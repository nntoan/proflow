#!/usr/bin/env node
// proflow installer — provisions the Command Code agent-skills pack natively
// (commands, skills, references, personas) plus the optional tool mods, into a
// project scope or the user scope.
//
//   npx @nntoan/proflow                 # no arguments: help. Never mutates anything.
//   proflow install [options]
//   proflow uninstall [options]
//   proflow status [--global]
//
// Two locations are resolved here and must never drift apart (see the plan's
// "target-location safety" section):
//
//   payload root   where the content packages live — resolved relative to THIS
//                  file, never relative to the cwd;
//   target scope   the git root's .commandcode/ (project) or ~/.commandcode/
//                  (global) — resolved from --project/--global, never the
//                  package directory.

import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(readFileSync(join(SELF_DIR, '..', 'package.json'), 'utf8')).version;
const MANIFEST = 'proflow.manifest.json';
const CONFIG_NAMES = ['proflow.json', 'proflow.jsonc'];

// Optional tool mods: package dir → the mod file it ships + the CLI it needs.
const MODS = {
	codegraph: {pkg: 'mod-codegraph', file: 'mods/codegraph.ts', cli: 'codegraph'},
	gh: {pkg: 'mod-gh', file: 'mods/gh.ts', cli: 'gh'},
	orca: {pkg: 'mod-orca', file: 'mods/orca.ts', cli: 'orca'},
};

const CLI_INSTALLERS = {
	darwin: {gh: ['brew', ['install', 'gh']], orca: null, codegraph: ['npm', ['i', '-g', '@colbymchenry/codegraph']]},
	linux: {gh: ['apt-get', ['install', '-y', 'gh']], orca: null, codegraph: ['npm', ['i', '-g', '@colbymchenry/codegraph']]},
	win32: {gh: ['winget', ['install', 'GitHub.cli']], orca: null, codegraph: ['npm', ['i', '-g', '@colbymchenry/codegraph']]},
};

// ── Plain output (the whole non-interactive path, and every failure) ───────────

const A = {reset: '\x1b[0m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m'};
const info = msg => console.log(msg);
const ok = msg => console.log(`${A.green}✓${A.reset} ${msg}`);
const warn = msg => console.log(`${A.yellow}!${A.reset} ${msg}`);
const fail = msg => {
	console.error(`${A.red}✗ ${msg}${A.reset}`);
	process.exitCode = 1;
};

// ── Locations ─────────────────────────────────────────────────────────────────

/**
 * Resolve a bundled payload package (the content pack, the magento pack, a mod
 * package) from THIS file's location. `marker` is a path that must exist inside
 * the package, so a same-named directory that is not the payload never matches.
 */
export function findPackage(name, marker) {
	const roots = [
		join(SELF_DIR, '..', '..', name), // monorepo checkout: packages/<name>
		join(SELF_DIR, '..', '..', '..', '@ultra-cmd', name), // installed: node_modules/@ultra-cmd/<name>
		...(process.env.PROFLOW_PAYLOAD_ROOT ? [join(process.env.PROFLOW_PAYLOAD_ROOT, name)] : []),
	];
	for (const dir of roots) {
		if (existsSync(join(dir, 'package.json')) && existsSync(join(dir, marker))) return resolve(dir);
	}
	return null;
}

/** The nearest ancestor containing `.git`, else `start`. */
export function findProjectRoot(start) {
	let dir = resolve(start);
	for (;;) {
		if (existsSync(join(dir, '.git'))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return resolve(start);
		dir = parent;
	}
}

/** The scope's `.commandcode` directory. */
function scopeDir(opts) {
	return opts.scope === 'global'
		? join(homedir(), '.commandcode')
		: join(findProjectRoot(opts.project || process.cwd()), '.commandcode');
}

const scopeLabel = (opts, ccDir) =>
	opts.scope === 'global' ? '~/.commandcode' : `${relative(dirname(ccDir), ccDir) || ccDir}`;

// ── Args ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
	const opts = {
		scope: 'project',
		yes: false,
		force: false,
		dryRun: false,
		magento2: undefined, // undefined = ask (or default off with --yes)
		mods: undefined, // undefined = ask
	};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--global' || arg === '-g') opts.scope = 'global';
		else if (arg === '--project' || arg === '--dir') opts.project = argv[++i];
		else if (arg === '--yes' || arg === '-y') opts.yes = true;
		else if (arg === '--force' || arg === '-f') opts.force = true;
		else if (arg === '--dry-run') opts.dryRun = true;
		else if (arg === '--magento2') opts.magento2 = true;
		else if (arg === '--no-magento2') opts.magento2 = false;
		else if (arg === '--mod') {
			opts.mods = (argv[++i] ?? '')
				.split(',')
				.map(s => s.trim())
				.filter(Boolean);
		} else if (arg === '--help' || arg === '-h') opts.help = true;
		else fail(`unknown option: ${arg} (try --help)`);
	}
	for (const name of opts.mods ?? []) {
		if (!MODS[name]) fail(`unknown mod "${name}" (known: ${Object.keys(MODS).join(', ')})`);
	}
	return opts;
}

function usage() {
	info(`proflow ${VERSION} — provision the Command Code agent-skills pack
  (also: \`npx @nntoan/proflow install\`)

  proflow install   [--global] [--project <dir>] [--yes] [--force] [--dry-run]
                    [--magento2] [--mod codegraph,gh,orca]
  proflow uninstall [--global] [--dry-run]
  proflow status    [--global]
  proflow --version

  Interactive by default: scope, optional packs, and any missing CLI are asked.
  --yes takes the defaults without prompting (required when stdin is not a TTY).`);
}

// ── Manifest ──────────────────────────────────────────────────────────────────

function readManifest(ccDir) {
	try {
		return JSON.parse(readFileSync(join(ccDir, MANIFEST), 'utf8'));
	} catch {
		return null;
	}
}

// ── Planning ──────────────────────────────────────────────────────────────────

export function buildPlan(opts, selection) {
	const ccDir = scopeDir(opts);
	const content = findPackage('proflow', 'commands');
	const plan = {ccDir, content, packs: selection, steps: [], problems: []};
	if (!content) {
		plan.problems.push('the proflow content package was not found next to the installer');
		return plan;
	}

	plan.steps.push({key: 'commands', title: 'commands', src: join(content, 'commands'), dest: join(ccDir, 'commands'), kind: 'files', ext: '.md', label: 'command'});
	plan.steps.push({key: 'skills', title: 'skills', src: join(content, 'skills'), dest: join(ccDir, 'skills'), kind: 'dirs', label: 'skill'});
	plan.steps.push({key: 'references', title: 'references', src: join(content, 'references'), dest: join(ccDir, 'references'), kind: 'files', ext: '.md', label: 'reference'});
	plan.steps.push({key: 'agents', title: 'agents', src: join(content, 'agents'), dest: join(ccDir, 'agents'), kind: 'files', ext: '.md', label: 'agent'});
	plan.steps.push({key: 'docs', title: 'docs', src: join(content, 'docs'), dest: join(ccDir, 'docs'), kind: 'files', ext: '.md', label: 'doc'});
	plan.steps.push({key: 'mod', title: 'harness mod', src: join(content, 'mods'), dest: join(ccDir, 'mods'), kind: 'files', ext: '.ts', label: 'mod'});

	if (selection.magento2) {
		const m2 = findPackage('magento2', 'skills');
		if (!m2) plan.problems.push('the magento2 pack was not found next to the installer');
		else plan.magento2 = {dir: m2, ccDir};
	}

	for (const name of selection.mods) {
		const mod = findPackage(MODS[name].pkg, 'mods');
		if (!mod) plan.problems.push(`mod "${name}" was not found next to the installer`);
		else (plan.modFiles ??= []).push({name, src: join(mod, MODS[name].file), dest: join(ccDir, 'mods', basename(MODS[name].file))});
	}

	plan.config = join(content, CONFIG_NAMES[1]);
	return plan;
}

// ── Applying ──────────────────────────────────────────────────────────────────

function copyFileInto(src, dest, dryRun) {
	if (dryRun) return;
	mkdirSync(dirname(dest), {recursive: true});
	cpSync(src, dest, {force: true});
}

function copyDirInto(src, dest, dryRun) {
	if (dryRun) return;
	rmSync(dest, {recursive: true, force: true});
	cpSync(src, dest, {recursive: true, force: true});
}

/** Place every entry of `step.src` into `step.dest`, skipping foreign collisions. */
function placeStep(step, {dryRun, force, owned}) {
	if (!existsSync(step.src)) return {placed: [], entries: [], skipped: []};
	const placed = [];
	const entries = [];
	const skipped = [];
	for (const name of readdirSync(step.src).sort()) {
		if (step.ext && !name.endsWith(step.ext)) continue;
		const bare = name.replace(/\.md$/, '').replace(/\.ts$/, '');
		if (step.kind === 'dirs' && !existsSync(join(step.src, name, 'SKILL.md'))) continue;
		const dest = join(step.dest, name);
		const mine = owned.has(bare) || owned.has(name);
		if (existsSync(dest) && !mine && !force) {
			skipped.push(name);
			continue;
		}
		if (step.kind === 'dirs') copyDirInto(join(step.src, name), dest, dryRun);
		else copyFileInto(join(step.src, name), dest, dryRun);
		placed.push(bare);
		entries.push(name);
	}
	return {placed, entries, skipped};
}

function mergeHookEntry(file, event, entry, dryRun) {
	let settings = {};
	if (existsSync(file)) {
		try {
			settings = JSON.parse(readFileSync(file, 'utf8'));
		} catch {
			warn(`could not parse ${file} — leaving it untouched`);
			return false;
		}
	}
	settings.hooks = settings.hooks ?? {};
	settings.hooks[event] = settings.hooks[event] ?? [];
	const command = entry.hooks[0].command;
	const already = settings.hooks[event].some(group => (group.hooks ?? []).some(h => h.command === command));
	if (!already) settings.hooks[event].push(entry);
	if (!dryRun) writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
	return true;
}

/** Drop a settings.json that only exists because this install created it (now `{}`). */
function removeEmptySettings(file, dryRun) {
	if (dryRun || !existsSync(file)) return;
	try {
		if (Object.keys(JSON.parse(readFileSync(file, 'utf8'))).length === 0) rmSync(file, {force: true});
	} catch {
		// An unparseable file is never ours to delete.
	}
}

function removeHookEntries(file, commands, dryRun) {
	if (!existsSync(file)) return;
	let settings;
	try {
		settings = JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		return;
	}
	if (!settings.hooks) return;
	for (const event of Object.keys(settings.hooks)) {
		settings.hooks[event] = settings.hooks[event].filter(
			group => !(group.hooks ?? []).some(h => commands.includes(h.command)),
		);
		if (settings.hooks[event].length === 0) delete settings.hooks[event];
	}
	if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
	if (!dryRun) writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

export function applyPlan(plan, opts, {onStep} = {}) {
	const prev = readManifest(plan.ccDir);
	const owned = {
		skills: new Set([...(prev?.skills ?? []), ...(prev?.magento2?.skills ?? [])]),
		agents: new Set([...(prev?.agents ?? []), ...(prev?.magento2?.agents ?? [])]),
		commands: new Set([...(prev?.commands ?? []), ...(prev?.magento2?.commands ?? [])]),
		references: new Set(prev?.references ?? []),
		docs: new Set(prev?.docs ?? []),
		mod: new Set(prev?.mods ?? []),
	};
	const result = {skills: [], agents: [], commands: [], references: [], docs: [], mods: [], magento2: null, config: null, skipped: []};

	for (const step of plan.steps) {
		onStep?.(step.title);
		const ownedSet = owned[step.key] ?? new Set();
		const {placed, entries, skipped} = placeStep(step, {dryRun: opts.dryRun, force: opts.force, owned: ownedSet});
		result.skipped.push(...skipped);
		if (step.key === 'skills') result.skills = placed;
		else if (step.key === 'agents') result.agents = placed;
		else if (step.key === 'commands') result.commands = placed;
		else if (step.key === 'references') result.references = placed;
		else if (step.key === 'docs') result.docs = entries;
		// Mods are recorded with their extension: uninstall deletes the exact file.
		else if (step.key === 'mod') result.mods = entries;
	}

	if (plan.magento2) {
		const {dir, ccDir} = plan.magento2;
		const m2 = {skills: [], commands: [], agents: [], hooks: []};
		const sub = [
			{key: 'skills', src: join(dir, 'skills'), dest: join(ccDir, 'skills'), kind: 'dirs', label: 'skill'},
			{key: 'commands', src: join(dir, 'commands'), dest: join(ccDir, 'commands'), kind: 'files', ext: '.md', label: 'command'},
			{key: 'agents', src: join(dir, 'agents'), dest: join(ccDir, 'agents'), kind: 'files', ext: '.md', label: 'agent'},
		];
		for (const step of sub) {
			onStep?.(`magento2 ${step.key}`);
			const {placed} = placeStep(step, {dryRun: opts.dryRun, force: opts.force, owned: owned[step.key]});
			m2[step.key] = placed;
		}
		if (opts.hooks !== false) {
			onStep?.('magento2 hooks');
			const src = join(dir, 'hooks');
			if (existsSync(src)) {
				const destDir = join(ccDir, 'hooks', 'm2');
				for (const file of readdirSync(src).filter(f => f.endsWith('.sh'))) {
					copyFileInto(join(src, file), join(destDir, file), opts.dryRun);
				}
				const guard =
					opts.scope === 'global'
						? join(destDir, 'guard-docs-path.sh')
						: './.commandcode/hooks/m2/guard-docs-path.sh';
				const command = `bash ${guard}`;
				mergeHookEntry(join(ccDir, 'settings.json'), 'PreToolUse', {matcher: 'write|edit', hooks: [{type: 'command', command, timeout: 10}]}, opts.dryRun);
				m2.hooks = [command];
			}
		}
		result.magento2 = m2;
	}

	for (const file of plan.modFiles ?? []) {
		onStep?.(`mod ${file.name}`);
		copyFileInto(file.src, file.dest, opts.dryRun);
		result.mods.push(basename(file.dest));
	}

	// The guard config template is written only when the scope has no config yet.
	if (existsSync(plan.config) && !CONFIG_NAMES.some(name => existsSync(join(plan.ccDir, name)))) {
		onStep?.(CONFIG_NAMES[1]);
		copyFileInto(plan.config, join(plan.ccDir, CONFIG_NAMES[1]), opts.dryRun);
		result.config = CONFIG_NAMES[1];
	}

	if (!opts.dryRun) {
		writeFileSync(
			join(plan.ccDir, MANIFEST),
			`${JSON.stringify(
				{
					name: 'proflow',
					version: VERSION,
					scope: opts.scope,
					installedAt: new Date().toISOString(),
					packs: {magento2: Boolean(result.magento2), mods: (plan.modFiles ?? []).map(f => f.name)},
					skills: result.skills,
					agents: result.agents,
					commands: result.commands,
					references: result.references,
					docs: result.docs,
					mods: result.mods,
					magento2: result.magento2,
					config: result.config,
				},
				null,
				2,
			)}\n`,
		);
	}
	return result;
}

// ── Commands ──────────────────────────────────────────────────────────────────

function install(opts, selection) {
	const plan = buildPlan(opts, selection);
	if (plan.problems.length > 0) {
		for (const problem of plan.problems) fail(problem);
		return;
	}
	const where = scopeLabel(opts, plan.ccDir);
	info(`${opts.dryRun ? 'Planning' : 'Installing'} proflow ${VERSION} (${opts.scope}) → ${where}`);
	info(`${A.dim}payload ${plan.content}${A.reset}`);
	const result = applyPlan(plan, opts, {onStep: title => info(`  ${title}`)});
	for (const name of result.skipped) warn(`${name} already exists and was not installed by proflow — skipping (use --force)`);
	info('');
	if (opts.dryRun) return info(`${A.yellow}Dry run — nothing written.${A.reset}`);
	ok(`proflow ${VERSION} installed in ${where}`);
	info(`  commands   ${result.commands.length} · skills ${result.skills.length} · references ${result.references.length} · agents ${result.agents.length}`);
	if (result.magento2) info(`  magento2   ${result.magento2.skills.length} skills · ${result.magento2.commands.length} commands · ${result.magento2.agents.length} agents`);
	if (result.mods.length) info(`  mods       ${result.mods.join(', ')}`);
	info(`\nNext: restart Command Code (or run /reload).`);
}

function uninstall(opts) {
	const ccDir = scopeDir(opts);
	const manifest = readManifest(ccDir);
	if (!manifest) return warn(`proflow is not installed in ${ccDir}`);
	const remove = path => {
		if (opts.dryRun) return info(`  remove ${path}`);
		rmSync(path, {recursive: true, force: true});
	};
	for (const name of manifest.commands ?? []) remove(join(ccDir, 'commands', `${name}.md`));
	for (const name of manifest.references ?? []) remove(join(ccDir, 'references', `${name}.md`));
	for (const name of manifest.skills ?? []) remove(join(ccDir, 'skills', name));
	for (const name of manifest.agents ?? []) remove(join(ccDir, 'agents', `${name}.md`));
	for (const name of manifest.mods ?? []) remove(join(ccDir, 'mods', name));
	for (const name of manifest.docs ?? ['agents.md']) remove(join(ccDir, 'docs', name));
	const m2 = manifest.magento2;
	if (m2) {
		for (const name of m2.skills ?? []) remove(join(ccDir, 'skills', name));
		for (const name of m2.commands ?? []) remove(join(ccDir, 'commands', `${name}.md`));
		for (const name of m2.agents ?? []) remove(join(ccDir, 'agents', `${name}.md`));
		const settingsFile = join(ccDir, 'settings.json');
		removeHookEntries(settingsFile, m2.hooks ?? [], opts.dryRun);
		removeEmptySettings(settingsFile, opts.dryRun);
		remove(join(ccDir, 'hooks', 'm2'));
	}
	if (manifest.config) remove(join(ccDir, manifest.config));
	if (!opts.dryRun) rmSync(join(ccDir, MANIFEST), {force: true});
	pruneEmpty(ccDir, ['commands', 'references', 'docs', 'skills', 'agents', 'mods', 'hooks'], opts.dryRun);
	ok(`proflow uninstalled from ${ccDir}`);
}

function pruneEmpty(ccDir, dirs, dryRun) {
	if (dryRun) return;
	for (const dir of dirs) {
		const path = join(ccDir, dir);
		try {
			if (existsSync(path) && statSync(path).isDirectory() && readdirSync(path).length === 0) {
				rmSync(path, {recursive: true, force: true});
			}
		} catch {
			// best effort
		}
	}
}

function status(opts) {
	const ccDir = scopeDir(opts);
	const manifest = readManifest(ccDir);
	if (!manifest) return info(`proflow: not installed in ${ccDir}`);
	info(`proflow ${manifest.version} (${manifest.scope}) in ${ccDir}`);
	info(`  commands   ${manifest.commands?.length ?? 0}`);
	info(`  skills     ${manifest.skills?.length ?? 0}`);
	info(`  references ${manifest.references?.length ?? 0}`);
	info(`  agents     ${manifest.agents?.length ?? 0}`);
	info(`  mods       ${(manifest.mods ?? []).join(', ') || '(none)'}`);
	if (manifest.magento2) {
		info(`  magento2   ${manifest.magento2.skills?.length ?? 0} skills · ${manifest.magento2.commands?.length ?? 0} commands · ${manifest.magento2.agents?.length ?? 0} agents`);
	}
	info(`  since      ${manifest.installedAt}`);
}

// ── CLI bootstrap ─────────────────────────────────────────────────────────────

function onPath(command) {
	const finder = process.platform === 'win32' ? 'where' : 'which';
	try {
		return spawnSync(finder, [command], {stdio: 'ignore'}).status === 0;
	} catch {
		return false;
	}
}

function cliInstaller(name) {
	const table = CLI_INSTALLERS[process.platform] ?? CLI_INSTALLERS.linux;
	return (table[name] ?? null) || (name === 'codegraph' ? ['npm', ['i', '-g', '@colbymchenry/codegraph']] : null);
}

function tryInstallCli(name) {
	const entry = cliInstaller(name);
	if (!entry) return false;
	const [command, args] = entry;
	info(`  ${command} ${args.join(' ')}`);
	return spawnSync(command, args, {stdio: 'inherit'}).status === 0;
}

// ── Wizard ────────────────────────────────────────────────────────────────────

async function wizard(opts) {
	const p = await import('@clack/prompts');
	const cancel = () => {
		p.cancel('Cancelled — nothing was written.');
		process.exit(0);
	};
	const guard = value => {
		if (p.isCancel(value)) cancel();
		return value;
	};

	const ccDir = scopeDir(opts);
	const prev = readManifest(ccDir);
	p.intro(`proflow ${VERSION} — Command Code setup`);

	if (prev) {
		const action = guard(
			await p.select({
				message: `proflow is already installed in ${scopeLabel(opts, ccDir)}.`,
				options: [
					{value: 'reconfigure', label: 'Reconfigure', hint: 'add or remove packs, change what is installed'},
					{value: 'status', label: 'Status', hint: 'show what is installed'},
					{value: 'uninstall', label: 'Uninstall', hint: 'remove only what proflow wrote'},
				],
			}),
		);
		if (action === 'status') {
			status(opts);
			return p.outro('Nothing changed.');
		}
		if (action === 'uninstall') {
			const go = guard(await p.confirm({message: 'Remove proflow from this scope?', initialValue: false}));
			if (!go) return p.outro('Nothing changed.');
			uninstall(opts);
			return p.outro('Done.');
		}
	}

	const answers = await p.group(
		{
			scope: () =>
				p.select({
					message: 'Install scope?',
					initialValue: opts.scope,
					options: [
						{
							value: 'project',
							label: 'Project',
							hint: `${relative(process.cwd(), scopeDir({...opts, scope: 'project'})) || '.'}/.commandcode — this project only`,
						},
						{value: 'global', label: 'Global', hint: '~/.commandcode — all projects'},
					],
				}),
			packs: () =>
				p.multiselect({
					message: 'Optional packs',
					required: false,
					options: [
						{value: 'magento2', label: 'Magento 2', hint: '36 skills · 18 commands · 2 personas · docs guard hook'},
						{value: 'codegraph', label: 'CodeGraph tools', hint: 'read-only explore/node/status — works in plan mode'},
						{value: 'gh', label: 'GitHub tools', hint: 'all of gh — read-only calls need no prompt'},
						{value: 'orca', label: 'Orca tools', hint: 'all of orca — worktrees, terminals, artifacts'},
					],
				}),
		},
		{onCancel: cancel},
	);

	const selection = {magento2: answers.packs.includes('magento2'), mods: answers.packs.filter(v => v !== 'magento2')};

	// Per-missing-CLI confirm: one question per selected pack whose CLI is absent.
	const usableMods = [];
	for (const name of selection.mods) {
		const cli = MODS[name].cli;
		if (onPath(cli)) {
			usableMods.push(name);
			continue;
		}
		const entry = cliInstaller(name);
		const installIt = guard(
			await p.confirm({
				message: `${cli} was not found on PATH. Install it now?`,
				initialValue: Boolean(entry),
			}),
		);
		if (!installIt) {
			p.log.warn(`Skipping the ${name} pack — ${cli} is required.`);
			continue;
		}
		const spinner = p.spinner();
		spinner.start(`Installing ${cli}`);
		const done = entry ? tryInstallCli(cli) : false;
		spinner.stop(done && onPath(cli) ? `${cli} installed` : `${cli} could not be installed — skipping the ${name} pack`);
		if (done && onPath(cli)) usableMods.push(name);
	}
	selection.mods = usableMods;

	const plan = buildPlan({...opts, scope: answers.scope}, selection);
	if (plan.problems.length > 0) {
		for (const problem of plan.problems) p.log.error(problem);
		return p.outro('Nothing written.');
	}

	const target = scopeLabel({...opts, scope: answers.scope}, plan.ccDir);
	p.note(
		[
			`scope     ${answers.scope} → ${target}`,
			`commands  ${readdirSync(plan.steps[0].src).length} (native)`,
			`skills    ${readdirSync(plan.steps[1].src).length} native skills`,
			`references ${readdirSync(plan.steps[2].src).length} · agents ${readdirSync(plan.steps[3].src).length}`,
			`packs     ${[selection.magento2 ? 'magento2' : null, ...selection.mods].filter(Boolean).join(', ') || 'core only'}`,
			`mods      proflow harness${selection.mods.length ? ` + ${selection.mods.join(', ')}` : ''}`,
		].join('\n'),
		'Plan',
	);

	const tasks = plan.steps.map(step => ({title: `install ${step.title}`, task: () => `${step.title}`}));
	const spinner = p.tasks(tasks);
	await spinner;

	const result = applyPlan(plan, {...opts, scope: answers.scope});
	for (const name of result.skipped) p.log.warn(`${name} already existed and was not installed by proflow — skipping`);
	p.outro(`Installed ${result.commands.length} commands · ${result.skills.length} skills · ${result.agents.length} personas. Restart Command Code or run /reload.`);
}

// ── Entry point ───────────────────────────────────────────────────────────────
// Guarded so the module can be imported by the tests without running the CLI.

async function main(argv) {
	if (argv.includes('--version') || argv.includes('-v') || argv[0] === 'version') {
		info(VERSION);
		return;
	}
	if (argv.length === 0) {
		// No subcommand: print help. A bare invocation must never mutate the cwd.
		usage();
		return;
	}
	const [command, ...rest] = argv[0].startsWith('-') ? ['install', ...argv] : argv;
	const opts = parseArgs(rest);
	if (opts.help || command === 'help') {
		usage();
	} else if (command === 'uninstall' || command === 'remove') {
		uninstall(opts);
	} else if (command === 'status') {
		status(opts);
	} else if (command === 'install') {
		const isTty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
		if (opts.dryRun || opts.yes || !isTty) {
			if (!isTty && !opts.yes && !opts.dryRun) {
				fail('not a TTY — re-run with --yes (or pass flags) so nothing is installed by surprise');
			} else {
				install(opts, {magento2: opts.magento2 ?? false, mods: opts.mods ?? []});
			}
		} else {
			await wizard(opts);
		}
	} else {
		fail(`unknown command: ${command} (try: install, uninstall, status; or --help)`);
	}
}

const invokedDirectly =
	process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) await main(process.argv.slice(2));
