'use strict';
// Refusal-log triage 2026-09-25: receipts gain two OPTIONAL fields,
// claimed_page (browser claims only) and traffic (person | automation).
// Proves on a disposable PostgreSQL 16 that:
//   - the original 9-key shape still records (functions deployed before the
//     migration keep working);
//   - the new keys record, are validated, and claimed_page is refused on
//     gateway receipts;
//   - a replay with the same attempt is a duplicate, a changed one a conflict;
//   - grants: only service_role may execute; nobody reads the table.
// Needs WRITE_REFUSAL_TEST_PG=<psql connection args> naming a THROWAWAY
// server, e.g. "-h 127.0.0.1 -p 55432 -U postgres". It creates and drops its
// own database.
const assert = require('assert/strict');
const cp = require('child_process');
const path = require('path');

const conn = process.env.WRITE_REFUSAL_TEST_PG;
if (!conn) { console.log('write-refusal-page-traffic-postgres: NOT_RUN (set WRITE_REFUSAL_TEST_PG to a disposable server)'); process.exit(0); }
const args = conn.split(/\s+/).filter(Boolean);
const db = 'refusal_page_traffic_' + process.pid;
const root = path.join(__dirname, '..');
const psql = (sql, database = db) => cp.execFileSync('psql', [...args, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', sql], { encoding: 'utf8' }).trim();
const file = f => cp.execFileSync('psql', [...args, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', path.join(root, f)], { encoding: 'utf8' });
const fails = (sql, pattern, message) => {
  let err = null;
  try { psql(sql); } catch (e) { err = e; }
  assert(err, message + ' (expected a refusal)');
  if (pattern) assert.match(String(err.stderr || err.message), pattern, message);
};

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
    const api = await import(path.join(root, 'supabase/functions/_shared/write-refusal-diagnostics.mjs'));
    const q = v => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
    const rec = r => JSON.parse(psql(`set role service_role; select public.production_write_refusal_record_v1(${q(r)})`).split('\n').pop());

    const old = await api.makeRefusalReceipt({}, 'write_conflict', 409);
    assert.deepEqual(Object.keys(old).sort(), ['attempt_id','code','identifiers','member_id','operation','origin','principal_kind','status','surface']);
    assert.equal(rec(old).recorded, true, 'the original 9-key shape still records');

    const gw = await api.makeRefusalReceipt({}, 'write_conflict', 409, 'gateway', { traffic: 'automation', claimed_page: 'client_link' });
    assert.equal(gw.traffic, 'automation');
    assert.equal('claimed_page' in gw, false, 'the builder never puts a page claim on a gateway receipt');
    assert.equal(rec(gw).recorded, true);

    const claim = await api.makeRefusalReceipt({ surface: 'calendar', operation: 'comment' }, 'canonical_comment_read_required', 409, 'browser_claim', { traffic: 'person', claimed_page: 'client_link' });
    assert.equal(rec(claim).recorded, true);
    assert.equal(rec(claim).duplicate, true, 'an identical replay is a duplicate');
    fails(`set role service_role; select public.production_write_refusal_record_v1(${q({ ...claim, traffic: 'automation' })})`, /refusal_attempt_conflict/, 'a replay that changes traffic conflicts');

    const row = JSON.parse(psql(`select row_to_json(r) from write_refusal_diagnostics.receipts_v1 r where attempt_id='${claim.attempt_id}'`));
    assert.equal(row.claimed_page, 'client_link'); assert.equal(row.traffic, 'person');
    const oldRow = JSON.parse(psql(`select row_to_json(r) from write_refusal_diagnostics.receipts_v1 r where attempt_id='${old.attempt_id}'`));
    assert.equal(oldRow.claimed_page, null); assert.equal(oldRow.traffic, null);

    const raw = await api.makeRefusalReceipt({}, 'write_conflict', 409);
    fails(`set role service_role; select public.production_write_refusal_record_v1(${q({ ...raw, claimed_page: 'staff_page' })})`, /refusal_claimed_page/, 'a gateway receipt may not carry a page claim');
    fails(`set role service_role; select public.production_write_refusal_record_v1(${q({ ...raw, traffic: 'robot' })})`, /refusal_traffic/, 'traffic is person or automation');
    fails(`set role service_role; select public.production_write_refusal_record_v1(${q({ ...raw, extra: 1 })})`, /refusal_shape/, 'unknown keys are still refused');

    for (const role of ['anon', 'authenticated']) fails(`set role ${role}; select public.production_write_refusal_record_v1(${q(await api.makeRefusalReceipt({}, 'write_conflict', 409))})`, /permission denied/, role + ' cannot record');
    for (const role of ['anon', 'authenticated', 'service_role']) fails(`set role ${role}; select count(*) from write_refusal_diagnostics.receipts_v1`, /permission denied/, role + ' cannot read receipts');

    const agent = ua => api.requestTraffic(new Request('http://x/', { headers: ua ? { 'user-agent': ua } : {} }));
    assert.equal(agent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.7390.37 Safari/537.36'), 'automation');
    assert.equal(agent('curl/8.5.0'), 'automation');
    assert.equal(agent(''), 'automation', 'no user agent is not a person');
    assert.equal(agent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'), 'person');
    assert.equal(api.requestTraffic(new Request('http://x/', { headers: { 'user-agent': 'Mozilla/5.0 Chrome/141', 'x-syncview-traffic': 'automation' } })), 'automation', 'a declared automation header wins');
    console.log('write-refusal-page-traffic-postgres: page and traffic fields record, validate and stay private ✅');
  } finally {
    psql(`drop database if exists ${db} with (force)`, 'postgres');
  }
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
