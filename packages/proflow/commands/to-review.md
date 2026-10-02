---
description: Conduct a five-axis code review — correctness, readability, architecture, security, performance
---

Invoke the code-review-and-quality skill.

Review the current changes (staged or recent commits) across all five axes:

1. **Correctness** — Does it match the spec? Edge cases handled? Tests adequate?
2. **Readability** — Clear names? Straightforward logic? Well-organized?
3. **Architecture** — Follows existing patterns? Clean boundaries? Right abstraction level?
4. **Security** — Input validated? Secrets safe? Auth checked? (invoke the security-and-hardening skill)
5. **Performance** — No N+1 queries? No unbounded ops? (invoke the performance-optimization skill)

Categorize findings as Critical, Important, or Suggestion. Read the tests first — they reveal
intent and coverage. Output a structured review with specific `file:line` references and
concrete fix recommendations.
