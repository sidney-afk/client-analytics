'use strict';
/*
 * No base-table query may name a column only the VIEW derives.
 *
 * THIS HAS NOW HAPPENED THREE TIMES, in the same file, with the same masking:
 *
 *   1. autoAssigneeForIntake asked `deliverables` for `raw_issue_parent_id`.
 *      PostgREST answered 42703. That read degrades to an empty set by design,
 *      so the parent-exclusion silently never applied.
 *   2. The same wrong column killed the B1 import lane on 2026-08-27 -- which
 *      does NOT degrade, which is the only reason anyone found out about (1).
 *   3. The child-batch borrow in assetSnapshot, caught by review on the PR that
 *      added it (2026-09-01). It would have been invisible again: the borrow
 *      swallows a failed child lookup so a blip cannot 503 the asset panel, so
 *      a permanently malformed query and "this parent has no children" are the
 *      same observable outcome.
 *
 * Every one of these is a query that RUNS, returns an error nobody reads, and
 * leaves a feature quietly doing nothing. A unit test cannot reach PostgREST,
 * and the fakes in the feature tests answer whatever they are told to -- so
 * neither layer can catch it. This file can: the column list is a fact about
 * the schema, and the call sites are text.
 *
 * The list is deliberately the `raw_*` and `identity_repair_*` families, which
 * is the naming convention for "computed from linear_raw by the view". Verified
 * against the live schema on 2026-09-01: all six answer 42703 on the table and
 * resolve on the view, while linear_issue_uuid, batch_id and client_slug are
 * real table columns and are NOT listed.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FUNCTIONS = path.join(ROOT, 'supabase/functions');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Columns the browser view computes and the table does not carry. */
const VIEW_ONLY = [
  'raw_issue_parent_id',
  'raw_project_id',
  'raw_issue_archived_at',
  'raw_issue_canceled_at',
  'identity_repair_state',
  'identity_repair_reason',
];

/* Base tables whose PostgREST surface does not carry them. */
const BASE_TABLES = ['deliverables'];

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/* A query CHAIN: from the `.from("<table>")` call to the end of the statement.
   PostgREST chains are written as one expression, so the statement boundary is
   where the column references stop belonging to this table. */
function queryChains(source, table) {
  const chains = [];
  const marker = `.from("${table}")`;
  let at = source.indexOf(marker);
  while (at >= 0) {
    let depth = 0;
    let end = at + marker.length;
    for (; end < source.length; end++) {
      const c = source[end];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      else if (c === ';' && depth <= 0) break;
    }
    chains.push({ index: at, text: source.slice(at, end) });
    at = source.indexOf(marker, at + marker.length);
  }
  return chains;
}

const files = walk(FUNCTIONS, []);
ok(files.length > 0, 'the edge-function sources are readable');

let chainCount = 0;
const offenders = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const table of BASE_TABLES) {
    for (const chain of queryChains(source, table)) {
      chainCount++;
      for (const column of VIEW_ONLY) {
        if (chain.text.includes(`"${column}"`) || chain.text.includes(`'${column}'`)) {
          const line = source.slice(0, chain.index).split('\n').length;
          offenders.push(`${path.relative(ROOT, file)}:${line} — .from("${table}") names ${column}`);
        }
      }
    }
  }
}

ok(chainCount > 0,
  'the sweep actually found base-table queries to check — a scan that matches nothing would pass forever');
ok(offenders.length === 0,
  'no base-table query names a view-derived column' + (offenders.length ? ':\n    ' + offenders.join('\n    ') : ''));

/* The sweep must be able to FAIL. A guard whose detector is broken is worse
   than no guard, because it reads as coverage. */
{
  const fake = 'const x = await supabase.from("deliverables")\n  .select("batch_id")\n  .eq("raw_issue_parent_id", uuid);';
  const chains = queryChains(fake, 'deliverables');
  ok(chains.length === 1 && chains[0].text.includes('"raw_issue_parent_id"'),
    'the detector catches the exact shape that shipped three times, so this file is proven able to fail');
}
{
  const safe = 'const x = await supabase.from("production_deliverables_browser_v1")\n  .eq("raw_issue_parent_id", uuid);';
  ok(queryChains(safe, 'deliverables').length === 0,
    'and does not flag the VIEW, which is where these columns legitimately live');
}

/* The three call sites this exists for, pinned by name so a rename cannot
   quietly move one of them back onto the table. */
const GATEWAY = fs.readFileSync(
  path.join(ROOT, 'supabase/functions/production-write/index.ts'), 'utf8');
ok((GATEWAY.match(/\.from\("production_deliverables_browser_v1"\)/g) || []).length >= 2,
  'both parent-uuid readers in the gateway go to the view: the intake auto-assign exclusion and the asset borrow');

console.log(failures === 0
  ? '\ndeliverables view-only column checks passed'
  : '\n' + failures + ' view-only column check(s) failed');
process.exit(failures === 0 ? 0 : 1);
