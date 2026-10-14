-- Messages inbox read state (Notes Step 2, docs/plans/2026-10-13-notes-messages.md).
--
-- One row per staff member per post: when they last read that conversation.
-- "Mark as unread" moves last_read_at back to just before the newest message
-- someone else wrote. reader_id is the verified roster member id (never the
-- shared role key, which several people hold and which is a secret).
--
-- Access: no browser key and no signed-in role reads or writes it. Only the
-- production-comments Edge Function (service role) reads and upserts rows,
-- after checking the staff key and roster member itself. Supabase grants every
-- new table to anon, authenticated and service_role by default, so all four
-- roles are named in the revoke.
--
-- Written by session Courier 2026-10-14; applied by the owner, not by CI.
begin;

create table if not exists public.message_reads (
  reader_id uuid not null references public.team_members(id) on delete cascade,
  post_id text not null check (length(post_id) between 1 and 160),
  last_read_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (reader_id, post_id)
);

alter table public.message_reads enable row level security;

revoke all on table public.message_reads from public, anon, authenticated, service_role;
grant select, insert, update on table public.message_reads to service_role;

comment on table public.message_reads is
  'Staff-only: when each staff member last read each post''s Messages conversation. Read and written only by production-comments (service role).';

commit;
