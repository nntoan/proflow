---
name: spec-reflection
description: Reviews a drafted specification adversarially before it is approved. Use when a spec exists at docs/spec/<id>/SPEC.md and needs a severity-ranked review, a decision recorded per finding, and a logged record of what changed.
---

# Spec Reflection

A spec is not done when it is written; it is done when it survives review. Run this once a draft
`docs/spec/<id>/SPEC.md` exists, before any plan or code is written against it.

## Ask first

Use the question tool to ask whether to run the reflection loop now — **run** or **skip**. If the user
skips, stop: the spec is theirs to approve as written.

## The loop

1. **Review.** Ask for **findings under ~800 words**. If a section is too large to fit, name it and stop — the caller re-queries that section rather than receiving the whole spec and code back, because an unbounded report exhausts the caller's context and is itself a cause of mid-build stops. Then spawn one `spec-reviewer` subagent against `docs/spec/<id>/` — the `agent` tool with
   `subagent_type: "spec-reviewer"`. Ask it to read `SPEC.md` and `explore-brief.md` and return its
   severity-ranked report: 🔴 Blocking, 🟡 Should fix, 💡 Suggestion.
2. **Decide with the user, not for them.** For every 🔴 and 🟡 finding, use the question tool to let
   the user choose: *Fix it*, *Accept the risk*, or *Defer*. Never silently resolve a substantive
   finding.
3. **Apply** the chosen fixes to `SPEC.md`. An accepted risk is recorded in the spec's Open Questions
   or Boundaries instead of being fixed.
4. **Log the round.** Append the findings and the decisions to `docs/spec/<id>/review-log.md` — one
   entry per round, so the reasoning survives compaction.
5. **Re-review**, including a consistency check against the sections frozen in earlier rounds.

Stop when the reviewer reports no 🔴 Blocking findings and the user is satisfied — or after **5
rounds**, whichever comes first. At the cap, hand the decision to the user explicitly rather than
looping.

## Approval gate

Close with the question tool: **Approve**, **Refine** (another reflection round), or **Reject** (stop).
Keep looping until the user approves; only then is the spec done. Report the spec's path.
