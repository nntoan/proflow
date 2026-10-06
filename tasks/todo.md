# Task list — DeepSeek off-peak calendar

**Spec:** `docs/spec/deepseek-offpeak-calendar/SPEC.md` (approved, committed `8dc25b4`)
**Plan:** `tasks/plan.md` · full approved text at `~/.commandcode/plans/deepseek-offpeak-calendar.md`
**Review log (local):** `docs/spec/deepseek-offpeak-calendar/review-log.md`

Verification for every task: `npm test` (7 suites) — plus the focused command named below.

## Phase 1 — Foundation (the resolver, calendar-free)

- [x] **T1 — CN calendar primitives.** (930ad14) `cnDateOf` (UTC+8, no DST) and `isCnWeekend`, exported.
      *Accept:* the 16:00Z boundary maps to the right CN date; 2026-10-03 → Sat, 2026-10-05 → Mon.
      *Verify:* `node test/smoke.mjs`. *Files:* mod, smoke. *Size:* S
- [x] **T2 — `windowState` + the countdown search.** (3c70975) Replace `nextFlip`; window ∪ weekend only.
      *Accept:* spec rows 2, 5, 6, 8, 9, 10, 12, 14, 17 pass under the default window.
      *Verify:* `npm test`. *Files:* mod, smoke. *Size:* M

### Checkpoint A
- [ ] `npm test` green; older window-only rows updated
- [ ] No behaviour change beyond the weekend rule without a calendar
- [ ] Human review before the calendar lands

## Phase 2 — Calendar input and the row

- [x] **T3 — the calendar loader.** Read the home file — the single source of truth, no override —
      shape-validated, cached per process, invalidated on refresh.
      *Accept:* rows 1, 3, 4, 11, 13, 15, 16, 19 pass; rows 17/18 degrade; rows 15/16 unchanged.
      *Verify:* `npm test`. *Files:* mod, smoke. *Size:* M
- [x] **T4 — `formatDuration` and the row.** `H:MM:SS`; PEAK red `\u001b[31m`, off-peak green
      `\u001b[32m`; the row regex `32|33` → `31|32`.
      *Accept:* rows 1/2/8/9 pin the codes; row 20 pins the formatter.
      *Verify:* `npm test`. *Files:* mod, smoke. *Size:* S

### Checkpoint B
- [ ] All 26 spec rows pass except the network-marked one
- [ ] `windowState` is pure — no clock reads inside it
- [ ] Human review: the row matches the spec's worked example

## Phase 3 — Calendar supply (the CLI side)

- [ ] **T5 — `holidays.mjs`.** Fetch, validate (≥ 5 dates per year, within the year), atomic
      write, `--out`, the pinned `<N> days for <Y1>, <Y2>` line. Parse a fixture first.
      *Accept:* a 4-date fixture is refused; the previous file byte-identical.
      *Verify:* the script with `--out /tmp/x.json`; `npm test`. *Files:* script, install test. *Size:* M
- [ ] **T6 — the installer step.** Copy the script to `$HOME/.commandcode/scripts/`,
      best-effort fetch, `--no-holidays`/`PROFLOW_HOLIDAYS=off`, the pinned skip line, manifest record.
      *Accept:* rows 23/24 pass offline. *Verify:* `npm test`. *Files:* install.mjs, install test. *Size:* M
- [ ] **T7 — `/proflow --refresh-holidays`.** Bounded 5 s spawn, three pinned lines, extended
      `argumentHint`, and the inert `deepseek-holidays` value surfaced once in the status message.
      *Accept:* row 21 passes. *Verify:* `npm test`. *Files:* mod, smoke. *Size:* M
- [ ] **T8 — uninstall scope + docs.** Home removal only when the manifest's scope is `global`;
      `docs/mod.md` and `docs/install.md` corrected.
      *Accept:* a `--project` uninstall leaves both files. *Verify:* `npm test`. *Size:* M

### Checkpoint C
- [ ] All 26 rows pass, connected except the network-marked one
- [ ] A temp-project install with an isolated `HOME` leaves the expected files
- [ ] Human review before the release

## Phase 4 — Close

- [ ] **T9 — the citation and the parse source.** Answer Open Q1; record the endpoint with its
      verification date in `holidays.mjs`; record the policy citation in `docs/mod.md`.
      *Accept:* a live fetch into a temp `--out` succeeds. *Files:* script, docs. *Size:* S
- [ ] **T10 — release.** Bump, notes, tag, push, verify on the remote.
      *Accept:* the published payload carries the mod, the script and the docs. *Size:* S

## Open questions blocking tasks

1. **Fetch endpoint** — gates T9; no guessed URL.
2. **Policy citation** — recorded in `docs/mod.md` (T9).
3. **Version bump** — 0.2.0 or 0.1.10 (T10).
4. **Countdown granularity** — the row emits per turn; accept it, or revisit (T4).

## Workflow fixes (from the `/build auto` review)

These are the fixes for the stops themselves — the stop rule, the missing resume state, the
unbounded reviewer, and the guard's misleading block message.

- [x] Bound `/build`'s stop rule (no invented gates, resource limits stated as such) — `patches/commands.mjs`
- [x] One checkpoint: plan review satisfies it — `patches/commands.mjs`
- [x] `tasks/todo.md` is the resume state; box-ticking rides the task's own commit — `patches/commands.mjs`
- [x] A plan may not invent gates; every task traces to the spec — `patches/agent-skills.mjs`
- [x] Bound the spec-reviewer's report (~800 words) — `overlays/skills/spec-reflection/SKILL.md`
- [ ] The guard's block message must name bypass mode and the remedy — `packages/proflow/mods/proflow.ts`
      *blocked:* its current wording must be read first; it is a mod string, not a vendored one
- [ ] Upstream request: the harness should warn when an agent declares no `tools:` — not ours to patch
