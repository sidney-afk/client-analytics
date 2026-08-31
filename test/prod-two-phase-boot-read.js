'use strict';
/*
 * The Production tab downloaded every deliverable before it would let anyone
 * touch anything. Reported live 2026-08-31 by an editor on a slow connection:
 * SyncLinear "super lento", comments stuck on their skeleton, and every write
 * control reading "Write controls are unavailable while authority is being
 * checked" on every issue she opened.
 *
 * MEASURED against the live projection the same morning:
 *   6,181 rows x 44 columns, 1,000 per page, keyset-paged so the pages are
 *   strictly sequential -> ~10 MB over 7 round trips before first interaction.
 *   2,206 of those rows are live; the other ~3,975 are approved / posted /
 *   archived / canceled work nobody was waiting on.
 *
 * Three separate defects fell out of that one read, and this file pins the
 * two structural ones (the comments timeout is pinned by its own file):
 *
 *   1. AUTHORITY WAS AWAITED INSIDE THE SAME Promise.all. One small row, the
 *      one that decides whether every write control is live, held behind a
 *      10 MB download running beside it. The sentence on screen was true for
 *      the first instant and a lie for the remaining thirty seconds.
 *   2. THE ARCHIVE LOADED BEFORE THE BOARD. Now the live half lands first and
 *      the finished work is merged in behind it.
 *
 * THE PROPERTY THAT MATTERS, and the one a split like this gets wrong: the two
 * filters must be exact complements, so the row set once the tail settles is
 * the same set the single read produced. `in` and `not.in` BOTH drop a NULL
 * status, so a naive split loses any row whose status is null -- silently, the
 * failure mode this repo keeps finding. Phase one therefore claims the nulls.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], next = INDEX[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

/* ---- 1. The two filters are built from ONE list, so they cannot drift ----- */

const terminalLine = (INDEX.match(/const PROD_CACHE_TERMINAL = \[([^\]]+)\];/) || [])[1] || '';
const TERMINAL = terminalLine.split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
ok(TERMINAL.length >= 6, 'the terminal-status list exists and is non-trivial (' + TERMINAL.length + ' statuses)');

const liveFilter = (INDEX.match(/const PROD_LIVE_FILTER = ([^;]+);/) || [])[1] || '';
const terminalFilter = (INDEX.match(/const PROD_TERMINAL_FILTER = ([^;]+);/) || [])[1] || '';
ok(/PROD_CACHE_TERMINAL\.join\(','\)/.test(liveFilter) && /PROD_CACHE_TERMINAL\.join\(','\)/.test(terminalFilter),
  'BOTH halves are derived from PROD_CACHE_TERMINAL, so a status added to one is added to the other');
ok(!/'(approved|posted|archived|canceled)'/.test(liveFilter + terminalFilter),
  'and neither hard-codes a status beside that list, which is how the two halves would drift apart');

/* ---- 2. THE TRAP: a null status must not fall through both halves -------- */

ok(/status\.is\.null/.test(liveFilter),
  'the LIVE half explicitly claims null-status rows — `in`/`not.in` both drop them, so without this a row with no status is fetched by neither half and vanishes');
ok(!/is\.null/.test(terminalFilter),
  'and the terminal half does NOT also claim them, which would double-fetch instead');
ok(/^or=\(/.test(liveFilter.replace(/^'/, '')),
  'the live half is an or-group, the only shape that can express "not terminal OR null" in one filter');

/* ---- 3. Executed: the two filters partition every status, exactly once --- */
/* Source shape alone would not catch an off-by-one here. Run the real
   predicates over every status the live estate holds, plus the null and
   mixed-case shapes the codebase warns about, and prove each lands in exactly
   one half. */
{
  const LIVE = new Set(TERMINAL);
  // Mirrors PostgREST: `in`/`not.in` compare the raw value; a null matches
  // neither, which is why the live half carries an explicit is.null arm.
  const inTerminal = (status) => status !== null && LIVE.has(status);
  const matchesLive = (status) => status === null || !inTerminal(status);
  const matchesTerminal = (status) => inTerminal(status);

  const STATUSES = [
    'todo', 'in_progress', 'tweak', 'smm_approval', 'kasper_approval',
    'client_approval', 'backlog', 'triage',            // live, seen in the estate today
    'approved', 'posted', 'archived', 'canceled', 'cancelled', 'duplicate',
    'Approved', 'POSTED',                              // the mixed case the cache comment warns about
    null,                                              // the trap
    'some_status_nobody_has_invented_yet'
  ];
  let everyExactlyOnce = true;
  const offenders = [];
  for (const status of STATUSES) {
    const hits = (matchesLive(status) ? 1 : 0) + (matchesTerminal(status) ? 1 : 0);
    if (hits !== 1) { everyExactlyOnce = false; offenders.push(String(status) + ' -> ' + hits + ' half/halves'); }
  }
  ok(everyExactlyOnce,
    'every status lands in EXACTLY one half — no row lost, none fetched twice' + (offenders.length ? ' (offenders: ' + offenders.join(', ') + ')' : ''));

  ok(matchesLive(null) && !matchesTerminal(null),
    'a null status lands in the LIVE half specifically — an unknown row surfaces where somebody can see it rather than disappearing');
  ok(matchesLive('Approved') && !matchesTerminal('Approved'),
    'a mixed-case terminal status still lands exactly once (in the live half) rather than being dropped by both');
}

/* ---- 4. The tail actually runs, and cannot paste stale data over new ----- */

const tail = grabFunc('_prodLoadTerminalTail');
ok(/PROD_TERMINAL_FILTER/.test(tail), '_prodLoadTerminalTail fetches the terminal half');
ok(/const generation = _prodState\.projectionGeneration/.test(tail)
  && /generation !== _prodState\.projectionGeneration/.test(tail),
  'and drops its own result if a newer load landed while it was in flight — a slow archive must never overwrite fresher state');
ok(/new Set\(/.test(tail) && /!seen\.has\(/.test(tail),
  'the merge de-duplicates by id, so a row whose status changed between the two reads cannot appear twice');
ok(/_prodTerminalTailRunning/.test(tail),
  'and it will not run twice concurrently');
ok(/catch \(e\)/.test(tail) && /console\.warn/.test(tail),
  'a failed tail is caught: the board is already usable without it, so it must not fail the load');

const loadData = grabFunc('_prodLoadData');
ok(/_prodLoadDeliverableProjection\(PROD_LIVE_FILTER\)/.test(loadData),
  '_prodLoadData fetches only the live half up front');
ok(/_prodLoadTerminalTail\(\)/.test(loadData),
  'and kicks off the tail after the board has painted');
const paintAt = loadData.indexOf('_prodRender();\n                _prodLoadTerminalTail()');
ok(paintAt > 0,
  'the tail starts AFTER the paint, not before it — starting it first would put the archive back in front of the reader');

/* ---- 5. Authority is off the critical path ------------------------------- */

ok(/const authorityPromise = _prodFetchAuthority\(\);/.test(loadData),
  'authority is issued as its own promise');
const settleAt = loadData.indexOf('authorityPromise.then(');
const groupAt = loadData.indexOf('await Promise.all(');
ok(settleAt > 0 && groupAt > 0 && settleAt < groupAt,
  'and it settles write controls BEFORE the group await — that ordering IS the fix; inside the group it waits on the projection beside it');
ok(/if \(_prodState\.authorityReadAt\) return;/.test(loadData),
  'the early settle refuses to overwrite a newer answer from the 30s poll or a delta refresh');
ok(/authorityPromise\s*\n?\s*\]\)/.test(loadData) || /authorityPromise$/m.test(loadData.split('Promise.all')[1] || ''),
  'the group still awaits the same promise, so the post-load assignment is unchanged');

console.log(failures === 0
  ? '\nTwo-phase Production boot read checks passed'
  : '\n' + failures + ' two-phase boot read check(s) failed');
process.exit(failures === 0 ? 0 : 1);
