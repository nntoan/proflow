# Verifying proflow

`npm test` covers the mod surface, the vendoring transforms, and the installer (see
[Verify](../README.md#verify)). Two things are **behavioural** and cannot be asserted from the
command text alone — the `/spec` flow and the CodeGraph wiring. This page is the manual check for
both.

## 1. `/spec` — recon fan-out

In a repo with a `.codegraph/` index (and at least a few source files):

```text
/spec add per-tenant rate limiting to the /api/upload endpoint
```

Expect, **before any clarifying question**:

- several `agent` calls issued in one turn — an `explore` scout for the codebase and a `general`
  researcher for prior art;
- a written `docs/spec/<id>/explore-brief.md` with **What exists today / Constraints / Prior art /
  Assumptions / Open unknowns**;
- the assumptions surfaced in chat ("ASSUMPTIONS I'M MAKING: …");
- if `.codegraph/` exists, at least one `codegraph explore "<query>"` shell call for the scout.

**Fail signal:** the first thing it does is ask you a question, with no recon artefact.

## 2. `/spec` — reflection loop (ask-first)

Continue that session to the draft. Expect:

1. `docs/spec/<id>/SPEC.md` written (six areas + success criteria + open questions);
2. an `ask_user_question` gate offering to bring the `spec-reviewer` in (yes / skip);
3. on yes: a `spec-reviewer` subagent returning severity-ranked findings (🔴 / 🟡 / 💡);
4. per 🔴/🟡 finding, an `ask_user_question` with fix / accept / defer — never a silent fix;
5. `docs/spec/<id>/review-log.md` appended each round, capped at 5;
6. a final approve / refine / reject gate that loops until you approve.

**Fail signals:** a repository-root `SPEC.md`; findings applied without asking; the loop running past
5 rounds without handing back to you.

## 3. CodeGraph wiring (default mode)

After `npx @nntoan/proflow install --mcp codegraph` in a repo you have indexed with `codegraph init`:

- `cmd mcp list` shows `codegraph`; a plain code question lets the model call
  `mcp__codegraph__codegraph_explore` without a permission prompt (the installer allowed
  `mcp__codegraph__*`);
- run a search (`grep`/`glob`/`rg`, or ask for one) and confirm the **PreToolUse** hook fires and the
  tool result arrives enriched with a `[codegraph] graph context …` block;
- run `git commit` (or merge/rebase/pull) and confirm the **PostToolUse** freshness nudge appears;
- uninstall removes the hook script, the two hook entries, and the two allow rules from
  `settings.json`, and the `codegraph` server from `mcp.json`.

**Plan-mode note:** Command Code hides MCP tools in plan mode and skips hooks there, so `codegraph`
is unreachable while planning **except** through the `Shell(codegraph *)` allow rule — which is why
`/spec` and `/brainstorm` recon call `codegraph explore` over the shell. If you see no CodeGraph use
in plan mode, that is expected unless the shell form is used.

## 4. Vendoring drift

After `npm run sync` or `npm run sync:magento2`:

```bash
npm test        # test/vendor.mjs asserts each patch applied and no Claude-isms remain
git diff        # review the vendored delta
```

A sync that cannot apply a declared patch **fails** (it does not silently ship stale content).
