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
// The provider loader retains this exact degradation contract; native options
// now have a separate authenticated complete-or-refuse projection.
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

  // ---- 2. the gateway runs the SAME rule -----------------------------------
  ok(/select\("assignee_id,status,linear_issue_uuid"\)/.test(gateway),
    'the gateway load read carries the uuid it needs to recognise a parent');
  ok(/select\("raw_issue_parent_id"\)[\s\S]{0,120}not\("raw_issue_parent_id", "is", null\)/.test(gateway),
    'and reads the parent set over the whole team, not just the open rows');
  ok(/if \(parentUuids\.has\(clean\(row\.linear_issue_uuid\)\)\) continue;/.test(gateway),
    'and skips parents in the same loop that counts');
  ok(/catch \(_\) \{ parentUuids = new Set<string>\(\); \}/.test(gateway),
    'with the same degradation: a failed parent read leaves the count uncorrected rather than refusing intake');

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
