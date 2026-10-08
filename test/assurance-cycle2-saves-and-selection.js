'use strict';
/*
 * Site assurance, cycle 2 (2026-10-08): thirteen places where the page said
 * something about a save, a send or a selection that was not true. Each block
 * lifts the real function out of the app and runs it against stand-ins; where
 * a function needs half the page to run, the block reads its code instead and
 * says so. OPEN_REPAIRS 374 has the stories.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction, stripNonCode } = require('./helpers/extract-function.js');

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const lift = name => extractFunction(INDEX, name);
const liftAsync = name => 'async ' + lift(name);
const code = name => stripNonCode(lift(name));
const tick = () => new Promise(r => setImmediate(r));

let finished = false;
process.on('exit', c => { if (!finished && c === 0) { console.log('FAIL  the suite stopped before its last check'); process.exitCode = 1; } });

(async () => {
  // --- 1. Instagram: a definite refusal is not "could not confirm" ---
  try {
    const isFinal = new Function(`${lift('_igCreateAnswerIsFinal')}\nreturn _igCreateAnswerIsFinal;`)();
    // Corrected after review (test/assurance-review-corrections.js): this shape shows its
    // reason but is NOT final, because the same shape can mean the post exists.
    ok(isFinal({ status: 200, json: { ok: false, error: 'Caption is too long', row: { id: 'r1', status: 'failed' } } }) === false,
      'Instagram: HTTP 200 with ok:false and a failed row keeps the attempt (its reason is shown by _igCreateRefusalReason)');
    ok(isFinal({ status: 403, json: { ok: false, error: 'not allowed' } }) === true, 'Instagram: a 4xx is still a definite refusal');
    ok(isFinal({ status: 200, json: { ok: false, error: 'Post For Me answered 0', row: { id: 'r1', status: 'failed' } } }) === false,
      'Instagram: Post For Me not answering stays unknown (the post may exist)');
    ok(isFinal({ status: 200, json: { ok: false, error: 'Post For Me answered 503', row: { id: 'r1', status: 'failed' } } }) === false,
      'Instagram: a Post For Me 5xx stays unknown');
    ok(isFinal({ status: 500, json: { ok: false } }) === false && isFinal({ status: 0, json: null }) === false,
      'Instagram: a server error or no answer stays unknown');
    const submit = code('_igSubmit');
    ok(/_igCreateAnswerIsFinal\(created\)/.test(submit) && /igUnknown: !final/.test(submit) && /_igCreateRefusalReason\(created\)/.test(submit),
      'Instagram: the submit path uses that rule, and shows a refusal\'s reason');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 2. TikTok: the whole form is locked while an upload is out ---
  try {
    const fields = [{ id: 'tkPrivacy', disabled: false }, { id: 'tkCover', disabled: false }, { id: 'tkPostNow', disabled: false }];
    const run = submitting => new Function('fields', 'submitting', `
      const tkState = { submitting };
      const document = { getElementById: id => id === 'tkFormCol' ? { querySelectorAll: () => fields } : null };
      ${lift('_tkLockWhileSending')}
      _tkLockWhileSending();
    `)(fields, submitting);
    run(false);
    ok(fields.every(f => f.disabled === false), 'TikTok: nothing is locked while no upload is out');
    run(true);
    ok(fields.every(f => f.disabled === true), 'TikTok: privacy, cover and schedule fields are locked during an upload');
    ok(/_tkLockWhileSending\(\)/.test(code('_tkRenderForm')), 'TikTok: every form render applies the lock');
    const env = { photos: [], errors: 0 };
    new Function('env', `
      const tkState = { submitting: true, photos: env.photos };
      const TIKTOK_MAX_PHOTOS = 35;
      ${lift('_tkHandlePhotoFiles')}
      _tkHandlePhotoFiles([{ name: 'late.jpg', type: 'image/jpeg', size: 10 }]);
    `)(env);
    ok(env.photos.length === 0, 'TikTok: an image dropped during an upload is not added to the strip');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 3. TikTok: Cancel while the post is being created does not claim "cancelled" ---
  try {
    const create = lift('_tkCreateViaFunction');
    // The function has more than one abort branch (the storage upload has its own, where
    // "Upload cancelled." is true). The one that follows the create call is the one that matters.
    const afterCreate = create.slice(create.indexOf("action: 'create'"));
    const abortBranch = (afterCreate.match(/if \(e && e\.name === 'AbortError'\) \{[\s\S]*?return;\s*\}/) || [''])[0];
    ok(/tkState\.error = '[^']*may already exist/.test(abortBranch) && !/tkState\.error = 'Upload cancelled\.'/.test(abortBranch),
      'TikTok: cancelling during the create step says the post may already exist');
    ok(/_tkFetchQueue\(\)/.test(abortBranch), 'TikTok: and reads the queue so a post that was created shows up');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 4. Today, editor Deck: Skip really moves the card to the back ---
  try {
    const queue = skipped => new Function('skipped', `
      const tdyState = { skipped };
      ${lift('_tdyEditorQueue')}
      return _tdyEditorQueue({ urgent: ['u'], open: [
        { id: 'a', status: 'todo', due_date: '2026-10-09' }, { id: 'b', status: 'todo', due_date: '2026-10-16' },
        { id: 't', status: 'tweak', due_date: '2026-10-20' }, { id: 'u', status: 'todo', due_date: '2026-10-30' } ] }).map(r => r.id);
    `)(skipped);
    ok(queue([]).join() === 't,u,a,b', 'Today: with nothing skipped the order is tweaks, urgent, then by due date');
    ok(queue(['t']).join() === 'u,a,b,t', 'Today: skipping the top card sends it to the back, whatever its rank');
    ok(queue(['t', 'u']).join() === 'a,b,t,u', 'Today: skipped cards keep the order they were skipped in');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 5. Calendar bulk colour: a failed save is not "Color updated" ---
  try {
    const run = async failing => {
      const env = { notices: [] };
      const posts = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
      await new Function('env', 'posts', 'failing', `
        const _isClientLink = false, CAL_COLORS = ['red'], CAL_BULK_ARCHIVE_CONCURRENCY = 3;
        const calState = { selected: new Set(['p1', 'p2', 'p3']), posts, selectMode: true };
        const _calPendingEdits = {}, _calSaveTimers = {};
        const _calIsBlankId = () => false;
        const document = { querySelectorAll: () => [] };
        const _calRenderBody = () => {};
        const showNotify = (title, body) => env.notices.push(title);
        const _calFlushCardSave = async pid => { if (failing.includes(pid)) posts.find(p => p.id === pid)._saveError = 'save failed'; };
        const _calRunPooled = async (ids, n, fn) => Promise.allSettled(ids.map(fn));
        ${liftAsync('_calApplyBulkColor')}
        return _calApplyBulkColor(null, 'red');
      `)(env, posts, failing);
      return env.notices;
    };
    ok((await run([])).join() === 'Color updated', 'Calendar: bulk colour that saved says "Color updated"');
    ok((await run(['p2'])).join() === 'Some colors were not saved', 'Calendar: bulk colour with a failed save says some were not saved');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 6. SyncLinear: Resolve, Reopen or Delete that was never sent says so ---
  try {
    const env = { renders: 0, refreshed: 0, state: { lifecycleKey: '', lifecycleRequestId: '', error: '' } };
    let answer;
    new Function('env', 'pending', `
      const _prodIssue = id => ({ id });
      const _prodComments = { find: () => ({ id: 'c1', version: 1, row_updated_at: 'T' }), adopt: () => {}, refresh: () => { env.refreshed++; } };
      const _prodCommentDraftFor = () => env.state;
      const _prodWriteRequestId = () => 'req';
      const _prodGatewayWrite = () => pending;
      const _prodRender = () => { env.renders++; };
      const _writeUiRecordFailure = () => {}, _prodWriteErrorText = () => 'refused';
      ${lift('_prodCommentLifecycle')}
      _prodCommentLifecycle('d1', 'c1', 'resolve');
    `)(env, new Promise(resolve => { answer = resolve; }));
    answer(null);
    await tick(); await tick();
    ok(/still saving/i.test(env.state.error) && env.renders === 1, 'SyncLinear: a comment action held back by another save shows a message');
    ok(env.state.lifecycleKey === '', 'SyncLinear: and can be tried again');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 7. Calendar "Add the missing video/thumbnail": no saved-copy write after a client switch
  try {
    const run = async switched => {
      const env = { cacheWrites: 0, renders: 0 };
      await new Function('env', 'switched', `
        const calState = { client: 'Alpha', posts: [{ id: 'p1' }] };
        const calClientSlug = name => String(name).toLowerCase();
        const _calUpsertFetch = async () => { if (switched) { calState.client = 'Beta'; calState.posts = [{ id: 'b1' }]; } return { ok: true, json: async () => ({ ok: true, post: { id: 'p1' } }) }; };
        const _calCacheWrite = () => { env.cacheWrites++; };
        const _calRenderBody = () => { env.renders++; };
        ${liftAsync('_calFillWriteCardLink')}
        return _calFillWriteCardLink('alpha', 'p1', 'video', 'del1', '');
      `)(env, switched);
      return env;
    };
    ok((await run(false)).cacheWrites === 1, 'Calendar: filling a missing part updates the saved copy');
    ok((await run(true)).cacheWrites === 0, 'Calendar: but not with another client\'s list after a client switch');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 8 and 9. Review view: a failed comment is shown; a failed Samples approve keeps its card (read from the code)
  try {
    const cal = code('_calReviewComment'), sxr = code('_sxrReviewComment');
    ok(/\.then\(\(\) => \{[\s\S]*?_saveError[\s\S]*?_calReviewState\.errors\[key\] =[\s\S]*?_calReviewRepaintCard\(pid\)/.test(cal),
      'Calendar Review: a comment whose save failed sets the panel error and repaints');
    ok(/\.then\(\(\) => \{[\s\S]*?_saveError[\s\S]*?_sxrReviewState\.errors\[key\] =[\s\S]*?_sxrReviewRepaintCard\(pid\)/.test(sxr),
      'Samples Review: a comment whose save failed sets the panel error and repaints');
    const approve = code('_sxrReviewApplyApprove');
    ok(/if \(current\._saveError\) \{[\s\S]*?_sxrRenderBody\(\{ preserveScroll: true \}\)[\s\S]*?return;/.test(approve),
      'Samples Review: a failed Approve re-renders the queue, so the card comes back with its error');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 10. Samples: a background refresh does not wipe text from a failed save ---
  try {
    const merge = new Function(`
      const sxrState = { posts: [
        { id: 's1', name: 'Typed but not saved', video_status: 'In Progress', updated_at: 'T0', _saveError: 'save failed', _saveErrorAt: Date.now(), _writeUiRetryEdits: { name: 'Typed but not saved', video_status: 'Approved' } },
        { id: 's2', name: 'Untouched', updated_at: 'T0' } ] };
      const _sxrPendingEdits = {}, _sxrSaveInFlight = {}, _sxrFailedNewCards = new Set(), _sxrReorderOptimistic = new Map();
      const _SXR_ROLLBACK_FIELDS = ['video_status', 'graphic_status', 'status', 'order_index'];
      const SXR_REORDER_GUARD_MS = 12000, SXR_FAILED_TEXT_KEEP_MS = 30 * 60 * 1000;
      const _sxrIsLocalStatusFresh = () => false, _sxrIsBlankId = () => false;
      const _sxrRecentSaveFields = new Map(), _sxrRecentSaveReconcile = () => null;
      const _thumbAdoptPersistedRevision = p => p, _writeUiSnapshotRepairRefs = () => [];
      const _sxrMergePostComments = w => w;
      ${lift('_sxrMergeServerRows')}
      return _sxrMergeServerRows([
        { id: 's1', name: 'Old name', video_status: 'Client Approval', updated_at: 'T1' },
        { id: 's2', name: 'Renamed by a teammate', updated_at: 'T1' } ]);
    `)();
    const s1 = merge.find(p => p.id === 's1'), s2 = merge.find(p => p.id === 's2');
    ok(s1.name === 'Typed but not saved', 'Samples: text from a save that failed survives a background refresh');
    ok(s1._saveError === 'save failed' && !!s1._writeUiRetryEdits, 'Samples: and so does its "Save failed, Retry"');
    ok(s1.video_status === 'Client Approval' && s1.updated_at === 'T1', 'Samples: everything else on that card follows the server (a status is never kept from a failed save)');
    ok(s2.name === 'Renamed by a teammate', 'Samples: a card with no failed save takes the server copy as before');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 11. Calendar select: the selection is what is ticked on screen ---
  try {
    const env = { count: { textContent: '0 selected' }, action: { disabled: true }, swatches: [{ disabled: true }] };
    const selected = new Function('env', `
      const calState = { selected: new Set(['shown-1', 'hidden-1', 'hidden-2', 'shown-2']) };
      const card = id => ({ getAttribute: () => id });
      const document = {
        getElementById: id => id === 'calStrip' ? { querySelectorAll: () => [card('shown-1'), card('shown-2'), card('other')] }
          : id === 'calSelectCount' ? env.count : id === 'calSelectArchive' ? env.action : null,
        querySelectorAll: () => env.swatches };
      ${lift('_calSelectionFollowsTheSheet')}
      _calSelectionFollowsTheSheet();
      return Array.from(calState.selected);
    `)(env);
    ok(selected.join() === 'shown-1,shown-2', 'Calendar: cards a filter has hidden leave the selection');
    ok(env.count.textContent === '2 selected' && env.action.disabled === false && env.swatches[0].disabled === false,
      'Calendar: the select bar shows the real count after a render, not "0 selected"');
    ok(/_calSelectionFollowsTheSheet\(\)/.test(code('_calRenderBody')), 'Calendar: every Sheet render applies it');
    ok(/sxrState\.selected\.size/.test(lift('renderSxrOrganizer')) || /sxrSelectCount">\$\{/.test(INDEX),
      'Samples: the select bar is rendered with the real count');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 12. A selection does not follow the person to another client (read from the code)
  try {
    const setClient = code('_calSetClient');
    ok(/if \(calState\.client !== name\) \{[\s\S]*?calState\.selectMode = false;[\s\S]*?calState\.selected = new Set\(\)/.test(setClient),
      'Calendar: changing client by any road clears the selection and select mode');
    ok(/if \(sxrState\.client !== initial\) _sxrResetSelection\(\);/.test(stripNonCode(INDEX.slice(INDEX.indexOf('function mountSampleReviews'), INDEX.indexOf('function mountSampleReviews') + 6000)) || '')
      || /if \(sxrState\.client !== initial\) _sxrResetSelection\(\);/.test(INDEX),
      'Samples: mounting on a different client clears the selection');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  // --- 13. Clients: a save that lands after another client was opened is still adopted
  try {
    const env = { replaced: [], toasts: [], paints: 0 };
    let answer;
    const state = { edit: { slug: 'fixtureclient', saving: false } };
    const saving = new Function('env', 'state', 'pending', `
      const _caState = state;
      let _caGeneration = 1;
      const _caEditRow = () => ({ slug: 'fixtureclient', updated_at: 'T0' });
      const _caEditChanges = () => ({ email: 'new@example.invalid' });
      const _caEditSay = () => {};
      const _caPaint = () => { env.paints++; };
      const _caEditPost = () => pending;
      const _caReplaceRow = row => env.replaced.push(row);
      const _caLoadHistory = () => {};
      const showToast = text => env.toasts.push(text);
      const CA_FIELD_LABELS = {};
      ${liftAsync('_caEditSave')}
      return _caEditSave();
    `)(env, state, new Promise(resolve => { answer = resolve; }));
    await tick();
    state.edit = null;                        // the person opened another client and discarded the form
    answer({ resp: { status: 200 }, json: { ok: true, row: { slug: 'fixtureclient', email: 'new@example.invalid', updated_at: 'T1' } } });
    await saving;
    ok(env.replaced.length === 1 && env.replaced[0].updated_at === 'T1', 'Clients: the saved row is taken even though the form is gone');
    ok(env.toasts.join() === 'Saved', 'Clients: and the person is told it saved');
  } catch (e) { ok(false, 'this block could not run: ' + String(e && e.message || e).slice(0, 120)); }

  finished = true;
  if (failures) { console.log('\n' + failures + ' check(s) failed'); process.exit(1); }
  console.log('\nassurance-cycle2-saves-and-selection: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
