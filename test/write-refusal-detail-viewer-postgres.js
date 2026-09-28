'use strict';
// OPEN_REPAIRS 101 release A (2026-09-27): migration 20260927200000 adds the
// detail columns, the browser v2 record function, the staff list and the
// daily cleanup. Proves on a disposable PostgreSQL 16 that:
//   - a browser claim records its detail fields through v2, reusing every v1
//     check (a gateway receipt, an unknown detail key or a bad value refuse);
//   - the error message is cleaned in SQL: emails, links, token-like strings
//     and long digit runs become [redacted], and it is capped at 200;
//   - a replay keeps the detail it was first recorded with;
//   - the list hides automation unless asked, shows the client only as a
//     12-character hash prefix and never returns the identifier hashes;
//   - the daily cleanup removes rows older than 30 days, in batches;
//   - grants: only service_role may record or list, nobody else may run the
//     cleanup, and nobody reads the table;
//   - the migration applies twice without error.
// Needs WRITE_REFUSAL_TEST_PG=<psql connection args> naming a THROWAWAY server.
const assert = require('assert/strict');
const cp = require('child_process');
const path = require('path');

const conn = process.env.WRITE_REFUSAL_TEST_PG;
if (!conn) { console.log('write-refusal-detail-viewer-postgres: NOT_RUN (set WRITE_REFUSAL_TEST_PG to a disposable server)'); process.exit(0); }
const args = conn.split(/\s+/).filter(Boolean);
const db = 'refusal_detail_viewer_' + process.pid;
const root = path.join(__dirname, '..');
const psql = (sql, database = db) => cp.execFileSync('psql', [...args, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const file = f => cp.execFileSync('psql', [...args, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', path.join(root, f)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const fails = (sql, pattern, message) => {
  let err = null;
  try { psql(sql); } catch (e) { err = e; }
  assert(err, message + ' (expected a refusal)');
  if (pattern) assert.match(String(err.stderr || err.message), pattern, message);
};
const MIGRATION = 'supabase/migrations/20260927200000_write_refusal_detail_and_viewer.sql';

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
    file(MIGRATION);
    file(MIGRATION);
    const api = await import(path.join(root, 'supabase/functions/_shared/write-refusal-diagnostics.mjs'));
    const q = v => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
    const rec = (r, d) => JSON.parse(psql(`set role service_role; select public.production_write_refusal_record_browser_v2(${q(r)}, ${q(d)})`).split('\n').pop());
    const row = id => JSON.parse(psql(`select row_to_json(r) from write_refusal_diagnostics.receipts_v1 r where attempt_id='${id}'`));
    const claim = (traffic, page = 'client_link') => api.makeRefusalReceipt({ surface: 'calendar', operation: 'status', identifiers: { client_slug: 'synthetic-client', card: 'p_card_1' } }, 'write_conflict', 409, 'browser_claim', { traffic, claimed_page: page });

    const detail = { card_ref: 'p_card_1', ui_action: 'approve', detail: 'Refused for a.person@example.com at https://x.invalid/a?t=1 key eyJhbGciOiJIUzI1NiJ9abcdefghij call 5551234567', browser: 'safari', os: 'ios', app_version: '2026-09-27T14:05', staff_role: null };
    const person = await claim('person');
    assert.deepEqual(rec(person, detail), { recorded: true, duplicate: false });
    const stored = row(person.attempt_id);
    assert.equal(stored.card_ref, 'p_card_1'); assert.equal(stored.ui_action, 'approve'); assert.equal(stored.browser, 'safari');
    assert.equal(stored.detail, 'Refused for [redacted] at [redacted] key [redacted] call [redacted]', 'the message is cleaned in SQL');
    assert.deepEqual(rec(person, { ...detail, detail: 'something else' }), { recorded: true, duplicate: true });
    assert.equal(row(person.attempt_id).detail, stored.detail, 'a replay keeps the first detail');
    const long = await claim('person');
    rec(long, { detail: 'word '.repeat(100) });
    assert(row(long.attempt_id).detail.length <= 200, 'the message is capped at 200');

    const gw = await api.makeRefusalReceipt({}, 'write_conflict', 409);
    // v1 is re-issued so its replay check ignores the new columns: an
    // identical gateway replay is still a duplicate, not a conflict.
    const v1 = r => JSON.parse(psql(`set role service_role; select public.production_write_refusal_record_v1(${q(r)})`).split('\n').pop());
    assert.deepEqual(v1(gw), { recorded: true, duplicate: false });
    assert.deepEqual(v1(gw), { recorded: true, duplicate: true }, 'a gateway replay is still a duplicate after the migration');
    fails(`set role service_role; select public.production_write_refusal_record_browser_v2(${q(gw)}, '{}'::jsonb)`, /refusal_shape/, 'v2 records browser claims only');
    fails(`set role service_role; select public.production_write_refusal_record_browser_v2(${q(await claim('person'))}, '{"body":"x"}'::jsonb)`, /refusal_detail_shape/, 'unknown detail keys are refused');
    fails(`set role service_role; select public.production_write_refusal_record_browser_v2(${q(await claim('person'))}, '{"staff_role":"owner"}'::jsonb)`, /check constraint/, 'a staff role outside the three is refused');
    fails(`set role service_role; select public.production_write_refusal_record_browser_v2(${q(await claim('person'))}, '{"card_ref":"has spaces in it"}'::jsonb)`, /check constraint/, 'a card id is an id, not text');

    const bot = await claim('automation', 'staff_page');
    rec(bot, { staff_role: 'admin' });
    const list = inc => JSON.parse(psql(`set role service_role; select public.production_write_refusal_list_v1(7, ${inc}, 200)`).split('\n').pop());
    const hidden = list(false);
    assert.equal(hidden.rows.length, 3, 'two person claims and the untagged gateway receipt'); assert.equal(hidden.hidden_automation, 1);
    assert(hidden.rows.every(r => r.traffic !== 'automation'));
    const shown = list(true);
    assert.equal(shown.rows.length, 4);
    const first = shown.rows.find(r => r.card_ref === 'p_card_1' && r.ui_action === 'approve');
    assert.equal(first.page, 'client_link'); assert.equal(first.client_ref.length, 12);
    assert(!JSON.stringify(shown).includes('identifiers') && !/[a-f0-9]{64}/.test(JSON.stringify(shown)), 'no full identifier hash leaves the list');
    assert.equal(shown.rows.find(r => r.traffic === 'automation').staff_role, 'admin');
    // Filters run in the query, so a rare screen is never lost to the row cap.
    const only = (surface, page) => JSON.parse(psql(`set role service_role; select public.production_write_refusal_list_v1(7, true, 1, ${surface ? `'${surface}'` : 'null'}, ${page ? `'${page}'` : 'null'})`).split('\n').pop());
    const rare = only('unknown', null);
    assert.equal(rare.total, 1); assert.equal(rare.rows.length, 1); assert.equal(rare.rows[0].surface, 'unknown', 'the one rare-screen row survives a limit of 1');
    assert.equal(only('production', null).total, 0);
    const clientOnly = only(null, 'client_link');
    assert.equal(clientOnly.total, 2); assert(clientOnly.rows.every(r => r.page === 'client_link'));
    fails(`set role service_role; select public.production_write_refusal_list_v1(7, true, 10, 'nowhere', null)`, /refusal_list_surface/, 'an unknown screen is refused');

    psql(`insert into write_refusal_diagnostics.receipts_v1(attempt_id,recorded_at,origin,surface,operation,code,status,principal_kind,identifiers)
          select gen_random_uuid(), now()-interval '40 days','gateway','production','status','write_conflict',409,'unverified','{}'::jsonb from generate_series(1,2500)`);
    const cleaned = JSON.parse(psql(`select public.production_write_refusal_retention_daily_v1()`));
    assert.equal(cleaned.deleted, 2500); assert.equal(cleaned.calls, 3);
    assert.equal(Number(psql(`select count(*) from write_refusal_diagnostics.receipts_v1`)), 4, 'recent rows stay (three claims and one gateway receipt)');

    for (const role of ['anon', 'authenticated']) {
      fails(`set role ${role}; select public.production_write_refusal_record_browser_v2(${q(await claim('person'))}, '{}'::jsonb)`, /permission denied/, role + ' cannot record');
      fails(`set role ${role}; select public.production_write_refusal_list_v1()`, /permission denied/, role + ' cannot list');
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      fails(`set role ${role}; select public.production_write_refusal_retention_daily_v1()`, /permission denied/, role + ' cannot run the cleanup');
      fails(`set role ${role}; select count(*) from write_refusal_diagnostics.receipts_v1`, /permission denied/, role + ' cannot read receipts');
    }
    console.log('write-refusal-detail-viewer-postgres: detail fields record cleaned, list hides automation, cleanup runs, all private ✅');
  } finally {
    psql(`drop database if exists ${db} with (force)`, 'postgres');
  }
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
