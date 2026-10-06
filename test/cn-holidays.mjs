// T3 of tasks/plan.md — the calendar loader.
//
// The home directory is a parameter, so every fixture lives in a temp dir and the real
// ~/.commandcode is never touched. The cache is per process, so each case invalidates it.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MOD = join(here, '..', 'packages', 'proflow', 'mods', 'proflow.ts');
const staged = join(tmpdir(), `proflow-cal-${process.pid}.mts`);
writeFileSync(staged, readFileSync(MOD, 'utf8'));
let mod;
try {
	mod = await import(pathToFileURL(staged).href);
} finally {
	unlinkSync(staged);
}

const W = mod.parseWindows('01:00-04:00,06:00-10:00');
const H = 60 * 60 * 1000;
const at = iso => new Date(iso);
const home = () => mkdtempSync(join(tmpdir(), 'proflow-home-'));
const withCalendar = (raw, name = 'holidays-cn.json') => {
	const h = home();
	mkdirSync(join(h, '.commandcode'), {recursive: true});
	writeFileSync(join(h, '.commandcode', name), raw);
	return h;
};
const NAT = JSON.stringify({2026: {off: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']}});
const NAT_4 = JSON.stringify({2026: {off: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']}});
const checks = [];
const check = (name, fn) => {
	mod.invalidateCalendar();
	fn();
	checks.push(name);
	console.log(`  \u001b[32m✓\u001b[0m ${name}`);
};
let failed = false;

try {
	check('a valid file loads, and the holiday rule applies end to end', () => {
		const h = withCalendar(NAT);
		const cal = mod.loadCalendar(h);
		assert.equal(cal.off.size, 7);
		// spec row 1: the worked example, now through the loader rather than a hand-made set
		assert.equal(mod.isOffPeak(at('2026-10-05T02:00:00Z'), W, cal), true);
		assert.equal(mod.nextChange(at('2026-10-05T02:00:00Z'), W, cal), 71 * H);
		// spec row 3, and row 4 with the shorter holiday
		assert.equal(mod.nextChange(at('2026-10-03T15:27:00Z'), W, cal), 105 * H + 33 * 60 * 1000);
		const short = mod.calendarFrom(JSON.parse(NAT_4));
		assert.equal(mod.nextChange(at('2026-10-03T15:27:00Z'), W, short), 33 * H + 33 * 60 * 1000);
	});

	check('a missing file is an empty calendar — window ∪ weekend (spec row 17)', () => {
		assert.equal(mod.loadCalendar(home()).off.size, 0);
		assert.equal(mod.isOffPeak(at('2026-10-10T08:00:00Z'), W, mod.loadCalendar(home())), true, 'weekend survives');
	});

	check('malformed JSON is an empty calendar, not a crash (spec row 18)', () => {
		const cal = mod.loadCalendar(withCalendar('{"2026": {"off": ["2026-10-0'));
		assert.equal(cal.off.size, 0);
		assert.equal(mod.isOffPeak(at('2026-10-14T08:00:00Z'), W, cal), false, 'window still decides');
	});

	check('a corrupt row is dropped, not merged (dates outside their year key)', () => {
		const cal = mod.calendarFrom({2026: {off: ['2026-10-05', '2027-10-05', 'not-a-date', 42]}});
		assert.deepEqual([...cal.off], ['2026-10-05']);
		assert.equal(mod.calendarFrom(null).off.size, 0);
		assert.equal(mod.calendarFrom({2026: {off: 'not-an-array'}}).off.size, 0);
	});

	check('an unknown year resolves window ∪ weekend — no invented holiday (rows 15/16)', () => {
		const cal = mod.loadCalendar(withCalendar(NAT));
		assert.equal(mod.isOffPeak(at('2027-01-01T02:00:00Z'), W, cal), false, 'in-window, unknown year → peak');
		assert.equal(mod.isOffPeak(at('2027-01-02T02:00:00Z'), W, cal), true, 'a Saturday still survives');
		assert.equal(mod.nextChange(at('2027-01-02T02:00:00Z'), W, cal), 47 * H);
	});

	check('the calendar is read once per process, and invalidateCalendar re-reads', () => {
		const first = withCalendar(NAT);
		assert.equal(mod.loadCalendar(first).off.size, 7);
		const second = withCalendar(NAT_4);
		assert.equal(mod.loadCalendar(second).off.size, 7, 'cached — the second home is not read');
		mod.invalidateCalendar();
		assert.equal(mod.loadCalendar(second).off.size, 4, 'after invalidation the new file is read');
	});
} catch (error) {
	failed = true;
	console.error(`  \u001b[31m✗\u001b[0m ${error.message}`);
}
console.log(`\n${failed ? '\u001b[31m✗ failed' : '\u001b[32m✓ passed'}\u001b[0m — ${checks.length} check(s)`);
process.exit(failed ? 1 : 0);
