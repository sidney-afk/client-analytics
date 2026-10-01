# Native notification outbox

> **Owner clarification, 2026-09-14: PRESERVE NORMAL WORKFLOWS; REMOVE WEBSITE RELIANCE ON LINEAR.** Preserve existing expected Slack notifications, including urgent editor and urgent review requests. The owner did NOT request a blanket notification ban. Do not introduce migration announcements, new recipients/triggers, duplicate sends or unexpected messages. Approvals, comments and urgent actions must preserve normal behavior and save correctly without relying on Linear. The owner believes existing urgent messages already link to the SyncView/SyncLinear website instead of Linear; verify that behavior rather than treating it as unbuilt or already proven. During preparation, do not send live/test client messages, merge, deploy or activate services. Remove website-side Linear dependencies as needed while leaving everything inside Linear unchanged: account, data, credentials, billing and Linear-side integrations/webhooks. Do not alter n8n or unrelated external automations in this preparation. Identify website-side sync connections and any backend work necessary to preserve behavior; do not confuse disconnecting those with shutting down Linear. Earlier assistant-authored blanket notification prohibitions and blanket bans on disconnecting website-side sync were overinterpretations and are superseded. No file substitutions, deletion or link changes are authorized by treating access exceptions as lower priority.

SOURCE_ONLY, inactive until deliberately installed and configured. Native status
and comment database triggers write durable notification intents; they do not
call Slack, n8n, or a scheduler. The `notify` Edge Function is a manual sender
and its only provider adapter is Slack `chat.postMessage`.

## What produces an intent

- A committed UI native status transition into `smm_approval` or `tweak`, with
  current SyncView authority and a canonical active staff actor.
- A newly inserted staff-authored native sub-issue comment, including a
  client-visible staff comment. Imported, mirror, reconcile, replay, synthetic,
  test, parity, edited, resolved, and deleted comments are excluded.
- `native_urgent_dispatch` retains the existing active video-editor identity
  preflight but now commits an urgent intent. It never calls n8n. An urgent
  sender message includes the exact stored editor Slack ID; status and comment
  messages are plain channel posts with parsing and implicit mentions disabled.

A client-authored native comment is admitted only from its correlated committed
`comment_add` ledger event: the existing SECURITY DEFINER writer supplies
`auth_kind=client`, `actor_key=client:<canonical slug>`, and a matching canonical
comment row. The displayed commenter is the current canonical client display
name, never caller `author_name`. Missing correlation creates no phantom post.

## Delivery and recovery boundary

An intent being `pending` is not delivery. `sent` requires a provider message
receipt with its destination channel and, for urgent, intended editor snapshot.
A transport-ambiguous response becomes `unknown` and is never automatically
retried. `retryable` is a known provider failure and is eligible for a later
manual sender run. `blocked`, `unknown`, and expired `sending` leases remain in
`production_notification_monitor_v1` for operator action. `production_notification_reconcile` is the only protected recovery route: `release_blocked_destination` rereads a newly configured client/urgent destination before releasing a never-sent blocked intent; `retry_duplicate_risk` requires the literal `RETRY_MAY_DUPLICATE` confirmation for unknown/expired sending state and writes a durable reconciliation record. It never silently retries an ambiguous provider outcome.

The gateway can make one best-effort post-commit wake call only when
`NOTIFY_WAKE_ENABLED=true`; failed wakes leave the intent pending. There is no
installed schedule or alert coverage in this source change. Before activation,
an operator must install the migration, deploy both functions with a reviewed
source closure/preflight catalog, configure a service-only `NOTIFY_RUNNER_KEY`,
configure the same key in production-write only if wakeups are wanted, configure
`SLACK_BOT_TOKEN`, and insert the protected
`production_notification_config.urgent_video_destination` row with a reviewed
channel ID. Client status/comment intents are retained as `blocked` when an
active client lacks a valid `clients.creative_channel_id`; they are not
discarded. **Corrected 2026-09-18:** that destination used to be read from
`clients.slack_channel_id`, which holds the SHARED client channel; see
`migrations/2026-09-18-notification-creative-channel.sql`.

The source includes dormant five-minute GitHub Actions sender and monitor jobs:
`native-notification-sender.yml` and `native-notification-monitor.yml`. They remain
skipped until their distinct repository variables are literally `true` and their
shared service-only URL/key secrets are set after review. The monitor health call
fails on stale pending, blocked, unknown, expired-lease or overdue retry debt; it does not send a provider
message. Claim preparation checks queued urgent targets against current authority, card round, assigned editor, and destination. A detected stale target is blocked. This database check and a later Slack request are not one atomic operation: business state can change between them; the source does not guarantee the target stays unchanged until Slack accepts the post. No n8n workflow is added or invoked by this layer.

## Verification

Preparation update, September 12: the health handler includes `retryable_overdue`
in unhealthy debt, using the existing SQL due-time boundary. The actual handler
test `test/native-notification-health-handler.js` passes nine cases with injected
SQL results and zero external calls. This verifies response handling, not hosted
SQL execution, delivery, schedule activation or alert coverage.

The follow-up health check also refuses nonnumeric, missing, fractional, unsafe
or inconsistent counts instead of coercing them into a healthy zero. Twelve
additional actual-handler cases pass with zero external calls. The SQL returns
JSON numeric counts; unresolved categories are disjoint subsets of total open
work, so overflow or debt exceeding that total is unavailable evidence, not health.

`node test/native-notifications.js` checks the source contract. Slack escaping
follows [chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage)
and [Slack formatting](https://docs.slack.dev/messaging/formatting-message-text):
all untrusted `&`, `<`, and `>` text is made plain before post; only a validated
urgent editor ID is inserted as mention markup. The real SQL
proof is `node test/native-notifications-postgres.js` under the existing
`postgres:16` unit-service (`F63_REQUIRE_POSTGRES=1`); local execution is
skipped where socket creation is denied.

### Trust boundary

The Edge Function authenticates the caller. SQL actor, payload, and event-stamp checks enforce the normal application protocol; they do not independently authenticate a person against a SQL-capable `service_role`. That role remains separately trusted. Anonymous/authenticated callers have no notification-table access or notification-RPC execution grants. Service inspection is read-only; notification state changes use the owning routines.

## Urgent message layout (2026-10-01)

**Why the old link was dead.** Every Slack post here is sent with `parse:"none"`, which Slack documents as "remove the hyperlinks", and the urgent line carried its address bare (`Open in SyncView: https://...`). Nothing turned it into a link. The `<@U...>` mention worked only because it is explicit markup, which is always honoured. The fix is explicit `<url|Open in SyncView>` markup (the same form the creative-channel posts use); `parse`, `link_names:false` and the escaping stay as they are, so nothing a person typed can become a mention or a link.

**New layout, behind a switch.** `NOTIFY_URGENT_FORMAT` (a `notify` function secret: `compact`, `card` or `line`, the same three styles as the creative channel) turns on the rich urgent post: the editor mention, a red URGENT marker, the client name, the card title, "needs tweaks", who pinged, and an "Open in SyncView" link or button. Unset, nothing changes: the old line is sent byte for byte. The names are read at send time from the rows the claimed intent points at (client display name, deliverable title, the pinging staff member); none is stored in the repository. If any read fails, or the assigned editor's Slack ID does not equal the mention already in the claim, the plain line goes out instead, with the explicit link, so a formatting problem never stops an urgent delivery. No database change.

**Preview before switching on.** The "Send notification preview" lane has a `message` choice (`creative`, `urgent`). `urgent` renders the layout from one test client's real rows and sends it to the single pinned direct message only; the mention in it is the person running the preview, never an editor, and it is labelled "Preview (not a real ping)". Counts only are printed.

**Not built (proposal only): grouping.** Several urgent pings for the same editor and client within a short window could go out as one message listing each title with its link, mirroring how a status and its comment are merged into one creative post (the second intent records the first one's Slack receipt). Decide before building: window length (about two minutes), a cap per message, and whether the first ping waits for the window or goes at once and later ones are folded into a follow-up.
