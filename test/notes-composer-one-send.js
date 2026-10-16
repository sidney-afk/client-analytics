'use strict';
/*
 * Calendar and Samples Notes: one send at a time, and a late answer never
 * clears another card's box.
 *
 * The composer keeps its text and stays live while a note is on its way. A
 * second Enter (or Enter, then Send) started a second send of the same note:
 * two notes on the work item, each copy overwriting the other's view of the
 * thread. And when the answer came back after the person had opened another
 * card's Notes, the code emptied the box that was on screen by then.
 *
 * The real functions are lifted out of the app and run against stand-ins.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const liftAsync = name => 'async ' + extractFunction(INDEX, name);
const tick = () => new Promise(r => setImmediate(r));

// A run that stops before its last line (a promise nobody answers) must not read as a pass.
let finished = false;
process.on('exit', code => { if (!finished && code === 0) { console.log('FAIL  the suite stopped before its last check'); process.exitCode = 1; } });

function build(prefix) {
  const P = prefix;                       // '_cal' or '_sxr'
  const env = { appended: [], answer: [], rendered: 0, state: { open: 'card-1', root: 'A note', reply: null, edit: null } };
  const api = new Function('env', `
    let ${P}ComposerSending = false;
    let ${P}OpenCommentsPid = env.state.open;
    let ${P}RootDraft = env.state.root;
    let ${P}RootDraftRestored = '';
    let ${P}ReplyTarget = null;
    let ${P}EditTarget = null;
    const ${P}EditDrafts = {};
    const ${P}ReplyDrafts = {};
    const ${P}CaptureModalDrafts = () => {};
    const ${P}SaveCommentEdit = async () => true;
    const ${P}NoteDraftSet = () => {};
    const ${P}ReplyDraftsPersist = () => {};
    const ${P}RenderCommentsModal = () => { env.rendered++; };
    const sessionStorage = { removeItem() {} };
    const document = { getElementById: () => null };
    const setTimeout = () => 0;
    const ${P}AppendComment = (pid, parentId, body) => { env.appended.push({ pid, body }); return new Promise(resolve => env.answer.push(resolve)); };
    ${liftAsync(P + 'SubmitComposerNow')}
    ${liftAsync(P + 'SubmitComposer')}
    return {
      submit: ${P}SubmitComposer,
      openOther: (pid, text) => { ${P}OpenCommentsPid = pid; ${P}RootDraft = text; },
      root: () => ${P}RootDraft,
    };
  `)(env);
  return { env, api };
}

/* Calendar, since the note outbox (2026-10-15): the click hands the note to
   the outbox (190, _noteOutboxPut / _noteOutboxSend) and frees the box at
   once; the send runs behind it and a failed one stays in the thread as "Not
   sent" with Retry (docs/syncview-design/tests/note-send-outbox-browser.js).
   What this suite still holds the Calendar to: one note per click, the box
   free at the click, and nothing done to another card's box. */
function buildCal() {
  const env = { queued: [], sent: [], rendered: 0, state: { open: 'card-1', root: 'A note' } };
  const api = new Function('env', `
    let _calComposerSending = false;
    let _calOpenCommentsPid = env.state.open;
    let _calRootDraft = env.state.root;
    let _calRootDraftRestored = '';
    let _calReplyTarget = null;
    let _calEditTarget = null;
    let _calComposeComp = 'video', _calComposeAudience = 'internal', _calComposeIsTweak = false;
    const _calEditDrafts = {};
    const _calReplyDrafts = {};
    const calState = { posts: [{ id: 'card-1' }, { id: 'card-2' }] };
    const _calCaptureModalDrafts = () => {};
    const _calSaveCommentEdit = async () => true;
    const _calNoteDraftSet = () => {};
    const _calReplyDraftsPersist = () => {};
    const _calRenderCommentsModal = () => { env.rendered++; };
    const _calFindCompForCommentId = () => 'video';
    const _calComponentsFor = () => ['video'];
    const _prodCanonicalCommentGate = () => ({ linked: false, ready: true });
    const _calCommentSendPending = () => false;
    const _calCommentRole = () => 'smm';
    const _calCurrentAuthor = () => 'Fixture';
    const _calCurrentAuthorId = () => 'm1';
    const _calNextTweakRound = () => 1;
    let n = 0;
    const _calMintCommentId = () => 'c_' + (++n);
    const _noteOutboxPut = e => { env.queued.push(e); return e; };
    const _noteOutboxSend = id => { env.sent.push(id); return Promise.resolve(true); };
    const showNotify = () => {};
    const document = { getElementById: () => null };
    const setTimeout = () => 0;
    ${liftAsync('_calSubmitComposerNow')}
    ${liftAsync('_calSubmitComposer')}
    return {
      submit: _calSubmitComposer,
      openOther: (pid, text) => { _calOpenCommentsPid = pid; _calRootDraft = text; },
      root: () => _calRootDraft,
    };
  `)(env);
  return { env, api };
}

(async () => {
  {
    const { env, api } = buildCal();
    const first = api.submit();
    const second = api.submit();
    await Promise.all([first, second]);
    ok(env.queued.length === 1 && env.sent.length === 1, 'Calendar: Enter twice sends the note once');
    ok(api.root() === '', 'Calendar: the box is free the moment the note is sent');
    ok(env.queued[0].body === 'A note' && env.queued[0].pid === 'card-1' && env.sent[0] === env.queued[0].id, 'Calendar: the outbox gets the note, with its own id, for its own card');
    api.openOther('card-2', 'Half a note on another card');
    ok(api.root() === 'Half a note on another card', 'Calendar: what is typed on another card is left alone');
    api.openOther('card-1', 'A second note');
    await api.submit();
    ok(env.queued.length === 2 && env.queued[1].body === 'A second note' && env.queued[1].id !== env.queued[0].id, 'Calendar: the next note sends normally, with a new id');
  }
  for (const [surface, prefix] of [['Samples', '_sxr']]) {
    // --- Enter twice: one send ---------------------------------------------------
    {
      const { env, api } = build(prefix);
      const first = api.submit();
      const second = api.submit();
      await tick();
      ok(env.appended.length === 1, surface + ': Enter twice sends the note once');
      env.answer.splice(0).forEach(done => done(true));
      await Promise.all([first, second]);
      ok(api.root() === '', surface + ': the box is cleared once the note is saved');
      // and the composer works again afterwards
      api.openOther('card-1', 'A second note');
      const third = api.submit();
      await tick();
      ok(env.appended.length === 2 && env.appended[1].body === 'A second note', surface + ': the next note sends normally');
      env.answer.splice(0).forEach(done => done(true));
      await third;
    }
    // --- the answer arrives after another card's Notes were opened ---------------
    {
      const { env, api } = build(prefix);
      const sending = api.submit();
      await tick();
      api.openOther('card-2', 'Half a note on another card');
      const rendersBefore = env.rendered;
      env.answer.splice(0).forEach(done => done(true));
      await sending;
      ok(api.root() === 'Half a note on another card', surface + ': a late answer does not clear what is typed on another card');
      ok(env.rendered === rendersBefore, surface + ': and does not redraw that card\'s Notes');
    }
    // --- a send that fails frees the composer -------------------------------------
    {
      const { env, api } = build(prefix);
      const failing = api.submit();
      await tick();
      env.answer.splice(0).forEach(done => done(false));
      await failing;
      ok(api.root() === 'A note', surface + ': a note that did not save stays in the box');
      const again = api.submit();
      await tick();
      ok(env.appended.length === 2, surface + ': and can be sent again');
      env.answer.splice(0).forEach(done => done(true));
      await again;
    }
  }
  finished = true;
  if (failures) { console.log('\n' + failures + ' check(s) failed'); process.exit(1); }
  console.log('\nnotes-composer-one-send: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
