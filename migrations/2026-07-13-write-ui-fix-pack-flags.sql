-- #813 fix-pack runtime controls. Additive seeds only: existing values win.
-- Applying this migration does not change authority or outbound mode.

begin;

insert into public.syncview_runtime_flags (key, value, updated_by)
values
  (
    'write_ui_overdue_due_bump',
    '{"enabled":true}'::jsonb,
    'write-ui-fix-pack-migration'
  ),
  (
    'linear_outbound_pending_age_alert',
    '{"minutes":30}'::jsonb,
    'write-ui-fix-pack-migration'
  )
on conflict (key) do nothing;

commit;
