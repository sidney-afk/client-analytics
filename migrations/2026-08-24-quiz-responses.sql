-- Growth Bottleneck Quiz — response storage, rate-limit ledger, and the
-- runtime switch that gates public capture.
--
-- WHY THIS TABLE EXISTS. The synchrosocial.com quiz funnel (/quiz) is a
-- public, unauthenticated lead magnet: anyone can take it, no client
-- relationship exists yet. It needs the same posture as `public_intake_log`
-- (2026-08-24) — a durable, DB-backed rate limit, not an in-process counter,
-- because Edge instances share no memory and are recycled constantly, so a
-- counter in the function would reset to zero under exactly the load it
-- exists to stop. A fresh table rather than reusing `public_intake_log`:
-- that table's shape (`client_slug`) is purpose-built for `production-write`'s
-- per-client model, and a quiz response has no client yet.
--
-- WHY A RUNTIME FLAG. Same fail-closed posture as `public_intake_enabled`: a
-- missing row, unreadable row, or malformed value must close the path, not
-- open it, and a single update can turn capture off without a redeploy.
--
-- PRIVILEGES. Service role only, same as every public-write table in this
-- repo — there is no RLS policy anywhere here that grants anon/authenticated
-- INSERT; the application layer inside the Edge Function decides
-- eligibility, then writes with the service-role key.

create table if not exists public.quiz_responses (
  id                bigint generated always as identity primary key,
  -- Client-minted idempotency key: a retry after a lost response answers
  -- {ok, duplicate:true} instead of creating a second row.
  response_id       text not null,
  quiz_slug         text not null default 'growth-bottleneck',
  contact_name      text,
  contact_email     text,
  -- Raw per-question answers, {q1: 4, q2: 2, ...}. Kept as the flexible
  -- question/answer shape the doc itself uses — same reasoning the legacy
  -- onboarding-inbox detail view already applies to its own free-form fields.
  answers           jsonb not null default '{}'::jsonb,
  result_category   text,  -- reach | positioning | profile | consistency
  result_scores     jsonb, -- {reach: 6, positioning: 8, profile: 4, consistency: 9}
  headline_variant  text,  -- ?hl= value at submit time, for the A/B test
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  utm_term          text,
  fbclid            text,
  gclid             text,
  ttclid            text,
  referrer          text,
  created_by        text not null default 'public-quiz',
  -- Server-set, never caller-supplied.
  created_at        timestamptz not null default now()
);

create unique index if not exists quiz_responses_response_id_idx
  on public.quiz_responses (response_id);
create index if not exists quiz_responses_created_at_idx
  on public.quiz_responses (created_at desc);

alter table public.quiz_responses enable row level security;
revoke all on public.quiz_responses from anon;
revoke all on public.quiz_responses from authenticated;

-- Rate-limit ledger. Same "how many rows since <timestamp>" query shape as
-- public_intake_log, without the per-client column this funnel has no use
-- for.
create table if not exists public.quiz_intake_log (
  id          bigint generated always as identity primary key,
  request_id  text not null,
  created_at  timestamptz not null default now()
);

create index if not exists quiz_intake_log_created_at_idx
  on public.quiz_intake_log (created_at desc);

alter table public.quiz_intake_log enable row level security;
revoke all on public.quiz_intake_log from anon;
revoke all on public.quiz_intake_log from authenticated;

-- The runtime switch. ABSENT or `{"enabled": false}` means the public
-- capture path is closed; quiz-capture fails closed on a missing row, an
-- unreadable row, or a malformed value.
insert into public.syncview_runtime_flags (key, value, updated_by)
values ('quiz_intake_enabled', '{"enabled": false}'::jsonb, 'migration-quiz-responses')
on conflict (key) do nothing;
