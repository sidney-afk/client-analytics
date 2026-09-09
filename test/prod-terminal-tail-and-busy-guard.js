/**
 * The archive stops being re-downloaded, and a background repaint stops
 * interrupting the reader (ledger item 184, 2026-09-09).
 *
 * Two independent rules, both EXECUTED against the shipped source rather than
 * pinned as text.
 *
 * 1. THE FINISHED HALF. `_prodLoadTerminalTail` used to re-read every terminal
 *    row on every full reconcile: measured live on 2026-09-09, 4,098 rows over
 *    five strictly sequential pages, 182 KB compressed per page, about 0.9 MB
 *    and several seconds, six times an hour in an open tab. It now reads only
 *    rows stamped since its own watermark, and takes the full pass on the first
 *    tail of a projection, on anything the reader asked for, and once an hour so
 *    a hard DELETE still converges.
 *
 * 2. THE TICK, WHILE SOMEONE IS TYPING. `_prodRefreshBusy` already deferred a
 *    background tick for an open menu layer and for an in-flight write. It did
 *    NOT defer for a caret in a field, so a tick could land mid-keystroke and
 *    `_prodRender()` would rebuild `#prodRoot` under it, taking the caret and
 *    selection with it. Workload has guarded its search input since it shipped
 *    and Calendar defers on the same condition; this closes the third case.
 *
 *    The guard is deliberately the EXISTING one extended, not a second
 *    mechanism. An earlier draft of this change added a separate deferred
 *    repaint and routed the batch-description arrival through it; that starved
 *    the very paint the description panel was waiting for, because that panel's
 *    editor is focused as a matter of course, and `inplace_link` in the mocked
 *    browser gate caught it twice. A repaint that IS the answer to a read the
 *    visible panel asked for must never be deferred.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// Never hand-roll a block-comment regex over index.html: OPEN_REPAIRS 145.
const { stripComments } = require('./helpers/strip-comments');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function grabFunc(signature) {
  const start = html.indexOf(signature);
  if (start < 0) throw new Error('not found: ' + signature);
  const end = html.indexOf('\n        }', start) + '\n        }'.length;
  return html.slice(start, end);
}
function constNum(decl) {
  const start = html.indexOf(decl);
  if (start < 0) throw new Error('not found: ' + decl);
  return Number(html.slice(start + decl.length, html.indexOf(';', start)).trim());
}

const TERMINAL_FULL_MS = constNum('const PROD_TERMINAL_FULL_MS = ');
const RECONCILE_MS = constNum('const PROD_FULL_RECONCILE_MS = ');

void (async () => {

// ---- 1. the cadence is genuinely slower than the reconcile it left ---------
ok(TERMINAL_FULL_MS > RECONCILE_MS,
  'the full archive pass is rarer than the reconcile (' + TERMINAL_FULL_MS + 'ms vs ' + RECONCILE_MS + 'ms)');

// ---- 2. the watermark reads the FINISHED rows, not the whole projection ----
{
  const sandbox = {
    _prodState: { deliverables: [] },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    "const PROD_CACHE_TERMINAL = ['approved','posted','archived','canceled','cancelled','duplicate'];\n"
    + grabFunc('function _prodCacheIsTerminal(row)') + '\n'
    + grabFunc('function _prodRowUpdatedMs(row)') + '\n'
    + grabFunc('function _prodDeliverableWatermark(rows)') + '\n'
    + grabFunc('function _prodTerminalWatermark()') + '\n',
    sandbox);

  sandbox._prodState.deliverables = [
    { id: 'a', status: 'approved', updated_at: '2026-09-01T00:00:00Z' },
    { id: 'b', status: 'posted',   updated_at: '2026-09-02T00:00:00Z' },
    // The live half moves constantly and must NOT raise the archive watermark:
    // if it did, every terminal row stamped before it would be skipped forever.
    { id: 'c', status: 'in_progress', updated_at: '2026-09-09T00:00:00Z' },
  ];
  const mark = vm.runInContext('_prodTerminalWatermark()', sandbox);
  ok(mark === '2026-09-02T00:00:00Z',
    'the watermark is the newest FINISHED row, not the newest row (' + mark + ')');

  sandbox._prodState.deliverables = [{ id: 'c', status: 'todo', updated_at: '2026-09-09T00:00:00Z' }];
  ok(vm.runInContext('_prodTerminalWatermark()', sandbox) === '',
    'no finished rows yet means no watermark, so the caller must read in full');
}

// ---- 3. the reader itself, executed ---------------------------------------
function makeTail() {
  const calls = [];
  const sandbox = {
    console: { warn() {}, log() {} },
    Date,
    encodeURIComponent,
    Array,
    Set,
    Map,
    Number,
    String,
    document: { getElementById: () => null },
    _prodTerminalTailRunning: false,
    _prodTerminalTailRerun: false,
    _prodState: {
      projectionGeneration: 1,
      deliverables: [],
      terminalTailLoadedAt: 0,
      terminalTailFullAt: 0,
      terminalTailPending: false,
      terminalTailFailed: false,
      batchFilesStatus: new Map(),
      clients: [], members: [], batches: [],
      adapter: {},
    },
    _prodLoadDeliverableProjection: async (filter) => { calls.push(filter); return sandbox.__next || []; },
    _prodScopeSignatures: () => new Map(),
    _prodAdapter: () => ({}),
    _prodInvalidateScopedReadsFor: () => {},
    _prodApplyDeepLinkFallback: () => {},
    _prodRender: () => {},
    __next: [],
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    "const PROD_CACHE_TERMINAL = ['approved','posted','archived','canceled','cancelled','duplicate'];\n"
    + "const PROD_TERMINAL_FILTER = 'status=in.(' + PROD_CACHE_TERMINAL.join(',') + ')';\n"
    + 'const PROD_TERMINAL_FULL_MS = ' + TERMINAL_FULL_MS + ';\n'
    + grabFunc('function _prodCacheIsTerminal(row)') + '\n'
    + grabFunc('function _prodRowUpdatedMs(row)') + '\n'
    + grabFunc('function _prodDeliverableWatermark(rows)') + '\n'
    + grabFunc('function _prodTerminalWatermark()') + '\n'
    + grabFunc('function _prodMergeDeliverableRows(changed)') + '\n'
    + grabFunc('async function _prodLoadTerminalTail(opts)') + '\n',
    sandbox);
  return { sandbox, calls, run: (opts) => vm.runInContext('_prodLoadTerminalTail', sandbox)(opts) };
}

{
  // 3a. The very first tail is a full pass even when nobody asked for one.
  const t = makeTail();
  t.sandbox.__next = [{ id: 'a', status: 'approved', updated_at: '2026-09-01T00:00:00Z' }];
  await t.run({ full: false });
  ok(t.calls.length === 1 && !t.calls[0].includes('updated_at'),
    'the first tail of a projection reads in full, with no watermark');
  ok(t.sandbox._prodState.terminalTailFullAt > 0,
    'a full pass stamps when the archive was last read whole');

  // 3b. The next background pass is watermarked.
  t.sandbox._prodState.terminalTailLoadedAt = Date.now();
  t.sandbox.__next = [];
  await t.run({ full: false });
  ok(t.calls.length === 2 && t.calls[1].includes('updated_at=gte.')
     && t.calls[1].includes(encodeURIComponent('2026-09-01T00:00:00Z')),
    'a later background pass reads only rows stamped since the archive watermark');

  // 3c. Anything the reader asked for still reads the whole archive.
  await t.run({ full: true });
  ok(t.calls.length === 3 && !t.calls[2].includes('updated_at'),
    'an explicit full pass (boot, Refresh) still reads the whole archive');
}

{
  // 3d. An incremental read must REPLACE a row it already holds, not skip it.
  //     The old append-only merge kept only ids it had never seen, which is
  //     right when joining the live half and wrong here: every row this read
  //     returns moved after the copy we hold.
  const t = makeTail();
  t.sandbox._prodState.deliverables = [
    { id: 'a', status: 'approved', updated_at: '2026-09-01T00:00:00Z', title: 'old' },
  ];
  t.sandbox._prodState.terminalTailLoadedAt = Date.now();
  t.sandbox._prodState.terminalTailFullAt = Date.now();
  t.sandbox.__next = [
    { id: 'a', status: 'archived', updated_at: '2026-09-08T00:00:00Z', title: 'new' },
    { id: 'z', status: 'posted', updated_at: '2026-09-08T00:00:00Z', title: 'fresh' },
  ];
  await t.run({ full: false });
  const rows = t.sandbox._prodState.deliverables;
  const a = rows.find(r => r.id === 'a');
  ok(rows.length === 2, 'the incremental merge adds the new row without duplicating the known one');
  ok(a && a.title === 'new' && a.status === 'archived',
    'a finished row that changed is REPLACED, not silently kept at its old value');
}

{
  // 3e. The hourly full pass is what converges a hard delete, so it must
  //     actually fire once the interval has elapsed.
  const t = makeTail();
  t.sandbox._prodState.deliverables = [
    { id: 'a', status: 'approved', updated_at: '2026-09-01T00:00:00Z' },
  ];
  t.sandbox._prodState.terminalTailLoadedAt = Date.now();
  t.sandbox._prodState.terminalTailFullAt = Date.now() - TERMINAL_FULL_MS - 1000;
  t.sandbox.__next = [];
  await t.run({ full: false });
  ok(t.calls.length === 1 && !t.calls[0].includes('updated_at'),
    'once the full interval has elapsed the archive is read whole again');
}

// ---- 4. the caller only asks for the whole archive when someone is waiting -
{
  const loader = html.slice(html.indexOf('async function _prodLoadData(opts)'));
  const call = loader.slice(0, loader.indexOf('\n        }'));
  ok(call.includes('_prodLoadTerminalTail({ full: !silent })'),
    'the loader reads the archive whole only when the load is not silent');
  ok(/const silent = !!\(opts && opts\.silent && _prodState\.loaded\)/.test(html),
    'and `silent` still means a background load, so the ten-minute reconcile is the incremental caller');
}

// ---- 4b. the tick defers; the paint the panel asked for does not ----------
{
  const deltaStart = html.indexOf('async function _prodDeltaRefresh(options)');
  const delta = html.slice(deltaStart, html.indexOf('\n        }\n        let _prodOperationalTimer', deltaStart));
  ok(/if \(!opts\.force && _prodRefreshBusy\(\)\) return null/.test(delta),
    'a background tick still consults the busy guard, and an explicit force still bypasses it');
  ok(/if \(repaint && document\.getElementById\('prodRoot'\)\) _prodRender\(\);/.test(delta),
    'the tick repaints directly once it has decided to run: the deferral is the tick, not the paint');

  /* The expensive half of the lesson, pinned so it is not re-learned: the
     description arrival is the COMPLETION of a read the visible panel asked
     for, and that panel's editor is focused as a matter of course. Deferring it
     means it never lands. */
  const arrival = html.slice(html.indexOf('async function _prodEnsureBatchDescription(batchId, force)'));
  const arrivalBody = stripComments(arrival.slice(0, arrival.indexOf('\n        }')));
  ok(arrivalBody.includes("if (visible && document.getElementById('prodRoot')) _prodRender();"),
    'the description arrival repaints directly: it is the answer the panel is waiting for');
  ok(!/RenderWhenIdle|_prodRefreshBusy/.test(arrivalBody),
    'and it is not routed through any deferral (that starves it while the editor is focused)');
}

// ---- 5. the busy guard, executed ------------------------------------------
function makeBusy() {
  const sandbox = {
    console,
    _prodState: { writes: new Set() },
    document: { activeElement: null, getElementById: () => null },
  };
  vm.createContext(sandbox);
  vm.runInContext(grabFunc('function _prodRefreshBusy()'), sandbox);
  return { sandbox, busy: () => vm.runInContext('_prodRefreshBusy()', sandbox) };
}

{
  const g = makeBusy();
  const root = { contains: (el) => !!(el && el.__inRoot) };
  const layer = { childElementCount: 0 };
  g.sandbox.document.getElementById = (id) => id === 'prodRoot' ? root : (id === 'prodLayer' ? layer : null);

  ok(g.busy() === false, 'an idle board is not busy');

  layer.childElementCount = 1;
  ok(g.busy() === true, 'an open menu, picker or context popover still defers the tick');
  layer.childElementCount = 0;

  g.sandbox._prodState.writes = new Set(['w1']);
  ok(g.busy() === true, 'an in-flight write still defers the tick');
  g.sandbox._prodState.writes = new Set();

  // The case this change adds.
  g.sandbox.document.activeElement = { tagName: 'DIV', isContentEditable: true, __inRoot: true };
  ok(g.busy() === true, 'a caret in the description editor defers the tick');

  g.sandbox.document.activeElement = { tagName: 'INPUT', isContentEditable: false, __inRoot: true };
  ok(g.busy() === true, "a caret in the board's own filter or search input defers the tick");

  g.sandbox.document.activeElement = { tagName: 'TEXTAREA', isContentEditable: false, __inRoot: true };
  ok(g.busy() === true, 'a caret in a textarea on the board defers the tick');

  // Scope: another surface's field must not freeze this board forever.
  g.sandbox.document.activeElement = { tagName: 'INPUT', isContentEditable: false, __inRoot: false };
  ok(g.busy() === false, 'a field focused OUTSIDE the board does not defer the board');

  g.sandbox.document.activeElement = { tagName: 'DIV', isContentEditable: false, __inRoot: true };
  ok(g.busy() === false, 'a merely focused non-editable node is not busy');

  g.sandbox.document.activeElement = null;
  ok(g.busy() === false, 'nothing focused is not busy');
}

console.log(failures ? '\nprod-terminal-tail-and-busy-guard: ' + failures + ' FAILED'
                     : '\nprod-terminal-tail-and-busy-guard: all checks passed');
process.exit(failures ? 1 : 0);
})();
