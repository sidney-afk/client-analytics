-- ef-auto-deploy-applied-when: select to_regclass('public.crm_n8n_sequences') is not null
-- ef-auto-deploy: functions-cope-without-this
--
-- Leads CRM: the n8n automations that message a lead, as readable sequences
-- (docs/features/CRM_LEADS.md). One row per automation, with its messages
-- (channel, when, from, subject, the exact wording) in `messages`.
--
-- Why a table and not the repo: the wording names clients and results, and
-- this repo is public. The rows are a snapshot read from n8n; refresh them
-- when an n8n message changes. They are read-only in SyncView and nothing
-- here sends anything. crm-leads `systems` returns them; if this table is
-- missing it returns an empty list, so the function copes without it.
--
-- Access: like every crm_ table, no browser key and no signed-in role. All
-- four roles are named in the revoke, then service_role gets select back.
--
-- Rollback: drop table public.crm_n8n_sequences;

create table if not exists public.crm_n8n_sequences (
  key text primary key check (key ~ '^[a-z0-9_]{1,40}$'),
  name text not null check (length(name) between 1 and 120),
  description text not null default '' check (length(description) <= 300),
  audience text not null default '' check (length(audience) <= 500),
  stops_when text not null default '' check (length(stops_when) <= 800),
  workflow_name text not null default '' check (length(workflow_name) <= 200),
  position integer not null default 100,
  active boolean not null default true,
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  synced_at timestamptz not null default now()
);

alter table public.crm_n8n_sequences enable row level security;
revoke all on table public.crm_n8n_sequences from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.crm_n8n_sequences to service_role;
