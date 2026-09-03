# Action history — making every action on a card retrievable, 2026-09-03

**Status:** strategy, owner-gated. Nothing here has been executed.
**Companion:** `docs/independence/LINEAR_EXIT_PLAN_2026-09.md`. The two overlap in one
place only (§9), and neither blocks the other.

Every number below was measured live, read-only, on 2026-09-03 (16:45–16:55Z) with the
browser publishable key. Where the key cannot read a table the row says **unreadable**
rather than guessing.

---

## 1. The one-paragraph version

There already are three append-only ledgers — one per surface — and together they hold
184,042 rows going back to 2026-06-25. They are better than nothing and much worse than
the owner believes. They record **that** a status moved and **who** moved it; they do
not record **what anyone wrote**, they do not record **field edits at all**, on Samples
they lose the actor on 70% of rows, they are written best-effort by application code
that several live writers bypass entirely, and **nothing in the app ever displays them**.
The one place a body is genuinely kept — Production comments — is deliberately hidden
from the browser by an RLS policy, and the function that would render its history has
been written and never called. On top of that, the two card tables behind four of the five
surfaces named — `calendar_posts` and `sample_reviews` — are **in no verified backup**,
and PITR is off by an earlier owner decision. So today, "someone wrecked a card, get it back" has no answer. The fix
is mostly one migration: move recording from the application into the database, where
nothing can bypass it.

---

## 2. What exists today

| Surface | Ledger | Rows | Written by | Actor quality |
|---|---|---|---|---|
| Content Calendar (staff, Kasper's board, client review page) | `calendar_post_events` | 35,020 since 2026-07-04 | `calendar-upsert` + `calendar-reorder`, best-effort | 1,739 rows (5.0%) have no actor; the rest carry an **unauthenticated** name (G3) |
| Samples calendar | `sample_review_events` | 57,919 since 2026-06-25 | `sample-review-upsert` + `sample-review-reorder`, best-effort | **40,421 rows (69.8%) have no actor** |
| SyncLinear (Production tab) | `deliverable_events` | 91,103 | `production-write` / `production-comments` + a database trigger backstop | 6,884 rows (7.6%) have no actor |

Current write rate, last 7 days: calendar 4,969 · samples 4,363 · deliverables 10,306.
About 20k events a week, ~1M a year. Storage is not a constraint anywhere in this plan.

All three tables carry the same shape: `action, actor, role, component, from_status,
to_status, payload, source, ts`. That shape is fine. The problem is what never reaches it.

---

## 3. The seven gaps

### G1 — Comment bodies are never recorded on the Calendar or Samples

`calendar-upsert` detects comment changes by diffing the ids inside the `*_tweaks` cell
and writes `payload: {added: [id]}` or `{deleted: [id]}`. The **text is not in the event
row**, and the text it replaced is gone: `video_tweaks` / `graphic_tweaks` /
`caption_tweaks` / `title_tweaks` are whole-cell overwrites, so an edit or a delete
destroys the previous body with no copy anywhere.

There is also **no `comment_edit` action at all** on either surface — editing a comment
in place produces no event of any kind.

Lifetime: 3,657 `comment_add` and 173 `comment_delete` on the Calendar, 3,309
`comment_add` on Samples. Every one of those bodies is unrecoverable today.

### G2 — Field edits are not recorded at all

`buildEvents` emits events for exactly seven things: create, overall status change,
per-component status change, client approvals, Kasper approve/finish/close, the urgent
ping, Linear link set/clear, and comment id adds/deletes. **Nothing else.** Retyping a
caption, changing the scheduled date, renaming a card, swapping the asset URL, replacing
the thumbnail, editing the CTA, changing the platform — all silent. The card simply has
a new value and no record that it ever had another one.

This is the gap that matters most for the owner's actual question, because "someone
changed something and I want it back" is usually a field, not a status.

### G3 — Attribution is unreliable, and unreliable in different ways per surface

Three different attribution models are live at once:

- **SyncLinear** is the good one. `production-write` requires an `x-syncview-actor` that
  resolves to **exactly one** active `team_members` row compatible with the presented
  role key, and persists both the person's name and `actor_key = member:<id>`. It
  refuses with `roster_actor_required` / `roster_actor_not_unique` rather than guessing.
- **The Calendar** persists whatever name the browser asserted, and **nothing
  authenticates it.** `AGENTS.md`'s frozen block records that `calendar-upsert` and
  `sample-review-upsert` are deliberately un-gated (open / tokenless) by owner decision
  from 2026-07-15, so clients' existing review links keep saving. The
  `authorizeBrowserWrite` call at `supabase/functions/calendar-upsert/index.ts:501` is
  therefore **repo source that is not what runs**: `docs/ops/EF_DEPLOY_MANIFEST.md` lists
  `calendar-upsert` as **NO CI DEPLOY PATH**, and the live rows carry the tokenless
  shape (`actor: "<person name>"`, `source: "ui"`) rather than the shape that code would
  mint (`staff:<role>`, `source: "calendar-upsert"`). Live sample of the most recent 300
  rows: 297 carry a person name, 3 carry none. No `actor_key`, no roster check, and no
  credential behind the name — **it is an unauthenticated claim.**
- **Samples** loses it outright on whole classes of action. In the most recent 300 rows,
  145 have no actor; the actions that lose it are `create`, `link_set`, `archive` and a
  large share of `status_change`. Lifetime that is 40,421 of 57,919 rows.

So on Samples the honest answer to "who archived this?" is, for most rows, *nobody
knows*; and on the Calendar the honest answer is "whoever the browser said", which is not
the same as knowing. Only the SyncLinear lane can answer it with evidence.

### G4 — The ledger is best-effort, and several live writers bypass it

`calendar-upsert` inserts its events through `waitUntil(insertEvents(...))` with the
promise's rejection swallowed (`p.catch(() => null)`). A failed insert loses the event
silently and the write still succeeds. Same shape on the samples side.

Worse, the ledger is application-level, so anything that writes the table another way
leaves no trace:

- `linear-inbound` writes `calendar_posts` and `sample_reviews` directly to backfill
  `video_deliverable_id` / `graphic_deliverable_id` — **zero** `calendar_post_events`
  emissions in that whole function.
- `scripts/linear-sync-reconcile.js` routes through the Edge Function only for clients
  on the `calendar_upsert_ef_clients` flag (43 slugs against 43 active clients — i.e.
  everyone). But its flag read is `try/catch`, and **on any read failure it
  sets the enrolled set to empty and sends every client down the n8n webhook instead**,
  which writes the row and no event. One flaky read = one unrecorded reconciler run.
- Any future migration, admin script, or SQL console fix writes silently.

`deliverables` does not have this problem, and the reason is instructive: migration
`2026-07-06-b1-linear-data-model.sql:239` installs
`track_b_deliverable_ledger_guard()`, an `AFTER INSERT OR UPDATE` trigger that writes a
`deliverable_events` row tagged `reason: rpc_bypass_guard` for anything that did not
already set `app.event_written`. **The pattern to copy already exists in this repo.**

### G5 — The one complete record is invisible to the app

`production_comments` plus the body-bearing `deliverable_events` rows are the only place
full comment text is retained across an edit. They are then hidden: the restrictive
policy `protect production comment event bodies`
(`migrations/2026-07-12-production-comments.sql:158-171`) removes every
`comment_add|edit|delete|resolve|unresolve|link_*` row carrying an `event_key` from anon
and authenticated SELECT, and `production_comments` itself returns 42501 to the browser
key. That is a correct decision — those bodies should not be world-readable from a
public page — but it means the good record is unreachable by the only client we have.

And `_prodActivity(events)` — a complete, finished renderer that turns those events into
a twelve-row activity feed — exists at `index.html:59255` with **zero call sites**. The
data it needs (`_prodState.events`) is already fetched and already used by
`_prodStatusBreakdown` for the status tooltip.

### G6 — Neither calendar surface is in a verified backup, and PITR is off

The `Track-B private backup` action is real, HMAC-signed, restore-rehearsed, and runs
every six hours — over a **fixed 14-table allowlist** (`scripts/track-b-backup.js:42`):
`team_members, clients, client_access, client_access_events, syncview_auth_events,
syncview_runtime_flags, flag_flips, settings_events, batches, deliverables,
production_comments, deliverable_events, mirror_outbox, linear_archive`.

Not in it: `calendar_posts` (9,819 rows), `sample_reviews` (6,594 rows),
`calendar_post_events`, `sample_review_events`.

The only other coverage is the weekly n8n graph, which `CUTOVER_AUDIT_2026-07-13.md` F13
already ruled **non-evidence** (it substitutes `[]` for a failed table dump and reports
success). The repo's own archived copy of it dumps `calendar_posts` and
`content_samples` and no event table at all.

PITR is owner-declined and recorded as accepted residual risk
(`docs/ops/TRACK_B_BACKUP.md:201`).

Put plainly: **if a card on the Content Calendar or the Samples calendar is wrecked
today, there is no snapshot to restore it from.** That is independent of the ledger gaps
and is the single most expensive item in this document.

### G7 — Nothing renders any of it

There is no history panel, timeline, or "what changed" view on any of the five surfaces
the owner named. The single exception is `_prodStatusBreakdown`, which turns
`deliverable_events` into a "In progress 2d, For SMM 4h" string inside the SyncLinear
status tooltip — four segments, durations only, no actor, no date, no other action
type. Everything else is retrievable only by someone with service-role access writing a
query. The ledgers are, functionally, write-only.

---

## 4. What "retrievable" has to mean

The test this plan is built against. For **any** card, on any of the five surfaces, the
owner should be able to answer:

1. What did this card look like on <date>?
2. Who changed <this field>, from what, to what, and when?
3. What did that comment say before it was edited or deleted?
4. Which of these changes came from a person, and which from an automation?
5. Can I put it back?

Today: 1 is no, 2 is status-only, 3 is no on two of three surfaces, 4 is yes-ish, 5 is
no. The steps below take them to yes/yes/yes/yes/yes in that order of difficulty.

---

## 5. The plan

Five steps. Each is independently shippable and independently useful — there is no
big-bang here, and stopping after step 1 still leaves the system much better off than it
is now.

### Step 1 — Move recording into the database (one migration)

A `BEFORE UPDATE` trigger on `calendar_posts` and `sample_reviews` that, when the row
actually changes, writes one event row carrying:

- the **previous value** of any `*_tweaks` cell that changed (this closes G1 completely,
  including edits, without needing a `comment_edit` action to be invented in app code);
- a **column allowlist** diff of business fields, recorded as `{col: {from, to}}` (this
  closes G2). The allowlist must be **derived from each writer's own writable-column
  constant**, not hand-written: a first hand-written draft of this plan listed `caption`,
  `caption_alt`, `name`, `scheduled_date`, `asset_url`, `thumbnail_url`, `post_url`,
  `cta`, `platform`, `platforms`, `order_index` and silently missed `color` and
  `caption_alt_platform` on the Calendar and `creative_direction` and
  `hide_creative_direction` on Samples — all four writable today, none captured by the
  existing `buildEvents`. A list a human maintains is a list that drifts the next time a
  column is added, and a field missing from it fails silently and invisibly, which is the
  exact failure mode this plan exists to end. Generate it from
  `supabase/functions/calendar-upsert/index.ts` and `sample-review-upsert/index.ts`, and
  make a test fail when a writable column has no entry;
- `tg_op`, and a `reason` tag distinguishing an app write from a bypass.

Two design points that are load-bearing:

- **It must be the database, not the Edge Function.** The whole point is that
  `linear-inbound`, the n8n fallback lane, and any future script are covered without
  being asked to cooperate. An app-level fix re-creates G4 the first time something new
  writes the table.
- **The bodies must be protected on arrival.** These rows carry client comment text, so
  they get the same restrictive SELECT policy already proven at
  `migrations/2026-07-12-production-comments.sql:158-171` — anon can read status
  activity, not bodies. Adding this without the policy would publish every comment on a
  public page.
- **The `app.event_written` guard does NOT port as-is, and assuming it does would
  double-record every ordinary action.** That flag is a transaction-local GUC set inside
  the RPCs that write `deliverables` (`perform set_config('app.event_written','1',true)`),
  so the guard and the app's own event insert share one transaction and the guard can tell
  they are the same write. `calendar-upsert` has no such RPC: it writes the row with
  `supabase.from("calendar_posts").update(...)` and then inserts its events in a
  **separate** PostgREST request, so nothing links the two and the trigger would fire
  unaware that an application event is coming. Resolve this **before** step 2, one of
  three ways: retire the application emitters and let the trigger be the sole writer
  (simplest, and the direction this plan already favours); fold the row write and its
  events into one `security definer` RPC that sets the GUC, the way `deliverables` does;
  or give every event a deterministic idempotency key and make the ledger unique on it.
  Choosing none of these is choosing to double-count.

Cost: comment-bearing events run 691/week across both surfaces, and the whole set of
`*_tweaks` cells averages 383 bytes per card (870 on cards that have any). Snapshotting
the previous cell on every comment change is on the order of **~600 KB/week, ~30 MB/year**.
Field diffs are smaller. This is not a storage decision.

### Step 2 — Close the bypasses

- Port `track_b_deliverable_ledger_guard` to both card tables as an `AFTER` trigger, so
  an app-written event stays the detailed one and anything else still lands a row tagged
  `rpc_bypass_guard`. This makes the ledger **complete by construction** rather than by
  everyone remembering. **Gate: step 1's de-duplication question must be answered first.**
  The guard recognises an app write only through the transaction-local `app.event_written`
  GUC, which the card writers cannot currently set (see step 1); porting it before that is
  settled turns one action into two or three ledger rows and makes the record less
  trustworthy, not more.
- Make the reconciler's flag-read failure **fail closed**: today the `catch` sends every
  client to the unrecorded n8n lane. It should skip the run and alert instead.
- Once step 1 is live, `waitUntil` on the Edge Function insert is no longer the only
  path, so its silent-failure mode stops being a data-loss mode.

### Step 3 — Fix attribution

**⛔ Read `AGENTS.md`'s frozen block before touching either function.** `calendar-upsert`
and `sample-review-upsert` are deliberately un-gated by owner decision; re-gating them
`401`s every client's approvals and comments, which broke clients twice on 2026-07-15.
Re-locking is permitted only after the owner says so affirmatively **and** every active
client has been re-issued and confirmed on a fresh link. Nothing in this step may re-gate
them as a side effect.

That constraint decides the shape of the whole step:

- **Do not resolve the asserted name against `team_members` while the writer is
  tokenless.** `production-write` can store `actor_key = member:<id>` because the name is
  checked against a presented credential and refused when it does not match. On an open
  endpoint the same lookup would take a string anyone can send, find a real roster row,
  and stamp it as verified — manufacturing false confidence in exactly the record this
  plan is trying to make trustworthy. A wrong answer that looks authoritative is worse
  than the blank we have now.
- **Record it honestly instead.** Persist the browser's string as `actor_claimed` and add
  an `actor_verified boolean` (or an `actor_key` that is only ever populated on a lane
  that authenticated the write). Then a history view can say *claimed: X* on the Calendar
  and *verified: X* in SyncLinear, and the difference is visible to the reader rather than
  hidden from them.
- **Find the samples write paths that send no identity at all** — `create`, `link_set`,
  `archive`, and the bulk status paths — and give them the same headers the single-card
  path uses. That is where the 70% goes, and it is safe: it adds a claim where there is
  currently nothing, and changes no gate.
- **Real verification is a separate, owner-gated project.** It needs the fresh-link
  reissue `AGENTS.md` requires, and it is the only thing that would let the Calendar and
  Samples answer "who" with evidence. Worth doing; not doable as a side effect of an
  audit-trail change.

Note the deliberate non-goal: this does not add per-person login, and after this step the
Calendar and Samples still cannot *prove* who acted. What changes is that the record stops
implying they can.

### Step 4 — Make it retrievable

- **Wire `_prodActivity`.** It is written, its data is already loaded, and it has no
  call site. This is the cheapest visible win in the document.
- Build the same panel for a Calendar card and a Samples row, reading the (now complete)
  ledger.
- For bodies, add a **service-role read function** — the same shape as the existing
  protected-reader pattern — so a staff principal can retrieve a deleted comment without
  the anon key ever being able to. This is what makes G5's hidden record usable without
  un-hiding it.
- Ship a read-only operator script for the "get me everything about this card" case,
  matching the existing triage scripts in `scripts/` (public-safe output, F64 rules).

### Step 5 — Make it survive

- Add `calendar_posts`, `sample_reviews`, `calendar_post_events`,
  `sample_review_events`, and the new snapshot rows to the `track-b-backup.js` allowlist
  (it is a fixed corpus with an exact-count manifest, so this is a deliberate, verified
  change — the count assertions and the restore rehearsal both have to move with it).
  **This is the item that actually answers "can I get it back".**
- Decide a retention rule before the tables grow: the ledgers are cheap, but body
  snapshots hold client comment text indefinitely, and "keep everything forever" should
  be a decision rather than a default.

---

## 6. What this does not do

- It does not give per-person authentication. Shared role keys stay shared.
- It does not make the app undo anything. Everything here is **recording and
  retrieval**; a one-click revert is a separate, larger, riskier piece of work and is
  deliberately out of scope.
- It does not recover anything already lost. The 3,657 + 3,309 comment bodies already
  overwritten, and every field edit before step 1 ships, stay gone.
- It does not change PITR. That remains an owner decision, and step 5 is the cheaper
  substitute rather than a replacement.

---

## 7. Owner decisions needed

1. **Backup scope (G6).** Adding the two card tables to the Track-B corpus is the single
   highest-value item here and the only one that answers "restore it". It touches a
   proven, manifest-checked lane, so it needs a deliberate go-ahead and a re-run of the
   restore rehearsal.
2. **Retention.** How long do we keep comment-body snapshots? Suggest 24 months and
   revisit; "forever" is fine if chosen on purpose.
3. **Order.** Step 1 alone closes G1 and G2 and is roughly one migration plus its test
   suite. Step 4's `_prodActivity` wiring is an afternoon. Suggest 1 → 4(partial) → 5 →
   2 → 3, so something visible lands early and the backup gap closes before the
   attribution polish.
4. **The reconciler fail-closed change (step 2)** changes behaviour on a flaky read from
   "write it anyway, unrecorded" to "skip and alert". That is the right trade but it is a
   behaviour change on a healing path, so it should be said out loud.

---

## 8. Ordering against the Linear exit

These two plans are independent and can run in parallel, with one exception worth
noting: the exit plan's **B1** (giving the Content Calendar a native status path so it
stops borrowing Linear as a relay) removes the reconciler's calendar writes, which is
where a meaningful share of the calendar's automation events come from today. If B1
lands first, step 2's reconciler fail-closed change becomes moot rather than wrong.
Nothing here needs to wait for it.

---

## 9. What this plan does not claim

An earlier reading of this ledger concluded that most Calendar status changes originate
in Linear, by joining `calendar_post_events.to_status` (`"For SMM Approval"`) against
`deliverable_events.to_status` (`smm_approval`). Those are two different vocabularies;
nothing matched, and "no precursor found" was misread as "originated in Linear". Redone
through the app's own mapping, 46 of 58 sampled were echoes of native SyncLinear work.
The editors work in SyncLinear. That correction is recorded here because it changed the
premise of an earlier draft of the exit plan, and because the same join mistake is easy
to repeat against these tables.

Everything in §2 and §3 is a measured count or a cited line of code. The estimates in
§5 are labelled as estimates. No claim in this document rests on a table the browser key
cannot read; `production_comments` is unreadable here and is described only from its
migration.
