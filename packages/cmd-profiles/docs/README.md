# cmd-profiles

Run Command Code as more than one identity on one machine.

A **profile** is a named bundle of one Command Code home directory. Command Code resolves its
credential, configuration, hooks, installed content and session history from its home, and exposes no
per-setting override — so the home is the unit of separation, and a profile is a home plus a name.

## Identity is isolated; capability is shared

Your `work` and `personal` profiles are different *identities*, not different *toolboxes*. Provisioning
links the machine's installed content into the profile, and withholds everything that identifies you:

| Shared from the machine | Withheld, per profile |
|---|---|
| `skills`, `mods`, `agents`, `commands` | `auth.json` (and `.local` / `.staging`) |
| `references`, `docs`, `hooks`, `scripts` | `config*.json`, `settings*.json` |
| both `~/.commandcode/` and `~/.agents/` | `sessions`, `projects`, `file-history`, `plans`, `caches`, `taste` |

A skill added to the machine appears under every profile without re-provisioning. `settings.json` stays
per profile because it carries hook commands as absolute paths and permission grants — an execution
surface, not preferences.

See `cmd-profiles list --shared` for what a given profile actually links, and `cmd-profiles diagnose` for
dangling links and share gaps.

**One accepted limitation**: sharing means one skill version per machine. Two people cannot run different
versions of the same skill. Silent per-profile divergence would be the worse failure.

## What this does, and what it does not

Profiles separate Command Code identities inside one operating-system account. They guard against
mistake and accident — a session inheriting the wrong home, or a credential being used by the wrong
person. **They are not a security boundary between colleagues:** anyone who can read the profile
directories can read another profile's files. If you need that, give each person their own
operating-system account.

This is not a limitation to work around; it follows from the operating system. Under one shared account
every profile belongs to the same user, so no permission bit separates them. A `0600` credential is
still readable by that user — verified, not assumed.

## Install

`cmd-profiles` is a separate package with its own command. Install it directly:

```sh
npm install -g @ultra-cmd/cmd-profiles
```

That puts `cmd-profiles` on your `PATH`. To run it once without installing:

```sh
npx @ultra-cmd/cmd-profiles provision --name work --owner "you at work"
```

**`npx @nntoan/proflow install` does not install this launcher.** That command provisions the
agent-skills pack into `.commandcode/`; it deliberately makes no global changes, so it does not link a
`bin` onto your `PATH`. If you want both, run both.

## Use

```sh
# create two identities
cmd-profiles provision --name work     --owner "you at work"
cmd-profiles provision --name personal --owner "you at home"

# authenticate each with its own account, inside its own profile
cmd-profiles run --profile work        # then authenticate in that session
cmd-profiles run --profile personal

# see what exists
cmd-profiles list
cmd-profiles diagnose
```

Both sessions can run at once. Each writes only to its own home.

### Resolution

A launch picks a profile in this order, and **fails** if none applies:

1. `--profile <name>`
2. `CMD_PROFILES_PROFILE`
3. the machine default, set with `cmd-profiles use <name>`
4. error, exit `2`

There is no fallback to `~/.commandcode`. A fallback would run your session as whoever owns that home,
which is exactly the confusion this tool exists to prevent.

### Adopting an existing setup

If you already use Command Code, record that home as a profile instead of starting over:

```sh
cmd-profiles adopt --name default --owner "you" --dry-run   # look first
cmd-profiles adopt --name default --owner "you"
```

Nothing is moved or copied — the registry stores a path. `--dry-run` writes nothing at all.

### Revoking

Access and history are separate decisions:

```sh
cmd-profiles revoke alice --access    # delete the credential, keep the transcripts
cmd-profiles revoke alice --history --yes   # delete the profile directory and the record
```

`--access` is what you want when someone leaves but the record may matter later. `--history` refuses
while the profile is the default, and refuses without `--yes` when the directory is not empty.

## On a shared host

The intended setup is a Mac Mini running `orca serve`, with each person pairing their own Orca to it:

```sh
# on the host, once per person
cmd-profiles provision --name ada --owner "Ada"

# the person authenticates on the host, in their own profile
cmd-profiles run --profile ada

# and a launch from the host's Orca runs their profile
orca terminal create --title "CC: ada" --command "cmd-profiles run --profile ada"
```

See [orca.md](./orca.md) for why the launch is a command string rather than a flag.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | success |
| `2` | no profile resolved, or the named profile does not exist |
| `3` | the profile is revoked |
| `4` | the profile is not authenticated — **only** with `run --require-auth` |
| `5` | the Command Code binary could not be found |

### Unattended launches: `run --require-auth`

A launch is normally how a person *reaches* a profile they have not signed in to yet, so a missing
credential only warns and the session starts. A script or cron job cannot read that warning, so it
would carry on with a session that can do nothing:

```sh
cmd-profiles run --profile work --require-auth    # exits 4 instead of starting
```

| Situation | Without `--require-auth` | With `--require-auth` |
|---|---|---|
| Profile has a credential | starts | starts |
| Profile has no credential | warns on stderr, starts anyway | **exits `4`**, names the profile |

Use it for anything unattended. Do not use it for a person's first login — that launch has to start so
they can authenticate inside it.

## Environment

| Variable | Purpose |
|---|---|
| `CMD_PROFILES_ROOT` | where profiles and the registry live; defaults to `~/.cmd-profiles` |
| `CMD_PROFILES_PROFILE` | the profile to use when `--profile` is absent |
| `CMD_PROFILES_BIN` | the Command Code binary; defaults to `commandcode` on `PATH` |

A launch sets `HOME` (and `USERPROFILE`) to the profile's home, records `CMD_PROFILES_PROFILE`, and
sets `COMMANDCODE_SKIP_UPDATES=1` so provisioning one person cannot silently change the version another
person runs. Everything else — `PATH`, `SSH_AUTH_SOCK`, `TERM` — is inherited unchanged.