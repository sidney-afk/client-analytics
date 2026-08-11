'use strict';
/*
 * B1 must not destroy the Linear label relation it does not read.
 *
 * WHAT THIS FIXES. `loadIssues` selected the issue without `labels`, and
 * `deliverableRow` stores that issue verbatim as `linear_raw.issue` — while
 * `deliverableFields` lists `linear_raw`, so the incremental plan REPLACES the
 * column wholesale on every write. Any relation `linear-inbound` had written
 * (it is careful: supabase/functions/linear-inbound/index.ts:451-452 preserves
 * the previous labels when an event omits them) was therefore deleted the next
 * time B1 touched that issue, and `production_workload_label_projection`
 * (migrations/2026-07-23-f34-f53-production-attachments.sql:64) fell to
 * `complete: false`. Because `sameValue` compares objects with a bare
 * JSON.stringify, a stored relation always differed from B1's label-less build,
 * so the rewrite fired — a one-way ratchet toward stripped.
 *
 * WHY IT WAS INVISIBLE. Nothing reads the projection while both teams are
 * Linear-authoritative: `wlFetchLinearMetadata` routes an issue to the native
 * reader only when `authority[team] === 'syncview'` (index.html:13990), so
 * today `nativeIds` is always empty. The damage is 100% latent and fires for
 * the first time at F1, on every graphics issue at once. Measured on live data
 * 2026-08-10: 133 of the 319 active graphics sub-issues that HAVE a
 * deliverables row were already at `complete: false`.
 *
 * THE ORDERING THIS LOCKS IN. `deliverableAllowed` in the incremental plan
 * writes a row only while its team is Linear-authoritative, so B1 stops
 * repairing graphics the moment F1 lands. The healing full-window run must
 * therefore happen BEFORE F1, never after — see docs/ops/FLIP_RUNBOOK.md.
 */
const path = require('node:path');
const fs = require('node:fs');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'scripts', 'b1-linear-backfill.js'), 'utf8');
const projectionSql = fs.readFileSync(
  path.join(ROOT, 'migrations', '2026-07-23-f34-f53-production-attachments.sql'), 'utf8');

// --- 1. The selection actually asks Linear for the relation ----------------
const queryMatch = source.match(/query B1BackfillIssues[\s\S]*?\n    \}`/);
ok(Boolean(queryMatch), 'the B1 issue query is extractable');
const query = queryMatch ? queryMatch[0] : '';

const labelsMatch = query.match(/labels\(first:\s*(\d+)\)\s*\{([\s\S]*?)\}\s*\}/);
ok(Boolean(labelsMatch), 'the issue selection requests a labels connection');
const labelSelection = labelsMatch ? labelsMatch[2] : '';
ok(/nodes\s*\{[^}]*\bid\b/.test(labelSelection), 'labels.nodes selects id — the projection rejects a node without one');
ok(/nodes\s*\{[^}]*\bname\b/.test(labelSelection), 'labels.nodes selects name — the weight is keyed on it');
ok(/nodes\s*\{[^}]*\bcolor\b/.test(labelSelection), 'labels.nodes selects color — the pill renders it');
ok(/pageInfo\s*\{[^}]*hasNextPage/.test(labelSelection),
  'labels selects pageInfo.hasNextPage — a relation without it is incomplete by definition');

// The page size and the SQL node ceiling must agree, or a fully-selected
// relation could still be rejected downstream for being too long.
const ceilingMatch = projectionSql.match(/jsonb_array_length\(v_nodes\)\s*>\s*(\d+)/);
ok(Boolean(ceilingMatch), "the SQL projection's node ceiling is extractable");
const ceiling = ceilingMatch ? Number(ceilingMatch[1]) : 0;
const pageSize = labelsMatch ? Number(labelsMatch[1]) : Infinity;
ok(pageSize <= ceiling,
  `labels(first: ${pageSize}) is within the projection's ${ceiling}-node ceiling`);

// --- 2. The relation reaches the stored column -----------------------------
ok(/linear_raw:\s*withAttribution\(\{\s*\n\s*issue,/.test(source),
  'linear_raw stores the fetched issue verbatim, so a selected relation is a stored relation');
ok(/const deliverableFields = \[[^\]]*'linear_raw'/.test(source),
  'linear_raw is a compared field, so a restored relation is actually written back');

// --- 3. The projection's completeness rules, ported from the SQL -----------
/* Mirrors production_workload_label_projection's completeness test. Kept
 * deliberately literal so a reader can diff it against the SQL above. */
function projectionComplete(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const issue = raw.issue;
  const relation = issue && issue.labels;
  if (!issue || typeof issue !== 'object') return false;
  if (!relation || typeof relation !== 'object' || Array.isArray(relation)) return false;
  const nodes = relation.nodes;
  const pageInfo = relation.pageInfo;
  if (!Array.isArray(nodes)) return false;
  if (!pageInfo || typeof pageInfo !== 'object' || Array.isArray(pageInfo)) return false;
  if (typeof pageInfo.hasNextPage !== 'boolean' || pageInfo.hasNextPage !== false) return false;
  if (nodes.length > ceiling) return false;
  const ids = new Set();
  const names = new Set();
  for (const node of nodes) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
    const id = String(node.id == null ? '' : node.id).trim();
    const name = String(node.name == null ? '' : node.name).trim();
    if (!id || id.length > 200 || !name || name.length > 200) return false;
    if (ids.has(id) || names.has(name)) return false;
    ids.add(id);
    names.add(name);
  }
  return true;
}

// The exact shape the fixed selection yields for an issue carrying no labels —
// the common case, and the one that was silently failing.
const fixedShape = { issue: { id: 'i1', labels: { nodes: [], pageInfo: { hasNextPage: false } } } };
ok(projectionComplete(fixedShape) === true,
  'an issue with no labels still projects complete — "no labels" is a fact, not an absence of data');

const weighted = {
  issue: {
    id: 'i1',
    labels: {
      nodes: [{ id: 'l1', name: '3× Workload', color: '#AABBCC' }],
      pageInfo: { hasNextPage: false },
    },
  },
};
ok(projectionComplete(weighted) === true, 'a weighted issue projects complete');

// The shape B1 produced BEFORE this fix. If this ever passes, the regression
// is back and the test above has stopped meaning anything.
const strippedShape = { issue: { id: 'i1' } };
ok(projectionComplete(strippedShape) === false,
  'the pre-fix shape (issue with no labels key at all) is INCOMPLETE — this is the defect being fixed');
ok(projectionComplete({ issue: { id: 'i1', labels: { nodes: [], pageInfo: { hasNextPage: true } } } }) === false,
  'a paginated relation is incomplete, so the page size must stay within the ceiling');

// --- 4. The ordering constraint the heal depends on ------------------------
ok(/const deliverableAllowed = row => authorityState\.write_safe === true\s*\n\s*&& authorityForTeam\(prodAuthority, row\.team\) === 'linear';/.test(source),
  'B1 writes a deliverable only while its team is Linear-authoritative — so the healing run MUST precede F1');

if (failures) {
  console.error(`\n${failures} B1 workload-label check(s) failed`);
  process.exit(1);
}
console.log('\nB1 workload-label preservation checks passed');
