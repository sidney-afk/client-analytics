# Content-Calendar Test Catalog

Exhaustive test inventory for the **SMM content calendar**, the **client
calendar**, and **Kasper review/messages**. Pair this with
`HEADLESS-TESTING-GUIDE.md` (how to run probes) — this file is the *what to
check*. It is built to be exhaustive **by construction**, not by memory.

> **Scope reminder (non-negotiable):** every action below runs against the LIVE
> backend. Only ever create/mutate the **`sidneylaruel`** ("Sidney Laruel") test
> client — including when working inside Kasper's cross-client tabs. Clean up
> everything you create (archive cards, tombstone comments).

---

## 1. The method — how this catalog is generated

Don't brainstorm scenarios. Take the **finite list of controls** (§4–§6) and
cross each one against the **lenses** below. Each (control × lens) cell is a test.
This is how "create a card with nothing", "archive then undo", and "text instead
of a Linear link" all fall out mechanically — they're *Create×empty*,
*Archive×inverse*, *Linear-field×invalid*.

### The lenses (apply every one to every control)
| # | Lens | The question it asks |
|---|------|----------------------|
| L1 | **Happy path** | Valid input → correct result, and it **persists on reload**. |
| L2 | **Empty / missing** | No input, blank, whitespace-only. Does it save junk? block? no-op cleanly? |
| L3 | **Invalid / wrong-type** | Garbage where structure is expected (text in a Linear field, letters in a date). |
| L4 | **Boundary** | 0, 1, max, very long, month/week/timezone edges, leap day. |
| L5 | **Inverse / undo / cancel** | The reverse action fully restores prior state (no residue). |
| L6 | **Interrupt mid-flight** | Start an async op, then cancel / switch client / navigate / change a dependency. |
| L7 | **Double-submit / idempotency** | Click twice fast; re-run the same write. One effect, not two. |
| L8 | **Multiplicity / bulk** | Select-many, bulk action; mixed eligible/ineligible items. |
| L9 | **Concurrency** | Two surfaces/devices act on the **same row** at the same time. |
| L10 | **Role** | SMM vs client vs Kasper — each can do what they should and **cannot** do what they shouldn't. |
| L11 | **Mode** | Collab on/off, title-review on/off, enabled-platforms set. Cross every relevant action. |
| L12 | **Every status** | Perform the action from **each** status the card/component can be in. |
| L13 | **Persist / refresh** | Survives reload; appears correctly when you re-open the card/tab. |
| L14 | **Cross-surface / realtime** | The change shows up correctly (and live) on the **other** surfaces. |

### Three test shapes to produce from it
1. **Scenario probes** — scripted flows for L1/L5/L6/L8/L9/L12/L14 (the catalog rows).
2. **Fuzz probes** — one parameterized probe per input field running the §3 batteries (L2/L3/L4).
3. **Matrix sweeps** — role×mode coverage (L10/L11), see §7.

---

## 2. Surfaces, statuses & vocabulary (so cases are precise)

- **Surfaces:** SMM (`#calendar/<slug>`), Client (`?c=<Name>&v=calendar`), Kasper (`?Kasper=1`).
- **Components** of a card: `video`, `graphic` (thumbnail), `caption`, `title` (YouTube, when title-review is engaged).
- **Status lifecycle** (per component / card): `In Progress → For SMM Approval → Kasper Approval → Client Approval → Approved → Posted`, plus `Tweaks Needed` and `Archived`. Drive actions from **each** of these (L12).
- **Modes:** Collaborative mode (kebab), Title review (kebab), Enabled platforms (Edit platforms).
- **Key controls** (confirmed in app): Create card, Edit fields, **Set all to…**, Generate caption / Generate all / Alternate, Edit caption prompt, Edit platforms, Drag-reorder (+ **Undo**), Multi-select → Archive (+ **Undo**), single Archive, **Reserve content / pick-and-pin / move-here / cancel**, Notes (component picker + audience), Sheet/Month/Week views, **All-months** + **All-content** filters, Collaborative-mode toggle, Title-review toggle, Kasper approve/request-change/approve-after-tweaks/comment (+ **Undo approve**), Kasper Messages inbox (reply / mark-as-read / show-all).

---

## 3. Input fuzz batteries (reuse for every field — covers L2/L3/L4)

Feed each into the field, save, reload, and assert: **no JS error**, **no data
corruption**, the value is either stored faithfully or rejected cleanly (never
silently mangled), and **nothing renders as live HTML** (XSS).

- **TEXT battery** (name, caption, title, note body): `""` · `"   "` (spaces) ·
  `"normal"` · 2000-char string · `"🎉 مرحبا 日本語"` (emoji/RTL/CJK) ·
  embedded newlines · `"<script>alert(1)</script>"` · `"\"></div><b>x"` ·
  `"'; DROP TABLE--"` · leading/trailing spaces · zero-width/​control chars.
- **LINEAR battery** (video / thumbnail link field): a **valid** Linear issue URL ·
  a valid Linear URL belonging to **another client/team** (must NOT cross-link) ·
  **plain text** (your example) · a non-Linear URL (`https://google.com`) ·
  malformed (`http://`, `linear.app/`) · `""` · whitespace · the **same** valid
  Linear URL used on **two cards** (dedupe behaviour — see §6).
- **DATE battery** (scheduled_date): valid · `""` · `"not-a-date"` · far past ·
  far future (`2099-12-31`) · leap day (`2028-02-29`) · **month edge** (1st & last
  of month) · **week edge** (Sat/Sun boundary) · a date in a different month than
  the active filter (undated/other-month visibility, §4.7).
- **PLATFORMS set:** none selected · exactly one · all · a set, then **remove a
  platform after** content/notes exist on it (e.g. remove YouTube after a title is
  in review — §5).
- **TIMEZONE:** run date-rendering cases under `America/Argentina/Buenos_Aires`
  (and one Pacific tz) — the off-by-one class only shows in the Americas.

---

## 4. SMM content calendar — action catalog

Each bullet is a flow; apply the lenses noted. ✅ = assert it persists on reload
**and** reflects on client/Kasper where relevant (L13/L14).

### 4.1 Create card
- [ ] Create with **nothing** (no name/date/platforms) → does it save? appear? is a blank card valid or rejected? (L2) ✅
- [ ] Create with name only; name + date; name + date + platforms; + Linear video link; + Linear thumbnail link. (L1) ✅
- [ ] Create with the **LINEAR battery** in the video field, then the thumbnail field. (L3) Especially **plain text instead of a link**, and **another client's** Linear URL.
- [ ] Create two cards with the **same** Linear video link → dedupe/merge behaviour, and which one wins on reload. (L9-ish) ✅
- [ ] Rapid double-click "create" → one card, not two. (L7)
- [ ] Create on client surface with collab **off** (should be blocked) and **on** (allowed). (L10/L11)

### 4.2 Edit card fields (name, date, platforms, video, thumbnail, caption, title)
- [ ] Each field with the matching §3 battery. (L2/L3/L4) ✅
- [ ] Edit, then **reload before the save settles** — does the edit survive? (L13)
- [ ] Edit the **same field on two surfaces** within the trust window. (L9)
- [ ] Edit a field, then immediately switch client → write must not land on the wrong client. (L6)

### 4.3 Statuses & "Set all to…"
- [ ] Move each component (video/graphic/caption/title) through **every** status transition. (L12) ✅
- [ ] **Set all to…** each target value; with the skip-key/modifier held; on a card missing a component; on an archived card. (L8/L12)
- [ ] Status change reflects live on client & Kasper (e.g. → Kasper Approval makes it enter Kasper's queue, with the content gate). (L14)
- [ ] Set a component to Kasper Approval **without** an asset/thumbnail → does/should it appear in Kasper's queue? (content gate, L3/L12)

### 4.4 Captions
- [ ] Generate caption (single) — happy path; result persists; shows on client. (L1) ✅
- [ ] **Generate then click Cancel** mid-flight — no caption lands, UI says cancelled, and a late result doesn't sneak in. (L6)
- [ ] **Edit the caption manually during generation** — which wins? is the generated one dropped silently? (L6)
- [ ] **Alternate caption** / regenerate — does it replace or append? prior caption recoverable? (L5)
- [ ] **Bulk "Generate all"** — partial failures don't fail the batch; concurrency cap holds; per-card results land on the right cards. (L8)
- [ ] **Switch client mid-generation** — result lands on the originating client only. (L6/L9)
- [ ] Generate, then **archive the card** before it returns. (L6)
- [ ] **Edit caption prompt** (per client), then generate → the *custom* prompt is used, not the default (regression: empty-prompt fallback). (L1)
- [ ] Empty / very-long / emoji / `<script>` generated or pasted caption renders safely. (L3)
- [ ] Generate with **no platforms** / no YouTube selected. (L11)
- [ ] Tab hidden during a long generation — poller behaviour. (L6)

### 4.5 Drag / reorder
- [ ] Drag within a month; **across months**; across week boundaries. (L1/L4) ✅
- [ ] Drag, then **Undo** → exact prior order restored. (L5)
- [ ] Drag, then **reload** → order persists (no snap-back; watch the hidden-card slot-collision class). (L13)
- [ ] Drag a **filter-hidden** vs visible card; drag in Sheet vs Month vs Week. (L11)
- [ ] Drag on client surface: collab off (blocked) vs on (allowed). (L10/L11)
- [ ] Two surfaces reorder the same strip concurrently. (L9)

### 4.6 Multi-select → Archive / single Archive / Undo
- [ ] Enter select mode, pick several, **Archive** → all vanish, persist on reload, removed from client/Kasper. (L8) ✅
- [ ] Bulk archive, then **Undo** → all restored to prior positions/status. (L5)
- [ ] **Shift-range** select → only the **visible** cards in range (not filter-hidden ones). (L8 regression)
- [ ] Select cards, then **switch client** / **change view** → selection clears (no cross-client archive). (L6 regression)
- [ ] Archive a **single** card; archive a card that's **currently in Kasper's queue** → it leaves Kasper too. (L14)
- [ ] Archive 30+ cards → bounded concurrency, no request storm; UI stays optimistic. (L8)
- [ ] Double-click Archive / Undo. (L7)

### 4.7 Views & filters
- [ ] **Sheet / Month / Week** each render the same data correctly; default Sheet shows **All months** (not just current). (L1 regression) ✅
- [ ] **All-months** vs a specific month: an **undated** card and an **other-month** card behave correctly (undated shouldn't masquerade under a concrete month). (L3/L4)
- [ ] **All-content** vs a specific type filter. (L1)
- [ ] Filter + scroll + selection **persist** across reload and view switches. (L13)
- [ ] Month/Week boundary dates render correctly in an Americas timezone. (L4/L14)

### 4.8 Reserve content / pick-and-pin / move-here / cancel
- [ ] Reserve a slot, **move-here** → lands correctly; **cancel** → no residue. (L5/L6) ✅
- [ ] Reserve in collab mode as client. (L10/L11)
- [ ] Reserve then reload. (L13)

### 4.9 Notes / comments (component picker + audience)
- [ ] Write a note on **each** component (video/thumbnail/caption/title), audience **Kasper/team** vs **Client**. (L1/L11) ✅
- [ ] Internal note **does not** appear on the client surface; client note **does**. (L10/L14)
- [ ] **Video/thumbnail** note routes to its **Linear** sub-issue; caption/title notes do **not**. (L14)
- [ ] Reply to a thread (inherits component + audience); resolve; reopen; delete. (L5)
- [ ] Internal SMM note appears in **Kasper → Messages**, labeled "New from Team", newest-first. (L14)
- [ ] Unread dot logic: appears for messages you didn't write; clears on open; doesn't over-clear. (L1)
- [ ] `<script>`/long/emoji note body renders safely. (L3)
- [ ] Note on a card, then **archive** the card. (L6)
- [ ] Client posts a **change-request** (flips status) vs a **comment** (doesn't). (L10/L12)

### 4.10 Kebab modes
- [ ] **Collaborative mode** on/off; toggle reflects on client (collab unlocks client create/drag/reserve). (L11/L14) ✅
- [ ] **Title review** on/off; toggle **syncs across devices** (regression: title switch desync). (L11/L14)
- [ ] **Edit platforms**: select none / one / all; persists to the **shared settings row** so the **client sees icons** and a second SMM device matches (regression: was localStorage-only). (L11/L14) ✅
- [ ] Saving an **empty** platform set → strip/per-card toggles behaviour. (L2)
- [ ] Fast double-toggle (collab then title) → both land, no clobber after the trust window (regression: settings serialize). (L7/L9)

---

## 5. YouTube title-review — its own section (lots of interactions)
- [ ] Turn title-review **on** → title becomes a review component; appears in Kasper. (L11) ✅
- [ ] **Send a title for review, then change the title afterward** — does the in-review title update, strand, or desync? what does Kasper see? (L6 — your example)
- [ ] **Remove YouTube from the card mid-title-review** → `title_status` shouldn't strand unreachable. (L6 regression-flag)
- [ ] Kasper approves / requests-change on the **title** specifically. (L12/L14)
- [ ] Title note repaints the Review tab live (regression: `title_comments` in re-render gate). (L14)
- [ ] Title-review **off** while a title is mid-review. (L6/L11)
- [ ] TEXT battery in the title field. (L3)

---

## 6. Cross-surface & interaction scenarios
- [ ] **SMM edit → client live update** (status, caption, platforms, date) without reload. (L14) ✅
- [ ] **Client comment / approval → SMM** sees it live; **Kasper approval → client** Approval state. (L14)
- [ ] **Same Linear sub-issue on two cards** (your example): dedupe winner, archived-vs-active precedence, and a note routed to that Linear issue. (L9)
- [ ] **Settings sync**: collab / title-review / platforms set on one surface reflect on the others (and across two SMM devices). (L11/L14)
- [ ] **Kasper "approve after tweaks"** → editor fixes → routes straight to client (no Kasper re-review). (L12/L14)
- [ ] **Reserve/move-here on SMM** vs what the client sees in collab. (L11/L14)
- [ ] A card that is simultaneously **archived on SMM** while **Kasper acts on it**. (L9)

---

## 7. Role × Mode matrix (L10/L11) — run as a sweep

For each cell, assert **allowed actions succeed** and **forbidden actions are
truly blocked** (button hidden/disabled **and** the underlying write rejected —
test both the UI and a direct call where feasible).

| Action | SMM | Client (collab OFF) | Client (collab ON) | Kasper |
|---|---|---|---|---|
| Create / drag / reserve card | ✅ | ⛔ | ✅ | n/a |
| Edit fields / Set-all / Generate caption | ✅ | ⛔ | ⛔ (unless designed) | n/a |
| Archive / Undo | ✅ | ⛔ | ⛔ | n/a |
| Edit platforms / prompt / kebab modes | ✅ | ⛔ | ⛔ | n/a |
| Comment (client-audience) | ✅ | ✅ | ✅ | ✅(internal) |
| Request change | ✅ | ✅ | ✅ | ✅ |
| Approve component | (routes) | ⛔ | ⛔ | ✅ |
| See internal/Kasper threads | ✅ | ⛔ | ⛔ | ✅ |
| Act on **another** client's card (Kasper tabs) | — | — | — | ⛔ (must no-op) |

Cross each "✅/⛔" with: button state, direct-call rejection, and persistence.

---

## 8. Concurrency & robustness (L7/L9) — the subtle bugs live here
- [ ] Two surfaces add a **comment to the same thread** at the same second → no lost message, no tombstone resurrection (atomic merge — already fixed; keep as regression). 
- [ ] Two devices **toggle the same setting** in the same second (cross-device settings race — known caveat). 
- [ ] Rapid **double-submit** on: create, archive, undo, approve, reply, generate. (L7)
- [ ] Edit a card while a **realtime refresh** lands (don't drop the in-flight edit / half-typed note). 
- [ ] Kasper **mark-as-read** while a newer unread message exists on another component (don't over-mark). 
- [ ] Network failure mid-write → optimistic value reconciles to backend truth after the trust window (no permanent phantom). 

---

## 9. The specific tricky cases you called out (don't lose these)
- [ ] Create a card and save **nothing** → does it persist?
- [ ] Archive a card → **is it actually gone** (reload + client + Kasper)?
- [ ] Drag cards around → persists + Undo.
- [ ] Write a caption, then write an **alternate** caption.
- [ ] Multi-select → **Archive** → then **Undo**.
- [ ] **Edit platforms** → client sees the icons.
- [ ] **Generate caption → Cancel.**
- [ ] **Set all to…** → then do something else.
- [ ] **Send a YouTube title for review → then change the title.**
- [ ] Put a Linear sub-issue link in the video → **move-here / cancel**.
- [ ] Put **plain text** where a Linear sub-issue link goes.
- [ ] Same Linear link on the video of **two** cards.
- [ ] Collaborative mode **on vs off** → client↔SMM interactions.

---

## 10. Coverage checklist (tick when a green probe exists)
- [ ] §4 SMM calendar — all subsections
- [ ] §5 Title review
- [ ] §6 Cross-surface
- [ ] §7 Role × Mode matrix
- [ ] §8 Concurrency
- [ ] §3 Fuzz battery run on every input field
- [ ] Every probe asserts **0 JS errors** and **cleans up** its Sidney data
- [ ] Pre-push ritual (guide §6) green before any push
