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
 * It also counts the rows a PROVIDER lane would still refuse (active creatives
 * with no stored linear_user_id), because that is the population on which the
 * two lanes disagree: the native lane admits them, the provider lane and the
 * browser's Create Post pool (which still filters linear_user_id=not.is.null)
 * do not. Zero there means the lanes cannot disagree on today's roster.
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
      '-c', "select coalesce(json_agg(t), '[]'::json) from (select role, team, active, default_for_team, (linear_user_id is not null and linear_user_id <> '') as mapped from public.team_members) t;"],
    { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('psql read failed: ' + (r.stderr || '').trim().slice(0, 200));
    const rows = JSON.parse(r.stdout.trim() || '[]').map(row => ({ ...row, linear_user_id: row.mapped ? 'mapped' : null }));
    return { source: 'disposable-postgres', rows };
  }
  if (flag('--rest')) {
    const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const key = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '');
    if (!base || !key) throw new Error('--rest needs SUPABASE_URL and SUPABASE_ANON_KEY (read-only publishable key)');
    // Only the columns the rule reads; no name, email or slack id leaves the table.
    const response = await fetch(base + '/rest/v1/team_members?select=role,team,active,default_for_team,linear_user_id&limit=1000', {
      headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('team_members read failed: HTTP ' + response.status);
    const rows = await response.json();
    return { source: 'rest-read-only', rows: Array.isArray(rows) ? rows : [] };
  }
  throw new Error('choose a source: --file <rows.json> | --pg | --rest');
}

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
