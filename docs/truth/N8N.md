# n8n — current truth

> Last verified: 2026-07-20 @ 09e3dd6 (F124 CLIENTS METRICS live receipt/coverage/quota proof; other statements retain their dated sources)
> Live facts from `docs/audits/2026-07-05-n8n.md` (verified 2026-07-05) unless noted.
> n8n remains load-bearing for many unmigrated readers/writers and as dormant Track-A fallback;
> full-active-roster Calendar/SXR/settings writes now use Edge Functions. Snapshot workflows
> privately plus a public-safe `n8n-backups/` stub before any change (`ROLLBACK.md` rule 2).

## Inventory

The app-facing webhook surface (55 endpoints) is enumerated and machine-enforced in
`docs/truth/ENDPOINTS.md`. A 2026-07-14 live census found 92 workflows, 77 active; all 77 active
graphs are now structurally readable; at least 34 matched fan-out/catch/continue-risk heuristics.
Structural coverage is not health proof. The combined pager/orchestrator has stop-on-error branch
coupling and deterministic false-green conditions (F132). The Edge Alert Relay acknowledges before
downstream Slack delivery and lacks authenticated, versioned source contracts (F09/F66/F81).
Neither graph directly calls Linear. Deep historical per-workflow reads:
`docs/audits/2026-07-05-n8n.md`.

## Known state (spot-verify before relying — n8n changes outside git)

- Inbound Linear sync workflow `MJbMZ789B5ExZz9x` (`SyncView Calendar - Linear Status Sync`,
  the `/webhook/linear-status-sync` intake carrying the calendar handler + workload branch +
  embedded samples handler) is **inactive/unpublished** (`activeVersionId=null`) and its Linear-side
  doorbells are now **gone**: the workflow's executions crashed 2026-07-12 ~23:03Z, it was
  deactivated 2026-07-13 02:15Z, Linear auto-disabled its two delivery webhooks (labels "Workload"
  and "Workload — Graphics") on 2026-07-17 after four days of failed deliveries to the dead
  endpoint, and the owner deleted both webhook registrations on 2026-07-18 so the mirror
  webhook-health monitor reads clean (2 checked / 2 enabled — only the EF `linear-inbound` pair
  remains registered). **Inbound instant sync is therefore retired de facto**: Calendar, Samples,
  and Workload inbound all ride the reconcilers (10–15 min lag — status reconcile */15, samples
  */10 + pager, Workload reconcile */10), which carried the system unaided 07-13 → 07-18 including
  through the 2026-07-17 Linear API outage. Do not call inbound "real-time". Revive-vs-formally-
  retire is a Phase-3 decision: reviving requires explaining the crash topology, republishing, and
  re-creating the Linear webhooks (~1 min each); retiring means the EF inbound lane becomes the
  only fast path at enrollment.
- The old dedicated Samples n8n trigger (`ZJOtYpQZj73DcBB1`) remains inactive, but Samples drift
  protection is **on twice**: pager `qllIDZPkdNAPRj0b` dispatches the GitHub workflow every 15
  minutes and `sample-linear-reconcile.yml` still has its own `*/10` schedule. Recent executions
  contain both trigger types. Until F132 closes, retain the independent schedule because Samples is
  the pager's last stop-on-error branch. If reducing burn first, remove the pager dispatch (not both),
  retain independent observation, and prove the post-cut 24-hour execution rate (audit F01).
- `linear-set-status` is the only n8n dueDate writer (+2d when overdue, on every call). The
  nightly due-date roller is NOT in n8n (see `docs/truth/LINEAR.md`).
- VIDEO PRODUCTION AUTOMATION ground truth: "Pick Freest Editor" = fewest open sub-issues
  among Video Editors-tab emails (ties by API order); graphic-form assigns a hardcoded single
  designer; the AI-thumbnail chain is **disconnected dead code** — don't budget a port.
- F44 server containment is live on VIDEO PRODUCTION AUTOMATION workflow
  `BrJSe8zCKUccfmIq`, active version `f6a5ca07-e7a7-4a41-a3d3-3638a682b596`. Intake now
  persists an idempotent Supabase receipt before work, strictly preflights exactly one project plus
  SMM credential, filming plan and roster, and returns success only after exact parent/child create
  confirmation. Bounded retry and payload-bearing dead-letter/replay support partial-create operator
  recovery. Safe malformed probes `268305` and `268306` returned 400 before receipt/create; live
  receipt rows remained zero and no work was created. This is server containment, not full closure:
  the awaiting/draft-preserving browser change remains owner-merge/deploy required. The retained
  rollback version is `d867fa43-2ab2-44a4-93c8-57254846ca1c`; restoring it reopens early success.
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
- `CLIENTS METRICS` workflow `Q4n1bagJYBkurEaI` is active at
  `b92fb693-1dd4-4ce2-a60e-98a1701c369d`; retained version
  `fb180e5f-79ee-4d49-9dec-70999b422b71` is the direct rollback. Its first scheduled production
  run (`287059`) consumed all 29 roster clients, emitted 29 unique
  `syncview.analytics.receipt.v1` terminal receipts, completed 29 Metrics writes, and passed final
  coverage with zero write failures. One provider failure exactly preserved its last-good row,
  whose affected values were already legitimate zeros; two successful platform results persisted
  fresh numeric zero fields without fallback. No `genuinely_empty` case occurred in that live run;
  pinned pre-publish execution `286168` covers that branch. The 31m12s run had no Sheets quota
  error; retain quota monitoring because the preceding production run did hit the project write
  limit. This closes the CLIENTS METRICS half of F124. TOP VIDEOS remains degraded: four retained
  green runs sent only 8–11 of 15 configured YouTube lanes through processed stats, while 4–7
  collapsed into the same no-source path used for missing/empty input.
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
- B1's current event is neither a success-only checkpoint nor a typed terminal heartbeat (F131).
  Per-deliverable, success-summary, and failure-summary writes share one action; cursor selection and
  pager age checks can therefore advance/look green after partial or failed work. Require a durable
  last-success high-water, distinct event types, exact `ok`/count validation, and failure convergence.
- The combined pager is not a terminal-health receipt (F132). Its stop-on-error v1 branches can
  suppress later lanes; Calendar/Samples inspect only five unfiltered runs and fresh pending work can
  hide terminal failure; outbound trusts embedded mode; malformed V2 can become zero; diff/repair/
  linkage share a two-summary gate and hourly throttle. Treat quiet as unknown until lanes are
  isolated/correlated and an external observer proves execution.

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
