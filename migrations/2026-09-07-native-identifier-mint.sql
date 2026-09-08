-- Native naming mint (folded-in lane G, work item G1; OPEN_REPAIRS 162 and its
-- correction, 163, 170).
--
-- WHAT BREAKS WITHOUT THIS
-- `deliverables.linear_identifier` is the human-readable name on a card
-- (`VID-13553`, `GRA-7197`). It has three writers and all three are Linear:
-- `supabase/functions/linear-inbound/index.ts:810` refreshes it, and
-- `supabase/functions/linear-outbound/index.ts:852` and `:868` MINT it for
-- SyncView-native cards — production-write writes `identifier: null`, the row
-- goes to `mirror_outbox`, the outbound worker creates the Linear issue and
-- writes the minted name straight back.
--
-- `index.html`, in `_prodAdapter()`, resolves
-- `displayId: linear_identifier || identifier || id`,
-- so a card created with no mint displays as its raw row id (`b1_d_188ba4ad…`)
-- in the Production list, the command palette, the Workload loose-strip header
-- and every deep link. Nothing errors. The estate simply stops producing names.
--
-- The deadline is NOT 2026-09-15. It is the moment `linear_outbound_enabled` is
-- set to `{"mode":"off"}`, which is earlier and under our own hand. Lane F's
-- outbound-off step is gated on this landing.
--
-- (The `index.html` reference is by SYMBOL and the two Edge Function references
-- are by LINE, on purpose. `index.html` is 65,000 lines and every browser PR
-- moves it; this citation drifted three times in one day, twice inside the PR
-- that corrected it. The Edge Functions are ~1,500 lines and change rarely, so
-- there the precision is worth the upkeep. `test/mint-migration-line-citations.js`
-- holds both against the source by content.)
--
-- ADDITIVE ONLY. Two new tables, four new functions, one new trigger, one new
-- runtime flag row. No DROP, no RENAME, no type change, no change to any
-- existing function. Installing this changes NOTHING until a team is seeded and
-- its flag flipped: the flag seeds as `provider` for both teams and allocation
-- is refused without a seed row.
--
-- The client lifecycle is untouched. Anonymous tokenless approval links read
-- and write `calendar_posts` / `sample_reviews`; nothing here is on that path.

begin;

-- One row per team, seeded once, holding the allocation cursor.
--
-- WHY THE ORDINALS START HIGH. Native names keep the provider's shape so a
-- human reads them the same way, which means they share a namespace with every
-- name Linear already minted. Seeding at `observed provider max + gap` puts
-- native allocations in a band the provider cannot reach before the cutoff, so
-- a native name can never collide with a provider one — and the band is
-- self-documenting to anyone who knows the estate's real ordinals.
create table if not exists public.production_native_identifier_mint (
  team text primary key check (team in ('video', 'graphics')),
  prefix text not null check (prefix ~ '^[A-Z][A-Z0-9]{1,9}$'),
  next_ordinal bigint not null check (next_ordinal > 0),
  observed_provider_max bigint not null default 0 check (observed_provider_max >= 0),
  seed_gap bigint not null check (seed_gap >= 0),
  seeded_at timestamptz not null default clock_timestamp(),
  seeded_by text not null default session_user
);
alter table public.production_native_identifier_mint enable row level security;
revoke all on public.production_native_identifier_mint from public, anon, authenticated, service_role;

-- Every name this estate minted itself, and every provider name that was
-- refused because the row already carried one. This is what makes a native
-- name identifiable after the fact; without it "is that ours?" is unanswerable.
create table if not exists public.production_native_identifier_grants (
  identifier text primary key,
  deliverable_id text not null,
  team text not null check (team in ('video', 'graphics')),
  minted_at timestamptz not null default clock_timestamp(),
  provider_identifier_refused text
);
create index if not exists production_native_identifier_grants_deliverable_idx
  on public.production_native_identifier_grants (deliverable_id);
alter table public.production_native_identifier_grants enable row level security;
revoke all on public.production_native_identifier_grants from public, anon, authenticated, service_role;

insert into public.syncview_runtime_flags (key, value, updated_by)
values ('production_native_identifier_mint',
        '{"schema_version":1,"video":{"mode":"provider"},"graphics":{"mode":"provider"}}',
        'native-identifier-mint')
on conflict (key) do nothing;

-- THIS CAPABILITY SELF-GUARDS, DELIBERATELY.
--
-- `production_label_catalog_capability()` (2026-09-06-native-label-writes.sql:57-72)
-- reads only its runtime flag and never checks that the version it names
-- exists, so flipping that flag to native with nothing staged reports "native"
-- and then 503s one call later. That trap is recorded in OPEN_REPAIRS 165.6 and
-- it is not repeated here: this function returns native only when the flag says
-- native AND a seed row for the team actually exists. A premature flip is
-- therefore inert rather than half-armed.
create or replace function public.production_native_identifier_capability(p_team text)
-- NOT `stable`: the `for share` below pins the flag row for the calling
-- transaction, so a concurrent flip cannot switch modes between this check and
-- the allocation it authorises — and PostgreSQL refuses row locks inside a
-- non-volatile function. `production_label_catalog_capability` takes the same
-- lock for the same reason.
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare v_value jsonb; v_team jsonb; v_seed public.production_native_identifier_mint;
begin
  if p_team is null or p_team not in ('video', 'graphics') then
    raise exception using errcode = '22023', message = 'native_identifier_team_invalid';
  end if;
  select value into v_value from public.syncview_runtime_flags
    where key = 'production_native_identifier_mint' for share;
  if jsonb_typeof(v_value) is distinct from 'object'
     or v_value->'schema_version' is distinct from '1'::jsonb then
    raise exception using errcode = '22023', message = 'native_identifier_config_invalid';
  end if;
  v_team := v_value->p_team;
  if jsonb_typeof(v_team) is distinct from 'object'
     or coalesce(v_team->>'mode', '') not in ('provider', 'native') then
    raise exception using errcode = '22023', message = 'native_identifier_config_invalid';
  end if;
  select * into v_seed from public.production_native_identifier_mint where team = p_team;
  if v_team->>'mode' <> 'native' or not found then
    return jsonb_build_object('schema_version', 1, 'team', p_team, 'mode', 'provider',
      'seeded', found, 'flag_mode', v_team->>'mode');
  end if;
  return jsonb_build_object('schema_version', 1, 'team', p_team, 'mode', 'native',
    'seeded', true, 'flag_mode', 'native', 'prefix', v_seed.prefix, 'next_ordinal', v_seed.next_ordinal);
end;
$fn$;

-- Seed one team from what the provider actually minted. Idempotent by refusal:
-- a second seed for the same team raises rather than moving the cursor, because
-- moving it after names have been handed out re-issues them.
create or replace function public.production_native_identifier_seed(p_team text, p_gap bigint default 100000)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare v_prefix text; v_max bigint; v_prefixes integer;
begin
  if p_team is null or p_team not in ('video', 'graphics') then
    raise exception using errcode = '22023', message = 'native_identifier_team_invalid';
  end if;
  if p_gap is null or p_gap < 0 or p_gap > 1000000000 then
    raise exception using errcode = '22023', message = 'native_identifier_gap_invalid';
  end if;
  if exists (select 1 from public.production_native_identifier_mint where team = p_team) then
    raise exception using errcode = '55000', message = 'native_identifier_already_seeded';
  end if;

  -- The prefix is DERIVED, never configured: whatever the provider has been
  -- using for this team is what a human already reads. Two different prefixes
  -- on one team means the team was moved or merged, and guessing which one wins
  -- is exactly the kind of silent choice item 161 was about — so refuse.
  select count(distinct substring(d.linear_identifier from '^([A-Z][A-Z0-9]{1,9})-[0-9]{1,9}$')),
         max(nullif(substring(d.linear_identifier from '^[A-Z][A-Z0-9]{1,9}-([0-9]{1,9})$'), '')::bigint),
         min(substring(d.linear_identifier from '^([A-Z][A-Z0-9]{1,9})-[0-9]{1,9}$'))
    into v_prefixes, v_max, v_prefix
    from public.deliverables d
   where d.team = p_team
     and d.linear_identifier ~ '^[A-Z][A-Z0-9]{1,9}-[0-9]{1,9}$';

  if coalesce(v_prefixes, 0) = 0 then
    raise exception using errcode = '22023', message = 'native_identifier_no_provider_names';
  end if;
  if v_prefixes > 1 then
    raise exception using errcode = '22023', message = 'native_identifier_prefix_ambiguous';
  end if;

  insert into public.production_native_identifier_mint
    (team, prefix, next_ordinal, observed_provider_max, seed_gap)
  values (p_team, v_prefix, coalesce(v_max, 0) + p_gap + 1, coalesce(v_max, 0), p_gap);

  return jsonb_build_object('ok', true, 'team', p_team, 'prefix', v_prefix,
    'observed_provider_max', coalesce(v_max, 0), 'seed_gap', p_gap,
    'next_ordinal', coalesce(v_max, 0) + p_gap + 1);
end;
$fn$;

-- Allocate one name. The row lock on the cursor is what serialises concurrent
-- creates; two sessions cannot leave with the same ordinal.
create or replace function public.production_native_identifier_allocate(p_team text, p_deliverable_id text)
returns text language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare v_prefix text; v_ordinal bigint; v_identifier text;
begin
  if coalesce(btrim(p_deliverable_id), '') = '' then
    raise exception using errcode = '22023', message = 'native_identifier_deliverable_required';
  end if;
  for i in 1..64 loop
    update public.production_native_identifier_mint
       set next_ordinal = next_ordinal + 1
     where team = p_team
    returning prefix, next_ordinal - 1 into v_prefix, v_ordinal;
    if not found then
      raise exception using errcode = '55000', message = 'native_identifier_not_seeded';
    end if;
    v_identifier := v_prefix || '-' || v_ordinal::text;
    -- The seed gap should make this impossible. Stepping over a collision
    -- rather than trusting the gap costs one statement and removes the only
    -- way this can hand two cards the same name.
    if not exists (select 1 from public.deliverables where linear_identifier = v_identifier)
       and not exists (select 1 from public.production_native_identifier_grants where identifier = v_identifier) then
      insert into public.production_native_identifier_grants (identifier, deliverable_id, team)
        values (v_identifier, p_deliverable_id, p_team);
      return v_identifier;
    end if;
  end loop;
  raise exception using errcode = '55000', message = 'native_identifier_exhausted';
end;
$fn$;

-- The mint itself.
--
-- INSERT: a row created with no provider name gets a native one, but only when
-- the team's capability is native. With the flag at its seeded `provider` this
-- branch does nothing at all, which is why installing this migration is a no-op.
--
-- UPDATE: a name that has been handed out MUST NOT CHANGE UNDER A READER. Once
-- a row carries a name from `production_native_identifier_grants`, a later
-- write that would replace it — `linear-outbound:852/868` minting, or
-- `linear-inbound:810` refreshing — keeps the native name and records the
-- provider one it refused. Note this branch is NOT flag-gated: allocation is a
-- policy choice, but stability of an already-published name is not, so flipping
-- the flag back to provider cannot retroactively rename existing cards.
create or replace function public.production_native_identifier_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare v_capability jsonb; v_grant public.production_native_identifier_grants;
begin
  if tg_op = 'INSERT' then
    if coalesce(btrim(new.linear_identifier), '') <> '' then return new; end if;
    if new.team is null or new.team not in ('video', 'graphics') then return new; end if;
    v_capability := public.production_native_identifier_capability(new.team);
    if v_capability->>'mode' <> 'native' then return new; end if;
    new.linear_identifier := public.production_native_identifier_allocate(new.team, new.id);
    return new;
  end if;

  if coalesce(btrim(old.linear_identifier), '') = ''
     or new.linear_identifier is not distinct from old.linear_identifier then
    return new;
  end if;
  select * into v_grant from public.production_native_identifier_grants
    where identifier = old.linear_identifier and deliverable_id = old.id;
  if not found then return new; end if;
  if coalesce(btrim(new.linear_identifier), '') <> '' then
    update public.production_native_identifier_grants
       set provider_identifier_refused = new.linear_identifier
     where identifier = old.linear_identifier;
  end if;
  new.linear_identifier := old.linear_identifier;
  return new;
end;
$fn$;

drop trigger if exists zzz_production_native_identifier_mint on public.deliverables;
create trigger zzz_production_native_identifier_mint
  before insert or update on public.deliverables
  for each row execute function public.production_native_identifier_guard();

revoke all on function public.production_native_identifier_capability(text),
  public.production_native_identifier_seed(text, bigint),
  public.production_native_identifier_allocate(text, text),
  public.production_native_identifier_guard()
  from public, anon, authenticated, service_role;
grant execute on function public.production_native_identifier_capability(text),
  public.production_native_identifier_seed(text, bigint) to service_role;

commit;
