#!/usr/bin/env node
// Target-location safety (§7 of the plan). The 0.1.1 bug was a *location* bug, so
// these assertions pin the two locations the CLI resolves — the payload root and
// the target scope — and prove an install writes nothing outside the target.
//
// Run: node test/locations.mjs

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPlan, findPackage, findProjectRoot} from '../packages/cli/scripts/install.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
};

const tmp = mkdtempSync(join(tmpdir(), 'proflow-locations-'));
const gitRepo = join(tmp, 'repo');
mkdirSync(join(gitRepo, '.git'), {recursive: true});
mkdirSync(join(gitRepo, 'packages', 'deep', 'inside'), {recursive: true});
const plainDir = join(tmp, 'plain');
mkdirSync(plainDir);

check('the payload root is found next to the installer, not from the cwd', () => {
	const before = findPackage('proflow', 'commands');
	assert.ok(before, 'proflow payload not found');
	assert.equal(before, join(ROOT, 'packages', 'proflow'));

	const cwd = process.cwd();
	process.chdir(plainDir);
	try {
		assert.equal(findPackage('proflow', 'commands'), before, 'resolution must not depend on the cwd');
	} finally {
		process.chdir(cwd);
	}
});

check('a project scope resolves to the git root, from anywhere inside it', () => {
	assert.equal(findProjectRoot(join(gitRepo, 'packages', 'deep', 'inside')), gitRepo);
	const fromRoot = buildPlan({scope: 'project', project: gitRepo}, {magento2: false, mods: []});
	assert.equal(fromRoot.ccDir, join(gitRepo, '.commandcode'));
	const fromDeep = buildPlan(
		{scope: 'project', project: join(gitRepo, 'packages', 'deep', 'inside')},
		{magento2: false, mods: []},
	);
	assert.equal(fromDeep.ccDir, join(gitRepo, '.commandcode'), 'a subdirectory must still target the git root');
});

check('a non-git directory targets itself; --project targets the given directory', () => {
	assert.equal(findProjectRoot(plainDir), plainDir);
	assert.equal(buildPlan({scope: 'project', project: plainDir}, {magento2: false, mods: []}).ccDir, join(plainDir, '.commandcode'));
	const other = join(tmp, 'other');
	assert.equal(buildPlan({scope: 'project', project: other}, {magento2: false, mods: []}).ccDir, join(other, '.commandcode'));
});

check('a global scope targets ~/.commandcode', () => {
	assert.equal(buildPlan({scope: 'global'}, {magento2: false, mods: []}).ccDir, join(homedir(), '.commandcode'));
});

check('the planned steps are the native surfaces plus the harness mod', () => {
	const plan = buildPlan({scope: 'project', project: gitRepo}, {magento2: false, mods: []});
	assert.deepEqual(
		plan.steps.map(step => step.key),
		['commands', 'skills', 'references', 'agents', 'docs', 'mod'],
	);
	assert.deepEqual(plan.problems, []);
	for (const step of plan.steps) {
		assert.equal(relative(plan.ccDir, step.dest).startsWith('..'), false, `${step.key} must land inside the scope`);
	}
});

check('an install writes nothing outside the target scope', () => {
	const before = readdirSync(tmp).sort();
	execFileSync(
		process.execPath,
		[join(ROOT, 'packages', 'cli', 'scripts', 'install.mjs'), 'install', '--yes', '--project', gitRepo],
		{encoding: 'utf8'},
	);
	assert.deepEqual(readdirSync(tmp).sort(), before, 'the fixture tree outside the target must be untouched');
	assert.ok(existsSync(join(gitRepo, '.commandcode', 'proflow.manifest.json')));
});

rmSync(tmp, {recursive: true, force: true});

console.log(`\n✓ proflow target-location test — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
