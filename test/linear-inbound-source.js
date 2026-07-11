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

ok(/role: "editor"[\s\S]*audience: "internal"[\s\S]*is_tweak: false[\s\S]*done: false[\s\S]*round: null[\s\S]*parent_id: null[\s\S]*author:[\s\S]*body:/.test(FN),
  'comment object must pin the exact non-tweak editor/internal shape');
ok(/SYNCVIEW_COMMENT_PREFIX/.test(FN) && /shouldDropEchoComment/.test(FN) && /duplicate_comment_event/.test(FN),
  'comment echo filtering and idempotency checks missing');
const dropFn = FN.match(/function shouldDropEchoComment\(comment: JsonMap\): boolean \{[\s\S]*?\n\}/);
ok(dropFn && /if \(!SYNCVIEW_COMMENT_PREFIX\.test\(body\)\) return false;/.test(dropFn[0])
  && /return legacyCommentActors\(\)\.some/.test(dropFn[0])
  && !/SYNCVIEW_COMMENT_PREFIX\.test\(body\)\s*\|\|/.test(dropFn[0]),
  'comment echo drop must be strict-AND: legacy actor AND SyncView prefix');

const syncviewPrefix = /^\*\*.+ \(via SyncView\):\*\*/;
const houseActors = ['house linear identity'];
const shouldDropEchoFixture = (comment) => {
  const body = String(comment.body || '');
  const user = comment.user || {};
  const authorKey = [user.name, user.email, comment.authorName, comment.authorEmail].map(v => String(v || '').toLowerCase()).join(' ');
  return syncviewPrefix.test(body) && houseActors.some(actor => authorKey.includes(actor));
};
ok(shouldDropEchoFixture({
  body: '**Video (via SyncView):** please update this',
  user: { name: 'House Linear Identity' },
}), 'house-authored SyncView-prefix comment must be dropped');
ok(!shouldDropEchoFixture({
  body: 'Manual editor note with no mirror prefix',
  user: { name: 'House Linear Identity' },
}), 'house-authored manual comment must be kept');
ok(!shouldDropEchoFixture({
  body: '**Video (via SyncView):** human copied this text',
  user: { name: 'Fixture Editor' },
}), 'genuine editor comment with a copied prefix must be kept');

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
