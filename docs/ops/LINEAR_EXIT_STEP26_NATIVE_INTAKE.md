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

Before final outbound cutoff, Storage records read-only checks for unfinished legacy batches/receipts **that are visible to the server**: each stable request/receipt identity, terminal or non-terminal state, and explicit disposition. A disposition is recovery on its existing identity, an owner-approved hold, or another documented recovery procedure.

**Server-visible and browser-held are different populations.** The legacy browser path writes its receipt to `localStorage` (`LINEAR_RECEIPTS_KEY`) *before* the webhook request starts. A browser interrupted before that request completes can hold a pending receipt that never reached any table Storage can read. A database inventory therefore proves disposition only for server-visible identities; it cannot establish that no browser-held receipt exists. Browser-held receipts are covered instead by the first browser exit below: on next open, the browser must show the saved receipt and its identity as a visible hold, and recover on that identity. Record the two populations separately; do not report the server inventory as covering both.

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

## Step 27 — acceptance before cutoff (checks 1–8)

These checks accept the replacement. **All of them must pass before the final outbound cutoff**, and none of them depends on the cutoff.

| # | Acceptance check | Measurement |
|---|---|---|
| 1 | Every unfinished **server-visible** legacy batch/receipt has an explicit pre-cutoff disposition. | Storage read-only inventory and recovery/hold record, keyed by existing identity. Reported as server-visible only (see Gate 0); it makes no claim about browser-held receipts. |
| 2 | All four browser exits show their specified visible holds, including a **browser-held** saved legacy receipt that never reached the server. | Offline browser tests for saved receipt (including one with no server-side counterpart), throwing storage read, missing helper, and `false` routing; each confirms zero legacy webhook requests. |
| 3 | Unenrolled clients are held, not enrolled or submitted automatically. | Offline test asserts visible hold and no mutation attempt. |
| 4 | Native pending submissions retain their existing identity. | Offline recovery test; no cross-epoch or cross-request reroute. |
| 5 | **Both team drills ran on native intake**, not the provider lane. | A Storage-authorized TEST run of `scripts/production-write-drill.js` for **each** team. Immediately before it, a readback of `native_intake_epochs` shows that team `enabled: true` with a well-formed epoch. Its report shows `intake_lane_by_team` = `native_intake` for that team and a matching `native_intake_by_team` entry. Intended cards and terminal native-only receipts exist, and a retry keeps the request identity with no duplicate card. A run whose report says `provider` for either team does not satisfy this check, whatever else it shows. Live execution remains deferred. |
| 6 | **The browser Submit route succeeds, and a retry is accepted.** | For an enrolled TEST client on each team, a served-browser (or equivalent browser-harness) submission through `_submitLinearFormRoutedOnce` selects the native route, never `_submitLinearFormLegacy`. It produces the intended cards and a server receipt. A retry of the same submission (resubmit after an interrupted response, and recovery after reload) is accepted on the **same** request identity with no duplicate card. Zero legacy webhook requests. The service-only drill in check 5 does not exercise this route and cannot substitute for it. Live execution remains deferred. |
| 7 | Browser closure is verified independently of empty-epoch outbox checks. | Source/browser tests acknowledge the outbox query cannot see direct-webhook bypass. |
| 8 | If observability is SQL, its additive migration is installed by authorized Storage and read back; if browser-only, publication and source tests are recorded. | Installation/readback or served-browser/source evidence. |

## Step 28 — closure after cutoff (check 9)

| # | Closure check | Measurement |
|---|---|---|
| 9 | Final ordinary-real-row outbound cutoff, performed through Storage **after** checks 1–8 have passed and every other final-cutoff dependency is accepted. | Flag-control receipt and readback of `linear_outbound_enabled`; TEST/parity behavior checked explicitly. |

**Order.** Checks 1–8 accept the browser/native-intake replacement before the cutoff: its holds, native intake on both teams, a successful browser Submit and retry, and identity-preserving recovery are its own evidence. The replacement therefore does not depend on the cutoff it enables. The cutoff is gated on checks 1–8, **not on "Step 27" as a whole**, and check 9 records it.

Final cutoff is not full Linear independence. It remains gated on accepted identifier-mint, intake, Workload, urgent-assignee lookup, brief media, and card-materialization replacements, plus checks 1–8. Only then may Storage perform the flag-control procedure that stops ordinary real-client outbound drains. Record **full legacy-route closure only after that cutoff** (check 9). TEST/parity exceptions remain explicit, and a quiet outbox epoch is not evidence against direct-webhook bypass. Browser-held legacy receipts remain covered by the check 2 hold, not by the cutoff.
