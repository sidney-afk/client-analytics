# Samples (Review) FE Rebuild — Build Strategy & Contract

**Status:** PLAN — awaiting your go-ahead. No feature code written yet.
**Supersedes the *execution approach* of:** `SAMPLES_PARITY_PLAN.md` (that doc is the record of the
old *function-by-function* approach that failed). **Builds on:** `SAMPLES_REBUILD_SPEC.md` (the
surface inventory) — this doc is the executable version of it, with verified line anchors, the
tagging/teardown convention, and the open decisions.

Produced by an 8-agent deep-research pass over the live `index.html` (30,431 lines) + every
`SAMPLES_*` doc, the SQL migrations, and the QA estate. Every anchor below was re-grep-verified
against the file at research time. **Line numbers drift as the file changes — at build time, locate
each function by NAME, treat the line number as a hint.**

---

## 0. The one rule (why attempt #1 failed, and the discipline that prevents a repeat)

Attempt #1 cloned the calendar **function by function** into `_sxr*`. That is lossy by
construction: you copy the functions you happen to look at and silently miss whole surfaces. The
result was a card that didn't match, a different Notes modal, a bare-list client link instead of the
real multi-tab portal, a missing tab-return refresh — each found reactively, one at a time.

**THE RULE:** clone **whole surfaces**, never individual functions. Take a calendar surface (the
toolbar, the Sheet card, the Review list, the Notes modal, the client portal) **in its entirety**,
copy it, and change ONLY (a) the data it points at, (b) the component set `['video','graphic']`, and
(c) the explicit exclusions. **Build strictly down the surface list in §5, verify each surface
against its calendar twin before starting the next.** That single discipline is the deliverable.

---

## 1. Technique: B — disciplined wholesale copy (purely additive, namespaced `_sxr*`)

Two routes existed; B is chosen and is non-negotiable for this codebase:

- **A (shared/parameterized):** one impl serves both surfaces. Rejected — `index.html` has no module
  wrapper; the calendar reads ~1,174 top-level globals directly, so A is a deep refactor of the
  **live calendar** (the #1 "never touch" surface). It also **destroys the tagging guarantee** —
  edited calendar lines cannot be cleanly removed.
- **B (wholesale copy):** copy whole surfaces into a new `_sxr*` namespace, re-pointed to
  `sample_reviews` / `SXR_COMPONENTS`. **Cannot break the calendar (purely additive). It is the only
  route where "tag every line / remove cleanly / revert byte-identical" is provable.** Its known cost
  (drift from the calendar twin) is mitigated by the `SAMPLES_PARITY_LOG.md` Mirror Registry.

### 1.1 The refinement: SHARED utilities are CALLED, not copied
"Whole-surface clone" applies to **surface / render / save** functions (things with a distinct
samples shape). It does **not** apply to the pure, table-agnostic utility layer. The samples code
**calls, never copies**: `_calEsc`, `_calEscAttr`, `_jsAttrArg`, `wlNormalizeClient`, `_calV2LoadLib`
(16165), `_calV2Client`, `_calSupabaseFetchAllRows`, `_calMapLinearStatusStrict`, and the shared
Linear webhooks (`linear-issue-statuses`, `linear-set-status`, `linear-add-comment`). Reason: the
2026-06-24 Linear poison fix and future escaping/pagination/concurrency fixes only reach samples for
free if samples calls the shared artifact. Component-shaped helpers that branch on `CAL_COMPONENTS`
(`computeOverallStatus` 12579, `_calComponentsFor`, `_calMigratePostShape`) **are** forked so they
iterate `['video','graphic']` only and never seed caption/title.

---

## 2. Namespace & tagging convention (your #1 requirement — made provable)

**Namespace = `sxr`** (NOT `sxr2`): the live realtime channel `sxr-<slug>`, flag `?sxr=1`, route
`#sample-reviews`, outbox key `syncview_sxr_linear_outbox_v1`, and the surviving test harness all
already assume `sxr`. Zero `sxr` refs remain in `index.html` post-teardown, so there's nothing to
collide with.

**Why not a literal `//` on every line (your literal ask):** the card HTML is built from large
template literals (`_calRenderInlineCard` emits backtick blocks with `${...}` and `onclick="..."`),
and `//` is illegal in CSS and HTML — a per-line marker would ship into the DOM or break syntax. The
robust equivalent that achieves the same "remove every trace in one shot":

1. **Symbol prefix (the grep guarantee):** every new identifier carries `sxr` — `_sxr*` / `SXR_*`
   (JS), `.sxr-*` (CSS), `#sxr*` / `navSxr` (ids), `syncview_sxr_*` (localStorage).
2. **Language-correct BEGIN/END fences** around each of the **4 insertion regions** (§3):
   - JS: `// >>> SXR_BEGIN` … `// <<< SXR_END`
   - CSS: `/* >>> SXR_BEGIN */` … `/* <<< SXR_END */`
   - HTML/nav: `<!-- >>> SXR_BEGIN -->` … `<!-- <<< SXR_END -->`
3. **`// SXR_LINE` trailing marker** ONLY on the 2 single JS statements wedged into existing `navTo`
   code (the nav `.active` toggle + the `_sxrTeardown()` call). These are **added adjacent lines**,
   never in-place edits — or the byte-identical revert breaks.

**PURELY ADDITIVE INVARIANT:** never edit an existing calendar line. All exclusion-stripping happens
*during the copy*, inside the fences.

**Teardown (two commands):**
```
sed -i '/>>> SXR_BEGIN/,/<<< SXR_END/d' index.html
sed -i '/\/\/ SXR_LINE$/d' index.html
```
**Proof of complete removal (three checks):**
- (i) fence balance before teardown: `grep -c '>>> SXR_BEGIN'` == `grep -c '<<< SXR_END'`
- (ii) after teardown: `grep -nE 'sxr|SXR' index.html` returns nothing
- (iii) **byte-identical:** `git diff e92cb19 -- index.html` returns EMPTY after the two seds
Wire (i) as a pre-commit/CI assert so a nested/duplicate fence can't silently corrupt the delete.

---

## 3. The 4 insertion points + 2 line hooks (kill the scatter)

All new code lives in exactly these places (anchors verified at research time; re-confirm by context):
- **(a) CSS:** one fenced block appended **before `</style>` (line 4071)**.
- **(b) JS:** one fenced block appended **before the `TIKTOK UPLOAD MODULE` banner (line 24734)**,
  i.e. right after the calendar module.
- **(c) Nav:** one fenced `<a id="navSxr" href="#sample-reviews" … navTo('sxr')>` **after line 4178**
  (the hidden `navTiktokPilot`), NOT after `#samples` (4166). Ship hidden unless `_sxrEnabled()`,
  mirroring how `navKasper`/`navTiktokPilot` ship `style="display:none;"`.
- **(d) Router:** one fenced `else if (page === 'sxr') { … renderSxrView(); mountSxrView(); }`
  **after the calendar case at 11681–11684** (the `else if (page === 'samples')` block is at 11686 —
  do not touch it).
- **2 `// SXR_LINE` hooks** inside `navTo`: toggle `navSxr.active`, and call `_sxrTeardown()` when
  leaving the tab (mirrors the calendar realtime teardown).

---

## 4. Backend contract (LIVE — do NOT rebuild; the FE just speaks to it)

- **Table:** Supabase `sample_reviews`, PK `(client, id)`, all-text columns; in `supabase_realtime`;
  `replica identity full`. Realtime verified delivering on `sample_reviews`.
- **Reads:** REST `GET {SUPABASE}/rest/v1/sample_reviews?select=*&client=eq.<slug>` via the shared
  compound-key paginator; fall back to the `sample-review-get` webhook (returns `{items}`).
- **Writes:** `sample-review-upsert` webhook — **field-level patch** (never whole row),
  `comments_base_at:''`, honours the `__CLEAR_LINK__` sentinel, archive = `{id, status:'Archived'}`
  (no delete webhook). Comments: send the full desired array per *changed* component only; never
  pre-merge; never send `''` for a tweak column you aren't editing (omit it).
- **Reorder:** `sample-review-reorder` `{client, items:[{id, order_index}]}`.
- **Status vocab (6, NO Scheduled/Posted):** In Progress · For SMM Approval · Kasper Approval ·
  Client Approval · Tweaks Needed · Approved. Terminal = Approved + Archived. Overall = worst-of.
- **Components:** `video`, `graphic` ONLY. `graphic` is labelled **"Thumbnail"** in the UI.
- **Comments:** per-component JSON in `video_tweaks`/`graphic_tweaks`; delete = TOMBSTONE
  (`deleted:true`); `role` ∈ {smm,client,kasper}; `audience` ∈ {internal,client}.
- **Linear:** link columns `linear_issue_id` (VID) / `graphic_linear_issue_id` (GRA); outbound push +
  point-adoption ride the SHARED Linear webhooks; **inbound rides realtime** (the FE must NOT call the
  inbound webhook). ⚠️ Inbound is an **embedded branch** (`Handle Sample Linear Event`) inside the
  calendar Linear workflow `MJbMZ789B5ExZz9x` — do NOT touch n8n.
- **Realtime channel:** `sxr-<slug>` on `sample_reviews` (reuse the shared supabase-js client/key).

**⚠ Operational gate (blocks the first LIVE test, not the build):** the snapshots for
`sample-review-get/upsert/reorder` show `active:false`. Confirm they were activated in n8n before any
live probe — I can verify this with the n8n tools.

---

## 5. Surface-by-surface build order — COPY → STRIP → TAG → VERIFY

Each step is "done" only when its retargeted `sxr_*` probe passes **and** a side-by-side visual pass
vs the calendar twin passes. Build on branch `claude/samples-feature-frontend-5r9r4n`.

**Surface 0 — Scaffolding + isolation (FIRST).** COPY consts 12526–12600 (CAL_*→SXR_*,
`SXR_COMPONENTS=['video','graphic']`, `SXR_STATUSES`= the 6), `calState` 13334–13352→`sampleState`,
settings 13362–13450, archive ledger 13893–13955. ADD `_sxrEnabled()` (sticky `?sxr=1`, default OFF),
webhook consts, outbox key. **VERIFY:** flag OFF → 0 samples network, supabase-js not on `window`, no
`sxr-` channel, no samples DOM, old `#samples` tab still works.

**Surface 1 — Shell + tab router + nav + client-link/token gate.** COPY `_calRenderShell`
17166–17261→`_sxrRenderShell`; add nav (3c), router case (3d), the 2 `// SXR_LINE` hooks. **STRIP:**
Month/Week tabs, month filter (16823), status-filter dropdown, kebab items (import-Excel 14405,
import-Linear 15013, bulk-Linear-sync 15255, edit-platforms, collab 17184, title-review 17185,
caption-prompt), the **All-months + All-content dropdowns**. Embed title = "Sample reviews"; tab bar =
**{Review, Sheet}** only. **VERIFY:** flag ON shows tab with exactly those 2 tabs; flag OFF nav
hidden; bad client token → "This link isn't valid"; old `#samples` untouched.

**Surface 2 — SMM Sheet card (largest/riskiest).** COPY `renderCalOrganizer` 18316–18393,
`_calRenderInlineCard` 18725–~18851 (~127 LOC) with ALL sub-deps: `_calLinkFieldHtml` 18413,
`_calLinearSlotHtml/PileHtml/Edit/Commit` 18494–18630, `_calStatusToggleMenu/OpenSetAllMenu/
SetAllStatus` 18859–19055, `_calDeriveThumbInfo` 18192 / `_calForceThumbRefresh` 18895 /
`_calSetThumbMedia` 18125 (**preserve the Linear pile/warn overlay on a media edit** — the bug that
wiped it before), `addCalBlankCard` 19934 / `_calBlankPost` 18395 / `_calPromoteBlankCard` 19792,
`_calArchiveOne` 19985 / `archiveCalPost` 20138, reorder + `_calUndoReorder` 21103 (**pin
`_calCommitDragOrder` by grep — not yet located**). **STRIP inside the card:** caption block
(`_calCapBlockHtml`/`.cal-capblock` ~18834), **CTA** (`.cal-fld-cta` ~18835), **date** block
18745–18763 + `.cal-meta-row` render ~18831, **platforms** (`_calPlatformsStripHtml`), **colour tag**
(`_calColorTagHtml`). **VERIFY:** render/edit/save/status/set-all/Linear/reorder/archive/create +
media-edit-preserves-pile + visual parity minus exclusions.

**Surface 3 — Save engine (clone the FIXED version verbatim).** COPY `_calOnFieldInput/Blur`
19388–19403, `_calFlushCardSave` 19428–~19767 (~340 LOC) — field-level patch, echo-merge (overlay
echo onto the FULL local row THEN migrate — never clobber a sibling component), `comments_base_at:''`,
`__CLEAR_LINK__`, in-flight lock, self-echo window, thumb_rev. FORK `_calMigratePostShape`→
`_sxrMigrateShape` (never seeds caption/title). **VERIFY:** edit/save + status-lifecycle +
worst-of-overall + concurrent-cross-component-edit-no-clobber.

**Surface 4 — SMM Review tab.** COPY `renderCalReview` 21802, `_calReviewItems` 21763,
`_calReviewCardHtml` 21855, `_calReviewCardBody` 21895, `_calReviewPanelHtml` 21922–~22068 (~147 LOC),
`_calReviewMode` 21424, `_CAL_REVIEW_CFG` (SMM: `For SMM Approval`→`Kasper Approval`). **STRIP:**
title/caption review components → review set = `['video','graphic']`. **VERIFY:** queue filter, panel
approve/request-change/thread/resolve, visual parity.

**Surface 5 — Notes/comments modal (REUSE the calendar GLOBAL CSS — do NOT invent `sxr-cm-*`).** COPY
`openCalComments/closeCalComments` 23006, `_calRenderCommentsModal` 23017–23118, `_calComposerHtml`
23151–23222, `_calCommentsForView` 12745 (audience gating). Component picker = Video/Thumbnail only.
**VERIFY:** visual parity + audience gating (hide internal/Kasper from client) + tombstone-on-delete.

**Surface 6 — Client portal as ONE whole surface (the biggest gap last time).** COPY client shell
(title "Sample reviews", tabs Review+Sheet), Client Review tab (`_CAL_REVIEW_CFG` client:
`Client Approval`→`Approved`), the **MISSING Client SHEET tab** = read-only `_sxrRenderInlineCard`
(`ro=true`: read-only pills, link pills open-only, NO add/edit/archive/drag/select), client notes
modal (no resolve, no audience toggle), visibility gating `_calIsClientReady` 18085→`_sxrIsClientReady`
(client-ready once any component leaves In Progress; collab always OFF). Client share link MUST carry
`?sxr=1`. **VERIFY:** NEW client-portal probe (tabs present; Sheet read-only; switch Review↔Sheet) +
token-gate negative case.

**Surface 7 — Realtime + freshness as ONE surface.** COPY `_calV2EnsureSubscribed` 16262 (channel
`sxr-<slug>`, table `sample_reviews`, reuse shared client/lib), `_calRefreshOnReturn` 14158 (gate on
`sampleState.client` mounted), deferred-render guard 14188–14219 (include the client review composer).
Card→Linear durable outbox on **separate key** `syncview_sxr_linear_outbox_v1` + self-echo suppression
+ stale-regress protection (ABOVE-set = {Client Approval, Approved}). **VERIFY:** background-tab →
return-refreshes; repaint-deferred-while-composer-focused.

**Surface 8 — Kasper samples sub-tab.** COPY `_kasperRenderCard` 28339–28439→`_sxrKasperRenderCard`
(own state slice; persists via `sample-review-upsert`, never `_kasperPersistPost`). **VERIFY:** kasper
sub-tab probe.

**FINAL GATE.** `node test/run-all.js` green + retargeted nightly `sxr_*` manifest (Linear MOCKED,
client `sidneylaruel` only) + ONE `overnight-test` run (after re-pointing its 3 courier openers
smm/client/kasper to the new tab) + flag-OFF isolation probe + old-`#samples`-untouched regression +
fence-balance assert + `git diff e92cb19` teardown dry-run returns EMPTY.

---

## 6. The do-not-touch perimeter (wired in as guards)
- **Default-OFF isolation:** every entry point gated on `_sxrEnabled()`; NO module-eval side effects
  (no fetch/subscribe/lib-load at script-eval time); supabase-js lazy-injected only behind the flag.
- **Old `#samples` module:** never reuse `_sm*`, `?sv2=1`, `samples-upsert`, `#samples`, `v=samples`.
  New build uses `_sxr*`, `?sxr=1`, `sample-review-upsert`, `#sample-reviews`, `v=sample-reviews`.
  Never grep-replace the bare substring `sample` (collides with the old module) — only exact tokens.
- **Embedded inbound Linear branch:** FE-only; do not edit n8n `MJbMZ789B5ExZz9x`; inbound rides
  realtime.

---

## 7. Verification engine (the "special skills/tools" that de-risk this)
Per surface: **`run`** smoke (tab loads, the Add/Approve affordance is present — the exact cold-open
guard against the "shipped with no Add button" bug) → **`code-review --high`** on the per-surface diff
(catches cherry-pick drift + 100% marker coverage + no leakage into old `#samples`) → the retargeted
**`sxr_*` probe** (Linear MOCKED via the surviving `qa/sxr_courier_lib.js`, client `sidneylaruel`,
unique `sr_*` ids, archive everything, assert Supabase row + DOM + 0 JS errors) → **`verify`** as
human-observed acceptance. Drop probes for every excluded feature. Do NOT lean on retry-to-green
(`PROBE_ATTEMPTS=3`) — it hides the realtime/concurrency flakes this feature is most prone to.
**Plan Mode** locks this plan; the **`overnight-test` skill** is the unattended deep sweep across all
three surfaces; **`SAMPLES_PARITY_LOG.md`** is the durable ledger so future calendar fixes get
mirrored.

---

## 8. Decisions (my recommended defaults in **bold** — tell me to change any)
1. **Tagging:** fences + `sxr` symbol prefix; teardown = 2 seds; proof = `git diff e92cb19` empty.
   **(recommended)** — vs. also adding a literal per-line marker (only safe in pure-JS regions; no
   extra safety).
2. **Review cadence:** **checkpoint after each surface** (you OK each one before I continue) —
   vs. milestone checkpoints (~3) — vs. build-all-then-review.
3. **Scope:** **full clone, all 9 steps incl. polish** (you said "exactly the same minus exclusions").
4. **Client review card default:** **collapsed (calendar parity)** — or auto-expand the actionable
   ones? (spec §7 flags this as the one flippable choice.)
5. **Linear reconciler (`scripts/sample-linear-reconcile.js`):** **OUT of scope** for this FE pass
   (FE just calls the shared webhook; reconciler is backend-later).
6. **Operational:** confirm the 3 n8n webhooks are ACTIVE before the first live test (I can check).
