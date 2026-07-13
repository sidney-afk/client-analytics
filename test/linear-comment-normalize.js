'use strict';

const path = require('path');
const { pathToFileURL } = require('url');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

(async () => {
  const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'linear-inbound', 'comment-normalize.mjs')).href;
  const { normalizeLinearComment, parseSyncViewBridgeBody, stableCommentAuthor } = await import(moduleUrl);

  const parsed = parseSyncViewBridgeBody('**Test Editor (via SyncView):** Please check https://example.test/a <!-- syncview-mirror:native-42 -->');
  ok(parsed.bridge_authored && parsed.bridge_author_name === 'Test Editor', 'bridge envelope exposes the human display author');
  ok(parsed.body === 'Please check https://example.test/a' && parsed.mirror_marker === 'native-42', 'bridge transport wrapper and hidden marker are removed from display body');

  const bridge = normalizeLinearComment({
    action: 'create',
    comment: {
      id: 'lin-comment-1',
      body: '**Test Editor (via SyncView):** Please check this <!-- syncview-mirror:native-42 -->',
      createdAt: '2026-07-12T10:00:00Z',
      updatedAt: '2026-07-12T10:00:00Z',
      user: { id: 'linear-house', name: 'Linear webhook' },
      parentId: 'lin-parent-1',
    },
    issue: { id: 'lin-issue-1', identifier: 'VID-1', team: { key: 'VID' } },
    payload: { webhookId: 'delivery-1', webhookTimestamp: '2026-07-12T10:00:01Z' },
    echo: { comment_id: 'native-42' },
    member: { id: 'member-1', name: 'Test Editor', role: 'editor' },
  });
  ok(bridge.id === 'native-42' && bridge.native_comment_id === 'native-42', 'matched outbound echo links the native and Linear comment IDs');
  ok(bridge.author_key === 'team:member-1' && bridge.author_name === 'Test Editor', 'bridge author is the stable human member, never the webhook transport actor');
  ok(bridge.transport_linear_user_id === 'linear-house' && bridge.transport_actor === 'Linear webhook', 'transport identity is retained separately for provenance');
  ok(bridge.parent_id === null && bridge.linear_parent_comment_id === 'lin-parent-1', 'reply metadata retains Linear ancestry until native parent linkage is safe');
  ok(bridge.provenance.bridge_authored === true && bridge.body === 'Please check this', 'bridge provenance is explicit without polluting the display body');

  const direct = normalizeLinearComment({
    action: 'update',
    comment: {
      id: 'lin-comment-2', body: 'Edited body', createdAt: '2026-07-11T09:00:00Z',
      updatedAt: '2026-07-12T09:00:00Z', user: { id: 'linear-human', name: 'Human Editor' },
    },
    issue: { id: 'lin-issue-2', identifier: 'GRA-2', team: { key: 'GRA' } },
    payload: {},
  });
  ok(direct.id === 'linear:lin-comment-2' && direct.native_comment_id === direct.id
    && direct.provenance.native_id_provenance === 'linear_derived', 'direct Linear comments mint a deterministic native ID while retaining the Linear ID');
  ok(direct.author_key === 'linear:linear-human', 'direct Linear comments use stable Linear human identity');
  ok(direct.edited_at === '2026-07-12T09:00:00.000Z', 'update events carry edit state');

  const removed = normalizeLinearComment({
    action: 'remove',
    comment: { id: 'lin-comment-3', user: { id: 'linear-human', name: 'Human Editor' } },
    issue: { id: 'lin-issue-3', identifier: 'VID-3' },
    payload: { webhookTimestamp: '2026-07-12T12:00:00Z' },
  });
  ok(removed.deleted_at === '2026-07-12T12:00:00.000Z', 'remove events carry a durable tombstone timestamp');
  ok(removed.provenance.timestamp_provenance === 'webhook_fallback', 'fallback timestamps are labelled rather than presented as original history');
  ok(!Object.prototype.hasOwnProperty.call(removed, 'body')
    && !Object.prototype.hasOwnProperty.call(removed, 'source_created_at')
    && !Object.prototype.hasOwnProperty.call(removed, 'resolved_at'),
  'remove payloads omit unavailable mutable snapshot fields');

  const partialEdit = normalizeLinearComment({
    action: 'update',
    comment: { id: 'lin-comment-4', body: 'Only this changed' },
    issue: { id: 'lin-issue-4', identifier: 'VID-4' },
    payload: { webhookTimestamp: '2026-07-12T12:30:00Z' },
  });
  ok(partialEdit.body === 'Only this changed'
    && !Object.prototype.hasOwnProperty.call(partialEdit, 'author_key'),
  'partial edits carry available body without inventing unavailable author identity');

  ok(stableCommentAuthor({ authorName: 'Same Person', bridgeAuthored: true }).author_key === 'bridge:same-person', 'unmapped bridge humans still get a deterministic author key');

  if (failures) process.exit(1);
  console.log('\nLinear comment normalization checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
