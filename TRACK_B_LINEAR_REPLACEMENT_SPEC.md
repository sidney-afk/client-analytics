# Track B — Replacing Linear with in-app production management

**Parent doc:** `INDEPENDENCE_PLAN.md`. **Safety doctrine:** `ROLLBACK.md` (applies in full to
every phase below). **Ground-truth audits:** `docs/audits/2026-07-05-*.md` — the mandatory deep
re-audit (live Linear / n8n / Supabase / Sheets diffs vs 2026-07-03, plus the four **logic maps**:
`2026-07-05-logic-calendar.md`, `-logic-samples.md`, `-logic-reviews.md`, `-logic-sync.md`).
Read `2026-07-05-reaudit-summary.md` first — it indexes the 20 findings that shaped this revision.

**Status: PLANNING — verified & hardened against the 2026-07-05 re-audit, then adversarially
re-reviewed by four independent critic passes (execution-readiness / worst-case / consistency /
fact-check) with all confirmed findings folded in. Owner sign-off needed on §14 decisions before
B0.** Track A is complete (A1/A2/A4 merged; A3 skipped by decision — the Linear bridges die with
Linear) but its Edge-Function flags are **TEST-only**: rolling every real client onto the EF write
paths is now an explicit Track B prerequisite phase (§6.2, "B0.5").

> **MANDATORY RE-AUDIT before any code.** These facts are a **2026-07-05** snapshot. Re-pull and
> diff before B0 (the pattern is established: `docs/audits/2026-07-05-*` diffed vs `-07-03-*`).
> Never trust a cited line number — re-locate by symbol.

**Sizing facts (2026-07-05, MEASURED — replaces the 2026-07-03 estimates):**
- 2 live teams (Graphics/GRA, Video/VID); 4 dormant (CON/ALE/PC/EA). `workload_issues` also
  contains CON + STR rows — see §2.9.
- **89 non-archived Linear projects ≈ 75 unique client names** (was misread as 48). ~51 carry
  `slackChannelId`; ~15 carry real brand-kit descriptions; ~14 have ghost (removed-user) leads.
- **1,869 open issues** (GRA 470 / VID 1,399), of which **841 sit in Backlog/Triage outside
  cycles**. Open-by-createdAt: ≤3 mo = 697, ≤6 mo = 924, ≤12 mo = 1,045, older = **824 (44%
  zombies)**. ~17.5k closed issues lifetime (estimate, id-interpolated, upper bound — hard-deleted
  ids exist). ~120 new sub-issues/week (**and therefore Linear's own id counters advance ~100/wk
  per team — never hardcode identifier seeds, §10.3**). Measured id ceilings 2026-07-03:
  VID-12815 / GRA-6578. 497 open issues are overdue; 336 review-state issues are >3 months old.
- 5 rostered editors/designers, **4 active** (martin idle since Jun 6 with assigned stale WIP).
- Fields used on deliverables: **state, assignee, due date, comments** — plus **priority, which is
  in use again** on July batches (§14 D-3). Labels, estimates, attachments, milestones unused.
- Real interactive write volume is small: ~25 calendar upserts, ~41 status pushes, ~27 inbound
  Linear events, ~69 sample upserts per day. Throughput is a non-issue; **correctness is the game.**

---

## 0. Locked decisions (owner) — with 2026-07-05 reality annotations

1. **Rollout = two-phase parallel run** (§1). Never true bidirectional sync — exactly one
   authoritative side per team at any moment; the mirror flows one direction only.
2. **Migration = operational + archive split** (§5). Live/open work becomes editable
   `deliverables`; all remaining history goes to a **read-only archive** so nothing is lost.
   *(Annotation: cut on createdAt/completedAt, never updatedAt — bulk touches poisoned updatedAt;
   see §5.1.)*
3. **Client single source of truth = the Supabase `clients` table** (§3). *(Annotation: the
   reconcile set is 89 projects / ~75 names, plus a 4th source nobody counted — the SMM sheet
   tab; see §3.)*
4. **Auth is built first (B0)** (§6). Client review links stay no-login. *(Annotation: there are
   **no tokens to move** — the sheet column never existed and every client link fails open today.
   §6.4 becomes mint-and-re-issue, with a `client-token-verify` EF for the read gate.)*
5. **UI/interaction design is LOCKED** (§10) — the pixel/behavior-matched prototype in
   `docs/syncview-design/`. The build wires logic to it; it does not redesign it. In Phase 1 the
   mirror must reflect Linear **exactly** until authority flips; the simpler feature set is a
   *view* choice, never data loss (see §2.4 `linear_raw`).
6. **Deliverable ↔ card are interconnected** (§9): deep links both ways, origin labels, and
   **title == card name** (incl. YouTube titles — verified: *the YouTube title IS
   `calendar_posts.name`*; no separate field exists).
7. **Comments go internal** (§9.5): review feedback lands in Supabase threads the editors read
   in-app, mirrored to Linear only during transition. *(Annotation: refined into a concrete
   single-writer design in §9.5; ratify in §14 D-6.)*
8. Carried from earlier: 3-role auth not per-person (D6); Slack now, ro.am later (D8); everything
   attributable with timestamps (D7); keep the team's exact status vocabulary (§2.1 canonicalizes
   it — the "exact vocabulary" turns out to be three conflicting vocabularies today).

---

## 1. The spine — two-phase parallel run

The governing safety rule: **there is always exactly one authoritative side per team, and the
mirror is one-directional. We never run true two-way sync.**

| Phase | Authoritative side | Mirror direction | New tab is | Purpose |
|---|---|---|---|---|
| **B0** Auth + scaffolding | Linear (unchanged) | none | not built | role keys, client tokens, flip-log, monitoring skeleton, vocabulary lock |
| **B0.5** EF rollout | Linear (unchanged) | none | not built | **all real clients onto the Track A Edge-Function write paths** (§6.2) — prerequisite for every auth/ledger claim below |
| **B1** Data model + backfill | Linear (unchanged) | none | not built | schema, operational+archive migration, client reconcile |
| **B2** Build surface | Linear (unchanged) | none | built, flag-hidden | Production tab behind `?prod=1`, role-gated |
| **B3** *Phase 1 — Evaluation mirror* | **Linear** | Linear → Supabase (inbound) | **read-only live mirror** | editors keep real work in Linear, try the new tab; zero risk |
| **B4** *Phase 2 — Authoritative pilot* | **Supabase** (per pilot team) | Supabase → Linear (outbound) | **authoritative** for the pilot team | pilot team works in the new tab; Linear kept current as fallback |
| **B5** New-only + teardown | Supabase | none (Linear frozen) | authoritative for all | Linear cold read-only fallback for a grace period, then archive + cancel |

**1.1 Authority is a runtime flag, not a deploy.** One new key in `syncview_runtime_flags`:
`prod_authority` = `{"video":"linear","graphics":"linear"}` (B3 default) → `"supabase"` per team
at each B4 flip. Consumed by the same proven `_calRuntimeFlagClients`-style machinery
(realtime-updated), read by: the FE Linear-push gates (§4.5), the card link-button resolver
(§9.2), the inbound engine (§4.3), the outbound mirror (§4.4), the legacy reconcilers and the
gated n8n bridges (§4.5). Flipping a team = **one SQL update**; rollback = the same update
reversed. Two hardening rules from the critic pass:
- **Fail-safe direction is phase-aware, not constant-`linear`.** A flag-read failure must never
  silently reassign authority: every consumer caches the last-known-good value (localStorage /
  process memory) and keeps using it on read failure, with a loud alert; a cold client with no
  cached value **freezes Linear-facing writes** (explicit "sync paused — reload" UX) rather than
  guessing. (A constant `linear` default would, after a flip, quietly re-enable Linear pushes and
  point editors back at frozen Linear.)
- **Drill granularity:** `prod_authority_client_overrides` = `{"sidneylaruel":{"video":"supabase"}}`
  (TEST-only, same shape discipline as the Track A flags) lets the §12 flip drill run end-to-end
  on the TEST client/project **without** flipping a whole team in production. Consumers check the
  override first, then the team value.
Because `syncview_runtime_flags.updated_at` is **provably not maintained on update** (re-audit
F3), B0 adds a `BEFORE UPDATE` stamp trigger **and** the `flag_flips` append-only log (§2.2).

**1.2 Per-team authority in B4:** a deliverable's authority = override ??
`prod_authority[deliverable.team]`. Cross-team edges (a GRA thumbnail under a VID batch —
routine, bidirectional) follow **the deliverable's team**, never the batch's. **Batch-level
fields** (name/description/links/status/comments) follow `batches.team`; a genuinely mixed or
mirrored-pair batch (`team=null` or both `linear_parent_ids` present) freezes batch-field edits
to **admin only** while its teams' authorities disagree, and the outbound mirror never writes a
Linear parent belonging to a still-Linear-authoritative team (§4.4).

**1.3 "Exact reflection" in B3 — what it actually requires.** Today's inbound path is
**status-only**. B3's mirror must also reflect **title, due date, assignee, priority, parent,
archived/deleted state, and comments** — none of which have any inbound path today. This is a NEW
inbound engine (§4.3). Comments additionally require a **new Linear webhook subscription for the
Comments resource** (the existing webhooks are Issues-only) — an owner action in Linear settings
at B3 (§4.3.4, also a named B3 gate item). Fields the UI doesn't show are preserved verbatim in
`deliverables.linear_raw` (§2.4).

**1.4 Known divergence windows in B3 (documented, accepted; the §8.1 diff must tolerate them):**
(a) the calendar refuses stale Linear regressions and never adopts unmapped states — the
Production tab can briefly disagree with a calendar card *by design*; (b) due-date churn from the
degraded ~23:45 UTC roller (§14 D-9) and `linear-set-status`'s **+2d overdue bump side effect**;
(c) **clamped states**: a sample-linked deliverable cannot represent `scheduled`/`posted` (§2.1)
— if the Linear issue lands there anyway, the inbound engine stores it in `linear_raw`, flags the
row (`payload.clamped`), displays a clamped badge, and the reconciler counts it as tolerated, not
drift; (d) **unknown assignees**: issues assigned to ghost/removed users compare by
`linear_raw` user id in the reconciler (mirror fidelity), and land on the repair list instead of
the diff count — otherwise one stale-WIP ghost blocks the 7-day zero-diff gate forever.

**1.5 The B3→B4 flip checklist (per team, one team at a time)** — expanded with the re-audit's
hidden-writer inventory and the critic findings:

1. Announce freeze to the team (the freeze is social; steps 5–8 are the technical net).
2. Quiesce app-side outbound: verify both localStorage outboxes are **drained on every staff
   browser** via the B2 staff diagnostic page (§10.7 — it reads both outbox keys; note
   `peekLinearOutbox()` exists today but an SXR peek helper does **not** and must be shipped in
   B2; the only SXR console helper today is the destructive `clearSxrLinearOutbox()`).
3. Final inbound reconcile; verify **zero diff** for that team (statuses, assignees — via raw
   user id, due dates modulo §1.4 tolerances, titles, engine-tracked comments per §8.1) **and
   zero cards carrying a Linear link with no `*_deliverable_id`** (linkage completeness, §4.3.5).
4. Flip `prod_authority[team]='supabase'` (logged in `flag_flips` + `EXECUTION_LOG.md` +
   ROLLBACK.md Live State row updated in the same PR).
5. Verify every legacy writer is gated for that team: FE push gates (§4.5), `MJbMZ`'s
   calendar/samples branches, **both reconcile scripts** (skip / detect-only for
   Supabase-authoritative teams — they are bidirectional writers and MUST be gated, or a
   straggler Linear edit re-enters through `pullLinearToCard` within 10 minutes), and the
   **n8n `linear-set-status` / `linear-add-comment` webhooks themselves** (server-side
   `prod_authority` check inside each — one snapshotted n8n edit per workflow — so stale-JS tabs
   and late outbox flushes are refused centrally, not just client-side).
6. Enable the outbound mirror for that team; probe a full create→status→comment→due round trip
   on the TEST project.
7. Repoint the card link buttons + status-pill lock predicate + **the Kasper-queue visibility
   gates** (§9.2 — the unlinked-graphic gates at `_calCompKasperVisible` and twins; missing this
   silently drops every new thumbnail out of Kasper review) for that team; probe: a new
   Linear-link-less sample appears in the Kasper queue.
8. **Leave inbound running in detect-only mode for the flipped team**: events are not applied;
   they are logged to `deliverable_events` (`source='mirror', action='foreign_write_detected'`)
   and Slack-alerted — catching the straggler editor still writing in Linear for the whole
   B4+B5 grace period.
9. Verify the native identifier sequence for the team is seeded **above the live Linear max at
   flip time + margin** and collides with nothing in `linear_archive`/`deliverables` (§10.3).
10. Rollback rehearsal (ROLLBACK rule 7): flip back, confirm Linear-authoritative flow works,
    flip forward again — before the team starts real work.

**1.6 Per-phase flip point, snapshot, and Live-State discipline (ROLLBACK rules 1/4 + the
Live-State mandate apply to every phase, not just B1):**

| Phase | Single flip point (kill switch) | Rollback |
|---|---|---|
| B0 | `auth_enforcement` runtime flag (`permissive` ⇄ `enforced`) | set back to `permissive` |
| B0.5 | the three `*_ef_clients` flags (per client) | remove client from flag → n8n path |
| B1 | additive tables only; no behavior flip | drop nothing; old world untouched |
| B2 | `?prod=1` + role gate (tab hidden by default) | hide tab (flag) |
| B3 | `linear_inbound_enabled` runtime flag (+ webhook disable in Linear as the hard kill) | set false / disable webhook |
| B4 | `prod_authority[team]` | flip back to `linear` |
| B5 | each teardown step is its own reversible action (§13) | reactivate the n8n workflow / webhook |

Every phase: snapshot per ROLLBACK rule 4 before starting, and update ROLLBACK.md's Live State
table **in the same PR** as the change. **n8n exports NEVER go to the public repo** — the
Phase-0 precedent is the rule: raw workflow JSON (which contains hardcoded keys) goes to the
private Drive backup folder; the repo gets a public-safe status stub in `n8n-backups/`
(clarified in ROLLBACK.md rule 2).

---

## 2. Data model (the new database)

**Hierarchy:** two **teams** (`video`, `graphics`) → **clients** (team-agnostic) → **batches**
(a shoot/batch; primary team recorded, cross-team children legal) → **deliverables** (one video /
one thumbnail; team-scoped).

Additive-only (ROLLBACK rule 3). Verified collision-free against the live schema. **Default
posture for any table not explicitly classified below: RLS on, zero policies (service-role
only)** — the safe default. Writes are Edge-Function-only, role/token-gated (§6). Realtime
publication adds: `clients`, `team_members`, `batches`, `deliverables`, `deliverable_events`,
`flag_flips`.

### 2.1 Reference: the canonical status vocabulary (fixes the previous draft's broken CHECK)

| Canonical **slug** (stored) | Display name (locked design) | Card component status (`CAL_STATUSES`) | Linear state names (per team, legacy) |
|---|---|---|---|
| `triage` | Triage | — (**inbound → no-op today**; adopting a Triage→In-Progress projection would be a deliberate divergence — D-2 ratifies) | Triage (VID only) |
| `backlog` | Backlog | — (inbound → `In Progress`) | Backlog |
| `todo` | Todo | — (inbound → `In Progress`); **outbound from card `In Progress` maps here (legacy asymmetry)** | Todo |
| `in_progress` | In Progress | In Progress | In Progress |
| `smm_approval` | For SMM approval | For SMM Approval | "For SMM approval" (both teams) |
| `kasper_approval` | For Kasper approval | Kasper Approval | "For Kasper approval" (both) |
| `tweak` | Tweak Needed | Tweaks Needed | GRA "Tweak Needed" / VID **"Tweak Needed "** (trailing space) |
| `client_approval` | For Client Approval | Client Approval | GRA "For Client approval" / VID "For Client Approval" |
| `approved` | Approved | Approved | Approved |
| `scheduled` | Scheduled | Scheduled (calendar only; samples clamp — §1.4c) | Scheduled |
| `posted` | Posted | Posted (calendar only; samples clamp) | Posted |
| `canceled` | Canceled | — (inbound → no-op today) | Canceled |
| `duplicate` | Duplicate | — (inbound → no-op) | Duplicate |

Rules locked here (B0 ratifies, §14 D-2): store **slugs**; map Linear→slug by **state UUID
first, normalized name second** (trim + case-fold + substring — the `_calMapLinearStatusStrict`
tolerance); map slug→Linear by the per-team state-UUID table captured at B0. Projection slug→card
status per the table. Clamping for `origin='samples'` rows per §1.4c. **Outbound mapping split
(D-10):** the legacy *card-projection* path keeps today's asymmetry (card `In Progress` → Linear
Todo) for mirror exactness until B5; the *deliverable-native* outbound op (§4.4) maps straight
(`in_progress` → Linear "In Progress") — both stated so the builder never has to guess.

### 2.2 Schema

```sql
create table clients (                    -- §3: the ONE canonical client registry (anon-readable)
  slug text primary key,                  -- canonical slug (wlNormalizeClient output; '&' legal)
  display_name text not null,
  active boolean not null default true,
  kind text not null default 'client' check (kind in ('client','internal','test')),
  source text not null default 'sheet',   -- 'seed' | 'sheet' | 'linear' | 'manual'
  slack_channel_id text,
  brand_kit jsonb,
  linear_project_ids jsonb,               -- ALL Linear project ids merged into this client
  -- Projects-board metadata (the locked design's board cards are WRITABLE — status/lead/target):
  emoji text,
  board_status text not null default 'in_progress' check (board_status in
    ('backlog','planned','in_progress','paused','completed','canceled')),   -- prototype PSTATUS
  lead_member_id uuid,                    -- references team_members(id); board "lead"
  target_date date,                       -- board "target"
  board_desc text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Board metadata is seeded at B1 from the client's merged Linear projects (Linear project state →
-- board_status, project lead → lead_member_id where resolvable, targetDate → target_date). One
-- board card per client per team (derived); the prototype's second "completed" card per client is
-- legacy-duplicate-project display — collapsed by the §3 merge, recorded as a conscious deviation.

create table client_access (              -- §6.4: service-role-only; NEVER anon-readable
  slug text primary key references clients(slug),
  review_token text not null,
  token_rotated_at timestamptz not null default now(),
  notes text
);

create table team_members (               -- anon-readable
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  role text not null check (role in ('admin','smm','editor','designer')),
  team text check (team in ('video','graphics')),
  slack_user_id text,
  linear_user_id text,
  avatar_color text,
  default_for_team boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table batches (
  id text primary key,                    -- b_<ts36>_<rand>
  client_slug text not null references clients(slug),
  team text check (team in ('video','graphics')),   -- PRIMARY team; null when genuinely mixed
  name text not null,
  description text,
  filming_doc_url text, footage_folder_url text,
  delivery_folder_url text,
  color text,
  status text not null default 'active' check (status in ('active','done','archived')),
  comments text,                          -- JSON thread; merged via batch_merge_comments RPC (clone)
  sort_key numeric,
  created_by text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linear_parent_ids jsonb                 -- TRANSITION: {"video":{uuid,identifier,url},"graphics":{...}}
);

create table deliverables (
  id text primary key,                    -- d_<ts36>_<rand>
  identifier text unique,                 -- display id; backfill = linear_identifier; native mint per §10.3
  batch_id text not null references batches(id),
  client_slug text not null references clients(slug),
  team text not null check (team in ('video','graphics')),
  kind text not null check (kind in ('video','thumbnail')),
  title text not null,
  brief text,
  status text not null default 'in_progress' check (status in
    ('triage','backlog','todo','in_progress','smm_approval','kasper_approval',
     'client_approval','tweak','approved','scheduled','posted','canceled','duplicate')),
  status_at timestamptz,                  -- trigger-stamped (the *_status_at pattern)
  assignee_id uuid references team_members(id),
  due_date date,
  priority smallint,                      -- MIRRORED ONLY; UI does not render it — §14 D-3
  file_url text,
  comments text,                          -- used ONLY for origin='manual' rows (§9.5)
  origin text not null default 'manual' check (origin in ('calendar','samples','manual')),
  card_id text,                           -- + client_slug joins the card (card PKs are (client,id))
  sort_key numeric,
  sync_state text not null default 'clean' check (sync_state in ('clean','pending','error')),
  created_by text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linear_issue_uuid text,                 -- canonical join key (survives team moves + renames)
  linear_identifier text,
  linear_issue_url text,
  linear_aliases jsonb,
  linear_raw jsonb                        -- verbatim last-mirrored payload + pre-B3 comment history
);
create index on deliverables (client_slug, status);
create index on deliverables (assignee_id, due_date);
create index on deliverables (batch_id);
create index on deliverables (team, status);
create unique index deliverables_linear_uuid_live
  on deliverables (linear_issue_uuid) where linear_issue_uuid is not null;

create table deliverable_events (         -- append-only ledger; ENFORCED (§2.6)
  id bigint generated always as identity primary key,
  deliverable_id text,                    -- NULLABLE: batch-level events carry batch_id only
  batch_id text, client_slug text not null,
  ts timestamptz not null default now(),
  actor text, role text,
  action text not null,                   -- status_change | assign | due_change | title_change |
                                          -- comment_add | comment_resolve | comment_delete |
                                          -- link_set | link_clear | create | archive | delete |
                                          -- reorder | mirror_out | mirror_in | reconcile |
                                          -- backfill | foreign_write_detected | urgent |
                                          -- board_change | batch_change
  from_status text, to_status text,
  source text not null default 'ui' check (source in ('ui','mirror','reconcile','backfill','system')),
  payload jsonb
);
create index on deliverable_events (deliverable_id, ts desc);
create index on deliverable_events (client_slug, ts desc);
create index on deliverable_events (source, ts desc);

create table mirror_outbox (              -- §4.4: durable server-side retry queue
  id bigint generated always as identity primary key,
  deliverable_id text not null,
  op text not null,                       -- create | update_state | update_fields | comment | archive
  payload jsonb not null,
  attempts int not null default 0, last_error text,
  created_at timestamptz not null default now(), next_retry_at timestamptz
);

create table linear_archive (             -- §5: read-only history — SERVICE-ROLE ONLY (§2.7)
  linear_uuid text primary key,
  identifier text, aliases jsonb,
  team text, client_slug text,
  parent_uuid text, parent_identifier text,
  title text, state text,                 -- verbatim (legacy names like "Tweak Applied" exist)
  assignee_name text, assignee_email text,
  due_date date, priority smallint,
  created_at timestamptz, completed_at timestamptz, archived_at timestamptz,
  comments jsonb,
  raw jsonb
);
create index on linear_archive (client_slug);
create index on linear_archive (identifier);

create table flag_flips (
  id bigint generated always as identity primary key,
  key text not null, old_value jsonb, new_value jsonb,
  actor text, ts timestamptz not null default now()
);
```

**Card linkage:** add to BOTH `calendar_posts` and `sample_reviews`: `video_deliverable_id text`,
`graphic_deliverable_id text` (nullable, additive; a card has two production slots exactly as it
has two Linear link slots). These columns must ride every write path that carries the Linear link
columns today: the EF ALLOWED lists, `KASPER_PATCH_SCALARS`, the n8n upsert ALLOWED arrays, and
`_CAL_ROLLBACK_FIELDS`. Linkage is **maintained continuously**, not backfilled once (§4.3.5).

### 2.3 Why relational integrity gives "change once, updates everywhere"

`deliverables` is the single row per task; due/assignee/status/title changes fan out to board,
workload, and calendar card via realtime on that one row + the card projection (§9.6).

### 2.4 `linear_raw` and the §1 lossless promise

`linear_raw jsonb` (+ `priority`, + verbatim `linear_archive.raw`) is where every Linear field
the UI hides still lives. It also holds the **pre-B3 comment history** for operational issues
(§5.1) — rendered as a read-only "Linear history" block in the activity feed, never imported into
live card threads. Post-B5 it freezes as historical context.

### 2.5 Timestamps/types

New tables use real types. Comment **threads** stay JSON-in-`text` deliberately: byte-compatible
with the existing card threads and merge RPCs. New RPC clones: `deliverable_merge_comments`
(manual-deliverable threads) and `batch_merge_comments` (batch threads) — clones of
`sample_review_merge_comments`, service-role-only, same tombstone semantics.

### 2.6 The ledger must be un-bypassable — concrete mechanism (critic-hardened)

Measured failure mode: 100% of today's 22k sample events are `source='ui'` — inbound/reconciler
writers have always bypassed the n8n-code-node ledger. Fix, concretely: **every deliverable/batch
write goes through a single Postgres function** `deliverable_write(...)` / `batch_write(...)`
(security definer, service-role-execute-only) that performs the row write **and** the event
insert **in one transaction**, setting `set_config('app.event_written','1',true)`. An
`AFTER INSERT OR UPDATE` trigger on `deliverables` **and** `batches` checks the (transaction-
local) marker and, when absent — i.e., any writer that bypassed the RPC, including a raw
service-role UPDATE — inserts a baseline event (`source='system', actor=null`). This works
*because* marker and trigger share the transaction; EFs therefore MUST write via these RPCs, not
via bare PostgREST updates (stated here so the builder doesn't reproduce the two-request pattern
that would make the marker invisible and double-log every write). CI asserts: (a) RPC write → 1
event; (b) raw UPDATE → 1 system event; (c) never 2.

### 2.7 Anon-exposure policy (explicit, with a safe default)

**Default for unlisted tables: service-role only.** Anon-readable (parity with the app's read
model): `clients`, `team_members`, `batches`, `deliverables`, `deliverable_events`, `flag_flips`.
Service-role only: `client_access`, `mirror_outbox`, **`linear_archive`** (17.5k issues of
internal feedback, client briefs, and delivery links must not be one anonymous REST call away —
the archive UI reads through a role-gated EF, §10.7), and every future table unless this section
is amended. `team_members.email` exposure is accepted and recorded (already public in audit docs).
Cross-client `using(true)` reads remain standing Phase-4 debt, not worsened by Track B.

### 2.8 Flags trigger

B0 migration adds the `BEFORE UPDATE` stamp trigger on `syncview_runtime_flags` + the
`flag_flips` insert trigger (§1.1).

### 2.9 CON/STR scope statement

`workload_issues` contains four team keys — VID 1,495 / GRA 562 / CON 15 / STR 13 rows (**totals
over all 2,085 rows**; the active-only split per team was not measured — measure it at B1 before
the D-11 decision). Track B models video+graphics only. Recommendation (§14 D-11): CON/STR out of
deliverables scope, included in `linear_archive` at B5, filtered explicitly by the workload
repoint (§9.10).

---

## 3. Client single source of truth

**The measured problem:** "who are our clients?" has **four** answers today — the hardcoded seed
(**30 names**; the *effective* roster is 33 after the sheet merge), the Clients Info sheet (29
rows), Linear projects (89 non-archived ≈ 75 unique names), and the SMM sheet tab (which knows a
client the app has never seen). Live slug sets: `calendar_posts` 21, `caption_prompts` 25,
`workload_issues.client_name` 56 messy variants.

**The fix:** the `clients` table becomes the boss list.

- **Reconciliation (one-off, B1):** union all four sources keyed by normalized slug — the
  normalizer is **`wlNormalizeClient` ported exactly** (index.html:9001: lowercase, strip
  accents, strip leading "dr.", and/&→`&`, strip other non-alphanumerics).
- **Duplicate Linear projects merge:** `clients.linear_project_ids` holds ALL project ids per
  client (up to 3 measured), incl. the two live split projects (Baya Voce VID + GRA).
- **Special rows seeded at B1:** Kasper Hytonen (`kind='internal'`), Sidney Laruel
  (`kind='test'`), and **`unattributed`** (`kind='internal'`, `active=true` — the repair-queue
  home for the 137 open issues with no project; visible in staff UI, excluded from client-facing
  pickers by `kind`). The roster cutover query stays `where active` (today's effective roster
  already includes the internal/test rows).
- **Owner review list (B1 gate):** 26 three-source clients; 3 sheet-only (Jenna Phillips
  Ballard, Alayna Bellquist, Amanda Hanson); 4 seed-only (Nobriga + Marks → `active=false`;
  Kasper internal; Sidney test); **Jessica Encell Coleman** (SMM+Linear only — owner call);
  **Morgan Burch** (sheet-active vs Linear-Completed — owner call); `terrinamar`/`terrinammar`
  merge (canonical `terrinammar`); junk quarantine (Test Project, Client Example, Onboarding
  Ale, Synchro House…). Expect ~30+ `active=false` entries.
- **Tokens:** §6.4 — minted, not moved.
- **Roster cutover (late, B4→B5):** `getClientRoster()` (index.html:9066) re-points to
  `select slug, display_name from clients where active` — one line, reversible.
- **Slack channels:** seed from Clients Info (26/29) cross-checked against Linear projects
  (~51); conflicts to the owner list.

---

## 4. The sync engine (the heart, and the riskiest part)

Three components — **inbound engine** (Linear→Supabase, B3+), **outbound mirror**
(Supabase→Linear, B4+ per team), **continuous reconciler v2** (§8.1) — all driven by the
authority flag (§1.1), all idempotent, all ledger-writing.

### 4.1 Direction is never ambiguous

For a given team exactly one side is authoritative; the engine only writes **away from** the
authoritative side. Batch-field edge case per §1.2.

### 4.2 Loop prevention (extended with the echo cases we will actually hit)

Every write carries `source`; the mirror ignores `mirror`-sourced changes. Two measured echo
channels get explicit treatment:

- **B4 outbound echo:** the mirror's own Linear writes come back as webhook deliveries ~1 s
  later. Drop rule = **strict AND**: (webhook actor == the mirror's own Linear identity) AND
  (payload equals the op recorded in `mirror_outbox`/ledger for that issue — value match, not
  just actor match). The mirror identity must be **distinct from sidney@** (a dedicated Linear
  user or OAuth-app actor — sidney@ is the legacy house identity used by n8n and by real humans;
  actor-only matching against it would swallow legitimate writes). §14 D-18.
- **B3 comment echo (the loop the critics caught):** the legacy comment mirror
  (`linear-add-comment`, house key, sidney@) keeps running through B3 — so every SyncView review
  comment appears in Linear ~1 s later, and the new Comments webhook would re-import it into the
  same card thread as a duplicate (which the legacy `is_tweak`-absent⇒true default would then
  count as an open tweak, corrupting the resolve/queue machinery). The inbound comment path
  therefore **drops** comments that are (authored by the legacy integration identity) AND (body
  matches the `**{…} (via SyncView):**` prefix convention), and keeps an idempotency check
  against recent `comment_add` ledger payload ids. sidney@'s *manual* Linear comments (no
  prefix) still flow in.

### 4.3 Inbound engine (new EF `linear-inbound`)

1. **Transport:** new Linear webhooks (per team) → EF; HMAC-SHA256 verification + ~60 s replay
   guard. Kill switch: `linear_inbound_enabled` flag (§1.6) + webhook disable as the hard stop.
   The existing `MJbMZ` webhooks/workflow keep running untouched for the card patches until B5.
2. **Field scope:** state (UUID→slug), title, dueDate, assignee (via `linear_user_id`/email;
   unknown → null + `payload.unknown_assignee` + repair list, §1.4d), priority, parent change,
   archive/restore, **delete** (webhook `remove`), team move (alias push into `linear_aliases`;
   `linear_issue_uuid` stays the key). Clamped states per §1.4c. Unknown state UUID → verbatim
   into `linear_raw` + `payload.unmapped_state` + Slack alert.
3. **Inbound comments:** full object pinned explicitly — `{role:'editor', audience:'internal',
   is_tweak:false, done:false, round:null, parent_id:null, author:<Linear display name>,
   body:<markdown verbatim>}` (the pinning matters: the legacy reader treats an *absent*
   `is_tweak` as TRUE). Echo filtering per §4.2. Image URLs stored as-is (expiring — §14 D-12).
4. **Comments webhook activation (owner action, B3 gate item):** subscribe the Comments resource
   in Linear settings; then **immediately re-run the §5.1 operational pull** (catch-up — webhooks
   only deliver from subscription time, and B1→B3 spans weeks at ~120 new issues/wk).
5. **Card-linkage maintenance (continuous, not one-off):** on issue create/update, resolve the
   issue's URL/uuid against card Linear-link columns (and vice versa on card link_set events via
   the card EFs) and keep `video_deliverable_id`/`graphic_deliverable_id` current. Reconciler v2
   carries a linkage lane ("0 cards with a Linear link and no deliverable id"). Without this,
   every card created during B2–B4 is status-dead at the flip (measured failure mode).
6. **Writer:** everything lands via `deliverable_write()`/`batch_write()` RPCs (§2.6) with
   `source='mirror'`, `action='mirror_in'` + specific action.
7. **Detect-only mode** per flipped team (§1.5.8).

### 4.4 Outbound mirror (new EF `linear-outbound` + `mirror_outbox`, B4 per team)

- **Trigger:** the write EF commits → synchronous Linear push attempt → on failure
  `sync_state='pending'` + `mirror_outbox` row. Retry worker (GH Actions cron ~5 min; pg_cron
  fallback) drains with backoff; `attempts>8` → `sync_state='error'` + Slack. Durable retry is
  server-side, deliberately not localStorage.
- **Ops:** issue create (batch parent create on first deliverable — only on the deliverable's
  own team, and never a parent on a Linear-authoritative team, §1.2), state update
  (**deliverable-native mapping: straight, incl. `in_progress`→"In Progress"** — §2.1/D-10),
  title/due/assignee update, comment create (`**{Actor} (via SyncView):**\n\n{body}` — the live
  convention `linear-tweak-comments` parses), archive.
- **Identity & secrets:** dedicated Linear key/actor distinct from sidney@ (§4.2, D-18), stored
  as EF secret. **Rate limits:** Linear's budget dwarfs ~70 writes/day; worker caps 1 op/s,
  backs off on 429.
- **Dropped side effect:** the +2d overdue bump is NOT replicated (D-8).
- **Not synced:** labels/estimates/cycles; the archive; priority (inbound-only).

### 4.5 The legacy pipes during transition (measured dependencies — gate, don't guess)

Untouched through B3: `MJbMZ789B5ExZz9x` (the A1/A2 EF flag routing lives inside it), both
reconcilers, `linear-set-status`/`linear-add-comment`, FE push sites. At each B4 team flip, ALL
of these gate on `prod_authority[team]` (see §1.5.5 — including the reconcilers and the two n8n
webhooks server-side). n8n edits follow the snapshot rule (§1.6 — private export + public stub;
most Linear bridges have NO current repo backup, incl. `rhDX5` edited 06-29). FE gates live in
the two push helpers + two comment helpers + two reassert loops + outbox flushers (**flushers
re-check the flag at flush time**, so a queued item never fires at a frozen side); the full
9-path fan-in inventory with symbols is `2026-07-05-logic-sync.md` §implications-1. Stale-JS
protection: B2 ships a `min_app_version` runtime flag + forced-reload banner so a flip can expire
tabs loaded before the gate code deployed (GitHub Pages caches ~10 min; a tab can live for days).

### 4.6 Conflict handling (rescoped honestly)

"One authoritative side" removes **cross-system** conflicts; it does not remove **human**
concurrency inside Supabase (two SMMs; SMM + Kasper on the same deliverable). The deliverable
write contract therefore carries compare-and-set: `expected_status` (for transitions) and/or
`expected_updated_at`; on mismatch the EF returns 409 + current row, the FE refetches and shows
"someone else just changed this" (the card contract's `comments_base_at` discipline, applied to
scalars). Comment threads already merge (RPCs). The B3→B4 flip instant is handled by §1.5.
Last-write-wins remains the backstop only.

### 4.7 Failure answers (detect → contain → recover → never lose)

| Failure | Detect | Contain | Recover | Data loss |
|---|---|---|---|---|
| Sync loop (echo re-applied) | §4.2 strict-AND drop + flap alert (same field >N/hr) | per-team single direction | reconciler v2 settles to authoritative side | none (ledger has every hop) |
| Partial mirror failure | `sync_state` + outbox depth + Slack | Supabase (authoritative) stays correct; mirror lags | outbox retries; manual replay tool | none |
| Linear down (B3) | inbound silence + reconciler failures | mirror stale (banner via last-event age) | **webhook redelivery is limited** (Linear retries briefly and can auto-disable the webhook) — recovery = reconciler v2 **applying** corrections + §8.2 webhook-enabled probe; not redelivery hope | none |
| Linear down (B4) | outbox depth alarm | pilot team unaffected | outbox drains on recovery | none |
| Supabase down | FE read failures; health check | B3: editors keep working in Linear; B4: degraded read-only (§7.4); **writes are refused loudly** (no background client queue — consistent with §4.4's removal of localStorage outboxes) | outbox/reconciler verify on recovery | none if refusals are loud; PITR/exports cover storage loss |
| Comment lost in mirror | engine-tracked comment map (§8.1) | authoritative store written first | re-push from thread (idempotent by comment id) | none |
| Client renamed mid-flight | rename event | slugs immutable; display-only rename | — | none |
| Editor assigned to deleted batch/card | FK + soft-delete cards | archive view renders | reassign UI; foreign-write alert | none |
| Status change with no actor | §2.6 trigger + actorless-event alert | — | ledger + `flag_flips` forensics | none |
| Backup can't restore | §7.5 rehearsal BEFORE B4 (gate artifact) | — | PITR/export | bounded by tested RPO |
| Straggler Linear write after flip | detect-only inbound alert (seconds) | not applied | manual merge via tab | none (event holds payload) |
| Stale-JS tab / closed-laptop outbox fires post-flip | server-side gates in the n8n bridges refuse it (§1.5.5); refusals logged | centrally refused regardless of client state | `min_app_version` forced reload | none |
| EF platform outage | "not saved" chips + health probe | reads unaffected; pre-B4 n8n paths unaffected | explicit user retry | none |
| Realtime outage | staleness watchdog → banner + poll | SWR refetch-on-focus | auto-heals | none |
| Flag corruption / unreadable | consumer validation; last-known-good cache (§1.1) | freeze writes on cold-no-cache; never reassign authority silently | fix flag; `flag_flips` forensics | none |
| Backfill crash mid-run | idempotent + re-runnable; dry-run counts gate | additive tables; old world untouched | re-run; verify counts | none |
| Archive pull rate-limits production bridges | §5.2 throttle budget + off-hours schedule | resume tokens | resume | none |
| DB nears 500 MB cap | monthly usage check | archive `raw` ~50–150 MB (fits) | prune `linear_raw` post-B5 / upgrade (D-1) | none |

---

## 5. Migration & backfill (B1)

Two pulls from Linear GraphQL, idempotent (keyed on `linear_issue_uuid`), re-runnable, each with
`--dry-run` producing the counts/samples report that is the B1 gate evidence.

### 5.1 Operational pull → live `batches` + `deliverables`

- **Definition:** open AND `createdAt` within cutoff (3 mo → 697 / **6 mo → 924 (recommended)** /
  12 mo → 1,045 / all-open → 1,869), plus any open issue linked from a live card. Never
  `updatedAt` (poisoned, measured).
- **Pre-migration cleanup (D-4):** owner-triage the 824 zombies + 336 stale-WIP in Linear first.
- **Batch shapes (all measured-real):** mirrored pairs (identical title+description → ONE batch
  row, both `linear_parent_ids`); single-team parents; mixed-team children; cross-team children
  both directions; orphan sub-issues → per-client synthetic "(no batch)"; **137 no-project
  issues** → parent's project, else title parse, else the `unattributed` client (visible repair
  queue, B1 gate reviews it).
- **Fields:** status per §2.1 (state UUID), assignee via `team_members` (unknown → recorded),
  due/priority verbatim, `identifier = linear_identifier`, `linear_raw` = full payload **incl.
  the issue's existing comment thread** (rendered read-only in the activity feed — pre-B3
  comment history is NEVER imported into live card threads: it would double-count the mirrored
  copies of card comments and its synthesized shapes would trip the `is_tweak` legacy default;
  the §8.1 comment metric consequently covers only engine-tracked comments).
- **Delivery links:** parse trailing delivery-link comments (`drive.google.com` / `f.io`) →
  `file_url`.

### 5.2 Archive pull → `linear_archive`

Full history (~17.5k closed + excluded open), verbatim; legacy states, ghost authors, deleted
ids, aliases, dormant teams all expected and stored as-is. **Rate budget (critic add):** the pull
shares Linear's API budget with the still-live production bridges — paginate with resume tokens,
hard cap ≤ 4 req/s, run off-hours, expect a multi-hour-to-day job; the B1 gate plan allows for
it. **Image rescue:** download `uploads.linear.app` images referenced by operational
briefs/comments into the private Drive folder, rewrite stored references; archive images
best-effort with per-row gap notes.

### 5.3 Clients + team_members

§3 + corrected sources: Video Editors tab (names/emails only — **no Slack ids there**), the
hardcoded Slack fallback map inside n8n `TJVMyfwl85qrFGeK`, `WL_VIDEO_EDITORS` (Linear UUIDs),
`WL_ALLOWED_GRAPHICS`, manual Rocío Perez row, 7 SMMs from the SMM tab, admin rows.
`default_for_team` = today's hardcoded graphics auto-assignee.

### 5.4 Card linkage backfill

Resolve card link URLs (direct or alias) → set both card columns + deliverable `card_id`/
`origin`. Unresolvable links → B1 repair report. Linkage then stays current via §4.3.5.

### 5.5 Safety

Pre-B1 snapshot per ROLLBACK rule 4 (git tag `pre-B1`, official Linear export → private Drive,
Supabase dump). Only new tables are written. Every backfill row events `source='backfill'`.
"Only new tables" explicitly INCLUDES the additive `clients` / `team_members` reconciliation
inserts of §5.3 — those are Track B tables and their rows MUST land **before** `deliverables`
(FK dependency), or the backfill rejects real work. Insertion order is derived from the FK
graph: `clients` → `team_members` → `batches` → `deliverables` → `deliverable_events`.

### 5.6 Constraint preflight (MANDATORY before the first backfill write)

*Added 2026-07-06 after the clients-FK near-miss: the audit had found the facts (85 operational
issues under client slugs absent from `clients`, 60 of them project-less), but no step traced
those facts to their schema consequences, and the backfill would have failed or silently dropped
rows. The fix is mechanical, not editorial:*

Before the first write, the backfill tooling must enumerate **every constraint on every target
table** — each foreign key, NOT NULL, CHECK (status enum, team, kind), and unique index across
`batches` / `deliverables` / `deliverable_events` / `linear_archive` / `mirror_outbox` — and
compute, **from the real pulled data**, the violation count for each, plus a written handling
rule for every non-zero count. Expected classes (non-exhaustive — the sweep is the point):
missing client rows; assignees not in `team_members` (ghost/departed users → NULL + note, or
inactive member rows); sub-issues whose parent is completed / out-of-window / absent (→ the
§5.1 synthetic-batch rule); state names outside the §2.1 enum; duplicate `linear_issue_id`;
card-linkage rows whose card client ≠ deliverable client. The preflight report is a required
**B1 gate addendum**; the backfill runs only after every non-zero count has an approved rule.
A violation discovered mid-run is a stop-and-report, never a silent drop.

The full assumption sweep that motivated this section lives in
`docs/audits/2026-07-06-data-assumption-sweep.md` — 12 ranked items. Items 1/2/5/6/7/8 there
are covered by this mechanical preflight; items 3/9/10/11/12 are semantic and are hereby
attached to their phase gates (9 → B0.5 canary evidence; 11 → B1 backfill; 3/10 → B3 gate;
12 → B4 flip checklist).

**Scope of the blocking gate vs. the Linear rate budget.** The constraint gate needs only
**issue-level** fields — assignee id, state name, parent status, team, project/client, and
link resolution — all obtained in ONE paginated issue pass that fits inside Linear's hourly cap
(§5.2: ≤ 4 req/s, separate API key from the live bridges so it never starves production status
sync). **Comment-dependent checks do NOT block the gate:** item 11 (which trailing drive/f.io
comment is the delivery link) and any comment-author check are per-issue-comment reads that blow
the rate budget, and they are data-*quality* refinements, not constraint violations. Run them as
a **separate, best-effort pass** (off-hours, resumable) whose result annotates the backfill but
does not gate it. If comments can't be swept in time, the backfill proceeds with the constraint
gate satisfied and `file_url` filled best-effort, flagged for later repair — never blocked.

---

## 6. Auth — build first (B0)

Three role keys via the `client-credentials` pattern: `X-Syncview-Key` (timing-safe) +
`X-Syncview-Actor`. The header plumbing already reaches every write; B0 makes EFs **enforce and
persist** it (today's samples EF drops actor/role — measured; Track B EFs must not).

- `ROLE_KEY_ADMIN` — Sidney + Kasper.
- `ROLE_KEY_SMM` — calendar/samples writes, batch creation, assignment, approvals.
- `ROLE_KEY_CREATIVE` — deliverable status/delivery/comments on own team's work; no approvals
  for Kasper/client, no batch creation, no `client_access`.

**6.1 Login UX.** One modal: role key + **name picked from the `team_members` roster** (not free
text — a typo would silently empty "My issues" views and mis-attribute the ledger) → localStorage
→ sent on every EF write. **Tab visibility** (B2 "role-gated"): presence of a stored role key
shows the tab (cosmetic, spoofable, accepted — reads are anon anyway); a lightweight
`key-verify` EF ping at boot validates the key and resolves the member row (editor's team for
"my work" views; mismatch ⇒ treated as no key). Server-side enforcement remains write-time.

**6.2 Rollout — including the missing prerequisite the critics caught (B0.5).** Track A left all
three `*_ef_clients` flags TEST-only, so today **~0% of real production writes flow through the
EFs** — which would make the permissive-key log vacuous and the ledger/name-sync/anomaly claims
false for exactly the rows that matter. Therefore:
- **B0.5 (its own gated step, Track A canary discipline):** first fix the two known blockers
  (bulk-import verify reads the unmirrored n8n/Sheet path — false-fails for EF clients; EF
  reorder has no n8n fallback), then roll `calendar_upsert_ef_clients`,
  `sample_review_ef_clients`, `settings_ef_clients` to **all real clients**, client-by-client,
  each with the one-flag rollback. Gate: 1 week all-clients-on-EF with zero regressions.
- Only then does the §6.2 permissive window start counting: role keys **permissive** (missing
  key ⇒ allowed + logged) until the log shows **zero unkeyed writes for 72 h over real-client
  traffic**, then flip `auth_enforcement` to enforced (§1.6 flip point).
- **Retire the open n8n card-write doors at B5** (§13.4.h): once all clients are EF-routed and
  baked, the unauthenticated `calendar-upsert-post`/`sample-review-upsert`/reorder webhooks are
  deactivated — until then, fail-closed tokens coexist with those legacy doors (accepted,
  time-boxed, stated).

**6.3 Actor is the audit trail** (D7): every ledger row carries who/role/when; §2.6 guarantees a
row even for rogue writers.

**6.4 Client review links — mint, don't move; verify server-side.** The sheet column never
existed; 0/29 tokens; the gate fails open today. B0: mint per-client tokens into `client_access`;
ship **`client-token-verify` EF** (`{slug, token}` → boolean + an access-log event) — the FE
client-link boot calls it (result cached per session) because the FE can no longer compare
locally (tokens are service-role-only). Client **writes** call the same EFs with
`X-Syncview-Client-Token`, validated against `client_access`, scoped to that client's rows and
client-legal transitions only (D4 rows 8–10). Then: re-issue fresh links per client via SMMs;
gate = every active client has a token-validated access-log event; **then** flip fail-open →
fail-closed (one flag). Fail-closed UX is an in-app screen ("ask your SMM for a fresh link" —
note: a static GitHub-Pages SPA cannot emit a real HTTP 410; it's a rendered state), and the
same screen replaces the view when an already-open tab's EF calls start returning 401/410.

**6.5 Future upgrade (documented, deferred):** per-person Supabase Auth + per-client RLS.

---

## 7. Reliability & disaster recovery

**7.1 Two independent backups — with the PITR truth told (§14 D-1).** The project is (per repo
docs) on the free tier, **where PITR does not exist**. Owner options: (a) upgrade to Pro + PITR
before B1 → RPO ≈ seconds (recommended); (b) stay free → RPO = the daily export. Either way:
daily export of all Track-B tables → private Drive folder (extend the weekly-backup workflow or
a GH Action) with a >26 h freshness alarm; the weekly full backup continues.

**7.2 Reconstruct-from-events.** §2.6 makes the ledger trustworthy; `scripts/replay-deliverables.js
--verify` ships with B1 and runs weekly in CI against a scratch schema (replay == state, or
alert).

**7.3 Linear as COLD FALLBACK through cutover:** B5 freezes but does not cancel; 8-week grace;
flip-back = `prod_authority` reversal.

**7.4 Degraded read-only mode:** SWR cache per team view; on Supabase read failure render cache +
amber banner, disable writes (never fake-save — the Samples-Old "Saved on device" silent local
fallback is the named anti-pattern), poll for recovery.

**7.5 Rehearsed restore** before B4: restore export (+ PITR if Pro) into a scratch project, run
replay-verify, time it (target RTO < 1 h). The drill artifact is a named B4 gate input.

**7.6 DR runbook in `ROLLBACK.md`:** symptom → fallback → steps → who to tell; §4.7 is its
skeleton. Written + rehearsed before B4.

---

## 8. Monitoring & observability (always-on)

**8.1 Continuous reconciler v2** (GH Actions + n8n trigger, ~10 min): per team, diff Linear ⇄
`deliverables` on status / assignee (**by raw Linear user id** — §1.4d) / due / title, plus the
**linkage lane** (cards with Linear links but no deliverable ids — §4.3.5) and the **comment
lane**: engine-tracked comments must map 1:1 by comment id recorded in event payloads —
pre-B3 history and `(via SyncView)` echoes explicitly excluded (§5.1, §4.2). Tolerances per
§1.4 (roller/+2d churn, clamped states). **It APPLIES corrections toward the authoritative side**
(within SAFETY_CAP ≈ 15, abort + page beyond) — alert-only would leave webhook-missed changes
unhealed, and Linear's redelivery is bounded (§4.7). Also verifies both Linear webhooks are still
**enabled** (Linear can auto-disable after sustained failures). Every correction = ledger row
(`source='reconcile'`) + Slack. **Restarts the dead samples lane** (measured: samples reconcile
is not running today). **Excludes `clients.kind='test'` rows from alerting** (QA harness traffic
must not page the owner at 3am — probes stamp a reserved actor; a "monitoring quiet during
overnight run" checklist item lands in B2/B3).

**8.2 Health checks** (Slack on breach): writes landing; realtime alive; `sync_state='error'`
== 0; outbox depth < 20 / oldest < 30 min; backup freshness < 26 h; replay-verify weekly green;
flags valid; **webhook enabled-state probe**; n8n `errorWorkflow` wired on the transition-
critical workflows (measured: the error-alert workflow exists but is attached to NOTHING — B0
checklist item).

**8.3 Ledger anomaly scans** (meaningful thanks to §2.6): actorless events; zero-event
deliverables; repeated mirror retries; `foreign_write_detected`; same-field flapping; events
from sources illegal for the current phase/team.

**8.4 Admin dashboard** (admin role): per-team authority, drift count, outbox depth, last-backup
age, error rates, reconciler last-run, flag-flip history, **both FE outbox depths + role-key
status per browser** (the §1.5.2 drain evidence).

**8.5 Harness lanes:** `master-test`/`overnight-test` gain Production-tab lanes (§12).

---

## 9. Creation & interaction flows (LOGIC — the locked design's wiring contract)

The current-state truth is the four logic maps; the **transition table**
(`2026-07-05-logic-reviews.md` §D4) is normative for EF role gating. **The write EFs are named:**
`deliverable-write` and `batch-write` (thin HTTP wrappers over the §2.6 RPCs; payload = op-level
patches modeled on the SXR EF contract: `{id?, patch, expected_status?, expected_updated_at?,
source}` + the §6 headers; response `{ok, row}` / `{ok:false, conflict:true, row}` — same
envelope family the FE already speaks).

**9.1 Creating a card → deliverable(s).** Batch picker + "new batch"; deliverables stamped
`origin`, `card_id`, `kind`; one sample = up to TWO deliverables. In B3, creation still flows
intake→Linear and mirrors in; from B4 the card/intake creates natively and the mirror pushes.
**Split-authority window (critic add):** intake requests split per deliverable team — the
Supabase-authoritative leg creates its batch row + deliverable natively FIRST; the
Linear-authoritative leg goes through the legacy intake and, when its parent/sub-issues mirror
in, the inbound engine **adopts them into the existing batch row** by `linear_parent_ids`
matching (title+client match fallback) rather than minting a second batch. The native side owns
the SMM Slack notification; the n8n leg keeps writing the Sheets submissions log while it
exists. **Auto-assign:** port Pick Freest Editor with three *deliberate* refinements (they are
improvements, not parity bugs — do not "fix" them back during parity testing): count only
`video`-team deliverables (was: all teams under the SMM's key), exclude `duplicate` from load
(was: included), ties by stable member order (was: API order). Graphics = `default_for_team`.
Claude-generated graphics titles: §14 D-5. **AI-thumbnail chain: verified disconnected dead code
— do not port** (D-5 confirms).

**9.2 The card's two link buttons + the FOUR link-keyed predicates.** Each card's two slots
resolve through authority (Linear URL ↔ `?prod=1&d=<id>`) via the choke points
`_calLinearUrlFor` / `_sxrLinearUrlFor`. At each team's flip, re-point ALL FOUR link-keyed
predicate families from `linear_issue_id` columns to `*_deliverable_id`: (1) the status-pill
LOCK ("Link a Linear sub-issue first"), (2) the dupe-link warning, (3) the "link the sub-issue"
nudges, (4) **the Kasper-queue visibility gates** (`_calCompKasperVisible` + samples twins —
missed, these silently hide every new thumbnail from Kasper review). Paste-guards → deliverable
picker (DB uniqueness). Plus a **"create missing deliverable" affordance**: a card slot with no
deliverable (e.g. the graphic slot of a half-linked B3-era sample) offers "create thumbnail
deliverable in batch …" post-flip. No four-button period.

**9.3 Back-link + origin label** (unchanged): "open source card" + **"Sample"** /
**"Off-calendar"** tags.

**9.4 Name interconnection (one value, two surfaces).** The YouTube title IS
`calendar_posts.name`; sync = deliverable.title == card.name, keyed on EF-committed writes
(ledger), never FE optimistic state. **Loop terminator + stale-write guard (critic add):** a
rename is ONE EF transaction that updates both card `name` and deliverable `title` and emits ONE
ledger event (`title_change`) — there is no second-hop propagation write to terminate; and
`name` writes carry a base-value compare (apply only if caller's base matches current), closing
the stale-tab / bulk-import-replay revert (the `name`∉`_CAL_ROLLBACK_FIELDS` caveat). During B3
the mirror stores Linear titles verbatim; name-sync activates per team at B4; legacy mismatches
get a badge + one-time report, no mass rename (D-13).

**9.5 Comments/notes — single-writer design (ratify D-6).** Card component threads
(`video_tweaks`/`graphic_tweaks`) remain **the single store** for card-linked deliverables; the
Production tab's activity feed renders and writes that same thread (via the **existing card EFs**
— `calendar-upsert` / `sample-review-upsert` field-level comment patches, so the merge RPCs and
the **card event ledgers** keep working exactly as today; `comment_add` events for card-linked
rows land in `calendar_post_events`/`sample_review_events`, NOT double-logged into
`deliverable_events`). Editors get `role='editor'`, `audience='internal'`. Manual deliverables
use `deliverables.comments` + `deliverable_merge_comments`; batches use `batches.comments` +
`batch_merge_comments`. Caption/title threads stay card-local (no deliverable exists — verified).
**Corrected mirror premise (critic add):** today only Notes-modal messages + request-change
bodies mirror to Linear; review-panel plain comments and Kasper's comment-only adds are
deliberately app-only ("plain notes don't ping the editor"). The transition mirror **preserves
exactly today's mirrored set** — it does not start pushing the app-only classes. Inbound Linear
comments per §4.3.3 with echo filtering per §4.2. After cutover the Linear leg drops.

**9.6 Assignment & due date:** single-row writes; the calendar card shows the editor chip via
`*_deliverable_id → deliverables → team_members`.

**9.7 Delivery flows preserved:** video = frame.io folder on the batch + status →
`smm_approval`; graphics = Drive folder on batch + per-deliverable `file_url`. A pasted link in
a comment offers "set as delivery link".

**9.8 URGENT + notifications:** re-point from the n8n Linear-resolution flow to the §11 notify
EF reading `team_members.slack_user_id` (the sheet never had Slack ids). Same confirm/latch UX.

**9.9 Kasper Messages inbox:** built on card threads + `kasper_seen` — §9.5 keeps it working
unchanged, now also showing editor replies. No rebuild.

**9.10 Workload tab re-point** (per team at flip): read `deliverables` (+`team_members`) for
flipped teams; CON/STR filtered; realtime can finally turn ON (row-level writes); allowlists retire into
`team_members`.

**9.11 `editors-week` replacement (B5) — corrected semantics (critic catch):** a "delivery" is a
transition **INTO a review state** (`smm_approval|kasper_approval|client_approval`) **FROM a work
state** (`in_progress|todo|backlog|tweak`) — NOT "entering approved/posted" (that measures
client/Kasper approvals, not editor labor). Per assignee, de-bounced to ≤1 per (Chicago-day,
kind) per deliverable, with the tweak-vs-firstcut split (from-state `tweak` ⇒ tweak-delivery).
Ship as a saved query behind the Kasper Editors subtab before retiring the webhook.

---

## 10. UI — the Production tab (DESIGN LOCKED — `docs/syncview-design/`)

Prototype status: pixel/behavior parity done (11 adversarial re-audits, last six 0-high;
138-assertion suite). Build = rebuild into the repo (`_prod*` — verified free) and wire to real
data.

**10.1 Data contract mapping:**

| Prototype structure | Real source |
|---|---|
| `ISSUES` rows `{id, team, project, title, parent, status, assignee, due, created, sub:[done,total], desc, file, comments}` | `deliverables` (+ batch join); `file` = `file_url`/batch folder; `comments` = §9.5 thread |
| `PROJECTS` `{name, emoji, team}` | `clients` (`emoji` column; board membership derived per team) |
| `EDITORS` `{name, init, color}` | `team_members` (`avatar_color`) |
| `STATUS` / `STATUS_ORDER` | **same 13-status set, DIFFERENT keys** — the prototype uses `prog`/`smm`/`kasper`/`client` where the DB stores `in_progress`/`smm_approval`/`kasper_approval`/`client_approval` (other 9 match). The rebuild renames the prototype keys to the §2.1 slugs, and the ported test-suite selectors are adapted to match (§12) — do NOT feed DB slugs into unrenamed prototype lookups |
| `CLIENTS` project-board cards `{status(PSTATUS), lead, target, desc}` | `clients.board_status` / `lead_member_id` / `target_date` / `board_desc` (§2.2 — these are WRITABLE in the locked design: pickers + drag; writes go through `batch-write`-style EF ops on `clients`, evented as `board_change`) |
| `TODAY = new Date(2026,6,4)`, `DRIVE` const | real clock; real links (mock scaffolding — no mock data ships) |

**10.2 Async is a new surface:** loading/skeleton/error/stale states via the SXR module's SWR +
optimistic patterns (the canonical clone template).

**10.3 Identifier display (D-7 — corrected by the critics):** backfilled rows show their
original `linear_identifier`. Native minting uses **per-team Postgres sequences created at each
team's B4 flip, seeded = live Linear max at flip + 5,000 margin** (never a constant written in a
spec — Linear's counters advance ~100/wk/team and would cross any pre-picked number during B3),
with a flip-checklist assertion that the seed range collides with nothing in
`linear_archive.identifier` or `deliverables.linear_identifier` (§1.5.9).

**10.4 Deep links:** `?prod=1&d=<id>` (detail), `?prod=1&team=<t>` (list/board).

**10.5 Kept/removed** (unchanged): no priority/labels/cycles/inbox/triage-nav/manual new-issue;
Triage *status* kept for migrated data. Light theme now.

**10.6 The behavioral test suites are NOT in this repo** — `behav.js`/`qa-features.js`/`sweep.js`
+ the parity-audit workflow live on the design machine only. **This is an OWNER action, not a
build-session task (D-17): copy them into `docs/syncview-design/tests/` before B2.** The B2 gate
depends on it.

**10.7 Still to wire** (with owners): §9.2–9.3 links/labels/predicates; §9.4 name-sync; §9.5
threads; §6 role gating + D4 transition enforcement; realtime; §9.1 intake; §9.10 workload;
reorder persistence (`sort_key`); archive view (**read-only surface over `linear_archive` via a
role-gated EF** — the table is service-role-only, §2.7); the **staff diagnostic page** (both FE
outbox depths incl. the new `peekSxrLinearOutbox()` helper, role-key status, flag/authority
state, `min_app_version`) — it is the named evidence mechanism for §1.5 steps 2/5.

---

## 11. Notifications

Slack now, behind one `notify` EF (ro.am-swappable). Fires on: deliverable assigned, status →
`tweak` (with tweak text), status → `smm_approval`, URGENT. Every send logs an event. **Owner
input (D-14):** what does Linear's native project→Slack integration post today (~51 projects
carry `slackChannelId`) — which of it must the notify EF replicate so client channels don't go
quiet at B5? Editors also lose Linear's own inbox at cutover; the assigned/tweak notifications
are the replacement — confirm sufficiency with the pilot team during B3.

---

## 12. Testing & verification

- **Probe suite** (`qa/` SXR pattern, TEST client + TEST Linear project only): batch create →
  auto-assign → full §D4 status walk incl. undo → delivery links → editor chip on card → ledger
  row for every step (incl. raw-write trigger check §2.6) → notify fired (test channel).
- **Role/token matrix:** 3 keys × every write op; client token × scope × legal/illegal
  transitions; permissive vs enforced; `key-verify` behavior.
- **Sync/mirror drills:** loop prevention; **B3 comment-echo probe (the legacy mirror + Comments
  webhook running together — assert each app comment appears exactly once)**; B4 echo-drop
  (strict AND); per-team isolation; **two-writer race** (concurrent conflicting transitions →
  one 409, no silent overwrite); alias move; webhook delete; clamped-state tolerance; **the full
  §1.5 flip checklist executed on the TEST client via `prod_authority_client_overrides`**
  (team-level flags never flip in production for a drill — critic catch), including outbox-drain
  evidence and the detect-only straggler alert.
- **Migration dry-run** (B1 gate): counts vs audit numbers; 20-issue spot parity; repair queue;
  idempotency (second run = zero changes); rate-budget compliance.
- **DR drill** (§7.5) + replay-verify green.
- **Behavioral parity:** the design-kit suites (once in-repo, D-17) re-run against the wired tab
  with selectors adapted to the renamed status keys (§10.1).
- `npm test` + `qa/master.js` green throughout; no renames of the 11 grabFunc-extracted symbols
  until §13 retires the reconcilers.
- **Track A latent bugs fixed in B0.5** (bulk-import verify; EF reorder fallback) — verified by
  probes before any real client is flagged.

---

## 13. Cutover & teardown (B5)

1. Both teams flipped and stable; intake native; outbound mirror keeps Linear current; grace
   period begins (Linear frozen-but-live, detect-only inbound alerting).
2. Grace (target 8 weeks) with §8 green + one flip-back drill.
3. Verify archive completeness (counts vs export; image-rescue report) + private full Linear
   export in Drive.
4. Retire in order (each reversible until step 7; **private-Drive export + public status stub
   before every n8n edit** — §1.6):
   a. outbound mirror off;
   b. Linear webhooks deleted + inbound EF retired;
   c. `MJbMZ789B5ExZz9x` deactivated — verify first that the A1/A2 flag routing inside it is
      moot (all real clients on EFs since B0.5);
   d. both reconcile scripts + Actions + n8n triggers;
   e. `Workload — Reconcile` + `workload_issues` (tab reads `deliverables`);
   f. VIDEO PRODUCTION AUTOMATION's Linear branches;
   g. `linear-set-status`, `linear-add-comment`, `linear-subissues`, `linear-issue-statuses`,
      `linear-tweak-comments`, `editors-week` (→ §9.11 query). (The nightly due-date roller is
      NOT in this family — n8n was eliminated by measurement; it dies only via D-9.)
   h. **the unauthenticated legacy card-write webhooks** (`calendar-upsert-post`,
      `sample-review-upsert`, reorders — deactivate now that all clients are EF-routed; this is
      the moment §6.4's "closes the unauthenticated write path" claim becomes fully true);
   i. FE: Linear push/outbox/reassert/point-adoption/bulk-link code removed; link columns stay,
      inert.
5. **Secrets teardown:** rotate the house Linear key (hardcoded in 6+ workflows); the 7 per-SMM
   keys + sheet column are handled at D-15 (**now**, not B5); rotate the Anthropic key if D-5
   ports the title generator.
6. Mirror-tab cleanup per §3 owner list.
7. **Only after** grace + verified archive + owner sign-off: cancel Linear.

---

## 14. Gates & open decisions

**Hard gates** (evidence + owner sign-off, ROLLBACK rule 6). Every phase also: rule-4 snapshot
before start + ROLLBACK.md Live State updated in the same PR (§1.6).
- **B0 →**: vocabulary ratified (D-2); tokens minted + `client-token-verify` live; flags
  trigger + `flag_flips` live; n8n errorWorkflow wired (§8.2).
- **B0.5 →**: Track A latent bugs fixed; all real clients on all three EF flags for 1 week,
  zero regressions; THEN permissive-key log clean 72 h over real traffic → enforced.
- **B1 →**: dry-run counts match audit; **constraint preflight (§5.6) posted with every
  non-zero violation count carrying an approved handling rule**; 20-issue spot parity; repair
  queue + `active=false` list reviewed (D-16); replay-verify green; CON/STR active split
  measured (D-11).
- **B2 →**: tab renders real migrated data behind `?prod=1` for admin; design-kit suites
  in-repo (D-17) and green on the wired tab; staff diagnostic page live.
- **B3 →**: comments webhook subscribed + catch-up pull run (§4.3.4); mirror zero-diff (modulo
  §1.4) 7 consecutive days; echo probe green (§12); editor/SMM UX feedback collected.
- **B3→B4 per team**: §1.5 checklist artifacts (outbox drain, zero-diff + linkage-zero report,
  legacy-writer gates verified incl. reconcilers + n8n bridges, identifier seed check, flip +
  rollback rehearsal, detect-only alert tested) + **roller located AND disabled (D-9 — with the
  fallback below)** + editor/SMM sign-off + DR drill done.
- **B4→B5**: 2 full batch cycles per team, zero lost/wrong statuses; reconciler v2 quiet;
  owner sign-off.
- **B5 end**: grace green + archive verified before cancellation.

**Open decisions for the owner:**

| # | Decision | Context | Recommendation | Blocks |
|---|---|---|---|---|
| D-1 | PITR add-on: yes/no/when | **Owner confirmed Pro plan 2026-07-05** (good — daily backups + 7-day retention already included). PITR costs **$100/mo (7-day)** + requires Small compute (~$5/mo net after Pro credits) — it's billed **prorated to the hour**, which enables a cheap middle path | (a) NOW: add a free 6-hourly export (GH Action) → RPO ≤ 6 h; (b) enable PITR **temporarily** around the risky windows only (B1 backfill days, each B4 flip week) and disable after — prorated cost ≈ a few dollars per window; (c) revisit keeping PITR permanently at B5, when Linear stops being a live second copy. **APPROVED by owner 2026-07-05** ("enable it [per this plan]; I'm not going to pay $100/mo") — i.e. no permanent add-on; 6-hourly export ships in B0; PITR toggled on only for the named windows | B1 ✅ |
| D-2 | Ratify status slugs + mappings (§2.1), incl. the Triage no-op and the D-10 outbound split | three vocabularies measured | **RATIFIED by owner 2026-07-05** ("yeah okay, do that — smartly"). His follow-up question — should the CARD pills gain the Linear-only statuses (Backlog/Canceled/…)? — answered as specced: **no; cards keep today's 8-status review vocabulary unchanged** (zero behavior risk to the review flows); the Production tab carries the full 13; the projection shows Backlog/Todo/Triage as "In Progress" on cards exactly as the Linear sync does today. If SMMs later want a "not started yet" hint on cards, it can be added as a display badge without touching the vocabulary | B0 ✅ |
| D-3 | Priority: mirror-only (hidden) vs surfaced | in active use again; locked design has no priority UI | mirror-only + URGENT; revisit after pilot | B1 |
| D-4 | Pre-migration Linear cleanup (824 zombies + 336 stale-WIP) | §5.1 — **OPTIONAL**: the migration cutoff already sends old open issues to the archive, not the live board, so skipping this loses nothing; a cleanup only makes Linear itself tidier during the mirror phase | default = skip unless the owner wants Linear tidied; a ready-made issue list can be generated on request | — |
| D-5 | Intake extras: port Claude graphics-titles? confirm AI-thumbnail chain stays dead? | §9.1 | port titles via EF secret; thumbnails dead | B2 |
| D-6 | Ratify §9.5 single-writer comment design | card thread stays the store; Kasper inbox intact | as specced | B1 |
| D-7 | Deliverable display identifiers | §10.3 — seeds computed at flip, never constants | per-team sequences, seed = flip-time Linear max + 5,000 | B1 (design) / B4 (seed) |
| D-8 | Overdue: visible state, no auto-bump | old bumper half-dead + inconsistent | confirm | B2 |
| D-9 | Identify the ~23:45 UTC roller actor | NOT n8n (measured); owner says "certainly something we've done… probably the workload calendar." Signature narrowed 2026-07-05 from the bumped-cohort data: fires 23:45:0x–2x UTC with sub-second spacing; touches ONLY review-state issues (For SMM/Client approval, Tweak Needed) of active calendar clients; rolls due-today → tomorrow; the set shrinks night-over-night (15 → 2) — consistent with a script reading a stale external list, e.g. **an Apps Script bound to one of the Google Sheets** (owner's hunch fits). Owner's personal-account Apps Script checked 2026-07-05: only one unrelated trigger ("Kenya CV", last run 11:28 PM local — wrong time, unrelated). REMAINING checks: the same Triggers page while logged in as **sidney@synchrosocial.com** and **house@synchrosocial.com** (the sheets are owned by the workspace account, so a bound script would live there, not on the gmail account), the sheets' Extensions → Apps Script, and Linear Settings → API → personal keys/apps | still a B4 flip-gate item with the same fallback (rotate remaining personal Linear keys + scoped due-date tolerance in detect-only alerting) if not found | B4 |
| D-10 | In-Progress→Todo outbound asymmetry | §2.1 — split rule: legacy card path keeps it, deliverable-native maps straight | as specced | B0 |
| D-11 | CON/STR scope | §2.9 (measure active split at B1) | out of scope; archived at B5 | B1 |
| D-12 | Inbound comment-image fidelity | Linear image URLs expire | best-effort for new comments; rescue pass covers briefs | B3 |
| D-13 | Legacy title mismatches at B4 | §9.4 | badge + report, no mass rename | B4 |
| D-14 | Linear→Slack project integration replacement scope | §11 | owner inspects one channel | B3 |
| D-15 | Rotate the 7 public per-SMM Linear keys + remove the sheet column | publicly readable via gviz today | **DECLINED by owner 2026-07-05** ("I don't care about it") — risk accepted, same posture as D9 (hardcoded house key). Keys become moot at B5 when Linear is retired; the sheet column is still removed at §13.6 cleanup | — |
| D-16 | §3 owner review list (Coleman, Burch, terrinamar, junk quarantine) | §3 | — | B1 |
| D-17 | Copy the design-kit behavioral suites into the repo | **RESOLVED 2026-07-05**: owner shared the probe folder via Drive; `behav.js` (138 assertions), `qa-features.js`, `sweep.js`, `build.js`, and the parity-audit workflow are now committed at `docs/syncview-design/tests/` (with run + path-adaptation README). NOTE for owner: the shared Drive folder also contains `.linear-probe-profile` — a saved **Linear login session**; un-share the folder or delete that subfolder | B2 ✅ |
| D-18 | Mirror identity: dedicated Linear user seat vs OAuth-app actor | §4.2/§4.4 — must be distinct from sidney@ for echo-dropping | OAuth-app actor if available; else a machine user seat | B4 |

---

## 15. Planning process (how this doc gets to "perfect")

- ✅ Rewrite around locked decisions. ✅ Design delivered + folded in (§9/§10).
- ✅ **2026-07-05: the deep-audit + verification pass**: full live re-audit
  (`docs/audits/2026-07-05-*`), logic maps, every subsystem pressure-tested; corrections applied
  in place (sizing, tokens, PITR, status enum, card two-slot linkage, anon exposure, ledger
  enforceability, batch shapes, inbound scope, hidden writers, workload 4-team reality).
- ✅ **2026-07-05: adversarial critic pass** (4 independent lenses — execution-readiness /
  worst-case / consistency / fact-check); all confirmed findings folded in: legacy
  reconciler+webhook gating, the B0.5 real-client EF rollout phase, the B3 comment echo loop,
  client-token-verify, Kasper visibility gates, projects-board schema, flip-time identifier
  seeds, §2.6 transaction mechanics, CAS on deliverable writes, per-phase flip points, drill
  granularity, editors-week semantics, prototype status-key rename map, comment-history
  handling, archive privacy, QA/monitoring isolation, and the D-17/D-18 additions.
- ✅ **2026-07-06: the clients-FK near-miss → standing rule.** The B1 backfill preflight caught
  85 operational issues whose client slugs were absent from `clients` (the audit knew the facts;
  no step had traced them to their schema consequences). Lesson made permanent:
  **STANDING RULE — every phase's tooling must validate ALL schema constraints and referential
  closure against the real data before its first write** (§5.6 is the B1 instance; B2 card-wiring,
  B3's inbound writer, and B4's flip checklists each get the same treatment before they run).
  "Audit found the fact" is not enough — a machine check must connect facts to consequences.
- **NEXT:** owner answers §14 (D-15 immediately; D-1/D-2/D-4/D-6/D-17 before B0–B2); then the
  build session implements phase by phase under Track A's gate discipline. Everything stays in
  THIS doc + `docs/syncview-design/` + `docs/audits/` — no scattered new files.
