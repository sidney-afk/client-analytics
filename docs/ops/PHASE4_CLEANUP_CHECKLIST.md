# Calendar v1 cleanup checklist — QUARANTINED

> [!CAUTION]
> **HISTORICAL DRAFT — NON-OPERATIVE. DO NOT DELETE OR SIMPLIFY CODE FROM THIS FILE.**
> The former Phase-4 recipe rested on a false “v2 is ready for every user” premise and could remove
> current behavior while its two named tests remained green. F104 withdrew the recipe on
> 2026-07-14. Git history retains it for archaeology only.

## Why the old recipe was withdrawn

- Calendar v2 is the default, but `?v2=0` and sticky `CAL_V2_KILL_KEY` still make
  `_calV2Ready()` false. README and the current System Map still advertise that per-browser
  recovery path. Usage has not been measured, so the opt-out population cannot be called zero.
- The former first step deleted `LINEAR_STATUSES_URL` with the v1-only
  `_calReconcileLinearStatuses`. That constant also powers the current v2
  `_calRefreshParentLinkFlags()` path. Deleting it would silently stop project/due/editor/
  parent-link metadata refresh because the caller catches the failure.
- The named status/banner tests do not exercise the v1/v2 flag, sticky opt-out, n8n read fallback,
  parent-link metadata refresh, Films, Kasper's three-tier reader, save-shape differences, outage
  containment, or second-device/concurrency behavior.
- “Delete newly orphaned helpers” was unsafe as a file-local rule:
  `_calMapLinearStatusStrict` is extracted from `index.html` by both reconciliation scripts.
- The old sequence also removed current differences in Linear catch-up, refresh cadence,
  whole-card versus field-patch saves, base-watermark behavior, and Supabase-to-n8n recovery. Those
  are product/recovery decisions, not behavior-preserving refactors.

## Current rule

The Calendar v1/read-fallback path remains current until the product/operations owner explicitly
retires it. No code, webhook, Sheet, flag, or recovery branch may be removed from this historical
file. Step-3 objects also remain governed by F60: exact private object capture, a supported
restore/recreate procedure, rehearsal, and machine-read post-action/rollback proof per object.

Read confidentiality findings such as F88 may justify replacing a legacy reader, but they do not
authorize deleting outage recovery without a scoped replacement.

## Required successor retirement plan

A new, dated, owner-approved plan must be written from current source and include:

1. Identifier-free telemetry proving the `?v2=0`/sticky-opt-out population and every fallback
   caller over an approved window.
2. An explicit owner decision on retiring the per-browser rollback, plus a replacement for
   Supabase/read/merge incidents and a synchronized README/System Map/ROLLBACK update.
3. Whole-repository symbol-consumer analysis, including scripts that extract functions from
   `index.html`.
4. Current authorization/read-confidentiality disposition for the surviving and replacement paths.
5. TEST coverage for v2-on and v2-off, Supabase failure, n8n fallback, status metadata/banner,
   Calendar/client/Kasper/Films, save concurrency, focus/return, mobile, and second device.
6. Full `npm test`, a live TEST-only recovery rehearsal, and a rollback proof before any removal.
7. For each workflow/Sheet/config object: F60's exact snapshot, recreate procedure, independent
   readback, and owner sign-off. Prefer disable/archive before deletion.

Until all seven exist and pass, Calendar-v1 cleanup is **blocked**, not “low risk.”
