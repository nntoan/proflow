# Verifying proflow

## Automated

```bash
npm install
npm test
```

Five suites, all runnable without Command Code:

| Suite | Covers |
| --- | --- |
| `test/locations.mjs` | the two locations the CLI resolves — payload root and target scope — for a repo root, a subdirectory, a non-git dir, `--global`, `--project`, and that an install writes nothing outside the target |
| `test/smoke.mjs` | the harness mod: the guard tiers, the config layers, the footer (cache, cost window, next step), `/proflow` |
| `test/install.mjs` | the installer: native layout, idempotency, collision protection, the magento pack + hook, uninstall, non-TTY refusal |
| `test/vendor.mjs` | patch drift, the command renames and the no-preamble rule, the magento `docs/` retarget, `m2-docs` survival |
| `test/toolmods.mjs` | mod-codegraph / mod-gh / mod-orca: the read gates, and that a selected mod installs and uninstalls |

`npm run sync` / `npm run sync:magento2` re-vendor upstream; both must leave the tree unchanged
(CI runs this weekly in `.github/workflows/sync-drift.yml`).

## Manual — a real session

Restart Command Code (or `/reload`) after installing, then:

1. **Native surfaces.** `/skills` lists 26 skills including `spec-reflection`; `/` lists the ten
   commands; `cmd skills list --debug` reports no skipped skills.
2. **The spec flow.** `/spec "add SSO"` — the skill is invoked in one line (no activation
   boilerplate), no root `SPEC.md` is written, and the spec lands in `docs/spec/<id>/` with its
   `explore-brief.md`; the reflection loop runs through `spec-reflection`.
3. **The footer.** Nothing is shown in an unrelated session. It appears once a lifecycle skill runs,
   and shows the cache-hit rate, the cost window (never a provider name), and `next: /to-plan`-style
   guidance. `--mod-option footer=false` clears it.
4. **The guard.** `curl … | sh` is denied; `git push --force origin feature` asks; a project
   `.commandcode/proflow.jsonc` with an `allow` regex waives it; `--mod-option guard=off` disables it.
5. **CodeGraph in plan mode.** With a `.codegraph/` index, `codegraph_explore` answers while plan
   mode is active — the point of shipping it as a mod tool rather than MCP.
6. **gh / orca.** `gh_read` runs `pr view` with no prompt; `gh_read` refuses `pr create`; `gh_run`
   runs it through the permission prompt.
7. **The magento pack.** `m2-*` skills install, the guard hook is wired in `settings.json`, and its
   matcher polices `docs/` (not `.docs/`) with the Magento-project scope gate intact.
