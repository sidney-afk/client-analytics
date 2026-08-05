\set ON_ERROR_STOP on
\set QUIET 1
\pset format unaligned
\pset tuples_only on
\pset pager off

-- Fixed, diagnostic-only catalog inventory. The one-shot installer runs this
-- once on a separate connection after any connected forward path that cannot
-- produce a final PASS. It never retries, resumes, drops, or repairs an index.
begin;
set transaction read only;
set local search_path = pg_catalog, public;
set local statement_timeout = '2min';
set local lock_timeout = '5s';

with target as (
  select c.oid table_oid, c.relowner table_owner
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'deliverables'
    and c.relkind = 'r'
), expected(slot, relname) as (
  values
    ('trimmed_id'::text, 'deliverables_b3_trimmed_id_lookup_idx'::text),
    ('exact_url'::text, 'deliverables_b3_exact_url_lookup_idx'::text)
), named as (
  select e.slot, e.relname, idx.oid index_oid, idx.relkind,
    idx.relowner, idx.reloptions, t.table_owner, am.amname,
    i.indisvalid, i.indisready, i.indislive, i.indisunique, i.indpred,
    i.indnkeyatts, i.indnatts,
    case when i.indexrelid is not null and i.indnkeyatts >= 1
      then pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) end k1,
    case when i.indexrelid is not null and i.indnkeyatts >= 2
      then pg_catalog.pg_get_indexdef(i.indexrelid, 2, true) end k2,
    case when i.indexrelid is not null and i.indnkeyatts >= 3
      then pg_catalog.pg_get_indexdef(i.indexrelid, 3, true) end k3
  from expected e
  cross join target t
  left join pg_catalog.pg_class idx
    on idx.relnamespace = 'public'::regnamespace
   and idx.relname = e.relname
  left join pg_catalog.pg_index i
    on i.indexrelid = idx.oid
   and i.indrelid = t.table_oid
  left join pg_catalog.pg_am am on am.oid = idx.relam
), judged as (
  select n.*,
    case
      when n.index_oid is null then false
      when n.slot = 'trimmed_id'
       and n.relkind in ('i','I')
       and n.amname = 'btree'
       and not n.indisunique
       and n.indpred is null
       and n.reloptions is null
       and n.indnkeyatts = 1
       and n.indnatts = 1
       and n.relowner = n.table_owner
       and n.k1 = 'btrim(COALESCE(id, ''''::text))' then true
      when n.slot = 'exact_url'
       and n.relkind in ('i','I')
       and n.amname = 'btree'
       and not n.indisunique
       and n.indpred is null
       and n.reloptions is null
       and n.indnkeyatts = 3
       and n.indnatts = 3
       and n.relowner = n.table_owner
       and n.k1 = 'lower(btrim(COALESCE(client_slug, ''''::text)))'
       and n.k2 = 'lower(btrim(COALESCE(kind, ''''::text)))'
       and n.k3 = 'b3_scoped_linear_url_projection(linear_issue_url)' then true
      else false
    end definition_exact
  from named n
), states as (
  select j.*,
    case
      when j.index_oid is null then 'MISSING'
      when j.definition_exact
       and j.indisvalid and j.indisready and j.indislive then 'EXACT_VALID'
      when j.definition_exact
       and (not j.indisvalid or not j.indisready or not j.indislive)
        then 'INVALID_OR_NOT_READY'
      else 'WRONG_DEFINITION'
    end state
  from judged j
), all_indexes as (
  select i.indexrelid, idx.relname, am.amname, i.indpred,
    i.indnkeyatts, i.indnatts,
    pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) k1,
    case when i.indnkeyatts >= 2
      then pg_catalog.pg_get_indexdef(i.indexrelid, 2, true) end k2,
    case when i.indnkeyatts >= 3
      then pg_catalog.pg_get_indexdef(i.indexrelid, 3, true) end k3
  from target t
  join pg_catalog.pg_index i on i.indrelid = t.table_oid
  join pg_catalog.pg_class idx on idx.oid = i.indexrelid
  join pg_catalog.pg_am am on am.oid = idx.relam
), equivalent_other as (
  select count(*) equivalent_other_count
  from all_indexes i
  where i.relname not in (
      'deliverables_b3_trimmed_id_lookup_idx',
      'deliverables_b3_exact_url_lookup_idx'
    )
    and i.amname = 'btree'
    and i.indpred is null
    and (
      (
        i.indnkeyatts = 1 and i.indnatts = 1
        and i.k1 = 'btrim(COALESCE(id, ''''::text))'
      ) or (
        i.indnkeyatts = 3 and i.indnatts = 3
        and i.k1 = 'lower(btrim(COALESCE(client_slug, ''''::text)))'
        and i.k2 = 'lower(btrim(COALESCE(kind, ''''::text)))'
        and i.k3 = 'b3_scoped_linear_url_projection(linear_issue_url)'
      )
    )
), dependency as (
  select count(*) dependency_count
  from states s
  join pg_catalog.pg_depend d
    on d.classid = 'pg_catalog.pg_class'::regclass
   and d.objid = s.index_oid
   and d.objsubid = 0
  where s.slot = 'exact_url'
    and s.definition_exact
    and d.refclassid = 'pg_catalog.pg_proc'::regclass
    and d.refobjid = to_regprocedure(
      'public.b3_scoped_linear_url_projection(text)'
    )
    and d.refobjsubid = 0
    and d.deptype = 'n'
), summary as (
  select
    count(*) filter (where index_oid is not null) named_index_count,
    count(*) filter (where state = 'EXACT_VALID') exact_index_count,
    count(*) filter (where index_oid is not null and not indisvalid)
      invalid_index_count,
    count(*) filter (where index_oid is not null and indisready)
      ready_index_count,
    count(*) filter (where index_oid is not null and indislive)
      live_index_count,
    max(state) filter (where slot = 'trimmed_id') trimmed_id_index_state,
    max(state) filter (where slot = 'exact_url') exact_url_index_state
  from states
)
select jsonb_build_object(
  'contract', 'syncview-b3-accelerator-failure-inventory-v1',
  'status', 'PASS',
  'inventory_state', case
    when s.named_index_count = 0
     and e.equivalent_other_count = 0 then 'FRESH'
    when s.named_index_count = 2
     and s.exact_index_count = 2
     and e.equivalent_other_count = 0
     and d.dependency_count = 1 then 'EXACT_COMPLETE'
    else 'REVIEW_REQUIRED'
  end,
  'trimmed_id_index_state', s.trimmed_id_index_state,
  'exact_url_index_state', s.exact_url_index_state,
  'named_index_count', s.named_index_count,
  'exact_index_count', s.exact_index_count,
  'equivalent_other_count', e.equivalent_other_count,
  'invalid_index_count', s.invalid_index_count,
  'ready_index_count', s.ready_index_count,
  'live_index_count', s.live_index_count,
  'url_projector_dependency_count', d.dependency_count,
  'active_build_count', (
    select count(*)
    from target t
    join pg_catalog.pg_stat_progress_create_index p on p.relid = t.table_oid
  ),
  'search_path_pinned', current_setting('search_path') = 'pg_catalog, public',
  'transaction_read_only', current_setting('transaction_read_only') = 'on',
  'current_xact_id_assigned', pg_current_xact_id_if_assigned() is not null
)::text
from summary s
cross join equivalent_other e
cross join dependency d;

commit;
