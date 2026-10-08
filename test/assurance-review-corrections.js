'use strict';
/*
 * Corrections to site-assurance batches 1 to 5, from an independent review of
 * those changes run before any of them was merged (2026-10-08), plus one route
 * defect from the cycle 3 journey sweep. OPEN_REPAIRS 376 has the stories.
 * Each block lifts the real function and runs it against stand-ins; where a
 * function needs half the page to run, the block reads its code and says so.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction, stripNonCode } = require('./helpers/extract-function.js');

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}
const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const lift = name => extractFunction(INDEX, name);
const liftAsync = name => 'async ' + lift(name);
const code = name => stripNonCode(lift(name));
const tick = () => new Promise(r => setImmediate(r));

let finished = false;
process.on('exit', c => { if (!finished && c === 0) { console.log('FAIL  the suite stopped before its last check'); process.exitCode = 1; } });

(async () => {
  // --- 1. SyncLinear: unsent text never crosses audiences into a reply --------------
  try {
    const begin = (draftAudience, threadAudience) => {
      const env = { confirms: [], draft: { body: 'staff-only words', audience: draftAudience, action: 'add', commentId: '', parentId: '' } };
      env.run = new Function('env', 'threadAudience', `
        const _prodComments = { find: () => ({ id: 'c1', body: 'thread', audience: threadAudience, version: 1, row_updated_at: 'T', parent_id: '' }) };
        const _prodCommentDraftFor = () => env.draft;
        const _prodCommentDraftKeep = () => {};
        const _prodRender = () => {};
        const showConfirm = (title, msg, onYes, yesLabel) => env.confirms.push({ msg, onYes, yesLabel });
        const setTimeout = () => 0;
        ${lift('_prodCommentBegin')}
        return _prodCommentBegin;
      `)(env, threadAudience);
      env.run('d1', 'add', 'c1');
      return env;
    };
    const leak = begin('internal', 'client');
    ok(leak.confirms.length === 1 && leak.draft.body === 'staff-only words' && leak.draft.parentId === '',
      'SyncLinear: an unsent internal comment is not moved into a reply on a client-visible thread; the person is asked');
    leak.confirms[0].onYes();
    ok(leak.draft.parentId === 'c1' && leak.draft.body === '' && leak.draft.audience === 'client',
      'SyncLinear: choosing to reply starts an empty reply with the thread\'s audience');
    const other = begin('client', 'internal');
    ok(other.confirms.length === 1 && other.draft.parentId === '', 'SyncLinear: the same holds the other way round');
    const same = begin('internal', 'internal');
    ok(same.confirms.length === 0 && same.draft.body === 'staff-only words' && same.draft.parentId === 'c1',
      'SyncLinear: text still follows into a reply on a thread of its own audience');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 2. SyncLinear: a second click on the same Resolve is ignored, not an error ----
  try {
    const env = { writes: 0, state: { lifecycleKey: '', lifecycleRequestId: '', error: '' } };
    let answer;
    const click = new Function('env', 'pending', `
      const _prodIssue = id => ({ id });
      const _prodComments = { find: () => ({ id: 'c1', version: 1, row_updated_at: 'T' }), adopt: () => {}, refresh: () => {} };
      const _prodCommentDraftFor = () => env.state;
      const _prodWriteRequestId = () => 'req';
      let first = true;
      const _prodGatewayWrite = () => { env.writes++; if (first) { first = false; return pending; } return Promise.resolve(null); };
      const _prodRender = () => {};
      const _writeUiRecordFailure = () => {}, _prodWriteErrorText = () => 'refused';
      ${lift('_prodCommentLifecycle')}
      return () => _prodCommentLifecycle('d1', 'c1', 'resolve');
    `)(env, new Promise(resolve => { answer = resolve; }));
    click(); click();
    await tick();
    ok(env.writes === 1, 'SyncLinear: a double click on Resolve sends one request');
    answer({ comment: { id: 'c1' } });
    await tick(); await tick();
    ok(env.state.error === '', 'SyncLinear: and leaves no "was not sent" message beside a thread that was resolved');
    click();
    ok(env.writes === 2, 'SyncLinear: once it has answered the button works again');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 3. Instagram: "Post For Me did not accept it" shows the reason but keeps the attempt
  try {
    const fns = new Function(`${lift('_igCreateAnswerIsFinal')}\n${lift('_igCreateRefusalReason')}\nreturn { final: _igCreateAnswerIsFinal, reason: _igCreateRefusalReason };`)();
    const refused = { status: 200, json: { ok: false, error: 'Internal server error', row: { id: 'r1', status: 'failed' } } };
    ok(fns.final(refused) === false, 'Instagram: HTTP 200 with a failed row is never treated as final (the post may exist)');
    ok(fns.reason(refused) === 'Internal server error', 'Instagram: but its reason is read, to be shown');
    ok(fns.final({ status: 403, json: { ok: false, error: 'not allowed' } }) === true && fns.reason({ status: 403, json: { ok: false } }) === '',
      'Instagram: a 4xx is still final');
    ok(fns.reason({ status: 500, json: { ok: false, error: 'x', row: { status: 'failed' } } }) === '' && fns.reason({ status: 0, json: null }) === '',
      'Instagram: a server error or no answer has no reason to show and stays "could not confirm"');
    const submit = code('_igSubmit');
    ok(/if \(final\) igState\.attempt = null;/.test(submit) && !/if \(reason\) \{[\s\S]{0,400}igState\.attempt = null/.test(submit),
      'Instagram: the attempt (and its key) is cleared only by a final answer');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 4. Calendar: an older change still waiting on a card is not "this save failed" --
  try {
    const run = async chip => {
      const env = { notices: [] };
      const posts = [{ id: 'p1' }, { id: 'p2' }];
      await new Function('env', 'posts', 'chip', `
        const _isClientLink = false, CAL_COLORS = ['red'], CAL_BULK_ARCHIVE_CONCURRENCY = 3;
        const calState = { selected: new Set(['p1', 'p2']), posts, selectMode: true };
        const _calPendingEdits = {}, _calSaveTimers = {};
        const _calIsBlankId = () => false;
        const document = { querySelectorAll: () => [] };
        const _calRenderBody = () => {};
        const showNotify = title => env.notices.push(title);
        const _calFlushCardSave = async pid => { if (pid === 'p1') posts[0]._saveError = chip; };
        const _calRunPooled = async (ids, n, fn) => Promise.allSettled(ids.map(fn));
        ${liftAsync('_calApplyBulkColor')}
        return _calApplyBulkColor(null, 'red');
      `)(env, posts, chip);
      return env.notices.join();
    };
    ok(await run('Not saved yet: Video to Approved.') === 'Color updated', 'Calendar: bulk colour on a card with an older unsaved status still says "Color updated"');
    ok(await run('HTTP 500') === 'Some colors were not saved', 'Calendar: a colour that really failed is still reported');
    ok(/_saveError && !\/\^Not saved yet: \/\.test\(String\(current\._saveError\)\)/.test(lift('_calReviewComment')),
      'Calendar Review: the same older-change chip is not shown as "Comment not saved yet"');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 5. Calendar: a parked edit that comes back is shown, not only saved ------------
  try {
    const env = { renders: 0, flushed: [] };
    const post = { id: 'p1', caption: 'Server caption', video_status: 'In Progress' };
    const restored = new Function('env', 'post', `
      const _calParkedEdits = { alpha: { p1: { principal: 'me', edits: { caption: 'Typed before the switch', video_status: 'Approved', _calPriorStatus: { video_status: 'In Progress' } } } } };
      const calState = { client: 'Alpha', posts: [post] };
      const calClientSlug = n => String(n).toLowerCase();
      const _writeUiPrincipalKey = () => 'me';
      const _writeUiQueueDiagnostic = () => {}, showNotify = () => {};
      const _calPendingEdits = {};
      const _CAL_ROLLBACK_FIELDS = ['video_status', 'status'];
      const _calFlushCardSave = pid => env.flushed.push(pid);
      const _calRenderBody = () => { env.renders++; };
      ${lift('_calRestoreParkedEdits')}
      return _calRestoreParkedEdits('alpha');
    `)(env, post);
    ok(restored === 1 && env.flushed.join() === 'p1', 'Calendar: a parked edit is handed back to the save engine');
    ok(post.caption === 'Typed before the switch' && env.renders === 1, 'Calendar: and its text is put on the card and painted');
    ok(post.video_status === 'In Progress', 'Calendar: a parked status is left for the save itself to apply');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 6. Samples: unsaved text from a failed save is kept for half an hour, not for ever
  try {
    const merged = ageMs => new Function('ageMs', `
      const sxrState = { posts: [{ id: 's1', name: 'Typed but not saved', updated_at: 'T0', _saveError: 'save failed', _saveErrorAt: Date.now() - ageMs, _writeUiRetryEdits: { name: 'Typed but not saved' } }] };
      const _sxrPendingEdits = {}, _sxrSaveInFlight = {}, _sxrFailedNewCards = new Set(), _sxrReorderOptimistic = new Map();
      const _SXR_ROLLBACK_FIELDS = ['video_status'], SXR_REORDER_GUARD_MS = 12000, SXR_FAILED_TEXT_KEEP_MS = 30 * 60 * 1000;
      const _sxrIsLocalStatusFresh = () => false, _sxrIsBlankId = () => false;
      const _sxrRecentSaveFields = new Map(), _sxrRecentSaveReconcile = () => null;
      const _thumbAdoptPersistedRevision = p => p, _writeUiSnapshotRepairRefs = () => [];
      const _sxrMergePostComments = w => w;
      ${lift('_sxrMergeServerRows')}
      return _sxrMergeServerRows([{ id: 's1', name: 'Renamed by a teammate', updated_at: 'T1' }])[0];
    `)(ageMs);
    ok(merged(60 * 1000).name === 'Typed but not saved', 'Samples: text from a save that failed a minute ago is kept');
    const old = merged(31 * 60 * 1000);
    ok(old.name === 'Renamed by a teammate' && !old._saveError, 'Samples: after half an hour the server copy wins again');
    ok(/SXR_FAILED_TEXT_KEEP_MS = 30 \* 60 \* 1000/.test(INDEX) && /cur\._saveErrorAt = Date\.now\(\)/.test(INDEX) && /delete wirePost\._saveErrorAt/.test(INDEX),
      'Samples: the failure is stamped when it happens, and the stamp is never sent to the server');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 7. A Calendar address for a client whose slug has "&" survives a reload ---------
  try {
    const route = fs.readFileSync(path.join(ROOT, 'src/index/003-sv-route.html.part'), 'utf8');
    const literal = (route.match(/if \(!(\/\^\\\/\(\?!\\\/\)\[[^\]]+\]\*\$\/)\.test\(p0\)/) || [])[1] || '';
    const allowed = literal ? new Function('return ' + literal)() : null;
    ok(!!allowed, 'the route script\'s path check was found');
    ok(!!allowed && allowed.test('/calendar/x&y/p_card_1'), 'a card link for a client whose slug has "&" is accepted, not sent to Home');
    ok(!!allowed && allowed.test('/calendar/fixtureclient/p_card_1') && allowed.test('/synclinear/VID-12'), 'ordinary addresses are still accepted');
    ok(!!allowed && !allowed.test('//evil.example/x') && !allowed.test('/calendar/<script>') && !allowed.test('/a b'), 'and the things it exists to refuse are still refused');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  finished = true;
  if (failures) { console.log('\n' + failures + ' check(s) failed'); process.exit(1); }
  console.log('\nassurance-review-corrections: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
