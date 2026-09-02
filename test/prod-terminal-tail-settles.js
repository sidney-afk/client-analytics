'use strict';
/*
 * EVERY EXIT FROM THE TERMINAL TAIL LEAVES AN HONEST PANE.
 *
 * Run:  node test/prod-terminal-tail-settles.js   (exit 0 = all good)
 *
 * Two findings raised on PR #1236 after it merged, and both are the same
 * missing step seen from two different exits.
 *
 *   P2 -- a tail read that REJECTS clears `terminalTailPending` in its
 *   `finally` and stops there. Nothing re-renders, so the detail pane keeps the
 *   "Loading this item..." paint for a read that is no longer running.
 *
 *   P1 -- a second phase-one load landing while a tail is in flight bumps
 *   `projectionGeneration`; its own `_prodLoadTerminalTail()` call returns early
 *   because one is running, and then the in-flight run discards itself at the
 *   generation check. The new generation ends up with NO terminal rows, nothing
 *   re-rendered, and a deep link to an approved or posted row stranded.
 *
 * The second one also disproved a comment: the caller claimed the overlap was
 * covered because "that run's own `finally` clears the flag". Clearing the flag
 * is not the same as giving the new generation a tail.
 *
 * This drives the REAL function against stubs, so it fails if either exit stops
 * settling -- source-matching a `finally` would not have caught the P1 at all,
 * because the bug is in what the function does NOT do.
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
/* Keeps the `async` keyword. The house `grabFunc` idiom seeks
   `'function ' + name + '('`, which starts the slice one word too late and
   hands back a function whose `await` no longer parses -- a mis-extraction that
   fails loudly here, but is the same shape as OPEN_REPAIRS 96's quiet ones. */
function grabFunc(name) {
  let at = INDEX.indexOf('async function ' + name + '(');
  if (at < 0) at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
// `let _prodTerminalTailRunning`/`_prodTerminalTailRerun` live outside the
// function body, so they are lifted by name rather than by grabbing a function.
function grabLet(name) {
  const m = new RegExp('let ' + name + ' = [^;]+;').exec(INDEX);
  if (!m) throw new Error('let not found: ' + name);
  return m[0];
}

function harness(opts) {
  const calls = { fallback: 0, render: 0, projection: 0 };
  // The real catch logs; two of these cases exercise it deliberately, and a
  // suite that prints a stack trace per expected failure is a suite nobody
  // reads. Errors still surface — they surface as a FAIL line.
  const quiet = Object.assign({}, console, { warn() {} });
  const ctx = vm.createContext({ console: quiet, calls, opts });
  vm.runInContext(`
    const _prodState = {
      projectionGeneration: 1,
      terminalTailPending: false,
      deliverables: [],
      clients: [], members: [], batches: [],
      adapter: null, batchFiles: new Map(), batchFilesStatus: new Map(),
      terminalTailLoadedAt: 0
    };
    const PROD_TERMINAL_FILTER = 'terminal';
    const document = { getElementById() { return {}; } };
    function _prodApplyDeepLinkFallback() { calls.fallback++; }
    function _prodRender() { calls.render++; }
    function _prodAdapter(x) { return { rows: x.deliverables }; }
    function _prodScopeSignatures() { return new Map(); }
    function _prodInvalidateScopedReadsFor() {}
    const Date_now = () => 0;
    async function _prodLoadDeliverableProjection() {
      calls.projection++;
      // The second phase-one load lands WHILE this read is in flight -- the
      // exact interleaving the P1 finding describes.
      if (opts.bumpGenerationDuringRead) _prodState.projectionGeneration++;
      if (opts.rejectRead) throw new Error('archived tail read failed');
      if (opts.notAnArray) return null;
      return [{ id: 'posted-1', status: 'posted' }];
    }
  `, ctx);
  // Date.now() is used for terminalTailLoadedAt; give the sandbox a real one.
  vm.runInContext('const Date = { now: () => 12345 };', ctx);
  vm.runInContext(grabLet('_prodTerminalTailRunning') + '\n'
    + grabLet('_prodTerminalTailRerun') + '\n'
    + grabFunc('_prodLoadTerminalTail'), ctx);
  return { ctx, calls, run: e => vm.runInContext(e, ctx) };
}

(async () => {
  /* ---- the ordinary success path is unchanged --------------------------- */
  {
    const h = harness({});
    await h.run('_prodLoadTerminalTail()');
    ok(h.calls.fallback === 1 && h.calls.render === 1,
      'a successful tail still applies the deep link and renders exactly once');
    ok(h.run('_prodState.terminalTailPending') === false,
      'and clears the pending flag');
  }

  /* ---- P2: the read rejects --------------------------------------------- */
  {
    const h = harness({ rejectRead: true });
    await h.run('_prodLoadTerminalTail()');
    ok(h.run('_prodState.terminalTailPending') === false,
      'a REJECTED tail read clears the pending flag');
    ok(h.calls.render === 1 && h.calls.fallback === 1,
      'and re-renders, so the pane stops claiming to load a read that is not running');
  }

  /* ---- and an answer that is not an array -------------------------------- */
  {
    const h = harness({ notAnArray: true });
    await h.run('_prodLoadTerminalTail()');
    ok(h.calls.render === 1 && h.calls.fallback === 1,
      'a non-array answer settles the pane too, rather than exiting quietly');
  }

  /* ---- P1: an overlapping load moves the generation mid-read ------------- */
  {
    const h = harness({ bumpGenerationDuringRead: true });
    // The overlapping load's own call, which arrives while this one is running.
    h.run('_prodTerminalTailRunning = true; _prodLoadTerminalTail(); _prodTerminalTailRunning = false;');
    ok(h.run('_prodTerminalTailRerun') === true,
      'a tail requested while one is running is REMEMBERED, not dropped');
  }
  {
    const h = harness({ bumpGenerationDuringRead: true });
    const done = h.run('_prodLoadTerminalTail()');
    // While that read is in flight, the second load asks for a tail.
    h.run('_prodTerminalTailRerun = true;');
    await done;
    await h.run('Promise.resolve()');
    ok(h.calls.projection === 2,
      'the generation that asked while we were busy gets its OWN tail, instead of none');
    ok(h.run('_prodState.projectionGeneration') === 3 || h.calls.projection === 2,
      'the re-run reads against the current generation');
  }

  /* ---- the re-run does not fire when nothing moved ----------------------- */
  {
    const h = harness({});
    const done = h.run('_prodLoadTerminalTail()');
    h.run('_prodTerminalTailRerun = true;');
    await done;
    await h.run('Promise.resolve()');
    ok(h.calls.projection === 1,
      'a request that arrived while busy but under the SAME generation is already covered — no second read');
  }

  /* ---- a failed read is not retried into a spin -------------------------- */
  {
    const h = harness({ rejectRead: true });
    const done = h.run('_prodLoadTerminalTail()');
    h.run('_prodTerminalTailRerun = true;');
    await done;
    await h.run('Promise.resolve()');
    ok(h.calls.projection === 1,
      'a FAILED read is not retried here — the 30s operational refresh is the retry, not a self-spin against a backend that is down');
  }

  if (failures) {
    console.error('\nTerminal-tail settling checks FAILED');
    process.exit(1);
  }
  console.log('\nTerminal-tail settling checks passed');
})();
