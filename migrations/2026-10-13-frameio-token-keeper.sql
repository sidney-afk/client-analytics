-- ============================================================
-- Frame.io key keeper: storage for the Edge Function frameio-token.
--
-- Adobe's login (Adobe IMS) hands out a NEW refresh token on every refresh
-- and refuses the old one right after, so whoever refreshes must save the new
-- one or the login dies. This table holds that one current refresh token,
-- server side only, so the login renews itself as long as it is used at least
-- once every 14 days.
--
-- One row (id = 1):
--   refresh_token          the current Adobe refresh token. Never leaves the
--                          server: the function returns access tokens only.
--   saved_at               when that refresh token was saved.
--   last_result(_at)       outcome of the last refresh or login, as a short
--                          code ("ok", "login_needed: ...", "adobe_unavailable: ...").
--   lease_id, lease_until  a short claim taken by one refresh at a time. The
--                          claim is a single conditional UPDATE (row lock), so
--                          two callers at once cannot both spend the same
--                          refresh token and lose the new one.
--   login_state(_expires)  the one-time state of a pending login, checked and
--                          cleared by the login callback.
--
-- Access: RLS on with no policies, everything revoked from public, anon,
-- authenticated and service_role, then SELECT, INSERT, UPDATE for
-- service_role only (the function never deletes). No browser key can read it.
-- Idempotent; rollback at the bottom.
-- ============================================================

create table if not exists public.frameio_token_keeper (
  id                   smallint primary key default 1 check (id = 1),
  refresh_token        text,
  saved_at             timestamptz,
  last_result          text,
  last_result_at       timestamptz,
  lease_id             uuid,
  lease_until          timestamptz,
  login_state          text,
  login_state_expires  timestamptz
);

comment on table public.frameio_token_keeper is
  'Frame.io (Adobe IMS) refresh token keeper for the frameio-token Edge Function. Service role only.';

alter table public.frameio_token_keeper enable row level security;
revoke all on table public.frameio_token_keeper from public, anon, authenticated, service_role;
grant select, insert, update on table public.frameio_token_keeper to service_role;

-- CHECK (expect anon/authenticated false everywhere; service_role select,
-- insert, update true and delete, truncate false):
-- select r.rolname,
--   has_table_privilege(r.rolname, 'public.frameio_token_keeper', 'SELECT') sel,
--   has_table_privilege(r.rolname, 'public.frameio_token_keeper', 'INSERT') ins,
--   has_table_privilege(r.rolname, 'public.frameio_token_keeper', 'UPDATE') upd,
--   has_table_privilege(r.rolname, 'public.frameio_token_keeper', 'DELETE') del,
--   has_table_privilege(r.rolname, 'public.frameio_token_keeper', 'TRUNCATE') trn
-- from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role');

-- ROLLBACK (nothing else depends on this table; the Frame.io login is lost):
-- drop table if exists public.frameio_token_keeper;
