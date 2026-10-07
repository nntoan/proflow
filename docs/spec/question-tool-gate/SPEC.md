# Spec: Question-tool gate

## Objective

The commands and skills tell the model to put a decision to the user with the question tool — about sixteen
sites name it, and dozens more rely on prose. A body of text can teach that; it cannot guarantee it. The
failure this exists for is specific and was observed repeatedly: **a turn ends with the decision still open
and nothing asked.** It is silent, and the user has to notice.

The gate catches that turn and pushes the run onward, telling the model why.

**Who it is for:** anyone whose workflow stops at a decision point, and anyone changing how the mod
intervenes in a run.

## The mechanism

```
tool_queued / beforeToolCall   track: a lifecycle workflow is active, and whether the
                               question tool has been called this run
onStop({stopReason, lastAssistantText})
    stopReason === 'end_turn'            ← only a natural stop, never a hard one
    && active                            ← a lifecycle signal, so an idle session is silent
    && !askedThisRun
    && the question tool is available    ← cmd.getActiveTools()
  → {continue: true, reason: "…put it to the user with the question tool…"}
```

- **`onStop` fires only when a run would end naturally** — the model returned no tool calls and no follow-up
  provider wants to continue. It does not fire for `max_turns`, `terminate`, `permission_denied` or
  `interrupted`.
- **`reason` is appended by the harness as an automated `source: 'stop_hook'` user turn.** The model is told
  why it must keep working.
- **Capped twice**: the mod stops after two nudges (`{continue: false}`), and the harness caps consecutive
  stop-hook continuations at eight. A hook that always says `continue` cannot loop forever.
- **Availability is checked** because headless runs withhold the question tool by default. Without the check
  the gate pushes the model at a tool the session does not have — observed in a headless run, then fixed.

## The one rule that keeps it cache-safe

**The gate uses `onStop` and nothing else.** A provider cache is prefix-keyed: a hit runs from byte 0 and
stops at the first differing byte. `onStop`'s reason is an **append**, so the old content stays a pure prefix
and the hit extends across it.

These are documented cache hazards, each on a hook the gate does **not** use:

- `appendSystemPrompt` — "must be byte-stable across rounds… a value that changes turn-to-turn busts the
  cache every round". It is byte 0 of every request.
- `beforeToolCall`'s `additionalContext` — appended **to the tool_result**, a rewrite inside the prefix.
- `transformContext` — the result is ephemeral, but a *changed* array alters the bytes the provider sees.

## Evidence

```
gate off   1 turn
gate on   20 turns · input 887,359 · cacheRead 828,800 · cacheWrite 0   (93.4% read)
           turn 2 — immediately after the append — read 99.6%

gate on   the model called ask_user_question four times, where gate-off stopped at turn one in prose
```

Read from the installed harness, not the website: `bundled/mod-builder/reference/hooks-and-events.md`
(`### onStop`, `### appendSystemPrompt`) and `examples/lifecycle-hooks.ts`.

## Vocabulary

The tool has one id in this harness: **`ask_user_question`**. Claude's `AskUserQuestion` is not a tool here,
and two shipped sites named it — `idea-refine` (its input gate) and `m2-feature` (the next-spec prompt). Both
are renamed **in the rule layer**, because a direct edit is wiped by the next sync:

- `patches/magento2.mjs` — a `genericRules()` entry, so it covers any file upstream adds.
- `patches/agent-skills.mjs` — a regex transform for `idea-refine`, so upstream rewording cannot break the
  sync.

`test/gates.mjs` pins all of it.

## Acceptance criteria

1. The gate fires **only** when all hold: `stopReason` is `end_turn`, a lifecycle workflow is active, the
   question tool has not been called this run, and that tool is present in `getActiveTools()`.
2. It never exceeds **two** continuations, and never fires for a hard stop.
3. It touches **no** other channel: not `appendSystemPrompt`, not a tool-result rewrite, not a
   `transformContext` modification.
4. On the turn immediately following a firing, the cache read share stays in the run's normal range — 99.6%
   measured — and `cacheWrite` does not move.
5. In a session where the question tool is absent, it stays silent.
6. Every shipped command that defines a decision stop names the tool by the one id above.

## Non-goals

- **Not** a replacement for the prose. The bodies teach the model to ask; the gate catches the turn where it
  forgot. Moving the *instruction* into the mod would not work: `appendSystemPrompt` is the documented cache
  hazard, and ADR-0002 already removed system-prompt injection.
- **Not** content enforcement. It cannot tell "asked in prose" from "did not ask" — by design, since forcing
  the tool is the point.
- **Not** exhaustive arming. `active` is broad: it is set by the directory probe (`docs/spec/`, `tasks/`) as
  well as by lifecycle skills, so the gate arms in any session opened in a proflow tree. Narrowing it to
  skill activation alone is open work.
- The `ModApi` is documented as experimental — "surfaces and signatures can change… pin what you ship".
  The mod fails soft, so a rename would silently disable the gate; `test/smoke.mjs` asserts the registered
  shape.
