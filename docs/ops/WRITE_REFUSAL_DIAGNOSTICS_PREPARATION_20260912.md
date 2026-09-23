# WR-101: separate refusal-diagnostics preparation

> **Superseded in part, 2026-09-22 (ledger 240).** This document describes the
> September 12 preparation as it was built. The release composed from it now
> lives in real source: the gateway integration is committed in
> `supabase/functions/production-write/index.ts` and the browser beacon in
> `src/index/120-calendar-flags-write-repair.js.part`. The composer no longer
> pins or patches `index.html` — that pin was a build output and went stale on
> every merge — and it no longer patches the gateway either, since only the
> committed file can be deployed. See ledger 240 for what changed and why.
>
> **Released 2026-09-23 (ledger 241, `EXECUTION_LOG.md`).** The SQL owner is on
> the live project, `write-diagnostics` is deployed and enabled, and the gateway
> recorder is live in `production-write` version 82. Kill switch: `ROLLBACK.md`.

Prepared and tested in isolation; not merged, deployed or activated. Existing
gateway and browser source files are unchanged. The companion composer produces
reviewable versions for a separate release, preserving the original refusal
status and response body. Calendar/Samples links and tokenless access are unchanged.

## Components

- SQL owner `20260913044451_write_refusal_diagnostics_preparation.sql` creates a
  private, RLS-enabled receipt table and service-only record, lookup/summary and
  bounded retention routines. No browser role receives direct access.
- `scripts/linear-exit-write-diagnostics-compose.js` pinned the gateway and browser
  source before inserting diagnostics. The gateway records after the failed
  business operation, using verified authentication context when available.
  (As of 2026-09-22 it pins nothing and patches nothing; it asserts the five
  committed gateway integration points appear exactly once each.)
- `supabase/functions/write-diagnostics/index.ts` accepts explicitly unverified
  browser claims and protects operator queries with a separate runner key.
  Shared helpers allowlist refusal codes and operations. Identifiers are hashed
  for lookup; bodies, display names, credentials and raw payloads are not stored.

Gateway recording waits at most 500 ms, never retries, and exposes recorded,
unavailable or unknown telemetry status without replacing the save error.
Browser reports are bounded to 20 per page, 2 KiB each, with a 1.5-second abort
and no retry. SQL serializes its per-minute admission limit: 100 browser claims
and 1,000 gateway receipts. Limits do not guarantee offline or outage capture.
Operator lookup returns at most 100 matching receipts from the last 24 hours;
summary counts remain separate. Retention removes at most 1,000 records older
than 30 days per invocation and has no installed schedule.

## Evidence

Portable PG17 lane `write-diagnostics`: final receipt
`28dd7d7f6a844554b46896c51cdd4021`, 13 checks passed, server stopped.
The full composed gateway performs real staff-key/roster authentication and
reaches the actual batch-description CAS routine. A competing write causes the
routine to refuse; the gateway retains HTTP 409 and `write_conflict`, does not
change description/events beyond the pre-RPC state, and commits a diagnostic
with the verified member UUID afterward. No external calls occurred. Fixture
SDK reads use the isolated owner connection; this is not full PostgREST ACL proof.

Separate handler/browser checks cover dormancy, operator authentication, bounded
claims, redaction, fixed fallback codes, telemetry failure and preserved drafts.
This is not a single full SPA-to-hosted-gateway journey. Earlier fixture failures
(child database binding, missing request ID and seeded event baseline) remain
private failed receipts; final assertions compare the exact pre-RPC state.

## Separately authorized release and acceptance

Review the SQL owner, composed gateway, composed browser and complete function
dependencies together. The new browser-reporting function needs
`verify_jwt=false`; its operator actions retain their separate key check.
`WRITE_DIAGNOSTICS_ENABLED=true` enables that new endpoint. Configure its reviewed
URL and private runner key, choose a retention cadence, and establish independent
outage monitoring. No configuration or schedule is changed by this preparation.

Include the diagnostics profile in control-record recovery when this SQL owner
is installed; a core-only backup must refuse to omit the private receipt table.
That profile passed isolated encrypted capture/reopen/restore of 94 tables; see
`../independence/LINEAR_EXIT_CONTROL_RECOVERY_20260912.md` for pins and limits.
Final combined installation-owner coverage remains open. Hosted gateway,
browser, lookup, outage and retention acceptance remains an installation-window
requirement. Diagnostics do not turn a refused save into a successful one.
