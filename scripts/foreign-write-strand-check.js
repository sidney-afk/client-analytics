'use strict';
/*
 * STRANDED FOREIGN WRITES — the one thing detect-only logging cannot tell you.
 *
 * Since the graphics flip (2026-08-16) and the video flip (2026-08-28),
 * SyncView owns both teams (OPEN_REPAIRS item 80). When somebody edits an
 * issue in LINEAR instead, for either team, `linear-inbound` records a
 * `foreign_write_detected` event and deliberately does NOT apply it: honouring
 * it would hand authority back to the side that just lost it. That is correct,
 * and it is also silent — 976 such events landed in the seven days to
 * 2026-08-22 and nothing anywhere reported them.
 *
 * But "detected" is not the same as "lost". Measured over those 14 days, the
 * overwhelming majority are HARMLESS: somebody nudged an issue in Linear and
 * SyncView then moved the same row on its own afterwards, so the native store
 * is simply AHEAD and its value is the right one. Counting raw foreign writes
 * as damage would cry wolf 900+ times a week — the alarm-fatigue failure the
 * health check exists to prevent.
 *
 * The rows that actually matter are the ones where Linear moved and the native
 * row NEVER caught up: its `updated_at` still predates the foreign write, and
 * the two sides now disagree about what the work IS. That is a piece of
 * somebody's day sitting in a state nobody downstream can see. On 2026-08-22
 * exactly TWO rows in fourteen days met that bar, so this is a small, readable
 * number by design — if it starts climbing, the working habit has changed and
 * somebody should be told.
 *
 * READ-ONLY. Public key, no writes, no Linear calls, safe to run anywhere.
 *
 *   node scripts/foreign-write-strand-check.js [--days=14] [--json]
 *
 * Exit 0 always: this is a CONTEXT report, not a gate. It gates nothing
 * precisely because a foreign write is a human's choice, not a fault, and the
 * remedy is a conversation rather than a repair.
 */
const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
  || 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA');

const args = new Map(process.argv.slice(2).map(a => {
  const m = String(a).match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] == null ? '1' : m[2]] : [a, '1'];
}));
const DAYS = Math.max(1, Number(args.get('days') || 14));
const AS_JSON = args.has('json');

/* Linear state name -> native status slug. Kept here rather than imported so
   this stays a zero-dependency read: an UNKNOWN state name is reported as
   unmapped instead of being silently treated as a disagreement, because a new
   workflow state must never masquerade as stranded work. */
const STATE_TO_STATUS = new Map([
  ['todo', 'todo'],
  ['backlog', 'backlog'],
  ['in progress', 'in_progress'],
  ['for smm approval', 'smm_approval'],
  ['for client approval', 'client_approval'],
  ['for kasper approval', 'kasper_approval'],
  ['tweak needed', 'tweak'],
  ['approved', 'approved'],
  ['scheduled', 'scheduled'],
  ['posted', 'posted'],
  ['canceled', 'canceled'],
  ['cancelled', 'canceled'],
  ['duplicate', 'duplicate'],
]);

async function rest(path) {
  const res = await fetch(SUPA_URL + '/rest/v1/' + path, {
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
  });
  if (!res.ok) throw new Error(path.split('?')[0] + ' -> HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return res.json();
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

async function main() {
  const since = isoDaysAgo(DAYS);
  const events = [];
  // Bounded, paged read: an unbounded deliverable_events scan intermittently
  // answers 57014 (statement timeout), which the health check documents as a
  // known database condition rather than missing data.
  const PAGE = 1000;
  for (let offset = 0; offset < 20000; offset += PAGE) {
    const page = await rest('deliverable_events'
      + '?select=deliverable_id,ts,payload'
      + '&action=eq.foreign_write_detected'
      + '&ts=gte.' + encodeURIComponent(since)
      + '&order=ts.desc&limit=' + PAGE + '&offset=' + offset);
    events.push(...page);
    if (page.length < PAGE) break;
  }

  /* Latest STATE-BEARING foreign write per deliverable; the list is already
     ts-descending.

     Not simply the latest event (fixed 2026-08-22, found in review). Two kinds
     of detection share this action name: a status edit, which carries
     `payload.issue` with its workflow state, and a comment echo, which carries
     only `linear_comment_id` and no issue at all. Taking the newest of either
     meant a comment landing after an unresolved status edit became the entry
     for that row, its empty state was discarded downstream as "stateless", and
     the still-stranded status change it hid was never evaluated.

     Measured over the 14 days to 2026-08-22: 56 of 978 detections carried no
     issue, and for 16 deliverables the newest detection was one of those while
     an earlier state-bearing one existed. Those 16 were silently dropped, so
     the stranded count was computed over an incomplete set. Comment echoes are
     still counted, apart, because they are ordinary traffic on this lane and
     not a disagreement about the work. */
  const latest = new Map();
  let commentEchoRows = 0;
  const echoOnly = new Set();
  for (const ev of events) {
    const id = String(ev.deliverable_id || '');
    if (!id) continue;
    const issue = (ev.payload && ev.payload.issue) || null;
    if (!issue) { echoOnly.add(id); continue; }
    if (latest.has(id)) continue;
    latest.set(id, {
      deliverable_id: id,
      ts: ev.ts,
      identifier: String(issue.identifier || ''),
      state: String((issue.state && issue.state.name) || ''),
      team: String((issue.team && issue.team.key) || ''),
      // NOT the editor. See the report note below.
      assigned_to: String((issue.assignee && issue.assignee.name) || ''),
    });
  }
  for (const id of echoOnly) if (!latest.has(id)) commentEchoRows++;

  const ids = [...latest.keys()];
  const rows = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const got = await rest('deliverables?select=id,status,updated_at,client_slug,team,linear_identifier'
      + '&id=in.(' + chunk.map(encodeURIComponent).join(',') + ')');
    for (const r of got) rows.set(String(r.id), r);
  }

  const stranded = [];
  const unmapped = new Set();
  let ahead = 0, agreed = 0, missing = 0, stateless = 0;
  for (const fw of latest.values()) {
    const row = rows.get(fw.deliverable_id);
    if (!row) { missing++; continue; }
    // An event with no state at all carries no claim about the work, so it is
    // neither agreement nor drift — count it apart rather than letting an
    // empty string masquerade as an unrecognised workflow state.
    if (!fw.state.trim()) { stateless++; continue; }
    const expected = STATE_TO_STATUS.get(fw.state.trim().toLowerCase());
    if (!expected) { unmapped.add(fw.state); continue; }
    if (expected === String(row.status || '')) { agreed++; continue; }
    // The native row moved AFTER the foreign write: SyncView is legitimately
    // ahead and its value wins. This is the common, harmless shape.
    if (row.updated_at && Date.parse(row.updated_at) >= Date.parse(fw.ts)) { ahead++; continue; }
    stranded.push({
      issue: fw.identifier || row.linear_identifier || fw.deliverable_id,
      client: row.client_slug || '(unattributed)',
      team: fw.team || row.team || '',
      // The detection records the issue's ASSIGNEE, never the person who made
      // the edit -- no payload in the window carried an actor or updatedBy.
      // Printing the assignee as the editor would send somebody to have a
      // conversation with the wrong person, so it is labelled for what it is.
      assigned_to: fw.assigned_to || '(unassigned)',
      linear_says: fw.state,
      syncview_says: row.status,
      linear_edited_at: fw.ts,
      syncview_updated_at: row.updated_at,
    });
  }
  stranded.sort((a, b) => String(b.linear_edited_at).localeCompare(String(a.linear_edited_at)));

  const report = {
    window_days: DAYS,
    foreign_writes: events.length,
    rows_touched: latest.size,
    agreed,
    syncview_ahead: ahead,
    stranded_count: stranded.length,
    stranded,
    unmapped_states: [...unmapped],
    deliverable_row_missing: missing,
    no_state_recorded: stateless,
    comment_echo_only_rows: commentEchoRows,
  };

  if (AS_JSON) { console.log(JSON.stringify(report, null, 2)); return; }

  console.log(`Foreign writes in the last ${DAYS} day(s): ${events.length} across ${latest.size} row(s)`);
  console.log(`  agree with SyncView          ${agreed}`);
  console.log(`  SyncView moved on afterwards ${ahead}   (harmless — the native value is the right one)`);
  console.log(`  STRANDED                     ${stranded.length}   (Linear moved, SyncView never caught up)`);
  if (missing) console.log(`  no deliverable row           ${missing}`);
  if (stateless) console.log(`  event carried no state        ${stateless}`);
  if (report.comment_echo_only_rows) {
    console.log(`  comment echoes only          ${report.comment_echo_only_rows}   (no status edit on the row at all)`);
  }
  if (unmapped.size) console.log(`  unmapped Linear states       ${[...unmapped].join(', ')}`);
  if (!stranded.length) {
    console.log('\nNothing stranded. Editing in Linear is happening, but nothing is sitting in a state SyncView cannot see.');
    return;
  }
  console.log('\nStranded rows — somebody moved these in Linear and SyncView still shows the old state:');
  for (const s of stranded) {
    console.log(`  ${s.issue.padEnd(10)} ${s.client.padEnd(20)} Linear: ${String(s.linear_says).padEnd(20)} SyncView: ${String(s.syncview_says).padEnd(16)} assigned to ${s.assigned_to}`);
    console.log(`  ${''.padEnd(10)} Linear edited ${s.linear_edited_at}, SyncView last touched ${s.syncview_updated_at}`);
  }
  console.log('\nEach one needs a human decision, not an automatic repair: SyncView owns both video');
  console.log('and graphics now, so the Linear value is not automatically the truth — somebody has to say which is.');
  console.log('The name shown is who the issue is ASSIGNED to, not who edited it: the detection');
  console.log('records no actor. Start with the assignee, but do not accuse them of the edit.');
}

main().catch(e => { console.error('foreign-write-strand-check failed: ' + (e && e.message || e)); process.exit(1); });
