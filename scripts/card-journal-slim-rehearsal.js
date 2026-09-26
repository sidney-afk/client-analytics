'use strict';

// Real PostgreSQL, synthetic data only, for migrations/2026-09-26-card-journal-slim.sql
// (NOT APPLIED). Builds the same disposable database as
// scripts/card-change-journal-rehearsal.js, installs the two functions exactly
// as they are live (so the migration's staleness guard is exercised), applies
// the migration, then its rollback. Needs the same explicit local opt-in:
//   CARD_HISTORY_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY node scripts/card-journal-slim-rehearsal.js
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { localConfig, LocalDatabase, bootstrap } = require('./card-change-journal-rehearsal');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = path.join(ROOT, 'migrations', '2026-09-26-card-journal-slim.sql');
const ROLLBACK = path.join(ROOT, 'migrations', '2026-09-26-card-journal-slim.ROLLBACK.sql');

// The live comment-merge body, byte for byte (CRLF line endings), read
// 2026-09-26; md5(prosrc) 01e84755d199ee82f060af0f338e55ff.
const LIVE_MERGE_BODY = [
  '',
  'begin',
  '  return query',
  '  update calendar_posts c set',
  "    video_tweaks   = case when p_video   is not null then _calmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.video_tweaks   end,",
  "    tweaks         = case when p_video   is not null then _calmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.tweaks         end,",
  "    graphic_tweaks = case when p_graphic is not null then _calmerge_comment_cell(c.graphic_tweaks, p_graphic, coalesce(p_base,'')) else c.graphic_tweaks end,",
  "    caption_tweaks = case when p_caption is not null then _calmerge_comment_cell(c.caption_tweaks, p_caption, coalesce(p_base,'')) else c.caption_tweaks end,",
  "    title_tweaks   = case when p_title   is not null then _calmerge_comment_cell(c.title_tweaks,   p_title,   coalesce(p_base,'')) else c.title_tweaks   end,",
  '    updated_at     = now()',
  '  where c.client = p_client and c.id = p_id',
  '  returning c.*;',
  'end;',
  '',
].join('\r\n');

// psql runs a file with CREATE INDEX CONCURRENTLY outside a transaction only
// when statements are sent separately, so split at the first `begin;`.
function applyFile(db, file) {
  const sql = fs.readFileSync(file, 'utf8');
  const at = sql.indexOf('\nbegin;');
  if (at > 0 && /create index concurrently/i.test(sql.slice(0, at))) {
    db.query(sql.slice(0, at));
    db.query(sql.slice(at));
  } else {
    db.query(sql);
  }
}

async function run() {
  const db = new LocalDatabase(localConfig());
  const checks = [];
  const check = (name, fn) => { fn(); checks.push(name); };
  db.create();
  let completed = false;
  try {
    bootstrap(db);
    db.query(`create or replace function public.calendar_merge_comments(p_client text, p_id text,
      p_video text default null, p_graphic text default null, p_caption text default null,
      p_title text default null, p_base text default '') returns setof public.calendar_posts
      language plpgsql set search_path = public as $live$${LIVE_MERGE_BODY}$live$;
      grant execute on function public.calendar_merge_comments(text,text,text,text,text,text,text) to anon, authenticated, service_role;`);
    check('fixture reproduces the live function bodies the migration pins', () => {
      assert.equal(db.query("select md5(prosrc) from pg_proc where oid='public.calendar_merge_comments(text,text,text,text,text,text,text)'::regprocedure"), '01e84755d199ee82f060af0f338e55ff');
      assert.equal(db.query("select md5(prosrc) from pg_proc where oid='public.card_change_journal_capture()'::regprocedure"), 'e14642bea1950178cce0067f3ba78fda');
    });

    const count = () => Number(db.query("select count(*) from public.card_change_journal where relation_name='calendar_posts'"));
    const card = (id) => `insert into public.calendar_posts(client, id, name) values ('historyfixture', '${id}', 'Synthetic card');`;
    const merge = (id, video) => `set role service_role; select count(*) from public.calendar_merge_comments('historyfixture','${id}', ${video === null ? 'null' : `'${video}'`}, null, null, null, '');`;
    const note = JSON.stringify([{ id: 'n1', text: 'Synthetic note', created_at: '2026-09-26T00:00:00Z' }]);

    db.query(card('before'));
    const b0 = count();
    db.query(merge('before', note));
    db.query(merge('before', note));
    check('BEFORE: re-merging an unchanged comment journals a timestamp-only row (the measured source)', () => {
      assert.equal(count(), b0 + 2);
      const last = db.rows("select changed_columns from public.card_change_journal where relation_name='calendar_posts' order by id desc limit 1")[0];
      assert.deepEqual(last.changed_columns, ['updated_at']);
    });
    const beforeRows = db.rows("select id, row_schema, row_schema_md5 from public.card_change_journal order by id");
    assert.ok(beforeRows.every(r => Object.keys(r.row_schema).length > 0));

    const staleCopy = fs.readFileSync(MIGRATION, 'utf8').replaceAll('01e84755d199ee82f060af0f338e55ff', '00000000000000000000000000000000');
    check('the staleness guard refuses to replace a function that changed since review', () => {
      const r = db.raw(staleCopy.slice(staleCopy.indexOf('\nbegin;')));
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /card_journal_slim_stale/);
    });

    applyFile(db, MIGRATION);
    check('migration applies; no existing journal row is changed or removed', () => {
      assert.deepEqual(db.rows("select id, row_schema, row_schema_md5 from public.card_change_journal order by id").slice(0, beforeRows.length), beforeRows);
    });

    db.query(card('after'));
    const a0 = count();
    const insertRow = db.rows("select row_schema from public.card_change_journal where relation_name='calendar_posts' order by id desc limit 1")[0];
    check('an INSERT is still journaled, with the layout by reference once one is stored', () => {
      assert.deepEqual(insertRow.row_schema, {});
    });
    db.query(merge('after', note));
    check('a comment that changes is journaled exactly once, with the comment column', () => {
      assert.equal(count(), a0 + 1);
      const last = db.rows("select changed_columns from public.card_change_journal where relation_name='calendar_posts' order by id desc limit 1")[0];
      assert.ok(last.changed_columns.includes('video_tweaks'));
    });
    const a1 = count();
    const updatedBefore = db.query("select updated_at from public.calendar_posts where id='after'");
    const returned = db.query(merge('after', note));
    check('re-merging the same comment writes nothing: no journal row, updated_at unchanged, row still returned', () => {
      assert.equal(count(), a1);
      assert.equal(db.query("select updated_at from public.calendar_posts where id='after'"), updatedBefore);
      assert.match(returned, /1$/);
    });
    check('merging into a card that does not exist still returns no row (caller creates it)', () => {
      assert.match(db.query(merge('missing', note)), /0$/);
    });
    db.query("update public.calendar_posts set updated_at = now() where id='after';");
    check('a direct timestamp-only UPDATE is not journaled', () => assert.equal(count(), a1));
    db.query("update public.calendar_posts set name = 'Renamed synthetic card' where id='after';");
    check('a real change is journaled in full, including its new updated_at', () => {
      assert.equal(count(), a1 + 1);
      const last = db.rows("select changed_columns, row_after from public.card_change_journal where relation_name='calendar_posts' order by id desc limit 1")[0];
      assert.deepEqual(last.changed_columns, ['name']);
      assert.equal(last.row_after.name, 'Renamed synthetic card');
    });
    db.query("delete from public.calendar_posts where id='after';");
    check('a DELETE is still journaled', () => assert.equal(count(), a1 + 2));

    check('every journal row resolves its layout; a full copy is kept once per layout', () => {
      assert.equal(db.query(`select count(*) from (select distinct relation_name, row_schema_md5 from public.card_change_journal) d
        where public.card_change_journal_row_schema(d.relation_name, d.row_schema_md5) is null`), '0');
      const newFull = db.query(`select count(*) from public.card_change_journal where id > ${beforeRows[beforeRows.length - 1].id}
        and relation_name='calendar_posts' and row_schema <> '{}'::jsonb`);
      assert.equal(newFull, '0');
      const resolved = JSON.parse(db.query(`select public.card_change_journal_row_schema('calendar_posts',
        (select row_schema_md5 from public.card_change_journal where relation_name='calendar_posts' order by id desc limit 1))`));
      assert.equal(resolved.name.type, 'text');
    });
    db.query("alter table public.calendar_posts add column synthetic_future_field text; update public.calendar_posts set synthetic_future_field='x' where id='before';");
    check('a new layout is stored in full on its first row', () => {
      const last = db.rows("select row_schema from public.card_change_journal where relation_name='calendar_posts' order by id desc limit 1")[0];
      assert.equal(last.row_schema.synthetic_future_field.type, 'text');
    });

    for (const role of ['anon', 'authenticated']) {
      check(role + ' cannot call the comment merge or the layout resolver', () => {
        assert.equal(db.query(`select has_function_privilege('${role}','public.calendar_merge_comments(text,text,text,text,text,text,text)','EXECUTE')`), 'f');
        assert.equal(db.query(`select has_function_privilege('${role}','public.card_change_journal_row_schema(text,text)','EXECUTE')`), 'f');
      });
    }
    check('service_role keeps the merge and gains only the resolver; the capture stays uncallable', () => {
      assert.equal(db.query("select has_function_privilege('service_role','public.calendar_merge_comments(text,text,text,text,text,text,text)','EXECUTE')"), 't');
      assert.equal(db.query("select has_function_privilege('service_role','public.card_change_journal_row_schema(text,text)','EXECUTE')"), 't');
      assert.equal(db.query("select has_function_privilege('service_role','public.card_change_journal_capture()','EXECUTE')"), 'f');
    });
    check('the journal stays immutable', () => {
      assert.match(db.raw('delete from public.card_change_journal;').stderr, /card_change_journal_immutable/);
    });

    const r0 = Number(db.query('select count(*) from public.card_change_journal'));
    applyFile(db, ROLLBACK);
    check('rollback restores the old behaviour and keeps every row resolvable', () => {
      assert.equal(Number(db.query('select count(*) from public.card_change_journal')), r0);
      db.query(merge('before', JSON.stringify([{ id: 'n2', text: 'Another', created_at: '2026-09-26T00:00:01Z' }])));
      const c = count();
      db.query(merge('before', JSON.stringify([{ id: 'n2', text: 'Another', created_at: '2026-09-26T00:00:01Z' }])));
      assert.equal(count(), c + 1, 'old merge stamps updated_at again');
      assert.equal(db.query(`select count(*) from (select distinct relation_name, row_schema_md5 from public.card_change_journal) d
        where public.card_change_journal_row_schema(d.relation_name, d.row_schema_md5) is null`), '0');
      assert.equal(db.query("select md5(prosrc) from pg_proc where oid='public.card_change_journal_capture()'::regprocedure"), 'e14642bea1950178cce0067f3ba78fda');
    });

    const result = { status: 'PASS', checks, passed: checks.length, server_version: db.query('show server_version'),
      proof_scope: 'synthetic_local_SQL_only_not_applied_to_any_shared_database' };
    console.log(JSON.stringify(result));
    completed = true;
    return result;
  } finally {
    if (completed) db.drop();
    else console.error('FAILED rehearsal database retained: ' + db.name);
  }
}
if (require.main === module) run().catch(error => { console.error(error.stack); process.exitCode = 1; });
module.exports = { run };
