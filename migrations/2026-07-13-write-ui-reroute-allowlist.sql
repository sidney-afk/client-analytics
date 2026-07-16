-- D-32 / F02 / F23: stage browser write reroutes per client.
-- Additive and idempotent: an operator-managed value is never overwritten.
-- The canonical TEST client is the only enrolled slug at install time, so the
-- #813 browser deploy is dark for every real client.

insert into public.syncview_runtime_flags (key, value, updated_by)
values (
  'write_ui_reroute_clients',
  '{"clients":["sidneylaruel"]}'::jsonb,
  'write-ui-fix-pack-migration'
)
on conflict (key) do nothing;
