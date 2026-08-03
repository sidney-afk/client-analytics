'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const FN = fs.readFileSync(path.join(ROOT, 'supabase/functions/linear-inbound/index.ts'), 'utf8');
const F27_ECHO = fs.readFileSync(path.join(ROOT, 'supabase/functions/linear-inbound/f27-echo.mjs'), 'utf8');
const CFG = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL linear-inbound-source:', msg);
    process.exit(1);
  }
}

function extractFunction(source, name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = brace; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('unclosed ' + name);
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

const labelNormalizeUrl = pathToFileURL(path.join(
  ROOT,
  'supabase/functions/linear-inbound/label-normalize.mjs',
)).href;
const labelRunner = `
  const { normalizeIssueLabelRelation } = await import(${JSON.stringify(labelNormalizeUrl)});
  const label = (id, name = id) => ({ id, name, color: '#123456', description: null });
  const previous = { labels: { nodes: [label('a', 'Known A')], pageInfo: { hasNextPage: false } } };
  const previousWithTwo = {
    labels: {
      nodes: [label('a', 'Known A'), label('b', 'Stale B')],
      pageInfo: { hasNextPage: false },
    },
  };
  console.log(JSON.stringify({
    exact: normalizeIssueLabelRelation({
      labelIds: ['b', 'a'],
      labels: [label('a', 'A'), label('b', 'B')],
    }),
    priorFill: normalizeIssueLabelRelation({ labelIds: ['a'] }, previous),
    unknownMissing: normalizeIssueLabelRelation({
      labelIds: ['a', 'b'],
      labels: [label('a', 'A')],
    }, previous),
    staleFillBlocked: normalizeIssueLabelRelation({
      labelIds: ['a', 'b'],
      labels: [label('a', 'A')],
    }, previousWithTwo),
    mismatched: normalizeIssueLabelRelation({
      labelIds: ['a'],
      labels: [label('b', 'B')],
    }, previous),
    duplicateIds: normalizeIssueLabelRelation({
      labelIds: ['a', 'a'],
      labels: [label('a', 'A')],
    }, previous),
    emptyName: normalizeIssueLabelRelation({
      labelIds: ['a'],
      labels: [{ id: 'a', name: '', color: '#123456' }],
    }, previous),
    malformedNode: normalizeIssueLabelRelation({
      labelIds: ['a'],
      labels: [null],
    }, previous),
    completeConnection: normalizeIssueLabelRelation({
      labels: { nodes: [label('a', 'A')], pageInfo: { hasNextPage: false } },
    }),
    partialConnection: normalizeIssueLabelRelation({
      labels: { nodes: [label('a', 'A')], pageInfo: { hasNextPage: true } },
    }),
  }));
`;
const labelChild = spawnSync(process.execPath, ['--input-type=module', '--eval', labelRunner], {
  encoding: 'utf8',
});
ok(labelChild.status === 0, `label normalization helper executes offline (${(labelChild.stderr || '').trim()})`);
if (labelChild.status === 0) {
  const result = JSON.parse(labelChild.stdout.trim());
  ok(result.exact.complete === true
    && result.exact.ids.join(',') === 'a,b'
    && result.exact.nodes.map(node => node.id).join(',') === 'a,b',
  'exact labelIds/node-set equality is complete and canonical');
  ok(result.priorFill.complete === true
    && result.priorFill.nodes[0].name === 'Known A',
  'sound previous metadata may fill a still-selected known ID');
  ok(result.unknownMissing.complete === false
    && result.staleFillBlocked.complete === false
    && result.mismatched.complete === false
    && result.duplicateIds.complete === false
    && result.emptyName.complete === false
    && result.malformedNode.complete === false,
  'missing, stale-filled, mismatched, duplicate, empty-name, and malformed label metadata all fail closed');
  ok(result.completeConnection.complete === true
    && result.partialConnection.complete === false,
  'node-only relations require an explicit complete page');
}

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
ok(FN.indexOf('if (!enabled)') < FN.lastIndexOf('handleLinearWebhook('),
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
  'labels_change',
  'description_change',
  'webhook_delete',
  'archived',
  'restored',
  'priority',
].forEach(token => ok(FN.includes(token), 'issue mapping token missing: ' + token));
ok(/const previousIssue = raw\.issue && typeof raw\.issue === "object" \? raw\.issue as JsonMap : \{\};[\s\S]*raw\.issue = \{ \.\.\.issue \};[\s\S]*if \(!has\(issue, "parent"\) && !has\(issue, "parentId"\) && !parentChanged && previousIssue\.parent !== undefined\) \{[\s\S]*\(raw\.issue as JsonMap\)\.parent = previousIssue\.parent;[\s\S]*\}/.test(FN),
  'mergeLinearRaw preserves stored parent only when the webhook did not change hierarchy');
ok(/if \(!has\(issue, "description"\) && previousIssue\.description !== undefined\) \{[\s\S]{0,120}\(raw\.issue as JsonMap\)\.description = previousIssue\.description/.test(FN),
  'mergeLinearRaw preserves exact stored Markdown when an unrelated webhook omits description');
ok(/mark\("labels", \["labels", "labelIds", "addedLabelIds", "removedLabelIds"\]\)/.test(FN)
  && /payloadChangesLabels\(payload\)[\s\S]{0,180}eventAction = "labels_change"/.test(FN),
  'inbound label changes advance the dedicated field clock and durable event action');
ok(/import \{[\s\S]{0,100}normalizeIssueLabelRelation,[\s\S]{0,80}\} from "\.\/label-normalize\.mjs"/.test(FN)
  && /if \(has\(issue, "labels"\) \|\| has\(issue, "labelIds"\)\)[\s\S]{0,180}const relation = normalizeIssueLabelRelation\(issue, previousIssue\)[\s\S]{0,160}labelIds = relation\.ids[\s\S]{0,120}nodes: relation\.nodes[\s\S]{0,100}hasNextPage: relation\.complete !== true/.test(FN)
  && /else if \(previousIssue\.labels !== undefined\)/.test(FN),
  'inbound stores only a proven exact label relation, marks all malformed/partial relations incomplete, and preserves labels when unrelated webhooks omit them');
ok(/operation === "labels"[\s\S]{0,280}JSON\.stringify\(actual\) === JSON\.stringify\(intended\)/.test(FN),
  'inbound label echo suppression requires the exact canonical selected-ID set');
ok(/mark\("description", \["description"\]\)/.test(FN)
  && /payloadChangesDescription\(payload\)[\s\S]{0,180}description_changed = true[\s\S]{0,100}eventAction = "description_change"/.test(FN)
  && /row\.brief = typeof issue\.description === "string" \? issue\.description : null/.test(FN)
  && !/row\.brief = clean\(issue\.description\)/.test(FN),
  'inbound description changes preserve exact Markdown, advance their field clock, and emit a durable audit action');
ok(/operation === "description"[\s\S]{0,520}actual === intended/.test(FN)
  && /hasOwnProperty\.call\(expected, "description"\)/.test(FN),
  'inbound description echo suppression requires an explicit exact-value receipt');
ok(/import \{ clearArchiveMarkers \} from "\.\/restore-markers\.mjs"/.test(FN)
  && /action === "restore"[\s\S]*clearArchiveMarkers\(linearRawWithFlag\(existing, issue, payload, deliveryId, "restored", true\)\)/.test(FN),
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
  && /handleCommentEvent\(supabase, payload, deliveryId, await recentOutboundEcho/.test(FN),
  'bridge echoes must be stored before echo suppression metadata is applied');
ok(/"pending", "shadow_ok", "written", "failed", "skipped"/.test(FN)
  && /lower\(row\.status\) === "skipped" && !clean\(result\.rollback_id\)/.test(FN),
  'only rollback-bound skipped rows participate in F27 echo matching');
ok(/f27PreflightIdentity/.test(FN)
  && /if \(rollbackIds\.length\)/.test(FN)
  && /from\("track_b_team_rollbacks"\)/.test(FN)
  && /\.eq\("state", "open"\)/.test(FN),
  'actorless F27 preflight proof is conditional on an open rollback lookup');
ok(/result\.f27_preflight !== true/.test(F27_ECHO)
  && /result\.outbox_id/.test(F27_ECHO)
  && /result\.dedup_key/.test(F27_ECHO)
  && /result\.operation/.test(F27_ECHO)
  && /rollback\.correlation_id/.test(F27_ECHO)
  && /rollback\.team/.test(F27_ECHO),
  'F27 preflight echo proof binds the exact outbox identity, correlation, and team');
ok(/if \(!actorMatches && !terminalValueProof && !openF27PreflightProof\) continue/.test(FN)
  && /catch \(_e\) \{\s*openF27Rollbacks = \[\];/.test(FN),
  'F27 lookup failure rejects only the extra proof while ordinary proofs remain available');
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

const canonicalTitleRequestFn = extractFunction(FN, 'canonicalTitleRequest');
const canonicalTitleConvergeFn = extractFunction(FN, 'convergeCanonicalTitleFromLinear');
const issueHandlerFn = extractFunction(FN, 'handleIssueEvent');
const baseDeliverableRowFn = extractFunction(FN, 'baseDeliverableRow');
const inboundF133FlagFn = extractFunction(FN, 'f133CanonicalTitleEnabled');
const deliveryIdentityFunctions = [
  extractFunction(FN, 'clean'),
  extractFunction(FN, 'textEncoder'),
  extractFunction(FN, 'hex'),
  extractFunction(FN, 'sha256Hex'),
  extractFunction(FN, 'stableDeliveryJson'),
  extractFunction(FN, 'canonicalDeliveryPayload'),
  extractFunction(FN, 'linearWebhookDeliveryId'),
].join('\n')
  .replaceAll(': Promise<string>', '')
  .replaceAll(': ArrayBuffer', '')
  .replaceAll(': TextEncoder', '')
  .replaceAll(': unknown', '')
  .replaceAll(': JsonMap', '')
  .replaceAll(': string', '')
  .replaceAll(' as JsonMap', '');
const deliveryConstants = [
  FN.match(/^const DELIVERY_UUID_V4 = .*;$/m)?.[0],
  FN.match(/^const DELIVERY_FALLBACK_OMIT = .*;$/m)?.[0],
].filter(Boolean).join('\n');
const deliveryRunner = `
  ${deliveryConstants}
  ${deliveryIdentityFunctions}
  const payload = {
    webhookId: 'same-webhook-configuration',
    webhookTimestamp: 1785600000000,
    createdAt: '2026-08-02T20:00:00.000Z',
    action: 'update',
    type: 'Issue',
    organizationId: 'org-test',
    data: { id: 'issue-test', title: 'Canonical title', updatedAt: '2026-08-02T20:00:00.000Z' },
    updatedFrom: { title: 'Previous title' },
  };
  const first = await linearWebhookDeliveryId('11111111-1111-4111-8111-111111111111', payload);
  const retry = await linearWebhookDeliveryId('11111111-1111-4111-8111-111111111111', payload);
  const second = await linearWebhookDeliveryId('22222222-2222-4222-8222-222222222222', payload);
  const reorderedRetry = {
    updatedFrom: { title: 'Previous title' },
    data: { updatedAt: '2026-08-02T20:00:00.000Z', title: 'Canonical title', id: 'issue-test' },
    organizationId: 'org-test',
    type: 'Issue',
    action: 'update',
    createdAt: '2026-08-02T20:00:00.000Z',
    webhookTimestamp: 1785600099999,
    webhookId: 'different-webhook-configuration',
  };
  const fallback = await linearWebhookDeliveryId('', payload);
  const malformedHeaderFallback = await linearWebhookDeliveryId('same-webhook-configuration', payload);
  const fallbackRetry = await linearWebhookDeliveryId('', reorderedRetry);
  const fallbackChanged = await linearWebhookDeliveryId('', {
    ...payload,
    data: { ...payload.data, title: 'A genuinely different title' },
  });
  console.log(JSON.stringify({
    first, retry, second, fallback, malformedHeaderFallback, fallbackRetry, fallbackChanged,
  }));
`;
const deliveryChild = spawnSync(process.execPath, ['--input-type=module', '--eval', deliveryRunner], {
  encoding: 'utf8',
});
ok(deliveryChild.status === 0,
  `delivery identity helper executes offline (${(deliveryChild.stderr || '').trim()})`);
if (deliveryChild.status === 0) {
  const identity = JSON.parse(deliveryChild.stdout.trim());
  ok(identity.first === identity.retry && identity.first !== identity.second
    && identity.first === 'linear-delivery:11111111-1111-4111-8111-111111111111',
  'an exact retry deduplicates while two deliveries from one webhook configuration remain distinct');
  ok(identity.fallback === identity.malformedHeaderFallback
    && identity.fallback === identity.fallbackRetry
    && identity.fallback !== identity.fallbackChanged
    && /^linear-payload-v1-sha256:[0-9a-f]{64}$/.test(identity.fallback),
  'headerless fallback is key-order stable, ignores configuration/send-time fields, and changes with semantic content');
}
ok(/const DELIVERY_HEADER = "linear-delivery"/.test(FN)
  && /req\.headers\.get\(DELIVERY_HEADER\)/.test(FN)
  && /Linear body webhookId is the webhook configuration ID, not a delivery/.test(FN)
  && !/clean\(payload\.(?:id|webhookId|deliveryId)/.test(FN),
  'all inbound provenance uses the authenticated request delivery identity, never a body configuration ID');
ok(/F133_FLAG_KEY = "f133_canonical_title_enabled"/.test(FN)
  && /Object\.keys\(parsed\)\.length === 1 && parsed\.enabled === true/.test(FN)
  && /catch \(_error\) \{[\s\S]{0,40}return false/.test(inboundF133FlagFn)
  && /await f133CanonicalTitleEnabled\(supabase\)/.test(FN),
  'F133 inbound activation is exact-true only and missing, malformed, or unreadable state fails closed');
ok(/function canonicalTitle\(value: unknown\): string \{[\s\S]*typeof value !== "string"[\s\S]*value\.includes\("\\0"\)[\s\S]*replace\(\/\\s\+\/gu, " "\)[\s\S]*title\.length > 500[\s\S]*\\u0000-\\u001f\\u007f/.test(FN),
  'Linear inbound applies the same whitespace, blank, control, and length title contract as native writes');
const canonicalTitleFn = vm.runInNewContext('(' + extractFunction(FN, 'canonicalTitle')
  .replace('(value: unknown): string', '(value)') + ')');
ok(canonicalTitleFn('  Campaign\n\tLaunch  ') === 'Campaign Launch'
  && canonicalTitleFn('   ') === ''
  && canonicalTitleFn('unsafe\u0001title') === ''
  && canonicalTitleFn('x'.repeat(501)) === ''
  && canonicalTitleFn(`bad\0title`) === '',
  'executable inbound title validation collapses whitespace and rejects blank, control, NUL, and oversized values');
ok(/source_deliverable_id: sourceDeliverableId/.test(canonicalTitleRequestFn)
  && /source_issue_uuid: sourceIssueUuid/.test(canonicalTitleRequestFn)
  && /const sourceIssueUuid = linearIssueUuid\(issue\) \|\| clean\(existing\.linear_issue_uuid\)/.test(canonicalTitleRequestFn)
  && /const sourceIdentifier = linearIdentifier\(issue\) \|\| clean\(existing\.linear_identifier\)/.test(canonicalTitleRequestFn)
  && /const sourceIssueUrl = linearIssueUrl\(issue\) \|\| clean\(existing\.linear_issue_url\)/.test(canonicalTitleRequestFn)
  && /source_identifier: sourceIdentifier/.test(canonicalTitleRequestFn)
  && /source_issue_url: sourceIssueUrl/.test(canonicalTitleRequestFn)
  && /delivery_id: deliveryId/.test(canonicalTitleRequestFn)
  && !/webhookId|payload\.id|payload\.deliveryId/.test(canonicalTitleRequestFn)
  && /source_edited_at: sourceEditedAt/.test(canonicalTitleRequestFn)
  && /title,/.test(canonicalTitleRequestFn)
  && /!sourceDeliverableId \|\| !sourceIssueUuid \|\| !sourceIdentifier[\s\S]*!sourceIssueUrl \|\| !deliveryId \|\| deliveryId\.length > 500[\s\S]*!sourceEditedAt/.test(canonicalTitleRequestFn),
  'canonical inbound request binds the exact deliverable, provider identity, delivery, timestamp, and normalized title');
ok(/rpc\("production_canonical_title_from_linear", \{[\s\S]*p_request: request/.test(canonicalTitleConvergeFn)
  && !/outbounds|target_deliverable|target_team/.test(canonicalTitleConvergeFn)
  && /receipt\.ok !== true/.test(canonicalTitleConvergeFn)
  && /receipt\.source_deliverable_id/.test(canonicalTitleConvergeFn)
  && /receipt\.title/.test(canonicalTitleConvergeFn)
  && /linkedCount < 1 \|\| linkedCount > 2/.test(canonicalTitleConvergeFn)
  && /outboxCount > linkedCount - 1/.test(canonicalTitleConvergeFn)
  && /typeof receipt\.superseded !== "boolean"/.test(canonicalTitleConvergeFn)
  && /typeof receipt\.test_only !== "boolean"/.test(canonicalTitleConvergeFn)
  && /typeof stale !== "boolean"/.test(canonicalTitleConvergeFn)
  && /rows\.length !== linkedCount[\s\S]*rowIds\.includes\(clean\(request\.source_deliverable_id\)\)[\s\S]*rows\.some\(row => clean\(row\.title\) !== receiptCardTitle\)/.test(canonicalTitleConvergeFn)
  && /stale === true[\s\S]*receipt\.replayed !== false[\s\S]*receipt\.noop !== true[\s\S]*receipt\.superseded !== true[\s\S]*outboxCount !== 0[\s\S]*receipt\.event_id !== null[\s\S]*receipt\.event_key !== null[\s\S]*outboxIds\.length !== 0[\s\S]*receipt\.current_title/.test(canonicalTitleConvergeFn),
  'inbound invokes only the service-owned target derivation and rejects a non-exact bounded receipt');
ok(issueHandlerFn.indexOf('if (await isDetectOnlyTeam')
    < issueHandlerFn.indexOf('if (canonicalTitleIntent) canonicalTitleRequest')
  && issueHandlerFn.indexOf('return { ok: true, detect_only: true }')
    < issueHandlerFn.indexOf('if (canonicalTitleIntent) canonicalTitleRequest'),
  'after the Graphics flip, Graphics remains detect-only while still-Linear-authoritative Video can enter canonical convergence');
ok(/const canonicalTitleIntent = canonicalSurface[\s\S]{0,220}payloadChangesTitle/.test(issueHandlerFn)
  && !/canonicalTitleIntent = f133Enabled/.test(issueHandlerFn)
  && /delete row\.title;[\s\S]{0,80}delete row\.linear_raw;/.test(issueHandlerFn)
  && issueHandlerFn.indexOf('delete row.linear_raw')
    < issueHandlerFn.indexOf('convergeCanonicalTitleFromLinear(supabase, written')
  && issueHandlerFn.indexOf('convergeCanonicalTitleFromLinear(supabase, written')
    < issueHandlerFn.indexOf('maintainCardLinkage(supabase, written')
  && /canonical_title_rpc_missing/.test(issueHandlerFn)
  && /canonical_title_pre_ddl_fallback/.test(issueHandlerFn)
  && /\["PGRST202", "42883"\]/.test(FN)
  && /production_canonical_title_from_linear/.test(FN),
  'linked titles use the canonical capability while OFF, with only exact pre-DDL missing-RPC fallback and retryable post-DDL guard failure');
const payloadChangesTitleFn = extractFunction(FN, 'payloadChangesTitle');
ok(/objectAt\(payload\.updatedFrom\)/.test(payloadChangesTitleFn)
  && /objectAt\(data\.updatedFrom\)/.test(payloadChangesTitleFn)
  && /hasOwnProperty\.call\(topLevel, "title"\)/.test(payloadChangesTitleFn)
  && /hasOwnProperty\.call\(nested, "title"\)/.test(payloadChangesTitleFn),
  'title intent detection checks both supported updatedFrom envelopes instead of letting an empty outer object mask the nested change');
ok(/canonicalTitleReceipt\.stale === true \? "title_stale" : "title_change"/.test(issueHandlerFn)
  && /title_stale: canonicalTitleReceipt\.stale === true/.test(issueHandlerFn),
  'bounded stale title receipts are acknowledged distinctly without being reported as a canonical mutation');
const webhookHandlerFn = extractFunction(FN, 'handleLinearWebhook');
ok(webhookHandlerFn.indexOf('const echo = await recentOutboundEcho')
    < webhookHandlerFn.indexOf('return await handleIssueEvent')
  && /if \(echo\) \{[\s\S]*recordOutboundEchoDrop[\s\S]*return \{ ok: true, dropped: "syncview_mirror_echo"/.test(webhookHandlerFn),
  'opposite-side title mirror webhooks are proven and dropped before canonical inbound handling, preventing echo loops');

ok(/rpc\("deliverable_write"/.test(FN), 'deliverable writes must go through deliverable_write RPC');
ok(/rpc\("batch_write"/.test(FN), 'batch writes must go through batch_write RPC helper');
ok(!/from\("deliverables"\)[\s\S]{0,120}\.(insert|update|upsert|delete)\(/.test(FN),
  'linear-inbound must not directly mutate deliverables');
ok(!/from\("batches"\)[\s\S]{0,120}\.(insert|update|upsert|delete)\(/.test(FN),
  'linear-inbound must not directly mutate batches');

ok(!/sidneylaruel|jesseisrael|lilybaker|mikiagrawal|chelseyscaffidi|daniellerobin/i.test(FN),
  'linear-inbound source must not contain real client slugs');

console.log('linear-inbound source checks passed');
