# Native notification handover preparation

> **Owner clarification, 2026-09-14: PRESERVE NORMAL WORKFLOWS; REMOVE WEBSITE RELIANCE ON LINEAR.** Preserve existing expected Slack notifications, including urgent editor and urgent review requests. The owner did NOT request a blanket notification ban. Do not introduce migration announcements, new recipients/triggers, duplicate sends or unexpected messages. Approvals, comments and urgent actions must preserve normal behavior and save correctly without relying on Linear. The owner believes existing urgent messages already link to the SyncView/SyncLinear website instead of Linear; verify that behavior rather than treating it as unbuilt or already proven. During preparation, do not send live/test client messages, merge, deploy or activate services. Remove website-side Linear dependencies as needed while leaving everything inside Linear unchanged: account, data, credentials, billing and Linear-side integrations/webhooks. Do not alter n8n or unrelated external automations in this preparation. Identify website-side sync connections and any backend work necessary to preserve behavior; do not confuse disconnecting those with shutting down Linear. Earlier assistant-authored blanket notification prohibitions and blanket bans on disconnecting website-side sync were overinterpretations and are superseded. No file substitutions, deletion or link changes are authorized by treating access exceptions as lower priority.

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

## Prepared delivery procedure - preserve expected behavior; separate live authorization

Use this procedure only for separately authorized live acceptance of existing expected notification behavior. Do not interpret it as a requirement to create new notifications or contact clients about the migration. During preparation use isolated checks and read-only evidence; retain no-unexpected-send and duplicate-prevention controls.

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
