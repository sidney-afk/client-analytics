# n8n — current truth

> Last verified: 2026-07-27 @ b6ce352 (F44 live Client Example durable-receipt/triage probe) +
> scoped 2026-08-03 qll V2-cadence publish/readback +
> scoped 2026-08-20 live census (99/83), onboarding Slack→Roam correction, provisioning
> phone fallback + failure alerts, and the Commas payment receiver;
> other statements retain their dated sources
> Live facts from `docs/audits/2026-07-05-n8n.md` (verified 2026-07-05) unless noted.
> n8n remains load-bearing for many unmigrated readers/writers and as dormant Track-A fallback;
> full-active-roster Calendar/SXR/settings writes now use Edge Functions. Snapshot workflows
> privately plus a public-safe `n8n-backups/` stub before any change (`ROLLBACK.md` rule 2).

## Inventory

The app-facing webhook surface (55 endpoints) is enumerated and machine-enforced in
`docs/truth/ENDPOINTS.md`. A 2026-08-20 live census found **99 workflows, 83 active** (16 inactive),
superseding the 2026-07-14 count of 92/77; seven were added since, none deleted — the three
Booking Recovery workflows, the Roam Creative Group Finalizer, two TikTok direct-upload
workflows, and Onboarding — Append Client Row (inactive). A new
`Sales — Payment Received (Commas)` receiver was added 2026-08-20 (see below), taking the
sales lane to a second payment processor. All active graphs are structurally readable; at
least 34 matched fan-out/catch/continue-risk heuristics.
Structural coverage is not health proof. The combined pager/orchestrator has stop-on-error branch
coupling and deterministic false-green conditions (F132). The Edge Alert Relay acknowledges before
downstream Slack delivery and lacks authenticated, versioned source contracts (F09/F66/F81).
Neither graph directly calls Linear. Deep historical per-workflow reads:
`docs/audits/2026-07-05-n8n.md`.

## Known state (spot-verify before relying — n8n changes outside git)

- Monitoring Pager + Reconciler Trigger `qllIDZPkdNAPRj0b` remains active. On 2026-08-03, after a
  private pre-edit export, only the `Trigger Reconciler V2` edge moved from the unchanged shared
  15-minute trigger to a new hourly minute-0 trigger. Calendar, Samples, V2-summary monitoring,
  incremental refresh, and outbound remain on the shared 15-minute path. Active version changed
  from `16a436c6-5b49-4baa-9630-978cee2854a2` to
  `ed76a77f-d757-49f8-af15-f17547b23283`; all 15 existing node definitions, workflow settings, and
  every unaffected connection block were hash-identical on readback. The first hourly V2 dispatch,
  GitHub run `30848272042`, completed successfully. `staticData` changed as expected scheduler
  runtime metadata and is not claimed byte-identical. This is temporary Disk-IO relief; only the V2
  branch returns to 15 minutes after the bounded reader is installed and green.
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
- F44 durable client intake is live on VIDEO PRODUCTION AUTOMATION workflow
  `BrJSe8zCKUccfmIq`, active version `28dacc7f-4dd7-4d65-ba88-31db737c2c65`.
  The Supabase receipt is inserted/claimed before authority or Linear preflight. Exact parent/child
  confirmation still returns `created`; a valid payload already durably captured but unable to create
  Linear work returns a strict HTTP 202 `received` acknowledgement instead. `received` is not a new
  ledger state: its ledger is `pending`, `failed`, or `partial`, it creates no Calendar job, and it
  tells the client that staff will complete an internal step. The response is bound to the exact
  receipt/hash/team/idempotency key and cannot be used to represent an unrecorded submission.
  Protected server-only filming-plan resolution remains in place. A missing/conflicting plan is never
  a client refusal: a successful Linear create carries the internal marker, while a plan problem that
  accompanies a create blocker is retained in triage. Missing or invalid SMM credentials, project/team
  mappings, roster/assignee resolution, authority decisions, Linear API failures, and failed exact
  confirmation likewise become retained staff triage. The workflow sends every `received` triage to an
  unconditional human Slack fallback, independent of the client's per-SMM recipient; response output
  precedes the dead-letter mirror and alert so their failure cannot block the client acknowledgement.
  A fresh no-staff QA probe produced execution `313787`:
  the receipt was retained `failed` with `filming_plan_mapping_missing` and
  `smm_credential_missing`, returned the strict 202 received contract, and the fallback DM succeeded.
  Browser code never automatically replays a retained receipt; only a server-side operator claim can
  resume it. Malformed input still receives a correction 400 before receipt creation. A receipt-store
  or transport outage cannot honestly claim durable capture and remains a separate availability
  incident, not a configuration fallback. Emergency-only rollback is n8n history version
  `af7671ab-deca-4470-a08b-ce591f59e08b`; it reintroduces the no-refuse defect. Do not restore
  `66e41fca-a86f-4ef3-a977-8ba960bc152d` (protected plan URL exposure); historical
  `9e5abc46-91f0-49f8-b815-fcc6baa93891` is pruned and not retrievable.
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
  launch real Drive/CRM/Roam/vault side effects without a verified-sale/staff-approval job, and the
  current full-brief builder sends raw account-access answers into a **Roam** group — the Slack
  `#name-creative` channel it used to create was retired 2026-07-28 and Slack is now only the
  failure/alert path. The exposure widened rather than closed: the brief is now also **persisted**
  in the `Roam Creative Group Queue` Data Table (`form_brief`, up to 38k chars). Split/authorize
  provisioning and structurally exclude secret fields; do not run a fake-client drill until provider
  sandboxes and captured inverses exist.
- Provisioning gained a phone fallback and failure alerts 2026-08-20 (`hs_searchable_calculated_phone_number`,
  last 10 digits) because the onboarding-form email routinely differs from the CRM email; the
  contact upsert now keys on the CRM email so a mismatch can no longer mint a phantom contact, and
  both previously-dangling IF false branches now DM Sidney. It also gained an `errorWorkflow`, which
  it had never had.
- The gates only evaluate at webhook time. `Sales — Contract Signed` and both Invoice Paid receivers
  each check the other flag when their own webhook lands; nothing re-checks afterwards and no
  reconciler sweeps `contract_signed && first_invoice_paid && !onboarding_sent`. Two clients were
  stranded and unstuck by hand on 2026-08-19. Commas delivers **at most once and never retries**,
  which makes the missing reconciler materially riskier than under Stripe.
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
