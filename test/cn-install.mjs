// T6 of tasks/plan.md — the installer's holiday step, offline.
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const INSTALLER = join(here, '..', 'packages', 'cli', 'scripts', 'install.mjs');
const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
	console.log(`  \u001b[32m✓\u001b[0m ${name}`);
};
let failed = false;

const fixture = () => {
	const home = mkdtempSync(join(tmpdir(), 'proflow-home-'));
	const proj = mkdtempSync(join(tmpdir(), 'proflow-proj-'));
	mkdirSync(join(proj, '.git'));
	return {home, proj};
};
const run = (home, proj, ...args) =>
	spawnSync(process.execPath, [INSTALLER, ...args, '--project', proj], {encoding: 'utf8', env: {...process.env, HOME: home}});

try {
	check('T6: a plain install deploys the script and the script alone reports (spec row 23)', () => {
		const {home, proj} = fixture();
		const res = run(home, proj, 'install', '--yes');
		assert.equal(res.status, 0, res.stderr || res.stdout);
		const script = join(home, '.commandcode', 'scripts', 'holidays.mjs');
		assert.ok(existsSync(script), 'the script lands in the isolated HOME');
		assert.match(res.stdout, /holidays: /, `the script's own line, not just the step label: ${res.stdout}`);
		const calendar = join(home, '.commandcode', 'holidays-cn.json');
		assert.ok(existsSync(calendar), 'the installer writes the verified calendar');
		assert.equal(JSON.parse(readFileSync(calendar, 'utf8'))['2026'].off.length, 33, '33 holiday days in 2026');
	});

	check('T6: the script runs when invoked — the realpath trap', () => {
		const {home} = fixture();
		const res = spawnSync(process.execPath, [join(here, '..', 'packages', 'cli', 'scripts', 'holidays.mjs'), '--out', join(home, 'x.json')], {encoding: 'utf8'});
		assert.equal(res.status, 0, res.stderr);
		assert.match(res.stdout, /holidays: (wrote|skipped)/, 'a direct invocation must run main, not exit silently');
		assert.match(res.stdout, /holidays: wrote 33 days for 2026/, 'and write from the verified notice');
	});

	check('T6: the flags still parse — the step did not break the chain', () => {
		const {home, proj} = fixture();
		for (const args of [['install', '--yes'], ['install', '--yes', '--no-magento2'], ['install', '--yes', '--mod', 'gh']]) {
			const res = run(home, proj, ...args);
			assert.equal(res.status, 0, `${args.join(' ')} → ${res.stderr || res.stdout}`);
			assert.doesNotMatch(res.stdout, /unknown option/);
		}
	});

	check('T6: --no-holidays and PROFLOW_HOLIDAYS=off deploy nothing', () => {
		const a = fixture();
		assert.equal(run(a.home, a.proj, 'install', '--yes', '--no-holidays').status, 0);
		assert.equal(existsSync(join(a.home, '.commandcode', 'scripts', 'holidays.mjs')), false);
		const b = fixture();
		const res = spawnSync(process.execPath, [INSTALLER, 'install', '--yes', '--project', b.proj], {
			encoding: 'utf8',
			env: {...process.env, HOME: b.home, PROFLOW_HOLIDAYS: 'off'},
		});
		assert.equal(res.status, 0, res.stderr || res.stdout);
		assert.equal(existsSync(join(b.home, '.commandcode', 'scripts', 'holidays.mjs')), false);
	});

	check('T6: --dry-run writes nothing and reports the mode (spec row 24)', () => {
		const {home, proj} = fixture();
		const res = run(home, proj, 'install', '--dry-run');
		assert.equal(res.status, 0, res.stderr || res.stdout);
		assert.match(res.stdout, /holidays: skipped — dry run/);
		assert.equal(existsSync(join(home, '.commandcode', 'scripts', 'holidays.mjs')), false);
	});

	check('T6: the manifest records the script for uninstall to find', () => {
		const {home, proj} = fixture();
		assert.equal(run(home, proj, 'install', '--yes').status, 0);
		const manifest = JSON.parse(readFileSync(join(proj, '.commandcode', 'proflow.manifest.json'), 'utf8'));
		assert.deepEqual(manifest.scripts, ['holidays.mjs']);
	});
	check('T8: a project uninstall leaves the machine-local calendar alone (spec row 25)', () => {
		const {home, proj} = fixture();
		assert.equal(run(home, proj, 'install', '--yes').status, 0);
		const script = join(home, '.commandcode', 'scripts', 'holidays.mjs');
		assert.ok(existsSync(script), 'deployed by the install');
		assert.equal(run(home, proj, 'uninstall').status, 0);
		assert.ok(existsSync(script), 'a project uninstall must not remove it — other scopes read it');
	});

	check('T8: a global uninstall removes the script it deployed', () => {
		const home = mkdtempSync(join(tmpdir(), 'proflow-home-'));
		const globalRun = (...args) =>
			spawnSync(process.execPath, [INSTALLER, ...args, '--global'], {encoding: 'utf8', env: {...process.env, HOME: home}});
		assert.equal(globalRun('install', '--yes').status, 0, 'a real global install, so the manifest exists');
		const script = join(home, '.commandcode', 'scripts', 'holidays.mjs');
		assert.ok(existsSync(script), 'deployed globally');
		assert.equal(globalRun('uninstall').status, 0);
		assert.equal(existsSync(script), false, 'the script goes with a global uninstall');
		assert.equal(existsSync(join(home, '.commandcode', 'holidays-cn.json')), false);
	});

} catch (error) {
	failed = true;
	console.error(`  \u001b[31m✗\u001b[0m ${error.message}`);
}
console.log(`\n${failed ? '\u001b[31m✗ failed' : '\u001b[32m✓ passed'}\u001b[0m — ${checks.length} check(s)`);
process.exit(failed ? 1 : 0);
