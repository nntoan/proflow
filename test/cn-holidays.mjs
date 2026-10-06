// T3 of tasks/plan.md — the calendar loader.
//
// The home directory is a parameter, so every fixture lives in a temp dir and the real
// ~/.commandcode is never touched. The cache is per process, so each case invalidates it.
import assert from 'node:assert/strict';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs';
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
// T5 — the fetch script's testable half: validation, the atomic write, and the refusal.
const SCRIPT = join(here, '..', 'packages', 'cli', 'scripts', 'holidays.mjs');
const hol = await import(pathToFileURL(SCRIPT).href);
const NAT_RAW = JSON.parse(NAT);

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
	check('T5: validation accepts a real calendar and refuses anything under the floor', () => {
		assert.deepEqual(hol.validateHolidays(NAT_RAW), {2026: 7});
		assert.equal(hol.validateHolidays({2026: {off: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']}}), null,
			'four dates is under the floor, so the year is refused outright');
		assert.equal(hol.validateHolidays({2026: {off: []}}), null);
		assert.equal(hol.validateHolidays(null), null);
		assert.equal(hol.validateHolidays([1, 2]), null);
		assert.equal(hol.validateHolidays({2026: {off: 'not-an-array'}}), null);
	});

	check('T5: a date outside its year key is dropped, and never counts toward the floor', () => {
		const fiveInYear = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
		assert.deepEqual(hol.validateHolidays({2026: {off: [...fiveInYear, '2027-01-01', 42, 'nope']}}), {2026: 5},
			'the three junk rows are dropped and the five real ones pass the floor');
		assert.equal(hol.validateHolidays({2026: {off: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2027-01-01']}}), null,
			'with one of five being out-of-year, only four count — under the floor');
	});

	check('T5: applyHolidays writes atomically and reports the pinned line', () => {
		const dir = mkdtempSync(join(tmpdir(), 'proflow-hol-'));
		const out = join(dir, 'nested', 'holidays-cn.json');
		const line = hol.applyHolidays(out, NAT_RAW);
		assert.equal(line, `holidays: wrote 7 days for 2026 → ${out}`);
		assert.equal(JSON.parse(readFileSync(out, 'utf8'))['2026'].off.length, 7);
		assert.ok(readFileSync(out, 'utf8').endsWith('\n'), 'the file ends with a newline');
	});

	check('T5: a refused calendar leaves the previous file byte-identical (spec row 21)', () => {
		const dir = mkdtempSync(join(tmpdir(), 'proflow-hol-'));
		const out = join(dir, 'holidays-cn.json');
		hol.applyHolidays(out, NAT_RAW);
		const before = readFileSync(out, 'utf8');
		assert.equal(hol.applyHolidays(out, {2026: {off: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']}}), null, 'refused');
		assert.equal(readFileSync(out, 'utf8'), before, 'untouched');
		assert.equal(existsSync(`${out}.${process.pid}.tmp`), false, 'no temp file left behind');
	});

	check('T9: the verified notice expands to the year the spec assumes', () => {
		const table = hol.expandRanges(hol.NOTICE.ranges);
		assert.deepEqual(Object.keys(table), ['2026']);
		const off = table['2026'].off;
		assert.equal(off.length, 33, '3+9+3+5+3+3+7');
		assert.equal(off[0], '2026-01-01');
		assert.equal(off.at(-1), '2026-10-07');
		for (const day of ['2026-10-01', '2026-10-03', '2026-10-05', '2026-10-07']) {
			assert.ok(off.includes(day), day + ' must be off-peak');
		}
		for (const day of ['2026-10-10', '2026-09-20', '2026-01-04', '2026-05-09']) {
			assert.ok(!off.includes(day), day + ' is a make-up working day and must not be listed');
		}
		assert.equal(hol.NOTICE.id, 'Guo Ban Fa Ming Dian [2025] No. 7');
		assert.match(hol.NOTICE.verified, /^\d{4}-\d{2}-\d{2}$/);
	});

	check('T9: the notice prices the spec worked example as off-peak', () => {
		const cal = mod.calendarFrom(hol.expandRanges(hol.NOTICE.ranges));
		assert.equal(mod.isOffPeak(at('2026-10-05T02:00:00Z'), W, cal), true, 'a holiday weekday inside a peak window');
		assert.equal(mod.nextChange(at('2026-10-05T02:00:00Z'), W, cal), 71 * H, 'the worked example');
		assert.equal(mod.nextChange(at('2026-10-03T15:27:00Z'), W, cal), 105 * H + 33 * 60 * 1000, 'row 3');
	});

} catch (error) {
	failed = true;
	console.error(`  \u001b[31m✗\u001b[0m ${error.message}`);
}
console.log(`\n${failed ? '\u001b[31m✗ failed' : '\u001b[32m✓ passed'}\u001b[0m — ${checks.length} check(s)`);
process.exit(failed ? 1 : 0);
