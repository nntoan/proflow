# Running profiles on a shared Orca host

How `cmd-profiles` sits under Orca on a Mac Mini that several people pair into.

## Why the launch is a command string

`orca terminal create` accepts `--worktree`, `--title`, `--command`, `--shell`, `--focus` — and **no
environment flag**. `orca agent launch` has none either. So the environment a session runs under has to
be established by whatever `--command` executes.

That makes the launch:

```sh
orca terminal create --title "CC: ada" --command "cmd-profiles run --profile ada"
```

`cmd-profiles run` sets `HOME` to that profile's directory and then `exec`s Command Code. Verified with
the real binary: a session under profile `ada` writes its state into `profiles/ada/.commandcode/`, and
`profiles/bob/.commandcode/` stays untouched.

## Why not `orca agent launch`

Orca's managed accounts cover Claude, Codex, OpenCode and Devin — `orca account add --agent
claude|codex|opencode|devin`. Command Code is not among them, so there is nothing to select there. For
OpenCode, Orca solves the same problem by running `opencode auth login --standalone` in private XDG
directories; this package is the equivalent for Command Code, which exposes no such switch (see the
spec's Appendix A).

## Operator setup

```sh
# 1. once per person, on the host
cmd-profiles provision --name ada --owner "Ada Lovelace"

# 2. the person authenticates as themselves, in their own profile
cmd-profiles run --profile ada        # then authenticate inside that session

# 3. confirm
cmd-profiles list
cmd-profiles diagnose

# 4. the Orca runtime that paired clients reach
orca serve service install            # a per-user background service that restarts itself
```

A paired client then reaches the profile with the launch string above, or with `orca agent launch`
if their client is configured to run the launcher.

## When someone leaves

```sh
cmd-profiles revoke ada --access      # credential gone, transcripts kept for audit
cmd-profiles diagnose ada             # reports: revoked
```

The next launch exits `3` and names `ada`. Delete the history only when it is genuinely not needed:

```sh
cmd-profiles use --clear              # required first, if ada was the default
cmd-profiles revoke ada --history --yes
```

## What Orca does not give you

`orca serve service install` writes a service *for the current operating-system user*. Orca has no
multi-tenant concept — a search of its full command schema finds no notion of tenants or per-user
isolation. The separation between people therefore comes from this package and from the operating
system, not from Orca.

Under one shared macOS account that means the separation is a guard against mistake, not a boundary
against a colleague. See the notice in `../docs/README.md`.

## Reboot survival is Orca's job, not this package's (FR-012)

`SPEC.md` FR-012 requires the host to come back to a working state after a reboot without each person
re-pairing. **This package implements none of that**, and should not: the profiles are directories on
disk and the registry is a file, both of which survive a reboot by existing. What has to come back is
the *runtime*, and that is `orca serve`.

The dependency, stated so it is not discovered during an outage:

```sh
orca serve service install     # a per-user background service that restarts itself
orca serve service status      # confirm it came back after a reboot
```

Two properties of that service matter here:

- It runs `orca serve --supervise --no-pairing` for the current OS user, so the runtime returns without
  intervention but **never prints a pairing link to its log** — pairing still happens from the desktop
  app, or from `orca serve` in a terminal while the service is stopped.
- It gives up after six failures in fifteen minutes and exits, rather than restarting forever. After
  that, later supervised runs refuse until a new build is installed or `--force` is passed. So
  "the host is back" is a thing to *check*, not assume.

**Status: unverified.** Nothing in this repository tests reboot survival, because it needs a real
reboot on the real host — task **T038** in `docs/spec/cmd-profiles/tasks.md`. Until that runs, FR-012
must not be reported as met.
