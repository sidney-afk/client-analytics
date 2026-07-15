# Samples Old: Phase-1 retirement and Phase-2 removal map

Status: Phase 1 implemented on this branch. The navigation entry is hidden and
legacy routes resolve to Samples New. No legacy renderer, browser state,
endpoint, workflow, table, or row is deleted or changed.

> **CLIENT-LINK BLOCKER (F117; verified 2026-07-14).** Phase 1 is safe only for staff hashes. A
> tokened legacy client link verifies its named client, then the redirect discards that binding and
> mounts generic Samples New from browser pins/preferences, including **Add client**, while client
> actions remain enabled. Do not call the legacy client portal intact, delete the old renderer, or
> approve Phase 2 until the old URL fails closed or reaches an exact-client server-bound portal.

This document is public-safe. It intentionally contains no client names,
credentials, private workflow identifiers, or live row data. Line references
are to the Phase-1 branch version of the repository.

## Classification key

- **legacy-only — safe to delete:** used only by Samples Old. Delete only in the
  later Phase-2 frontend cleanup.
- **shared — must keep:** used by Samples New (SXR), Calendar, another tab, or
  repository recovery/audit processes. Do not delete with the legacy module.
- **owner-decision:** compatibility or operational state whose retirement needs
  an explicit owner checkpoint.

## Phase-1 behavior shipped here

| Item | Classification | Source | Phase-1 disposition |
| --- | --- | --- | --- |
| `#navSamples` / “Samples Old” button | legacy-only — safe to delete | Removed from `index.html` between the Calendar and SXR nav entries; SXR remains at `index.html:6524-6528` | Removed from markup. A one-commit revert restores it. |
| `#samples`, `#samples/<client>`, and `#samples/<client>/<card>` | owner-decision | Boot rewrite at `index.html:109-113`; runtime resolver `_resolveRetiredSamplesRoute` and `navTo` hook at `index.html:15160-15175` | Staff hashes resolve to `#sample-reviews`; no old view mounts. This is not proof for tokened client URLs (F117). Keep only after staff/client routing tests and an owner sunset decision. |
| Restored `syncview_nav=samples` state | owner-decision | `FAST`/saved-nav prediction at `index.html:89-120`; app `FAST_TABS`/restore path at `index.html:30422-30423` and `index.html:33818-33831` | Still recognized so old browser state reaches `navTo`, then resolves to Samples New. |
| `navTo('samples')` calls | legacy-only — safe to delete, except the resolver | Existing callers remain at `index.html:33961`, `index.html:34100`, and `index.html:34261`; resolver at `index.html:15160-15175` | Callers are harmless and dormant because the resolver runs before `currentNav` is assigned. Delete callers in Phase 2; retain the resolver for bookmark compatibility. |
| SXR / “Samples New” nav and renderer | shared — must keep | `#navSxr` at `index.html:6524-6528`; route/mount at `index.html:15210`, `index.html:15300-15305`; SXR module begins at `index.html:34440` | Untouched. |
| Retirement guard | shared — must keep | `test/samples-legacy-retirement.js:1-50`; live gating assertion at `qa/probes/sxr_gating_flags.js:81-96` | Pins absent old nav, redirect behavior, unaffected tabs, dormant old code, and intact SXR. |

## Complete frontend inventory

### Navigation and routing

| Piece | Classification | Source | Phase-2 action |
| --- | --- | --- | --- |
| Pre-paint `FAST` entry for `samples` and its target rewrite | owner-decision | `index.html:89-113` | Keep recognition + rewrite while old bookmarks or saved state may exist. Later removal is an owner decision. |
| Old boot-nav selectors and old boot skeleton | legacy-only — safe to delete | `index.html:1747`, `index.html:1900`, `index.html:6730-6738` | Delete after the route always predicts `sample-reviews`. Keep shared boot skeleton primitives and the SXR review skeleton. |
| `navSamples` active-state lookup | legacy-only — safe to delete | `index.html:15202-15203` | Delete. The element no longer exists. |
| `currentNav === 'samples'` / `page === 'samples'` branch | legacy-only — safe to delete | Legacy cleanup checks at `index.html:15236-15238`; render/mount branch at `index.html:15307-15311` | Delete only with the full `_sm*` module. Keep `currentNav`, which is global shared router state (`index.html:11670-11675`). |
| Initial `#samples/<...>` deep-link focus parser | legacy-only — safe to delete | `index.html:33825-33829`, `index.html:34093-34100` | Delete the old focus parsing; keep the top-level compatibility redirect. |
| Popstate `#samples/<...>` focus parser | legacy-only — safe to delete | `index.html:34254-34261` | Delete the old focus parsing; let the resolver continue to redirect. |
| Legacy client portal `?c=...&v=samples&t=...` | owner-decision — **currently broken (F117)** | Detection/loading at `index.html:33854-33863`; token gate/mount handoff at `index.html:33924-33964`; retirement resolver and generic SXR mount | Current code verifies the old link's client/token, then loses the client binding and uses generic SXR pins/preferences. Fail closed or implement a server-bound exact-client handoff into the dedicated client mount; remove Add-client/client switching, clear residual selection, and test every old-link/fresh/residual/cross-client/mobile/second-device case before deleting the old block. |
| Global `NAV_KEY`, history, router, and other tab branches | shared — must keep | `index.html:11671-11675`, `index.html:15165-15338` | Keep. Remove only Samples Old-specific conditions. |

### Legacy UI, state, and helpers

| Piece | Classification | Source | Phase-2 action |
| --- | --- | --- | --- |
| Samples Old CSS (`.samples-view`, `.sm-*`, modal, responsive rules) | legacy-only — safe to delete | `index.html:5936-6192` | Delete the legacy CSS block. Do not delete the shared mobile header rules beginning at `index.html:6193` or SXR styles beginning at `index.html:6228`. |
| Constants, state, and basic `_sm*` helpers | legacy-only — safe to delete | `index.html:14190-14356` | Delete `SAMPLES_*`, `SM_*`, `smState`, `_smLinkClient`, `_smFocusRequest`, timers, normalization, approval, media, and legacy UI helpers. |
| Preference/cache/seen helpers | legacy-only — safe to delete | `index.html:14357-14379` | Delete code. Existing browser keys may be left orphaned; clearing them is an owner decision because it is not required for functional retirement. |
| Supabase-v2 flag, REST/realtime client, subscription, and teardown | legacy-only — safe to delete | `index.html:14401-14553` | Delete `_smV2*` code, diagnostics, and the `content_samples` subscription. Do not delete the shared Supabase loader/configuration it calls. |
| `renderSamplesView`, `mountSamplesView`, loader, initial load | legacy-only — safe to delete | `index.html:14574-14653` | Delete. |
| Tabs, client picker, shell, URL sync, and body/card renderers | legacy-only — safe to delete | `index.html:14656-14888` | Delete `_smApplyFocus`, `_smRenderShell`, tab/search functions, `_smSyncUrl`, `_smRenderBody`, `_smRenderCard`, and `_smMediaHtml`. |
| Editing, archive, drag/reorder, saves, and save indicator adapter | legacy-only — safe to delete | `index.html:14889-15011` | Delete old handlers and writes. Keep the shared `_svSaveIndHtml`/`_svSaveIndApply` implementation used by Calendar and SXR. |
| Notes/comments modal and approval actions | legacy-only — safe to delete | `index.html:15012-15135` | Delete `_sm*` modal state/render/submit/delete functions. |
| Mode, card-link, and share-link helpers | legacy-only — safe to delete | `index.html:15136-15155` | Delete after the owner approves sunset/redirect behavior for old shared links. |

### Browser state and cache keys

| Key | Classification | Source | Notes |
| --- | --- | --- | --- |
| `syncview_samplesCache_v1:<slug>` | legacy-only — safe to delete | `SM_CACHE_PREFIX`, `index.html:14198`; read/write/eviction at `index.html:14359-14375` | Per-client old-card cache. Not SXR data. |
| `syncview_samples_prefs_v1` | legacy-only — safe to delete | `SM_PREFS_KEY`, `index.html:14199`; read/write at `index.html:14357-14358` | Old selected client/kind preference. |
| `syncview_samplesSeen_v1` | legacy-only — safe to delete | `SM_SEEN_KEY`, `index.html:14200`; read/write at `index.html:14378-14379` | Old comment seen markers. |
| `syncview_samples_v2` | legacy-only — safe to delete | `SM_V2_LS_KEY`, `index.html:14207`; writes at `index.html:14427-14428` | Old `content_samples` direct-read opt-in remnant. |
| `syncview_samples_v2_off` | legacy-only — safe to delete | `SM_V2_KILL_KEY`, `index.html:14208`; reads/writes at `index.html:14427-14429` | Old direct-read kill switch. |
| `syncview_nav` | shared — must keep | `NAV_KEY`, `index.html:11671`; router writes at `index.html:15183-15188` | Shared last-tab state. Only its legacy value needs redirect compatibility. |
| SXR keys such as `syncview_sxr_on`, `syncview_sxr_off`, SXR cache/outbox/seen keys | shared — must keep | SXR constants begin at `index.html:34469` and `index.html:34497-34499` | Belong to Samples New, not Samples Old. |

### Shared dependencies called by Samples Old — do not delete

The old module calls shared utilities rather than owning them. Removing the
call sites is safe; removing the implementations is not.

| Shared dependency | Classification | Legacy call sites | Other owner |
| --- | --- | --- | --- |
| `CAL_SUPABASE_URL`, `CAL_SUPABASE_ANON_KEY`, shared Supabase loader | shared — must keep | `index.html:14435-14464` | Calendar and SXR REST/realtime. |
| `_svLoadingSkeletonHtml` | shared — must keep | `index.html:14575` | App-wide loading surfaces, including SXR. |
| `_calGetPins` and the shared client roster/canonicalization (`wlNormalizeClient`, `wlCanonicalClient`, `wlIsAllowedClient`) | shared — must keep | `index.html:14221`, `index.html:14580`, `index.html:14691`, `index.html:14708`, `index.html:14731-14746` | Calendar, Templates, Workload, SXR, and other client-scoped views. |
| `_isClientLink`, `clientMap`, client-link access verification | shared — must keep | `index.html:14227-14229`, `index.html:14581`, `index.html:14666`, `index.html:15148` plus the entry router | Calendar and SXR client portals. |
| `_svSaveIndHtml`, `_svSaveIndApply` | shared — must keep | `index.html:14852`, `index.html:14986-14989` | Calendar and SXR save status. |
| Global theme/status CSS variables and shared mobile header rules | shared — must keep | Referenced throughout `index.html:5936-6192`; shared rules begin at `index.html:6193` | All tabs. Delete selectors, not variables. |
| Entire SXR module (`SXR_*`, `sxrState`, `_sxr*`, render/mount/client/Kasper surfaces) | shared — must keep | `index.html:34440-38353`; main entry points at `index.html:34742-34746` and `index.html:37349` | Samples New. This is the replacement, not part of the deletion target. |

## Endpoints, workflows, and data

| Piece | Classification | Source | Phase-1 state | Phase-2 disposition |
| --- | --- | --- | --- | --- |
| `SAMPLES_GET_URL` → `webhook/samples-get` | owner-decision | `index.html:14190`; fallback reads at `index.html:14474` and `index.html:14625` | Unchanged. | Disable workflow after frontend deletion and a no-traffic checkpoint; do not delete it. |
| `SAMPLES_UPSERT_URL` → `webhook/samples-upsert` | owner-decision | `index.html:14191`; archive/save writes at `index.html:14943` and `index.html:15002` | Unchanged. | Disable workflow; do not delete. |
| `SAMPLES_REORDER_URL` → `webhook/samples-reorder` | owner-decision | `index.html:14192`; write at `index.html:14974` | Unchanged. | Disable workflow; do not delete. |
| `public.content_samples` | owner-decision | Browser REST/realtime at `index.html:14461` and `index.html:14502`; current-system map at `docs/independence/SYSTEM_MAP.md:332-355` | No schema, policy, publication, or row changes. | Archive in place: keep all rows and service-role backup access, stop browser reads/realtime only after workflows are disabled. |
| SXR `sample_reviews` / `sample_review_events` and `sample-review-*` endpoints | shared — must keep | SXR table/endpoints at `index.html:34461-34468`; system map at `docs/independence/SYSTEM_MAP.md:297-331` | Untouched. | Never include in legacy cleanup. |

Historical and recovery records are **shared — must keep**, even after the live
legacy surface is removed:

- `migrations/samples-supabase-migration.sql:10-51` defines and seeds the
  historical table; do not rewrite or delete applied migrations.
- `migrations/live-schema-baseline-2026-07-03.sql:130`, `:326`, `:386`,
  `:408`, `:623`, and `:643` record the recovered live schema.
- `n8n-backups/syncview-weekly-backup.2026-07-02.pre-onboarding-tables.json:15-16`
  and `:108-122` record backup coverage. Keep backup history; confirm the live
  backup continues to read the archived table through a non-browser role.
- `docs/truth/ENDPOINTS.md:21,96`, `docs/independence/SYSTEM_MAP.md:332-355`,
  and the mirrored `docs/CLIENT_LIFECYCLE_MAP.md:314-324,603-607` must be
  updated in Phase 2 to describe “archived,” not deleted. The lifecycle map's
  mirror contract must be followed then.

## Old-to-new migration machinery

These files describe or operate Samples New. Their names contain “Samples,” but
they are not disposable legacy-old code.

| Artifact | Classification | Source | Decision |
| --- | --- | --- | --- |
| `SAMPLES_REBUILD_SPEC.md` | shared — keep as historical build contract | `docs/features/SAMPLES_REBUILD_SPEC.md` | Surface/exclusion evidence only; default-OFF and n8n topology claims are superseded by its F46/F73 banner. |
| `SAMPLES_REBUILD_STRATEGY.md` | shared — keep as historical execution record | `docs/features/SAMPLES_REBUILD_STRATEGY.md` | Namespace/copy-discipline evidence only; not current flag/topology guidance. |
| `SAMPLES_GO_LIVE.md` | shared — keep as historical rollout record | `docs/features/SAMPLES_GO_LIVE.md` | Do not execute its old default-OFF, workflow, or fallback instructions; current controls are linked in its banner. |
| `SAMPLES_PARITY_LOG.md` | shared — keep append-only | `docs/features/SAMPLES_PARITY_LOG.md` | Historical Calendar ↔ SXR build registry; old “embedded + live” and default-OFF rows do not override current state. |
| SXR fences and aliases | shared — must keep | `index.html:34440-34518`; shared aliases specifically at `index.html:34482-34491` | Do not delete any `_sxr*`, `SXR_*`, `#sample-reviews`, `navSxr`, or `sample-review-*` item. |

## Test inventory

| Test | Classification | Phase-2 action |
| --- | --- | --- |
| `test/samples-legacy-retirement.js:1-50` | shared — must keep | After frontend deletion, change “dormant legacy renderer/endpoints remain” assertions to “legacy renderer/endpoints absent”; retain redirect and SXR/other-tab guards. |
| `qa/probes/sxr_gating_flags.js:81-114` | shared — must keep | Retain the absent-old-nav assertion and all SXR flag isolation checks. |
| `test/save-indicator-rollout.js:58-67` old `_smSetSaving` section | legacy-only — safe to delete | Delete only the Samples Old subsection; retain shared save-indicator, Calendar, and SXR checks. |
| SXR suites (`test/samples-realtime-status-propagation.js`, `test/samples-input-scroll-polish.js`, `test/sxr-*`, SXR QA probes) | shared — must keep | Names refer to Samples New/SXR; do not delete based on the word “samples.” |

## Phase-2 plan — only on the owner's word

Phase 2 must be a separate change set and must start by rechecking current
frontend references and recent endpoint traffic. Do not infer approval from the
merge of Phase 1.

1. **Delete frontend legacy-only code.** Delete the exact legacy-only ranges in
   this map: old CSS and skeleton, `_sm*` module/state/caches, old route focus
   parsers, old client-portal implementation, `SAMPLES_*` constants/calls, and
   stale old-only test sections. Keep the compatibility redirect, SXR, shared
   utilities, migrations, backup history, and data. Run focused retirement/SXR
   tests, `npm test`, and `npm run test:prod-polish`.

   One-command rollback: `git revert <phase-2-frontend-commit>`.

2. **Disable, do not delete, the three `samples-*` workflows.** Snapshot the
   current workflows privately, verify no accepted legacy traffic after the
   frontend bake window, then deactivate get/upsert/reorder. Store workflow IDs
   only in the private deployment environment. **There is no bulk blind-activation rollback.**
   Before restoring each workflow, read back and compare its exact approved graph/active version,
   trigger, credential bindings, error handler, and last-green contract; exclude duplicate active
   callers/cadences; obtain owner approval; activate one workflow; then verify activation plus its
   first green request before considering the next. Stop on any mismatch. Validate the exact API
   route against the installed n8n version and keep IDs/credentials private (F60/F63).

3. **Archive `content_samples` without deleting rows.** After workflow disable
   and a verified backup, remove the table from browser realtime and revoke
   browser-role SELECT while retaining the table, rows, service-role access, and
   backup coverage. Use one transaction so apply and rollback are atomic.

   One-command rollback shape:

   ```powershell
   psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -c "BEGIN; GRANT SELECT ON TABLE public.content_samples TO anon; ALTER PUBLICATION supabase_realtime ADD TABLE public.content_samples; COMMIT;"
   ```

   Before applying the archive transaction, confirm publication membership and
   grants so the inverse command exactly matches live state.

4. **Update current-state documentation.** Mark Samples Old archived in truth,
   system, endpoint, rollback, and lifecycle maps; preserve applied migrations
   and dated audit/backup artifacts. Follow the cross-repository mirror rule for
   `docs/CLIENT_LIFECYCLE_MAP.md`.

Each operational step gets its own checkpoint and rollback proof. No step drops
the table, deletes rows, deletes a workflow, or changes Samples New.

## Phase-1 acceptance checklist

- [x] “Samples Old” is absent from the staff navigation.
- [x] `#samples` and legacy subpaths resolve to `#sample-reviews` without
  mounting `renderSamplesView`/`mountSamplesView`.
- [x] Samples New (`navSxr`, `#sample-reviews`, SXR state/endpoints) is unchanged.
- [x] Every non-Samples route is returned unchanged by the retirement resolver.
- [x] Legacy frontend/backend code and `content_samples` remain intact.
- [x] Focused retirement and boot-parity guards pass.
- [ ] A tokened `v=samples` link stays bound to exactly its verified client across fresh/residual
      state, refresh/back, mobile and second device, with all cross-client reads/writes denied
      server-side (F117).
- [ ] Owner explicitly authorizes Phase 2.
