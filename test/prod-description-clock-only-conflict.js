'use strict';
/*
 * A description save that loses only the CLOCK retries once by itself.
 *
 * A server job (the thumbnail titles job) stamps a freshly created card with a
 * new updated_at while leaving the description text alone. A person saving in
 * that window used to be refused with write_conflict and had to press Save
 * again. Runs the real _prodSaveDescription from the built page against
 * stubs: the clock-only conflict is retried once with the winner's clock, a
 * conflict where the TEXT changed is still shown to the person and not retried,
 * and a clock that keeps moving cannot loop.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failed = 0;
function ok(cond, msg) {
  if (cond) console.log('  ok  ' + msg);
  else { failed++; console.log('FAIL  ' + msg); }
}
function grabFunc(src, signature) {
  const start = src.indexOf(signature);
  if (start < 0) throw new Error('missing ' + signature);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unterminated ' + signature);
}
const SRC = grabFunc(INDEX, 'async function _prodSaveDescription(');

function harness(script) {
  const row = { id: 'del_1', brief: 'old text', updated_at: 'T0' };
  const sent = [];
  const state = {
    editing: true, saving: false, draft: 'my new text', value: 'old text', baseline: 'old text',
    hasValue: true, status: 'ready', sourceUpdatedAt: 'T0', uploading: 0, requestId: '', error: '', remoteChanged: false
  };
  const ctx = {
    _prodIssue: () => ({ id: 'del_1', updatedRaw: row.updated_at }),
    _prodDescriptionState: () => state,
    _prodCanWrite: () => true,
    _prodDescriptionOperation: () => 'description',
    _prodWriteRequestId: () => 'req-' + (sent.length + 1),
    _prodNextDescriptionRequestToken: () => 1,
    _prodSyncDescriptionRow: (id, brief, at) => { row.brief = brief; if (at) row.updated_at = at; },
    _prodSyncBatchDescriptionRow: () => {},
    _prodDescriptionText: v => (v == null ? '' : String(v)),
    _prodGatewayWrite: async (issue, op, fields) => {
      sent.push({ clock: issue.updatedRaw, text: fields.description });
      const step = script[Math.min(sent.length - 1, script.length - 1)];
      if (step.ok) return { row: { brief: fields.description, updated_at: step.ok } };
      const err = new Error('write_conflict'); err.code = 'write_conflict';
      err.row = { brief: step.brief, updated_at: step.clock };
      throw err;
    },
    _prodWriteErrorText: () => 'Description changed elsewhere.',
    _writeUiRecordFailure: () => { ctx.logged++; },
    _svDraftClear: () => {}, _prodDescDraftClient: () => 'c', _prodToast: () => {}, _prodRender: () => {},
    _prodFocusDescriptionControl: () => {}, _prodDescriptionEditorControl: () => 'text',
    PROD_DESCRIPTION_IMAGE_PLACEHOLDER_RE: /!\[Uploading image/,
    logged: 0, result: null
  };
  vm.createContext(ctx);
  vm.runInContext(SRC + '\nthis.save = _prodSaveDescription;', ctx);
  return { ctx, state, sent, row };
}

(async () => {
  console.log('clock moved, text did not: one automatic retry with the winner\'s clock');
  let h = harness([{ brief: 'old text', clock: 'T1' }, { ok: 'T2' }]);
  await h.ctx.save(null, 'del_1');
  ok(h.sent.length === 2, 'the draft was sent twice');
  ok(h.sent[0].clock === 'T0' && h.sent[1].clock === 'T1', 'the second send carries the clock the server answered with');
  ok(h.sent[1].text === 'my new text', 'and the same draft text');
  ok(!h.state.editing && h.state.value === 'my new text' && !h.state.error, 'the person ends on a saved description with no error');
  ok(h.ctx.logged === 0, 'a refusal that healed itself is not reported as a failed save');

  console.log('text changed under us: a real conflict, shown, never retried');
  h = harness([{ brief: 'someone else wrote this', clock: 'T1' }, { ok: 'T2' }]);
  await h.ctx.save(null, 'del_1');
  ok(h.sent.length === 1, 'only one send');
  ok(h.state.editing && h.state.draft === 'my new text', 'the draft is kept for review');
  ok(h.state.remoteChanged && h.state.value === 'someone else wrote this', 'the winner\'s text is shown');
  ok(h.ctx.logged === 1, 'the refusal is reported');

  console.log('a clock that keeps moving cannot loop');
  h = harness([{ brief: 'old text', clock: 'T1' }, { brief: 'old text', clock: 'T2' }, { ok: 'T3' }]);
  await h.ctx.save(null, 'del_1');
  ok(h.sent.length === 2, 'two sends and then it stops');
  ok(h.state.editing && h.state.error, 'and the person is told, as before');

  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('description clock-only conflict checks passed');
})();
