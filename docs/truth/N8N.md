# n8n — current truth

> Last verified: 2026-07-14 @ e3961b6 (live configuration/execution readback + second-pass reconciliation)
> Live facts from `docs/audits/2026-07-05-n8n.md` (verified 2026-07-05) unless noted.
> n8n remains load-bearing for many unmigrated readers/writers and as dormant Track-A fallback;
> full-active-roster Calendar/SXR/settings writes now use Edge Functions. Snapshot workflows
> privately plus a public-safe `n8n-backups/` stub before any change (`ROLLBACK.md` rule 2).

## Inventory

The app-facing webhook surface (55 endpoints) is enumerated and machine-enforced in
`docs/truth/ENDPOINTS.md`. A 2026-07-14 live census found 92 workflows, 77 active; 75 of the 77
active graphs were readable and 34 matched fan-out/catch/continue-risk heuristics. Two already-known
monitor/relay graphs could not be detailed through the live tool and remain explicit gaps. Deep
historical per-workflow reads: `docs/audits/2026-07-05-n8n.md`.

## Known state (spot-verify before relying — n8n changes outside git)

- Inbound Linear sync workflow `MJbMZ789B5ExZz9x` is **inactive/unpublished**
  (`activeVersionId=null`). Its five-node saved graph contains the A1/A2 routing and the later
  authority gates, but that graph is not serving traffic. A 24-execution crash cluster ended before
  the last saved version and no later execution was present at the 2026-07-13 readback. Do not call
  Calendar/Samples/Workload inbound "real-time" and do not publish this saved graph as an automatic
  fix: first explain the crash/soft-error topology, then deliberately choose and drill either a
  published fast path or the existing reconciler-only latency.
- The old dedicated Samples n8n trigger (`ZJOtYpQZj73DcBB1`) remains inactive, but Samples drift
  protection is **on twice**: pager `qllIDZPkdNAPRj0b` dispatches the GitHub workflow every 15
  minutes and `sample-linear-reconcile.yml` still has its own `*/10` schedule. Recent executions
  contain both trigger types. Remove one cadence (not both), retain the monitored healer, and prove
  the post-cut 24-hour execution rate (audit F01).
- `linear-set-status` is the only n8n dueDate writer (+2d when overdue, on every call). The
  nightly due-date roller is NOT in n8n (see `docs/truth/LINEAR.md`).
- VIDEO PRODUCTION AUTOMATION ground truth: "Pick Freest Editor" = fewest open sub-issues
  among Video Editors-tab emails (ties by API order); graphic-form assigns a hardcoded single
  designer; the AI-thumbnail chain is **disconnected dead code** — don't budget a port.
- Historical 2026-07-05 sizing was ~25 calendar upserts, ~41 set-status, and ~27 inbound Linear
  events/day across the then-current topology. Do not use the inbound count as current n8n traffic:
  B3 now enters through the Edge Function and the legacy n8n receiver is inactive (F46).
- The weekly backup runs on schedule, but **green is not complete** (F13). Ten critical nodes
  continue after copy/download/export/dump/upload errors; builders serialize whatever arrived and
  explicitly substitute empty arrays for missing/failed table dumps. There is no expected-corpus
  manifest, checksum/readback, complete pointer, or restore proof. It is neither independent of n8n
  nor a valid D-1 restore gate.
- Provider sales callbacks are unsafe (F115/F116): neither has a provider-native verified,
  server-correlated durable inbox; the mirrored stale-snapshot two-gate logic can lose or duplicate
  the onboarding email.
- Primary onboarding is not just public capture (F128/F129). An unauthenticated submission can
  launch real Drive/CRM/Slack/vault side effects without a verified-sale/staff-approval job, and the
  current full-brief builder sends raw account-access answers to a workspace-public channel or
  fallback DM. Split/authorize provisioning and structurally exclude secret fields; do not run a
  fake-client drill until provider sandboxes and captured inverses exist.
- Project Central's active load/save API can turn a failed source tab into a valid partial tree, then
  clear all three live sheets before validating/reappending; its webhooks authenticate no caller and
  it has no revision/staging/transaction/restore receipt. Keep it out of recovery workflows until
  the destructive partial-replacement finding closes.
- Client analytics collectors can publish provider/state failures as zeros, stale values, or
  incomplete platform coverage while the workflow remains successful. Treat Metrics/Top Videos as
  degraded unless per-client/platform coverage receipts distinguish valid empty from source failure.
- The active Linear Sub-Issues reader and retained `/add-to-calendar` branch do not page children
  (or nested comments), reject partial GraphQL envelopes, or publish a completeness receipt. Their
  outputs currently drive Calendar import/link/status or legacy Sheet writes. Treat `ok:true` and a
  green execution as incomplete until F126's exhaustive-page/zero-mutation contract is proved.
- The central error-DM workflow is **not** blanket-wired (F09). In the 2026-07-14 live sample, five
  of six load-bearing cutover workflows had no `errorWorkflow`; three of those unwired workflows
  had 135 error/crash/cancel records since Jul 7. The handler also failed 29 of 30 sampled
  invocations while the execution limit was active. Do not treat the handler's existence or a quiet
  DM channel as coverage; require a complete active-workflow settings census, one sanitized TEST
  receipt per workflow, and a non-n8n liveness path.

## Standing hazards

- **Hardcoded credentials inside workflows:** the house Linear key remains embedded across legacy
  bridges. A plaintext provider key documented in the July 5 audit remains in the live Graphics
  title-generation workflow and all 50 retained versions (F52). Restrict workflow/history/export
  access immediately; stage and TEST-prove a managed replacement for the known live branch; owner
  revoke/rotate; then finish the complete version/export/backup/provider census while monitoring for
  an unknown consumer. Never place a value in this repository.
- Raw workflow JSON is not in git. The private weekly backup corpus holds the unredacted all-workflow
  exports; n8n retains its own version history; public `n8n-backups/` files are status stubs only.
  Snapshot before touching and use `ROLLBACK.md` for the restore contract.
- Reachable legacy Calendar/SXR/settings write fallbacks remain unauthenticated through B5 (F67).
  Routing a client back to n8n or calling a webhook directly can bypass later Edge Function auth.
  Authenticate/scope each fallback or retire it before enforcement; rollback must preserve the same
  principal/client boundary.
- Four active Linear mutation routes are also caller-unauthenticated (F91): status, comment, video
  intake, and graphics intake. Their `prod_authority` check constrains direction only; both teams are
  presently Linear-authoritative. Contain them now with active immutable principal or a short-lived
  exact-client intake capability, then complete the native reroute and retirement plan.
