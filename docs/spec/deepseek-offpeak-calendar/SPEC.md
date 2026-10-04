# Spec: DeepSeek off-peak calendar — weekends and Chinese holidays

## Objective

The footer's DeepSeek cost-window indicator decides peak/off-peak from `deepseek-window`
alone — a set of **peak** windows in UTC. It therefore reports **PEAK** on days DeepSeek
bills as off-peak: weekends and Chinese public holidays.

**Reproducing it, exactly:** with `--mod-option deepseek-window=00:30-16:30` (DeepSeek's
real peak window), at 2026-10-03T15:27Z — Saturday, inside the National Day golden week —
the row reads `PEAK — off-peak in …`. The same command line after this change reads
`off-peak (−50%) — peak in 96:33:00`.

**Who it is for:** anyone pricing turns in the footer, who uses that line to decide
whether to spend now or wait.

### Acceptance criteria

1. **Off-peak**, at an instant `t`, is true when **either**:
   - `t` is outside every peak window in `deepseek-window` (peak windows are unchanged in
     meaning and default: `01:00-04:00,06:00-10:00`), **or**
   - the Asia/Shanghai calendar date of `t` is a Saturday, a Sunday, or a Chinese public
     holiday — **all day**, spanning `[D−1 16:00Z, D 16:00Z)` for CN date `D`.
   Otherwise the state is peerless: **peak**.
2. **Any weekend is off-peak, always.** An official 调休 make-up working day does *not*
   cancel a weekend, so the calendar holds only "off" dates — no "work" list — and a
   make-up Saturday is simply absent from it. (The case is therefore tested as "this
   date is absent from the calendar; the row still says off-peak".)
3. `deepseek-window` keeps its meaning (**peak** windows, UTC, default
   `01:00-04:00,06:00-10:00`). No existing install's configuration changes meaning.
4. **The countdown is the exact delay to the next state change, formatted
   `H:MM:SS`**, computed from the real calendar — never from the next window boundary
   alone. It is a duration, so it is identical for readers in every timezone.
   - now = 2026-10-03T15:27:00Z, holiday through 10-07 → next peak
     2026-10-07T16:00:00Z → **`96:33:00`**
   - same instant, holiday through 10-04 → next peak 2026-10-04T16:00:00Z → **`24:33:00`**
   - zero-second and 100-hour cases are pinned in the table.
5. **The calendar is generated at install time and refreshable on demand.**
   `holidays.mjs` is copied into the scope (`<scope>/scripts/holidays.mjs`, the installer
   gains an explicit step: the payload step filters by extension) and writes
   `<scope>/.commandcode/holidays-cn.json`. `/proflow --refresh-holidays` spawns that
   script with a **bounded timeout** (5 s) and prints its outcome. The script owns the
   network access; **the mod never opens a socket**.
6. **Validation and atomicity before writing:** the parsed result must name the year, hold
   a plausible number of dates, all `YYYY-MM-DD` and inside that year. The file is written
   temp-then-rename. On any failure — unreachable source, unparseable page, failed
   validation, timeout — the previous file is left untouched and the note says so, which
   also means an install never fails over this.
7. **Degradation, explicitly:** with no calendar (never fetched, unreadable, malformed) the
   resolver behaves exactly as 0.1.8 — window-only — and claims no off-peak day it cannot
   substantiate. **There is no shipped fallback file**; the installed calendar is the only
   source, and `--no-holidays` / `PROFLOW_HOLIDAYS=off` disables the fetch so the test
   suite never touches the network.
8. The row carries **no reason label** — only the state and the duration change. The row's
   wording is otherwise as in 0.1.8.
9. `deepseek-holidays` is **retired**: it is registered, documented in `docs/mod.md` and
   asserted by the suite today, yet nothing reads it, and "extra peak dates" is the
   opposite concept. `docs/mod.md` is corrected (its default and its "Mon–Fri" claim are
   both wrong).
10. The guard, footer layout, next-step rows and rates behaviour are untouched.

## Tech stack

Node ≥ 22.13 (per the repo's `engines`). TypeScript mods loaded by the harness, ESM
`install.mjs` for the CLI, zero runtime dependencies in the mod. Fetching lives in the
CLI-provided script, never inside the mod.

## Commands

```bash
npm test                                                      # all suites (test/run.mjs)
node test/smoke.mjs                                           # the mod suite alone
node packages/cli/scripts/holidays.mjs                        # fetch → <scope>/.commandcode/holidays-cn.json
node packages/cli/scripts/install.mjs install --yes --no-holidays --project /tmp/x
npm run proflow:install -- --global
# in the harness:
/proflow --refresh-holidays                                   # spawn the script, print the outcome
```

## Project structure

```
packages/proflow/mods/proflow.ts           the resolver, the formatter, the row (pure, exported)
packages/cli/scripts/holidays.mjs          fetch + validate + atomic write; source and its verification date recorded in-file
packages/cli/scripts/install.mjs           copies the script into <scope>/scripts/, runs one fetch, best effort, dry-run skipped
packages/proflow/proflow.schema.json       holidaysCn override (paths, shape and precedence stated below)
test/smoke.mjs                             resolver, formatter and row cases
docs/mod.md                                flag table corrected; deepseek-holidays removed
docs/spec/deepseek-offpeak-calendar/       this spec
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

- Pure and clock-injected: `now` is a parameter, never `Date.now()` inside the resolver, so
  every table case is deterministic. Whole-second arithmetic (the current row truncates to
  minutes, which would fumble a `H:MM:SS` countdown by up to 59 s).
- `cnDate` is the *only* place the China timezone enters; `isCnWeekend` derives from it.
- Peak-window semantics are preserved: the flag lists peak windows, outside them is
  off-peak, and weekends/holidays are off-peak all day regardless.
- Replaces `nextFlip`; `formatMinutes` is replaced by `formatDuration(ms) → 'H:MM:SS'`
  (pinned for 0 s, 59 s, and > 100 h). Existing assertions on both — `test/smoke.mjs`
  (`formatMinutes(134) === '2h 14m'`, and the row match that uses it) — are updated with
  them.
- Calendar cached once per process and invalidated by `--refresh-holidays`, the same shape
  as the rates table.
- Tabs, single quotes, named exports; comments only where the reason is not obvious.

## Testing strategy

`test/smoke.mjs`, every row pinned to a string, every case naming its date and calendar.
Installer/fetch cases set `PROFLOW_HOLIDAYS=off` or `--no-holidays` unless the case is
about fetching, so the suite never calls out.

| # | Case | Expect |
|---|---|---|
| 1 | Sat 2026-10-03T15:27Z, holiday to 10-07, peak window 00:30–16:30 | off-peak, `peak in 96:33:00` |
| 2 | same, holiday to 10-04 | off-peak, `peak in 24:33:00` |
| 3 | Sat 2026-10-03T03:00Z, outside the peak window | off-peak |
| 4 | Sat 2026-10-10T08:00Z, plain Saturday, inside the peak window | off-peak (weekend beats the window) |
| 5 | 调休 Saturday 2026-10-10 absent from the calendar | still off-peak (criterion 2) |
| 6 | Wed 2026-10-14T08:00Z, inside a peak window | peak |
| 7 | Wed 2026-10-14T17:00Z, outside it | off-peak |
| 8 | Fri 2026-10-09T23:00Z (CN is Saturday) | off-peak; next peak 2026-10-12T00:30Z |
| 9 | 2026-10-07T16:00Z — the instant the CN holiday day ends | state per criterion 1; next peak pinned |
| 10 | 2026-10-07T15:59:59Z vs 16:00:00Z vs 16:00:01Z | seconds boundary pinned |
| 11 | 2026-10-03T15:27:40Z | sub-minute: `96:32:20`, not `96:32:00` |
| 12 | 2026-12-31T16:30Z with a 2026-only calendar | off-peak (window); CN 2027-01-01 is unknown → no false PEAK claim |
| 13 | empty calendar | window-only, identical to 0.1.8 for every row above that is not weekend/holiday |
| 14 | malformed installed calendar (truncated JSON) | window-only, no crash, no claim |
| 15 | `holidaysCn` override in `proflow.jsonc` | replaced dates win; shape and precedence as documented |
| 16 | formatter: 0 s, 59 s, 359999 s, > 100 h | `00:00:00`, `00:00:59`, `99:59:59`, `100:00:00` |
| 17 | fetch script with the source unreachable | exits 0 with the note; existing file byte-identical |
| 18 | fetch script with a 200 whose shape changed | validation refuses; existing file byte-identical |
| 19 | installer with `--dry-run` / `--no-holidays` | no fetch, no write, step printed |
| 20 | uninstall | removes the calendar it installed |

## Boundaries

- **Always:** keep the resolver pure, offline, clock-injected and second-accurate; keep
  peak-window semantics unchanged; degrade to window-only; validate and write atomically;
  bound every spawn with a timeout; keep the installer's step best-effort; run `npm test`
  before a commit; record the fetch source and the date it was verified inside
  `holidays.mjs`.
- **Ask first:** changing the fetch source or its parse rules; adding any dependency to the
  fetch path; changing the row's wording beyond state + duration; replacing or retiring any
  other flag; touching the guard, footer layout or rates logic.
- **Never:** hardcode holiday dates in the resolver; let the mod touch the network; write
  the calendar into a scope other than the one the install targeted; produce an off-peak
  claim from a calendar that failed to load; fail or hang an install over the fetch; guess
  a source URL; leave a partial file behind; write anything under `docs/spec/` other than
  `SPEC.md`.

## Success criteria

- With `--mod-option deepseek-window=00:30-16:30`, the live case flips from PEAK to
  `off-peak (−50%) — peak in 96:33:00` on Saturday 2026-10-03.
- Every weekday evaluates exactly as 0.1.8 did.
- A weekend or holiday resolves off-peak regardless of the peak windows.
- Install on a machine that cannot reach the source leaves the previous calendar intact and
  installs anyway; with no calendar at all, the row matches 0.1.8.
- All suites green, offline, with the table above as the test list.

## Decisions log (one per review finding)

| Finding | Decision |
|---|---|
| Flag polarity contradiction (Critical) | Flag keeps meaning **peak** windows; pseudocode and examples recomputed (criterion 3) |
| Live case not reproducible (Critical) | Spec states the exact `--mod-option` line (Objective) |
| Both countdowns wrong (Critical) | Replaced with **96:33:00** / **24:33:00** on the CN-day boundary; working shown (criterion 4) |
| Fallback cannot reach the runtime (Critical) | Fallback **removed**; the calendar is generated into the scope and the resolver degrades (criterion 7) |
| `--refresh-holidays` has no mechanism (Critical) | Installer copies the script into `<scope>/scripts/`; the command spawns it with a 5 s timeout (criterion 5) |
| No fetch timeout (High) | Bounded wait, note printed (criterion 5) |
| No validation; overwrite on bad parse (High) | Validate + temp-then-rename; keep the previous file (criterion 6) |
| Project installs write to `$HOME`; tests fetch (High) | The calendar is written to the **target scope**; `--no-holidays` / `PROFLOW_HOLIDAYS=off` for tests (criteria 5, 7) |
| Calendar cache invalidation unstated (High) | Cached per process, invalidated by the refresh (Code style) |
| 调休 case not expressible (High) | Restated as "absent from the calendar" (criterion 2, case 5) |
| Unpinned table rows (Medium) | Every row pinned to a string (Testing) |
| Dates missing from cases (Medium) | Every case dated and given a calendar (Testing) |
| Sub-minute handling unpinned (Medium) | Whole-second arithmetic; cases 10–11 |
| `nextFlip`/`formatMinutes` fate unstated (Medium) | Replaced; affected assertions named (Code style) |
| "All day" undefined against UTC (Medium) | `[D−1 16:00Z, D 16:00Z)`; boundary cases 9–10 |
| Year-boundary false PEAK (Medium) | Unknown future year resolves window-only, never a false PEAK claim (case 12) |
| Malformed installed file uncovered (Medium) | Case 14 |
| `holidaysCn` paths/shape/precedence (Medium) | Documented in the schema section before implementation |
| `deepseek-holidays` duplicated (Medium) | Retired, with `docs/mod.md` corrected (criterion 9) |
| `Node ≥ 24` wrong (Low) | `≥ 22.13` |
| Formatter edge cases (Low) | Case 16 |
| Coverage / date enumeration (Low) | Moot: no shipped table; the fetch's year is what exists |

## Open questions

1. **The exact fetch source and shape.** The publisher is known — the State Council's
   annual holiday notice on `gov.cn` — but the path changes yearly and I will not guess a
   URL. Implementation step: identify the official endpoint, record it with the
   verification date inside `holidays.mjs`, and parse only what the notice states. Until
   then the fetch is best-effort and an un-fetched machine runs window-only.
2. **`holidaysCn` override shape** — `{year: {off: [dates]}}` reusing the file's shape, at
   the same two locations the config layers already use (project then home, later wins).
   Confirm before implementation; the schema sets `additionalProperties: false` at the root.
