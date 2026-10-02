#!/usr/bin/env node
// Vendoring + transform tests.
//
//   1. Patch drift: every declared `replaces` rule must still be reflected in the
//      committed vendored file — the same guarantee `applyPatches` enforces at
//      sync time, checked here without re-cloning.
//   2. Commands: the renames landed, and no command carries an activation
//      preamble or the Claude plugin namespace.
//   3. Magento: the `.docs/` → `docs/` retarget and the sibling-path fix landed,
//      while the `m2-docs` *skill* references survived.
//
// Run: node test/vendor.mjs

import assert from 'node:assert/strict';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import agentSkillsPatches from '../patches/agent-skills.mjs';
import commandPatches from '../patches/commands.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAYLOAD = join(ROOT, 'packages', 'proflow');
const MAGENTO = join(ROOT, 'packages', 'magento2');
const read = path => readFileSync(path, 'utf8');

const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
};

/** `grep -rEl <pattern> <dir>` → the matching file list (empty when none). */
function grepFiles(pattern, dir) {
	const result = spawnSync('grep', ['-rEl', pattern, dir], {encoding: 'utf8'});
	return (result.stdout || '').trim();
}

check('every agent-skills patch is applied to its committed vendored file', () => {
	for (const patch of [...agentSkillsPatches, ...commandPatches]) {
		const file = join(PAYLOAD, patch.file);
		assert.ok(existsSync(file), `missing ${patch.file}`);
		const text = read(file);
		for (const rule of patch.replaces ?? []) {
			assert.ok(
				text.includes(rule.with),
				`${patch.file}: patch not applied (${rule.with.slice(0, 60)}…)`,
			);
		}
	}
});

check('the command renames landed and no upstream name survives', () => {
	const names = readdirSync(join(PAYLOAD, 'commands')).sort();
	assert.deepEqual(names, [
		'brainstorm.md',
		'build.md',
		'code-simplify.md',
		'constraints.md',
		'ship.md',
		'spec.md',
		'test.md',
		'to-plan.md',
		'to-review.md',
		'webperf.md',
	]);
	assert.ok(!names.includes('plan.md') && !names.includes('review.md'));
});

check('no command carries an activation preamble or the Claude namespace', () => {
	const dir = join(PAYLOAD, 'commands');
	assert.equal(grepFiles('Skill activation', dir), '');
	assert.equal(grepFiles('agent_skills', dir), '');
	assert.equal(grepFiles('agent-skills:', dir), '');
	assert.equal(grepFiles('In Claude Code', dir), '');
});

check('every command still invokes its skill in one line', () => {
	const spec = read(join(PAYLOAD, 'commands', 'spec.md'));
	assert.match(spec, /^Invoke the spec-driven-development skill\.$/m);
	assert.match(spec, /docs\/spec\/<id>\/SPEC\.md/);
	const build = read(join(PAYLOAD, 'commands', 'build.md'));
	assert.match(build, /Invoke the incremental-implementation skill alongside test-driven-development\./);
});

check('the spec-reflection skill ships and the spec skill points at it', () => {
	const reflection = read(join(PAYLOAD, 'skills', 'spec-reflection', 'SKILL.md'));
	assert.match(reflection, /^name: spec-reflection$/m);
	assert.match(reflection, /spec-reviewer/);
	assert.match(reflection, /review-log\.md/);

	const spec = read(join(PAYLOAD, 'skills', 'spec-driven-development', 'SKILL.md'));
	assert.match(spec, /spec-reflection/);
	assert.match(spec, /docs\/spec\/<id>\/SPEC\.md/);
	assert.doesNotMatch(spec, /Save the approved map at the project root/);
});

check('the magento artifact root was retargeted to docs/', () => {
	assert.equal(grepFiles('\\.docs([^_a-zA-Z]|$)', MAGENTO), '', 'no `.docs` artifact path may remain');
	assert.match(read(join(MAGENTO, 'skills', 'm2-context', 'scripts', 'resolve-context.sh')), /"docs_root": "docs"/);
	assert.match(read(join(MAGENTO, 'skills', 'm2-lint', 'scripts', 'build-findings.sh')), /DOCS_ROOT="\$\{DOCS_ROOT:-docs\}"/);
});

check('the magento docs guard now polices docs/ and keeps its scope gate', () => {
	const matcher = read(join(MAGENTO, 'hooks', 'docs-path-matcher.sh'));
	assert.match(matcher, /\*\/docs\/\*/);
	assert.match(matcher, /"\$root"\/docs\/\*/);
	assert.match(matcher, /only Magento projects are governed/);
	assert.equal(grepFiles('\\.docs', join(MAGENTO, 'hooks')), '');
});

check('the m2-docs skill references survived the retarget', () => {
	// `docs` is also an upstream *skill* name: `m2-docs` must keep meaning the
	// skill, while `docs/` means the artifact directory.
	const guide = read(join(MAGENTO, 'skills', 'm2-feature', 'references', 'documentation-guide.md'));
	assert.match(guide, /`m2-docs`/);
	assert.match(read(join(MAGENTO, 'skills', 'm2-widget', 'SKILL.md')), /defaults to `docs`/);
});

check('the magento sibling paths point at m2-context', () => {
	assert.equal(grepFiles('\\.\\.\\/\\.\\.\\/context\\/', MAGENTO), '');
	assert.match(read(join(MAGENTO, 'skills', 'm2-lint', 'scripts', 'build-findings.sh')), /\.\.\/\.\.\/m2-context\/scripts\//);
});

check('the magento component has no other Claude-isms left', () => {
	assert.equal(grepFiles('CLAUDE_PLUGIN_ROOT', MAGENTO), '');
	assert.equal(grepFiles('\\.claude/', MAGENTO), '');
	assert.equal(grepFiles('magento2-tools:', MAGENTO), join(MAGENTO, 'hooks', 'guard-docs-path.sh'));
	assert.equal(grepFiles('(^|[^-A-Za-z0-9])(reviewer|explorer)([^-A-Za-z0-9]|$)', join(MAGENTO, 'skills')), '');
});

check('the magento agents are namespaced and gen-routing.sh is excluded', () => {
	assert.deepEqual(readdirSync(join(MAGENTO, 'agents')).sort(), ['m2-explorer.md', 'm2-reviewer.md']);
	const reviewer = read(join(MAGENTO, 'agents', 'm2-reviewer.md'));
	assert.match(reviewer, /^name: m2-reviewer$/m);
	assert.match(reviewer, /^tools: glob, grep, read_file, shell_command$/m);
	assert.equal(spawnSync('find', [MAGENTO, '-name', 'gen-routing.sh'], {encoding: 'utf8'}).stdout.trim(), '');
});

check('the package licenses are separated from the vendored ones', () => {
	// Every package carries proflow's license, so a sync can never clobber it.
	for (const entry of readdirSync(join(ROOT, 'packages'))) {
		const file = join(ROOT, 'packages', entry, 'LICENSE');
		assert.ok(existsSync(file), `packages/${entry}/LICENSE is missing`);
		assert.match(read(file), /Copyright \(c\) Toan Nguyen & proflow contributors/);
	}
	// The vendored content keeps its own upstream license, verbatim.
	assert.match(read(join(PAYLOAD, 'LICENSE.agent-skills')), /Copyright \(c\) 2025 Addy Osmani/);
	assert.match(read(join(MAGENTO, 'LICENSE.magento2')), /Copyright \(c\) 2026 Serge Autushka/);
});

console.log(`\n✓ proflow vendor test — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
