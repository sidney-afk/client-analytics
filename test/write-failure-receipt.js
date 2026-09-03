'use strict';
/*
 * OPEN_REPAIRS 101, the two halves that need no deploy.
 *
 * Run:  node test/write-failure-receipt.js   (exit 0 = all good)
 *
 * The item asks for a durable, server-side write-failure receipt. Points 1-3 of
 * it need an edge-function change and a grant; points 2 (browser half) and 4 do
 * not, and point 4 is the one the entry itself calls out as removing the worst
 * outcome on its own:
 *
 *   "A refused comment is the only thing here that cannot be reconstructed.
 *    Retaining the draft locally against its card id -- a `_calReplyDrafts`
 *    entry mirrored to `sessionStorage`, which today happens for a new root and
 *    NOT for a reply -- is a smaller change than any of the above."
 *
 * Two properties are asserted here, and the second matters as much as the first:
 * the ring must gain the identifiers that let a human FIND the lost thread, and
 * it must not start accumulating the comment body or the author's name in
 * localStorage while doing it.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures += 1; console.error('FAIL  ' + message); }
}
function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
function grabConst(name) {
  const m = new RegExp('const ' + name + ' = [^;]+;').exec(INDEX);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

/* ---- the reply draft survives, keyed per card ----------------------------- */

const store = {};
const HARNESS = `
const sessionStorage = {
  _d: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; }
};
const _calReplyDrafts = Object.create(null);
`;
const ctx = vm.createContext({ console });
vm.runInContext(HARNESS
  + grabConst('CAL_REPLY_DRAFTS_PREFIX') + '\n'
  + grabConst('CAL_REPLY_DRAFT_MAX') + '\n'
  + grabFunc('_calReplyDraftsLoad') + '\n'
  + grabFunc('_calReplyDraftsPersist') + '\n', ctx);
const run = e => vm.runInContext(e, ctx);

run(`_calReplyDrafts['cm_root_1'] = 'the client asked for the logo bigger'; _calReplyDraftsPersist('card-A');`);
ok(run(`sessionStorage.getItem(CAL_REPLY_DRAFTS_PREFIX + 'card-A')`) !== null,
'a reply draft is mirrored to sessionStorage against its card');

/* The repro: the person closes the modal after a refused save and reopens it.
   `openCalComments` wipes the in-memory map, so before this change the text was
   gone at exactly the moment they went looking for why the save failed. */
run(`for (const k of Object.keys(_calReplyDrafts)) delete _calReplyDrafts[k];
     Object.assign(_calReplyDrafts, _calReplyDraftsLoad('card-A'));`);
ok(run(`_calReplyDrafts['cm_root_1']`) === 'the client asked for the logo bigger',
'and it comes back after the wipe that every modal open performs');

run(`for (const k of Object.keys(_calReplyDrafts)) delete _calReplyDrafts[k];
     Object.assign(_calReplyDrafts, _calReplyDraftsLoad('card-B'));`);
ok(run(`Object.keys(_calReplyDrafts).length`) === 0,
'a different card does not inherit it — the store is per card, not global');

/* A successful send clears it; the early return on a REFUSAL is what keeps it. */
run(`Object.assign(_calReplyDrafts, _calReplyDraftsLoad('card-A'));
     delete _calReplyDrafts['cm_root_1']; _calReplyDraftsPersist('card-A');`);
ok(run(`sessionStorage.getItem(CAL_REPLY_DRAFTS_PREFIX + 'card-A')`) === null,
'sending the reply clears the stored draft rather than leaving it behind for ever');

/* The cap holds threads, not characters: a long draft is never shortened. */
run(`for (const k of Object.keys(_calReplyDrafts)) delete _calReplyDrafts[k];
     for (let i = 0; i < 30; i++) _calReplyDrafts['p' + i] = 'draft ' + i;
     _calReplyDraftsPersist('card-C');`);
const capped = JSON.parse(run(`sessionStorage.getItem(CAL_REPLY_DRAFTS_PREFIX + 'card-C')`));
ok(Object.keys(capped).length === run(`CAL_REPLY_DRAFT_MAX`),
'the store keeps at most CAL_REPLY_DRAFT_MAX threads per card');
ok(capped.p29 === 'draft 29' && capped.p0 === undefined,
'and evicts the least recently written, not the newest');

const long = 'x'.repeat(50000);
run(`for (const k of Object.keys(_calReplyDrafts)) delete _calReplyDrafts[k];
     _calReplyDrafts['p'] = ${JSON.stringify(long)}; _calReplyDraftsPersist('card-D');`);
ok(JSON.parse(run(`sessionStorage.getItem(CAL_REPLY_DRAFTS_PREFIX + 'card-D')`)).p.length === 50000,
'a long draft is stored whole — silently shortening it is worse than dropping it');

/* ---- the diagnostic row names the thread, and nothing more ---------------- */

const ctx2 = vm.createContext({ console });
vm.runInContext(`
const localStorage = { _d: {}, getItem(k) { return this._d[k] == null ? null : this._d[k]; }, setItem(k, v) { this._d[k] = String(v); } };
const WRITE_UI_QUEUE_DIAG_KEY = 'k';
`
  + grabConst('WRITE_UI_DIAG_IDS') + '\n'
  + grabConst('WRITE_UI_DIAG_PAYLOAD_IDS') + '\n'
  + grabFunc('_writeUiDiagnosticIds') + '\n'
  + grabFunc('_writeUiQueueDiagnostic') + '\n', ctx2);
const run2 = e => vm.runInContext(e, ctx2);

/* A real queue item, shaped as _writeUiQueueLegacyPair builds it. */
run2(`_writeUiQueueDiagnostic('calendar', 'ui_write_failure', {
  id: 'q_123_comment',
  kind: 'comment',
  client_slug: 'sidneylaruel',
  transport: 'legacy_n8n',
  card: 'card-A',
  component: 'video',
  comment: 'cm_root_1',
  parent: 'cm_root_1',
  payload: { issue: 'VID-13330', body: 'please make the logo bigger', author: 'A Person' },
  source_gate: { comment_body: 'please make the logo bigger', comment_author: 'A Person' }
}, { code: 'comment_parent_ambiguous' });`);
const row = JSON.parse(run2(`localStorage.getItem(WRITE_UI_QUEUE_DIAG_KEY)`))[0];

ok(row.card === 'card-A' && row.component === 'video' && row.comment === 'cm_root_1'
  && row.issue === 'VID-13330' && row.client_slug === 'sidneylaruel' && row.id === 'q_123_comment',
'a refusal row now names the card, component, comment, work item and client slug');
ok(row.kind === 'comment' && row.outcome === 'ui_write_failure' && row.code === 'comment_parent_ambiguous',
'the fields the row already carried are unchanged');

const serialized = JSON.stringify(row);
ok(!/logo bigger/.test(serialized), 'the comment body is NOT recorded');
ok(!/A Person/.test(serialized), "the comment author's name is NOT recorded");
ok(!('source_gate' in row) && !('payload' in row),
'nested caller structures are not copied wholesale — only allowlisted scalars are');

run2(`_writeUiQueueDiagnostic('calendar', 'drained', { kind: 'status', payload: { nested: { deep: 'x' } }, id: { not: 'a scalar' } });`);
const row2 = JSON.parse(run2(`localStorage.getItem(WRITE_UI_QUEUE_DIAG_KEY)`))[1];
ok(row2.id === undefined && row2.nested === undefined,
'a non-scalar under an allowlisted key is dropped rather than serialized');

/* ---- THE WIRING, not just the helpers ------------------------------------
 *
 * Added after a mutation check caught this suite passing with the feature dead.
 * Deleting the persist call from the composer handler, and deleting the restore
 * from `openCalComments`, both left every assertion above green -- because they
 * drive the two helpers directly and never ask whether anything CALLS them.
 * That is OPEN_REPAIRS 114's lesson one level up: a guard is only as reachable
 * as the path that feeds it, and a test that exercises the guard alone cannot
 * see the path.
 *
 * Each call is looked for inside the BODY of the function that must make it,
 * brace-matched rather than by character distance, so prose is free and only a
 * real move of the call fails it. */
function bodyOf(name) { return grabFunc(name); }

ok(/else if \(_calReplyTarget\) \{[\s\S]{0,200}?_calReplyDraftsPersist\(_calOpenCommentsPid\)/.test(bodyOf('_calOnComposerInput')),
'typing in a reply box writes the draft through to sessionStorage');
ok(/else if \(_calReplyTarget\) \{[\s\S]{0,200}?_calReplyDraftsPersist\(_calOpenCommentsPid\)/.test(bodyOf('_calCaptureModalDrafts')),
'the modal-wide capture persists a reply draft too, so a re-render cannot lose it');
ok(/_calReplyDraftsLoad\(pid\)/.test(bodyOf('openCalComments')),
'opening the modal restores this card\'s reply drafts instead of only wiping them');
ok(bodyOf('openCalComments').indexOf('delete _calReplyDrafts[k]')
  < bodyOf('openCalComments').indexOf('_calReplyDraftsLoad(pid)'),
'and restores AFTER the wipe, not before it, or the wipe would undo the restore');
ok(/if \(parentId\) \{ delete _calReplyDrafts\[parentId\]; _calReplyDraftsPersist\(pid\); \}/.test(bodyOf('_calSubmitComposer')),
'a sent reply clears the stored draft; the early return above it is what keeps a refused one');

/* ---- THE SAMPLES TWIN, which the first version of this shipped without ----
 *
 * A 2026-09-03 audit found point 4 landed on the calendar only. `_sxrReplyDrafts`
 * was wiped on every open with no load beside it and never persisted, so a
 * client's refused reply on the samples review surface died exactly the way the
 * calendar's used to. `_sxrCommentRole()` returns 'client' on a share link and
 * the comments button carries no client gate, so this is a client-facing path.
 *
 * That is the third time this repo has fixed one of these two surfaces and not
 * its twin (item 87.3 predicted it in writing; the SMM queue gate was missed on
 * samples anyway). So the twin is asserted here, structurally, in the same file
 * as the calendar one — a prediction is not a check. */
ok(/const SXR_REPLY_DRAFTS_PREFIX = 'sv_sxrReplyDrafts_';/.test(INDEX),
'samples review has its own reply-draft store');
ok(/else if \(_sxrReplyTarget\) \{ _sxrReplyDrafts\[_sxrReplyTarget\] = ta\.value; _sxrReplyDraftsPersist\(_sxrOpenCommentsPid\); \}/.test(INDEX),
'typing a samples reply writes it through to sessionStorage');
ok(/_sxrReplyDraftsLoad\(pid\)/.test(bodyOf('openSxrComments')),
'opening the samples thread restores that card\'s reply drafts instead of only wiping them');
ok(bodyOf('openSxrComments').indexOf('delete _sxrReplyDrafts[k]')
  < bodyOf('openSxrComments').indexOf('_sxrReplyDraftsLoad(pid)'),
'and restores AFTER the wipe on samples too');
ok(/if \(parentId\) \{ delete _sxrReplyDrafts\[parentId\]; _sxrReplyDraftsPersist\(pid\); \}/.test(INDEX),
'a sent samples reply clears its stored draft');
ok(/const kept = keys\.slice\(-CAL_REPLY_DRAFT_MAX\);/.test(bodyOf('_sxrReplyDraftsPersist')),
'both surfaces share one cap constant, so they cannot drift apart');

/* ---- source form: the lane that matters actually passes the identifiers ---- */

ok(/_writeUiReportFailure\(surface, 'comment', error, \{[\s\S]{0,200}?card: post && post\.id/.test(INDEX),
'the canonical comment gateway refusal reports the card it was raised for');
ok(/function _writeUiReportFailure\(surface, operation, error, context\)/.test(INDEX),
'the failure reporter accepts identifiers for the sites that can supply them');
ok(/Object\.assign\(\{ kind: operation \}, context \|\| \{\}\)/.test(INDEX),
'and merges them into the diagnostic item, so they pass through the same allowlist');

if (failures) {
  console.error('\nWrite-failure receipt checks FAILED');
  process.exit(1);
}
console.log('\nWrite-failure receipt checks passed');
