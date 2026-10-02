#!/usr/bin/env node
// Installer test: provisions into a throwaway project and asserts the native
// layout, idempotency, collision protection, the magento pack, and a clean
// uninstall — no Command Code needed.
//
// Run: node test/install.mjs

import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INSTALLER = join(ROOT, 'packages', 'cli', 'scripts', 'install.mjs');
const pkg = JSON.parse(readFileSync(join(ROOT, 'packages', 'cli', 'package.json'), 'utf8'));

const proj = mkdtempSync(join(tmpdir(), 'proflow-install-'));
mkdirSync(join(proj, '.git'));
const cc = join(proj, '.commandcode');
const manifestPath = join(cc, 'proflow.manifest.json');

const run = (...args) =>
	spawnSync(process.execPath, [INSTALLER, ...args, '--project', proj], {encoding: 'utf8'});
const ok = result => {
	assert.equal(result.status, 0, `installer failed: ${result.stderr || result.stdout}`);
	return result.stdout;
};
const manifest = () => JSON.parse(readFileSync(manifestPath, 'utf8'));
const counts = dir => readdirSync(join(cc, dir)).length;

const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
};

check('install provisions the native surfaces, the harness mod, and a manifest', () => {
	ok(run('install', '--yes'));
	assert.equal(counts('commands'), 10);
	assert.equal(counts('skills'), 26);
	assert.equal(counts('references'), 7);
	assert.equal(counts('agents'), 5);
	assert.equal(counts('docs'), 1);
	assert.ok(existsSync(join(cc, 'mods', 'proflow.ts')), 'the harness mod must be installed');
	assert.ok(existsSync(join(cc, 'skills', 'spec-reflection', 'SKILL.md')), 'spec-reflection must install');

	const m = manifest();
	assert.equal(m.version, pkg.version);
	assert.equal(m.commands.length, 10);
	assert.equal(m.skills.length, 26);
	assert.equal(m.references.length, 7);
	assert.ok(m.agents.includes('spec-reviewer'));
	assert.deepEqual(m.mods, ['proflow.ts']);
});

check('the installed commands are the proflow set', () => {
	const names = readdirSync(join(cc, 'commands')).sort();
	for (const name of ['brainstorm.md', 'spec.md', 'to-plan.md', 'build.md', 'test.md', 'to-review.md', 'ship.md']) {
		assert.ok(names.includes(name), `missing ${name}`);
	}
	assert.ok(!names.includes('plan.md'));
});

check('install is idempotent and refreshes its own files', () => {
	writeFileSync(join(cc, 'mods', 'proflow.ts'), 'STALE');
	writeFileSync(join(cc, 'docs', 'agents.md'), 'STALE');
	const out = ok(run('install', '--yes'));
	assert.doesNotMatch(out, /skipping/, 'a re-install must not skip its own files');
	assert.notEqual(readFileSync(join(cc, 'mods', 'proflow.ts'), 'utf8'), 'STALE');
	assert.notEqual(readFileSync(join(cc, 'docs', 'agents.md'), 'utf8'), 'STALE');
	assert.equal(counts('skills'), 26);
});

check('a foreign skill of the same name is not clobbered', () => {
	const sentinel = join(cc, 'skills', 'idea-refine', 'SKILL.md');
	writeFileSync(sentinel, 'FOREIGN');
	const m = manifest();
	m.skills = m.skills.filter(name => name !== 'idea-refine');
	writeFileSync(manifestPath, JSON.stringify(m));

	const out = ok(run('install', '--yes'));
	assert.match(out, /idea-refine.*skipping/i);
	assert.equal(readFileSync(sentinel, 'utf8'), 'FOREIGN');

	ok(run('install', '--yes', '--force'));
	assert.notEqual(readFileSync(sentinel, 'utf8'), 'FOREIGN');
});

check('uninstall removes what proflow wrote and leaves foreign files', () => {
	const keep = join(cc, 'skills', 'foreign-skill');
	mkdirSync(keep, {recursive: true});
	writeFileSync(join(keep, 'SKILL.md'), 'keep me');

	ok(run('uninstall'));
	assert.ok(!existsSync(manifestPath));
	assert.ok(!existsSync(join(cc, 'commands', 'spec.md')));
	assert.ok(!existsSync(join(cc, 'skills', 'idea-refine')));
	assert.ok(!existsSync(join(cc, 'mods', 'proflow.ts')));
	assert.ok(!existsSync(join(cc, 'references')));
	assert.ok(existsSync(join(keep, 'SKILL.md')), 'a foreign skill must survive uninstall');

	assert.match(ok(run('status')), /not installed/i);
});

check('--magento2 installs the m2 pack and wires the guard hook', () => {
	ok(run('install', '--yes', '--magento2'));
	const skills = readdirSync(join(cc, 'skills'));
	assert.equal(skills.filter(name => name.startsWith('m2-')).length, 36);
	assert.equal(readdirSync(join(cc, 'commands')).filter(n => n.startsWith('m2-')).length, 18);
	assert.ok(existsSync(join(cc, 'agents', 'm2-reviewer.md')));
	assert.ok(existsSync(join(cc, 'hooks', 'm2', 'guard-docs-path.sh')));

	const settings = JSON.parse(readFileSync(join(cc, 'settings.json'), 'utf8'));
	assert.ok(
		settings.hooks.PreToolUse.some(g => (g.hooks ?? []).some(h => /guard-docs-path\.sh/.test(h.command))),
		'the guard hook must be wired into settings.json',
	);
	assert.equal(manifest().magento2.skills.length, 36);

	ok(run('uninstall'));
	assert.ok(!existsSync(join(cc, 'skills', 'm2-fix')));
	assert.ok(!existsSync(join(cc, 'hooks')), 'the hook dir must be removed');
	assert.ok(!existsSync(join(cc, 'settings.json')), 'a settings.json we created must not be left empty');
});

check('every vendored magento skill has a parseable description', () => {
	// Command Code drops a skill whose `description:` is a plain multi-line scalar
	// containing ": " — assert the sync normalised them all.
	const dir = join(ROOT, 'packages', 'magento2', 'skills');
	const bad = [];
	for (const name of readdirSync(dir)) {
		const file = join(dir, name, 'SKILL.md');
		if (!existsSync(file)) continue;
		const lines = readFileSync(file, 'utf8').split('\n');
		const i = lines.findIndex(line => line.startsWith('description:'));
		if (i === -1) {
			bad.push(`${name}: no description`);
			continue;
		}
		if (/^description:\s*(>[+-]?|\|[+-]?)\s*$/.test(lines[i])) continue;
		if (/^description:\s*\S/.test(lines[i]) && !/^\s+\S/.test(lines[i + 1] ?? '')) continue;
		bad.push(`${name}: ${lines[i]}`);
	}
	assert.deepEqual(bad, [], `unparseable description(s): ${bad.join('; ')}`);
});

check('the CLI defaults to help, reports --version, and never installs bare', () => {
	const bare = (...args) => spawnSync(process.execPath, [INSTALLER, ...args], {encoding: 'utf8'});
	assert.match(bare('--version').stdout, new RegExp(pkg.version.replace(/\./g, '\\.')));
	assert.match(bare().stdout, /proflow install/);

	const empty = mkdtempSync(join(tmpdir(), 'proflow-bare-'));
	spawnSync(process.execPath, [INSTALLER], {cwd: empty, encoding: 'utf8'});
	assert.deepEqual(readdirSync(empty), [], 'a bare invocation must not touch the cwd');
	rmSync(empty, {recursive: true, force: true});
});

check('a non-TTY run without --yes refuses instead of installing', () => {
	const blank = mkdtempSync(join(tmpdir(), 'proflow-notty-'));
	mkdirSync(join(blank, '.git'));
	const result = spawnSync(process.execPath, [INSTALLER, 'install', '--project', blank], {
		encoding: 'utf8',
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /not a TTY/);
	assert.ok(!existsSync(join(blank, '.commandcode')), 'nothing may be written');
	rmSync(blank, {recursive: true, force: true});
});

rmSync(proj, {recursive: true, force: true});

console.log(`\n✓ proflow installer test — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
