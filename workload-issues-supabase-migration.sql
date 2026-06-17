-- ============================================================
-- Workload → Supabase migration SQL
-- Run in the Supabase SQL editor for project uzltbbrjidmjwwfakwve.
--
-- This table is a DERIVED CACHE of active Linear sub-issues that backs the
-- Workload view. It is NOT a source of truth — every row is reconstructable
-- from Linear at any time by the reconcile job. Dropping or truncating it is
-- therefore safe (the next reconcile refills it). Nothing here is destructive
-- and the block is idempotent: safe to run more than once.
--
-- Mirrors the proven content_samples / calendar_posts pattern:
--   table + RLS (anon read only) + realtime publication + replica identity full.
-- Writes are performed server-side (reconcile job + Linear webhook) using the
-- existing "Supabase - SyncView Calendar" service credential — there is
-- deliberately NO anon write policy, so the browser's public key cannot write.
-- ============================================================

create table if not exists public.workload_issues (
  id                 text primary key,     -- Linear issue id (global, stable)
  identifier         text,                 -- human key, e.g. "VID-12570"
  title              text,
  url                text,
  is_sub_issue       boolean not null default false,
  parent_id          text,                 -- Linear id of the parent issue (null for parents)
  parent_identifier  text,
  due_date           text,                 -- Linear dueDate ("YYYY-MM-DD" or null); FE slices to 10
  linear_created_at  text,                 -- Linear issue createdAt (raw)
  linear_updated_at  text,                 -- Linear issue updatedAt (raw) — change detection
  status             text,                 -- workflow state name
  status_type        text,                 -- workflow state type (started/unstarted/backlog/triage/…)
  team_key           text,
  team_name          text,
  assignee_id        text,
  assignee_name      text,
  assignee_email     text,
  client_name        text,
  active             boolean not null default true,  -- soft flag; reconcile/webhook flip to false instead of deleting
  synced_at          timestamptz not null default now()  -- last time a writer touched this row
);

-- Read paths: "all active issues" and per-assignee / per-client filtering.
create index if not exists workload_issues_active_idx     on public.workload_issues (active);
create index if not exists workload_issues_assignee_idx    on public.workload_issues (assignee_id);
create index if not exists workload_issues_client_idx      on public.workload_issues (client_name);
-- Reconcile mark-and-sweep deactivates rows whose synced_at predates the run.
create index if not exists workload_issues_synced_at_idx   on public.workload_issues (synced_at);

-- ---- RLS: anon may READ only (no anon writes) ----
alter table public.workload_issues enable row level security;
grant select on public.workload_issues to anon;
drop policy if exists "anon read workload_issues" on public.workload_issues;
create policy "anon read workload_issues"
  on public.workload_issues for select to anon using (true);

-- ---- Realtime: publish row changes so the board can subscribe ----
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='workload_issues'
  ) then
    execute 'alter publication supabase_realtime add table public.workload_issues';
  end if;
end $$;
alter table public.workload_issues replica identity full;
