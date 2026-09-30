---
description: Break approved work into small, verifiable tasks with acceptance criteria.
argument-hint: "<goal>"
---

**Skill activation (do this first).** Load the `planning-and-task-breakdown` skill: call the `agent_skills` tool with `{"action":"load","name":"planning-and-task-breakdown"}` and follow the returned workflow as your operating procedure for this command. If the pack is installed as native Command Code skills, load it with `activate_skill` instead.

Read the existing spec — prefer `docs/spec/<id>/SPEC.md` (the architectural location `/spec` writes to), and read its siblings `explore-brief.md` and `review-log.md` for the recon findings and the decisions already made. Fall back to `docs/SPEC.md` or a file under `spec/` only if no `docs/spec/<id>/` exists, and never treat a repository-root `SPEC.md` as the canonical spec. Read the relevant codebase sections too. If more than one `docs/spec/<id>/SPEC.md` exists, ask the user which one this plan is for rather than guessing.

Then:

1. Enter plan mode — read only, no code changes. Use the `enter_plan_mode` tool; the user can also start you in plan mode with `/plan`.
2. Identify the dependency graph between components.
3. Slice work vertically (one complete path per task, not horizontal layers).
4. Write tasks with acceptance criteria and verification steps.
5. Add checkpoints between phases.
6. Present the plan for human review.

Save the plan to `tasks/plan.md` and the task list to `tasks/todo.md`.

If `tasks/plan.md` or `tasks/todo.md` already exists with unchecked tasks for different work, stop and ask before writing — never silently overwrite an incomplete plan.
