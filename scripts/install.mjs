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
	const opts = {scope: 'project', force: false, dryRun: false, skills: true, agents: true, commands: false, mcp: []};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--global' || arg === '-g') opts.scope = 'global';
		else if (arg === '--force' || arg === '-f') opts.force = true;
		else if (arg === '--dry-run') opts.dryRun = true;
		else if (arg === '--no-skills') opts.skills = false;
		else if (arg === '--no-agents') opts.agents = false;
		else if (arg === '--commands') opts.commands = true;
		else if (arg === '--mcp') opts.mcp.push(argv[++i]);
		else if (arg === '--project' || arg === '--dir') opts.project = argv[++i];
		else if (arg === '--help' || arg === '-h') opts.help = true;
		else fail(`unknown option: ${arg}`);
	}
	for (const name of opts.mcp) {
		if (!MCP_PRESETS[name]) fail(`unknown MCP preset "${name}" (known: ${Object.keys(MCP_PRESETS).join(', ')})`);
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
	if (mcp.servers.length) info(`  mcp       ${mcp.servers.join(', ')} → ${mcp.file}`);
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
	removeMcp(manifest.mcp, opts);
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
	if (manifest.mcp?.servers?.length) info(`  mcp      ${manifest.mcp.servers.join(', ')} → ${manifest.mcp.file}`);
	info(`  since    ${manifest.installedAt}`);
}

const argv = process.argv.slice(2);
// Allow `proflow --help` (no subcommand): treat a leading flag as install's.
const [command = 'install', ...rest] = argv[0]?.startsWith('-') ? ['install', ...argv] : argv;
const opts = parseArgs(rest);
if (opts.help || command === 'help') {
	info(`proflow — install the mod and its native skills/agents
  (run as \`npx @nntoan/proflow <command>\` or the installed \`proflow\` bin)

  proflow install   [--global] [--force] [--dry-run] [--no-skills] [--no-agents] [--commands] [--mcp codegraph]
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
