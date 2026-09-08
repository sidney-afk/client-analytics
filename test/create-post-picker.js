'use strict';

/*
 * create-post-picker.js — behavioral contract for the Create Post batch
 * picker presentation (owner-approved redesign, 2026-08-14).
 *
 * The dialog's WRITE path is pinned elsewhere (native-intake-ui-source.js,
 * prod-write-gateway-browser.js); this suite renders the real picker in a VM
 * and asserts what a reader sees. Round 2 (owner pick 2026-08-18, option E):
 *   - the post shape is a segmented toggle, Video + Thumbnail by default;
 *   - Start a new batch is the FIRST card and the DEFAULT choice;
 *   - every compatible batch lives in ONE previous-batch card whose dropdown
 *     is always visible with the last batch preselected; touching the
 *     dropdown selects the card;
 *   - dropdown rows are titled by the batch NAME with count + short start
 *     date, the created time added only when two offered rows share a name;
 *   - mode-incompatible batches are NOT RENDERED AT ALL (owner: "the batches
 *     that can't hold this post I prefer not to show");
 *   - Linear identifier ranges NEVER reach the rendered HTML, even when the
 *     fixture data carries identifiers that would tempt it;
 *   - an empty compatible batch reads "Empty batch";
 *   - parentless orphan batches (2026-08-07 outage, OPEN_REPAIRS items 1-2)
 *     are excluded from BOTH lists;
 *   - a failed or slow post-count read degrades the subtext to the start
 *     date alone and never blocks the dialog.
 *
 * Fixtures are neutral placeholders ("Client A · 7 Aug 2026") — never real
 * client names or slugs (public repo, rule F64).
 */

process.env.TZ = 'UTC';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Quote- and comment-aware extractor (workload-linear-browser.js pattern).
// Not regex-literal-aware, so _calEsc/_calEscAttr use extractRaw below.
function extractConstBlock(decl, endsWith) {
  const start = source.indexOf(decl);
  assert(start >= 0, 'missing const ' + decl);
  const end = source.indexOf(endsWith, start);
  assert(end > start, 'unterminated const ' + decl);
  return source.slice(start, end + endsWith.length);
}
function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  assert(start >= 0, 'missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let index = brace; index < source.length; index++) {
    const ch = source[index], next = source[index + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { lineComment = true; index++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; index++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('unclosed ' + name);
}

// Raw brace counter for one-liners whose regex literals contain quote
// characters (they would desynchronise the quote-aware walker above).
function extractRaw(name) {
  let at = source.indexOf('function ' + name + '(');
  assert(at >= 0, 'missing ' + name);
  let depth = 0;
  for (let index = source.indexOf('{', at); index < source.length; index++) {
    const ch = source[index];
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(at, index + 1);
  }
  throw new Error('unclosed ' + name);
}

const PICKER_SOURCES = [
  // Added 2026-08-19: the dialog now serves both the Calendar and the Samples
  // tab, so it resolves "which view is on screen" and "which batches to ask
  // for" through these two helpers rather than assuming the calendar. Both
  // guard their globals with typeof, so a context without sxrState is fine.
  extract('_nativePostViewSlug'),
  extract('_nativePostPurpose'),
  extractRaw('_calEsc'),
  extractRaw('_calEscAttr'),
  extract('_linearIntakeBatchTitle'),
  extract('_calNativeBatchStartMeta'),
  extract('_calNativeBatchDisplayName'),
  // Added 2026-08-20: batch compatibility now reads the batch's PARENT map
  // (which teams it can actually file under) rather than only its team
  // column, so the mode->teams table and the parent-team reader join the
  // harness scope. A free identifier here would break every world below.
  extractConstBlock('const CAL_NATIVE_MODE_TEAMS = {', '};'),
  /* Added 2026-08-20: the dialog renders a post-count input, so the render
     function now reads the count helpers. Same trap as the line above -- a
     free identifier here is a ReferenceError that takes out every world in
     this file, which is exactly how it announced itself. */
  extractConstBlock('const CAL_NATIVE_MAX_INTAKE_ITEMS =', ';'),
  /* The editor picker's own constants. Missing, the pool race throws a
     ReferenceError that the dialog swallows into its unavailable state --
     which looks exactly like a legitimately empty pool. */
  extractConstBlock('const CAL_NATIVE_LIVE_VIDEO_STATUSES =', ';'),
  extractConstBlock('const CAL_NATIVE_EDITOR_POOL_TIMEOUT_MS =', ';'),
  /* 2026-08-26: the batch dropdown grew a name filter, shown only once the
     list is long enough to be worth searching. The render reads this
     threshold, so leaving it out throws a ReferenceError before a single
     assertion runs — which is how it announced itself. */
  extractConstBlock('const CAL_NATIVE_BATCH_FILTER_MIN =', ';'),
  // Post naming (2026-09-07): read from index.html rather than restated,
  // so the separator this suite asserts is the one the app actually uses.
  extractConstBlock('const CAL_NATIVE_TITLE_SEPARATOR =', ';'),
  extractConstBlock('const CAL_NATIVE_NAME_MAX =', ';'),
  /* 2026-08-26: "How many posts?" stopped being a hand-rolled stepper and
     became the shared `sv-stepper` primitive, so the render now calls
     _svStepperHtml and that pulls in its two attribute escapers. Same trap as
     every line above -- a free identifier here is a ReferenceError before a
     single assertion runs. Its two escapers, _ptoAttr and _jsAttrArg, are
     already stubbed further down this list and those stubs deliberately win. */
  extract('_svStepperHtml'),
  extract('_calNativePostTeamsPer'),
  extract('_calNativePostCountMax'),
  extract('_calNativePostCount'),
  extract('_calNativePostCountHint'),
  extract('_calNativeBatchParentTeams'),
  extract('_calNativeBatchCompatible'),
  extract('_calNativeBatchHasLinearParents'),
  extract('_calNativeBatchLists'),
  /* The render applies the saved filter itself since 2026-09-08, so the
     matcher is no longer only the live filter's business. */
  extract('_calNativeBatchMatches'),
  /* 2026-08-24: the dialog renders a video-editor picker, so the render
     function now reads its disclaimer helper. Same trap as the lines above --
     a free identifier here is a ReferenceError that takes out every world in
     this file, which is exactly how it announced itself. */
  /* The editor picker is built on the shared sv-select primitive (2026-08-24),
     so the render function reaches for it and its tone helper too. */
  /* sv-select's own string helpers are supplied rather than extracted: the
     brace matcher overruns _ptoEsc's escape-map literal and swallows unrelated
     code. They are pure and three lines each, so faithful copies are stabler
     here than a slice that can silently take the wrong bytes. The icon
     constants are inert markup this test never asserts on. */
  "function _ptoEsc(v){return String(v==null?'':v).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));}",
  'function _ptoAttr(v){ return _ptoEsc(v); }',
  'function _jsAttrArg(v){ return _ptoEsc(JSON.stringify(String(v == null ? \'\' : v))); }',
  "const SV_ICON_CHEV = '';",
  "const SV_ICON_CHECK = '';",
  'function _svSelectPick(){}',
  'function _svSelectKeydown(){}',
  'function _svSelectToggle(){}',
  extract('_svTone'),
  extract('_svSelectHtml'),
  // Post/batch naming (2026-09-07). The renderer calls all four, so the vm
  // needs them or every picker assertion fails on a ReferenceError instead of
  // on what it is actually checking.
  extract('_calNativeCleanName'),
  extract('_calNativePostNamesFor'),
  extract('_calNativeBatchNameFor'),
  extract('_calNativePostNameHint'),
  extract('_calNativePostNamesHtml'),
  /* The receipt (2026-09-08, option A). The renderer calls it inline, so every
     helper it reaches has to be here too or the ReferenceError lands before a
     single batch assertion runs -- the same trap the notes above describe. */
  "const CAL_NATIVE_RECEIPT_ROWS = 8;",
  extract('_calNativeTitleOrdinal'),
  extract('_calNativeBatchMaxOrdinal'),
  extract('_calNativeBatchById'),
  extract('_calNativeReceiptHtml'),
  extract('_calNativeSyncReceipt'),
  extract('_calRenderNativePostChoice'),
  extract('_calNativePrevBatchPick'),
].join('\n');

// Parent identifiers deliberately present in the fixture data: the picker
// must never surface them (the owner rejected identifier ranges outright).
const TEMPTING_PARENTS = {
  video: { uuid: 'lin-parent-vid', identifier: 'VID-1200', url: 'https://linear.example/VID-1200' },
  graphics: { uuid: 'lin-parent-gra', identifier: 'GRA-3400', url: 'https://linear.example/GRA-3400' },
};

function batchFixture(overrides) {
  return {
    id: 'bat-fixture', client_slug: 'client-a', team: null,
    name: 'Client A · 7 Aug 2026', status: 'active',
    created_at: '2026-08-07T09:30:00.000Z', updated_at: '2026-08-07T09:30:00.000Z',
    linear_parent_ids: TEMPTING_PARENTS,
    ...overrides,
  };
}

function renderPicker(options, countEntries, clientName = 'Client A', stateExtra = null) {
  const modal = { innerHTML: '' };
  const context = {
    console,
    document: {
      querySelector: selector => selector === '#calNativePostOverlay .cal-import-modal' ? modal : null,
    },
  };
  vm.createContext(context);
  vm.runInContext(PICKER_SOURCES, context);
  context.__options = options;
  context.__countEntries = countEntries === null ? null : countEntries;
  context.__stateExtra = stateExtra || {};
  vm.runInContext([
    '_calNativePostState = Object.assign({',
    "  clientName: " + JSON.stringify(clientName) + ",",
    "  clientSlug: 'client-a',",
    '  batchOptions: __options,',
    '  batchPostCounts: __countEntries === null ? null : new Map(__countEntries)',
    '}, __stateExtra);',
    '_calRenderNativePostChoice();',
  ].join('\n'), context);
  return modal.innerHTML;
}

/* The mode toggle renders first; batch assertions read only the batch
   radiogroup so its cards keep stable indexes. */
function batchSection(html) {
  const at = html.indexOf('aria-label="Choose a batch"');
  return at >= 0 ? html.slice(at) : html;
}

function titlesOf(html) {
  return [...html.matchAll(/cal-native-batch-title">([^<]*)</g)].map(m => m[1]);
}
/* Scoped to the BATCH select since 2026-08-24: the dialog gained a second
   select (the video-editor picker), and an unscoped sweep silently started
   returning that one's options first — every batch assertion below would have
   been reading the wrong control while still looking like it passed. */
/* ONLY THE CHOSEN BRANCH RENDERS ITS CONTROLS since 2026-09-08 (option A), so
   any assertion about the batch DROPDOWN must render with that tab selected.
   The id is discovered rather than assumed: which batch is compatible depends
   on the post shape, so a hard-coded one would silently fall back to the
   new-batch tab and take the dropdown with it. */
function renderPrev(options, countEntries, clientName = 'Client A', stateExtra = null) {
  const ids = (options || []).map(batch => String(batch && batch.id || ''));
  for (const id of ids) {
    const html = renderPicker(options, countEntries, clientName,
      Object.assign({ batchChoice: { value: 'batch', batchId: id } }, stateExtra || {}));
    if (/cal-native-batch-select/.test(html)) return html;
  }
  return renderPicker(options, countEntries, clientName, stateExtra);
}

function optionsOf(html) {
  const start = html.indexOf('cal-native-batch-select');
  const scope = start < 0 ? '' : html.slice(start, html.indexOf('</select>', start));
  return [...scope.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(m => m[1]);
}

let pass = 0;
function ok(cond, label) {
  assert(cond, label);
  pass++;
  console.log('  ok  ' + label);
}

// ---------------------------------------------------------------------------
console.log('1) toggle first; new batch is the first, default card; the dropdown holds the batches');
{
  const html = renderPicker([
    batchFixture({ id: 'bat-a', name: 'Client A · 7 Aug 2026' }),
    batchFixture({ id: 'bat-orphan', name: 'Client A · 1 Aug 2026', created_at: '2026-08-01T10:00:00.000Z', linear_parent_ids: null }),
    /* Incompatible because of their PARENTS, not their stamp (2026-08-26). The
       team column stopped deciding this — it describes a batch's existing
       children, not the teams it can file — so a stamped batch with both
       parents recorded is now offered, correctly. What is still hidden from a
       Video + Thumbnail post is a batch with no parent for one of the lanes,
       which is the real population these fixtures now represent: 127 of the
       143 stamped rows live were exactly this shape. */
    batchFixture({ id: 'bat-vid', name: 'Client A video work', team: 'video', created_at: '2026-08-05T08:00:00.000Z',
      linear_parent_ids: { video: TEMPTING_PARENTS.video } }),
    batchFixture({ id: 'bat-gra', name: 'Client A graphics work', team: 'graphics', created_at: '2026-08-03T08:00:00.000Z',
      linear_parent_ids: { graphics: TEMPTING_PARENTS.graphics } }),
  ], [['bat-a', 4]]);

  const modeBlock = html.slice(0, html.indexOf('aria-label="Choose a batch"'));
  ok(modeBlock.includes('class="cal-native-mode-toggle"')
    && [...modeBlock.matchAll(/<span>([^<]*)<\/span>/g)].map(m => m[1]).join('|') === 'Video + Thumbnail|Video only|Thumbnail only',
    'the post-shape toggle renders its three modes first');
  ok(/value="both" checked/.test(modeBlock) && !/value="video" checked/.test(modeBlock) && !/value="thumbnail" checked/.test(modeBlock),
    'Video + Thumbnail is the default shape');
  const batches = batchSection(html);
  ok(titlesOf(batches)[0] === 'Start a new batch' && /value="new" checked/.test(batches),
    'Start a new batch is the first card and the default choice');
  const generated = 'Client A · ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  /* THE GENERATED NAME IS THE FIELD'S VALUE, NOT ITS PLACEHOLDER (owner,
     2026-09-08: "it should be clear that we can change the name"). A greyed
     placeholder read as a system-issued value rather than an editable one, so
     the default is now real text you can select and type over. The placeholder
     stays as the fallback for a field somebody empties. */
  ok(new RegExp('id="calNativeBatchName"[^>]*value="' + generated + '"').test(html),
    'the generated batch name is PREFILLED as the value, so it reads as editable');
  ok(new RegExp('id="calNativeBatchName"[^>]*placeholder="' + generated + '"').test(html),
    'and remains the placeholder, so clearing the field still lands on the default');
  ok(!/adds this post to it/.test(html),
    'the old quoted subtext is gone — the receipt below states the parent instead');
  ok(titlesOf(batches)[1] === 'Add to a previous batch', 'the second tab is the previous-batch tab');
  ok(/id="calNativePrevBatchRadio"[^>]*data-batch-id="bat-a"/.test(batches)
    && !/id="calNativePrevBatchRadio"[^>]* checked/.test(batches),
    'the previous-batch radio carries the last batch id but starts unchecked');
  /* ONLY THE CHOSEN BRANCH RENDERS ITS CONTROLS (2026-09-08, option A). Both
     used to sit open at once. So the dropdown assertions below need the
     previous-batch tab actually selected -- and the check that it is ABSENT
     under the other tab is the point of the change. */
  ok(!/cal-native-batch-select/.test(batches),
    'the batch dropdown is not rendered while Start a new batch is the chosen tab');
  const prevHtml = batchSection(renderPicker([
    batchFixture({ id: 'bat-a', name: 'Client A · 7 Aug 2026' }),
  ], [['bat-a', 4]], 'Client A', { batchChoice: { value: 'batch', batchId: 'bat-a' } }));
  ok(optionsOf(prevHtml).join('|') === 'Client A · 7 Aug 2026 — last batch · 4 posts · started 7 Aug',
    'the dropdown row is the batch name plus last-batch label, count, and short start date');
  ok(/onmousedown="_calNativePrevBatchPick\(this, true\)"/.test(prevHtml)
    && /onchange="_calNativePrevBatchPick\(this, true\)"/.test(prevHtml),
    'touching the dropdown selects the previous-batch tab');
  ok(!/id="calNativeBatchName"/.test(prevHtml),
    'and the new-batch name field is not rendered under that tab');
  ok(!/started 7 Aug,/.test(html), 'a unique display name carries no time of day');
  ok(!/VID-\d|GRA-\d/.test(html), 'Linear identifier ranges never reach the HTML despite tempting fixture identifiers');
  ok(!html.includes('bat-orphan') && !html.includes('Client A · 1 Aug 2026'),
    'a parentless orphan batch is excluded from the dropdown');
  ok(!html.includes('Client A video work') && !html.includes('Client A graphics work'),
    'a batch with no parent for one of the lanes is not rendered at all');
  ok(!html.includes('is-incompatible') && !html.includes('cal-native-batch-unavailable') && !html.includes('<details'),
    'the old disabled rows and disclosure are gone entirely');
  ok(!html.includes('Add to existing batch'), 'the old prefix phrase is gone');
}

// ---------------------------------------------------------------------------
console.log('2) empty compatible batch reads Empty batch');
{
  const html = renderPrev([batchFixture({ id: 'bat-a' })], [['bat-a', 0]]);
  ok(optionsOf(html)[0] === 'Client A · 7 Aug 2026 — last batch · Empty batch · started 7 Aug',
    'zero posts renders the Empty batch wording');
  ok(!html.includes('0 posts'), 'zero is never spelled as a count');
}

// ---------------------------------------------------------------------------
console.log('3) duplicate display names pull the created time into every twin');
{
  const html = renderPrev([
    batchFixture({ id: 'bat-a', name: 'Client A · 7 Aug 2026', created_at: '2026-08-07T09:30:00.000Z' }),
    batchFixture({ id: 'bat-b', name: 'Client A · 7 Aug 2026', created_at: '2026-08-07T14:05:00.000Z' }),
    batchFixture({ id: 'bat-c', name: 'Client A extras', created_at: '2026-08-06T10:00:00.000Z' }),
  ], [['bat-a', 4], ['bat-b', 1], ['bat-c', 2]]);
  const options = optionsOf(html);
  ok(options[0] === 'Client A · 7 Aug 2026 — last batch · 4 posts · started 7 Aug, 09:30', 'first twin appends its created time');
  ok(options[1] === 'Client A · 7 Aug 2026 — 1 post · started 7 Aug, 14:05', 'second twin appends its created time (and 1 post is singular)');
  ok(options[2] === 'Client A extras — 2 posts · started 6 Aug', 'a uniquely named row keeps the date alone');
}

// ---------------------------------------------------------------------------
console.log('4) counts-fetch failure degrades the subtext to the start date only');
{
  const html = renderPrev([batchFixture({ id: 'bat-a' })], null);
  ok(optionsOf(html)[0] === 'Client A · 7 Aug 2026 — last batch · started 7 Aug', 'no counts map -> date-only subtext');
  ok(!/\d posts/.test(optionsOf(html)[0]) && !html.includes('Empty batch'), 'no invented counts when the read failed');
}

// ---------------------------------------------------------------------------
console.log('5) orphan-only options leave just the checked new-batch card');
{
  const html = renderPicker([
    batchFixture({ id: 'bat-orphan-1', name: 'Client A · 2 Aug 2026', linear_parent_ids: null }),
    batchFixture({ id: 'bat-orphan-2', name: 'Client A · 3 Aug 2026', linear_parent_ids: {} }),
    /* Incompatible by its PARENTS, not its stamp — see the note in case 1. */
    batchFixture({ id: 'bat-vid', name: 'Client A video work', team: 'video', created_at: '2026-08-05T08:00:00.000Z',
      linear_parent_ids: { video: TEMPTING_PARENTS.video } }),
  ], []);
  ok(!html.includes('bat-orphan-1') && !html.includes('bat-orphan-2'),
    'null and empty-object linear_parent_ids are both excluded from every list');
  ok(/value="new" checked/.test(html), 'with no eligible compatible batch the new-batch card is preselected');
  ok(!html.includes('Add to a previous batch') && !html.includes('cal-native-batch-select'),
    'with nothing to offer, the previous-batch card is not rendered');
}

// ---------------------------------------------------------------------------
console.log('6) the post-count read is one bounded projection query that counts cards, not rows');
(async () => {
  const context = { console };
  vm.createContext(context);
  /* Takes the BATCH ROWS now, not their ids (2026-08-27): the count has to
     know which uuids each batch records as a parent, and those rows already
     carry the map -- passing ids would force a second read to learn it. */
  vm.runInContext(extract('_calNativeParentUuids'), context);
  /* The counter also reads each batch's highest ordinal now (2026-09-08), for
     the Create Post receipt's append preview. */
  vm.runInContext((source.match(/const CAL_NATIVE_ORDINAL_RE = [^;]+;/) || [''])[0], context);
  vm.runInContext(extract('_calNativeTitleOrdinal'), context);
  vm.runInContext(extract('_calFetchNativeBatchPostCounts'), context);
  vm.runInContext([
    'restCalls = [];',
    'async function _prodRestRows(table, select, params, pageSize, maxPages) {',
    '  restCalls.push({ table: table, select: select, params: params, pageSize: pageSize, maxPages: maxPages });',
    '  return [',
    "    { batch_id: 'bat-a', card_id: 'card-1', id: 'd1', linear_issue_uuid: 'v1' },",
    "    { batch_id: 'bat-a', card_id: 'card-1', id: 'd2', linear_issue_uuid: 'g1' },",
    "    { batch_id: 'bat-a', card_id: 'card-2', id: 'd3', linear_issue_uuid: 'v2' },",
    "    { batch_id: 'bat-b', card_id: '', id: 'd4', linear_issue_uuid: 'v3' },",
    "    { batch_id: 'bat-b', card_id: null, id: 'd5', linear_issue_uuid: 'v4' },",
    /* bat-c holds NOTHING but its own imported parent row. Before this was
       excluded it counted as one post, so the empty-batch ranking never sank
       it -- 60 live batches were in exactly this state on 2026-08-27. */
    "    { batch_id: 'bat-c', card_id: '', id: 'd6', linear_issue_uuid: 'parent-c' },",
    '  ];',
    '}',
  ].join('\n'), context);
  const { counts } = await vm.runInContext(
    "_calFetchNativeBatchPostCounts(["
    + "{ id: 'bat-a' }, { id: 'bat-b' },"
    + " { id: 'bat-c', linear_parent_ids: { video: { uuid: 'parent-c' }, graphics: { uuid: 'parent-c' } } },"
    + " { id: 'bat-a' }])", context);
  const calls = context.restCalls;
  ok(calls.length === 1, 'exactly one extra REST query fetches every shown count');
  ok(calls[0].table === 'production_deliverables_browser_v1', 'counts come from the browser-safe deliverables projection');
  /* `title` joined the projection on 2026-09-08 and is the ONE addition: the
     ordinal an append allocates from is recorded nowhere else -- there is no
     column for it -- so the Create Post receipt reads it back out of the title
     on rows this query already fetches, rather than paying a second round
     trip. Still no brief, no status, no assignee. */
  ok(calls[0].select === 'batch_id,card_id,id,linear_issue_uuid,title',
    'the projection reads only what counting and the ordinal preview need, plus the uuid that tells a parent apart');
  ok(/^batch_id=in\.\(/.test(calls[0].params) && decodeURIComponent(calls[0].params).includes('"bat-a","bat-b","bat-c"'),
    'the query filters to the deduplicated shown batches');
  ok(calls[0].maxPages === 1 && calls[0].pageSize === 1000, 'the read is bounded to one page');
  ok(counts.get('bat-a') === 2, 'a paired Video + Graphics post sharing one card counts once');
  ok(counts.get('bat-b') === 2, 'cardless rows each count alone');
  ok(counts.get('bat-c') === 0, 'a batch holding only its own parent row counts ZERO, so the Empty batch wording is told the truth');

  // -------------------------------------------------------------------------
  console.log('7) the open flow never blocks on the counts read: failure and stall both degrade');
  for (const stall of [false, true]) {
    const modal = { innerHTML: '' };
    const overlayStub = {};
    const context2 = {
      console,
      setTimeout, clearTimeout,
      CAL_NATIVE_BATCH_COUNT_TIMEOUT_MS: 25,
      calState: { client: 'Client A' },
      calClientSlug: name => String(name || '').trim() ? 'client-a' : '',
      showNotify: () => {},
      _syncviewRequireStaffIdentity: async () => ({ role: 'admin' }),
      _calCloseNativePost: () => {},
      _calLatestNativeBatches: async () => [batchFixture({ id: 'bat-a' })],
      _calFetchNativeBatchPostCounts: stall
        ? (() => new Promise(() => {}))
        : (async () => { throw new Error('counts read down'); }),
      /* The editor pool is loaded alongside the batch options and must never
         gate the dialog either. Resolved in one world, rejected in the other,
         so both the populated picker and its degraded state are exercised. */
      _calNativeVideoEditorPool: stall
        ? (async () => { throw new Error('editor pool down'); })
        : (async () => ([
            { id: 'ed-free', name: 'Free Editor', openCount: 1 },
            { id: 'ed-busy', name: 'Busy Editor', openCount: 9 },
          ])),
      document: {
        createElement: () => overlayStub,
        body: { appendChild: () => {}, classList: { add: () => {}, remove: () => {} } },
        querySelector: selector => selector === '#calNativePostOverlay .cal-import-modal' ? modal : null,
        getElementById: () => null,
      },
    };
    vm.createContext(context2);
    vm.runInContext(PICKER_SOURCES + '\n' + extract('_calOpenNativePost'), context2);
    await vm.runInContext("_calOpenNativePost('Client A', 'client-a')", context2);
    /* The editor pool resolves on its own promise chain (raced against a
       timeout), so it lands a tick after the open flow returns and re-renders
       the dialog. Drain the queue before asserting -- the first paint is
       deliberately the disabled "checking workloads" state. */
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));
    /* The dropdown now lives behind the previous-batch tab (2026-09-08), and
       this world opens on the new-batch one, so the check is what it was
       always really about: a counts read that fails or stalls must still
       produce a working dialog, and must never invent a count. */
    ok(/cal-native-batch-tabs/.test(modal.innerHTML)
      && /Add to a previous batch/.test(modal.innerHTML),
      (stall ? 'a stalled' : 'a failing') + ' counts read still renders the whole picker');
    ok(!/\d+ posts/.test(modal.innerHTML) && !/Empty batch/.test(modal.innerHTML),
      'and no count is invented for a read that never landed');
    ok(/value="new" checked/.test(modal.innerHTML), 'the degraded dialog still defaults to Start a new batch');
    if (stall) {
      ok(/assigned automatically/i.test(modal.innerHTML),
        'a failed editor-pool read leaves Create Post working and says the editor is assigned automatically');
    } else {
      ok(/Free Editor/.test(modal.innerHTML) && /\(suggested\)/.test(modal.innerHTML),
        'the editor with the fewest open videos is the suggested default');
      ok(modal.innerHTML.indexOf('Free Editor') < modal.innerHTML.indexOf('Busy Editor'),
        'and the pool is ordered freest-first');
      /* The explanatory paragraph under the picker was removed on 2026-09-08
         at the owner's request. What it carried is not lost: the OPTION itself
         still names the open count and marks the suggestion, which is where
         these two now assert it. */
      ok(!/cal-native-editor-hint/.test(modal.innerHTML),
        'no explanatory paragraph under the picker');
      ok(/1 open video/.test(modal.innerHTML),
        'the option itself still carries the number the suggestion is based on, singular for one');
      ok(/\(suggested\)/.test(modal.innerHTML),
        'and still marks which one is suggested, so the default is never unexplained');
    }
  }

  // -------------------------------------------------------------------------
  console.log('8) the post-shape choice re-scopes compatibility and keeps the chosen batch');
  {
    const options = [
      batchFixture({ id: 'bat-a', name: 'Client A · 7 Aug 2026' }),
      /* Named for what they can FILE, and now shaped that way: a single-team
         parent map. Before 2026-08-26 the team stamp alone made them
         single-team, which is the rule that hid 143 live batches from a mixed
         post; the parents are what decides now. */
      batchFixture({ id: 'bat-vid', name: 'Client A video work', team: 'video', created_at: '2026-08-05T08:00:00.000Z',
        linear_parent_ids: { video: TEMPTING_PARENTS.video } }),
      batchFixture({ id: 'bat-gra', name: 'Client A graphics work', team: 'graphics', created_at: '2026-08-03T08:00:00.000Z',
        linear_parent_ids: { graphics: TEMPTING_PARENTS.graphics } }),
    ];
    const thumbHtml = renderPrev(options, [['bat-a', 4]], 'Client A', { mode: 'thumbnail' });
    ok(/value="thumbnail" checked/.test(thumbHtml.slice(0, thumbHtml.indexOf('aria-label="Choose a batch"'))),
      'the saved mode stays checked across a re-render');
    ok(optionsOf(thumbHtml).some(text => text.startsWith('Client A graphics work')),
      'a graphics-only batch becomes offerable for a Thumbnail-only post');
    ok(!thumbHtml.includes('Client A video work'),
      'the video-only batch is not rendered anywhere for a Thumbnail-only post');
    const videoHtml = renderPrev(options, [['bat-a', 4]], 'Client A', { mode: 'video' });
    ok(optionsOf(videoHtml).some(text => text.startsWith('Client A video work'))
      && !videoHtml.includes('Client A graphics work'),
      'a Video-only post flips the compatibility the other way');
    const keptBatch = renderPicker(options, [['bat-a', 4]], 'Client A',
      { mode: 'thumbnail', batchChoice: { value: 'batch', batchId: 'bat-gra' } });
    ok(/id="calNativePrevBatchRadio"[^>]*data-batch-id="bat-gra"[^>]* checked/.test(keptBatch)
      && /<option value="bat-gra" selected/.test(keptBatch),
      'the batch the user picked survives a mode re-render when still offered');
    const keptNew = renderPicker(options, [['bat-a', 4]], 'Client A',
      { mode: 'both', batchChoice: { value: 'new', batchId: '' } });
    ok(/value="new" checked/.test(keptNew) && !/id="calNativePrevBatchRadio"[^>]* checked/.test(keptNew),
      'an explicit Start-a-new-batch choice survives a mode re-render');
    const lostChoice = renderPicker(options, [['bat-a', 4]], 'Client A',
      { mode: 'both', batchChoice: { value: 'batch', batchId: 'bat-gra' } });
    ok(/value="new" checked/.test(lostChoice)
      && /id="calNativePrevBatchRadio"[^>]*data-batch-id="bat-a"/.test(lostChoice)
      && !/id="calNativePrevBatchRadio"[^>]* checked/.test(lostChoice),
      'a chosen batch that the new mode no longer offers falls back to the new-batch default');
  }

  // -------------------------------------------------------------------------
  console.log('8b) a saved filter still applies after a re-render');
  {
    /* Codex P2 on PR 1353. `state.batchFilter` outlives a re-render and is
       painted back into the search box, but the options were rebuilt from the
       whole compatible list. Switching to the new-batch tab and back therefore
       showed an active query above batches it excludes AND preselected the
       first UNFILTERED one, which the submit path would then have appended to.
       A visible query has to mean the list under it. */
    /* Seven, because the search box only renders above
       CAL_NATIVE_BATCH_FILTER_MIN -- so a saved query can only exist at this
       size, and a fixture below it would test the fix in a world where the
       bug is unreachable. */
    const filterOptions = [
      batchFixture({ id: 'bat-new', name: 'September push', created_at: '2026-09-02T09:00:00.000Z' }),
      batchFixture({ id: 'bat-2', name: 'August wave', created_at: '2026-08-30T09:00:00.000Z' }),
      batchFixture({ id: 'bat-3', name: 'Launch set', created_at: '2026-08-29T09:00:00.000Z' }),
      batchFixture({ id: 'bat-4', name: 'Podcast cuts', created_at: '2026-08-28T09:00:00.000Z' }),
      batchFixture({ id: 'bat-5', name: 'Shorts batch', created_at: '2026-08-27T09:00:00.000Z' }),
      batchFixture({ id: 'bat-6', name: 'Reels set', created_at: '2026-08-26T09:00:00.000Z' }),
      batchFixture({ id: 'bat-old', name: 'Evergreen', created_at: '2026-08-24T09:00:00.000Z' }),
    ];
    /* The state on RETURN to the tab: while the panel was collapsed the tab
       strip's radio still carried the id the last render computed -- the first
       unfiltered batch -- so coming back arrives with `batch` chosen and
       `bat-new` aimed at, under a query that excludes it. */
    const filtered = renderPicker(filterOptions, null, 'Client A',
      { batchFilter: 'ever', batchChoice: { value: 'batch', batchId: 'bat-new' } });
    const shownRows = optionsOf(batchSection(filtered));
    ok(shownRows.length === 1 && shownRows[0].startsWith('Evergreen'),
      'the re-rendered dropdown holds only what the saved query matches');
    ok(/id="calNativePrevBatchRadio"[^>]*data-batch-id="bat-old"/.test(filtered),
      'and the radio aims at the first MATCH, not the first unfiltered batch the submit path would have taken');
    ok(/id="calNativeBatchFilter"[^>]*value="ever"/.test(filtered),
      'with the query still in the box, so what is shown and what is listed agree');
    ok(/id="calNativePrevBatchRadio"[^>]* checked/.test(filtered),
      'and the tab the user clicked is still the one they are on — a query that hides the remembered batch must not bounce them back to Start a new batch');

    /* The other direction: a query matching nothing must say so, and must not
       leave a live select preselecting something invisible. */
    const noMatch = renderPicker(filterOptions, null, 'Client A',
      { batchFilter: 'nothing matches this', batchChoice: { value: 'batch', batchId: 'bat-new' } });
    ok(optionsOf(batchSection(noMatch)).length === 0, 'a query matching nothing renders no options');
    ok(/cal-native-batch-select[^>]* disabled/.test(noMatch), 'and disables the dropdown');
    ok(/calNativeBatchFilterEmpty" style="display:;"/.test(noMatch), 'and shows the no-match line');
  }

  // -------------------------------------------------------------------------
  console.log('9) picking from the dropdown selects the card and re-aims the radio');
  {
    const radio = { dataset: {}, checked: false };
    const context3 = {
      console,
      document: { getElementById: id => id === 'calNativePrevBatchRadio' ? radio : null },
    };
    vm.createContext(context3);
    /* The pick also refreshes the receipt now (2026-09-08) so the append
       preview follows the dropdown. Counted here, because "the numbers must
       track the batch you just chose" is the whole point of the receipt. */
    context3.receiptSyncs = 0;
    vm.runInContext('function _calNativeSyncReceipt(){ receiptSyncs++; }', context3);
    vm.runInContext(extract('_calNativePrevBatchPick'), context3);
    context3.__sel = { value: 'bat-b' };
    vm.runInContext('_calNativePrevBatchPick(__sel, true)', context3);
    ok(radio.dataset.batchId === 'bat-b' && radio.checked === true,
      'a dropdown pick aims the radio at that batch and checks the card');
    ok(context3.receiptSyncs === 1,
      'and refreshes the receipt, so the previewed ordinals follow the batch just picked');
    radio.checked = false;
    context3.__sel = { value: 'bat-c' };
    vm.runInContext('_calNativePrevBatchPick(__sel, false)', context3);
    ok(radio.dataset.batchId === 'bat-c' && radio.checked === false,
      'a no-check sync re-aims the radio without stealing the choice');
    vm.runInContext('_calNativePrevBatchPick(null, true)', context3);
    ok(radio.dataset.batchId === 'bat-c', 'a missing select is a no-op');
  }

  console.log('\ncreate-post-picker: ' + pass + ' checks passed');
})().catch(error => { console.error(error); process.exit(1); });
