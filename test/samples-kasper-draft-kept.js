'use strict';
/*
 * REGRESSION GUARD: on Kasper's Samples review, a note or change request he
 * typed is never lost when its save does not go through (OPEN_REPAIRS 397,
 * Digger bug archaeology 2026-10-10).
 *
 * Run:  node --require ./test/helpers/single-file-index.js test/samples-kasper-draft-kept.js
 *
 * The buttons empty his box and then call _sxrKasperApplyAndPersist, which
 * rolls the card (and so the thread entry his words were in) back on a
 * refusal. Only its catch put the words back, and only for a change request.
 * A refused check read, someone else's change, a blocked repair and a failed
 * plain Comment each lost them from the thread and the box at once. The
 * Calendar twin (330) already gave them back.
 *
 * Every function under test is pulled out of the built page by name, so this
 * runs the shipping code. Cards and people are made up.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing in the built page: ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', source.indexOf(')', start));
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (!quote && ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (!quote && ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}
function constLine(name) {
  const m = source.match(new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm'));
  if (!m) throw new Error('missing const ' + name);
  return m[0];
}

const NOTE = 'Please trim the first two seconds.';
function sandbox({ fresh = 'same', upsertOk = true, gatewayCommits = true, cachedRepair = false, onRead = null } = {}) {
  const calls = { sent: 0, upsert: 0, alerts: 0, notify: 0 };
  const code = [constLine('SXR_COMPONENTS'), constLine('SXR_PRIORITY'), constLine('SXR_REVIEW_COMPONENTS'),
    extract('computeSampleOverallStatus'), extract('_sxrKasperFindItem'), extract('_sxrKasperReadFresh'), extract('_sxrKasperPersist'),
    extract('_sxrKasperApplyAndPersist'), extract('_sxrKasperRequestTweakComp'), extract('_sxrKasperAddCommentComp')].join('\n\n');
  const post = { id: 's1', name: 'Fixture sample', video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', status: 'Kasper Approval',
    updated_at: '2026-10-01T16:00:00.000Z', video_tweaks: '[]', graphic_tweaks: '[]' };
  if (cachedRepair) post._writeUiKasperRepair = { id: 's1' };
  const it = { post, slug: 'fixtureslug', client: 'Fixture Client' };
  const threads = { video: [], graphic: [] };
  const s = {
    JSON, Date, Object, Array, String, Promise, Set, console,
    CAL_SUPABASE_URL: 'https://x.invalid', CAL_SUPABASE_ANON_KEY: 'k', SXR_TABLE: 'sample_reviews', COMP_LABELS: { video: 'Video', graphic: 'Thumbnail' },
    fetch: async () => {
      if (onRead) onRead(s);
      if (fresh === null) return { ok: false, json: async () => [] };
      const row = fresh === 'same' ? { id: 's1', video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', status: 'Kasper Approval' } : fresh;
      return { ok: true, json: async () => [row] };
    },
    _sxrKasperState: { items: [it], saving: {}, writeGen: 0, drafts: {} },
    _kasperState: { sxrRepairs: [] },
    _sxrSetLastLocalWriteAt: () => {}, _sxrKasperRepaint: () => {},
    _kasperSetSaveAlert: () => { calls.alerts++; }, _kasperPaintReview: () => {},
    showNotify: () => { calls.notify++; }, _writeUiQueueDiagnostic: () => {},
    _sxrLinearUrlFor: () => '',
    _sxrCommentsFor: (p, comp) => threads[comp], _sxrSetCommentsFor: (p, comp, list) => { threads[comp] = list; p[comp + '_tweaks'] = JSON.stringify(list); },
    _sxrStringifyComments: list => JSON.stringify(list), _sxrMintCommentId: () => 'c' + Math.random().toString(36).slice(2),
    _sxrNextTweakRound: () => 1, _sxrClearStaleApprovals: () => {}, _sxrMsgIsTweak: m => !!(m && m.is_tweak),
    _writeUiPrincipalKey: () => 'k', _sxrNormStatus: v => String(v || ''),
    _sxrPostLinearComment: async () => { calls.sent++; if (!gatewayCommits) throw Object.assign(new Error('refused'), { status: 409 }); return { native_committed: true }; },
    _sxrPushStatusToLinear: async () => { calls.sent++; if (!gatewayCommits) throw Object.assign(new Error('refused'), { status: 409 }); return { native_committed: true }; },
    _sxrUpsertFetch: async () => { calls.upsert++; return { ok: true, status: 200, json: async () => (upsertOk ? { ok: true } : { ok: false, error: 'refused' }) }; },
    _writeUiTrackSave: (a, b, c, send) => send(),
    _writeUiReportFailure: () => {}, _writeUiRecordFailure: () => {},
    _writeUiAdoptRepairAck: () => {}, _writeUiAppendRepairRef: () => {}, _writeUiRepairCompanions: () => [],
    _writeUiGatewayError: (st, c) => Object.assign(new Error(c), { status: st, code: c }),
    _writeUiReconcileReplayStatus: async () => false, _writeUiCompleteSourceRepairRefs: async () => true, _writeUiRemoveCompletedRepairRefs: () => {},
    _kasperPersistCache: () => true,
  };
  vm.createContext(s); vm.runInContext(code, s);
  const settle = () => new Promise(r => setTimeout(r, 30));
  return { s, calls, post, threads, settle, draft: () => s._sxrKasperState.drafts['s1|video'] || '' };
}

const failures = [];
async function run(name, fn) {
  try { await fn(); console.log('ok - ' + name); }
  catch (e) { failures.push(name); console.error('not ok - ' + name + ': ' + (e && e.message)); }
}

(async () => {
  await run('change request, the check read fails: nothing sent, his words back in the box', async () => {
    const t = sandbox({ fresh: null });
    t.s._sxrKasperState.drafts['s1|video'] = NOTE;
    t.s._sxrKasperRequestTweakComp('s1', 'video'); await t.settle();
    assert.strictEqual(t.calls.sent + t.calls.upsert, 0, 'nothing was sent');
    assert.strictEqual(t.post.video_status, 'Kasper Approval', 'the card is as it was');
    assert.strictEqual(t.draft(), NOTE, 'his change request is back in the box (box: ' + JSON.stringify(t.draft()) + ')');
  });
  await run('change request, someone else moved the part: his words back in the box', async () => {
    const t = sandbox({ fresh: { id: 's1', video_status: 'Client Approval', graphic_status: 'Kasper Approval', status: 'Client Approval' } });
    t.s._sxrKasperState.drafts['s1|video'] = NOTE;
    t.s._sxrKasperRequestTweakComp('s1', 'video'); await t.settle();
    assert.strictEqual(t.calls.sent + t.calls.upsert, 0, 'nothing was sent');
    assert.strictEqual(t.draft(), NOTE, 'his change request is back in the box (box: ' + JSON.stringify(t.draft()) + ')');
  });
  await run('change request, an earlier repair blocks it: his words back in the box', async () => {
    const t = sandbox({ cachedRepair: true });
    t.s._sxrKasperState.drafts['s1|video'] = NOTE;
    t.s._sxrKasperRequestTweakComp('s1', 'video'); await t.settle();
    assert.strictEqual(t.calls.sent + t.calls.upsert, 0, 'nothing was sent');
    assert.strictEqual(t.draft(), NOTE, 'his change request is back in the box (box: ' + JSON.stringify(t.draft()) + ')');
  });
  await run('change request refused by the gateway before it committed: his words back (as before)', async () => {
    const t = sandbox({ gatewayCommits: false });
    t.s._sxrKasperState.drafts['s1|video'] = NOTE;
    t.s._sxrKasperRequestTweakComp('s1', 'video'); await t.settle();
    assert.strictEqual(t.draft(), NOTE, 'his change request is back in the box');
  });
  await run('plain Comment whose save is refused: his note back in the box and out of the thread', async () => {
    const t = sandbox({ upsertOk: false });
    t.s._sxrKasperState.drafts['s1|video'] = NOTE;
    t.s._sxrKasperAddCommentComp('s1', 'video'); await t.settle();
    assert.strictEqual(t.calls.upsert, 1, 'the save was tried');
    assert.ok(!JSON.stringify(t.post.video_tweaks || '').includes('trim the first'), 'the refused note is not left in the thread looking sent');
    assert.strictEqual(t.draft(), NOTE, 'his note is back in the box (box: ' + JSON.stringify(t.draft()) + ')');
  });
  await run('words typed while the refused save was out are not overwritten', async () => {
    const t = sandbox({ fresh: null, onRead: s => { s._sxrKasperState.drafts['s1|video'] = 'Something newer'; } });
    t.s._sxrKasperState.drafts['s1|video'] = NOTE;
    t.s._sxrKasperRequestTweakComp('s1', 'video'); await t.settle();
    assert.strictEqual(t.draft(), 'Something newer', 'the newer text stays');
  });
  await run('a save that goes through leaves the box empty', async () => {
    const t = sandbox({});
    t.s._sxrKasperState.drafts['s1|video'] = NOTE;
    t.s._sxrKasperAddCommentComp('s1', 'video'); await t.settle();
    assert.strictEqual(t.calls.upsert, 1, 'saved once');
    assert.strictEqual(t.draft(), '', 'nothing is put back after a save that worked');
  });
  if (failures.length) { console.error(`\nsamples-kasper-draft-kept: ${failures.length} failed`); process.exit(1); }
  console.log('\nsamples-kasper-draft-kept: Kasper\'s words survive every refused Samples save ✅');
})();
