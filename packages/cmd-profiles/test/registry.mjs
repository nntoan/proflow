// Registry validation. Every rule in data-model.md has a failing fixture here, because the
// failure mode this guards is a registry that looks fine and points somewhere nobody approved.
//
// Run: node test/registry.mjs

import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
	emptyRegistry,
	isAuthenticated,
	isRevoked,
	readRegistry,
	removeProfile,
	upsertProfile,
	validateRegistry,
	writeRegistry,
} from '../src/registry.mjs';

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

const tmp = mkdtempSync(join(tmpdir(), 'cmd-profiles-registry-'));
let seq = 0;
const freshRoot = () => join(tmp, `root-${(seq += 1)}`);

check('an empty registry is valid and has no default', () => {
	const reg = validateRegistry(emptyRegistry());
	assert.equal(reg.schema_version, 1);
	assert.equal(reg.default, null);
	assert.deepEqual(reg.profiles, {});
});

check('a missing registry file reads as empty, not as an error', () => {
	assert.deepEqual(readRegistry(freshRoot()), emptyRegistry());
});

check('a wrong schema_version is refused rather than guessed', () => {
	assert.throws(() => validateRegistry({schema_version: 2, default: null, profiles: {}}), /schema_version must be 1/);
	assert.throws(() => validateRegistry({default: null, profiles: {}}), /schema_version must be 1/);
});

check('a default naming an unknown profile is refused', () => {
	assert.throws(
		() => validateRegistry({schema_version: 1, default: 'ghost', profiles: {}}),
		/default "ghost" is not a known profile/,
	);
});

check('a default naming a revoked profile is refused', () => {
	const reg = {
		schema_version: 1,
		default: 'a',
		profiles: {a: {path: '/abs/a', owner: 'x', adopted: false, revoked: 'access'}},
	};
	assert.throws(() => validateRegistry(reg), /default "a" is revoked/);
});

check('a relative path is refused', () => {
	const reg = {schema_version: 1, default: null, profiles: {a: {path: 'relative/a', owner: 'x'}}};
	assert.throws(() => validateRegistry(reg), /non-absolute path/);
});

check('nested paths are refused — two overlapping homes would share state', () => {
	const reg = {
		schema_version: 1,
		default: null,
		profiles: {a: {path: '/abs/a', owner: 'x'}, b: {path: '/abs/a/b', owner: 'y'}},
	};
	assert.throws(() => validateRegistry(reg), /nested inside profile "a"/);
});

check('a duplicate path is refused — two names on one home is one identity twice', () => {
	const reg = {
		schema_version: 1,
		default: null,
		profiles: {a: {path: '/abs/same', owner: 'x'}, b: {path: '/abs/same', owner: 'y'}},
	};
	assert.throws(() => validateRegistry(reg), /share the path/);
});

check('an unknown revoked state is refused', () => {
	const reg = {schema_version: 1, default: null, profiles: {a: {path: '/abs/a', owner: 'x', revoked: 'gone'}}};
	assert.throws(() => validateRegistry(reg), /unknown revoked state/);
});

check('a valid registry round-trips through the file', () => {
	const root = freshRoot();
	const reg = emptyRegistry();
	reg.profiles.work = {path: '/abs/work', owner: 'ada', adopted: false, revoked: null};
	reg.default = 'work';
	writeRegistry(root, reg);
	assert.deepEqual(readRegistry(root), reg);
});

check('a corrupt registry file is reported, never repaired', () => {
	const root = freshRoot();
	mkdirSync(root, {recursive: true});
	writeFileSync(join(root, 'registry.json'), '{not json');
	assert.throws(() => readRegistry(root), /not valid JSON/);
});

check('isAuthenticated is derived from auth.json and never cached', () => {
	const home = join(tmp, 'home-a');
	mkdirSync(home, {recursive: true});
	assert.equal(isAuthenticated(home), false);
	writeCredential(home, '{"apiKey":"present"}');
	assert.equal(isAuthenticated(home), true, 'must be derived per call, so a new credential is seen');
});

check('isRevoked recognises access and treats anything else as live', () => {
	assert.equal(isRevoked({revoked: 'access'}), true);
	assert.equal(isRevoked({revoked: null}), false);
	assert.equal(isRevoked({}), false);
	assert.equal(isRevoked(undefined), false);
});

check('removeProfile clears a default that pointed at the removed profile', () => {
	const reg = {schema_version: 1, default: 'work', profiles: {work: {path: '/abs/w'}}};
	const next = removeProfile(reg, 'work');
	assert.equal(next.default, null);
	assert.deepEqual(next.profiles, {});
});

check('upsertProfile adds without disturbing siblings', () => {
	const reg = emptyRegistry();
	reg.profiles.work = {path: '/abs/w', owner: 'ada'};
	const next = upsertProfile(reg, 'personal', {path: '/abs/p', owner: 'ada'});
	assert.equal(Object.keys(next.profiles).length, 2);
	assert.equal(next.profiles.work.path, '/abs/w', 'the original record must be untouched');
});

console.log(`\n✓ cmd-profiles registry — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
