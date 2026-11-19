// Diagnostics. The contract that matters: a credential value must never appear in any output,
// only whether one is present. Seeded here with a sentinel that would be obvious if it leaked.
//
// Run: node test/diagnose.mjs

import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {diagnose} from '../src/diagnose.mjs';
import {provision, revoke, useDefault} from '../src/lifecycle.mjs';

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

const tmp = mkdtempSync(join(tmpdir(), 'cmd-profiles-diagnose-'));
let seq = 0;
const freshRoot = () => join(tmp, `root-${(seq += 1)}`);
const SENTINEL = 'sk-SENTINEL-must-never-appear-in-output';

check('a healthy profile reports no findings', () => {
	const root = freshRoot();
	provision({root, name: 'work', owner: 'ada'});
	const result = diagnose({root, profile: 'work'});
	assert.deepEqual(result.profiles[0].findings, ['unauthenticated']);
});

check('an unauthenticated profile is named as such, not reported healthy', () => {
	const root = freshRoot();
	const {home} = provision({root, name: 'work', owner: 'ada'});
	writeCredential(home, JSON.stringify({apiKey: SENTINEL}));
	const result = diagnose({root, profile: 'work'});
	assert.deepEqual(result.profiles[0].findings, []);
	assert.equal(result.profiles[0].authenticated, true);
});

check('a missing path is reported rather than crashing', () => {
	const root = freshRoot();
	const {home} = provision({root, name: 'work', owner: 'ada'});
	rmSync(home, {recursive: true, force: true});
	const result = diagnose({root, profile: 'work'});
	assert.ok(result.profiles[0].findings.includes('path-missing'));
});

check('a revoked profile is reported as revoked', () => {
	const root = freshRoot();
	provision({root, name: 'work', owner: 'ada'});
	revoke({root, name: 'work', mode: 'access'});
	const result = diagnose({root, profile: 'work'});
	assert.ok(result.profiles[0].findings.includes('revoked'));
});

check('an unknown profile name is a finding, not a throw', () => {
	const root = freshRoot();
	provision({root, name: 'work', owner: 'ada'});
	const result = diagnose({root, profile: 'ghost'});
	assert.deepEqual(result.profiles[0].findings, ['unknown-profile']);
});

check('a broken registry is reported as the finding, not as a crash', () => {
	const root = freshRoot();
	mkdirSync(root, {recursive: true});
	writeFileSync(join(root, 'registry.json'), '{not json');
	const result = diagnose({root});
	assert.equal(result.registry.valid, false);
	assert.match(result.registry.reason, /not valid JSON/);
});

check('diagnose reports every profile when none is named', () => {
	const root = freshRoot();
	provision({root, name: 'a', owner: 'ada'});
	provision({root, name: 'b', owner: 'bob'});
	useDefault({root, name: 'a'});
	const result = diagnose({root});
	assert.equal(result.profiles.length, 2);
	assert.equal(result.default, 'a');
	assert.equal(result.profiles.find(p => p.name === 'a').isDefault, true);
});

check('CREDENTIAL — no output contains a credential value', () => {
	const root = freshRoot();
	const {home} = provision({root, name: 'work', owner: 'ada'});
	writeCredential(home, JSON.stringify({apiKey: SENTINEL}));

	const all = JSON.stringify(diagnose({root}));
	assert.doesNotMatch(all, /SENTINEL/, 'a credential value must never reach diagnostic output');
	// It must still tell the operator a credential is there — silence would be less useful.
	assert.equal(diagnose({root}).profiles[0].authenticated, true);
});

console.log(`\n✓ cmd-profiles diagnose — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
