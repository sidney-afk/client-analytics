'use strict';

/*
 * Regression proof for the two defects that made "Attach / replace" unusable
 * for every graphics deliverable, fixed by
 * migrations/2026-08-06-artifact-projection-scope-and-revision.sql.
 *
 * Both were invisible until the asset-probe fix let a request reach them, and
 * both are provable only against a real PostgreSQL: one is a plpgsql control
 * path, the other is a collision with a BEFORE UPDATE trigger. A source-only
 * assertion could not have caught either, which is exactly why this file
 * executes SQL rather than grepping it.
 *
 *   scope_invalid  -- an intake-created deliverable is stamped origin
 *                     'calendar' at birth and acquires its card later. The old
 *                     predicate refused every non-'manual' origin regardless of
 *                     card_id, so such a row could never be attached to.
 *   projection_failed -- the projection wrote thumb_rev='artifact-N' and read
 *                     that value back, but syncview_thumbnail_thumb_rev_before_write
 *                     fires on `update of thumbnail_url` and overwrites it with
 *                     its own token. Readback matched zero rows and rolled the
 *                     attach back.
 *
 * The trigger below is the REAL one, extracted verbatim from its shipped
 * migration -- a hand-written imitation would not prove the collision.
 *
 * Opt-in like the other PostgreSQL proofs: set ARTIFACT_REQUIRE_POSTGRES=1 with
 * a loopback server. CI runs it on the disposable database.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

if (process.env.ARTIFACT_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP: artifact projection PostgreSQL proof uses the disposable CI database');
  process.exit(0);
}

const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
const pgHost = String(process.env.PGHOST || '').trim().toLowerCase();
assert.ok(
  allowedHosts.has(pgHost) || pgHost.startsWith('/'),
  'artifact projection proof refuses non-loopback PostgreSQL',
);

const root = path.resolve(__dirname, '..');

function extract(file, marker) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const start = src.indexOf(marker);
  assert.ok(start >= 0, `${marker} not found in ${file}`);
  const terminator = src.startsWith('create or replace function public.production_artifact_write', start)
    ? '$fn$;'
    : '$$;';
  const end = src.indexOf(terminator, start);
  assert.ok(end > start, `unterminated definition in ${file}`);
  return src.slice(start, end + terminator.length) + '\n';
}

const ARTIFACT_FN = 'create or replace function public.production_artifact_write';
const oldFn = extract('migrations/2026-07-23-f34-f53-production-attachments.sql', ARTIFACT_FN);
const newFn = extract('migrations/2026-08-06-artifact-projection-scope-and-revision.sql', ARTIFACT_FN);
const triggerFn = extract(
  'migrations/2026-07-14-thumbnail-revision-v2.sql',
  'create or replace function public.syncview_thumbnail_thumb_rev_before_write',
);

function psql(sql, { expectFailure = false } = {}) {
  const run = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=0', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
    env: process.env,
  });
  assert.ok(run.status !== null, 'psql did not run — is PostgreSQL client installed?');
  const out = `${run.stdout || ''}${run.stderr || ''}`;
  if (!expectFailure) assert.ok(!/^ERROR:/m.test(out), `unexpected SQL error:\n${out}`);
  return out;
}

const SCHEMA = `
drop schema if exists public cascade; create schema public;
create table public.clients (slug text primary key, active boolean not null default true);
create table public.deliverables (
  id text primary key, client_slug text not null, team text not null,
  origin text, card_id text, file_url text, artifact_revision bigint,
  status text, updated_at text);
create table public.calendar_posts (
  id text not null, client text not null, thumbnail_url text, asset_url text,
  thumb_rev text, graphic_status text, updated_at text, graphic_deliverable_id text,
  primary key (client, id));
create table public.sample_reviews (like public.calendar_posts including all);
create function public.production_assert_authority(text,text,boolean,boolean)
  returns void language plpgsql as $s$ begin return; end $s$;
create function public.production_outbox_replay(text,text,text,text,text,text,text,boolean,boolean,text,text)
  returns boolean language plpgsql as $s$ begin return false; end $s$;
create function public.production_deliverable_write(p_row jsonb, p_event jsonb)
  returns public.deliverables language plpgsql as $s$
declare r public.deliverables%rowtype;
begin
  update public.deliverables d set file_url = nullif(btrim(p_row->>'file_url'),'')
  where d.id = nullif(btrim(p_row->>'id'),'') returning d.* into r;
  return r;
end $s$;
create function public.syncview_thumbnail_revision_v2_enabled(p_client text)
  returns boolean language sql stable as $s$ select true $s$;
create function public.syncview_base36(n bigint) returns text
  language sql immutable as $s$ select 'b36-' || n::text $s$;
create function public.syncview_thumbnail_drive_file_id(u text)
  returns text language sql immutable as $s$ select null::text $s$;
${triggerFn}
create trigger calendar_thumbnail_revision_v2_media
  before update of thumbnail_url, asset_url on public.calendar_posts
  for each row execute function public.syncview_thumbnail_thumb_rev_before_write('media');
`;

const FIXTURES = `
truncate public.deliverables, public.calendar_posts, public.clients;
insert into public.clients values ('acme', true);
insert into public.deliverables values ('d_nocard','acme','graphics','calendar',null,null,0,'todo',null);
insert into public.deliverables values ('d_linked','acme','graphics','calendar','card1',null,0,'todo',null);
insert into public.calendar_posts (id, client, thumbnail_url, thumb_rev, graphic_deliverable_id)
  values ('card1','acme',null,null,'d_linked');
insert into public.deliverables values ('d_badscope','acme','graphics','weird','card9',null,0,'todo',null);
`;

const attach = (id, url) => `
select public.production_artifact_write(
  jsonb_build_object('id','${id}','team','graphics','file_url','${url}'),
  jsonb_build_object('outbound', jsonb_build_object('operation','attachment')));
`;
const readFile = id => `select coalesce(file_url,'<null>') from public.deliverables where id='${id}';`;
const readCard = `select coalesce(thumbnail_url,'<null>'), coalesce(thumb_rev,'<null>') from public.calendar_posts where id='card1';`;

psql(SCHEMA);

/* The old definition must FAIL both ways. Asserting the bug still reproduces is
   what makes this a regression test rather than a test of the fix alone: if a
   future change removes the trigger or the predicate, this half stops failing
   and the proof says so instead of quietly passing. */
psql(oldFn);
let out = psql(FIXTURES + attach('d_nocard', 'https://x/a.png'), { expectFailure: true });
assert.ok(/artifact_card_projection_scope_invalid/.test(out), 'old function should refuse a card-less row');
assert.ok(/<null>/.test(psql(readFile('d_nocard'))), 'old function should roll the attach back');
console.log('  ok  old definition refuses an intake row that has no card yet');

out = psql(attach('d_linked', 'https://x/b.png'), { expectFailure: true });
assert.ok(/artifact_card_projection_failed/.test(out), 'old function should collide with the revision trigger');
assert.ok(/<null>/.test(psql(readFile('d_linked'))), 'old function should roll the linked attach back');
console.log('  ok  old definition collides with the thumbnail revision trigger on a linked card');

/* The new definition must succeed on both, without weakening the guard. */
psql(newFn);
psql(FIXTURES);

out = psql(attach('d_nocard', 'https://x/a.png'));
assert.ok(/"surface": null/.test(out) && /"updated": false/.test(out), 'card-less attach should skip projection');
assert.ok(/https:\/\/x\/a\.png/.test(psql(readFile('d_nocard'))), 'card-less attach should persist file_url');
console.log('  ok  a row with no card attaches and skips the projection');

out = psql(attach('d_linked', 'https://x/b.png'));
assert.ok(/"surface": "calendar"/.test(out) && /"updated": true/.test(out), 'linked attach should project');
assert.ok(/https:\/\/x\/b\.png/.test(psql(readFile('d_linked'))), 'linked attach should persist file_url');
const card = psql(readCard);
assert.ok(/https:\/\/x\/b\.png/.test(card), 'linked attach should write the card thumbnail');
assert.ok(/b36-/.test(card), 'the revision trigger still owns thumb_rev');
assert.ok(!/artifact-/.test(card), 'the projection must not fight the trigger for thumb_rev');
console.log('  ok  a linked card attaches, projects, and leaves thumb_rev to the trigger');

out = psql(attach('d_badscope', 'https://x/c.png'), { expectFailure: true });
assert.ok(/artifact_card_projection_scope_invalid/.test(out), 'a named card with an unknown surface must still refuse');
assert.ok(/<null>/.test(psql(readFile('d_badscope'))), 'the refusal must still roll the attach back');
console.log('  ok  a row naming a card with an unprojectable origin still refuses');

console.log('artifact projection scope and revision proof passed');
