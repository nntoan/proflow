---
description: Five-axis code review — correctness, readability, architecture, security, performance.
argument-hint: "[scope]"
---

**Skill activation (do this first).** Load the `code-review-and-quality` skill: call the `agent_skills` tool with `{"action":"load","name":"code-review-and-quality"}` and follow the returned workflow as your operating procedure for this command. If the pack is installed as native Command Code skills, load it with `activate_skill` instead.

Review the current changes (staged or recent commits) across all five axes:

1. **Correctness** — Does it match the spec? Edge cases handled? Tests adequate?
2. **Readability** — Clear names? Straightforward logic? Well-organized?
3. **Architecture** — Follows existing patterns? Clean boundaries? Right abstraction level?
4. **Security** — Input validated? Secrets safe? Auth checked? (load the `security-and-hardening` skill)
5. **Performance** — No N+1 queries? No unbounded ops? (load the `performance-optimization` skill)

Categorize findings as Critical, Important, or Suggestion. Output a structured review with specific `file:line` references and concrete fix recommendations. Read the tests first — they reveal intent and coverage.
