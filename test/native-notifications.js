/* Offline source contract for manual native notifications. No provider/network. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const sql = fs.readFileSync('migrations/2026-09-09-native-notification-outbox.sql', 'utf8');
const gateway = fs.readFileSync('supabase/functions/production-write/index.ts', 'utf8');
const sender = fs.readFileSync('supabase/functions/notify/index.ts', 'utf8');
const adapter = fs.readFileSync('supabase/functions/notify/slack-api.ts', 'utf8');
function ok(condition, message) { assert.ok(condition, message); }

// Execute the gateway's actual event builder. Transaction attribution must
// not be disqualified by a browser clock, while receipt replay keeps its clock.
const { extractFunction } = require('./helpers/extract-function');
const eventBuilder = extractFunction(gateway, 'eventFor').replace(/^[\s\S]*?\): JsonMap \{/, 'function eventFor(operation, principal, sourceEditedAt, surface, outbound, existing = null, nextStatus = "") {');
const eventScope = { clean: value => String(value == null ? '' : value).trim() };
vm.runInNewContext(eventBuilder + '; this.eventFor = eventFor;', eventScope);
const clock = '2026-09-10T00:00:00.000Z';
const outbound = { source_edited_at: clock, dedup_key: 'synthetic-retry' };
const actor = { actorName: 'Synthetic Admin', actorKey: 'member:synthetic', actorRole: 'admin', kind: 'staff' };
const event = eventScope.eventFor('status', actor, clock, 'production', outbound, {status:'todo'}, 'smm_approval');
ok(!Object.hasOwn(event, 'ts') && !Object.hasOwn(event, 'source_event_at'), 'live status event uses transaction clock for native attribution');
assert.strictEqual(event.outbound.source_edited_at, clock, 'exact retry receipt retains caller clock');
assert.strictEqual(eventScope.eventFor('create', actor, clock, 'production', outbound).ts, clock, 'create replay keeps historical timestamp contract');

ok(/create table if not exists public\.production_notification_intents/i.test(sql), 'durable intent outbox exists');
ok(/create table if not exists public\.production_notification_delivery_receipts/i.test(sql), 'durable provider receipts exist');
ok(/create or replace view public\.production_notification_monitor_v1/i.test(sql) && /production_notification_health_summary/.test(sql), 'pending/unknown/lease debt has an aggregate observable monitor');
ok(/after insert on public\.deliverable_events/i.test(sql) && /after insert on public\.production_comments/i.test(sql), 'independent committed event/comment observers exist');
ok(/new\.source <> 'ui'/i.test(sql) && /new\.action <> 'status_change'/i.test(sql), 'status observer excludes non-UI and non-status events');
ok(/event_assignee_attribution/i.test(sql) && /prod_authority/i.test(sql), 'status observer requires committed native transaction proof and current authority');
ok(/auth_kind', ''\) <> 'staff'/i.test(sql) && /production_notification_actor_valid/i.test(sql), 'actor is a validated native staff identity, not a display string');
ok(/new\.origin <> 'native'|new\.source <> 'ui'|new\.import_run_id is not null/i.test(sql) && /legacy_parity/.test(sql) && /test_only/.test(sql), 'comment observer excludes imported/replayed/synthetic/test/parity sources');
ok(/new\.author_member_id is null/.test(sql) && /production_notification_actor_valid/.test(sql), 'staff-authored subissue comments are identity-validated regardless of audience');
ok(/new\.to_status not in \('smm_approval', 'tweak'\)/i.test(sql), 'only the two approved status transitions notify');
ok(!/assignee_change|assignment_change/.test(sql.match(/production_notification_status_intent_after[\s\S]*?\$fn\$;/i)[0]), 'no assignment-notification path');
ok(/'parse', 'none', 'link_names', false/.test(sql) && /'allow_mentions', true/.test(sql), 'client notifications disable parsing while urgent records explicit recipient mention intent');
ok(/destination_channel_id text not null/.test(sql) && /intended_member_id uuid/.test(sql), 'receipt snapshots destination and optional exact intended member');
ok(/state in \('pending','sending','sent','retryable','unknown','blocked'\)/.test(sql), 'pending, retryable, blocked, and ambiguous outcomes are distinct');
ok(/for update skip locked/i.test(sql) && /next_attempt_at <= now\(\)/.test(sql) && /interval '5 minutes'/.test(sql) && /lease_expired_manual_reconcile/.test(sql), 'claims are bounded, rate retries back off, and an abandoned lease stays visible');
ok(/production_notification_enqueue_urgent/i.test(sql) && /slack_user_id/.test(sql) && /urgent_video_destination/.test(sql) && /urgent_target_changed/.test(sql), 'urgent uses protected destination config, exact active editor identity, and claim-time stale blocking');
ok(/production_notification_reconcile/.test(sql) && /RETRY_MAY_DUPLICATE/.test(sql) && /production_notification_reconciliations/.test(sql), 'protected recovery releases never-sent destinations and records explicit duplicate-risk retries');
ok(/notification_urgent_destination_unconfigured/.test(sql), 'urgent never guesses a video-editing channel');
const urgentBlock = gateway.slice(gateway.indexOf('async function handleNativeUrgentDispatch'), gateway.indexOf('async function handleCreateOptions'));
ok(/production_notification_enqueue_urgent/.test(urgentBlock), 'gateway routes urgent to committed notification admission');
ok(/operation === "status" \|\| operation === "comment"/.test(gateway) && /await wakeNotificationSender\(\)/.test(gateway), 'ordinary native status/comment commits best-effort wake the sender after SQL commit');
ok(!/n8n\.cloud/.test(urgentBlock) && /wakeNotificationSender/.test(urgentBlock), 'gateway urgent action has no n8n handoff and only wakes the notification sender after commit');
ok(/delivery: "pending"/.test(urgentBlock) && !/delivery: "sent"/.test(urgentBlock), 'enqueue is not misreported as delivered');
ok(/NOTIFY_RUNNER_KEY/.test(sender) && /SLACK_BOT_TOKEN/.test(sender) && /MAX_LIMIT = 10/.test(sender), 'manual sender requires separate runner/provider configuration and a bounded batch');
ok(/postSlackChannelMessage/.test(sender) && /production_notification_health_summary/.test(sender) && /pending_stale/.test(sender), 'sender health uses an unbounded aggregate for stale queue debt');
ok(/body\?\.ok === true/.test(adapter) && /body\.channel === channel/.test(adapter) && /response\.ok/.test(adapter), 'success receipt matches Slack ok, timestamp, and requested channel');
ok(/slack_transport_unconfirmed/.test(adapter) && /response\.status >= 500/.test(adapter) && /kind: "unknown"/.test(adapter), 'ambiguous transport/5xx latches unknown rather than retrying');
ok(/parse: "none"/.test(adapter) && /link_names: false/.test(adapter), 'adapter disables implicit mention parsing');
console.log('native notification source contract: ok');
