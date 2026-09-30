---
description: Define work spec-first — recon, interview, draft, reflect, and approve a specification before code.
argument-hint: "<goal | ticket | version>"
---

**Skill activation (do this first).** Load the `spec-driven-development` and `interview-me` skills:
call the `agent_skills` tool with `{"action":"load","name":"spec-driven-development"}`, then again
with `{"action":"load","name":"interview-me"}`, and follow them as your operating procedure. If the
pack is installed as native Command Code skills, load them with `activate_skill` instead. If neither
succeeds, tell the user the skill could not be loaded and stop.

**Hard rules.**
1. **Never write code** from this command. It ends at an approved spec.
2. **Never write a spec at the repository root.** Every spec lives in its own directory:
   `docs/spec/<id>/SPEC.md`. A top-level `SPEC.md` is not accepted.
3. Do not finish until the user has **explicitly approved the spec** through the question tool.

## Where specs live

`docs/spec/<id>/`, where `<id>` is, in this order of preference:

- the **ticket id** when the request names one (e.g. `ABC-123`, `PROJ-42`),
- otherwise a short **kebab-case feature slug** (e.g. `user-sso`, `checkout-redesign`),
- otherwise a **version** for release-scoped work (e.g. `v1.3`).

Each directory holds:

| File | Purpose |
| --- | --- |
| `explore-brief.md` | Recon findings, assumptions, and the interview Q&A — the persistent baseline. |
| `SPEC.md` | The specification itself. |
| `review-log.md` | One entry per reflection round: issues raised and how they were resolved. |

Choose `<id>` from the goal, state it, and reuse it for the rest of the command.

## Phase 0 — Recon (fan out BEFORE asking anything)

You cannot ask good questions about a codebase you haven't scouted. **Before the interview, issue
several subagent calls in a single assistant turn so they run in parallel:**

1. **Codebase scout** — `agent` with `subagent_type: "explore"`: where the relevant code lives,
   existing patterns and conventions, the data model, the test setup, and anything this change would
   touch or duplicate.
2. **Prior-art / external research** — `agent` with `subagent_type: "general"`: how comparable
   products solve this, standard approaches, libraries or standards worth adopting, known pitfalls.

If CodeGraph is available — a `.codegraph/` directory exists, or `mcp__codegraph__*` tools are
listed — **use it before grep/read** for the codebase scout; `codegraph_explore` returns the relevant
symbols and call paths in one call. Hand the scout that instruction.

Synthesize the results into `docs/spec/<id>/explore-brief.md` (create the directory), with these
sections: **What exists today**, **Constraints discovered**, **Prior art**, **Assumptions we are
making**, **Open unknowns**. Then surface the assumptions to the user in the chat:

```
ASSUMPTIONS I'M MAKING:
1. …
→ Correct me now or I'll proceed with these.
```

## Phase 1 — Interview (one question at a time)

Following `interview-me`, ask **one question at a time**, each informed by the recon above — no
question that the recon already answered, and no questionnaire dumps. Cover the objective and target
users, core features and acceptance criteria, tech-stack constraints, and boundaries (always / ask
first / never). **Append every question and answer to `explore-brief.md` as it is resolved**, so the
decisions survive compaction and feed the review.

## Phase 2 — Capability map (only when the request bundles several capabilities)

If the request bundles several independently testable capabilities, propose a capability map (module
ids, dependency direction, build order) per the skill's Phase 0 **before** writing any spec, get it
approved through the question tool, then spec each module in dependency order — one
`docs/spec/<id>/SPEC.md` per module.

## Phase 3 — Draft the spec

Write `docs/spec/<id>/SPEC.md` covering the skill's six core areas: **Objective, Commands, Project
Structure, Code Style, Testing Strategy, Boundaries**, plus **Success Criteria** and **Open
Questions**. Reframe vague goals as measurable success criteria rather than accepting them as-is.

## Phase 4 — Reflection loop (the spec-reviewer)

A spec is not done when it is written; it is done when it survives review. Loop:

1. **Review.** Spawn one `spec-reviewer` subagent against `docs/spec/<id>/`:
   `agent` with `subagent_type: "spec-reviewer"` if the persona is installed, otherwise
   `subagent_type: "general"` with the brief loaded via
   `agent_skills` `{"action":"persona","name":"spec-reviewer"}` pasted as the task prompt. Ask it to
   read `SPEC.md` and `explore-brief.md` and return its severity-ranked report.
2. **Decide with the user, not for them.** For each 🔴 Blocking and 🟡 Should-fix finding, use the
   **`ask_user_question`** tool to let the user choose — *Fix it*, *Accept the risk*, or *Defer*.
   Do not silently resolve substantive findings.
3. **Apply** the chosen fixes to `SPEC.md` (or record an accepted risk in the spec's Open
   Questions/Boundaries).
4. **Log the round.** Append the findings and the decisions to `docs/spec/<id>/review-log.md`.
5. **Re-review**, including a consistency check against the previously frozen sections.

Stop when the reviewer reports no 🔴 Blocking findings and the user is satisfied — or after **5
rounds**, whichever comes first. If the cap is hit, stop and hand the decision to the user explicitly
rather than looping.

## Phase 5 — Approval gate

Use the **`ask_user_question`** tool for the final decision on the spec: **Approve**, **Refine**
(another reflection round), or **Reject** (stop). Keep looping Phases 3–5 until the user approves.
Only then is the spec done — report its path and offer `/to-plan` next. Never start implementing.
