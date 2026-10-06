# Audit Dimensions

The dimension catalogue `m2-audit` fans out. Each row: what runs it, when it is included,
the `outputKind` it emits, and the model tier its dispatch pins (see `parallel-dispatch.md`).

| Dimension | Runner | Included when | outputKind | Tier |
|-----------|--------|---------------|-----------|------|
| Architecture / API review | `m2-reviewer` agent (dimension: Architecture/API) | always | `m2-review` | opus |
| Security review | `m2-reviewer` agent (dimension: Security) | always | `m2-review` | opus |
| Frontend/admin review | `m2-reviewer` agent (dimension: Frontend/admin) | a `view/`, `ui_component/`, or controller surface exists | `m2-review` | haiku |
| Testing/tooling review | `m2-reviewer` agent (dimension: Testing/tooling) | always | `m2-review` | haiku |
| Performance/ops review | `m2-reviewer` agent (dimension: Performance/operations) | always | `m2-review` | sonnet |
| Security scan | `m2-security` `scripts/build-findings.sh` | always | `m2-security` | haiku (scripted) |
| Performance scan | `m2-perf-audit` `scripts/build-findings.sh` | always | `performance` | haiku (scripted) |
| Static analysis | `m2-lint` `scripts/build-findings.sh` | always | `quality` | haiku (scripted) |
| Accessibility | `m2-a11y-audit` `scripts/build-findings.sh` | storefront `.phtml` templates present | `accessibility` | haiku (scripted) |
| Breeze compatibility | `m2-breeze-compat` `scripts/build-findings.sh` | Breeze theme active (`ctx.theme.breeze`) | `compatibility` | haiku (scripted) |
| Marketplace readiness | `m2-marketplace` `scripts/build-findings.sh` | `--release-readiness`, or the request names Marketplace/EQP | `m2-marketplace` | haiku (scripted) |

Notes:

- **Judgement vs scripted.** The five review dimensions need reasoning → `m2-reviewer`
  subagents. The scripted scanners are deterministic → run their `build-findings.sh` directly (Bash);
  they need no LLM turn and already emit JSON+SARIF.
- **Security appears twice on purpose.** The scripted `m2-security` catches CVEs, secrets,
  and cross-module patterns; the `m2-reviewer` Security dimension catches localised code
  defects (ACL/CSRF/escaping/SQL). Consolidation de-duplicates any overlap by `file:line`.
- **`--include` / `--exclude`** override surface detection; record any forced change in the report.
- All runners receive `--docs-root=<output_root>` so their artifacts collect under one folder.
