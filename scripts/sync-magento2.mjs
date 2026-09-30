#!/usr/bin/env node
// Vendor + adapt muon-m2/magento2-tools as an optional proflow component.
//
//   node scripts/sync-magento2.mjs [ref]
//
// magento2-tools is a Claude Code plugin, so its content assumes a Claude
// environment. This script clones it, transforms the parts that do not hold in
// Command Code, and writes the result to components/magento2/. The transform is
// deliberately conservative — each rule is one of:
//
//   1. Skill namespacing    `context` -> `m2-context` (dir + `name:` + refs),
//                           so the 36 generic upstream names (context, review,
//                           test, security, …) can't shadow other skills, the
//                           proflow commands, or Command Code built-ins.
//   2. Cross-skill refs     `magento2-tools:fix` -> `m2-fix`, and bare
//                           backticked `` `fix` `` -> `` `m2-fix` ``.
//   3. Plugin-root paths    ${CLAUDE_PLUGIN_ROOT}/skills/X/... ->
//                           ${COMMANDCODE_SKILL_DIR}/../m2-X/... (Command Code
//                           installs skills flat, so the plugin root is the
//                           skills directory).
//   4. Config/memory paths  .claude/m2.json -> .commandcode/m2.json, CLAUDE.md ->
//                           AGENTS.md, so the resolver reads Command Code's
//                           locations (the M2_* env overrides still win).
//   5. Agent tool ids       Glob/Grep/Read/Bash -> glob/grep/read_file/shell_command.
//
// Agents keep their names (`reviewer`, `explorer`) because the skills reference
// them in prose; that carries a small collision risk with a user's own agent of
// the same name, which the README documents.
//
// The generated tree is committed, so installing never needs the network.

import {execFileSync} from 'node:child_process';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'components', 'magento2');
const REF = process.argv[2] || 'main';
const REPO = process.env.MAGENTO2_TOOLS_REPO || 'https://github.com/muon-m2/magento2-tools.git';

const AGENT_TOOLS = {
	Glob: 'glob',
	Grep: 'grep',
	Read: 'read_file',
	Write: 'write_file',
	Edit: 'edit_file',
	MultiEdit: 'edit_file',
	LS: 'read_directory',
	Bash: 'shell_command',
	WebFetch: 'web_fetch',
	WebSearch: 'web_search',
	TodoWrite: 'todo_write',
};

const stage = mkdtempSync(join(tmpdir(), 'magento2-tools-'));
try {
	console.log(`Cloning ${REPO} @ ${REF} …`);
	execFileSync('git', ['clone', '--depth', '1', '--branch', REF, REPO, stage], {stdio: 'inherit'});
	const commit = execFileSync('git', ['-C', stage, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
	const plugin = JSON.parse(readFileSync(join(stage, '.claude-plugin', 'plugin.json'), 'utf8'));

	const skillNames = readdirSync(join(stage, 'skills')).filter(name =>
		existsSync(join(stage, 'skills', name, 'SKILL.md')),
	);
	const skillSet = new Set(skillNames);

	function transform(text) {
		let out = text;
		// 3. plugin-root script paths -> relative to the current skill dir
		out = out.replace(/\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/([a-z0-9-]+)\//g, (_m, s) => `\${COMMANDCODE_SKILL_DIR}/../m2-${s}/`);
		out = out.replace(/\$\{CLAUDE_PLUGIN_ROOT\}\/agents\//g, '${COMMANDCODE_SKILL_DIR}/../../agents/');
		out = out.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, '${COMMANDCODE_SKILL_DIR}/..');
		// 2. cross-skill refs
		out = out.replace(/magento2-tools:([a-z0-9-]+)/g, (_m, s) => `m2-${s}`);
		for (const name of skillNames) {
			out = out.split('`' + name + '`').join('`m2-' + name + '`');
		}
		// 4. config + memory locations
		out = out.replace(/\.claude\/m2\.json/g, '.commandcode/m2.json');
		out = out.replace(/\.claude\/\.cache/g, '.commandcode/.cache');
		out = out.replace(/\.claude\/settings\.json/g, '.commandcode/settings.json');
		out = out.replace(/\bCLAUDE\.md\b/g, 'AGENTS.md');
		return out;
	}

	function writeTransformed(srcFile, destFile, extra) {
		let text = transform(readFileSync(srcFile, 'utf8'));
		if (extra) text = extra(text, srcFile);
		mkdirSync(dirname(destFile), {recursive: true});
		writeFileSync(destFile, text);
	}

	function copyTree(srcDir, destDir, extraForSkillMd) {
		for (const entry of readdirSync(srcDir)) {
			const src = join(srcDir, entry);
			const dest = join(destDir, entry);
			if (statSync(src).isDirectory()) {
				copyTree(src, dest, extraForSkillMd);
				continue;
			}
			if (entry === 'SKILL.md' && extraForSkillMd) {
				writeTransformed(src, dest, extraForSkillMd);
				continue;
			}
			if (/\.(md|sh|mjs|js|json|php|xml|less|txt|yaml|yml)$/i.test(entry) || !/\./.test(entry)) {
				writeTransformed(src, dest);
			} else {
				mkdirSync(dirname(dest), {recursive: true});
				cpSync(src, dest);
			}
			if (statSync(src).mode & 0o111) {
				try {
					execFileSync('chmod', ['+x', dest]);
				} catch {
					// best effort
				}
			}
		}
	}

	rmSync(OUT, {recursive: true, force: true});

	// Skills — prefix dir + `name:`.
	for (const name of skillNames) {
		const addName = text => text.replace(/^name:[ \t]*.*$/m, `name: m2-${name}`);
		copyTree(join(stage, 'skills', name), join(OUT, 'skills', `m2-${name}`), addName);
	}

	// Commands — rename to m2-<verb>.
	const commandsDir = join(stage, 'commands');
	const commandVerbs = existsSync(commandsDir)
		? readdirSync(commandsDir).filter(f => f.endsWith('.md'))
		: [];
	for (const file of commandVerbs) {
		writeTransformed(join(commandsDir, file), join(OUT, 'commands', `m2-${file}`));
	}

	// Agents — keep names, fix tool ids.
	const agentsDir = join(stage, 'agents');
	const agentNames = existsSync(agentsDir) ? readdirSync(agentsDir).filter(f => f.endsWith('.md')) : [];
	for (const file of agentNames) {
		writeTransformed(join(agentsDir, file), join(OUT, 'agents', file), text =>
			text.replace(/^tools:[ \t]*(.*)$/m, (line, list) => {
				const mapped = list
					.split(',')
					.map(t => t.trim())
					.filter(Boolean)
					.map(t => AGENT_TOOLS[t] || t)
					.join(', ');
				return `tools: ${mapped}`;
			}),
		);
	}

	// Hooks — adapt the PreToolUse guard to Command Code's tool ids + env. Hook
	// filenames stay unprefixed (the guard sources its sibling by name); the
	// installer namespaces them under .commandcode/hooks/m2/ instead.
	const hooksDir = join(stage, 'hooks');
	const hookFiles = existsSync(hooksDir) ? readdirSync(hooksDir).filter(f => f.endsWith('.sh')) : [];
	for (const file of hookFiles) {
		writeTransformed(join(hooksDir, file), join(OUT, 'hooks', file), text =>
			text
				.replace('Write|Edit)', 'write_file|edit_file|Write|Edit)')
				.replace(
					'project_root="${CLAUDE_PROJECT_DIR:-}"',
					'project_root="${COMMANDCODE_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-}}"',
				),
		);
		execFileSync('chmod', ['+x', join(OUT, 'hooks', file)]);
	}

	cpSync(join(stage, 'LICENSE'), join(OUT, 'LICENSE'));
	writeFileSync(
		join(OUT, 'VENDOR.json'),
		`${JSON.stringify(
			{
				source: 'https://github.com/muon-m2/magento2-tools',
				repo: REPO,
				ref: REF,
				commit,
				version: plugin.version,
				transformedBy: 'scripts/sync-magento2.mjs',
				syncedAt: new Date().toISOString(),
			},
			null,
			2,
		)}\n`,
	);

	console.log(
		`\nVendored magento2-tools ${plugin.version} (${commit.slice(0, 12)}) → ${relative(ROOT, OUT)}\n` +
			`  skills   ${skillNames.length} (prefixed m2-)\n` +
			`  commands ${commandVerbs.length} (renamed m2-)\n` +
			`  agents   ${agentNames.length}\n` +
			`  hooks    ${hookFiles.length}`,
	);
} finally {
	rmSync(stage, {recursive: true, force: true});
}
