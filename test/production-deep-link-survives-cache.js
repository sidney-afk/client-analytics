'use strict';
/*
 * A Production deep link has to survive the stale first paint.
 *
 * OWNER REPORT 2026-08-24, opening a Workload rollup and following its
 * "Open SyncView" link: "it just goes to the old team's issues, but it doesn't
 * open it". The popover builds ?prod=1&d=<identifier>; the link was correct.
 *
 * mountProductionView paints from the localStorage snapshot first
 * (stale-while-revalidate) and only then reads live. The absent-target guard
 * ran on BOTH paints and cleared _prodState.openId on the cached one -- so a
 * batch created after the reader last opened Production was discarded before
 * the live read arrived, and the live read then found openId already empty and
 * had nothing left to open. What the reader saw was the cached list: old data,
 * and the item never opening. Indistinguishable from a broken link.
 *
 * Two properties are pinned here, and they pull in opposite directions:
 *
 *   1. The request SURVIVES a cached paint that cannot satisfy it, and the
 *      first authoritative read re-applies it.
 *   2. It is consumed exactly once, and never re-applied over a reader who
 *      navigated in the meantime -- a background refresh minutes later must
 *      not yank someone out of the issue they opened.
 *
 * And when the live read genuinely does not have the target, the reader is
 * TOLD, rather than left on a list that looks like the app failed.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/*
 * Quote-aware brace matcher. The extracted functions deliberately carry no
 * comments in their bodies, so a quote scanner is enough here; anything added
 * to them later that contains an apostrophe or a backtick would need this to
 * learn about comments too (see test/attribution-mixed-family.js).
 */
function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  const brace = source.indexOf('{', start);
    /* Comments are SKIPPED, not parsed. index.html comments are prose and
       contain apostrophes -- "the row's scope" -- which a quote-only scanner
       reads as an unterminated string, swallowing every brace after it and
       throwing `unclosed` for a function that balances perfectly. That error
       names the wrong thing and sends the reader hunting a syntax error that
       is not there. A brace or quote inside a comment is not code. */
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = brace; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (!quote && char === '/' && next === '/') { lineComment = true; index++; continue; }
    if (!quote && char === '/' && next === '*') { blockComment = true; index++; continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('unclosed ' + name);
}

// ---- Run the real function against a fake projection -----------------------
function newHarness(live) {
  const sandbox = { String, Boolean };
  /* `terminalTailLoadedAt` is stamped because every `apply(true)` in this suite
     means "the server has answered and the row set is settled" — which, since
     2026-09-03, requires a tail to have LANDED and not merely no flag to be
     raised. The un-stamped pre-tail state is a real state with its own
     contract; it is asserted in test/prod-incomplete-pane-honesty.js, where the
     pane's copy is also checked. */
  sandbox._prodState = {
    view: 'list', openId: '', openBatchId: '', openProjectId: '',
    clientSlug: '', deepLink: null, deepLinkMissing: '',
    terminalTailPending: false, terminalTailFailed: false, terminalTailLoadedAt: 1,
  };
  sandbox._prodIssue = id => (live.issues || []).includes(String(id)) ? { id: String(id) } : null;
  sandbox._prodBatch = id => (live.batches || []).includes(String(id)) ? { id: String(id) } : null;
  sandbox._prodClient = id => (live.clients || []).includes(String(id)) ? { id: String(id) } : null;
  vm.createContext(sandbox);
  vm.runInContext(
    extractFunction('_prodRowSetComplete')
      + '\n'
      + extractFunction('_prodApplyDeepLinkFallback')
      + '\nthis.apply = _prodApplyDeepLinkFallback;',
    sandbox,
  );
  return sandbox;
}

// ---- 1. The reported failure -----------------------------------------------
/*
 * The exact sequence: the cached snapshot predates the batch, the live read
 * has it. Before this change the cached paint cleared openId and the item was
 * lost for good.
 */
{
  const h = newHarness({ issues: ['VID-13555'] });          // live HAS it
  h._prodState.openId = 'VID-13555';
  h._prodState.view = 'detail';
  h._prodState.deepLink = { kind: 'issue', id: 'VID-13555' };

  // Cached paint: the snapshot does not have it yet.
  h._prodIssue = id => null;
  h.apply(false);
  /* CHANGED 2026-09-03 BY OWNER REPORT, and the old assertion is the bug.
     It required the cached paint to fall back to the LIST, which is what the
     reader then sees: opening a deep link flashes the entire unfiltered "All
     teams" board before the item they clicked. The owner sent a screenshot of
     exactly that and asked for it to stop.
     A cached snapshot is not evidence of absence, so the paint now KEEPS the
     requested item and shows its skeleton until the authoritative read answers.
     Everything else about the contract is unchanged and still asserted below:
     the request stays pending, nothing is declared missing, and the
     authoritative pass still evicts a genuinely absent row. */
  ok(h._prodState.view === 'detail' && h._prodState.openId === 'VID-13555',
    'a cached paint that cannot satisfy the link HOLDS the item and shows its skeleton, never the whole board');
  ok(h._prodState.deepLink && h._prodState.deepLink.id === 'VID-13555',
    'but the request is still pending — this is the line that was missing');
  ok(h._prodState.deepLinkMissing === '',
    'and nothing is declared missing yet, because no authoritative read has happened');

  // Live read lands.
  h._prodIssue = id => String(id) === 'VID-13555' ? { id } : null;
  h.apply(true);
  ok(h._prodState.view === 'detail' && h._prodState.openId === 'VID-13555',
    'the first authoritative read re-applies it and the deliverable opens');
  ok(h._prodState.deepLinkMissing === '',
    'and no not-found notice is raised for a link that did resolve');
  ok(h._prodState.deepLink === null,
    'the request is consumed, so it cannot fire again on a later refresh');
}

// ---- 2. Consumed once — a refresh must not yank the reader -----------------
{
  const h = newHarness({ issues: ['VID-13555', 'VID-99'] });
  h._prodState.deepLink = { kind: 'issue', id: 'VID-13555' };
  h.apply(true);
  ok(h._prodState.openId === 'VID-13555', 'the link opens on the first authoritative read');

  // The reader then navigates somewhere else, and a background refresh runs.
  h._prodState.openId = 'VID-99';
  h.apply(true);
  ok(h._prodState.openId === 'VID-99',
    'a later refresh leaves the reader where they navigated, never re-opening the link');
}

// ---- 3. Navigating DURING the wait wins over the pending link --------------
{
  const h = newHarness({ issues: ['VID-13555', 'VID-99'] });
  h._prodState.deepLink = { kind: 'issue', id: 'VID-13555' };
  h._prodState.openId = 'VID-99';                    // opened while the read was in flight
  h._prodState.view = 'detail';
  h.apply(true);
  ok(h._prodState.openId === 'VID-99',
    'a reader who opened something during the wait is not pulled away from it');
  ok(h._prodState.deepLinkMissing === '',
    'and is not shown a not-found notice about a link they overtook');
}

// ---- 4. Genuinely absent: SAY SO -------------------------------------------
/*
 * The silent list fallback is what made the defect unreportable — the owner
 * could only describe it as "it doesn't open it". A named target is the whole
 * difference between a broken app and a link that points somewhere else.
 */
{
  const h = newHarness({ issues: [] });
  h._prodState.openId = 'GRA-7119';
  h._prodState.view = 'detail';
  h._prodState.deepLink = { kind: 'issue', id: 'GRA-7119' };
  h.apply(true);
  ok(h._prodState.view === 'list' && h._prodState.openId === '',
    'a target absent from live data still falls back to the list');
  ok(h._prodState.deepLinkMissing === 'GRA-7119',
    'and the target is named, so the reader can tell a stale link from a broken app');
}

// ---- 5. Cold load with no cache at all -------------------------------------
/*
 * Regression guard for the first version of this fix, which treated "something
 * is open" as "the reader navigated" and so stayed silent on a cold load — the
 * one path where the deep link is still sitting in openId when the live read
 * completes.
 */
{
  const h = newHarness({ issues: [] });
  h._prodState.openId = 'VID-404';
  h._prodState.view = 'detail';
  h._prodState.deepLink = { kind: 'issue', id: 'VID-404' };
  h.apply(true);
  ok(h._prodState.deepLinkMissing === 'VID-404',
    'a cold load with an unresolvable link reports it too, not only the cached path');
}

// ---- 6. Batches and projects take the same route ---------------------------
{
  const h = newHarness({ batches: ['bat_1'] });
  h._prodState.deepLink = { kind: 'batch', id: 'bat_1' };
  h.apply(false);
  ok(h._prodState.deepLink !== null, 'a ?batch= link also survives the cached paint');
  h.apply(true);
  ok(h._prodState.view === 'batch' && h._prodState.openBatchId === 'bat_1',
    'and opens the batch on the authoritative read');

  const p = newHarness({ clients: ['acme'] });
  p._prodState.deepLink = { kind: 'project', id: 'acme' };
  p.apply(true);
  ok(p._prodState.view === 'project' && p._prodState.openProjectId === 'acme',
    'a project deep link opens the project');
}

// ---- The wiring: both paints go through the one helper ---------------------
const hydrate = extractFunction('_prodHydrateFromCache');
ok(/_prodApplyDeepLinkFallback\(false\)/.test(hydrate),
  'the cached paint calls the helper NON-authoritatively, so it cannot discard the request');
ok(!/_prodState\.openId = ''/.test(hydrate),
  'and no longer clears the deep link inline — that inline guard was the defect');

const loadStart = source.indexOf('async function _prodLoadData(');
const loadSlice = source.slice(loadStart, loadStart + 9000);
ok(/_prodApplyDeepLinkFallback\(true\)/.test(loadSlice),
  'the live read calls it authoritatively, which is the only place a target is declared missing');

const prime = extractFunction('_prodPrimeFromUrl');
ok(/_prodState\.deepLink = d \? \{ kind: 'issue', id: d \}/.test(prime),
  'the URL records what it asked for rather than only mutating view state');
ok(/_prodState\.deepLinkMissing = '';/.test(prime),
  'and a fresh URL clears any previous not-found notice');

// ---- The notice is rendered, dismissible, and escaped ----------------------
const notice = extractFunction('_prodDeepLinkNoticeHTML');
ok(/if \(!missing\) return '';/.test(notice),
  'the notice renders nothing at all unless a target actually went missing');
ok(/_calEsc\(missing\)/.test(notice) && /_calEscAttr\(missing\)/.test(notice),
  'the identifier comes from the URL, so it is escaped into both text and attribute');
ok(/_prodDismissDeepLinkNotice\(\)/.test(notice),
  'and it can be dismissed');

const list = extractFunction('_prodList');
ok((list.match(/_prodDeepLinkNoticeHTML\(\)/g) || []).length === 2,
  'both list branches carry it — the populated list and the empty state');
ok(/emptyNotice\s*\n?\s*\? '<div class="prod-listwrap"/.test(list),
  'the empty state is only wrapped when there IS a notice, so prod-content keeps its single flex child');

const setQuery = extractFunction('_prodSetQuery');
ok(/_prodState\.deepLinkMissing = '';/.test(setQuery),
  'any deliberate navigation retires the notice rather than leaving it on the list forever');
/*
 * Caught in review of this change. Clearing only the NOTICE left the pending
 * REQUEST alive, and `openedElsewhere` is computed from the three open ids
 * alone — so a reader who switched team, tab, grouping or filter while still on
 * the list had all three empty, and the authoritative read yanked them into the
 * deep-link target. Not only a two-second race either: if the first read fails,
 * the request stays pending and any later successful refresh fires it.
 */
ok(/_prodState\.deepLink = null;/.test(setQuery),
  'and retires the pending REQUEST too, so a completed read cannot yank a reader off the route they just chose');
{
  // The clear is only safe because no deep-link load path touches the URL.
  const mount = extractFunction('mountProductionView');
  ok(!/_prodSetQuery\(/.test(mount)
    && !/_prodSetQuery\(/.test(extractFunction('_prodPrimeFromUrl'))
    && !/_prodSetQuery\(/.test(extractFunction('_prodHydrateFromCache')),
    'and no mount/prime/hydrate path calls _prodSetQuery, which is what makes clearing there safe rather than self-defeating');
}

if (failures) {
  console.error(`\n${failures} production deep-link check(s) failed`);
  process.exit(1);
}
console.log('\nproduction deep-link survives-cache checks passed');
