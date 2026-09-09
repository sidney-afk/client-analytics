-- DRAFT / UNAPPLIED. Private committed-change history; no writer/auth change.
-- See docs/ops/CARD_CHANGE_HISTORY.md for installation, backup and rollback.
-- This transaction installs capture together with its private durable store.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- No IF NOT EXISTS: refuse an unexpected or partial prior installation rather
-- than claiming capture on an unknown table/trigger definition. Six owners
-- are mandatory. Missing prerequisites abort the entire installation.
do $check$
declare v_table text; v_expected text[]; v_actual text[]; v_client text;
begin
  foreach v_table in array array['calendar_posts','sample_reviews','batches',
    'deliverables','production_comments','workload_plan'] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'card_history_required_owner_missing: %', v_table;
    end if;
    v_expected := case when v_table in ('calendar_posts','sample_reviews') then array['client','id']
      when v_table = 'workload_plan' then array['issue_id'] else array['id'] end;
    select array_agg(a.attname::text order by k.ord) into v_actual
      from pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(attnum,ord)
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
      where c.conrelid=to_regclass('public.' || v_table) and c.contype='p';
    if v_actual is distinct from v_expected then
      raise exception 'card_history_owner_key_mismatch: %', v_table;
    end if;
    v_client := case when v_table in ('calendar_posts','sample_reviews','workload_plan')
      then 'client' else 'client_slug' end;
    if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.' || v_table)
      and attname=v_client and atttypid='text'::regtype and not attisdropped) then
      raise exception 'card_history_owner_client_column_mismatch: %', v_table;
    end if;
  end loop;
end;
$check$;

create table public.card_change_journal (
  id bigint generated always as identity primary key,
  journal_version integer not null default 1 check (journal_version = 1),
  relation_schema text not null check (relation_schema = 'public'),
  relation_name text not null check (relation_name in ('calendar_posts',
    'sample_reviews','batches','deliverables','production_comments','workload_plan')),
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  entity_key_before jsonb,
  entity_key_after jsonb,
  client_before text,
  client_after text,
  row_before jsonb,
  row_after jsonb,
  changed_columns text[] not null,
  row_schema jsonb not null,
  row_schema_md5 text not null,
  transaction_id bigint not null,
  transaction_started_at timestamptz not null,
  statement_started_at timestamptz not null,
  recorded_at timestamptz not null,
  database_name text not null,
  database_session_user text not null,
  database_role_setting text not null,
  request_claims jsonb not null,
  actor_assurance text not null default 'transport_only_person_unverified'
    check (actor_assurance = 'transport_only_person_unverified'),
  constraint card_change_journal_images check (
    (operation = 'INSERT' and row_before is null and entity_key_before is null
      and row_after is not null and entity_key_after is not null)
    or (operation = 'UPDATE' and row_before is not null and row_after is not null
      and entity_key_before is not null and entity_key_after is not null)
    or (operation = 'DELETE' and row_before is not null and entity_key_before is not null
      and row_after is null and entity_key_after is null)
  )
);

-- No foreign keys: deletion or reassignment of a current card, client, person,
-- batch, comment or crosswalk cannot cascade away its historical evidence.
create index card_change_journal_entity_before_idx
  on public.card_change_journal (relation_name, (md5(entity_key_before::text)), id);
create index card_change_journal_entity_after_idx
  on public.card_change_journal (relation_name, (md5(entity_key_after::text)), id);
create index card_change_journal_transaction_idx
  on public.card_change_journal (transaction_id, id);
create index card_change_journal_recorded_idx
  on public.card_change_journal (recorded_at);

alter table public.card_change_journal enable row level security;
revoke all on public.card_change_journal from public, anon, authenticated, service_role;
revoke all on sequence public.card_change_journal_id_seq from public, anon, authenticated, service_role;
grant select on public.card_change_journal to service_role;

comment on table public.card_change_journal is
  'Private immutable committed row images for six card owners. No client reader, realtime publication, automatic pruning or action-count claim. Minimum proposed retention 30 days; target 90 days plus recoverable checkpoint, subject to restore proof.';
comment on column public.card_change_journal.id is
  'Allocation order with rollback gaps; NOT global commit order. Same-row locks serialize versions; transaction_id groups database writes, not multi-request UI actions.';
comment on column public.card_change_journal.request_claims is
  'Selected role/sub transport claims only; no request headers, raw JWT or IP capture. Journal does not verify a person: service-role requests and direct SQL can assert these values. Separate full business row images may themselves contain confidential URLs or arbitrary text.';

create function public.card_change_journal_immutable()
returns trigger language plpgsql set search_path = pg_catalog as $fn$
begin
  raise exception using errcode = '55000', message = 'card_change_journal_immutable';
end;
$fn$;
revoke all on function public.card_change_journal_immutable() from public, anon, authenticated, service_role;
create trigger card_change_journal_immutable_rows
  before update or delete on public.card_change_journal
  for each row execute function public.card_change_journal_immutable();
create trigger card_change_journal_immutable_truncate
  before truncate on public.card_change_journal
  for each statement execute function public.card_change_journal_immutable();

create function public.card_change_journal_capture()
returns trigger language plpgsql security definer
set search_path = pg_catalog set timezone = 'UTC' as $fn$
declare
  v_before jsonb;
  v_after jsonb;
  v_before_key jsonb;
  v_after_key jsonb;
  v_client_column text;
  v_key_column text;
  v_schema jsonb;
  v_changed text[];
  v_claims jsonb := '{}'::jsonb;
  v_selected_claims jsonb;
begin
  if tg_table_schema <> 'public' or tg_table_name not in ('calendar_posts',
    'sample_reviews','batches','deliverables','production_comments','workload_plan')
    or tg_op not in ('INSERT','UPDATE','DELETE') then
    raise exception 'card_history_owner_invalid';
  end if;
  if tg_op <> 'INSERT' then v_before := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_after := to_jsonb(new); end if;
  v_client_column := case when tg_table_name in ('calendar_posts','sample_reviews','workload_plan')
    then 'client' else 'client_slug' end;
  v_key_column := case when tg_table_name = 'workload_plan' then 'issue_id' else 'id' end;
  if v_before is not null then
    v_before_key := jsonb_build_object(v_key_column, v_before -> v_key_column);
    if tg_table_name in ('calendar_posts','sample_reviews') then
      v_before_key := v_before_key || jsonb_build_object('client', v_before -> 'client');
    end if;
  end if;
  if v_after is not null then
    v_after_key := jsonb_build_object(v_key_column, v_after -> v_key_column);
    if tg_table_name in ('calendar_posts','sample_reviews') then
      v_after_key := v_after_key || jsonb_build_object('client', v_after -> 'client');
    end if;
  end if;

  -- Capture all columns, including future business columns, with their actual
  -- SQL type/typmod/nullability. A writer allowlist is not a schema inventory.
  select jsonb_object_agg(a.attname, jsonb_build_object(
    'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
    'identity', a.attidentity, 'generated', a.attgenerated) order by a.attnum)
    into v_schema from pg_attribute a
    where a.attrelid = tg_relid and a.attnum > 0 and not a.attisdropped;
  select coalesce(array_agg(k order by k), array[]::text[]) into v_changed
    from jsonb_object_keys(coalesce(v_before, '{}'::jsonb) || coalesce(v_after, '{}'::jsonb)) k
    where (v_before -> k) is distinct from (v_after -> k);

  -- Malformed optional metadata must not block an otherwise valid card save.
  -- Never equate these claims or persisted author fields with the action actor.
  begin
    v_claims := coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  exception when invalid_text_representation then
    v_claims := '{}'::jsonb;
  end;
  v_selected_claims := jsonb_strip_nulls(jsonb_build_object(
    'role', left(v_claims ->> 'role', 120),
    'sub', left(v_claims ->> 'sub', 240)));

  insert into public.card_change_journal (
    relation_schema, relation_name, operation, entity_key_before, entity_key_after,
    client_before, client_after, row_before, row_after, changed_columns,
    row_schema, row_schema_md5, transaction_id, transaction_started_at,
    statement_started_at, recorded_at, database_name, database_session_user,
    database_role_setting, request_claims
  ) values (
    tg_table_schema, tg_table_name, tg_op, v_before_key, v_after_key,
    v_before ->> v_client_column, v_after ->> v_client_column,
    v_before, v_after, v_changed, v_schema, md5(v_schema::text),
    txid_current(), transaction_timestamp(), statement_timestamp(), clock_timestamp(),
    current_database(), session_user, coalesce(current_setting('role', true), 'none'),
    v_selected_claims
  );
  -- Never catch a journal failure and never consult app.event_written. A failed
  -- history INSERT aborts its business transaction, including semantic events.
  return null;
end;
$fn$;
revoke all on function public.card_change_journal_capture() from public, anon, authenticated, service_role;

do $install$
declare v_table text;
begin
  foreach v_table in array array['calendar_posts','sample_reviews','batches',
    'deliverables','production_comments','workload_plan'] loop
    execute format('create trigger card_change_journal_after after insert or update or delete on public.%I for each row execute function public.card_change_journal_capture()', v_table);
  end loop;
end;
$install$;
commit;
