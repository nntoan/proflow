# The lifecycle commands

Ten commands map onto the development lifecycle. Each one is a thin wrapper: it invokes the skill that
enforces the process, and stops where it should. They carry no activation preamble — Command Code
advertises every installed skill by name and activates it on demand.

```
  DEFINE        PLAN        BUILD        VERIFY       REVIEW        SHIP
┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐
│  SPEC  │──▶│ TASKS  │──▶│  CODE  │──▶│ PROOF  │──▶│  GATE  │──▶│  LIVE  │
└────────┘   └────────┘   └────────┘   └────────┘   └────────┘   └────────┘
  /spec       /to-plan      /build       /test      /to-review     /ship
```

| Command | Skill | What it enforces |
| --- | --- | --- |
| `/brainstorm` | `idea-refine`, `interview-me` | Optional pre-spec entry: parallel research, diverge then converge, a one-page `IDEA.md` |
| `/spec` | `spec-driven-development` | A spec at `docs/spec/<id>/SPEC.md` before any code — never a repository-root `SPEC.md` |
| `/to-plan` | `planning-and-task-breakdown` | Vertical slices with acceptance criteria; plan mode, read-only |
| `/build` | `incremental-implementation`, `test-driven-development` | One task per invocation: RED → GREEN → regression → build → commit |
| `/test` | `test-driven-development` | Tests are proof: the failing output, the passing output, the regression suite |
| `/to-review` | `code-review-and-quality` | Five-axis review with `file:line` findings, severity-ranked |
| `/constraints` | `constraint-driven-development` | A written quality bar (`CONSTRAINTS.md`), plus `check` / `guard` / `ratchet` |
| `/code-simplify` | `code-simplification` | Behaviour-preserving simplification, tests after every step |
| `/webperf` | `web-performance-auditor` persona | A performance audit in Quick or Deep mode |
| `/ship` | `shipping-and-launch` | Three reviewer personas in parallel → GO/NO-GO + rollback plan |

`/plan` and `/review` are Command Code built-ins, so proflow ships the collision-safe `/to-plan` and
`/to-review`.

## `/build auto`

Once a spec exists, `/build auto` generates the plan (if needed) and implements **every** task in a
single approved pass. The one human gate is the plan approval; after that it runs autonomously — but it
still runs the full test-driven loop per task, commits each task separately so any point is a clean
rollback, and stops to ask on a failing test, an ambiguous spec, or anything irreversible.

## The router skill

`using-agent-skills` is the meta-skill: it maps incoming work to the right skill and carries the
lifecycle sequence. Load it when you are unsure which workflow applies.

## Specs

```
docs/spec/<id>/
├── SPEC.md            the specification — the only file meant for version control
├── explore-brief.md   recon findings, assumptions, the interview Q&A (local)
└── review-log.md      one entry per reflection round (local)
```

`<id>` is the ticket id, else a kebab-case slug, else a version. `/to-plan` and `/build` read this
directory, and refuse a repository-root `SPEC.md` as canonical.

**Only `SPEC.md` belongs in git.** The recon and reflection artifacts — and a `/brainstorm`
`IDEA.md` — are working notes: they carry the session's questions, the assumptions and the round-by
round argument, which is noise in a shared repository. proflow's own `.gitignore` keeps them out, and
these four lines do the same for a project:

```
docs/spec/*
!docs/spec/*/
docs/spec/*/*
!docs/spec/*/SPEC.md
```

### The reflection loop

`spec-reflection` (an authored skill, pointed at by the vendored spec skill) runs before approval:

1. it asks whether to run;
2. a `spec-reviewer` subagent reads `SPEC.md` and `explore-brief.md` and returns a severity-ranked
   report (🔴 blocking / 🟡 should fix / 💡 suggestion);
3. **you** decide per blocking finding — fix, accept the risk, or defer — never silently resolved;
4. the decisions are appended to `review-log.md`, and the loop re-reviews (cap: 5 rounds);
5. the spec is approved, refined, or rejected through the question tool.

## Command internals

Commands are vendored from upstream and adapted by declarative rules (`patches/commands.mjs`). The
adaptations are deliberately small — the Claude plugin namespace, the `docs/spec/<id>/` location, the
spec-location line, and the persona mechanics in `/ship`. A rule that stops matching fails the sync, so
upstream drift cannot ship silently. See `docs/adr/0002-monorepo-native-install.md`.
