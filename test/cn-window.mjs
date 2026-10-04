// T2 of tasks/plan.md — the resolver, with and without a calendar.
//
// Durations are asserted in milliseconds against the spec's pinned values (stated in
// H:MM:SS). The row's formatting and colours are T4's, so nothing here touches the
// existing row assertions.
import assert from 'node:assert/strict';
import {readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MOD = join(here, '..', 'packages', 'proflow', 'mods', 'proflow.ts');
const staged = join(tmpdir(), `proflow-win-${process.pid}.mts`);
writeFileSync(staged, readFileSync(MOD, 'utf8'));
let mod;
try {
	mod = await import(pathToFileURL(staged).href);
} finally {
	unlinkSync(staged);
}

const at = iso => new Date(iso);
const W = mod.parseWindows('01:00-04:00,06:00-10:00');
const NONE = {off: new Set()};
const NAT = {off: new Set(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'])};
const NAT_4 = {off: new Set(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'])};
const H = 60 * 60 * 1000;
const checks = [];
const check = (name, fn) => {
	fn();
	checks.push(name);
	console.log(`  \u001b[32m✓\u001b[0m ${name}`);
};
let failed = false;

try {
	check('row 2: in-window with no calendar is peak, ending at the window edge', () => {
		const now = at('2026-10-05T02:00:00Z');
		assert.equal(mod.isOffPeak(now, W, NONE), false, 'inside 01:00-04:00');
		assert.equal(mod.nextChange(now, W, NONE), 2 * H, 'peak ends at 04:00Z');
	});

	check('row 5: a Saturday inside a peak window is off-peak, and the weekend governs', () => {
		const now = at('2026-10-03T03:00:00Z');
		assert.equal(mod.isOffPeak(now, W, NONE), true, 'CN Sat 11:00');
		assert.equal(mod.nextChange(now, W, NONE), 46 * H, 'next peak Mon 2026-10-05T01:00Z');
	});

	check('row 6: a weekend Saturday with no holiday still defers to Monday', () => {
		const now = at('2026-10-10T08:00:00Z');
		assert.equal(mod.isOffPeak(now, W, NONE), true, 'CN Sat 16:00');
		assert.equal(mod.nextChange(now, W, NONE), 41 * H, 'next peak Mon 2026-10-12T01:00Z');
	});

	check('row 8: mid-window on a Wednesday is peak until the window closes', () => {
		const now = at('2026-10-14T08:00:00Z');
		assert.equal(mod.isOffPeak(now, W, NONE), false);
		assert.equal(mod.nextChange(now, W, NONE), 2 * H, 'the window closes at 10:00Z');
	});

	check('row 9: outside the windows is off-peak, next window on the China side', () => {
		const now = at('2026-10-14T17:00:00Z');
		assert.equal(mod.isOffPeak(now, W, NONE), true, 'CN Thu 01:00');
		assert.equal(mod.nextChange(now, W, NONE), 8 * H, 'next peak 2026-10-15T01:00Z');
	});

	check('row 10: the seconds boundary at 01:00Z is exact', () => {
		assert.equal(mod.nextChange(at('2026-10-08T00:59:59Z'), W, NONE), 1000, 'one second');
		assert.equal(mod.nextChange(at('2026-10-08T01:00:00Z'), W, NONE), 3 * H, 'window ends 04:00Z');
		assert.equal(mod.nextChange(at('2026-10-08T01:00:01Z'), W, NONE), 3 * H - 1000, 'one second less');
	});

	// Without a calendar this is the weekend rule alone — 33:32:20, the value round 2's
	// reviewer derived independently for the weekend-only case.
	check('row 13 without a calendar: the weekend rule alone', () => {
		const now = at('2026-10-03T15:27:40Z');
		assert.equal(mod.isOffPeak(now, W, NONE), true, 'CN Sat 23:27');
		assert.equal(mod.nextChange(now, W, NONE), 33 * H + 32 * 60 * 1000 + 20000, '33:32:20 to Monday');
	});

	check('row 17: window ∪ weekend with no holidays at all', () => {
		assert.equal(mod.isOffPeak(at('2026-10-10T08:00:00Z'), W, NONE), true, 'weekend');
		assert.equal(mod.isOffPeak(at('2026-10-14T08:00:00Z'), W, NONE), false, 'window');
	});

	// The spec's headline holiday values, proved early: the calendar is only a parameter,
	// so the rule is assertable before the loader (T3) exists.
	check('row 1: the worked example — a holiday weekday, 71:00:00 to the next peak', () => {
		const now = at('2026-10-05T02:00:00Z');
		assert.equal(mod.isOffPeak(now, W, NAT), true, 'inside a window, but a holiday');
		assert.equal(mod.nextChange(now, W, NAT), 71 * H, 'next peak Thu 2026-10-08T01:00Z');
	});

	check('row 3: a holiday weekend, 105:33:00', () => {
		assert.equal(mod.nextChange(at('2026-10-03T15:27:00Z'), W, NAT), 105 * H + 33 * 60 * 1000);
	});

	check('row 4: the same instant, holiday ending 10-04, 33:33:00', () => {
		assert.equal(mod.nextChange(at('2026-10-03T15:27:00Z'), W, NAT_4), 33 * H + 33 * 60 * 1000);
	});

	check('row 11: the instant the holiday day ends, 09:00:00', () => {
		const now = at('2026-10-07T16:00:00Z');
		assert.equal(mod.isOffPeak(now, W, NAT), true, 'CN Thu 10-08 00:00, outside the windows');
		assert.equal(mod.nextChange(now, W, NAT), 9 * H, 'next peak 10-08T01:00Z');
	});

	check('row 13 with the holiday: 105:32:20, second-accurate', () => {
		assert.equal(mod.nextChange(at('2026-10-03T15:27:40Z'), W, NAT), 105 * H + 32 * 60 * 1000 + 20000);
	});
} catch (error) {
	failed = true;
	console.error(`  \u001b[31m✗\u001b[0m ${error.message}`);
}
console.log(`\n${failed ? '\u001b[31m✗ failed' : '\u001b[32m✓ passed'}\u001b[0m — ${checks.length} check(s)`);
process.exit(failed ? 1 : 0);
