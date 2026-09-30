---
description: Implement one task (or "auto" for the whole plan) — RED → GREEN → regression → build → commit.
argument-hint: "[auto]"
---

**Skill activation (do this first).** Load the `incremental-implementation` and `test-driven-development` skills: call the `agent_skills` tool with `{"action":"load","name":"incremental-implementation"}`, then again with `{"action":"load","name":"test-driven-development"}`, and follow them. If the pack is installed as native Command Code skills, load them with `activate_skill` instead.

## Modes

- **`/build`** — implement the *next* pending task, then stop (careful, one slice at a time).
- **`/build auto`** — generate the plan if needed, get a single approval, then implement *every* task without stopping between them.

`$ARGUMENTS` selects the mode. Treat `auto` (canonical) or `all` as autonomous mode; anything else (or empty) is the default single-task mode. Autonomous mode is not faster *per task* — it runs the same test-driven loop — it only removes the human stepping *between* tasks.

## Default: one task

Pick the next pending task from the plan. Then:

1. Read the task's acceptance criteria
2. Load relevant context (existing code, patterns, types)
3. Write a failing test for the expected behavior (RED)
4. Implement the minimum code to pass the test (GREEN)
5. Run the full test suite to check for regressions
6. Run the build to verify compilation
7. Commit with a descriptive message
8. Mark the task complete and stop

## Autonomous: the whole plan (`/build auto`)

Use this once a spec exists and you want to collapse plan + build into one run. It removes the manual stepping between tasks — **not** the verification. Every task still earns a passing test and its own commit.

1. **Require a spec.** Prefer the canonical location `docs/spec/<id>/SPEC.md` (with its `explore-brief.md` / `review-log.md`); fall back to `docs/SPEC.md` or a file under `spec/`. A repository-root `SPEC.md`, a README, or an arbitrary doc does **not** count. If more than one `docs/spec/<id>/SPEC.md` exists, ask which one this build is for. If none exists, stop and tell the user to run `/spec` first — do not invent requirements.
2. **Establish a clean baseline.** Run `git status --porcelain`. If there are uncommitted changes outside the expected planning artifacts (`SPEC.md`, `docs/SPEC.md`, `spec/*`, `docs/spec/*`, `tasks/plan.md`, `tasks/todo.md`), stop and ask the user to commit, stash, or confirm how to handle them. Autonomous per-task commits must not absorb unrelated local work, or the clean-rollback guarantee breaks.
3. **Plan if needed.** If there is no `tasks/plan.md`, load the `planning-and-task-breakdown` skill and generate one.
4. **Single checkpoint.** Present the full plan and wait for an unambiguous affirmative (e.g. "approve", "go", "yes"). Treat hedged responses ("looks reasonable", "I guess") as **not** approved. This is the only human gate — after approval, run autonomously. If you generated `tasks/plan.md`, commit it as a single preparatory commit now so it doesn't bleed into the first task's commit.
5. **Execute every task in dependency order.** Use each task's declared dependencies; if they aren't explicit, execute in the order the plan lists them. For each task, run the full default loop above (RED → GREEN → regression → build → commit → mark complete). Stage only the files that task touched plus its task-status update — never `git add -A` blindly — and make one commit per task so any point is a clean rollback.
6. **Stop and ask the user** (do not push through) when:
   - a test can't be made to pass or the build breaks without an obvious fix → load the `debugging-and-error-recovery` skill
   - the spec is ambiguous, or a task needs a decision the spec doesn't cover
   - a task is high-risk or irreversible — auth/permission changes, destructive data migrations, payments, deletions, deploys, anything touching secrets, **or anything you can't undo with `git revert`** → load the `doubt-driven-development` skill and get explicit sign-off before continuing

   After the user resolves a blocker, they re-invoke `/build auto` — it resumes from the next pending task.
7. **Summarize at the end:** tasks completed, tests added, commits made, and anything skipped, flagged, or left for the user.

If any step fails, load the `debugging-and-error-recovery` skill.
