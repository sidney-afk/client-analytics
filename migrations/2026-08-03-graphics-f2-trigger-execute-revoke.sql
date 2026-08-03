-- Graphics F2 read-role closure: remove the pre-existing PUBLIC attachment
-- path to the outbound-intent SECURITY DEFINER trigger function.
--
-- This changes one ACL only. PostgreSQL checks EXECUTE when CREATE TRIGGER is
-- issued; revoking it later does not remove, disable, or rebind the existing
-- deliverable_events trigger. The exact trigger binding is required both
-- before and after the revoke.

begin;

do $graphics_f2_preflight$
declare
  v_function_oid oid;
begin
  select p.oid
    into v_function_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'track_b_enqueue_outbound_intent'
    and p.pronargs = 0
    and p.prokind = 'f'
    and p.prosecdef
    and p.prorettype = 'pg_catalog.trigger'::regtype;

  if v_function_oid is null then
    raise exception 'graphics_f2_target_function_boundary_invalid';
  end if;

  if not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = v_function_oid
      and acl.grantee = 0::oid
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'graphics_f2_target_public_execute_missing';
  end if;

  if 1 <> (
    select count(*)
    from pg_trigger t
    where t.tgrelid = 'public.deliverable_events'::regclass
      and t.tgfoid = v_function_oid
      and t.tgname = 'track_b_outbound_intent_after'
      and not t.tgisinternal
      and t.tgenabled = 'O'
  ) then
    raise exception 'graphics_f2_existing_trigger_boundary_invalid';
  end if;
end;
$graphics_f2_preflight$;

revoke execute on function public.track_b_enqueue_outbound_intent() from public;

do $graphics_f2_readback$
declare
  v_function_oid oid := 'public.track_b_enqueue_outbound_intent()'::regprocedure::oid;
begin
  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = v_function_oid
      and acl.grantee = 0::oid
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'graphics_f2_target_public_execute_still_present';
  end if;

  if 1 <> (
    select count(*)
    from pg_trigger t
    where t.tgrelid = 'public.deliverable_events'::regclass
      and t.tgfoid = v_function_oid
      and t.tgname = 'track_b_outbound_intent_after'
      and not t.tgisinternal
      and t.tgenabled = 'O'
  ) then
    raise exception 'graphics_f2_existing_trigger_changed_by_revoke';
  end if;
end;
$graphics_f2_readback$;

select jsonb_build_object(
  'schema_version', 1,
  'target', 'public.track_b_enqueue_outbound_intent()',
  'target_public_execute', false,
  'existing_trigger_binding', 'PASS',
  'other_public_security_definer', coalesce((
    select jsonb_agg(
      format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
    )
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p', 'w')
      and p.prosecdef
      and p.oid <> 'public.track_b_enqueue_outbound_intent()'::regprocedure::oid
      and exists (
        select 1
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
        where acl.grantee = 0::oid
          and acl.privilege_type = 'EXECUTE'
      )
  ), '[]'::jsonb)
) as graphics_f2_trigger_execute_revoke_receipt;

commit;

-- Owner-only inverse if the reviewed ACL change itself must be backed out:
-- grant execute on function public.track_b_enqueue_outbound_intent() to public;
