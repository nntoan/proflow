---
description: Define work spec-first — write a structured specification before code.
argument-hint: "<goal>"
---

**Skill activation (do this first).** Load the `spec-driven-development` skill: call the `agent_skills` tool with `{"action":"load","name":"spec-driven-development"}` and follow the returned workflow as your operating procedure for this command. If the pack is installed as native Command Code skills, load it with `activate_skill` instead. If neither succeeds, tell the user the skill could not be loaded and stop.

Begin by understanding what the user wants to build. Ask clarifying questions about:

1. The objective and target users
2. Core features and acceptance criteria
3. Tech stack preferences and constraints
4. Known boundaries (what to always do, ask first about, and never do)

Then generate a structured spec covering all six core areas: objective, commands, project structure, code style, testing strategy, and boundaries.

If the request bundles several independently testable capabilities, first propose a capability map (module ids, dependency direction, build order) per the skill's Phase 0 and get it approved, then spec each module in dependency order.

Save the spec to `docs/spec/<feature>/SPEC.md` and end with an approve-vs-reflect gate: present the spec and ask the user to approve it or request changes before any implementation begins. Never start coding from this command.
