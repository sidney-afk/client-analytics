# Track B — Replacing Linear with in-app production management

**Parent doc:** `INDEPENDENCE_PLAN.md`. **Starts only after Track A gate A3 passes.**
**Ground truth:** `docs/audits/2026-07-03-linear.md` (what Linear actually does for this team)
and `docs/audits/2026-07-03-supabase.md` §6b (what's missing schema-wise). **These audits are a
2026-07-03 snapshot — the master plan's MANDATORY FIRST STEP (re-audit and diff) applies; by the
time Track B starts, re-audit Linear especially (projects, users, volumes, state names) since
weeks will have passed.** Key sizing facts:
2 live teams (Graphics/GRA, Video/VID), 48 projects-as-clients (~20 active), ~120 new
sub-issues/week, ~1,075 non-completed issues in current cycles, 5 active editors/designers.
Fields actually used on deliverables: **state, assignee, due date, comments** (labels, priority,
estimates, attachments, milestones: unused — do not build them).

## 1. Principles

- **SXR playbook**: build the whole surface behind a flag in `index.html` (`_prod*` namespace),
  invisible until enabled, exactly like the Samples rebuild (`SAMPLES_REBUILD_STRATEGY.md` is the
  canonical how-to for cloning a surface in this codebase, including realtime channel, SWR cache,
  optimistic save funnel, and probe patterns).
- **Keep the team's mental model**: same status names they know (the card vocabulary — In
  Progress, For SMM Approval, Kasper Approval, Client Approval, Tweaks Needed, Approved,
  Scheduled, Posted), board columns like Linear, batches still exist. New tool, same brain.
- **Everything attributable** (owner requirement D7): every write carries actor + role, lands in
  `deliverable_events` with timestamps, and the UI has a history view per deliverable.

## 2. How the creative team actually works (owner's answers, 2026-07-03 — design to THIS)

1. **Editors/designers find their work and learn about tweaks from the SyncView workload
   calendar** (not Linear's inbox, not the Linear mobile app — they don't use either) **and from
   the per-client Slack creative channels** that Linear currently posts into via its Slack
   project integration.
2. **Due dates exist so the workload calendar can show a planned date.** That is their purpose.
3. **Delivery flow — Video team:** finished videos go into one shared frame.io folder per batch;
   the editor posts the frame.io folder link **as a comment on the parent (batch) issue**, then
   sets each sub-issue's status to **For SMM approval** — the status change IS the "it's ready"
   signal.
4. **Delivery flow — Graphics team:** designer posts the general Drive folder link on the parent
   AND comments each sub-issue with the **specific file link**, then sets status to For SMM
   approval.
5. **Editors/designers never create issues.** Creation happens via the Linear-submission
   automation (the `linear` tab → VIDEO PRODUCTION AUTOMATION), occasionally by an SMM or the
   videographer manually. Editors/designers **do** change statuses (that's how work moves).
6. **They DO read the parent/batch issue** — it carries the general description (filming-plan doc
   link, footage folder, timestamp mappings, brief).
7. Notifications: **Slack for now** (ro.am later, separate effort — D8).

## 3. Auth — three role keys (owner decision D6)

Not per-person accounts. Three shared secrets, one per tier, checked by Edge Functions:

- `ROLE_KEY_ADMIN` — Sidney + Kasper (everything, including the existing credentials passphrase
  surface, which stays separate/as-is).
- `ROLE_KEY_SMM` — social media managers (calendar/samples writes, batch creation, assignment).
- `ROLE_KEY_CREATIVE` — video editors + graphic designers (deliverable status changes, delivery
  links/comments on their assignments; cannot approve on behalf of Kasper/client, cannot create
  batches).

Mechanics: extend the proven `client-credentials` pattern — header `X-Syncview-Key` +
timing-safe compare, plus required `X-Syncview-Actor` (display name picked at login). FE: one
login modal (role key + "your name"), stored in localStorage; sent on every EF write. Events
record `{actor, role}`. Client links keep working via `?c=&t=` tokens, which move from the
Sheet column into `clients.review_token` and become **deny-when-empty** (today they fail open —
this closes that hole). When someone joins/leaves a tier, rotate that one key (EF secret update)
and re-share — zero account admin, which is what the owner wants. (Per-person Supabase Auth
remains a documented future upgrade; do not build it now.)

Rollout order matters: B0 ships role keys **permissive** (missing key = allowed + logged) for
one week to flush out forgotten surfaces, then flips to enforced.

## 4. Schema (B0–B1)

```sql
create table clients (
  slug text primary key,              -- the existing bare-text client slug, now a real entity
  display_name text not null,
  active boolean not null default true,
  review_token text,                  -- moves from Sheets "Clients Info"; empty = client links denied
  slack_channel_id text,              -- from Linear project slackChannelId / {slug}-creative
  brand_kit jsonb,                    -- fonts/colors/sample links, migrated from Linear project descriptions
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table team_members (
  id uuid primary key default gen_random_uuid(),
  name text not null, email text,
  role text not null check (role in ('admin','smm','editor','designer')),
  team text check (team in ('video','graphics')),   -- null for admin/smm
  slack_user_id text, active boolean not null default true,
  created_at timestamptz not null default now()
);

create table batches (
  id text primary key,                -- native mint: b_<ts36>_<rand> (same style as cards)
  client_slug text not null references clients(slug),
  team text not null check (team in ('video','graphics')),
  name text not null,                 -- "{Client} · {date}" convention preserved
  description text,                   -- the batch brief (owner: editors read this)
  filming_doc_url text, footage_folder_url text,
  delivery_folder_url text,           -- frame.io (video) / Drive (graphics) folder the team delivers into
  color text,                         -- batch color shown on calendar cards (owner's idea)
  status text not null default 'active' check (status in ('active','done','archived')),
  created_by text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linear_parent_ids jsonb             -- transition only: mirrored GRA/VID parent issue ids
);

create table deliverables (
  id text primary key,                -- d_<ts36>_<rand>; replaces VID-####/GRA-#### as join key
  batch_id text not null references batches(id),
  client_slug text not null references clients(slug),
  team text not null check (team in ('video','graphics')),
  kind text not null check (kind in ('video','thumbnail')),
  title text not null,                -- "Video 3", "Thumbnail #2", hook text
  brief text,
  status text not null default 'In Progress' check (status in
    ('Backlog','In Progress','For SMM Approval','Kasper Approval','Client Approval',
     'Tweaks Needed','Approved','Scheduled','Posted','Canceled')),
  status_at timestamptz,              -- stamped by trigger, reuse the *_status_at trigger pattern
  assignee_id uuid references team_members(id),
  due_date date,                      -- drives the workload/planned view (owner's answer #2)
  file_url text,                      -- per-deliverable delivery link (graphics always; video optional)
  comments text,                      -- JSON thread, same shape as *_tweaks threads (reuse merge RPC pattern)
  sort_key numeric,
  created_by text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linear_issue_id text                -- transition only: the mirrored Linear sub-issue url
);
create index on deliverables (client_slug, status);
create index on deliverables (assignee_id, due_date);
create index on deliverables (batch_id);
create unique index deliverables_linear_link_live
  on deliverables (linear_issue_id) where linear_issue_id is not null;
  -- the duplicate-link guard finally becomes a DB constraint

create table deliverable_events (   -- clone of sample_review_events, same anon-read + realtime
  id bigint generated always as identity primary key,
  deliverable_id text not null, batch_id text, client_slug text not null,
  ts timestamptz not null default now(),
  actor text, role text, action text not null,
  from_status text, to_status text,
  source text not null default 'ui',   -- ui | mirror | backfill
  payload jsonb
);
```

Card linkage: add `deliverable_id text` to `calendar_posts` and `sample_reviews` (nullable,
alongside the Linear link columns during transition). The calendar card's editor display joins
`deliverables.assignee_id → team_members.name`. Realtime publication: add `batches`,
`deliverables`, `deliverable_events`, `clients` (rev-style if needed), `team_members`.
Anon SELECT stays `using(true)` on the new tables for now (parity with the rest of the app);
writes are EF-only with role keys.

## 5. Backfill (B1)

One-off scripts (pattern: `scripts/linear-sync-reconcile.js` — Node, reads Linear GraphQL):

1. `clients` ← Linear projects (48) merged with the Sheets "Clients Info" tab (display names,
   review tokens) and the audit's active-project list; brand-kit text lifted from Linear project
   descriptions into `brand_kit`. Slack channel ids from Linear project `slackChannelId`,
   falling back to the `{slug}-creative` channels the onboarding provisioner creates.
2. `team_members` ← the 5 active editors/designers + SMMs + admins (names/emails from the Linear
   audit §2; Slack ids from the "Video Editors" sheet tab that `send-urgent-slack` uses today).
3. Open work only: for each non-completed Linear sub-issue in GRA/VID (≈ current-cycle scope,
   ~1,075 — but skip stale WIP older than a cutoff the owner picks), create `batches` (from
   parents, one batch per mirrored GRA/VID parent PAIR — dedupe by identical title/client) and
   `deliverables` (status/assignee/due-date mapped; `linear_issue_id` set). Completed history
   stays in Linear's export archive (B5) — do not import thousands of dead issues.
4. Link existing cards: where `calendar_posts`/`sample_reviews` carry a `linear_issue_id` that
   matched a backfilled deliverable, set `deliverable_id`.

## 6. UI (B2) — the `production` tab (`_prod*` namespace, flag `?prod=1` + role-gated)

- **Board view** (default for creative role): columns = statuses, cards = deliverables, filtered
  to "Mine" by default (assignee = the logged-in actor's team_member), sorted by due date.
  Toggle: My queue / whole team / by client. This deliberately looks and behaves like the Linear
  board they use today.
- **Batch view**: batch header (description, filming doc, footage folder, delivery folder — the
  things the owner says editors actually read) above its deliverables. Batch-level delivery-link
  field satisfies the video team's "one frame.io folder per batch" flow (§2.3); per-deliverable
  `file_url` satisfies graphics (§2.4).
- **Deliverable card**: status chips (creative role can move In Progress ↔ For SMM Approval ↔
  Tweaks Needed; approval statuses are smm/admin-only actions — mirror today's who-does-what),
  comment thread (reuse the threaded-comments component + merge-RPC pattern), file link,
  due date, assignee, history (from `deliverable_events`).
- **Intake** (smm/admin): "New batch" form replacing the `linear` tab's video/graphic forms —
  same fields (client, titles/notes, filming plans), creates batch + N deliverables in one EF
  call, auto-assigns via a ported "freest editor" rule (count open deliverables per active
  team_member of that team; the n8n "Pick Freest Editor" logic in VIDEO PRODUCTION AUTOMATION is
  the reference), optionally still fires the n8n AI-thumbnail webhook. The old forms keep working
  until B5 (they create Linear issues; during transition the mirror keeps both worlds aligned).
- **Calendar/SXR cards** (smm view): show editor name + batch color chip via `deliverable_id`
  join; card link modal accepts a deliverable picker (replacing the Linear sub-issue URL paste)
  once the pilot team is on.
- **Workload tab**: re-point from `workload_issues` to `deliverables` (a view or direct query)
  when B3 starts for the pilot team; `workload_issues` keeps serving the non-pilot team until B5.
- **Notifications EF** (`notify`): posts to `clients.slack_channel_id` on: deliverable assigned,
  status → Tweaks Needed (with the tweak text), status → For SMM Approval, URGENT button.
  Slack bot token as EF secret. Isolated module so ro.am can replace it later (D8).

## 7. Parallel run and cutover (B3–B5)

**What "parallel run with mirror" means (plain words):** the new Production tab becomes the
single source of truth for the pilot team, but every change made there is **also copied into
Linear** (one-way, new-system → Linear, via the Track A outbound bridge EFs and issue
creation via the existing intake automation). Nobody has to check two tools — Linear just stays
a read-only mirror so (a) the non-pilot team's world is unchanged, (b) the old Slack/Linear
integrations keep firing, and (c) if the pilot fails we turn the flag off and nothing was lost.
Inbound Linear→new-system sync is deliberately NOT built; during the pilot, pilot-team statuses
change only in SyncView. A daily diff script (deliverables vs mirrored Linear issues) reports
any divergence to Slack.

- **B3 — Graphics pilot** (owner's smaller team: 1 designer, ~350 active issues vs Video's ~730):
  Rocío + the SMMs run 2 full batch cycles in the Production tab. Gate: zero lost/incorrect
  statuses in the diff report, designer and SMMs sign off.
- **B4 — Video joins.** Same bar, 2 cycles.
- **B5 — Cutover & teardown:**
  1. Intake stops creating Linear issues; mirror off.
  2. Export the Linear workspace (built-in export + `uploads.linear.app` images referenced in
     briefs — download anything the briefs still need into Drive) and archive it.
  3. Retire, in order: outbound bridge EFs (`linear-set-status`, `linear-add-comment`,
     `linear-issue-statuses`), the inbound `linear-status-sync` EF + the Linear webhook, both
     reconcile scripts + their GitHub Actions + the n8n trigger workflows
     (`AkiFmromoDkmsh39`, `ZJOtYpQZj73DcBB1`), `Workload — Reconcile` + `workload_issues`,
     VIDEO PRODUCTION AUTOMATION's Linear branches, `linear-tweak-comments`, `editors-week`
     (replaced by a `deliverable_events` query), the nightly due-date bumper, and the Linear
     link columns' UI affordances (columns themselves can stay, inert, for history).
  4. Cancel the Linear subscription once the archive is verified.

**Open decision for the owner (carry into B2):** the nightly automation currently bumps every
overdue due date to tomorrow (audit `2026-07-03-linear.md`, ~23:00 UTC fingerprints).
Recommendation: do NOT replicate it — show a visible "overdue" state on the board/workload
instead, because silent bumping hides lateness. Owner to confirm before B2 ships.

## 8. Verification

- Probe suite `qa/` additions following the SXR probe pattern: batch create → auto-assign →
  status walk (In Progress → For SMM Approval → Tweaks Needed → … → Posted) → delivery links →
  calendar card shows editor → events ledger rows exist for every step → Slack notify fired
  (assert via a test channel). Run against the QA client slug.
- Role-key matrix test: each of the 3 keys × each write action → allowed/denied as per §3/§6.
- Mirror diff script green for the whole pilot window.
- `npm test` + `qa/master.js` stay green throughout; the Production tab gets its own lane.
