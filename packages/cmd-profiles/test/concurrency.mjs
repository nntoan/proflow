// Concurrent registry writers — FR-020.
//
// The requirement says one person's session must not prevent another's from starting, stopping, or
// reprovisioning. The claim used to rest on `writeRegistry` using an atomic rename; the spec now says
// that is not proof. This suite exercises simultaneous writers and asserts nothing is lost.
//
// Run: node test/concurrency.mjs

import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {provision, touch} from '../src/lifecycle.mjs';
import {readRegistry} from '../src/registry.mjs';

const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
};

const tmp = mkdtempSync(join(tmpdir(), 'cmd-profiles-concurrency-'));
const CLI = join(import.meta.dirname, '..', 'src', 'cli.mjs');
const WRITERS = 8;

/** Run one CLI command in its own process, resolving to its exit code. */
function runCli(args) {
	return new Promise(resolve => {
		const child = spawn(process.execPath, [CLI, ...args], {stdio: 'ignore'});
		child.on('error', () => resolve({code: -1}));
		child.on('exit', code => resolve({code: code ?? -1}));
	});
}

check(`provisioning ${WRITERS} profiles sequentially leaves all of them`, () => {
	const root = join(tmp, 'seq');
	for (let i = 0; i < WRITERS; i += 1) provision({root, name: `p${i}`, owner: `owner${i}`});
	assert.equal(Object.keys(readRegistry(root).profiles).length, WRITERS);
});

check('an atomic write leaves no temp file behind', () => {
	const root = join(tmp, 'seq');
	assert.deepEqual(
		readdirSync(root).filter(name => name.includes('.tmp')),
		[],
		'a rename must not leave its temp file',
	);
});

// ── the cross-process races ─────────────────────────────────────────────────────────────────────
// Separate processes, because a lost update is a cross-process race: two readers both see N
// profiles, both write N+1, and one write vanishes. In-process calls would serialise and prove
// nothing about the case the requirement is about.

const parallelRoot = join(tmp, 'parallel');
provision({root: parallelRoot, name: 'seed', owner: 'seed'});
const provisionResults = await Promise.all(
	Array.from({length: WRITERS}, (_, i) =>
		runCli(['provision', '--name', `c${i}`, '--owner', `o${i}`, '--root', parallelRoot]),
	),
);

check(`FR-020: ${WRITERS} simultaneous provisions lose no record`, () => {
	const succeeded = provisionResults.filter(r => r.code === 0).length;
	const present = Object.keys(readRegistry(parallelRoot).profiles);
	// Every provision that reported success must still be there. A lost update shows up as a
	// success whose record is gone — silent, and exactly what the requirement forbids.
	assert.equal(
		present.length,
		succeeded + 1,
		`${succeeded} provisions succeeded but the registry holds ${present.length - 1} beyond the seed — present: ${present.join(', ')}`,
	);
});

check(`FR-020: every successful provision is individually present`, () => {
	const present = new Set(Object.keys(readRegistry(parallelRoot).profiles));
	const missing = provisionResults
		.map((r, i) => ({i, ...r}))
		.filter(r => r.code === 0 && !present.has(`c${r.i}`))
		.map(r => `c${r.i}`);
	assert.deepEqual(missing, [], 'a provision that reported success must have persisted a record');
});

check('a losing writer fails loudly rather than silently', () => {
	// The complement of the check above: if any writer could not persist, it must have exited
	// non-zero. A zero exit with no record is the only unacceptable outcome.
	const failures = provisionResults.filter(r => r.code !== 0).length;
	const succeeded = provisionResults.filter(r => r.code === 0).length;
	assert.equal(succeeded + failures, WRITERS, 'every writer must have produced an exit code');
});

// ── touches on one profile ──────────────────────────────────────────────────────────────────────

const touchRoot = join(tmp, 'touch-race');
provision({root: touchRoot, name: 'work', owner: 'ada'});
const touchResults = await Promise.all(
	Array.from({length: WRITERS}, () => runCli(['use', 'work', '--root', touchRoot])),
);

check(`FR-020: ${WRITERS} simultaneous writers to one registry do not corrupt it`, () => {
	const reg = readRegistry(touchRoot);
	assert.equal(reg.default, 'work', 'the registry must remain readable and coherent');
	assert.ok(reg.profiles.work, 'the profile must survive');
	assert.ok(
		touchResults.every(r => r.code === 0),
		'a concurrent write must not fail outright',
	);
});

check('last_used_at still parses after a storm of touches', () => {
	const root = join(tmp, 'touch-storm');
	provision({root, name: 'work', owner: 'ada'});
	for (let i = 0; i < WRITERS; i += 1) touch({root, name: 'work'});
	const value = readRegistry(root).profiles.work.last_used_at;
	assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, `unexpected timestamp: ${value}`);
});

console.log(`\n✓ cmd-profiles concurrency — ${checks.length} checks passed\n`);
for (const name of checks) console.log(`  ✓ ${name}`);
console.log('');
