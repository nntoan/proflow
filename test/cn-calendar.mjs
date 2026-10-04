// T1 of tasks/plan.md — the CN calendar primitives.
//
// The mod's peak windows are UTC; weekends and holidays are China's. These two
// functions are the only place that timezone enters, so they carry the boundary
// cases the whole feature rests on.
import assert from 'node:assert/strict';
import {readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// The mod is TypeScript inside a CommonJS package, so Node will not treat the .ts
// as ESM from its extension alone and its exports stay invisible. A staged .mts
// copy is the portable way in — the mod imports only node builtins, so nothing
// relative has to resolve from the temp directory.
const here = dirname(fileURLToPath(import.meta.url));
const MOD = join(here, '..', 'packages', 'proflow', 'mods', 'proflow.ts');
const staged = join(tmpdir(), `proflow-cn-${process.pid}.mts`);
writeFileSync(staged, readFileSync(MOD, 'utf8'));
let cnDateOf;
let isCnWeekend;
try {
	({cnDateOf, isCnWeekend} = await import(pathToFileURL(staged).href));
} finally {
	unlinkSync(staged);
}

const at = iso => new Date(iso);
const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
	console.log(`  \u001b[32m✓\u001b[0m ${name}`);
};
let failed = false;

try {
	check('cnDateOf maps an instant to the China date, not the UTC one', () => {
		assert.equal(cnDateOf(at('2026-10-05T02:00:00Z')), '2026-10-05'); // 10:00 CN
		assert.equal(cnDateOf(at('2026-10-03T15:27:00Z')), '2026-10-03'); // 23:27 CN
	});

	check('cnDateOf holds the China midnight boundary at 16:00Z', () => {
		assert.equal(cnDateOf(at('2026-10-03T15:59:59Z')), '2026-10-03', 'a second before CN midnight');
		assert.equal(cnDateOf(at('2026-10-03T16:00:00Z')), '2026-10-04', 'CN midnight itself');
		assert.equal(cnDateOf(at('2026-10-03T16:00:01Z')), '2026-10-04', 'a second after');
	});

	check('isCnWeekend knows the China weekdays', () => {
		assert.equal(isCnWeekend('2026-10-03'), true, 'Sat');
		assert.equal(isCnWeekend('2026-10-04'), true, 'Sun');
		assert.equal(isCnWeekend('2026-10-05'), false, 'Mon');
		assert.equal(isCnWeekend('2026-10-08'), false, 'Thu');
		assert.equal(isCnWeekend('2026-10-10'), true, 'Sat');
		assert.equal(isCnWeekend('2027-01-02'), true, 'the 2027 case from the spec');
	});

	check('both are pure — same input, same output', () => {
		const t = at('2026-10-03T15:27:00Z');
		assert.equal(cnDateOf(t), cnDateOf(t));
		assert.equal(isCnWeekend('2026-10-03'), isCnWeekend('2026-10-03'));
	});
} catch (error) {
	failed = true;
	console.error(`  \u001b[31m✗\u001b[0m ${error.message}`);
}
console.log(`\n${failed ? '\u001b[31m✗ failed' : '\u001b[32m✓ passed'}\u001b[0m — ${checks.length} check(s)`);
process.exit(failed ? 1 : 0);
