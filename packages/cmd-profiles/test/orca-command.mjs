// The Orca launch contract.
//
// These checks import the SHIPPED function. An earlier version of this file defined its own copy,
// which meant it passed regardless of what `src/` did — a test that could not fail. `/speckit-converge`
// found that (F2/T043) and this is the fix.
//
// Run: node test/orca-command.mjs

import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {orcaLaunchCommand} from '../src/orca.mjs';

const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
};

const DOCS = join(import.meta.dirname, '..', 'docs');

check('the documented launch string is exactly the contract', () => {
	assert.equal(
		orcaLaunchCommand('ada'),
		'orca terminal create --title "CC: ada" --command "cmd-profiles run --profile ada"',
	);
});

check('a profile name cannot carry a shell metacharacter into the command', () => {
	for (const bad of ['ada; rm -rf /', 'ada && echo pwned', 'ada$(whoami)', 'ada`id`', 'a/b', 'a b']) {
		assert.throws(() => orcaLaunchCommand(bad), `expected "${bad}" to be refused`);
	}
});

check('a valid dotted name survives into the command', () => {
	assert.match(orcaLaunchCommand('work.2026'), /--profile work\.2026"/);
});

check('every documented launch string matches the shipped function', () => {
	// The docs hard-code the command for a human to copy. If the function and the docs disagree, one
	// of them is telling an operator to run the wrong thing.
	const expected = orcaLaunchCommand('ada');
	const docs = readdirSync(DOCS).filter(f => f.endsWith('.md'));
	assert.ok(docs.length > 0, 'there must be docs to check');

	const offenders = docs.filter(file => {
		const text = readFileSync(join(DOCS, file), 'utf8');
		if (!text.includes('orca terminal create')) return false;
		return !text.includes(expected);
	});

	assert.deepEqual(offenders, [], `these docs show a launch string the function does not produce: ${offenders.join(', ')}`);
});

console.log(`\n✓ cmd-profiles orca command — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
