# Step 26/27 — native intake and closure of its legacy fallback

This is a **design and acceptance plan only**. It authorizes no database access, flag change, deployment, workflow edit, or merge. Source statements are against current `main`; live measurements cited from the earlier session are not fresh verification by this document.

## Current source boundary

`native_intake_epochs` makes native intake durable, but it is not a complete legacy-exit closure.

| Path | Current behaviour | Effect of `linear_outbound_enabled: off` |
|---|---|---|
| Native `production-write` intake, including an ordinary real-client batch that straddles an epoch change | A pre-existing batch receipt preserves request identity and can retain an older empty epoch. For normal real-client, non-parity work, `production-write` schedules a drain only when `outboundLiveForDrain()` reads `live`; `linear-outbound` selects no normal real rows in `off` mode. TEST and legacy-parity exceptions retain their explicit behavior. | Stops the normal drain. It does not alter the stored request identity or reroute unfinished work. |
| Direct browser legacy submission | `_submitLinearFormRoutedOnce` can call `_submitLinearFormLegacy`, which posts to the legacy webhook directly. It bypasses `production-write`, the outbox, and the outbound flag. | No effect. |

The reported **“15 cards reached Linear”** is an earlier-session measurement, not reproduced or freshly verified here. That session's five checks did not reproduce it, but cannot prove the direct webhook path absent or detect it through an empty-epoch outbox query. Preserve the discrepancy as an open historical fact; fixing confirmed paths does not require a separate historical-audit investigation first.

## Gate 0 — read-only pre-cutoff disposition

Before final outbound cutoff, Storage records read-only checks for unfinished legacy batches/receipts: each stable request/receipt identity, terminal or non-terminal state, and explicit disposition. A disposition is recovery on its existing identity, an owner-approved hold, or another documented recovery procedure.

Do not impose a batch age limit as a prerequisite and do not silently reroute an interrupted submission across identities or epochs. Root-history pinning prevents partial multi-item requests from splitting; any later change is optional, separate work.

## Confirmed browser exits to close

All four direct legacy-path exits require an identity-preserving, visible browser hold rather than a fallback POST.

| Exit | Required visible hold and recovery |
|---|---|
| Saved legacy receipt | State that the submission predates cutoff and show the receipt/request identity. Recover on that identity; never auto-convert to native. |
| `localStorage` read throws | State that saved submission recovery cannot be read. Do not choose legacy; preserve the entered draft and give an owner-recovery path. |
| Routing helper missing | State that the browser is incomplete/outdated and cannot safely submit. Do not POST; reload/update is recovery. |
| Routing returns `false` | State that the client is not enrolled for native intake. Hold visibly; **never** auto-enroll and never submit through legacy. |

The native-pending receipt remains on its native recovery path. Holds must neither overwrite nor discard a durable receipt.

## What needs implementation later

| Work | Required boundary |
|---|---|
| Browser closure | Update the Submit router for all four holds; remove dead legacy submit/polling code only after hold/recovery tests prove no live caller remains. Browser code publishes through GitHub Pages. |
| Optional database observability | A browser panel can publish with browser code. A SQL view/routine cannot: it needs a **new additive migration**, authorized installation by Storage, then database readback. Never edit an installed migration in place. |
| Optional Edge Function source change | If changing any Section 4 function, use [deploy-f27-section4-closures.yml](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml). Use the sealed capture and private upload first with the existing `f27-capture.ps1` flow; do not recreate it or provide raw PowerShell. |
| Final flag-only cutoff | Change `linear_outbound_enabled` only through canonical retirement flag control by Storage, with readback. Section 4 deploys four pinned Edge Functions; it neither updates flags nor replaces flag control. |

## Step 27 acceptance checks

| # | Acceptance check | Measurement |
|---|---|---|
| 1 | Every unfinished legacy batch/receipt has explicit pre-cutoff disposition. | Storage read-only inventory and recovery/hold record, keyed by existing identity. |
| 2 | All four browser exits show their specified visible holds. | Offline browser tests for saved receipt, throwing storage read, missing helper, and `false` routing; confirm zero legacy webhook request. |
| 3 | Unenrolled clients are held, not enrolled or submitted automatically. | Offline test asserts visible hold and no mutation attempt. |
| 4 | Native pending submissions retain their existing identity. | Offline recovery test; no cross-epoch or cross-request reroute. |
| 5 | Browser closure is verified independently of empty-epoch outbox checks. | Source/browser tests acknowledge the outbox query cannot see direct-webhook bypass. |
| 6 | If observability is SQL, its additive migration is installed by authorized Storage and read back; if browser-only, publication and source tests are recorded. | Installation/readback or served-browser/source evidence. |
| 7 | Final ordinary-real-row outbound cutoff occurs through Storage only after checks 1–6 and all other final-cutoff dependencies are accepted. | Flag-control receipt and readback of `linear_outbound_enabled`; TEST/parity behavior checked explicitly. |

## Step 28 — closure sense and ordering

Browser fallback closure may precede final outbound cutoff. It is complete when the four browser exits cannot make a direct webhook submission and recovery holds preserve identity.

Final cutoff is not full Linear independence. It remains gated on accepted identifier-mint, intake, Workload, urgent-assignee lookup, brief media, and card-materialization replacements, plus Step 27. Only then may Storage perform the flag-control procedure that stops ordinary real-client outbound drains. TEST/parity exceptions remain explicit, and a quiet outbox epoch is not evidence against direct-webhook bypass.
