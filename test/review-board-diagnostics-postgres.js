'use strict';
// OPEN_REPAIRS 623 (session Reviewguard, 2026-11-01): migration 20261101220000 keeps the
// review boards' own code and the browser store's fill beside each browser report, and
// adds a per-day read. Proves on a disposable PostgreSQL 16 that:
//   - v3 records the claim through v2 (every older check still runs) and the extra fields
//     in the side table; a replay keeps the first values and counts the try;
//   - a bad code, an out-of-range store figure or an unknown key is refused;
//   - the daily read groups by day, page, action, code, browser and OS, counts reports,
//     tries and cards, shows the fullest store, and leaves automation out;
//   - the 30-day cleanup takes the side rows with their refusal rows;
//   - grants: only service_role may record or read; nobody reads either table;
//   - the migration applies twice without error, and the function's shaping of `env`
//     drops anything that is not a short code or a whole number in range.
// Needs WRITE_REFUSAL_TEST_PG=<psql connection args> naming a THROWAWAY server.
const assert = require('assert/strict');
const cp = require('child_process');
const path = require('path');

const conn = process.env.WRITE_REFUSAL_TEST_PG;
if (!conn) { console.log('review-board-diagnostics-postgres: NOT_RUN (set WRITE_REFUSAL_TEST_PG to a disposable server)'); process.exit(0); }
const args = conn.split(/\s+/).filter(Boolean);
const db = 'review_board_diag_' + process.pid;
const root = path.join(__dirname, '..');
const psql = (sql, database = db) => cp.execFileSync('psql', [...args, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-d', database, '-c', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const file = f => cp.execFileSync('psql', [...args, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db, '-f', path.join(root, f)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const fails = (sql, pattern, message) => {
  let err = null;
  try { psql(sql); } catch (e) { err = e; }
  assert(err, message + ' (expected a refusal)');
  if (pattern) assert.match(String(err.stderr || err.message), pattern, message);
};
const MIGRATION = 'supabase/migrations/20261101220000_review_board_diagnostics.sql';

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
    file('supabase/migrations/20260928060000_write_refusal_attempts_and_network.sql');
    file(MIGRATION);
    file(MIGRATION);
    const api = await import(path.join(root, 'supabase/functions/_shared/write-refusal-diagnostics.mjs'));
    const shape = await import(path.join(root, 'supabase/functions/write-diagnostics/browser-detail.mjs'));
    const q = v => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
    const rec = (r, d, e) => JSON.parse(psql(`set role service_role; select public.production_write_refusal_record_browser_v3(${q(r)}, ${q(d)}, ${e === null ? 'null' : q(e)})`).split('\n').pop());
    const env = id => JSON.parse(psql(`select coalesce((select row_to_json(e) from write_refusal_diagnostics.review_env_v1 e where attempt_id='${id}'),'null'::json)`));
    const claim = async (body, traffic = 'person') => shape.shapeBrowserReceipt(await api.makeRefusalReceipt({ surface: 'calendar', operation: body.operation || 'review_approve', identifiers: { card: body.card || 'p_card_1', component: 'video' } }, body.code || 'save_in_flight', body.status, 'browser_claim', { traffic, claimed_page: body.page || 'staff_page' }), body);
    const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    const detail = body => shape.browserDetail(Object.assign({ identifiers: { card: body.card || 'p_card_1' } }, body), SAFARI_MAC, 'admin');

    // The function's shaping: a short code and whole numbers in range, nothing else.
    assert.deepEqual(shape.browserEnv({ env: { code: 'save_in_flight', storage_kc: 5120, storage_pct: 98 } }), { ui_code: 'save_in_flight', storage_kc: 5120, storage_pct: 98 });
    assert.deepEqual(shape.browserEnv({ env: { code: 'Card title here', storage_kc: -1, storage_pct: 101, body: 'words' } }), null, 'nothing usable: no env at all');
    assert.deepEqual(shape.browserEnv({ env: { code: 'ok', storage_pct: 12.5 } }), { ui_code: 'ok', storage_kc: null, storage_pct: null });
    assert.equal(shape.browserEnv({}), null);
    assert.equal(shape.browserEnv({ env: [1] }), null);

    // v3 records the claim and its extra fields.
    const body = { operation: 'review_repeat', code: 'save_in_flight', env: { code: 'save_in_flight', storage_kc: 5120, storage_pct: 98 } };
    const one = await claim(body);
    assert.deepEqual(rec(one, detail(body), shape.browserEnv(body)), { recorded: true, duplicate: false });
    const row = JSON.parse(psql(`select row_to_json(r) from write_refusal_diagnostics.receipts_v1 r where attempt_id='${one.attempt_id}'`));
    assert.equal(row.ui_action, 'review_repeat'); assert.equal(row.browser, 'safari'); assert.equal(row.os, 'mac');
    assert.equal(row.code, 'browser_refusal', 'a page code outside the gateway list is stored as browser_refusal in the receipt');
    const e1 = env(one.attempt_id);
    assert.equal(e1.ui_code, 'save_in_flight'); assert.equal(e1.storage_kc, 5120); assert.equal(e1.storage_pct, 98);
    // A replay keeps the first values and counts the try.
    assert.deepEqual(rec(one, detail(body), { ui_code: 'other_code', storage_kc: 1, storage_pct: 1 }), { recorded: true, duplicate: true });
    assert.equal(env(one.attempt_id).ui_code, 'save_in_flight', 'a replay keeps the first code');
    assert.equal(Number(psql(`select attempts from write_refusal_diagnostics.receipts_v1 where attempt_id='${one.attempt_id}'`)), 2);
    // No env: recorded, no side row.
    const bare = await claim({ operation: 'review_approve', code: 'write_conflict', status: 409 });
    assert.deepEqual(rec(bare, detail({ operation: 'review_approve' }), null), { recorded: true, duplicate: false });
    assert.equal(env(bare.attempt_id), null);

    // Refusals.
    fails(`set role service_role; select public.production_write_refusal_record_browser_v3(${q(await claim(body))}, '{}'::jsonb, '{"ui_code":"Has Spaces"}'::jsonb)`, /check constraint/, 'a code is a short snake_case word');
    fails(`set role service_role; select public.production_write_refusal_record_browser_v3(${q(await claim(body))}, '{}'::jsonb, '{"storage_pct":140}'::jsonb)`, /check constraint/, 'a percent is 0 to 100');
    fails(`set role service_role; select public.production_write_refusal_record_browser_v3(${q(await claim(body))}, '{}'::jsonb, '{"text":"words"}'::jsonb)`, /refusal_env_shape/, 'unknown keys are refused');
    fails(`set role service_role; select public.production_write_refusal_record_browser_v3(${q(await claim(body))}, '{}'::jsonb, '{"ui_code":5}'::jsonb)`, /refusal_env_shape/, 'a code is text');
    fails(`set role service_role; select public.production_write_refusal_record_browser_v3(${q(await api.makeRefusalReceipt({}, 'write_conflict', 409))}, '{}'::jsonb, '{}'::jsonb)`, /refusal_shape/, 'v3 records browser claims only');

    // The daily read: a second card on the client link, and automation left out.
    const b2 = { operation: 'review_approve', code: 'offline', page: 'client_link', card: 'p_card_2', env: { code: 'offline', storage_kc: 40, storage_pct: 1 } };
    const two = await claim(b2);
    rec(two, detail(b2), shape.browserEnv(b2));
    const bot = await claim(b2, 'automation');
    rec(bot, detail(b2), shape.browserEnv(b2));
    const daily = JSON.parse(psql(`set role service_role; select coalesce(jsonb_agg(d),'[]'::jsonb) from public.production_write_refusal_review_daily_v1(14) d`).split('\n').pop());
    const find = (action, code) => daily.find(r => r.action === action && r.code === code);
    const rep = find('review_repeat', 'save_in_flight');
    assert(rep, 'the repeat row is there: ' + JSON.stringify(daily));
    assert.equal(rep.page, 'staff_page'); assert.equal(rep.browser, 'safari'); assert.equal(rep.os, 'mac');
    assert.equal(Number(rep.reports), 1); assert.equal(Number(rep.tries), 2); assert.equal(Number(rep.cards), 1); assert.equal(rep.max_storage_pct, 98);
    const off = find('review_approve', 'offline');
    assert.equal(off.page, 'client_link'); assert.equal(Number(off.reports), 1, 'automation is left out of the daily read');
    assert.equal(find('review_approve', 'write_conflict').max_storage_pct, null, 'a report without env still counts');
    assert(!JSON.stringify(daily).includes('p_card'), 'the daily read names no card');

    // The cleanup takes the side rows with their refusal rows.
    psql(`update write_refusal_diagnostics.receipts_v1 set recorded_at=now()-interval '40 days' where attempt_id='${one.attempt_id}'`);
    psql(`select public.production_write_refusal_retention_daily_v1()`);
    assert.equal(env(one.attempt_id), null, 'the side row went with its refusal row');
    assert(env(two.attempt_id), 'a recent side row stays');

    // Grants: service_role only, and no one reads the tables.
    for (const role of ['anon', 'authenticated']) {
      fails(`set role ${role}; select public.production_write_refusal_review_daily_v1(14)`, /permission denied/, role + ' cannot run the daily read');
      fails(`set role ${role}; select public.production_write_refusal_record_browser_v3(${q(await claim(body))}, '{}'::jsonb, '{}'::jsonb)`, /permission denied/, role + ' cannot record');
    }
    for (const role of ['anon', 'authenticated', 'service_role']) {
      fails(`set role ${role}; select * from write_refusal_diagnostics.review_env_v1`, /permission denied/, role + ' cannot read the side table');
    }
    const grants = psql(`select coalesce(string_agg(grantee||':'||privilege_type, ','),'') from information_schema.role_table_grants where table_schema='write_refusal_diagnostics' and table_name='review_env_v1' and grantee in ('public','anon','authenticated','service_role')`);
    assert.equal(grants, '', 'no role holds a table privilege');
    const pub = psql(`select string_agg(p.proname||':'||coalesce(array_to_string(p.proacl,' '),'(default)'),',') from pg_proc p where p.proname in ('production_write_refusal_record_browser_v3','production_write_refusal_review_daily_v1')`);
    assert(!/(^|[ ,{])=X/.test(pub) && !/anon=|authenticated=/.test(pub), 'no public, anon or authenticated EXECUTE: ' + pub);
    console.log('review-board-diagnostics-postgres: codes and store fill recorded, read per day, cleaned with their rows, all private ✅');
  } finally {
    psql(`drop database if exists ${db}`, 'postgres');
  }
})().catch(e => { console.error(e); process.exit(1); });
