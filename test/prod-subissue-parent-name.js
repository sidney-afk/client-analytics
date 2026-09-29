'use strict';

/*
 * A SUB-ISSUE'S "Sub-issue of ..." HEADER NEVER SHOWS AN INTERNAL ID.
 *
 * Owner report 2026-09-29: opening a sub-issue read "Sub-issue of bat_44ca..."
 * (the parent's raw batch key) instead of the parent's name, and sometimes
 * stayed that way. Two causes, both fixed:
 *   1. the header printed _prodIssueLabel(parent) -- the raw key for a batch
 *      parent, which has no short identifier -- and fell back to the same key
 *      when the title was empty;
 *   2. the lookup for a name the page did not hold had no time limit, so one
 *      request that never answered left the header on its placeholder for good.
 *
 * Executes the REAL functions out of the shipped page (not a source scan),
 * with the parent's data delayed, failing and hanging. Only the synthetic
 * test ids below are used.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    const char = source[i], next = source[i + 1];
    if (comment === 'line') { if (char === '\n') comment = ''; continue; }
    if (comment === 'block') { if (char === '*' && next === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { comment = 'line'; i++; continue; }
    if (char === '/' && next === '*') { comment = 'block'; i++; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

const NAMES = ['_prodIssueLabel', '_prodIssueDisplayLabel', '_prodIsInternalId', '_prodSafeName',
  '_prodKnownName', '_prodParentNameState', '_prodEnsureParentName', '_prodParentNameHTML',
  '_prodSubIssueContextHTML'];
// Timers shortened so the hung-request cases run in milliseconds.
const consts = ['PROD_PARENT_NAME_TIMEOUT_MS = 40', 'PROD_PARENT_NAME_RETRY_MS = 60', '_prodParentNames = new Map()']
  .map(c => 'const ' + c + ';').join('\n');
const script = consts + '\n' + NAMES.map(extractFunction).join('\n')
  + '\nglobalThis.__api = { ' + NAMES.join(', ') + ', names: _prodParentNames };';

function makeWorld(reads) {
  const renders = [];
  const sandbox = {
    setTimeout, clearTimeout, Promise, Date, Map, Set, String, Array, Object, RegExp,
    document: { getElementById: () => ({}) },
    _prodRender: () => renders.push('render'),
    _prodState: { loading: false, cachePartial: false },
    _calEsc: v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    _calEscAttr: v => String(v).replace(/"/g, '&quot;'),
    _jsAttrArg: v => JSON.stringify(String(v)),
    _prodStatusIcon: () => '', _prodStatusSVG: () => '',
    _prodSubProgress: () => null, _prodDisplayClient: () => 'Test client',
    _prodAttributionResolved: () => false, _prodIssueProjectChipHTML: () => '',
    _prodProjectGlyph: () => '', _prodOpenProject: () => {},
    _prodRestRows: (table, select, params) => reads.batch(params),
    _prodLoadDeliverableProjection: params => reads.deliverable(params)
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);
  return { api: sandbox.__api, renders };
}

const RAW_ID = /\b(bat|del|b1_b)_[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-/i;
const BATCH_ID = 'bat_44ca2350-7bff-4c1d-9a11-0123456789ab';
const child = { id: 'del_11111111-2222-4333-8444-555555555555', parent: BATCH_ID, project: 'fixture-client' };
// What a person can read: markup stripped. The parent's key stays in a hidden
// data attribute the page's own selectors and click handlers need.
const vis = html => String(html).replace(/<[^>]*>/g, ' ');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // --- the helpers -------------------------------------------------------
  {
    const { api } = makeWorld({ batch: async () => [], deliverable: async () => [] });
    ok(api._prodIsInternalId(BATCH_ID), 'a batch key is an internal id');
    ok(api._prodIsInternalId('del_11111111-2222-4333-8444-555555555555'), 'a deliverable key is an internal id');
    ok(api._prodIsInternalId('b1_b_0a1b2c3d-0000-0000-0000-000000000000'), 'an imported batch key is an internal id');
    ok(api._prodIsInternalId(BATCH_ID + '::0a1b2c3d-0000-0000-0000-000000000000'), 'a two-team batch node is an internal id');
    ok(api._prodIsInternalId('0a1b2c3d-0000-4000-8000-000000000000'), 'a bare uuid is an internal id');
    ok(!api._prodIsInternalId('VID-13400'), 'a Linear number is not an internal id');
    ok(!api._prodIsInternalId('video_20260929 launch') && !api._prodIsInternalId('ad_deadbeef campaign'),
      'a real title that merely starts like a key is kept');
    ok(!api._prodIsInternalId('Spring launch reel'), 'a real name is not an internal id');
    ok(api._prodKnownName({ title: BATCH_ID, batchName: 'Spring launch' }) === 'Spring launch',
      'a title that is only the key is skipped for the batch name');
    ok(api._prodIssueDisplayLabel({ displayId: 'del_11111111-2222-4333-8444-555555555555' }) === '',
      'a native card with no short identifier gets no label, not its key');
    ok(api._prodIssueDisplayLabel({ syntheticBatchParent: true, displayId: BATCH_ID }) === 'Post',
      'a batch parent still reads "Post"');
  }

  // --- 1. opened BEFORE the parent data arrives ---------------------------
  {
    let release;
    const gate = new Promise(r => { release = r; });
    const { api, renders } = makeWorld({
      batch: async () => { await gate; return [{ id: BATCH_ID, name: 'Spring launch reel' }]; },
      deliverable: async () => []
    });
    const seen = [];
    const paint = () => { const html = api._prodSubIssueContextHTML(child, null); seen.push(html); return html; };
    const first = paint();
    ok(/Sub-issue of/.test(first), 'the header is there straight away, before the parent loads');
    ok(/data-prod-parent-skeleton/.test(first), 'the name slot is a skeleton while the parent is unknown');
    ok(!RAW_ID.test(vis(first)), 'no internal id is visible while waiting');
    paint(); paint();
    release();
    await wait(10);
    ok(renders.length >= 1, 'the page repaints when the name arrives');
    const later = paint();
    ok(later.includes('Spring launch reel') && !/data-prod-parent-skeleton/.test(later), 'the real name replaces the skeleton');
    ok(seen.every(h => !RAW_ID.test(vis(h))), 'no internal id was visible in any paint');
  }

  // --- 2. the parent is loaded, but its name is not -----------------------
  {
    const { api } = makeWorld({ batch: () => new Promise(() => {}), deliverable: () => new Promise(() => {}) });
    const parent = { id: BATCH_ID, displayId: BATCH_ID, syntheticBatchParent: true, batchId: BATCH_ID, title: '', batchName: '' };
    const html = api._prodSubIssueContextHTML(child, parent);
    ok(!RAW_ID.test(vis(html)), 'a loaded parent with no name never prints its key');
    ok(/data-prod-parent-skeleton/.test(html), 'and shows a skeleton while the name is looked up');
    ok(/>Post </.test(html) || />Post<\/b>|Post /.test(html), 'the neutral "Post" label stands in for the key');
    const named = api._prodSubIssueContextHTML(child, Object.assign({}, parent, { title: 'Summer sale' }));
    ok(named.includes('Summer sale') && !/data-prod-parent-skeleton/.test(named), 'a name the page already holds shows at once, with no lookup');
  }

  // --- 3. THE STUCK CASE: a lookup that never answers ----------------------
  {
    let calls = 0;
    let hang = true;
    const { api } = makeWorld({
      batch: () => { calls++; return hang ? new Promise(() => {}) : Promise.resolve([{ id: BATCH_ID, name: 'Back at last' }]); },
      deliverable: async () => []
    });
    const first = api._prodSubIssueContextHTML(child, null);
    ok(/data-prod-parent-skeleton/.test(first), 'stuck case: starts on the skeleton');
    await wait(80);
    const timedOut = api._prodSubIssueContextHTML(child, null);
    ok(!/data-prod-parent-skeleton/.test(timedOut), 'stuck case: the skeleton does not last forever');
    ok(/Untitled post/.test(timedOut) && !RAW_ID.test(vis(timedOut)), 'stuck case: a neutral word replaces it, never the key');
    hang = false;
    await wait(80);                       // past the retry window
    api._prodSubIssueContextHTML(child, null);   // a later paint retries
    await wait(15);
    ok(calls >= 2, 'stuck case: a later paint asks again instead of giving up for the session');
    ok(api._prodSubIssueContextHTML(child, null).includes('Back at last'), 'stuck case: the name appears once the lookup works');
  }

  // --- 4. a lookup that fails outright -------------------------------------
  {
    const { api } = makeWorld({ batch: async () => { throw new Error('network'); }, deliverable: async () => [] });
    api._prodSubIssueContextHTML(child, null);
    await wait(15);
    const html = api._prodSubIssueContextHTML(child, null);
    ok(/Untitled post/.test(html) && !RAW_ID.test(vis(html)) && !/data-prod-parent-skeleton/.test(html),
      'a failed lookup ends on the neutral word, not the key and not a skeleton');
  }

  // --- 5. every parent-name site in the page goes through the safe helper --
  {
    const boot = extractFunction('_prodDetailTopbar') + extractFunction('_prodSubIssueContextHTML');
    ok(!/_prodIssueLabel\(parent\)/.test(boot), 'no header, crumb or side card prints the parent through the raw label');
  }

  if (failures) { console.error(failures + ' assertion(s) failed'); process.exit(1); }
  console.log('prod-subissue-parent-name: all assertions passed');
})();
