# Installing proflow

```bash
npx @nntoan/proflow install
```

The installer provisions the agent-skills pack — and, optionally, the Magento 2 pack and the tool mods —
into a Command Code **scope**.

## Scopes

| Scope | Location | Flag |
| --- | --- | --- |
| Project (default) | the git root's `.commandcode/` | — |
| Global | `~/.commandcode/` | `--global`, `-g` |
| A specific directory | `<dir>/.commandcode/` | `--project <dir>` |

Project scope is always allowed, including inside the proflow repository itself. The installer resolves
the target from the git root, so running it from a subdirectory still installs into the project root.

## What it writes

| Path | Content |
| --- | --- |
| `.commandcode/commands/` | 10 commands |
| `.commandcode/skills/` | 26 skills (each its own directory, with `references/` and `scripts/`) |
| `.commandcode/references/` | 7 shared checklists — the skills link to these, so they are required |
| `.commandcode/agents/` | 5 personas, usable as `agent` subagent types |
| `.commandcode/docs/agents.md` | the persona index the skills reference |
| `.commandcode/mods/proflow.ts` | the harness mod (guard + footer) |
| `.commandcode/proflow.jsonc` | the guard-config template, written only when no config exists yet |
| `.commandcode/proflow.manifest.json` | what was written, so uninstall removes exactly that |

Files proflow did not install are never overwritten — a foreign skill of the same name is skipped with a
warning (`--force` overrides).

## Interactive run

On a TTY the installer walks you through it:

1. an **action menu** when proflow is already installed there — *Reconfigure*, *Status*, *Uninstall*;
2. **scope** — project or global;
3. **optional packs** — Magento 2, CodeGraph tools, GitHub tools, Orca tools;
4. a **confirm per missing CLI** — anything a selected pack needs (`gh`, `orca`, `codegraph`), with a
   spinner while it installs via the platform manager (`brew`, `apt-get`, `winget`, or `npm -g`);
5. a **plan summary** — scope, counts, packs, target paths;
6. **one spinner per step**, then an outro.

`Ctrl-C` at any prompt cancels and writes nothing. With no TTY, `--yes` is required, so automation can
never trigger a surprise install.

## Flags

| Flag | Effect |
| --- | --- |
| `--global`, `-g` | target `~/.commandcode` instead of this project |
| `--project <dir>` | target a specific project directory |
| `--yes`, `-y` | no prompts; take the defaults. Required when stdin is not a TTY |
| `--force`, `-f` | overwrite files proflow did not install |
| `--dry-run` | print the plan, the resolved payload root and target scope, then write nothing |
| `--magento2` / `--no-magento2` | add or omit the Magento 2 pack |
| `--mod codegraph,gh,orca` | add the optional tool mods |
| `-h`, `--help` / `-v`, `--version` | help / version |

```bash
npx @nntoan/proflow install --yes                    # no prompts (core only)
npx @nntoan/proflow install --global                 # all projects
npx @nntoan/proflow install --magento2 --mod gh,orca
npx @nntoan/proflow install --dry-run                # show the plan, write nothing
npx @nntoan/proflow uninstall                        # remove only what proflow wrote
npx @nntoan/proflow status                           # what is installed in this scope
```

## Missing CLIs

A pack whose CLI is absent is skipped rather than half-installed, and the installer says so. Nothing
fails the install. If you decline a CLI install, only that pack is dropped — the core always lands.

- `--mod gh` needs `gh` (and `gh auth login`)
- `--mod orca` needs the Orca CLI on `PATH`
- `--mod codegraph` needs `codegraph` (`npm i -g @colbymchenry/codegraph`)
- `--magento2` has no CLI requirement

## Working inside the proflow repository

`npx @nntoan/proflow` cannot start there: npm resolves the local package and finds no local `.bin`
(`sh: proflow: command not found`). Use the workspace script instead — the installer detects the case
and prints the same hint:

```bash
npm run proflow:install
npm run proflow:uninstall
```

## Uninstalling

`uninstall` deletes exactly what the manifest lists, prunes the directories it emptied, removes the
magento hook entry from `settings.json` (and that file, if this install created it), and leaves
everything else — including your `proflow.jsonc` edits — alone.
