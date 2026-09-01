-- 2026-09-01 — A post's own description becomes editable.
--
-- OWNER REQUEST, 2026-08-31, opening a batch parent from a shared card link:
-- "I need to be able to edit the description and it says that the post batch
-- parent cannot ... any parent issue should be able to ... the description
-- should be editable". Asked what shape he wanted: "I want it like linear, so
-- there's a description for the parent issue, and then there is the description
-- for all of the sub-issues."
--
-- That shape ALREADY EXISTS in the data. A sub-issue carries its own
-- `deliverables.brief`; the batch parent shows `batches.description`, which is
-- the post's own text and is not shared into any child. Nothing about the model
-- needed to change. The only thing missing was a way to write the parent half:
-- the gateway refuses every batch-entity mutation except `comment`
-- (unsupported_batch_operation), so a post description was set once at intake
-- and was permanent from every seat in the product -- exactly the shape the
-- folder links were in before 2026-08-31-batch-asset-write.sql.
--
-- 1,186 batch parents carry a description today.
--
-- WHY A FUNCTION AND NOT A DIRECT UPDATE, and it is the same answer the asset
-- writer gives: the interesting half is what must NOT move. `public.batch_write`
-- updates any key it is handed, so the whitelist lives HERE, in the database,
-- rather than only in the gateway that happens to call it today. This function
-- can reach `description` and nothing else -- not the name, not a folder link,
-- not the purpose, not the client. A future caller cannot widen that by asking.
--
-- Deliberately thin, and deliberately a near-copy of
-- production_batch_asset_write: same scope-then-lock ordering, same per-team
-- authority assertion, same batch_write call, same audit shape. Two functions
-- that behave identically are easier to keep honest than one function with a
-- mode flag, and the asset one has already been corrected twice (team fallback,
-- client_slug insert arm) -- both corrections are folded in here from the start
-- rather than waiting to be rediscovered.
--
-- NOT public.production_batch_write. That path requires an outbox dedup key AND
-- an intent fingerprint and RAISES without them (production_outbox_replay,
-- 2026-07-12-write-ui-outbox-parity.sql:146). That contract exists for writes
-- with a Linear mirror leg. A post description has none -- Linear never held it
-- -- so there is nothing to dedup against.
--
-- THE client_slug KEY IS LOAD-BEARING, and its absence is a fixed bug, not a
-- style choice. batch_write is an INSERT ... ON CONFLICT (id) DO UPDATE, and
-- PostgreSQL evaluates NOT NULL on the PROPOSED INSERT TUPLE before it resolves
-- the conflict -- so a partial row without client_slug raises 23502 on a row
-- that already exists and is only being updated. That is precisely what made
-- every batch folder link unsaveable for the whole estate until
-- 2026-08-31-batch-asset-client-slug-insert-arm.sql. `test/batch-asset-write-insert-arm.js`
-- pins the general rule; this function is written to satisfy it on day one.
--
-- LOCKING. Takes a row lock on public.batches and nothing else -- the same
-- single-table lock production_batch_asset_write takes, so the two cannot form
-- a cycle no matter how they interleave, and neither can cycle with
-- production_artifact_write (deliverables + calendar_posts, never batches).
--
-- Additive: no table, column, index, trigger, policy, grant on another object,
-- runtime flag or authority value is touched, and no row is written at install
-- time.
--
-- ROLLBACK, TOP-DOWN, for the same reason the asset writer documents. Revert
-- the browser half first (the Edit control disappears from the batch parent's
-- description), then redeploy the prior production-write closure through
-- .github/workflows/deploy-f27-section4-closures.yml, and only then, if you
-- want it gone entirely: `drop function if exists
-- public.production_batch_description_write(text, text, text, text, jsonb);`.
-- Dropping it FIRST leaves a live Edit control whose save reaches a missing
-- function and returns 500 write_failed with no explanation. Leaving the
-- function installed under a reverted gateway costs nothing: nothing else
-- calls it. See ROLLBACK.md.

begin;

create or replace function public.production_batch_description_write(
  p_batch_id text,
  p_client_slug text,
  p_description text,
  p_expected_updated_at text default null,
  p_event jsonb default '{}'::jsonb
) returns public.batches
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_current public.batches%rowtype;
  v_teams text[];
  v_team text;
  v_row jsonb;
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  /* ONLY the exact empty string becomes NULL. NOT btrim.
     The first version trimmed, and review was right to refuse it: the gateway
     validates with canonicalDescription, which preserves every code unit on
     purpose, so trimming here would silently rewrite validated Markdown after
     the fact -- destroying the leading indentation of a fenced code block and
     the trailing spaces that are a hard line break in Markdown. `nullif` alone
     is the whole intent: NULL and '' both mean "this post has no description",
     and batch_write's insert arm already collapses '' the same way.
     The erase is deliberate: a wrong description was unfixable from every seat
     in the product, and refusing to clear it would leave half of that in
     place. */
  v_description text := nullif(p_description, '');
begin
  if nullif(btrim(coalesce(p_batch_id, '')), '') is null
     or nullif(btrim(coalesce(p_client_slug, '')), '') is null then
    raise exception 'production batch description scope required';
  end if;

  -- Scope and existence resolve together, so a caller cannot use a mismatched
  -- client slug to discover which batch ids exist. Same anti-enumeration
  -- ordering the protected asset reader and the asset writer both use.
  select b.* into v_current
  from public.batches b
  where b.id = p_batch_id
    and b.client_slug = p_client_slug
  for update;
  if not found then
    raise exception 'production batch description target missing';
  end if;

  /* The batch's own team AND every team its deliverables belong to.
     `batches.team` is not reliably populated -- measured 2026-08-31, 303 of
     1,644 batches carry a null team -- and authorizing on that column alone is
     what made both editable asset slots unwritable by everyone until
     2026-08-31-batch-asset-team-fallback.sql. A description is a post-level
     field read by every sibling on every team, so it authorizes exactly the
     same way. */
  select coalesce(array_agg(distinct t), '{}'::text[])
    into v_teams
  from (
    select lower(btrim(coalesce(v_current.team, ''))) as t
    union all
    select lower(btrim(coalesce(d.team, '')))
    from public.deliverables d
    where d.batch_id = v_current.id
      and d.client_slug = v_current.client_slug
  ) s
  where t in ('video', 'graphics');

  if array_length(v_teams, 1) is null then
    -- No resolvable scope anywhere. Refused through the same assertion so the
    -- error vocabulary a caller sees does not change with the cause.
    perform public.production_assert_authority(
      v_current.client_slug, null, false, false
    );
  end if;

  -- Fails closed on the FIRST team that is not writable, so a mixed batch
  -- cannot be edited while half of it is Linear-authoritative.
  foreach v_team in array v_teams loop
    perform public.production_assert_authority(
      v_current.client_slug, v_team, false, false
    );
  end loop;

  /* THE CAS BELONGS HERE, UNDER THE LOCK, and the gateway's pre-check is only
     a fast refusal. Two saves that start together both read `updated_at`
     unlocked, both see the same value, and both pass a check made before
     either transaction exists -- so the second silently overwrote the first.
     Re-checking after `for update` is the only place the comparison is
     serialised against a concurrent writer. Raised by review on #1203.
     A null expectation means the caller did not ask for optimistic
     concurrency, which is how every non-UI caller (a repair, a backfill) has
     always been able to write without inventing a clock. */
  if p_expected_updated_at is not null
     and coalesce(v_current.updated_at::text, '') is distinct from p_expected_updated_at then
    raise exception 'production batch description write conflict';
  end if;

  -- Exactly three keys reach batch_write: the id it matches on, the client_slug
  -- its NOT NULL insert arm demands, and the one column being written. Every
  -- other column is left alone by the per-key `case when v_row ? '<col>'` arms
  -- of the ON CONFLICT clause, so this cannot clobber a name, a folder link or
  -- a purpose by omission.
  v_row := jsonb_build_object(
    'id', v_current.id,
    'client_slug', v_current.client_slug,
    'description', v_description
  );

  return public.batch_write(
    v_row,
    v_event || jsonb_build_object('action', 'batch_description_change')
  );
end;
$fn$;

revoke all on function public.production_batch_description_write(text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_batch_description_write(text, text, text, text, jsonb)
  to service_role;

commit;
