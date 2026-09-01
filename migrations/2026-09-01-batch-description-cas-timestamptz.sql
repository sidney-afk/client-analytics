-- A post description could not be saved by ANYONE, on ANY post, since the hour
-- the feature merged. Second report from the same person, 2026-09-01.
--
-- Supersedes the function body installed by
-- migrations/2026-09-01-batch-description-write.sql. That file stays for
-- provenance -- its whitelist, its lock ordering, its team derivation and its
-- grants were all correct and are restated verbatim below. Two lines were not.
--
-- WHAT THE SMM SAW. First report: "the new description he's trying to make
-- isn't saving". That was the browser gate, refusing `batch_description` at the
-- door because the gates compared against a different spelling than the save
-- sent; fixed and deployed (production-write v65). Second report, after that
-- deploy, and it is a DIFFERENT failure that the first one had been hiding:
--
--   "A service the write depends on did not answer, and nothing was committed.
--    Try again in a moment; if it keeps failing, send this code to the owner."
--
-- The write now reaches the database. The database refuses it, every time, and
-- the sentence tells him to retry something that can never succeed.
--
-- ---------------------------------------------------------------------------
-- BUG 1: THE COMPARE-AND-SWAP IS UNSATISFIABLE. It compares two renderings of
-- the same instant as TEXT, and they are not the same text.
--
-- Measured against the live row behind the report and a local PostgreSQL 16
-- (Sebastian's post, batches.updated_at, 2026-09-01):
--
--   what PostgREST hands the browser   2026-08-31T20:18:54.574498+00:00
--   what the browser sends back        2026-08-31T20:18:54.574498+00:00
--   what `updated_at::text` renders    2026-08-31 20:18:54.574498+00
--
-- ISO 8601 `T` against a space, `+00:00` against `+00`. `is distinct from` is
-- therefore TRUE for a row nobody else has touched, on every save, for every
-- user, forever. The gateway's own pre-check passes because it compares the
-- PostgREST rendering against itself -- which is why nothing upstream caught
-- this and why the refusal only ever appears at the very last step.
--
-- The fix is to stop comparing strings. Both sides become `timestamptz` and the
-- comparison happens in the type the column actually has, so any rendering of
-- the same instant matches and no rendering of a different one does. This is
-- what every other writer in the estate already does -- p_expected_updated_at
-- is declared `timestamptz` in 2026-08-26-production-intake-append-v7.sql:161,
-- 2026-08-31-production-component-fill.sql:89 and
-- 2026-07-23-f34-f53-production-attachments.sql:772. This function was the sole
-- `text` outlier, and the outlier is the one that broke.
--
-- THE PARAMETER TYPE DOES NOT CHANGE, deliberately, and that is the whole
-- reason this is a SQL-only repair. Changing `p_expected_updated_at text` to
-- `timestamptz` changes the function's identity: `create or replace` would
-- install a SECOND overload beside the broken one rather than replacing it, and
-- PostgREST -- which resolves an RPC by the argument names in the JSON body,
-- not by type -- would then have two candidates for the same call and answer
-- PGRST203 ambiguous. The cast moves INSIDE the body instead. Signature
-- identical, no overload, no redeploy of the edge function: paste this in the
-- SQL editor and the next save works.
--
-- A MALFORMED expectation is refused as a conflict rather than allowed to raise
-- 22007 into the generic 500 handler. An expectation that is not a timestamp
-- cannot match the row's clock, so a conflict is what it factually is -- and it
-- reloads the winning text for the user instead of telling them to wait.
--
-- The EMPTY STRING means "no expectation", matching the null arm one line
-- above. The browser sends `''` when it could not resolve the batch row it is
-- editing (`String(batch.updated_at || '')`), and the gateway forwards it
-- verbatim. Treating that as a real expectation would compare the row's clock
-- against nothing and refuse a first-ever save on a batch whose `updated_at` is
-- unreadable. `btrim` is safe HERE and only here: this is a machine-generated
-- timestamp, not the description -- p_description is still `nullif(x, '')` with
-- no trim, because trimming validated Markdown destroys a fenced code block's
-- indentation and the trailing spaces that are a hard line break.
--
-- ---------------------------------------------------------------------------
-- BUG 2: THE REFUSALS ARE UNREADABLE TO THE GATEWAY, so even a CORRECT refusal
-- arrived as the wrong thing. All three `raise exception` messages were written
-- as English with spaces:
--
--   'production batch description write conflict'
--   'production batch description target missing'
--   'production batch description scope required'
--
-- The gateway's RPC error mapper matches UNDERSCORE tokens -- `/write_conflict/i`,
-- `/batch_not_found/i` (production-write/index.ts, the `rpc()` helper). None of
-- the three matched anything, so every one of them fell all the way through to
-- the final `throw new GatewayError(500, "native_write_failed")`, and
-- `native_write_failed` is in the browser's `wait` class. That is the exact
-- sentence in the screenshot. A conflict -- a real, correct, expected outcome
-- -- was reported as a dependency outage.
--
-- Renamed to tokens the ALREADY-DEPLOYED gateway maps, so no function deploy is
-- needed to make the mapping take effect:
--
--   ..._write_conflict   -> matches /write_conflict/i   -> 409 write_conflict
--                           browser: "That batch changed while this window was
--                           open" and it adopts the winning row and clock
--   ..._batch_not_found  -> matches /batch_not_found/i  -> 409 batch_not_found
--   ..._scope_required   -> unmapped by design; unreachable from the gateway,
--                           which refuses a blank id or slug before the call.
--                           Named in the same shape so the next reader does not
--                           have to wonder whether it was missed.
--
-- test/batch-description-cas-timestamptz.js executes the deployed mapper's own
-- regexes against these three strings, and against the three they replace, so
-- the pairing cannot rot silently.
--
-- ---------------------------------------------------------------------------
-- NOTHING ELSE MOVES. The whitelisted three-key row, the scope-then-lock
-- ordering, the union-of-teams authority assertion that fails closed, the
-- `nullif(p_description, '')` erase, the revoke/grant -- all restated
-- unchanged, so test/batch-description-write.js keeps proving them here.
--
-- Additive: no table, column, index, trigger, policy, grant on another object,
-- runtime flag or authority value is touched, and no row is written at install
-- time.
--
-- ROLLBACK. Re-apply the function body from
-- migrations/2026-09-01-batch-description-write.sql, which restores the two
-- bugs above and makes every post description unsaveable again -- so the only
-- reason to do it is if this replacement is itself wrong. There is no browser
-- or gateway half to revert with it: this file changes neither. See ROLLBACK.md.

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
  v_expected timestamptz;
  /* ONLY the exact empty string becomes NULL. NOT btrim.
     The gateway validates with canonicalDescription, which preserves every code
     unit on purpose, so trimming here would silently rewrite validated Markdown
     after the fact -- destroying the leading indentation of a fenced code block
     and the trailing spaces that are a hard line break in Markdown. NULL and ''
     both mean "this post has no description", and batch_write's insert arm
     already collapses '' the same way. The erase is deliberate: a wrong
     description was unfixable from every seat in the product. */
  v_description text := nullif(p_description, '');
begin
  if nullif(btrim(coalesce(p_batch_id, '')), '') is null
     or nullif(btrim(coalesce(p_client_slug, '')), '') is null then
    raise exception 'production_batch_description_scope_required';
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
    raise exception 'production_batch_description_batch_not_found';
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
     unlocked, both see the same value, and both pass a check made before either
     transaction exists -- so the second silently overwrote the first.
     Re-checking after `for update` is the only place the comparison is
     serialised against a concurrent writer. Raised by review on #1203.

     COMPARED AS timestamptz, NOT AS TEXT, which is the whole repair. The
     browser round-trips PostgREST's ISO rendering
     (2026-08-31T20:18:54.574498+00:00) while `updated_at::text` renders
     2026-08-31 20:18:54.574498+00 -- the same instant, different strings, so
     the text comparison was TRUE for an untouched row and refused every save
     the product has ever attempted. In the column's own type there is one
     answer and it is the right one.

     A null OR EMPTY expectation means the caller did not ask for optimistic
     concurrency, which is how every non-UI caller (a repair, a backfill) has
     always been able to write without inventing a clock, and how the browser
     behaves when it could not resolve the row's clock at all. A MALFORMED one
     is a conflict: it cannot match, and a conflict reloads the winning text
     instead of telling the user to wait for a service that is not down. */
  if p_expected_updated_at is not null then
    begin
      v_expected := nullif(btrim(p_expected_updated_at), '')::timestamptz;
    /* NARROW, not `when others`. The block wraps a single cast, and the only
       errors a text->timestamptz cast raises are these two. `when others` would
       also swallow a statement timeout or a query cancellation and report it as
       a conflict, which is the same class of lie this file exists to remove. */
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'production_batch_description_write_conflict';
    end;
    if v_expected is not null and v_current.updated_at is distinct from v_expected then
      raise exception 'production_batch_description_write_conflict';
    end if;
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
