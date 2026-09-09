'use strict';
/*
 * WORKLOAD TWEAK-FEEDBACK CALLOUT INTEGRATION.
 *
 * Lane A originally added a Linear-id bridge here. Lane D replaced that wire:
 * native Workload rows are now read by `wlFetchTweakComments`, progressively
 * painted one row at a time, and abandoned when the popover generation moves.
 * The old test still sliced from `if (tweakSubs.length)`, outside the shipped
 * `const token` declaration, and then asserted the retired Linear-id contract.
 *
 * This suite executes the final call-site block and the real close function.
 * `test/workload-tweak-feedback-source.js` separately executes the reader and
 * proves that a native id reaches `production-comments`; this file proves the
 * browser call site supplies row ids, paints progressive answers, preserves an
 * already-interacted-with row at final settlement, and cancels stale work.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function extractFunction(name) {
  const start = source.indexOf('function ' + name);
  if (start < 0) throw new Error('missing function ' + name);
  const brace = source.indexOf('{', start);
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
  throw new Error('unclosed function ' + name);
}

// Include the generation declaration that the stale A-only harness excluded.
const START = 'const token = ++_wlTweakCommentsToken;';
const END = '// Position: anchored below the clicked rollup';
const start = source.indexOf(START);
const end = source.indexOf(END, start);
if (start < 0 || end < 0 || end <= start) {
  console.error('FAIL  could not slice the final tweak-feedback call site from index.html');
  process.exit(1);
}
const block = source.slice(start, end);
const closeSource = extractFunction('wlClosePopover');

ok(/wlFetchTweakComments\(tweakSubs\.map\(s => s\.id\), paintRow, abandoned\)/.test(block),
  'the real call site passes row ids plus progressive-paint and cancellation callbacks');
ok(/const token = \+\+_wlTweakCommentsToken/.test(block),
  'the executed slice owns the generation token it reads (the stale harness hole is closed)');

function makePopover(rowIds) {
  const boxes = new Map(rowIds.map(id => [String(id), { innerHTML: 'loading' }]));
  let open = true;
  return {
    boxes,
    classList: {
      contains(name) { return name === 'open' && open; },
      remove(name) { if (name === 'open') open = false; },
    },
    setAttribute() {},
    querySelector(selector) {
      const match = /\[data-wl-comments-for="([^"]*)"\]/.exec(selector);
      return match ? (boxes.get(match[1]) || null) : null;
    },
    querySelectorAll(selector) {
      return selector === '.wl-tweak-comments' ? [...boxes.values()] : [];
    },
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function buildHarness(fetchImpl) {
  const factory = new Function(
    'window', 'wlFetchTweakComments', 'wlRenderTweakComments', 'wlMarkClampedComments',
    `let _wlTweakCommentsToken = 0;
     let activePop = null;
     const wlState = { popoverAnchor: null, renderQueued: false };
     const document = {
       getElementById(id) { return id === 'wlPopover' ? activePop : null; },
       contains() { return false; },
       querySelectorAll() { return []; }
     };
     const wlClearSpotlight = () => {};
     const renderWorkloadAll = () => {};
     ${closeSource}
     return {
       open(tweakSubs, pop) { activePop = pop; ${block} },
       close() { wlClosePopover(false); },
       generation() { return _wlTweakCommentsToken; }
     };`
  );
  const render = rows => rows && rows.failed
    ? '<div class="wl-tweak-comments-status is-unavailable">Could not load.</div>'
    : '<div class="feedback">' + (rows || []).map(row => row.body).join('|') + '</div>';
  return factory({}, fetchImpl, render, () => {});
}

const NATIVE_ONE = 'del_fixture_one';
const NATIVE_TWO = 'del_fixture_two';
const rows = [{ id: NATIVE_ONE }, { id: NATIVE_TWO }];
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {
  // Progressive paint: the first native answer must not wait for the aggregate.
  {
    const pending = deferred();
    let sent = null, onRow = null, shouldStop = null;
    const pop = makePopover(rows.map(row => row.id));
    const harness = buildHarness((ids, paint, stop) => {
      sent = ids.slice(); onRow = paint; shouldStop = stop; return pending.promise;
    });
    harness.open(rows, pop);

    ok(JSON.stringify(sent) === JSON.stringify([NATIVE_ONE, NATIVE_TWO]),
      'the call site sends native Workload row ids, not an obsolete Linear-id bridge');
    ok(typeof onRow === 'function' && typeof shouldStop === 'function',
      'the native reader receives both progressive-paint and abandonment callbacks');
    ok(shouldStop() === false, 'the current generation remains wanted while its popover is open');

    onRow(NATIVE_ONE, [{ body: 'First native answer' }]);
    ok(/First native answer/.test(pop.boxes.get(NATIVE_ONE).innerHTML)
      && pop.boxes.get(NATIVE_TWO).innerHTML === 'loading',
    'one native row paints immediately while its neighbour is still loading');

    // An editor can expand/collapse content before the slow row settles. Final
    // settlement must not rewrite that already-painted DOM.
    pop.boxes.get(NATIVE_ONE).innerHTML = '<div class="editor-state">expanded</div>';
    pending.resolve({
      [NATIVE_ONE]: [{ body: 'First native answer' }],
      [NATIVE_TWO]: [{ body: 'Second native answer' }],
    });
    await tick(); await tick();
    ok(/editor-state/.test(pop.boxes.get(NATIVE_ONE).innerHTML),
      'final settlement does not repaint a row the editor already interacted with');
    ok(/Second native answer/.test(pop.boxes.get(NATIVE_TWO).innerHTML),
      'final settlement backstops a row not delivered through progressive paint');
  }

  // Opening a new generation, even one with no tweak rows, abandons the old one.
  {
    const first = deferred();
    let oldPaint = null, oldStop = null;
    const oldPop = makePopover([NATIVE_ONE]);
    const currentPop = makePopover([]);
    let calls = 0;
    const harness = buildHarness((ids, paint, stop) => {
      calls++; oldPaint = paint; oldStop = stop; return first.promise;
    });
    harness.open([{ id: NATIVE_ONE }], oldPop);
    const before = harness.generation();
    harness.open([], currentPop);
    ok(harness.generation() === before + 1,
      'a replacement with no tweak rows still advances the feedback generation');
    ok(oldStop() === true, 'the previous native drain is told to stop spending read budget');
    oldPaint(NATIVE_ONE, [{ body: 'stale answer' }]);
    ok(oldPop.boxes.get(NATIVE_ONE).innerHTML === 'loading',
      'a stale progressive answer cannot paint into the replaced popover');
    first.resolve({ [NATIVE_ONE]: [{ body: 'stale final answer' }] });
    await tick(); await tick();
    ok(oldPop.boxes.get(NATIVE_ONE).innerHTML === 'loading' && calls === 1,
      'the stale final answer is also suppressed without starting another read');
  }

  // Closing the popover executes the other production cancellation path.
  {
    const pending = deferred();
    let paint = null, stop = null;
    const pop = makePopover([NATIVE_ONE]);
    const harness = buildHarness((ids, onRow, shouldStop) => {
      paint = onRow; stop = shouldStop; return pending.promise;
    });
    harness.open([{ id: NATIVE_ONE }], pop);
    const before = harness.generation();
    harness.close();
    ok(harness.generation() === before + 1 && stop() === true,
      'closing advances the real generation and abandons the in-flight native read');
    paint(NATIVE_ONE, [{ body: 'after close' }]);
    pending.reject(new Error('synthetic close-time failure'));
    await tick(); await tick();
    ok(pop.boxes.get(NATIVE_ONE).innerHTML === 'loading',
      'neither progress nor rejection overwrites a closed popover');
  }

  // A current-generation whole-scope rejection remains visible and routes the
  // editor to SyncView, never to a provider that may no longer exist.
  {
    const pop = makePopover([NATIVE_ONE]);
    const harness = buildHarness(() => Promise.reject(new Error('synthetic scope change')));
    harness.open([{ id: NATIVE_ONE }], pop);
    await tick(); await tick();
    ok(/Couldn&rsquo;t load feedback/.test(pop.boxes.get(NATIVE_ONE).innerHTML),
      'a current native feedback rejection paints an explicit unavailable state');
    ok(/open the post in SyncView/i.test(pop.boxes.get(NATIVE_ONE).innerHTML)
      && !/open .*Linear/i.test(pop.boxes.get(NATIVE_ONE).innerHTML),
    'the recovery message points to SyncView and carries no stale provider instruction');
  }

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\nWorkload tweak-feedback call-site checks passed.');
})().catch(error => {
  console.error('FAIL  the tweak-feedback harness threw: ' + (error && error.stack || error));
  process.exit(1);
});
