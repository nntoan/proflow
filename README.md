# proflow

**Production-grade engineering workflows for [Command Code](https://commandcode.ai)** — a
mod that deep-integrates [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
into a single installable package.

It packages the 25 upstream skills, 7 shared reference checklists, and 4 specialist personas,
then wires the full development lifecycle into six slash commands:

```
DEFINE → PLAN → BUILD → VERIFY → REVIEW → SHIP
/spec   /to-plan  /build  /test   /to-review  /ship
```

`/plan` and `/review` are reserved by Command Code, so the planning and review commands are
named `/to-plan` and `/to-review` (same convention as proflow).

## What you get

- **Six lifecycle commands** that drive the matching skill workflows end to end.
- **`agent_skills`** — a model-callable tool for progressive disclosure: `list` the catalog,
  then `load` exactly the skill, reference checklist, or persona a task needs.
- **A byte-stable catalog** appended to the system prompt so the model knows which skill
  applies without loading every skill body up front (turn it off with a flag).

## Install

proflow ships its own installer, so there is no git clone and nothing to copy by hand. One command
provisions everything — the mod, the 25 native skills, and the 4 personas — into a single Command
Code scope:

```bash
npx @nntoan/proflow install            # this project   → <repo>/.commandcode/   (trust-gated)
npx @nntoan/proflow install --global   # all projects   → ~/.commandcode/
npx @nntoan/proflow uninstall          # removes only what proflow wrote
npx @nntoan/proflow status             # show what is installed
```

Flags: `--force` (overwrite a same-named skill proflow does not own), `--dry-run`, `--no-skills`,
`--no-agents`, and `--commands` (also drop native command files — only needed if you don't load the
mod).

What lands where, under the target scope's `.commandcode/`:

| Path | What | How Command Code sees it |
| --- | --- | --- |
| `mods/proflow/` | the mod package | dir-manifest auto-discovery → the six commands + the `agent_skills` tool |
| `skills/<name>/` | the 25 skills | native — `/skills`, `/skill:<name>`, `activate_skill` |
| `agents/*.md` | the 4 personas | native subagents — `subagent_type: "code-reviewer"` (used by `/ship`) |
| `proflow.manifest.json` | the install record | drives `uninstall` and collision protection |

Restart Command Code (or run `/reload`), then `cmd mods list` should show `proflow` and
`cmd skills list` should show the 25 project skills. A brand-new workspace builds its mod index on
first contact, so the very first session may not see the mod yet — the next one will.

Just want the mod, without the native skills/agents? Use the mod manager instead:

```bash
cmd mods add @nntoan/proflow    # mod only (the agent_skills tool still serves the skills)
cmd --mod ./mods/proflow.ts     # try it without installing
```

## Commands

| Command | Use it for | What it does |
| --- | --- | --- |
| `/spec <goal>` | Defining work | Loads `spec-driven-development`, asks clarifying questions, writes `docs/spec/<feature>/SPEC.md`, and stops at an approve-vs-reflect gate. |
| `/to-plan <goal>` | Planning approved work | Loads `planning-and-task-breakdown`, reads the spec, enters plan mode, and writes `tasks/plan.md` + `tasks/todo.md`. |
| `/build [auto]` | One slice, or the whole plan | Loads `incremental-implementation` + `test-driven-development`; runs RED → GREEN → regression → build → commit for the next task, or every task with `auto`. |
| `/test [scope]` | Proving behavior | Loads `test-driven-development`; new features go test-first, bugs use the Prove-It reproduction pattern. |
| `/to-review [scope]` | Reviewing changes | Loads `code-review-and-quality`; five-axis review (correctness, readability, architecture, security, performance) with `file:line` findings. |
| `/ship [scope]` | Release readiness | Loads `shipping-and-launch`; fans out to three personas in parallel (`agent` tool), merges their reports, and returns GO/NO-GO plus a rollback plan. |

### Arguments

Command bodies support Command Code's **native placeholder grammar**, so a workflow can place the
argument where it reads best; a body with no placeholder gets the arguments appended as an
`ARGUMENTS:` footer (native behavior). Supported forms: `$ARGUMENTS` / `$@`, `$1`…`$N`, `${N}`,
`${N:-default}`, `${@}`, `${@:N}`, `${@:N:L}` — substituted in a single pass, with arguments
inserted literally.

Tool-loaded skills resolve their own placeholders too: `$ARGUMENTS`, `$ARGUMENTS[N]`, `${N}`, and
`${COMMANDCODE_SKILL_DIR}` / `${COMMANDCODE_PROJECT_DIR}` (plus the `CLAUDE_*` aliases). The
`$ARGUMENTS` value comes from the tool's optional `arguments` field when the model supplies it,
otherwise from the current typed prompt — captured on input and cleared at the end of each run.

Skill bodies use this narrower grammar deliberately: it has no bare `$1` form, so SQL (`WHERE id = $1`)
or `$50` inside a skill is never mistaken for a placeholder. Reference checklists and personas are
served without substitution for the same reason.

## The skills

The `agent_skills` tool is how the model reaches the pack. It is read-only and takes two
fields:

```json
{"action": "list"}
{"action": "load", "name": "security-and-hardening"}
{"action": "reference", "name": "definition-of-done"}
{"action": "persona", "name": "code-reviewer"}
```

- `list` returns the full catalog, grouped by phase.
- `load` returns a skill's full `SKILL.md` workflow (25 available, from `interview-me` and
  `spec-driven-development` through `test-driven-development` to `shipping-and-launch`).
- `reference` returns one of the 7 shared checklists (definition-of-done, security, testing,
  performance, accessibility, observability, orchestration patterns).
- `persona` returns one of the 4 specialist briefs (code-reviewer, security-auditor,
  test-engineer, web-performance-auditor) — used by `/ship`.

The catalog rides in the system prompt, so the skill names and one-line descriptions are
always visible; bodies load only on demand.

### Native skills and the `agent_skills` tool

`npx @nntoan/proflow install` already provisions the skills natively, so `/skills`, `/skill:<name>`, and
`activate_skill` all work and the command prompts load skills through `activate_skill`. The bundled
`agent_skills` tool stays as a fallback: it reads the same skills straight out of the mod package,
so it works even when the native copies are absent — a `--mod`-only run, a `--no-skills` install, or
any scope that hasn't provisioned them.

You do **not** need `cmd skills add addyosmani/agent-skills` — the installer carries the same
content. (Running it anyway only duplicates the skill names.)

## Flags

Set options at launch with `--mod-option name=value`:

| Flag | Default | Effect |
| --- | --- | --- |
| `catalog` | `true` | Inject the agent-skills catalog into the system prompt. `--mod-option catalog=false` disables it (the `agent_skills` tool still works). |

`/proflow` prints the installed pack status at any time.

## How it is built

| Path | Contents |
| --- | --- |
| `mods/proflow.ts` | The mod: commands, the `agent_skills` tool, the catalog hook, flags, the argument engine. Reads everything else relative to itself, so the package is self-contained. |
| `commands/*.md` | The six lifecycle workflows (authored for Command Code). The mod reads these at load; they are not overwritten by the sync script. |
| `skills/`, `references/`, `agents/`, `docs/agents.md` | Vendored verbatim from addyosmani/agent-skills. |
| `scripts/install.mjs` | The installer (`npx @nntoan/proflow install|uninstall|status`) — the `proflow` bin. |
| `scripts/sync-upstream.mjs` | Re-vendors the upstream content (`npm run sync [ref]`). |
| `test/smoke.mjs`, `test/install.mjs` | Mod-surface and installer tests (`npm test`). |

Refresh the vendored content:

```bash
npm run sync            # tracks main
npm run sync v0.6.11    # pin a tag
```

Provenance for the vendored snapshot is recorded in `VENDOR.json`.

## Verify

```bash
npm test                # mod surface (17) + installer (5) checks
cmd mods list           # proflow listed, no load warnings
cmd skills list         # 25 project skills after an install
```

The smoke test loads the mod with a mock `ModApi` and exercises every registered surface: the six
commands, the argument grammar, the `agent_skills` tool (list/load/reference/persona plus the
unknown-name error path), and the catalog hook. The installer test provisions into a throwaway
project and asserts the layout, idempotency, collision protection, and a clean uninstall.

## License

MIT. See `LICENSE`. The bundled skill content is MIT-licensed by Addy Osmani and the
agent-skills contributors — see `LICENSE.agent-skills` and
[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills).
