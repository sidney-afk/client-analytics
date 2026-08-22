'use strict';
/*
 * The stranded-foreign-write report must stay HONEST IN BOTH DIRECTIONS.
 *
 * Post-flip, editing a graphics issue in Linear records a
 * `foreign_write_detected` event and is deliberately not applied. 976 of those
 * landed in the seven days to 2026-08-22 and nothing reported them, so it was
 * tempting to raise the raw count as an alarm. Measured, that would have been
 * a 900-a-week false alarm: for all but two rows SyncView had already moved
 * the same row on its own afterwards, which makes the NATIVE value the correct
 * one and the foreign write merely noise.
 *
 * So the report has exactly two ways to lie, and this suite pins both:
 *   - calling a harmless write STRANDED (the alarm-fatigue failure the health
 *     check exists to prevent), and
 *   - calling a genuinely stranded row harmless, which is somebody's work
 *     sitting where nobody downstream can see it.
 *
 * It runs the real classifier out of the script against fixtures, with the
 * network stubbed, so a change to the rule shows up here rather than in a
 * silent weekly number.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.env.STRAND_CHECK_SRC || path.join(ROOT, 'scripts', 'foreign-write-strand-check.js');
const source = fs.readFileSync(SRC, 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const NOW = Date.parse('2026-08-22T00:00:00Z');
const ago = h => new Date(NOW - h * 3600000).toISOString();

/* Fixture world. One row of each shape the live data actually contains. */
const EVENTS = [
  // stranded: Linear moved to Approved, native still smm_approval and older
  { deliverable_id: 'd-stranded', ts: ago(30), payload: { issue: {
    identifier: 'GRA-6950', state: { name: 'Approved' }, team: { key: 'GRA' },
    assignee: { name: 'A Designer' } } } },
  // harmless: native moved on AFTER the foreign write
  { deliverable_id: 'd-ahead', ts: ago(30), payload: { issue: {
    identifier: 'GRA-7000', state: { name: 'Tweak Needed' }, team: { key: 'GRA' },
    assignee: { name: 'A Designer' } } } },
  // agreement: both sides say the same thing
  { deliverable_id: 'd-agree', ts: ago(30), payload: { issue: {
    identifier: 'GRA-7001', state: { name: 'For SMM approval' }, team: { key: 'GRA' } } } },
  // an older event for the SAME row as d-stranded: must be ignored in favour
  // of the newest one, or a fixed row would keep reporting for ever
  { deliverable_id: 'd-stranded', ts: ago(200), payload: { issue: {
    identifier: 'GRA-6950', state: { name: 'Todo' }, team: { key: 'GRA' } } } },
  // a state this script has never heard of: reported, never counted as drift
  { deliverable_id: 'd-unmapped', ts: ago(30), payload: { issue: {
    identifier: 'GRA-7002', state: { name: 'Waiting On Client Assets' }, team: { key: 'GRA' } } } },
  // an event carrying no state at all makes no claim about the work
  { deliverable_id: 'd-stateless', ts: ago(30), payload: { issue: {
    identifier: 'GRA-7003', team: { key: 'GRA' } } } },
  // a foreign write whose deliverable row no longer exists
  { deliverable_id: 'd-gone', ts: ago(30), payload: { issue: {
    identifier: 'GRA-7004', state: { name: 'Approved' }, team: { key: 'GRA' } } } },
];
const ROWS = [
  { id: 'd-stranded', status: 'smm_approval', updated_at: ago(240), client_slug: 'clientx', team: 'graphics', linear_identifier: 'GRA-6950' },
  { id: 'd-ahead', status: 'client_approval', updated_at: ago(2), client_slug: 'clienty', team: 'graphics', linear_identifier: 'GRA-7000' },
  { id: 'd-agree', status: 'smm_approval', updated_at: ago(240), client_slug: 'clientz', team: 'graphics', linear_identifier: 'GRA-7001' },
  { id: 'd-unmapped', status: 'todo', updated_at: ago(240), client_slug: 'clientz', team: 'graphics', linear_identifier: 'GRA-7002' },
  { id: 'd-stateless', status: 'todo', updated_at: ago(240), client_slug: 'clientz', team: 'graphics', linear_identifier: 'GRA-7003' },
];

function run(events, rows) {
  const out = [];
  const sandbox = {
    console: { log: m => out.push(String(m)), error: m => out.push('ERR ' + m) },
    process: { argv: ['node', 'script', '--json'], env: {}, exit: code => { throw new Error('exit:' + code); } },
    Date, Math, Number, String, Boolean, Object, Array, Set, Map, JSON, encodeURIComponent,
    fetch: async (url) => {
      const u = String(url);
      const body = u.includes('deliverable_events')
        ? (u.includes('offset=0') ? events : [])
        : rows.filter(r => u.includes(encodeURIComponent(r.id)) || u.includes(r.id));
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return new Promise(resolve => setTimeout(() => resolve(out.join('\n')), 60));
}

(async () => {
  const text = await run(EVENTS, ROWS);
  let report;
  try { report = JSON.parse(text); }
  catch (e) { console.error('FAIL  the script did not emit JSON. Output was:\n' + text.slice(0, 500)); process.exit(1); }

  ok(report && typeof report === 'object', 'the real script runs and reports (harness is not vacuous)');
  ok(report.stranded_count === 1, 'exactly one fixture row is stranded (got ' + report.stranded_count + ')');
  const s = (report.stranded || [])[0] || {};
  ok(s.issue === 'GRA-6950', 'the stranded row is the one whose native value never caught up');
  ok(s.linear_says === 'Approved' && s.syncview_says === 'smm_approval',
    'it reports BOTH sides, so a human can judge which is right');
  ok(s.client === 'clientx' && s.edited_by === 'A Designer',
    'it names the client and the person, because the remedy is a conversation');

  ok(report.syncview_ahead === 1,
    'a row SyncView moved on afterwards is HARMLESS, not stranded — this is the alarm-fatigue guard');
  ok(!(report.stranded || []).some(r => r.issue === 'GRA-7000'),
    'and that harmless row never appears in the stranded list');
  ok(report.agreed === 1, 'a row both sides agree on is counted as agreement');
  ok(report.unmapped_states.length === 1 && report.unmapped_states[0] === 'Waiting On Client Assets',
    'an unrecognised Linear state is REPORTED rather than silently treated as drift');
  ok(!(report.stranded || []).some(r => r.issue === 'GRA-7002'),
    'and an unrecognised state is never counted as stranded — a new workflow state must not cry wolf');
  ok(report.no_state_recorded === 1, 'an event carrying no state is counted apart, not as an unmapped state');
  ok(report.deliverable_row_missing === 1, 'a foreign write whose row is gone is counted, not crashed on');
  ok(report.foreign_writes === EVENTS.length && report.rows_touched === 6,
    'the raw volume is still reported, so the working habit stays visible');

  // The newest event per row must win: an older Todo event for the same row
  // must not resurrect a row that has since been moved on.
  ok(!(report.stranded || []).some(r => r.linear_says === 'Todo'),
    'only the LATEST foreign write per row is judged, so a superseded event cannot report for ever');

  // A world with nothing wrong must say so rather than inventing a finding.
  const clean = await run(
    [EVENTS[2]],
    [ROWS[2]],
  );
  const cleanReport = JSON.parse(clean);
  ok(cleanReport.stranded_count === 0 && cleanReport.agreed === 1,
    'a clean world reports zero stranded rows');

  // It is a CONTEXT report: it must never fail a run, whatever it finds.
  ok(/Exit 0 always/.test(source) && !/process\.exit\(1\)[\s\S]{0,80}stranded/.test(source),
    'the check never gates — a foreign write is a human choice, not a fault');

  if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
  console.log('\nall green');
})().catch(e => { console.error('FAIL  harness: ' + (e && e.message)); process.exit(1); });
