-- Public intake rate-limit ledger and ownership record.
--
-- WHY THIS TABLE EXISTS. The owner decided on 2026-08-24 that the Submit link
-- must work for anyone — clients and videographers send footage through it and
-- are not staff. `production-write` therefore admits an unauthenticated caller
-- for `intake_create` on the `submission` surface only, and the rate limit is
-- the control that bounds what an open write path can be used for.
--
-- WHY A TABLE AND NOT AN IN-PROCESS COUNTER. Edge instances do not share memory
-- and are recycled constantly, so a counter in the function would reset to zero
-- under exactly the load it exists to stop — a rate limit in name only. The
-- count has to be durable and shared, which means a row per submission.
--
-- It doubles as the ownership record: every public submission leaves a row here
-- naming the client it claimed and the request that made it, so anything that
-- arrives this way is identifiable and reversible in one query. The created
-- deliverables carry `created_by = 'public-intake'` for the same reason.
--
-- PRIVILEGES. Service role only. The anon key must never read this — it would
-- expose the roster of who is submitting and how often — and must never write
-- it, because a caller who could insert here could also exhaust another
-- client's allowance or clear its own.

create table if not exists public.public_intake_log (
  id bigint generated always as identity primary key,
  client_slug text not null,
  request_id text not null,
  item_count integer not null default 0,
  -- Server-set, never caller-supplied: the whole limit depends on this clock.
  created_at timestamptz not null default now()
);

-- The only query this table serves is "how many rows since <timestamp>",
-- optionally narrowed to one client. Both windows are covered by this index.
create index if not exists public_intake_log_created_at_idx
  on public.public_intake_log (created_at desc);
create index if not exists public_intake_log_client_created_at_idx
  on public.public_intake_log (client_slug, created_at desc);

alter table public.public_intake_log enable row level security;
revoke all on public.public_intake_log from anon;
revoke all on public.public_intake_log from authenticated;

-- The runtime switch. ABSENT or `{"enabled": false}` means the public path is
-- closed, and `production-write` fails closed on a missing row, an unreadable
-- row, or a malformed value — so this insert is what turns the capability on,
-- and a single update turns it off again without a deploy.
insert into public.syncview_runtime_flags (key, value, updated_by)
values ('public_intake_enabled', '{"enabled": false}'::jsonb, 'migration-public-intake')
on conflict (key) do nothing;
