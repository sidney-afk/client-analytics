'use strict';
// Only an explicitly bound owned disposable loopback PostgreSQL server.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { localConfig, LocalDatabase } = require('../scripts/card-change-journal-rehearsal');
if (process.env.CARD_HISTORY_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') {
  console.log('SKIP native brief media actual SQL: explicit owned disposable binding required'); process.exit(0);
}
const config = localConfig(), source = fs.readFileSync(path.join(__dirname, '../migrations/2026-09-07-native-brief-media.sql'), 'utf8');
const original = new LocalDatabase(config), restored = new LocalDatabase(config);
const made = [];
const quote = s => "'" + String(s).replaceAll("'", "''") + "'";
function bootstrap(db) {
  db.create(); made.push(db);
  db.query(`create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table public.syncview_runtime_flags(key text primary key,value jsonb,updated_by text);
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
    end $$;`);
  db.query(source);
}
try {
  bootstrap(original);
  assert.equal(original.query("select public from storage.buckets"), 'f');
  assert.equal(original.query("select 'application/octet-stream'=any(allowed_mime_types) and not ('image/svg+xml'=any(allowed_mime_types)) and not ('application/pdf'=any(allowed_mime_types)) from storage.buckets"), 't');
  assert.equal(original.query("select value->>'mode' from syncview_runtime_flags where key='native_brief_media'"), 'off');
  const id = '11111111-1111-4111-8111-111111111111', hash = 'a'.repeat(64);
  const row = { id, deliverable_id: 'fixture', client_slug: 'fixture', team: 'video', source_updated_at: '2026-09-01T00:00:00Z',
    source_kind: 'native_brief', source_entity_id: 'fixture', source_sha256: hash, source_offset: 4, source_length: 30, original_url_sha256: hash, audience: 'staff', state: 'verified',
    content_sha256: hash, readback_sha256: hash, storage_path: hash + '/' + id, byte_length: 10, mime_type: 'image/png',
    verified_at: '2026-09-01T00:00:00Z', source_receipt_sha256: hash, created_at: '2026-09-01T00:00:00Z' };
  const insert = value => 'insert into public.native_brief_media_occurrences select * from jsonb_populate_record(null::public.native_brief_media_occurrences,' + quote(JSON.stringify(value)) + '::jsonb)';
  for (const field of ['readback_sha256','storage_path','byte_length','mime_type','verified_at']) assert.throws(() => original.query(insert({ ...row, [field]: null })));
  assert.throws(() => original.query(insert({ ...row, readback_sha256: 'b'.repeat(64) })));
  assert.throws(() => original.query(insert({ ...row, audience: 'public' })));
  original.query('set role service_role;' + insert(row));
  for (const [i, mime] of ['application/pdf','image/svg+xml','video/mp4','video/quicktime'].entries()) {
    const extraId = '33333333-3333-4333-8333-33333333333' + i;
    original.query('set role service_role;' + insert({ ...row, id: extraId, storage_path: hash + '/' + extraId, source_offset: 40 + i, mime_type: mime }));
  }
  assert.throws(() => original.query(insert({ ...row, byte_length: 52428801 })));
  assert.throws(() => original.query(insert({ ...row, mime_type: 'text/html' })));
  for (const role of ['anon','authenticated']) assert.throws(() => original.query('set role ' + role + '; select * from native_brief_media_occurrences'));
  for (const statement of ["delete from native_brief_media_occurrences", "update native_brief_media_occurrences set state='held'"]) assert.throws(() => original.query('set role service_role;' + statement));
  assert.throws(() => original.query(insert({ ...row, source_updated_at: '2026-09-02T00:00:00Z', id: '22222222-2222-4222-8222-222222222222', storage_path: hash + '/22222222-2222-4222-8222-222222222222' })));
  const exported = original.rows('select * from native_brief_media_occurrences');
  bootstrap(restored); for (const record of exported) restored.query(insert(record));
  assert.deepEqual(restored.rows('select * from native_brief_media_occurrences'), exported);
  assert.equal(restored.query("select relrowsecurity from pg_class where oid='native_brief_media_occurrences'::regclass"), 't');
  assert.throws(() => restored.query('set role anon;select * from native_brief_media_occurrences'));
  console.log('PASS actual SQL: private/off defaults, 7 bad-row refusals, 4 ACL refusals, occurrence conflict and exact empty-target row/schema reconstruction; object bytes tested separately; no live database');
} finally { for (const db of made.reverse()) db.drop(); }
