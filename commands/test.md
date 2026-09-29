---
description: Run the TDD workflow — failing test first; use the Prove-It pattern for bugs.
argument-hint: "[scope]"
---

**Skill activation (do this first).** Load the `test-driven-development` skill: call the `agent_skills` tool with `{"action":"load","name":"test-driven-development"}` and follow the returned workflow as your operating procedure for this command. If the pack is installed as native Command Code skills, load it with `activate_skill` instead.

For new features:

1. Write tests that describe the expected behavior (they should FAIL)
2. Implement the code to make them pass
3. Refactor while keeping tests green

For bug fixes (Prove-It pattern):

1. Write a test that reproduces the bug (must FAIL)
2. Confirm the test fails
3. Implement the fix
4. Confirm the test passes
5. Run the full test suite for regressions

For browser-related issues, also load the `browser-testing-with-devtools` skill and verify with the Chrome DevTools MCP server when it is configured.

Report the evidence: the command you ran, the failing output before the fix, the passing output after, and the regression-suite result. "Looks right" is not evidence.
