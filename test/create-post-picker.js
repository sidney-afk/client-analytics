'use strict';

/*
 * create-post-picker.js — behavioral contract for the Create Post batch
 * picker presentation (owner-approved redesign, 2026-08-14).
 *
 * The dialog's WRITE path is pinned elsewhere (native-intake-ui-source.js,
 * prod-write-gateway-browser.js); this suite renders the real picker in a VM
 * and asserts what a reader sees:
 *   - each row is titled by the batch NAME, never a prefix phrase;
 *   - subtext is post count + short start date, with the created time added
 *     only when two visible rows share a display name;
 *   - Linear identifier ranges NEVER reach the rendered HTML, even when the
 *     fixture data carries identifiers that would tempt it;
 *   - an empty compatible batch reads "Empty batch";
 *   - parentless orphan batches (2026-08-07 outage, OPEN_REPAIRS items 1-2)
 *     are excluded from BOTH lists;
 *   - single-team rows collapse behind a dynamic <details> disclosure with a
 *     per-team reason, and stay disabled;
 *   - the new-batch row says "Start a new batch" over the generated name;
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
  extractRaw('_calEsc'),
  extractRaw('_calEscAttr'),
  extract('_linearIntakeBatchTitle'),
  extract('_calNativeBatchStartMeta'),
  extract('_calNativeBatchDisplayName'),
  extract('_calNativeBatchCompatible'),
  extract('_calNativeBatchHasLinearParents'),
  extract('_calNativeBatchLists'),
  extract('_calRenderNativePostChoice'),
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

/* The mode radio row renders first; batch assertions read only the batch
   radiogroup so its titles/metas keep their historic indexes. */
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

let pass = 0;
function ok(cond, label) {
  assert(cond, label);
  pass++;
  console.log('  ok  ' + label);
}

// ---------------------------------------------------------------------------
console.log('1) titles are batch names; subtext is count + short start date');
{
  const html = renderPicker([
    batchFixture({ id: 'bat-a', name: 'Client A · 7 Aug 2026' }),
    batchFixture({ id: 'bat-orphan', name: 'Client A · 1 Aug 2026', created_at: '2026-08-01T10:00:00.000Z', linear_parent_ids: null }),
    batchFixture({ id: 'bat-vid', name: 'Client A video work', team: 'video', created_at: '2026-08-05T08:00:00.000Z' }),
    batchFixture({ id: 'bat-gra', name: 'Client A graphics work', team: 'graphics', created_at: '2026-08-03T08:00:00.000Z' }),
  ], [['bat-a', 4]]);

  const modeBlock = html.slice(0, html.indexOf('aria-label="Choose a batch"'));
  ok(titlesOf(modeBlock).join('|') === 'Video + Thumbnail|Video only|Thumbnail only',
    'the post-shape choice renders its three modes first');
  ok(/value="both" checked/.test(modeBlock) && !/value="video" checked/.test(modeBlock) && !/value="thumbnail" checked/.test(modeBlock),
    'Video + Thumbnail is the default shape');
  ok(titlesOf(batchSection(html))[0] === 'Client A · 7 Aug 2026', 'compatible row is titled by the batch name');
  ok(!html.includes('Add to existing batch'), 'the old prefix phrase is gone');
  ok(!html.includes('Unavailable for this'), 'the old unavailable phrase is gone');
  ok(metasOf(batchSection(html))[0] === '4 posts · started 7 Aug', 'subtext is post count + short start date');
  ok(!/started 7 Aug,/.test(html), 'a unique display name carries no time of day');
  ok(!/VID-\d|GRA-\d/.test(html), 'Linear identifier ranges never reach the HTML despite tempting fixture identifiers');
  ok(!html.includes('bat-orphan') && !html.includes('Client A · 1 Aug 2026'),
    'a parentless orphan batch is excluded from the compatible list');
  ok(/<details class="cal-native-batch-unavailable">/.test(html), 'unavailable rows sit inside a native details disclosure');
  ok(html.includes("2 batches can't hold this post — show why"), 'the disclosure line counts the hidden rows');
  ok(html.includes("Video-only — can't hold this Video + Thumbnail post · started 5 Aug"),
    'a video-only batch explains what it cannot hold under the default shape');
  ok(html.includes("Graphics-only — can't hold this Video + Thumbnail post · started 3 Aug"),
    'a graphics-only batch explains what it cannot hold under the default shape');
  const unavailable = html.slice(html.indexOf('<details'), html.indexOf('</details>'));
  ok((unavailable.match(/ disabled>/g) || []).length === 2
    && (unavailable.match(/is-incompatible/g) || []).length === 2
    && (unavailable.match(/aria-disabled="true"/g) || []).length === 2,
    'disclosed rows stay disabled radio options');
  ok(titlesOf(unavailable).includes('Client A video work'), 'disclosed rows are titled by batch name too');
  const generated = 'Client A · ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  ok(html.includes('<span class="cal-native-batch-title">Start a new batch</span>'), 'the new-batch row is titled Start a new batch');
  ok(html.includes('"' + generated + '" · adds this post to it'), 'the new-batch subtext keeps the generated batch name');
  ok(/value="batch" data-batch-id="bat-a" checked/.test(html), 'the first compatible batch is preselected');
}

// ---------------------------------------------------------------------------
console.log('2) empty compatible batch reads Empty batch');
{
  const html = renderPicker([batchFixture({ id: 'bat-a' })], [['bat-a', 0]]);
  ok(metasOf(batchSection(html))[0] === 'Empty batch · started 7 Aug', 'zero posts renders the Empty batch wording');
  ok(!html.includes('0 posts'), 'zero is never spelled as a count');
}

// ---------------------------------------------------------------------------
console.log('3) duplicate display names pull the created time into every twin');
{
  const html = renderPicker([
    batchFixture({ id: 'bat-a', name: 'Client A · 7 Aug 2026', created_at: '2026-08-07T09:30:00.000Z' }),
    batchFixture({ id: 'bat-b', name: 'Client A · 7 Aug 2026', created_at: '2026-08-07T14:05:00.000Z' }),
    batchFixture({ id: 'bat-c', name: 'Client A extras', created_at: '2026-08-06T10:00:00.000Z' }),
    batchFixture({ id: 'bat-d', name: 'Client A · 7 Aug 2026', team: 'video', created_at: '2026-08-07T16:45:00.000Z' }),
  ], [['bat-a', 4], ['bat-b', 1], ['bat-c', 2]]);
  const metas = metasOf(batchSection(html));
  ok(metas[0] === '4 posts · started 7 Aug, 09:30', 'first twin appends its created time');
  ok(metas[1] === '1 post · started 7 Aug, 14:05', 'second twin appends its created time (and 1 post is singular)');
  ok(metas[2] === '2 posts · started 6 Aug', 'a uniquely named row keeps the date alone');
  ok(html.includes("Video-only — can't hold this Video + Thumbnail post · started 7 Aug, 16:45"),
    'a disclosed row sharing the name also appends its created time');
}

// ---------------------------------------------------------------------------
console.log('4) counts-fetch failure degrades the subtext to the start date only');
{
  const html = renderPicker([batchFixture({ id: 'bat-a' })], null);
  ok(metasOf(batchSection(html))[0] === 'started 7 Aug', 'no counts map -> date-only subtext');
  ok(!/post/.test(metasOf(batchSection(html))[0]) && !html.includes('Empty batch'), 'no invented counts when the read failed');
}

// ---------------------------------------------------------------------------
console.log('5) orphan-only options fall back to a checked new-batch row; one hidden row is singular');
{
  const html = renderPicker([
    batchFixture({ id: 'bat-orphan-1', name: 'Client A · 2 Aug 2026', linear_parent_ids: null }),
    batchFixture({ id: 'bat-orphan-2', name: 'Client A · 3 Aug 2026', linear_parent_ids: {} }),
    batchFixture({ id: 'bat-vid', name: 'Client A video work', team: 'video', created_at: '2026-08-05T08:00:00.000Z' }),
  ], []);
  ok(!html.includes('bat-orphan-1') && !html.includes('bat-orphan-2'),
    'null and empty-object linear_parent_ids are both excluded from every list');
  ok(/value="new" checked/.test(html), 'with no eligible compatible batch the new-batch row is preselected');
  ok(html.includes("1 batch can't hold this post — show why"), 'a single hidden row reads as 1 batch');
}

// ---------------------------------------------------------------------------
console.log('6) the post-count read is one bounded projection query that counts cards, not rows');
(async () => {
  const context = { console };
  vm.createContext(context);
  vm.runInContext(extract('_calFetchNativeBatchPostCounts'), context);
  vm.runInContext([
    'restCalls = [];',
    'async function _prodRestRows(table, select, params, pageSize, maxPages) {',
    '  restCalls.push({ table: table, select: select, params: params, pageSize: pageSize, maxPages: maxPages });',
    '  return [',
    "    { batch_id: 'bat-a', card_id: 'card-1', id: 'd1' },",
    "    { batch_id: 'bat-a', card_id: 'card-1', id: 'd2' },",
    "    { batch_id: 'bat-a', card_id: 'card-2', id: 'd3' },",
    "    { batch_id: 'bat-b', card_id: '', id: 'd4' },",
    "    { batch_id: 'bat-b', card_id: null, id: 'd5' },",
    '  ];',
    '}',
  ].join('\n'), context);
  const counts = await vm.runInContext("_calFetchNativeBatchPostCounts(['bat-a', 'bat-b', 'bat-c', 'bat-a'])", context);
  const calls = context.restCalls;
  ok(calls.length === 1, 'exactly one extra REST query fetches every shown count');
  ok(calls[0].table === 'production_deliverables_browser_v1', 'counts come from the browser-safe deliverables projection');
  ok(calls[0].select === 'batch_id,card_id,id', 'the projection reads only what counting needs');
  ok(/^batch_id=in\.\(/.test(calls[0].params) && decodeURIComponent(calls[0].params).includes('"bat-a","bat-b","bat-c"'),
    'the query filters to the deduplicated shown batches');
  ok(calls[0].maxPages === 1 && calls[0].pageSize === 1000, 'the read is bounded to one page');
  ok(counts.get('bat-a') === 2, 'a paired Video + Graphics post sharing one card counts once');
  ok(counts.get('bat-b') === 2, 'cardless rows each count alone');
  ok(counts.get('bat-c') === 0, 'a shown batch with no rows counts zero, enabling the Empty batch wording');

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
    ok(metasOf(batchSection(modal.innerHTML))[0] === 'started 7 Aug',
      (stall ? 'a stalled' : 'a failing') + ' counts read still renders the picker with a date-only subtext');
    ok(modal.innerHTML.includes('Client A · 7 Aug 2026'), 'the batch rows themselves are intact after the degrade');
  }

  // -------------------------------------------------------------------------
  console.log('8) the post-shape choice re-scopes compatibility and keeps the chosen batch');
  {
    const options = [
      batchFixture({ id: 'bat-a', name: 'Client A · 7 Aug 2026' }),
      batchFixture({ id: 'bat-vid', name: 'Client A video work', team: 'video', created_at: '2026-08-05T08:00:00.000Z' }),
      batchFixture({ id: 'bat-gra', name: 'Client A graphics work', team: 'graphics', created_at: '2026-08-03T08:00:00.000Z' }),
    ];
    const thumbHtml = renderPicker(options, [['bat-a', 4]], 'Client A', { mode: 'thumbnail' });
    ok(/value="thumbnail" checked/.test(thumbHtml.slice(0, thumbHtml.indexOf('aria-label="Choose a batch"'))),
      'the saved mode stays checked across a re-render');
    ok(titlesOf(batchSection(thumbHtml)).includes('Client A graphics work'),
      'a graphics-only batch becomes compatible for a Thumbnail-only post');
    ok(thumbHtml.includes("Video-only — can't hold a Thumbnail post"),
      'a video-only batch is disclosed with a Thumbnail-specific reason');
    ok(!batchSection(thumbHtml).slice(0, batchSection(thumbHtml).indexOf('<details')).includes('Client A video work'),
      'the video-only batch is not offered as compatible for a Thumbnail-only post');
    const videoHtml = renderPicker(options, [['bat-a', 4]], 'Client A', { mode: 'video' });
    ok(titlesOf(batchSection(videoHtml)).includes('Client A video work')
      && videoHtml.includes("Graphics-only — can't hold a Video post"),
      'a Video-only post flips the compatibility the other way');
    const keptBatch = renderPicker(options, [['bat-a', 4]], 'Client A',
      { mode: 'thumbnail', batchChoice: { value: 'batch', batchId: 'bat-gra' } });
    ok(/value="batch" data-batch-id="bat-gra" checked/.test(keptBatch)
      && !/value="batch" data-batch-id="bat-a" checked/.test(keptBatch),
      'the batch the user picked survives a mode re-render when still offered');
    const keptNew = renderPicker(options, [['bat-a', 4]], 'Client A',
      { mode: 'both', batchChoice: { value: 'new', batchId: '' } });
    ok(/value="new" checked/.test(keptNew) && !/value="batch" data-batch-id="bat-a" checked/.test(keptNew),
      'an explicit Start-a-new-batch choice survives a mode re-render');
    const lostChoice = renderPicker(options, [['bat-a', 4]], 'Client A',
      { mode: 'both', batchChoice: { value: 'batch', batchId: 'bat-gra' } });
    ok(/value="batch" data-batch-id="bat-a" checked/.test(lostChoice),
      'a chosen batch that the new mode no longer offers falls back to the first compatible');
  }

  console.log('\ncreate-post-picker: ' + pass + ' checks passed');
})().catch(error => { console.error(error); process.exit(1); });
