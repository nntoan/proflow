# ADR 0003 — Version-control identity under a Command Code profile

**Status:** accepted · **Date:** 2026-11-12

## Context

`packages/cmd-profiles` runs Command Code as more than one identity on one machine by pointing `HOME`
at a per-profile directory (spec `docs/spec/cmd-profiles/SPEC.md`, FR-001…FR-005). `HOME` is the only
relocation lever the published binary exposes, so it is not optional — a scan of every environment
variable the binary reads found no home or config-dir override, and `getSettingsUserPath` composes from
the home directory directly.

Relocating `HOME` relocates more than Command Code's state. It also relocates the version-control
identity, because that identity lives in `~/.gitconfig` and nowhere else on the target host — there is
no `/etc/gitconfig`.

The consequence was measured, not assumed, and it is worse than a failure. Under a profile home:

- `git config --global user.name` is **empty**, and the machine's `includeIf` routing is gone, because
  those rules live inside `~/.gitconfig` and a profile home has none.
- `git commit` **succeeds anyway**, exit `0`, and authors the commit as
  `Toan Nguyen <toanguye@WKMZTC87C56D.global.publicisgroupe.net>` — git's fallback to the operating
  system user's full name and `user@hostname`.

That is the dangerous shape: no error, no warning, and a wrong author written into permanent history.
Every commit made under a profile would be attributed to a generic machine identity rather than to
work or personal, silently undoing the routing the machine was configured for.

(A loud failure can be produced by setting `user.useConfigOnly=true`, which turns the fallback into
*"Author identity unknown"*. Verified. That is the honest failure mode, but it is not the default, so
the launcher cannot rely on git to notice.)

The machine's own routing is more interesting than a single identity. This host has no global
`user.name` at all; it relies entirely on `includeIf` rules keyed on the remote URL, which send personal
repositories to `~/.gitconfig-personal` and client repositories to `~/.gitconfig-digitas`. Those rules
live *inside* `~/.gitconfig`, so a profile home loses the whole routing table, not just a name.

FR-015 therefore needed a decision, and it is expensive to reverse: authorship is written into
permanent history, and a wrong choice mis-attributes every commit made on the shared host.

## Decision

**Authorship routes by repository remote URL, from the machine's own configuration. A profile never
carries, overrides, or infers a version-control identity.**

Concretely:

- The launcher does **not** set `GIT_AUTHOR_*`, `GIT_COMMITTER_*`, or `user.name`/`user.email`, and does
  not write a `.gitconfig` into a profile home. It sets the identity-neutral variables — `HOME`,
  `USERPROFILE`, `CMD_PROFILES_PROFILE`, `COMMANDCODE_SKIP_UPDATES` — plus `GIT_CONFIG_GLOBAL`, which
  points *at* the machine's configuration rather than replacing any part of it.
- Because a profile home has no `.gitconfig`, **every launch must point version control at the machine's
  configuration** so the `includeIf` routing still applies. `GIT_CONFIG_GLOBAL` is the mechanism, and it
  was verified to restore both the routing (`git config --get-regexp includeIf` returns the machine's
  rules under a profile home) and a successful commit.
- A commit in a work repository is authored as work, whoever launched the session. A commit in a
  personal repository is authored as personal. The profile is irrelevant to authorship by design.

## Alternatives considered

- **Each profile carries its own author and SSH identity.** Gives the strongest per-identity guarantee —
  work commits are always work even in a repository that would route elsewhere. Rejected as the default
  because it duplicates a routing table that already exists and is already correct, and because it makes
  every new profile a mis-attribution risk until someone configures it. It also forces SSH keys into
  every profile, which the shared host does not need.
- **Let each profile choose, defaulting to the machine's routing.** Flexible, and the tempting middle
  ground. Rejected: the failure mode is a profile that silently mis-authors commits, and the damage is
  permanent history that cannot be corrected without a rewrite.
- **Write the machine's `.gitconfig` into each profile home.** Superficially simple — `includeIf` paths
  resolve per home, so this would work. Rejected because it copies a file that then diverges: a change
  to the machine's routing would not reach existing profiles, and there would be two sources of truth
  for authorship with no way to tell which was in force.
- **Do nothing and document it.** Rejected: a commit failure on the shared host would be discovered by a
  person mid-task, and the obvious workaround they would reach for — setting `user.name` globally inside
  their profile — is precisely the mis-attribution this decision exists to prevent.

## Consequences

- **Every launch must set `GIT_CONFIG_GLOBAL`.** This is not optional polish: without it, a profile home
  has no identity, git silently falls back to `user@hostname`, and every commit is mis-attributed
  without any error. It is a correctness requirement of the launcher, and a launch that omits it is
  broken in the worst way — it appears to work.
- **The machine's `.gitconfig` is a single point of truth**, and therefore a single point of failure. If
  it is malformed or its `includeIf` rules are wrong, every profile inherits the defect. That is
  accepted: it is one place to be right rather than N places to keep in sync.
- **`HOME`-relative paths inside `includeIf` still resolve per home.** The rules use `~/`, so under a
  profile home they would point at files that do not exist there. Passing `GIT_CONFIG_GLOBAL` is what
  keeps those paths meaningful; a future change that hard-codes absolute paths in the routing would
  break this arrangement and must be caught in review.
- **SSH authentication is unaffected.** `SSH_AUTH_SOCK` is inherited unchanged, so an agent already
  running keeps working. A profile that needs a different key would need the rejected per-profile
  option, and that is deliberate scope.
- **The decision is testable and must be tested.** `test/launch.mjs` already asserts the launcher sets no
  `GIT_*` variable; the `GIT_CONFIG_GLOBAL` requirement needs its own assertion, and it must assert the
  *author of a real commit* rather than the presence of a variable — because the failure mode is a
  successful commit with the wrong author, which a presence check would not catch.
- **A silent fallback is the failure this ADR exists to prevent.** `user.useConfigOnly=true` in the
  machine's configuration converts it into a loud `Author identity unknown`. That is worth recommending
  for the shared host on its own merits, independently of this feature, because it turns a permanent
  mis-attribution into a fixable error.
- **Reversal cost.** Moving to per-profile identity later means adding a field to the registry, a
  provisioning step, and a rewrite of this ADR. It does not require changing the storage model, so the
  door is not closed — but any existing profile would need configuring before it could commit again.
