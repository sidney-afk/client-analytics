-- Preparation only. Observed default privileges grant service EXECUTE on new functions.
-- These two helpers are private dependencies, never service entry points.
begin;
revoke execute on function public.production_provider_terminal_clean_v1(text), public.production_provider_legacy_written_shape_v1(public.mirror_outbox) from service_role;
commit;
