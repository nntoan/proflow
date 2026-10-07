# Spec: Footer and session state across a reload

## Objective

The proflow footer is one status line owned by the mod process. `/reload` and `--resume` replace that
process, so the line is cleared and must be rebuilt from whatever survives — and the session counters, which
exist precisely to survive, must not restart at zero.

This spec records the behaviour as shipped (0.1.18) and the measurements that decided it, so a future change
can be judged against facts rather than re-argued. It is a spec of record, not a proposal: everything below
is implemented and verified.

**Who it is for:** anyone reading the footer to decide whether to spend now, and anyone changing how the mod
persists or paints state.

## Segments, and what each one is

| Segment | Shows | Survives a reload? |
|---|---|---|
| `model (effort)` | the session's model, with effort in parentheses | **yes** — session-stable |
| `ctx Nk (x%)` | the last known prompt size, as tokens and as a share of the model's window | **yes** — no request has moved it |
| `cache x%` | the cache share. Session state, not per-turn | **yes** |
| `avg x%` | the session-wide cache share (`sessionRead / sessionTotal`) | **yes** — the counters |
| `$x.xxxx/turn` | **this** turn's spend | **no** — deliberately |

A segment is emitted only when its value is known. A fresh process therefore renders a shorter line, not a
line full of zeros.

## Why the cache share survives a reload, and the cost does not

A provider cache is prefix-keyed, and the conversation is unchanged by a reload. Measured with a headless
run against an existing session (`cmd -p --continue`, `--output-format json`):

```
process 1 (fresh session)        req 1 read% 21.7    req 2 read% 98.9
process 2 (--continue ≡ reload)  req 1 read% 99.3    cacheWrite 0
```

A new process read **99.3%** of its first request from cache with `cacheWrite` at zero: the prefix survived
the process boundary intact. An earlier 20-turn run showed 828,800 of 887,359 input tokens as cache reads
(93.4%), and 99.6% on the turn immediately after the `onStop` gate appended its reason.

So the cache share describes **the session**, which a reload does not change — blanking it reads as a lost
cache when nothing was lost. The turn's cost is different: it is a spend this process never made, and
restoring it would state something untrue. It appears with the first turn.

The one thing not established: the provider's cache has a TTL. After a long pause an entry may expire
regardless of the bytes, which is indistinguishable from a genuine prefix change without a hash — hence
`/proflow --context`.

## State: one object

`cmd.session` is **undefined while the factory runs** and bound only afterwards. Measured headless:

```
factory                    session=undefined
first turn_start           session=bound, entries present
```

Consequences, and the rules that follow:

1. **Nothing may be seeded at load.** Seeding runs lazily — on the first turn, or the first usage report,
   whichever comes first — and only once, so a later turn cannot clobber the running totals.
2. **The footer is painted on `session_start`**, the documented moment the harness binds the host, because a
   footer segment belongs to the process that registered it. Painting only from model events left the footer
   dark until the first request.
3. **Session-stable state is one object**, `proflow/session` = `{model, effort, context, cache}` — one write
   site, one read site. Adding a field is a property, not new plumbing; per-field plumbing is how `effort`
   was silently lost. The counters keep their own `proflow/cache` = `{read, total}` entry, whose shape a test
   pins.
4. **The facts are written as soon as they are known**, not only at `turn_end`, so a single turn makes them
   restorable.

## Acceptance criteria

1. After a completed turn, then `/reload`, the footer shows `model (effort) · ctx Nk (x%) · cache x% ·
   avg x%` — with the cache share carried across, not blanked.
2. `$x.xxxx/turn` is absent immediately after a reload, and appears once a turn has run in the new process.
3. The seeded model, effort, context and cache come from the session's own entries; a session with none —
   e.g. the first reload after upgrading from a build that did not write them — renders only the segments it
   has, which is `avg` when the counters are the only prior state.
4. `/proflow --context` reports the session facts (model, effort, context, cache, avg) alongside the
   per-process round count and prefix hash, and states that rounds are per-process — so a zero after a
   reload reads as expected rather than broken.
5. `/proflow --context` captures the prefix through `transformContext` and returns the message array
   **unchanged, same reference** — the documented no-change signal. Anything else would move a byte inside
   the cached prefix and is forbidden.

## Evidence trail

- Headless boundary measurement: 99.3% cache read on a new process, `cacheWrite` 0.
- Headless 20-turn run: 93.4% cache reads overall; 99.6% on the turn after the gate appended its reason.
- Headless session probe: `session=undefined` in the factory, bound at the first `turn_start`.
- Live session, 0.1.18: `deepseek-v4.1-flash (high) · ctx 409k (40.9%) · cache 99.95% · avg 90.84%` after a
  reload.

## Non-goals

- **Not** a claim about the provider's TTL behaviour; only that a reload alone does not cost the cache.
- **Not** a re-pricing of anything — the cost estimator replicates the harness's own, unchanged.
- **Not** an attempt to restore per-turn figures. Cache share and cost are separated on the rule that a
  figure is restored only when it remains true.
