'use strict';
// OPEN_REPAIRS 101 follow-up (2026-09-28): migration 20260928060000.
// Proves on a disposable PostgreSQL 16 that:
//   - a retry that reuses the page's attempt id attaches to the first row and
//     bumps `attempts` (one row per click), and the list returns the count;
//   - a network failure records code 'network_failure' with NO status;
//   - a network_failure code is still refused on any other shape, and an
//     unknown code is still refused (the widened rule kept the old list);
//   - a gateway replay through v1 is still a duplicate, not a conflict;
//   - the migration applies twice; grants are unchanged.
// Needs WRITE_REFUSAL_TEST_PG=<psql connection args> naming a THROWAWAY server.
const assert = require('assert/strict');
const cp = require('child_process');
const path = require('path');

const conn = process.env.WRITE_REFUSAL_TEST_PG;
if (!conn) { console.log('write-refusal-attempts-network-postgres: NOT_RUN (set WRITE_REFUSAL_TEST_PG to a disposable server)'); process.exit(0); }
const args = conn.split(/\s+/).filter(Boolean);
const db = 'refusal_attempts_network_' + process.pid;
const root = path.join(__dirname, '..');
const psql = (sql, database = db) => cp.execFileSync('psql', [...args, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const file = f => cp.execFileSync('psql', [...args, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', path.join(root, f)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const fails = (sql, pattern, message) => {
  let err = null;
  try { psql(sql); } catch (e) { err = e; }
  assert(err, message + ' (expected a refusal)');
  if (pattern) assert.match(String(err.stderr || err.message), pattern, message);
};
const MIGRATION = 'supabase/migrations/20260928060000_write_refusal_attempts_and_network.sql';

(async () => {
  psql(`create database ${db}`, 'postgres');
  try {
    psql(`do $$begin
      if not exists (select from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin; end if;
    end$$`);
    file('supabase/migrations/20260913044451_write_refusal_diagnostics_preparation.sql');
    file('supabase/migrations/20260925180000_write_refusal_page_and_traffic.sql');
    file('supabase/migrations/20260927200000_write_refusal_detail_and_viewer.sql');
    file(MIGRATION);
    file(MIGRATION);
    const api = await import(path.join(root, 'supabase/functions/_shared/write-refusal-diagnostics.mjs'));
    const shape = await import(path.join(root, 'supabase/functions/write-diagnostics/browser-detail.mjs'));
    const q = v => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
    const rec = (r, d = {}) => JSON.parse(psql(`set role service_role; select public.production_write_refusal_record_browser_v2(${q(r)}, ${q(d)})`).split('\n').pop());
    const row = id => JSON.parse(psql(`select row_to_json(r) from write_refusal_diagnostics.receipts_v1 r where attempt_id='${id}'`));
    const claim = async (body, code, status) => shape.shapeBrowserReceipt(await api.makeRefusalReceipt({ surface: 'calendar', operation: 'status', identifiers: { card: 'p_card_1' } }, code, status, 'browser_claim', { traffic: 'automation', claimed_page: 'client_link' }), body);

    const attempt = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const first = await claim({ attempt }, 'write_conflict', 409);
    assert.equal(first.attempt_id, attempt);
    assert.deepEqual(rec(first, { detail: 'Changed elsewhere' }), { recorded: true, duplicate: false });
    const retry = await claim({ attempt }, 'write_conflict', 409);
    assert.deepEqual(rec(retry, { detail: 'Changed elsewhere' }), { recorded: true, duplicate: true });
    assert.deepEqual(rec(retry, { detail: 'Changed elsewhere' }), { recorded: true, duplicate: true });
    assert.equal(Number(psql(`select count(*) from write_refusal_diagnostics.receipts_v1 where attempt_id='${attempt}'`)), 1, 'one row per click');
    assert.equal(row(attempt).attempts, 3, 'the retries are counted on the first row');
    const listed = JSON.parse(psql(`set role service_role; select public.production_write_refusal_list_v1(7, true, 10, null, null)`).split('\n').pop());
    assert(listed.rows.some(r => r.attempts === 3), 'the list returns the count');

    const net = await claim({ failure: 'network' }, undefined, undefined);
    assert.equal(net.code, 'network_failure'); assert.equal(net.status, null);
    rec(net, { detail: 'Failed to fetch' });
    const n = row(net.attempt_id);
    assert.equal(n.code, 'network_failure'); assert.equal(n.status, null, 'no invented 500');
    assert.equal(n.attempts, 1);

    const bad = await claim({}, 'write_conflict', 409);
    fails(`set role service_role; select public.production_write_refusal_record_browser_v2(${q({ ...bad, code: 'made_up_code' })}, '{}'::jsonb)`, /check constraint/, 'an unknown code is still refused');
    fails(`set role service_role; select public.production_write_refusal_record_browser_v2(${q({ ...bad, status: 200 })}, '{}'::jsonb)`, /check constraint/, 'a status outside 400-599 is still refused');

    const gw = await api.makeRefusalReceipt({}, 'write_conflict', 409);
    const v1 = r => JSON.parse(psql(`set role service_role; select public.production_write_refusal_record_v1(${q(r)})`).split('\n').pop());
    assert.deepEqual(v1(gw), { recorded: true, duplicate: false });
    assert.deepEqual(v1(gw), { recorded: true, duplicate: true }, 'a gateway replay is still a duplicate');

    for (const role of ['anon', 'authenticated']) {
      fails(`set role ${role}; select public.production_write_refusal_record_browser_v2(${q(await claim({}, 'write_conflict', 409))}, '{}'::jsonb)`, /permission denied/, role + ' cannot record');
      fails(`set role ${role}; select public.production_write_refusal_list_v1()`, /permission denied/, role + ' cannot list');
    }
    for (const role of ['anon', 'authenticated', 'service_role']) fails(`set role ${role}; select count(*) from write_refusal_diagnostics.receipts_v1`, /permission denied/, role + ' cannot read receipts');
    console.log('write-refusal-attempts-network-postgres: one row per click, network failures without a status, all private ✅');
  } finally {
    psql(`drop database if exists ${db} with (force)`, 'postgres');
  }
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
