#!/usr/bin/env node
// Installer test: provisions into a throwaway project and asserts the layout,
// idempotency, collision protection, and clean uninstall — no Command Code needed.
//
// Run: node test/install.mjs

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INSTALLER = join(ROOT, 'scripts', 'install.mjs');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const proj = mkdtempSync(join(tmpdir(), 'proflow-install-'));
mkdirSync(join(proj, '.git'));
const cc = join(proj, '.commandcode');
const manifestPath = join(cc, 'proflow.manifest.json');

const run = (...args) =>
	execFileSync(process.execPath, [INSTALLER, ...args, '--project', proj], {encoding: 'utf8'});

const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
};

check('install provisions mod, skills, agents, and a manifest', () => {
	run('install');
	assert.ok(existsSync(join(cc, 'mods', 'proflow', 'mods', 'proflow.ts')));
	assert.ok(existsSync(join(cc, 'mods', 'proflow', 'commands', 'spec.md')));
	assert.ok(existsSync(join(cc, 'mods', 'proflow', 'skills', 'test-driven-development', 'SKILL.md')));
	assert.equal(readdirSync(join(cc, 'skills')).length, 25);
	assert.equal(readdirSync(join(cc, 'agents')).length, 5);
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	assert.equal(manifest.version, pkg.version);
	assert.equal(manifest.skills.length, 25);
	assert.ok(manifest.agents.includes('spec-reviewer'));
});

check('install is idempotent and re-runs cleanly', () => {
	run('install');
	assert.equal(readdirSync(join(cc, 'skills')).length, 25);
	assert.ok(existsSync(join(cc, 'mods', 'proflow', 'package.json')));
});

check('a foreign skill of the same name is not clobbered', () => {
	// Make one provisioned skill look foreign: sentinel it, drop it from the manifest.
	const sentinel = join(cc, 'skills', 'idea-refine', 'SKILL.md');
	writeFileSync(sentinel, 'FOREIGN');
	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	manifest.skills = manifest.skills.filter(name => name !== 'idea-refine');
	writeFileSync(manifestPath, JSON.stringify(manifest));

	const out = run('install');
	assert.match(out, /idea-refine.*skipping/i);
	assert.equal(readFileSync(sentinel, 'utf8'), 'FOREIGN');

	run('install', '--force');
	assert.notEqual(readFileSync(sentinel, 'utf8'), 'FOREIGN');
});

check('uninstall removes proflow files and leaves foreign ones', () => {
	const keep = join(cc, 'skills', 'foreign-skill');
	mkdirSync(keep, {recursive: true});
	writeFileSync(join(keep, 'SKILL.md'), 'keep me');

	run('uninstall');
	assert.ok(!existsSync(join(cc, 'mods', 'proflow')));
	assert.ok(!existsSync(manifestPath));
	assert.ok(!existsSync(join(cc, 'skills', 'idea-refine')));
	assert.ok(!existsSync(join(cc, 'agents', 'code-reviewer.md')));
	assert.ok(existsSync(join(keep, 'SKILL.md')), 'foreign skill must survive uninstall');
});

check('status reflects an uninstalled scope', () => {
	const out = run('status');
	assert.match(out, /not installed/i);
});

check('--mcp bundles an MCP server and uninstall removes it', () => {
	run('install', '--mcp', 'codegraph');
	const mcpFile = join(proj, '.mcp.json');
	assert.ok(existsSync(mcpFile), '.mcp.json must be written');
	assert.equal(JSON.parse(readFileSync(mcpFile, 'utf8')).mcpServers.codegraph.command, 'codegraph');
	assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')).mcp.servers, ['codegraph']);

	run('uninstall');
	assert.ok(!JSON.parse(readFileSync(mcpFile, 'utf8')).mcpServers?.codegraph, 'codegraph must be removed');
});

check('--component magento2 installs its skills, commands, agents, and hook', () => {
	run('install', '--component', 'magento2');
	const skills = readdirSync(join(cc, 'skills'));
	assert.ok(skills.includes('m2-fix'), 'm2-fix skill missing');
	assert.equal(skills.filter(name => name.startsWith('m2-')).length, 36);
	assert.equal(readdirSync(join(cc, 'commands')).filter(n => n.startsWith('m2-')).length, 18);
	assert.ok(existsSync(join(cc, 'agents', 'reviewer.md')));
	assert.ok(existsSync(join(cc, 'hooks', 'm2', 'guard-docs-path.sh')));

	const settings = JSON.parse(readFileSync(join(cc, 'settings.json'), 'utf8'));
	assert.ok(
		settings.hooks.PreToolUse.some(g => (g.hooks ?? []).some(h => /guard-docs-path\.sh/.test(h.command))),
		'the guard hook must be wired into settings.json',
	);
	assert.equal(JSON.parse(readFileSync(manifestPath, 'utf8')).components.magento2.skills.length, 36);

	run('uninstall');
	assert.ok(!existsSync(join(cc, 'skills', 'm2-fix')));
	assert.ok(!existsSync(join(cc, 'hooks')), 'the hook dir must be removed');
	const after = existsSync(join(cc, 'settings.json')) ? JSON.parse(readFileSync(join(cc, 'settings.json'), 'utf8')) : {};
	assert.ok(!after.hooks, 'the hook entry must be removed from settings.json');
});

rmSync(proj, {recursive: true, force: true});

console.log(`\n✓ proflow installer test — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
