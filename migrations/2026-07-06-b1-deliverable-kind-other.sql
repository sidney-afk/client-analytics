-- Track B B1: widen measured operational deliverable kinds.
-- Additive/safe widening: B1 preflight found 28 in-window issues that are
-- neither video nor thumbnail. They backfill as kind='other' per spec section 2.2.

do $$
declare
  v_constraint text;
begin
  select c.conname
    into v_constraint
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'deliverables'
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) like '%kind%'
     and pg_get_constraintdef(c.oid) like '%video%'
     and pg_get_constraintdef(c.oid) like '%thumbnail%'
   order by c.conname
   limit 1;

  if v_constraint is not null then
    execute format('alter table public.deliverables drop constraint %I', v_constraint);
  end if;

  alter table public.deliverables
    add constraint deliverables_kind_check
    check (kind in ('video','thumbnail','other'));
end $$;
