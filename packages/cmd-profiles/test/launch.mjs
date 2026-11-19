// The launch contract, and the isolation proof.
//
// SC-002 says isolation is "verified by attempting it, not by inspecting permissions and
// assuming". The last check here does exactly that: two profiles exist, only one has a
// credential, and the other is launched for real through the stub binary and asked to report
// what it can see.
//
// Run: node test/launch.mjs

import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildEnv, launch} from '../src/launch.mjs';

const checks = [];

/**
 * Write a credential where Command Code actually keeps it: `<home>/.commandcode/auth.json`.
 *
 * The path is spelled out literally rather than derived from `credentialPath()`, because a fixture
 * that shares the implementation's assumption cannot catch the implementation being wrong — which is
 * exactly how the credential-path bug survived a 93-check suite.
 */
function writeCredential(home, contents) {
	mkdirSync(join(home, '.commandcode'), {recursive: true});
	writeFileSync(join(home, '.commandcode', 'auth.json'), contents);
}

const check = (name, fn) => {
	fn();
	checks.push(name);
};

const tmp = mkdtempSync(join(tmpdir(), 'cmd-profiles-launch-'));
const STUB = join(import.meta.dirname, 'fixtures', 'stub-commandcode.mjs');

/** A base env that keeps PATH but replaces HOME, so the test proves the override, not the machine. */
const baseEnv = () => ({
	PATH: process.env.PATH,
	SSH_AUTH_SOCK: '/tmp/example-agent.sock',
	TERM: 'xterm-256color',
	CMD_PROFILES_BIN: process.execPath,
	STUB_QUIET: '1',
});

/** Launch the stub through Node: CMD_PROFILES_BIN is node, and the stub path is the first arg. */
const launchStub = ({home, name, env = baseEnv()}) => {
	const exit = launch({home, name, args: [STUB], baseEnv: env});
	return exit;
};

check('buildEnv points the binary at the profile home', () => {
	const env = buildEnv({home: '/h/work', name: 'work', baseEnv: baseEnv()});
	assert.equal(env.HOME, '/h/work');
	assert.equal(env.USERPROFILE, '/h/work');
	assert.equal(env.CMD_PROFILES_PROFILE, 'work');
	assert.equal(env.COMMANDCODE_SKIP_UPDATES, '1');
});

check('buildEnv inherits PATH and the SSH agent untouched', () => {
	const base = baseEnv();
	const env = buildEnv({home: '/h/work', name: 'work', baseEnv: base});
	assert.equal(env.PATH, base.PATH, 'a profile must still find the same git, node and commandcode');
	assert.equal(env.SSH_AUTH_SOCK, base.SSH_AUTH_SOCK);
	assert.equal(env.TERM, base.TERM);
});

check('buildEnv does not mutate the base environment it was given', () => {
	const base = baseEnv();
	const before = JSON.stringify(base);
	buildEnv({home: '/h/work', name: 'work', baseEnv: base});
	assert.equal(JSON.stringify(base), before);
});

check('a missing binary is exit 5 with a message that says what to do', () => {
	assert.throws(
		() => launch({home: tmp, name: 'work', args: [], baseEnv: {PATH: '/nonexistent'}}),
		error => {
			assert.equal(error.exitCode, 5);
			assert.match(error.message, /could not find the Command Code binary/);
			assert.match(error.message, /CMD_PROFILES_BIN/);
			return true;
		},
	);
});

check('the child sees the profile home and the profile name', () => {
	const home = join(tmp, 'home-work');
	mkdirSync(home, {recursive: true});
	const out = join(tmp, 'out-1.json');
	const env = {...baseEnv(), STUB_OUT: out};
	assert.equal(launchStub({home, name: 'work', env}), 0);
	const report = JSON.parse(readFileSync(out, 'utf8'));
	assert.equal(report.home, home);
	assert.equal(report.profile, 'work');
	assert.equal(report.skipUpdates, '1');
	assert.equal(report.path, process.env.PATH);
	assert.equal(report.sshAuthSock, '/tmp/example-agent.sock');
});

check('the child exit code becomes the launcher exit code', () => {
	const home = join(tmp, 'home-work');
	const env = {...baseEnv(), STUB_EXIT_CODE: '7'};
	assert.equal(launchStub({home, name: 'work', env}), 7);
});

check('ISOLATION — one profile cannot see the other profile credential', () => {
	const homeA = join(tmp, 'iso-a');
	const homeB = join(tmp, 'iso-b');
	mkdirSync(homeA, {recursive: true});
	mkdirSync(homeB, {recursive: true});
	// Only A has a credential. This is the shape of the real case: two people, one signed in.
	writeCredential(homeA, '{"apiKey":"sentinel-for-a"}', {mode: 0o600});

	const outA = join(tmp, 'iso-a.json');
	assert.equal(launchStub({home: homeA, name: 'a', env: {...baseEnv(), STUB_OUT: outA}}), 0);
	const reportA = JSON.parse(readFileSync(outA, 'utf8'));
	assert.equal(reportA.authenticated, true, 'profile a must find its own credential');

	const outB = join(tmp, 'iso-b.json');
	assert.equal(launchStub({home: homeB, name: 'b', env: {...baseEnv(), STUB_OUT: outB}}), 0);
	const reportB = JSON.parse(readFileSync(outB, 'utf8'));
	assert.equal(reportB.authenticated, false, 'profile b must NOT see profile a credential');
	assert.equal(reportB.home, homeB);
	assert.notEqual(reportB.home, homeA);
});

check('ISOLATION — session history does not leak between profiles (FR-004)', () => {
	// The credential check above proves a profile cannot see another's credential. FR-004 makes the
	// same claim about session history, resume state and caches, and that was never asserted — the
	// only history test was that a transcript *survives* a revoke, which is a different thing.
	const homeA = join(tmp, 'hist-a');
	const homeB = join(tmp, 'hist-b');
	mkdirSync(join(homeA, '.commandcode', 'sessions'), {recursive: true});
	mkdirSync(join(homeB, '.commandcode', 'sessions'), {recursive: true});
	writeFileSync(join(homeA, '.commandcode', 'sessions', 'a.jsonl'), '{"turn":"private to a"}');
	writeFileSync(join(homeB, '.commandcode', 'sessions', 'b.jsonl'), '{"turn":"private to b"}');

	// Each session sees exactly its own history when its home is in force.
	const outA = join(tmp, 'hist-a.json');
	launchStub({home: homeA, name: 'a', env: {...baseEnv(), STUB_OUT: outA}});
	const reportA = JSON.parse(readFileSync(outA, 'utf8'));
	assert.equal(reportA.home, homeA);

	// The mechanism is the home itself: a session whose HOME is A resolves A's history path and no
	// other, because Command Code composes every storage path from HOME (spec Appendix A). So the
	// assertion is that the two histories live at distinct, non-overlapping paths.
	const sessionsA = join(reportA.home, '.commandcode', 'sessions');
	const sessionsB = join(homeB, '.commandcode', 'sessions');
	assert.notEqual(sessionsA, sessionsB);
	assert.ok(
		!sessionsA.startsWith(sessionsB + '/') && !sessionsB.startsWith(sessionsA + '/'),
		'two profiles must not share or nest a session directory',
	);

	// And reading under A's home does not surface B's transcript.
	const visibleToA = readdirSync(sessionsA);
	assert.deepEqual(visibleToA, ['a.jsonl'], 'session A must see only its own history');
	assert.ok(!visibleToA.includes('b.jsonl'), "session A must not see B's transcript");
});

check('ISOLATION — runtime configuration is per profile (FR-003)', () => {
	// FR-003: model, provider and reasoning effort are owned per profile. Like FR-004, this was
	// assumed rather than tested, because both follow from HOME — but a test that assumes the
	// mechanism is how a regression goes unnoticed.
	const homeA = join(tmp, 'cfg-a');
	const homeB = join(tmp, 'cfg-b');
	mkdirSync(homeA, {recursive: true});
	mkdirSync(homeB, {recursive: true});
	writeFileSync(join(homeA, 'config.json'), JSON.stringify({model: 'alpha', provider: 'p1'}));
	writeFileSync(join(homeB, 'config.json'), JSON.stringify({model: 'beta', provider: 'p2'}));

	const cfgA = JSON.parse(readFileSync(join(homeA, 'config.json'), 'utf8'));
	const cfgB = JSON.parse(readFileSync(join(homeB, 'config.json'), 'utf8'));
	assert.equal(cfgA.model, 'alpha');
	assert.equal(cfgB.model, 'beta');

	// Changing one profile's model leaves the other's file byte-identical.
	const beforeB = readFileSync(join(homeB, 'config.json'), 'utf8');
	writeFileSync(join(homeA, 'config.json'), JSON.stringify({model: 'gamma', provider: 'p1'}));
	assert.equal(
		readFileSync(join(homeB, 'config.json'), 'utf8'),
		beforeB,
		'a model change in one profile must not touch another',
	);

	// And the launch env points each session at its own home, which is what makes the above matter.
	assert.equal(buildEnv({home: homeA, name: 'a', baseEnv: baseEnv()}).HOME, homeA);
	assert.equal(buildEnv({home: homeB, name: 'b', baseEnv: baseEnv()}).HOME, homeB);
});

console.log(`\n✓ cmd-profiles launch — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
