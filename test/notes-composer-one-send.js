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

(async () => {
  for (const [surface, prefix] of [['Calendar', '_cal'], ['Samples', '_sxr']]) {
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
