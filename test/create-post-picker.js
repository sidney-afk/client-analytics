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
  extract('_calNativeEditorDisclaimer'),
  extract('_calRenderNativePostChoice'),
  extract('_linearIntakeRecoveryHtml'),
  'function _linearIntakeRead() { return null; }',
  'function _linearIntakeUnresolvedRead() { return []; }',
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
function metasOf(html) {
  return [...html.matchAll(/cal-native-batch-meta">([^<]*)</g)].map(m => m[1]);
}
/* Scoped to the BATCH select since 2026-08-24: the dialog gained a second
   select (the video-editor picker), and an unscoped sweep silently started
   returning that one's options first — every batch assertion below would have
   been reading the wrong control while still looking like it passed. */
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
  ok(html.includes('"' + generated + '" · adds this post to it'), 'the new-batch subtext keeps the generated batch name');
  ok(titlesOf(batches)[1] === 'Add to a previous batch', 'the second card is the previous-batch card');
  ok(/id="calNativePrevBatchRadio"[^>]*data-batch-id="bat-a"/.test(batches)
    && !/id="calNativePrevBatchRadio"[^>]* checked/.test(batches),
    'the previous-batch radio carries the last batch id but starts unchecked');
  ok(optionsOf(batches).join('|') === 'Client A · 7 Aug 2026 — last batch · 4 posts · started 7 Aug',
    'the dropdown row is the batch name plus last-batch label, count, and short start date');
  ok(/onmousedown="_calNativePrevBatchPick\(this, true\)"/.test(batches)
    && /onchange="_calNativePrevBatchPick\(this, true\)"/.test(batches),
    'touching the dropdown selects the previous-batch card');
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
  const html = renderPicker([batchFixture({ id: 'bat-a' })], [['bat-a', 0]]);
  ok(optionsOf(html)[0] === 'Client A · 7 Aug 2026 — last batch · Empty batch · started 7 Aug',
    'zero posts renders the Empty batch wording');
  ok(!html.includes('0 posts'), 'zero is never spelled as a count');
}

// ---------------------------------------------------------------------------
console.log('3) duplicate display names pull the created time into every twin');
{
  const html = renderPicker([
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
  const html = renderPicker([batchFixture({ id: 'bat-a' })], null);
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
  const counts = await vm.runInContext(
    "_calFetchNativeBatchPostCounts(["
    + "{ id: 'bat-a' }, { id: 'bat-b' },"
    + " { id: 'bat-c', linear_parent_ids: { video: { uuid: 'parent-c' }, graphics: { uuid: 'parent-c' } } },"
    + " { id: 'bat-a' }])", context);
  const calls = context.restCalls;
  ok(calls.length === 1, 'exactly one extra REST query fetches every shown count');
  ok(calls[0].table === 'production_deliverables_browser_v1', 'counts come from the browser-safe deliverables projection');
  ok(calls[0].select === 'batch_id,card_id,id,linear_issue_uuid', 'the projection reads only what counting needs, plus the uuid that tells a parent apart');
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
    ok(optionsOf(modal.innerHTML)[0] === 'Client A · 7 Aug 2026 — last batch · started 7 Aug',
      (stall ? 'a stalled' : 'a failing') + ' counts read still renders the picker with a date-only subtext');
    ok(/value="new" checked/.test(modal.innerHTML), 'the degraded dialog still defaults to Start a new batch');
    if (stall) {
      ok(/assigned automatically/i.test(modal.innerHTML),
        'a failed editor-pool read leaves Create Post working and says the editor is assigned automatically');
    } else {
      ok(/Free Editor/.test(modal.innerHTML) && /\(suggested\)/.test(modal.innerHTML),
        'the editor with the fewest open videos is the suggested default');
      ok(modal.innerHTML.indexOf('Free Editor') < modal.innerHTML.indexOf('Busy Editor'),
        'and the pool is ordered freest-first');
      ok(/has the least on right now \(1 open video\)/.test(modal.innerHTML),
        'the disclaimer names the person and the number it is based on, singular for one');
      ok(/suggestion/.test(modal.innerHTML),
        'and says plainly that it is a suggestion, which is what the owner asked to be disclaimed');
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
    const thumbHtml = renderPicker(options, [['bat-a', 4]], 'Client A', { mode: 'thumbnail' });
    ok(/value="thumbnail" checked/.test(thumbHtml.slice(0, thumbHtml.indexOf('aria-label="Choose a batch"'))),
      'the saved mode stays checked across a re-render');
    ok(optionsOf(thumbHtml).some(text => text.startsWith('Client A graphics work')),
      'a graphics-only batch becomes offerable for a Thumbnail-only post');
    ok(!thumbHtml.includes('Client A video work'),
      'the video-only batch is not rendered anywhere for a Thumbnail-only post');
    const videoHtml = renderPicker(options, [['bat-a', 4]], 'Client A', { mode: 'video' });
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
  console.log('9) picking from the dropdown selects the card and re-aims the radio');
  {
    const radio = { dataset: {}, checked: false };
    const context3 = {
      console,
      document: { getElementById: id => id === 'calNativePrevBatchRadio' ? radio : null },
    };
    vm.createContext(context3);
    vm.runInContext(extract('_calNativePrevBatchPick'), context3);
    context3.__sel = { value: 'bat-b' };
    vm.runInContext('_calNativePrevBatchPick(__sel, true)', context3);
    ok(radio.dataset.batchId === 'bat-b' && radio.checked === true,
      'a dropdown pick aims the radio at that batch and checks the card');
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
