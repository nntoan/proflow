#!/usr/bin/env node
// Tool-mod tests: mod-codegraph / mod-gh / mod-orca.
//
//  1. Each loads with a mock ModApi and registers the expected tools, with the
//     right read-only gating.
//  2. `*_read` refuses anything off its allowlist, so the no-prompt fast path can
//     never be used to smuggle a write.
//  3. The installer copies a selected mod into the scope, and uninstall removes it.
//
// Run: node test/toolmods.mjs

import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Checks register here and run sequentially at the end: several are async and
// share each mod's recorded calls.
const suite = [];
const check = (name, fn) => suite.push([name, fn]);

/** Load a mod with a mock ModApi; returns {tools, calls}. */
async function loadMod(relativePath) {
	const source = readFileSync(join(ROOT, relativePath), 'utf8');
	const url =
		'data:text/javascript;base64,' +
		Buffer.from(stripTypeScriptTypes(source, {mode: 'strip'})).toString('base64');
	const mod = await import(url);
	const tools = new Map();
	const calls = [];
	const cmd = {
		addTool: tool => {
			tools.set(tool.schema.name, tool);
			return {dispose() {}};
		},
		exec: async ({command, args}) => {
			calls.push([command, ...args]);
			return {stdout: `ran ${command} ${args.join(' ')}`, stderr: '', code: 0};
		},
	};
	mod.default(cmd);
	return {mod, tools, calls};
}

const codegraph = await loadMod('packages/mod-codegraph/mods/codegraph.ts');
const gh = await loadMod('packages/mod-gh/mods/gh.ts');
const orca = await loadMod('packages/mod-orca/mods/orca.ts');

check('mod-codegraph registers read-only tools and shells out correctly', async () => {
	assert.deepEqual([...codegraph.tools.keys()], ['codegraph_explore', 'codegraph_node', 'codegraph_status']);
	for (const tool of codegraph.tools.values()) assert.equal(tool.readOnly, true, 'every codegraph tool must be read-only');
	const result = await codegraph.tools.get('codegraph_explore').run({input: {query: 'where is auth'}});
	assert.equal(result.ok, true);
	assert.deepEqual(codegraph.calls[0], ['codegraph', 'explore', 'where is auth']);
});

check('mod-gh exposes the full surface with a validated read gate', async () => {
	assert.deepEqual([...gh.tools.keys()], ['gh_read', 'gh_run']);
	assert.equal(gh.tools.get('gh_read').readOnly, true);
	assert.notEqual(gh.tools.get('gh_run').readOnly, true);
});

check('gh_read refuses write subcommands but accepts read ones', async () => {
	const refused = await gh.tools.get('gh_read').run({input: {args: ['pr', 'create', '--title', 'x']}});
	assert.equal(refused.ok, false);
	assert.match(refused.error, /allowlist/);
	assert.deepEqual(gh.calls, [], 'a refused call must never reach the CLI');

	const view = await gh.tools.get('gh_read').run({input: {args: ['pr', 'view', '12', '--json', 'title']}});
	assert.equal(view.ok, true);
	assert.deepEqual(gh.calls.at(-1), ['gh', 'pr', 'view', '12', '--json', 'title']);

	for (const args of [['issue', 'close', '3'], ['release', 'create', 'v1'], ['repo', 'delete', 'x/y']]) {
		assert.equal((await gh.tools.get('gh_read').run({input: {args}})).ok, false, `${args.join(' ')} must be refused`);
	}
});

check('gh_run carries writes through', async () => {
	const result = await gh.tools.get('gh_run').run({input: {args: ['pr', 'create', '--title', 'x']}});
	assert.equal(result.ok, true);
	assert.deepEqual(gh.calls.at(-1), ['gh', 'pr', 'create', '--title', 'x']);
});

check('orca_read refuses mutations and orca_run carries them', async () => {
	assert.equal((await orca.tools.get('orca_read').run({input: {args: ['worktree', 'create', 'x']}})).ok, false);
	assert.equal((await orca.tools.get('orca_read').run({input: {args: ['terminal', 'send', 'x', 'y']}})).ok, false);
	assert.equal((await orca.tools.get('orca_read').run({input: {args: ['worktree', 'list']}})).ok, true);
	assert.equal((await orca.tools.get('orca_run').run({input: {args: ['worktree', 'rm', 'x']}})).ok, true);
	assert.equal(orca.tools.get('orca_read').readOnly, true);
	assert.notEqual(orca.tools.get('orca_run').readOnly, true);
});

check('the installer ships a selected mod and uninstall removes it', () => {
	const proj = mkdtempSync(join(tmpdir(), 'proflow-mod-'));
	mkdirSync(join(proj, '.git'));
	const installer = join(ROOT, 'packages', 'cli', 'scripts', 'install.mjs');
	const run = (...args) => spawnSync(process.execPath, [installer, ...args, '--project', proj], {encoding: 'utf8'});

	const install = run('install', '--yes', '--mod', 'codegraph,gh');
	assert.equal(install.status, 0, install.stderr);
	const cc = join(proj, '.commandcode');
	for (const name of ['proflow.ts', 'codegraph.ts', 'gh.ts']) {
		assert.ok(existsSync(join(cc, 'mods', name)), `${name} must be installed`);
	}
	assert.ok(!existsSync(join(cc, 'mods', 'orca.ts')), 'an unselected mod must not install');

	const uninstall = run('uninstall');
	assert.equal(uninstall.status, 0, uninstall.stderr);
	assert.ok(!existsSync(join(cc, 'mods')), 'uninstall must remove the mods directory');
	rmSync(proj, {recursive: true, force: true});
});

const passed = [];
for (const [name, fn] of suite) {
	await fn();
	passed.push(name);
}

console.log(`\n✓ proflow tool-mod test — ${passed.length} checks passed\n`);
for (const name of passed) console.log(`  ✓ ${name}`);
console.log('');
