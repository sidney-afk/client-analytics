'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const FN = fs.readFileSync(path.join(ROOT, 'supabase/functions/linear-inbound/index.ts'), 'utf8');
const CFG = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL linear-inbound-source:', msg);
    process.exit(1);
  }
}

function hmac(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function fresh(ts, now) {
  return Math.abs(now - Date.parse(ts)) <= 60000;
}

const now = Date.UTC(2026, 6, 7, 20, 0, 0);
const dummyIssuePayload = JSON.stringify({
  type: 'Issue',
  action: 'update',
  webhookTimestamp: new Date(now).toISOString(),
  data: {
    id: 'lin_dummy_issue_1',
    identifier: 'VID-TEST',
    url: 'https://linear.example/issue/VID-TEST/dummy',
    title: 'Dummy test deliverable',
    state: { id: 'state_dummy_smm', name: 'For SMM approval', type: 'started' },
    assignee: { id: 'linear_user_dummy', email: 'editor@example.invalid', name: 'Test Editor' },
    team: { key: 'VID', name: 'Video' },
    dueDate: '2026-07-31',
    priority: 2,
  },
});
const sig = hmac('dummy-secret', dummyIssuePayload);
ok(sig.length === 64 && /^[0-9a-f]+$/.test(sig), 'test HMAC fixture sanity');
ok(fresh(JSON.parse(dummyIssuePayload).webhookTimestamp, now), 'test replay fixture sanity');

ok(/\[functions\.linear-inbound\]\s*\nverify_jwt = false/.test(CFG),
  'linear-inbound must be configured verify_jwt=false because it verifies Linear HMAC itself');

[
  'LINEAR_INBOUND_SIGNING_SECRET',
  'SLACK_ALERT_WEBHOOK',
  'linear-signature',
  'HMAC',
  'SHA-256',
  'REPLAY_WINDOW_MS = 60_000',
  'webhookTimestamp',
  'timingSafeEqual',
].forEach(token => ok(FN.includes(token), 'transport token missing: ' + token));

ok(/function signingSecrets\(\): string\[\] \{[\s\S]*Deno\.env\.get\(SIGNING_SECRET_ENV\)[\s\S]*\.split\(",\"\)[\s\S]*\.filter\(Boolean\)/.test(FN),
  'linear-inbound must parse comma-separated signing secrets');
const verifyFn = FN.match(/async function verifySignature\(headers: Headers, rawBody: string\): Promise<boolean> \{[\s\S]*?\n\}/);
ok(verifyFn && /for \(const secret of secrets\)/.test(verifyFn[0])
  && /matched = timingSafeEqual\(expected, provided\) \|\| matched;/.test(verifyFn[0])
  && !/return timingSafeEqual\(expected, provided\)/.test(verifyFn[0]),
  'signature verifier must try every configured secret and reject only if none match');

ok(/if \(!enabled\) \{[\s\S]*outcome: "disabled"[\s\S]*return json\(\{ ok: true, disabled: true \}\)/.test(FN),
  'flag-false path must acknowledge and stop dark');
ok(FN.indexOf('if (!enabled)') < FN.indexOf('handleLinearWebhook(supabase, payload)'),
  'linear_inbound_enabled gate must run before the enabled handler');

ok(/const ALERT_THROTTLE_MS = 60 \* 60 \* 1000/.test(FN)
  && /const lastAlertAt = new Map<string, number>\(\)/.test(FN),
  'linear-inbound anomaly alerts must throttle at one per type per hour');
const alertPayloadFn = FN.match(/function alertPayload\(type: string, issue: JsonMap, details: JsonMap = \{\}\): JsonMap \{[\s\S]*?\n\}/);
ok(alertPayloadFn
  && /issue_identifier: identifier/.test(alertPayloadFn[0])
  && /team,/.test(alertPayloadFn[0])
  && !/client_slug|client_name|assignee|email|name/.test(alertPayloadFn[0]),
  'alert payload must be scrubbed to identifiers/team only, with no client or assignee names');
const alertFn = FN.match(/async function postAnomalyAlert\(type: string, issue: JsonMap, details: JsonMap = \{\}, nowMs = Date\.now\(\)\): Promise<boolean> \{[\s\S]*?\n\}/);
ok(alertFn
  && /Deno\.env\.get\(ALERT_WEBHOOK_ENV\)/.test(alertFn[0])
  && /nowMs - last < ALERT_THROTTLE_MS/.test(alertFn[0])
  && /lastAlertAt\.set\(type, nowMs\)/.test(alertFn[0])
  && /fetch\(hook/.test(alertFn[0]),
  'postAnomalyAlert must use the alert webhook, throttle per anomaly type, and POST the payload');
ok(/postAnomalyAlert\("unmapped_state", issue,[\s\S]*state_id:[\s\S]*state_type:/.test(FN),
  'unmapped_state must alert with state id/type only');
ok(/postAnomalyAlert\("unknown_assignee", issue\)/.test(FN),
  'unknown_assignee must alert without assignee identity in the alert');

[
  'linear_inbound_enabled',
  'prod_authority',
  'foreign_write_detected',
  'detect_only',
].forEach(token => ok(FN.includes(token), 'flag/detect-only token missing: ' + token));

[
  'statusFromName',
  'stateUuidMap',
  'unmapped_state',
  'unknown_assignee',
  'clamped_state',
  'team_move',
  'parent_change',
  'webhook_delete',
  'archived',
  'restored',
  'priority',
].forEach(token => ok(FN.includes(token), 'issue mapping token missing: ' + token));
ok(/const previousIssue = raw\.issue && typeof raw\.issue === "object" \? raw\.issue as JsonMap : \{\};[\s\S]*raw\.issue = \{ \.\.\.issue \};[\s\S]*if \(!has\(issue, "parent"\) && previousIssue\.parent !== undefined\) \{[\s\S]*\(raw\.issue as JsonMap\)\.parent = previousIssue\.parent;[\s\S]*\}/.test(FN),
  'mergeLinearRaw must preserve the stored parent when an Issue webhook omits parent');
ok(/import \{ clearArchiveMarkers \} from "\.\/restore-markers\.mjs"/.test(FN)
  && /action === "restore"[\s\S]*clearArchiveMarkers\(linearRawWithFlag\(existing, issue, payload, "restored", true\)\)/.test(FN),
  'restore must clear stale archive/delete markers before writing the deliverable');

ok(/const DUPLICATE_LINK_COLUMNS/.test(fs.readFileSync(path.join(ROOT, 'supabase/functions/sample-review-upsert/index.ts'), 'utf8')),
  'sanity: running after the samples twins guard merge');

ok(/import \{ normalizeLinearComment, parseSyncViewBridgeBody \} from "\.\/comment-normalize\.mjs"/.test(FN),
  'comment capture must use the shared bridge/human-author normalizer');
ok(/rpc\("production_comment_upsert", \{[\s\S]*p_comment: pComment,[\s\S]*p_event: pEvent/.test(FN),
  'every comment webhook must converge through the durable production comment RPC');
ok(/readStoredComment\([\s\S]{0,180}clean\(normalized\.linear_comment_id\)/.test(FN)
  && /lifecycleOnly[\s\S]{0,900}delete normalized\[field\]/.test(FN),
  'lifecycle-only comment events preserve stored body and human-author snapshots');
ok(/async function readBatchForIssue/.test(FN)
  && /\.contains\("linear_parent_ids", probe\)/.test(FN)
  && /targetBatchId[\s\S]{0,520}\{ batch_id: targetBatchId \}/.test(FN),
  'comment capture resolves Linear batch-parent identities without explicit target nulling');
ok(!/const pComment = \{[\s\S]{0,260}batch_id: null/.test(FN),
  'comment RPC input never clears a stored batch target explicitly');
ok(/including house-authored `\(via SyncView\)` bridges, is persisted first/.test(FN)
  && /handleCommentEvent\(supabase, payload, await recentOutboundEcho/.test(FN),
  'bridge echoes must be stored before echo suppression metadata is applied');
ok(/"pending", "shadow_ok", "written", "failed", "skipped"/.test(FN)
  && /lower\(row\.status\) === "skipped" && !clean\(result\.rollback_id\)/.test(FN),
  'only rollback-bound skipped rows participate in F27 echo matching');
ok(!/shouldDropEchoComment|duplicate_comment_event/.test(FN),
  'legacy prefix drops and time-window comment dedupe must be removed in favor of durable idempotency');
ok(/normalized\.linear_author_id\s*=[\s\S]*normalized\.transport_linear_user_id\s*=[\s\S]*normalized\.transport_actor\s*=/.test(
  fs.readFileSync(path.join(ROOT, 'supabase/functions/linear-inbound/comment-normalize.mjs'), 'utf8')),
  'human author identity and webhook transport identity must be stored separately');

ok(/maintainCardLinkage/.test(FN)
  && /video_deliverable_id/.test(FN)
  && /graphic_deliverable_id/.test(FN)
  && /calendar_posts/.test(FN)
  && /sample_reviews/.test(FN),
  'card-linkage maintenance must cover both card tables and both slots');

ok(/rpc\("deliverable_write"/.test(FN), 'deliverable writes must go through deliverable_write RPC');
ok(/rpc\("batch_write"/.test(FN), 'batch writes must go through batch_write RPC helper');
ok(!/from\("deliverables"\)[\s\S]{0,120}\.(insert|update|upsert|delete)\(/.test(FN),
  'linear-inbound must not directly mutate deliverables');
ok(!/from\("batches"\)[\s\S]{0,120}\.(insert|update|upsert|delete)\(/.test(FN),
  'linear-inbound must not directly mutate batches');

ok(!/sidneylaruel|jesseisrael|lilybaker|mikiagrawal|chelseyscaffidi|daniellerobin/i.test(FN),
  'linear-inbound source must not contain real client slugs');

console.log('linear-inbound source checks passed');
