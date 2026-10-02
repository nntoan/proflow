# ADR 0002 — A monorepo, and native-only delivery

**Status:** accepted · **Date:** 2026-09-30

## Context

Until 0.1.1 proflow was a single package that was three things at once: the installer (`bin`), the
mod, and the install payload. That worked while the mod was the delivery mechanism — it registered
the lifecycle commands, served the 25 skills through an `agent_skills` tool, and injected a catalog
into every system prompt.

Three problems accumulated:

1. **The mod was a tax.** Serving the skills meant re-implementing what the harness already does
   (~90 lines of `$ARGUMENTS` substitution), and the catalog was injected into every session whether
   or not the user touched proflow.
2. **The payload was invisible.** There was no package to depend on for the content alone, so the
   installer had to carry it, and every consumer paid for the installer.
3. **One version for unrelated things.** A change to the Magento pack or a tool mod forced a version
   bump of the installer too.

Command Code also grew the seams that made the mod redundant: native skills are advertised by name,
activated on demand, and reachable as `/skill:<name>`; native custom commands cover the lifecycle;
personas are usable as `agent` subagent types.

## Decision

**Split into a workspace of independent packages, and install the pack natively.**

- `packages/cli` (`@nntoan/proflow`) — the installer only. It resolves the payload packages
  **relative to its own file** (never the cwd), copies them into the target scope, and depends on them
  so `npx` can always find them.
- `packages/proflow` (`@ultra-cmd/proflow`) — the payload: commands, skills, references, personas,
  and the harness mod, which is now **tools and behaviour only**: the dangerous-command guard, one
  footer segment (cache hits, the peak/off-peak window, the next lifecycle step), and `/proflow`.
- `packages/magento2`, `packages/mod-gh`, `packages/mod-orca`, `packages/mod-codegraph` — the
  optional packs.
- Build tooling (`tools/`, `scripts/`, `patches/`, `overlays/`) stays at the root; `packages/*` are
  pure payloads.

Commands are **vendored from upstream and patched** (`patches/commands.mjs`), not authored: upstream's
wrappers are one line of skill invocation plus a short body, so the adaptation is a handful of lines
each, and a rule that stops matching fails the sync.

## Alternatives considered

- **Keep the mod as the delivery mechanism.** Rejected: it duplicates the harness, taxes every session
  with a catalog, and leaves skills unavailable in plan-mode-free installs.
- **One package with `exports` for the payload.** Rejected: it does not separate the installer's
  dependency surface, and the optional packs still could not version independently.
- **Publish only the installer and fetch payloads at install time.** Rejected: installs would need
  the network and a second resolution path.

## Consequences

- The installer is the only package with a dependency (`@clack/prompts`), and it declares the five
  payload packages so their content is always present.
- The harness mod no longer injects anything into the system prompt, so an idle session pays nothing
  for proflow being installed. The footer appears only once proflow is actually in use.
- The lifecycle commands carry no activation preamble: Command Code advertises and activates native
  skills, so `Invoke the spec-driven-development skill.` is enough — a claim verified against the
  product docs before removing ~7 lines from every command.
- The reflection process lives in a **new authored skill**, `spec-reflection`, pointed at by a patch
  to the vendored `spec-driven-development` skill, so every load path gets it and `/spec` stays thin.
- Six packages publish from one tag; the release workflow skips anything already on npm, so a partial
  release is recoverable by re-running.
