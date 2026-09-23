# n8n — current truth

**Corrected 2026-09-21:** Linear was retired as a work surface at the 2026-09-20 cutoff. Staff work in SyncView; normal outbound writes and legacy parity are off. The inbound webhook remains, and STEP 7 credential revocation is still owner-gated. Earlier Linear topology, provider-write and authority statements below are retained for provenance and are superseded by this cutoff state. Legacy symbols, IDs, stored rows and endpoint definitions may remain without being live work paths. This correction does not re-verify unrelated counts, versions or historical findings. See [cutoff record](../ops/LINEAR_CUTOFF_RUNBOOK.md).

> Last verified: 2026-09-23 @ 344006c5 — a live READ-ONLY re-verification through the n8n API: a
> full workflow census (count, active/inactive split), the active/inactive state and stored version
> of every workflow id this document names, and the live identity of the Kasper Ad Performance pull.
> **No workflow was edited, activated, deactivated, published or archived.** Four claims had
> drifted and are corrected in place, each marked `Corrected 2026-09-23`. What this pass did NOT
> re-verify, and which therefore still rests on its older dated evidence: every per-workflow node
> topology and behavioural claim below (F44's receipt contract, the Kasper pull's node graph and
> credentials, the backup workflow's error handling, the provisioning/sales gate logic), the
> F09/F13/F115/F116/F126/F128–F132 findings, and the standing hazards — those need graph reads and
> execution reads this pass deliberately did not perform.
>
> Earlier stamp, retained for provenance: 2026-08-24 @ c7f088a (F44 live Client Example durable-receipt/triage probe) +
> scoped 2026-09-10 Kasper-approval urgent ping `1WjZZjfQjDlg1Crf` — created 2026-09-09, DM copy
> corrected and published 2026-09-10 (see below) +
> scoped 2026-08-03 qll V2-cadence publish/readback +
> scoped 2026-08-20 live census (99/83), onboarding Slack→Roam correction, provisioning
> phone fallback + failure alerts, and the Commas payment receiver +
> scoped 2026-08-25 Kasper Ad Performance pull — v1 + v2 + v3 all fully live, published, and proven
> end-to-end against real production data (merged via #1127/#1131/#1137); v3 (unfinished-lead
> follow-up tracking, reusing the existing booking_recovery Data Table) is now `6OtjILbhkYLY6yVE`,
> rebuilt same-day to fix a `status=pending` filter bug that silently excluded already-contacted
> leads (proven with real execution `431479`), superseding `CdCYzye6Khp6x5A6` (itself superseding
> the archived `BKl9OFVMb4VS2IHf`) — see below +
> scoped 2026-08-24 onboarding Roam→Slack reversal (Client — Slack Creative Channel Finalizer
> replaces the archived Client — Roam Creative Group Finalizer; Kasper's booking alert dropped
> its Roam leg, Telegram-only now) +
> scoped 2026-08-25 Hiring Process capture, reviewer-alert link repair, and dedicated-interview
> booking branch (candidate invitation delivery remains default-off);
> other statements retain their dated sources
> Live facts from `docs/audits/2026-07-05-n8n.md` (verified 2026-07-05) unless noted.
> n8n remains load-bearing for many unmigrated readers/writers and as dormant Track-A fallback;
> full-active-roster Calendar/SXR/settings writes now use Edge Functions. Snapshot workflows
> privately plus a public-safe `n8n-backups/` stub before any change (`ROLLBACK.md` rule 2).

## Inventory

The app-facing webhook surface is enumerated and machine-enforced in `docs/truth/ENDPOINTS.md`.
**Corrected 2026-09-23: that surface is 53 endpoints, not 55** — it dropped to 53 when
`linear-issue-statuses` was retired from the app (PR #1497); `ENDPOINTS.md` owns the number and
`test/truth-sync.js` enforces it against `index.html`, so read it there rather than from this line.

**Corrected 2026-09-23 — the workflow census has moved a long way.** A live read-only census today
returns **138 workflows, 96 active, 42 inactive**, superseding the 2026-08-20 count of 99/83. That
is +39 workflows and +13 active in about a month, and the inactive half has more than doubled,
which is the cutover's shape: retired Linear lanes stay as unpublished graphs rather than being
deleted, and the inactive list is now dominated by one-off/backfill workflows. The per-workflow
delta was not enumerated, so this corrects the count only — do not read a delta into it. The older
2026-08-20 finding follows for provenance: it found 99/83 (16 inactive),
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

**Corrected 2026-09-21:** Linear-related schedules and write targets below must be read against the executed cutoff, not treated as instructions to restore them. Outbound and parity are off; only the inbound webhook and STEP 7 credential decision remain in the retirement boundary. Other n8n services are outside this correction.

- Kasper-approval urgent ping `1WjZZjfQjDlg1Crf` (`SyncView — Urgent Kasper Review → Slack`) is
  active at version **`fddb0d5a-790b-4e3e-85f7-8c357f7b3969`** (published 2026-09-10). Created
  2026-09-09 as the twin of `send-urgent-slack`, aimed at Kasper rather than the editor:
  `POST /webhook/send-urgent-kasper-slack` takes card context ONLY — the recipient is fixed in the
  workflow and never read from the request, and the review-tab link is rebuilt and accepted only on
  the SyncView origin, so a forged payload cannot turn a SyncView Bot DM into a link elsewhere.
  The 2026-09-10 publish changed **one string** in `Parse & Validate` and nothing else (verified by
  an n8n version diff, not by inspection): the DM used to close "It is in the Urgent section at the
  top", which the browser cannot guarantee because it sends the DM BEFORE writing the urgent marker.
  It now closes "Urgent cards sit at the top of your review tab".
  Public-safe graphs: `n8n-backups/send-urgent-kasper-slack.2026-09-10.published.json` is the ACTIVE
  one; the `.2026-09-09.created.json` sibling is the ROLLBACK graph (`f442f701-94bb-48bd-9f35-6cc4ff45da63`).
  **A workflow edit made through the API lands as a DRAFT** — `versionId` moves and `activeVersionId`
  does not — so the live webhook keeps running the old version until it is published. Check the two
  fields rather than trusting the update result; this was caught here on 2026-09-10 and would
  otherwise have shipped a copy fix production was not running.

- Hiring application capture `oi4BPg79dykdet6H` (`Hiring — Application Capture (iClosed)`) is
  active at version `759a33ed-7156-4a86-89ed-bac45497ba55`. It accepts only the dedicated Client
  Success & Content Manager application payload, persists through the hiring bridge, and sends the
  reviewer alerts with the working staff deep link
  `https://synchrosocial.com/?Kasper=1#kasper/hiring-process`. Both the Slack and Telegram alert
  paths use that link; the old `/kasper/hiring-process` path is absent. The dedicated invitation
  dispatcher `su5afuhg17V2xhgh` remains inactive and `hiring_invites_enabled` remains exactly
  `false`, so no candidate email is automatically released. **Corrected 2026-09-21: that last
  sentence is history as of 2026-08-25.** Candidate email IS live for the editor hire: read-only
  on 2026-09-21, `hiring_invites_enabled` reads `{"enabled": true}` (set 2026-08-28T23:49Z) and
  `hiring_practical_tests_enabled` reads `{"enabled": true}` (set 2026-09-16T14:21Z), and both the
  invitation dispatcher `su5afuhg17V2xhgh` and the practical-test dispatcher `eiisSbHsD1OnnNdQ` are
  active (5-minute polls, see the 2026-09-20 hiring pollers bullet below). The kill switch in
  `ROLLBACK.md` still works: set `hiring_invites_enabled` back to `{"enabled": false}`.
- The existing active `Sales — Call Booked (iClosed)` receiver `xoPqojySDriQ8Mzh` is at version
  `a82e2ce1-d062-4997-a812-7621b5c1b635`. A first strict gate accepts only
  `client-success-content-manager-interview` with a nonblank iClosed contact ID and booking ID,
  then records the hiring booking through the bridge. Its false branch is the unchanged sales
  decision. Controlled execution `432073` took only the hiring branch and returned
  `interview_booked`; no sales CRM, nurture, or sales alert node ran. See the public-safe recovery
  record in `n8n-backups/2026-08-25-hiring-process-status.md`.
- `SyncView Workload — Reconcile` `lGwC9WWPVJtxphtf` (every 10 min: GET the Linear issues webhook, bulk-upsert
  `workload_issues`, soft-deactivate rows that left the active set) — **DEACTIVATED on the owner's explicit
  "deactivate reconcile" 2026-09-21 at about 14:57Z** (unpublished, not edited; `active: false`,
  `activeVersionId: null`, last stored version `50a8a1e4-3d7d-4327-b8be-fc708cee4fe7`, republishable). Last run
  14:50:09Z. Reason and the order lesson are in `docs/ops/LINEAR_CUTOFF_RUNBOOK.md`, STEP 6 item 3: it
  re-activated 28 hand-retired legacy rows ten minutes after they were retired, so it had to go first.
- Hiring pollers, interval change 2026-09-20 on the owner's explicit instruction: Interview Invite Dispatch
  `su5afuhg17V2xhgh` and Practical Test Dispatch `eiisSbHsD1OnnNdQ` were both polling every 1 minute
  (~86k executions/month between them, the largest single n8n cost after the Linear webhooks) and now poll
  every 5 minutes. Published versions `fe1dbcea-1552-40d8-8556-e659e4aff133` and
  `a902a7c1-4080-4ec3-8f05-616628294205` (pre-edit `05da2d71-a23c-4585-9e5c-6bead157778f` and
  `0204ff3b-6af9-483b-9aac-754c0cbee4c8`); 4 runs each verified in the following 15 minutes. The earlier line
  above saying `su5afuhg17V2xhgh` "remains inactive" and `hiring_invites_enabled` "remains exactly false" is
  history as of 2026-08-25: both dispatchers are active for the editor hire and both hiring flags read
  `{"enabled": true}` (read-only 2026-09-21). Owner intent: switch both off and clear the Hiring Raw Log
  table once the editor hire closes.
- Monitoring Pager + Reconciler Trigger `qllIDZPkdNAPRj0b` — **DEACTIVATED by the owner 2026-09-20 at about 20:12Z** (Linear cutoff runbook STEP 6; verified read-only `active: false`). Its dispatch targets are unscheduled as of #1449. History below is kept as written. It **was** active: on 2026-08-03, after a
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
- The old dedicated Samples n8n trigger (`ZJOtYpQZj73DcBB1`) remains inactive. Samples drift
  protection **used to be on twice**: pager `qllIDZPkdNAPRj0b` dispatches the GitHub workflow every
  15 minutes AND `sample-linear-reconcile.yml` carried its own `*/10` schedule.
  **Changed 2026-09-20 by the Linear cutoff, STEP 6 of `docs/ops/LINEAR_CUTOFF_RUNBOOK.md`:** the
  `*/10` cron is commented out (`workflow_dispatch` kept), so the independent half is gone and the
  pager dispatch is the ONLY remaining trigger.
  **The retain-until-F132 instruction no longer applies, and it is important to say why rather than
  to read this as the burn cut it warned against.** That instruction chose between two lanes both
  wanted alive; the cutoff wants neither, because the reconcile compares against a Linear state
  native writes no longer feed. It also said to cut the pager and keep the schedule if only one
  could go — the cutoff does the reverse *in the end*, but only because STEP 6 retires both, and it
  orders the n8n pager FIRST for exactly this reason.
  **The pager half mattered, and it is now also off.** Removing the cron alone would NOT have
  stopped this lane: the pager's dispatch supplies `dry_run=false`, and `sample-linear-reconcile.yml`
  computes `APPLY` as `github.event_name == 'schedule' || github.event.inputs.dry_run != 'true'`, so
  a pager-dispatched run is write-capable exactly as a scheduled one was — the cron removal changes
  the trigger count and nothing about the writes. The owner deactivated pager `qllIDZPkdNAPRj0b`
  separately on 2026-09-20 (~20:12Z), outside PR #1449, which does not itself touch n8n.
  **Verified by read-only API check on 2026-09-20: `active: false`, `activeVersionId: null`.** With
  both halves off, Samples reconciliation now runs only when a human dispatches it by hand, and such
  a dispatch still writes unless `dry_run` is left on.
  **Corrected 2026-09-23: Workload reconcile `lGwC9WWPVJtxphtf` is NOT still ACTIVE.** This
  sentence contradicts the bullet further up that records its 2026-09-21 deactivation, and the
  live read settles it — `active: false`. STEP 6's warning has therefore already come true, and
  measurably: the newest `workload_issues.synced_at` is `2026-09-21 14:50:16Z` and has not moved,
  so the mirror is frozen at 3,836 rows (2,097 active) rather than empty, which is exactly the
  state the browser cannot distinguish from health. Whether the workload-source-freshness watcher
  was confirmed before the deactivation was not established this pass.
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
  launch real Drive/CRM/Slack/vault side effects without a verified-sale/staff-approval job, and the
  current full-brief builder sends raw account-access answers into a **Slack** `#{client}-creative`
  channel — inlined directly into the first (kickoff) message as of 2026-08-24, by owner decision,
  not just the follow-up brief. (Briefly this went to a Roam group instead, 2026-07-28 → 2026-08-24;
  that chapter is archived, not deleted.) The exposure is unchanged in kind: the brief is still
  **persisted** in a Data Table (`Slack Creative Channel Queue.form_brief`, up to 38k chars) in
  addition to being posted. Split/authorize provisioning and structurally exclude secret fields; do
  not run a fake-client drill until provider sandboxes and captured inverses exist.
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
> **Corrected 2026-09-23 — every Kasper Ad Performance workflow id in the three bullets below is
> stale.** The live, active `Kasper Ad Performance — Daily Pull` is **`2Ax4c78jgI7roXzv`**, created
> and published 2026-09-02, 15 nodes (the v3 bullet describes 11), active version
> `74798eb9-6b7f-449a-a526-64c7fdfd274b`, still on a schedule trigger. None of
> `6OtjILbhkYLY6yVE`, `CdCYzye6Khp6x5A6`, `BKl9OFVMb4VS2IHf` or `19ZqxaOt09KPLGx1` appear in the
> live workflow list at all. `UYUTvvj7YGJOeZuz` and the backfill `NeTWOfflUndxTe1C` still exist but
> are **inactive**. What the 2026-09-02 rebuild changed was not read this pass and nothing is
> claimed about it — only that the ids below name a superseded generation. Read the three bullets
> as the dated build/debug history they are, not as current topology.

- **Kasper Ad Performance pull — live (2026-08-24).** `Kasper Ad Performance — Daily Pull`
  (workflow id `UYUTvvj7YGJOeZuz`, published, cron `0 9,21 * * *`) pulls Meta Ads Insights
  (spend/impressions/clicks/landing-page-views, daily breakdown, for campaign
  `120243068755680573` "Prospecting | Leads | US | Aug 2026" in ad account `24069488506082034`,
  via credential "Facebook Graph account") and iClosed bookings (same `utm_campaign=prospecting`
  attribution as `iclosed_bookings.py` in the Kasper Ads working folder, via credential "iClosed
  API - Kasper"), re-pulling the trailing ~8 days each run so late-attributed conversions aren't
  missed by a same-day-only pull, and upserts the result into `kasper_ad_performance_daily`
  (`Prefer: resolution=merge-duplicates`, via credential "Supabase - SyncView Calendar"). Two
  manual test runs (`427019`, `427095`) proved the pipeline before publish; the first caught that
  Meta's flat `landing_page_view` insights field returns 0 — the real count is in the `actions`
  array (`action_type: "landing_page_view"`) for this API version — fixed before the workflow that
  is now live (an earlier buggy revision, `wP0yLVDIOJph1bcM`, was unpublished and archived). A
  one-time backfill run (`Kasper Ad Performance — ONE-TIME Backfill`, manual-trigger only) ran once
  covering 2026-08-10 campaign launch through today — done, not a follow-up.
- **Kasper Ad Performance pull v2 — migration applied, function redeployed, one real attribution
  bug found and fixed, current revision proven working end-to-end (2026-08-24).** Adds two things to
  both the live pull and the one-time backfill: (1) a second Meta Insights pull at `level=ad` (same
  fields, adding `ad_id`/`ad_name`), upserted into `kasper_ad_performance_by_ad_daily`; (2) a
  HubSpot contact batch lookup (`POST /crm/v3/objects/contacts/batch/read`, `idProperty: "email"`,
  via credential "HubSpot account" — the same credential already used by the Sales/Onboarding
  workflows above) keyed on each booking's `inviteeEmail`, pulling `iclosed_status` and
  `lifecyclestage`, upserting one row per booking into `kasper_ad_leads` (real PII — name + email).
  Both workflows are 11 nodes (was 6): the trigger fans out to three parallel branches (campaign
  Meta pull, by-ad Meta pull, iClosed pull → extract unique emails → HubSpot batch lookup), all
  three converge on a 3-input Merge node into one `Build Daily Rows` Code node returning
  `{ daily, byAd, leads }`, fanning out to three separate upsert HTTP nodes.
  `2026-08-24-kasper-ad-performance-v2.sql` is **applied to production** and
  `kasper-ad-performance-read` is **redeployed** with the extended response shape (both
  readback-verified). A first real test run (live pull execution `427645`, then backfill execution
  `427649`) proved the HubSpot join works correctly — one Aug-13 booking correctly came back
  `iclosed_status: booked`, `hubspot_lifecyclestage: customer` — but found a real bug: every by-ad
  row showed 0 bookings. Root cause: Meta appends `| COPY N` to an ad's name when it splits the ad
  for delivery testing (observed live: `Video | Fast Pitch | COPY 2`, `Video | Danny Training |
  COPY 2`, `Static | Baya Results | COPY 1`), but the `utm_content` tag on the underlying creative
  link is never updated to match, so exact-name matching against a booking's UTM tag (`Video | Fast
  Pitch`) always failed. Fixed by stripping a trailing `| COPY N` (case-insensitive) from Meta's
  `ad_name` before using it as the match/grouping key, which also collapses COPY variants of the
  same ad into one row — matching how `iclosed_bookings.py`'s own "Bookings per ad" breakdown
  already groups them (no COPY concept). The wrongly-keyed by-ad rows from the first test run were
  deleted before the fix landed. Both workflows were rebuilt with the fix (live pull id
  `BKl9OFVMb4VS2IHf`, superseding `19ZqxaOt09KPLGx1`, which itself superseded `UYUTvvj7YGJOeZuz`;
  backfill id `NeTWOfflUndxTe1C`, superseding `DBQvKxonjhTt7rKC`, which itself superseded
  `FPQo6G2zi8WcIfa1` — all superseded revisions unpublished/archived), then proven correct with
  real test executions after credential wiring: live pull execution `427729` succeeded (verified
  ad names collapse correctly, e.g. `Video | Fast Pitch`, with correct spend per ad — 0 bookings in
  that run's trailing-8-day window, which was independently confirmed accurate against the
  campaign-level table, not a bug); backfill execution `427742` first caught a second real issue
  (the "HubSpot Contact Lookup (Backfill)" node's credential wasn't actually set despite an earlier
  "wired" confirmation — `Credentials not found`, isolated via `get_workflow_execution` with
  `includeData: true`), then after that was fixed, backfill execution `427743` succeeded and proved
  the fix end-to-end: 4 real Aug 11/13 bookings correctly attributed 2-to-`Video | Fast Pitch`
  (one cancelled, one now `hubspot_lifecyclestage: customer`) and 2-to-`Video | Danny Training`
  (both still `lead`) — exactly matching the 4 total bookings already known from the campaign-level
  table. Live pull is published (2x/day cron); backfill stays manual-trigger-only by design.
- **Kasper Ad Performance pull v3 — unfinished-lead follow-up tracking, credential-wired, proven,
  published (2026-08-25).** Adds a 4th independent branch to the live pull only (not the backfill —
  see below): `Pull Unfinished Leads` (Data Table `get` on `booking_recovery`, id
  `xEhLpKwNv8uTaeAK`, filtered `status=pending AND utm_campaign=prospecting`) → `Map Unfinished
  Leads` (Code, reshapes to the Supabase column set) → `Upsert Unfinished Leads` (POST,
  `merge-duplicates`, into the new `kasper_ad_unfinished_leads` table). This branch is independent
  of the other three — it needs no Meta/iClosed data, so it doesn't feed `Combine Sources` or
  `Build Daily Rows`, and a zero-row result just means that branch's Upsert node doesn't run for
  that execution, same as any other zero-item n8n branch.
  `booking_recovery` is not a new capture path — it's fed by the pre-existing "Sales — Booking
  Recovery Capture (iClosed)" (`31DnMJLU3YM89py1`) and "Sales — Booking Recovery Dispatch"
  (`nQ4vnZ8bmG3E3Lor`) workflows, which already track people who started the acquisition-calendar
  booking flow (`social-media-consultation`/`ai-intro-call`) without finishing, with full ad UTM
  attribution and an `email_sent_at`/`sms_sent_at` timestamp once the recovery email actually
  sends. Booked, disqualified, and other-calendar leads never reach `status=pending` there (that
  workflow's own logic, not re-filtered here), so the `status=pending` filter alone gives
  "unfinished, not disqualified" for free.
  Rebuilt as live-pull id `CdCYzye6Khp6x5A6`, superseding `BKl9OFVMb4VS2IHf`. The owner wired
  credentials on all 8 HTTP Request nodes 2026-08-25; a real test execution (`428427`) then proved
  the whole workflow, not just the new branch: `Pull Unfinished Leads` ran and returned zero rows
  (correctly — no `booking_recovery` row currently matches both filters, matching the same finding
  from the pre-build investigation), so `Map`/`Upsert Unfinished Leads` correctly did not run
  (zero-item skip, not a failure), while the three pre-existing writers (`Upsert Daily Rows`,
  `Upsert By-Ad Rows`, `Upsert Lead Rows`) all reported `executionStatus: success` with zero errors
  anywhere in the execution. Independently confirmed against live data, not just n8n's own status:
  a direct Supabase readback immediately after showed `kasper_ad_performance_daily` and
  `kasper_ad_performance_by_ad_daily` both carrying a fresh `updated_at` of `2026-08-25 00:50:48`,
  matching the execution's own `stoppedAt` timestamp to the second — proof the Meta/Supabase
  credentials are genuinely live, not just present in the node JSON. `kasper_ad_leads` kept its
  prior `updated_at` (no new/changed bookings since the last proof run — an empty diff, not a
  skipped write) and `kasper_ad_unfinished_leads` remained at 0 rows, consistent with the zero-item
  branch skip. Published immediately after (`activeVersionId` confirmed live), and the superseded
  `BKl9OFVMb4VS2IHf` archived. The "Unfinished leads" panel section will render empty until a real
  abandoned lead accumulates in `booking_recovery` — expected given the state above, not a defect.
  **Not added to the backfill workflow** (`NeTWOfflUndxTe1C`, left untouched): `status=pending` is
  a current snapshot, not a historical range, so the live pull's very first run already captures
  100% of whatever is currently pending — there is no gap for a backfill to fill.
- **2026-08-25 correction — the `status=pending` filter was wrong, not just empty.** The owner
  manually backfilled 5 real leads into `kasper_ad_unfinished_leads` from iClosed's own dashboard
  (its public API has no UTM/campaign fields for historical contacts, confirmed by exhausting four
  reasonable endpoint/param variants) and then noticed the UI showed no follow-up status for people
  he knew had already been emailed. Checking `booking_recovery` directly by `lead_key` found 4 of
  the 5 already had real rows there — with `status` values of `completed` or `suppressed` (reason
  `awaiting_sms`), never `pending` — because Dispatch (`nQ4vnZ8bmG3E3Lor`) advances `status` away
  from `pending` the moment it acts. The `status=pending` filter on `Pull Unfinished Leads`
  therefore silently excluded every already-contacted lead, not just genuinely resolved ones — a
  bug that would have recurred for every future lead the moment Dispatch touched it, not a one-off
  backfill mistake. The three states that actually mean "no longer live" (`booked`, `disqualified`,
  `other_calendar`) live in `suppressed_reason`, not `status`. Fixed by rebuilding as
  `6OtjILbhkYLY6yVE`: `Pull Unfinished Leads` now filters only on `utm_campaign=prospecting`, and
  the exclusion logic moved into `Map Unfinished Leads`'s Code node, which drops rows whose
  `suppressed_reason` is `booked`/`disqualified`/`other_calendar` (case-insensitive) and otherwise
  keeps them regardless of `status`. Proven with real execution `431479`: a direct Supabase
  readback immediately after showed all 4 real `kasper_ad_unfinished_leads` rows freshly rewritten
  by `n8n:kasper-ad-performance-pull` with correct `follow_up_due_at`/`email_sent_at`, matching the
  execution's own timestamp to the second — the live pipeline itself re-discovered and corrected
  the same leads the owner had flagged, not just a manual patch. The bad values from the original
  manual backfill were separately corrected in Supabase directly
  (`migrations/2026-08-25-kasper-ad-unfinished-leads-followup-correction.sql`) since the rebuilt
  workflow's next real run would only ever *add to* `kasper_ad_unfinished_leads`, not retroactively
  fix rows it didn't touch this cycle. The 5th backfilled lead (Andrew Schwab) genuinely has no
  `booking_recovery` row — he predates the capture workflow's 2026-08-14 build — so his `null`
  follow-up fields are correct, not a miss. The UI (`index.html`'s
  `_kadUnfinishedLeadsListHtml()`) also gained a phone column (`tel:` link) alongside email,
  per the owner's request, since several of these leads only ever gave a phone number.
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
  intake, and graphics intake. Their `prod_authority` check constrains direction only.
  **Corrected 2026-09-23: "both teams are presently Linear-authoritative" is false.** Live
  `prod_authority` reads `{"video":"syncview","graphics":"syncview"}` and has since 2026-08-28, so
  the direction constraint now points the other way for both teams. Two of the four routes
  (`linear-set-status`, `linear-add-comment`) also no longer have a caller in the app as of
  2026-09-22 and are scheduled for revoke on 2026-09-27 — see `docs/truth/APP.md`. The endpoints
  themselves still authenticate no incoming principal until revoked, so F91 stays open as an
  exposure; it is simply no longer reachable through those two bridges from this app. Whether the
  two intake routes still have callers was not established this pass.
