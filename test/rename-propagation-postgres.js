'use strict';
/*
 * rename-propagation-postgres.js — migrations/2026-09-23-rename-propagation.sql
 * on a disposable PostgreSQL 17, before anyone applies it live.
 *
 * Needs RENAME_PG_BIN (or F42_REHEARSAL_PGBIN): a directory holding initdb,
 * pg_ctl and psql. It creates a throwaway cluster in the temp directory,
 * builds a scaffold of the live tables and triggers the migration touches
 * (columns and trigger bodies copied from the live catalog on 2026-09-23),
 * applies the real WR-101 logbook migration and then this migration, and
 * proves every direction, edge case and failure in docs/ops/RENAME_PLAN.md
 * sections D and E. No live database is touched.
 *
 *   RENAME_PG_BIN=/path/to/pgsql/bin node test/rename-propagation-postgres.js
 */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { TITLES, RENAMES, NAMES_OF, SEP } = require('./fixtures/title-name-rule-fixtures');

const ROOT = path.resolve(__dirname, '..');
const BIN = process.env.RENAME_PG_BIN || process.env.F42_REHEARSAL_PGBIN || '';
if (!BIN || !fs.existsSync(path.join(BIN, process.platform === 'win32' ? 'initdb.exe' : 'initdb'))) {
  throw Error('DISPOSABLE_REQUIRED: set RENAME_PG_BIN to a PostgreSQL 17 bin directory');
}
const exe = (n) => path.join(BIN, process.platform === 'win32' ? n + '.exe' : n);
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-prop-'));
const data = path.join(base, 'data');
const port = String(56000 + (process.pid % 1000));

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw Error(cmd + ' failed: ' + (r.stderr || r.stdout));
  return r;
}
function psqlFile(file) {
  return run(exe('psql'), ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', port,
    '-U', 'postgres', '-d', 'postgres', '-f', file]);
}
let n = 0;
function sql(text) {
  const f = path.join(base, 'q' + (n++) + '.sql');
  fs.writeFileSync(f, text, 'utf8');
  return psqlFile(f).stdout.trim();
}
const one = (text) => { const out = sql(text).split('\n').filter(Boolean); return out[out.length - 1]; };
const json = (text) => JSON.parse(one(text));

const SCAFFOLD = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create extension if not exists pgcrypto;
create table public.syncview_runtime_flags (key text primary key, value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(), updated_by text);
create table public.calendar_posts (client text not null, id text primary key, updated_at text, name text,
  status text, title_status text, title_tweaks text, client_title_approved_at text, video_status text,
  graphic_status text, video_deliverable_id text, graphic_deliverable_id text);
create table public.sample_reviews (client text not null, id text primary key, name text, status text,
  video_status text, updated_at text, video_deliverable_id text, graphic_deliverable_id text);
create table public.deliverables (id text primary key, identifier text, batch_id text, client_slug text not null,
  team text, kind text, title text not null, status text default 'todo', status_at timestamptz,
  origin text, card_id text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), linear_raw jsonb);
create table public.deliverable_events (id bigint generated always as identity primary key, deliverable_id text,
  batch_id text, client_slug text not null, ts timestamptz not null default now(), actor text, role text,
  action text not null, from_status text, to_status text,
  source text not null check (source in ('ui','mirror','reconcile','backfill','system','outbound')),
  payload jsonb, event_key text, event_assignee_id uuid, event_assignee_attribution text not null default 'unknown');
create function public.track_b_deliverable_touch_timestamps() returns trigger language plpgsql as $f$
begin new.updated_at := now(); if tg_op = 'INSERT' and new.status_at is null then new.status_at := now();
elsif tg_op = 'UPDATE' and new.status is distinct from old.status then new.status_at := now(); end if; return new; end $f$;
create trigger track_b_deliverable_touch_timestamps_before before insert or update on public.deliverables
  for each row execute function public.track_b_deliverable_touch_timestamps();
create function public.track_b_deliverable_ledger_guard() returns trigger language plpgsql security definer
set search_path to 'public' as $f$
begin if current_setting('app.event_written', true) = '1' then return null; end if;
insert into public.deliverable_events (deliverable_id, batch_id, client_slug, action, source, payload)
values (new.id, new.batch_id, new.client_slug, 'update', 'system', jsonb_build_object('op', tg_op, 'reason', 'rpc_bypass_guard'));
return null; end $f$;
create trigger track_b_deliverable_ledger_guard_after after insert or update on public.deliverables
  for each row execute function public.track_b_deliverable_ledger_guard();
`;

(async () => {
  const rule = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/title-name-rule.mjs')).href);
  run(exe('initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C']);
  // stdio must be ignored: the postmaster inherits pg_ctl's pipes, so a piped
  // spawn never sees EOF (on Windows it hangs outright).
  const started = spawnSync(exe('pg_ctl'), ['-D', data, '-l', path.join(base, 'server.log'), '-o',
    '-p ' + port + ' -c listen_addresses=127.0.0.1', '-w', 'start'], { stdio: 'ignore' });
  if (started.status !== 0) throw Error('pg_ctl start failed; see ' + path.join(base, 'server.log'));
  let passed = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };
  const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); passed++; };
  try {
    sql(SCAFFOLD);
    psqlFile(path.join(ROOT, 'supabase/migrations/20260913044451_write_refusal_diagnostics_preparation.sql'));
    psqlFile(path.join(ROOT, 'migrations/2026-09-23-rename-propagation.sql'));
    psqlFile(path.join(ROOT, 'migrations/2026-09-23-refusal-receipt-title-operation.sql'));
    psqlFile(path.join(ROOT, 'migrations/2026-09-23-refusal-receipt-title-operation.sql'));
    // Idempotent: a second apply must succeed and change nothing.
    psqlFile(path.join(ROOT, 'migrations/2026-09-23-rename-propagation.sql'));
    ok(true, 'migration applies twice');

    // ── B: the SQL copy agrees with the module on every fixture ──
    const payload = JSON.stringify({ titles: TITLES, renames: RENAMES.map(([o, nm]) => [o, nm]), names: NAMES_OF.map(([t]) => t) });
    const got = json(`select jsonb_build_object(
      'parts', (select jsonb_agg(public.syncview_title_parts(t) order by i) from jsonb_array_elements_text($j$${payload}$j$::jsonb->'titles') with ordinality x(t, i)),
      'renames', (select jsonb_agg(public.syncview_rename_title(r->>0, r->>1) order by i) from jsonb_array_elements($j$${payload}$j$::jsonb->'renames') with ordinality x(r, i)),
      'names', (select jsonb_agg(public.syncview_title_name_of(t) order by i) from jsonb_array_elements_text($j$${payload}$j$::jsonb->'names') with ordinality x(t, i)))`);
    TITLES.forEach((t, i) => {
      const mine = rule.titleParts(t);
      const theirs = got.parts[i];
      // ordinal is compared through `digits`: JSON.parse rounds a huge SQL numeric.
      const drop = (p) => p && { sample: p.sample, kind: p.kind, digits: p.digits, name: p.name };
      eq(drop(theirs), drop(mine), 'SQL parts ' + JSON.stringify(t));
    });
    RENAMES.forEach(([o, nm, expected], i) => eq(got.renames[i], expected, 'SQL rename ' + JSON.stringify([o, nm]).slice(0, 80)));
    NAMES_OF.forEach(([, expected], i) => eq(got.names[i], expected, 'SQL nameOf'));

    // ── Fixture rows ──
    const seed = (card, video, thumb, extra = {}) => sql(`
      insert into public.deliverables (id, client_slug, team, kind, title, origin, card_id, created_at, updated_at)
      values ('${card}-v', 'c1', 'video', 'video', $t$${video}$t$, '${extra.origin || 'calendar'}', '${card}', now() - interval '1 day', '2026-01-01T00:00:00Z'),
             ('${card}-g', 'c1', 'graphics', 'thumbnail', $t$${thumb}$t$, '${extra.origin || 'calendar'}', '${card}', now() - interval '1 day', '2026-01-01T00:00:00Z');
      insert into public.${extra.table || 'calendar_posts'} (client, id, name, ${extra.table === 'sample_reviews' ? '' : "title_status, client_title_approved_at, "}video_deliverable_id, graphic_deliverable_id)
      values ('c1', '${card}', 'Old', ${extra.table === 'sample_reviews' ? '' : "'approved', '2026-09-01T00:00:00Z', "}'${card}-v', '${card}-g');`);
    const title = (id) => one(`select title from public.deliverables where id = '${id}'`);
    const flags = (v) => sql(`update public.syncview_runtime_flags set value = '${JSON.stringify(v)}' where key = 'rename_propagation'`);
    const drain = () => json(`select public.rename_propagation_drain(200)`);
    const outboxCount = () => Number(one(`select count(*) from public.rename_propagation_outbox`));

    // ── Dormant by default ──
    seed('k0', 'Video 1', 'Thumbnail 1');
    sql(`update public.calendar_posts set name = 'Dormant' where id = 'k0'`);
    eq(drain(), { dormant: 1 }, 'flags default off: recorded but dormant');
    eq(title('k0-v'), 'Video 1', 'dormant does not rename');

    flags({ card_to_subissue: true, subissue_to_card: false, samples: false });

    // ── D1/D6: card -> video and thumbnail; stamps and approvals untouched; no loop ──
    seed('k1', 'Video 4', 'Thumbnail 4');
    const stampBefore = one(`select updated_at from public.deliverables where id = 'k1-v'`);
    sql(`update public.calendar_posts set name = 'Gym day' where id = 'k1'`);
    const before = outboxCount();
    eq(drain(), { done: 1 }, 'card rename drains');
    eq(title('k1-v'), 'Video 4' + SEP + 'Gym day', 'D1 video');
    eq(title('k1-g'), 'Thumbnail 4' + SEP + 'Gym day', 'D6 thumbnail sibling');
    eq(one(`select updated_at from public.deliverables where id = 'k1-v'`), stampBefore, 'updated_at not moved (approvals cannot conflict)');
    eq(one(`select title_status || '|' || client_title_approved_at from public.calendar_posts where id = 'k1'`), 'approved|2026-09-01T00:00:00Z', 'approval untouched');
    eq(outboxCount(), before, 'propagated writes record nothing (no loop)');
    eq(one(`select count(*) from public.deliverable_events where payload->>'reason' = 'rename_propagation' and deliverable_id like 'k1-%'`), '2', 'one ledger event per sub-issue');
    eq(one(`select count(*) from public.deliverable_events where payload->>'reason' = 'rpc_bypass_guard' and payload->>'op' = 'UPDATE' and deliverable_id like 'k1-%'`), '0', 'no anonymous bypass event');
    eq(drain(), {}, 'nothing left to do');

    // ── D2 overwrite, D7 separator in name, D8 empty, D4 out of format ──
    seed('k2', 'Video 4' + SEP + 'Something else', 'Promo clip FINAL - edit 2');
    sql(`update public.calendar_posts set name = 'X${SEP}part 3' where id = 'k2'`); drain();
    eq(title('k2-v'), 'Video 4' + SEP + 'X' + SEP + 'part 3', 'D2+D7');
    eq(title('k2-g'), 'X' + SEP + 'part 3', 'D4 out of format takes the name whole');
    sql(`update public.calendar_posts set name = '' where id = 'k2'`);
    eq(drain(), { skipped: 1 }, 'D9 empty name cannot blank an out-of-format title');
    eq(title('k2-v'), 'Video 4', 'D8 numbered title goes bare');
    eq(title('k2-g'), 'X' + SEP + 'part 3', 'D9 out-of-format title kept');
    const logged = Number(one(`select count(*) from write_refusal_diagnostics.receipts_v1`));
    ok(logged >= 1, 'skip is written to the WR-101 logbook');

    // ── Numbered-looking name, too long, emoji, spaces ──
    seed('k3', 'Video 9', 'Promo clip');
    sql(`update public.calendar_posts set name = 'Video 7' where id = 'k3'`); drain();
    eq(title('k3-v'), 'Video 9' + SEP + 'Video 7', 'numbered title keeps its own number');
    eq(title('k3-g'), 'Promo clip', 'no number invented on an out-of-format title');
    sql(`update public.calendar_posts set name = repeat('x', 161) where id = 'k3'`);
    eq(drain(), { skipped: 1 }, '161 chars refused');
    sql(`update public.calendar_posts set name = '  ' || repeat(chr(127916), 160) || '  ' where id = 'k3'`); drain();
    eq(title('k3-v'), 'Video 9' + SEP + String.fromCodePoint(0x1f3ac).repeat(160), '160 emoji fit, spaces trimmed');

    // ── E3: a just-created sub-issue is deferred, then applied ──
    seed('k4', 'Video 2', 'Thumbnail 2');
    sql(`update public.deliverables set created_at = now() where id = 'k4-v'`);
    sql(`update public.calendar_posts set name = 'Fresh' where id = 'k4'`);
    eq(drain(), { deferred: 1 }, 'in-flight append deferred');
    eq(title('k4-v'), 'Video 2', 'deferred row untouched');
    eq(title('k4-g'), 'Thumbnail 2' + SEP + 'Fresh', 'settled sibling applied');
    sql(`update public.deliverables set created_at = now() - interval '1 hour' where id = 'k4-v';
         update public.rename_propagation_outbox set next_attempt_at = now() where state = 'deferred'`);
    eq(drain(), { done: 1 }, 'deferred row completes later');
    eq(title('k4-v'), 'Video 2' + SEP + 'Fresh', 'deferred applied');

    // ── C: two cards claiming one sub-issue -> skipped, never guessed ──
    seed('k5', 'Video 3', 'Thumbnail 3');
    sql(`insert into public.calendar_posts (client, id, name, video_deliverable_id) values ('c1', 'k5b', 'Other', 'k5-v');
         update public.calendar_posts set name = 'Ambiguous' where id = 'k5'`);
    eq(drain(), { skipped: 1 }, 'ambiguous link skipped');
    eq(title('k5-v'), 'Video 3', 'ambiguous target untouched');
    eq(one(`select detail->>'k5-v' from public.rename_propagation_outbox where source_id = 'k5' order by id desc limit 1`), 'ambiguous_link', 'reason recorded');

    // ── E1: the write fails -> retries with backoff -> gives up -> logbook ──
    seed('k6', 'Video 6', 'Thumbnail 6');
    sql(`create function public.fail_title() returns trigger language plpgsql as $f$ begin
           if new.title like '%FAILME%' then raise exception 'synthetic failure'; end if; return new; end $f$;
         create trigger fail_title before update on public.deliverables for each row execute function public.fail_title();
         update public.calendar_posts set name = 'FAILME' where id = 'k6'`);
    const logBefore = Number(one(`select count(*) from write_refusal_diagnostics.receipts_v1 where status = 503`));
    for (let i = 0; i < 6; i++) {
      drain();
      sql(`update public.rename_propagation_outbox set next_attempt_at = now() where source_id = 'k6'`);
    }
    eq(one(`select state || ':' || attempts from public.rename_propagation_outbox where source_id = 'k6'`), 'failed:6', 'gives up after six attempts');
    eq(Number(one(`select count(*) from write_refusal_diagnostics.receipts_v1 where status = 503`)), logBefore + 1, 'give-up written to the logbook once');
    eq(one(`select state from public.rename_propagation_status_v1 where source_id = 'k6'`), 'failed', 'marker shows failed');
    sql(`drop trigger fail_title on public.deliverables`);
    eq(one(`select public.rename_propagation_retry(id) from public.rename_propagation_outbox where source_id = 'k6'`), 't', 'retry re-queues');
    eq(drain(), { done: 1 }, 'retried row succeeds');

    // ── E1: recording can never fail the save ──
    sql(`alter table public.rename_propagation_outbox add constraint synthetic_block check (source_id <> 'k7')`);
    seed('k7', 'Video 7', 'Thumbnail 7');
    sql(`update public.calendar_posts set name = 'Still saves', status = 'Approved' where id = 'k7'`);
    eq(one(`select name || '|' || status from public.calendar_posts where id = 'k7'`), 'Still saves|Approved', 'save commits even when recording fails');
    sql(`alter table public.rename_propagation_outbox drop constraint synthetic_block`);

    // ── Rule 6: Linear-made titles do not spread ──
    sql(`update public.deliverables set title = 'Video 7${SEP}From Linear', linear_raw = '{"x":1}' where id = 'k7-v'`);
    eq(one(`select state from public.rename_propagation_outbox where source_id = 'k7-v'`), 'ignored_linear', 'linear origin ignored');

    // ── Same source renamed twice before a drain: the latest name wins ──
    seed('k8', 'Video 8', 'Thumbnail 8');
    sql(`update public.calendar_posts set name = 'First' where id = 'k8'; update public.calendar_posts set name = 'Second' where id = 'k8'`);
    eq(drain(), { superseded: 1, done: 1 }, 'older rename superseded');
    eq(title('k8-v'), 'Video 8' + SEP + 'Second', 'latest name applied');

    // ── Release 2: sub-issue -> card -> sibling ──
    sql(`update public.deliverables set title = 'Video 8${SEP}Dormant side' where id = 'k8-v'`);
    eq(drain(), { dormant: 1 }, 'sub-issue direction dormant in release 1');
    flags({ card_to_subissue: true, subissue_to_card: true, samples: true });
    seed('k9', 'Video 5' + SEP + 'Launch', 'Thumbnail 5' + SEP + 'Launch');
    sql(`update public.deliverables set title = 'Video 5${SEP}Launch v2' where id = 'k9-v'`);
    eq(drain(), { done: 1 }, 'sub-issue rename drains');
    eq(one(`select name from public.calendar_posts where id = 'k9'`), 'Launch v2', 'D3 card follows');
    eq(title('k9-g'), 'Thumbnail 5' + SEP + 'Launch v2', 'D6 sibling follows through the card');
    eq(one(`select title_status from public.calendar_posts where id = 'k9'`), 'approved', 'approval untouched');
    eq(drain(), {}, 'no loop');

    // ── D5: out-of-format sub-issue renamed -> card takes the whole title ──
    seed('k10', 'Promo clip FINAL', 'Thumbnail 10');
    sql(`update public.deliverables set title = 'Promo C' where id = 'k10-v'`); drain();
    eq(one(`select name from public.calendar_posts where id = 'k10'`), 'Promo C', 'D5 card');
    eq(title('k10-g'), 'Thumbnail 10' + SEP + 'Promo C', 'D5 sibling');

    // ── E4: both sides renamed at once; the later rename wins everywhere ──
    seed('k11', 'Video 11', 'Thumbnail 11');
    sql(`update public.calendar_posts set name = 'Card side' where id = 'k11'`);
    sql(`select pg_sleep(0.01); update public.deliverables set title = 'Video 11${SEP}Issue side' where id = 'k11-v'`);
    drain();
    eq(one(`select name from public.calendar_posts where id = 'k11'`), 'Issue side', 'later sub-issue rename wins on the card');
    eq(title('k11-v'), 'Video 11' + SEP + 'Issue side', 'and on itself');
    eq(title('k11-g'), 'Thumbnail 11' + SEP + 'Issue side', 'and on the sibling');
    eq(drain(), {}, 'race settles with nothing left and no loop');

    // ── E4 reversed: the sub-issue first, the card a moment later -> card wins ──
    seed('k13', 'Video 13', 'Thumbnail 13');
    sql(`update public.deliverables set title = 'Video 13${SEP}Issue first' where id = 'k13-v'`);
    sql(`select pg_sleep(0.01); update public.calendar_posts set name = 'Card later' where id = 'k13'`);
    drain();
    eq(one(`select name from public.calendar_posts where id = 'k13'`), 'Card later', 'later card rename wins on the card');
    eq(title('k13-v'), 'Video 13' + SEP + 'Card later', 'and overwrites the earlier sub-issue rename');
    eq(title('k13-g'), 'Thumbnail 13' + SEP + 'Card later', 'and reaches the sibling');
    eq(drain(), {}, 'reverse race settles with no loop');

    // ── Both sides in ONE drain batch, rows interleaved: card, issue, card ──
    seed('k14', 'Video 14', 'Thumbnail 14');
    sql(`update public.calendar_posts set name = 'C1' where id = 'k14'`);
    sql(`select pg_sleep(0.01); update public.deliverables set title = 'Thumbnail 14${SEP}I1' where id = 'k14-g'`);
    sql(`select pg_sleep(0.01); update public.calendar_posts set name = 'C2' where id = 'k14'`);
    drain();
    eq([one(`select name from public.calendar_posts where id = 'k14'`), title('k14-v'), title('k14-g')],
      ['C2', 'Video 14' + SEP + 'C2', 'Thumbnail 14' + SEP + 'C2'], 'interleaved renames converge on the last one everywhere');
    eq(drain(), {}, 'interleaved race leaves nothing behind');

    // ── Sub-issue rename never touches the card's approvals or clock ──
    seed('k15', 'Video 15', 'Thumbnail 15');
    sql(`update public.calendar_posts set updated_at = '2026-01-02T03:04:05Z', status = 'Approved', video_status = 'Approved' where id = 'k15'`);
    sql(`update public.deliverables set title = 'Video 15${SEP}Renamed' where id = 'k15-v'`);
    drain();
    eq(one(`select name || '|' || updated_at || '|' || title_status || '|' || client_title_approved_at || '|' || status || '|' || video_status from public.calendar_posts where id = 'k15'`),
      'Renamed|2026-01-02T03:04:05Z|approved|2026-09-01T00:00:00Z|Approved|Approved', 'card renamed; approvals, statuses and clock untouched');

    // ── Samples ──
    seed('s1', 'Sample Video 1', 'Sample Thumbnail 1', { table: 'sample_reviews', origin: 'samples' });
    sql(`update public.sample_reviews set name = 'Sample name' where id = 's1'`); drain();
    eq(title('s1-v'), 'Sample Video 1' + SEP + 'Sample name', 'sample card -> sub-issue');
    sql(`update public.deliverables set title = 'Sample Thumbnail 1${SEP}Back' where id = 's1-g'`); drain();
    eq(one(`select name from public.sample_reviews where id = 's1'`), 'Back', 'sample sub-issue -> card');
    eq(title('s1-v'), 'Sample Video 1' + SEP + 'Back', 'sample sibling');

    // ── Release 2: a refused rename's receipt is recorded as operation 'title' ──
    const hash = 'a'.repeat(64);
    eq(json(`select public.production_write_refusal_record_v1(jsonb_build_object('attempt_id', gen_random_uuid(), 'origin', 'gateway', 'surface', 'production', 'operation', 'title', 'code', 'invalid_intake_item_name', 'status', 400, 'principal_kind', 'staff', 'member_id', null, 'identifiers', jsonb_build_object('id', '${hash}')))`).recorded, true, 'logbook accepts a title receipt');
    eq(one(`select count(*) from write_refusal_diagnostics.receipts_v1 where operation = 'title'`), '1', 'recorded as title, not other');

    // ── Privileges ──
    const priv = json(`select jsonb_build_object(
      'anon_outbox', has_table_privilege('anon', 'public.rename_propagation_outbox', 'select'),
      'auth_outbox', has_table_privilege('authenticated', 'public.rename_propagation_outbox', 'select'),
      'svc_outbox_write', has_table_privilege('service_role', 'public.rename_propagation_outbox', 'insert'),
      'anon_view', has_table_privilege('anon', 'public.rename_propagation_status_v1', 'select'),
      'anon_drain', has_function_privilege('anon', 'public.rename_propagation_drain(integer)', 'execute'),
      'auth_drain', has_function_privilege('authenticated', 'public.rename_propagation_drain(integer)', 'execute'),
      'svc_drain', has_function_privilege('service_role', 'public.rename_propagation_drain(integer)', 'execute'),
      'anon_poke', has_function_privilege('anon', 'public.rename_propagation_poke()', 'execute'),
      'anon_retry', has_function_privilege('anon', 'public.rename_propagation_retry(bigint)', 'execute'),
      'anon_apply', has_function_privilege('anon', 'public.rename_propagation_apply_deliverable(bigint,timestamptz,text,text,text,text)', 'execute'),
      'svc_apply', has_function_privilege('service_role', 'public.rename_propagation_apply_deliverable(bigint,timestamptz,text,text,text,text)', 'execute'),
      'svc_record', has_function_privilege('service_role', 'public.rename_propagation_record()', 'execute'),
      'anon_logbook', has_function_privilege('anon', 'public.rename_propagation_logbook(text,integer,text,text,text)', 'execute'))`);
    eq(priv, { anon_outbox: false, auth_outbox: false, svc_outbox_write: false, anon_view: true, anon_drain: false,
      auth_drain: false, svc_drain: true, anon_poke: true, anon_retry: true, anon_apply: false, svc_apply: false,
      svc_record: false, anon_logbook: false }, 'privileges exactly as designed');
    seed('k12', 'Video 12', 'Thumbnail 12');
    sql(`update public.calendar_posts set name = 'Poked' where id = 'k12'`);
    eq(json(`set role anon; select public.rename_propagation_poke()`), { done: 1 }, 'anon poke drains');
    eq(title('k12-v'), 'Video 12' + SEP + 'Poked', 'poke applied');

    console.log('rename-propagation-postgres: ' + passed + ' checks passed ✅');
  } finally {
    spawnSync(exe('pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { encoding: 'utf8' });
    try { fs.rmSync(base, { recursive: true, force: true }); } catch (_) { /* best effort */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
