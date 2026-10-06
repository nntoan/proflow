#!/usr/bin/env node
// Writes the Chinese public holidays to ~/.commandcode/holidays-cn.json.
//
// The source is deliberately NOT wired: spec Open Q1 requires the State Council's official
// endpoint to be identified and recorded here with its verification date, and guessing a URL
// is forbidden. Until then this exits 0 with the pinned skip line, which is what the
// installer's best-effort step and /proflow --refresh-holidays both report.
//
// Shape: {"YYYY": {"off": ["YYYY-MM-DD", …]}} — the off dates only. A 调休 make-up working day
// is never represented: the weekend rule stands regardless, so the list carries no "work" side.
import {mkdirSync, realpathSync, renameSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const SHAPE = '{"YYYY": {"off": ["YYYY-MM-DD", …]}}';

/**
 * The verified notice. Read on 2026-10-06 from a gov.cn-hosted copy of Guo Ban Fa Ming Dian
 * [2025] No. 7 — every weekday label in it checks out against the real calendar, which is why the
 * dates are trusted. The 调休 make-up days it names are deliberately absent: the weekend rule
 * stands regardless, so they cannot cancel a weekend.
 *
 * Data rather than a live parse, because the notice is prose in Chinese and a mis-parse would
 * silently become a wrong calendar. The annual chore is to read the new notice and update this.
 */
export const NOTICE = {
	id: 'Guo Ban Fa Ming Dian [2025] No. 7',
	publisher: 'General Office of the State Council',
	url: 'https://en.bjhd.gov.cn/workinginhaidian/supportingservices/publicholidays/202512/t20251211_4797062.shtml',
	verified: '2026-10-06',
	ranges: {
		2026: [
			['2026-01-01', '2026-01-03'],
			['2026-02-15', '2026-02-23'],
			['2026-04-04', '2026-04-06'],
			['2026-05-01', '2026-05-05'],
			['2026-06-19', '2026-06-21'],
			['2026-09-25', '2026-09-27'],
			['2026-10-01', '2026-10-07'],
		],
	},
};

/** Inclusive ranges → the calendar shape the resolver reads. */
export function expandRanges(ranges) {
	const out = {};
	for (const [year, spans] of Object.entries(ranges)) {
		const off = [];
		for (const [from, to] of spans) {
			for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86400000) {
				off.push(new Date(t).toISOString().slice(0, 10));
			}
		}
		out[year] = {off};
	}
	return out;
}
export const MIN_DATES_PER_YEAR = 5;

export function defaultOut(home = homedir()) {
	return join(home, '.commandcode', 'holidays-cn.json');
}

/** Accepted year → date count, or null when the calendar is unusable. */
export function validateHolidays(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const counts = {};
	for (const [year, entry] of Object.entries(raw)) {
		if (!/^\d{4}$/.test(year)) continue;
		const dates = (entry ?? {}).off;
		if (!Array.isArray(dates)) continue;
		const good = dates.filter(
			date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && date.startsWith(year),
		);
		if (good.length >= MIN_DATES_PER_YEAR) counts[year] = good.length;
	}
	return Object.keys(counts).length > 0 ? counts : null;
}

/** Temp-then-rename, so a killed run cannot leave a partial file behind. */
export function writeHolidays(path, raw) {
	mkdirSync(dirname(path), {recursive: true});
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(raw, null, '\t')}\n`);
	renameSync(temp, path);
}

/**
 * Validate, then write. Returns the pinned line, or null when the input is refused — in which
 * case nothing is written and whatever was there is left byte-identical.
 */
export function applyHolidays(path, raw) {
	const counts = validateHolidays(raw);
	if (!counts) return null;
	writeHolidays(path, raw);
	const parts = Object.keys(counts)
		.sort()
		.map(year => `${counts[year]} days for ${year}`);
	return `holidays: wrote ${parts.join(', ')} → ${path}`;
}

function main(argv) {
	const i = argv.indexOf('--out');
	const out = i === -1 ? defaultOut() : argv[i + 1];
	if (!out) {
		console.log('holidays: skipped — --out needs a path');
		process.exit(0);
	}
	const line = applyHolidays(out, expandRanges(NOTICE.ranges));
	console.log(line ?? `holidays: skipped — the table failed validation (${SHAPE})`);
	process.exit(0);
}

// Both sides resolved: on macOS a temp path reaches /var/... while import.meta.url resolves
// to /private/var/..., and comparing them raw silently means "not invoked" — the script then
// does nothing at all, which is exactly what the installer's empty capture looked like.
function invokedDirectly() {
	try {
		return Boolean(process.argv[1]) && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
	} catch {
		return false;
	}
}

if (invokedDirectly()) main(process.argv.slice(2));
