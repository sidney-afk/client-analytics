# Track B — Replacing Linear with in-app production management

**Parent doc:** `INDEPENDENCE_PLAN.md`. **Safety doctrine:** `ROLLBACK.md` (applies in full to
every phase below). **Ground-truth audits:** `docs/audits/2026-07-05-*.md` — the mandatory deep
re-audit (live Linear / n8n / Supabase / Sheets diffs vs 2026-07-03, plus the four **logic maps**:
`2026-07-05-logic-calendar.md`, `-logic-samples.md`, `-logic-reviews.md`, `-logic-sync.md`).
Read `2026-07-05-reaudit-summary.md` first — it indexes the 20 findings that shaped this revision.

**Status: PLANNING — verified & hardened against the 2026-07-05 re-audit. Owner sign-off needed on
§14 decisions before B0.** Track A is complete (A1/A2/A4 merged; A3 skipped by decision — the
Linear bridges die with Linear). Every subsystem below has been pressure-tested against the live
system; where the previous draft was wrong (sizing, tokens, PITR, status enum, card linkage) it is
corrected in place, with the evidence cited.

> **MANDATORY RE-AUDIT before any code.** These facts are a **2026-07-05** snapshot. Re-pull and
> diff before B0 (the pattern is established: `docs/audits/2026-07-05-*` diffed vs `-07-03-*`).
> Never trust a cited line number — re-locate by symbol.

**Sizing facts (2026-07-05, MEASURED — replaces the 2026-07-03 estimates):**
- 2 live teams (Graphics/GRA, Video/VID); 4 dormant (CON/ALE/PC/EA). `workload_issues` also
  contains CON + STR rows (28 active) — see §2.9.
- **89 non-archived Linear projects ≈ 75 unique client names** (was misread as 48). ~51 carry
  `slackChannelId`; ~15 carry real brand-kit descriptions; ~14 have ghost (removed-user) leads.
- **1,869 open issues** (GRA 470 / VID 1,399), of which **841 sit in Backlog/Triage outside
  cycles**. Open-by-createdAt: ≤3 mo = 697, ≤6 mo = 924, ≤12 mo = 1,045, older = **824 (44%
  zombies)**. ~17.5k closed issues lifetime (estimate, id-interpolated, upper bound — hard-deleted
  ids exist). ~120 new sub-issues/week. 497 open issues are overdue; 336 review-state issues are
  >3 months old (stale WIP).
- 5 rostered editors/designers, **4 active** (martin idle since Jun 6 with assigned stale WIP).
- Fields used on deliverables: **state, assignee, due date, comments** — plus **priority, which is
  in use again** on July batches (Urgent/High/Medium; the "unused" premise is stale — §14 D-3).
  Labels, estimates, attachments, milestones remain unused.
- Real interactive write volume is small: ~25 calendar upserts, ~41 status pushes, ~27 inbound
  Linear events, ~69 sample upserts per day. Throughput is a non-issue; **correctness is the game.**

---

## 0. Locked decisions (owner) — with 2026-07-05 reality annotations

1. **Rollout = two-phase parallel run** (§1). Never true bidirectional sync — exactly one
   authoritative side per team at any moment; the mirror flows one direction only.
2. **Migration = operational + archive split** (§5). Live/open work becomes editable
   `deliverables`; all remaining history goes to a **read-only archive** so nothing is lost.
   *(Annotation: cut on createdAt/completedAt, never updatedAt — bulk touches poisoned updatedAt;
   see §5.1 and the measured cutoff table.)*
3. **Client single source of truth = the Supabase `clients` table** (§3). All three current
   sources reconcile into it. *(Annotation: the reconcile set is 89 projects / ~75 names, plus a
   4th source nobody counted — the SMM sheet tab; see §3.)*
4. **Auth is built first (B0)** (§6). Client review links stay no-login. *(Annotation: there are
   **no tokens to move** — the sheet column never existed and every client link fails open today.
   §6.4 becomes mint-and-re-issue.)*
5. **UI/interaction design is LOCKED** (§10) — the pixel/behavior-matched prototype in
   `docs/syncview-design/`. The build wires logic to it; it does not redesign it. In Phase 1 the
   mirror must reflect Linear **exactly** until authority flips; the simpler feature set is a
   *view* choice, never data loss (see §2.4 `linear_raw` — this is what makes the promise true).
6. **Deliverable ↔ card are interconnected** (§9): deep links both ways, origin labels, and
   **title == card name** (incl. YouTube titles — verified: *the YouTube title IS
   `calendar_posts.name`*; no separate field exists).
7. **Comments go internal** (§9.5): review feedback lands in Supabase threads the editors read
   in-app, mirrored to Linear only during transition. *(Annotation: refined into a concrete
   single-writer design in §9.5 — the card's component thread stays the one store for card-linked
   deliverables; ratify in §14 D-6.)*
8. Carried from earlier: 3-role auth not per-person (D6); Slack now, ro.am later (D8); everything
   attributable with timestamps (D7); keep the team's exact status vocabulary (§2.3 canonicalizes
   it — the "exact vocabulary" turns out to be three conflicting vocabularies today).

---

## 1. The spine — two-phase parallel run

The governing safety rule: **there is always exactly one authoritative side per team, and the
mirror is one-directional. We never run true two-way sync.**

| Phase | Authoritative side | Mirror direction | New tab is | Purpose |
|---|---|---|---|---|
| **B0** Auth + scaffolding | Linear (unchanged) | none | not built | role keys, client tokens, flip-log, monitoring skeleton, vocabulary lock |
| **B1** Data model + backfill | Linear (unchanged) | none | not built | schema, operational+archive migration, client reconcile |
| **B2** Build surface | Linear (unchanged) | none | built, flag-hidden | Production tab behind `?prod=1`, role-gated |
| **B3** *Phase 1 — Evaluation mirror* | **Linear** | Linear → Supabase (inbound) | **read-only live mirror** | editors keep real work in Linear, try the new tab; zero risk |
| **B4** *Phase 2 — Authoritative pilot* | **Supabase** (per pilot team) | Supabase → Linear (outbound) | **authoritative** for the pilot team | pilot team works in the new tab; Linear kept current as fallback |
| **B5** New-only + teardown | Supabase | none (Linear frozen) | authoritative for all | Linear cold read-only fallback for a grace period, then archive + cancel |

**1.1 Authority is a runtime flag, not a deploy.** One new key in `syncview_runtime_flags`:
`prod_authority` = `{"video":"linear","graphics":"linear"}` (B3 default) →
`{"...":"supabase"}` per team at each B4 flip. It is consumed by the same proven
`_calRuntimeFlagClients`-style machinery (realtime-updated, fail-safe default = `linear`), read by:
the FE Linear-push gates (§4.6), the card link-button resolver (§9.2), the inbound engine (§4.3),
the outbound mirror (§4.4), and the n8n `MJbMZ` branches (§4.5). Flipping a team = **one SQL
update**; rolling back = the same update reversed. Because `syncview_runtime_flags.updated_at` is
**provably not maintained on update** (re-audit F3), B0 adds a `BEFORE UPDATE` trigger stamping it
**and** a `flag_flips` append-only log table (old value, new value, actor, ts) — Track B's kill
switches must have a reliable audit trail (ROLLBACK rule 5).

**1.2 Per-team authority in B4** (unchanged, now concrete): a deliverable's authority =
`prod_authority[deliverable.team]`. When Graphics pilots first, Graphics deliverables are
Supabase-authoritative (outbound mirror), Video deliverables remain inbound-mirrored. Cross-team
edges (a GRA thumbnail under a VID batch — routine, and bidirectional) follow **the deliverable's
team**, never the batch's.

**1.3 "Exact reflection" in B3 — what it actually requires (new, from the re-audit).** Today's
inbound path is **status-only** (`{id, video_status|graphic_status}` patches). B3's mirror must
also reflect **title, due date, assignee, priority, parent, archived/deleted state, and comments**
— none of which have any inbound path today. This is a NEW inbound engine (§4.3), not a reuse of
the card patch. Comments additionally require a **new Linear webhook subscription for the Comments
resource** (the two existing webhooks are Issues-only) — an owner action in Linear settings at B3
(§4.3.4). Fields the UI doesn't show (priority, labels if ever used) are preserved verbatim in
`deliverables.linear_raw` (§2.4) — that is what makes "simpler UI, never less data" honest.

**1.4 Known divergence windows in B3 (documented, accepted):** the calendar deliberately refuses
stale Linear regressions (`_calIsStaleLinearRegress`) and never adopts unmapped states — so the
Production tab (exact mirror) can briefly disagree with a calendar card **by design**; the
reconciler (most-recent-action-wins on `*_status_at`) remains the arbiter. The nightly due-date
roller (degraded, ~23:45 UTC, actor unknown — §14 D-9) and `linear-set-status`'s **+2d overdue
bump side effect** will inject due-date churn into the mirror; the B3→B4 zero-diff gate must
tolerate/model due-date deltas from these two known writers or it will never pass (§8.1).

**1.5 The B3→B4 flip checklist (per team, one team at a time)** — expanded from the re-audit's
hidden-writer inventory (logic-sync §implications):

1. Announce freeze to the team (the freeze is social, not technical — see step 8 for the net).
2. Quiesce app-side outbound: confirm both localStorage outboxes are **drained on every staff
   browser** (`peekLinearOutbox()` / SXR twin; the flip runbook includes a broadcast + a probe
   that checks queued counts via a diagnostic page) — queued failed pushes MUST NOT fire at the
   old authority after the flip.
3. Final inbound reconcile; verify **zero diff** (statuses, assignees, due dates modulo §1.4
   tolerances, titles, comment counts) between Linear and the mirror for that team.
4. Flip `prod_authority[team]='supabase'` (logged in `flag_flips` + `EXECUTION_LOG.md`).
5. Verify FE push gates + `MJbMZ` branch gates now ignore that team (probe issue).
6. Enable the outbound mirror for that team; probe a full create→status→comment→due round trip
   on the TEST project.
7. Repoint the card link buttons + status-pill lock predicate for that team (§9.2) — same flag,
   no deploy.
8. **Leave inbound running in detect-only mode for the flipped team**: inbound events for a
   Supabase-authoritative team are *not applied*; they are logged to `deliverable_events`
   (`source='linear', action='foreign_write_detected'`) and **Slack-alerted** — this catches the
   straggler editor still writing in Linear (whose writes would otherwise be silently lost) for
   the whole B4+B5 grace period.
9. Rollback rehearsal (ROLLBACK rule 7): flip the flag back, confirm Linear-authoritative flow
   works, flip forward again — **before** the team starts real work.

**Why this gives the owner what they asked for:** editors use Linear and the tab side by side in
B3 with zero divergence risk (read-only mirror); at B4 exactly one side is ever truth; any
misbehavior = flip one flag back with the previous authoritative side intact and current.

---

## 2. Data model (the new database)

**Hierarchy:** two **teams** (`video`, `graphics`) → **clients** (team-agnostic; one client can
have work on both teams) → **batches** (a shoot/batch of content; primary team recorded, but
**cross-team children are legal** — measured as routine and bidirectional) → **deliverables**
(one video / one thumbnail; team-scoped). Board/list surfaces are team-scoped like the prototype.

Additive-only (ROLLBACK rule 3). Verified collision-free against the live schema (all six tables
404 today; `deliverable_id` absent from both card tables). Anon `SELECT using(true)` **except
where noted** — the re-audit killed the "everything anon-readable" simplification (§2.7).
**Writes are Edge-Function-only, role/token-gated** (§6). Realtime publication adds: `clients`,
`team_members`, `batches`, `deliverables`, `deliverable_events`, `flag_flips`.

### 2.1 Reference: the canonical status vocabulary (fixes the previous draft's broken CHECK)

Three vocabularies exist today and the previous CHECK list was an inconsistent hybrid of them
(and omitted `Duplicate`, which live issues hold — backfill would have crashed on the constraint):

| Canonical **slug** (stored) | Display name (locked design) | Card component status (`CAL_STATUSES`) | Linear state names (per team, legacy) |
|---|---|---|---|
| `triage` | Triage | — (inbound → `In Progress`) | Triage (VID only) |
| `backlog` | Backlog | — (inbound → `In Progress`) | Backlog |
| `todo` | Todo | — (inbound → `In Progress`); **outbound from card `In Progress` maps here** | Todo |
| `in_progress` | In Progress | In Progress | In Progress |
| `smm_approval` | For SMM approval | For SMM Approval | "For SMM approval" (both teams) |
| `kasper_approval` | For Kasper approval | Kasper Approval | "For Kasper approval" (both) |
| `tweak` | Tweak Needed | Tweaks Needed | GRA "Tweak Needed" / VID **"Tweak Needed "** (trailing space) |
| `client_approval` | For Client Approval | Client Approval | GRA "For Client approval" / VID "For Client Approval" |
| `approved` | Approved | Approved | Approved |
| `scheduled` | Scheduled | Scheduled (calendar only; samples reject) | Scheduled |
| `posted` | Posted | Posted (calendar only; samples reject) | Posted |
| `canceled` | Canceled | — (inbound → no-op today) | Canceled |
| `duplicate` | Duplicate | — (inbound → no-op) | Duplicate |

Rules locked here (B0 ratifies, §14 D-2): store **slugs** (immune to the trailing-space /
capitalization traps); map Linear→slug by **state UUID first, normalized name second** (trim +
case-fold + substring, exactly the tolerance `_calMapLinearStatusStrict` uses); map slug→Linear by
the per-team state-UUID table captured at B0 (the audit has all UUIDs). Projection slug→card
status per the table (Triage/Backlog/Todo project to `In Progress` on cards, as today; a
sample-linked deliverable is **clamped**: `scheduled`/`posted` are unrepresentable on samples —
the deliverable EF refuses them for `origin='samples'` rows, mirroring the SXR guards).
**Known asymmetry to preserve or fix consciously (§14 D-10):** today's outbound n8n map sends
card `In Progress` → Linear **Todo** (not In Progress).

### 2.2 Schema

```sql
create table clients (                    -- §3: the ONE canonical client registry (anon-readable)
  slug text primary key,                  -- canonical slug (wlNormalizeClient output; '&' legal, e.g. eben&annie)
  display_name text not null,
  active boolean not null default true,   -- former/legacy/non-web Linear projects come in active=false
  kind text not null default 'client' check (kind in ('client','internal','test')),  -- Kasper Hytonen=internal, Sidney Laruel=test
  source text not null default 'sheet',   -- provenance: 'seed' | 'sheet' | 'linear' | 'manual'
  slack_channel_id text,
  brand_kit jsonb,                        -- fonts/colors/sample links parsed from Linear project descriptions (~15 have real content)
  linear_project_ids jsonb,               -- ALL Linear project ids merged into this client (dupes are real: up to 3 per client)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- NOTE: review_token does NOT live here. clients is anon-readable; tokens go in client_access (§2.7).

create table client_access (              -- §6.4: service-role-only; NEVER anon-readable
  slug text primary key references clients(slug),
  review_token text not null,             -- minted at B0 (nothing to migrate — the sheet column never existed)
  token_rotated_at timestamptz not null default now(),
  notes text
);

create table team_members (               -- anon-readable (names/colors drive the UI)
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,                             -- Linear-user join key (server-side use)
  role text not null check (role in ('admin','smm','editor','designer')),
  team text check (team in ('video','graphics')),   -- null for admin/smm
  slack_user_id text,
  linear_user_id text,                    -- from WL_VIDEO_EDITORS / WL_ALLOWED_GRAPHICS + Linear users
  avatar_color text,                      -- prototype EDITORS.color
  default_for_team boolean not null default false,  -- graphics auto-assign = the (single) default designer today
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table batches (                    -- a shoot/batch; Linear "parent issue(s)" — possibly a mirrored PAIR
  id text primary key,                    -- native mint b_<ts36>_<rand>
  client_slug text not null references clients(slug),
  team text check (team in ('video','graphics')),   -- PRIMARY team (creation context); null when genuinely mixed; children may differ (measured: routine)
  name text not null,                     -- "{Client} · {date}" / "{CLIENT} | SAMPLES | …" conventions preserved
  description text,                       -- the batch brief (editors read this)
  filming_doc_url text, footage_folder_url text,
  delivery_folder_url text,               -- frame.io (video) / Drive (graphics)
  color text,                             -- batch color chip on calendar cards
  status text not null default 'active' check (status in ('active','done','archived')),
  comments text,                          -- JSON thread, same shape as deliverables.comments
  sort_key numeric,
  created_by text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linear_parent_ids jsonb                 -- TRANSITION: {"video": {uuid,identifier,url}, "graphics": {...}} — mirrored pairs collapse to ONE batch row
);

create table deliverables (               -- Linear "sub-issue" = one video / one thumbnail
  id text primary key,                    -- d_<ts36>_<rand>
  identifier text unique,                 -- display id (e.g. VID-13001 — new counters seeded above Linear's max; §10.3, §14 D-7)
  batch_id text not null references batches(id),
  client_slug text not null references clients(slug),
  team text not null check (team in ('video','graphics')),
  kind text not null check (kind in ('video','thumbnail')),
  title text not null,                    -- == linked card's name from B4 on (§9.4); == Linear title verbatim during B3 mirror
  brief text,
  status text not null default 'in_progress' check (status in
    ('triage','backlog','todo','in_progress','smm_approval','kasper_approval',
     'client_approval','tweak','approved','scheduled','posted','canceled','duplicate')),
  status_at timestamptz,                  -- stamped by trigger (the *_status_at pattern, reused verbatim)
  assignee_id uuid references team_members(id),
  due_date date,
  priority smallint,                      -- MIRRORED ONLY (in active use again); UI does not render it (locked design) — §14 D-3
  file_url text,                          -- per-deliverable delivery link (backfilled by parsing delivery-link comments, §5.2)
  comments text,                          -- JSON thread — used ONLY for origin='manual' rows; card-linked rows read/write the card thread (§9.5)
  origin text not null default 'manual' check (origin in ('calendar','samples','manual')),
  card_id text,                           -- calendar_posts.id / sample_reviews.id (join with client_slug — card PKs are (client,id))
  sort_key numeric,
  sync_state text not null default 'clean' check (sync_state in ('clean','pending','error')),
  created_by text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- TRANSITION-ONLY Linear mirror keys (the URL alone is NOT a safe key — issues move teams and keep alias identifiers):
  linear_issue_uuid text,                 -- canonical join key (survives team moves + renames)
  linear_identifier text,                 -- e.g. GRA-6217 (display/debug)
  linear_issue_url text,                  -- what the card link columns store today
  linear_aliases jsonb,                   -- prior identifiers/urls after team moves (VID-12400 ⇒ GRA-6217 is real)
  linear_raw jsonb                        -- verbatim last-mirrored Linear payload — the §1 "nothing is lost" guarantee
);
create index on deliverables (client_slug, status);
create index on deliverables (assignee_id, due_date);       -- workload query
create index on deliverables (batch_id);
create index on deliverables (team, status);
create unique index deliverables_linear_uuid_live
  on deliverables (linear_issue_uuid) where linear_issue_uuid is not null;   -- duplicate-link guard as a DB constraint

create table deliverable_events (         -- append-only ledger; ENFORCED, not optional (§2.6)
  id bigint generated always as identity primary key,
  deliverable_id text not null, batch_id text, client_slug text not null,
  ts timestamptz not null default now(),
  actor text, role text,                  -- PERSISTED from X-Syncview-* headers (fixing the samples-EF gap that drops them)
  action text not null,                   -- status_change | assign | due_change | title_change | comment_add | comment_resolve |
                                          -- comment_delete | link_set | link_clear | create | archive | delete | reorder |
                                          -- mirror_out | mirror_in | reconcile | backfill | foreign_write_detected | urgent
  from_status text, to_status text,
  source text not null default 'ui' check (source in ('ui','mirror','reconcile','backfill','system')),
  payload jsonb
);
create index on deliverable_events (deliverable_id, ts desc);
create index on deliverable_events (client_slug, ts desc);
create index on deliverable_events (source, ts desc);       -- monitoring: anomaly scans

create table mirror_outbox (              -- §4.4: durable server-side retry queue for the outbound mirror
  id bigint generated always as identity primary key,
  deliverable_id text not null,
  op text not null,                       -- create | update_state | update_fields | comment | archive
  payload jsonb not null,
  attempts int not null default 0, last_error text,
  created_at timestamptz not null default now(), next_retry_at timestamptz
);

create table linear_archive (             -- §5: read-only history — nothing is ever lost
  linear_uuid text primary key,           -- canonical id
  identifier text, aliases jsonb,
  team text, client_slug text,            -- client_slug null allowed: 137 open issues have no project; legacy more
  parent_uuid text, parent_identifier text,
  title text, state text,                 -- state stored VERBATIM (legacy names like "Tweak Applied" exist)
  assignee_name text, assignee_email text,-- ghost users stored as names (removed accounts are routine in history)
  due_date date, priority smallint,
  created_at timestamptz, completed_at timestamptz, archived_at timestamptz,
  comments jsonb,                         -- verbatim comment objects
  raw jsonb                               -- full original payload
);
create index on linear_archive (client_slug);
create index on linear_archive (identifier);

create table flag_flips (                 -- §1.1: reliable kill-switch audit trail
  id bigint generated always as identity primary key,
  key text not null, old_value jsonb, new_value jsonb,
  actor text, ts timestamptz not null default now()
);
```

**Card linkage (corrected — the previous draft's single `deliverable_id` was under-specified):**
a card has **two** production slots exactly as it has two Linear link slots today. Add to BOTH
`calendar_posts` and `sample_reviews`: `video_deliverable_id text`, `graphic_deliverable_id text`
(nullable, additive). Reverse lookup: `deliverables.card_id + client_slug + kind`. These columns
must ride every write path that carries the Linear link columns today: the EF ALLOWED lists,
`KASPER_PATCH_SCALARS`, the n8n upsert ALLOWED arrays, and `_CAL_ROLLBACK_FIELDS` (logic-calendar
§implications 3).

### 2.3 Why relational integrity gives "change once, updates everywhere"

Unchanged from the earlier draft and now verified against the real read paths: `deliverables` is
the single row per task; due/assignee/status/title changes fan out to the board, the workload tab,
and the calendar card via realtime on that one row + the card projection (§9.6) — no copy-drift.

### 2.4 `linear_raw` and the §1 lossless promise

The previous draft promised "every Linear field we don't show is still stored/mirrored" but gave
those fields no home. `linear_raw jsonb` (mirror phases only) + `priority` column + verbatim
`linear_archive.raw` close that gap. Post-B5 (§13) `linear_raw` freezes as historical context.

### 2.5 Timestamps/types

New tables use real types (`timestamptz`, `date`, `numeric`, `jsonb`) — none of the text-timestamp
debt. The comment **threads** stay JSON-in-`text` deliberately: byte-compatible with the existing
card threads and the merge-RPC pattern (§9.5 clones `sample_review_merge_comments` as
`deliverable_merge_comments` for `origin='manual'` rows; card-linked rows use the existing card
RPCs — same machine, zero new merge semantics).

### 2.6 The ledger must be un-bypassable (measured failure mode, fixed by design)

Re-audit F6: **100% of the 22,000 existing `sample_review_events` are `source='ui'`** — the
inbound-Linear and reconciler writers have bypassed the ledger since day one, because event
insertion lives in n8n code, not the DB. Since §7 makes `deliverable_events` a replay/DR
primitive, bypassability is not acceptable: **a `AFTER INSERT OR UPDATE` trigger on
`deliverables`** writes a baseline `status_change`/`create` event whenever the writer didn't
(EFs pass an `app.event_written` marker via `set_config`; the trigger fills gaps with
`source='system', actor=null`) — CI asserts that a raw service-role UPDATE still produces an
event row. Anomaly monitoring (§8) then means something.

### 2.7 Anon-exposure policy (fixes a security regression in the previous draft)

The previous draft made every new table anon-readable, then moved review tokens *into* `clients`
— publishing every client's token to anyone holding the (public, committed) anon key. Fixed:
`client_access` and `mirror_outbox` have **RLS on, zero policies** (service-role only, same as
the credentials tables). `clients`, `team_members`, `batches`, `deliverables`,
`deliverable_events`, `flag_flips` are anon-readable (parity with the app's read model; note
`team_members.email` is technically exposed — the same emails are already in the public audit
docs; acceptable, recorded). Client-link *scoping* stays a FE concern in the transition (as for
every existing table — `using(true)` cross-client reads are standing Phase-4 debt, not worsened
by Track B).

### 2.8 Flags trigger

B0 migration adds the `BEFORE UPDATE` stamp trigger on `syncview_runtime_flags` + the
`flag_flips` insert trigger (§1.1). Additive; nothing else touches that table's behavior.

### 2.9 CON/STR scope statement (new)

`workload_issues` live data contains four team keys: VID 1,495 / GRA 562 / **CON 15 / STR 13**
active rows. Track B models video+graphics only. Decision (recommend, §14 D-11): CON/STR issues
are **out of scope for deliverables** (they are not editor deliverables), included in
`linear_archive` at B5 so nothing is lost, and the workload repoint (§9.10) explicitly filters
them until then. Silent exclusion would strand 28 active mirror rows — this names it.

---

## 3. Client single source of truth

**The measured problem (worse than the draft assumed):** "who are our clients?" has **four**
answers today — the hardcoded seed (33 effective names), the Clients Info sheet (29 rows), Linear
projects (89 non-archived ≈ 75 unique names), and the SMM sheet tab (which knows a client the app
has never seen). Live slug sets: `calendar_posts` 21, `caption_prompts` 25 (one slug contains
`&`), `workload_issues.client_name` 56 messy display-name variants (incl. `Miki-agrawal` vs
`Miki Agrawal`, NULL×80, junk projects).

**The fix (unchanged in shape, now with real content):** the `clients` table becomes the boss list.

- **Reconciliation (one-off, B1):** union all four sources keyed by normalized slug — and the
  normalizer is **`wlNormalizeClient` ported exactly** (index.html:9001: lowercase, strip
  accents, strip leading "dr.", and/&→`&`, strip other non-alphanumerics). A naive
  lowercase-strip re-implementation silently loses the three variant spellings that exist TODAY
  ("Eben and Annie", "Dr Erica Matluck", "Miki-agrawal").
- **Duplicate Linear projects merge**: `clients.linear_project_ids` holds ALL project ids per
  client (measured: up to 3 per client — Alyssa Nobriga ×3, Baya Voce ×3, Art of Love ×3…); the
  mirror and archive attribute by this merged set, incl. the **two live split projects**
  (Baya Voce VID + GRA).
- **Owner review list (B1 gate)** — concrete, from the measured 3-way diff
  (`2026-07-05-sheets.md` §d): 26 clients in all three sources; 3 sheet-only (Jenna Phillips
  Ballard, Alayna Bellquist, Amanda Hanson — no mirror tabs exist; don't block on mirrors);
  4 seed-only (Alyssa Nobriga + Jordan Marks = former → `active=false`; Kasper Hytonen →
  `kind='internal'`; Sidney Laruel → `kind='test'`); **Jessica Encell Coleman** (SMM+Linear only —
  onboard or ignore, owner call); **Morgan Burch** (active on sheet, Completed in Linear — owner
  call); the `terrinamar`/`terrinammar` duplicate pair (canonical = `terrinammar`); plus the
  junk-quarantine list (Test Project, Client Example, Onboarding Ale, Synchro House…). Expect the
  `active=false` list to be ~30+ entries.
- **Tokens:** see §6.4 — minted at B0 into `client_access`, not copied (there is nothing to copy).
- **Cutover of the roster source (late, B4→B5):** `getClientRoster()` (index.html:9066 — built
  2026-07-04 exactly for this) re-points from `WL_CLIENT_NAMES` to
  `select slug, display_name from clients where active` — a one-line, late, reversible switch.
- **Slack channels:** seed `clients.slack_channel_id` from the Clients Info column (26/29
  populated) cross-checked against Linear projects' `slackChannelId` (~51 carry one); conflicts
  go on the owner-review list.

---

## 4. The sync engine (the heart, and the riskiest part)

One module, driven by the `(team → authority)` flag (§1.1). Three components: the **inbound
engine** (Linear→Supabase, B3+), the **outbound mirror** (Supabase→Linear, B4+ per team), and the
**continuous reconciler v2** (§8.1). All writes carry `source` tags; all ops are idempotent;
nothing silently drops.

### 4.1 Direction is never ambiguous

For a given team exactly one side is authoritative; the engine only writes **away from** the
authoritative side. There is no code path that writes both directions for the same team. The
matrix lives in one place (the flag) and every component reads it at run time.

### 4.2 Loop prevention (extended with the echo case we will actually hit)

Every write carries `source` (`ui | mirror | reconcile | backfill | system`); the mirror ignores
`mirror`-sourced changes. Additionally (new, measured): in B4 the outbound mirror's own Linear
writes come back as webhook deliveries ~1 s later (today nearly every inbound execution is an echo
of an app push). The inbound engine drops echoes by **actor** (the mirror's own Linear API key
identity) *and* by no-op comparison (state UUID already equal) — belt and suspenders, since
`source` tags don't cross the Linear boundary.

### 4.3 Inbound engine (new EF `linear-inbound`, replaces nothing until B5)

- **Transport:** new Linear webhooks (per team, like the existing pair) pointing at the EF;
  HMAC-SHA256 signature verification + ~60 s replay guard (the design the never-built A3 spec'd —
  it lives here now). The existing `MJbMZ` webhooks and workflow **keep running untouched** for
  the card patches until B5 (§4.5).
- **Scope:** full-field, not status-only — state (by UUID→slug), title, dueDate, assignee (via
  `team_members.linear_user_id`/email; unknown assignee → null + `payload.unknown_assignee`
  recorded), priority, parent change, archive/restore, **delete** (webhook `remove` action —
  hard-deletes are real: QA probes delete issues), team-move (alias handling: on identifier
  change, push old identifier/url into `linear_aliases`, keep `linear_issue_uuid` as the join).
- **Comments (B3 requirement §1.3):** a second webhook subscription (Comments resource) feeds
  comment create/update/delete into the linked deliverable's thread (card thread for card-linked
  rows — §9.5) with `role='editor', audience='internal'`, author = Linear user display name.
  Formatting: Linear markdown body stored verbatim in the comment `body`; inline
  `uploads.linear.app` image URLs are signed and expiring — the comment stores the URL as-is plus
  a note; the §5 image-rescue pass covers briefs, and inbound *new* comment images are accepted
  as best-effort (owner-visible caveat, §14 D-12).
- **Writer:** upserts `deliverables`/`batches` keyed by `linear_issue_uuid`; writes
  `deliverable_events` (`source='mirror'`, `action='mirror_in'` + specific action) — enforced by
  §2.6 anyway.
- **Guards ported from `MJbMZ` (proven over months):** fire-and-forget 200; skip non-Issue/
  non-Comment events; freshness guard (Linear `updatedAt` vs row `updated_at`); archived-row skip;
  no-op skip; canonical-row pick. Plus new: unknown state UUID → store name verbatim in
  `linear_raw`, event `payload.unmapped_state`, Slack alert (never silently drop a state).
- **Detect-only mode** (per team, post-flip): apply nothing; log + alert (§1.5 step 8).

### 4.4 Outbound mirror (new EF `linear-outbound` + `mirror_outbox`, B4 per team)

- **Triggers:** the deliverable-write EF (§6/§9) commits, then synchronously attempts the Linear
  push (sub-second happy path); on failure it marks `sync_state='pending'` and enqueues
  `mirror_outbox`. A retry worker (GitHub Actions cron every 5 min — same infra as the existing
  reconcilers; pg_cron is the fallback option) drains the outbox with exponential backoff;
  `attempts>8` → `sync_state='error'` + Slack alert. **The durable retry lives server-side in the
  DB, not in localStorage** — the current FE-outbox design loses queued pushes when a browser
  never returns; the new design cannot.
- **Ops:** issue create (batch parent create on first deliverable of a batch — respecting the
  mirrored-pair convention only where the batch originally had one; new batches create a parent on
  the deliverable's team only), state update (slug→per-team state UUID), title/due/assignee
  update, comment create (formatted `**{Actor} (via SyncView):**\n\n{body}` — the exact live
  convention, which `linear-tweak-comments` parses), archive.
- **Identity & secrets:** a dedicated Linear API key stored as an EF secret (never in code/repo).
  This is also the actor the inbound engine uses for echo-dropping (§4.2).
- **Rate limits:** Linear's API budget (~1,500 requests/hour complexity-based) dwarfs our measured
  write volume (~70 writes/day); the outbox worker caps at 1 op/sec anyway and backs off on 429.
- **Explicitly dropped side effect:** the **+2d overdue due-date bump** that today's
  `linear-set-status` performs on every push is NOT replicated (aligned with §14 D-8's visible-
  overdue recommendation). During B4 Linear may therefore show older due dates than before on
  overdue items — expected, documented.
- **What does NOT sync:** anything not listed (labels/estimates/cycles); the archive (§5) is a
  one-time copy, never live-synced; priority is inbound-mirrored but never written outbound (the
  new UI can't set it).

### 4.5 The legacy pipes during transition (measured dependency — do not touch early)

`MJbMZ789B5ExZz9x` (inbound card patches; **the A1/A2 EF flag routing lives inside it**), the two
reconcilers, `linear-set-status`/`linear-add-comment`, and the FE push sites keep running through
B3 untouched. At each B4 team flip: FE push sites + `MJbMZ`'s calendar/samples branches gate on
`prod_authority[team]` (one n8n edit, snapshotted + reversible per ROLLBACK rule 2 — note
**most Linear-bridge workflows have NO current repo backup**; export each before its first edit:
`VQqqeY`, `8stSpZ`, `Nk3pw`, `GP8CSZ`, `d7Dod7`, `rhDX5` (edited 06-29, zero backups!), `TJVMy`,
`BrJSe`). The FE gate is one helper each in `_calPushStatusToLinear` / `_sxrPushStatusToLinear` /
both comment helpers / both reassert loops — the full 9-path fan-in list with symbols is in
`2026-07-05-logic-sync.md` §implications-1 and is the flip-checklist's verification target.

### 4.6 Conflict handling

Inside a single authoritative phase there is no conflict (one writer per team). The only conflict
window is the B3→B4 flip instant — handled by the checklist (§1.5: freeze → drain outboxes →
zero-diff → flip → enable outbound). Last-write-wins on `updated_at` is the backstop, never the
mechanism. The special case the re-audit added: **queued FE outbox items and the reassert loop
are inventoried hidden writers** — the checklist drains/gates them explicitly.

### 4.7 Failure answers (detect → contain → recover → never lose)

| Failure | Detect | Contain | Recover | Data loss |
|---|---|---|---|---|
| Sync loop (echo applied as new change) | `source`/actor tags + no-op guard; anomaly scan: same field flapping >N times/hr → alert | inbound engine drops echoes; per-team authority means only one writer direction exists | reconciler v2 settles to authoritative side | none (ledger has every hop) |
| Partial mirror failure (Linear write fails) | `sync_state='pending'/'error'` + outbox depth metric + Slack alert | deliverable stays correct in Supabase (authoritative); only the mirror lags | outbox retries with backoff; manual `mirror_outbox` replay tool | none (authoritative side intact) |
| Linear down (B3) | inbound silence + reconciler diff failures | mirror goes stale (read-only tab shows stale banner via last-event timestamp) | Linear webhooks redeliver on recovery; reconciler heals residual drift | none |
| Linear down (B4) | outbox depth alarm | pilot team unaffected (Supabase authoritative); Linear catches up later | outbox drains on recovery | none |
| Supabase down (any phase) | FE read failures; health check | B3: editors keep working in Linear (authoritative); B4: **degraded read-only mode** (§7.4) from SWR cache; writes queue client-side with explicit "not saved" UX (never fake-saved) | Supabase recovers → outboxes flush → reconciler verifies | none if writes were refused loudly; the ledger + PITR/exports cover storage loss |
| Comment lost in the mirror | comment counts in reconciler v2 diff; `comment_add` events vs Linear comment list | comments are written to the authoritative store FIRST (card thread / deliverable thread), mirror second | re-push from the thread (idempotent by comment id in payload) | none — the Supabase thread is the store, the mirror is a copy |
| Client renamed mid-flight | `clients.updated_at` + rename event | slugs are immutable keys; display_name is presentation-only; Linear project rename does not change `linear_project_ids` | none needed | none |
| Editor assigned to deleted batch / deliverable of deleted card | FK prevents dangling batch refs; card deletion is soft (Archived) — links stay resolvable | archive view still renders | reassign UI; `foreign_write_detected` alert if Linear side did it post-flip | none |
| Status change with no actor | §2.6 trigger writes `source='system', actor=null` + anomaly scan alerts on actorless events | — | investigate via ledger + `flag_flips` | none (that's the point of the trigger) |
| Backup that can't restore | §7.5 rehearsed restore BEFORE B4 (gate artifact) | — | PITR/export per §7 | bounded by tested RPO |
| Straggler Linear write after flip | detect-only inbound (§1.5.8) alerts within seconds | not applied (authority protects store) | manually merge the straggler's change via the tab; ask the editor to move | none (event holds the foreign payload) |
| EF platform outage | write failures surface in FE ("not saved" chip) + health probe | reads unaffected (PostgREST direct); n8n legacy paths unaffected pre-B4 | Supabase status; writes retry from explicit user action | none (no fake success) |
| Realtime outage | staleness watchdog (last realtime event age) → banner + poll fallback | SWR refetch-on-focus already standard | auto-heals | none |
| Flag corruption (bad `prod_authority` value) | flag validation in every consumer (unknown value ⇒ fail-safe to `linear` + alert) | fail-safe default | fix flag; `flag_flips` shows who/when | none |
| Backfill crash mid-run | migration is idempotent + re-runnable (keyed on `linear_issue_uuid`); dry-run counts gate | old world untouched (additive tables) | re-run; verify counts | none |
| DB nears 500 MB free cap | monthly usage check in §8 health | archive `raw` is the big consumer — measured estimate ~50–150 MB total; fits, but see §14 D-1 plan decision | prune `linear_raw` post-B5 / upgrade | none |

---

## 5. Migration & backfill (B1)

Two separate pulls from Linear GraphQL (pattern: `scripts/linear-sync-reconcile.js`), both
idempotent (keyed on `linear_issue_uuid`) and re-runnable, both with `--dry-run` producing a
counts + samples report that is the B1 gate evidence.

### 5.1 Operational pull → live `batches` + `deliverables`

- **Definition (updated by measurement):** operational = **open (not completed/canceled) AND
  `createdAt` within the cutoff window** — never `updatedAt` (bulk touches make ~95% of open
  issues look recent; measured). Cutoff options with real counts: 3 mo → 697, 6 mo → 924
  (recommended default), 12 mo → 1,045, all-open → 1,869. Plus: any open issue whose URL is
  linked from a live card is operational regardless of age (the card link set is the working set).
- **Pre-migration cleanup (strongly recommended, §14 D-4):** the 824 open zombies (>12 mo,
  mostly 2023 VID backlog) and 336 stale-WIP items should be owner-triaged (bulk-cancel in
  Linear) BEFORE the pull — migrating garbage makes the new board lie on day one. The audit has
  the exact lists.
- **Batch shapes (all four are real, measured):** mirrored GRA+VID parent pairs (match by
  identical title + description → ONE batch row with both `linear_parent_ids`); single-team
  parents; parents with mixed-team children (children keep their own team); **cross-team
  children under either direction**. Orphan sub-issues (no parent) get a per-client synthetic
  "(no batch)" batch. **137 open issues have no project** → client attribution falls back to
  parent's project, then title parsing, then a **repair queue** the owner reviews at the B1 gate
  (they land with `client_slug=null` forbidden — use the `unattributed` client row, visible and
  fixable in the UI).
- Statuses map per §2.1 (by state UUID); assignees via `team_members` (unknown → null +
  recorded); due dates and priority copy verbatim; `linear_raw` stores the payload.

### 5.2 Archive pull → `linear_archive`

Everything else — target **full history** (~17.5k closed + excluded open), verbatim (`raw` +
parsed columns + full comment threads). Expect and handle: legacy states ("Tweak Applied", team
default sets), ghost authors ("Editing Team", removed accounts — stored as plain names),
hard-deleted ids (enumeration gaps are normal), alias identifiers, dormant-team history
(CON/ALE/PC/EA — include; it's cheap and it's the "never lose anything" clause). Size estimate
~50–150 MB of jsonb — inside the current cap, but this is the §14 D-1 plan-tier conversation.
**Delivery-link extraction:** parse each issue's comments for `drive.google.com` / `f.io` URLs →
`deliverables.file_url` / archive parsed column (measured convention: one delivery-link comment
per review round). **Image rescue:** download `uploads.linear.app` images referenced by
*operational* briefs/comments into the private Drive backup folder (they're signed URLs that die
with the workspace) and rewrite the stored brief references; archive images are copied
best-effort in the same pass, gaps recorded per-row in `raw._image_rescue`.

### 5.3 Clients + team_members

§3 reconciliation, plus `team_members` seeded from (corrected sources — the sheet does NOT hold
Slack ids): Video Editors tab (4 names/emails) + the hardcoded Slack fallback map inside n8n
`TJVMyfwl85qrFGeK`'s Code node + `WL_VIDEO_EDITORS` (index.html:8973, Linear UUIDs) +
`WL_ALLOWED_GRAPHICS` (8964) + a manual row for Rocío Perez (designer — exists only in the FE
allowlist today) + the 7 SMMs from the SMM tab + admin rows (Sidney, Kasper). Set
`default_for_team` for the graphics designer (today's hardcoded auto-assignee).

### 5.4 Card linkage backfill

Where a card's `linear_issue_id`/`graphic_linear_issue_id` URL resolves (directly or via alias)
to a backfilled deliverable, set the card's `video_deliverable_id`/`graphic_deliverable_id` and
the deliverable's `card_id`/`origin`. Unresolvable links (deleted issues, malformed URLs) go on
the B1 repair report. Samples note: `sample_reviews` PK is `(client, id)` — the join carries
`client_slug` too.

### 5.5 Safety

Before B1: snapshot per ROLLBACK rule 4 (git tag `pre-B1`, full Linear export via the official
exporter to the private Drive folder, Supabase dump). The migration writes only new tables — the
old world is untouched and keeps running. Every backfill row writes a `deliverable_events`
`source='backfill'` event (§2.6 enforces it anyway).

---

## 6. Auth — build first (B0)

Three role keys, not per-person accounts (D6), via the proven `client-credentials` pattern:
`X-Syncview-Key` (timing-safe compare against EF secrets) + `X-Syncview-Actor` (display name).
The header plumbing **already reaches every calendar/samples/settings write and both reconcilers**
(Track A shipped it); B0 makes the EFs *enforce and persist* it — note the measured gap: today's
samples EF accepts the headers and then **drops actor/role on the floor** (events take actor only
from `kasper_approved_by`). Track B EFs must persist actor/role/source into every event row.

- `ROLE_KEY_ADMIN` — Sidney + Kasper (everything, incl. §8 dashboard + flag flips).
- `ROLE_KEY_SMM` — calendar/samples writes, batch creation, assignment, approvals.
- `ROLE_KEY_CREATIVE` — deliverable status changes + delivery links/comments on their own team's
  work; cannot approve for Kasper/client, cannot create batches, cannot touch `client_access`.

**6.1 Login UX.** One modal: role key + name → localStorage → sent on every EF write. Rotating a
tier = update one EF secret + re-share. Zero per-person admin.

**6.2 Rollout.** B0 ships keys **permissive** (missing key ⇒ allowed but logged with
`payload.missing_key=true`) for ~1 week; the permissive log must show **zero unkeyed writes for
72h** before flipping to enforced — that log IS the gate evidence. (Reconcilers and n8n callers
get keys of their own: `system` actors.)

**6.3 Actor is the audit trail** (unchanged, D7): every ledger row carries who/role/when; the §2.6
trigger guarantees a row even for rogue writers.

**6.4 Client review links — mint, don't move (corrected by measurement).** The sheet's token
column **does not exist**; 0/29 clients have tokens; every current client link is
`?c=<name>`-only and the gate fails open. So: B0 **mints** a token per active client into
`client_access`, ships the EF-side validation, and keeps the FE fail-open **until** the
re-issue step: generate fresh `?c=<slug>&t=<token>` links for every active client, SMMs deliver
them to clients, THEN flip fail-open → fail-closed (one flag). The ordering guard from the
earlier draft survives, but the checklist item is now "mint + re-issue + confirm each client has
clicked the new link (ledger shows a token-validated read) + flip". Old tokenless links keep
working until the flip, then 410 with a friendly "ask your SMM for a fresh link" screen.
**Client WRITE path (new, previously unspecified):** client actions (approve / request change /
comment) call the same EFs with `X-Syncview-Client-Token` instead of a role key; the EF validates
token↔slug and **scopes every write to that client's rows + client-legal transitions only**
(D4 table rows 8–10: approve→`approved`, request-change→`tweak`, comment). This closes today's
model where client writes ride fully unauthenticated webhooks.

**6.5 Future upgrade (documented, deferred):** per-person Supabase Auth + per-client RLS.

---

## 7. Reliability & disaster recovery

Honest framing unchanged: never lose data, detect fast, recover fast, keep the old net up while
it's scary. Defense in depth:

**7.1 Two independent backups — with the PITR truth told (§14 D-1).** The previous draft assumed
Supabase PITR; **the project is (per repo docs) on the free tier, where PITR does not exist.**
Options for the owner: (a) upgrade to Pro + PITR add-on before B1 → RPO ≈ seconds (recommended —
the whole business runs on this after B5); (b) stay free → RPO = the daily export (up to 24 h of
deliverable state, partially reconstructable from ledgers + Linear cold fallback during the
mirror era). Either way: (i) an **independent daily export** of all Track-B tables to the private
weekly-backup Drive folder (extend `jlVfbg0Njxf1It7h` or a GH Action; n8n is fine here — D1
back-office carve-out), with **freshness alarm** (>26 h → Slack); (ii) the weekly full backup
continues.

**7.2 Reconstruct-from-events.** The ledger can replay current state — and §2.6 makes the ledger
trustworthy (today's equivalent ledgers would replay **nothing** for non-UI writes; measured).
A `scripts/replay-deliverables.js --verify` tool ships with B1 and runs in CI weekly against a
scratch schema: replay(events) == table state, or alert. An untested replay is a hope.

**7.3 Linear as COLD FALLBACK through cutover** (unchanged): B5 freezes but does NOT cancel
Linear; 8-week grace target; the B4 outbound mirror means Linear is current up to the moment of
freeze. Flip-back = `prod_authority` reversal + editors return to Linear; nothing was lost.

**7.4 Degraded read-only mode (now concrete).** The Production tab uses the same SWR pattern as
calendar/SXR: last-good data in localStorage per team view. If Supabase reads fail: render cache
+ persistent amber banner ("offline copy from HH:MM — changes disabled"), disable write
affordances, poll for recovery. Writes NEVER pretend to succeed offline (the Samples-Old
"Saved on device" silent-local-fallback is the documented anti-pattern — measured, and explicitly
not copied).

**7.5 Rehearsed restore** (ROLLBACK rule 7 applied to data): before B4, restore the daily export
+ (if Pro) PITR into a scratch project, run the replay-verify, time it. Target RTO < 1 h. The
drill artifact (timings, gaps found) is a named B4 gate input.

**7.6 DR runbook in `ROLLBACK.md`:** symptom → which fallback → exact steps → who to tell; the
§4.7 table is its skeleton. Written + rehearsed before B4.

---

## 8. Monitoring & observability (always-on)

**8.1 Continuous reconciler v2.** Extends the proven scripts pattern (GH Actions + n8n trigger,
10-min cadence): per team, diff Linear ⇄ `deliverables` on status/assignee/due/title/comment-count
(+ the card ⇄ deliverable projections of §9), honoring the §1.4 tolerances (due-date churn from
the legacy roller/+2d bump while those still exist). Any mismatch → Slack with ids + a
`deliverable_events` `source='reconcile'` row. SAFETY_CAP like today's (abort + page the owner on
mass divergence >15). **Note (measured):** the *samples* reconcile lane is currently dead (GH
cron commented out; n8n trigger inactive) — Track B v2 *restarts* that coverage rather than
inheriting it; do not assume it runs today.

**8.2 Health checks** (one scheduled probe, Slack on breach): writes landing (ledger rows/hour>0
during work hours), realtime channel alive, `sync_state='error'` count == 0, `mirror_outbox`
depth < 20 and oldest < 30 min, backup freshness < 26 h, replay-verify weekly green, flag values
valid, **n8n error-alert wiring** — note the existing "Error Alerts → DM Sidney" workflow is
still **un-wired** on every inspected workflow; wiring `errorWorkflow` on the transition-critical
n8n workflows (MJbMZ, set-status, add-comment) is a B0 checklist item since we depend on them
through B4.

**8.3 Anomaly detection on the ledger** (now meaningful thanks to §2.6): actorless events;
deliverables with zero events; repeated mirror retries; `foreign_write_detected` events;
same-field flapping (loop tripwire); events from unexpected sources per phase (e.g. `mirror_out`
for a team whose authority is `linear`).

**8.4 Admin dashboard** (admin role): per-team authority state, drift count, outbox depth,
last-backup age, error rates, last reconciler run, flag-flip history. One glance = healthy or not.

**8.5 Harness lanes:** `master-test` / `overnight-test` gain Production-tab lanes (§12).

---

## 9. Creation & interaction flows (LOGIC — the locked design's wiring contract)

The full current-state truth these rules are derived from is the four logic maps; the
**transition table** (who can move which status where, with side effects) is
`2026-07-05-logic-reviews.md` §D4 and is normative for the new EF's role gating.

**9.1 Creating a card → deliverable(s).** A new calendar card / sample can attach to an existing
batch or create one (batch picker + "new batch"). Deliverables are stamped
`origin='calendar'|'samples'`, `card_id`, `kind`. **One sample = up to TWO deliverables** (video +
thumbnail — matching its two Linear slots today). In B3, creation still flows through the current
intake→Linear path and mirrors in; from B4 the card/intake creates deliverables natively and the
mirror pushes to Linear. **Intake replacement scope (measured):** today's `VIDEO PRODUCTION
AUTOMATION` does — Linear project/parent/sub-issue creation (replaced by native batch+deliverable
creation), **Pick Freest Editor** auto-assign (port exactly: fewest open deliverables — open =
not `approved/scheduled/posted/canceled/duplicate` — among active video-team members; ties by
stable member order; graphics = `default_for_team` member, today a single hardcoded designer),
Claude-generated graphics titles (§14 D-5: port as an EF call with a proper secret, or drop to
manual titles), Sheets "Linear Submissions" log (keep n8n-side during transition; retire at B5),
Slack DM to the SMM (→ §11 notify EF), and an **AI-thumbnail chain that is verified disconnected
dead code — do not port** (§14 D-5 confirms with owner). The intake tab's fragile 15–120 s
"poll Linear until the sub-issues appear" loop dies at B4 — native creation is synchronous; keep
the durable localStorage job pattern for retry UX.

**9.2 The card's two link buttons + the status-pill lock (measured dependency).** Today each card
has two Linear-link slots rendered by `_calLinearPileHtml`/`_sxrLinearPileHtml`, and — critical —
**the per-component status pills are LOCKED until a Linear link exists** ("Link a Linear sub-issue
first"). End state: the same two buttons resolve through `prod_authority[team]` — Linear URL while
that team is Linear-authoritative, Production-tab deep link (`?prod=1&d=<id>`) once flipped — via
the two single choke points `_calLinearUrlFor` / `_sxrLinearUrlFor`. The **lock predicate,
dupe-link warning, and "link the sub-issue" nudges re-point from `linear_issue_id` columns to
`*_deliverable_id`** at the same flip — otherwise every new card/sample goes status-dead at B4
(measured failure mode, logic-samples §implications-4). Paste-guards are replaced by a deliverable
picker (uniqueness now enforced by the DB index). No four-button period, ever.

**9.3 Back-link + origin label** (unchanged): every deliverable shows "open source card" —
content calendar if `origin='calendar'`, samples if `origin='samples'` (join `client_slug` +
`card_id`), plus a visible **"Sample"** tag for samples and **"Off-calendar"** for `manual` rows.

**9.4 Name interconnection (one value, two surfaces — verified simple).** The YouTube title **is**
`calendar_posts.name` (no separate field), so title-sync is exactly: deliverable.title ==
card.name. Write paths that touch `name` are enumerated (logic-calendar §implications-1); the
settings pseudo-row (`__cal_settings__`) and blank ids are excluded. Sync is keyed on
**EF-committed writes** (ledger), never FE optimistic state (measured caveat: `name` is not in
`_CAL_ROLLBACK_FIELDS`, so FE state can lie after a failed save). During B3 the mirror stores
Linear titles verbatim (they routinely differ from card names today — e.g. "Video 3" vs the real
title); **name-sync activates per team at B4** for new edits, and legacy mismatches get a
one-time "titles differ" report + a badge in the tab rather than a mass rename (§14 D-13 if the
owner prefers a bulk adopt). Renames propagate: card→deliverable and deliverable→card through the
authoritative side, mirrored outward to Linear during transition.

**9.5 Comments/notes — single-writer design (refines locked decision #7; ratify §14 D-6).**
Measured reality: card component threads (`video_tweaks`/`graphic_tweaks`, JSON-in-text with
`{id,parent_id,author,role,audience,is_tweak,round,done,…}`) already power ALL three review
flows, the Kasper Messages inbox, seen-tracking, and resolve flows; and **every** video/graphic
note (internal audience included) currently mirrors to Linear so editors see it. The design that
avoids a two-store split brain:

- **Card-linked deliverables:** the card's component thread **remains the single store**. The
  Production tab's activity feed *renders and writes that same thread* (same merge RPCs, same
  shape) — one thread, three surfaces (card review UIs, Kasper inbox, Production tab). Editors
  get a new comment role `editor` (audience `internal`); the existing audience filter already
  keeps internal notes away from clients.
- **Inbound Linear comments (B3/B4)** land in that thread as `role='editor', audience='internal'`
  with the author's name (replacing today's one-way "editors only see it in Linear" flow).
- **Manual deliverables** (no card) use `deliverables.comments` with the cloned
  `deliverable_merge_comments` RPC.
- **Caption/title threads have NO deliverable** (verified: `_calLinearUrlFor` returns '' for
  them; nothing ever synced) — they stay card-local, untouched by Track B.
- **During transition** the same comment is mirrored to Linear (outbound only, existing
  convention `**{Actor} (via SyncView):**` — note the prefix is the *actor's* name now, not
  fixed "Kasper"); after cutover the Linear leg drops. The exact call-site inventory being
  redirected (6 sites + 2 outboxes) is in `2026-07-05-logic-reviews.md` §implications-1.
- **Faster, as the owner intuited:** EF write + realtime beats webhook→n8n→Linear→webhook→n8n.

**9.6 Assignment & due date** edits write the single `deliverables` row → workload + calendar
card + board update via realtime. The calendar card shows the assignee (editor chip) via
`*_deliverable_id → deliverables → team_members` — the owner's "SMM sees who's editing" ask.
No card-level assignee/due columns exist or are added; the deliverable is the one home.

**9.7 Delivery flows preserved** (owner's answers, confirmed against measured behavior): video =
frame.io folder link on the **batch** (`delivery_folder_url`) + editor sets status →
`smm_approval`; graphics = Drive folder on batch + per-deliverable `file_url` + same status move.
Editors post delivery links as comments today — the tab gives `file_url` a real field + keeps the
comment habit working (a pasted link in a comment offers "set as delivery link").

**9.8 URGENT + notifications:** the URGENT button (SMM calendar + Kasper card + SXR) re-points
from the n8n Linear-resolution flow to the §11 notify EF reading `team_members.slack_user_id`
(measured: the sheet never had Slack ids; the n8n fallback map is the real source today).
Same confirm → "Sending…" → latched UX.

**9.9 Kasper Messages inbox** (previously unspecified — it's a review surface the spec must not
break): it is built entirely on the card threads + `kasper_seen` basis; since §9.5 keeps card
threads as the store, **the inbox keeps working unchanged**, now also carrying editor replies
(which today it structurally cannot show). Explicit non-goal: no separate inbox rebuild in Track B.

**9.10 Workload tab re-point** (per team, at its B4 flip): `_wlV2FetchIssues`/`_wlV2MapRow` read
`deliverables` (+ `team_members`) instead of `workload_issues` for flipped teams; parked/active
semantics map from status slugs; the hardcoded editor allowlists retire in favor of
`team_members`; realtime can finally turn ON for it (row-level writes replace the full-table
rewrite that forced `WL_V2_REALTIME=false`). CON/STR rows (§2.9) are filtered out explicitly.
Until a team flips, its workload rows keep coming from `workload_issues` — mixed-source view is
per-team, never per-row.

**9.11 `editors-week` replacement (B5):** a `deliverable_events` query — per editor, count of
`status_change` events entering `approved|posted` states + assignments touched, last 7 days.
The ledger schema provably supports it (from/to/actor/ts). Ship as a saved query behind the
Kasper Editors subtab before retiring the webhook.

---

## 10. UI — the Production tab (DESIGN LOCKED — `docs/syncview-design/`)

**The design is done** — pixel- and behavior-matched prototype (11 adversarial re-audits, last
six 0-high; 138-assertion behavioral suite). `SyncView.html` = behavior source of truth;
`linear-design-tokens.md` = visual spec; `PARITY.md`/`PARITY-LOOP.md` = the interaction record.
Build = rebuild into the repo (`_prod*` namespace — **verified free**, boot-gate FAST list +
`navTo` get a `production` entry; the flag-gated `sample-reviews` boot entry at index.html:87 is
the template) and wire to real data. Not a redesign.

**10.1 Data contract mapping (the wiring bridge the build session follows):**

| Prototype structure | Real source |
|---|---|
| `ISSUES` rows `{id, team, project, title, parent, status, assignee, due, created, sub:[done,total], desc, file, comments}` | `deliverables` (+ parent batch join); `sub` = children counts for batch rows; `file` = `file_url`/batch `delivery_folder_url`; `comments` = §9.5 thread |
| `PROJECTS` `{name, emoji, team}` | `clients` (board membership derived from where the client has deliverables — a client can appear on both teams' boards) |
| `EDITORS` `{name, init, color}` | `team_members` (`avatar_color`) |
| `STATUS` / `STATUS_ORDER` | §2.1 slugs + display names (identical set — the prototype already uses these 13 keys) |
| `PSTATUS` (project board columns) | client/board grouping — Phase-agnostic display metadata on `clients` (default Backlog/In Progress/… mapping from activity) |
| `TODAY = new Date(2026,6,4)` (hardcoded) | real clock (this is mock scaffolding, as is the hardcoded `DRIVE` link — **no mock data ships**, reconfirmed) |

**10.2 Async is a new surface the prototype never had:** the prototype is synchronous; the real
build adds loading/skeleton/error/stale states (accepted prototype limitation). Use the SXR
module's SWR + optimistic patterns — it is the canonical clone template (fenced namespace,
flag-gated boot, per-client flag routing, realtime channel, outbox → §4.4's server-side outbox).

**10.3 Identifier display (§14 D-7):** the locked design renders `VID-####` identifiers.
Recommendation: keep per-team prefixes with new counters seeded above Linear's max (VID-13000+,
GRA-7000+) minted at create into `deliverables.identifier` — no UI change, no archive collision,
editors keep their muscle memory.

**10.4 Deep links:** `?prod=1&d=<deliverable id>` (detail), `?prod=1&team=<t>` (list/board) via
the SPA's history layer — consumed by §9.2's buttons and Slack notifications (§11).

**10.5 Kept/removed** (unchanged): removed priority/labels/cycles/inbox/triage-nav/manual
new-issue; kept Triage *status* for migrated data. Light theme now; dark later (whole-site).

**10.6 The behavioral test suites are NOT in this repo** (measured): `behav.js` /
`qa-features.js` / `sweep.js` / the parity-audit workflow live on the design machine only.
**B2 checklist item: copy them into `docs/syncview-design/tests/`** so the build session can
re-run the 138 assertions against the wired tab (they run on the built HTML; adapting selectors
to the `_prod*` build is part of §12's lane work). Until then the repo cannot prove behavior
parity — flagging as the one open design-kit gap.

**10.7 Still to wire (logic, not look)** — unchanged list, now with owners: card/samples link +
origin labels (§9.2–9.3), name-sync (§9.4), threads (§9.5), role gating (§6 + D4 table), realtime
data, intake auto-assign (§9.1), workload re-point (§9.10), reorder persistence (`sort_key`;
note the prototype has no sub-issue drag-reorder — accepted), archive view (read-only surface
over `linear_archive`, linked from client/board context).

---

## 11. Notifications

Slack now, behind one `notify` EF (ro.am-swappable, D8). Bot token = EF secret. Fires on:
deliverable assigned (→ editor DM or team channel), status → `tweak` (with the tweak text — the
editor's "you have changes" signal currently delivered via Linear comments), status →
`smm_approval` (→ the client's `clients.slack_channel_id` creative channel), URGENT (§9.8 →
#video-editing). Every send logs a `deliverable_events` row (`action='urgent'`/`payload.notify`).
**Open item for the owner (§14 D-14):** Linear's native project→Slack integration (~51 projects
carry `slackChannelId`) — what does it post today, and which of those messages must the notify EF
replicate so channels don't go quiet after B5? (Not readable via API; needs a look at one channel.)
Editors also lose Linear's own inbox/assignment notifications at cutover — the assigned/tweak
notifications above are their replacement; confirm sufficiency with the pilot team at B3 feedback.

---

## 12. Testing & verification

- **Probe suite** (`qa/` SXR pattern — golden lanes + probes, run against `sidneylaruel` TEST
  client + the Sidney Laruel TEST Linear project only): batch create → auto-assign → full status
  walk (per the §D4 transition table, incl. undo paths) → delivery links → calendar card shows
  editor chip → **an event-ledger row exists for every step (incl. a raw service-role write —
  §2.6 trigger check)** → notify fired (asserted via a test channel).
- **Role/token matrix:** 3 role keys × every write action → allow/deny per §6; client token ×
  in-scope/out-of-scope client × client-legal/illegal transitions; missing-key behavior in
  permissive vs enforced mode.
- **Sync/mirror drills:** loop prevention (mirrored change not echoed back — assert via ledger
  source chain); echo-drop (outbound write's webhook echo produces no second event); per-team
  authority isolation (write to non-pilot team while pilot flipped); **the B3→B4 flip checklist
  executed end-to-end on the TEST project, including outbox-drain verification and the detect-only
  straggler alert**; alias handling (move a TEST issue between teams, verify uuid-keyed row
  stability); delete handling (webhook remove).
- **Migration dry-run** (B1 gate): counts by team/status/client vs the audit's measured numbers;
  spot-value parity on 20 random issues (all fields incl. comments); repair-queue review;
  re-run idempotency (second run = zero changes).
- **DR drill** (§7.5) — a signed-off gate artifact, not a claim. Replay-verify green.
- **Behavioral parity:** the design kit's suites re-run against the wired tab (after §10.6 lands
  them in-repo).
- `npm test` + `qa/master.js` stay green throughout; **no renames of the 11 grabFunc-extracted
  symbols** (`CAL_STATUSES`, `CAL_PRIORITY`, `CAL_COMPONENTS`, `SXR_COMPONENTS`, `_calNormStatus`,
  `computeOverallStatus`, `computeSampleOverallStatus`, `_calClearStaleApprovals`,
  `_sxrClearStaleApprovals`, `_calMapLinearStatusStrict`, `_calIdentFromUrl`) until §13 retires
  the reconcilers — CI + the 10-min cron break silently otherwise.
- **Latent Track A bug to fix before any real-client flag** (measured, inherited): bulk-import
  verify reads the n8n/Sheet path that the EF doesn't mirror — flagged clients' imports would
  false-fail (logic-calendar §implications-5). Also: EF reorder has no n8n fallback (
  §implications-6) — acceptable for TEST, a gate item for real clients.

---

## 13. Cutover & teardown (B5)

1. Both teams flipped (§1.5) and stable; intake creates natively; outbound mirror ON keeps Linear
   current; grace period begins: **Linear frozen but live** (read-only by convention, §7.3),
   detect-only inbound alerting on any foreign write.
2. Grace period (target 8 weeks) with §8 monitoring green and one rehearsed flip-back drill.
3. Verify archive completeness (§5.2 counts vs live Linear export; image-rescue report) and the
   private full Linear export (official exporter) in the Drive backup folder.
4. Retire, in order (each step reversible until 7; **export every n8n workflow JSON before
   touching it** — most Linear bridges have NO current repo backup, incl. `rhDX5` edited 06-29):
   a. outbound mirror off (nothing left to mirror to);
   b. Linear webhooks deleted + inbound EF retired;
   c. `MJbMZ789B5ExZz9x` deactivated — **note: the A1/A2 EF flag routing lives inside it; by B5
      all real clients are on EFs, so its routing role is over — verify the flags are all-clients
      first**;
   d. both reconcile scripts + Actions + n8n triggers (`AkiFmromoDkmsh39`, `ZJOtYpQZj73DcBB1` —
      the latter already inactive);
   e. `Workload — Reconcile` + `workload_issues` (tab now reads `deliverables`, §9.10);
   f. VIDEO PRODUCTION AUTOMATION's Linear branches (webhooks stay for any non-Linear leg the
      owner keeps, e.g. the Sheets submissions log if wanted);
   g. `linear-set-status`, `linear-add-comment`, `linear-subissues`, `linear-issue-statuses`,
      `linear-tweak-comments`, `editors-week` (→ §9.11 query) — and with them the (degraded)
      due-date roller if it turns out to live in this family (§14 D-9);
   h. FE: Linear push/outbox/reassert/point-adoption/bulk-link code paths removed; Linear-link
      columns stay, inert, for history.
5. **Secrets teardown (new, measured):** rotate the house Linear API key (hardcoded in 6+ n8n
   workflows), delete + rotate the **7 per-SMM Linear keys exposed in the public SMM sheet tab**
   (this rotation should NOT wait for B5 — see §14 D-15), rotate the hardcoded Anthropic key if
   D-5 ports the title generator.
6. Remove the `linear_api_key` column from the SMM sheet; mirror-tab cleanup per §3 owner list.
7. **Only after** grace + verified archive + owner sign-off: cancel the Linear subscription.

---

## 14. Gates & open decisions

**Hard gates** (evidence + owner sign-off, ROLLBACK rule 6):
- **B0 →**: permissive log clean 72 h (§6.2); tokens minted + re-issue plan agreed (§6.4);
  vocabulary table ratified (§2.1); flags trigger + `flag_flips` live.
- **B1 →**: dry-run counts match audit numbers; spot-parity 20 issues; repair queue + <br>
  `active=false` client list reviewed; replay-verify green; snapshot set complete.
- **B2 →**: tab renders real migrated data behind `?prod=1` for admin role; behavioral suites
  in-repo and green on the wired tab (§10.6).
- **B3 →**: mirror zero-diff (modulo §1.4 tolerances) for 7 consecutive days; editors/SMM UX
  feedback collected; comment webhook live.
- **B3→B4 per team**: the §1.5 checklist artifacts (outbox drain proof, zero-diff report, flip +
  rollback rehearsal, detect-only alert tested) + editor/SMM sign-off + DR drill done (§7.5).
- **B4→B5**: 2 full batch cycles per team with zero lost/wrong statuses; reconciler v2 quiet;
  owner sign-off.
- **B5 teardown end**: grace period green + archive verified before cancellation.

**Open decisions for the owner (each blocks the phase noted):**

| # | Decision | Context | Recommendation | Blocks |
|---|---|---|---|---|
| D-1 | Supabase plan: Pro + PITR vs free tier | §7.1 — the previous PITR assumption was false; also 500 MB cap vs archive size | Upgrade before B1 (the business runs on this) | B1 |
| D-2 | Ratify canonical status slugs + mappings (§2.1) incl. the In-Progress→Todo outbound asymmetry (D-10) | three vocabularies measured; old CHECK list was broken | as specced; keep the asymmetry during mirror, drop it post-B5 | B0 |
| D-3 | Priority: mirror-only (hidden) vs surfaced | priority is in active use again (Urgent/High/Medium); locked design has no priority UI | mirror-only + rely on URGENT; revisit after pilot feedback | B1 |
| D-4 | Pre-migration Linear cleanup: bulk-cancel the 824 zombies + triage 336 stale-WIP? | §5.1 — migrating garbage makes the new board lie | yes — owner does a triage pass in Linear before B1 | B1 |
| D-5 | Intake extras: port Claude graphics-title generation? Confirm AI-thumbnail chain stays dead? | §9.1 — thumbnails are disconnected dead code; titles use a hardcoded Anthropic key | port titles via EF secret; confirm thumbnails dead | B2 |
| D-6 | Ratify §9.5 single-writer comment design (card thread stays the store; deliverable feed renders it) | avoids a two-store split brain; keeps Kasper inbox intact | as specced | B1 |
| D-7 | Deliverable display identifiers | §10.3 | per-team counters seeded above Linear max (VID-13000+) | B1 |
| D-8 | Overdue due dates: visible overdue state, no auto-bump (previous recommendation stands) | the old bumper is already half-dead + inconsistent (§14 D-9) | confirm: no replication; overdue badge + workload lane already exist | B2 |
| D-9 | Identify the ~23:45 UTC due-date roller actor | NOT n8n (measured elimination); actor invisible read-only — check Linear admin audit log / any personal scripts | owner checks Linear Settings → API → personal keys / audit log | B3 |
| D-10 | Keep or fix the In-Progress→Todo outbound mapping | §2.1 note | keep during mirror (exactness), drop at B5 | B0 |
| D-11 | CON/STR teams scope | §2.9 — 28 active mirror rows | out of deliverables scope; archived at B5 | B1 |
| D-12 | Inbound comment-image fidelity | §4.3 — Linear image URLs expire | accept best-effort for new comments; rescue pass covers briefs | B3 |
| D-13 | Legacy title mismatches at B4: badge-and-report vs bulk-adopt card names | §9.4 | badge + report (no mass rename) | B4 |
| D-14 | Linear→Slack project integration: what must the notify EF replicate? | §11 — ~51 projects post to client channels today | owner inspects one channel; extend notify EF accordingly | B3 |
| D-15 | **Rotate the 7 public per-SMM Linear keys + remove the sheet column NOW** (independent of Track B) | publicly readable via gviz today (re-audit; values not recorded) | do immediately; keys move to n8n credentials until B5 kills them | now |
| D-16 | Owner review lists from §3 (Jessica Encell Coleman, Morgan Burch, terrinamar merge, junk quarantine) | §3 | — | B1 |

---

## 15. Planning process (how this doc gets to "perfect")

- ✅ Rewrite around locked decisions. ✅ Design delivered + folded in (§9/§10).
- ✅ **2026-07-05: the deep-audit + verification pass** (this revision): full live re-audit
  (`docs/audits/2026-07-05-*`), logic maps of calendar/samples/three review flows/sync surfaces,
  every subsystem §1–§13 pressure-tested against measured reality; corrections applied in place
  (sizing ×2, tokens mint-not-move, PITR, status enum + Duplicate, card two-slot linkage, anon
  token exposure, ledger enforceability, batch shapes, inbound-scope gap, hidden bidirectional
  writers, workload 4-team reality); worst-case table added (§4.7); §14 rebuilt as a decision
  register.
- **NEXT:** owner answers §14 (D-15 immediately; D-1/D-2/D-4/D-6 before B0/B1); then depth-pass
  any remaining subsystem the owner questions; then the build session implements phase by phase
  under Track A's gate discipline. Everything stays in THIS doc + `docs/syncview-design/` +
  `docs/audits/` — no scattered new files.
