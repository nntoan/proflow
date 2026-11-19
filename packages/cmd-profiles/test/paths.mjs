// Layout and name rules. The name rules are narrow on purpose: a profile name becomes a
// directory, is printed into an operator's Orca command string, and is compared
// case-insensitively on macOS.
//
// Run: node test/paths.mjs

import assert from 'node:assert/strict';
import {join, resolve} from 'node:path';
import {assertProfileName, defaultRoot, profileHome, profilesDir, registryPath} from '../src/paths.mjs';

const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
};

check('defaultRoot honours CMD_PROFILES_ROOT so tests never touch a real home', () => {
	const before = process.env.CMD_PROFILES_ROOT;
	process.env.CMD_PROFILES_ROOT = '/tmp/example-root';
	try {
		assert.equal(defaultRoot(), resolve('/tmp/example-root'));
	} finally {
		if (before === undefined) delete process.env.CMD_PROFILES_ROOT;
		else process.env.CMD_PROFILES_ROOT = before;
	}
});

check('defaultRoot falls back to ~/.cmd-profiles', () => {
	const before = process.env.CMD_PROFILES_ROOT;
	delete process.env.CMD_PROFILES_ROOT;
	try {
		assert.match(defaultRoot(), /\.cmd-profiles$/);
	} finally {
		if (before !== undefined) process.env.CMD_PROFILES_ROOT = before;
	}
});

check('registryPath and profilesDir sit under the root', () => {
	assert.equal(registryPath('/r'), join('/r', 'registry.json'));
	assert.equal(profilesDir('/r'), join('/r', 'profiles'));
});

check('a valid name is accepted and every invalid shape is refused', () => {
	assert.equal(assertProfileName('work'), 'work');
	assert.equal(assertProfileName('a'), 'a');
	assert.equal(assertProfileName('work.2026'), 'work.2026');
	assert.equal(assertProfileName('a'.repeat(32)), 'a'.repeat(32));

	const bad = [
		'',
		'Work', // uppercase
		'1work', // must start with a letter
		'-work',
		'work/profile',
		'..',
		'work.',
		'a'.repeat(33),
		'con',
		'nul',
		'com1',
		'lpt9',
		'aux.txt',
	];
	for (const name of bad) {
		assert.throws(() => assertProfileName(name), `expected "${name}" to be refused`);
	}
});

check('profileHome joins the name under the profiles root', () => {
	assert.equal(profileHome('/r', 'work'), join('/r', 'profiles', 'work'));
});

check('profileHome cannot escape the root', () => {
	assert.throws(() => profileHome('/r', '../etc'));
	assert.throws(() => profileHome('/r', 'a/../../b'));
});

console.log(`\n✓ cmd-profiles paths — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
