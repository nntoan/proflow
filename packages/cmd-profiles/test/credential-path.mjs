// The credential lives at `<home>/.commandcode/auth.json` — not `<home>/auth.json`.
//
// This file exists because the second path was used for months and a 93-check suite agreed with it:
// every fixture wrote to the wrong place, so nothing could disagree. The tests here therefore spell
// the vendor's path out LITERALLY and never derive it from `credentialPath()`, because a test that
// shares the implementation's assumption cannot catch the implementation being wrong.
//
// Run: node test/credential-path.mjs

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {provision, revoke} from '../src/lifecycle.mjs';
import {CC_STATE_DIR, ccStateDir, credentialPath, isAuthenticated, readRegistry} from '../src/registry.mjs';

const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
};

const tmp = mkdtempSync(join(tmpdir(), 'cmd-profiles-cred-'));
const CLI = join(import.meta.dirname, '..', 'src', 'cli.mjs');

/** Write a credential exactly where Command Code writes it. Path hardcoded on purpose. */
function vendorCredential(home, contents = '{"apiKey":"secret"}') {
	mkdirSync(join(home, '.commandcode'), {recursive: true});
	writeFileSync(join(home, '.commandcode', 'auth.json'), contents, {mode: 0o600});
}

function cli(args) {
	const r = spawnSync(process.execPath, [CLI, ...args], {encoding: 'utf8', env: {...process.env}});
	return {code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? ''};
}

check('REGRESSION — isAuthenticated finds a credential at the vendor path', () => {
	const home = join(tmp, 'h1');
	mkdirSync(home, {recursive: true});
	assert.equal(isAuthenticated(home), false, 'nothing written yet');
	vendorCredential(home);
	assert.equal(isAuthenticated(home), true, 'the credential at .commandcode/auth.json must be found');
});

check('REGRESSION — a credential at the OLD wrong path is NOT treated as authentication', () => {
	// The inverse assertion. If someone "fixes" this by probing both locations, this test fails —
	// which is intended: the old layout is not a valid layout, and accepting it would hide a real
	// misconfiguration rather than surface it.
	const home = join(tmp, 'h2');
	mkdirSync(home, {recursive: true});
	writeFileSync(join(home, 'auth.json'), '{"apiKey":"stale"}');
	assert.equal(isAuthenticated(home), false, 'a credential outside .commandcode must not count');
});

check('REGRESSION — list reports an authenticated profile as authenticated', () => {
	const root = join(tmp, 'root-list');
	const {home} = provision({root, name: 'alice', owner: 'alice'});
	vendorCredential(home);
	const out = cli(['list', '--root', root, '--json']);
	const profile = JSON.parse(out.stdout).profiles[0];
	assert.equal(profile.authenticated, true, 'list must not report a signed-in profile as unauthenticated');
});

check('REGRESSION — diagnose raises no finding for an authenticated profile', () => {
	const root = join(tmp, 'root-diag');
	const {home} = provision({root, name: 'alice', owner: 'alice'});
	vendorCredential(home);
	const out = cli(['diagnose', '--root', root, '--json']);
	assert.deepEqual(JSON.parse(out.stdout).profiles[0].findings, [], 'a healthy profile must produce no findings');
});

check('REGRESSION — revoke --access actually deletes the vendor credential', () => {
	// The severe one. Before the fix this reported success and left the credential on disk.
	const root = join(tmp, 'root-revoke');
	const {home} = provision({root, name: 'alice', owner: 'alice'});
	vendorCredential(home, '{"apiKey":"must-be-destroyed"}');

	// Assert the precondition through the filesystem, with the path spelled out.
	const vendor = join(home, '.commandcode', 'auth.json');
	assert.equal(existsSync(vendor), true, 'precondition: the credential exists');

	revoke({root, name: 'alice', mode: 'access'});

	assert.equal(existsSync(vendor), false, 'revocation must delete the real credential, not a phantom path');
	const reg = readRegistry(root);
	assert.equal(reg.profiles.alice.revoked, 'access');
});

check('REGRESSION — revoke --access keeps the rest of the profile', () => {
	const root = join(tmp, 'root-keep');
	const {home} = provision({root, name: 'bob', owner: 'bob'});
	vendorCredential(home);
	mkdirSync(join(home, '.commandcode', 'sessions'), {recursive: true});
	writeFileSync(join(home, '.commandcode', 'sessions', 's.jsonl'), '{"turn":1}');
	writeFileSync(join(home, '.commandcode', 'config.json'), '{"model":"x"}');

	revoke({root, name: 'bob', mode: 'access'});

	assert.equal(existsSync(join(home, '.commandcode', 'auth.json')), false, 'credential gone');
	assert.equal(existsSync(join(home, '.commandcode', 'sessions', 's.jsonl')), true, 'history kept');
	assert.equal(existsSync(join(home, '.commandcode', 'config.json')), true, 'config kept');
});

check('REGRESSION — run --require-auth accepts a profile signed in at the vendor path', () => {
	const root = join(tmp, 'root-require');
	const {home} = provision({root, name: 'carol', owner: 'carol'});
	vendorCredential(home);
	const r = spawnSync(process.execPath, [CLI, 'run', '--profile', 'carol', '--root', root, '--require-auth'], {
		encoding: 'utf8',
		env: {...process.env, CMD_PROFILES_BIN: '/usr/bin/true'},
	});
	assert.equal(r.status, 0, 'a signed-in profile must not be refused by --require-auth');
});

check('the helpers agree with the literal vendor path', () => {
	// A consistency check between the exported helpers and the literals spelled out above. The
	// literals are the contract; this catches the helpers drifting from them.
	const home = join(tmp, 'h3');
	assert.equal(credentialPath(home), join(home, '.commandcode', 'auth.json'));
	assert.equal(ccStateDir(home), join(home, '.commandcode'));
	assert.equal(CC_STATE_DIR, '.commandcode');
});

console.log(`\n✓ cmd-profiles credential path — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
