# SyncLinear / Linear exit: deep-cutover addendum

Status: analysis-only. This document changes no production behaviour, data, runtime flag, Edge Function, n8n workflow, share link, or credential. It extends and, where stated, corrects [the 2026-09-03 strategy](2026-09-03-synclinear-linear-exit-strategy.md).

Repository base: `00d0e8883f754dd03676216e23a602a9e5bd353c` (`origin/main`, inspected 2026-09-03). Live measurements below are point-in-time, aggregate-only, and deliberately omit client identifiers, share tokens, bodies, attachment URLs, and secrets.

## Executive answer

Yes. The first strategy identified the main migration lanes, but a safe retirement has more failure domains than a route flip. The deeper audit found client-critical problems in fallback semantics and cached browser state; current, measurable native-link and Workload gaps; historical-data/asset/recovery gaps; and operational trigger/deployment paths that can revive or silently degrade a Linear dependency.

Linear must **not** be scheduled for credential revocation or account cancellation yet. This is not because SyncLinear is unused: the live authority flags are native for both production teams. It is because native authority does not prove that every client action, old browser, background job, historical asset, or staff recovery path has a provider-free durable outcome.

The hard rule remains unchanged: existing client share links keep their current open Calendar/Sample writer contract. Do not solve an exit problem by adding a token or login gate to either writer. That caused client-wide approval failures before and is expressly frozen by `AGENTS.md:3-14`.

## Correction to the earlier map

The earlier map described Samples fallback failure as an error/stale presentation. That was too favourable. The primary Samples REST read does have a catch path, but its legacy fallback neither checks the HTTP result nor validates the response envelope. It returns `ok: true` with an empty list for a malformed, wrong-shaped, or empty fallback payload: `index.html:60922-60938`. `loadSxrCards` then treats it as success, clears the error/stale state, writes the empty result to the seven-day cache, and renders it: `index.html:60967-61018`, especially `:60972`, `:60987-60992`.

If the legacy Samples fallback is unavailable or changes shape when Linear is retired, a client can therefore see an empty Samples board rather than their content or an honest error. This is a P0 cutover blocker. The Calendar reader already models the required contrast: it rejects an unusable/empty fallback result and retains last-good cards with a stale notice: `index.html:34587-34618`, `:35181-35195`.

Whether the source at those lines is the serving revision is **UNPROVEN**: `sample-review-upsert`, `calendar-upsert`, and `client-token-verify` have no automatic CI deployment path according to `docs/ops/EF_DEPLOY_MANIFEST.md:25-30,49-50`. The defect is nevertheless reachable in the audited browser bundle and must be tested against the serving revision before any retirement gate can pass.

## Newly confirmed current blockers

| Domain | Confirmed evidence | What a user would see if Linear disappeared now | Required exit condition |
| --- | --- | --- | --- |
| Client Samples read fallback | A primary-read exception can turn a bad/empty fallback into successful cached emptiness: `index.html:60922-61018`. | Client sees no Samples/review content, without an error explaining that their data is unavailable. | Typed fallback validation; preserve last-good content/cache on every unusable fallback outcome; live share-link fault test. |
| Client write fault routing | Missing, malformed, slow, or failed routing-flag reads deliberately choose legacy n8n/Linear status/comment lanes: `index.html:25073-25141`, `:32198-32361`, `:60287-60334`, `:64994-65097`. | An approval, tweak, or comment can look locally/source-saved while the team-delivery leg queues or fails after Linear is gone. | Every failure branch sends one durable native intent/receipt or gives an explicit, recoverable native error; none may call a provider endpoint. |
| Cached clients and local debt | Legacy status/comment queues live in browser storage and resume on startup, focus, page restore, reconnect, visibility, and a minute cadence: `index.html:32134-32196`, `:64948-64992`, `:65681-65841`. Calendar/Samples card caches retain shapes for seven days: `index.html:34371-34376`, `:60791-60857`. Stale tabs are intentionally allowed to keep running while dirty: `index.html:75914-76290`. | A client returning to an older tab can retry a retired endpoint, or an old cached shape can make an action targetless. Server queue health alone cannot show this local debt. | A provider-free compatibility receiver/translator survives the agreed stale-bundle and cache horizon, or the same client is shown a durable native recovery state. Never silently clear their queued intent. |
| Interactive Calendar linkage | Read-only aggregate check at 2026-09-03: 587 component slots would throw `native_link_required`; 31 are actionable and 4 were linked after native authority changed. The classifier defines the precise reachable predicate: `scripts/calendar-native-link-gap-check.js:3-43,153-216`. | A client or staff member can press a status/tweak action on a still-live card and receive a refusal because it has a provider link but no native target. | Zero actionable half-linked components, or a durable native exception route that preserves the offered client control. The post-flip bucket must remain zero. |
| New-card linkage | In the latest eight-week aggregate, 455 cards were created; 20 were unlinked, one remains live, and 17 were removed before judgment: `scripts/card-linkage-leak-check.js:120-192`. | The one live card may be an intentional reference rather than lost work; that classification is **UNPROVEN**. If it is work, no provider shutdown can repair its missing destination. | Privately classify each live unlinked card; make creation atomically attach native work or make its source-only/reference role explicit before exposing an action that needs work. |
| Workload completeness | Native visibility check at 2026-09-03 found 14 real live native rows invisible to their owner, above the gate baseline of 13: `scripts/workload-native-visibility-check.js:218-335`. | Staff misses work they owe. This is staff-facing, but it makes a Linear-free Workload source unsafe. | Native renderer, plan identity, due/assignment/comment reads, forced refresh, and visibility check all pass with Linear unavailable. |
| Workload deep links | A live aggregate read at 2026-09-03 found 5,173 of 5,176 native Workload subissue rows retain a provider URL. The native view selects it: `migrations/2026-09-02-workload-native-view.sql:161-176`. | Staff clicking almost any current Workload item reaches a dead provider link after shutdown. | Replace interactive deep links with native routes; retain legacy identifiers only as non-clickable provenance/archive metadata. |
| Public/staff creation | `production-write` resolves provider project/state/assignee information before the native intake write: `supabase/functions/production-write/index.ts:2168-2517,5953-6009,6837-6902`. | A client or staff member using Submit/Create Post can receive a pre-write service failure. This is client-critical wherever public intake is offered. | Provider-free native project/team/state/assignee mapping is deployed and fingerprinted; share-link and staff Create Post journeys prove a durable native receipt. Production-board create stays closed: `index.html:52200-52256`; `production-write/index.ts:3455-3488`. |
| Provider-only assets/history | The archive reader recognizes private provider uploads and shows an unavailable placeholder when one is unresolved: `supabase/functions/production-archive/index.ts:1-5,124-155,204-230`. The asset rescuer requires a provider credential and a certified final export: `scripts/f34-linear-asset-rescue.js:4-11,436-448,478-524,591-686`. | A historical attachment can become unavailable. The archive reader is staff-only, not a client continuity route: `production-archive/index.ts:242-284`. | Export, classify, rescue/rehost, hash-readback, and share-link retrieval test every visible asset class before access is revoked. |
| Comment/history coverage | F42 deliberately imports only selected linked Calendar/Samples fields; deferrals and wrong-link defects are not imported: `scripts/f42-card-comment-export.js:4-38`; `scripts/f42-card-comment-import.js:31-58,654-685`; `scripts/f42-card-comment-apply.js:105-119`. | Older notes, replies, lifecycle information, or attachments can vanish from the user experience if their only copy is provider-side. | Every comment/reply/tweak/lifecycle record has exactly one disposition: native preserved, protected retrievable archive, or explicit owner-approved retention disposition. |
| Running automation roots | Active GitHub workflows include B1 refresh, deliverable/status/Samples reconcile, outbound drain, E2E, monitoring, and inbound deployment. Source confirms direct provider consumers and independent trigger roots: `.github/workflows/b1-linear-incremental-refresh.yml:24-25,38-42,70-93`; `.github/workflows/linear-outbound-drain.yml:3-17,58-70,91-134`; `.github/workflows/linear-deliverables-reconcile.yml:1-10,48-60,68-130`; `.github/workflows/sample-linear-reconcile.yml:1-15,49-55`. Read-only published n8n inspection also found active Calendar/Workload/urgent-tweak/intake/qll provider paths. | A shut-down provider can cause background failures or error-continued notification/assignment degradation while pages appear to work. | Replace/retire every trigger root—GitHub schedule, dispatch, manual runbook, qll/n8n trigger, provider webhook—not merely one cron. |
| Recovery/rollback | `linear-outbound` in off mode stops calls but does not terminalize ordinary pending work: `supabase/functions/linear-outbound/index.ts:62-74,956-1127,1355-1458`. Manual deployment/rollback bundles can redeploy provider code: `.github/workflows/deploy-onboarding-edge-functions.yml:122-163`; `.github/workflows/deploy-f27-section4-closures.yml:1240-1365`. | Client impact is indirect until a rollback revives an old writer or an unadjudicated queue is forgotten. | Every intent is delivered, explicitly cancelled/classified, or archived with an auditable reason. Provider-free recovery replaces provider replay before irreversible shutdown. |

The 2026-09-03 point-in-time aggregate evidence is intentionally not a claim that every row is defective. The linkage checker measures a component-level, reachable `native_link_required` condition; the eight-week creation check measures whole cards; the Workload checker measures live owner visibility. Their different predicates and timestamps must not be collapsed into one number.

## What the current signals do and do not prove

Read-only live snapshots at roughly 22:00Z on 2026-09-03 show both production teams are SyncView-authoritative, the client-comment gateway is enabled, and the relevant client cohorts are populated. That proves the healthy browser branch is configured for native use at that moment. It does **not** prove a failed flag read, stale bundle, or legacy browser queue follows the native path; the source explicitly says otherwise: `index.html:25073-25141`, `:60287-60334`.

The same snapshot recorded active GitHub workflow definitions with recent completed runs. In particular, the latest scheduled Calendar and Samples E2E runs were failing, while several provider-dependent reconciler/drain runs reported success. A green provider job proves it ran, not that a provider-free client journey works. A red E2E run is a cutover blocker until its cause is classified; its current cause is **UNPROVEN** from this audit. Workflow state can change after this snapshot, so the final gate must take a fresh read immediately before any transition.

Anonymous access returned authorization failures—not zero rows—for protected data such as outbox, intake receipts, comments, archive, workload plans, F27 ledgers, and asset-rescue state. That proves the data is protected from the published role, not that it is absent. Counts, ages, and reconciliation state for those objects are **UNPROVEN** until a private privileged preflight captures them.

## Additional exploration still required

| Question that must be answered privately | Why source/read-only public data is insufficient | Required evidence before approval |
| --- | --- | --- |
| Which source revision is actually serving for manual/no-CI functions? | `production-write`, client writers/verifier, inbound/outbound, archive/comments, and Workload lanes have manual or pinned deployment paths: `docs/ops/EF_DEPLOY_MANIFEST.md:3-7,24-30,38-57`. | Protected deployed source hash/version, deployment receipt, and real test-scope action/readback for each client-critical writer. |
| What remains in protected queues, receipts, mappings, and rollback state? | Track-B backup is a fixed 14-table corpus and omits Calendar/Samples/event ledgers, intake receipts, workload plans, comment receipt/audit/link tables, F27 ledgers, asset-rescue tables, and external bytes: `scripts/track-b-backup.js:42-57`; `docs/ops/TRACK_B_BACKUP.md:21-34,160-207`. | A separate immutable Exit Archive manifest: counts/hashes, DDL/function/trigger versions, crosswalks, external-object hashes, plus isolated restore and retrieval rehearsal with provider egress disabled. |
| Are all provider assets reachable after shutdown? | F34 only recognizes a defined upload-host pattern and selected fields: `scripts/f34-linear-asset-rescue.js:18-20,91-148`; the sidecar has the same bounded shape: `migrations/2026-07-23-f34-f53-production-attachments.sql:687-768`. | Independent final provider-export asset census by host/type/location; zero unclassified occurrences; private byte/hash readback; client-link retrieval tests for every visible asset class. |
| Does every old share link have the credentials/crosswalk a replacement comment route would require? | The native comment reader has exact token, read-budget/audit, and surface-policy constraints: `supabase/functions/production-comments/index.ts:158-191,271-340`; `production-comments/policy.mjs:51-76`. | Fresh and old share-link test matrix. The answer may not be "add auth" because frozen writers remain tokenless: `AGENTS.md:3-14`. |
| Are all published n8n/provider-admin/external paths accounted for? | Repository source cannot establish provider-side webhooks, automations, OAuth apps, personal tokens, Slack/email integrations, browser extensions, or external scripts. Live graph inspection was partial. | Owner-admin export/inventory, role-by-role staff acceptance checklist, and an offline trigger-to-sink dependency scan of exported published workflows. |
| What happens to historical URL/bookmark/404 routes? | The SPA fallback drops query parameters for unknown non-onboarding paths: `404.html:15-24`. Current share-link query behavior is strict: `index.html:59765-59856`. | Inventory of historic route shapes/bookmarks and a no-loss redirect/compatibility test. Absence of old path-based links is **UNPROVEN**. |
| Are existing monitors protection or merely liveness? | The watchdog watches legacy heartbeats and job execution rather than a real client journey: `scripts/monitoring-watchdog.js:57-107,134-139,190-293`. | Replacement alert delivery drill: deliberately fail only the allowed test-scope synthetic and verify owner notification. |

## Extended, ordered exit gates

These gates add to the primary strategy's plan. They are deliberately ordered: a later gate must not be used to compensate for a missing earlier client-safe compatibility guarantee.

### Gate D0 — freeze the evidence baseline and prove serving revisions

- **What changes:** no product behavior. Capture private source/version fingerprints for every manual/pinned Edge Function, published n8n export/version, provider-admin integration inventory, and current protected-data aggregate. Create a separate immutable Exit Archive rather than changing the existing Track-B backup contract.
- **Why it sits first:** a source-only plan cannot certify production behavior where deployment provenance is unknown. A later rollback or dry run is unsafe if it silently restores provider-dependent source.
- **Gate:** protected receipts show each client-critical function's serving hash and writer posture; an isolated archive restore retrieves a representative source card, native work item, comment thread, attachment, receipt, and mapping without provider egress.
- **Post-ship test:** owner runs the retrieval rehearsal and a public test-scope share journey against the observed deployed revision; both have stored aggregate pass/fail evidence.
- **Client sees mid-flight:** nothing changes. This is read-only capture and rehearsal; no writer, flag, URL, or browser cache is changed.
- **Who acts:** database/archive owner, Edge Function deploy owner, n8n owner, and provider administrator. A merge alone cannot complete it.
- **Undo:** additive evidence capture is reversible only as a reference artifact. It must not be deleted during the cutover program.

### Gate D1 — make client reads fail closed to last-good content, not to empty success

- **What changes:** replace Samples' unchecked legacy fallback with Calendar-equivalent response/envelope validation, last-good preservation, stale/error presentation, and no-empty-cache-write behavior. This is a client reader repair, not a writer re-gate.
- **Why it precedes provider retirement:** otherwise a provider outage can masquerade as an empty-but-successful client board, making a client-visible loss invisible to monitoring.
- **Gate:** primary read fault plus each fallback result—non-2xx, invalid JSON, wrong envelope, explicit failure, and empty payload—never overwrites a nonempty cache or hides last-good content. Cold cache produces an explicit retry/error state, not a false empty success.
- **Post-ship test:** fresh and cache-primed share links load Calendar and Samples through the above fault matrix, then refresh/reconnect. The test validates screen state and cache/readback, not only HTTP status.
- **Client sees mid-flight:** no content/control disappears. Before release, they see the existing behavior; after release, a transient outage keeps their prior content visible with an honest stale notice.
- **Who acts:** frontend merge; GitHub Pages release; deploy owner only if a server fallback contract changes.
- **Undo:** revert the reader code while the legacy endpoint remains live. Do not use an empty cache as a rollback mechanism.

### Gate D2 — replace every client writer failure fallback with a native durable receipt

- **What changes:** implement a provider-independent compatibility adapter/outbox for Calendar and Samples approval, status, tweak, plain note, linked/unlinked comment, and client collaborative Calendar creation. It accepts legacy cached payload shapes, performs idempotent native persistence, and gives the browser a durable receipt. It must preserve the frozen open writer posture.
- **Why it precedes cache retirement and operations shutdown:** routing failures currently choose legacy endpoints. Turning those endpoints off first creates the exact client-side action loss the project must avoid.
- **Gate:** under each one-at-a-time fault—flag REST timeout/5xx/malformed/missing value, Realtime failure, old cache, old bundle, and provider-blocked endpoint—each offered client action produces exactly one source/native receipt and survives reload/BFCache. No provider request is attempted.
- **Post-ship test:** scheduled private synthetic journeys use only the designated test scope and exercise client Calendar/Samples load, approve, tweak, note/comment, collaborative Calendar create, refresh, offline/reconnect, and page restore. Assert the visual result and server readback.
- **Client sees mid-flight:** nothing changes in controls, share URLs, or auth. During dual compatibility, an old page reaches the adapter rather than Linear; it either succeeds natively or shows a visible pending/retry state tied to the same action.
- **Who acts:** frontend and Edge Function changes land by merge; manual writer deploy owners fingerprint serving revisions. n8n is not edited unless its owner explicitly approves the same change window.
- **Undo:** route the adapter to its retained native compatibility implementation. Do not undo by re-gating a client writer or deleting browser-local debt.

### Gate D3 — close target/linkage debt and prove creation semantics

- **What changes:** privately classify every actionable half-linked component and live unlinked card into native target, source-only/reference disposition, or durable native exception. Modify creation/link workflows so a provider-shaped link cannot create a future native-target refusal. Preserve legacy IDs as provenance.
- **Why it precedes provider-free actions:** native status/comment adapters cannot safely choose a destination until every interactive component has one. Backlog repair alone is a treadmill while post-flip gaps are still being created.
- **Gate:** `calendar-native-link-gap-check --gate` is zero for post-flip actionable gaps; all other actionable gaps are zero or have an owner-reviewed native exception receipt; every live unlinked card is classified. The checker's total is monitored after every deploy.
- **Post-ship test:** staff and client use representative native, legacy-shaped, no-work/reference, and exception cards. Status/tweak/comment/create actions persist and read back without a provider request; Production creation remains closed.
- **Client sees mid-flight:** existing cards remain visible and actionable throughout. A card is never converted from a provider link to no target; dual identifiers remain until after the full retirement soak.
- **Who acts:** database owner for additive mapping/backfill; frontend/function owners for adapter/creation changes; staff workflow owner for adoption/link controls.
- **Undo:** disable the new reader/adapter while retaining mappings and exception receipts. Do not delete cards, links, comments, or mappings as rollback.

### Gate D4 — decouple public/staff creation and staff views

- **What changes:** replace provider project/team/state/assignee validation in public intake with native mappings; re-source Submit project selection, Calendar/Samples Create Post, Production labels, urgent-tweak assignee resolution, Calendar metadata, and Workload reads/writes/deep links to SyncLinear. Production continues to reject subissue creation.
- **Why it precedes trigger shutdown:** public intake calls provider resolution before native write today. Stopping the provider first can turn a client-facing Create Post into a pre-write failure.
- **Gate:** provider-blocked test-scope Submit and staff Create Post each creates one native work object and receipt, appears in the appropriate client/staff surface, and does not create a Production-tab subissue. Workload visibility check exits zero, native plan identities are mapped, and no interactive Workload deep link targets the provider.
- **Post-ship test:** staff opens Submit, Calendar, Samples, Workload, Production, Filming, and Kasper paths; client opens Calendar and Samples. Exercise create, edit, status, tweak, note, assignment/urgent notification where offered, plan day/due edit, refresh, and native deep link while provider traffic is blocked in the test environment.
- **Client sees mid-flight:** no client control moves or disappears. The client continues to use existing Create Post/review controls; only their durable backend destination changes after it is verified.
- **Who acts:** frontend/code merge, database migration owner, manual Edge Function deploy owner, and notification/integration owner. Any n8n modification remains owner-gated.
- **Undo:** switch only the native mapping/reader to its retained previous native-compatible version while the provider still exists. After provider revocation, rollback means restoring SyncLinear service from the Exit Archive, not reviving Linear.

### Gate D5 — archive history, comments, assets, and recovery state outside the provider

- **What changes:** produce a private final provider export and Exit Archive that cover active/archived/deleted work, hierarchy, statuses, labels, users, comments/replies/reactions/edit history, attachments/inline assets, external IDs, receipt/outbox state, mapping/rollback state, and workflow/admin configuration. Rehost/rescue every visible provider-hosted asset or record an explicit irreversible disposition.
- **Why it precedes credentials and subscription changes:** provider cancellation can make export, attachment rescue, and investigation unrecoverable. Existing backups and F42/F34 are useful components, not proof of comprehensive coverage.
- **Gate:** per-class count/hash manifests reconcile; every non-test intake/outbox/F27 item is terminal or explicitly classified; every comment/history record has a disposition; asset census has no unclassified host/type; an isolated restore retrieves representative material without provider egress.
- **Post-ship test:** authorized operator retrieves a historical issue/tree, comment/reply, status, attachment, receipt, and crosswalk from the private archive. Separately, a client share journey retrieves every asset class that the product still displays.
- **Client sees mid-flight:** nothing changes. Export and rescue are read-only/additive until a tested native/rehosted reader is already available.
- **Who acts:** provider administrator, database/archive owner, storage owner, and legal/retention owner. This is not merge-only work.
- **Undo:** exports and rescued copies are additive recovery artifacts. Provider account deletion/cancellation is not practically reversible; that action remains blocked until this gate is signed off.

### Gate D6 — replace monitoring before removing operational roots

- **What changes:** introduce native client synthetic, native receipt/age, projection freshness, provider-egress, asset/archive, and Workload/linkage monitors. Then replace or retire provider-dependent B1/reconcile/outbound/shadow/drill workflows, n8n paths, and qll dispatches as a coordinated operational change.
- **Why it precedes scheduler/webhook removal:** existing monitoring largely proves a heartbeat/job run, not that an unauthenticated client can still use the product. Removing old jobs first either creates intentional false alarms or removes the only signal before a replacement is proven.
- **Gate:** a deliberately failed test-scope client synthetic alerts the responsible owner; healthy synthetic proves load/approve/tweak/note/comment/create-plus-readback; provider-egress counter is zero except for the explicitly approved final export window; no active trigger-to-sink path reaches Linear.
- **Post-ship test:** run each scheduled replacement at least once, include failure-injection, and observe alert delivery. Re-run after a full schedule cycle and after a qll/manual-dispatch attempt. A passing dead-man alone is insufficient.
- **Client sees mid-flight:** nothing changes because their compatibility adapter/native writers were completed in D1-D4. Monitoring runs against the permitted test scope only.
- **Who acts:** repository/workflow owner, n8n owner with explicit same-window approval, monitoring/on-call owner. Do not edit n8n merely to satisfy this document.
- **Undo:** restore exported workflow versions while Linear is still available and the native monitors remain on. Do not let a source-exact rollback bundle reintroduce provider traffic after final revocation.

### Gate D7 — staged external shutdown and irreversibility control

- **What changes:** stop new provider outbox intent creation; adjudicate existing work; disable every inbound/outbound provider integration and staff provider creation path; update deploy/rollback bundles so routine recovery cannot revive provider code; then revoke credentials. Cancel/delete the provider workspace only after a post-revocation soak.
- **Why it is last:** credential removal before D1-D6 turns compatible fallback, export, rescue, and recovery failures into client-visible or irrecoverable loss.
- **Gate:** fresh and held-prior-bundle client journeys are green across the agreed cache horizon; zero provider egress spans scheduled, manual, cached, and fault paths; native freshness/receipt monitors are green; provider administrator confirms webhooks, automations, OAuth/API keys, integrations, browser extensions, and permissions are disabled; final archive delta is reconciled.
- **Post-ship test:** after each substep, rerun client/staff journeys and monitor all scheduled cycles. After revocation, validate the same products without credentials and watch for first-attempt egress or client 4xx/5xx/aged receipt alert.
- **Client sees mid-flight:** nothing changes. A fresh or stale page always reaches a provider-free reader/writer before any credential is touched; an internal delay never removes a client control or converts it to a provider error.
- **Who acts:** code/workflow owners, n8n owner, database/archive owner, deploy owner, and provider administrator. Credential revocation and account cancellation require explicit owner authorization in their own change window.
- **Undo:** before credential revocation, restore native-compatible adapters/configuration and exported workflow versions. After revocation, recovery is the tested SyncLinear/archive plan; after workspace cancellation, provider recovery is not a dependable rollback.

## Watchers that must exist before cutover

| Watcher | What it proves | Alert condition and route | New infrastructure? |
| --- | --- | --- | --- |
| Unauthenticated client synthetic | The actual share-link contract loads content and persists each offered client action through refresh/readback. | Any non-2xx, missing native receipt/readback, stale projection, or unexpected empty board pages the owner immediately. | Can start in existing Actions, but needs a private fixture and authoritative result. |
| Fault-routing synthetic | Flag/Realtime/read failures and a held prior bundle still use a native compatibility receiver, once. | Any legacy endpoint/provider request, duplicate receipt, browser-local-only success, or lost BFCache/reconnect action alerts. | Requires test harness/aggregate receipt query. |
| Samples content-integrity monitor | No fallback response has replaced known content with a false empty success. | Empty cache write after fallback, bad envelope accepted, or a content-bearing test row rendered empty alerts. | Small code metric plus test; no client data in alert. |
| Native receipt/outbox monitor | Accepted actions have durable terminal/native state and no provider-bound work accumulates. | Missing receipt, pending-age breach, failed terminal state, or any new provider-bound row alerts. | Add aggregate query/metric. |
| Native freshness/visibility monitor | Calendar, Samples, and Workload show source changes promptly and Workload does not hide live work. | Stale age breach, nonzero linkage post-flip count, or nonzero Workload gate result alerts. | Existing read-only scripts can be scheduled; freshness needs an aggregate source/projection comparison. |
| Provider-egress census | No browser, Edge Function, GitHub workflow, n8n execution, or outbox transition reaches Linear after its cutoff. | First unexpected request/execution/transition alerts with route/category/time only. | Mostly existing logs/source scans; n8n export/telemetry access needed. |
| Archive/asset recovery monitor | Private recovery remains retrievable after provider loss. | Manifest hash/count mismatch, unclassified asset, unresolved visible asset, or restore/retrieval failure alerts. | Private scheduled check/storage access. |
| Alert-delivery drill | A monitor actually reaches a human. | A deliberately failed test-scope synthetic must produce a verified notification; failure blocks the next gate. | No new platform if existing failed-run notifications reach the responsible owner; that coverage is currently **UNPROVEN**. |

## Cosmetic, documentation, and human-work sweep extended

Do this only after D1-D7 have passed. A string scan is not proof, but it supplies the inventory for reachable UI testing.

- **Client-visible:** all Calendar/Samples/Submit copy; empty, stale, retry, pending, and success messages; status/tweak/comment help; deep links; tooltips; attachment placeholders; cached-page update notices; and any provider-named remedy. The client must never be asked to open, wait for, or contact Linear.
- **Staff-visible:** Workload provider deep links and refresh/fallback instructions; Calendar/Samples link/adoption/subissue controls; Submit/Create success/failure copy; Production label/error messages; archive placeholders; Kasper/editor/tweak assignment wording; runbooks and manual remediation links.
- **Operational:** GitHub workflow names/descriptions/dispatch inputs, n8n workflow labels, monitoring ownership, deploy/rollback bundles, secrets/variables, provider-admin webhooks/automations/integrations, browser bookmarks/extensions, Slack/email notification recipients, and billing/retention/access ownership.

The human-work inventory is a separate acceptance exercise. Code cannot prove that staff do not create or search provider work manually, rely on a browser extension, receive a provider notification, or follow an off-repository runbook. These are **UNPROVEN** until an owner-admin and role-by-role review records the replacement or retirement of each practice.

## Irreversible boundaries added by this audit

1. Provider asset access may be needed to rescue historical files; account cancellation can make those bytes unavailable.
2. A provider-only comment, reply, audit event, or hierarchy relation cannot be reconstructed from an outbox count alone.
3. Clearing browser-local queues cannot prove client intent was delivered and would discard the only copy for an old tab. It is prohibited as a cutover shortcut.
4. A generic rollback/deploy bundle that restores provider code is not a rollback after credentials are gone. Update it before irrevocable shutdown.
5. Credential revocation may be operationally reversible only while the account and export window remain intact; workspace cancellation/deletion is the final, practically irreversible act.

## Decision rule

The successful end state is not "zero Linear strings" or "SyncLinear authority enabled." It is this: with Linear unavailable, a fresh or stale client share page can still see content, approve, request changes, and write every offered note/comment; every action has a durable native result or visible native recovery; staff have working native operational views; history/assets are retrievable; and any silent regression alerts a human before a client has to discover it.

Until the gates above have independent evidence, the correct status is **not ready for Linear shutdown**.
