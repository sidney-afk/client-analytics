-- Asset access evidence, looked up by URL (2026-09-05).
--
-- production-write's asset_access_read now reuses a fresh verdict the ledger
-- already holds for the SAME url (slot + url_sha256, newest first, within
-- ASSET_EVIDENCE_MAX_AGE_MS) instead of probing the provider on every read.
-- The table's primary key and its one index both lead with deliverable_id, so
-- that lookup is a scan without this.
--
-- Optional. The read is correct without it and the table is small today; this
-- only keeps the lookup cheap as the ledger grows. Idempotent, safe to re-run.
create index if not exists production_asset_access_checks_by_url_idx
  on public.production_asset_access_checks (slot, url_sha256, checked_at desc);
