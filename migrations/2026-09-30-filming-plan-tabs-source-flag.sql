-- ============================================================
-- NOT APPLIED. Written 2026-09-30 by Forge for PR 1b of
-- docs/plans/2026-09-28-n8n-exit.md (Kasper > Filming reads its Doc tabs from
-- the filming-plan-tabs Edge Function instead of the n8n webhook).
--
-- Seeds ONE runtime flag row, `filming_plan_tabs_source`, at {"mode":"n8n"}, the
-- value the page already behaves as when the row is missing, unreadable or
-- malformed. Applying this changes nothing the page does. The flip to
-- {"mode":"function"} is a separate step that only Lighthouse takes, with the
-- owner's go. The page reads the row afresh at every Filming load and Refresh
-- (anon read policy on syncview_runtime_flags already covers it), so flipping it
-- back to {"mode":"n8n"} takes effect on the next load of every open tab.
--
-- An existing row wins (on conflict do nothing), so re-running never resets a flip.
--
-- Flip:     update public.syncview_runtime_flags set value = '{"mode":"function"}'::jsonb, updated_by = 'lighthouse' where key = 'filming_plan_tabs_source';
-- Rollback: update public.syncview_runtime_flags set value = '{"mode":"n8n"}'::jsonb,      updated_by = 'lighthouse' where key = 'filming_plan_tabs_source';
-- ============================================================
begin;

insert into public.syncview_runtime_flags (key, value, updated_by)
values ('filming_plan_tabs_source', '{"mode":"n8n"}'::jsonb, 'filming-plan-tabs-source-migration')
on conflict (key) do nothing;

commit;
