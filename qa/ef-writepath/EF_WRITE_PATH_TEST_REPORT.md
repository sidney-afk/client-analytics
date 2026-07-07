# SyncView Edge-Function (EF) Write-Path — End-to-End Test Report

**Scope:** Validate the new Supabase Edge-Function write path end-to-end on ONE test
client (`sidneylaruel`) so the owner can decide whether to move all clients onto it.
**Method:** Repeatable headless Playwright harness driving the REAL UI against the REAL
backend, with outbound network captured to prove routing by URL; Supabase rows read back
via anon RLS; Linear round-trips verified via the Linear API and reverted.

> Test client only. No writes to any real client. Linear mutations limited to the test
> client's own linked test issues, recorded and reverted. No secrets/real-client content
> committed.

---

## Phase 0 — Architecture map (from source)

Two INDEPENDENT pipes fire when a card changes:

- **PIPE A — the flag (EF vs n8n).** Calendar/samples/settings writes route to Supabase
  Edge Functions when the client is in the runtime flag, else fall back to the old n8n
  webhooks. The routing decision is **fully encapsulated inside the fetch helper**
  (`_calUpsertFetch` → `_calUpsertUrlForClient` → `_calUpsertUseEf`); callers are routing-agnostic.
- **PIPE B — Linear sync (always n8n, NOT gated by the flag).** After a write lands,
  status/comment changes push to the n8n `linear-set-status` / `linear-add-comment`
  webhooks (`_calPushStatusToLinear` / `_calPostLinearComment`), which update the linked
  Linear ISSUE. On failure the payload is queued in the `_linearOutbox` for retry.
  Per-component routing: `video_status` → `linear_issue_id` (VID issue),
  `graphic_status` → `graphic_linear_issue_id` (GRA issue). Caption/title have no Linear.

### #1 RISK — does the EF path still fire PIPE B? (source verdict: YES, it does)

The Linear push sits on the **shared path AFTER** the EF-vs-n8n branch, and the branch is
hidden inside the fetch helper, so flagging a client to EF cannot skip the enqueue. Evidence
(`index.html`):

| Path | Routed write (Pipe A) | Linear push (Pipe B), same code path |
|---|---|---|
| Single-card save (caption/status/date/links) | `_calUpsertFetch(...)` @22482 | `_calPushStatusToLinear` @22581-22588 (video→`linear_issue_id`, graphic→`graphic_linear_issue_id`) |
| Kasper batch approve | `_calUpsertFetch(...)` @39397 | `_calPushStatusToLinear` @39423-39424 |
| Review change-request | `_calFlushCardSave` (→`_calUpsertFetch`) @25499 | `_calPostLinearComment` @25501 |
| Notes-modal comment | routed save | `_calPostLinearComment` @26395 (video/graphic only) |
| Samples save | `_sxrUpsertFetch(...)` @32431 | `_sxrPushStatusToLinear` @32467-32468 |

The only way EF could skip Pipe B is if the EF write THREW before reaching the push
(`if (!resp.ok) throw` @22485; `if (!json.ok) throw` @22487). The EF returns the SAME
success shape n8n returned — `{ ok: true, post: {...} }` (calendar-upsert
`supabase/functions/calendar-upsert/index.ts:450`) / `{ ok: true, sample: {...} }`
(sample-review-upsert) — so on success it does not throw and the push is reached.
**This is confirmed live in Phase 1/2 below.**

### Routing constants & flag (index.html)

- `CALENDAR_UPSERT_EF_URL = …/functions/v1/calendar-upsert` (@15022); n8n fallback
  `CALENDAR_UPSERT_N8N_URL = …/webhook/calendar-upsert-post` (@15020).
- `CALENDAR_REORDER_EF_URL = …/functions/v1/calendar-reorder` (@15026); n8n
  `CALENDAR_REORDER_BATCH_URL` (@15030).
- `SXR_UPSERT_EF_URL = …/functions/v1/sample-review-upsert` (@30582); `SXR_REORDER_EF_URL`
  (@30585).
- Settings/templates route via `_settingsWriteUrlForClient(slug, efUrl, n8nUrl)` (@15241).
- Flag table read once + realtime-subscribed: `syncview_runtime_flags` keyed by
  `calendar_upsert_ef_clients` / `sample_review_ef_clients` / `settings_ef_clients`.
- `_calUpsertUseEf(slug)` @15155 returns `slug && _calUpsertEfClients.has(slug)`; empty/error
  flag ⇒ `false` ⇒ n8n (fail-safe).

### Interaction → routing → column → Linear map (to be exercised live)

| # | UI interaction | EF endpoint (flagged) | Supabase column(s) written (table `calendar_posts`/`sample_reviews`) | Pipe-B Linear? → issue | Frontend surface |
|---|---|---|---|---|---|
| 1 | Caption edit (blur) | calendar-upsert | `caption`, `updated_at` | none | card caption |
| 2 | video_status flip | calendar-upsert | `video_status`, `status`, `updated_at` | yes → `linear_issue_id` (VID) | video status pill |
| 3 | graphic_status flip | calendar-upsert | `graphic_status`, `status`, `updated_at` | yes → `graphic_linear_issue_id` (GRA) | graphic status pill |
| 4 | caption_status flip | calendar-upsert | `caption_status`, `status`, `updated_at` | none | caption status pill |
| 5 | title_status flip | calendar-upsert | `title_status`, `status`, `updated_at` | none | title status pill |
| 6 | reorder / drag | calendar-reorder | `order_index`, `updated_at` (existing rows only) | none | card order |
| 7 | add card | calendar-upsert (insert) | new row (id + content) | none (until linked/status) | new card |
| 8 | remove/archive card | calendar-upsert | `status='Archived'`, `updated_at` | none | card leaves board |
| 9 | Samples approve | sample-review-upsert | component `*_status` → next state, `status` | yes if linked → per component | review queue |
| 10 | Samples request-tweak | sample-review-upsert | `*_status='Tweaks Needed'`, `*_tweaks` | comment → per component | review card |
| 11 | Samples add comment | sample-review-upsert | `*_tweaks` (merged via RPC) | comment (video/graphic) | comment thread |
| 12 | Settings / caption-template save | settings/templates-save EF | (settings store / CaptionPrompts) | none | settings modal |

Reorder EF writes `order_index`+`updated_at` for EXISTING rows only and returns
`{ ok:true, updated }` (no echo, no Linear) — `supabase/functions/calendar-reorder/index.ts`.

### calendar-upsert EF column parity (ALLOWED list)

`supabase/functions/calendar-upsert/index.ts:24-36` ALLOWED includes all live columns:
`order_index, scheduled_date, name, asset_url, thumbnail_url, caption, caption_alt,
caption_alt_platform, post_url, cta, tweaks, status, linear_issue_id, video_deliverable_id,
kasper_approved_at, posted_at, platform, platforms, color, video_status, graphic_status,
caption_status, graphic_linear_issue_id, graphic_deliverable_id, video_tweaks,
graphic_tweaks, caption_tweaks, client_video_approved_at, client_graphic_approved_at,
client_caption_approved_at, title_status, title_tweaks, client_title_approved_at,
kasper_seen, kasper_approved_after_tweaks, thumb_rev, kasper_finished_at, kasper_closed_at,
kasper_finish_log`. Guard gauntlet preserved: phantom-row guard, link-clobber guard,
duplicate-link guard, scalar-conflict guard, comment 3-way merge (`calendar_merge_comments`
RPC), plus a best-effort `calendar_post_events` ledger. (Column drift vs n8n verified
separately — see Phase 1b.)

### Live pre-conditions confirmed (read-only)

- `sidneylaruel` is present in ALL THREE EF flags (`calendar_upsert_ef_clients`,
  `sample_review_ef_clients`, `settings_ef_clients`). Five other (real) clients are also
  already flagged — i.e. the EF path is already live in production for them; strictly
  read-only on those here.
- Test fixtures (`calendar_posts`, `client=sidneylaruel`):
  - **TEST 2** `p_mqjznt6m_h4k9o` — video=`Tweaks Needed`, graphic=`Approved`,
    caption=`Approved`, title=`Approved`; linked VID-12612 (video) + GRA-6310 (graphic).
    Card and Linear currently in sync. Primary dual-component fixture.
  - **TEST 1** `p_mqjzlp3t_yk13m`, **TEST 3** `p_mqjzobk2_xnw24` — distinct linked issues.
- Linear test issues (test client's own project): VID-12612 baseline `Tweak Needed `,
  GRA-6310 baseline `Approved`. Both created by the test client's owner under the test
  client's Linear project. Recorded for revert.

---

## Phase 1c + Phase 2 — per-component status flip round-trip (RESULT: PASS)

Harness `qa/ef-writepath/10-status-linear.js`, driven via the real SMM status control
(`_calStatusPick`, the exact fn the pill-menu item's onclick invokes) on TEST 2
(`p_mqjznt6m_h4k9o`), 32/32 assertions green in the forwarded-to-live-n8n run.

| Flip | Routing (captured) | Supabase column | Pipe-B push (captured) | Linear issue moved (API-verified) |
|---|---|---|---|---|
| video → In Progress | `cal-ef` ×1, `cal-n8n` ×0 | `video_status=In Progress` | 1× `linear-set-status` issue=VID-12612 status="In Progress" | VID-12612 `Tweak Needed → Todo` @17:59:43; **GRA-6310 unchanged** |
| video → Tweaks Needed (revert) | `cal-ef` ×1, ×0 | `video_status=Tweaks Needed` | 1× VID-12612 "Tweaks Needed" | VID-12612 `Todo → Tweak Needed ` @17:59:56 (baseline) |
| graphic → In Progress | `cal-ef` ×1, ×0 | `graphic_status=In Progress` | 1× `linear-set-status` issue=GRA-6310 status="In Progress" | GRA-6310 `Approved → Todo` @18:00:08; **VID-12612 unchanged** |
| graphic → Approved (revert) | `cal-ef` ×1, ×0 | `graphic_status=Approved` | 1× GRA-6310 "Approved" | GRA-6310 `Todo → Approved` @18:00:21 (baseline) |

**#1 RISK — RESOLVED (live, end-to-end):** an EF-routed card write STILL enqueues Pipe B.
Every status flip routed to `…/functions/v1/calendar-upsert` (zero n8n `calendar-upsert-post`)
**and** fired exactly one `linear-set-status` push to n8n, on the shared post-write path.

**Phase 2 — dual-component correctness — PASS (confirmed at Linear, not just the FE push):**
a `video_status` change moved ONLY VID-12612 (GRA-6310 untouched); a `graphic_status`
change moved ONLY GRA-6310 (VID-12612 untouched). Component isolation holds through the EF
write, the FE push routing, AND the real n8n→Linear leg.

**Linear issues touched (test client's own; dummy ids) — all reverted:**
- VID-12612 (Video): baseline `Tweak Needed ` → `Todo` → **`Tweak Needed ` (reverted ✓)**.
- GRA-6310 (Graphics): baseline `Approved` → `Todo` → **`Approved` (reverted ✓)**.
(Both verified via Linear API stateHistory; final states equal the recorded baselines. The
FE-side dry run additionally proved the same routing/enqueue with Linear MOCKED — zero
mutation — so the FE conclusion does not depend on the live leg.)

**Observed mapping (n8n `linear-set-status`, shared Pipe B):** SyncView "In Progress" →
Linear "Todo"; "Tweaks Needed" → Video "Tweak Needed "; "Approved" → "Approved". This mapping
is identical for EF and n8n clients (Pipe B is not EF-gated), so it carries no migration risk.

---

## Phase 1 — calendar (non-status) write interactions (RESULT: PASS)

Harness `qa/ef-writepath/11-calendar-writes.js`, real SMM UI handlers, 21/21 green. A fresh
disposable card (unique name) was created and archived; TEST 3 flips were reverted.

| Interaction | Driver (real UI path) | Routing (captured) | Supabase | Linear |
|---|---|---|---|---|
| Add card | `addCalBlankCard` → type name+caption → blur (`_calOnFieldBlur`/`_calOnCaptionBlur`) | `cal-ef`, no `cal-n8n` | new row persisted (real id) | none |
| Caption edit | field blur → `_calFlushCardSave` | `cal-ef` only | `caption` updated | none |
| caption_status flip (linked TEST 3) | `_calStatusPick` | `cal-ef` only | `caption_status` | **0 pushes (no leak)** |
| title_status flip (linked TEST 3) | `_calStatusPick` | `cal-ef` only | `title_status` | **0 pushes (no leak)** |
| Reorder | `persistCalReorder` | `cal-reorder-ef` only | `order_index` | none |
| Persist | hard reload (fresh page) | — | card + caption survive reload | — |
| Archive/remove | `archiveCalPost` → confirm-modal `#confirmYes` | `cal-ef` only | `status='Archived'` | none |

Caption & title status changes on a Linear-LINKED card fire ZERO Linear pushes — confirming
the video/graphic-only gating; no caption/title leak onto any issue.

## Phase 1 — SAMPLES (sxr) write interactions (RESULT: PASS)

Harness `qa/ef-writepath/12-samples.js`, real SMM samples UI, 35/35 green (forwarded run).
Fixture: Sample 1 `sr_mqvenh27_jp85b` (video `Approved`→VID-12728, graphic `Approved`→GRA-6496).

| Interaction | Routing (captured) | Supabase | Linear (API-verified) |
|---|---|---|---|
| video_status flip | `sxr-ef`, no `sxr-n8n` | `video_status` | VID-12728 `Approved→Todo→Approved`; GRA-6496 untouched |
| graphic_status flip | `sxr-ef` only | `graphic_status` | GRA-6496 `Approved→Todo→Approved`; VID-12728 untouched |
| Reorder | `sxr-reorder-ef` only | `order_index` | none |
| Add card | `sxr-ef` only | new row | none |
| Archive | `sxr-ef` only (confirm-modal) | `status='Archived'` | none |

The samples EF write path (`_sxrUpsertFetch` → sample-review-upsert EF) STILL fires Pipe B
(`_sxrPushStatusToLinear`) to the correct per-component issue — same result as calendar.

**Samples Linear issues touched (test client's own; dummy ids) — all reverted:** VID-12728
`Approved`→(Todo)→`Approved` ✓; GRA-6496 `Approved`→(Todo)→`Approved` ✓ (Linear-API verified).

---

## Phase 1b — column drift & duplicate-link check (READ-ONLY, all 6 flagged clients) — PASS

Harness `qa/ef-writepath/21-drift-check.js`. For every flagged client (the test client + the
5 production clients already on the EF path), read live non-archived `calendar_posts` +
`sample_reviews` rows via the anon key and check each column against the EF's `ALLOWED` list.

- calendar-upsert `ALLOWED` = 39 columns; sample-review-upsert `ALLOWED` = 25 columns.
- **6/6 clients clean:** NO row carries a non-empty value in any column the EF would drop, and
  NO duplicate live Linear link within a client. i.e. the EF preserves the full n8n row shape —
  no dropped/renamed fields. (The service-role `scripts/b05-jesse-ef-guard-replay.js` needs
  `SUPABASE_SERVICE_ROLE_KEY`, an owner-only secret — recommend the owner run it too; this anon
  read reproduces its core drift/dup-link assertions.)

## Phase 3 — fail-safe fork (RESULT: PASS)

Harness `qa/ef-writepath/20-routing-failsafe.js`, 16/16 green. Asserting the REAL in-page
routing functions:

| Router | flagged (sidneylaruel) | unflagged slug | empty flag |
|---|---|---|---|
| `_calUpsertUrlForClient` | calendar-upsert **EF** | n8n `calendar-upsert-post` | n8n (fail-safe) |
| `_calReorderUrlForClient` | calendar-reorder **EF** | n8n `calendar-reorder-batch` | — |
| `_sxrUpsertUrlForClient` | sample-review-upsert **EF** | n8n `sample-review-upsert` | n8n (fail-safe) |
| `_settingsUseEf` | true (**EF**) | false (n8n) | — |

**Live fail-safe:** with `sidneylaruel` temporarily removed from the in-memory flag, a real
caption edit on a disposable card routed to the n8n `calendar-upsert-post` webhook (captured;
the n8n write was blocked so nothing landed), NOT the EF. Flag restored, card archived. The
routing decision degrades to n8n on empty/error flag — a client can be pulled off the EF path
instantly by removing the slug (one-step rollback).

## Phase 4 — read-only surface health (focused) — PASS

- Repo EF unit/source tests all PASS: `calendar-upsert-routing`, `calendar-upsert-edge-source`,
  `a2-writer-edge-source`, `a4-settings-edge-source`, `samples-realtime-status-propagation`.
- Harness `qa/ef-writepath/30-master-readonly.js`, 8/8 green: passive loads of SMM calendar,
  SMM samples, client calendar, client samples each fire ZERO write/Linear POSTs and log ZERO
  app console errors. (Writes happen only on user action.)
- Across EVERY harness in this suite (100+ assertions), app console errors were 0. The only
  browser errors emitted are the Supabase realtime WebSocket timeout — an environment limitation
  of this sandbox (the proxy can't relay the browser's WS), NOT an app bug; it is filtered the
  same way the repo's own courier harnesses filter it.

---

## Results matrix — interaction × {routing, supabase, linear, persist, realtime}

Legend: ✓ pass · — not applicable · (n/a WS = realtime WS un-tunnelable in sandbox; pill-update
logic verified via the app's realtime handler + a repo unit test).

| Interaction (surface) | routing→EF | supabase col | linear (Pipe B) | persist | realtime pill |
|---|---|---|---|---|---|
| caption edit (cal) | ✓ | ✓ caption | — (0 push) | ✓ | ✓ |
| video_status (cal) | ✓ | ✓ video_status | ✓ VID only | ✓ | ✓ |
| graphic_status (cal) | ✓ | ✓ graphic_status | ✓ GRA only | ✓ | ✓ |
| caption_status (cal) | ✓ | ✓ caption_status | — (0 push, no leak) | ✓ | ✓ |
| title_status (cal) | ✓ | ✓ title_status | — (0 push, no leak) | ✓ | ✓ |
| reorder (cal) | ✓ reorder-EF | ✓ order_index | — | ✓ | — |
| add card (cal) | ✓ insert | ✓ new row | — | ✓ | ✓ |
| archive (cal) | ✓ | ✓ status=Archived | — | ✓ | ✓ |
| video_status (samples) | ✓ | ✓ video_status | ✓ VID only | ✓ | ✓* |
| graphic_status (samples) | ✓ | ✓ graphic_status | ✓ GRA only | ✓ | ✓* |
| reorder (samples) | ✓ reorder-EF | ✓ order_index | — | ✓ | — |
| add/archive (samples) | ✓ | ✓ | — | ✓ | ✓* |
| caption-template save | ✓ settings-EF | ✓ caption_prompts | — (0 push) | ✓ | — |

\* samples realtime pill logic verified by the repo unit test `samples-realtime-status-propagation.js`
(the P1 fix, PR #712) plus the calendar realtime-handler harness above; same code path.

Every Linear issue touched (test client's own; dummy ids) was reverted and re-verified at baseline:
**VID-12612** (`Tweak Needed `), **GRA-6310** (`Approved`), **VID-12728** (`Approved`), **GRA-6496**
(`Approved`). No other Linear issue was touched (non-allowlisted pushes were blocked by the harness).

---

## Bugs / findings

**No bug on the #1 risk.** The EF write path does NOT skip the Linear enqueue. On every
calendar AND samples status/comment write, the EF-routed card write is followed on the shared
path by the Pipe-B push to the correct per-component issue — proven live end-to-end (FE routing
captured + n8n→Linear round-trip verified via the Linear API + dual-component isolation).

**One pre-existing gap found (NOT introduced by this migration; not fixed inline — for a
separate reviewed PR):**

- **The samples EF (`sample-review-upsert`) has no duplicate-link guard**, whereas the calendar
  EF (`calendar-upsert`) does (`readLinkTwins` + the duplicate-`linear_issue_id` guard). Its
  `applyGuards(incoming, existing, readFailed, nowMs)` takes no `twins` and never queries link
  twins. Impact today is negligible — real-client samples usage is ~0 active rows — but if two
  live sample rows were linked to the same Linear issue, the samples EF would not deduplicate
  where the calendar EF would. Recommend porting the calendar guard to the samples EF before
  samples usage scales. (Failure scenario: two live `sample_reviews` rows for one client both
  carrying the same `linear_issue_id` → both drive that one issue; calendar prevents this, samples
  does not.)

**Known operational gap (documented in `ROLLBACK.md`, not an EF write-path defect):**

- **The Samples ⇄ Linear reconciler is currently disabled** (last ran 2026-06-28; cron off). The
  calendar reconciler runs and reports 0 corrections. Samples EF clients therefore have no
  most-recent-wins convergence backstop beyond the 5-minute local-fresh merge. Accepted while SXR
  usage ≈0; re-enable before scaling samples.

**Realtime status pill:** works. The observer's status PILL (not just the note dot) flips live
via the app's realtime handler + REST refetch (P1 fix / PR #712, plus its unit test). The live
Supabase realtime WebSocket itself could not be exercised in this sandbox (the proxy cannot relay
the browser's WS, so the subscription TIMES_OUT and the app falls back to REST — which is what was
driven). It is already exercised in production for the 5 flagged clients. Low residual risk.

---

## GO / NO-GO

**GO — safe to move all clients onto the EF write path**, with the conditions below. The
calendar EF path is mature and proven: 5 production clients have run on it since 2026-07-06/07
with 0 reconciler-sourced corrections and no recorded write-path incident, the reconcile net
shows 0 drift, response-shape and column parity hold, the guard gauntlet is preserved
(A1/A2/A4 parity previously passed on the test client), and this end-to-end test confirms every
interaction routes to the EF, writes the correct columns, still drives Linear correctly per
component, persists, and propagates — with a clean one-step per-client rollback (remove the slug
→ instant n8n fallback).

**Recommended before / during a full rollout:**
1. **All-client drift pre-flight.** This test verified 0 drift on the 6 flagged clients only.
   Run the anon drift check (extend `21-drift-check.js` to all clients) or the service-role
   `b05-jesse-ef-guard-replay.js` across every client before flipping, as a cheap safety net for
   per-client data-shape edge cases. The EF `ALLOWED` was captured from live n8n and covers all
   live columns seen so far, but the remaining 25 clients weren't read here.
2. **Stage the rollout** (small waves) and watch EF error rates + the calendar reconciler
   correction count after each wave — exactly the monitor used for the existing 5-client waves.
3. **Samples-specific (only matters as samples usage grows, ~0 today):** port the duplicate-link
   guard to the samples EF, and re-enable the Samples ⇄ Linear reconciler. Neither blocks the
   calendar rollout; both should precede meaningful samples adoption.

**Residual risks:** per-client data-shape edge cases on the un-tested 25 clients (mitigated by
#1); write volume at full scale (mitigated by #2 — the EFs are stateless and the current 5-client
load is nominal); the two samples gaps above (low-urgency given ~0 samples usage). None of these
is a calendar write-path blocker.

---

## Reproduce

Harness lives in `qa/ef-writepath/` (Node + Playwright, same courier pattern as
`qa/sxr_courier_lib.js`). Each script serves `index.html` in-process, seeds the auth key, drives
the REAL UI on the test client `sidneylaruel`, and captures outbound network to prove routing by
URL. Linear pushes are captured+mocked by default (zero mutation); `EFWP_LINEAR_FORWARD=1`
forwards ONLY the test client's own allow-listed issues to live n8n for the real round-trip.

```
node qa/ef-writepath/00-smoke.js            # courier + load sanity
node qa/ef-writepath/10-status-linear.js    # Phase 1c + 2 (status → Linear, dual-component)
node qa/ef-writepath/11-calendar-writes.js  # caption/status/reorder/add/archive/persist
node qa/ef-writepath/12-samples.js          # samples status/reorder/add/archive
node qa/ef-writepath/13-settings.js         # caption-template save routing
node qa/ef-writepath/14-realtime.js         # status-pill propagation
node qa/ef-writepath/20-routing-failsafe.js # Phase 3 fail-safe fork
node qa/ef-writepath/21-drift-check.js      # column drift, all flagged clients (read-only)
node qa/ef-writepath/30-master-readonly.js  # Phase 4 read-only surface health
```

Safety: only `sidneylaruel` is ever written; Linear mutations are limited to the test client's
own allow-listed issues and reverted; screenshots (if any) stay local and are not committed; the
browser-safe publishable anon key already in `index.html` is the only key used (no secrets).
