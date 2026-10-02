'use strict';
/*
 * REGRESSION GUARD: a Kasper decision is never silently lost, and the board says
 * what it is (OPEN_REPAIRS 316).
 *
 * Run:  node --require ./test/helpers/single-file-index.js test/kasper-never-lose-decision.js   (exit 0 = holding)
 *       (npm test runs it with that preload; it hands the suite the plain concatenation of src/index/)
 *
 * WHAT WENT WRONG. calendar-upsert refuses a write when ANYTHING on the card
 * changed after the screen loaded, even a column Kasper is not touching. A plain
 * Approve was refused for good (three clicks, the same stale screen, the same
 * refusal), shown as a small line inside the panel, and Finish and the X swallowed
 * their errors altogether. The board also gave no sign that a card had come back,
 * which cards were urgent, or that a finished card had moved to a collapsed
 * section.
 *
 * Every function below is pulled out of the BUILT index.html by name, so this runs
 * the shipping code, not a copy. Cards, ids and people in the fixtures are made up.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) return null;
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', source.indexOf(')', start));
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (!quote && ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (!quote && ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}
// A function the build under test does not have becomes a stub that fails the case that calls it,
// so a run against OLD code reports each case as failed instead of dying at load time.
function must(name) { return extract(name) || 'function ' + name + '() { throw new Error(\'missing in this build: ' + name + '\'); }'; }
function constLine(name) {
  const m = source.match(new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm'));
  return m ? m[0] : 'var ' + name + ' = undefined;';   // absent in an OLD build: the cases that need it fail, the run does not die
}
function maybe(name) { return extract(name) || ''; }

const failures = [];
async function runCase(name, fn) {
  try { await fn(); console.log('ok - ' + name); }
  catch (error) { failures.push({ name, error }); console.error('not ok - ' + name + ': ' + (error && error.stack || error)); }
}
const stand = require('./helpers/write-log-stand-ins');
const clone = o => JSON.parse(JSON.stringify(o));

/* ───────────── A. the save itself: _kasperPersistPostWrite ───────────── */
const PERSIST = [
  constLine('CAL_STATUSES'), constLine('CAL_PRIORITY'), constLine('CAL_COMPONENTS'), constLine('KASPER_PATCH_SCALARS'),
  constLine('COMP_LABELS'),
  maybe('_kasperJudgeConflict') ? constLine('KASPER_COMP_STATUS_KEYS') : '',
  maybe('_kasperJudgeConflict') ? constLine('KASPER_OWN_MARKERS') : '',
  maybe('_kasperJudgeConflict') ? constLine('KASPER_FRESH_COLUMNS') : '',
  must('_calNormStatus'), must('computeOverallStatus'), must('_calStringifyComments'), must('_calCommentsFor'),
  must('_calSetCommentsFor'), must('_calCommentStamp'), must('_calMergeCommentLists'),
  must('_kasperPatchSnapshot'), must('_writeUiGatewayError'), must('_calReadFreshCardStamp'), must('_calUnionCommentCell'),
  maybe('_kasperJudgeConflict'), maybe('_kasperConflictSentence'), maybe('_kasperAdoptServerFields'),
  must('_kasperPersistPostWrite'),
].join('\n\n');

function makeSandbox({ upsertResponses, freshRows, freshFails = false }) {
  const upsertCalls = [], freshUrls = [];
  const sandbox = Object.assign({
    CAL_SUPABASE_URL: 'https://example.supabase.co', CAL_SUPABASE_ANON_KEY: 'anon',
    _writeUiPrincipalKey: () => 'staff:fixture:kasper',
    _kasperPersistCache: () => true,
    _writeUiCompleteSourceRepairRefs: async () => true,
    _writeUiRemoveCompletedRepairRefs: () => {},
    _calPushStatusToLinear: async () => ({ native_committed: true }),
    _writeUiReconcileReplayStatus: async () => false,
    _writeUiAdoptRepairAck: () => {},
    _writeUiAppendRepairRef: () => {},
    _writeUiAdoptReplayStatus: () => '',
    _writeUiQueueDiagnostic: () => {},
    _calLinearUrlFor: () => '',
    _calComponentsFor: () => ['video', 'graphic', 'caption'],
    _calV2Log: () => {},
    _calMigratePostShape: (post) => {
      for (const c of ['video', 'graphic', 'caption', 'title']) {
        if (typeof post[c + '_tweaks'] === 'string' && post[c + '_tweaks']) { try { post[c + '_comments'] = JSON.parse(post[c + '_tweaks']); } catch (e) {} }
      }
      return post;
    },
    _calUpsertFetch: async (slug, payload) => {
      upsertCalls.push({ slug, payload: clone(payload) });
      const body = upsertResponses[upsertCalls.length - 1] || upsertResponses[upsertResponses.length - 1];
      return { ok: true, json: async () => body };
    },
    _cardReadFetch: async (url) => {
      freshUrls.push(url);
      if (freshFails) return { ok: false, json: async () => null };
      const i = Math.min(freshUrls.length - 1, freshRows.length - 1);
      return { ok: true, json: async () => [freshRows[i]] };
    },
    console, Object, Array, Promise, String, Number, JSON, Date, Boolean, Map, Set, Error, isFinite, Math,
  }, stand);
  vm.createContext(sandbox);
  vm.runInContext(PERSIST, sandbox);
  return { sandbox, upsertCalls, freshUrls };
}

const CONFLICT = { ok: false, conflict: true, id: 'p_card_1', error: 'Not saved: someone else updated this card (caption_status, kasper_approved_at) after your screen last loaded it.' };
const OK = { ok: true, id: 'p_card_1', post: { updated_at: '2026-10-01T16:00:09.000Z' } };

/* A caption approval taken from the screen as it was loaded at 16:00:00: every part at
   Kasper Approval, Kasper has just approved the caption. */
function approveCaptionItem() {
  const base = { video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Kasper Approval', status: 'Kasper Approval', kasper_approved_at: '' };
  const post = {
    id: 'p_card_1', updated_at: '2026-10-01T16:00:00.000Z', _baseAt: '2026-10-01T16:00:00.000Z',
    video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Client Approval',
    kasper_approved_at: '2026-10-01T16:00:05.000Z',
    video_comments: [], graphic_comments: [], caption_comments: [], title_comments: [],
    video_tweaks: '', graphic_tweaks: '', caption_tweaks: '', title_tweaks: '',
  };
  post.status = 'Kasper Approval';
  post._patchBase = Object.assign({}, base);
  return { post, slug: 'testslug', client: 'Test Client' };
}
const noRepair = { precommitted: false, refs: [], companions: [] };

async function approveRefusedByAnUnrelatedChange() {
  /* The editor moved the VIDEO after the screen loaded. Nothing touched the caption. The
     approval must be re-checked and applied, not refused for good. */
  const item = approveCaptionItem();
  const fresh = { updated_at: '2026-10-01T16:00:07.000Z', video_status: 'For SMM Approval', graphic_status: 'Kasper Approval', caption_status: 'Kasper Approval', status: 'Kasper Approval', kasper_approved_at: '', video_tweaks: '', graphic_tweaks: '', caption_tweaks: '', title_tweaks: '' };
  const { sandbox, upsertCalls, freshUrls } = makeSandbox({ upsertResponses: [CONFLICT, OK], freshRows: [fresh] });
  await sandbox._kasperPersistPostWrite(item, noRepair);
  assert.strictEqual(upsertCalls.length, 2, 'a refused plain approve must be re-checked and sent once more');
  assert.ok(/kasper_approved_at/.test(freshUrls[0]) && /caption_status/.test(freshUrls[0]), 'the re-read must ask for the fields it judges, not only the stamp');
  const second = upsertCalls[1].payload;
  assert.strictEqual(second.post.caption_status, 'Client Approval', 'his decision is what is re-sent');
  assert.ok(!('video_status' in second.post), 'the editor\'s change to the video is never part of his write, so it is never overwritten');
  assert.strictEqual(second.comments_base_at, fresh.updated_at, 'the retry rebases on the stamp it just read');
  assert.strictEqual(item.post.video_status, 'For SMM Approval', 'the screen adopts the change someone else made');
}

async function alreadyApplied() {
  const item = approveCaptionItem();
  const fresh = { updated_at: '2026-10-01T16:00:07.000Z', video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Client Approval', status: 'Kasper Approval', kasper_approved_at: '2026-10-01T16:00:04.000Z', video_tweaks: '', graphic_tweaks: '', caption_tweaks: '', title_tweaks: '' };
  const { sandbox, upsertCalls } = makeSandbox({ upsertResponses: [CONFLICT, OK], freshRows: [fresh] });
  await sandbox._kasperPersistPostWrite(item, noRepair);
  assert.strictEqual(upsertCalls.length, 2);
  assert.ok(!('caption_status' in upsertCalls[1].payload.post), 'a value the server already holds is not sent again');
  assert.ok(!('kasper_approved_at' in upsertCalls[1].payload.post), 'the first sign-off stamp on the server wins');
}

async function someoneElseDecidedThePart() {
  /* Staff moved the caption to Approved. His Client Approval must NOT overwrite it. */
  const item = approveCaptionItem();
  const fresh = { updated_at: '2026-10-01T16:00:07.000Z', video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Approved', status: 'Kasper Approval', kasper_approved_at: '', video_tweaks: '', graphic_tweaks: '', caption_tweaks: '', title_tweaks: '' };
  const { sandbox, upsertCalls } = makeSandbox({ upsertResponses: [CONFLICT, OK], freshRows: [fresh] });
  let err;
  try { await sandbox._kasperPersistPostWrite(item, noRepair); } catch (e) { err = e; }
  assert.ok(err, 'a genuine conflict must be thrown, not swallowed');
  assert.strictEqual(upsertCalls.length, 1, 'nothing may be sent over someone else\'s change');
  assert.ok(err._kasperConflict && err._kasperConflict.fields.indexOf('caption_status') >= 0, 'the error names the part');
  assert.ok(err._kasperConflict.fresh && err._kasperConflict.fresh.caption_status === 'Approved', 'and carries the server\'s version');
  assert.ok(/caption/i.test(err.message) && /Approved/.test(err.message), 'in plain words: ' + err.message);
}

async function partNoLongerAtKasperApproval() {
  /* His screen thought the caption was at Kasper Approval, the server has had it at Tweaks
     Needed since (so it differs from what his screen held): not his to decide any more. */
  const item = approveCaptionItem();
  const fresh = { updated_at: '2026-10-01T16:00:07.000Z', video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Tweaks Needed', status: 'Tweaks Needed', kasper_approved_at: '', video_tweaks: '', graphic_tweaks: '', caption_tweaks: '', title_tweaks: '' };
  const { sandbox, upsertCalls } = makeSandbox({ upsertResponses: [CONFLICT, OK], freshRows: [fresh] });
  await assert.rejects(() => sandbox._kasperPersistPostWrite(item, noRepair), /Tweaks Needed/);
  assert.strictEqual(upsertCalls.length, 1);
  /* And the case where his own snapshot was already past Kasper Approval and nobody changed it. */
  const item2 = approveCaptionItem();
  item2.post._patchBase.caption_status = 'For SMM Approval';
  const fresh2 = Object.assign({}, fresh, { caption_status: 'For SMM Approval', status: 'Kasper Approval' });
  const m2 = makeSandbox({ upsertResponses: [CONFLICT, OK], freshRows: [fresh2] });
  await assert.rejects(() => m2.sandbox._kasperPersistPostWrite(item2, noRepair), /not at Kasper Approval/);
  assert.strictEqual(m2.upsertCalls.length, 1, 'a decision is re-applied only while the part is still at Kasper Approval');
}

async function undoIsStillAllowed() {
  const item = approveCaptionItem();
  item.post.caption_status = 'Kasper Approval'; item.post.kasper_approved_at = '';
  item.post._patchBase.caption_status = 'Client Approval'; item.post._patchBase.kasper_approved_at = '2026-10-01T15:59:00.000Z';
  const fresh = { updated_at: '2026-10-01T16:00:07.000Z', video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Client Approval', status: 'Kasper Approval', kasper_approved_at: '2026-10-01T15:59:00.000Z', video_tweaks: '', graphic_tweaks: '', caption_tweaks: '', title_tweaks: '' };
  const { sandbox, upsertCalls } = makeSandbox({ upsertResponses: [CONFLICT, OK], freshRows: [fresh] });
  await sandbox._kasperPersistPostWrite(item, noRepair);
  assert.strictEqual(upsertCalls.length, 2, 'Undo (back to Kasper Approval) is the one reversal allowed');
  assert.strictEqual(upsertCalls[1].payload.post.caption_status, 'Kasper Approval');
}

async function unreadableCardIsNotGuessed() {
  const item = approveCaptionItem();
  const { sandbox, upsertCalls } = makeSandbox({ upsertResponses: [CONFLICT, OK], freshRows: [{}], freshFails: true });
  let err;
  try { await sandbox._kasperPersistPostWrite(item, noRepair); } catch (e) { err = e; }
  assert.ok(err, 'if the card cannot be re-read nothing is guessed');
  assert.strictEqual(upsertCalls.length, 1);
  assert.ok(err._kasperConflict && err._kasperConflict.unchecked, 'and the failure says it could not be checked');
  assert.ok(/^Not saved/.test(err.message), err.message);
}

async function keepsAConcurrentComment() {
  const item = approveCaptionItem();
  item.post.caption_comments = [{ id: 'c_mine', body: 'mine', created_at: '2026-10-01T16:00:03.000Z', updated_at: '2026-10-01T16:00:03.000Z' }];
  item.post.caption_tweaks = JSON.stringify(item.post.caption_comments);
  const theirs = { id: 'c_theirs', body: 'theirs', created_at: '2026-10-01T16:00:02.000Z', updated_at: '2026-10-01T16:00:02.000Z' };
  const fresh = { updated_at: '2026-10-01T16:00:07.000Z', video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Kasper Approval', status: 'Kasper Approval', kasper_approved_at: '', video_tweaks: '', graphic_tweaks: '', caption_tweaks: JSON.stringify([theirs]), title_tweaks: '' };
  const { sandbox, upsertCalls } = makeSandbox({ upsertResponses: [CONFLICT, OK], freshRows: [fresh] });
  await sandbox._kasperPersistPostWrite(item, noRepair);
  const sent = JSON.parse(upsertCalls[1].payload.post.caption_tweaks).map(c => c.id).sort();
  assert.deepStrictEqual(sent, ['c_mine', 'c_theirs'], 'someone else\'s note rides along, so the server cannot read its absence as a deletion');
}

async function boundedRetries() {
  const item = approveCaptionItem();
  let n = 0;
  const rows = [1, 2, 3, 4, 5].map(i => ({ updated_at: '2026-10-01T16:00:0' + (6 + i) + '.000Z', video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Kasper Approval', status: 'Kasper Approval', kasper_approved_at: '', video_tweaks: '', graphic_tweaks: '', caption_tweaks: '', title_tweaks: '' }));
  const { sandbox, upsertCalls } = makeSandbox({ upsertResponses: [CONFLICT], freshRows: rows });
  await assert.rejects(() => sandbox._kasperPersistPostWrite(item, noRepair), /someone else updated/);
  assert.ok(upsertCalls.length <= 4, 'never an unbounded loop (sent ' + upsertCalls.length + ')');
}

/* ───────────── B. skip notes ───────────── */
const SKIPS = [
  maybe('_kasperIsKasperActor'), maybe('_kasperBuildSkips'), maybe('_kasperClock'), maybe('_kasperSkipNoteText'),
  maybe('_kasperApplySkipsToHistory'), maybe('_kasperHistoryEntryFromPost'), constLine('COMP_LABELS'),
].join('\n\n');
function skipSandbox() { const s = { Date, Map, Set, Object, Array, String, isFinite, Math, JSON, KASPER_PAST_STATUSES: ['Client Approval', 'Approved', 'Scheduled', 'Posted'] }; vm.createContext(s); vm.runInContext(SKIPS, s); return s; }
const ev = (post_id, ts, component, to_status, source, actor, role) => ({ post_id, ts, component, to_status, source, actor, role });

async function staffSkipIsListed() {
  const s = skipSandbox();
  assert.strictEqual(typeof s._kasperBuildSkips, 'function', 'the skip builder must exist');
  const past = [
    ev('p1', '2026-10-01T17:14:37Z', 'video', 'Client Approval', 'native-bridge', null, null),
    ev('p1', '2026-10-01T17:14:40Z', null, 'Client Approval', 'ui', 'Sam Staff', 'smm'),
    ev('p1', '2026-10-01T17:14:41Z', 'caption', 'Client Approval', 'ui', 'Sam Staff', 'smm'),
  ];
  const out = s._kasperBuildSkips(past, []);
  assert.ok(out.p1, 'staff moving parts past Kasper without him is a skip');
  assert.strictEqual(out.p1.by, 'Sam Staff');
  assert.deepStrictEqual(Array.from(out.p1.comps).sort(), ['caption', 'video']);
  assert.strictEqual(out.p1.to, 'Client Approval');
  const note = s._kasperSkipNoteText(out.p1);
  assert.ok(/Video and Caption moved to Client Approval by Sam Staff/.test(note) && /without your decision/.test(note), note);
}
async function hisOwnDecisionsAreNotSkips() {
  const s = skipSandbox();
  const own = s._kasperBuildSkips([
    ev('p2', '2026-10-01T15:48:28Z', 'caption', 'Client Approval', 'ui', 'Kasper Test', 'admin'),
  ], []);
  assert.deepStrictEqual(Object.keys(own), [], 'an approval by him (even under the admin role) is his decision');
  const bridged = s._kasperBuildSkips([
    ev('p3', '2026-10-01T15:42:12Z', 'graphic', 'Client Approval', 'native-bridge', null, null),
  ], [{ post_id: 'p3', ts: '2026-10-01T15:42:14Z' }]);
  assert.deepStrictEqual(Object.keys(bridged), [], 'a bridge echo within seconds of his own action is his');
  const byRole = s._kasperBuildSkips([ev('p4', '2026-10-01T15:00:00Z', 'video', 'Client Approval', 'ui', 'X', 'kasper')], []);
  assert.deepStrictEqual(Object.keys(byRole), []);
  const unknown = s._kasperBuildSkips([ev('p5', '2026-10-01T10:00:00Z', 'video', 'Approved', 'native-bridge', null, null)], [{ post_id: 'p5', ts: '2026-10-01T09:00:00Z' }]);
  assert.ok(unknown.p5 && unknown.p5.by === '', 'a move with no one of his near it is a skip, by an unknown staff member');
  assert.ok(/by staff/.test(s._kasperSkipNoteText(unknown.p5)));
}
async function historyGetsTheNote() {
  const s = skipSandbox();
  const post = { id: 'p6', name: 'Fixture card', asset_url: '', thumbnail_url: '', scheduled_date: '' };
  const index = new Map([['p6', { post, client: 'Test Client', slug: 'testslug' }]]);
  const skips = { p6: { by: 'Sam Staff', at: '2026-10-01T17:14:41.000Z', to: 'Client Approval', comps: ['caption'] },
                  p7: { by: 'Sam Staff', at: '2026-10-01T10:00:00.000Z', to: 'Approved', comps: ['video'] } };
  const h = s._kasperApplySkipsToHistory([{ id: 'p7', name: 'Approved earlier', approvedAt: '2026-09-30T10:00:00Z' }], skips, index);
  assert.strictEqual(h.length, 2);
  const only = h.find(e => e.id === 'p6');
  assert.ok(only && only.skippedOnly && only.skip.by === 'Sam Staff', 'a card he never approved gets a row of its own');
  assert.ok(h.find(e => e.id === 'p7').skip, 'a card he approved earlier gets the note on its row');
  assert.strictEqual(h[0].id, 'p6', 'newest first');
}

/* ───────────── C. the cards: sent back, urgent, alerts ───────────── */
const CARD = [
  constLine('CAL_STATUSES'), constLine('CAL_COMPONENTS'), constLine('COMP_LABELS'), constLine('CAL_REVIEW_COMPONENTS'),
  must('_calNormStatus'), must('_calCommentsFor'), must('_kasperCompReviewable'), must('_calUrgentSameRound'),
  maybe('_calKasperUrgentComp'), must('_calKasperUrgentActive'), must('_calUrgentSentForCurrentRound'), must('_calUrgentButtonHtml'),
  must('_calApplyUrgentButtonState'),
  must('_kasperUndecidedComps'), maybe('_kasperClock'), maybe('_kasperReturnInfo'), maybe('_kasperReturnLineHtml'),
  maybe('_kasperUrgentTagHtml'), maybe('_kasperFailureText'), maybe('_kasperRenderSaveAlerts'), maybe('_kasperCardAlertHtml'),
  maybe('_kasperAlertButtonsHtml'), maybe('_kasperRenderFreshnessNote'),
  constLine('KASPER_PAST_STATUSES'),
].join('\n\n');
function cardSandbox(extra) {
  const s = Object.assign({
    Date, Map, Set, Object, Array, String, isFinite, Math, JSON, Number, Boolean,
    _calEsc: v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    _calEscAttr: v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
    _calComponentsFor: () => ['video', 'graphic', 'caption'],
    _calCompLinked: () => true,
    _calShowUrgent: () => false,
    _urgentKind: () => ({ btnTitle: 'Send an urgent ping' }),
    _writeUiFailureSentence: e => String(e && e.message || 'Save failed'),
    _kasperState: { saveAlerts: {}, lastLoaded: 0 },
  }, extra || {});
  vm.createContext(s); vm.runInContext(CARD, s); return s;
}

async function sentBackMarker() {
  const s = cardSandbox();
  assert.strictEqual(typeof s._kasperReturnInfo, 'function', 'the sent-back marker must exist');
  /* Finished earlier, thumbnail and caption already with the client, the video is back. */
  const post = { id: 'p8', kasper_finished_at: '2026-10-01T15:48:00Z', kasper_approved_at: '2026-10-01T15:42:00Z', asset_url: 'v', thumbnail_url: 't', caption: 'c',
    video_status: 'Kasper Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval',
    video_comments: [{ id: 'c1', role: 'kasper', body: 'fix the cut' }], graphic_comments: [], caption_comments: [] };
  const info = s._kasperReturnInfo({ post, sentAtMs: Date.parse('2026-10-01T16:01:00Z') });
  assert.ok(info, 'a card he decided before and that is back in front of him is marked');
  assert.deepStrictEqual(Array.from(info.back), ['video']);
  assert.deepStrictEqual(Array.from(info.sentOn).sort(), ['caption', 'graphic']);
  const line = s._kasperReturnLineHtml(info);
  assert.ok(/Video back for your review/.test(line) && /Already sent to the client: Thumbnail and Caption|Already sent to the client: Caption and Thumbnail/.test(line), line);
  const fresh = { id: 'p9', asset_url: 'v', thumbnail_url: 't', caption: 'c', video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Kasper Approval', video_comments: [], graphic_comments: [], caption_comments: [] };
  assert.strictEqual(s._kasperReturnInfo({ post: fresh, sentAtMs: 1 }), null, 'a first-time card is not "sent back"');
}
async function urgentTagAndButton() {
  const s = cardSandbox();
  const p = { id: 'p10', video_status: 'Kasper Approval', kasper_urgent_pinged_at: '2026-10-01T15:26:27Z', kasper_urgent_comp: 'video', kasper_urgent_status_at: '2026-09-30T19:38:51Z', video_status_at: '2026-09-30T19:38:51Z', kasper_urgent_by: 'Sam Staff' };
  assert.strictEqual(typeof s._kasperUrgentTagHtml, 'function', 'the urgent tag must exist');
  const tag = s._kasperUrgentTagHtml(p);
  assert.ok(/data-kasper-urgent-tag/.test(tag) && />Urgent/.test(tag) && /Sam Staff/.test(tag), tag);
  assert.strictEqual(s._kasperUrgentTagHtml(Object.assign({}, p, { video_status: 'Client Approval' })), '', 'a spent ping carries no tag');
  /* The orange button on Kasper's cards pings the EDITOR; it must not read as a status. */
  const btn = s._calUrgentButtonHtml('p10', '_kasperSendUrgentSlack', { id: 'p10' }, 'kcard-urgent-btn', true, 'editor', { idle: 'Ping editor', done: 'Editor pinged' });
  assert.ok(/>Ping editor</.test(btn) && !/>URGENT</.test(btn), btn);
  const calendarBtn = s._calUrgentButtonHtml('p10', '_calSendUrgent', { id: 'p10' }, '', true, 'editor');
  assert.ok(/>URGENT</.test(calendarBtn), 'the SMM calendar button is unchanged');
  const el = { dataset: { urgentIdle: 'Ping editor', urgentDone: 'Editor pinged' }, classList: { toggle() {} }, textContent: '', disabled: false };
  s._calApplyUrgentButtonState(el, { id: 'p10' }, 'editor');
  assert.strictEqual(el.textContent, 'Ping editor', 'the in-place update keeps the name');
}
async function alertsStayUntilHeAct() {
  const s = cardSandbox();
  s._kasperState.saveAlerts.p11 = { pid: 'p11', name: 'Fixture <card>', client: 'Test Client', kind: 'conflict', text: 'Not saved: someone else changed this card.', at: 1 };
  assert.strictEqual(typeof s._kasperRenderSaveAlerts, 'function', 'the alert strip must exist');
  const strip = s._kasperRenderSaveAlerts();
  assert.ok(/role="alert"/.test(strip) && /1 change was NOT saved/.test(strip) && /Fixture &lt;card&gt;/.test(strip), strip);
  assert.ok(/_kasperReloadCard\('p11'\)/.test(strip) && /_kasperAckAlert\('p11'\)/.test(strip), 'it has to offer a way to act');
  assert.ok(/data-kasper-card-alert/.test(s._kasperCardAlertHtml('p11')), 'and the card carries it too');
  assert.strictEqual(s._kasperCardAlertHtml('nope'), '');
  assert.strictEqual(s._kasperFailureText(new Error('network down'), 'Your note').indexOf('Not saved: Your note did not go through.'), 0);
}

/* ───────────── D. the queue read and the live refresh ───────────── */
async function busyOnlyWhenTypingOrSaving() {
  const fn = must('_kasperViewBusy');
  const mk = (items, active) => {
    const s = { Date, KASPER_RT_SELF_ECHO_MS: 5000, _kasperLastLocalWriteAt: 0, _kasperState: { items, replies: [] }, document: { activeElement: active || null } };
    vm.createContext(s); vm.runInContext(fn, s); return s._kasperViewBusy;
  };
  const withDraft = [{ _drafts: { video: 'half a note', graphic: '', caption: '' }, _saving: {} }];
  assert.strictEqual(mk(withDraft)(), false, 'an unsent draft in a box he is not typing in no longer freezes the live refresh');
  assert.strictEqual(mk([{ _drafts: {}, _saving: { video: true } }])(), true, 'a save in flight still holds it');
  const ta = { tagName: 'TEXTAREA', closest: () => ({}) };
  assert.strictEqual(mk(withDraft, ta)(), true, 'a box he is typing in is still protected');
}
async function unlistedClientsAreReported() {
  const fn = must('_kasperFetchAllRelevantPosts');
  const rows = [
    { id: 'p20', client: 'knownslug', status: 'Kasper Approval', video_status: 'Kasper Approval', asset_url: 'v' },
    { id: 'p21', client: 'sheetonlyslug', status: 'Kasper Approval', video_status: 'Kasper Approval', asset_url: 'v' },
    { id: 'p22', client: 'sheetonlyslug', status: 'Approved', video_status: 'Approved' },
    { id: 'p23', client: 'quietslug', status: 'Approved', video_status: 'Approved' },
  ];
  const mk = (names) => {
    const s = {
      Date, Map, Set, Object, Array, String, Promise, JSON, console, setTimeout, clearTimeout, isFinite,
      WL_CLIENT_NAMES: names, CAL_SUPABASE_URL: 'https://x', CAL_SUPABASE_ANON_KEY: 'k', KASPER_CAL_CONCURRENCY: 2,
      AbortController: undefined,
      wlNormalizeClient: v => String(v || '').toLowerCase().replace(/[^a-z0-9&]+/g, ''),
      _svReadWithRetry: fnc => fnc(), _calSupabaseFetchAllRows: async () => rows.map(r => Object.assign({}, r)),
      _kasperCalCacheRead: () => null, _kasperCalCacheWrite: () => {}, _calV2FetchPosts: async () => ({ ok: true, posts: [] }),
      _calArchivedRefs: () => [], _calIsArchivedRef: () => false, _calDedupeByLinearIssue: l => l, _calNormStatus: v => String(v || ''),
      _calCoerceDate: v => v, _calLoadComments: () => [], _calMigratePostShape: () => {}, _kasperPatchSnapshot: () => ({}),
      _calPostKasperVisible: p => ['video_status', 'graphic_status', 'caption_status'].some(k => p[k] === 'Kasper Approval'),
      _calComponentsFor: () => ['video', 'graphic', 'caption'], _calCompKasperVisible: (p, c) => p[c + '_status'] === 'Kasper Approval',
      _kasperCompReviewable: () => true, _kasperHistoryEntryFromPost: p => ({ id: p.id }), _kasperHasUnreadReply: () => false,
      _KASPER_PARTS: ['video', 'graphic', 'caption', 'title'],
    };
    vm.createContext(s); vm.runInContext(fn.replace('async function _kasperFetchAllRelevantPosts', 'var run = async function'), s);
    return s;
  };
  const s = mk(['knownslug']);
  const out = await s.run(true);
  assert.deepStrictEqual(Array.from(out.queue.map(q => q.post.id)), ['p20'], 'only the clients the page knows are read into the queue');
  assert.deepStrictEqual(Array.from(out.unlisted || []), ['sheetonlyslug'], 'a client the list does not know yet, holding a part at Kasper Approval, is REPORTED, not dropped in silence');
  const grown = mk(['knownslug', 'sheetonlyslug']);
  const out2 = await grown.run(true);
  assert.deepStrictEqual(Array.from(out2.queue.map(q => q.post.id)).sort(), ['p20', 'p21'], 'once the list has grown the same read includes them');
  assert.deepStrictEqual(Array.from(out2.unlisted || []), []);
}
async function sectionsAndReload() {
  assert.ok(/tweaksCollapsed:\s*false/.test(source), '"Tweaks pending" must open by default so a finished card is not hidden');
  assert.ok(/WL_CLIENT_NAMES\.length > rosterAtStart/.test(source), 'a load that started before the client list grew must repeat once');
}

/* ───────────── E. Samples: same rule ───────────── */
function samplesSandbox({ fresh, finishFails = false }) {
  const calls = { upsert: 0, status: 0, alerts: [], repaint: 0 };
  const fns = [constLine('SXR_COMPONENTS'), constLine('SXR_PRIORITY'), constLine('SXR_REVIEW_COMPONENTS'), must('computeSampleOverallStatus'),
    must('_sxrKasperApplyAndPersist'), maybe('_sxrKasperReadFresh'), must('_sxrKasperFindItem')].join('\n\n');
  const p = { id: 's1', name: 'Fixture sample', video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', status: 'Kasper Approval', updated_at: '2026-10-01T16:00:00.000Z' };
  const it = { post: p, slug: 'testslug', client: 'Test Client' };
  const s = Object.assign({
    JSON, Date, Object, Array, String, Promise, console,
    CAL_SUPABASE_URL: 'https://x', CAL_SUPABASE_ANON_KEY: 'k', SXR_TABLE: 'sample_reviews',
    _cardReadFetch: async () => ({ ok: !!fresh, json: async () => [fresh] }),
    _sxrKasperState: { items: [it], saving: {}, writeGen: 0, drafts: {} },
    _kasperState: { sxrRepairs: [] },
    _sxrSetLastLocalWriteAt: () => {}, _sxrKasperRepaint: () => { calls.repaint++; },
    _kasperSetSaveAlert: (...a) => calls.alerts.push(a), _kasperPaintReview: () => {},
    _sxrLinearUrlFor: () => '', _sxrCommentsFor: () => [], COMP_LABELS: { video: 'Video', graphic: 'Thumbnail' },
    _writeUiPrincipalKey: () => 'k',
    _sxrNormStatus: v => String(v || ''),
    _sxrPushStatusToLinear: async (url, status, opts) => { calls.status++; calls.edits = opts && opts.repairEdits; throw new Error('stop here: reached the write'); },
    _sxrPostLinearComment: async () => { throw new Error('stop here'); },
    _sxrUpsertFetch: async () => { calls.upsert++; return { ok: true, json: async () => ({ ok: true }) }; },
    _writeUiTrackSave: (a, b, c, send) => send(), _writeUiReportFailure: () => {}, _writeUiRecordFailure: () => {}, showNotify: () => {},
    _writeUiAdoptRepairAck: () => {}, _writeUiAppendRepairRef: () => {}, _writeUiRepairCompanions: () => [],
    _writeUiGatewayError: (st, code) => Object.assign(new Error(code), { status: st, code }),
    _writeUiReconcileReplayStatus: async () => false, _writeUiCompleteSourceRepairRefs: async () => true, _writeUiRemoveCompletedRepairRefs: () => {},
    _kasperPersistCache: () => true,
  }, {});
  vm.createContext(s); vm.runInContext(fns, s);
  return { s, calls, p, it };
}
async function samplesNeverOverwrite() {
  const approve = (p) => { p.video_status = 'Client Approval'; return { video_status: 'Client Approval', status: 'Client Approval' }; };
  const a = samplesSandbox({ fresh: { updated_at: '2026-10-01T16:00:09.000Z', status: 'Tweaks Needed', video_status: 'Tweaks Needed', graphic_status: 'Kasper Approval' } });
  await a.s._sxrKasperApplyAndPersist('s1', 'video', approve, null);
  assert.strictEqual(a.calls.status + a.calls.upsert, 0, 'nothing is sent over a part someone else already moved');
  assert.strictEqual(a.calls.alerts.length, 1, 'and he is told');
  assert.ok(/Tweaks Needed/.test(a.calls.alerts[0][4]) && a.calls.alerts[0][3] === 'conflict', a.calls.alerts[0][4]);
  assert.strictEqual(a.p.video_status, 'Tweaks Needed', 'the card shows the current state, not his stale one');
  const b = samplesSandbox({ fresh: { updated_at: '2026-10-01T16:00:00.000Z', status: 'Kasper Approval', video_status: 'Kasper Approval', graphic_status: 'Kasper Approval' } });
  await b.s._sxrKasperApplyAndPersist('s1', 'video', approve, null);
  assert.strictEqual(b.calls.status, 1, 'when nothing changed the decision goes ahead as before');
  const c = samplesSandbox({ fresh: null });
  await c.s._sxrKasperApplyAndPersist('s1', 'video', approve, null);
  assert.strictEqual(c.calls.status + c.calls.upsert, 0, 'a decision that cannot be checked is refused, not guessed (Codex P1, PR 1916)');
  assert.strictEqual(c.calls.alerts.length, 1, 'and he is told');
  assert.strictEqual(c.p.video_status, 'Kasper Approval', 'the card is left as it was');
}
async function samplesFinishAndCloseAreNotQuiet() {
  for (const which of ['_sxrKasperDismiss', '_sxrKasperClose']) {
    const calls = { alerts: [], rendered: 0 };
    const p = { id: 's2', name: 'Fixture sample', video_status: 'Client Approval', graphic_status: 'Tweaks Needed', status: 'Tweaks Needed',
      graphic_comments: [{ id: 'c1', role: 'kasper', is_tweak: true, done: false }], video_comments: [] };
    const it = { post: p, slug: 'testslug', client: 'Test Client' };
    const s = {
      Date, JSON, Object, Array, String, Promise, console,
      _sxrKasperState: { items: [it], dismissed: {}, closed: {} },
      _sxrKasperFindItem: id => (s._sxrKasperState.items || []).find(x => x.post.id === id),
      _sxrKasperUndecidedComps: () => [], _sxrKasperPostHasUnresolvedKasperTweak: () => true,
      _sxrKasperLatestMsgAt: () => '2026-10-01T16:00:00.000Z', _sxrKasperAppendFinishLog: () => {}, _kasperMarkSeenAt: () => {},
      _sxrKasperRenderQueue: () => { calls.rendered++; },
      _sxrKasperPersist: async () => { throw new Error('refused'); },
      _kasperSetSaveAlert: (...a) => calls.alerts.push(a), _kasperPaintReview: () => {},
      _sxrKasperHistoryEntryFromPost: () => ({}), _sxrKasperRecordHistory: () => {},
    };
    vm.createContext(s); vm.runInContext(must(which), s);
    s[which]('s2');
    await new Promise(r => setTimeout(r, 10));
    assert.strictEqual(calls.alerts.length, 1, which + ': a refused save is reported');
    assert.ok(s._sxrKasperState.items.some(x => x.post.id === 's2'), which + ': the sample is back in his queue');
    assert.ok(!(s._sxrKasperState.dismissed.s2 || s._sxrKasperState.closed.s2), which + ': the local flag is undone');
  }
}



async function refusedCloseIsNotRemovedByItsOwnAnimation() {
  /* Codex P2, PR 1916: a Close refused inside the 240 ms removal animation restored the card, then the
     pending removal timer hid it again. */
  const timers = [];
  const item = { post: { id: 'p30', name: 'Fixture', kasper_closed_at: null }, client: 'Test Client', slug: 'testslug' };
  const el = { classList: { add() {} } };
  const s = { Date, Object, Array, String, Promise, console, window: {}, CSS: undefined,
    document: { querySelector: () => el },
    setTimeout: (fn, ms) => { timers.push(fn); return timers.length; }, clearTimeout: id => { timers[id - 1] = null; },
    _kasperState: { items: [item], closed: {} },
    _kasperInvalidateInFlightLoad: () => {}, _kasperPersistCache: () => true, _kasperPaintReview: () => {},
    _kasperPersistPost: () => Promise.reject(new Error('refused locally')),
    _kasperNoteSaveFailure: () => {} };
  vm.createContext(s);
  vm.runInContext('var _kasperRemovalTimers = {};\n' + must('_kasperRemoveItem') + '\n' + must('_kasperClose'), s);
  s._kasperClose('p30');
  await new Promise(r => setImmediate(r));   // the refusal lands before the animation timer
  for (const t of timers) if (t) t();
  assert.ok(s._kasperState.items.some(x => x.post.id === 'p30'), 'the card is still in his queue after a refused Close');
}


async function samplesRecomputeFromTheFreshCompanion() {
  /* Codex P1, PR 1916: the part he decides is unchanged but the OTHER part moved; his stale aggregate
     must not overwrite the server's. */
  const approve = (p) => { p.video_status = 'Client Approval'; p.status = s0.computeSampleOverallStatus(p); return { video_status: 'Client Approval', status: p.status }; };
  const fresh = { updated_at: '2026-10-01T16:00:09.000Z', status: 'Kasper Approval', video_status: 'Kasper Approval', graphic_status: 'Client Approval' };
  const a = samplesSandbox({ fresh });
  var s0 = a.s;
  await a.s._sxrKasperApplyAndPersist('s1', 'video', approve, null);
  assert.strictEqual(a.calls.status, 1, 'the decision itself still goes ahead (his part did not move)');
  assert.strictEqual(a.calls.edits.status, 'Client Approval', 'but the aggregate is recomputed from the fresh companion, not the stale one he saw (got ' + (a.calls.edits && a.calls.edits.status) + ')');
}
async function alertsAreSavedWhenSetAndWhenAcknowledged() {
  /* Codex P2, PR 1916: setting or acknowledging an alert must write the cache, or a reload right after
     loses it / brings an acknowledged one back. */
  let persisted = 0; const snapshots = [];
  const s = { Date, Object, String, _kasperState: { saveAlerts: {} }, _kasperPersistCache: () => { persisted++; snapshots.push(Object.keys(s._kasperState.saveAlerts).length); return true; },
    _kasperRepaintCard: () => {}, _kasperPaintReview: () => {} };
  vm.createContext(s); vm.runInContext(must('_kasperSetSaveAlert') + '\n' + must('_kasperAckAlert'), s);
  s._kasperSetSaveAlert('p40', 'Fixture', 'Test Client', 'failed', 'Not saved: x');
  assert.deepStrictEqual(snapshots, [1], 'saved right after the alert is set, with the alert in it');
  s._kasperAckAlert('p40');
  assert.deepStrictEqual(snapshots, [1, 0], 'saved right after it is acknowledged, without it');
}

/* ───────────── F. a browser-only hide never outlives its moment ───────────── */
async function localMarksExpireAndUrgentWins() {
  const fns = [constLine('KASPER_LOCAL_FLAG_MS'), constLine('CAL_STATUSES'), constLine('CAL_COMPONENTS'), constLine('CAL_REVIEW_COMPONENTS'),
    must('_calNormStatus'), must('_calCommentsFor'), must('_kasperCompReviewable'), must('_calUrgentSameRound'), must('_calKasperUrgentComp'), must('_calKasperUrgentActive'),
    must('_kasperLocalFlagLive'), must('_kasperUrgentSupersedes'), must('_kasperUndecidedComps'), must('_kasperFinishedAt'), must('_kasperIsFinished')].join('\n\n');
  const s = { Date, Object, Array, String, isFinite, Math, JSON, _calComponentsFor: () => ['video', 'graphic', 'caption'], _calCompLinked: () => true,
    _kasperState: { dismissed: {}, closed: {} } };
  vm.createContext(s); vm.runInContext(fns, s);
  assert.strictEqual(s._kasperLocalFlagLive(true), false, 'a leftover `true` from an older version is expired');
  assert.strictEqual(s._kasperLocalFlagLive(Date.now() - 10 * 60 * 1000), false, 'ten minutes old is expired');
  assert.strictEqual(s._kasperLocalFlagLive(Date.now() - 1000), true, 'a mark from a second ago is still the click in flight');
  const post = { id: 'p1', asset_url: 'v', thumbnail_url: 't', caption: 'c', video_status: 'Kasper Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval', video_comments: [], graphic_comments: [], caption_comments: [] };
  s._kasperState.dismissed.p1 = true;
  assert.strictEqual(s._kasperIsFinished(post), false, 'an old browser-only Finish mark no longer hides a card that is back at Kasper Approval');
  s._kasperState.dismissed.p1 = Date.now();
  assert.strictEqual(s._kasperIsFinished(post), true, 'a fresh one still holds (the write is in flight)');
  const ping = Object.assign({}, post, { kasper_urgent_pinged_at: new Date().toISOString(), kasper_urgent_comp: 'video', kasper_urgent_status_at: '', video_status_at: '' });
  assert.strictEqual(s._kasperIsFinished(ping), false, 'an urgent ping puts a hidden card back in front of him, even inside the window');
}

(async () => {
  await runCase('plain approve refused by an unrelated change is re-checked and applied', approveRefusedByAnUnrelatedChange);
  await runCase('a value the server already holds is not re-sent', alreadyApplied);
  await runCase('someone else decided the part: nothing overwritten, conflict reported with the server version', someoneElseDecidedThePart);
  await runCase('a part no longer at Kasper Approval is never re-decided', partNoLongerAtKasperApproval);
  await runCase('Undo stays allowed', undoIsStillAllowed);
  await runCase('an unreadable card is not guessed', unreadableCardIsNotGuessed);
  await runCase('a concurrent note is carried, not pruned', keepsAConcurrentComment);
  await runCase('retries are bounded', boundedRetries);
  await runCase('staff skipping Kasper is listed with who and when', staffSkipIsListed);
  await runCase('his own decisions are not skips', hisOwnDecisionsAreNotSkips);
  await runCase('history rows carry the skip note', historyGetsTheNote);
  await runCase('"Sent back to you" marker', sentBackMarker);
  await runCase('urgent tag and the renamed editor button', urgentTagAndButton);
  await runCase('unsaved-change alerts stay until he acts', alertsStayUntilHeAct);
  await runCase('live refresh is held only by typing or a save in flight', busyOnlyWhenTypingOrSaving);
  await runCase('clients the list does not know are reported, not dropped', unlistedClientsAreReported);
  await runCase('Tweaks pending opens by default; roster growth reloads', sectionsAndReload);
  await runCase('Samples: a decision never overwrites someone else\'s change', samplesNeverOverwrite);
  await runCase('Samples: a refused Finish or Close is reported and undone', samplesFinishAndCloseAreNotQuiet);
  await runCase('browser-only Finish and Close marks expire; an urgent ping wins', localMarksExpireAndUrgentWins);
  await runCase('a refused Close is not undone by its own removal animation', refusedCloseIsNotRemovedByItsOwnAnimation);
  await runCase('Samples: the aggregate is recomputed from the fresh companion part', samplesRecomputeFromTheFreshCompanion);
  await runCase('alerts are saved when set and when acknowledged', alertsAreSavedWhenSetAndWhenAcknowledged);
  if (failures.length) { console.error('\n' + failures.length + ' failure(s).'); process.exit(1); }
  console.log('\nAll kasper-never-lose-decision assertions passed.');
})();
