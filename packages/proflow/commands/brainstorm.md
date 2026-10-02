Invoke the idea-refine and interview-me skills.

Use `/brainstorm` when the intent is still fuzzy — a greenfield project, a "wouldn't it be nice if…", or
a direction with several plausible shapes. It produces a one-page concept, not a specification, and it
is optional: `/spec` is the entry point when you already know what you want to build.

## Phase A — Fan out (parallel reconnaissance)

Before refining anything, gather evidence. **Issue the subagent calls in a single assistant turn so
they run in parallel** — two or three focused calls beat one broad one:

1. **Codebase / constraints** — `agent` with `subagent_type: "explore"`, when there is an existing
   repo: what already exists, what this idea would collide with or extend, non-negotiable
   constraints. Prefer CodeGraph when the repo has a `.codegraph/` directory: run
   `codegraph explore "<question>"` via the shell before grep/glob/read — one call returns the
   relevant symbols and call paths, and the shell form works even in plan mode (where the CodeGraph
   MCP tool is hidden).
2. **Prior art** — `agent` with `subagent_type: "general"`: who already does this, how, and what
   users complain about.
3. **Approach options** — `agent` with `subagent_type: "general"`: two or three genuinely different
   technical or product approaches, with trade-offs.

If a research call is unnecessary (e.g. an internal tool with no external analogue), say so and skip
it rather than padding the fan-out.

## Phase B — Diverge, then converge

Following `idea-refine`: generate 5–8 deliberately different directions, score them against the
user's stated success signal, then converge on one recommended direction. Surface the assumptions
behind it. Ask the user to pick using the question tool when there is a real fork — do not choose
silently.

## Phase C — The one-pager

Save `docs/spec/<id>/IDEA.md` (create the directory; `<id>` is a kebab-case slug for the idea),
covering: **the problem and who has it**, **the recommended direction and why**, **2–3 considered
alternatives and why not**, **assumptions to validate**, **a "Not Doing" list**, and **open
questions**. Keep it to one page.

## Phase D — Hand off

Tell the user the concept is ready and offer `/spec <idea>` to turn it into a specification
(`/spec` will reuse this directory and its `IDEA.md` as input). Stop here — do not write a spec or
any code from `/brainstorm`.
