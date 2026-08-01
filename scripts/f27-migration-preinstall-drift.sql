\set ON_ERROR_STOP on

-- Disposable PostgreSQL-only drift injector for the hosted atomic-gate proof.
-- The workflow creates a fresh exact-subset database for each case, invokes
-- this file once, then requires the checked-in parent migration to abort.
\if :{?f27_gate_drift_case}
\else
  \echo F27_GATE_DRIFT_CASE_REQUIRED
  \quit 2
\endif

select :'f27_gate_drift_case' = 'runtime_f4' as is_runtime_f4,
       :'f27_gate_drift_case' = 'fence_generation' as is_fence_generation,
       :'f27_gate_drift_case' = 'fence_acl_public' as is_fence_acl_public,
       :'f27_gate_drift_case' = 'fence_acl_service_write' as is_fence_acl_service_write,
       :'f27_gate_drift_case' = 'fence_acl_service_grant' as is_fence_acl_service_grant,
       :'f27_gate_drift_case' = 'fence_acl_unexpected_grantee' as is_fence_acl_unexpected_grantee,
       :'f27_gate_drift_case' = 'function_source' as is_function_source,
       :'f27_gate_drift_case' = 'function_acl' as is_function_acl,
       :'f27_gate_drift_case' = 'mirror_enqueue_acl' as is_mirror_enqueue_acl,
       :'f27_gate_drift_case' = 'production_authority_source' as is_production_authority_source,
       :'f27_gate_drift_case' = 'production_authority_acl' as is_production_authority_acl,
       :'f27_gate_drift_case' = 'production_authority_overload' as is_production_authority_overload,
       :'f27_gate_drift_case' = 'extra_function_overload' as is_extra_function_overload,
       :'f27_gate_drift_case' = 'fence_shape' as is_fence_shape,
       :'f27_gate_drift_case' = 'outbox_catalog' as is_outbox_catalog,
       :'f27_gate_drift_case' = 'outbox_constraint' as is_outbox_constraint,
       :'f27_gate_drift_case' = 'outbox_index' as is_outbox_index,
       :'f27_gate_drift_case' = 'outbox_trigger' as is_outbox_trigger,
       :'f27_gate_drift_case' = 'extra_schema' as is_extra_schema,
       :'f27_gate_drift_case' = 'extra_type_domain' as is_extra_type_domain,
       :'f27_gate_drift_case' = 'extra_rule' as is_extra_rule,
       :'f27_gate_drift_case' = 'extra_inheritance' as is_extra_inheritance,
       :'f27_gate_drift_case' = 'extra_collation' as is_extra_collation,
       :'f27_gate_drift_case' = 'extra_opclass' as is_extra_opclass,
       :'f27_gate_drift_case' = 'extra_opfamily' as is_extra_opfamily
\gset

\if :is_runtime_f4
  update public.syncview_runtime_flags
  set value = '{"enabled":true}'::jsonb,
      updated_by = 'rollback-gate-drift-proof'
  where key = 'linear_legacy_parity_enabled';
\elif :is_fence_generation
  update public.track_b_f27_team_fences
  set generation = 1,
      updated_by = 'rollback-gate-drift-proof'
  where team = 'video';
\elif :is_fence_acl_public
  grant select on public.track_b_f27_team_fences to public;
\elif :is_fence_acl_service_write
  grant update on public.track_b_f27_team_fences to service_role;
\elif :is_fence_acl_service_grant
  grant select on public.track_b_f27_team_fences to service_role with grant option;
\elif :is_fence_acl_unexpected_grantee
  create role f27_unexpected_reader nologin;
  grant select on public.track_b_f27_team_fences to f27_unexpected_reader;
\elif :is_function_source
  create or replace function public.track_b_f27_write_authorization(p_team text)
  returns jsonb
  language plpgsql
  security definer
  stable
  set search_path = public
  as $drift$
  begin
    return jsonb_build_object('ok', false, 'drift', p_team);
  end;
  $drift$;
\elif :is_function_acl
  grant execute on function public.track_b_f27_write_authorization(text)
    to authenticated;
\elif :is_mirror_enqueue_acl
  grant execute on function public.mirror_outbox_enqueue(
    text, text, text, jsonb, text, timestamp with time zone, text, text,
    text, text, text, text, text, bigint, boolean
  ) to authenticated;
\elif :is_production_authority_source
  create or replace function public.production_assert_authority(
    p_client_slug text,
    p_team text,
    p_test_only boolean,
    p_legacy_parity boolean
  ) returns void
  language plpgsql
  security definer
  set search_path = public
  as $drift$
  begin
    raise notice 'drift';
  end;
  $drift$;
\elif :is_production_authority_acl
  grant execute on function public.production_assert_authority(
    text, text, boolean, boolean
  ) to authenticated;
\elif :is_production_authority_overload
  create function public.production_assert_authority(
    p_client_slug text,
    p_team text,
    p_test_only boolean,
    p_legacy_parity boolean,
    p_drift text
  ) returns void
  language sql
  as $drift$
    select;
  $drift$;
\elif :is_extra_function_overload
  create function public.track_b_f27_write_authorization(
    p_team text,
    p_drift text
  ) returns jsonb
  language sql
  immutable
  as $drift$
    select jsonb_build_object('team', p_team, 'drift', p_drift);
  $drift$;
\elif :is_fence_shape
  alter table public.track_b_f27_team_fences
    alter column generation drop not null;
\elif :is_outbox_catalog
  alter table public.mirror_outbox
    add column "MiXeDF27OutboxDrift" text;
\elif :is_outbox_constraint
  alter table public.mirror_outbox
    add constraint "MiXeDF27OutboxConstraint" check (id > 0);
\elif :is_outbox_index
  create index "MiXeDF27OutboxIndex"
    on public.mirror_outbox(id);
\elif :is_outbox_trigger
  create function public.rollback_outbox_trigger_drift()
  returns trigger
  language plpgsql
  as $drift$
  begin
    return new;
  end;
  $drift$;
  create trigger "MiXeDF27OutboxTrigger"
    before insert on public.mirror_outbox
    for each row execute function public.rollback_outbox_trigger_drift();
\elif :is_extra_schema
  create schema "MiXeDF27Schema";
\elif :is_extra_type_domain
  create type public."MiXeDF27Type" as enum ('drift');
  create domain public."MiXeDF27Domain" as text;
\elif :is_extra_rule
  create table public.rollback_rule_drift (id integer);
  create rule "MiXeDF27Rule" as
    on insert to public.rollback_rule_drift do instead nothing;
\elif :is_extra_inheritance
  create table public.rollback_inheritance_drift ()
    inherits (public.track_b_f27_team_fences);
\elif :is_extra_collation
  create collation public."MiXeDF27Collation" from pg_catalog."C";
\elif :is_extra_opclass
  create operator class public."MiXeDF27OperatorClass"
    for type integer using btree as
      operator 3 =;
\elif :is_extra_opfamily
  create operator family public."MiXeDF27OperatorFamily" using btree;
\else
  \echo F27_GATE_DRIFT_CASE_UNKNOWN
  \quit 2
\endif

select 'F27_PREINSTALL_DRIFT_INJECTED' as terminal,
       :'f27_gate_drift_case' as drift_case;
