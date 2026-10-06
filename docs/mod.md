# The proflow harness mod

The skills, commands, references and personas are native files. The mod adds the three things native
files cannot — a shell-command guard, the footer, and `/proflow` — and the installer writes it to
`.commandcode/mods/proflow.ts`.

## The dangerous-command guard

A `beforeToolCall` hook on shell commands, with three tiers checked in order — **allow beats deny beats
confirm**.

### deny — blocked outright

- recursive destroy of a root-ish target: `rm -rf` on `/`, `/*`, `~`, `$HOME`, `..`, and `sudo rm -rf`
- `find / … -delete` / `-exec rm`
- raw device or filesystem destruction: `dd … of=/dev/(sd|nvme|disk|hd|loop|rdisk)*`, `mkfs*`, `wipefs`,
  `> /dev/sd*`
- `mv / *` or `~` to `/dev/null`; `chmod -R 777 /`; `chown -R … /`
- fork bombs: `:(){ :|:& };:`
- pipe-to-shell: `curl|wget|fetch … | sh|bash|zsh`, `base64 -d … | sh`, `eval "$(curl …)"`
- covering tracks: `history -c`, `> ~/.bash_history`, `rm ~/.bash_history`
- secret exfiltration: `~/.ssh/* | curl`, `env | curl …`
- history rewrite on a protected branch: `git push --force` to `main`/`master`, `git filter-branch`,
  `git reflog expire --expire=now --all`

### confirm — asks first

A plain recursive delete (`rm -rf ./build`), `git reset --hard`, `git clean -fdx`, `git checkout -- .`,
`git restore .`, `git push --force` (any branch), `git commit|push --no-verify`, `npm publish|unpublish`,
`gh release create|delete`, `docker system prune -a` · `docker rm -f` · `docker volume rm` ·
`compose down -v`, `kubectl delete`, `terraform destroy|apply -auto-approve`,
`aws s3 rb --force|rm --recursive`, `DROP TABLE|DATABASE`, `TRUNCATE TABLE`, `DELETE FROM` with no
`WHERE`, `redis-cli FLUSHALL|FLUSHDB`, `shutdown|reboot|halt|poweroff`, `kill -9 -1`, `killall5`,
`chmod -R 777`.

A declined confirmation blocks the command and tells the model it was not confirmed.

### allow — your exceptions

Regexes that beat both tiers above.

## Your own rules

`.commandcode/proflow.jsonc` for one project, `~/.commandcode/proflow.jsonc` for all of them. JSONC —
comments and trailing commas are fine — and `$schema` is wired for editor autocomplete and validation:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/nntoan/proflow/main/packages/proflow/proflow.schema.json",
  "guard": {
    "deny":    ["\\bwire-credentials\\b"],
    "confirm": ["--force"],
    "allow":   ["rm -rf ./build"]
  }
}
```

| Layer | Read from |
| --- | --- |
| built-ins | the mod itself |
| user | `~/.commandcode/proflow.json{,.c}` |
| project | `<cwd>/.commandcode/proflow.json{,.c}` |

Later layers append; a malformed file never breaks the guard. The schema ships in the package
(`packages/proflow/proflow.schema.json`) and the installer copies the commented template into the scope
**only when no config exists yet** — it never overwrites your file.

## The footer

One segment per mod, so everything is composed into a single line:

```
proflow · cache 99.90% • avg 99.86% · off-peak (−50%) • peak in 2h 14m · next: /to-plan
```

- **cache** — the rolling cache-hit rate, computed from the token usage the harness reports per model
  request (defensive across providers, since the field names differ).
- **the cost window** — peak/off-peak state for the configured model pattern, with a countdown to the
  next flip. The rendered text never names the provider.
- **next** — the following lifecycle step. The mod learns it by watching `activate_skill`: a command
  activates its skill, the mod maps that skill to its phase, and the footer shows what comes next. It
  never inspects the command text.

The segment is **empty until proflow is actually in use** — a lifecycle skill was activated, or the
tree already holds `docs/spec/**` or `tasks/` — and is cleared at session end. On hosts without footer
rendering it falls back to a notice (`cmd.ui.capabilities.status`).

## Flags

```bash
--mod-option guard=off|deny|all          # disable · deny tier only · all tiers
--mod-option footer=false                # hide the footer segment
--mod-option next-step=false             # hide the next-step hint
--mod-option deepseek=false              # hide the cost window
--mod-option deepseek-window=01:00-04:00,06:00-10:00   # peak windows, UTC, Mon–Fri
--mod-option deepseek-model=deepseek     # model-id pattern for the cost window
--mod-option deepseek-holidays=2026-10-01,…            # extra peak dates
```

## `/proflow`

Prints the guard tier counts, the footer state, the configured cost window, and which config files
were found.

## The off-peak calendar

The cost window prices Chinese public holidays and weekends as off-peak, all day, on the China
calendar day — `[D−1 16:00Z, D 16:00Z)`. The dates live in one machine-local file,
`~/.commandcode/holidays-cn.json`, which the installer writes and `/proflow --refresh-holidays`
rewrites; the mod reads it and never opens a socket.

Shape: `{"YYYY": {"off": ["YYYY-MM-DD", …]}}` — the off dates only. A 调休 make-up working day is
never listed, and cannot cancel a weekend: the weekend rule stands regardless.

`deepseek-holidays` is **ignored**. It was registered but never read, and "extra peak dates" is
the opposite concept; the flag remains so a config that sets it is not a hard failure, and the
`/proflow` status says so when a value is present.

### The countdown is a snapshot

The row is rendered once per turn, so `peak in 96:33:00` is as old as the turn it was printed in —
up to a turn stale by the time it is read. That is accepted rather than fixed: the alternative is
re-rendering the footer or the feed row far more often than a turn, which costs more than the
staleness it removes, and the number the row reports is a *duration to the next price change*, not a
clock. It stays honest as long as nobody reads it as a timestamp.
