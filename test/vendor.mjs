#!/usr/bin/env node
// Vendoring + hook tests.
//
//  1. Patch drift: every `replaces.find` in scripts/patches/agent-skills.mjs must
//     still match its committed file exactly once — the same guarantee
//     `applyPatches` enforces at sync time, checked here without re-cloning.
//  2. Magento transform: no Claude-isms survive, and the renames landed.
//  3. The CodeGraph hook: fails open with no index, and emits the right
//     additionalContext when the CLI returns graph data (stubbed CLI).
//
// Run: node test/vendor.mjs

import assert from 'node:assert/strict';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import agentSkillsPatches from '../scripts/patches/agent-skills.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFileSync(join(ROOT, rel), 'utf8');
const MAGENTO = join(ROOT, 'components', 'magento2');

const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
};

/** `grep -rEl <pattern> <dir>` → list of matching files (empty when none). */
function grepFiles(pattern, dir) {
	const result = spawnSync('grep', ['-rEl', pattern, dir], {encoding: 'utf8'});
	return (result.stdout || '').trim();
}

check('every agent-skills patch is applied to its committed vendored file', () => {
	// `applyPatches` already fails loudly at sync time when a `find` no longer
	// matches; this asserts the committed tree actually reflects each patch, so a
	// sync that silently skipped a file is caught without re-cloning.
	for (const patch of agentSkillsPatches) {
		assert.ok(existsSync(join(ROOT, patch.file)), `missing ${patch.file}`);
		const text = read(patch.file);
		for (const rule of patch.replaces ?? []) {
			assert.ok(text.includes(rule.with), `${patch.file}: patch not applied (${rule.with.slice(0, 50)}…)`);
		}
	}
});

check('the spec-driven-development skill is aligned to docs/spec/<id>/', () => {
	const skill = read('skills/spec-driven-development/SKILL.md');
	assert.match(skill, /docs\/spec\/<id>\/SPEC\.md/);
	assert.doesNotMatch(skill, /Save the approved map at the project root/);
});

check('the magento component has no Claude-isms left', () => {
	assert.equal(grepFiles('CLAUDE_PLUGIN_ROOT', MAGENTO), '', 'CLAUDE_PLUGIN_ROOT should be rewritten');
	assert.equal(grepFiles('\\.claude/', MAGENTO), '', '.claude/ paths should be rewritten');
	// The only surviving `magento2-tools:` is a user-facing label in the guard hook.
	assert.equal(grepFiles('magento2-tools:', MAGENTO), join(MAGENTO, 'hooks', 'guard-docs-path.sh'));
	// No un-prefixed agent references remain in the skills (m2-reviewer is fine).
	assert.equal(grepFiles('(^|[^-A-Za-z0-9])(reviewer|explorer)([^-A-Za-z0-9]|$)', join(MAGENTO, 'skills')), '');
});

check('the magento agents are namespaced and gen-routing.sh is excluded', () => {
	assert.deepEqual(readdirSync(join(MAGENTO, 'agents')).sort(), ['m2-explorer.md', 'm2-reviewer.md']);
	const reviewer = read('components/magento2/agents/m2-reviewer.md');
	assert.match(reviewer, /^name: m2-reviewer$/m);
	assert.match(reviewer, /^tools: glob, grep, read_file, shell_command$/m);
	assert.equal(
		spawnSync('find', [MAGENTO, '-name', 'gen-routing.sh'], {encoding: 'utf8'}).stdout.trim(),
		'',
		'gen-routing.sh must be excluded',
	);
});

check('the CodeGraph hook fails open with no index', () => {
	const dir = mkdtempSync(join(tmpdir(), 'cg-hook-none-'));
	const out = runHook(dir, {hook_event_name: 'PreToolUse', cwd: dir, tool_name: 'grep', tool_input: {pattern: 'somethingLong'}});
	assert.equal(out.stdout.trim(), '');
	assert.equal(out.status, 0);
});

check('the CodeGraph hook injects context when the CLI returns graph data', () => {
	const dir = mkdtempSync(join(tmpdir(), 'cg-hook-'));
	mkdirSync(join(dir, '.codegraph'), {recursive: true});
	const bin = join(dir, 'bin');
	mkdirSync(bin, {recursive: true});
	const stub = join(bin, 'codegraph');
	writeFileSync(stub, '#!/bin/sh\necho "GRAPH CONTEXT: $2"\n');
	chmodSync(stub, 0o755);

	const out = runHook(
		dir,
		{hook_event_name: 'PreToolUse', cwd: dir, tool_name: 'grep', tool_input: {pattern: 'checkoutFlow'}},
		{PATH: `${bin}:${process.env.PATH}`},
	);
	const payload = JSON.parse(out.stdout);
	assert.equal(payload.hookSpecificOutput.hookEventName, 'PreToolUse');
	assert.match(payload.hookSpecificOutput.additionalContext, /GRAPH CONTEXT: checkoutFlow/);
});

function runHook(cwd, payload, env = {}) {
	return spawnSync(process.execPath, [join(ROOT, 'hooks', 'codegraph-hook.cjs')], {
		cwd,
		input: JSON.stringify(payload),
		encoding: 'utf8',
		env: {...process.env, ...env},
		timeout: 20000,
	});
}

console.log(`\n✓ proflow vendor test — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
