-- Close the service_role and anon gaps the Linear-exit deploy preflight refuses on.
--
-- WHY THIS EXISTS. The step 19 manual Edge release refused before deploying
-- anything, in its read-only preflight, with
--   CONTRACT_MISMATCH:relation:production_notification_config,
--   routine:production_assignment_epoch(text),
--   routine:production_notification_actor_valid(uuid,text,text),
--   routine:production_notification_client_comment_event_after(),
--   routine:production_notification_comment_intent_after(),
--   routine:production_notification_intent_guard(),
--   routine:production_notification_plain_text(text,integer),
--   routine:production_notification_status_intent_after(),
--   sequence:production_notification_delivery_receipts_id_seq,
--   sequence:production_notification_reconciliations_id_seq
-- Ten keys, and the gate is right on all ten. The 2026-09-06 and 2026-09-09
-- migrations revoke from `public, anon, authenticated` and never from
-- `service_role`, unlike the 2026-09-05 guards, which revoke from
-- `public, anon, authenticated, service_role` and pass. On a hosted project
-- service_role starts with the platform's blanket grants, so "not revoked"
-- means "still held".
--
-- The decision was to tighten the database to the gate rather than loosen the
-- gate, so this migration contains REVOKES ONLY. It creates nothing, alters no
-- definition, grants nothing and touches no object outside those ten keys.
--
-- SAFE BECAUSE NOTHING CALLS THESE AS service_role. Measured across the whole
-- repository: 0 of the seven routines is referenced by any file under
-- supabase/functions/, and 0 invocation-shaped matches exist there. Every
-- caller is either another SECURITY DEFINER routine in the same migrations --
-- which executes as its definer and needs no grant on the invoking role -- or
-- a trigger. A trigger function does not require EXECUTE on the role whose
-- statement fires it, which is why the three *_after() functions and the
-- intent guard keep working after this runs.

begin;

-- 1. The seven private routines. EXECUTE was never revoked from service_role.
revoke execute on function public.production_assignment_epoch(text) from service_role;
revoke execute on function public.production_notification_intent_guard() from service_role;
revoke execute on function public.production_notification_plain_text(text,integer) from service_role;
revoke execute on function public.production_notification_actor_valid(uuid,text,text) from service_role;
revoke execute on function public.production_notification_status_intent_after() from service_role;
revoke execute on function public.production_notification_comment_intent_after() from service_role;
revoke execute on function public.production_notification_client_comment_event_after() from service_role;

-- 2. The config table. service_role keeps select/insert/update/delete, which
--    the 2026-09-09 migration grants deliberately; only the three privileges
--    the contract requires it NOT to hold are removed.
revoke truncate, references, trigger on table public.production_notification_config from service_role;

-- 3. The two sequences. service_role keeps usage and select, which the
--    2026-09-09 migration grants deliberately. UPDATE was never revoked from
--    it, and anon was never revoked at all -- the 2026-09-09 table revoke
--    covers tables only, never sequences.
revoke update on sequence public.production_notification_delivery_receipts_id_seq,
                           public.production_notification_reconciliations_id_seq from service_role;
revoke usage, select, update on sequence public.production_notification_delivery_receipts_id_seq,
                                         public.production_notification_reconciliations_id_seq from anon;

commit;
