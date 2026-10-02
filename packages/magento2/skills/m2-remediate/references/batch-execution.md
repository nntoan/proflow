# Batch Execution

How a batch is presented, executed, and accounted for. The **plan** decides what the batches
are; this document decides how they run.

## The order is a dependency order

The authoritative order travels in the plan's `batches[]`, and it is defined once in
`triage/references/plan-format.md`. It is **not** re-derived here and must not be
re-sorted — but executing it well means knowing what each position is protecting, because a
run that reorders "just this once" pays for it in re-churn or a lost fix:

| # | Batch | What breaks if it runs later |
|---|---|---|
| 1 | `m2-upgrade` | It rewrites call sites. Run it after `m2-fix` and every behavioural patch is written against the old API, then patched a second time by the migration. |
| 2 | `m2-fix` | Behavioural and security defects, applied to the *migrated* code. Run it before `m2-upgrade` and its regression tests encode the pre-migration signature. |
| 3 | structural owners (`m2-extension-point`, `m2-indexer`, `m2-message-queue`, `m2-webapi`, `m2-graphql`, `m2-admin-form`, `m2-admin-listing`, `m2-system-config`, `m2-data-migration`, `m2-feature`) | New surfaces produce new strings, new templates and new code paths. Running them after `m2-i18n`, `m2-test-generate` or `m2-lint` means those three ran against code that no longer exists. |
| 4 | `m2-frontend` / `m2-breeze-adapt` | Same argument, one layer out: the templates these produce are what `m2-i18n` extracts from and what `a11y` findings were raised against. |
| 5 | `m2-i18n` | Extraction is only complete once **every** user-facing string the run will produce exists. Run it early and the phrases added by batches 3–4 are simply missing from the CSV. |
| 6 | `m2-test-generate` | Tests are written against final code. Run it earlier and it tests an intermediate state, then fails in the same run that produced it. |
| 7 | `m2-lint` | **Last.** It formats everything the run produced and catches style the remediation itself introduced. Run it first and every later batch re-dirties what it just fixed. A Critical `m2-lint` finding still runs last — severity sets order *within* a batch, never between batches. |
| 8 | `m2-docs` | Regenerates module documentation from the finished code, picking up what the run changed. |

An owner the list does not name is a structural owner (position 3): specialist work that
should neither jump ahead of `m2-upgrade` nor trail behind `m2-lint`.

## Presenting a batch

One message, then **one approval**. It carries:

- the batch sequence, the owner skill, and the gate (`auto` / `batch` / `manual`);
- per finding: severity, title, `file:line` evidence, fingerprint (short form is enough), and
  a one-line **drafted intent** taken from the finding's `recommendation`;
- the `verification` that will decide whether each finding closed;
- any `gate: manual` item, called out as a human action with what the human must actually do;
- what will be committed — one commit per finding.

Do not ask per finding, and do not re-present the same batch after a partial failure. The
approval covers the batch as presented; a finding that turns out to need more than its
evidence describes is `deferred`, not re-negotiated mid-batch.

An `auto` batch under `--yes-auto` is announced, not asked. A `manual` batch is never
executable, so it is reported rather than gated.

## The per-finding invocation contract

Every invocation carries the **same four things**, because the point of routing is that the
owning skill starts from the diagnosis instead of re-deriving it:

1. the plan (or source report) path and the finding id,
2. the `fingerprint`,
3. the `file:line` evidence and snippet,
4. the `--docs-root` of this run.

| Owner | Invocation |
|---|---|
| `m2-fix` | `fix --from-finding=<plan.json>#<finding-id> --docs-root=<root>` — see `fix/references/from-finding.md`. Its RCA gate is delegated **upward** to the batch gate; it does not re-prompt. |
| `m2-upgrade` | The upgrade skill with the finding's target version constraint and evidence. |
| `m2-lint` | The lint skill scoped to the finding's file (`auto` gate; safe auto-fixes only). |
| `m2-extension-point`, `m2-indexer`, `m2-message-queue`, `m2-webapi`, `m2-graphql`, `m2-admin-form`, `m2-admin-listing`, `m2-system-config`, `m2-data-migration` | The generator, with the evidence and `recommendation` as its requirement, on the **project** module — never on the file under `vendor/` the finding points at. |
| `m2-frontend`, `m2-breeze-adapt` | The frontend owner with the template/asset evidence; `m2-breeze-adapt` builds the companion module and never edits the target. |
| `m2-i18n`, `m2-test-generate`, `m2-docs` | Scoped to the module the run touched, once, at their batch position. |
| `inline` | No sub-skill owns it: a metadata or packaging edit this skill makes directly, under the same commit rule. |
| `none` / `unrouted` | Not executable. Reported, never executed. |

A vendor-path finding is **never** patched in place. The remediation is a plugin, observer or
preference in a project module, and the commit records which module took it.

## Failure policy

No silent passes. The run records what happened and keeps going.

| Situation | Recorded as | Run continues? |
|---|---|---|
| Change landed, `verification` passed | `closed` | yes |
| Change landed, `verification` failed | `still-open`, with the command and its output | yes — next finding |
| Owning skill ran but produced no change addressing the evidence | `still-open`, with what it reported | yes |
| Finding needs more than its evidence describes | `deferred`, with what it would take | yes — nothing is committed |
| Owning skill unavailable or refuses | whole batch `skipped`, with the reason | yes — next batch |
| `gate: manual` | `pending-manual` | yes — never executed |
| Commit rejected by a hook | Fix the cause, re-stage, commit again with the same message (never `--no-verify`, never amend). Three consecutive failures → `still-open` and move on. | yes |
| Working tree dirty at start | The run does not start | no |

A `skipped` batch is the one outcome that is easy to mistake for success, because nothing
failed — nothing ran. It is never counted clean, and it is reported with the same prominence
as a failure: an absent result is not a result.

`audit --compare` is what proves the outcome. A finding this run called `closed` that still
appears in the closure diff's `still_open` bucket means the verification was too weak, and the
report says so rather than trusting this skill's own bookkeeping.
