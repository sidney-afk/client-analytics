'use strict';
/*
 * "FREEST EDITOR" MUST COUNT VIDEOS, NOT BRIEFS.
 *
 * Measured 2026-08-27 (ledger item 50): 75 of 535 open deliverable rows are
 * batch PARENT issues — the container that titles a batch and carries its
 * brief — about 30 of them assigned to a person. Both halves of the Create
 * Post editor suggestion counted them as open work: an editor holding two
 * month-briefs was charged two phantom videos, and the "freest" pick drifted
 * toward whoever held fewer BRIEFS. One editor's board carried a brief from
 * February in `tweak` and July's whole-month container as personal overdue
 * work, which is how this surfaced.
 *
 * The rule now, on BOTH sides: a row whose issue some other row names as
 * `raw_issue_parent_id` is a parent, and parents do not count. The symmetry is
 * not optional — the browser suggests and the gateway assigns, and the default
 * path sends no assignee, so if the two count differently the dialog names one
 * person and the server picks another.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const gateway = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---- 1. the browser pool, EXECUTED with a canned estate --------------------
// The PROVIDER loader retains this exact degradation contract. Native editor
// options moved to an authenticated complete-or-refuse gateway projection, and
// the PostgREST loader this suite executes kept its body byte-for-byte under
// its new name.
const start = html.indexOf('async function _calLegacyVideoEditorPool()');
const end = html.indexOf('\n    }', html.indexOf('withLoad.sort', start)) + 6;
ok(start > -1 && end > start, 'the browser pool is findable (harness is not vacuous)');
const poolSrc = html.slice(start, end);

const PARENT_UUID = 'uuid-parent-1';
const responses = url => {
  if (url.includes('team_members')) {
    return [{ id: 'ed-a', name: 'Alma' }, { id: 'ed-b', name: 'Bruno' }];
  }
  if (url.includes('raw_issue_parent_id=not.is.null')) {
    // A child in a TERMINAL status still proves its parent is a parent.
    return [{ raw_issue_parent_id: PARENT_UUID }];
  }
  // Open rows: Alma holds two real videos plus the PARENT row; Bruno holds two.
  return [
    { assignee_id: 'ed-a', linear_issue_uuid: 'uuid-a1' },
    { assignee_id: 'ed-a', linear_issue_uuid: 'uuid-a2' },
    { assignee_id: 'ed-a', linear_issue_uuid: PARENT_UUID },
    { assignee_id: 'ed-b', linear_issue_uuid: 'uuid-b1' },
    { assignee_id: 'ed-b', linear_issue_uuid: 'uuid-b2' },
  ];
};
const pool = new Function(
  'CAL_SUPABASE_URL', 'CAL_SUPABASE_ANON_KEY', 'CAL_NATIVE_LIVE_VIDEO_STATUSES', 'fetch',
  poolSrc + '\nreturn _calLegacyVideoEditorPool;')(
  'https://x.test', 'k', ['todo', 'in_progress', 'tweak'],
  async url => ({ ok: true, json: async () => responses(url) }));

(async () => {
  const editors = await pool();
  const byId = Object.fromEntries(editors.map(e => [e.id, e]));
  ok(byId['ed-a'] && byId['ed-a'].openCount === 2,
    'a held batch parent does not count as an open video (2 real + 1 parent counts 2)');
  ok(byId['ed-b'] && byId['ed-b'].openCount === 2, 'an editor with no parents keeps a truthful count');
  ok(editors[0].id === 'ed-a',
    'the tie now breaks on NAME, which is only visible because the phantom no longer breaks it first');

  /* Without the exclusion this suggestion inverts — that is the regression. */
  const noParents = new Function(
    'CAL_SUPABASE_URL', 'CAL_SUPABASE_ANON_KEY', 'CAL_NATIVE_LIVE_VIDEO_STATUSES', 'fetch',
    poolSrc + '\nreturn _calLegacyVideoEditorPool;')(
    'https://x.test', 'k', ['todo', 'in_progress', 'tweak'],
    async url => ({ ok: true, json: async () => (url.includes('raw_issue_parent_id=not.is.null') ? [] : responses(url)) }));
  const blind = await noParents();
  ok(blind.find(e => e.id === 'ed-a').openCount === 3,
    'and with an empty parent set the same rows count 3 — so the exclusion, not the fixture, is what the pass proves');

  /* A failed parent read degrades to the uncorrected count, never to null. */
  const parentReadFails = new Function(
    'CAL_SUPABASE_URL', 'CAL_SUPABASE_ANON_KEY', 'CAL_NATIVE_LIVE_VIDEO_STATUSES', 'fetch',
    poolSrc + '\nreturn _calLegacyVideoEditorPool;')(
    'https://x.test', 'k', ['todo', 'in_progress', 'tweak'],
    async url => url.includes('raw_issue_parent_id=not.is.null')
      ? { ok: false, json: async () => [] }
      : { ok: true, json: async () => responses(url) });
  const degraded = await parentReadFails();
  ok(degraded.find(e => e.id === 'ed-a').openCount === 3,
    'a failed parent read keeps the uncorrected count — a skewed suggestion beats a picker that cannot rank');

  // ---- 2. the gateway runs the SAME rule, in SQL ---------------------------
  /*
   * 2026-09-19: the gateway stopped downloading the two populations to count
   * them. The parent read had reached 3,232 rows against PostgREST's 1,000-row
   * cap, so the picker refused and the Video editor dropdown greyed out. The
   * rule did not change -- the place it runs did.
   *
   * The degradation contract changed with it, deliberately and on the gateway
   * side only: count and exclusion are now one statement, so there is no
   * second read left to fail halfway. A count that cannot be established is
   * refused rather than reported. The BROWSER's provider loader above keeps
   * its degradation, because a skewed suggestion still beats a picker that
   * cannot rank.
   */
  const openLoadSql = fs.readFileSync(
    path.join(ROOT, 'migrations', '2026-09-19-native-intake-open-load.sql'), 'utf8');
  ok(/raw_issue_parent_id is not null/.test(openLoadSql)
    && /from public\.production_deliverables_browser_v1 v\s*\n\s*where v\.team = p_team/.test(openLoadSql),
    'the parent set is read over the whole team, not just the open rows');
  ok(/not exists \(\s*\n?\s*select 1 from parents p where p\.issue_uuid = d\.linear_issue_uuid\)/.test(openLoadSql),
    'and parents are excluded inside the same aggregate that counts');
  ok(/intakeOpenLoad\(supabase, "video", "assignee_load_unavailable"\)/.test(gateway)
    && /intakeOpenLoad\(supabase, "video", "intake_editor_options_unavailable"\)/.test(gateway),
    'both gateway paths -- the auto pick and the picker projection -- take that one aggregate');
  ok(!/select\("assignee_id,status,linear_issue_uuid"\)/.test(gateway)
    && !/\.select\("raw_issue_parent_id"\)/.test(gateway),
    'and neither downloads open-work or parent rows any more, so no page cap can truncate the count');

  // ---- 3. the symmetry that keeps the suggestion honest --------------------
  const browserStatuses = (html.match(/CAL_NATIVE_LIVE_VIDEO_STATUSES = \[([^\]]+)\]/) || [])[1];
  const gatewayStatuses = (gateway.match(/INTAKE_LOAD_LIVE_STATUSES = Object\.freeze\(\[([^\]]+)\]\)/) || [])[1];
  ok(!!browserStatuses && !!gatewayStatuses
    && browserStatuses.replace(/['"\s]/g, '') === gatewayStatuses.replace(/['"\s]/g, ''),
    'both sides still count over the SAME live statuses — the contract the default no-assignee path depends on');

  if (failures) {
    console.error(`\n${failures} editor-count parent-exclusion check(s) failed`);
    process.exit(1);
  }
  console.log('\neditor count excludes parents on both sides');
})();
