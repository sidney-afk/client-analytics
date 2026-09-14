-- Draft/unapplied. Native intake receipt retention: DELETE and TRUNCATE.
--
-- Apply AFTER the composed native-intake artifact (scripts/native-intake-named-append-compose.js),
-- which creates the receipt guard this completes. PURELY ADDITIVE ON PURPOSE: it
-- adds its own triggers rather than replacing that guard's body, so the composed
-- artifact's published digest and its execution evidence both stay valid, and the
-- guard body has exactly one copy in the tree.
--
-- WHY. public.production_intake_epoch_read resolves a REPLAYED intake's lane from
-- the receipt itself (2026-09-05-native-only-intake.sql:62-70): a marked receipt
-- pins the accepted native epoch, an unmarked one pins the old provider lane. The
-- receipt guard installed there covers INSERT and UPDATE only, so a service-role
-- cleanup of terminal mirror_outbox rows -- or a TRUNCATE -- removes the pin. The
-- next replay of that request finds no receipt and falls through to whatever
-- public.production_native_intake_epochs() says at that moment, silently
-- re-resolving an already accepted round onto the other lane. Losing the row is
-- not the harm; re-deciding the lane is. The native assignment and label lanes
-- already refuse exactly this (2026-09-06-native-existing-assignment.sql:85-132,
-- 2026-09-06-native-label-writes.sql:109-119), and docs/independence/LINEAR_EXIT_BRIEF_B.md
-- already tells an operator these receipts cannot be deleted. This makes that true.
--
-- MARKER-SCOPED, like those two: an unmarked provider receipt is ordinary outbox
-- work and stays deletable, so routine maintenance is untouched. The residual it
-- does NOT cover: deleting an unmarked PROVIDER receipt also drops a pin, because
-- epoch_read reads absence as "no history". Refusing every outbox delete forever
-- is a much larger constraint than this lane should impose, so that case stays
-- with the operator, not the trigger.
begin;

create function public.production_native_intake_delete_guard() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if coalesce(old.payload->>'_native_intake_epoch','')<>'' then
    raise exception 'native_intake_receipt_retained'; end if;
  return old;
end; $$;
create trigger zz_native_intake_delete_guard before delete on public.mirror_outbox
for each row execute function public.production_native_intake_delete_guard();

create function public.production_native_intake_truncate_guard() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.mirror_outbox
    where coalesce(payload->>'_native_intake_epoch','')<>'') then
    raise exception 'native_intake_receipt_retained'; end if;
  return null;
end; $$;
create trigger zz_native_intake_truncate_guard before truncate on public.mirror_outbox
for each statement execute function public.production_native_intake_truncate_guard();

revoke all on function public.production_native_intake_delete_guard() from public,anon,authenticated,service_role;
revoke all on function public.production_native_intake_truncate_guard() from public,anon,authenticated,service_role;
-- Rollback, structural only and only once nothing native remains admitted:
--   drop trigger zz_native_intake_delete_guard on public.mirror_outbox;
--   drop trigger zz_native_intake_truncate_guard on public.mirror_outbox;
--   drop function public.production_native_intake_delete_guard();
--   drop function public.production_native_intake_truncate_guard();
commit;
