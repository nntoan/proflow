---
description: Run Command Code as a named profile — list, create, adopt, revoke, or launch one
---

Invoke `cmd-profiles` for what the user asked, and stop.

- To see or audit profiles: `cmd-profiles list` and `cmd-profiles diagnose`.
- To create one: `cmd-profiles provision --name <name> --owner <text>`.
- To adopt an existing setup: `cmd-profiles adopt --name <name> --owner <text> --dry-run` first.
- To launch: `cmd-profiles run --profile <name>`.
- For an unattended launch (script, cron, CI): `cmd-profiles run --profile <name> --require-auth`, which
  exits `4` instead of starting a session with no credential. Never use `--require-auth` for a person's
  first sign-in — that launch must be able to start so they can authenticate inside it.
- To remove someone: `cmd-profiles revoke <name> --access` (keeps history) or `--history --yes`.

A launch with no resolvable profile **fails** (exit 2) rather than falling back to `~/.commandcode`.
When you report that failure, do not suggest unsetting the profile selection to "get it working" — the
fallback is the bug this tool exists to prevent.

Profiles separate identities inside one operating-system account. They guard against mistake, not
against a colleague with file access. Say so if the user assumes otherwise.
