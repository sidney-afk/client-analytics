# Native notification outbox

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
active client lacks a valid `clients.slack_channel_id`; they are not discarded.

The source includes dormant five-minute GitHub Actions sender and monitor jobs:
`native-notification-sender.yml` and `native-notification-monitor.yml`. They remain
skipped until their distinct repository variables are literally `true` and their
shared service-only URL/key secrets are set after review. The monitor health call
fails on blocked, unknown, or expired-lease debt; it does not send a provider
message. Claim preparation checks queued urgent targets against current authority, card round, assigned editor, and destination. A detected stale target is blocked. This database check and a later Slack request are not one atomic operation: business state can change between them; the source does not guarantee the target stays unchanged until Slack accepts the post. No n8n workflow is added or invoked by this layer.

## Verification

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
