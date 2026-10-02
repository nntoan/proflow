# Releasing proflow

The workspace publishes **six packages** from one tag. Releases run over **npm trusted publishing
(OIDC)** — there is no `NPM_TOKEN` in this repository, and no long-lived secret in CI at all.

| Package | Contents | State |
| --- | --- | --- |
| `@nntoan/proflow` | the installer (`bin: proflow`) | **exists** (0.1.0, 0.1.1 published by hand) |
| `@ultra-cmd/proflow` | commands · skills · references · agents · docs · the harness mod | **new scope — first release needs Part A** |
| `@ultra-cmd/magento2` | the optional Magento 2 pack | new scope |
| `@ultra-cmd/mod-codegraph` | read-only CodeGraph tools | new scope |
| `@ultra-cmd/mod-gh` | the `gh` tools | new scope |
| `@ultra-cmd/mod-orca` | the `orca` tools | new scope |

`@nntoan/proflow` **depends on** the five `@ultra-cmd/*` packages, so publishing order matters: the
installer goes last, or a consumer can resolve it before the payloads it copies exist. The workflow
handles this; do the same when publishing by hand.

---

## Part A — the first release of `@ultra-cmd`

A trusted publisher can only be configured on a package that **already exists**, so each new package
needs one manual publish first. This is the only part of the process that needs `npm login`.

### A1. Make sure the `@ultra-cmd` scope exists

An npm scope is either your username or an **organization**. `@ultra-cmd` is not a username, so create
the organization once at [npmjs.com/org/create](https://www.npmjs.com/org/create) — free for public
packages — and make sure your account is its owner (or a member with publish rights).

Then log in locally:

```bash
npm login          # 2FA prompts as usual; creates ~/.npmrc credentials
npm whoami         # must print your npm username
```

### A2. Publish the first version of each new package by hand

The version in the manifests is the one you are releasing. Payloads first, installer last:

```bash
npm install                                        # link the workspaces
npm test                                           # all six must be green
npm publish --access public --workspace @ultra-cmd/proflow
npm publish --access public --workspace @ultra-cmd/magento2
npm publish --access public --workspace @ultra-cmd/mod-codegraph
npm publish --access public --workspace @ultra-cmd/mod-gh
npm publish --access public --workspace @ultra-cmd/mod-orca
npm publish --access public --workspace @nntoan/proflow   # last: it depends on the five above
```

Notes:

- `--access public` is **required** for a scoped package; without it npm assumes private and the
  publish fails.
- These first publishes carry **no provenance** — a local publish cannot sign. They start with the
  first CI release (Part B).
- A brand-new package name can 404 for a few minutes afterwards (`npm view` → `E404`); the registry CDN
  caches the miss. It clears on its own; it is not a broken publish.

### A3. Configure a trusted publisher for every package

For **each** of the six packages: npmjs.com → the package → **Settings** → **Trusted publishing** →
GitHub Actions, then:

| Field | Value |
| --- | --- |
| Organization or user | `nntoan` |
| Repository | `proflow` |
| Workflow filename | `release.yml` (the filename only — it must exist in `.github/workflows/`) |
| Allowed actions | tick **Allow npm publish** |

Two things to know:

- **The checkbox matters.** Since 2026-09-03, new trusted-publisher configurations are created
  **stage-only** (they may run `npm stage publish`, not `npm publish`). Left unticked, the workflow
  fails at publish time with `ENEEDAUTH`.
- A configuration **cannot be edited** after creation — to change it, delete it and add a new one.
  All fields are case-sensitive, and npm does not validate them when you save.

### A4. Verify the OIDC path with the next tag

Bump to the next patch (Part B), push the tag, and watch the workflow publish over OIDC with no token.
Confirm the attestations landed:

```bash
npm view @ultra-cmd/proflow@<version> dist.attestations
# { url: 'https://registry.npmjs.org/-/npm/v1/attestations/…',
#   provenance: { predicateType: 'https://slsa.dev/provenance/v1' } }
```

### A5. Then lock it down

Only after A4 succeeds, per package: Settings → **Publishing access** → *Require two-factor
authentication and disallow tokens* → Update. This restricts token authentication only; trusted
publishers keep working. Then revoke any automation tokens you no longer need.

---

## Part B — every release after that

### B1. Prepare

```bash
npm install
npm test                                # five suites
npm pack --dry-run --workspaces         # every package must carry what it loads at runtime
```

Check the version in the root `package.json`, the six package manifests, and
`packages/proflow/VENDOR.json` (re-run `npm run sync` if upstream moved — review that diff).

### B2. Bump and tag

One command bumps the root and every workspace, without committing or tagging:

```bash
npm version 0.1.3 --workspaces --include-workspace-root --no-git-tag-version
git add -A && git commit -m "chore(release): 0.1.3"
git tag v0.1.3
git push --follow-tags
```

The tag must match the **root** version — the workflow fails otherwise.

### B3. What the tag does

1. asserts `npm >= 11.5.1` (the OIDC requirement — Node 24's bundled npm satisfies it);
2. verifies the tag against the root version;
3. runs the tests;
4. publishes **every workspace package whose exact version is not on npm yet** — payloads first,
   `@nntoan/proflow` last — each authenticated by its own short-lived OIDC token;
5. cuts a GitHub release with generated notes.

Re-running is safe: anything already published is skipped. Provenance is generated automatically under
trusted publishing, and the workflow passes `--provenance` anyway — that is redundant while the repo
and packages are public, but it makes a release **fail** if an attestation cannot be produced instead
of publishing silently unsigned.

---

## Troubleshooting

- **`ENEEDAUTH` / "Unable to authenticate":** the workflow filename does not match what you configured,
  `id-token: write` is missing, the runner is not GitHub-hosted, or *Allow npm publish* was never
  ticked.
- **`repository.url` must match the GitHub repository** exactly, or the publish is rejected. All six
  packages point at `git+https://github.com/nntoan/proflow.git`.
- **No token means no private reads.** The "already published → skip" check is a public,
  unauthenticated `npm view`, which works for our packages. If a private dependency is ever added, that
  install step needs a read-only token while publishes stay OIDC.
- **Publishing from inside this repository fails** (`sh: proflow: command not found`): npm resolves the
  local package and finds no local `.bin`. Use `npm run proflow:install`.
- **`npm pkg fix` strips `./`** from the `bin` path; harmless, but re-run `npm test` after it.

## Drift

`.github/workflows/sync-drift.yml` re-vendors both upstreams weekly and fails if the committed tree
would change. A failing run means: run the sync locally, review the diff against `patches/*.mjs`
(a rule that no longer matches fails loudly), run `npm test`, and open a re-vendor PR.
