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
//   agents/*.md     the personas, so the `agent` tool can name them
//   --mcp <name>    merges a known MCP server into the scope's mcp.json (e.g. codegraph)
// It records what it wrote in `proflow.manifest.json` so uninstall removes only
// proflow's files, and re-install never clobbers a foreign skill of the same name.

import {spawnSync} from 'node:child_process';
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
// MCP servers the installer can bundle with `--mcp <name>`.
const MCP_PRESETS = {
	codegraph: {transport: 'stdio', command: 'codegraph', args: ['serve', '--mcp']},
};
// Optional components, vendored under components/<name>/ (extra skills, commands, agents, hooks).
const COMPONENTS = ['magento2'];
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
	const opts = {scope: 'project', force: false, dryRun: false, skills: true, agents: true, commands: false, hooks: true, mcp: [], components: []};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--global' || arg === '-g') opts.scope = 'global';
		else if (arg === '--force' || arg === '-f') opts.force = true;
		else if (arg === '--dry-run') opts.dryRun = true;
		else if (arg === '--no-skills') opts.skills = false;
		else if (arg === '--no-agents') opts.agents = false;
		else if (arg === '--commands') opts.commands = true;
		else if (arg === '--mcp') opts.mcp.push(argv[++i]);
		else if (arg === '--component') opts.components.push(argv[++i]);
		else if (arg === '--magento2') opts.components.push('magento2');
		else if (arg === '--no-hooks') opts.hooks = false;
		else if (arg === '--project' || arg === '--dir') opts.project = argv[++i];
		else if (arg === '--help' || arg === '-h') opts.help = true;
		else fail(`unknown option: ${arg}`);
	}
	for (const name of opts.mcp) {
		if (!MCP_PRESETS[name]) fail(`unknown MCP preset "${name}" (known: ${Object.keys(MCP_PRESETS).join(', ')})`);
	}
	for (const name of opts.components) {
		if (!COMPONENTS.includes(name)) fail(`unknown component "${name}" (known: ${COMPONENTS.join(', ')})`);
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

	// 4. Optional MCP servers (e.g. codegraph), merged into the scope's mcp.json.
	const mcp = opts.mcp.length > 0 ? installMcp({opts, ccDir}) : {file: null, servers: []};

	// 5. Optional components (e.g. magento2): extra skills, commands, agents, and hooks.
	const components = {};
	for (const name of opts.components) {
		if (name === 'magento2') {
			components.magento2 = installMagento2({
				opts,
				ccDir,
				owned: {
					skills: new Set(prev?.components?.magento2?.skills ?? []),
					commands: new Set(prev?.components?.magento2?.commands ?? []),
					agents: new Set(prev?.components?.magento2?.agents ?? []),
				},
			});
		}
	}

	// 6. CodeGraph wiring — only when its MCP preset is selected (mirrors Claude Code).
	const codegraph = opts.mcp.includes('codegraph')
		? installCodegraph({opts, ccDir})
		: {hooks: [], permissions: []};

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
					mcp,
					components,
					codegraph,
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
	info(`  commands  /brainstorm /spec /to-plan /build /test /to-review /ship (via the mod)`);
	if (opts.skills) info(`  skills    ${skills.length} → ${join(ccDir, 'skills')}`);
	if (opts.agents) info(`  agents    ${agents.length} → ${join(ccDir, 'agents')}`);
	if (mcp.servers.length) info(`  mcp       ${mcp.servers.join(', ')} → ${mcp.file}`);
	if (codegraph.hooks.length) info(`  codegraph allow+hooks → ${join(ccDir, 'settings.json')}`);
	if (components.magento2) {
		const c = components.magento2;
		info(`  magento2  ${c.skills.length} skills · ${c.commands.length} commands · ${c.agents.length} agents · ${c.hooks.length} hook(s)`);
	}
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

function mcpFileFor(opts, ccDir) {
	// project scope → <projectRoot>/.mcp.json (shared, committed)
	// global scope  → ~/.commandcode/mcp.json (user scope)
	return opts.scope === 'global' ? join(ccDir, 'mcp.json') : join(dirname(ccDir), '.mcp.json');
}

function onPath(command) {
	const finder = process.platform === 'win32' ? 'where' : 'which';
	try {
		return spawnSync(finder, [command], {stdio: 'ignore'}).status === 0;
	} catch {
		return false;
	}
}

function installMcp({opts, ccDir}) {
	const file = mcpFileFor(opts, ccDir);
	let config = {};
	if (existsSync(file)) {
		try {
			config = JSON.parse(readFileSync(file, 'utf8'));
		} catch {
			warn(`could not parse ${file} — leaving it untouched`);
			return {file: null, servers: []};
		}
	}
	config.mcpServers = config.mcpServers ?? {};

	const servers = [];
	for (const name of opts.mcp) {
		const preset = MCP_PRESETS[name];
		const existing = config.mcpServers[name];
		if (existing && JSON.stringify(existing) === JSON.stringify(preset)) {
			warn(`mcp "${name}" is already configured in ${file} — leaving it as is`);
			continue; // not ours to remove on uninstall
		}
		if (existing && !opts.force) {
			warn(`mcp "${name}" exists in ${file} with a different config — skipping (use --force)`);
			continue;
		}
		config.mcpServers[name] = preset;
		servers.push(name);
		if (preset.command && !onPath(preset.command)) {
			warn(`"${preset.command}" is not on PATH — the ${name} server will not start until it is installed`);
		}
	}
	if (servers.length > 0 && !opts.dryRun) {
		mkdirSync(dirname(file), {recursive: true});
		writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
		ok(`mcp      ${servers.join(', ')} → ${file}`);
	}
	return {file, servers};
}

function removeMcp(mcp, opts) {
	if (!mcp?.file || !mcp.servers?.length) return;
	try {
		const config = JSON.parse(readFileSync(mcp.file, 'utf8'));
		for (const name of mcp.servers) delete config.mcpServers?.[name];
		if (opts.dryRun) return info(`  remove mcp ${mcp.servers.join(', ')} from ${mcp.file}`);
		writeFileSync(mcp.file, `${JSON.stringify(config, null, 2)}\n`);
	} catch {
		// Missing or unreadable — nothing to undo.
	}
}

function installMagento2({opts, ccDir, owned}) {
	const src = join(PKG_ROOT, 'components', 'magento2');
	if (!existsSync(src)) {
		warn('magento2 component is not vendored — run `node scripts/sync-magento2.mjs` first');
		return {skills: [], commands: [], agents: [], hooks: []};
	}
	const skills = placeAll({
		srcDir: join(src, 'skills'),
		destDir: join(ccDir, 'skills'),
		owned: owned.skills,
		keep: name => existsSync(join(src, 'skills', name, 'SKILL.md')),
		opts,
		label: 'skill',
	});
	const commands = placeAll({
		srcDir: join(src, 'commands'),
		destDir: join(ccDir, 'commands'),
		owned: owned.commands,
		keep: name => name.endsWith('.md'),
		opts,
		label: 'command',
		stripExt: true,
	});
	const agents = placeAll({
		srcDir: join(src, 'agents'),
		destDir: join(ccDir, 'agents'),
		owned: owned.agents,
		keep: name => name.endsWith('.md'),
		opts,
		label: 'agent',
		stripExt: true,
	});
	const hooks = opts.hooks ? installMagento2Hooks({opts, ccDir}) : [];
	return {skills, commands, agents, hooks};
}

function installMagento2Hooks({opts, ccDir}) {
	const srcDir = join(PKG_ROOT, 'components', 'magento2', 'hooks');
	const destDir = join(ccDir, 'hooks', 'm2');
	if (!existsSync(srcDir)) return [];
	const files = readdirSync(srcDir).filter(file => file.endsWith('.sh'));
	for (const file of files) copyInto(join(srcDir, file), join(destDir, file), opts);
	if (!opts.dryRun) ok(`hooks    ${files.length} → ${destDir}`);

	// Project hooks run from the project root; global hooks need an absolute path.
	const guard =
		opts.scope === 'global'
			? join(destDir, 'guard-docs-path.sh')
			: './.commandcode/hooks/m2/guard-docs-path.sh';
	const command = `bash ${guard}`;
	mergeHookEntry(join(ccDir, 'settings.json'), 'PreToolUse', {matcher: 'write|edit', hooks: [{type: 'command', command, timeout: 10}]}, opts);
	return [command];
}

function readSettings(file) {
	if (!existsSync(file)) return {};
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		warn(`could not parse ${file} — leaving it untouched`);
		return null;
	}
}

function writeSettings(file, settings, opts) {
	if (opts?.dryRun) return;
	mkdirSync(dirname(file), {recursive: true});
	writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Append a hook entry to `settings.hooks[event]` unless the same command is already there. */
function mergeHookEntry(file, event, entry, opts) {
	const settings = readSettings(file);
	if (!settings) return false;
	settings.hooks = settings.hooks ?? {};
	settings.hooks[event] = settings.hooks[event] ?? [];
	const command = entry.hooks[0].command;
	if (settings.hooks[event].some(group => (group.hooks ?? []).some(h => h.command === command))) return true;
	settings.hooks[event].push(entry);
	writeSettings(file, settings, opts);
	return true;
}

/** Add entries to `permissions.allow` (idempotent). */
function mergePermissions(file, entries, opts) {
	const settings = readSettings(file);
	if (!settings) return false;
	settings.permissions = settings.permissions ?? {};
	settings.permissions.allow = settings.permissions.allow ?? [];
	for (const entry of entries) {
		if (!settings.permissions.allow.includes(entry)) settings.permissions.allow.push(entry);
	}
	writeSettings(file, settings, opts);
	return true;
}

/** Remove every hook entry whose command is in `commands`, across all events. */
function removeHookEntries(file, commands, opts) {
	const settings = readSettings(file);
	if (!settings?.hooks) return;
	for (const event of Object.keys(settings.hooks)) {
		settings.hooks[event] = settings.hooks[event].filter(
			group => !(group.hooks ?? []).some(h => commands.includes(h.command)),
		);
		if (settings.hooks[event].length === 0) delete settings.hooks[event];
	}
	if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
	writeSettings(file, settings, opts);
}

function removePermissions(file, entries, opts) {
	const settings = readSettings(file);
	if (!Array.isArray(settings?.permissions?.allow)) return;
	settings.permissions.allow = settings.permissions.allow.filter(entry => !entries.includes(entry));
	if (settings.permissions.allow.length === 0) delete settings.permissions.allow;
	if (Object.keys(settings.permissions).length === 0) delete settings.permissions;
	writeSettings(file, settings, opts);
}

function removeMagento2Hooks(ccDir, commands, opts) {
	removeHookEntries(join(ccDir, 'settings.json'), commands, opts);
	rmSync(join(ccDir, 'hooks', 'm2'), {recursive: true, force: true});
}

/**
 * CodeGraph wiring — mirrors the Claude Code + GitNexus setup: install the hook
 * script, allow the MCP tools and the CLI, and register the PreToolUse augment
 * and PostToolUse freshness hooks.
 */
function installCodegraph({opts, ccDir}) {
	const src = join(PKG_ROOT, 'hooks', 'codegraph-hook.cjs');
	if (!existsSync(src)) {
		warn('codegraph hook not found in the package');
		return {hooks: [], permissions: []};
	}
	const destDir = join(ccDir, 'hooks', 'codegraph');
	copyInto(src, join(destDir, 'codegraph-hook.cjs'), opts);
	if (!opts.dryRun) ok(`hooks    codegraph-hook.cjs → ${destDir}`);

	const command =
		opts.scope === 'global'
			? `node ${join(destDir, 'codegraph-hook.cjs')}`
			: 'node ./.commandcode/hooks/codegraph/codegraph-hook.cjs';
	const permissions = ['mcp__codegraph__*', 'Shell(codegraph *)'];
	const file = join(ccDir, 'settings.json');
	mergePermissions(file, permissions, opts);
	mergeHookEntry(file, 'PreToolUse', {matcher: 'read|shell', hooks: [{type: 'command', command, timeout: 10}]}, opts);
	mergeHookEntry(file, 'PostToolUse', {matcher: 'shell', hooks: [{type: 'command', command, timeout: 10}]}, opts);
	return {hooks: [command], permissions};
}

function removeCodegraph(ccDir, wiring, opts) {
	const file = join(ccDir, 'settings.json');
	if (wiring?.hooks?.length) removeHookEntries(file, wiring.hooks, opts);
	if (wiring?.permissions?.length) removePermissions(file, wiring.permissions, opts);
	rmSync(join(ccDir, 'hooks', 'codegraph'), {recursive: true, force: true});
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
	const magento = manifest.components?.magento2;
	if (magento) {
		for (const name of magento.skills ?? []) remove(join(ccDir, 'skills', name));
		for (const name of magento.commands ?? []) remove(join(ccDir, 'commands', `${name}.md`));
		for (const name of magento.agents ?? []) remove(join(ccDir, 'agents', `${name}.md`));
		removeMagento2Hooks(ccDir, magento.hooks ?? [], opts);
	}
	removeMcp(manifest.mcp, opts);
	removeCodegraph(ccDir, manifest.codegraph, opts);
	if (!opts.dryRun) rmSync(join(ccDir, MANIFEST), {force: true});
	pruneEmpty([join(ccDir, 'mods'), join(ccDir, 'skills'), join(ccDir, 'agents'), join(ccDir, 'commands'), join(ccDir, 'hooks')]);
	ok(`proflow uninstalled from ${ccDir}`);
}

function pruneEmpty(dirs) {
	for (const dir of dirs) {
		try {
			if (existsSync(dir) && statSync(dir).isDirectory() && readdirSync(dir).length === 0) {
				rmSync(dir, {recursive: true, force: true});
			}
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
	if (manifest.mcp?.servers?.length) info(`  mcp      ${manifest.mcp.servers.join(', ')} → ${manifest.mcp.file}`);
	if (manifest.codegraph?.hooks?.length) info(`  codegraph allow + hooks → ${join(ccDir, 'settings.json')}`);
	if (manifest.components?.magento2) {
		const c = manifest.components.magento2;
		info(`  magento2 ${c.skills?.length ?? 0} skills, ${c.commands?.length ?? 0} commands, ${c.agents?.length ?? 0} agents`);
	}
	info(`  since    ${manifest.installedAt}`);
}

function usage() {
	info(`proflow ${pkg.version} — install the mod and its native skills/agents
  (run as \`npx @nntoan/proflow <command>\` or the installed \`proflow\` bin)

  proflow install   [--global] [--force] [--dry-run] [--no-skills] [--no-agents] [--commands] [--mcp codegraph] [--component magento2] [--no-hooks]
  proflow uninstall [--global] [--dry-run]
  proflow status    [--global]
  proflow --version`);
}

const argv = process.argv.slice(2);
if (argv.includes('--version') || argv.includes('-v') || argv[0] === 'version') {
	info(pkg.version);
} else if (argv.length === 0) {
	// No subcommand: print help. Never assume `install` — a bare invocation
	// (`npx @nntoan/proflow`) must not mutate the current directory.
	usage();
} else {
	// A leading flag belongs to `install` (e.g. `proflow --global`).
	const [command, ...rest] = argv[0].startsWith('-') ? ['install', ...argv] : argv;
	const opts = parseArgs(rest);
	if (opts.help || command === 'help') usage();
	else if (command === 'install') install(opts);
	else if (command === 'uninstall' || command === 'remove') uninstall(opts);
	else if (command === 'status') status(opts);
	else fail(`unknown command: ${command} (try: install, uninstall, status; or --help)`);
}
