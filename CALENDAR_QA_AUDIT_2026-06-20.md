# Calendar QA Audit & Test Guide — 2026-06-20

End-to-end QA of the content calendar across its three surfaces (SMM `#calendar/<slug>`,
Client `?c=<Name>&v=calendar`, Kasper `?Kasper=1`), driving the **real** app headless against the
**live** Supabase + n8n backend. Every probe asserts on rendered DOM + the Supabase row + **zero**
JS errors, and only ever creates/mutates the test client **Sidney Laruel** (`sidneylaruel`),
cleaning up after itself (archive cards, tombstone comments).

This doc is the durable record (the probe scripts live in `qa/probes/`, the harness in
`qa/probes/lib.js` + `qa/golden_lib.js`). It supersedes the scratch notes in `/tmp/qa/STATUS*.md`.

---

## 1. Bugs found and FIXED (branch `claude/stoic-mendel-wcf3b5`, PR #549 — NOT merged)

### 1a. Supabase reads silently capped at 1000 rows (data completeness) — `_calSupabaseFetchAllRows`
- **Symptom:** PostgREST caps every response at the project's `db-max-rows` (1000) regardless of the
  client `limit`. The app read `…/calendar_posts?select=*&limit=20000` (Kasper, unscoped) and
  `&limit=5000` (per-client). The table is at 1254+ rows, so Kasper's queue silently dropped every
  row past the first 1000 — a freshly-added card sorting past the window never reached him.
- **Fix:** page through with **keyset** pagination. The first pass keysetted on `id` alone — but
  `id` is NOT globally unique (the same id is reused across different clients; rows key on
  **(client, id)**). An id-only cursor skips a same-id group straddling a page boundary, so the
  shipped fix uses a **compound (id, client) keyset**:
  `order=id.asc,client.asc&or=(id.gt.X,and(id.eq.X,client.gt.Y))`.
- **Verified:** against the live 1254-row table (8 cross-client same-id groups) at page sizes
  7/50/250/1000 — every run returns exactly 1254 rows, all (client,id) pairs, zero dups (probe
  logic in `p46`, standalone boundary proof run separately). Offline suite 19/19.

### 1b. Kasper cross-component status clobber — `_kasperPersistPostWrite`
- **Symptom:** Kasper persisted the **whole row**. When he changed one component (e.g. requested a
  video change) at the same instant another actor changed a DIFFERENT component (e.g. the client
  approved the caption), Kasper's row carried a STALE value for that other component and overwrote
  it. Intermittent (~1/3 under tight concurrency, probe `p42`). The upsert's stale-save conflict
  guard catches the common case but not the read-before-the-other-write TOCTOU window.
- **Fix:** Kasper now sends a **field-level patch** — snapshot the card's scalar columns on load
  (`_patchBase`) and after each write, and send only the scalars that changed vs that snapshot
  (plus the always-server-merged comment cells, plus the derived overall status when it moved). A
  component Kasper didn't touch is never on his wire. **Falls back to the whole row when no
  snapshot is available**, so it's never worse than before. (`KASPER_PATCH_SCALARS`,
  `_kasperPatchSnapshot`.)
- **Verified:** `p42` now passes 6/6 (was ~1/3). Every individual Kasper action persists all its
  fields — `p39` inbox, `p44` blast-radius, `p45` AAT, `p53` finish, `p54` undo/X-close, `p55`
  comment all green. Offline 19/19.

---

## 2. n8n investigation — NO backend change made (and why that's correct + safe)

Read the live **SyncView Calendar — Upsert Post** workflow (`pWSqaqVw7dmqhYOA`,
`POST /webhook/calendar-upsert-post`) and its **Calendar Comment Merge** helper (`meM78zr1Gcl72c6f`).

- **Architecture:** Build Row From Patch → Read Existing Row (Supabase) → Read Link Twins → Merge
  Comments (the guard node) → Is Conflict ? respond-no-write : Strip Routing → {Google-Sheets
  appendOrUpdate mirror} + {Prep Mirror → Row Existed? → (exists) atomic comment-merge RPC + Mirror
  Update / (new) Mirror Create}.
- **Existing guards (all solid):** phantom-row, read-failure, comment **3-way merge**
  (`comments_base_at`), link-clobber (carry stored link over a blank), `__CLEAR_LINK__` sentinel,
  duplicate-link (linear_issue_id unique across live rows), **stale-save conflict**
  (`comments_base_at < stored updated_at` AND a scalar changed → reject with a "someone else
  updated this card — refresh" error). autoMapInputData writes only the columns present in the patch.
- **The "duplicate-id rows" report was WRONG — it is NOT a bug.** Grouping by `id` alone is
  misleading: `id` is not globally unique. Definitive check (all rows, grouped by **(client, id)**):
  **0 true (client, id) duplicates**; 8 ids appear across multiple *different* clients
  (e.g. `p_mpbe2kgs_me9j7` → chelseyscaffidi/daniellerobin/soniachopra; `p_cal_settings` → one
  settings row per client). Everything keys on (client, id), so this is by design. **No DDL, no
  dedup, no row deletion** — and adding a global-unique `id` constraint would BREAK the cross-client
  design. (This is the "impossible to fix" class of change that was correctly avoided.)
- **The status clobber is best fixed on the FRONTEND** (1b above), not in n8n: the upsert faithfully
  writes the columns it's given; the ambiguity (which status Kasper "intended" to change) only the
  frontend knows. The conflict guard already mitigates the detectable cases; the field-patch closes
  the residual TOCTOU at the source.

**Net: the n8n upsert was left untouched. The two real fixes are frontend, on PR #549.**

---

## 3. Findings characterized but intentionally NOT changed

- **Caption-gen cancel is best-effort** (`_calCapJobSettle`): cancelling a *running* job sends
  `cancel_requested` to the backend; in production the workflow returns `cancelled` and the frontend
  suppresses the caption (verified — `p32` G green with a cancel-aware mock). BUT the frontend does
  not *also* guard locally, so in the narrow race where the backend finishes generating before
  honouring the cancel (returns a caption anyway), that late caption still lands. Optional one-line
  hardening: in `_calCapJobSettle`, treat a `done` as cancelled when `job.cancelRequested` is set.
  Flagged, not changed (looks intentional).
- **Rapid SMM→Kasper handoff conflict** (`p71` capstone, intermittent): a card surfaces in Kasper's
  queue the moment the FIRST component reaches Kasper Approval, so his snapshot can be stale; a
  Kasper approve on it is correctly REJECTED by the conflict guard ("refresh"). This is the SAFETY
  NET for the sequential-stale case (the truly-concurrent case is 1b). Correct behaviour; the `p71`
  probe retries-on-conflict to stay deterministic.

---

## 4. Probe inventory (regression suite) — `qa/probes/`

Run any probe with `node qa/probes/<name>.js` (requires the local server on :8000 serving
`index.html`, and Playwright at `/opt/node22/lib/node_modules/playwright`). All probes are
self-cleaning and scoped to `sidneylaruel`.

| Probe | Covers |
|---|---|
| p28–p30 | Linear status PUSH from SMM / Kasper / client (correct sub-issue; caption & title never push; no cross-leak) |
| p31, p32, p38 | Caption generation: entry guards · races (edit-during/cancel/archive) · bulk concurrency+partial-failure |
| p33–p35 | Shift-range select (visible only) · set-all status · month-grid placement (Buenos Aires tz) |
| p36 | CAPSTONE video lifecycle across DB + Kasper + client + Linear |
| p39 | Kasper Messages inbox: internal note surfaces → threaded reply (internal/kasper) → SMM sees, client doesn't → mark-read |
| p40 | Unread-dot lifecycle (client/SMM, audience-aware, own-note-never-unread) |
| p41 | Multi-round tweak loop across actors with round numbering + audience tags |
| **p42** | **Concurrent cross-component (Kasper×client) — the clobber repro; now 6/6 after fix 1b** |
| p43, p43b | SMM×client concurrent field-patch (both land) + stale-overall self-heal |
| p44 | Kasper whole-row blast-radius: concurrent client COMMENT survives (comment cells merged) |
| p45 | Approve-After-Tweaks full lifecycle (Kasper pre-clear → SMM badge → client → badge hides) |
| p46 | Pagination fix: fetches all 1000+ rows; previously-hidden card now in Kasper queue |
| p47 | Title/YouTube review lifecycle + invariants (never folded into overall; never pushes Linear) |
| p48 | Schedule → Post → Archive cross-surface (real handlers + confirm dialogs) |
| p49 | REALTIME propagation both directions (no manual reload) |
| p50 | Mixed-state card per-surface visibility (no cross-surface leakage) |
| p51 | Client tweak round-trip (request → leaves sheet → SMM resolves → re-active → approve) |
| p52 | Alt-caption SMM-owned / client read-only / rides along with caption review |
| p53 | Kasper finish-reviewing hand-off (kasper_finished_at; no drag-back; re-surface on fresh ask) |
| p54 | Kasper undo-approve (toast) + X-close (kasper_closed_at; re-surface on new message) |
| p55 | Kasper plain comment (internal; no status change; card stays; client can't see) |
| p56 | Cross-client isolation + Kasper bulk-read grouping (no foreign leak) |
| p57 | SMM review-sheet flow (For-SMM-Approval → approve→Kasper / approve→client / request-change) |
| p58 | Bulk archive + colour tag (peripheral UI; client read-only) |
| p59 | Live v2 reconcile (keep own write + adopt a concurrent other-field change) |
| p60 | Notes MODAL — SMM: internal vs client note · threaded reply · video note → Linear |
| p61 | Notes MODAL — CLIENT: comment vs request-a-change (→Tweaks Needed) · reply |
| p62 | "SMM marks as done": resolve non-last (no chooser) · resolve last (chooser→route) · delete + guards |
| p63 | Client privacy filter (Kasper authorship + internal threads never leak to client) |
| p64 | Unified multi-component feed · "N open" badge · unread-clears-on-open · Show-resolved |
| p65 | Concurrent same-thread comment merge (both survive) |
| p66 | Stale-approval clearing (regress below Client Approval clears the sign-off stamp) |
| p67 | thumbnail/asset link edit → thumb_rev cache-bust propagation (caption edit does NOT bump it) |
| p68 | Linear link CLEAR sentinel end-to-end (clears to empty, not stale URL, not literal sentinel) |
| p69 | Date reschedule (DB + month-filter membership moves + client cross-surface) |
| p70 | Rapid realtime convergence (5 quick status changes → client converges to final) |
| **p71** | **Full 4-component pipeline capstone (SMM→Kasper→client→Approved), conflict-retry hardened** |

Golden flows (in `qa/`): golden_1..6 (clean approve, Kasper tweak loop, client tweak loop, AAT,
undo, cross-surface archive). Offline unit suite: `test/*.js` (19 tests).

---

## 5. Harness & scope rules (for future sessions)

- **Server:** `python3 -m http.server 8000` from the repo root (serves `index.html` live).
- **Harness:** `qa/probes/lib.js` (extends `qa/golden_lib.js`) — `up`, `rawRow`, `pollRaw`,
  `smmPage`/`clientPage`/`kasperPage`, `waitForPost`, `smmResolveTweak`, `clientApprove`,
  `clientRequest`, `makeOk`, etc. Auth via `localStorage.syncview_auth_v1='ok'` init script.
- **SCOPE (hard rule):** only ever create/mutate **`sidneylaruel`**. Unique probe ids. Always clean
  up (archive cards, tombstone comments). Never touch other clients. Don't touch the urgent/Slack
  buttons (`_calSendUrgentSlack`, `sendWeeklySlackUpdate`, `kcard-urgent-btn`) — they ping Slack.
- **Sidney's fixtures:** collab_mode=true, title_review=true, enabled_platforms=
  [instagram,youtube,linkedin], 4 real scratch cards (TESTTT, TEST 1/2/3) — leave them intact.

## 5b. CI (automated — no manual testing)
- **`.github/workflows/calendar-unit-tests.yml`** — runs `node test/run-all.js` (the 19 unit suites)
  on **every push + PR**. Fast, no network/browser. The always-on gate.
- **`.github/workflows/calendar-e2e-nightly.yml`** — runs `node qa/run-probes.js` (the
  `nightly-manifest.txt` set, 44 probes) **nightly at 08:00 UTC + on demand** (Actions → Run
  workflow; optional probe-subset input). Each probe is retried (`PROBE_ATTEMPTS`, default 3) to
  absorb transient network/realtime flakiness; red only if a probe fails every attempt.
- Local: `npm run test:unit` (fast) and `npm run test:e2e` (serves the app + runs the probes).
- Manifest is verified green end-to-end (44/44). When adding a probe, append it to
  `nightly-manifest.txt` once it's stable.

## 6. Recommended future testing
- Re-run the suite after any calendar change; `p42`/`p65`/`p59`/`p70` are the concurrency canaries.
- Untested edges worth adding: reserve-tray drag-to-schedule UI, settings reconcile cross-device
  (mutates settings — restore carefully), Linear PULL reconcile under v2 (currently disabled FE-side).
- If concurrency tests flake, check whether it's the conflict-guard rejection (correct) vs a real
  clobber — `p42` distinguishes them.
