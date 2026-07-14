# Track B — Replacing Linear with in-app production management

**Parent doc:** `INDEPENDENCE_PLAN.md`. **Safety doctrine:** `ROLLBACK.md` (applies in full to
every phase below). **Ground-truth audits:** `docs/audits/2026-07-05-*.md` — the mandatory deep
re-audit (live Linear / n8n / Supabase / Sheets diffs vs 2026-07-03, plus the four **logic maps**:
`2026-07-05-logic-calendar.md`, `-logic-samples.md`, `-logic-reviews.md`, `-logic-sync.md`).
Read `2026-07-05-reaudit-summary.md` first — it indexes the 20 findings that shaped this revision.

**Status: IN EXECUTION — current checkpoint 2026-07-14.** Track A and B0–B3 are live; the B4
outbound pipe has historical TEST/shadow/live proof, and #812's Production controls are deployed
but authority-locked. Human cutover remains blocked: both real teams are Linear-authoritative,
outbound is off, auth is permissive, #813 remains unmerged, and the open findings in
`CUTOVER_AUDIT_2026-07-13.md` plus `GO_LIVE_CHECKLIST.md` are mandatory gates. Use
`B4_READINESS.md`, `ROLLBACK.md`, and `docs/ops/FLIP_RUNBOOK.md` for current execution state; do not
restart completed B0–B3 work from the historical planning prose below.

> **Historical-baseline warning.** The sizing and rationale below began as a **2026-07-05**
> planning snapshot. Re-pull and diff any load-bearing claim against current main/live systems;
> never trust a cited line number. The dated audit explains why decisions were made, not which
> phase should run next.

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
4. **Auth is built first (B0)** (§6). Client review links stay no-login. *(Historical annotation:
   on 2026-07-05 there were no tokens to move because the sheet column never existed. B0 has since
   minted tokens into protected `client_access` and deployed `client-token-verify`; circulating
   links and all builders are still not safely re-issued/enforced, so F03/F33 remain OPEN. Tokens
   must never be copied into the public Sheet or browser bootstrap.)*
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
8. Carried from earlier: retain the three auth **tiers**, but F31 reopens the shared-key/session
   mechanism and requires individual revocation/immutable actor proof (or a time-boxed owner risk
   acceptance); Slack now, ro.am later (D8); everything attributable with timestamps (D7); keep the
   team's exact status vocabulary (§2.1 canonicalizes it — the "exact vocabulary" turns out to be
   three conflicting vocabularies today).

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
| **B4** *Phase 2 — Shadow then authoritative rollout* | **SyncView** (after the owner flip) | SyncView → Linear (outbound) | shadow first; then authoritative for both teams | all-client shadow proof + watchers replace a per-client pilot; Linear remains the reversible fallback |
| **B5** New-only + teardown | Supabase | none (Linear frozen) | authoritative for all | Linear cold read-only fallback for a grace period, then archive + cancel |

**1.1 Authority is a runtime flag, not a deploy.** `prod_authority` starts as
`{"video":"linear","graphics":"linear"}` (B3 default) and changes to `"syncview"` per team only
at an owner-approved B4 handoff. `linear_outbound_enabled` is the independent global switch:
`off` → `shadow` → `live`. **D-25 superseded D-19's per-client pilot for proving the pipe:** the
full-roster pipe proof completed before the write UI. **D-28 now governs the human cutover:** ship
the gates with authority Linear/Linear and outbound off, soak the daily TEST drill + nightly
full-roster shadow audit, then the owner flips Graphics first; Video follows only after Graphics is
  boring. **F27/F58 supersede D-26's direct-pause mechanism:** immediate containment is stop the
  affected team's new mutations and disable the involved outbound lane(s), both F2/F4 if
  unknown/mixed; authority returns to `linear` only after
  audited per-team intent classification/resolution and a machine-read zero.
Consumed by the same proven `_calRuntimeFlagClients`-style machinery
(realtime-updated), read by: the FE Linear-push gates (§4.5), the card link-button resolver
(§9.2), the inbound engine (§4.3), the outbound mirror (§4.4), the legacy reconcilers and the
  gated n8n bridges (§4.5). A forward team flip is one owner-approved SQL update after every gate;
  rollback is **not** the same update reversed until F27's accounting gate completes. F55 also
  requires every consumer to reject the legacy `supabase` alias and accept only canonical
  `linear`/`syncview`. Two hardening rules from the critic pass:
- **Fail-safe direction is phase-aware, not constant-`linear`.** A flag-read failure must never
  silently reassign authority: every consumer caches the last-known-good value (localStorage /
  process memory) and keeps using it on read failure, with a loud alert; a cold client with no
  cached value **freezes Linear-facing writes** (explicit "sync paused — reload" UX) rather than
  guessing. (A constant `linear` default would, after a flip, quietly re-enable Linear pushes and
  point editors back at frozen Linear.)
- **Drill granularity:** the service-only TEST harness supplies a fail-closed request override that
  is accepted only for the active TEST client and privately allowlisted TEST project ids. It never
  writes a runtime flag and cannot authorize a real-client row. Production consumers read only the
  global switch plus the team authority.
Because `syncview_runtime_flags.updated_at` is **provably not maintained on update** (re-audit
F3), B0 adds a `BEFORE UPDATE` stamp trigger **and** the `flag_flips` append-only log (§2.2).

**1.2 Per-team authority in B4:** a deliverable's authority = override ??
`prod_authority[deliverable.team]`. Cross-team edges (a GRA thumbnail under a VID batch —
routine, bidirectional) follow **the deliverable's team**, never the batch's. **Batch-level
fields** (name/description/links/status/comments) follow `batches.team`; a genuinely mixed or
mirrored-pair batch (`team=null` or both `linear_parent_ids` present) freezes batch-field edits
to **admin only** while its teams' authorities disagree, and the outbound mirror never writes a
Linear parent belonging to a still-Linear-authoritative team (§4.4).

**1.3 "Exact reflection" in B3 — what it actually requires.** The original status-only path was
replaced by the B3 inbound engine, which reflects **title, due date, assignee, priority, parent,
archived/deleted state, and Linear-origin comments**. Part 1 (#809) added the Comments webhook
capture, normalized durable store, historical Linear comment backfill, and protected staff thread
reader. **This did not migrate the active Calendar/Samples thread stores or provide client reads;
F42/F43 keep the comment epoch open.** Fields
the UI doesn't show remain preserved verbatim in `deliverables.linear_raw` (§2.4); comments live in
`production_comments`, not in `linear_raw` snapshots or body-bearing ledger payloads.

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

**1.5 The B3→B4 flip checklist** — expanded with the re-audit's hidden-writer inventory and the
critic findings. D-25's all-client proof established the outbound pipe; D-28 refines the human
rollout to Graphics first, then Video after an independently boring window. Run this checklist per
team. D-29 keeps incident containment per team, while F27/R2 governs any authority reversal:

1. With live flags still authority Linear/Linear and outbound off, accumulate the D-28 green soak:
   daily TEST write drill + nightly full-roster read-only shadow audit through the pager. Require
   every watcher live, shadow results clean, and the TEST project passing
   create→status→comment→due→assignee plus pause/resume, stale-tab, and both lane-specific kill
   switches. Record owner approval to enter the final handoff window; **do not flip yet**.
2. Announce the brief final freeze to the team. Quiesce app-side outbound: verify both localStorage outboxes are **drained on every staff
   browser** via the B2 staff diagnostic page (§10.7 — it reads both outbox keys; note
   `peekLinearOutbox()` exists today but an SXR peek helper does **not** and must be shipped in
   B2; the only SXR console helper today is the destructive `clearSxrLinearOutbox()`).
3. Final inbound reconcile; verify **zero diff** for that team (statuses, assignees — via raw
   user id, due dates modulo §1.4 tolerances, titles, engine-tracked comments per §8.1) **and
   zero cards carrying a Linear link with no `*_deliverable_id`** (linkage completeness, §4.3.5).
4. Verify every serving legacy writer is gated for that team: FE push gates (§4.5), **both
   reconcile scripts** (skip / detect-only for
   Supabase-authoritative teams — they are bidirectional writers and MUST be gated, or a
   straggler Linear edit re-enters through `pullLinearToCard` within 10 minutes), and the
   **n8n `linear-set-status` / `linear-add-comment` webhooks themselves** (server-side
   `prod_authority` check inside each — one snapshotted n8n edit per workflow — so stale-JS tabs
   and late outbox flushes are refused centrally, not just client-side). Separately machine-read
   `MJbMZ789B5ExZz9x`: it was inactive/unpublished on 2026-07-13, while its saved graph contained
   authority gates. Before parity/flip the owner must choose and drill either a repaired/published
   fast path or an explicit reconciler-only SLA; a saved gate is neither a live watcher nor a reason
   to publish an unexplained crash topology.
5. Repoint the card link buttons + status-pill lock predicate + **the Kasper-queue visibility
   gates** (§9.2 — the unlinked-graphic gates at `_calCompKasperVisible` and twins; missing this
   silently drops every new thumbnail out of Kasper review) for that team; probe: a new
   Linear-link-less sample appears in the Kasper queue.
6. Prove that inbound will remain running in **detect-only** mode for the flipped team: events are
   not applied;
   they are logged to `deliverable_events` (`source='mirror', action='foreign_write_detected'`)
   and Slack-alerted — catching the straggler editor still writing in Linear for the whole
   B4+B5 grace period. Exercise this branch on TEST before the real flip.
7. Verify the native identifier sequence for the team is seeded **above the live Linear max at
   flip time + margin** and collides with nothing in `linear_archive`/`deliverables` (§10.3).
8. Complete the rollback rehearsal (ROLLBACK rule 7): on TEST, stop new writes, snapshot and classify the
     team's outbox, replay/quarantine/discard with an audited decision, prove a machine-read team
     zero, only then reverse authority and confirm Linear-authoritative flow. Re-soak before flipping
     forward. **A direct flip-back or default-drainer green is not a rehearsal (F05/F27).**
9. **Only after steps 1–8 are green**, prove exact zero real, non-parity normal rows for both teams in
   `pending|failed|shadow_ok`, owner-classifying/resolving any residue. Then enable and read back
   global normal outbound **while both teams are still Linear-authoritative** and require a fresh
   healthy drainer/credential/pager heartbeat plus the same fresh both-team zero. The heartbeat has
   zero normal-lane writes; any writes exactly equal expected, acknowledged `legacy_parity_written`.
   Per-row authority pauses normal residue in this intermediate state, but paused nonzero can starve
   the global batch or become writable at F1 and is not green. Only then flip Graphics authority to `syncview` and read back both flags
   (F98); never open authority before F2. Video remains `linear`. The later Video
   handoff changes only its authority after repeating the human/readiness gates and re-reading the
   already-live global outbound/parity state; it must not execute F2 forward a second time. Log every owner action in
   `flag_flips` + `EXECUTION_LOG.md` and update the ROLLBACK Live State row.
10. Observe the first real handoff and every watcher. A cosmetic defect is fixed in place. For an
    authoritative-data defect, stop affected mutations and disable the involved outbound lane(s);
    authority reverses only after F27/R2's snapshot, classification, resolution, and team-zero proof.

**1.6 Per-phase flip point, snapshot, and Live-State discipline (ROLLBACK rules 1/4 + the
Live-State mandate apply to every phase, not just B1):**

| Phase | Single flip point (kill switch) | Rollback |
|---|---|---|
| B0 | `auth_enforcement` runtime flag (`permissive` → `enforced`) | preserve enforcement; revert/fix the failed caller or verifier. Global permissive is an owner security-incident action only, with compensating server containment, forced session/cache invalidation, monitoring, and expiry (F70) |
| B0.5 | the three `*_ef_clients` routing flags (per client) | **auth-preserving rollback is currently blocked (F67):** removal/empty list selects an unauthenticated n8n writer. Fail visibly and repair/revert the authenticated caller/EF until every retained fallback enforces equivalent immutable principal/client scope |
| B1 | additive tables only; no behavior flip | drop nothing; old world untouched |
| B2 | `?prod=1` + role gate (tab hidden by default) | hide tab (flag) |
| B3 | `linear_inbound_enabled` runtime flag (+ webhook disable in Linear as the hard kill) | set false / disable webhook |
| B4 | independent F2 normal mode + F4 parity gate + `prod_authority[team]` | immediate containment: stop users and disable the involved lane(s), both F2/F4 if unknown/mixed; authority may return to `linear` only after F27's audited team intent classification/replay/discard and machine-read zero |
| B5 | each teardown action is owner-gated and may proceed only after its exact inverse/restore readback is captured and drilled (§13/F60) | restore only a verified, owner-approved workflow graph/webhook and drill it before use; F46 forbids blind-publishing the retained `MJb...` export until the owner resolves its response-topology ambiguity |

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
  comments text,                          -- legacy compatibility only; new issue threads use production_comments
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
  kind text not null check (kind in ('video','thumbnail','other')),
    -- 'other' added 2026-07-06: the B1 constraint preflight measured 28 operational issues
    -- that are neither (GRA banners/carousels/brand-kit tasks, VID scripts/admin). Backfill
    -- defaults them to 'other' (list posted in the B1 gate PR); reclassify in-app later.
    -- UI: generic icon, excluded from kind-specific review logic.
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
  comments text,                          -- legacy compatibility only; new issue threads use production_comments
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

create table production_comments (       -- Part 1 #809 normalized issue thread (§9.5)
  id text primary key,
  idempotency_key text not null unique,
  native_comment_id text unique,
  deliverable_id text references deliverables(id),
  batch_id text references batches(id),
  client_slug text, team text not null,
  linear_issue_uuid text, linear_identifier text,
  linear_comment_id text unique,
  parent_id text references production_comments(id),
  thread_root_id text references production_comments(id),
  linear_parent_comment_id text, linear_thread_root_id text,
  author_key text not null,
  author_member_id uuid references team_members(id),
  linear_author_id text, author_name text not null,
  role text not null,
  transport_actor text, transport_role text, transport_linear_user_id text,
  body text not null, body_format text not null, attachments jsonb not null,
  audience text not null, component text, is_tweak boolean not null, round integer,
  origin text not null, source text not null,
  source_created_at timestamptz, source_updated_at timestamptz not null,
  edited_at timestamptz, deleted_at timestamptz,
  deleted_by_key text, deleted_by_name text,
  resolved_at timestamptz, resolved_by_key text, resolved_by_name text,
  version integer not null,
  import_run_id text, backfill_tag text, provenance jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null, ingested_at timestamptz not null
);
-- Service-role writes only. Browser reads page through the authenticated production-comments EF;
-- comment text is not granted to the anon REST role.

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

### 2.3 Why relational integrity can give "change once, updates everywhere"

`deliverables` is the single canonical row per task. Realtime can update readers of that row, but
it does not by itself translate the 13-status Production vocabulary into the separate 8-status
Calendar/Samples review field. **Implementation correction F50 (2026-07-13): that projection is
not present today.** Before either team flips, implement an explicit mapping/conflict-authority
transaction or move every affected reader to canonical deliverable state; prove both directions on
TEST and monitor linked-row mismatches. Due, assignee, title, and artifact display likewise require
surface-specific readback rather than an assumption that linkage IDs fan out values automatically.

### 2.4 `linear_raw` and the §1 lossless promise

`linear_raw jsonb` (+ `priority`, + verbatim `linear_archive.raw`) is where every non-comment
Linear field the UI hides still lives. Comment history is not assumed to exist in these snapshots:
Part 1 imported it directly from Linear into `production_comments` and reconciles by stable comment
id. Post-B5 `linear_raw` freezes as historical issue context.

### 2.5 Timestamps/types

New tables use real types. Legacy card JSON threads remain byte-compatible during transition, but
Production issue comments are normalized rows in `production_comments`; edits/deletes are
lifecycle timestamps, not destructive rewrites. `production_comment_write` is service-role-only
and atomically merges that row with its ledger/outbox intent (§4.4/§9.5).

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

### 2.7 Read-exposure policy (F86/F88 decision OPEN; fail closed for new work)

**Default for every unlisted table is service-role only.** No raw anonymous-readable list is
approved here. F88 proves the current browser-key policy exposes nonempty operational tables across
content, events, Production, settings, and directories; F86 proves the raw staff/client tables
include inactive rows and internal email/Slack/Linear/project-mapping fields beyond the sign-in
surface's least-field need. The owner/legal/client decision remains explicit: either classify and
accept each exposed field as intentionally public, or move each browser consumer to a
principal/client/role-scoped least-field projection and revoke raw anonymous access. Until that
decision and migration are complete, new Track-B tables/readers must fail closed and must not add
`using(true)` parity policies.

`client_access`, `mirror_outbox`, `production_comments`, and **`linear_archive`** remain
service-role-only. The archive contains internal feedback, client briefs, and delivery links; its
UI must read through an authenticated, audience/role-scoped function (§10.7). The protected
comment reader remains subject to F39's target/team enforcement. Staff email exposure is no longer
treated as a standing accepted design decision. Any future table requires an explicit field-level
classification, owner, consumer list, and direct-REST/cross-client denial proof before read access
is widened.

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
  client (up to 3 measured), including the measured client whose VID and GRA work uses split projects.
- **Special rows seeded at B1:** one internal operations row, one dedicated TEST row, and
  **`unattributed`** (`kind='internal'`, `active=true` — the repair-queue
  home for the 137 open issues with no project; visible in staff UI, excluded from client-facing
  pickers by `kind`). The roster cutover query stays `where active` (today's effective roster
  already includes the internal/test rows).
- **Owner review list (B1 gate):** 26 three-source clients; 3 sheet-only rows; 4 seed-only rows
  (two default inactive, one internal, one TEST); two cross-source status/ownership conflicts; one
  normalized-spelling collision; and a junk/test quarantine. Exact identifiers and the chosen
  canonical spelling stay in the private B1 artifact. Expect roughly 30+ `active=false` entries.
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

Every write carries `source`; transport suppression is separate from durable storage. Two measured
echo channels get explicit treatment:

- **B4 outbound echo:** the mirror's own Linear writes come back as webhook deliveries ~1 s
  later. Drop rule = **strict AND**: (webhook actor == the mirror's own Linear identity) AND
  (payload equals the op recorded in `mirror_outbox`/ledger for that issue — value match, not
  just actor match). The mirror identity must be **distinct from the legacy house identity** (a
  dedicated Linear user or OAuth-app actor — the house identity is used by n8n and by real humans;
  actor-only matching against it would swallow legitimate writes). §14 D-18.
- **Comment echo:** Part 1 (#809) made `production_comments` the durable normalized thread. The
  inbound path stores native, manual-Linear, legacy-bridge `(via SyncView)`, and outbound-mirror
  comments idempotently by stable native/Linear ids; a transport identity never replaces the
  stable human author carried by the originating intent. Bridge-authored comments are therefore
  **not dropped from storage**. Echo suppression applies only to the later write-loop decision:
  acknowledged mirror actor + matching outbox marker/value means "already sent", not "delete or
  hide this comment". Comment webhook retries merge lifecycle state (edit/delete/parent/audience)
  onto the same row.

### 4.3 Inbound engine (new EF `linear-inbound`)

1. **Transport:** new Linear webhooks (per team) → EF; HMAC-SHA256 verification + ~60 s replay
   guard. Kill switch: `linear_inbound_enabled` flag (§1.6) + webhook disable as the hard stop.
   The two legacy Linear webhook configurations still target `MJbMZ`, but that n8n workflow is
   inactive/unpublished and supplies no current card-patch fast path; scheduled reconcilers heal.
   F46 requires a deliberate, drilled topology decision before any publish.
2. **Field scope:** state (UUID→slug), title, dueDate, assignee (via `linear_user_id`/email;
   unknown → null + `payload.unknown_assignee` + repair list, §1.4d), priority, parent change,
   archive/restore, **delete** (webhook `remove`), team move (alias push into `linear_aliases`;
   `linear_issue_uuid` stays the key). Clamped states per §1.4c. Unknown state UUID → verbatim
   into `linear_raw` + `payload.unmapped_state` + Slack alert.
3. **Inbound comments:** normalize every comment into `production_comments` with body, stable human
   author, timestamp, native + Linear ids, parent/thread metadata, role/audience, and edit/delete
   state. The body is stored verbatim Markdown and image URLs remain as-is (expiring — §14 D-12).
   The ledger may carry a lifecycle/audit projection, but is not the body store. Storage and
   write-loop suppression are deliberately separate per §4.2.
4. **Linear comments capture + history (completed in Part 1 #809):** the Comments resource is
   subscribed, live lifecycle events normalize into `production_comments`, and the restartable
   direct-Linear history import reconciled the pre-subscription gap. Re-runs are idempotent and
   tag-rollbackable. **Separate open gate (F42/F43):** migrate active Calendar/Samples roots/replies
   from their actual source arrays, reconcile composite identities/lifecycle, and route every card,
   Production, and client entry point through the canonical thread before enrollment.
5. **Card-linkage maintenance (continuous, not one-off):** on issue create/update, resolve the
   issue's URL/uuid against card Linear-link columns (and vice versa on card link_set events via
   the card EFs) and keep `video_deliverable_id`/`graphic_deliverable_id` current. Reconciler v2
   carries a linkage lane ("0 cards with a Linear link and no deliverable id"). Without this,
   every card created during B2–B4 is status-dead at the flip (measured failure mode).
6. **Writer:** everything lands via `deliverable_write()`/`batch_write()` RPCs (§2.6) with
   `source='mirror'`, `action='mirror_in'` + specific action.
7. **Detect-only mode** per flipped team (§1.5.8).

### 4.4 Outbound mirror (new EF `linear-outbound` + `mirror_outbox`, B4 per team)

**Part 2 implementation state (2026-07-14):** the gateway/outbound/parity backend is deployed;
#812 is a live browser caller for authority-gated Production operations. Both real teams remain
Linear-authoritative, global normal outbound is off, and legacy parity is disabled, so real-team
controls stay read-only. #813's broader Calendar/SXR reroutes remain unmerged and lack the required
cohort boundary (F02/F23); no current proof authorizes a forward flag change.

- **Authenticated browser gateway:** `production-write` is the only browser-reachable Track-B write
  gateway. It accepts either a staff role key plus an active roster identity or a client token
  scoped to its own client; if both credential types are present it rejects the request. The
  matched secret decides the principal and permission set — claimed role, actor, source, and other
  headers never elevate. Missing/invalid credentials return 401; authenticated but out-of-scope
  requests return 403. Client tokens may add comments and perform only the client-legal approval /
  tweak transitions for their own client. Staff permissions follow §6. Low-level
  `deliverable-write` and `batch-write` HTTP wrappers are service-only so they cannot bypass this
  policy.
- **Authority + concurrency gate:** the gateway resolves the target row's team and validates a
  last-known-good `prod_authority` value before the first write. Normal Production operations are
  accepted only for a `syncview`-authoritative team; active TEST-client requests have a bounded,
  fail-closed override that cannot target a real client/project. Writes carry compare-and-set
  (`expected_status` / `expected_updated_at`), stable request/dedup ids, server-derived actor/role,
  and server timestamp. A conflict returns 409 with current state; retries are idempotent.
- **Durable transaction:** the gateway routes scalar mutations through the
  `deliverable_write`/`batch_write` RPCs and comments through `production_comment_write`, which
  stores the normalized `production_comments` row, ledger event, and one outbox intent atomically.
  The outbox row carries entity/operation/payload, `dedup_key`, actor/role, and
  `source_edited_at`; retries and outcomes remain server-side, never in a new browser queue.
  Supported native operations are create, status, comment, due, assignee, title, priority, parent,
  archive, and restore.
- **Three-way normal-lane switch:** `linear_outbound_enabled={"mode":"off"}` remains the normal default. `shadow`
  resolves the exact GraphQL mutation and variables, compares them with current Linear state, and
  records `shadow_ok` without sending. `live` sends through the dedicated
  `LINEAR_MIRROR_API_KEY`. A row advances in either mode only when its team's
  `prod_authority` is `syncview`; otherwise it stays queued.
- **Allowlisted legacy-parity lane:** rerouted Calendar/SXR status+comment intents and Submit
  create intents still save natively first while their team is Linear-authoritative, then request
  a targeted drain of that exact outbox dedup key. Only server-derived, allowlisted
  `create|status|comment` intents may carry `legacy_parity=true`; due, assignee, Production-tab
  writes, arbitrary rows, and broad drains cannot use the lane. Its independent
  `linear_legacy_parity_enabled` kill switch must be enabled as well as team authority=`linear`.
  This narrow compatibility lane does not turn on global outbound, has terminal no-redrain
  semantics, and is replaced automatically by the normal lane after that team's flip. The caller
  never performs a second Linear write, so there is no double-write. The legacy +2d overdue status
  side effect is deliberately not ported.
- **Newest-edit-wins:** every row records the SyncView edit timestamp. Before shadow or live work,
  the drainer reads the relevant current Linear value and its field clock. A newer direct-Linear
  edit marks the queued row `stale` rather than overwriting it. Comments are additive and therefore
  do not stale-drop because an unrelated issue field changed.
- **Create/idempotency:** create uses a deterministic Linear-valid UUID derived from `dedup_key`,
  checkpoints the Linear result before local linkage, and re-draining a written row is a no-op.
  Parent create is an explicit dependency; a child is never mistaken for its own parent.
- **Historical structure freeze (D-27):** outbound never restructures historical work. `parent`
  and `restore` are classified `tolerated_historical` and are neither enqueued nor sent when the
  entity was created before `2026-07-12T04:48:56.000Z` (the B4 implementation merge boundary)
  **and** has explicit historical provenance: `created_by` is `linear-backfill` or
  `history-backfill-2026-07-10`, `origin='backfill'`, or
  `linear_raw.issue.completedAt` predates that boundary. A row created at/after the boundary, or
  an older active/manual row without that evidence, remains live-era and may emit `parent` or
  `restore`. Every other operation, including `archive`, is unchanged.
- **Echo prevention:** outbound comments carry the established `(via SyncView)` convention plus an
  internal dedup marker. `linear-inbound` classifies the webhook as an acknowledged echo only when
  its actor is the dedicated mirror identity **and** its value/marker matches the outbox intent. It
  still upserts Linear identity/lifecycle onto the normalized comment row; it suppresses only a
  second local mutation/outbound intent. The drainer checkpoints acknowledgment before final status
  so a fast webhook cannot race the guard.
- **Pause/resume (D-26, mechanism superseded by F27/F58):** stop affected users and disable/read
  the involved lane(s)—F2 normal, F4 parity, or both if unknown/mixed. Snapshot and classify every
  team pending/retry/failed intent; replay, quarantine, or discard only with an audited owner reason;
  prove a machine-read team zero before changing authority to `linear`. Inbound may then apply
  Linear truth. Timestamp-based stale dropping is a resume safeguard, not rollback accounting.
- **Recovery and monitoring:** the scheduled Actions worker drains capped batches and writes one
  `source='outbound'` summary event per run. The n8n pager dispatches/checks it and pages on failed
  writes, growing backlog above threshold, volume spikes, shadow mismatch, or stale summaries while
  mode is active. Reconciler v2 measures both directions; outbound healing only enqueues through the
  same RPC path when the team is SyncView-authoritative. A missing known Linear comment requeues its
  original idempotent outbox row through the service-only `mirror_outbox_requeue` RPC rather than
  minting a second dedup key.
- **Required but not yet implemented side effect (D-30, superseding D-8):** a status change on an
  overdue item must apply the legacy +2-day bump through the native write transaction, behind its
  own kill flag. This is a write-UI epoch gate, not an allowed behavior drop.
- **Not synced:** labels, estimates, and cycles.

### 4.5 The legacy pipes during transition (measured dependencies — gate, don't guess)

Before any team flip, every **serving** bypass receives a server-side authority check: the
`linear-set-status`, `linear-add-comment`, `video-form`, and `graphic-form` n8n mutation webhooks;
both legacy apply reconcilers; and the B1 incremental apply. A SyncView-authoritative target is
refused or classified detect-only before an authoritative field can be changed. The
Calendar/Samples/Workload receiver `MJbMZ789B5ExZz9x` is currently inactive/unpublished; its saved
graph is authority-gated but cannot be counted as a live fast path. Its pre-flip gate is therefore a
topology decision plus machine readback (active state, active-version/node fingerprint, last-green
execution), not an automatic publish. n8n edits follow the snapshot rule (§1.6 — private export +
public-safe stub, disable-not-delete).

**Authority is not caller authentication (F91).** The four active n8n mutation webhooks above
currently accept no incoming staff/client credential; with both teams Linear-authoritative their
direction gate permits the serving path. This is a current containment blocker, not work to defer
until the team flip. Status/comment require an active immutable staff/client principal as
appropriate. Video/graphics intake requires staff auth or an owner-ratified, server-minted,
short-lived exact-client capability if the shareable intake product is retained. Every path must
resolve scope server-side, audit immutable actor/role, bound requests, enforce idempotency, and pass
deployed anonymous/expired/cross-client negative tests without production writes. The later native
reroute and B5 retirement do not excuse an unauthenticated transition epoch.

**The non-Linear Sales Intake route is retained, not exempt (F106/F107).** Its active privileged
workflow also authenticates no caller, returns success before email completes, trusts
browser-round-tripped preview state, and has no durable replay key. Track B does not migrate this
route, but go-live still depends on the agency lifecycle working safely. Bind an active individual
Kasper/Admin principal before side effects and replace the response with a server-owned,
idempotent receipt/state machine; otherwise deactivate it and use the manual process.

The browser reroute is shipped only after those central gates. Production status/comment/due/
assignee controls are enabled per deliverable team only when its last-known-good authority is
`syncview`, except for the bounded active-TEST override. A Linear-authoritative team renders the
same read-only controls as B3 because inbound would otherwise overwrite the edit. Calendar, SXR,
SMM bridge callers, and Submit call `production-write`; they do not call both the gateway and an
n8n Linear mutation webhook. Submit creates batches/deliverables natively and uses returned native
ids for card jobs instead of polling Linear.

Existing `syncview_linear_outbox_v1`, `syncview_sxr_linear_outbox_v1`, and
`syncview_calCardJobs_v1` data is drain-only migration debt. Startup, focus, timer, online,
visibility, and resume paths re-check server authority before flushing; a gated stale item is
terminally discarded/logged rather than sent around the gateway. No new item is written to those
queues. Calendar/SXR cache namespaces are version-bumped so a seven-day cache cannot revive a
legacy Linear URL or caller. A cold authority read failure freezes writes and asks for reload; it
never guesses `linear` or `syncview`.

D-28 rollout is team-scoped with no deploy at flip time: daily TEST write drills plus the nightly
full-roster shadow audit must stay green through the soak window, then the owner may flip Graphics
first. Video remains read-only/Linear-authoritative until its own gate is green. D-29 treats a
cosmetic defect as fix-in-place; an authoritative-data defect pauses only the affected team through
D-26 unless evidence shows a systemic failure.

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
| Linear down (B4) | outbox depth alarm | SyncView-authoritative work remains saved; mirror pauses | outbox drains on recovery | none |
| Supabase down | FE read failures; health check | B3: editors keep working in Linear; B4: degraded read-only (§7.4); **writes are refused loudly** (no background client queue — consistent with §4.4's removal of localStorage outboxes) | outbox/reconciler verify on recovery | none if refusals are loud; PITR/exports cover storage loss |
| Comment lost in mirror | engine-tracked comment map (§8.1) | authoritative store written first | re-push from thread (idempotent by comment id) | none |
| Client renamed mid-flight | rename event | slugs immutable; display-only rename | — | none |
| Editor assigned to deleted batch/card | FK + soft-delete cards | archive view renders | reassign UI; foreign-write alert | none |
| Status change with no actor | §2.6 trigger + actorless-event alert | — | ledger + `flag_flips` forensics | none |
| Backup can't restore | §7.5 rehearsal BEFORE B4 (gate artifact) | — | PITR/export | bounded by tested RPO |
| Straggler Linear write after flip | detect-only inbound alert (seconds) | not applied | manual merge via tab | none (event holds payload) |
| Stale-JS tab / closed-laptop outbox fires post-flip | server-side gates in the n8n bridges refuse it (§1.5.5); refusals logged | centrally refused regardless of client state | `min_app_version` forced reload | none |
| EF platform outage | "not saved" chips + health probe | reads unaffected; pre-B4 n8n paths unaffected | explicit user retry | none |
| Realtime outage | **Target only — OPEN under F95:** staleness watchdog → banner + poll; the shipped Production tab has no operational realtime/poll watchdog | SWR refetch-on-focus exists, but a continuously foreground tab can stay stale | add bounded foreground catch-up/manual refresh and prove two-tab recovery | not yet proved |
| Flag corruption / unreadable | consumer validation; last-known-good cache (§1.1) | freeze writes on cold-no-cache; never reassign authority silently | fix flag; `flag_flips` forensics | none |
| Backfill crash mid-run | idempotent + re-runnable; dry-run counts gate | additive tables; old world untouched | re-run; verify counts | none |
| Archive pull rate-limits production bridges | §5.2 throttle budget + off-hours schedule | resume tokens | resume | none |
| Pro database disk/usage approaches its live limit | monthly Management API + Dashboard Usage readback | 2026-07-13 baseline was 0.45 GiB used; alert on measured trend rather than the obsolete 500 MB Free assumption | prune `linear_raw` post-B5 / resize deliberately | none |

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

**Completed-run rule (F103):** an executed migration ID is terminal, not a standing idempotency
credential. Reject it server-side before any write. A future import requires a fresh owner-approved
ID, immutable source checkpoint/hash, exact current dry run, pinned script/schema commit, expiry,
TEST rehearsal, and dependency-safe compensating plan. Executed playbooks retain evidence only;
they expose no runnable apply/delete/recovery command.

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
`X-Syncview-Actor`. The `production-write` gateway validates these at every request and persists
the resolved principal; browser claims never select authority or role.

- `ROLE_KEY_ADMIN` — Sidney + Kasper.
- `ROLE_KEY_SMM` — calendar/samples writes, batch creation, assignment, approvals.
- `ROLE_KEY_CREATIVE` — deliverable status/delivery/comments on own team's work; no approvals
  for Kasper/client, no batch creation, no `client_access`.

**6.0 Write-boundary rule (Part 2): secret decides.** `production-write` is the only browser
gateway for Track-B mutations. Exactly one auth mode is accepted:

- staff role-key secret + roster member id: the matched secret establishes the key family and the
  selected active row establishes the **claimed** member/role/team authorization. Under today's
  shared-key model it does not prove which holder acted (F31); immutable human attribution requires
  an individually revocable server session;
- client token: an active `client_access` row establishes the client principal and scopes every
  target to that same client; or
- service-authenticated TEST override: only the active TEST client and privately allowlisted TEST
  projects, with an explicit confirmation value. It cannot authorize a real row and never changes
  a runtime flag.

Missing or invalid credentials are 401. A valid credential with the wrong actor, role, client,
team, transition, or operation is 403. Unknown/unavailable authority fails closed; a valid write
against a Linear-authoritative team is 409 unless it is an allowlisted legacy-parity intent from
§4.4. Role/source/actor headers are audit hints only and cannot elevate. Direct
`deliverable-write`/`batch-write` wrappers and write RPCs are service-only; granting the anon key
their old HTTP permission would bypass the gateway and is forbidden.

**6.1 Login UX.** One modal: role key + **name picked from the `team_members` roster** (not free
text — a typo would silently empty "My issues" views and mis-attribute the ledger) → localStorage
→ sent on every EF write. **Tab visibility** (B2 "role-gated"): presence of a stored role key
shows the tab (cosmetic, spoofable, accepted — reads are anon anyway); a lightweight
`key-verify` EF ping at boot validates the key and resolves the member row (editor's team for
"my work" views; mismatch ⇒ treated as no key). Server-side enforcement remains write-time.

**6.2 Rollout record — B0.5 is complete; auth enforcement is not.** This subsection originally
described a missing prerequisite. The two Track-A blockers were fixed, all three `*_ef_clients`
flags reached the full active roster on 2026-07-07, and the three-day zero-fallback close-out
completed on 2026-07-10. Do not re-run that rollout or describe the flags as TEST-only.

- `auth_enforcement` remains **permissive**. Staff sign-in and protected B4 operations exist, but
  F35 proves six Track-A service-role writers still accept public unauthenticated calls. The
  enforcement decision therefore remains a security gate, not an elapsed-time flip.
- **F97 sequencing correction:** the canonical checklist previously never executed the already
  documented F5 forward action. GO_LIVE Phase 0.75 now requires all Phase-0 auth/read/write findings,
  exact current-token roster evidence, stale-verdict/session invalidation, CAS/readback, and negative
  proof before any real-client parity cohort. No real cohort or team handoff may start while this
  flag is permissive, missing, malformed, or supported only by expired evidence.
- F03/F33 still block safe client-link re-issuance: tokens exist only in protected storage; every
  builder/distribution path and revocation/cache behavior must be proven before enforcement.
- The legacy n8n card-write webhooks remain reachable and are selected for unlisted clients, flag
  read failures, and some EF failures. They are unauthenticated service-role writers (F67), not
  approved recovery paths. Block flag-removal/empty-list rollback, fail visibly on dependency
  failure, and either add equivalent immutable principal/client authorization or retire the webhook
  **before auth enforcement or either human flip**, after every caller/stale tab is accounted for.
  B5 may archive/delete only an already-contained zero-caller path; it is not the deadline for
  closing anonymous write access.
- New-client onboarding is not a completed Track-B enrollment path (F69/F110). The active standard
  and AI submit graphs acknowledge the intake-row insert, then dispatch provisioning without
  waiting while credential import is fail-soft; duplicate-row success resumes neither branch.
  Before any new client is called live, one server-owned job must durably read back every mapping,
  token/revision, authority, authenticated routing/policy, credential, and legacy provisioning
  receipt. Its protected status surface must distinguish captured/processing/complete/failed and
  resume the same job across partial failure, lost response, duplicate click, and capture-only
  replay. Operators start from that SyncView receipt/inbox—not the replaced Notion workflow (F111).

**6.3 Actor is the audit-trail target** (D7): every accepted write must carry an immutable,
server-resolved human/member identity, actual role, and server timestamp. This target is **not yet
met**: F31 shows shared keys plus caller-selected roster identities permit impersonation and lack
individual revocation, while F35 shows public Track-A writers can trust caller-supplied actor/role.
Ledger presence alone is not attribution proof; close those gates before relying on D7.

**6.4 Client review links — current state and required closure.** The sheet token column never
existed. B0 has minted 32 unique tokens in service-role-only `client_access`, and
`client-token-verify` plus token-scoped `production-write` are live. Distribution is still blocked:
circulating links are token-less, all four link builders lack a safe exact-client token source, and
F33 forbids putting bearer tokens into the anonymous Sheet/bootstrap. F38 also proves verifier
500/network/malformed responses are positively cached and an already-open tab survives revocation;
the verifier does not join `clients.active`. F89 proves the current telemetry cannot certify this
gate: `ok` records access-allowed, so the last seven days contain hundreds of permissive tokenless
`ok=true` events and zero valid-token events. Build a staff-authenticated exact-client link endpoint,
keep each SMM responsible for re-sharing their clients, fail closed on every enforced-mode verifier
error, require active client/current token revision, and revalidate/purge on boot/focus/pageshow/
online/rotation/offboarding. Persist separate credential-valid and access-allowed evidence. Gate =
every active client has a fresh exact valid event at current revision, no missing/extra/stale rows,
and same-tab/second-device/offline-return/offboarding drills pass. The denial UX is in-app; a static
Pages SPA does not itself emit HTTP 410.

**Unknown-client entry correction (F102):** a nonempty `?c=` currently bypasses the password before
client resolution. An unknown slug skips the verifier and falls into staff Home; adding `?prod=1`
reaches Production before the client branch. Replace this boolean shortcut with resolve+verify-first
entry, an explicit server-owned client-view allowlist, no pre-verification data/cache load, invalid-
link state for every unknown/malformed/cross-route combination, and individually verified staff
sessions for staff/Production routes. F38/F89/F97 closure does not imply this route is closed.

**6.5 Individual staff sessions are a pre-flip security gate (F31), not a generic future upgrade.**
Shared role keys may retain tier selection, but accepted writes need an individually revocable
server session with immutable member ID and version invalidation. The only alternative is an
explicit owner-signed, time-boxed residual-risk acceptance with compensating controls and a tested
offboarding/forced-login procedure. **F88 supersedes the former “deferred hardening” sentence for
read confidentiality:** client-token verification controls SPA behavior only, while 20 nonempty
operational tables remain directly anon-selectable. The owner must either explicitly accept—with
legal/client review—that their exposed fields are public and tokens protect UI/write only, or make
reads principal/client/role-scoped and revoke raw anon policies before claiming confidential client
review. F86 separately requires least-field active staff/client directory projections.

---

## 7. Reliability & disaster recovery

**7.1 Two independent backups — with dated live truth (§14 D-1).** The project is **Pro**. On
2026-07-13 the Management API showed seven completed physical daily backups across the included
seven-day retention window. PITR was **off**, consistent with the approved temporary-window policy;
it must be explicitly enabled and read back before each named risky window. Independently ship a
six-hourly export of all Track-B tables to a private store with a >7 h freshness alarm; retained
daily backups alone do not meet that RPO and do not prove restore.

**7.2 Reconstruct-from-events.** §2.6 makes the ledger trustworthy; `scripts/replay-deliverables.js
--verify` ships with B1 and runs weekly in CI against a scratch schema (replay == state, or
alert).

**7.3 Linear as COLD FALLBACK through cutover:** after each team flips, keep Linear available for
roughly one week (D-22), then B5 freezes but does not yet cancel it. “Available” is not a direct
one-flag rollback: F27 blocks authority reversal until new SyncView intents are stopped, captured,
classified/replayed/quarantined/discarded with owner reasons, and a team-scoped zero is proved.

**7.4 Degraded read-only mode:** SWR cache per team view; on Supabase read failure render cache +
amber banner, disable writes (never fake-save — the Samples-Old "Saved on device" silent local
fallback is the named anti-pattern), poll for recovery.

**7.5 Rehearsed restore** before B4: no successful scratch restore rehearsal was documented at the
2026-07-13 audit. Restore the export (+ PITR recovery point while it is enabled) into a scratch
project, run replay-verify, and time it (target RTO < 1 h). The drill artifact—not the existence of
seven backups—is a named B4 gate input.

**7.6 DR runbook in `ROLLBACK.md`:** symptom → fallback → steps → who to tell; §4.7 is its
skeleton. Written + rehearsed before B4.

---

## 8. Monitoring & observability (always-on)

**2026-07-08 cadence update:** GitHub cron remains requested every 10 min, but observed
delivery may be roughly hourly. n8n is the reliability layer for the mirror gate: the
Monitoring Pager + Reconciler V2 Trigger dispatches a dry-run v2 pass every 15 min and pages
if the latest summary is older than about 90 min or any gate count is non-zero. The same
pager checks calendar/samples reconciler freshness and pages when the latest completed run is
older than about 2 h.

**8.1 Continuous reconciler v2** (GH Actions + n8n trigger, ~10 min): per team, diff Linear ⇄
`deliverables` on status / assignee (**by raw Linear user id** — §1.4d) / due / title, plus the
**linkage lane** (cards with Linear links but no deliverable ids — §4.3.5) and the **comment
lane**: `production_comments` rows with a Linear id must map 1:1 by that stable id, including the
Part 1 historical backfill and stored `(via SyncView)` bridge rows. Echo recognition suppresses
only a repeated outbound mutation; it does not exclude the durable row (§4.2/§9.5). Tolerances per
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
(`2026-07-05-logic-reviews.md` §D4) is normative for role gating. The browser write boundary is
`production-write`; `deliverable-write` and `batch-write` are service-only low-level wrappers over
the §2.6 RPCs. Gateway payloads are operation-level intents with native target ids, CAS values,
stable request ids, and §6 credentials; the response uses the existing `{ok,row}` /
`{ok:false,conflict:true,row}` envelope family and intake additionally returns native batch + item
ids for card materialization.

**9.1 Creating a card → deliverable(s).** Submit sends one authenticated `intake_create` request to
`production-write`; the gateway validates the whole request before its first mutation, then creates
the batch and every deliverable **natively first**. Stable request ids make retries idempotent.
Each child outbox create depends on the correct team-specific parent create, and the response
returns native batch/deliverable ids immediately for post-submit card materialization — new card
jobs do not poll Linear to discover identity. `linear_identifier` is checkpointed later from the
outbound result; Part 2 does not invent a native display identifier or seed a sequence (§10.3).

**Active-component correction (F101, 2026-07-14):** the owner-locked model creates a paired Video
and Graphics deliverable for every post. Current Submit's advanced single-team actions and parked
PR #813 instead allow one team while materializing both card statuses as `In Progress`; the absent
leg is then counted by overall/client-ready logic but cannot be advanced. Before the caller merges,
remove and reject single-team intake under the locked model. If the owner ratifies single-team work
as an exception, add an explicit active-component contract across storage, materialization,
review/readiness/queues, comments/alerts, artifacts, migration, and every persona; absence is N/A,
not synthetic approval.

**Mixed-authority window:** every team leg shares the same native batch. A
SyncView-authoritative leg enters the normal outbox lane. A still-Linear-authoritative leg enters
the narrow §4.4 `legacy_parity` create lane, which targets only that request's parent/children even
while global outbound remains off. The browser never calls `video-form`/`graphic-form` in parallel,
so it cannot double-create. The existing submissions-log Sheets telemetry may remain as a
non-Linear side effect, but it consumes native response ids.

**Project + assignment policy:** the canonical client row selects the client. Stored project ids
are validated read-only against their Linear team; during the mapping migration, an absent stored
id may use one exact normalized native-display-name match and otherwise fails closed. Video
auto-assignment counts only video-team deliverables, excludes `duplicate`, and breaks ties by
stable roster order. Graphics
uses the one active `default_for_team` member. A missing/ambiguous mapping or assignee fails closed
before the first row write. Graphics generated descriptions use a server-side provider configured
only through private secrets. Missing configuration, transport failure, or a malformed provider
response refuses the request before any native/outbox write; a valid response with a missing or
unmatched item falls back only that item to `Video N`. Provider credentials/configuration never
reach the browser. The disconnected AI-thumbnail chain is dead code and is not ported.

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

**Implementation correction (F112, 2026-07-14): this card projection is not shipped.** The
deployed app, current `main`, and the latest inspected #813 candidate still pass only the legacy
Linear URL into both Calendar and Samples slot renderers. Native linkage IDs are transported and
#813 uses them for write routing/materialization, but neither surface dereferences a deliverable,
renders D-20's **View sub-issue** route, or resolves the current assignee. Treat this paragraph as
a target contract: both card surfaces must pass mixed-authority, reassignment, missing/inactive
linkage, mobile/new-tab/back, second-device, and Linear-unavailable proof before the first creative
team flip.

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

**Approval-revision correction (F109/F113, 2026-07-14):** current title, media, and caption
approvals are status/timestamp-only, not bound to the content the client saw. Calendar/Samples
generic editors and Edge writers can change approved content while preserving the old sign-off;
the client queue then remains empty. This target therefore requires one server-owned material
revision per reviewed component, approval of an exact revision, atomic invalidation or explicit
stale-sign-off state on every material/same-link provider revision, and immutable actor/revision
events. Approval-versus-edit races, no-ops, offline retries, queue re-entry, and second-device
convergence are first-flip gates.

**9.5 Comments/notes — normalized single-writer design (Part 1 #809 + Part 2).**
`production_comments` is the durable issue-thread store for native and Linear-origin comments,
including bridge-authored `(via SyncView)` rows. Every row carries body, stable human author,
timestamp, native + Linear ids, parent/thread metadata, role/audience, and edit/delete state.
`production-comments` is the protected paged reader; the Production detail renders its author +
body + time thread from that endpoint. Comment text is not anonymous-readable.

Writes go only through `production-write`, which resolves the actor and calls
`production_comment_write`. That service-role RPC merges the normalized row and atomically appends
the ledger/outbox intent, so retries cannot produce a second local row or Linear mutation. The
transport actor is retained only as transport metadata; it never replaces the originating human
author. Inbound webhook edits/deletes update lifecycle state on the same row. Outbound and
legacy-parity echoes are retained in storage and suppressed only from re-writing per §4.2.
Card-local caption/title threads remain card-local because no deliverable thread exists for them.

**Implementation correction (F42/F43, 2026-07-13): this is a target design, not current truth.**
The existing recovery script reads `deliverables.comments`; it did not import the active
Calendar/Samples roots/replies, so existing source parent IDs are not addressable by the gateway.
Review-panel plain comments and resolve/reopen/delete still write only card JSON, Notes uses the
gateway first, Production writes only normalized rows, and client links do not read normalized
client-audience rows. Enrollment is blocked until a composite-ID migration and one canonical
create/reply/edit/resolve/reopen/delete contract pass the full staff/creative/client projection,
audience, idempotency, retry, realtime, and refresh matrix.

**9.6 Assignment & due date:** single-row writes; the calendar card shows the editor chip via
`*_deliverable_id → deliverables → team_members`.

**Current implementation correction (F112):** no Calendar or Samples card-side
`deliverables → team_members` read exists today, including in the latest inspected #813 candidate.
The editor chip and explicit unassigned/inactive/degraded states remain a first-flip gate, not
completed behavior.

**Due-clock correction (F99, 2026-07-14):** the shipped picker is not yet a real-clock contract.
It freezes browser-local midnight at script load, while overdue uses a fresh UTC date. Ratify one
business IANA zone or explicitly viewer-local calendar-day rule; derive all relative input, option,
highlight, overdue, and write dates on demand from it; re-render at its next midnight and on return;
and pass long-open/UTC±/DST/leap-day/mouse/keyboard/bulk tests before writable authority.

**Due-year correction (F100, 2026-07-14):** the mouse picker currently stores only a formatted
month/day label and reparses it with the current year; stored `MM/DD` also cannot seed its month or
selection. Keep ISO values separate from visible labels, seed/compare from `dueRaw`, unify mouse,
keyboard, typed, and bulk conversion, and prove Dec→Jan/leap-day/future-year behavior.

**Manual-assignment correction (F94, 2026-07-14):** the shipped Production picker and gateway do
not yet implement a trustworthy eligibility boundary. Both must consume one server-authoritative
projection that enforces active native membership, the owner-ratified compatible creative role/team,
and an active Linear-user mapping while dual-ready mirroring remains required. Reject an ineligible,
unmapped, provider-inactive, or stale target before the native row/outbox commit. Retired mode removes
only the external-mapping requirement through the same atomic epoch transition; it does not weaken
native role/team/activity checks.

**Implementation correction (F50, 2026-07-13):** the corresponding status projection is not
implemented. Linkage IDs do not update a card's review-status field. Add the explicit 13→8 mapping,
conflict authority, idempotency/CAS behavior, and cross-surface mismatch detector—or make all
affected status readers canonical—before a Graphics or Video authority flip.

**9.7 Delivery flows preserved:** video = frame.io folder on the batch + status →
`smm_approval`; graphics = Drive folder on batch + per-deliverable `file_url`. A pasted link in
a comment offers "set as delivery link".

**Implementation correction (F53, 2026-07-13): this target is not implemented.** Native Graphics
intake currently creates a blank `file_url`/thumbnail, Production exposes no protected file/link
operation or picker, and SMM Approval does not require resolvable media. Add a canonical
actor-attributed, CAS/idempotent file/link write plus exact card projection/replacement history;
the promised comment-link affordance is part of the gate. A new TEST graphic must complete
intake→attach→SMM→Kasper/client→tweak→replacement→approval across refresh and second device before
Graphics authority changes.

**9.8 URGENT + notifications:** re-point from the n8n Linear-resolution flow to the §11 notify
EF reading `team_members.slack_user_id` (the sheet never had Slack ids). Preserve the confirmation
UI, but latch **Sent** only from a persisted exact-recipient receipt; unresolved/ambiguous/provider
failure stays visibly pending and retryable (F47).

**9.9 Kasper Messages inbox:** built on card threads + `kasper_seen` — §9.5 keeps it working
unchanged, now also showing editor replies. No rebuild.

**9.10 Workload tab re-point** (per team at flip): read `deliverables + batches + clients +
team_members` for flipped teams; CON/STR filtered; realtime can finally turn ON (row-level writes);
allowlists retire into `team_members`. **F40 implementation correction (2026-07-13): this is not in
main or #813.** Both still read only Linear-derived `workload_issues` with n8n fallback, so the
handoff is a hard pre-flip build gate, not B5 cleanup. The adapter composes native rows only for
SyncView-authoritative teams and must never fall back those teams to Linear truth.

Before enabling, publish a set-parity report. The live audit found 13 legacy stale ghosts and 39
genuine active top-level native rows hidden by today's sub-issue-only Workload rule. The owner must
explicitly preserve that rule or accept the additional rows with comms; parent/client/assignee/status
semantics, native deep links, CON/STR, search/rollups, catch-up, and mixed-authority failure behavior
must all be covered. B5 removes `workload_issues`, the n8n fallback, old cache, and Linear links only
after that report and TEST propagation matrix are green.

**9.11 `editors-week` replacement (B5) — behavioral contract, not a count substitution.** The
current browser calls an **unauthenticated** n8n reader over VID Linear issues/histories. That reader
attributes old transitions to each issue's **current assignee**, bounds history, and does not prove
complete issue/history paging. The Kasper Editors subtab consumes more than delivery totals: initial
load/error/empty behavior, finished versus still-open work, per-day timelines, week navigation,
scope, and an older-week cache.

The native saved query must derive transitions from `deliverable_events` using the assignee identity
at **event time**, preserve legitimate history for people who later become inactive, explicitly
exclude the Graphics team, TEST/internal clients, and unassigned work from Video production totals,
and define all state transitions/debounce rules from measured legacy behavior. It must fully page
inputs and reproduce load, finished/open, timelines, week boundaries/time zone, scope, cache, and
failure UX. A fixture set and a live read-only parity report must match every displayed row and
timeline—not merely the aggregate delivery count—before `editors-week` retires.

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

Ordinary Production project, team, and personal queues include only active clients. Inactive-client
rows live in an explicit role-gated recovery view and cannot be assigned or advanced without an
audited recovery action. **Implementation correction (F54, 2026-07-13):** the current adapter reads
`clients.active` but never applies it; the live read-only snapshot found 67 otherwise-renderable
Graphics rows across six inactive real clients, including 10 SMM-approval rows assigned to an active
Graphics member. Reconcile that cohort and require `zero_unreviewed_inactive_client_work` before the
Graphics flip; preserve reactivation/history deliberately rather than deleting it implicitly.

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
Triage *status* kept for migrated data. Follows the staff theme toggle; light default.

**10.6 The behavioral test suites are in-repo (D-17 resolved 2026-07-05):**
`behav.js` (138 assertions), `qa-features.js`, `sweep.js`, `build.js`, and the parity-audit
workflow live at `docs/syncview-design/tests/`, plus the wired-tab lanes added in B2:
`prod-readonly-smoke.js` and `prod-structure-subset.js` (read-only structural subset of
behav/sweep adapted to the `_prod*` DOM). The pixel-measurement method doc referenced by
`linear-design-tokens.md` lives in the **other repo** — `synchrosocial/docs/pixel-matching-playbook.md`
— it is not missing from this one.

**10.7 Current wiring status** (2026-07-14; use the register/inventory for the exact gate list):

- **Shipped:** B0 protected auth/token scaffolding; B0.5 full-active-roster Track-A routing; B1
  mirror/archive tables and refresh/reconciliation; B2 Production surface; B3 HMAC inbound plus
  monitoring; staff sign-in; and #812's authority-gated Production status/comment/due/assignee
  controls. The legacy card/Workload fast receiver is **inactive/unpublished** (F46), so scheduled
  reconciliation—not that saved graph—is the current healing path.
- **Still blocking rollout/retirement:** #813's safe per-client reroute boundary; native intake and
  Linear-free retirement epoch (F32/F44/F45); canonical card/deliverable status projection (F50),
  Graphics artifact delivery (F53), links/predicates/name sync, unified comment threads and client
  audience reads (F42/F43), Workload (F40), archive UI/rescue (F34), reorder/diagnostics, secure
  link distribution/enforcement, notification parity, concurrency, and every other OPEN item in
  `CUTOVER_AUDIT_2026-07-13.md`. This list is a summary, not an alternate checklist.

**10.8 B2 design-fidelity protocol: TRANSPLANT → ADAPT → PROVE (NON-OPTIONAL):**
three build rounds produced three classes of fidelity failure — #686 (built from prose, wrong
structure), #689 (retyped artifact values, byte-level slips), #693 (re-implemented behaviors:
un-scoped CSS vars → transparent menus, sibling-as-children data model, missing picker
submenus, wrong icon fallbacks). The autopsy found five systematic failure modes: (F1)
transcription instead of copying, (F2) unstated environment differences between the standalone
artifact and the embedded tab, (F3) no written data-mapping contract, (F4) no exhaustive
behavior inventory so "done" tracked the prompt not the artifact, (F5) verification that
checks DOM structure but cannot see rendered output. This protocol retires all five. It is
owner-ratified (2026-07-06): the goal is OUR implementation converged to the artifact —
provably — as the floor on which later improvements are built.

- **Source of truth (unchanged):** `docs/syncview-design/SyncView.html`. Where any prose
  (this spec, a prompt, a review note, the ledger) conflicts with the artifact, the artifact
  wins.
- **Simpler-tool boundary (owner-ratified 2026-07-07):** SyncView is a SIMPLER tool than
  Linear; Linear features that add complexity (AI assistant, initiatives, workspace
  management, dev-tooling copy commands) are deliberate REMOVALS, not adoptions. Linear wins
  on look/feel/interaction of KEPT surfaces only, never on adding removed-class features.
- **10.8.1 Adapter Contract (kills F3):** `docs/syncview-design/ADAPTER.md` is the definitive
  B1→artifact data mapping, implemented as ONE function (`_prodAdapter()`) that converts the
  B1 tables into the artifact's exact data shapes (ISSUES/PROJECTS/CLIENTS/EDITORS field
  names). All `_prod*` render code consumes artifact-shaped objects only. Every mapping
  decision is written in the contract (parent/children semantics: children exist ONLY under a
  batch-parent row, a sibling never lists a sibling; icon fallbacks: missing client emoji →
  the artifact's project glyph, never a letter; the status slug↔artifact-key table; member →
  EDITORS color/initials derivation; self-parent rule: `title == batch.name`).
- **10.8.2 Verbatim-transplant rule (kills F1):** ported functions are byte-copies of the
  artifact's, with exactly three allowed edits: the `_prod` name prefix, the state-object
  reference, and mutation-call sites replaced by the single read-only guard. Any other
  deviation must carry a `// PORT-DELTA:` comment stating the reason (the typography override
  is one standing PORT-DELTA; the owner's exception of 2026-07-06 remains in force).
- **10.8.3 Mechanical fidelity checker (enforces 10.8.2):** `test/port-fidelity-check.js`
  pairs each ported function with its artifact original and FAILS on any unmarked difference.
  Runs in `npm test`. "Was it copied faithfully" is a red/green lane, not a review opinion.
- **10.8.4 Environment shim (kills F2):** ADAPTER.md's environment section enumerates every
  assumption the artifact makes of its host page (root-scoped CSS variables, body-mounted
  `#layer`/`#toast`/tooltip, document-level keyboard listeners, history API, z-index map) and
  states how the embedded tab satisfies each (e.g. `--prod-*` variables must resolve on every
  overlay mount point, not only inside `.prod-view`). New body-mounted elements are added to
  this list in the same PR that adds them.
- **10.8.5 Parity ledger (kills F4):** `docs/syncview-design/WIRED-PARITY.md` is the living
  behavior ledger. Current states distinguish ✅ ported, 🔐 authority-gated, 🔒 unsupported/
  guarded, and ⬜ pending. The former `PARITY.md`/B2 `deferred-B3` text is historical and cannot
  authorize current behavior. Every Production-tab PR updates the living ledger.
- **10.8.6 Verification that can see (F105 currently OPEN):** every `_prod*` PR must exercise two
  explicit browser states: (a) locked live-read/zero-mutation, where supported controls fail closed
  according to current UX and no live mutation is sent; (b) fully intercepted writable fixtures
  covering verified role, team authority, bounded active-TEST override, all four supported
  operations, conflicts, and stale-tab rejection. Interaction, `behav-wired`, pixel, and review
  packet assertions must declare which state they test; unsupported mutations remain guarded.
  The exact candidate commit must pass the aggregate `npm run test:prod-polish`, not only the fast
  PR subset, and a REVIEWER examines fresh artifacts. Current interaction/heavy lanes are red on
  superseded B2 picker assumptions, so this definition of done is not met.

---

## 11. Notifications

Slack now, behind one `notify` EF (ro.am-swappable). Fires on: deliverable assigned, status →
`tweak` (with tweak text), status → `smm_approval`, URGENT. Every send logs an event. **Owner
input (D-14):** what does Linear's native project→Slack integration post today (~51 projects
carry `slackChannelId`) — which of it must the notify EF replicate so client channels don't go
quiet at B5? Editors also lose Linear's own inbox at cutover; the assigned/tweak notifications
are the replacement — confirm sufficiency in the TEST matrix and full-roster shadow review.
**Exact-recipient contract:** a channel post is not delivery success. Resolve the immutable native
assignee to exactly one active notification identity before sending; missing/ambiguous mappings
remain visibly pending/retryable and alert. Persist the intended member, resolved destination, and
provider message/receipt id, and let the caller show “Sent” only from that exact-recipient receipt.
The legacy retained execution sample had mapped mentions, so this gate does not claim a historical
miss; it prevents the current fail-open success branch from surviving the cutover.

---

## 12. Testing & verification

- **Probe suite** (`qa/` SXR pattern, TEST client + TEST Linear project only): batch create →
  auto-assign → full §D4 status walk incl. undo → delivery links → editor chip on card → ledger
  row for every step (incl. raw-write trigger check §2.6) → notification receipt names the exact
  intended member and provider message. Negative cases—missing, inactive, ambiguous, wrong-team,
  and provider failure—stay pending/retryable, alert, and never render “Sent.”
- **Role/token matrix:** 3 keys × every write op; client token × scope × legal/illegal
  transitions; permissive vs enforced; `key-verify` behavior.
- **Sync/mirror drills:** loop prevention; **B3 comment-echo probe (the legacy mirror + Comments
  webhook running together — assert each app comment appears exactly once)**; B4 echo-drop
  (strict AND); per-team isolation; **two-writer race** (concurrent conflicting transitions →
  one 409, no silent overwrite); alias move; webhook delete; clamped-state tolerance; **the full
  §1.5 flip checklist executed on the TEST client via the service-only request override**
  (runtime authority flags never change for a drill), including outbox-drain
  evidence and the detect-only straggler alert.
- **Migration dry-run** (B1 gate): counts vs audit numbers; 20-issue spot parity; repair queue;
  idempotency (second run = zero changes); rate-budget compliance.
- **DR drill** (§7.5) + replay-verify green.
- **Behavioral parity (see §10.8 — non-optional):** during B2, every `_prod*` render PR runs
  `prod-structure-subset.js` + `prod-readonly-smoke.js` against the wired tab; at B3 the full
  in-repo `behav.js`/`sweep.js` suites re-run against it with selectors adapted to the renamed
  status keys (§10.1). Review is against `SyncView.html`, never against prose.
- `npm test` + `qa/master.js` green throughout; no renames of the 11 grabFunc-extracted symbols
  until §13 retires the reconcilers.
- **Track A latent bugs fixed in B0.5** (bulk-import verify; EF reorder fallback) — verified by
  probes before any real client is flagged.

---

## 13. Cutover & teardown (B5)

0. **Build and TEST-prove the Linear-free retired epoch without activating it for real teams
   (F32):** under an isolated service-only TEST override, native intake/mutations no longer require
   Linear validation, project/assignee eligibility, or identifiers, and new mirror-outbox enqueue is
   transactionally suppressed. With Linear reads/writes unavailable, the full TEST matrix succeeds
   and creates zero outbox rows. Keep the production retired-epoch flag disabled throughout grace.
1. Both teams flipped and stable; intake native; outbound mirror keeps Linear current; grace
   period begins (Linear frozen-but-live, detect-only inbound alerting).
2. Hold the post-flip dual-ready fallback for roughly one week (D-22) with §8 green + one F27-safe
   recovery drill: stop writes/outbound, snapshot and classify all team intents, resolve them with
   audit evidence, prove team zero, then reverse authority on TEST. This is separate from D-28's
   pre-flip shadow/parity-soak week. At the end of this window, freeze human Linear work; keep the
   normal outbound lane available only for step 3's final classified drain, then stop it before
   the archive/export gates;
   do not cancel the subscription until the later retirement step below succeeds.
3. At the end of grace, enter a **server-enforced** team maintenance/cutoff state on both systems;
   a human instruction is not a write freeze (F61). It must reject stale tabs, retries, services,
   and automations with explicit UX and an atomic high-water/readback contract. Set/read F4 parity `false`;
   keep normal outbound live only long enough to classify/replay or owner-disposition all final
   queued intents and prove both teams machine-zero, then set/read F2 normal outbound `off`. Run the
   final reconcile **dry-run/detect-only only** (F92). If it reports any diff or would-enqueue work,
   abort the transition: while the server freeze remains active, restore/read F2 live, classify and
   drain/disposition the work, re-prove both teams zero, set/read F2 off, and retry the final dry-run.
   Never run reconciler apply after F2 is off. Then verify archive completeness (counts vs export;
   image-rescue report) plus the
   private full Linear export in Drive. F34 requires a live role/audience-scoped archive reader and exact retrieval
   drills, a complete issue↔comment manifest, and zero unreviewed Linear-hosted image/attachment
   gaps—stored rows or a generic count are not human/asset recovery.
   Before retiring any inbox/reader replacement, prove exact-recipient assignment/tweak/URGENT
   notification receipts and full §9.11 Editors UI/semantic parity (including event-time identity,
   history paging, load, finished/open, timelines, scope, cache, and failure UX).
4. Atomically activate the owner-controlled retired epoch only after step 3's freeze, zero, and
   export proof. Read it back, run the private TEST mutation matrix with Linear unavailable, and
   prove zero new normal or parity outbox rows before users resume in SyncView-only mode.
5. Retire in order, one owner-approved action at a time. Prefer deactivate/archive/config removal
   over deleting graphs or webhooks. Before **each** action capture the exact current object in the
   private backup store, document and rehearse its restore/recreate procedure, and define a
   machine-read post-action + rollback readback; if that object cannot be restored and verified,
   stop. Publish only a public-safe status stub (§1.6). There is no blanket “reversible until step
   cancellation” promise (F60):
   a. verify F4 parity is `false` and F2 normal outbound is `off`, with both read back; neither lane
      may still scan/write;
   b. disable/archive Linear webhooks + inbound EF; delete only after the saved configuration and
      recreation drill are owner-approved;
   c. verify `MJbMZ789B5ExZz9x` remains inactive/unpublished. Preserve its saved graph unless F46's
      owner-approved topology and a verified restore object explicitly authorize removal; never
      blind-publish or destructively edit the unexplained graph as teardown evidence;
   d. both reconcile scripts + Actions + n8n triggers;
   e. `Workload — Reconcile` + `workload_issues` (tab reads `deliverables`);
   f. VIDEO PRODUCTION AUTOMATION's Linear branches;
   g. `linear-set-status`, `linear-add-comment`, `linear-subissues`, `linear-issue-statuses`,
      `linear-tweak-comments`, `editors-week` (→ §9.11 query). (The nightly due-date roller is
      NOT in this family — n8n was eliminated by measurement; it dies only via D-9.)
    h. **the legacy card-write webhooks** (`calendar-upsert-post`, `sample-review-upsert`, reorders):
       F67 requires authentication or retirement in Phase 0, before enforcement or either human
       flip. B5 may only perform final deactivate/archive/deletion after a zero-caller/stale-tab proof;
       it is not the moment an unauthenticated path is allowed to close;
      **F104 boundary:** Calendar's `?v2=0` read path, n8n fallback, Kasper/Films recovery, and
      shared status-metadata helpers are not implied by this Linear retirement list. The historical
      Phase-4 recipe is quarantined; retire them only through a fresh owner plan with usage,
      replacement recovery, whole-repo consumers, cross-surface tests, and F60 per-object proof;
    i. FE: Linear push/outbox/reassert/point-adoption/bulk-link code removed; link columns stay,
       inert.
6. **Secrets teardown:** rotate the house Linear key (hardcoded in 6+ workflows). The owner accepted
   the seven public per-SMM keys through the transition at D-15; revoke them at B5 and remove their
   Sheet column during this owner-gated cleanup—do not imply they were already rotated. **F52 is a Phase-0 containment item,
   not deferred teardown:** remove the plaintext title-provider credential from the reachable n8n
   branch and retained-version exposure. Immediately restrict access; stage a managed replacement
   and prove the known TEST title path; owner revoke/rotate; then finish the broader workflow/
   version/export/backup/provider census while monitoring for an unknown consumer. Do not defer the
   known live branch until every historical artifact has been enumerated.
7. Mirror-tab cleanup per §3 owner list.
8. **Only after** grace + verified archive + owner sign-off: cancel Linear.

---

## 14. Gates & open decisions

**Hard gates** (evidence + owner sign-off, ROLLBACK rule 6). Every phase also: rule-4 snapshot
before start + ROLLBACK.md Live State updated in the same PR (§1.6).
- **B0 →**: vocabulary ratified (D-2); tokens minted + `client-token-verify` live; flags
  trigger + `flag_flips` live. **Monitoring sub-gate REOPENED (F09):** the central n8n error
  handler exists, but five of six sampled load-bearing cutover workflows were not wired to it and
  the handler failed 29 of 30 sampled invocations at the execution limit. Require a generated
  active-workflow/settings census, one sanitized TEST receipt per load-bearing workflow, and an
  independently hosted pager receipt while n8n execution is unavailable before this gate is green.
- **B0.5 → COMPLETE (2026-07-10):** Track A latent bugs fixed; all active clients reached all
  three EF flags on 2026-07-07, then the owner-approved three-day close-out found zero real-client
  fallback traffic, zero ledger errors, and clean full-roster column drift. This supersedes the
  unexecuted one-week planning target. **Separate auth gate remains OPEN:** F35 must close every
  public writer and real write-attempt telemetry must be clean for 72 h before `enforced`.
- **B1 →**: dry-run counts match audit; **constraint preflight (§5.6) posted with every
  non-zero violation count carrying an approved handling rule**; 20-issue spot parity; repair
  queue + `active=false` list reviewed (D-16); replay-verify green; CON/STR active split
  measured (D-11).
- **B2 →**: tab renders real migrated data behind `?prod=1` for admin ✅ (#686, rebuilt to the
  artifact in #689 after the §10.8 divergence incident); design-kit suites in-repo (D-17 ✅) and
  the wired read-only lanes green ✅ (`prod-structure-subset.js` + `prod-readonly-smoke.js`;
  full behav/sweep re-run lands at B3 per §10.8); **staff diagnostic page live — STILL OPEN**;
  parity-gap backlog worked down per `docs/audits/2026-07-06-prod-parity-gaps.md`.
- **B3 →**: comments webhook subscribed + catch-up pull run (§4.3.4); after F90 source separation,
  **real-client-only** mirror zero-diff (modulo §1.4) for a new 7 consecutive days, with planned
  TEST activity retained as a separately failing diagnostic rather than counted in the real soak;
  echo probe green (§12); editor/SMM UX feedback collected.
- **B3→B4 per team**: §1.5 checklist artifacts (outbox drain, zero-diff + linkage-zero report,
  legacy-writer gates verified incl. reconcilers + n8n bridges, identifier seed check, flip +
  rollback rehearsal, detect-only alert tested) + **roller located and disabled, or an explicit
  owner-signed detect-only acceptance after every credential consumer is mapped (D-9/F14)** +
  editor/SMM sign-off + DR drill done. A machine-generated unexpired manifest must bind exact
  flags, Pages/main SHA, all 24 Edge Functions, load-bearing n8n active graphs/last-green evidence,
  and migration/schema state to the owner flag transaction (F56/F59). Every fallback writer retains
  the same auth boundary (F67). Rotating unknown shared/personal keys is not an automatic fallback.
- **B4→B5**: 2 full batch cycles per team, zero lost/wrong statuses; reconciler v2 quiet;
  owner sign-off.
- **B5 end**: grace green + server-enforced freeze/atomic epoch transition (F61) + archive verified
  before cancellation. No history/comment DELETE is considered ready until F62/F68's dependency-
  safe transaction and restore rehearsal exist.

**Open decisions for the owner:**

| # | Decision | Context | Recommendation | Blocks |
|---|---|---|---|---|
| D-1 | PITR add-on: yes/no/when | **Live 2026-07-13:** Pro entitlements; seven completed daily physical backups / seven-day retention; PITR off between approved windows; database disk 0.45 GiB used; no successful scratch restore rehearsal documented. Management API does not settle billed egress or spend-cap posture. | Keep the approved temporary-window policy: ship the independent six-hourly export, enable/read back PITR before each named risky window, disable after, and rehearse a timed scratch restore before B4. **Owner Dashboard question before flip:** what does Usage/Billing show for current egress, and is the spend cap enabled or disabled? | B4 gate remains OPEN until export + PITR readback + restore drill + Dashboard answer |
| D-2 | Ratify status slugs + mappings (§2.1), incl. the Triage no-op and the D-10 outbound split | three vocabularies measured | **RATIFIED by owner 2026-07-05** ("yeah okay, do that — smartly"). His follow-up question — should the CARD pills gain the Linear-only statuses (Backlog/Canceled/…)? — answered as specced: **no; cards keep today's 8-status review vocabulary unchanged** (zero behavior risk to the review flows); the Production tab carries the full 13; the projection shows Backlog/Todo/Triage as "In Progress" on cards exactly as the Linear sync does today. If SMMs later want a "not started yet" hint on cards, it can be added as a display badge without touching the vocabulary | B0 ✅ |
| D-3 | Priority: mirror-only (hidden) vs surfaced | in active use again; locked design has no priority UI | mirror-only + URGENT; revisit after the full-roster shadow window | B1 |
| D-4 | Pre-migration Linear cleanup (824 zombies + 336 stale-WIP) | §5.1 — **OPTIONAL**: the migration cutoff already sends old open issues to the archive, not the live board, so skipping this loses nothing; a cleanup only makes Linear itself tidier during the mirror phase | default = skip unless the owner wants Linear tidied; a ready-made issue list can be generated on request | — |
| D-5 | Intake extras: port Claude graphics-titles? confirm AI-thumbnail chain stays dead? | §9.1 | port titles via EF secret; thumbnails dead | B2 |
| D-6 | Ratify §9.5 single-writer comment design | card thread stays the store; Kasper inbox intact | as specced | B1 |
| D-7 | Deliverable display identifiers | §10.3 — seeds computed at flip, never constants | per-team sequences, seed = flip-time Linear max + 5,000 | B1 (design) / B4 (seed) |
| D-8 | Overdue: visible state, no auto-bump | **SUPERSEDED by D-30 on 2026-07-13.** The earlier drop assumption was never ratified. | Do not implement this historical stance; D-30 controls. | — |
| D-9 | Identify the ~23:45 UTC roller actor | Still unresolved. Later read-only forensics cleared the inspected n8n and GitHub scheduled writers and showed the current cohort spans both teams and non-review states, superseding the narrow July-5 signature. The shared `Form` credential's observed audit-window reads belong to a GitHub reader, not the roller; external Apps Script/OAuth/remaining credential holders and Linear admin audit delivery remain to inspect. No account or client identifier belongs in this public register. | Before a flip, locate and disable the writer. If it cannot be located, proceed only with explicit owner-signed detect-only acceptance after every shared/personal credential consumer is mapped and the alert/tolerance contract is drilled. Do **not** rotate remaining keys as a blind fallback; that can break unknown consumers without proving the writer is gone. | B4 |
| D-10 | In-Progress→Todo outbound asymmetry | §2.1 — split rule: legacy card path keeps it, deliverable-native maps straight | as specced | B0 |
| D-11 | CON/STR scope | §2.9 (measure active split at B1) | out of scope; archived at B5 | B1 |
| D-12 | Inbound comment-image fidelity | Linear image URLs expire | best-effort for new comments; rescue pass covers briefs | B3 |
| D-13 | Legacy title mismatches at B4 | §9.4 | badge + report, no mass rename | B4 |
| D-14 | Linear→Slack project integration replacement scope | §11 | owner inspects one channel | B3 |
| D-15 | Rotate the 7 public per-SMM Linear keys + remove the sheet column | publicly readable via gviz today | **DECLINED by owner 2026-07-05** ("I don't care about it") — risk accepted, same posture as D9 (hardcoded house key). Keys become moot at B5 when Linear is retired; the sheet column is still removed at §13.6 cleanup | — |
| D-16 | §3 private four-entry owner review list (two possible clients, one unmatched variant, one junk quarantine row) | §3; identifiers stay in the private artifact | — | B1 |
| D-17 | Copy the design-kit behavioral suites into the repo | **SUITES RESOLVED; SECURITY FOLLOW-UP OPEN.** The behavioral files are committed under `docs/syncview-design/tests/`. The shared source folder also exposed a saved Linear browser session. Unsharing/deleting the folder is insufficient: revoke the provider-side session first, verify the old profile is denied, inspect downloads/caches privately, then remove the artifact and record identifier-free evidence (F64). | — | B2 suites ✅ / session incident OPEN |
| D-18 | Mirror identity: dedicated Linear user seat vs OAuth-app actor | §4.2/§4.4 — must be distinct from a human editor for echo-dropping | **IMPLEMENTED in B4:** dedicated SyncView Mirror identity through the `LINEAR_MIRROR_API_KEY` EF secret; the drainer resolves its actor id at runtime and strict echo matching requires that actor plus the acknowledged outbox intent. No secret or personal identity is stored in the repo. | B4 ✅ |
| D-19 | B4 flip granularity: per-team-global (§1.1) vs. both-teams-together, per-client | §1.1/§9.1 — per-team flipping creates the split-authority-within-a-card window (a card's video slot authoritative in Supabase while its graphic slot is still Linear), the plan's fiddliest adoption path | **SUPERSEDED by D-25 on 2026-07-11.** The earlier decision was both teams together with a per-client allowlist; D-25 replaces the allowlist/pilot with full-roster shadow proof followed by one owner-controlled all-client live flip. Retained here as decision history only. | B4 |
| D-20 | Card → Production deep-link (replaces the "open in Linear" URL button, §9.2) | locked decision 6 + §9.2 re-point cards from `linear_issue_id` to `*_deliverable_id` | **RATIFIED by owner 2026-07-11:** label **"View sub-issue"**; opens the deliverable in the Production tab in a **new browser tab** (not a side panel). | B4/B5 |
| D-21 | Legacy Linear-link fields on cards at/after cutover | §13.4.i keeps the `linear_issue_id` columns inert after teardown | **RATIFIED by owner 2026-07-11:** leave the fields **inert but present** with a **phase-aware disclaimer** — during the fallback window "Linear is a fallback during migration; links still work," and the field quietly retires after teardown. | B5 |
| D-22 | Linear fallback grace period (§1/§13) | Linear kept as a fallback after cutover | **RATIFIED duration retained; one-flag mechanism superseded by F27.** Keep the roughly one-week fallback window, but a team cannot resume in Linear until new SyncView writes stop and its outbox is audited, classified, resolved, and proved zero. After a clean week, freeze Linear read-only, then archive. | B5 / F27 |
| D-23 | Submission (visible **Submit**, internal `linear`) tab UI at B4 (§9.1) | intake plumbing flips to native create; the form UI could also change | **CONFIRMED by owner 2026-07-11; capability wording corrected 2026-07-14:** the submission form/body and behavior do not change — only its top-nav label becomes **Submit** while `#linear` / `navTo('linear')` remain locked. The authority-gated native mirror receives the **Linear** label/logo but keeps `#production` / `?prod=1`; its shipped status/comment/due/assignee controls remain read-only for Linear-authoritative teams and open only under the verified write contract (plus bounded active-TEST override). Backend intake plumbing flips separately at B4 (create natively, mirror out during the fallback). | B4 |
| D-24 | Consolidate staff auth into the three role keys (one password per person) + polish the sign-in surface | today there are three separate keys — the B4 role key, the Client Credentials key (`client-credentials` EF), and the onboarding key (`onboarding-full`, Kasper-only) | **RATIFIED by owner 2026-07-11: one password per person = their role key.** The `client-credentials` and onboarding EFs accept the role key (same `key-verify` mechanism) and gate by role — **credentials: `admin`+`smm`; onboarding: `admin` only; creative/editor/designer: neither.** FE drops the separate credential/onboarding key prompts and uses the signed-in role identity. Additive + reversible: keep the old separate-key paths working during transition, then retire. **Signed-in state shows an account menu** (Signed in as `<name>` · `<role>` + **Sign out**; **no "Switch user"** — sign out then in). The sign-in modal itself to be polished to a finished/premium standard, judged via the master-tester vision pass + `/human-audit`. `auth_enforcement` stays permissive throughout; no secret-value rotation. | B4 / auth |
| D-25 | B4 rollout model | D-19's per-client pilot vs. full-roster shadow proof | **Historical pipe-proof decision; superseded for human rollout by D-28/D-32.** The full-roster shadow proof remains valid evidence for the outbound pipe. Human parity enrollment now uses per-client cohorts, then Graphics-first authority. Do not execute the old both-team/all-client flip. | B4 history |
| D-26 | Reversible pause / graceful fallback | emergency-only rollback vs. normal team operation | **Historical direct-pause mechanism superseded/blocked by F27/F58.** Stop team mutations and disable the involved outbound lane(s), both F2/F4 when unknown/mixed. Authority returns to `linear` only after audited per-team quarantine/classify/replay/discard and machine-read zero. Pending-row timestamp logic is not permission to skip that accounting. | B4 / F27 |
| D-27 | Historical-write suppression | the full-roster read-only audit found historical parent/restore differences that would restructure completed backfill-era work | **RATIFIED by owner 2026-07-12:** outbound never restructures historical work. The exact predicate and operation scope are locked in §4.4; historical `parent`/`restore` differences remain visible as `tolerated_historical` but are never enqueued or written. Live-era restructuring remains enabled. | B4 |
| D-28 | Write-UI epoch human rollout (refines D-25's "both teams live together") | after the outbound pipe was proven live 2026-07-12, flipping the *team-facing write UI* to everyone at once means any real bug pauses the whole company | **RATIFIED by owner 2026-07-12:** roll the write UI to humans in stages, not one flip. (1) **Silent shadow soak** — ship the write-UI epoch but keep the team on Linear and run outbound in `shadow` ~1 week so the bug wave is caught with nobody watching; (2) **graphics team first** — flip `prod_authority.graphics`→`syncview` live while video stays on `linear` as the safety net; (3) roll video once graphics is boring. D-25's full-roster shadow governed proving the *pipe* (done, both teams together on 2026-07-12); D-28 governs the *human* cutover. | write-UI epoch |
| D-29 | Bug-response policy during the staged cutover | "every bug → flip everyone back to Linear" is operational whiplash the owner flagged | **Policy retained; direct authority action superseded by F27/F58.** Cosmetic/UI bugs are fixed in place. For a data-integrity bug, stop that team's mutations and disable the involved outbound lane(s), both if unknown/mixed; return authority only after intents are audited, resolved, and proved zero. A systemic incident may contain all teams, but no team gets a blind flip-back. | write-UI epoch / F27 |
| D-30 | Overdue +2-day auto-bump (supersedes D-8's drop) | the legacy path silently extends overdue due dates by 2 days on status change; the native gateway deliberately did not port it (D-8 assumed "drop", never ratified); the 2026-07-13 audit (F20) surfaced that dropping it was an unratified behavior change | **RATIFIED by owner 2026-07-13: KEEP the bump.** Port the +2d-overdue-on-status-change behavior into the native write path, flag-gated so it can be disabled later without a deploy. D-8's "no auto-bump" stance is superseded. | write-UI epoch |
| D-31 | Client link token distribution | audit F03: circulating links are token-less while the write gateway hard-requires a token; audit F33 proved the proposed sheet mechanism would expose every bearer token through anonymous GViz | **PARTIALLY RETAINED / MECHANISM REOPENED 2026-07-13:** the owner's human decision remains — **each SMM re-shares their own clients' links**, with no central resend. **Do not put tokens in Clients Info.** Explicit owner question from F33: approve a staff-authenticated exact-client link-builder endpoint instead. Until answered and built, token enforcement/write reroute is blocked. | write-UI epoch |
| D-32 | Staged reroute rollout via per-client allowlist (amends the #813 merge model; satisfies D-28's soak intent) | audit F02/F23: "#813 ships inert" was false — merging with parity off freezes every Linear-linked approval company-wide, and GitHub Pages deploys to 100% of users at once with no canary | **RATIFIED by owner 2026-07-13:** #813's reroute ships behind a per-client allowlist runtime flag (`write_ui_reroute_clients`, same pattern as `calendar_upsert_ef_clients`) defaulting to the TEST client only. Merge is dark; parity is armed at Phase 1; real clients enroll in staged cohorts with watchers green between cohorts; a full-roster clean week satisfies D-28's soak. Emptying the allowlist is the pre-flip kill switch. | write-UI epoch |

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
- **NEXT (current):** close every blocking OPEN item in `CUTOVER_AUDIT_2026-07-13.md` and the
  Phase-0 fix pack in `GO_LIVE_CHECKLIST.md`; resolve the explicit owner questions; then execute
  the staged TEST/parity/Graphics-first sequence with `docs/ops/FLIP_RUNBOOK.md`. B0–B3 and Track A
  are completed history and must not be restarted from this footer.
