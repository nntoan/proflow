# Releasing proflow — runbook

`@nntoan/proflow` is a **scoped npm package** with **no build step**: jiti loads the TypeScript mod
at runtime, and npm ships the `files` allowlist as-is. Releasing is therefore `npm publish` plus a
tag — the only care needed is that the tarball carries what the mod reads at runtime.

Two paths:

- **First release** — §2, manual and once (§1 pre-flight first).
- **Every release after** — §3: bump → tag → push; CI publishes.

---

## 0. One-time prerequisites

| Need | Why |
| --- | --- |
| npm account with access to the **`@nntoan` scope** | publishing a scoped package requires scope ownership (`npm publish --access public`) |
| `npm login` (and `--otp` if 2FA is on) | local publishes |
| GitHub repo pushed, and `repository`/`homepage`/`bugs` in `package.json` matching it | npm metadata + provenance |
| `NPM_TOKEN` repo secret — an npm **Automation** token with publish rights | the `release.yml` workflow |
| Repo **public** + workflow `id-token: write` | npm provenance (`--provenance`) |
| Node **≥ 22.13** | the test harness uses `module.stripTypeScriptTypes` |

---

## 1. Pre-flight (every release)

```bash
git switch main && git pull
git status --porcelain          # MUST be empty
npm test                        # 19 mod-surface + 6 vendor + 9 installer checks
npm pack --dry-run              # inspect the tarball contents BEFORE publishing
```

`npm test` must be green, and the pack list must include everything the mod reads **relative to
itself**: `mods/ commands/ skills/ references/ agents/`, plus `components/ hooks/ docs/`
and `scripts/install.mjs`. If any is missing, fix `package.json#files` — the mod resolves them from
its own directory (`.commandcode/mods/proflow/…`), so a missing dir degrades the catalog silently.

Optional, if you want to pick up upstream changes in this release:

```bash
npm run sync          # agent-skills
npm run sync:magento2 # magento2-tools
git diff              # REVIEW the vendored delta before committing it
npm test              # the drift test re-checks every patch applied
```

> The syncs **wipe** `skills/ · references/ · agents/`, so authored files must live in `overlays/`
> (restored after each sync). `agents/spec-reviewer.md` is the current example.

---

## 2. First release (manual, once)

```bash
# 1. Choose the first public version. Keep 0.1.0 for a preview, or go 1.0.0.
npm version 1.0.0 --no-git-tag-version

git add package.json
git commit -m "chore: release 1.0.0"

# 2. Publish (scoped → --access public; add --otp <code> if 2FA is enabled).
npm login
npm publish --access public

# 3. Tag and push.
git tag v1.0.0
git push origin main --tags

# 4. GitHub release notes (or use the UI).
gh release create v1.0.0 --generate-notes
```

`prepublishOnly` runs `npm test` automatically, so a broken tree cannot be published even if you
forget §1.

> **A brand-new package's packument is briefly unavailable.** Right after the first publish the
> registry may 404 on `GET /@nntoan%2fproflow` (so `npm view` and `npm install` fail) even though
> `/@nntoan/proflow/latest` and the tarball already return 200. This is a CDN cache of the 404 that
> npm's own pre-publish existence check primed — it clears on its own within a few minutes. Confirm
> readiness before treating it as a failure:
> `curl -s -o /dev/null -w '%{http_code}\n' https://registry.npmjs.org/@nntoan%2fproflow` → `200`.
> Do **not** republish a new version to "fix" it.

**Verify the publish (see §4).** Do not skip this — a scoped package can publish "successfully" yet
be uninstallable if `files` is wrong.

---

## 3. Subsequent releases (tag → CI)

The `release.yml` workflow owns publishing once the secret exists. Locally you only bump and tag:

```bash
git switch main && git pull
npm version patch          # or minor / major — commits the bump + creates the git tag
git push origin main --follow-tags
```

On the `v*` tag, `release.yml`:

1. asserts `v<tag>` equals `package.json.version` (fails otherwise);
2. runs `npm test`;
3. `npm publish --provenance --access public` with `NPM_TOKEN`;
4. creates a GitHub release with generated notes.

**If the tag/version check fails**, your tag was not created by `npm version`. Delete it and re-tag:

```bash
git tag -d vX.Y.Z && git push --delete origin vX.Y.Z
npm version X.Y.Z
git push origin main --follow-tags
```

---

## 4. Post-release verification

```bash
npm view @nntoan/proflow version
npm view @nntoan/proflow dist.tarball
npx @nntoan/proflow --help
```

Smoke-install into a throwaway project (proves the tarball is self-contained):

```bash
mkdir -p /tmp/proflow-smoke && cd /tmp/proflow-smoke && git init -q
npx @nntoan/proflow install --component magento2 --mcp codegraph
cmd mods list                       # → proflow
cmd skills list                     # → 25 agent-skills (+ 36 m2-* with the component)
```

Then, in a real Command Code session: `/proflow` prints the pack status, the commands appear in the
`/` menu, and `agent_skills` loads a skill. `docs/verification.md` has the deeper behavioural checks.

---

## 5. Vendor drift / freshness

Upstream (`addyosmani/agent-skills`, `muon-m2/magento2-tools`) moves independently. The
`sync-drift.yml` workflow re-runs both syncs **weekly** and fails if the committed tree would change
— a signal to open a re-vendor PR:

```bash
npm run sync && npm run sync:magento2
git diff                 # review
npm test                 # drift test must pass
git commit -am "chore: re-vendor upstream"
```

Vendored versions are recorded in `VENDOR.json` and `components/magento2/VENDOR.json`. A sync that
cannot apply a declared patch **fails loudly** (it never ships stale content); update
`scripts/patches/*.mjs` when upstream changes a patched anchor.

---

## 6. Rollback & recovery

| Situation | Action |
| --- | --- |
| Published the wrong files | Publish a patch **immediately**; `npm deprecate @nntoan/proflow@X.Y.Z "broken, use X.Y.(Z+1)"`. Unpublish only within 72h: `npm unpublish @nntoan/proflow@X.Y.Z --force` |
| Bad tag, nothing published | Delete the tag and re-tag with a **new** version |
| CI published, need to withdraw | `npm deprecate` the version; never reuse the number |
| Provenance step failed but publish succeeded | Harmless — the version is out; fix the workflow for the next tag |

**Never reuse a version number** — npm keeps the first publish of a version permanently.

---

## 7. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `npm view`/`npm install` 404 right after the **first** publish | CDN cached the pre-publish 404 → wait a few minutes; `curl .../@nntoan%2fproflow` returning 200 means it is live (§2) |
| `E403` on publish | not logged in, or no rights to the `@nntoan` scope → `npm login`; confirm scope ownership; keep `--access public` |
| `EOTP` | 2FA enabled → add `--otp <code>` (or publish via CI with an Automation token) |
| `E409` / "cannot publish over" | the version exists → bump; the release workflow already skips when the version is published |
| `warn publish "bin[proflow]" … was invalid` | npm normalizes a `./`-prefixed bin path; `bin` must be `scripts/install.mjs` (no `./`) — run `npm pkg fix` |
| Provenance error | repo must be public and the workflow needs `id-token: write` |
| `npm test` fails on Node < 22.13 | upgrade Node (the harness uses `module.stripTypeScriptTypes`) |
| Installed mod does nothing | check `cmd mods list` for a load warning; the tarball must include `mods/ commands/ skills/ references/ agents/` (§1) |
| `sh: proflow: command not found` from `npx` | you ran it **inside this package's own checkout** — npx resolves the local package and finds no local `.bin`. Run from the target project, use `node scripts/install.mjs`, or an absolute `npx --yes @nntoan/proflow@<v> <cmd>` from another dir |
| Skills missing after install | `cmd skills list --debug` — usually YAML in a vendored `SKILL.md`; the sync normalises descriptions, so re-run `npm run sync` |

---

## Appendix — what the package ships

| Path | Role |
| --- | --- |
| `mods/proflow.ts` | the mod (commands, `agent_skills` tool, catalog hook, flags) |
| `commands/*.md` | the seven lifecycle workflows, read by the mod at load |
| `skills/`, `references/`, `agents/`, `docs/agents.md` | vendored agent-skills (skills patched by `scripts/patches/agent-skills.mjs`) |
| `components/magento2/` | the optional magento2 component (installed with `--component magento2`) |
| `hooks/codegraph-hook.cjs` | the CodeGraph PreToolUse/PostToolUse hook (installed with `--mcp codegraph`) |
| `scripts/install.mjs` | the `proflow` bin (`install` / `uninstall` / `status`) |
| `README.md`, `LICENSE`, `LICENSE.agent-skills`, `VENDOR.json` | docs and licenses |

Not shipped (dev-only): `scripts/lib/`, `scripts/patches/`, `scripts/sync-*.mjs`, `overlays/`,
`test/`, `docs/adr/`, `docs/verification.md`, `.github/`.
