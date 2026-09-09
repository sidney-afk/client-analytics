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

// ---- 2b. THE CALLER SEQUENCE, which is where the first version broke -------
/* Codex on #1366: `_prodLoadData` replaces `_prodState.deliverables` with the
   LIVE-only read before it calls the tail, so a watermark computed afterwards
   was always '' and the tail silently fell back to reading all 4,098 rows —
   the exact behaviour this change exists to remove. The first version of this
   suite seeded terminal rows straight into the sandbox and so never exercised
   the real order. These checks do. */
{
  const sandbox = { _prodState: { deliverables: [], terminalTailLoadedAt: 0, terminalTailFullAt: 0 }, console, Date, Number, Set, Array, String };
  vm.createContext(sandbox);
  vm.runInContext(
    "const PROD_CACHE_TERMINAL = ['approved','posted','archived','canceled','cancelled','duplicate'];\n"
    + 'const PROD_TERMINAL_FULL_MS = ' + TERMINAL_FULL_MS + ';\n'
    + grabFunc('function _prodCacheIsTerminal(row)') + '\n'
    + grabFunc('function _prodRowUpdatedMs(row)') + '\n'
    + grabFunc('function _prodDeliverableWatermark(rows)') + '\n'
    + grabFunc('function _prodTerminalWatermark()') + '\n'
    + grabFunc('function _prodTerminalTailFullDue(silent)') + '\n'
    + grabFunc('function _prodCarryTerminalRows(live, previous)') + '\n',
    sandbox);
  const carry = vm.runInContext('_prodCarryTerminalRows', sandbox);
  const fullDue = vm.runInContext('_prodTerminalTailFullDue', sandbox);

  const previous = [
    { id: 'live1', status: 'todo', updated_at: '2026-09-09T00:00:00Z' },
    { id: 'arch1', status: 'approved', updated_at: '2026-09-01T00:00:00Z' },
    { id: 'arch2', status: 'posted', updated_at: '2026-09-02T00:00:00Z' },
  ];
  const freshLive = [{ id: 'live1', status: 'in_progress', updated_at: '2026-09-09T12:00:00Z' }];

  const carried = carry(freshLive, previous);
  ok(carried.length === 3, 'phase one keeps the archive alongside the fresh live half');
  ok(!carried.some(r => r.id === 'live1' && r.status === 'todo'),
    'and the stale live row is not carried, only finished rows are');

  // The property Codex's finding is about.
  sandbox._prodState.deliverables = carried;
  ok(vm.runInContext('_prodTerminalWatermark()', sandbox) === '2026-09-02T00:00:00Z',
    'so the archive watermark still exists AFTER the phase-one replacement (the defect: it was empty)');

  sandbox._prodState.deliverables = freshLive;
  ok(vm.runInContext('_prodTerminalWatermark()', sandbox) === '',
    'without the carry the watermark is empty, which is exactly what silently forced a full read');

  // A row leaving a terminal status: the live half is the fresher copy.
  const reopened = carry(
    [{ id: 'arch1', status: 'in_progress', updated_at: '2026-09-09T12:00:00Z' }],
    previous);
  ok(reopened.filter(r => r.id === 'arch1').length === 1
     && reopened.find(r => r.id === 'arch1').status === 'in_progress',
    'a row that just left the archive is not duplicated, and the live copy wins');

  ok(carry(freshLive, []).length === 1, 'nothing to carry leaves the live half untouched');

  // The decision that drives the carry.
  const now = Date.now();
  sandbox._prodState.terminalTailLoadedAt = now;
  sandbox._prodState.terminalTailFullAt = now;
  ok(fullDue(false) === true, 'a load nobody asked to be silent (boot, Refresh) takes the full archive');
  ok(fullDue(true) === false, 'a silent reconcile with a recent full pass goes incremental');
  sandbox._prodState.terminalTailLoadedAt = 0;
  ok(fullDue(true) === true, 'a silent reconcile with no archive yet still takes the full pass');
  sandbox._prodState.terminalTailLoadedAt = now;
  sandbox._prodState.terminalTailFullAt = now - TERMINAL_FULL_MS - 1000;
  ok(fullDue(true) === true, 'and once the hourly interval has elapsed, so a hard delete converges');
}

// ---- 2c. the order in the loader, pinned ----------------------------------
{
  const loader = html.slice(html.indexOf('async function _prodLoadData(opts)'));
  const body = loader.slice(0, loader.indexOf('\n        }'));
  const decidedAt = body.indexOf('const tailFull = _prodTerminalTailFullDue(silent)');
  const carriedAt = body.indexOf('_prodCarryTerminalRows(');
  const replacedAt = body.indexOf('_prodState.deliverables = mergedDeliverables');
  ok(decidedAt > 0 && carriedAt > 0 && replacedAt > 0,
    'the loader decides, carries, and then replaces');
  ok(decidedAt < replacedAt && carriedAt < replacedAt,
    'the decision and the carry both happen BEFORE the projection is replaced — reversing this is the defect');
  ok(body.includes('_prodLoadTerminalTail({ full: tailFull })'),
    'and the tail is handed the same decision rather than re-deriving it');
}

// ---- 2d. a late tail must not revert a row that moved on -------------------
/* Codex on #1366, second finding: `_prodMergeDeliverableRows` replaces on any
   timestamp DIFFERENCE, not only a newer one. Safe for the delta, whose
   watermark is the whole projection's max; unsafe here, where the watermark is
   the archive's and the read spans seconds. The case that bites is a row
   LEAVING the archive mid-read. */
{
  const sandbox = { console, Map, Array, Number, String, Date };
  vm.createContext(sandbox);
  vm.runInContext(
    grabFunc('function _prodRowUpdatedMs(row)') + '\n'
    + grabFunc('function _prodDropSupersededRows(rows, previous)') + '\n',
    sandbox);
  const drop = vm.runInContext('_prodDropSupersededRows', sandbox);

  const held = [
    { id: 'a', status: 'in_progress', updated_at: '2026-09-09T12:00:00Z' },
    { id: 'b', status: 'approved', updated_at: '2026-09-01T00:00:00Z' },
  ];
  const late = [
    // Selected as approved before the write that reopened it.
    { id: 'a', status: 'approved', updated_at: '2026-09-08T00:00:00Z' },
    // Genuinely newer than the copy held.
    { id: 'b', status: 'archived', updated_at: '2026-09-09T09:00:00Z' },
    { id: 'c', status: 'posted', updated_at: '2026-09-05T00:00:00Z' },
  ];
  const kept = drop(late, held);
  ok(!kept.some(row => row.id === 'a'),
    'a tail row older than the copy held is dropped, so a reopened row is not reverted');
  ok(kept.some(row => row.id === 'b' && row.status === 'archived'),
    'a genuinely newer tail row still lands');
  ok(kept.some(row => row.id === 'c'),
    'a row not held at all is always kept');

  ok(drop([{ id: 'a', status: 'approved', updated_at: '2026-09-09T12:00:00Z' }], held).length === 1,
    'an identical stamp is kept, so a same-second echo is not mistaken for a stale one');
  ok(drop([{ id: 'a', status: 'approved' }], [{ id: 'a', status: 'x' }]).length === 1,
    'a row with no parseable stamp on either side is kept: absence of proof is not proof');
  ok(drop([], held).length === 0 && drop(null, held).length === 0,
    'an empty or missing response is handled without throwing');
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
    + grabFunc('function _prodDropSupersededRows(rows, previous)') + '\n'
    + grabFunc('async function _prodLoadTerminalTail(opts)') + '\n',
    sandbox);
  return { sandbox, calls, run: (opts) => vm.runInContext('_prodLoadTerminalTail', sandbox)(opts) };
}

{
  // 3a. With nothing held, an incremental request still reads in full: there
  //     is no stamp to be relative to, and a watermarked read would leave the
  //     archive empty rather than merely stale.
  const t = makeTail();
  t.sandbox.__next = [{ id: 'a', status: 'approved', updated_at: '2026-09-01T00:00:00Z' }];
  await t.run({ full: false });
  ok(t.calls.length === 1 && !t.calls[0].includes('updated_at'),
    'an empty watermark falls back to the full read rather than emptying the archive');
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
  t.sandbox.__next = [];
  await t.run({ full: true });
  ok(t.calls.length === 1 && !t.calls[0].includes('updated_at'),
    'the hourly full pass, once the caller asks for it, reads the archive whole again');
}

// ---- 4. the caller only asks for the whole archive when someone is waiting -
{
  const loader = html.slice(html.indexOf('async function _prodLoadData(opts)'));
  const call = loader.slice(0, loader.indexOf('\n        }'));
  ok(call.includes('_prodLoadTerminalTail({ full: tailFull })'),
    'the loader hands the tail the decision it made before replacing the projection');
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
