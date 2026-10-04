# Spec: DeepSeek off-peak calendar — weekends and Chinese holidays

## Objective

The footer's DeepSeek cost-window indicator decides peak/off-peak from `deepseek-window`
alone — **peak** windows in UTC (default `01:00-04:00,06:00-10:00`, i.e. 9am–12pm and
2–6pm China time). It therefore reports **PEAK** on days DeepSeek bills as off-peak:
weekends and Chinese public holidays.

**The worked example** — a moment that is peak today and off-peak after:

```
moment   Mon 2026-10-05T02:00:00Z = CN Mon 10:00
         inside a peak window (01:00-04:00 UTC = 9am-12pm CN)
         and inside National Day (10-01…10-07)

today    PEAK — off-peak in 2h 00m        the window ends at 12pm CN
after    off-peak (−50%) — peak in 71:00:00
         next peak Thu 2026-10-08 09:00 CN  (the first window after the holiday)
```

**Premise, and its provenance.** That weekends and Chinese public holidays are billed
off-peak all day is the reporter's account of DeepSeek's policy — it is the reason this
feature exists, and it is **not yet verified against a published source**. The plan phase
identifies the citation and records it in `docs/mod.md`; until then the spec states the rule
on that authority and nothing here should be quoted as DeepSeek's own wording.

**Who it is for:** anyone pricing turns in the footer, who uses that line to decide whether
to spend now or wait.

### Acceptance criteria

1. **Off-peak** at an instant `t` is true when **either**: `t` lies outside every peak
   window in `deepseek-window`; **or** the Asia/Shanghai calendar date of `t` is a Saturday, a
   Sunday, or a Chinese public holiday — all day, spanning `[D−1 16:00Z, D 16:00Z)` for CN
   date `D`. Otherwise the state is **peak**.
2. **Any weekend is off-peak, always.** A 调休 make-up working day does not cancel a weekend,
   so the calendar carries only "off" dates and a make-up Saturday is simply absent from it.
3. `deepseek-window` keeps its meaning and default (peak windows, UTC). **This spec fixes its
   registry description** to `'Peak windows in UTC, comma-separated (weekends and CN holidays
   are off-peak all day)'`; `test/smoke.mjs`'s mock records `options.description` and asserts
   it, so the flag's help cannot drift from the spec.
4. **Countdown** = the exact delay to the next state change, `H:MM:SS`, from the real calendar
   — never from the next window boundary. With the default window:
   - 2026-10-05T02:00:00Z, holiday to 10-07 → next peak 2026-10-08T01:00:00Z → **`71:00:00`**
   - 2026-10-03T15:27:00Z, holiday to 10-07 → next peak 2026-10-08T01:00:00Z → **`105:33:00`**
5. **One machine-local calendar: `$HOME/.commandcode/holidays-cn.json`** — a property of the
   machine and of DeepSeek's policy, not of a project, so the installer writes it there for
   every scope, deliberately. `PROFLOW_HOLIDAYS=off` / `--no-holidays` skips the fetch.
6. **The fetch script ships and is spawned best-effort — unverified.** The installer copies
   `packages/cli/scripts/holidays.mjs` to `$HOME/.commandcode/scripts/holidays.mjs`.
   `/proflow --refresh-holidays` spawns that literal path with a **5 s timeout** and prints
   exactly one pinned line: on success the script's own
   `holidays: wrote <N> days for <Y1>, <Y2> → <path>`; on timeout `holidays: timed out`; on a
   non-zero exit `holidays: failed (<status>)`. No checksum is kept: the home directory is the
   user's own scope and the mod cannot protect it from its owner. `/proflow`'s `argumentHint`
   becomes `'[--refresh-rates|--refresh-holidays]'`. **Accepted:** the timeout and failure
   lines are stated, not exercised — a stub cannot be substituted without a fetch seam, which
   is out of scope.
7. **Validation, shape and atomicity.** The file is `{"YYYY": {"off": ["YYYY-MM-DD", …]}}`; the
   parse must name a year and hold **≥ 5 valid dates within that year, per year written**.
   Written temp-then-rename. On any failure the previous file is untouched and the installer
   prints the pinned `holidays: skipped — <reason>`; an install never fails or hangs over this.
   A year the notice does not source is **omitted**, never fatal to the other year. The fetch
   writes the current and next year when the notice covers them, to the path given by `--out`.
8. **Degradation.** With no calendar, only the *holiday* set is missing: weekends still apply
   because they come from the clock, so the state is **window ∪ weekend**. A CN date in a year
   the file does not cover resolves **window ∪ weekend too** — never assumed to be a holiday,
   never stripped of its weekend rule.
9. **The row keeps its labels**, and `deepseek-holidays` stays registered but is inert: the
   registry description becomes `'Ignored — off-peak days come from ~/.commandcode/holidays-cn.json'`,
   and a **non-empty** value surfaces once, in the `/proflow` status message, with this pinned
   literal (the default empty value stays silent):

   ```
   deepseek-holidays: <value>
     ignored — off-peak days come from ~/.commandcode/holidays-cn.json
     refresh with /proflow --refresh-holidays
   ```

   The existing registration assertion is kept; a **new** assertion pins the description and
   the message. `docs/mod.md` is corrected to match.
10. **PEAK must be visibly different from off-peak.** Off-peak keeps green (`\u001b[32m`); peak
    is **red** (`\u001b[31m`), not the yellow it uses today. `test/smoke.mjs`'s row regex changes
    from `32|33` to `31|32`; rows 2 and 8 pin red, rows 1 and 9 pin green.
11. The guard, footer layout, the countdown's position in the row, and rates behaviour are
    untouched.

## Tech stack

Node ≥ 22.13 (repo `engines`). TypeScript mods loaded by the harness, ESM `install.mjs` for
the CLI, zero runtime dependencies in the mod. The fetch lives in the shipped script; the mod
spawns it and never opens a socket itself.

## Commands

```bash
npm test                                                    # all suites (test/run.mjs)
node test/smoke.mjs                                         # the mod suite alone
node packages/cli/scripts/install.mjs install --yes --no-holidays --project /tmp/x
PROFLOW_HOLIDAYS=off npm run proflow:install -- --global
# in the harness:
/proflow --refresh-holidays                                 # 5 s timeout, best effort
```

## Project structure

```
packages/proflow/mods/proflow.ts        resolver + formatter + row + colours (pure, exported)
packages/cli/scripts/holidays.mjs       fetch + validate + atomic write; source and verification date in-file
packages/cli/scripts/install.mjs        copies the script, runs one fetch, best effort
packages/proflow/proflow.schema.json    holidaysCn override (paths and precedence per Open Q2)
test/smoke.mjs                          resolver, formatter, row, colour, flag cases
test/install.mjs                        script copy, HOME isolation, uninstall scope
docs/mod.md                             flag table corrected; deepseek-holidays marked inert; policy citation recorded
docs/spec/deepseek-offpeak-calendar/    this spec (+ review-log.md, local)
```

## Code style

```ts
// Peak windows come from the flag; the China calendar decides whole days. They meet here.
export function windowState(now: Date, windows: Window[], calendar: CnCalendar): WindowState {
	const cnDate = cnDateOf(now);                                    // 'YYYY-MM-DD', Asia/Shanghai
	const offAllDay = calendar.off.has(cnDate) || isCnWeekend(cnDate);
	const offPeak = offAllDay || !minutesInPeak(now, windows);
	const until = offPeak ? nextPeak(now, windows, calendar)
	                      : nextOffPeak(now, windows, calendar);
	return {offPeak, until};                                          // until = ms to the change
}
```

- Pure, clock-injected (`now` is a parameter), whole-second arithmetic — today's row truncates
  to minutes, which would fumble an `H:MM:SS` countdown by up to 59 s.
- `cnDate` is the only place the China timezone enters; `isCnWeekend` derives from it — which is
  why weekends survive a missing calendar and holidays do not.
- Replaces `nextFlip`; `formatMinutes` becomes `formatDuration(ms) → 'H:MM:SS'`, and the
  existing assertions on both (`formatMinutes(134) === '2h 14m'` and the row regex `32|33`) are
  updated with them.
- Calendar cached once per process, invalidated by the refresh, like the rates table.
- Tabs, single quotes, named exports; comments only where the reason is not obvious.

## Testing strategy

`test/smoke.mjs` unless stated. **Calendar assumed: CN National Day 2026, 10-01…10-07, unless a
row says otherwise.** Every row states its instant in both frames (UTC, and the China
date/time) and its window, unless it says "same as row N". Display rows pin their exact string
including the colour code. Installer cases run with **`HOME` pointed at a temporary
directory**; **no default case touches the network** — the rows marked *(network)* below are
skipped, and nothing else depends on the fetch.

Default window `01:00-04:00,06:00-10:00` (9am–12pm, 2–6pm China).

| # | Case | Expect |
|---|---|---|
| 1 | **The worked example**: 2026-10-05T02:00Z = CN Mon 10:00, in-window, holiday | off-peak `\u001b[32m`, `peak in 71:00:00` |
| 2 | 2026-10-05T02:00Z with no calendar at all | peak `\u001b[31m`, `off-peak in 02:00:00` |
| 3 | 2026-10-03T15:27Z = CN Sat 23:27, holiday to 10-07 | off-peak, `peak in 105:33:00` |
| 4 | same instant, holiday to 10-04 only | off-peak, `peak in 33:33:00` |
| 5 | 2026-10-03T03:00Z = CN Sat 11:00, in-window, holiday | off-peak, `peak in 118:00:00` |
| 6 | 2026-10-10T08:00Z = CN Sat 16:00, in-window, no holiday | off-peak, `peak in 41:00:00` |
| 7 | 2026-10-10 called a 调休 working day, absent from the calendar | as row 6 — the weekend rule wins |
| 8 | 2026-10-14T08:00Z = CN Wed 16:00, in-window | peak `\u001b[31m`, `off-peak in 02:00:00` |
| 9 | 2026-10-14T17:00Z = CN Thu 01:00 | off-peak `\u001b[32m`, `peak in 08:00:00` |
| 10 | 2026-10-09T23:00Z = CN Sat 07:00, no holiday | off-peak, `peak in 50:00:00` |
| 11 | 2026-10-07T16:00Z (holiday day ends) = CN Thu 00:00 | off-peak, `peak in 09:00:00` |
| 12 | 2026-10-08T00:59:59Z / 01:00:00Z / 01:00:01Z | `peak in 00:00:01` / `off-peak in 03:00:00` / `off-peak in 02:59:59` |
| 13 | 2026-10-03T15:27:40Z | off-peak, `peak in 105:32:20` |
| 14 | **CN-day boundary**, window `06:00-10:00,20:00-22:00`: 2026-10-07T20:00Z = CN Thu 10-08 04:00 | peak, `off-peak in 02:00:00` — a UTC-day model would still call this a holiday |
| 15 | 2027-01-01T02:00Z = CN New Year 10:00, 2026-only calendar, in-window | peak, `off-peak in 02:00:00` — the false PEAK the row exposes |
| 16 | 2027-01-02T02:00Z = CN Sat 10:00, in-window, 2026-only calendar | off-peak, `peak in 47:00:00` (next window Mon 2027-01-04T01:00Z) |
| 17 | empty calendar: 2026-10-10T08:00Z, then 2026-10-14T08:00Z | off-peak `peak in 41:00:00`; then peak `off-peak in 02:00:00` — window ∪ weekend |
| 18 | malformed installed calendar (truncated JSON), same two instants | identical to row 17, no crash |
| 19 | `holidaysCn` override: home calendar 10-01…10-04 only, project config lists `2026-10-05`; 2026-10-05T02:00Z | off-peak, `peak in 71:00:00` — the project override adds the day |
| 20 | formatter: 0 s, 59 s, 359999 s, 360000 s | `00:00:00`, `00:00:59`, `99:59:59`, `100:00:00` |
| 21 | flag: a non-empty `deepseek-holidays` value (test/install.mjs or smoke) | the `/proflow` status carries the pinned rejection literal; the description matches criterion 9; the registry still lists the flag |
| 22 | validation floor (test/install.mjs, offline): a fixture with **4** dates for a year | refused; the previous file byte-identical |
| 23 | `--project` install, isolated `HOME`, `--no-holidays` (test/install.mjs) | the script lands in that `HOME`; **no** JSON is written; exit 0; the resolver falls back to window ∪ weekend |
| 24 | `PROFLOW_HOLIDAYS=off` and `--dry-run` (test/install.mjs) | no fetch; the step prints its pinned `holidays: skipped — <reason>` line |
| 25 | uninstall (test/install.mjs) | removes the home calendar and script **only** when the manifest's scope is `global` |
| 26 *(network)* | fetch from the real source, current + next year | skipped by default; the JSON round-trip through an isolated `HOME` |

## Boundaries

- **Always:** keep the resolver pure, offline, clock-injected, second-accurate; keep
  peak-window semantics and the default unchanged; degrade per criterion 8; validate and write
  atomically; bound the spawn with a timeout; keep the install step best-effort; run `npm test`
  before a commit; record the fetch source and its verification date in `holidays.mjs`.
- **Ask first:** changing the fetch source or parse rules; adding a dependency to the fetch
  path; changing the row beyond labels and the peak colour; replacing or retiring another flag;
  touching the guard, footer layout or rates logic.
- **Never:** hardcode holiday dates in the resolver; open a socket from the mod; execute a
  script that came from a **project** scope; produce an off-peak claim from a calendar that
  failed to load; assume an unknown year is a holiday; fail or hang an install over the fetch;
  guess a source URL; leave a partial file behind; commit anything under `docs/spec/` except
  `SPEC.md` (its siblings stay local).

## Success criteria

- The worked example reproduces `PEAK — off-peak in 2h 00m` before and
  `off-peak (−50%) — peak in 71:00:00` after.
- Every **non-holiday** weekday evaluates as 0.1.8 did; weekends and holidays resolve off-peak
  regardless of the peak windows.
- PEAK renders red and off-peak green, pinned by rows 2, 8 (red) and 1, 9 (green).
- A machine with no calendar still treats weekends as off-peak; an unknown year never claims a
  holiday.
- All default suites green **offline**, with the table above as the test list.

## Decisions log

| Round | Finding | Decision |
|---|---|---|
| 1 | Polarity; live case; countdowns; fallback; refresh (🔴×5) | Peak windows kept; example stated; CN-day boundary; fallback removed; script shipped |
| 1 | Timeout; validation; paths; cache; 调休 (🟡) | 5 s bound; validate + temp-then-rename; home-only; invalidated; "absent from the calendar" |
| 2 | Row 8's shortcut; rows 9–10 unpinned; "exactly 0.1.8"; year rule; paths (🔴×5) | Corrected; pinned; scoped; normative; home literal |
| 2 | Spawn/network; `scripts/` ownership; precedence; dual-use env; window; target year (🟡) | Corrected; manifest records, uninstall scopes; switch only; named; current + next |
| 3 | Row 6's countdown; row 20's real home; the unenforceable checksum; "every weekday" (🔴) | Fixed — then the window correction below |
| **3** | **The table used a window I assumed (`00:30–16:30`), not the shipped default** | **Recomputed on `01:00-04:00,06:00-10:00`; the user caught this** |
| 3 | Colours unpinned; floor; messages; uninstall scope; shape; "retired" (🟡) | Pinned; floored per year; refusal tested; global-only; shape stated; registered-but-rejecting |
| 4 | The example's "before" false again (🔴) | Replaced with the in-window holiday weekday 2026-10-05T02:00Z |
| 4 | No in-window holiday row; undeclared calendar (🔴×2) | Rows 1/2/14 added; the table declares National Day |
| 4 | The checksum was unenforceable (🔴) | **Guarantee dropped** — spawned best-effort, unverified |
| 4 | The fetch had no seam (🔴) | **Seam dropped** — those rows skipped and marked |
| 4 | Unknown-year wording; floor unexercised; colours in prose; "text"; `--no-holidays` (🟡) | Window ∪ weekend; a 4-date fixture; codes spelled; "labels"; the step line |
| 5 | Row 22 promised a fetched JSON in an offline suite (🔴) | **Split**: 23 asserts the offline half; 26 carries the round-trip, marked *(network)* |
| 5 | Criterion 10 cited the wrong rows (🟡) | Rows 2/8 red, 1/9 green |
| 5 | Flag rejection had no literal, trigger or surface; the assertion unexecutable (🟡) | Pinned literal, non-empty trigger, `/proflow` status; new assertion; mock records descriptions |
| 5 | Criterion 3's description unobservable (🟡) | The mock records `options.description` and asserts it |
| 5 | Row 19 unpinned and pending Q2 (🟡) | Pinned: home omits 10-05, the override adds it |
| 5 | Three install-side outputs had no literals (🟡) | `holidays: wrote …`, `holidays: skipped — <reason>`, row 24 |
| 5 | The premise had no citation (💡→handled) | Recorded as the reporter's account, citation to verify in the plan and in `docs/mod.md` |

## Open questions

1. **The exact fetch source and shape.** Publisher known — the State Council's annual notice on
   `gov.cn` — but the path changes yearly and I will not guess a URL. Identify the endpoint,
   record it with the verification date in `holidays.mjs`, and parse only what the notice states.
   Until then the fetch is best-effort and an un-fetched machine runs window ∪ weekend.
2. **`holidaysCn` override shape** — `{year: {off: [dates]}}`, at the two config locations the
   code already layers (home, then project; **project wins**), with the schema's
   `additionalProperties: false` relaxed for it. Row 19 assumes this shape; confirm before
   implementation.
3. **The citation** for the off-peak policy (Objective), recorded in `docs/mod.md`.
4. **Residual risks accepted:** an unknown CN year resolves window ∪ weekend, so a holiday
   inside a peak window can read PEAK until the fetch succeeds; the spawned home script is
   unverified, so a user who edits it owns the result; and the timeout/failure lines are stated
   but untested.
