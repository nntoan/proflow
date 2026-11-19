// Provision, adopt, use, revoke.
//
// The adoption check is the important one: it hashes every file in a pre-existing home before and
// after, because FR-013's promise is that adopting changes nothing, and "we only wrote the
// registry" is a claim that should be proven rather than asserted.
//
// Run: node test/lifecycle.mjs

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import {tmpdir} from 'node:os';
import {existsSync} from 'node:fs';
import {adopt, list, provision, revoke, useDefault, ISOLATION_NOTICE} from '../src/lifecycle.mjs';
import {EXIT, ProfileError, resolveProfile} from '../src/resolve.mjs';
import {readRegistry} from '../src/registry.mjs';

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

const tmp = mkdtempSync(join(tmpdir(), 'cmd-profiles-lifecycle-'));
// A real home with no installed content, so provision links nothing and FR-029 applies. Using the
// developer's actual home here would make the suite depend on what that machine has installed.
const FAKE_REAL_HOME = join(tmp, 'real-home');
mkdirSync(FAKE_REAL_HOME, {recursive: true});
let seq = 0;
const freshRoot = () => join(tmp, `root-${(seq += 1)}`);

/** A stable hash of every path and file under a directory. */
function hashTree(dir) {
	const hash = createHash('sha256');
	const walk = current => {
		for (const entry of readdirSync(current).sort()) {
			const full = join(current, entry);
			const rel = relative(dir, full);
			const stat = statSync(full);
			if (stat.isDirectory()) {
				hash.update(`d:${rel}\n`);
				walk(full);
			} else {
				hash.update(`f:${rel}:${stat.mode}\n`);
				hash.update(readFileSync(full));
			}
		}
	};
	walk(dir);
	return hash.digest('hex');
}

check('provision creates the home and a registry entry', () => {
	const root = freshRoot();
	const result = provision({root, name: 'work', owner: 'ada', realHome: FAKE_REAL_HOME});
	assert.ok(statSync(result.home).isDirectory());
	const reg = readRegistry(root);
	assert.equal(reg.profiles.work.owner, 'ada');
	assert.equal(reg.profiles.work.adopted, false);
	assert.equal(reg.profiles.work.revoked, null);
});

check('provision refuses a duplicate name', () => {
	const root = freshRoot();
	provision({root, name: 'work', owner: 'ada', realHome: FAKE_REAL_HOME});
	assert.throws(() => provision({root, name: 'work', owner: 'bob', realHome: FAKE_REAL_HOME}), /already exists/);
});

check('provision requires an owner', () => {
	assert.throws(() => provision({root: freshRoot(), name: 'work', owner: '  ', realHome: FAKE_REAL_HOME}), /needs an owner/);
});

check('list derives authentication per call', () => {
	const root = freshRoot();
	const {home} = provision({root, name: 'work', owner: 'ada', realHome: FAKE_REAL_HOME});
	assert.equal(list({root}).profiles[0].authenticated, false);
	writeCredential(home, '{}');
	assert.equal(list({root}).profiles[0].authenticated, true);
});

check('adopt records an existing home and changes nothing inside it', () => {
	const root = freshRoot();
	const existing = join(tmp, 'existing-home');
	mkdirSync(join(existing, '.commandcode'), {recursive: true});
	writeFileSync(join(existing, '.commandcode', 'config.json'), '{"model":"x"}');
	writeCredential(existing, '{"apiKey":"sentinel"}');

	const before = hashTree(existing);
	const result = adopt({root, name: 'default', owner: 'ada', path: existing});
	const after = hashTree(existing);

	assert.equal(after, before, 'adopting must not modify a single byte of the adopted home');
	assert.equal(result.adopted, true);
	assert.equal(result.authenticated, true);
	assert.equal(readRegistry(root).profiles.default.path, existing);
});

check('adopt --dry-run writes nothing at all', () => {
	const root = freshRoot();
	const existing = join(tmp, 'dry-home');
	mkdirSync(existing, {recursive: true});
	const result = adopt({root, name: 'default', owner: 'ada', path: existing, dryRun: true});
	assert.equal(result.dryRun, true);
	assert.equal(result.wouldWrite.profiles.default.path, existing);
	// A missing registry reads as empty by design, so absence is asserted against the filesystem.
	assert.equal(existsSync(join(root, 'registry.json')), false, '--dry-run must not create the registry');
	assert.equal(readRegistry(root).profiles.default, undefined);
});

check('adopt refuses a path that does not exist', () => {
	assert.throws(
		() => adopt({root: freshRoot(), name: 'x', owner: 'a', path: join(tmp, 'nope')}),
		/does not exist/,
	);
});

check('use sets and clears the default, and refuses a revoked profile', () => {
	const root = freshRoot();
	provision({root, name: 'work', owner: 'ada', realHome: FAKE_REAL_HOME});
	assert.equal(useDefault({root, name: 'work'}).default, 'work');
	assert.equal(useDefault({root, clear: true}).default, null);

	provision({root, name: 'gone', owner: 'bob', realHome: FAKE_REAL_HOME});
	revoke({root, name: 'gone', mode: 'access'});
	assert.throws(() => useDefault({root, name: 'gone'}), /revoked/);
});

check('revoke --access deletes the credential and blocks launches, keeping the rest', () => {
	const root = freshRoot();
	const {home} = provision({root, name: 'work', owner: 'ada', realHome: FAKE_REAL_HOME});
	writeCredential(home, '{}');
	mkdirSync(join(home, 'sessions'), {recursive: true});
	writeFileSync(join(home, 'sessions', 's1.jsonl'), 'transcript');

	const result = revoke({root, name: 'work', mode: 'access'});
	assert.equal(result.revoked, 'access');
	assert.equal(statStat(join(home, '.commandcode', 'auth.json')), false, 'credential must be gone');
	assert.equal(statStat(join(home, 'sessions', 's1.jsonl')), true, 'history must survive an access revoke');

	assert.throws(
		() => resolveProfile({profile: 'work', root, env: {}}),
		error => {
			assert.equal(error.exitCode, EXIT.revoked);
			return true;
		},
	);
});

check('revoke --access refuses to leave a revoked profile as the default', () => {
	const root = freshRoot();
	provision({root, name: 'work', owner: 'ada', realHome: FAKE_REAL_HOME});
	useDefault({root, name: 'work'});
	revoke({root, name: 'work', mode: 'access'});
	assert.equal(readRegistry(root).default, null, 'the default must be cleared, not left dangling');
});

check('revoke --history refuses while the profile is the default', () => {
	const root = freshRoot();
	provision({root, name: 'work', owner: 'ada', realHome: FAKE_REAL_HOME});
	useDefault({root, name: 'work'});
	assert.throws(
		() => revoke({root, name: 'work', mode: 'history', yes: true}),
		error => {
			assert.ok(error instanceof ProfileError);
			assert.match(error.message, /is the default/);
			return true;
		},
	);
});

check('revoke --history requires --yes when history would be destroyed', () => {
	const root = freshRoot();
	const {home} = provision({root, name: 'work', owner: 'ada', realHome: FAKE_REAL_HOME});
	writeFileSync(join(home, 'transcript.jsonl'), 'data');
	assert.throws(() => revoke({root, name: 'work', mode: 'history'}), /not empty/);
	assert.equal(statStat(home), true, 'a refused revoke must not delete anything');
});

check('revoke --history removes the directory and the record, leaving siblings byte-identical', () => {
	const root = freshRoot();
	const a = provision({root, name: 'keep', owner: 'ada', realHome: FAKE_REAL_HOME});
	const b = provision({root, name: 'gone', owner: 'bob', realHome: FAKE_REAL_HOME});
	writeFileSync(join(b.home, 'transcript.jsonl'), 'data');
	writeFileSync(join(a.home, 'transcript.jsonl'), 'keep me');
	const beforeA = hashTree(a.home);

	const result = revoke({root, name: 'gone', mode: 'history', yes: true});
	assert.equal(result.revoked, 'history');
	assert.equal(statStat(b.home), false, 'the revoked home must be gone');
	assert.equal(readRegistry(root).profiles.gone, undefined);
	assert.equal(hashTree(a.home), beforeA, 'a sibling profile must be untouched');
});

check('SC-008 — a single-profile installation resolves the same paths a user already had', () => {
	// SC-008 says a user who never creates a second profile observes no change in paths, prompts, or
	// behaviour. The neighbouring "byte-identical" check is about sibling profiles after a revoke,
	// which is a different claim; this one is about the untouched single-profile case.
	const root = freshRoot();
	const {home} = provision({root, name: 'only', owner: 'solo', realHome: FAKE_REAL_HOME});

	// The home is where the tool put it, under the root the caller gave — nothing is redirected to a
	// global location, and nothing is redirected away from it.
	assert.equal(home, join(root, 'profiles', 'only'));

	// Resolution reaches that same home rather than any fallback.
	const resolved = resolveProfile({profile: 'only', root, env: {}, registry: readRegistry(root)});
	assert.equal(resolved.home, home);
	assert.equal(resolved.source, 'flag');

	// And listing reports one profile with that path, no invented entries.
	const listed = list({root});
	assert.equal(listed.profiles.length, 1);
	assert.equal(listed.profiles[0].path, home);
	assert.equal(listed.profiles[0].adopted, false);
});

check('SC-008 — provisioning a second profile does not disturb the first', () => {
	const root = freshRoot();
	const first = provision({root, name: 'only', owner: 'solo', realHome: FAKE_REAL_HOME});
	const before = list({root}).profiles.find(p => p.name === 'only');

	provision({root, name: 'second', owner: 'other', realHome: FAKE_REAL_HOME});

	const after = list({root}).profiles.find(p => p.name === 'only');
	assert.deepEqual(after, before, 'an existing profile must be untouched by a new one');
	assert.equal(after.path, first.home);
});

check('US1/AC3 — one person signing out does not disturb another session', () => {
	// The acceptance scenario: "person B signs out and back in, person A's session continues
	// uninterrupted". The existing checks prove each profile has its own credential; none exercises
	// what happens to a *second* profile when the first signs out, which is the operational half of
	// FR-002.
	const root = freshRoot();
	const a = provision({root, name: 'alice', owner: 'alice', realHome: FAKE_REAL_HOME});
	const b = provision({root, name: 'bob', owner: 'bob', realHome: FAKE_REAL_HOME});
	writeCredential(a.home, '{"apiKey":"alice-key"}', {mode: 0o600});
	writeCredential(b.home, '{"apiKey":"bob-key"}', {mode: 0o600});

	// Alice is mid-session with some history.
	mkdirSync(join(a.home, 'sessions'), {recursive: true});
	writeFileSync(join(a.home, 'sessions', 'run.jsonl'), '{"turn":"alice work"}');
	const aliceBefore = hashTree(a.home);

	// Bob signs out the way a person does: the credential is gone, the rest of his profile is not.
	rmSync(join(b.home, '.commandcode', 'auth.json'));

	// Bob is now unauthenticated...
	const bob = resolveProfile({profile: 'bob', root, env: {}, registry: readRegistry(root)});
	assert.equal(bob.authenticated, false, 'bob is signed out');

	// ...and Alice is untouched: same credential, same history, byte for byte.
	assert.equal(
		hashTree(a.home),
		aliceBefore,
		"another person signing out must not alter Alice's profile in any way",
	);
	const alice = resolveProfile({profile: 'alice', root, env: {}, registry: readRegistry(root)});
	assert.equal(alice.authenticated, true, 'alice stays signed in while bob signs out');
	assert.equal(alice.home, a.home);

	// Bob signs back in; Alice is still untouched.
	writeCredential(b.home, '{"apiKey":"bob-key-2"}', {mode: 0o600});
	assert.equal(hashTree(a.home), aliceBefore, 'signing back in must not touch the other profile');
	assert.equal(
		resolveProfile({profile: 'bob', root, env: {}, registry: readRegistry(root)}).authenticated,
		true,
	);
});

check('US1/AC3 — revoking one profile leaves the other launchable', () => {
	// The administrative version of the same scenario: `revoke --access` is what an operator does,
	// and it must not take a neighbour down with it.
	const root = freshRoot();
	const keep = provision({root, name: 'keep', owner: 'ada', realHome: FAKE_REAL_HOME});
	const gone = provision({root, name: 'gone', owner: 'bob', realHome: FAKE_REAL_HOME});
	writeCredential(keep.home, '{}');
	writeCredential(gone.home, '{}');

	revoke({root, name: 'gone', mode: 'access'});

	assert.equal(
		resolveProfile({profile: 'keep', root, env: {}, registry: readRegistry(root)}).authenticated,
		true,
		'the surviving profile must remain launchable',
	);
	assert.throws(
		() => resolveProfile({profile: 'gone', root, env: {}, registry: readRegistry(root)}),
		error => {
			assert.equal(error.exitCode, EXIT.revoked);
			return true;
		},
	);
});

function statStat(path) {
	try {
		statSync(path);
		return true;
	} catch {
		return false;
	}
}

console.log(`\n✓ cmd-profiles lifecycle — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
