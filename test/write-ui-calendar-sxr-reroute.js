'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function between(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `missing source range: ${start}`);
  return source.slice(a, b);
}

const shared = between('const WRITE_UI_PRODUCTION_WRITE_URL', 'function _calUpsertFetch');
assert(shared.includes("'/functions/v1/production-write'"));
assert(shared.includes('const authority = await _writeUiRefreshAuthority()'), 'every gateway intent must live-read authority before its first attempt');
assert(shared.includes("throw _writeUiGatewayError(503, 'authority_unavailable')"), 'authority lookup must fail closed');
assert(shared.includes('_syncviewEfHeaders('), 'gateway must reuse staff/client authentication headers');
assert(shared.includes('payload.legacy_parity = true'), 'Linear-authority parity must be explicit');
assert(shared.includes("intent.legacyOnly && authority[intent.team] !== 'linear'"), 'a stale legacy queue row must be rejected before transport after a team flip');
assert(shared.includes('payload.id = intent.nativeId'), 'native linkage must be preferred');

const calendar = between('function _calPushStatusToLinear', 'function _calUrgentSameRound');
const calendarLegacy = between('function _calLegacyPushStatusToLinear', 'function _calPushStatusToLinear');
assert(calendar.includes("surface: 'calendar'"));
assert(calendar.includes("await _writeUiUseGatewayWhenReady('calendar', meta)"), 'Calendar reroute awaits its client allowlist');
assert(calendar.includes('_calLegacyPushStatusToLinear') && calendar.includes('_calLegacyPostLinearComment'), 'Calendar retains both legacy transports');
assert(calendar.includes('_writeUiGatewayWithRepair({'));
assert(calendar.includes('native_comment_id: nativeCommentId'));
assert(calendar.includes('parent_id:'));
assert(calendar.includes('audience:'));
assert(calendar.includes('is_tweak:'));
assert(calendar.includes('round:'));
assert(calendar.includes('const targetKey = nativeId || url'), 'Calendar status accepts a native id without a Linear URL');
assert(calendar.includes('return chain'), 'Calendar status exposes an awaitable gateway acknowledgement');
assert(calendar.includes('if (!url && !nativeId)') && calendar.includes("_writeUiClassifyTargetless('calendar'"), 'Calendar comment accepts native id and live-classifies every targetless write');
assert(calendarLegacy.includes('fetch(LINEAR_SET_STATUS_URL') && calendarLegacy.includes('fetch(LINEAR_ADD_COMMENT_URL'), 'Calendar legacy lane keeps the original n8n endpoints');

const sxr = between('function _sxrPushStatusToLinear', '/* Point-adoption:');
const sxrLegacy = between('function _sxrLegacyPushStatusToLinear', 'function _sxrPushStatusToLinear');
assert(sxr.includes("surface: 'sxr'"));
assert(sxr.includes("await _writeUiUseGatewayWhenReady('sxr', meta)"), 'SXR reroute awaits its client allowlist');
assert(sxr.includes('_sxrLegacyPushStatusToLinear') && sxr.includes('_sxrLegacyPostLinearComment'), 'SXR retains both legacy transports');
assert(sxr.includes('_writeUiGatewayWithRepair({'));
assert(sxr.includes('native_comment_id: nativeCommentId'));
assert(sxr.includes('const targetKey = nativeId || url'), 'SXR status accepts a native id without a Linear URL');
assert(sxr.includes('return chain'), 'SXR status exposes an awaitable gateway acknowledgement');
assert(sxr.includes('if (!url && !nativeId)') && sxr.includes("_writeUiClassifyTargetless('sxr'"), 'SXR comment accepts native id and live-classifies every targetless write');
assert(sxrLegacy.includes('fetch(LINEAR_SET_STATUS_URL') && sxrLegacy.includes('fetch(LINEAR_ADD_COMMENT_URL'), 'SXR legacy lane keeps the original n8n endpoints');

const calEnqueue = between('function _linearOutboxEnqueue', 'function _writeUiLegacyQuarantine');
const sxrEnqueue = between('function _sxrLinearOutboxEnqueue', 'function _sxrLinearOutboxScheduleRetry');
assert(calEnqueue.includes("transport: 'legacy_n8n'")
  && calEnqueue.includes("await _writeUiLegacyAppendOutboxItem('calendar', record)"),
'Calendar identified n8n retries enter the cross-tab-safe legacy queue');
assert(sxrEnqueue.includes("transport: 'legacy_n8n'")
  && sxrEnqueue.includes("await _writeUiLegacyAppendOutboxItem('sxr', record)"),
'SXR identified n8n retries enter the cross-tab-safe legacy queue');

const calDrain = between('async function _linearOutboxFlushRun', 'window.clearLinearOutbox');
const sxrDrain = between('async function _sxrLinearOutboxFlushRun', 'window.clearSxrLinearOutbox');
for (const [name, drain] of [['Calendar', calDrain], ['SXR', sxrDrain]]) {
  assert(drain.includes("transport === 'legacy_n8n'") && drain.includes('LINEAR_ADD_COMMENT_URL') && drain.includes('LINEAR_SET_STATUS_URL'), `${name} identified legacy rows retain direct n8n retry`);
  assert(drain.includes("it.kind === 'comment' || it.kind === 'status'"), `${name} historical statuses and comments must both leave the active queue`);
  assert(drain.includes('native_comment_id'), `${name} queue must persist a stable comment id`);
  assert(drain.includes('legacy_actor_unverifiable'), `${name} must quarantine unverifiable historical attribution without replay`);
}

const lifecycle = between('function _writeUiResumeLegacyQueues', '/* Point-adoption:');
for (const event of ["'focus'", "'pageshow'", "'pagehide'", "'online'", "'visibilitychange'", "'startup'"]) {
  assert(lifecycle.includes(event), `legacy queue lifecycle missing ${event}`);
}
assert(lifecycle.includes('_writeUiRefreshAuthority()'));
assert(lifecycle.includes('_writeUiExpireV1Caches()'));
assert(lifecycle.indexOf('await _writeUiPrimeRerouteFlag()') < lifecycle.indexOf('const linearQueueResume'), 'retry classification must await the per-client allowlist');
assert(lifecycle.indexOf('const linearQueueResume') < lifecycle.indexOf('const authority = await _writeUiRefreshAuthority()'), 'identified legacy n8n retries must not depend on prod_authority availability');
assert(lifecycle.includes('_resumePendingCalCardJobs(authority)'), 'post-submit v1 jobs must share the authority-gated lifecycle');
assert(lifecycle.includes("_writeUiResumeLegacyQueues('timer')"), 'legacy queues need a bounded timer drain path');
assert(source.includes('window.peekSxrLinearOutbox'));
assert(lifecycle.includes('window.peekWriteUiLegacyQueueState'));
for (const field of ['calendar_linear', 'sxr_linear', 'submission_cards', 'native_intake', 'source_repairs', 'legacy_quarantine']) assert(lifecycle.includes(field));
assert(lifecycle.includes('unknown_records') && lifecycle.includes("drain_state: unknown ? 'unknown' : 'observed'"), 'corrupt local debt cannot be reported as a clean zero');
const cardJobs = between('function _calCardJobTeams', '// Tabs that fetch their own data sources');
assert(cardJobs.includes("authority[team] !== 'linear'"), 'post-submit v1 jobs may drain only while every required team remains Linear-authoritative');
assert(cardJobs.includes("'discarded_authority'"), 'flipped-team v1 jobs must terminally discard with diagnostics');

assert(source.includes("const CAL_LINEAR_META_LS_KEY = 'syncview_calLinearMeta_v2'"));
assert(source.includes("const CAL_CACHE_KEY_PREFIX = 'syncview_calCache_v2:'"));
assert(source.includes("const SXR_CACHE_PREFIX = 'syncview_sxr_cache_v2_'"));
assert(source.includes('_writeUiFilterCachedPosts(parsed.posts, authority)'));
assert(source.includes('_writeUiFilterCachedPosts(o.posts, authority)'));
assert(source.includes('if (!authority) return null;'), 'cache reads must fail closed without live authority');

assert(source.includes("await _calPushStatusToLinear(post.linear_issue_id"));
assert(source.includes("await _calPushStatusToLinear(post.graphic_linear_issue_id"));
assert(source.includes("await _sxrPushStatusToLinear(post.linear_issue_id"));
assert(source.includes("await _sxrPushStatusToLinear(post.graphic_linear_issue_id"));
assert(source.includes('comment: newComment'));
assert(source.includes('parentId: msg.parent_id'));
assert(source.includes('comment: linearMeta'));
assert(!source.includes('if (linUrl) _calPostLinearComment'));
assert(!source.includes('if (linUrl) _sxrPostLinearComment'));

console.log('write UI Calendar/SXR allowlisted gateway, legacy retry queues, lifecycle, and cache guards: ok');
