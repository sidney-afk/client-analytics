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
 * Revised 2026-09-05 for the owner's label ruling (OPEN_REPAIRS 156): kind no
 * longer refuses, labels follow the card, and a contested slot can be resolved
 * with evict_occupant='card_wins'. Every shape the live measurement found is a
 * fixture here: the "Reel N" video row stamped thumbnail, the Video-team
 * thumbnail in a graphic slot, the empty native shell holding a slot, the
 * terminal shell, and the same-issue duplicate that must NOT be evicted.
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
-- The bind reads the card's Linear identity, so the stub needs the two
-- columns the live table carries (live-schema-baseline-2026-07-03.sql:38-39).
alter table public.calendar_posts add column if not exists linear_issue_id text;
alter table public.calendar_posts add column if not exists graphic_linear_issue_id text;
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
-- The Linear identity columns are populated because the bind REQUIRES the
-- card and the deliverable to name the same issue (Codex P1 on #1273: the card
-- pointer alone is not independent authority). A row with no identity, or a
-- disagreeing one, is a refusal -- so the fixture carries one of each.
-- linear_issue_uuid is set on the shells that must reach Linear through the
-- outbound lane when evicted, and left null on the one that must not.
insert into public.deliverables(id,batch_id,client_slug,team,kind,title,status,origin,card_id,linear_identifier,linear_issue_url,linear_issue_uuid) values
  ('del_ok',       'bat_acme', 'acme', 'video', 'video',     'V',  'todo', 'manual',  null,             'VID-100', null, null),
  ('del_gra',      'bat_acme', 'acme', 'video', 'thumbnail', 'T',  'todo', 'manual',  null,             'GRA-200', null, null),
  ('del_free',     'bat_acme', 'acme', 'video', 'video',     'F',  'todo', 'manual',  null,             'VID-300', null, null),
  ('del_want',     'bat_acme', 'acme', 'video', 'video',     'W',  'todo', 'manual',  null,             'VID-400', null, null),
  -- the live shape of an occupant: native-born, attached to the card, a
  -- different issue from the one the card points at, still in a live status.
  ('del_holder',   'bat_acme', 'acme', 'video', 'video',     'H',  'kasper_approval', 'calendar','card_taken', 'VID-410', null, 'uuid-holder'),
  ('del_other',    'bat_beta', 'beta', 'video', 'video',     'O',  'todo', 'manual',  null,             'VID-500', null, null),
  ('del_beta',     'bat_beta', 'beta', 'video', 'video',     'Z',  'todo', 'manual',  null,             'VID-600', null, null),
  ('del_bound',    'bat_acme', 'acme', 'video', 'video',     'B',  'todo', 'calendar','card_elsewhere', 'VID-700', null, null),
  -- team is video but kind is other: the pair the FIRST version refused, and
  -- the ruling now binds (the card's word, identity agreeing).
  ('del_wrongkind','bat_acme', 'acme', 'video', 'other',     'K',  'todo', 'manual',  null,             'VID-800', null, null),
  -- identity provable on the card side only, and on neither column here.
  ('del_delblind', 'bat_acme', 'acme', 'video', 'video',     'N',  'todo', 'manual',  null,             null,      null, null),
  -- identity provable on the deliverable side only.
  ('del_cardblind','bat_acme', 'acme', 'video', 'video',     'C',  'todo', 'manual',  null,             'VID-820', null, null),
  -- both sides provable, and they disagree.
  ('del_mismatch', 'bat_acme', 'acme', 'video', 'video',     'M',  'todo', 'manual',  null,             'VID-999', null, null),
  -- identity carried as a full issue URL rather than a bare identifier, which
  -- is the shape the live rows actually hold.
  ('del_url',      'bat_acme', 'acme', 'video', 'video',     'U',  'todo', 'manual',  null,             null,      'https://linear.app/synchro/issue/VID-850/some-title', null),
  -- the 14 live "Reel N" rows: a video-slot row stamped thumbnail by its batch
  -- parent's title. Its card ALSO has a real thumbnail bound in the graphic
  -- slot with the same kind, so without the label rule the bind would collide
  -- on deliverables_card_slot_unique (client, origin, card_id, kind).
  ('del_reel',      'bat_acme', 'acme', 'video',    'thumbnail', 'R',  'todo', 'manual',  null,        'VID-830', null, null),
  ('del_reel_thumb','bat_acme', 'acme', 'graphics', 'thumbnail', 'RT', 'todo', 'calendar','card_reel', 'GRA-831', null, null),
  -- the 9 live graphic slots holding a thumbnail tracked on the VIDEO team.
  ('del_vidthumb',  'bat_acme', 'acme', 'video',    'thumbnail', 'VT', 'todo', 'manual',  null,        'VID-840', null, null),
  -- the 26 live "Carousel"/"Story" rows: graphic slot, kind='other'. Bound,
  -- the kind becomes the slot key, because linear-inbound reads any kind but
  -- 'thumbnail' as the VIDEO slot (Codex P1 on #1291).
  ('del_carousel',  'bat_acme', 'acme', 'graphics', 'other',     'CA', 'todo', 'manual',  null,        'GRA-860', null, null),
  -- two projections of ONE issue: the second is not an occupant that lost.
  ('del_dupe_a',    'bat_acme', 'acme', 'video', 'video', 'DA', 'todo',            'manual',   null,        'VID-870', null, null),
  ('del_dupe_b',    'bat_acme', 'acme', 'video', 'video', 'DB', 'kasper_approval', 'calendar', 'card_dupe', 'VID-870', null, 'uuid-dupe-b'),
  -- a terminal occupant: detached, its status left alone, nothing sent.
  ('del_posted_keep','bat_acme','acme', 'video', 'video', 'PK', 'posted', 'manual',   null,          'VID-880', null, null),
  ('del_posted_occ', 'bat_acme','acme', 'video', 'video', 'PO', 'posted', 'calendar', 'card_posted', 'VID-881', null, 'uuid-posted-occ');

insert into public.calendar_posts(client, id, name, video_deliverable_id, graphic_deliverable_id, linear_issue_id, graphic_linear_issue_id) values
  ('acme','card_ok','Card OK','del_ok','del_gra','https://linear.app/synchro/issue/VID-100/a','GRA-200'),
  ('acme','card_free','Card Free','del_free',null,'VID-300',null),
  ('acme','card_taken','Card Taken','del_want',null,'VID-400',null),
  ('acme','card_nolink','Card No Link',null,null,'VID-050',null),
  ('acme','card_wrongkind','Card Wrong Kind','del_wrongkind',null,'VID-800',null),
  ('acme','card_delblind','Card Del Blind','del_delblind',null,'VID-810',null),
  ('acme','card_cardblind','Card Card Blind','del_cardblind',null,null,null),
  ('acme','card_mismatch','Card Mismatch','del_mismatch',null,'VID-901',null),
  ('acme','card_url','Card URL','del_url',null,'VID-850',null),
  ('acme','card_reel','Card Reel','del_reel','del_reel_thumb','VID-830','GRA-831'),
  ('acme','card_vidthumb','Card VidThumb',null,'del_vidthumb',null,'VID-840'),
  ('acme','card_carousel','Card Carousel',null,'del_carousel',null,'GRA-860'),
  ('acme','card_dupe','Card Dupe','del_dupe_a',null,'VID-870',null),
  ('acme','card_posted','Card Posted','del_posted_keep',null,'VID-880',null),
  ('beta','card_ok','Beta same id','del_beta',null,'VID-600',null);
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
      "select client_slug||'|'||origin||'|'||card_id||'|'||team||'|'||kind from public.deliverables where id='del_ok'");
    ok(bound === 'acme|calendar|card_ok|video|video',
      'the happy path binds all four crosswalk fields and leaves a video kind alone (' + bound + ')');
    const boundEvent = scalar(cluster,
      "select count(*) from public.deliverable_events where deliverable_id='del_ok' and action='crosswalk_bound'");
    const guardEvent = scalar(cluster,
      "select count(*) from public.deliverable_events where deliverable_id='del_ok' and action in ('update','status_change') and payload->>'reason'='rpc_bypass_guard'");
    ok(boundEvent === '1' && guardEvent === '0',
      'the bind writes its own crosswalk_bound event and the ledger guard\'s bare \'update\' is not written on top of it — the guard\'s \'create\' from the fixture insert is expected and not counted (' + boundEvent + '/' + guardEvent + ')');
    const links = scalar(cluster,
      "select count(*) from public.production_comment_card_links where card_id='card_ok' and component='video'");
    ok(links === '1', 'and the legacy comment was imported once (' + links + ')');
    const receipt = scalar(cluster, bind(
      { source_surface: 'calendar', deliverable_id: 'del_ok', card_id: 'card_ok', client_slug: 'acme', component: 'video' },
      [{ native_comment_id: 'n1', source_fingerprint: 'fp1', body: 'hello',
         author_key: 'smm:acme', author_name: 'SMM', role: 'smm', audience: 'internal',
         created_at: '2026-08-01T10:00:00Z' }]
    )).replace(/\s+/g, '');
    ok(/"processed":1/.test(receipt) && /"imported":0/.test(receipt) && /"already_linked":1/.test(receipt),
      'and a REPEAT of that call reports 0 imported / 1 already_linked rather than counting the loop -- '
      + 'a runner certifying "N comments copied" from this receipt is certifying inserts, not attempts');

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
    const gra = scalar(cluster, "select team||'|'||card_id||'|'||kind from public.deliverables where id='del_gra'");
    ok(gra === 'graphics|card_ok|thumbnail', 'a graphic binds to the graphics team and keeps its thumbnail kind (' + gra + ')');

    /* ---- the label rule: kind never refuses, and follows the card -------- */
    cluster.exec(bind({ source_surface: 'calendar', deliverable_id: 'del_wrongkind', card_id: 'card_wrongkind', client_slug: 'acme', component: 'video' }, []));
    const wk = scalar(cluster, "select card_id||'|'||kind from public.deliverables where id='del_wrongkind'");
    ok(wk === 'card_wrongkind|video',
      "a video-team row stamped kind='other' binds into the video slot when both sides name the same issue, and becomes kind='video' (" + wk + ')');

    /* the Jessica shape: the card's graphic slot already holds a real thumbnail
       of the SAME kind, so without normalisation this bind is a 23505. */
    const reelReceipt = scalar(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_reel', card_id: 'card_reel', client_slug: 'acme', component: 'video' }, [])).replace(/\s+/g, '');
    const reel = scalar(cluster, "select card_id||'|'||team||'|'||kind from public.deliverables where id='del_reel'");
    const reelThumb = scalar(cluster, "select coalesce(card_id,'<null>')||'|'||team||'|'||kind||'|'||status from public.deliverables where id='del_reel_thumb'");
    ok(reel === 'card_reel|video|video',
      "a 'Reel' row stamped thumbnail binds into the video slot and is relabelled kind='video' (" + reel + ')');
    ok(reelThumb === 'card_reel|graphics|thumbnail|todo',
      "and the same card's real thumbnail -- the OTHER slot's row -- is neither an occupant nor touched (" + reelThumb + ')');
    ok(/"kind_before":"thumbnail"/.test(reelReceipt) && /"kind":"video"/.test(reelReceipt) && /"evicted":\[\]/.test(reelReceipt),
      'and the receipt records the relabel and that nothing was evicted');

    /* a Video-team thumbnail in a graphic slot: prefix does not refuse either */
    cluster.exec(bind({ source_surface: 'calendar', deliverable_id: 'del_vidthumb', card_id: 'card_vidthumb', client_slug: 'acme', component: 'graphic' }, []));
    const vt = scalar(cluster, "select card_id||'|'||team||'|'||kind from public.deliverables where id='del_vidthumb'");
    ok(vt === 'card_vidthumb|graphics|thumbnail',
      'a thumbnail tracked on the Video team binds into the graphic slot the card gives it, taking the slot\'s team (' + vt + ')');

    /* a "Carousel" (kind=other) in a graphic slot: bound, its kind is the slot
       key, so linear-inbound can never route it into the video slot. */
    const caReceipt = scalar(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_carousel', card_id: 'card_carousel', client_slug: 'acme', component: 'graphic' }, [])).replace(/\s+/g, '');
    const ca = scalar(cluster, "select card_id||'|'||team||'|'||kind from public.deliverables where id='del_carousel'");
    ok(ca === 'card_carousel|graphics|thumbnail' && /"kind_before":"other"/.test(caReceipt) && /"kind":"thumbnail"/.test(caReceipt),
      "a graphics row stamped kind='other' binds into the graphic slot and becomes kind='thumbnail' -- the slot key linear-inbound and the unique index read (" + ca + ')');

    /* ---- every refusal, each reachable only via its own guard ---------- */
    refuses(cluster, bind({ source_surface: 'sxr', deliverable_id: 'del_free', card_id: 'card_free', client_slug: 'acme', component: 'video' }),
      'crosswalk_bind_invalid_identity', 'a non-calendar surface');
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_free', card_id: 'card_free', client_slug: 'acme', component: 'caption' }),
      'crosswalk_bind_invalid_identity', 'a component with no card slot');
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_free', card_id: 'card_free', client_slug: 'acme', component: 'video', evict_occupant: 'yes' }),
      'crosswalk_bind_invalid_evict_mode', 'an eviction mode that is not a named ruling');
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
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_delblind', card_id: 'card_delblind', client_slug: 'acme', component: 'video' }),
      'crosswalk_bind_linear_identity_unproven', 'a deliverable that names no Linear issue');
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_cardblind', card_id: 'card_cardblind', client_slug: 'acme', component: 'video' }),
      'crosswalk_bind_linear_identity_unproven', 'a card that names no Linear issue');
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_mismatch', card_id: 'card_mismatch', client_slug: 'acme', component: 'video' }),
      'crosswalk_bind_linear_identity_disagrees', 'a card and a deliverable naming DIFFERENT Linear issues');
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_want', card_id: 'card_taken', client_slug: 'acme', component: 'video' }),
      'crosswalk_bind_slot_occupied', 'a card slot another deliverable already holds, with no eviction asked for');
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_dupe_a', card_id: 'card_dupe', client_slug: 'acme', component: 'video', evict_occupant: 'card_wins' }),
      'crosswalk_bind_occupant_same_issue', 'an occupant that names the SAME issue as the card, even with eviction asked for');
    const dupeHeld = scalar(cluster, "select coalesce(card_id,'<null>')||'|'||status from public.deliverables where id='del_dupe_b'");
    ok(dupeHeld === 'card_dupe|kasper_approval', 'and that same-issue occupant is left exactly where it was (' + dupeHeld + ')');

    /* ---- the ruling: the card wins -------------------------------------- */
    const evictReceipt = scalar(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_want', card_id: 'card_taken', client_slug: 'acme', component: 'video', evict_occupant: 'card_wins' }, [])).replace(/\s+/g, '');
    const want = scalar(cluster, "select card_id||'|'||origin||'|'||kind from public.deliverables where id='del_want'");
    const holder = scalar(cluster, "select coalesce(card_id,'<null>')||'|'||status from public.deliverables where id='del_holder'");
    ok(want === 'card_taken|calendar|video', 'with evict_occupant=card_wins the row the card points at is bound (' + want + ')');
    ok(holder === '<null>|canceled', 'the live occupant is detached from the card AND canceled natively, so it leaves every queue (' + holder + ')');
    const evictEvent = scalar(cluster,
      "select from_status||'>'||to_status||'|'||(payload->>'mode')||'|'||(payload->>'kept_linear_identifier')||'|'||(payload->>'occupant_linear_identifier') from public.deliverable_events where deliverable_id='del_holder' and action='crosswalk_occupant_evicted'");
    ok(evictEvent === 'kasper_approval>canceled|canceled|VID-400|VID-410',
      'the eviction is written to deliverable_events with both issues named (' + evictEvent + ')');
    const outbox = scalar(cluster,
      "select operation||'|'||(payload->>'status')||'|'||status||'|'||dedup_key from public.mirror_outbox where entity='deliverable' and entity_id='del_holder'");
    ok(outbox === 'status|canceled|pending|crosswalk-evict:del_holder:canceled',
      'and the cancel is queued for the outbound lane, never sent to Linear directly (' + outbox + ')');
    ok(/"evicted":\[\{"mode":"canceled","status_before":"kasper_approval","deliverable_id":"del_holder","linear_identifier":"VID-410"\}\]/.test(evictReceipt)
      || (/"deliverable_id":"del_holder"/.test(evictReceipt) && /"mode":"canceled"/.test(evictReceipt) && /"status_before":"kasper_approval"/.test(evictReceipt)),
      'and the receipt lists the eviction with its prior status');

    /* a terminal occupant is detached and NOT re-statused, and nothing is queued */
    cluster.exec(bind({ source_surface: 'calendar', deliverable_id: 'del_posted_keep', card_id: 'card_posted', client_slug: 'acme', component: 'video', evict_occupant: 'card_wins' }, []));
    const postedKeep = scalar(cluster, "select card_id||'|'||status from public.deliverables where id='del_posted_keep'");
    const postedOcc = scalar(cluster, "select coalesce(card_id,'<null>')||'|'||status from public.deliverables where id='del_posted_occ'");
    const postedMode = scalar(cluster, "select payload->>'mode' from public.deliverable_events where deliverable_id='del_posted_occ' and action='crosswalk_occupant_evicted'");
    const postedOutbox = scalar(cluster, "select count(*) from public.mirror_outbox where entity_id='del_posted_occ'");
    ok(postedKeep === 'card_posted|posted' && postedOcc === '<null>|posted' && postedMode === 'detached' && postedOutbox === '0',
      'a terminal (posted) occupant is detached, its status left alone, recorded as mode=detached, and nothing is queued for Linear (' + postedOcc + '/' + postedMode + '/' + postedOutbox + ')');

    /* The identity check must read a full issue URL exactly as it reads a bare
       identifier -- live rows carry both shapes, and a repair that silently
       refused every URL row would look like a clean run over a third of the
       work. */
    cluster.exec(bind({ source_surface: 'calendar', deliverable_id: 'del_url', card_id: 'card_url', client_slug: 'acme', component: 'video' }, []));
    const urlBound = scalar(cluster, "select coalesce(card_id,'<null>') from public.deliverables where id='del_url'");
    ok(urlBound === 'card_url',
      'a deliverable whose identity is a full issue URL binds against a bare card identifier (' + urlBound + ')');

    /* cross-client: beta's card genuinely points at acme's deliverable */
    cluster.exec("update public.calendar_posts set video_deliverable_id='del_free' where client='beta' and id='card_ok';");
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_free', card_id: 'card_ok', client_slug: 'beta', component: 'video' }),
      'crosswalk_bind_client_mismatch', "another client's live deliverable");

    /* already bound elsewhere */
    cluster.exec("update public.calendar_posts set video_deliverable_id='del_bound' where client='acme' and id='card_free';");
    refuses(cluster, bind({ source_surface: 'calendar', deliverable_id: 'del_bound', card_id: 'card_free', client_slug: 'acme', component: 'video' }),
      'crosswalk_bind_already_bound_elsewhere', 'a deliverable already bound to a different card');

    /* ---- the refusals changed nothing --------------------------------- */
    /* Named as PAIRS, not as a set of ids with a set of cards: `del_bound`
       legitimately carries a card_id from the fixture, so "any of these rows is
       bound" would report a false failure, and loosening it to "origin is
       calendar" would stop noticing the thing it is here to notice. Each pair
       below is exactly one refused bind. */
    const untouched = scalar(cluster,
      "select count(*) from public.deliverables where (id, coalesce(card_id,'')) in "
      + "(('del_free','card_free'),('del_other','card_free'),"
      + "('del_bound','card_free'),('del_dupe_a','card_dupe'),"
      + "('del_delblind','card_delblind'),('del_cardblind','card_cardblind'),"
      + "('del_mismatch','card_mismatch'))");
    ok(untouched === '0',
      'every refusal left the deliverable exactly as it was (' + untouched + ' changed)');
    const stillOne = scalar(cluster, "select count(*) from public.production_comment_card_links");
    ok(stillOne === '1', 'and imported no comments (' + stillOne + ' link(s) total)');
    const flag = scalar(cluster, "select coalesce(current_setting('app.event_written', true), '<unset>')");
    ok(flag !== '1', 'and the ledger-guard bypass did not leak past the function (' + flag + ')');

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
