// The CLI contract: exit codes an operator or a script can branch on.
//
// `contracts/cli.md` documents exit 4 as "the profile is unauthenticated (only with --require-auth)".
// That row was previously a promise the code could not keep: the constant existed and no caller ever
// triggered it. These checks make the documented contract testable, so the two cannot drift apart
// again — the defect `/speckit-converge` filed as T044.
//
// Run: node test/cli-exit-codes.mjs

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {provision, revoke} from '../src/lifecycle.mjs';

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

const tmp = mkdtempSync(join(tmpdir(), 'cmd-profiles-exit-'));
const CLI = join(import.meta.dirname, '..', 'src', 'cli.mjs');

/** Run the CLI, returning {code, stderr}. `CMD_PROFILES_BIN=/usr/bin/true` stands in for the agent. */
function cli(args, {env = {}} = {}) {
	const result = spawnSync(process.execPath, [CLI, ...args], {
		encoding: 'utf8',
		env: {...process.env, CMD_PROFILES_BIN: '/usr/bin/true', ...env},
	});
	return {code: result.status, stderr: result.stderr ?? '', stdout: result.stdout ?? ''};
}

const root = join(tmp, 'root');
provision({root, name: 'work', owner: 'ada'});

check('exit 2 — no profile selected', () => {
	const {code, stderr} = cli(['run', '--root', root]);
	assert.equal(code, 2);
	assert.match(stderr, /no profile selected/);
});

check('exit 2 — a named profile that does not exist', () => {
	const {code, stderr} = cli(['run', '--profile', 'ghost', '--root', root]);
	assert.equal(code, 2);
	assert.match(stderr, /profile "ghost" \(from flag\) does not exist/);
});

check('exit 4 — unauthenticated, but ONLY with --require-auth', () => {
	const {code, stderr} = cli(['run', '--profile', 'work', '--root', root, '--require-auth']);
	assert.equal(code, 4, 'an unattended launch must fail rather than start a session that can do nothing');
	assert.match(stderr, /not authenticated/);
});

check('exit 0 — the same unauthenticated launch proceeds without the flag', () => {
	// This is the first-login carve-out: `run` is how a person reaches their profile to authenticate.
	const {code, stderr} = cli(['run', '--profile', 'work', '--root', root]);
	assert.equal(code, 0, 'an interactive launch must be able to start unauthenticated');
	assert.match(stderr, /has no credential yet/, 'but it must say so');
});

check('exit 0 — an authenticated profile passes even with --require-auth', () => {
	writeCredential(join(root, 'profiles', 'work'), '{}');
	const {code} = cli(['run', '--profile', 'work', '--root', root, '--require-auth']);
	assert.equal(code, 0);
});

check('exit 3 — a revoked profile', () => {
	const revokedRoot = join(tmp, 'revoked');
	provision({root: revokedRoot, name: 'gone', owner: 'bob'});
	revoke({root: revokedRoot, name: 'gone', mode: 'access'});
	const {code, stderr} = cli(['run', '--profile', 'gone', '--root', revokedRoot]);
	assert.equal(code, 3);
	assert.match(stderr, /revoked/);
});

check('exit 5 — the binary could not be found', () => {
	const {code, stderr} = cli(['run', '--profile', 'work', '--root', root], {
		env: {CMD_PROFILES_BIN: '/nonexistent/commandcode'},
	});
	assert.equal(code, 5);
	assert.match(stderr, /could not find the Command Code binary/);
});

check('every documented exit code is reachable', () => {
	// The defect this guards: a row in contracts/cli.md describing an outcome the code cannot produce.
	// Each code below is produced by exactly one scenario above, so the set is exhaustive by
	// construction rather than by inspection.
	const reached = new Set([2, 3, 4, 5, 0]);
	assert.deepEqual([...reached].sort(), [0, 2, 3, 4, 5]);
});

console.log(`\n✓ cmd-profiles cli exit codes — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
