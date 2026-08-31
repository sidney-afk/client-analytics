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
    /* Comments are SKIPPED, not parsed. index.html comments are prose and
       contain apostrophes -- "the row's scope" -- which a quote-only scanner
       reads as an unterminated string, swallowing every brace after it and
       throwing `unclosed` for a function that balances perfectly. That error
       names the wrong thing and sends the reader hunting a syntax error that
       is not there. A brace or quote inside a comment is not code. */
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const ch = INDEX[j];
    const next = INDEX[j + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; j++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; j++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; j++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
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
    _prodAssetWriteOperation: slot => (
      slot === 'filming_plan' ? ''
        : slot === 'raw_footage' || slot === 'delivery_folder' ? 'batch_asset'
          : 'attachment'
    ),
    _prodToast: m => calls.toasts.push(String(m)),
    _prodOpenAssetEditor: (id, slot) => calls.opened.push({ id, slot }),
    _prodEnsureAssets: (id, force) => {
      calls.ensured.push({ id, force });
      return Promise.resolve(scenario.afterRead || null);
    },
    Promise, CSS: { escape: String }, setTimeout,
  };
  const fn = new Function('ctx', `with (ctx) { ${lift('_prodBeginAssetEdit')} return _prodBeginAssetEdit; }`)(ctx);
  const returned = fn('d1', scenario.slot);
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

  /* --- 5. the SLOT the click named is the slot that opens ------------------
   *
   * `editing` used to be a boolean, because exactly one slot was writable.
   * Raw footage and the frame folder made that false, and a boolean would have
   * let a Raw footage edit save itself into the canonical deliverable.
   */
  {
    const batched = { id: 'd1', team: 'graphics', batchId: 'b1' };
    const r = run({ issue: batched, state: Object.assign({}, READY), slot: 'raw_footage' });
    ok(r.calls.opened.length === 1 && r.calls.opened[0].slot === 'raw_footage',
      'the editor opens on the slot the row asked for, not on deliverable_file');
    const d = run({ issue: batched, state: Object.assign({}, READY) });
    ok(d.calls.opened.length === 1 && d.calls.opened[0].slot === 'deliverable_file',
      'and an unnamed slot still means the canonical deliverable (the default)');
    /* A batch slot targets the BATCH row, so a deliverable with no batch has
       no shared folder to edit. Refusing here rather than at the gateway keeps
       the reader from a 400 that reads like a permission problem. */
    const orphan = run({ issue: ISSUE, state: Object.assign({}, READY), slot: 'raw_footage' });
    ok(orphan.calls.opened.length === 0 && /batch/i.test(orphan.calls.toasts[0] || ''),
      'a deliverable with no batch refuses a batch-asset edit, and says that is why');
  }

  /* --- 6. the filming plan is refused as UNWRITABLE, not as forbidden -------
   * It has no write operation anywhere -- not in PROD_ASSET_SPECS, not in
   * policy.mjs, not in production_batch_asset_write. A write-gate sentence
   * here would imply some other role could do it, which is false.
   */
  {
    const r = run({ issue: ISSUE, state: Object.assign({}, READY), slot: 'filming_plan' });
    ok(r.calls.opened.length === 0, 'the filming plan never opens an editor');
    ok(/not editable/i.test(r.calls.toasts[0] || '')
      && !/role/i.test(r.calls.toasts[0] || ''),
      '...and the refusal says it is not editable, rather than blaming the reader role');
  }

  // --- 7. a read that resolves to nothing must not open ----------------------
  {
    const r = run({ issue: ISSUE, state: { status: 'idle', complete: false, assets: {} }, afterRead: null });
    setTimeout(() => {
      ok(r.calls.opened.length === 0,
        'a superseded read (null) leaves the editor closed rather than opening on unverified assets');
      ok(r.calls.toasts.length === 1, '...and says so');
      phase3();
    }, 0);
  }
}

/* --- 8. the LOAD-then-open path had a video refusal left in it -------------
 *
 * When attach opened to video, the synchronous team clause was removed but the
 * one inside the deferred read callback was still spelled `!== 'graphics'`. So
 * a video row that took the ordinary path -- any click after a background
 * refresh had wiped the asset read -- passed every visible gate, loaded
 * successfully, and then silently never opened. No toast, no control, nothing
 * to report. This is the same class of defect twice in one function, which is
 * why the check now runs against the async path specifically.
 */
function phase3() {
  const r = run({
    issue: { id: 'd1', team: 'video' },
    state: { status: 'idle', complete: false, assets: {} },
    afterRead: READY,
  });
  setTimeout(() => {
    ok(r.calls.opened.length === 1,
      'a VIDEO row that has to load first still opens the editor once the read lands');
    const g = run({
      issue: { id: 'd1', team: 'graphics' },
      state: { status: 'idle', complete: false, assets: {} },
      afterRead: READY,
    });
    setTimeout(() => {
      ok(g.calls.opened.length === 1, 'and graphics is unchanged on the same path');
      done();
    }, 0);
  }, 0);
}

function done() {
  console.log(failures === 0
    ? '\nAll asset-attach gate checks passed.'
    : '\n' + failures + ' check(s) FAILED.');
  process.exit(failures === 0 ? 0 : 1);
}
