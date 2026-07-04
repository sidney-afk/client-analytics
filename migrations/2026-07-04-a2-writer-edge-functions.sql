-- A2 writer Edge Functions: additive runtime flag only.
-- Real clients must remain on n8n until explicitly canaried.

insert into public.syncview_runtime_flags (key, value, updated_by)
values ('sample_review_ef_clients', '{"clients":[]}'::jsonb, 'a2-migration')
on conflict (key) do nothing;
