-- ============================================================
-- WR-101 refusal receipts learn the `title` operation (rename release 2).
--
-- production-write gains `title` (rename a sub-issue in SyncLinear,
-- OPEN_REPAIRS 243). Every gateway operation must be recordable in the
-- refusal logbook as itself (test/linear-exit-write-diagnostics-handlers.js),
-- so _shared/write-refusal-diagnostics.mjs now emits operation 'title', and
-- this widens the table's check to accept it.
--
-- APPLY BEFORE deploying the production-write that carries `title`. If the
-- order is reversed nothing breaks -- the gateway records receipts
-- fail-soft -- but a refused rename would lose its receipt until this lands.
-- Additive and idempotent: the new check is a strict superset of the old one.
-- ============================================================
begin;
alter table write_refusal_diagnostics.receipts_v1
  drop constraint if exists receipts_v1_operation_check;
alter table write_refusal_diagnostics.receipts_v1
  add constraint receipts_v1_operation_check check (operation in (
    'comment','status','create','update','archive','restore','due','assignee',
    'labels','description','attachment','intake_create','batch_asset',
    'batch_description','component_fill','title','other'));
commit;
