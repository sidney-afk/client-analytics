#!/usr/bin/env node
'use strict';
/*
 * NATIVE ASSIGNEE CATALOG — aggregate readiness dry-run.
 *
 * Answers one operator question before a native intake epoch is ever enabled:
 * can the native roster (`team_members`) support assignment on each team
 * without Linear? It applies the SAME rule the gateway applies per request
 * (nativeAssigneeCatalogReadiness in production-write/policy.mjs: at least one
 * active editor on video; exactly one active default designer on graphics)
 * to the whole roster at once, and reports COUNTS ONLY. It never prints a
 * name, an id, an email or a provider identifier, so its output is safe for a
 * public ledger. It writes nothing anywhere.
 *
 * It also counts the rows a PROVIDER lane would still refuse
 * (`provider_lane_would_refuse`): active creatives whose STORED linear_user_id
 * is missing or not a well-formed id. That is a stored-mapping measure only;
 * it says nothing about live provider activity or reachability, which no
 * dry-run can know. It matters because it is the population on which the two
 * lanes disagree: the native lane admits them, the provider lane and the
 * browser's Create Post pool (which still filters linear_user_id=not.is.null)
 * do not. Zero there means the lanes cannot disagree on today's roster.
 *
 * A REST read is only evidence when it is COMPLETE. The read pages through the
 * table with exact counts and refuses to report readiness at all when the
 * server's total is unknown, the pages do not add up to it, or the roster is
 * larger than the bounded page budget: an unproven roster is exit 1, never
 * "ready".
 *
 * Sources, in order of preference for evidence:
 *   --file <rows.json>   an exported array of team_members rows (offline)
 *   --pg                 a DISPOSABLE loopback PostgreSQL (NIR_PG* / PG* env,
 *                        loopback hosts only) — what the lane tests use
 *   --rest               a read-only GET of /rest/v1/team_members with the
 *                        publishable key (SUPABASE_URL + SUPABASE_ANON_KEY);
 *                        opt-in, never the default, and still not serving
 *                        evidence for the gateway
 *
 * Exit code: 0 when every team is ready, 2 when not, 1 on a read failure.
 * Source alone is not serving evidence: a green dry-run says the roster can
 * support native assignment, not that the native lane is deployed or enabled.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ''; };

const REST_PAGE = 500;
const REST_MAX_PAGES = 20;

/* Complete-or-refuse paging over PostgREST. Every page asks for the exact
   total (Prefer: count=exact); exact intervals, body lengths and unique member
   identities must cover that same total within the page budget; otherwise the
   read is unproven and the caller must not report readiness. This checks page
   coverage, not a transactional snapshot of concurrent roster edits. Exported
   for the offline test, which drives it with a fake fetch. */
async function readRestComplete(base, key, fetchImpl) {
  const rows = [];
  const seen = new Set();
  let total = null;
  for (let page = 0; page < REST_MAX_PAGES; page++) {
    const from = page * REST_PAGE;
    const to = from + REST_PAGE - 1;
    // Member id is needed for eligibility and distinct coverage, but is never
    // emitted by the aggregate report. No name, email or slack id is read.
    const response = await fetchImpl(base + '/rest/v1/team_members?select=id,role,team,active,default_for_team,linear_user_id&order=id.asc', {
      headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json', Range: from + '-' + to, 'Range-Unit': 'items', Prefer: 'count=exact' },
    });
    if (!(response.status === 200 || response.status === 206)) throw new Error('team_members read failed: HTTP ' + response.status);
    const match = /^(?:items )?(?:(\d+)-(\d+)|\*)\/(\d+|\*)$/.exec(String(response.headers.get('content-range') || '').trim());
    if (!match || match[3] === '*') throw new Error('unproven_roster_read: server did not report an exact total');
    const reported = Number(match[3]);
    if (!Number.isSafeInteger(reported) || reported < 0) throw new Error('unproven_roster_read: invalid exact total');
    if (reported > REST_PAGE * REST_MAX_PAGES) throw new Error('unproven_roster_read: roster exceeds the bounded page budget');
    if (total !== null && reported !== total) throw new Error('unproven_roster_read: total changed between pages');
    total = reported;
    const pageRows = await response.json();
    if (!Array.isArray(pageRows)) throw new Error('unproven_roster_read: page was not an array');
    if (total === 0) {
      if (from !== 0 || match[1] !== undefined || pageRows.length !== 0) throw new Error('unproven_roster_read: invalid empty range');
      return rows;
    }
    const rangeStart = Number(match[1]);
    const rangeEnd = Number(match[2]);
    if (!Number.isSafeInteger(rangeStart) || !Number.isSafeInteger(rangeEnd)
        || rangeStart !== from || rangeEnd !== Math.min(to, total - 1)
        || pageRows.length !== rangeEnd - rangeStart + 1) {
      throw new Error('unproven_roster_read: page range or body length does not match the requested coverage');
    }
    for (const row of pageRows) {
      const id = row && typeof row.id === 'string' ? row.id : '';
      if (!id || id !== id.trim() || seen.has(id)) throw new Error('unproven_roster_read: missing or repeated member identity');
      seen.add(id);
    }
    rows.push(...pageRows);
    if (rows.length >= total) break;
    if (!pageRows.length) throw new Error('unproven_roster_read: empty page before the total was reached');
  }
  if (total === null || rows.length !== total) {
    throw new Error('unproven_roster_read: ' + rows.length + ' rows read of ' + total + ' reported (page budget ' + (REST_PAGE * REST_MAX_PAGES) + ')');
  }
  return rows;
}

async function readRows() {
  if (value('--file')) {
    const rows = JSON.parse(fs.readFileSync(path.resolve(value('--file')), 'utf8'));
    return { source: 'file', rows: Array.isArray(rows) ? rows : [] };
  }
  if (flag('--pg')) {
    const host = process.env.NIR_PGHOST || process.env.PGHOST || '';
    if (!['localhost', '127.0.0.1', '::1'].includes(host) && !host.startsWith('/')) {
      throw new Error('--pg accepts only a disposable loopback PostgreSQL');
    }
    const psql = process.env.NIR_PSQL || 'psql';
    const r = spawnSync(psql, ['-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A',
      '-h', host, '-p', process.env.NIR_PGPORT || process.env.PGPORT || '5432',
      '-U', process.env.NIR_PGUSER || process.env.PGUSER || 'postgres',
      '-d', process.env.NIR_PGDATABASE || process.env.PGDATABASE || 'postgres',
      '-c', "select coalesce(json_agg(t), '[]'::json) from (select id, role, team, active, default_for_team, linear_user_id from public.team_members) t;"],
    { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('psql read failed: ' + (r.stderr || '').trim().slice(0, 200));
    // Preserve the input for the shared policy's validity check; raw mapping
    // values stay private and only aggregate counts reach the report.
    const rows = JSON.parse(r.stdout.trim() || '[]');
    return { source: 'disposable-postgres', rows };
  }
  if (flag('--rest')) {
    const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const key = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '');
    if (!base || !key) throw new Error('--rest needs SUPABASE_URL and SUPABASE_ANON_KEY (read-only publishable key)');
    return { source: 'rest-read-only', rows: await readRestComplete(base, key, globalThis.fetch) };
  }
  throw new Error('choose a source: --file <rows.json> | --pg | --rest');
}

module.exports = { readRestComplete, REST_PAGE, REST_MAX_PAGES };
if (require.main !== module) return;

(async () => {
  const policy = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/production-write/policy.mjs')).href);
  const { source, rows } = await readRows();
  const report = policy.nativeAssigneeCatalogReadiness(rows);
  const out = {
    dry_run: 'native-assignee-catalog',
    source,
    serving_evidence: false,
    ready: report.ready,
    totals: report.totals,
    teams: report.teams,
    provider_lane_would_refuse_means: 'active creatives whose stored linear_user_id is missing or malformed; not live provider activity or reachability',
    activation_gate: report.ready
      ? 'roster supports native assignment on both teams; serving/deploy/activation proof is separate'
      : 'DO NOT enable a native epoch for a team that is not ready',
  };
  console.log(JSON.stringify(out, null, 2));
  process.exit(report.ready ? 0 : 2);
})().catch(error => {
  console.error('native-assignee-catalog dry-run failed: ' + error.message);
  process.exit(1);
});
