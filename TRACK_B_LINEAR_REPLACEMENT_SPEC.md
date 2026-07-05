# Track B — Replacing Linear with in-app production management

**Parent doc:** `INDEPENDENCE_PLAN.md`. **Safety doctrine:** `ROLLBACK.md` (applies in full to
every phase below). **Ground-truth audits:** `docs/audits/2026-07-03-linear.md` (what Linear
actually does for this team) and `docs/audits/2026-07-03-supabase.md` §6b (schema gaps).

**Status: PLANNING — actively iterated with the owner. Not execution-ready yet.** Track A is
complete (A1/A2/A4 merged to `main`; A3 was skipped by owner decision — the Linear bridges die
with Linear, so there is nothing to port). Track B may now begin planning-first: we perfect this
doc, section by section, then hand phases to Codex under the same gate discipline as Track A.

> **MANDATORY RE-AUDIT before any code.** These sizing facts are a 2026-07-03 snapshot and weeks
> have passed. Re-pull Linear (projects, users, volumes, state names, per-team counts) and diff
> against the audit before B0. Never trust a cited line number or count in this doc — re-derive it.

**Sizing facts (2026-07-03, re-verify):** 2 live teams (Graphics/GRA, Video/VID), 48
projects-as-clients (~20 active), ~120 new sub-issues/week, ~1,075 non-completed issues in
current cycles, 5 active editors/designers. Fields actually used on deliverables: **state,
assignee, due date, comments**. Labels, priority, estimates, attachments, milestones are unused —
**do not build them.**

---

## 0. Locked decisions (owner, this planning round)

1. **Rollout = two-phase parallel run** (§1). Never true bidirectional sync — exactly one
   authoritative side at any moment, mirror flows one direction only.
2. **Migration = operational + archive split** (§5). Live/open work becomes editable
   `deliverables`; all remaining history is pulled into a **read-only archive** so nothing is lost.
3. **Client single source of truth = the Supabase `clients` table** (§3). All three current
   sources (hardcoded roster, Clients Info sheet, Linear projects) reconcile into it; the app
   reads only from it.
4. **Auth is built first (B0)** (§6). The whole audit trail depends on knowing *who* did *what*,
   so login is the foundation, not a later add-on. Client review links stay no-login (§6.4).
5. **UI/interaction design is LOCKED** (§10) — pixel- and behavior-matched Linear prototype in
   `docs/syncview-design/`. Deliberately **simpler than Linear** (no priority/labels/cycles/extra
   nav); the build wires logic to it, does not redesign it. In Phase 1 our mirror must reflect
   Linear **exactly** until authority flips (the simpler feature set is a *view* choice, never a
   data-loss — every Linear field we don't show is still stored/mirrored).
6. **Deliverable ↔ card are interconnected** (§9): a deliverable deep-links to its source card in
   the content-calendar or samples calendar and is **labeled by origin** (Sample / off-calendar);
   its **title is the same value as the card's name** (incl. YouTube titles), synced both ways.
7. **Comments go internal** (§9.5): client/Kasper/SMM feedback writes straight to the deliverable's
   Supabase thread (faster than the Linear round-trip), mirrored to Linear only during transition.
8. Carried from earlier: 3-role auth not per-person (D6); Slack notifications now, ro.am later
   (D8); everything attributable with timestamps (D7); keep the team's exact status vocabulary.

**Still open** (tracked in §14): final history cutoff (3/6/12 mo — decide from real counts);
overdue-due-date behavior. The UI layer is now locked, so §10 is a reference, not a placeholder.

---

## 1. The spine — two-phase parallel run

The governing safety rule for the whole track: **there is always exactly one authoritative side,
and the mirror is one-directional. We never run true two-way sync** (two authoritative writers is
the single most corruption-prone thing we could build). Each phase names the authoritative side
and the mirror direction explicitly.

| Phase | Authoritative side | Mirror direction | New tab is | Purpose |
|---|---|---|---|---|
| **B0** Auth + scaffolding | Linear (unchanged) | none | not built | login, backups, monitoring skeleton |
| **B1** Data model + backfill | Linear (unchanged) | none | not built | schema, one-off migration, client reconcile |
| **B2** Build surface | Linear (unchanged) | none | built, flag-hidden | the Production tab behind `?prod=1`, role-gated |
| **B3** *Phase 1 — Evaluation mirror* | **Linear** | Linear → Supabase (inbound) | **read-only live mirror** | editors keep real work in Linear, *try* the new tab, give UX feedback. Zero risk: Linear is still truth. |
| **B4** *Phase 2 — Authoritative pilot* | **Supabase** (per pilot team) | Supabase → Linear (outbound) | **authoritative** for the pilot team | pilot team does real work in the new tab; Linear kept current as a live fallback. |
| **B5** New-only + teardown | Supabase | none (Linear frozen) | authoritative for all | Linear becomes a **cold read-only fallback** for a grace period, then archive + cancel. |

**Per-team authority during B4** (this is subtle — the sync engine must be *per-team
directional*): when Graphics pilots first, Graphics is Supabase-authoritative (outbound to
Linear) while Video is still Linear-authoritative (inbound to Supabase, so the board shows Video
correctly but read-only). A deliverable's authority is a function of `(team, phase)`, not global.

**Why this gives the owner what they asked for without the risk:** editors genuinely use Linear
and the new tab side by side (B3), but because the new tab is read-only there, no divergence can
occur. The moment it becomes authoritative (B4), Linear flips to a passive mirror — so at every
instant, one side is truth and the other is a copy. If any phase misbehaves, flip the flag and
the previous authoritative side is intact.

**Exact reflection in Phase 1 (owner requirement).** During B3 the new tab must reflect Linear
**exactly** — every live issue, status, assignee, due date, and comment. The prototype's simpler
feature set (no priority/labels/cycles) is a *display* choice only: those Linear fields are still
**stored and kept in sync** underneath, so nothing is lost and the flip to authoritative later is
lossless. "Simpler UI" never means "less data."

---

## 2. Data model (the new database)

**Hierarchy (mirrors Linear):** two **teams** (`video`/VID, `graphics`/GRA) → **clients**
(= Linear projects, team-agnostic; one client can have work on both teams) → **batches** (= parent
issues, team-scoped) → **deliverables** (= sub-issues, team-scoped). A deliverable belongs to one
team; a client spans both. The board is team-scoped (like the prototype's sidebar teams).

Additive-only (ROLLBACK rule 3). All new tables; anon `SELECT using(true)` for parity with the
rest of the app; **writes are Edge-Function-only, gated by role keys** (§6). Realtime publication
added for `clients`, `team_members`, `batches`, `deliverables`, `deliverable_events`.

```sql
create table clients (                    -- §3: the ONE canonical client registry
  slug text primary key,                  -- existing bare-text client slug, now a real entity
  display_name text not null,
  active boolean not null default true,   -- former/non-web Linear projects come in as active=false
  source text not null default 'sheet',   -- provenance: 'seed' | 'sheet' | 'linear' | 'manual'
  review_token text,                       -- moves from Sheets; empty => client link DENIED (§6.4)
  slack_channel_id text,
  brand_kit jsonb,                         -- fonts/colors/sample links, from Linear project descriptions
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null, email text,
  role text not null check (role in ('admin','smm','editor','designer')),
  team text check (team in ('video','graphics')),   -- null for admin/smm
  slack_user_id text, active boolean not null default true,
  created_at timestamptz not null default now()
);

create table batches (                    -- Linear "parent issue" = a batch of content
  id text primary key,                    -- native mint b_<ts36>_<rand>
  client_slug text not null references clients(slug),
  team text not null check (team in ('video','graphics')),
  name text not null,                     -- "{Client} · {date}" convention preserved
  description text,                       -- the batch brief (editors read this)
  filming_doc_url text, footage_folder_url text,
  delivery_folder_url text,               -- frame.io (video) / Drive (graphics) delivery folder
  color text,                             -- batch color chip shown on calendar cards
  status text not null default 'active' check (status in ('active','done','archived')),
  created_by text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linear_parent_ids jsonb                 -- TRANSITION ONLY: mirrored GRA/VID parent issue ids
);

create table deliverables (               -- Linear "sub-issue" = one video / thumbnail
  id text primary key,                    -- d_<ts36>_<rand>; replaces VID-####/GRA-#### as join key
  batch_id text not null references batches(id),
  client_slug text not null references clients(slug),
  team text not null check (team in ('video','graphics')),
  kind text not null check (kind in ('video','thumbnail')),
  title text not null,                    -- MUST equal the linked card's name (§9 name-sync)
  brief text,
  status text not null default 'In Progress' check (status in     -- match the prototype/Linear set exactly (reconcile at B0)
    ('Triage','Backlog','Todo','In Progress','For SMM Approval','Kasper Approval',
     'Client Approval','Tweaks Needed','Approved','Scheduled','Posted','Canceled')),
  status_at timestamptz,                  -- stamped by trigger (reuse the *_status_at pattern)
  assignee_id uuid references team_members(id),
  due_date date,                          -- drives the workload / planned view
  file_url text,                          -- per-deliverable delivery link
  comments text,                          -- JSON thread; reuse the merge-RPC pattern from samples
  origin text not null default 'manual' check (origin in ('calendar','samples','manual')),  -- §9 deep-link + label
  card_id text,                           -- the calendar_posts / sample_reviews row this mirrors (null when origin='manual')
  sort_key numeric,
  sync_state text not null default 'clean' check (sync_state in ('clean','pending','error')),
  created_by text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linear_issue_id text                    -- TRANSITION ONLY: mirrored Linear sub-issue url
);
create index on deliverables (client_slug, status);
create index on deliverables (assignee_id, due_date);   -- workload tab query
create index on deliverables (batch_id);
create unique index deliverables_linear_link_live
  on deliverables (linear_issue_id) where linear_issue_id is not null;  -- duplicate-link guard, now a DB constraint

create table deliverable_events (         -- append-only ledger; clone of sample_review_events
  id bigint generated always as identity primary key,
  deliverable_id text not null, batch_id text, client_slug text not null,
  ts timestamptz not null default now(),
  actor text, role text, action text not null,
  from_status text, to_status text,
  source text not null default 'ui',      -- ui | mirror | backfill  (§4 loop prevention keys off this)
  payload jsonb
);

create table linear_archive (             -- §5: read-only history, so nothing is ever lost
  linear_id text primary key,             -- original VID-####/GRA-####
  team text, client_slug text, parent_id text,
  title text, state text, assignee text, due_date date,
  created_at timestamptz, completed_at timestamptz,
  comments jsonb, raw jsonb               -- full original payload, verbatim
);
```

**Relational integrity is what makes "change it once, updates everywhere" true.** Because
`deliverables` is the single row for a task, changing its `due_date` or `assignee_id` updates the
workload tab, the calendar card, and the board simultaneously (all read the same row over
realtime) — no fan-out writes, no drift. **Card linkage:** add nullable `deliverable_id` to
`calendar_posts` and `sample_reviews` (alongside the existing Linear-link columns during
transition); the card's editor-name/color display joins `deliverable_id → deliverables →
team_members`.

---

## 3. Client single source of truth

**The problem, plainly:** "who are our clients?" is currently answered by three lists that can
disagree — the hardcoded roster in `index.html`, the Google "Clients Info" sheet, and Linear's
projects. We already felt this today (the roster normalization: `getClientRoster()` now unifies
the first two). Linear migration makes it worse: Linear has projects that aren't current web
clients.

**The fix:** the `clients` table (§2) becomes the one boss list. Everything asks it.

- **Reconciliation (one-off, B1):** union the three sources keyed by normalized slug
  (`wlNormalizeClient`). Web/sheet clients → `active=true, source='sheet'|'seed'`. Linear-only
  projects that aren't live web clients → imported as `active=false, source='linear'` (kept for
  history/archive linkage, hidden from live pickers). Owner reviews the `active=false` list once.
- **Cutover of the roster source (late, B4→B5):** `getClientRoster()` is re-pointed from
  `WL_CLIENT_NAMES` to `select slug,display_name from clients where active`. Until then, the
  Clients Info sheet keeps feeding the seed (no behavior change), so this is a safe, late, one-line
  switch — not a big-bang.
- **Net result:** add/rename/deactivate a client in one place; calendar, samples, Templates,
  analytics, workload, and the Production tab all follow automatically.

---

## 4. The sync engine (the heart, and the riskiest part)

One module, driven by the phase/team authority matrix (§1). Reuses proven Track A machinery: the
Linear webhook (inbound) and the outbound bridge pattern (`linear-set-status` /
`linear-add-comment` / issue creation via the existing intake automation).

- **Direction is never ambiguous.** For a given `(team, phase)` exactly one side is authoritative;
  the engine only ever writes *away from* the authoritative side. There is no code path that writes
  both directions for the same team at the same time.
- **Loop prevention.** Every write carries a `source` tag (`ui` | `mirror` | `backfill`). The
  mirror **ignores `mirror`-sourced changes**, so a change copied Linear→Supabase is never echoed
  back Supabase→Linear (and vice versa). This is the classic and only reliable way to stop sync
  loops.
- **Field mapping (only what's used):** `status` ⇄ Linear state (name-mapped, both directions
  audited for the exact state-name set at B0), `assignee_id` ⇄ Linear assignee (via
  `team_members.email`/Linear user id), `due_date` ⇄ Linear due date, `comments` ⇄ Linear comments
  (append-merge, reuse the samples merge RPC). Title/brief/links map on create; batch = parent.
- **Conflict handling.** Inside a single authoritative phase there is no conflict (one writer). The
  only conflict window is the instant a team *flips* authority (B3→B4). That flip is a
  **checklisted, one-team-at-a-time cutover** (freeze the team's Linear writes → final inbound
  reconcile → verify zero diff → switch authority → enable outbound). Last-write-wins on
  `updated_at` is the backstop, never the primary mechanism.
- **Idempotency & failure.** Every sync op is idempotent (keyed by `linear_issue_id` /
  `deliverable_id`). A failed mirror write sets `deliverables.sync_state='error'`, is retried with
  backoff, and surfaces in monitoring (§8). Nothing silently drops.
- **What does NOT sync:** anything not in the field list above (no labels/priority/estimates).
  The archive (§5) is a one-time copy, never live-synced.

---

## 5. Migration & backfill (B1)

Two **separate** pulls from Linear GraphQL (pattern: `scripts/linear-sync-reconcile.js`), both
idempotent and re-runnable:

1. **Operational pull → live `batches` + `deliverables`.** "Operational" = an issue that is **not
   completed/canceled AND had activity within the cutoff window** (created / status-changed /
   commented in the last N months, default **6** — decide N from the real count at B1), **or** is
   in a current cycle. A parent (batch) is live if any of its sub-issues is live. Statuses,
   assignees, due dates map over; `linear_issue_id`/`linear_parent_ids` set for the mirror.
2. **Archive pull → read-only `linear_archive`.** Everything else (completed/old), captured
   verbatim (`raw` jsonb + parsed columns + comments). Target full history if volume allows; else
   last 12–24 months. This is what guarantees "never lose anything" without polluting the live
   board with thousands of dead cards. Also download any `uploads.linear.app` images still
   referenced by live briefs into Drive.
3. **Clients** (§3 reconciliation) and **team_members** (5 editors/designers + SMMs + admins;
   Slack ids from the "Video Editors" sheet tab that `send-urgent-slack` uses).
4. **Card linkage:** where a `calendar_posts`/`sample_reviews` row already carries a
   `linear_issue_id` that matches a backfilled deliverable, set its `deliverable_id`.

Before B1: snapshot per ROLLBACK rule 4 (git tag `pre-B1`, Linear export, Supabase dump). The
migration writes only new tables — the old world is untouched and keeps running.

---

## 6. Auth — build first (B0)

Three role keys, not per-person accounts (D6). Extends the proven `client-credentials` pattern:
header `X-Syncview-Key` (timing-safe compare) + required `X-Syncview-Actor` (display name chosen
at login). Every EF write records `{actor, role}` into the event ledgers.

- `ROLE_KEY_ADMIN` — Sidney + Kasper (everything).
- `ROLE_KEY_SMM` — social media managers (calendar/samples writes, batch creation, assignment,
  approvals).
- `ROLE_KEY_CREATIVE` — editors + designers (deliverable status changes + delivery links/comments
  on their assignments; **cannot** approve on behalf of Kasper/client or create batches).

**6.1 Login UX.** One modal: role key + "your name" → stored in localStorage → sent on every EF
write. When someone joins/leaves a tier, rotate that one key (EF secret update) and re-share —
zero account admin.

**6.2 Rollout (matches Track A canary discipline).** B0 ships role keys **permissive** (missing
key = allowed but logged) for ~1 week to flush out every write surface that forgot to send a key,
then flips to **enforced**. The permissive log IS the evidence for the flip gate.

**6.3 Actor is the audit trail.** This is why auth is first: `deliverable_events` /
`calendar_post_events` / `sample_review_events` all record who + role + timestamp. Without login
those columns are blank and the whole "trace any future bug" requirement (D7) is hollow.

**6.4 Client review links — unchanged for clients, hardened underneath.** Clients are external
and **never log in**; the role keys are staff-only. A client still just opens `?c=<slug>&t=<token>`
and sees their page. The one change is a security fix: the token moves from the Sheet into
`clients.review_token` and flips from **fail-open** (today: no token → link works) to
**fail-closed** (no token → denied). **Ordering guard:** populate a token for every `active`
client *before* enforcing fail-closed, or a live client link would go dark. This ordering is a
hard checklist item in B0.

**6.5 Future upgrade (do not build now):** per-person Supabase Auth. Documented, deferred.

---

## 7. Reliability & disaster recovery (the "what if it all breaks" plan)

The honest framing: no software "never fails." What we *can* guarantee is **never lose data,
detect fast, recover fast, and keep the old net up while it's scary.** Defense in depth:

- **Two independent backups.** (a) Supabase **Point-in-Time Recovery** — continuous, restore to
  any second (RPO ≈ seconds). (b) An **independent daily export** (all Track-B tables → the weekly
  backup Drive folder), so we never trust a single vendor for backups. Both, always.
- **Reconstruct-from-events.** The append-only ledgers mean current state can be **replayed** from
  history if a table is ever corrupted — a third, structural safety net.
- **Keep Linear as a COLD FALLBACK through cutover.** At B5, editors go new-only but **Linear is
  not cancelled** — it stays a read-only, still-current mirror for a grace period (target **8
  weeks**). If a catastrophic bug appears, flip the flag back to Linear-authoritative; Linear was
  kept current by the B4 outbound mirror right up to the switch, so nothing is lost. We only
  cancel the subscription after the grace period + a verified archive.
- **Rehearsed restore, not hoped-for restore** (ROLLBACK rule 7 applied to data). Before B4 we
  **practice** a full restore from backup into a scratch project and time it. Target **RTO < 1
  hour**. An untested backup is a hope.
- **Degraded read-only mode.** If Supabase is unreachable, the app serves the last cached snapshot
  read-only (editors can still *see* their queue) and shows a banner, rather than a white screen.
- **DR runbook** in `ROLLBACK.md`: symptom → which fallback → exact steps → who to tell. Written
  and rehearsed before B4, not after an incident.

---

## 8. Monitoring & observability (always-on, not once-a-day)

- **Continuous reconciler.** Supabase ↔ Linear diff on a short interval during B3–B5 (extends the
  Track A reconciler); any mismatch (status/assignee/due/missing/extra) → Slack alert with the
  specific ids. This is the tripwire the owner asked for.
- **Health checks.** Writes landing, events being written, realtime channel alive, `sync_state`
  not stuck `error`, **backup freshness** (alarm if the daily export is > 26h old), sync lag over
  threshold.
- **Anomaly detection on the event ledger.** A status that changed with no `actor`; a deliverable
  with zero events; a mirror op retrying repeatedly; a spike in `sync_state='error'`.
- **Admin monitoring dashboard** (admin role): live sync status, drift count, last-backup time,
  error rates, per-team authority state. One glance = "is everything healthy."
- **Autonomous test harnesses already exist** — `master-test` and `overnight-test` skills get new
  lanes that hammer the Production tab and its interactions with calendar/samples (§12).

---

## 9. Creation & interaction flows (LOGIC — UI layout in the locked design, §10)

The data-flow rules the front end must satisfy. The *look* of the buttons/labels is fixed by the
locked design (`docs/syncview-design/`); the *behavior* below is what the build wires.

**9.1 Creating a card → a deliverable.** A new content-calendar card or new sample can (a) attach
to an **existing batch** or (b) spin up a **new batch** (batches = "a group of content", so the
flow needs a batch picker + "new batch" affordance — matches the prototype's no-manual-issue
model). The deliverable is stamped `origin='calendar'|'samples'` and `card_id` = the source row.
In B3 (Linear authoritative) creation still flows through the current intake→Linear path and
mirrors in; from B4 (Supabase authoritative for that team) the card creates the `deliverable`
(+ batch) natively and the mirror pushes it to Linear.

**9.2 The card's link buttons (calendar/samples → Production).** Today a card has two buttons
(video link, graphic link) that open Linear sub-issues. End state: the same two buttons open **our**
deliverable in the Production tab. **No four-button period** — each button resolves through the
phase/team flag (points at Linear while that team is Linear-authoritative, at the Production tab
once it flips), so a card always shows exactly two buttons that do the right thing.

**9.3 The deliverable's back-link + origin label (Production → calendar/samples).** The reverse
link the owner asked for: every deliverable in the Production tab shows a control to **open its
source card** — in the *content calendar* if `origin='calendar'`, in the *samples calendar* if
`origin='samples'` (via `card_id`). And it is **labeled by origin**: a samples deliverable shows a
visible **"Sample"** tag; a `origin='manual'` deliverable (created directly, not from either
calendar) shows an **"Off-calendar / no card"** tag so it's never mistaken for a tracked card.
This removes the confusion of a sub-issue with no obvious home.

**9.4 Name interconnection (title is one value, shown in two places).** A deliverable's `title`
**must always equal its linked card's name** — they are the same string surfaced in two UIs, not
two fields that can drift. Editing the name on either side updates the other (through the
authoritative side per phase, then mirrored). This explicitly includes **YouTube titles**: when a
card's YouTube title is tweaked/updated, the linked deliverable's title updates too (and vice
versa). One rename, consistent everywhere — no "which name is right?" ambiguity.

**9.5 Comments/notes become internal (and faster).** Today the client-review, Kasper-review, and
SMM comment/notes systems post through n8n into Linear comments. Post-migration they write
**directly to the deliverable's `comments` thread in Supabase** — no n8n/Linear round-trip, so
feedback appears immediately (the owner's "faster like this" intuition is correct: an EF write +
realtime beats a webhook→Linear hop). During transition the same comment is **mirrored to Linear**
(so the non-pilot world still sees it); after cutover the Linear write drops. Merge/concurrency
reuses the samples comment-merge RPC.

**9.6 Assignment & due date** edits write the single `deliverables` row → the workload tab and the
calendar card update via realtime (§2), because it's one row, not fan-out copies.

**9.7 Delivery flows preserved** (owner's answers): video = one frame.io folder link on the batch
+ status → For SMM Approval; graphics = Drive folder on the batch + per-deliverable `file_url` +
status → For SMM Approval.

---

## 10. UI — the Production tab (DESIGN LOCKED — `docs/syncview-design/`)

**The design is done.** A dedicated session pixel- **and** behavior-matched a full prototype to
real Linear (11 adversarial re-audits, a 138-assertion behavioral suite green). It lives in
[`docs/syncview-design/`](docs/syncview-design/) — `SyncView.html` is the behavior source of truth,
`linear-design-tokens.md` is the visual build spec, `PARITY.md`/`PARITY-LOOP.md` document every
interaction. The build session's job is to **rebuild this into the repo (`_prod*` namespace, flag
`?prod=1`, role-gated) and wire it to real data** — not to redesign it.

**Surfaces the prototype delivers** (all built + parity-checked): sidebar (brand/nav/teams/
collapse), list view (`sub-title › parent batch` rows, status group headers, chips/due/avatar),
projects board (columns + cards + drag), issue/sub-issue **detail** (inline-editable description,
properties panel, comment composer + activity feed, sub-issue list, back-stack), project detail,
and the full interaction layer — status/assignee/project/**due-calendar** pickers, right-click
context menus + submenus, **multi-select** (list + board) with a floating bulk-action bar, the
**⌘K command palette**, an extensive **keyboard model** (j/k, Enter, s/a/⇧D, ⌘A, Escape hierarchy),
**delete + Undo (⌘Z)**, truncation-aware tooltips, filter/group menus, and contextual empty states.

**Deliberately simpler than Linear** (the owner's "too many options" concern, §0): **removed** —
priority, labels, cycles, the Triage/Views/Inbox/Invite nav, the workspace switcher, and manual
"new issue"; **kept** — the Triage *status* (for migrating existing data). Light theme now; dark
mode is a later whole-site pass (needs re-measuring Linear's dark palette).

**Still to wire (logic, not look), on top of the prototype:** the calendar/samples ↔ deliverable
links + origin labels (§9.3), name-sync (§9.4), internal comments (§9.5), role gating on status
transitions (§6), realtime data, intake auto-assign ("freest editor"), and the workload tab
re-point from `workload_issues` to `deliverables`.

---

## 11. Notifications

Slack now, isolated behind a `notify` EF so ro.am can replace it later (D8). Fires on: deliverable
assigned, status → Tweaks Needed (with the tweak text), status → For SMM Approval, URGENT button.
Posts to `clients.slack_channel_id`. Slack bot token as EF secret.

---

## 12. Testing & verification

- **Probe suite** (`qa/`, SXR pattern): batch create → auto-assign → full status walk (In Progress
  → For SMM Approval → Tweaks Needed → … → Posted) → delivery links → calendar card shows editor →
  an event ledger row exists for **every** step → Slack notify fired (assert via a test channel).
  Run against the QA client slug only.
- **Role-key matrix:** each of the 3 keys × each write action → allowed/denied per §6.
- **Sync/mirror tests:** loop-prevention (a mirrored change is not echoed back), per-team authority,
  the B3→B4 flip checklist produces zero diff.
- **Autonomous coverage:** `overnight-test` drives *every clickable thing* in the Production tab
  and its cross-talk with calendar/samples, unattended, with a morning report.
- **DR drill:** the rehearsed restore (§7) is a signed-off gate artifact, not a claim.
- `npm test` + `qa/master.js` stay green throughout; the Production tab gets its own lane.

---

## 13. Cutover & teardown (B5)

1. Each team flips new-only via the checklist (§4); intake stops creating Linear issues; outbound
   mirror off; **Linear frozen but LIVE as cold fallback** (§7) — not cancelled.
2. Grace period (target 8 weeks) with monitoring green and the fallback proven.
3. Verify the archive (§5) is complete and image assets are in Drive.
4. Retire, in order (all reversible until the last step): the Linear webhook + inbound sync, both
   reconcile scripts + their Actions + n8n triggers (`AkiFmromoDkmsh39`, `ZJOtYpQZj73DcBB1`),
   `Workload — Reconcile` + `workload_issues`, VIDEO PRODUCTION AUTOMATION's Linear branches,
   `linear-tweak-comments`, `editors-week` (→ a `deliverable_events` query), the nightly due-date
   bumper, and the Linear-link columns' UI affordances (columns stay, inert, for history).
5. **Only after** the grace period + verified archive: cancel the Linear subscription.

---

## 14. Gates & open decisions

**Hard gates** (evidence + owner sign-off before proceeding, per ROLLBACK rule 6):
B0 permissive→enforced (the forgotten-surface log is clean); B1 backfill (row counts + spot-value
parity vs Linear; the `active=false` client list reviewed); B3→B4 per-team flip (zero-diff
reconcile + editor/SMM sign-off + rehearsed DR drill); B5 teardown (grace period green + archive
verified) before cancelling Linear.

**Open decisions to resolve in the loops:**
- History cutoff N (3/6/12 mo) — decide from the real operational-vs-archive counts at B1.
- Overdue due dates: the nightly automation currently silently bumps every overdue date to
  tomorrow. **Recommendation: do not replicate it** — show a visible "overdue" state instead
  (silent bumping hides lateness). Owner to confirm before B2.
- The entire **UI/interaction layer** (§10) — owner is designing; drives §9 button behavior.
- Auto-assign rule fidelity (port "Pick Freest Editor" exactly vs refine).

---

## 15. Planning process (how this doc gets to "perfect")

- ✅ Rewrite around the locked decisions (this doc). ✅ Design delivered and folded into §9/§10
  (`docs/syncview-design/`). ✅ Owner's interconnection/label/comment rules captured (§9).
- **NEXT — the deep-audit + verification pass** (handoff: `docs/TRACK_B_FABLE5_HANDOFF.md`). A
  fresh Fable-5 session re-audits the *entire* live system (website, n8n, Supabase, Linear, every
  doc), maps the real logic of the content calendar + samples + all three review flows (client /
  Kasper / SMM), then **verifies and improves this plan** — connecting the locked new-Linear design
  to how the current system actually behaves, and hunting everything neither of us thought of.
- Then **depth-pass each subsystem** (§2–§8) until each has an execution-ready spec + its own
  rollback + gate. **Only then** does the build session implement, phase by phase, under Track A's
  gate discipline. Everything stays in THIS doc + `docs/syncview-design/` — no scattered new files.
