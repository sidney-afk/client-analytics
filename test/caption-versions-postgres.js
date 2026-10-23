'use strict';
/*
 * caption-versions-postgres.js -- migrations/2026-10-23-caption-versions.sql and the hand-run
 * scripts/caption-versions-backfill.sql on a disposable PostgreSQL.
 *
 * Synthetic client, card ids and text only (the repository is public). Proves:
 *  - a real caption change writes one version; a save that changes anything else, or writes the same caption,
 *    writes none; the calendar's settings row is skipped;
 *  - how it changed: the card saver's origin header (typed, redo with its note and actor, restored with the version
 *    it came from), an API write with no origin ("saved", or "generated" when a caption job just produced that
 *    text), and a write with no API request at all ("outside"); a broken header is "saved", never an error;
 *  - A CARD SAVE STILL SUCCEEDS WHEN THE VERSION INSERT FAILS (the insert refused by a constraint, and the table
 *    gone altogether): the caption is saved and a WARNING is logged instead of an error;
 *  - the table is append-only (update, delete and truncate refused);
 *  - privileges, all four roles measured: anon and authenticated hold nothing, service_role holds exactly SELECT,
 *    and no role may execute the trigger functions;
 *  - the "how to tell it is applied" read in the file answers false, false, false before and true, true, true after;
 *  - the migration applies twice without error, and the backfill is re-runnable (the second run inserts nothing).
 *
 * Locally, point PG* at a throwaway server and set CAPTION_VERSIONS_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY.
 * It creates and drops its own database.
 */
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.CAPTION_VERSIONS_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') {
  console.log('SKIP caption-versions-postgres: needs a disposable PostgreSQL (CAPTION_VERSIONS_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY)');
  process.exit(0);
}
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const DB = 'caption_versions_' + process.pid;
const FILE = 'migrations/2026-10-23-caption-versions.sql';
const BACKFILL = 'scripts/caption-versions-backfill.sql';

function psql(database, text, allowFail = false) {
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database],
    { input: text, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw Error('psql failed: ' + (r.stderr || r.stdout));
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const q = text => psql(DB, text).out;
const lit = v => (v == null ? 'null' : "'" + String(v).replace(/'/g, "''") + "'");
const b64 = obj => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
// A write the way PostgREST makes it for an Edge Function: the request's headers in request.headers.
const viaApi = (headers, sql) => `begin; select set_config('request.headers', ${lit(JSON.stringify(headers))}, true); ${sql}; commit;`;
const setCaption = (id, text) => `update public.calendar_posts set caption = ${lit(text)}, updated_at = now()::text where client = 'qa-client' and id = ${lit(id)}`;
const versions = id => q(`select coalesce(json_agg(json_build_object('kind', kind, 'text', text, 'note', note, 'from', restored_from,
  'actor', actor, 'role', actor_role, 'field', field) order by id), '[]') from public.caption_versions where post_id = ${lit(id)}`);
const vlist = id => JSON.parse(versions(id));

const header = read(FILE);
const probe = header.slice(header.indexOf('-- HOW TO TELL IT IS APPLIED'), header.indexOf('-- Supabase grants')).split('\n').slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();

let failed = false;
try {
  assert.equal(header.split('\n')[0], '-- ef-auto-deploy: functions-cope-without-this', 'the cope marker is line 1');
  psql('postgres', `drop database if exists ${DB}; create database ${DB};`);
  psql(DB, `
    do $r$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $r$;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.calendar_posts (client text not null, id text not null, name text, caption text, caption_alt text,
      status text, updated_at text, primary key (client, id));
    create table public.caption_jobs (job_id text primary key, client text, post_id text, status text, caption text,
      updated_at timestamptz not null default now());
    create table public.card_change_journal (id bigint generated always as identity primary key, relation_name text,
      operation text, entity_key_after jsonb, client_after text, row_before jsonb, row_after jsonb, changed_columns text[],
      recorded_at timestamptz not null default clock_timestamp());
    insert into public.calendar_posts (client, id, name, caption, updated_at) values
      ('qa-client', 'p_one', 'Warm up', 'First caption', '2026-10-20T10:00:00Z'),
      ('qa-client', 'p_two', 'Second', 'Two', '2026-10-20T10:00:00Z'),
      ('qa-client', 'p_cal_settings', '__cal_settings__', '{}', '2026-10-20T10:00:00Z');
  `);

  // Before: the read answers false, false, false.
  assert.equal(q(probe), 'f|f|f', 'the applied read answers false before');

  // Journal rows from before the trigger existed, for the backfill below.
  q(`insert into public.card_change_journal (relation_name, operation, entity_key_after, client_after, row_before, row_after, changed_columns, recorded_at) values
    ('calendar_posts', 'UPDATE', '{"id":"p_old","client":"qa-client"}', 'qa-client',
      '{"caption":"Old one","updated_at":"2026-09-18T08:00:00Z"}', '{"caption":"Old two"}', array['caption','updated_at'], '2026-09-20T09:00:00Z'),
    ('calendar_posts', 'UPDATE', '{"id":"p_old","client":"qa-client"}', 'qa-client',
      '{"caption":"Old two"}', '{"caption":"Old three"}', array['caption'], '2026-09-21T09:00:00Z'),
    ('calendar_posts', 'UPDATE', '{"id":"p_old","client":"qa-client"}', 'qa-client',
      '{"caption":"Old three","status":"a"}', '{"caption":"Old three","status":"b"}', array['status'], '2026-09-22T09:00:00Z'),
    ('calendar_posts', 'UPDATE', '{"id":"p_cal_settings","client":"qa-client"}', 'qa-client',
      '{"caption":"{}"}', '{"caption":"{\\"x\\":1}","name":"__cal_settings__"}', array['caption'], '2026-09-22T09:00:00Z');`);

  psql(DB, header);
  psql(DB, header);   // applies twice without error
  assert.equal(q(probe), 't|t|t', 'the applied read answers true after');

  // Privileges, all four roles.
  assert.equal(q(`select has_table_privilege('anon', 'public.caption_versions', 'select,insert,update,delete')`), 'f');
  assert.equal(q(`select has_table_privilege('authenticated', 'public.caption_versions', 'select,insert,update,delete')`), 'f');
  assert.equal(q(`select has_table_privilege('service_role', 'public.caption_versions', 'select')`), 't');
  assert.equal(q(`select has_table_privilege('service_role', 'public.caption_versions', 'insert,update,delete,truncate')`), 'f');
  for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
    if (role === 'public') continue;
    assert.equal(q(`select has_function_privilege('${role}', 'public.caption_versions_capture()', 'execute')`), 'f', role + ' may not execute the capture');
    assert.equal(q(`select has_function_privilege('${role}', 'public.caption_versions_refuse_change()', 'execute')`), 'f', role + ' may not execute the guard');
  }
  assert.equal(q(`select count(*) from pg_class c, aclexplode(c.relacl) a where c.relname = 'caption_versions' and a.grantee = 0`), '0', 'PUBLIC holds nothing');
  const seq = q(`select pg_get_serial_sequence('public.caption_versions', 'id')`);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(q(`select has_sequence_privilege('${role}', '${seq}', 'usage,select,update')`), 'f', role + ' holds nothing on the sequence');
  }
  assert(!psql(DB, `set role anon; select count(*) from public.caption_versions;`, true).ok, 'anon cannot read');

  // A typed save from the card saver.
  psql(DB, viaApi({ 'x-syncview-caption-origin': b64({ k: 'typed', a: 'QA Staff', r: 'smm' }) }, setCaption('p_one', 'Typed caption')));
  // A redo with its note.
  psql(DB, viaApi({ 'x-syncview-caption-origin': b64({ k: 'redo', n: 'shorter, a hookier first line', a: 'QA Staff', r: 'smm' }) }, setCaption('p_one', 'Redo caption')));
  // A save that changes something else, and one that writes the same caption: no version.
  psql(DB, viaApi({ 'x-syncview-caption-origin': b64({ k: 'typed' }) }, `update public.calendar_posts set status = 'x' where id = 'p_one'`));
  psql(DB, viaApi({ 'x-syncview-caption-origin': b64({ k: 'typed' }) }, setCaption('p_one', 'Redo caption')));
  let v = vlist('p_one');
  assert.equal(v.length, 2, 'two real changes, two versions');
  assert.deepEqual(v.map(x => x.kind), ['typed', 'redo']);
  assert.equal(v[0].actor, 'QA Staff');
  assert.equal(v[0].role, 'smm');
  assert.equal(v[0].note, null, 'a typed save keeps no note');
  assert.equal(v[1].note, 'shorter, a hookier first line');
  // Restored, naming the version it came from.
  const firstId = q(`select min(id) from public.caption_versions where post_id = 'p_one'`);
  psql(DB, viaApi({ 'x-syncview-caption-origin': b64({ k: 'restored', f: Number(firstId), n: 'ignored', a: 'QA Staff', r: 'admin' }) }, setCaption('p_one', 'Typed caption')));
  v = vlist('p_one');
  assert.equal(v[2].kind, 'restored');
  assert.equal(String(v[2].from), firstId);
  assert.equal(v[2].note, null, 'only a redo keeps a note');

  // An API write with no origin: "saved"; the same with the text a caption job just produced: "generated".
  psql(DB, viaApi({ 'x-client-info': 'supabase-js' }, setCaption('p_two', 'Client words')));
  q(`insert into public.caption_jobs (job_id, client, post_id, status, caption) values ('j1', 'qa-client', 'p_two', 'done', 'Fresh from the model')`);
  psql(DB, viaApi({ 'x-client-info': 'supabase-js' }, setCaption('p_two', 'Fresh from the model')));
  // A broken origin header: "saved", and the save goes through.
  psql(DB, viaApi({ 'x-syncview-caption-origin': '%%% not base64 %%%' }, setCaption('p_two', 'After a bad header')));
  psql(DB, viaApi({ 'x-syncview-caption-origin': b64({ k: 'delete everything' }) }, setCaption('p_two', 'Unknown kind')));
  // No API request at all (SQL): "outside".
  psql(DB, setCaption('p_two', 'Fixed by hand'));
  v = vlist('p_two');
  assert.deepEqual(v.map(x => x.kind), ['saved', 'generated', 'saved', 'saved', 'outside']);
  // The second-platform caption is its own field.
  psql(DB, viaApi({ 'x-syncview-caption-origin': b64({ k: 'typed' }) }, `update public.calendar_posts set caption_alt = 'Alt text' where id = 'p_two'`));
  assert.equal(vlist('p_two').pop().field, 'caption_alt');
  // A new card with a caption gets its first version; one without gets none.
  psql(DB, viaApi({ 'x-syncview-caption-origin': b64({ k: 'typed' }) }, `insert into public.calendar_posts (client, id, caption) values ('qa-client', 'p_new', 'Born with words'), ('qa-client', 'p_empty', '')`));
  assert.equal(vlist('p_new').length, 1);
  assert.equal(vlist('p_empty').length, 0);
  // The settings row is not a caption.
  psql(DB, setCaption('p_cal_settings', '{"a":1}'));
  assert.equal(vlist('p_cal_settings').length, 0, 'settings row skipped');

  // Append-only, even for the owner.
  for (const stmt of ['update public.caption_versions set text = 1::text', 'delete from public.caption_versions', 'truncate public.caption_versions']) {
    const r = psql(DB, stmt, true);
    assert(!r.ok && /append-only/.test(r.err), stmt + ' is refused: ' + r.err);
  }

  // THE SAVE STILL SUCCEEDS WHEN THE VERSION INSERT FAILS.
  // 1. The insert is refused (a constraint every new row breaks).
  const before = q(`select count(*) from public.caption_versions`);
  q(`alter table public.caption_versions add constraint qa_refuse_all check (false) not valid`);
  let r = psql(DB, viaApi({ 'x-syncview-caption-origin': b64({ k: 'typed' }) }, setCaption('p_one', 'Saved while history is broken')), true);
  assert(r.ok, 'the card save succeeds: ' + r.err);
  assert(/caption_versions_capture skipped: 23514/.test(r.err), 'a WARNING is logged: ' + r.err);
  assert.equal(q(`select caption from public.calendar_posts where id = 'p_one'`), 'Saved while history is broken');
  assert.equal(q(`select count(*) from public.caption_versions`), before, 'no version, no error');
  q(`alter table public.caption_versions drop constraint qa_refuse_all`);
  // 2. The table is gone altogether.
  q(`alter table public.caption_versions rename to caption_versions_away`);
  r = psql(DB, setCaption('p_one', 'Saved with no history table'), true);
  assert(r.ok, 'the card save succeeds with no table: ' + r.err);
  assert(/caption_versions_capture skipped: 42P01/.test(r.err), 'a WARNING is logged: ' + r.err);
  assert.equal(q(`select caption from public.calendar_posts where id = 'p_one'`), 'Saved with no history table');
  q(`alter table public.caption_versions_away rename to caption_versions`);
  // 3. Inside a larger transaction that goes on afterwards: the transaction is not aborted.
  r = psql(DB, `begin; alter table public.caption_versions add constraint qa_refuse_all check (false) not valid;
    ${setCaption('p_two', 'In a transaction')}; select 1; alter table public.caption_versions drop constraint qa_refuse_all; commit;`, true);
  assert(r.ok, 'the surrounding transaction commits: ' + r.err);
  assert.equal(q(`select caption from public.calendar_posts where id = 'p_two'`), 'In a transaction');

  // Backfill: journal rows older than the first live version, re-runnable.
  const b1 = psql(DB, read(BACKFILL)).out;
  const after1 = q(`select coalesce(json_agg(json_build_object('t', text, 'at', created_at) order by created_at), '[]') from public.caption_versions where kind = 'backfill' and post_id = 'p_old'`);
  const rows = JSON.parse(after1);
  assert.deepEqual(rows.map(x => x.t), ['Old one', 'Old two', 'Old three'], 'the first text, then each change');
  assert(rows[0].at.startsWith('2026-09-18T08:00:00'), 'the first text is dated from its own updated_at');
  assert.equal(q(`select count(*) from public.caption_versions where kind = 'backfill' and post_id = 'p_cal_settings'`), '0');
  assert.equal(q(`select count(*) from public.caption_versions where kind = 'backfill' and actor is null and note is null`),
    q(`select count(*) from public.caption_versions where kind = 'backfill'`), 'who and how not recorded');
  const b2 = psql(DB, read(BACKFILL)).out;
  assert.equal(b2.split('\n').pop(), b1.split('\n').pop(), 'a second run inserts nothing');

  console.log('PASS caption-versions-postgres');
} catch (e) {
  failed = true;
  console.error('FAIL caption-versions-postgres:', e && e.stack || e);
} finally {
  psql('postgres', `drop database if exists ${DB};`, true);
}
process.exit(failed ? 1 : 0);
