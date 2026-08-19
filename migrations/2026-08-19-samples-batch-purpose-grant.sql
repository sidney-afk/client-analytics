-- Samples native create, grant layer. FIXES A LIVE BREAK introduced by
-- migrations/2026-08-19-samples-batch-purpose.sql.
--
-- WHAT BROKE
-- The Samples create dialog filters batches by `purpose`, and every such read
-- returned HTTP 401 / SQLSTATE 42501 "permission denied for table batches" --
-- not just for the new column, for THE WHOLE TABLE. The Calendar picker was
-- unaffected because it never named the column.
--
-- WHY
-- 2026-07-23 (f34/f53) deliberately revoked the table-wide SELECT on
-- public.batches and replaced it with an explicit COLUMN allowlist for
-- anon/authenticated, so that a stale cached client asking for a column it
-- should not see fails closed. That is working as designed. Column privileges
-- are not inherited by columns added later, so `purpose` was outside the
-- allowlist, and PostgreSQL refuses the statement rather than the column --
-- which is why the failure looked like a blanket auth error rather than a
-- missing field.
--
-- Referencing a column in a WHERE clause requires the same privilege as
-- selecting it, so this is required even if the column is never read back.
--
-- SAFE TO EXPOSE: purpose is 'calendar' or 'samples'. It carries no client
-- data, no identifier and no secret; it is the same class of routing flag as
-- `status`, which has been in the allowlist since f34.
--
-- WHY THE ORIGINAL MIGRATION'S PROOF DID NOT CATCH THIS
-- It was compiled and behaviour-proven on a disposable PostgreSQL 16 -- as
-- superuser, against a fixture with no RLS and no grants. Everything about the
-- column was correct; the permission that governs reaching it was invisible to
-- that method. Any future migration touching a table with a column allowlist
-- must be proven AS THE anon ROLE, which is what this file's own proof does.

begin;

-- Additive: existing column privileges are untouched.
grant select (purpose) on table public.batches to anon, authenticated;

commit;

-- ROLLBACK:
--   begin;
--   revoke select (purpose) on table public.batches from anon, authenticated;
--   commit;
--
-- Revoking it re-breaks the Samples picker, so roll back only alongside
-- reverting the browser change that names the column.
