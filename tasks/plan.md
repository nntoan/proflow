# Implementation Plan: DeepSeek off-peak calendar

**Status:** approved (plan review) · **Spec:** `docs/spec/deepseek-offpeak-calendar/SPEC.md` (`8dc25b4`) · **Tasks:** `tasks/todo.md` · full approved text: `~/.commandcode/plans/deepseek-offpeak-calendar.md`

## Overview

Price weekends and Chinese public holidays as off-peak in the footer's DeepSeek cost
indicator. `deepseek-window`'s peak windows keep their meaning and default; the new rules add
"off all day" for a CN weekend or holiday on the China day `[D−1 16:00Z, D 16:00Z)`, a
countdown that lands on the next real state change, and PEAK in red against off-peak green. The
calendar is generated at install, refreshed by `/proflow --refresh-holidays`, read from
`$HOME/.commandcode/holidays-cn.json`; the mod never opens a socket.

## Architecture decisions

1. One pure, clock-injected `windowState(now, windows, calendar)` decides the state; the row
   renders it and never re-derives — which is what makes the 26-row table assertable.
2. `cnDateOf(now)` is the only place China time enters. Weekends come from the clock, holidays
   from the file, so a missing calendar degrades to window ∪ weekend and loses only holidays.
3. "All day" is the China day, not the UTC day: a Chinese holiday is off-peak from its first
   minute in China.
4. The calendar is machine-local and generated; the mod spawns the shipped script unverified
   (the home scope is the user's own), bounded by 5 s. The mod never fetches.
5. `deepseek-window` semantics and default are untouched; every countdown is computed against
   the shipped default `01:00-04:00,06:00-10:00`.

## Dependency graph

```
cnDateOf / isCnWeekend ─► windowState (window ∪ weekend) ─► + calendar loader ─► the row
                                                                   ▲
holidays.mjs (fetch · validate · atomic write) ─► installer step ──┘
                                               └─► /proflow --refresh-holidays
```

Bottom-up: resolver and row complete and tested before any fetching exists, because the
calendar is a parameter.

## Task list

### Phase 1 — Foundation (calendar-free)
- **T1 — CN primitives.** `cnDateOf` (UTC+8, no DST), `isCnWeekend`, exported.
  *Accept:* the 16:00Z boundary maps to the right CN date. *Verify:* `node test/smoke.mjs`.
  *Files:* `packages/proflow/mods/proflow.ts`, `test/smoke.mjs`. **S**
- **T2 — `windowState` + countdown search.** Replace `nextFlip`; window ∪ weekend only; forward
  search to the next real change. *Accept:* spec rows 2, 5, 6, 8, 9, 10, 12, 14, 17 pass.
  *Verify:* `npm test`. *Files:* mod, smoke. **M**

**Checkpoint A:** `npm test` green · no change beyond the weekend rule without a calendar ·
human review before the calendar lands.

### Phase 2 — Calendar input and the row
- **T3 — the calendar loader.** Home file → project `holidaysCn` (project wins), validated,
  cached per process, invalidated on refresh. *Accept:* rows 1, 3, 4, 11, 13, 15, 16, 19 pass;
  17/18 degrade. *Verify:* `npm test`. *Files:* mod, schema, smoke. **M**
- **T4 — `formatDuration` and the row.** `H:MM:SS`; PEAK red `\u001b[31m`, off-peak green
  `\u001b[32m`; regex `32|33` → `31|32`. *Accept:* rows 1/2/8/9 pin the codes; row 20 the
  formatter. *Verify:* `npm test`. *Files:* mod, smoke. **S**

**Checkpoint B:** the 26 rows pass except the network-marked one · `windowState` pure · row
matches the spec's worked example.

### Phase 3 — Calendar supply (CLI side)
- **T5 — `holidays.mjs`.** Fetch, validate (≥ 5 dates per year, within the year), atomic write,
  `--out`, pinned `<N> days for <Y1>, <Y2>`. Fixture first, source wired at T9.
  *Accept:* a 4-date fixture is refused, previous file byte-identical. *Verify:* the script with
  `--out`; `npm test`. *Files:* `packages/cli/scripts/holidays.mjs` (new), `test/install.mjs`. **M**
- **T6 — installer step.** Copy the script to `$HOME/.commandcode/scripts/`, best-effort fetch,
  `--no-holidays`/`PROFLOW_HOLIDAYS=off`, pinned skip line, manifest record.
  *Accept:* rows 23/24 pass offline. *Verify:* `npm test`. *Files:* `install.mjs`, `test/install.mjs`. **M**
- **T7 — `/proflow --refresh-holidays`.** 5 s bounded spawn, three pinned lines, extended
  `argumentHint`, the inert `deepseek-holidays` value surfaced once. *Accept:* row 21 passes.
  *Verify:* `npm test`. *Files:* mod, smoke. **M**
- **T8 — uninstall scope + docs.** Home removal only when the manifest's scope is `global`;
  `docs/mod.md` and `docs/install.md` corrected. *Accept:* a `--project` uninstall leaves both.
  *Verify:* `npm test`. **M**

**Checkpoint C:** all 26 rows pass (network one excepted) · a temp-project install with an
isolated `HOME` leaves the expected files · human review before the release.

### Phase 4 — Close
- **T9 — citation and source.** Answer Open Q1; record the endpoint with its verification date
  in `holidays.mjs`; record the policy citation in `docs/mod.md`. *Accept:* a live fetch into a
  temp `--out` succeeds. **S**
- **T10 — release.** Bump, notes, tag, push, verify on the remote (the 0.1.8/0.1.9 sequence).
  *Accept:* the published payload carries mod, script and docs. **S**

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| The fetch endpoint is unknown; the notice's shape changes yearly | High | T5 parses a fixture first; the mod never depends on the fetch |
| Countdown arithmetic is easy to get wrong — I did, three times | High | Every value is pinned in the spec table; keep it as the test list |
| CN-day boundary vs the UTC window is subtle | Med | Row 14 is the only distinguishing case; keep the `[D−1 16:00Z, D 16:00Z)` wording |
| The row emits per turn, so `H:MM:SS` can be stale | Med | Accept the granularity and document it, or revisit the emission point (Q5) |
| `holidaysCn`'s shape is unconfirmed and gates two tasks | Med | Answer Q2 before T3 |

## Open questions

1. The fetch endpoint (spec Q1) — gates T9; no guessed URL.
2. `holidaysCn` shape and locations (spec Q2) — gates T3 and T5.
3. The policy citation (spec Q3) — recorded in `docs/mod.md`.
4. Version bump — 0.2.0 for a feature, or 0.1.10 on the patch line.
5. Countdown granularity — accept the per-turn emission, or revisit it.

## Not in scope

The windows themselves and the `deepseek-window` default; any other cost surface (rates, the
session average, feed colours beyond PEAK); the `magento2-tour-guide` spec, which has no
approved SPEC.md yet.
