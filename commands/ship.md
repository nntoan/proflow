---
description: Pre-launch fan-out to specialist personas, then a GO/NO-GO decision with a rollback plan.
argument-hint: "[scope]"
---

**Skill activation (do this first).** Load the `shipping-and-launch` skill: call the `agent_skills` tool with `{"action":"load","name":"shipping-and-launch"}` and follow the returned workflow as your operating procedure for this command. If the pack is installed as native Command Code skills, load it with `activate_skill` instead.

`/ship` is a **fan-out orchestrator**. It runs three specialist personas in parallel against the current change, then merges their reports into a single go/no-go decision with a rollback plan. The personas operate independently — no shared state, no ordering — which is what makes parallel execution safe and useful here.

## Phase A — Parallel fan-out

Load the three persona briefs, then spawn three subagents concurrently. **Issue all three `agent` tool calls in a single assistant turn so they execute in parallel** — sequential calls defeat the purpose of this command.

1. Load the persona text with the `agent_skills` tool: `{"action":"persona","name":"code-reviewer"}`, `{"action":"persona","name":"security-auditor"}`, `{"action":"persona","name":"test-engineer"}`.
2. For each, call the `agent` tool with `subagent_type: "general"` and a task prompt that contains the persona text verbatim followed by the change scope. If you have installed these personas into `.commandcode/agents/`, you may pass their names as `subagent_type` instead.

The three personas:

- **code-reviewer** — five-axis review (correctness, readability, architecture, security, performance) of the staged changes or recent commits.
- **security-auditor** — vulnerability and threat-model pass: OWASP Top 10, secrets handling, auth/authz, dependency CVEs.
- **test-engineer** — coverage analysis for the change: gaps in the happy path, edge cases, error paths, and concurrency.

Do not let one persona delegate to another; a subagent cannot spawn subagents.

## Phase B — Merge in main context

Once all three reports are back, the main agent (not a persona) synthesizes them:

1. **Code quality** — aggregate Critical/Important findings and any failing tests, lint, or build output. Resolve duplicates.
2. **Security** — promote any Critical/High findings to launch blockers. Cross-reference the reviewer's security axis.
3. **Performance** — pull from the reviewer's performance axis; cross-check Core Web Vitals if applicable.
4. **Accessibility** — verify keyboard nav, screen reader support, contrast directly (not covered by the three personas). The `references/accessibility-checklist.md` via `agent_skills` `{"action":"reference","name":"accessibility-checklist"}` is the baseline.
5. **Infrastructure** — env vars, migrations, monitoring, feature flags. Verify directly.
6. **Documentation** — README, ADRs, changelog. Verify directly.

## Phase C — Decision and rollback

Produce a single output:

```markdown
## Ship Decision: GO | NO-GO

### Blockers (must fix before ship)
- [persona, file:line, finding, fix]

### Recommended fixes
- [persona, file:line, finding, fix]

### Acknowledged risks (shipping anyway)
- [risk + mitigation]

### Rollback plan
- Trigger conditions: [signals]
- Rollback procedure: [exact steps]
- Recovery time objective: [target]

### Specialist reports (full)
- [code-reviewer report]
- [security-auditor report]
- [test-engineer report]
```

## Rules

1. The three Phase A personas run in parallel — never sequentially.
2. Personas do not call each other. The main agent merges in Phase B.
3. The rollback plan is mandatory before any GO decision.
4. If any persona returns a Critical finding, the default verdict is NO-GO unless the user explicitly accepts the risk.
5. **Skip the fan-out only if all of the following are true:** the change touches 2 files or fewer, the diff is under 50 lines, and it does not touch auth, payments, data access, or config/env. Otherwise, default to fan-out.
