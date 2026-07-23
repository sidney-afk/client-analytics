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
assert(shared.includes("throw _writeUiGatewayError(409, 'legacy_resume_lease_revoked')")
  && shared.indexOf('requireResumeOwner();', shared.indexOf('const authority = await _writeUiRefreshAuthority()'))
    < shared.indexOf('const resp = await fetch(WRITE_UI_PRODUCTION_WRITE_URL')
  && shared.includes('onLegacyResumeTransportStart'),
'legacy queue gateway retries must recheck the exact owner after internal awaits and at the real POST boundary');
assert(shared.includes("throw _writeUiGatewayError(503, 'authority_unavailable')"), 'authority lookup must fail closed');
assert(shared.includes('_syncviewEfHeaders('), 'gateway must reuse staff/client authentication headers');
assert(source.includes('const run = _syncviewClientEntryDataRun')
  && source.includes('_syncviewClientEntryRunCurrent(run) ? _syncviewClientWriteToken()'),
'client credentials must not attach before the exact strict-verification run is current');
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
  assert(drain.includes("owner.kind === 'client'")
    && drain.includes('snapshot.filter(item => _writeUiLegacyItemOwnedBy(item, owner))'),
  `${name} client drain must select only debt owned by the verified client`);
  assert(drain.indexOf('await _writeUiPrimeRerouteFlag()') > drain.indexOf('_writeUiLegacyResumeOwnerCurrent(owner)')
    && drain.indexOf('_writeUiLegacyResumeOwnerCurrent(owner)', drain.indexOf('await _writeUiPrimeRerouteFlag()'))
      < drain.indexOf("_writeUiLegacyDrainWithLock('"),
  `${name} drain must recheck its exact lease after the routing read and before taking the delivery lock`);
  const legacyPostAt = drain.indexOf('const resp = await fetch(endpoint');
  const gatewayPostAt = drain.indexOf('await _writeUiGatewayPost({');
  assert(drain.lastIndexOf('_writeUiLegacyResumeOwnerCurrent(owner)', legacyPostAt) < legacyPostAt
    && drain.lastIndexOf('_writeUiLegacyResumeOwnerCurrent(owner)', legacyPostAt) > drain.lastIndexOf('try {', legacyPostAt)
    && drain.lastIndexOf('_writeUiLegacyResumeOwnerCurrent(owner)', gatewayPostAt) < gatewayPostAt,
  `${name} drain must recheck the exact lease immediately before either POST transport`);
  const finalizeAt = drain.indexOf('await _writeUiLegacyFinalizeFlush(');
  assert(finalizeAt >= 0
    && drain.includes('() => deliveryStarted || _writeUiLegacyResumeOwnerCurrent(owner)')
    && drain.indexOf('if (finalized && finalized.deferred === true)', finalizeAt) > finalizeAt,
  `${name} finalizer must retain a no-transport row when its owner expires while waiting for the surface lock`);
}

const legacyFinalize = between('async function _writeUiLegacyFinalizeFlush', 'function _writeUiLegacyQuarantine');
assert(legacyFinalize.indexOf("typeof finalizeGuard === 'function'") >= 0
  && legacyFinalize.indexOf("typeof finalizeGuard === 'function'")
    < legacyFinalize.indexOf('_writeUiLegacyOutboxItems(surface)'),
'the optional lease guard must run inside the acquired finalizer lock before any queue read or write');

const legacyOwner = between('const _writeUiLegacyClientRunIds', 'function _writeUiGatewayError');
assert(legacyOwner.includes('new WeakMap()')
  && legacyOwner.includes('runId = ++_writeUiLegacyClientRunIdSeq')
  && legacyOwner.includes("['client', owner.runId, owner.generation, owner.slug]"),
'client queue coalescing keys must bind captured run identity and generation, not mutable href');
assert(legacyOwner.includes('verificationEpoch: _syncviewStaffVerificationEpoch')
  && legacyOwner.includes("['staff', owner.principal, owner.verificationEpoch]")
  && legacyOwner.includes('Number(owner.verificationEpoch) === _syncviewStaffVerificationEpoch'),
'staff queue owners must bind the exact successful verification epoch as well as the principal');
const staffIdentity = between('let _syncviewStaffIdentityVerified', 'function _syncviewStaffEsc');
assert(staffIdentity.includes('let _syncviewStaffVerificationEpoch = 0'));
assert(source.includes('function _syncviewInvalidateStaffVerification()')
  && source.includes('function _syncviewAcceptStaffVerification()')
  && source.includes('_syncviewAcceptStaffVerification();'),
'staff verification success and invalidation must advance a monotonic session epoch');
assert(legacyOwner.includes("String(item && item.client_slug || '')")
  && legacyOwner.includes('if (!slug || slug !== owner.slug) return false')
  && legacyOwner.includes('if (!gateSlug || gateSlug !== owner.slug) return false'),
'client queue ownership must fail closed for foreign, empty, or inconsistent client slugs');

const lifecycle = between('function _writeUiResumeLegacyQueues', '/* Point-adoption:');
for (const event of ["'focus'", "'pageshow'", "'pagehide'", "'online'", "'visibilitychange'", "'startup'"]) {
  assert(lifecycle.includes(event), `legacy queue lifecycle missing ${event}`);
}
assert(lifecycle.includes('_writeUiRefreshAuthority()'));
assert(lifecycle.includes('_writeUiExpireV1Caches()'));
assert(lifecycle.indexOf('const owner = _writeUiLegacyResumeOwner(clientEntryRun)')
  < lifecycle.indexOf('await _writeUiPrimeRerouteFlag()'),
'every lifecycle resume must acquire a verified owner before any queue work');
assert(lifecycle.indexOf('await _writeUiPrimeRerouteFlag()') < lifecycle.indexOf('const linearQueueResume'), 'retry classification must await the per-client allowlist');
assert(lifecycle.indexOf('const linearQueueResume') < lifecycle.indexOf('const authority = await _writeUiRefreshAuthority()'), 'identified legacy n8n retries must not depend on prod_authority availability');
assert(lifecycle.includes('_resumePendingCalCardJobs(authority)'), 'post-submit v1 jobs must share the authority-gated lifecycle');
assert(lifecycle.includes("_writeUiResumeLegacyQueues('timer')"), 'legacy queues need a bounded timer drain path');
const pagehideAt = lifecycle.indexOf("window.addEventListener('pagehide'");
const pagehideOwnerAt = lifecycle.indexOf('const owner = _writeUiLegacyResumeOwner()', pagehideAt);
const pagehideReadAt = lifecycle.indexOf('const calendarCount = _linearOutboxRead()', pagehideAt);
assert(pagehideOwnerAt > pagehideAt
  && lifecycle.indexOf('if (!_writeUiLegacyResumeOwnerCurrent(owner)) return', pagehideOwnerAt) < pagehideReadAt,
'pagehide diagnostics must not inspect queue storage before client or staff verification');
const clientResumeAt = lifecycle.indexOf("if (owner.kind === 'client')");
const staffResumeAt = lifecycle.indexOf('_writeUiExpireV1Caches()', clientResumeAt);
const clientResume = lifecycle.slice(clientResumeAt, staffResumeAt);
assert(clientResumeAt >= 0 && staffResumeAt > clientResumeAt
  && clientResume.includes('_linearOutboxFlush(owner)')
  && clientResume.includes('_sxrLinearOutboxFlush(owner)')
  && !clientResume.includes('_linearIntakeRead')
  && !clientResume.includes('_calCardJobsRead')
  && !clientResume.includes('_writeUiRefreshAuthority')
  && !clientResume.includes('_writeUiResumeSourceRepairs')
  && !clientResume.includes('_kasperResumeSourceRepairs')
  && !clientResume.includes('_writeUiLegacyHydrateConfirmedCacheAfterAuthority'),
'verified client resume is limited to matching Calendar/SXR retry debt and excludes staff/global repair lanes');
const clientEntry = between('function _syncviewPurgeClientEntrySurface', 'function _syncviewSuspendClientEntry');
assert(clientEntry.includes('_writeUiCancelClientLegacyRetryTimers()')
  && clientEntry.includes("_writeUiResumeLegacyQueues('client-verified', dataRun).catch"),
'client teardown clears retry timers and strict success explicitly resumes debt without awaiting it');
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
