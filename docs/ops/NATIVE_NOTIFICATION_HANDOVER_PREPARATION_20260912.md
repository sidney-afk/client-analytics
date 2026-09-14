# Native notification handover preparation

> **Owner scope correction, 2026-09-14: WEBSITE DECOUPLING ONLY; LEAVE LINEAR UNTOUCHED.** Remove the website's dependency on Linear without modifying Linear itself. Do not write/reconcile/drain work into Linear, stop or alter its integrations or external workers, revoke/rotate credentials, delete webhooks/workflows, cancel billing, or delete/archive workspace data as part of this project. Existing n8n and unrelated automations stay untouched. Previous Linear-retirement/shutdown procedures are historical and outside this rollout, not future steps implicitly approved by installation. Do not introduce client communications through Slack, email, invitations, reminders, webhooks or other channels. Internal communications also remain unapproved. The current broad candidate is not an approved website-only release: first identify the exact browser and necessary website-backend changes, their effects on existing integration traffic, and a release path that excludes unrelated functions, senders and provider mutations. A generic request to install does not authorize the broader package. File decisions require an item/type-specific proposal; preserve originals, links and permissions in the meantime.

> **Owner decision, 2026-09-14: NO CLIENT NOTIFICATIONS.** Client-facing notifications are outside the requested Linear-exit rollout. Do not send, test-send, enable, configure for delivery, or replay queued notifications to any client/channel through this migration. Roster access and earlier destination/exclusion decisions were preparation only and do not authorize delivery. Installation, activation or retirement approval does not override this decision. Keep client delivery disabled; do not require a client message to satisfy an acceptance gate. Internal staff/operator alerts are a separate, unapproved scope until exact recipients, content, triggers and channels are agreed. Before any release involving notify or its callers, prove all client-delivery paths remain disabled, including scheduled sends, gateway wakeups and backlog replay; existing tests and documentation alone do not prove that hosted behavior. This documentation change does not modify existing live automations.

This is an installation-window procedure, not authorization to execute it.
No workflow, sender, wakeup, destination or credential is activated here.
Read `NATIVE_NOTIFICATIONS.md` for the existing SQL and delivery semantics.

## Release contents and private acceptance record

Review the exact source revision of `migrations/2026-09-09-native-notification-outbox.sql`,
`supabase/functions/notify/index.ts`, `supabase/functions/notify/slack-api.ts`,
`supabase/functions/_shared/staff-role-auth.ts`, the composed production-write
bundle, both native-notification workflows and `scripts/monitoring-watchdog.js`.
Resolve the migration through the observed pending-owner plan: an already-present
owner must be compared, not replayed merely because it appears in this list.
The full installation target and hosted function dependency closure must agree.

Keep the acceptance record private. Bind it to that revision and target project,
with observed function/configuration fingerprints, observation times, operator
and backup operator, intended channel/editor identities, intent IDs and provider
message receipts. Publish only hashes, counts and pass/fail classifications.
Never include bot tokens, runner keys, channel/customer names or message bodies
in public proof. A checked box or successful HTTP status is not a delivery receipt.

## Historical delivery procedure - not approved for this rollout

The following retained procedure documents previously prepared capabilities, not an owner-approved client notification plan. Do not execute its client destination, send or sender-activation steps. A future internal-only proposal must first specify exact recipients, message content and triggers, and prove client routes cannot be reached.

1. Capture recoverable pre-state and verify the installed SQL shape/grants and
   function closure. Verify `NATIVE_NOTIFICATION_SENDER_ENABLED`,
   `NATIVE_NOTIFICATION_MONITOR_ENABLED` and `NOTIFY_WAKE_ENABLED` remain false
   while configuration is reviewed. Keep the old route until new acceptance passes.
2. Privately verify `clients.slack_channel_id` for every in-scope active client,
   `production_notification_config.urgent_video_destination`, and the current
   active editor-to-Slack identity mapping. Missing destinations remain blocked;
   do not substitute a generic channel or infer a recipient from display text.
   Record owner confirmation of the exact destinations and responsible operators.
3. Configure the reviewed notify URL and matching service-only runner key in the
   function and its intended callers, plus the function's Slack credential.
   Compare fingerprints and configuration presence without logging values.
   Test health authentication refusal and successful read-only health response.
4. In the explicitly authorized TEST scope, generate one real committed intent
   for each supported status/comment/urgent path. Invoke the sender only under
   that scope's authorization. Independently read the Slack message and SQL
   delivery receipt: intent, attempt, channel, timestamp and urgent editor must
   agree. A pending intent proves enqueue only. Repeating the completed send must
   not duplicate delivery. Capture the current target again before an urgent test.
5. Reuse isolated fault-injection evidence for denied destinations, known provider
   failure, ambiguous transport and receipt-write failure. A hosted ambiguous
   attempt must remain unresolved while the operator checks provider history;
   do not deliberately create uncontrolled real duplicate-risk sends as a drill.
6. Verify the read-only monitor reports debt and an independently observed alert
   reaches the designated operator. Verify a missing heartbeat is detected by an
   observer that survives the sender/monitor host failing. Existing watchdog
   workflows share GitHub Actions; they cannot prove detection during a complete
   GitHub outage. Accept an external observer and its tested ownership before
   claiming independent outage coverage.
7. Only after those receipts pass, authorize the intended sender cadence and
   monitor separately; enable gateway wakeups only if desired and separately
   reviewed. Check the first observed runs and backlog. Retire the old notification
   route only after coverage of every old route's intended recipient/effect is
   reconciled. No n8n execution or edit is part of this preparation.

GitHub's five-minute schedule is best effort, not a prompt-delivery guarantee.
Dormant workflow heartbeats prove that the workflow ran, not that notification
sending is enabled or delivery was tested. The watchdog's 360-minute tolerance
plus observation delay is not an urgent-notification service-level guarantee.

## Operator recovery decisions

| Observed state | Required evidence and action |
|---|---|
| `blocked`, never attempted, missing destination | Verify the intended current destination; `release_blocked_destination` rereads protected configuration before releasing |
| Known provider nondelivery | Review failure evidence; eligible `retryable` work may run later; protected blocked recovery requires `PROVIDER_CONFIRMED_NOT_DELIVERED` |
| `unknown` or expired `sending` | Stop automatic replay; inspect exact provider destination/history and original intent. Absence from a partial read is not proof of nondelivery |
| Provider message independently verified | Use protected `attest_manual_receipt` with exact timestamp and `MANUAL_PROVIDER_RECEIPT_VERIFIED`; retain independent evidence of channel/recipient/content. The RPC trusts the operator's attestation and does not fetch Slack |
| Uncertain outcome with no conclusive receipt | Keep unresolved, or obtain explicit duplicate-risk acceptance before `retry_duplicate_risk` with `RETRY_MAY_DUPLICATE`; never manufacture success |
| Invalid/missing health counts or failed observation | Treat health as unavailable and investigate; do not record a healthy zero |

If acceptance fails, keep activation disabled and preserve all intents/receipts.
Do not delete pending records or restore stale data over newer accepted work.
Stopping a schedule does not cancel an in-flight send: account for its terminal
receipt or retain unknown debt before claiming the system is quiet.

## Current proof limit

The repository contains isolated SQL, adapter and actual-handler tests. The health
handler passes nine existing cases plus twelve malformed/inconsistent count cases
with zero external calls. This document prepares the handover; no hosted delivery,
operator acceptance, destination census or independent outage drill is completed
by writing it. Those remain explicit acceptance requirements.
