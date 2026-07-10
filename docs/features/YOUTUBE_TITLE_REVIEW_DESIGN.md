# YouTube Title Review + Notes Component Routing — Design Spec

**Status:** Part A front-end BUILT + pushed (`claude/zen-meitner-bmih9m`); Phase 0 backend + Part B pending · **Date:** 2026-06-17
**Owner area:** Calendar → per-card title, Kasper/client review, Notes modal, Linear sync

This spec covers two related features decided together:

- **Part A — YouTube Title Review:** let the SMM put a YouTube title through Kasper- and
  client-approval, fully tracked, without affecting the card's overall status.
- **Part B — Notes component picker + Linear routing:** in the Notes modal, let the SMM /
  client say *which deliverable* a note is about, and route video/thumbnail notes to the
  matching Linear sub-issue (caption + title have no Linear, so they're Supabase-only).

Part B improves all components; Part A only depends on it for the "Title" picker option.

---

## Core architectural decision (applies to both parts)

Today one array, `CAL_COMPONENTS = ['video','graphic','caption']` (`index.html` ~11324),
serves **two different jobs**: it defines what folds into the card's **overall status**
(`computeOverallStatus` ~11338) **and** what shows in the **review / Notes / queue** UI.

We **split it in two**:

- **`CAL_COMPONENTS = ['video','graphic','caption']`** → **overall status only.** Unchanged.
  The title never enters it, so `computeOverallStatus`, the `Archived`/`Posted`/`Scheduled`
  gating, "done-ness" warnings, client-ready gating, and Linear status push are **100%
  untouched**, and all 617 existing cards behave exactly as before.
- **`CAL_REVIEW_COMPONENTS = ['video','graphic','caption','title']`** → **everything else:**
  status pills, review panels, Kasper queue, Notes feed, unread/seen tracking, comment
  resolve/delete.

Every current `CAL_COMPONENTS` usage is then audited and pointed at the correct list (the
full site inventory is in §A6/§B3). This split is the linchpin: it lets the title be a
first-class *review* component while staying invisible to the *overall-status* machinery —
the part with all the historical bugs.

---

# PART A — YouTube Title Review

## A1. The problem

For YouTube the **title** drives CTR, but the card's title is just the plain `name` text
box — no review, no approval, no history. The SMM needs to send a title to Kasper, then the
client, for sign-off, with a complete audit trail.

## A2. Approach (decided)

The title becomes a **4th review component** with its own **`title_status`** that reuses the
**existing** status values, set by the SMM via the **same dropdown** the other components
use (`_calStatusToggleMenu` ~16961 → `_calStatusPick` ~17007). It is **excluded from
`computeOverallStatus`** (via the list split above).

- **No new status *value*** — reuses the existing vocabulary.
- **Never affects overall status** — not in `CAL_COMPONENTS`.
- **SMM has full control** — can skip Kasper (set straight to *Client Approval*/*Approved*),
  keep *Approved* after a typo edit, or send back for re-review. Kasper and the client still
  use the guided **Approve / Request change** buttons in their panels (no free dropdown for
  them — same as today).

Behaviourally the title mirrors the **caption** (the existing no-Linear component), with
four deliberate differences: (1) excluded from overall status, (2) gated to YouTube + a
per-client toggle, (3) a trimmed status list, (4) no Linear.

### Decisions captured
- Own `title_status`, reusing existing values, **off the overall status.** *(chosen)*
- **Status options = relevant subset:** `In Progress`, `For SMM Approval`, `Kasper
  Approval`, `Client Approval`, `Tweaks Needed`, `Approved`. Drops `Scheduled`/`Posted`
  (publishing states that don't apply to a title). *(chosen)*
- Goes through **Kasper *and* client** approval. *(chosen)*
- **Kasper Approve → auto-advances to Client Approval** (mirrors `_kasperApproveComp`
  ~25396, which routes a sub-status to `Client Approval`). *(chosen)*
- Re-review routing is **SMM-driven via the dropdown** (e.g. after a client change request
  the SMM resubmits straight to *Client Approval*, skipping Kasper). *(follows from the
  dropdown decision)*
- **Per-client toggle** in the global ⋮ menu (~15523), cross-device, mirroring
  "Collaborative mode" (`_calIsCollabOn`); default off. *(chosen)*
- **YouTube cards only** (`_calPostPlatforms(post)` includes `youtube`), badged with a small
  YouTube glyph. *(chosen)*
- **Editing an approved title does NOT force re-review** — the SMM decides. We still **log**
  the edit (old → new) in the history for the audit trail. *(chosen)*

## A3. Data model

New per-card fields (added to the n8n `calendar-upsert-post` `ALLOWED` list + Supabase
`calendar_posts` + Sheet mirror, exactly like the `caption_*` fields):

| Field | Type | Meaning |
|---|---|---|
| `title_status` | text | One of the A2 subset. **Not** folded into `computeOverallStatus`. |
| `title_tweaks` | text (JSON) | The title's comment/tweak thread — same shape as `caption_tweaks`. |
| `client_title_approved_at` | text (ISO ts) | Client approval timestamp (mirrors `client_caption_approved_at`). |

The **audit trail** comes from the existing comment model, which already records per entry:
`{ role: 'smm'|'kasper'|'client', author, is_tweak, audience, body, created_at, updated_at,
done, done_at, done_by }` — i.e. **who / what / when / resolved**. We add two small,
title-scoped extensions for the "leave no room for error" goal:

- a **`round`** integer tag on entries (revision 1, 2, 3…), and
- optional **`kind:'event'`** system entries logging lifecycle moments (`submit`,
  `kasper_approve`, `client_approve`, `edit_title` with old→new). The thread is JSON, so
  this is additive and needs no migration — and gives headroom for details we add later.

The per-client enable flag lives where "Collaborative mode" persists (cross-device).

## A4. Lifecycle

The title flows through `title_status` like any component:

- **SMM** sets it via the dropdown (full freedom).
- Card enters **Kasper's queue** when `title_status === 'Kasper Approval'`
  (`_calCompKasperVisible` ~20600, with the caption's no-Linear rule). Title is added to
  `_kasperUndecidedComps` (~20667) so **"Finish reviewing"** requires a title decision.
- **Kasper** Approve → `Client Approval` (auto-advance) + stamps; Request change →
  `Tweaks Needed` + a Kasper tweak comment. (No Linear push — title has no issue.)
- **Client** Approve → `Approved` + `client_title_approved_at`; Request change →
  `Tweaks Needed` + a client tweak.
- **Edit after approval** → logged as an `edit_title` event; status unchanged unless the SMM
  changes it.

## A5. UI surfaces

1. **Sheet/organizer card:** a **title status pill** next to the `name` input
   (`_calTitleRowHtml` ~16782), opening the same status dropdown — shown only when the
   feature is on **and** the card is YouTube. Badged with a small YouTube glyph.
2. **Kasper & client review panels:** the review body is a hard 3-column grid
   (`.cal-review-body { grid-template-columns: repeat(3,…) }`, panels via
   `_calReviewPanelHtml` ~19818). When the title panel is present, switch to a **2×2 grid**
   and render a title panel (reusing the existing approve / request-change / thread markup;
   no Linear link; YT badge).
3. **Client view:** the title panel shows when `title_status === 'Client Approval'`. The
   card must be **visible to the client when the title is in client review** even if the
   other 3 components aren't client-ready — so the client-visibility gate (`_calIsClientReady`
   ~16419 is overall-only; the actual view filter) gets an **OR "title in client review."**
4. **Notes:** title comments appear in the Notes feed labeled **"Title"** automatically once
   `COMP_LABELS['title']='Title'` is set and the feed iterates `CAL_REVIEW_COMPONENTS`
   (`_calRenderCommentsModal` ~20796 / label at 20816).

## A6. Touch-point inventory (which list each site uses)

**Stay on `CAL_COMPONENTS` (overall status — exclude title):** `computeOverallStatus`
(~11340); `_calIsClientReady` (~16419); the overall-status recompute in the patch builder.

**Move to `CAL_REVIEW_COMPONENTS` (include title):** status-pill render (~16887,
`_calClientCompPillsHtml` ~16430); `_calReviewComponentActive` (~19378) + review-panel
iteration (~19804); Kasper visibility/undecided (~20600/~20616/~20667); Notes feed
(~20796); unread/seen (`_notesHasUnread` ~19450, `_kasperHasUnreadReply` ~19468,
`_calMarkKasperSawComp` ~19508); `_calFindCompForCommentId` (~21099); Kasper item
saving-state/drafts (~23654/~24404); `COMP_LABELS`/`COMP_PILL_COLORS` (~19347/19348, add
`title`).

**Seed / persist:** `_calMigratePostShape` (~11407) seeds `title_status` (default empty so
no pill shows when feature off) + loads `title_tweaks`; new-card template (~12112);
`_calFlushCardSave` patch builder (~17566) includes `title_status`/`title_tweaks`/
`client_title_approved_at`; `_CAL_ROLLBACK_FIELDS` (~17467); dedupe keys (~15987);
remote-change detection (~12281); recent-save tracking (~17687).

---

# PART B — Notes component picker + Linear routing

## B1. The problem

In the Notes modal, a **new** note is hardcoded to the `video` component and is **never
posted to Linear** (`_calAppendComment` ~21049, root comp = `'video'`; no
`_calPostLinearComment` call). So there's no way to leave a note *about the thumbnail* from
Notes, and Notes feedback never reaches the editor's Linear sub-issue. Only review-panel
**change-requests** currently reach Linear.

## B2. The feature

Add a **component picker** to the Notes-modal composer (`_calComposerHtml` ~20917) for a new
root note: **Video · Thumbnail · Caption · Title** (Title only when the Part-A feature is on
+ YouTube; options limited to components active on that card). Replies keep inheriting their
parent thread's component (no picker on replies).

`_calAppendComment` takes the chosen component instead of the hardcoded `'video'` and writes
to `<comp>_tweaks` (already persisted to Supabase + Sheet). **Routing to Linear:** after the
note is appended, if the component has a Linear issue, post it there via
`_calPostLinearComment(_calLinearUrlFor(post, comp), body, author)`:

- **Video** → `post.linear_issue_id`
- **Thumbnail (graphic)** → `post.graphic_linear_issue_id`
- **Caption / Title** → **no Linear** (Supabase only).

⚠️ **Gate explicitly on `comp ∈ {video, graphic}`** — `_calLinearUrlFor` (~11521) falls
through to the *video* id for any non-`graphic` comp (incl. caption), so we must not call it
blindly for caption/title.

`_calPostLinearComment` (~13074) is already async + fire-and-forget with a **retry outbox**
on failure, so routing is resilient and never blocks the save.

## B3. Decisions (Part B) — locked

1. **All video/thumbnail notes post to Linear** — both comments **and** change-requests, so
   the editor sees every piece of feedback on the sub-issue. *(chosen)*
2. **Replies also post to Linear** — a video/thumbnail thread carries its whole back-and-forth
   onto the issue. *(chosen)*
3. **Create-only:** editing / resolving / deleting a note does **not** sync to Linear (matches
   today's review behaviour). The Linear comment is a one-time post. *(chosen)*
4. **Audience-independent:** notes post to Linear **regardless** of the internal/client
   audience toggle (Linear is internal tooling; the toggle still controls in-app client
   visibility). *(chosen)*
5. **Picker defaults to Video** (preserves current muscle memory). *(chosen)*

## B4. Touch-points (Part B)

`_calComposerHtml` (~20917) add the picker + a `_calComposeComp` state var;
`_calAppendComment` (~21049) use the chosen comp + add the Linear-routing call;
`_calFindCompForCommentId` (~21099) iterate `CAL_REVIEW_COMPONENTS`. No new persistence
beyond Part A's `title_tweaks` (component notes already persist via `<comp>_tweaks`).

---

## Data / persistence (both parts)

New Supabase columns on `public.calendar_posts` (idempotent migration, like
`migrations/kasper-review-state-migration.sql`): `title_status`, `title_tweaks`,
`client_title_approved_at`. Add the same three to the n8n `calendar-upsert-post` `ALLOWED`
array. **Run the migration before editing `ALLOWED`** (same ordering rule as the
Kasper-state rollout — otherwise the Supabase mirror sends an unknown column and errors).
The Sheet auto-adds columns. Part B needs **no** new columns.

## Edge cases

- Feature off / non-YouTube card → no title pill, no Title picker option; behaviour 100%
  unchanged. Existing cards have empty `title_*` → nothing shows.
- Toggle off mid-review → hide title UI but **preserve** `title_*` data; toggling back on
  restores state.
- Cross-device → all new fields ride the existing upsert echo + Supabase realtime.
- A video/thumbnail with **no Linear issue linked** → the note saves to Supabase and simply
  isn't posted to Linear (no error; `_calPostLinearComment` no-ops on empty url).
- Overall status never gated by the title (a card can be `Approved`/`Posted` with its title
  still in review, and vice versa).

## Build order

**Phase 0 — backend (no-op until used):** Supabase migration (3 columns) → `ALLOWED` (3
names). 

**Phase A — title review:** list split (`CAL_REVIEW_COMPONENTS`) + audit the §A6 sites →
seed/persist (`_calMigratePostShape`, patch builder) → `COMP_LABELS`/colors + status subset
helper → per-client ⋮ toggle → title pill on the card → 2×2 review grid + title panel →
Kasper queue + undecided → client view + visibility OR → Notes "Title" label → audit
`round`/event log.

**Phase B — Notes picker + Linear routing:** composer picker + `_calComposeComp` →
`_calAppendComment` comp + Linear routing → `_calFindCompForCommentId` review list.

**Tests:** `test/title-review-lifecycle.js` (state across rounds; both routing paths; proves
`computeOverallStatus` untouched) and `test/notes-linear-routing.js` (comp targeting; Linear
called for video/graphic only, never caption/title; create-only). Mirror the existing
`test/kasper-review-state-global.js` / `calendar-v2-status-repro.js` harness style.

Each phase ships safe behind the off-by-default toggle (A) / is additive (B).

## Out of scope (v1)

- Title review for non-YouTube platforms; Linear for titles/captions (none exist).
- Title A/B testing, CTR analytics, AI title suggestions.
- Syncing Notes edits/resolves/deletes back to Linear (create-only).
- A per-card feature menu (toggle is per-client).

## Status of decisions

All decisions (Part A and Part B) are **locked** — see "Decisions captured" (§A2) and §B3.

## Implementation status (2026-06-17)

**Part A front-end — DONE & pushed** (off-by-default, safe). Foundation/data layer
(`CAL_REVIEW_COMPONENTS` split, `title_status`/`title_tweaks`/`client_title_approved_at`
in migrate + patch builder + rollback/dedupe/realtime tuples), the per-client ⋮ toggle,
the SMM title pill (trimmed status list), the SMM + client review panels (title preview,
2×2 grid), the Kasper queue + Kasper panels (hero + multi, auto-advance to Client), and
the Notes feed (title comments labeled "Title", full unread/seen). Title is Linear-safe
(`_calLinearUrlFor` → `''`). Guarded by `test/title-review-lifecycle.js` (proves the
overall-status invariant) + the full existing suite (all pass).

**Phase 0 backend — PENDING (needs you / sign-off):** run `migrations/title-review-migration.sql`
in Supabase, then add `title_status`, `title_tweaks`, `client_title_approved_at` to the
n8n `calendar-upsert-post` `ALLOWED` array (migration first). Until then the toggle is
off and the new fields are dropped by the upsert — no effect.

**Audit trail — DONE:** per-comment role/author/time/resolved + `client_title_approved_at`
+ `kasper_seen` (via reuse), **plus explicit `round` numbering** on every change-request
(`_calNextTweakRound`), surfaced as "Tweak #N" in the Notes feed + replies inbox. Guarded by
`test/title-review-lifecycle.js`.

**Deferred (not yet built):**
- `kind:'event'` lifecycle log entries (submit / approve / `edit_title` with old→new) — the
  `round` numbering above already covers "2nd / 3rd tweak"; a full system-event timeline is a
  further enhancement.
- A literal YouTube logo glyph on the title pill/panel (currently a red dot + "Title").
- **Part B** (Notes component picker + Linear routing) — separate phase, not started.

## Outstanding bugs — live QA (2026-06-17) → **ALL RESOLVED 2026-06-18**

The title feature is **verified working** in live testing (driven headlessly on the
**Sidney Laruel** test client against the live backend): `title_status`/`caption_status`
hold through every realtime reconcile; round numbering, echo-adopt and the title square
all behave; the title is excluded from the overall status through SMM, Kasper and client
title-review (approve / request-change / resolve), and every status + comment persists
across refresh and across tabs. The three open items below were reproduced, root-caused
against the real code + the live n8n workflows, fixed front-end, and re-verified live.
**Diagnostics:** append `&v2debug=1` for the `[calV2 …]` trace — `SAVE→` / `ECHO adopt` /
`RECONCILE adopt remote` / `RECONCILE keep LOCAL (stale Linear regress)` / `MERGE took
SERVER` / `MERGE kept LOCAL` / `COMMENT delete` + `COMMENT resurrection` / `BADGE refresh`.
Regression coverage: `test/calendar-v2-status-repro.js` sections E/F/G.

- **A. Video/thumbnail status reverts after a client approval — FIXED (front-end).**
  Root cause: `_calRecentSaveReconcile` adopted *any* server sub-status differing from
  both `wrote` and `base`. The Linear Status Sync (`MJbMZ789B5ExZz9x`) writes back **only**
  the bare sub-status of a **drifted** issue (no comment, never clearing
  `client_<comp>_approved_at`, never the overall status) — a third value the reconcile then
  adopted, reverting a fresh approval. Fix: `_calIsStaleLinearRegress` refuses to adopt a
  Linear-backed regress below Client Approval when we just advanced past it and there is no
  corroborating change-request comment; `loadCalendarPosts` re-asserts the kept value to
  Linear so the drift heals forward. Verified live (`RECONCILE keep LOCAL` fired; the
  approval held). **Backend guard — IMPLEMENTED + deployed 2026-06-18.** The durable half
  now lives in the Linear Status Sync (`MJbMZ789B5ExZz9x`, `Handle Linear Event` node):
  before writing a mapped sub-status it computes `linAt` (Linear's own `data.updatedAt`)
  and, per matched card, drops a write that would REGRESS a sub-status currently at/above
  Client Approval to below it when the card's `updated_at` is newer than `linAt`
  (`!(linAt > cardAt)`) — most-recent-action-wins, so a fresh calendar approval is never
  clobbered at source. Forward moves and Linear-newer regressions are unaffected; reports a
  `skippedFresh` count. Proven offline against the exact deployed code (decision unit test
  9/9 + end-to-end mock run 4/4); the node was character-verified after the push.
  Snapshot (Linear key redacted):
  `n8n-backups/linear-status-sync.2026-06-18.pre-freshness-guard.Handle-Linear-Event.js`.
  **Rollback:** republish n8n version `cedf2b13-ec20-4ce5-a601-f21b3f1840db` (new active
  version `3f99f865-bc1b-4b72-ab8f-6e153236100e`).
- **B. Deleting a plain comment sometimes needs ~3 tries — FIXED (front-end).** Root cause
  in the LWW take-server merge: `winner = Object.assign({}, fp, pend)` overlaid pend's
  `*_tweaks` STRING (the delete-tombstone) but left the parsed `*_comments` ARRAY as the
  server's live copy, which the comment merge + render read — silently resurrecting the
  deleted comment. Fix: re-run `_calMigratePostShape` on the merged row when pend carries a
  `*_tweaks`, so the tweaks string is re-parsed into the arrays and the tombstone wins.
  Verified live: a deleted comment stays gone across a forced take-server reload.
- **C. A client comment from the Review surface doesn't badge the SMM — FIXED (front-end).**
  Root cause: when the LWW merge keeps the local row (recent-save window), the incoming
  comment is unioned into that row IN PLACE, so `_calPostsEqualForRender` compares it to
  itself and reports `dataChanged = false` (a false negative) — the `!dataChanged`
  background branch was a no-op that refreshed nothing. Fix: refresh the Notes badges on
  that branch too. Verified live: the unread dot now lights even inside the recent-save
  window and cross-tab.

