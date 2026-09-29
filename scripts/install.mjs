#!/usr/bin/env node
// proflow installer — provisions the mod plus the native Command Code surfaces
// it carries, in one step. No git clone, no manual copying.
//
//   npx proflow install            # project (.commandcode/) — trust-gated
//   npx proflow install --global   # all projects (~/.commandcode/)
//   npx proflow uninstall [--global]
//   npx proflow status [--global]
//
// What `install` does, under the target scope's `.commandcode/`:
//   mods/proflow/   the mod package (dir-manifest auto-discovery — no settings edit)
//   skills/<name>/  the 25 agent-skills, so /skills and /skill:<name> work natively
//   agents/*.md     the 4 personas, so the `agent` tool can name them
// It records what it wrote in `proflow.manifest.json` so uninstall removes only
// proflow's files, and re-install never clobbers a foreign skill of the same name.

import {cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = 'proflow.manifest.json';
const PAYLOAD = [
	'mods',
	'commands',
	'skills',
	'references',
	'agents',
	'docs',
	'package.json',
	'README.md',
	'LICENSE',
	'LICENSE.agent-skills',
	'VENDOR.json',
];
const A = {reset: '\x1b[0m', dim: '\x1b[2m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m'};

const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
const rel = path => path.replace(`${PKG_ROOT}/`, '');
const info = msg => console.log(msg);
const ok = msg => console.log(`${A.green}✓${A.reset} ${msg}`);
const warn = msg => console.log(`${A.yellow}!${A.reset} ${msg}`);
const fail = msg => {
	console.error(`${A.red}✗ ${msg}${A.reset}`);
	process.exitCode = 1;
};

function findProjectRoot(start) {
	let dir = resolve(start);
	for (;;) {
		if (existsSync(join(dir, '.git'))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return resolve(start);
		dir = parent;
	}
}

function parseArgs(argv) {
	const opts = {scope: 'project', force: false, dryRun: false, skills: true, agents: true, commands: false};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--global' || arg === '-g') opts.scope = 'global';
		else if (arg === '--force' || arg === '-f') opts.force = true;
		else if (arg === '--dry-run') opts.dryRun = true;
		else if (arg === '--no-skills') opts.skills = false;
		else if (arg === '--no-agents') opts.agents = false;
		else if (arg === '--commands') opts.commands = true;
		else if (arg === '--project' || arg === '--dir') opts.project = argv[++i];
		else if (arg === '--help' || arg === '-h') opts.help = true;
		else fail(`unknown option: ${arg}`);
	}
	return opts;
}

function ccDirFor(opts) {
	return opts.scope === 'global'
		? join(homedir(), '.commandcode')
		: join(findProjectRoot(opts.project || process.cwd()), '.commandcode');
}

function readManifest(ccDir) {
	try {
		return JSON.parse(readFileSync(join(ccDir, MANIFEST), 'utf8'));
	} catch {
		return null;
	}
}

function copyInto(src, dest, opts) {
	if (opts.dryRun) return;
	mkdirSync(dirname(dest), {recursive: true});
	cpSync(src, dest, {recursive: true, force: true});
}

function install(opts) {
	const ccDir = ccDirFor(opts);
	const prev = readManifest(ccDir);
	const ownedSkills = new Set(prev?.skills ?? []);
	const ownedAgents = new Set(prev?.agents ?? []);
	const ownedCommands = new Set(prev?.commands ?? []);
	const where = opts.scope === 'global' ? '~/.commandcode' : `${ccDir.replace(/\/\.commandcode$/, '')}/.commandcode`;

	info(`${opts.dryRun ? 'Planning' : 'Installing'} proflow ${pkg.version} (${opts.scope}) → ${where}\n`);

	// 1. The mod package (dir-manifest discovery — no settings edit needed).
	const modDir = join(ccDir, 'mods', 'proflow');
	if (opts.dryRun) {
		info(`  mod      ${modDir} (replace)`);
	} else {
		rmSync(modDir, {recursive: true, force: true});
		for (const entry of PAYLOAD) {
			copyInto(join(PKG_ROOT, entry), join(modDir, basename(entry)), opts);
		}
		ok(`mod      ${modDir}`);
	}

	// 2. Native skills + 3. native personas, with collision protection.
	const skills = opts.skills
		? placeAll({
				srcDir: join(PKG_ROOT, 'skills'),
				destDir: join(ccDir, 'skills'),
				owned: ownedSkills,
				keep: name => existsSync(join(PKG_ROOT, 'skills', name, 'SKILL.md')),
				opts,
				label: 'skill',
			})
		: [];
	const agents = opts.agents
		? placeAll({
				srcDir: join(PKG_ROOT, 'agents'),
				destDir: join(ccDir, 'agents'),
				owned: ownedAgents,
				keep: name => name.endsWith('.md'),
				opts,
				label: 'agent',
				stripExt: true,
			})
		: [];
	const commands = opts.commands
		? placeAll({
				srcDir: join(PKG_ROOT, 'commands'),
				destDir: join(ccDir, 'commands'),
				owned: ownedCommands,
				keep: name => name.endsWith('.md'),
				opts,
				label: 'command',
				stripExt: true,
			})
		: [];

	if (!opts.dryRun) {
		writeFileSync(
			join(ccDir, MANIFEST),
			`${JSON.stringify(
				{
					name: 'proflow',
					version: pkg.version,
					scope: opts.scope,
					installedAt: new Date().toISOString(),
					modDir: 'mods/proflow',
					skills,
					agents,
					commands,
				},
				null,
				2,
			)}\n`,
		);
	}

	info('');
	info(
		opts.dryRun
			? `${A.yellow}Dry run — nothing written.${A.reset}`
			: `${A.green}proflow ${pkg.version} installed.${A.reset}`,
	);
	info(`  commands  /spec /to-plan /build /test /to-review /ship (via the mod)`);
	if (opts.skills) info(`  skills    ${skills.length} → ${join(ccDir, 'skills')}`);
	if (opts.agents) info(`  agents    ${agents.length} → ${join(ccDir, 'agents')}`);
	if (!opts.dryRun) {
		info(`\nNext: restart Command Code (or run /reload), then check ${A.dim}cmd mods list${A.reset} and /proflow.`);
	}
}

function placeAll({srcDir, destDir, owned, keep, opts, label, stripExt = false}) {
	if (!existsSync(srcDir)) return [];
	const placed = [];
	for (const name of readdirSync(srcDir).sort()) {
		if (!keep(name)) continue;
		const dest = join(destDir, stripExt ? `${name.replace(/\.md$/, '')}.md` : name);
		if (existsSync(dest) && !owned.has(name.replace(/\.md$/, ''))) {
			if (!opts.force) {
				warn(`${label} "${name}" already exists and was not installed by proflow — skipping (use --force)`);
				continue;
			}
		}
		copyInto(join(srcDir, name), dest, opts);
		placed.push(stripExt ? name.replace(/\.md$/, '') : name);
	}
	if (!opts.dryRun) ok(`${label.padEnd(8)} ${placed.length} → ${destDir}`);
	return placed;
}

function uninstall(opts) {
	const ccDir = ccDirFor(opts);
	const manifest = readManifest(ccDir);
	if (!manifest) {
		warn(`proflow is not installed in ${ccDir}`);
		return;
	}
	const remove = path => {
		if (opts.dryRun) return info(`  remove ${path}`);
		rmSync(path, {recursive: true, force: true});
	};
	remove(join(ccDir, 'mods', 'proflow'));
	for (const name of manifest.skills ?? []) remove(join(ccDir, 'skills', name));
	for (const name of manifest.agents ?? []) remove(join(ccDir, 'agents', `${name}.md`));
	for (const name of manifest.commands ?? []) remove(join(ccDir, 'commands', `${name}.md`));
	if (!opts.dryRun) rmSync(join(ccDir, MANIFEST), {force: true});
	pruneEmpty([join(ccDir, 'mods'), join(ccDir, 'skills'), join(ccDir, 'agents'), join(ccDir, 'commands')]);
	ok(`proflow uninstalled from ${ccDir}`);
}

function pruneEmpty(dirs) {
	for (const dir of dirs) {
		try {
			if (existsSync(dir) && statSync(dir).isDirectory() && readdirSync(dir).length === 0) rmSync(dir);
		} catch {
			// best effort
		}
	}
}

function status(opts) {
	const ccDir = ccDirFor(opts);
	const manifest = readManifest(ccDir);
	if (!manifest) return info(`proflow: not installed in ${ccDir}`);
	info(`proflow ${manifest.version} (${manifest.scope}) in ${ccDir}`);
	info(`  mod      ${existsSync(join(ccDir, 'mods', 'proflow')) ? 'present' : 'MISSING'}`);
	info(`  skills   ${manifest.skills?.length ?? 0}`);
	info(`  agents   ${manifest.agents?.length ?? 0}`);
	info(`  commands ${manifest.commands?.length ?? 0}${manifest.commands?.length ? '' : ' (provided by the mod)'}`);
	info(`  since    ${manifest.installedAt}`);
}

const argv = process.argv.slice(2);
// Allow `proflow --help` (no subcommand): treat a leading flag as install's.
const [command = 'install', ...rest] = argv[0]?.startsWith('-') ? ['install', ...argv] : argv;
const opts = parseArgs(rest);
if (opts.help || command === 'help') {
	info(`proflow — install the mod and its native skills/agents
  (run as \`npx @nntoan/proflow <command>\` or the installed \`proflow\` bin)

  proflow install   [--global] [--force] [--dry-run] [--no-skills] [--no-agents] [--commands]
  proflow uninstall [--global] [--dry-run]
  proflow status    [--global]`);
} else if (command === 'install') {
	install(opts);
} else if (command === 'uninstall' || command === 'remove') {
	uninstall(opts);
} else if (command === 'status') {
	status(opts);
} else {
	fail(`unknown command: ${command} (try: install, uninstall, status)`);
}
