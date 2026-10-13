#!/usr/bin/env node
'use strict';
/*
 * One-time repair (OPEN_REPAIRS, Mender 2026-10-13): Calendar notes marked
 * done or deleted only in the legacy card copy (calendar_posts.video_tweaks /
 * graphic_tweaks) while the canonical row in production_comments stayed open.
 *
 * This script prints SQL; it never connects to anything. Run the SQL with the
 * service role (the Supabase SQL editor or MCP).
 *
 *   node scripts/canonical-note-lifecycle-repair.js                 # dry run: counts only
 *   node scripts/canonical-note-lifecycle-repair.js --apply --client=<slug>
 *   node scripts/canonical-note-lifecycle-repair.js --apply --all   # Lighthouse, after review
 *
 * The dry run returns counts only: no note text, no client names, no ids.
 * Apply only ever SETS resolved_at / deleted_at where they are empty, so it
 * cannot reopen or undelete anything. Root notes only.
 *
 * Matching, per card component and its deliverable:
 *   1. canonical.native_comment_id = legacy note id (preferred);
 *   2. otherwise canonical.created_at = legacy created_at, only when exactly
 *      one canonical root on that deliverable has that time.
 */

function sqlLiteral(v) { return "'" + String(v).replace(/'/g, "''") + "'"; }

function parseArgs(argv) {
  const out = { apply: false, all: false, client: '' };
  for (const a of argv) {
    if (a === '--apply') out.apply = true;
    else if (a === '--all') out.all = true;
    else if (a.startsWith('--client=')) out.client = a.slice(9).trim();
    else throw new Error('unknown argument: ' + a);
  }
  if (out.apply && !out.all && !out.client) throw new Error('--apply needs --client=<slug> or --all');
  if (out.client && !/^[a-z0-9_-]{1,80}$/i.test(out.client)) throw new Error('bad --client');
  return out;
}

function matchesCte(client) {
  const scope = client ? `and p.client = ${sqlLiteral(client)}` : '';
  return `with legacy as (
  select p.client, x.comp, x.did, e->>'id' as lid,
         nullif(e->>'created_at','') as lcat,
         coalesce((e->>'done')::boolean, false) as ldone,
         coalesce((e->>'deleted')::boolean, false) as ldel,
         nullif(e->>'done_at','') as ldone_at,
         nullif(e->>'done_by','') as ldone_by,
         nullif(e->>'updated_at','') as lupd
  from public.calendar_posts p
  cross join lateral (values ('video', p.video_deliverable_id, p.video_tweaks),
                             ('graphic', p.graphic_deliverable_id, p.graphic_tweaks)) x(comp, did, tw)
  cross join lateral jsonb_array_elements(case when x.tw ~ '^\\s*\\[' then x.tw::jsonb else '[]'::jsonb end) e
  where coalesce(x.did, '') <> '' and coalesce(e->>'parent_id', '') = ''
    and (coalesce((e->>'done')::boolean, false) or coalesce((e->>'deleted')::boolean, false))
    ${scope}
), by_native as (
  select l.*, c.id as cid from legacy l
  join public.production_comments c on c.deliverable_id = l.did and c.parent_id is null
   and c.native_comment_id = l.lid
), by_time as (
  select l.*, min(c.id) as cid from legacy l
  join public.production_comments c on c.deliverable_id = l.did and c.parent_id is null
   and l.lcat ~ '^\\d{4}-' and c.created_at = l.lcat::timestamptz
  where not exists (select 1 from by_native n where n.did = l.did and n.lid = l.lid)
  group by l.client, l.comp, l.did, l.lid, l.lcat, l.ldone, l.ldel, l.ldone_at, l.ldone_by, l.lupd
  having count(*) = 1
), matched as (
  select * from by_native union all select * from by_time
), plan as (
  select m.*, c.resolved_at, c.deleted_at,
         (m.ldel and c.deleted_at is null) as want_delete,
         (m.ldone and not m.ldel and c.resolved_at is null and c.deleted_at is null) as want_resolve
  from matched m join public.production_comments c on c.id = m.cid
)`;
}

function dryRunSql(client) {
  return `${matchesCte(client)}
select
  (select count(*) from legacy) as legacy_done_or_deleted_roots,
  (select count(*) from matched) as matched_to_canonical,
  (select count(*) from by_native) as matched_by_native_id,
  (select count(*) from by_time) as matched_by_created_at,
  (select count(*) from legacy) - (select count(*) from matched) as unmatched,
  count(*) filter (where want_resolve) as would_resolve,
  count(*) filter (where want_delete) as would_delete,
  count(distinct (client, did)) filter (where want_resolve or want_delete) as deliverables_touched,
  count(distinct client) filter (where want_resolve or want_delete) as clients_touched
from plan;`;
}

function applySql(client) {
  return `begin;
${matchesCte(client)}
, resolved as (
  update public.production_comments c
     set resolved_at = coalesce(case when p.ldone_at ~ '^\\d{4}-' then p.ldone_at::timestamptz end, now()),
         resolved_by_name = coalesce(c.resolved_by_name, p.ldone_by),
         resolved_by_key = coalesce(c.resolved_by_key, 'repair:legacy-done'),
         version = c.version + 1,
         updated_at = now()
    from plan p
   where c.id = p.cid and p.want_resolve and c.resolved_at is null and c.deleted_at is null
  returning c.id
), deleted as (
  update public.production_comments c
     set deleted_at = coalesce(case when p.lupd ~ '^\\d{4}-' then p.lupd::timestamptz end, now()),
         deleted_by_key = coalesce(c.deleted_by_key, 'repair:legacy-deleted'),
         version = c.version + 1,
         updated_at = now()
    from plan p
   where c.id = p.cid and p.want_delete and c.deleted_at is null
  returning c.id
)
select (select count(*) from resolved) as resolved, (select count(*) from deleted) as deleted;
commit;`;
}

function build(argv) {
  const o = parseArgs(argv);
  if (!o.apply) return dryRunSql(o.client);
  return applySql(o.all ? '' : o.client);
}

module.exports = { build, parseArgs, dryRunSql, applySql };
if (require.main === module) {
  try { process.stdout.write(build(process.argv.slice(2)) + '\n'); }
  catch (e) { console.error(e.message); process.exit(2); }
}
