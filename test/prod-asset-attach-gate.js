'use strict';
/*
 * An unread asset state is not a refusal.
 *
 * Reported 2026-08-25: the graphics designer could not attach a link. The
 * deliverable was healthy — assigned to her, attribution resolved, card linked,
 * sync clean — and her role pairing (creative key + designer member, graphics
 * team) permits both the attachment and the protected asset read.
 *
 * The mechanism is a lifetime mismatch. Every projection refresh calls
 * _prodInvalidateScopedReads, which DELETES the asset state of any row that is
 * not mid-edit, while the rendered panel keeps showing the values from the last
 * read. A click seconds later therefore lands on a state that is merely UNREAD
 * and was answered with "Refresh protected asset access before replacing the
 * canonical deliverable." — about a panel that looks perfectly ready.
 *
 * The gate itself is correct and must stay: replacing a canonical deliverable
 * against an unverified asset snapshot is exactly what it exists to prevent.
 * What changes is that an unread state now LOADS and then opens, while a
 * genuine read failure still refuses and says why.
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
function lift(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('missing ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

// --- harness ---------------------------------------------------------------
function run(scenario) {
  const calls = { toasts: [], ensured: [], opened: [] };
  const ctx = {
    _prodIssue: () => scenario.issue,
    _prodAssetState: () => scenario.state,
    _prodWriteTeam: t => (t === 'graphics' ? 'graphics' : 'video'),
    _prodCanWrite: () => scenario.canWrite !== false,
    _prodWriteGateText: () => scenario.gateText || '',
    _prodToast: m => calls.toasts.push(String(m)),
    _prodOpenAssetEditor: id => calls.opened.push(id),
    _prodEnsureAssets: (id, force) => {
      calls.ensured.push({ id, force });
      return Promise.resolve(scenario.afterRead || null);
    },
    Promise, CSS: { escape: String }, setTimeout,
  };
  const fn = new Function('ctx', `with (ctx) { ${lift('_prodBeginAssetEdit')} return _prodBeginAssetEdit; }`)(ctx);
  const returned = fn('d1');
  return { calls, returned };
}
const READY = { status: 'ready', complete: true, assets: { deliverable_file: { url: 'https://x/f' } } };
const ISSUE = { id: 'd1', team: 'graphics' };

// --- 1. the reported case: state was wiped by a refresh, panel looks ready ---
{
  const r = run({ issue: ISSUE, state: { status: 'idle', complete: false, assets: {} }, afterRead: READY });
  ok(r.calls.toasts.length === 0,
    'an UNREAD state no longer scolds the reader about refreshing access');
  ok(r.calls.ensured.length === 1 && r.calls.ensured[0].force === true,
    'it forces a fresh read instead');
  return setTimeout(() => {
    ok(r.calls.opened.length === 1, '...and opens the editor once the read lands');
    phase2();
  }, 0);
}

function phase2() {
  // --- 2. a genuine read failure still refuses, with the real reason ---------
  {
    const r = run({ issue: ISSUE, state: { status: 'error', complete: false, error: 'Asset access was denied.', assets: {} } });
    ok(r.calls.toasts.length === 1 && /denied/.test(r.calls.toasts[0]),
      'a real read FAILURE still refuses, and shows the actual reason');
    ok(r.calls.opened.length === 0, '...and does not open the editor');
    ok(r.calls.ensured.length === 1, '...while still retrying the read');
  }

  // --- 3. an already-ready state opens immediately, no extra read -----------
  {
    const r = run({ issue: ISSUE, state: Object.assign({}, READY) });
    ok(r.calls.opened.length === 1 && r.calls.ensured.length === 0,
      'a ready state opens straight away and re-reads nothing');
  }

  // --- 4. the write gate still comes first ----------------------------------
  {
    const r = run({ issue: ISSUE, state: Object.assign({}, READY), canWrite: false, gateText: 'Your staff role cannot perform this action.' });
    ok(r.calls.opened.length === 0 && /staff role/.test(r.calls.toasts[0] || ''),
      'the write gate is still checked before anything else');
    /* 2026-08-30: video is no longer refused HERE. It was refused by a second
       team clause that duplicated _prodCanWrite and could disagree with the
       renderer -- which is how a video row came to offer no control and no
       explanation. The refusal now lives in exactly one place, so a video row
       with write permission opens, and a row without it is stopped by the gate
       above with a real sentence. */
    const v = run({ issue: { id: 'd1', team: 'video' }, state: Object.assign({}, READY) });
    ok(v.calls.opened.length === 1, 'a video deliverable now opens the editor, like graphics');
    const vBlocked = run({
      issue: { id: 'd1', team: 'video' }, state: Object.assign({}, READY),
      canWrite: false, gateText: 'Your staff role cannot perform this action.',
    });
    ok(vBlocked.calls.opened.length === 0 && /staff role/.test(vBlocked.calls.toasts[0] || ''),
      'and a video row the person may not write is refused by the ONE gate, with its reason');
  }

  // --- 5. a read that resolves to nothing must not open ----------------------
  {
    const r = run({ issue: ISSUE, state: { status: 'idle', complete: false, assets: {} }, afterRead: null });
    setTimeout(() => {
      ok(r.calls.opened.length === 0,
        'a superseded read (null) leaves the editor closed rather than opening on unverified assets');
      ok(r.calls.toasts.length === 1, '...and says so');
      done();
    }, 0);
  }
}

function done() {
  console.log(failures === 0
    ? '\nAll asset-attach gate checks passed.'
    : '\n' + failures + ' check(s) FAILED.');
  process.exit(failures === 0 ? 0 : 1);
}
