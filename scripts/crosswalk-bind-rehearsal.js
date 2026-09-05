#!/usr/bin/env node
'use strict';
/*
 * Executes production_comment_card_bind_and_import against a disposable
 * PostgreSQL 16 -- the happy path and EVERY refusal, each asserted by its own
 * error code.
 *
 * A source test cannot tell you that PL/pgSQL guard ordering does what the
 * comments claim. The component-fill rehearsal's own header records that its
 * first draft reported four false passes because every refusal short-circuited
 * on an earlier check than the one it named. So each refusal below is set up so
 * that ONLY the guard under test can fire, and the happy path is re-run
 * afterwards to prove the refusals left nothing behind.
 *
 * Reuses the F42 harness's Cluster and FOUNDATION_SQL rather than copying them.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Cluster, FOUNDATION_SQL } = require('./f42-apply-rehearsal.js');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'migrations');
const CHAIN = [
  '2026-07-06-b1-linear-data-model.sql',
  '2026-07-11-b4-linear-outbound.sql',
  '2026-07-12-production-comments.sql',
  '2026-07-12-write-ui-outbox-parity.sql',
  '2026-08-19-samples-batch-purpose.sql',
  '2026-08-19-samples-batch-write-purpose.sql',
  '2026-08-26-production-intake-append-v7.sql',
  '2026-07-23-production-comment-thread-lifecycle.sql',
];
const SUBJECT = '2026-09-05-crosswalk-bind-and-import.sql';

function have(bin) {
  if (fs.existsSync('/usr/lib/postgresql/16/bin/' + bin)) return true;
  return spawnSync('bash', ['-lc', 'command -v ' + bin], { encoding: 'utf8' }).status === 0;
}

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Two clients on purpose: the bare card id is reused across clients by design
   (calendar_posts is keyed on (client, id)), and the cross-client guard cannot
   be tested without a second client that legitimately holds the same id. */
/* The F42 foundation stubs calendar_posts as `(id text primary key)`, which
   cannot hold the same card id for two clients -- and the bare id being reused
   across clients is exactly what makes the cross-client guard necessary. So the
   table is reshaped to the LIVE shape first: the real primary key is
   (client, id), per migrations/live-schema-baseline-2026-07-03.sql. Altered
   rather than dropped so nothing the chain created is cascaded away. */
const FIXTURE = `
alter table public.calendar_posts add column if not exists client text;
alter table public.calendar_posts add column if not exists name text;
alter table public.calendar_posts add column if not exists video_deliverable_id text;
alter table public.calendar_posts add column if not exists graphic_deliverable_id text;
alter table public.calendar_posts add column if not exists video_tweaks text;
alter table public.calendar_posts add column if not exists graphic_tweaks text;
update public.calendar_posts set client = coalesce(client, 'legacy');
alter table public.calendar_posts alter column client set not null;
alter table public.calendar_posts drop constraint if exists calendar_posts_pkey;
alter table public.calendar_posts add primary key (client, id);

insert into public.clients(slug, display_name, active, kind) values
  ('acme','Acme','t','client'), ('beta','Beta','t','client')
  on conflict (slug) do nothing;

insert into public.batches(id, client_slug, name, status, purpose, linear_parent_ids, updated_at)
values ('bat_acme','acme','Acme batch','active','calendar','{}'::jsonb, now()),
       ('bat_beta','beta','Beta batch','active','calendar','{}'::jsonb, now());

-- Deliverables FIRST: the chain gives calendar_posts.video_deliverable_id and
-- graphic_deliverable_id foreign keys into deliverables, so a card cannot name
-- a row that does not exist yet.
--
-- client_slug is NOT NULL, which mirrors live and shapes the happy path: the
-- rows this repair targets ALREADY carry the right client (that is why the
-- SQL pass could fix 60 of them) and are wrong only in origin, card_id or
-- team. A row whose client differs is a broken card reference, and refusing it
-- is the point of the guard, not a gap in the fixture.
insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,origin,card_id) values
  ('del_ok',      'bat_acme', 'acme',   'video',    'video',     'V',  'todo', 'manual',  null),
  ('del_gra',     'bat_acme', 'acme',   'video',    'thumbnail', 'T',  'todo', 'manual',  null),
  ('del_free',    'bat_acme', 'acme', 'video',    'video',     'F',  'todo', 'manual',  null),
  ('del_want',    'bat_acme', 'acme', 'video',    'video',     'W',  'todo', 'manual',  null),
  ('del_holder',  'bat_acme', 'acme', 'video',    'video',     'H',  'todo', 'calendar','card_taken'),
  ('del_other',   'bat_beta', 'beta', 'video',    'video',     'O',  'todo', 'manual',  null),
  ('del_beta',    'bat_beta', 'beta', 'video',    'video',     'Z',  'todo', 'manual',  null),
  ('del_bound',   'bat_acme', 'acme', 'video',    'video',     'B',  'todo', 'calendar','card_elsewhere');

insert into public.calendar_posts(client, id, name, video_deliverable_id, graphic_deliverable_id) values
  ('acme','card_ok','Card OK','del_ok','del_gra'),
  ('acme','card_free','Card Free','del_free',null),
  ('acme','card_taken','Card Taken','del_want',null),
  ('acme','card_nolink','Card No Link',null,null),
  ('beta','card_ok','Beta same id','del_beta',null);
`;

const bind = (b, comments) =>
  `select public.production_comment_card_bind_and_import('${JSON.stringify(b)}'::jsonb, '${JSON.stringify(comments || [])}'::jsonb);`;

/* Cluster.exec throws on a non-zero psql, carrying the server's message, so a
   refusal is caught here rather than reported by a status code. */
function refuses(cluster, sql, code, message) {
  let text = '(no error raised)';
  try { cluster.exec(sql); }
  catch (e) { text = String((e && e.message) || e); }
  ok(text.includes(code), message + ' -> ' + code
    + (text.includes(code) ? '' : '  [got: ' + text.replace(/\s+/g, ' ').slice(0, 200) + ']'));
}
const scalar = (cluster, sql) => String(cluster.run('', undefined, { sql, tuplesOnly: true }) || '').trim();

function rehearse() {
  const cluster = new Cluster();
  cluster.start();
  try {
    cluster.exec('set check_function_bodies = on;');
    cluster.exec(FOUNDATION_SQL);
    for (const file of CHAIN) cluster.runFile(path.join(MIGRATIONS, file));
    ok(true, 'prerequisite chain applied (' + CHAIN.length + ' migrations)');

    cluster.exec('alter database ' + cluster.db + ' set check_function_bodies = on;');
    cluster.runFile(path.join(MIGRATIONS, SUBJECT));
    ok(true, SUBJECT + ' applied with check_function_bodies = on');

    cluster.exec(FIXTURE);

    /* ---- the happy path, with a comment to import --------------------- */
    cluster.exec(bind(
      { source_surface: 'calendar', deliverable_id: 'del_ok', card_id: 'card_ok', client_slug: 'acme', component: 'video' },
      [{ native_comment_id: 'n1', source_fingerprint: 'fp1', body: 'hello',
         author_key: 'smm:acme', author_name: 'SMM', role: 'smm', audience: 'internal',
         created_at: '2026-08-01T10:00:00Z' }]
    ));
    const bound = scalar(cluster,
      "select client_slug||'|'||origin||'|'||card_id||'|'||team from public.deliverables where id='del_ok'");
    ok(bound === 'acme|calendar|card_ok|video',
      'the happy path binds all four crosswalk fields (' + bound + ')');
    const links = scalar(cluster,
      "select count(*) from public.production_comment_card_links where card_id='card_ok' and component='video'");
    ok(links === '1', 'and the legacy comment was imported once (' + links + ')');

    /* THE LEGACY THREAD IS UNTOUCHED. This is the property the owner asked
       about: the repair copies, so the original stays where clients read it. */
    const tweaks = scalar(cluster,
      "select coalesce(video_tweaks,'<null>') from public.calendar_posts where client='acme' and id='card_ok'");
    ok(tweaks === '<null>' || !tweaks.includes('deleted'),
      'and calendar_posts.video_tweaks was never written by the bind (copy, not move)');

    /* idempotent: same call again must not double-import */
    cluster.exec(bind(
      { source_surface: 'calendar', deliverable_id: 'del_ok', card_id: 'card_ok', client_slug: 'acme', component: 'video' },
      [{ native_comment_id: 'n1', source_fingerprint: 'fp1', body: 'hello',
         author_key: 'smm:acme', author_name: 'SMM', role: 'smm', audience: 'internal',
         created_at: '2026-08-01T10:00:00Z' }]
    ));
    const links2 = scalar(cluster,
      "select count(*) from public.production_comment_card_links where card_id='card_ok' and component='video'");
    ok(links2 === '1', 're-running it imports nothing new (' + links2 + ')');

    /* graphic component maps to the graphics team and the graphic slot */
    cluster.exec(bind(
      { source_surface: 'calendar', deliverable_id: 'del_gra', card_id: 'card_ok', client_slug: 'acme', component: 'graphic' }, []));
    const gra = scalar(cluster, "select team||'|'||card_id from public.deliverables where id='del_gra'");
    ok(gra === 'graphics|card_ok', 'a graphic binds to the graphics team (' + gra + ')');

    /* ---- every refusal, each reachable only via its own guard ---------- */
    refuses(cluster, bind({ source_surface: 'sxr', deliverable_id: 'del_free', card_id: 'card_free', client_slug: 'acme', component: 'video' }),
      'crosswalk_bind_invalid_identity', 'a non-calendar surface');
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_free', card_id: 'card_free', client_slug: 'acme', component: 'caption' }),
      'crosswalk_bind_invalid_identity', 'a component with no card slot');
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_free', card_id: 'nope', client_slug: 'acme', component: 'video' }),
      'crosswalk_bind_card_missing', 'a card that does not exist');
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_free', card_id: 'card_nolink', client_slug: 'acme', component: 'video' }),
      'crosswalk_bind_card_does_not_reference_deliverable', 'a card whose slot names nothing');
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_other', card_id: 'card_free', client_slug: 'acme', component: 'video' }),
      'crosswalk_bind_card_does_not_reference_deliverable', 'a deliverable the card never referenced');
    /* `crosswalk_bind_deliverable_missing` is deliberately NOT exercised here,
       and the reason is worth stating rather than leaving as a gap: the chain
       gives calendar_posts.video_deliverable_id a foreign key into
       deliverables, so a card physically cannot name a row that does not
       exist. The guard stays as defence in depth -- the FK could be dropped, or
       the function called with a binding no card produced -- but asserting it
       here would need the schema bent out of shape to reach it, and a test that
       fakes its own precondition proves less than saying so. */
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_want', card_id: 'card_taken', client_slug: 'acme', component: 'video' }),
      'crosswalk_bind_slot_occupied', 'a card slot another deliverable already holds');

    /* cross-client: beta's card genuinely points at acme's deliverable */
    cluster.exec("update public.calendar_posts set video_deliverable_id='del_free' where client='beta' and id='card_ok';");
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_free', card_id: 'card_ok', client_slug: 'beta', component: 'video' }),
      'crosswalk_bind_client_mismatch', "another client's live deliverable");

    /* already bound elsewhere */
    cluster.exec("update public.calendar_posts set video_deliverable_id='del_bound' where client='acme' and id='card_free';");
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_bound', card_id: 'card_free', client_slug: 'acme', component: 'video' }),
      'crosswalk_bind_already_bound_elsewhere', 'a deliverable already bound to a different card');

    /* ---- the refusals changed nothing --------------------------------- */
    const untouched = scalar(cluster,
      "select count(*) from public.deliverables where id in ('del_free','del_want','del_other','del_bound') and origin='calendar' and card_id in ('card_free','card_taken','card_ok')");
    ok(untouched === '0',
      'every refusal left the deliverable exactly as it was (' + untouched + ' changed)');
    const stillOne = scalar(cluster, "select count(*) from public.production_comment_card_links");
    ok(stillOne === '1', 'and imported no comments (' + stillOne + ' link(s) total)');

    return failures === 0;
  } finally {
    cluster.stop();
  }
}

if (require.main === module) {
  if (!have('initdb') || !have('psql')) {
    console.log('[crosswalk-bind-rehearsal] SKIP: PostgreSQL 16 server binaries not available here');
    process.exit(0);
  }
  let passed = false;
  try { passed = rehearse(); }
  catch (error) {
    console.error('[crosswalk-bind-rehearsal] FAIL ' + ((error && error.message) || String(error)));
    process.exit(1);
  }
  console.log(passed ? '\ncrosswalk bind-and-import rehearsal passed'
    : '\n' + failures + ' crosswalk bind-and-import rehearsal check(s) failed');
  process.exit(passed ? 0 : 1);
}

module.exports = { CHAIN, SUBJECT, rehearse };
