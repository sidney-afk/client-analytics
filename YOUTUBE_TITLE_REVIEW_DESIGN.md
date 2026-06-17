# YouTube Title Review — Design Spec

**Status:** Draft for sign-off (Sidney + Kasper) · **Date:** 2026-06-17
**Owner area:** Calendar → per-card title, Kasper review, client review

---

## 1. The problem (in one line)

For YouTube, the **title** is a first-class deliverable (it drives CTR), but today the
card's title is just a plain `name` text box with **no review, no approval, and no
history** — so there's no way for the SMM to send a title to Kasper, and then the client,
for sign-off.

## 2. What this feature does

Adds an **opt-in, YouTube-only title review lifecycle** to a calendar card:

1. The SMM can **send the title for review** (one button on the card).
2. **Kasper approves** it (or requests a change). On approval it **auto-advances to the
   client**.
3. The **client approves** it (or requests a change).
4. **Everything is tracked** — who did what, when, and on which revision round — so there
   is a complete, auditable history with no room for error.

### Guiding constraint (why this is the safe design)

The title review is a **parallel lifecycle that never touches the card's overall status.**
It is **not** a new component in `CAL_COMPONENTS` and **never enters `computeOverallStatus`**
(`index.html` ~11338) or the `*_status` set. There is **no `title_status` field and no new
status value.** State is **derived from timestamps + an event log** — the same proven
pattern as the existing `kasper_approved_at` / `kasper_finished_at` / `kasper_closed_at`
stamps.

Consequence: the title can be in any review phase while the card's overall status
(`Approved`/`Posted`/`Archived`, the archived/posted gating, Linear push, "done-ness"
warnings) is **completely unaffected**. All 617 existing cards and every non-YouTube
client are untouched, because every new field is additive and optional.

---

## 3. Decisions captured (this session)

- **Approach:** Option B — **timestamps + event log, no new status**, out of
  `computeOverallStatus`. *(chosen)*
- **Title does NOT affect overall card status.** *(confirmed)*
- **Toggle:** **per-client**, in the existing global ⋮ menu, cross-device — mirrors
  "Collaborative mode." *(chosen)*
- **Applies to YouTube cards only** (`_calPostPlatforms(post)` includes `youtube`), badged
  with a small YouTube logo. *(chosen)*
- **On Kasper approval → auto-advance to client review.** *(chosen)*
- **After a CLIENT change request + SMM revision → straight back to the client** (skip
  Kasper). After a **Kasper** change request + revision → back to **Kasper**. Re-review
  routing keys off **who raised the change.** *(chosen)*

---

## 4. Data model

### 4a. New per-card fields (additive, back-compatible)

All added to the n8n `calendar-upsert-post` **`ALLOWED`** list, the Supabase
`calendar_posts` table, and the Google Sheet mirror — exactly like the `caption_*` and
`kasper_*_at` fields already are.

| Field | Type | Meaning |
|---|---|---|
| `title_submitted_at` | text (ISO ts) | When the SMM last sent the **current** title for review. Bumped on every (re)submit; marks the start of a round. |
| `title_kasper_approved_at` | text (ISO ts) | When Kasper approved the current title. |
| `title_client_approved_at` | text (ISO ts) | When the client approved (terminal). |
| `title_comments` | text (JSON array) | The **thread + audit log**. Same comment object shape as `caption_comments`, with two small additions (`round`, `kind`). |

**No `title_status`.** State is derived (see §5).

### 4b. The `title_comments` entry shape

Reuses the existing comment object (so it inherits thread rendering, role colors,
resolved/seen tracking) and adds two fields:

```js
{
  id, parent_id,
  role: 'smm' | 'kasper' | 'client',   // WHO
  author,                               // display name
  is_tweak: boolean,                    // true = a change request
  audience: 'internal' | 'client',
  body,                                 // the note (for tweaks/comments)
  created_at, updated_at,               // WHEN
  done, done_at, done_by,               // resolution tracking (existing)
  // NEW:
  round: integer,                       // which revision round this belongs to
  kind: 'comment' | 'event',            // 'event' = a system lifecycle entry
  action,                               // for events: 'submit' | 'kasper_approve' |
                                        //   'client_approve' | 'request_changes' |
                                        //   'edit_title' | 'reopen'
  to,                                   // for 'submit' events: 'kasper' | 'client'
  from_value, to_value                  // for 'edit_title': old → new title text
}
```

- **Human discussion / change requests** are normal comments (`kind:'comment'`,
  `is_tweak` true for change requests).
- **Lifecycle moments** (submit, approvals, edits) are logged as `kind:'event'` entries so
  the thread reads as a complete chronological history in one place.
- The three scalar stamps in §4a are **denormalized fast pointers** for the headline state
  (cheap to render, ride realtime); the log is the **full audit trail** and is JSON, so
  new actions/fields cost nothing and need no migration (the "details we haven't thought
  of yet" headroom).

### 4c. The per-client enable flag

Stored where "Collaborative mode" persists (cross-device, per client), surfaced as a
toggle in the global ⋮ menu (`index.html` ~15523). Default **off**. When off, no title
review UI renders and the feature is a complete no-op.

---

## 5. The derived state machine

A single helper `_titleReviewState(post)` is the **only** source of truth for the chip and
the review panels, so they can never disagree.

Let `S = title_submitted_at`, `K = title_kasper_approved_at`,
`C = title_client_approved_at`, `openTweak` = the latest `is_tweak && !done` entry,
`lastSubmit` = the latest `kind:'event', action:'submit'` entry (carries `to`).

| Phase | Condition | Waiting on | Chip |
|---|---|---|---|
| **disabled** | feature off OR card not YouTube | — | *(nothing)* |
| **draft** | no `S` (never sent), or title edited after approval (`reopen`) | SMM | "Send for review" |
| **changes_requested** | `openTweak` exists | SMM | "Changes requested by Kasper/Client" (+ round) |
| **in_kasper_review** | `lastSubmit.to === 'kasper'` and not yet K-approved this round | Kasper | "In review · Kasper" |
| **in_client_review** | (K ≥ S, auto-advanced) OR `lastSubmit.to === 'client'`, not yet C-approved this round | Client | "In review · Client" |
| **approved** | `C ≥ S` | — | "Approved ✓" |

**Round** = number of `submit` events (1 on first send, 2 on first resubmit, …). Every
comment/tweak/event is tagged with the current round, so "2nd tweak / 3rd tweak" is a
stored fact, not a guess.

### Transitions (who writes what)

| Action | Actor | Writes |
|---|---|---|
| **Send for review** | SMM | `title_submitted_at = now`; `submit` event `{to:'kasper', round}` |
| **Approve** | Kasper | `title_kasper_approved_at = now`; `kasper_approve` event → auto-advance to client |
| **Request change** | Kasper | `is_tweak` comment `{role:'kasper', round}` + `request_changes` event → phase `changes_requested` (back to SMM) |
| **Resubmit after Kasper tweak** | SMM | resolve the tweak; `title_submitted_at = now`; round++; `submit` event `{to:'kasper'}` → back to Kasper |
| **Approve** | Client | `title_client_approved_at = now`; `client_approve` event → **approved** |
| **Request change** | Client | `is_tweak` comment `{role:'client', round}` + `request_changes` event → `changes_requested` (back to SMM) |
| **Resubmit after Client tweak** | SMM | resolve the tweak; `title_submitted_at = now`; round++; `submit` event `{to:'client'}` → **straight back to client** |
| **Edit an approved title** | SMM | `edit_title` event `{from_value,to_value}`; phase → `draft` (re-review required) — prevents an approved title silently drifting |

The skip-Kasper routing is encoded entirely by `lastSubmit.to` in the log — no extra
status field.

---

## 6. UI surfaces (three touch-points)

### 6a. Sheet/organizer card — the title row
Next to the existing `name` input (`_calTitleRowHtml` ~16782), when the feature is on and
the card is YouTube:
- A small **derived-state chip** (phase + round) with a **YouTube glyph**.
- For the SMM: a **"Send title for review"** button (enabled only when the title is
  non-empty and phase is `draft`/`changes_requested`).

### 6b. Kasper & client review panels — 2×2 grid
The review body is currently a hard 3-column grid
(`.cal-review-body { grid-template-columns: repeat(3, …) }`, panels via
`_calReviewPanelHtml` ~19818). When a title panel is present, switch the grid to **2×2**
(`repeat(2, …)`) and render a **title panel** reusing the existing thread / approve /
request-change rendering, badged YouTube.
- **Kasper queue:** add a title predicate to `_calPostKasperVisible` (~20616) so a card
  surfaces when `phase === 'in_kasper_review'`. Add the title to `_kasperUndecidedComps`
  (~20667) so **"Finish reviewing"** requires a title decision — nothing slips through.
  Re-surfacing on resubmit works for free (a new `submit` event is a new message, which the
  existing `kasper_finished_at` logic already treats as a fresh ask).
- **Client view:** title panel shows when `phase === 'in_client_review'`. Client
  **Approve** writes `title_client_approved_at`; **Request change** writes a client
  `is_tweak`. The card must be **visible to the client when the title is in client review**
  even if the other components aren't client-ready yet — extend the client-visibility gate
  (`_calIsClientReady` ~16419) with an OR for "title in client review."

### 6c. Visual language
Reuse `.cal-review-panel*` / `.kcard-*` tokens so the title panel feels native. The YouTube
badge is a small inline logo on the chip and the panel head.

---

## 7. Edge cases

- **Non-YouTube card / feature off** → no title UI; existing behavior 100% unchanged.
- **Empty title** → "Send for review" disabled.
- **Feature toggled off mid-review** → hide the UI but **preserve** all `title_*` data;
  toggling back on restores the exact state.
- **Existing cards** (no `title_*` fields) → phase `draft`/`disabled`; nothing renders
  unless YouTube + enabled.
- **Cross-device** → all four fields ride the existing upsert echo + Supabase realtime, so
  every device shows the same state (same mechanism as `kasper_*_at`).
- **Overall status** → never gated by the title. A card can be `Approved`/`Posted` with its
  title still in review, and vice versa (confirmed acceptable).

---

## 8. Build order (once approved)

1. **Backend (no-op until enabled):** add the 4 columns to Supabase (idempotent migration,
   like `kasper-review-state-migration.sql`); add the 4 names to the n8n `ALLOWED` list;
   Sheet auto-adds columns. **Run the migration before adding to `ALLOWED`** (same ordering
   rule as the Kasper-state rollout).
2. **Data layer:** `_titleReviewState`; load `title_comments` in `_calMigratePostShape`
   (~11407); include the new fields in the `_calFlushCardSave` patch builder (~17566).
3. **Per-client toggle** in the ⋮ menu (mirror `_calIsCollabOn`).
4. **SMM title-row chip + Send for review.**
5. **Kasper review:** 2×2 grid + title panel + queue predicate + `_kasperUndecidedComps`.
6. **Client review:** title panel + approve/request-change + client visibility.
7. **Audit log:** `event` entries, `round` tracking, `edit_title` stale detection.
8. **Regression test** `test/title-review-lifecycle.js` (mirroring
   `test/kasper-review-state-global.js` + `calendar-v2-status-repro.js`): assert the state
   machine across multiple rounds and both routing paths (Kasper-tweak→Kasper,
   client-tweak→client), and that `computeOverallStatus` is provably untouched.

The FE ships safe behind the off-by-default toggle, so steps 3–7 can land incrementally.

---

## 9. Out of scope (v1)

- Title review for non-YouTube platforms.
- Linear integration for titles (titles, like captions, have no Linear issue).
- Title A/B testing, CTR analytics, or AI title suggestions.
- A per-card menu (the toggle is per-client; there is no per-card ⋮ today).
