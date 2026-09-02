-- Workload's native source, step 1 of docs/ops/WORKLOAD_NATIVE_SOURCE.md.
--
-- WHY. The Workload board is the only major surface still reading a
-- Linear-derived table. Production and Samples moved to the native projection
-- at the flip; Workload did not. Three things follow from that one fact, and
-- each is load-bearing:
--
--   * Linear is a MANDATORY RELAY, not a legacy mirror. Turn it off and the
--     board is empty -- nothing else populates `workload_issues`.
--   * Linear sub-issue creation cannot stop, because the rows the board draws
--     ARE those issues.
--   * A native write is invisible to Workload until it round-trips through
--     Linear. `index.html` carries `_wlPendingNativeDueReceipt*` purely to
--     paper over that, with the comment "Native writes do not advance
--     workload_issues.synced_at."
--
-- It already costs live work: OPEN_REPAIRS item 95 measures 40 deliverables
-- across 10 ACTIVE clients that are live natively and absent from the board,
-- because something archived their issues in Linear and `workload_issues` is
-- rebuilt from a Linear query that no longer returns them. The flip refused
-- that foreign write at the front door and Workload applied it through the
-- back door, because Workload never reads native data at all.
--
-- WHAT THIS IS, AND WHAT IT IS NOT. This is step 1 of five: build the view,
-- change no browser code, so the two sources can be diffed against each other
-- on real data before anything reads it. Applying this file changes NOTHING
-- that anyone sees. It creates one read-only view and grants select on it.
-- Nothing is dropped, no table is touched, no row is written, and re-running
-- it is a no-op.
--
-- ==========================================================================
-- FOUR DECISIONS THIS FILE DELIBERATELY DOES NOT MAKE
-- ==========================================================================
--
-- 1. ROW IDENTITY. Scope doc §6.1 is an owner decision: native `del_...` ids
--    (fuller exit, more call sites) or `linear_issue_uuid` (smaller change,
--    keeps a Linear column load-bearing). The view answers BOTH and picks
--    neither -- `id`/`parent_id` are native, `linear_id`/`linear_parent_id`
--    are Linear's. This is not fence-sitting: `public.workload_plan` is
--    `issue_id text primary key` holding the LINEAR uuid today, and every
--    manual plan day already saved is keyed that way, so `linear_id` has to
--    survive until that table is migrated whichever way the decision goes.
--    A view that had chosen would have silently orphaned those plan days.
--
-- 2. WHAT `url` POINTS AT after Linear (scope doc §6.2). It still points at
--    Linear here, because that is still where the issue is. A SyncView deep
--    link is the obvious replacement and is an owner call, not a view change.
--
-- 3. WHETHER `sort_order` COMES BACK. `deliverables.sort_key` exists and
--    `workload_issues` has no sort column at all, so this view COULD supply
--    the manual ordering the board has been quietly doing without. It
--    deliberately does not expose it under that name: `_wlV2MapRow` reads
--    `r.sort_order`, and `wlSortSubIssues` uses manual order only when EVERY
--    row has a finite value -- so simply naming the column `sort_order` would
--    silently re-order the whole board the moment this view is read. It is
--    published as `native_sort_key` instead, inert until somebody decides
--    they want it. Scope doc §4: "do not reintroduce it as a requirement
--    without asking whether anyone wants it."
--
-- 4. ANYTHING ABOUT n8n. No workflow is touched, referenced or disabled here.
--    The reconcile and the Linear webhook keep running exactly as they do,
--    which is required until step 5 -- and step 5 is not this file.
--
-- ==========================================================================
-- THE ONE POLICY CHOICE THIS FILE DOES MAKE, SAID OUT LOUD
-- ==========================================================================
--
-- `active`. On the Linear side it mirrors Linear's archived flag, and that is
-- exactly the mechanism item 95 is about. Natively there is NO per-deliverable
-- archive column -- nothing in SyncView can archive a deliverable -- so the
-- closest honest analogue is the batch: `active` is false only when the
-- deliverable's batch is `archived`.
--
-- The consequence is intended and is the acceptance test for step 3, not an
-- incident: item 95's 40 rows SHOULD appear on the native side and not on the
-- Linear side. A diff that shows them is the view working.
--
-- ==========================================================================
-- STATUS VOCABULARY: REPRODUCED FROM TWO SOURCES, NOT INVENTED
-- ==========================================================================
--
-- The board keys behaviour on Linear's vocabulary: `status_type` drives
-- `wlIsActiveStatus`, and the lower-cased `status` NAME drives
-- `WL_PARKED_STATUSES`, `wlIsInProgress` and `wlIsTweaksNeeded`. So the view
-- has to speak that vocabulary, and both halves are taken from evidence:
--
--   * the DISPLAY NAME comes from `STATUS_NAMES` in
--     supabase/functions/linear-outbound/mapping.mjs -- the map SyncView
--     already uses when it writes a status INTO Linear. Using anything else
--     would mean two maps that can disagree.
--   * the TYPE comes from a census of the live table on 2026-09-02, 3,437
--     rows, every distinct (status, status_type) pair. It is not guessed:
--     `Approved`, `Scheduled` and `Posted` are all type `completed`, which is
--     not what the parked-name list would lead you to assume, and getting it
--     wrong by assumption would have hidden or shown real work.
--
-- AND IT ENDS A CLASS OF BUG. That same census found the live table holding
-- `For Client approval` (391 rows) AND `For Client Approval` (366) AND
-- `Tweak Needed ` with a trailing space (13) -- three spellings of two states,
-- plus 19 rows with a null status entirely, because the vocabulary is a
-- human-editable display string in somebody else's product. `wlNormStatus`
-- trims and lower-cases, so the board survives it; the point is that it has
-- to. A closed native set with one canonical spelling each cannot drift.
--
-- ==========================================================================
-- KNOWN, DELIBERATE DIFFERENCES FROM `workload_issues`
-- ==========================================================================
--
-- Recorded here so step 3 measures them instead of rediscovering them:
--
--   * A PARENT'S `identifier` IS THE BATCH NAME, because a batch has no
--     identifier column and `bat_486f3680...` is not something a person can
--     search for. It matches the `parent_identifier` its own children carry,
--     which is what `workload_issues` also does. `identifier` is read by the
--     board's search box and its debug line only; `wlSortSubIssues` reads the
--     trailing number of a SUB-issue's identifier, never a parent's.
--   * A PARENT'S TEAM IS NULL WHEN THE BATCH IS WORKED BY BOTH TEAMS. See the
--     note at that column: the batch has no single team, and the obvious
--     tie-break silently means "graphics".
--   * IMPORTED CONTAINER ROWS ARE EXCLUDED. See the `where not (...)` on the
--     first arm: `deliverables` also holds batch-PARENT issues the B1 importer
--     wrote into their own batches, and they are posts rather than assignable
--     work.
--   * ONE PARENT ROW PER BATCH, not one per team. Linear carries a separate
--     parent ISSUE per team, so a batch worked by both teams has two parent
--     rows there and one here. Every deliverable in the batch points at the
--     same `batch_id`, so `parentById` resolves identically.
--   * PARENT STATUS IS NULL. No filter on this board reads a parent's status
--     -- `wlRenderableIssueProjection` takes parents by id, and every
--     status test upstream is guarded by `isSubIssue`. Minting a
--     Linear-shaped status for them would be a claim nothing checks.
--   * `assignee_id` IS THE LINEAR USER ID, not the native uuid, wherever one is
--     recorded. An earlier draft answered `team_members.id` and called the
--     namespace difference harmless because "the board filters editors by
--     NAME". That was wrong and review on #1222 caught it: filtering is by
--     name, but GROUPING, capacity keys, the rollup map and the seeded
--     freest-first roster all key on the assignee ID. All three
--     WL_VIDEO_EDITORS ids are `linear_user_id` values and none is a
--     `team_members.id`, so the native uuid would have split every editor into
--     a busy chip and a free chip. `native_assignee_id` carries the other one
--     for whoever migrates the roster.
--   * TEAMS `CON` AND `STR` DO NOT EXIST HERE. The live table holds 8 parent
--     rows on Linear teams (Content Research, Strategy and Filming Plans)
--     that have no native equivalent -- `deliverables.team` is video or
--     graphics only. They are parents with no sub-issues on this board, so
--     nothing renders them today either.
--   * `synced_at` IS NULL. Native IS the source; there is no sync to stamp.
--     `_wlV2MapRow` passes it straight through and the board's own comment
--     says reconcile timestamps are excluded from renderable comparisons.

-- IF AN EARLIER REVISION OF THIS FILE WAS ALREADY APPLIED (it was never applied
-- to production, but a branch build may have been), run
--     drop view if exists public.workload_issues_native_v1;
-- first. `create or replace view` cannot change a column's name or position,
-- and review on #1222 added two columns to both arms. Postgres refuses with
-- `cannot change name of view column` rather than doing something surprising,
-- so nothing silently half-applies.

begin;

create or replace view public.workload_issues_native_v1 as

-- Sub-issues: one row per deliverable.
select
    d.id                                            as id,
    d.linear_issue_uuid                             as linear_id,
    coalesce(d.linear_identifier, d.identifier)     as identifier,
    d.title                                         as title,
    d.linear_issue_url                              as url,
    true                                            as is_sub_issue,
    d.batch_id                                      as parent_id,
    b.linear_parent_ids                             as linear_parent_ids,
    b.name                                          as parent_identifier,
    to_char(d.due_date, 'YYYY-MM-DD')               as due_date,
    to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as linear_created_at,
    to_char(d.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as linear_updated_at,
    null::timestamptz                               as synced_at,
    case d.status
        when 'triage'           then 'Triage'
        when 'backlog'          then 'Backlog'
        when 'todo'             then 'Todo'
        when 'in_progress'      then 'In Progress'
        when 'smm_approval'     then 'For SMM approval'
        when 'kasper_approval'  then 'For Kasper approval'
        when 'client_approval'  then 'For Client approval'
        when 'tweak'            then 'Tweak Needed'
        when 'approved'         then 'Approved'
        when 'scheduled'        then 'Scheduled'
        when 'posted'           then 'Posted'
        when 'canceled'         then 'Canceled'
        when 'duplicate'        then 'Duplicate'
    end                                             as status,
    case d.status
        when 'triage'           then 'triage'
        when 'backlog'          then 'backlog'
        when 'todo'             then 'unstarted'
        when 'in_progress'      then 'started'
        when 'smm_approval'     then 'started'
        when 'kasper_approval'  then 'started'
        when 'client_approval'  then 'started'
        when 'tweak'            then 'started'
        when 'approved'         then 'completed'
        when 'scheduled'        then 'completed'
        when 'posted'           then 'completed'
        when 'canceled'         then 'canceled'
        when 'duplicate'        then 'duplicate'
    end                                             as status_type,
    case d.team when 'video' then 'VID' when 'graphics' then 'GRA' end as team_key,
    case d.team when 'video' then 'Video' when 'graphics' then 'Graphics' end as team_name,
    -- THE LINEAR USER ID WHERE ONE EXISTS, not the native uuid. Raised by
    -- review on #1222 and verified: WL_VIDEO_EDITORS seeds the "freest first"
    -- panel with three ids, and all three are `team_members.linear_user_id`
    -- values -- NONE of them is a `team_members.id`. `renderEditorWorkload`
    -- merges live work onto those seeded rows by assignee id, and every
    -- rollup, capacity key and group drag keys on it too. Answering the native
    -- uuid would give each editor a populated chip under one id and a
    -- zero-work chip under the other: the same person shown busy and free at
    -- once, and the freest-editor ranking reading off the wrong one.
    --
    -- Falls back to the native uuid for the 7 of 13 active members with no
    -- Linear id recorded. They have no seeded roster row to collide with, so
    -- the fallback groups their work correctly rather than dropping it into
    -- "Needs assignment" -- which is what a bare `tm.linear_user_id` would do.
    coalesce(tm.linear_user_id, d.assignee_id::text) as assignee_id,
    d.assignee_id::text                             as native_assignee_id,
    tm.name                                         as assignee_name,
    tm.email                                        as assignee_email,
    c.display_name                                  as client_name,
    d.client_slug                                   as client_slug,
    (b.status is distinct from 'archived')          as active,
    d.sort_key                                      as native_sort_key,
    d.kind                                          as native_kind,
    d.sync_state                                    as native_sync_state
  from public.deliverables d
  join public.batches b on b.id = d.batch_id
  left join public.team_members tm on tm.id = d.assignee_id
  left join public.clients c on c.slug = d.client_slug
 -- CONTAINERS ARE NOT WORK. `deliverables` also holds imported batch-PARENT
 -- issues: the B1 importer's `batchGroupKey` read `issue.parent || issue`, so a
 -- parent issue was grouped with its own children and written as a row inside
 -- its own batch (OPEN_REPAIRS item 98; `containerIssueIds` in
 -- scripts/b1-linear-backfill.js stops new ones). `workload_issues` excludes
 -- them correctly because Linear knows they have no parent. Emitting them here
 -- would put a post on an editor's board as assignable work and count it
 -- against their capacity. Raised by review on #1222.
 --
 -- MEASURED 2026-09-02 over the 607 live-work rows, and the obvious predicate
 -- is the wrong one. "No Linear parent" catches 150 rows -- but 57 of those are
 -- `del_` rows born NATIVELY in batches that were never mirrored, so they have
 -- no Linear parent for the same reason they have no Linear anything. Hiding
 -- them is hiding exactly the work this view exists to surface.
 --
 -- So the test is STRUCTURAL, in two parts, and catches 93 rows and no native
 -- one:
 --   (1) the row is named as its own batch's Linear parent -- 77 rows;
 --   (2) it was IMPORTED (a `b1_` id) and carries no Linear parent -- 16 more,
 --       in batches whose parent map was never recorded (item 1).
 -- Scoped to imported ids on purpose: a natively created deliverable can never
 -- be one of these, because only the importer ever made them.
 --
 -- Confirmed independently: all 93 have a title byte-identical to their batch's
 -- name, and 0 of the 57 native rows the naive predicate would have taken do.
 where not (
        exists (
          select 1
            from jsonb_each(case when jsonb_typeof(b.linear_parent_ids) = 'object'
                                 then b.linear_parent_ids else '{}'::jsonb end) as lp(team_key, entry)
           where d.linear_issue_uuid is not null
             and coalesce(entry ->> 'uuid',
                          case when jsonb_typeof(entry) = 'string' then entry #>> '{}' end)
                 = d.linear_issue_uuid)
     or (d.id like 'b1\_%'
         and nullif(btrim(coalesce(case when jsonb_typeof(d.linear_raw) = 'object'
                                        then d.linear_raw #>> '{issue,parent,id}' end, '')), '') is null))

union all

-- Parents: one row per batch that actually carries a deliverable. A batch with
-- no deliverables is never a parent of anything the board renders, so
-- including it would only add rows nothing looks up.
select
    b.id                                            as id,
    null::text                                      as linear_id,
    b.name                                          as identifier,
    b.name                                          as title,
    null::text                                      as url,
    false                                           as is_sub_issue,
    null::text                                      as parent_id,
    b.linear_parent_ids                             as linear_parent_ids,
    null::text                                      as parent_identifier,
    null::text                                      as due_date,
    to_char(b.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as linear_created_at,
    to_char(b.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as linear_updated_at,
    null::timestamptz                               as synced_at,
    null::text                                      as status,
    null::text                                      as status_type,
    -- The batch's own team where it has one, otherwise borrowed from its
    -- deliverables -- but ONLY when they agree. 303 of 1,644 batches carry a
    -- null `team` (OPEN_REPAIRS item 91), and repairing that column belongs to
    -- intake, not to a read path: guessing one IN is how a wrong value becomes
    -- permanent, so it is derived here and deliberately never written back.
    --
    -- A batch worked by BOTH teams answers NULL rather than picking one. It
    -- genuinely has no single team, and an arbitrary tie-break (the first
    -- draft used `min(team)`, which silently means "graphics") would state
    -- something false about every mixed batch. Nothing on this board filters
    -- a parent by team -- parents are resolved by id -- so NULL costs nothing
    -- that a wrong answer would not cost more.
    case (select case when count(distinct d2.team) = 1 then min(d2.team) end
            from public.deliverables d2 where d2.batch_id = b.id)
        when 'video' then 'VID' when 'graphics' then 'GRA' end as team_key,
    case (select case when count(distinct d2.team) = 1 then min(d2.team) end
            from public.deliverables d2 where d2.batch_id = b.id)
        when 'video' then 'Video' when 'graphics' then 'Graphics' end as team_name,
    null::text                                      as assignee_id,
    null::text                                      as native_assignee_id,
    null::text                                      as assignee_name,
    null::text                                      as assignee_email,
    c.display_name                                  as client_name,
    b.client_slug                                   as client_slug,
    (b.status is distinct from 'archived')          as active,
    b.sort_key                                      as native_sort_key,
    null::text                                      as native_kind,
    null::text                                      as native_sync_state
  from public.batches b
  left join public.clients c on c.slug = b.client_slug
 where exists (select 1 from public.deliverables d3 where d3.batch_id = b.id);

alter view public.workload_issues_native_v1 set (security_barrier = true);

-- Read-only, and the same audience `workload_issues` already has: the board
-- reads it with the browser publishable key. No write grant exists to give.
grant select on public.workload_issues_native_v1 to anon;
grant select on public.workload_issues_native_v1 to authenticated;

-- ==========================================================================
-- The status map must be TOTAL, and this is what makes applying the file
-- worth anything on its own. `deliverables.status` is a CHECK-constrained
-- closed set; if a value is ever added to that constraint without being added
-- to the two CASE expressions above, the view answers NULL for it -- and a
-- NULL `status_type` passes `wlIsActiveStatus`, so the row would render as
-- live work with no status at all. Fail the transaction instead.
-- ==========================================================================
do $$
declare
  unmapped int;
begin
  select count(*) into unmapped
    from public.deliverables d
   where d.status is not null
     and d.status not in ('triage','backlog','todo','in_progress','smm_approval',
                          'kasper_approval','client_approval','tweak','approved',
                          'scheduled','posted','canceled','duplicate');
  if unmapped > 0 then
    raise exception
      'workload_issues_native_v1 does not map % deliverable status value(s); extend both CASE expressions before applying',
      unmapped;
  end if;
end $$;

-- Proof the view is readable and shaped as claimed, printed by the apply so
-- the operator sees a number rather than a silent success.
select
  count(*)                                           as rows_total,
  count(*) filter (where is_sub_issue)                as sub_issues,
  count(*) filter (where not is_sub_issue)            as parents,
  -- Type-only, deliberately: this counts what `wlIsActiveStatus`'s TYPE test
  -- keeps, not what the board finally renders -- the parked-NAME list
  -- (WL_PARKED_STATUSES) removes more, and reproducing it here would be a
  -- second copy of a rule that already has one home.
  count(*) filter (where is_sub_issue and active
                     and status_type not in ('completed','canceled','duplicate','triage','backlog'))
                                                      as unfinished_by_type
  from public.workload_issues_native_v1;

commit;
