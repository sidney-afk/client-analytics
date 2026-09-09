'use strict';
/*
 * editors-week, natively.
 *
 * Kasper's weekly editor panel used to POST the `editors-week` n8n webhook,
 * which read Linear. That endpoint dies with Linear access on 2026-09-15.
 * `_kedFetchNativeWeek` rebuilds the identical payload from
 * public.deliverable_events (the installed status-transition ledger,
 * migrations/2026-07-06-b1-linear-data-model.sql:87, anon-readable per its
 * policy at :683), so every _ked* consumer downstream is untouched.
 *
 * A shaper is the easy half. The two ways it silently corrupts a week are:
 *
 *   1. THE TIMEZONE. _kedVideoDeliveries falls back to a UTC date slice
 *      (`String(t.at).slice(0,10)`) when a transition carries no dayKey, but
 *      _kedWeekDateKeys builds the seven bar buckets in America/Chicago. Any
 *      delivery after ~19:00 Chicago would land on the NEXT day's bar, and
 *      Sunday-evening work would fall outside the week's seven keys entirely:
 *      counted in the headline totals, invisible in the bars. Nothing errors.
 *
 *   2. THE TWEAK LABEL. deliverables.status uses `tweak`; every _ked*
 *      predicate matches Linear's 'Tweak Needed'. Ship the raw value and a
 *      tweak round is silently recounted as a first cut (wrong split on the
 *      headline row) AND the timeline strip loses its colour, because
 *      _kedStatusSlug needs /tweak\s*needed/ too.
 *
 * Both are pinned below with counterexamples that fail on the naive shaper.
 * Fixtures are synthetic: the repo is public, so no client display names.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const EVENT_ASSIGNEE_MIGRATION = fs.readFileSync(
  path.resolve(__dirname, '..', 'migrations', '2026-09-09-editors-event-assignee.sql'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Balanced-brace extraction of a named function out of index.html, so these
   checks exercise the SHIPPED source rather than a copy that can drift. */
function grabFunc(name) {
  const at = INDEX.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
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

/* Balanced extraction for the `const X = { … };` / `= new Intl…;` literals. */
function grabConst(name) {
  const re = new RegExp('const\\s+' + name + '\\s*=');
  const at = INDEX.search(re);
  if (at < 0) throw new Error('const not found: ' + name);
  let depth = 0, quote = '', escaped = false, started = false;
  for (let j = at; j < INDEX.length; j++) {
    const c = INDEX[j];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{' || c === '(') { depth++; started = true; }
    else if (c === '}' || c === ')') depth--;
    else if (c === ';' && depth === 0 && started) return INDEX.slice(at, j + 1);
    else if (c === '\n' && depth === 0 && started) return INDEX.slice(at, j);
  }
  throw new Error('unterminated const ' + name);
}

const SHAPER_FUNCS = [
  '_kedNativeLabel', '_kedTzOffsetMinutes', '_kedChicagoMidnightMs',
  '_kedChicagoDayKey', '_kedWeekLabel', '_kedRestPage', '_kedRestIn',
  '_kedFetchNativeWeek', '_kedExpectedLastWeekMondayDate'
];
const CONSUMER_FUNCS = [
  '_kedNorm', '_kedReviewTarget', '_kedIsTweakState', '_kedIsWorkState',
  '_kedIsFinishState', '_kedVideoDeliveries', '_kedVideoFinished',
  '_kedVideoIsWip', '_kedIsCourtState', '_kedVideoCourt', '_kedSplitVideos',
  '_kedWeekDateKeys', '_kedStatusSlug'
];
const CONSTS = ['_KED_NATIVE_TZ', '_KED_NATIVE_STATUS_LABEL', '_kedDayKeyFmt'];

/* ── the sandbox ─────────────────────────────────────────────────────────── */

// Rows the stubbed PostgREST serves, keyed by table. Each test rebuilds them.
function makeSandbox(tables, opts) {
  const calls = [];
  const sandbox = {
    console,
    Intl, Date, JSON, Math, Map, Set, Array, Object, String, Number, isNaN,
    encodeURIComponent, Promise, Error,
    CAL_SUPABASE_URL: 'https://stub.invalid',
    CAL_SUPABASE_ANON_KEY: 'stub-key',
    __calls: calls,
    fetch: function (url) {
      calls.push(url);
      const u = String(url);
      const table = u.split('/rest/v1/')[1].split('?')[0];
      const q = u.split('?')[1] || '';
      const params = {};
      for (const kv of q.split('&')) {
        const i = kv.indexOf('=');
        if (i > 0) params[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
      }
      let rows = (tables[table] || []).slice();
      // Honour the `in.(…)` filters the shaper sends, so chunking is real.
      for (const key of Object.keys(params)) {
        const v = params[key];
        if (v.indexOf('in.(') === 0) {
          const wanted = new Set(v.slice(4, -1).split(',').map(s => s.replace(/^"|"$/g, '')));
          rows = rows.filter(r => wanted.has(String(r[key])));
        }
      }
      const limit = +params.limit || 1000;
      const offset = +params.offset || 0;
      const page = rows.slice(offset, offset + limit);
      return Promise.resolve({
        ok: opts && opts.httpError ? false : true,
        status: opts && opts.httpError ? 500 : 200,
        json: () => Promise.resolve(page)
      });
    }
  };
  vm.createContext(sandbox);
  const src = CONSTS.map(grabConst).join('\n')
    + '\n' + SHAPER_FUNCS.concat(CONSUMER_FUNCS).map(grabFunc).join('\n');
  vm.runInContext(src, sandbox);
  return sandbox;
}

/* Last week's Chicago Monday, computed the same way the app does. */
const probe = makeSandbox({});
const MONDAY = probe._kedExpectedLastWeekMondayDate();
const MONDAY_MS = probe._kedChicagoMidnightMs(MONDAY);

/* Chicago-local wall clock: `dayOffset` days and `hour`:`minute` after
   00:00 Chicago on last week's Monday, returned as the UTC instant. */
function iso(dayOffset, hour, minute) {
  return new Date(MONDAY_MS + dayOffset * 86400000 + hour * 3600000 + (minute || 0) * 60000).toISOString();
}

function ev(deliverable_id, ts, from_status, to_status, ownerId, attribution) {
  return { deliverable_id, ts, from_status, to_status, action: 'status_change',
    event_assignee_id: ownerId === undefined ? 'm1' : ownerId,
    event_assignee_attribution: attribution === undefined ? 'native_transaction' : attribution };
}

/* ── 1. The payload contract the cache and the bar buckets depend on ─────── */

(async () => {
  const base = makeSandbox({
    deliverable_events: [ev('d1', iso(0, 15), 'in_progress', 'smm_approval')],
    deliverables: [{ id: 'd1', title: 'T1', client_slug: 'testclient', assignee_id: 'm1', kind: 'video', linear_issue_url: '' }],
    team_members: [{ id: 'm1', name: 'Editor One', email: 'e1@example.invalid', role: 'editor', active: true }],
    clients: [{ slug: 'testclient', display_name: 'Test Client' }]
  });
  const out = await base._kedFetchNativeWeek();

  ok(String(out.weekStart).split('T')[0] === MONDAY,
    'weekStart\'s UTC date part is last week\'s Chicago Monday, so _kedLoadEditorsCache still invalidates on a new week');
  ok(base._kedChicagoDayKey(out.weekStart) === MONDAY,
    'and weekStart formatted in Chicago is that same Monday, so _kedWeekDateKeys yields Mon..Sun (not Sun..Sat)');
  const keys = base._kedWeekDateKeys(out.weekStart);
  ok(keys.length === 7 && keys[0].label === 'Mon' && keys[6].label === 'Sun',
    'the seven bar buckets run Mon..Sun off the shaper\'s own weekStart');
  ok(Date.parse(out.weekEnd) - Date.parse(out.weekStart) >= 6 * 86400000,
    'weekEnd is the exclusive end of the same seven-day window');
  ok(out.source === 'native-event-assignee-v1', 'the payload declares its event-assignee source, so an old current-assignee cache is distinguishable');
  ok(Array.isArray(out.editors) && out.editors.length === 1 && out.editors[0].videos.length === 1,
    'one editor with one video comes back in the shape _kedPaint consumes');

  /* ── 2. TRAP ONE: the Chicago dayKey ──────────────────────────────────── */
  /* 21:30 Chicago on the Monday is 02:30 UTC on the TUESDAY. The naive
     shaper (no dayKey, UTC slice) puts this on Tuesday's bar. */
  const tz = makeSandbox({
    deliverable_events: [ev('d1', iso(0, 21, 30), 'in_progress', 'smm_approval')],
    deliverables: [{ id: 'd1', title: 'T1', client_slug: 'testclient', assignee_id: 'm1', kind: 'video', linear_issue_url: '' }],
    team_members: [{ id: 'm1', name: 'Editor One', email: 'e1@example.invalid', role: 'editor', active: true }],
    clients: [{ slug: 'testclient', display_name: 'Test Client' }]
  });
  const tzOut = await tz._kedFetchNativeWeek();
  const tzTr = tzOut.editors[0].videos[0].transitions[0];
  const utcSlice = String(tzTr.at).slice(0, 10);
  ok(tzTr.dayKey === MONDAY,
    'a 21:30-Chicago transition carries the Chicago dayKey (Monday), not the UTC date');
  ok(utcSlice !== MONDAY,
    'COUNTEREXAMPLE: the UTC date slice that _kedVideoDeliveries falls back to disagrees, so an absent dayKey WOULD have moved the bar');
  const tzStats = tz._kedSplitVideos(tzOut.editors[0].videos, Date.parse(tzOut.weekStart), Date.parse(tzOut.weekEnd));
  const tzKeys = tz._kedWeekDateKeys(tzOut.weekStart).map(k => k.key);
  ok(Object.keys(tzStats.perDay).every(k => tzKeys.indexOf(k) !== -1),
    'every delivery lands inside the week\'s seven bucket keys');

  /* Sunday-evening work is the case that vanishes entirely rather than
     shifting: its UTC date is the following Monday, outside all seven keys. */
  const sun = makeSandbox({
    deliverable_events: [ev('d1', iso(6, 21, 30), 'in_progress', 'smm_approval')],
    deliverables: [{ id: 'd1', title: 'T1', client_slug: 'testclient', assignee_id: 'm1', kind: 'video', linear_issue_url: '' }],
    team_members: [{ id: 'm1', name: 'Editor One', email: 'e1@example.invalid', role: 'editor', active: true }],
    clients: [{ slug: 'testclient', display_name: 'Test Client' }]
  });
  const sunOut = await sun._kedFetchNativeWeek();
  const sunTr = sunOut.editors[0].videos[0].transitions[0];
  const sunKeys = sun._kedWeekDateKeys(sunOut.weekStart).map(k => k.key);
  ok(sunKeys.indexOf(sunTr.dayKey) === 6,
    'Sunday-evening Chicago work lands on the Sunday bar');
  ok(sunKeys.indexOf(String(sunTr.at).slice(0, 10)) === -1,
    'COUNTEREXAMPLE: its UTC date falls outside all seven keys — it would have been counted in the totals and invisible in the bars');

  /* ── 3. TRAP TWO: tweak → 'Tweak Needed' ──────────────────────────────── */
  const tw = makeSandbox({
    deliverable_events: [ev('d1', iso(0, 15), 'tweak', 'smm_approval')],
    deliverables: [{ id: 'd1', title: 'T1', client_slug: 'testclient', assignee_id: 'm1', kind: 'video', linear_issue_url: '' }],
    team_members: [{ id: 'm1', name: 'Editor One', email: 'e1@example.invalid', role: 'editor', active: true }],
    clients: [{ slug: 'testclient', display_name: 'Test Client' }]
  });
  const twOut = await tw._kedFetchNativeWeek();
  const twVideo = twOut.editors[0].videos[0];
  ok(twVideo.transitions[0].from === 'Tweak Needed',
    'a `tweak` from_status is shaped to the Linear label the predicates match');
  const twDs = tw._kedVideoDeliveries(twVideo);
  ok(twDs.length === 1 && twDs[0].kind === 'tweak',
    'so the delivery is counted as a tweak round');
  ok(tw._kedIsTweakState(tw._kedNorm('tweak')) === false,
    'COUNTEREXAMPLE: the raw `tweak` value matches no _ked* tweak predicate, so it would have been miscounted as a first cut');
  ok(tw._kedStatusSlug('Tweak Needed') === 'tweak-needed' && tw._kedStatusSlug('tweak') !== 'tweak-needed',
    'and the timeline strip keeps its Tweak Needed colour, which the raw value also loses');

  /* ── 4. Every status in the DB domain maps somewhere defensible ────────── */
  /* migrations/2026-07-06-b1-linear-data-model.sql:39-41 */
  const DOMAIN = ['triage', 'backlog', 'todo', 'in_progress', 'smm_approval',
    'kasper_approval', 'client_approval', 'tweak', 'approved', 'scheduled',
    'posted', 'canceled', 'duplicate'];
  const L = s => base._kedNorm(base._kedNativeLabel(s));
  ok(DOMAIN.every(s => base._kedNativeLabel(s) !== s || s === 'todo' || s === 'backlog'),
    'every native status value is translated (todo/backlog already match verbatim)');
  ok(['in_progress', 'todo', 'backlog', 'tweak'].every(s => base._kedIsWorkState(L(s))),
    'the four editor-held states map onto _kedIsWorkState');
  ok(base._kedReviewTarget(L('smm_approval')) === 'smm'
    && base._kedReviewTarget(L('kasper_approval')) === 'kasper'
    && base._kedReviewTarget(L('client_approval')) === 'client',
    'the three review columns map onto their _kedReviewTarget slots');
  ok(base._kedIsFinishState(L('approved')) && base._kedIsFinishState(L('posted')),
    'approved and posted are finish states');
  ok(['triage', 'scheduled', 'canceled', 'duplicate'].every(s =>
    !base._kedIsWorkState(L(s)) && !base._kedIsFinishState(L(s)) && !base._kedReviewTarget(L(s))),
    'triage/scheduled/canceled/duplicate deliberately match no predicate — they are not editor work');

  /* ── 5. Parity: a synthetic week produces the pre-cutover numbers ──────── */
  /* Two videos for one editor: one first cut delivered Monday, one tweak
     round delivered Wednesday that then reaches Approved. */
  const par = makeSandbox({
    deliverable_events: [
      ev('v1', iso(0, 14), 'todo', 'in_progress'),
      ev('v1', iso(0, 20), 'in_progress', 'smm_approval'),
      ev('v2', iso(2, 15), 'tweak', 'kasper_approval'),
      ev('v2', iso(2, 22), 'kasper_approval', 'approved'),
      ev('v3', iso(3, 16), 'todo', 'in_progress')
    ],
    deliverables: [
      { id: 'v1', title: 'V1', client_slug: 'testclient', assignee_id: 'm1', kind: 'video', linear_issue_url: '' },
      { id: 'v2', title: 'V2', client_slug: 'testclient', assignee_id: 'm1', kind: 'video', linear_issue_url: '' },
      { id: 'v3', title: 'V3', client_slug: 'testclient', assignee_id: 'm1', kind: 'video', linear_issue_url: '' }
    ],
    team_members: [{ id: 'm1', name: 'Editor One', email: 'e1@example.invalid', role: 'editor', active: true }],
    clients: [{ slug: 'testclient', display_name: 'Test Client' }]
  });
  const parOut = await par._kedFetchNativeWeek();
  const st = par._kedSplitVideos(parOut.editors[0].videos,
    Date.parse(parOut.weekStart), Date.parse(parOut.weekEnd));
  ok(st.firstCuts === 1, 'one first cut (todo→in progress→SMM)');
  ok(st.tweakRounds === 1, 'one tweak round (tweak→Kasper)');
  ok(st.finishes === 1, 'one finish (v2 reached Approved)');
  ok(st.wip === 1, 'one still in progress (v3 started, never delivered, never finished)');
  ok(st.loadVideos === 3 && st.newVideos + st.tweakVideos + st.inProgVideos === st.loadVideos,
    'on-his-plate is three and its three parts still add up to it');

  /* ── 6. Event owner is immutable history, not current assignment ─────── */
  const reassigned = makeSandbox({
    deliverable_events: [
      ev('handoff', iso(0, 14), 'todo', 'in_progress', 'former'),
      ev('handoff', iso(0, 18), 'in_progress', 'smm_approval', 'former'),
      ev('handoff', iso(2, 14), 'tweak', 'kasper_approval', 'current'),
      ev('handoff', iso(3, 12), 'kasper_approval', 'approved', 'current')
    ],
    // The live row now belongs to a third identity. It must not receive any
    // of last week's transitions just because it is current today.
    deliverables: [{ id: 'handoff', title: 'H', client_slug: 'testclient', assignee_id: 'today', kind: 'video', linear_issue_url: '' }],
    team_members: [
      { id: 'former', name: 'Inactive Editor', email: 'former@example.invalid', role: 'editor', active: false },
      { id: 'current', name: 'Current Editor', email: 'current@example.invalid', role: 'editor', active: true },
      { id: 'today', name: 'Today Editor', email: 'today@example.invalid', role: 'editor', active: true }
    ],
    clients: [{ slug: 'testclient', display_name: 'Test Client' }]
  });
  const reassignedOut = await reassigned._kedFetchNativeWeek();
  const byOwner = new Map(reassignedOut.editors.map(e => [e.id, e]));
  ok(byOwner.has('former') && byOwner.has('current') && !byOwner.has('today'),
    'a reassignment during the week credits each transition to its stamped owner, never today\'s assignee');
  ok(byOwner.get('former').videos[0].transitions.length === 2
    && byOwner.get('current').videos[0].transitions.length === 2,
    'the shared video is partitioned by event owner instead of duplicating its full timeline under both people');
  ok(reassigned._kedSplitVideos(byOwner.get('former').videos, Date.parse(reassignedOut.weekStart), Date.parse(reassignedOut.weekEnd)).firstCuts === 1
    && reassigned._kedSplitVideos(byOwner.get('current').videos, Date.parse(reassignedOut.weekStart), Date.parse(reassignedOut.weekEnd)).tweakRounds === 1,
    'the handoff keeps the first cut with the former editor and the tweak delivery with the current editor');
  const totalFinishes = reassignedOut.editors.reduce((n, editor) => n
    + reassigned._kedSplitVideos(editor.videos, Date.parse(reassignedOut.weekStart), Date.parse(reassignedOut.weekEnd)).finishes, 0);
  ok(totalFinishes === 1, 'a finish is attributed to its own event once, with no duplicate finish after reassignment');
  ok(byOwner.get('former').inactive === true,
    'an inactive roster member remains in historical results; _kedPaint must not filter this history');
  ok(/_kedRestIn\('team_members', 'id,name,role,active'/.test(INDEX),
    'restoring historical roster identity does not expand the weekly reader with email snapshots');
  ok(!/editors = .*wlIsInactiveEditor/s.test(INDEX),
    'the shipped painter no longer removes inactive editors from a completed week');

  const noProof = makeSandbox({
    deliverable_events: [
      ev('legacy', iso(0, 15), 'in_progress', 'smm_approval', null, 'unknown'),
      ev('unassigned', iso(1, 15), 'in_progress', 'smm_approval', null, 'unassigned')
    ],
    // A tempting current assignee must never fill either missing history owner.
    deliverables: [
      { id: 'legacy', title: 'Legacy', client_slug: 'testclient', assignee_id: 'today', kind: 'video', linear_issue_url: '' },
      { id: 'unassigned', title: 'Unassigned', client_slug: 'testclient', assignee_id: 'today', kind: 'video', linear_issue_url: '' }
    ],
    team_members: [{ id: 'today', name: 'Today Editor', email: 'today@example.invalid', role: 'editor', active: true }],
    clients: [{ slug: 'testclient', display_name: 'Test Client' }]
  });
  const noProofOut = await noProof._kedFetchNativeWeek();
  ok(noProofOut.editors.length === 0 && noProofOut.unattributed.unknown === 1 && noProofOut.unattributed.unassigned === 1,
    'unknown historic and explicitly unassigned events remain honest separately labeled counts, never guessed current-assignee credit');
  ok(/event_assignee_attribution/.test(INDEX) && /unattributed/.test(INDEX),
    'the shipped UI has an explicit attribution-limited state instead of silently calling unknown history a quiet week');

  /* ── 7. Scope and robustness ──────────────────────────────────────────── */
  const mixed = makeSandbox({
    deliverable_events: [
      ev('v1', iso(0, 15), 'in_progress', 'smm_approval'),
      ev('g1', iso(0, 15), 'in_progress', 'smm_approval'),
      ev('u1', iso(0, 15), 'in_progress', 'smm_approval', null, 'unassigned')
    ],
    deliverables: [
      { id: 'v1', title: 'V', client_slug: 'testclient', assignee_id: 'm1', kind: 'video', linear_issue_url: '' },
      { id: 'g1', title: 'G', client_slug: 'testclient', assignee_id: 'm1', kind: 'thumbnail', linear_issue_url: '' },
      { id: 'u1', title: 'U', client_slug: 'testclient', assignee_id: null, kind: 'video', linear_issue_url: '' }
    ],
    team_members: [{ id: 'm1', name: 'Editor One', email: 'e1@example.invalid', role: 'editor', active: true }],
    clients: [{ slug: 'testclient', display_name: 'Test Client' }]
  });
  const mixedOut = await mixed._kedFetchNativeWeek();
  ok(mixedOut.editors.length === 1 && mixedOut.editors[0].videos.length === 1
    && mixedOut.editors[0].videos[0].id === 'v1',
    'graphics deliverables and unassigned videos are excluded, so headline counts stay video-only');

  /* ── 6b. TEST AND INTERNAL CLIENTS ARE NOT EDITOR PRODUCTION ─────────── */
  /* Codex finding, 2026-09-08. The client lookup selected `slug,display_name`
     only, so nothing downstream could tell one kind of client from another and
     every slug counted. The TEST client is the one the nightly probes drive:
     they move statuses on it all night, each move writes a `status_change`
     row, and every one landed in whichever editor holds the assignee_id — in
     the panel Kasper reads to judge people. TRACK_B_LINEAR_REPLACEMENT_SPEC
     §9.11 names the exclusion; the graphics and unassigned halves of the same
     sentence were already implemented (§6 above) and this one was not.

     Every check in this block fails against the shaper as it stood before
     2026-09-08. */
  const kinds = makeSandbox({
    deliverable_events: [
      ev('real1', iso(0, 15), 'in_progress', 'smm_approval'),
      ev('test1', iso(0, 15), 'in_progress', 'smm_approval'),
      ev('int1', iso(0, 15), 'in_progress', 'smm_approval'),
      ev('churned1', iso(0, 15), 'in_progress', 'smm_approval'),
      ev('unknown1', iso(0, 15), 'in_progress', 'smm_approval')
    ],
    deliverables: [
      { id: 'real1', title: 'R', client_slug: 'realclient', assignee_id: 'm1', kind: 'video', linear_issue_url: '' },
      { id: 'test1', title: 'T', client_slug: 'robotclient', assignee_id: 'm1', kind: 'video', linear_issue_url: '' },
      { id: 'int1', title: 'I', client_slug: 'internalclient', assignee_id: 'm1', kind: 'video', linear_issue_url: '' },
      { id: 'churned1', title: 'C', client_slug: 'churnedclient', assignee_id: 'm1', kind: 'video', linear_issue_url: '' },
      { id: 'unknown1', title: 'U', client_slug: 'noregistryrow', assignee_id: 'm1', kind: 'video', linear_issue_url: '' }
    ],
    team_members: [{ id: 'm1', name: 'Editor One', email: 'e1@example.invalid', role: 'editor', active: true }],
    clients: [
      { slug: 'realclient', display_name: 'Real Client', kind: 'client', active: true },
      { slug: 'robotclient', display_name: 'Robot Client', kind: 'test', active: true },
      { slug: 'internalclient', display_name: 'Internal Client', kind: 'internal', active: false },
      { slug: 'churnedclient', display_name: 'Churned Client', kind: 'client', active: false }
      /* `noregistryrow` deliberately has NO row at all. */
    ]
  });
  const kindsOut = await kinds._kedFetchNativeWeek();
  const kindIds = kindsOut.editors.length ? kindsOut.editors[0].videos.map(v => v.id).sort() : [];
  ok(!kindIds.includes('test1'),
    "a TEST client's video is excluded from an editor's week — the nightly probes' own status "
    + 'traffic no longer counts as that editor\'s production');
  ok(!kindIds.includes('int1'),
    'and an INTERNAL client\'s video is excluded too, per spec §9.11');
  ok(kindIds.includes('real1'),
    'while a real active client\'s video is kept — the filter did not widen into "drop everything"');
  ok(kindIds.includes('churned1'),
    'an OFFBOARDED real client (kind:client, active:false) is KEPT: the work happened, and the rule '
    + 'is kind, not active — dropping it would erase a real week from a real editor');
  ok(kindIds.includes('unknown1'),
    'a slug with no registry row at all is KEPT: an absent row is not evidence of a robot, and '
    + 'AGENTS.md says a guard that could go either way chooses permissive');
  ok(kindIds.length === 3,
    'so exactly the two proven non-production clients are removed and nothing else (' + kindIds.join(',') + ')');

  /* The lookup has to ASK for `kind`. Selecting only slug/display_name is how
     the defect existed at all — a filter written against a column the request
     never returned would silently keep everything. */
  ok(/_kedRestIn\(\s*'clients',\s*'slug,display_name,kind'/.test(INDEX),
    'the shipped clients read selects `kind`, so the filter has something real to judge');

  /* An editor whose whole week was TEST work vanishes rather than appearing
     with a plate of zero — the panel lists people who did production work. */
  const allRobot = makeSandbox({
    deliverable_events: [ev('t1', iso(0, 15), 'in_progress', 'smm_approval')],
    deliverables: [{ id: 't1', title: 'T', client_slug: 'robotclient', assignee_id: 'm1', kind: 'video', linear_issue_url: '' }],
    team_members: [{ id: 'm1', name: 'Editor One', email: 'e1@example.invalid', role: 'editor', active: true }],
    clients: [{ slug: 'robotclient', display_name: 'Robot Client', kind: 'test', active: true }]
  });
  const allRobotOut = await allRobot._kedFetchNativeWeek();
  ok(Array.isArray(allRobotOut.editors) && allRobotOut.editors.length === 0 && allRobotOut.weekStart,
    'a week that was entirely TEST traffic returns the empty envelope, not an editor with a plate of zero');

  /* Paging: a week over the 1000-row PostgREST default must not truncate.
     A truncated read is indistinguishable from a quiet week. */
  const many = [];
  for (let i = 0; i < 1400; i++) many.push(ev('p' + i, iso(0, 15), 'in_progress', 'smm_approval'));
  const paged = makeSandbox({
    deliverable_events: many,
    deliverables: many.map(e => ({ id: e.deliverable_id, title: 'P', client_slug: 'testclient', assignee_id: 'm1', kind: 'video', linear_issue_url: '' })),
    team_members: [{ id: 'm1', name: 'Editor One', email: 'e1@example.invalid', role: 'editor', active: true }],
    clients: [{ slug: 'testclient', display_name: 'Test Client' }]
  });
  const pagedOut = await paged._kedFetchNativeWeek();
  ok(pagedOut.editors[0].videos.length === 1400,
    'a 1400-row week is paged in full rather than silently cut at the 1000-row default');

  const empty = makeSandbox({ deliverable_events: [] });
  const emptyOut = await empty._kedFetchNativeWeek();
  ok(Array.isArray(emptyOut.editors) && emptyOut.editors.length === 0 && emptyOut.weekStart,
    'a genuinely empty week returns the envelope with no editors, which _kedPaint renders as its empty state');

  let threw = null;
  try {
    const bad = makeSandbox({ deliverable_events: [] }, { httpError: true });
    await bad._kedFetchNativeWeek();
  } catch (e) { threw = e; }
  ok(threw && /HTTP 500/.test(String(threw.message)),
    'a failed read throws so _kasperLoadEditors shows its error state instead of painting an empty week as fact');

  /* ── 6b. The pager's ceiling: loud, not truncating ────────────────── */
  /* `_kedRestPage` used to run a fixed twenty iterations, so a query matching
     more than 20,000 rows returned the first 20,000 as if that were all of
     them. That is the SAME defect the pager exists to remove -- a count the
     owner reads as fact, quietly short -- just moved up two orders of
     magnitude and made rare, which is the worse failure mode, not the better
     one: a wrong number nobody ever sees go wrong is a wrong number that gets
     trusted. Driven against the pager directly rather than through the shaper,
     because the shaper's own `in.(...)` filters cap the row count long before
     the ceiling, and the ceiling is the thing under test. Codex on bd6011e. */
  const wideRows = (n) => Array.from({ length: n }, (_, i) => ({ id: 'r' + i }));

  const past20k = makeSandbox({ widetable: wideRows(20500) });
  const past20kOut = await past20k._kedRestPage('widetable?select=id');
  ok(past20kOut.length === 20500,
    'a 20,500-row read is paged in FULL, where the fixed twenty-page loop stopped at 20,000 ('
    + past20kOut.length + ' rows)');

  const exact = makeSandbox({ widetable: wideRows(3000) });
  const exactOut = await exact._kedRestPage('widetable?select=id');
  ok(exactOut.length === 3000,
    'a total that is an exact multiple of the page size still terminates, on the empty page after it');

  let ceiling = null;
  try {
    const over = makeSandbox({ widetable: wideRows(50000) });
    await over._kedRestPage('widetable?select=id');
  } catch (e) { ceiling = e; }
  ok(ceiling && /refusing to report a truncated count/.test(String(ceiling.message)),
    'and the safety ceiling THROWS rather than returning a short answer, so _kasperLoadEditors '
    + 'paints its error state instead of a plausible wrong number');
  ok(ceiling && !/select=/.test(String(ceiling.message)),
    'the thrown message names the table only, never the filter values — it can reach CI output in a PUBLIC repo');

  /* ── 8. SQL contract: source-only and immutable ─────────────────────── */
  ok(/add column if not exists event_assignee_id uuid/.test(EVENT_ASSIGNEE_MIGRATION)
    && /event_assignee_attribution text not null default 'unknown'/.test(EVENT_ASSIGNEE_MIGRATION),
    'the migration adds nullable event identity plus an explicit unknown default; it does not infer legacy ownership');
  ok(/native_transaction/.test(EVENT_ASSIGNEE_MIGRATION)
    && /unassigned/.test(EVENT_ASSIGNEE_MIGRATION)
    && /event_assignee_attribution_immutable/.test(EVENT_ASSIGNEE_MIGRATION),
    'only transaction-stamped known and explicit unassigned states are valid, and attribution cannot later be rewritten');
  ok(/v_event \? 'ts'/.test(EVENT_ASSIGNEE_MIGRATION)
    && /v_event \? 'source_event_at'/.test(EVENT_ASSIGNEE_MIGRATION)
    && /\('backfill', 'reconcile'\)/.test(EVENT_ASSIGNEE_MIGRATION),
    'source-timed, backfill, and reconcile writes remain unknown instead of pretending a later database snapshot proves past ownership');
  ok(/event_assignee_server_stamp_required/.test(EVENT_ASSIGNEE_MIGRATION)
    && /app\.event_assignee_stamp/.test(EVENT_ASSIGNEE_MIGRATION),
    'ordinary RPC/application writers cannot claim an owner without the native transaction stamp; privileged SQL remains separately trusted');
  ok(!/update\s+public\.deliverable_events[\s\S]{0,240}assignee_id/i.test(EVENT_ASSIGNEE_MIGRATION),
    'the migration contains no current-assignee backfill of historical ledger rows');

  /* ── 9. The endpoint is actually gone from the shipped file ───────────── */
  ok(!/webhook\/editors-week/.test(INDEX),
    'no editors-week webhook path remains anywhere in index.html');
  ok(!/EDITORS_WEEK_URL/.test(INDEX),
    'and its constant is removed, not merely unreferenced');
  ok(/_kedFetchNativeWeek\(\)/.test(INDEX),
    '_kasperLoadEditors reads the native shaper');
  const endpoints = fs.readFileSync(path.resolve(__dirname, '..', 'docs', 'truth', 'ENDPOINTS.md'), 'utf8');
  ok(!/webhook\/editors-week/.test(endpoints),
    'docs/truth/ENDPOINTS.md drops it in the same commit, which is what test/truth-sync.js checks');

  console.log(`\neditors-week-native: ${failures ? '' : 'all '}checks ${failures ? failures + ' failed ❌' : 'passed ✅'}`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FAIL  suite threw: ' + (e && e.stack || e)); process.exit(1); });
