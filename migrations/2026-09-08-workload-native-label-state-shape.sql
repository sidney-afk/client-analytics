-- Corrective, additive. Replaces one function body; no data is touched, no
-- flags change, no provider calls. Applies on top of
-- 2026-09-05-workload-native-membership.sql, which is ALREADY APPLIED live --
-- which is why this is a new file rather than an edit to that one.
--
-- Codex P2 on PR #1344. `workload_native_label_state_absent` answers "no
-- provider label state was ever stamped", and the caller treats true as
-- "complete, with no labels" -- i.e. the row weighs 1x and skips
-- `production_workload_label_projection` entirely. The original body was
--
--   jsonb_typeof(p_raw) is distinct from 'object'
--   or jsonb_typeof(p_raw->'issue') is distinct from 'object'
--   or (p_raw->'issue')->'labels' is null
--
-- and `is distinct from 'object'` is true for a JSON array, string, number or
-- boolean as well as for absence. So a `linear_raw` of the wrong SHAPE was
-- certified as provably-unlabelled rather than refused, and any weight it might
-- have carried was silently counted as 1x. That inverts the rule the migration
-- states for itself: "a label relation exists but is malformed ... is genuinely
-- unprovable, and still refused".
--
-- The distinction it needs is absence versus wrong-type:
--   * SQL NULL, or JSON null                       -> absent, provable, 1x.
--   * an object with no `issue`                    -> absent, provable, 1x.
--     (this is the permanent post-cutoff shape: production-write stamps
--      `{"attribution": ...}` and nothing adds `issue` once outbound is off)
--   * an object whose `issue` has no `labels`      -> absent, provable, 1x.
--   * anything else -- a scalar, an array, an `issue` that is not an object,
--     or a present `labels` relation                -> NOT absent, so the
--     projection decides, and a malformed relation stays unprovable.
create or replace function public.workload_native_label_state_absent(p_raw jsonb)
returns boolean language sql immutable
set search_path = pg_catalog, public as $fn$
  select case
    when p_raw is null or jsonb_typeof(p_raw) = 'null' then true
    when jsonb_typeof(p_raw) <> 'object' then false
    when p_raw->'issue' is null or jsonb_typeof(p_raw->'issue') = 'null' then true
    when jsonb_typeof(p_raw->'issue') <> 'object' then false
    else (p_raw->'issue')->'labels' is null
  end;
$fn$;
revoke all on function public.workload_native_label_state_absent(jsonb) from public,anon,authenticated;
grant execute on function public.workload_native_label_state_absent(jsonb) to service_role;
