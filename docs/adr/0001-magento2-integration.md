# ADR 0001 — Integrating muon-m2/magento2-tools as an optional component

**Status:** accepted · **Date:** 2026-09-30

## Context

`muon-m2/magento2-tools` is a Magento 2 engineering toolkit shipped as a **Claude Code plugin**:
36 skills, 18 namespaced slash commands (`/magento2-tools:<verb>`), two read-only subagents
(`reviewer`, `explorer`), one `PreToolUse` hook, and a large body of bundled scripts/templates. We
want it available to Command Code users **as an optional choice**, separate from the agent-skills
core, without asking them to switch agents or hand-copy files.

The plugin assumes a Claude environment in ways that do not hold in Command Code:

- `${CLAUDE_PLUGIN_ROOT}` (22 files) — Command Code has no plugin-root token.
- Namespaced command/skill names (`magento2-tools:fix`) — Command Code derives command names from
  filenames and has no `:` prefix.
- Claude hook schema/`tool_name` values (`Grep`/`Glob`/`Bash`).
- `.claude/m2.json` and `CLAUDE.md` for config/memory — Command Code reads `.commandcode/` and
  `AGENTS.md`.
- Claude agent `tools:` ids (`Glob`, `Read`, `Bash`).

## Decision

**Vendor + transform (option A).** Ship `components/magento2/`, produced by
`scripts/sync-magento2.mjs` through the shared vendoring engine (`scripts/lib/vendor.mjs`), and
install it with `--component magento2`. Transformations are declarative data in
`scripts/patches/magento2.mjs`.

### Alternatives considered

- **B — Delegate to `cmd skills add muon-m2/magento2-tools`.** Installs the 36 skills natively with
  no vendoring, but the 22 `${CLAUDE_PLUGIN_ROOT}` references break, `${COMMANDCODE_SKILL_DIR}`-based
  script paths are absent, and the commands, agents, and hook never install. Rejected as incomplete.
- **C — Thin wrapper mod.** A mod that shells out to the upstream pack. The ModApi has no
  skill-registration seam, so with the pack not installed there is nothing to serve. Rejected.

## Consequences

- **Namespacing.** Skills become `m2-<name>` (dir + `name:` + every `` `name` `` reference) and
  commands `m2-<verb>`, so the 36 generic upstream names (`context`, `review`, `test`, …) cannot
  shadow other skills, proflow's commands, or Command Code built-ins.
- **Agent rename.** `reviewer`/`explorer` become `m2-reviewer`/`m2-explorer` (file, `name:`, and the
  ~51 prose references) to avoid colliding with a user's own agents of those names. Tool ids are
  mapped to Command Code's (`glob`, `grep`, `read_file`, `shell_command`).
- **Path/config rewrite.** `${CLAUDE_PLUGIN_ROOT}/skills/X` →
  `${COMMANDCODE_SKILL_DIR}/../m2-X`; `.claude/m2.json` → `.commandcode/m2.json`; `CLAUDE.md` →
  `AGENTS.md`. The `M2_*` environment overrides still win.
- **Hook adaptation.** The `.docs/` guard's `tool_name` case and project-root env var are updated;
  the installer wires it into `settings.json` (merged, reversible).
- **Dev-only files excluded.** `gen-routing.sh` has no callers in an installed tree, is undocumented
  by any `SKILL.md`, and is broken here (no upstream README, and the rename defeats its
  `magento2-tools:` assumption). The engine excludes it (and any future entry in `exclude`).
- **YAML safety.** Upstream writes several `description:` values as plain multi-line scalars that
  Command Code's YAML parser rejects; the transform normalises them to `>-` block scalars.
- **Cost.** ~3.5 MB vendored, and the rules must be revisited when upstream releases change — the
  engine fails loudly on drift, and `test/vendor.mjs` guards the committed result.
