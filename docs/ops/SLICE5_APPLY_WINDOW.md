# Slice 5 — owner-gated apply / deploy window

**Status:** STEPS A AND B EXECUTED 2026-07-26 (~23:45Z / 23:49Z). The owner applied the
migration via the Supabase SQL editor and dispatched the deploy (run `30226070558`), both pinned
to `f3cf20ec0e57fb1e57cd7c19a7d9d3ebd6cec105`; every readback below passed, with the measured
speed-up 1,273→392 ms per page and 3.6–4.3 s→1.15 s per boot walk (receipts in
`EXECUTION_LOG.md`). **The §3 TEST drills remain OWED** — F37/F94/F136/F95 are live-capable, not
yet proven. No runtime flag, authority value, n8n workflow, or frozen writer was touched.

One correction from the window: A1's original expected value said 45; the view has **46** columns
(verified live and by the reviewer's 46-column equivalence proof). `create or replace view`
enforces shape identity, so the miscount was a doc typo, not drift.

**Scope:** blocker #8 (F37 + F94 + F136 — verified personal queue, eligible assignment, and one
server-owned transition/peer-work policy) and blocker #9 (F95 — bounded foreground refresh),
including the read-path fix F95 depends on.

**Companion documents:** `migrations/README.md` (recipe bullet), `ROLLBACK.md` (Slice 5 row),
`docs/truth/SUPABASE.md` (measured read cost), `docs/truth/ENDPOINTS.md` (`assignee_options`).

---

## 0. What changes where

| Artifact | Lane | Goes live when |
|---|---|---|
| `index.html` (queue identity, picker, transition gate, refresh loop, keyset read) | GitHub Pages | **on merge** — Pages deploys `main` |
| `supabase/functions/production-write/{index.ts,policy.mjs}` | pinned `workflow_dispatch` on **Deploy staff-sensitive edge functions** | only when the owner dispatches it |
| `migrations/2026-07-25-slice5-production-read-path.sql` | Supabase SQL editor, by hand | only in this window |
| `test/*`, `qa/probes/prod_read_path_timing.js`, docs | none | n/a |

The browser half is the only part that ships on merge. It is safe to ship alone: it is strictly
more restrictive than what is deployed, and every write it can attempt is still refused by the
already-deployed gateway plus the `prod_authority` gate, which is `linear` for both real teams.

## 1. Preconditions (verify, do not assume)

1. `npm test` green on the exact merge SHA, and `npm run test:prod-polish` green (10 suites).
2. Read back current authority — do not trust this document:
   `GET /rest/v1/syncview_runtime_flags?select=value&key=eq.prod_authority` → both teams `linear`.
3. The most recent scheduled Track-B snapshot exists (`docs/ops/TRACK_B_BACKUP.md`). The view/index
   step holds no data, so this is belt-and-braces, not the restore path for this change.
4. Record the exact SHA being applied/deployed. Every step below is pinned to that one SHA.
5. Baseline the read path **before** touching anything, so the after-numbers are comparable:
   `node qa/probes/prod_read_path_timing.js single` and `… pagination`. Keep the output.

## 2. Order of operations

The two live steps are independent — neither is a precondition of the other — but this order gives
the cheapest rollback at every point.

### Step A — apply the read-path migration (Supabase SQL editor)

Apply `migrations/2026-07-25-slice5-production-read-path.sql` verbatim, in one transaction.

Readbacks, all read-only, all against the live database:

```sql
-- A1. the view still has exactly its 46 browser columns, in order
select count(*) as columns
from information_schema.columns
where table_schema = 'public' and table_name = 'production_deliverables_browser_v1';

-- A2. grants and security_barrier survived the in-place replace
select grantee, privilege_type
from information_schema.role_table_grants
where table_name = 'production_deliverables_browser_v1' and grantee in ('anon','authenticated');
select reloptions from pg_class where relname = 'production_deliverables_browser_v1';

-- A3. the new extraction mechanism is the one that landed
select pg_get_viewdef('public.production_deliverables_browser_v1'::regclass) ~ 'jsonb_to_record' as replaced;

-- A4. the delta index exists
select indexdef from pg_indexes
where schemaname = 'public' and indexname = 'deliverables_updated_at_idx';

-- A5. the plan no longer repeats the per-column detoast
explain (analyze, buffers)
select * from public.production_deliverables_browser_v1
order by team asc, status asc, due_date asc limit 1000;
```

Expected: A1 = 46; A2 = `anon:SELECT`, `authenticated:SELECT`, `{security_barrier=true}`;
A3 = `true`; A4 = a btree on `(updated_at)`; A5 execution time roughly a third of the pre-apply
figure captured in step 1.5.

Then re-run the anon probe and compare against the baseline:

```
node qa/probes/prod_read_path_timing.js single
node qa/probes/prod_read_path_timing.js pagination
```

Expected direction (offline measurement was 3.0× on the page and 2.2× on the delta window):
the full-projection page drops from ~1.2–1.5 s to roughly 0.4–0.5 s upstream, and the keyset walk
from ~3.4 s to roughly 1.1–1.2 s. **If the page does not get materially faster, stop and
investigate — do not proceed to step B and do not treat the number as noise.**

Rollback for step A: re-run the original `create view` statement from
`migrations/2026-07-23-f34-f53-production-attachments.sql` as `create or replace view`, and
`drop index if exists public.deliverables_updated_at_idx;`. Catalog-only, no data involved.

### Step B — deploy `production-write`

Dispatch **Deploy staff-sensitive edge functions** pinned to the same SHA. This is the only
supported lane for this function; merging and pushing must not deploy it.

Readbacks:

```
B1. the workflow's own pinned-SHA guard passes and the run id is recorded
B2. function version increments (Supabase dashboard / functions list)
B3. a signed-out POST to /functions/v1/production-write with
    {"action":"assignee_options","surface":"production","id":"<any>","client_slug":"<any>"}
    returns 401 — never a candidate list
```

There is no real-data write in this window. The service-only TEST drills below are separate and
still owed.

Rollback for step B: redeploy the previous SHA through the same lane. The browser fails closed if
`assignee_options` is unavailable — the picker shows "Eligible assignees could not be loaded" with a
Retry and offers no selectable member — so an un-deployed gateway degrades the assignee control
rather than allowing an unchecked assignment.

## 3. What is still owed after this window (not in scope here)

These are the gates that make F94/F136 *proven* rather than *implemented*. None of them is a real
write against a real team; all of them run against the active TEST client with the service-only
override.

1. **F94 negative drill.** Attempt an assignment to, in turn: an inactive member, a cross-team
   member, an admin/SMM row, a member with no `linear_user_id`, and a member whose Linear user is
   archived. Expect `403 assignee_out_of_scope`, `403 assignee_role_incompatible`,
   `409 assignee_mapping_unavailable`, `409 assignee_provider_inactive` — and in every case **zero**
   `deliverables` mutation, **zero** `deliverable_events` row, and **zero** `mirror_outbox` row.
   Then assign to an eligible member and prove the native row, the event, and the outbox intent all
   appear together.
2. **F94 stale-picker drill.** Open the picker, deactivate the chosen member out of band, then
   commit. Expect the commit to fail closed, not to trust the list the browser was holding.
3. **F136 13×13 matrix.** For each role × current × next, with the row assigned to the actor, to a
   peer, and unassigned, reached from the list and from a direct `?prod=1&d=<id>` link, on a second
   device, and under a stale CAS. Expect the accepted set to equal
   `CREATIVE_STATUS_TRANSITIONS` exactly and every other combination to return
   `403 operation_forbidden` before any mutation.
4. **F37 identity drills.** The unattended owner-gated harness covers only synthetic TEST
   identities: account switching, duplicate display names, a roster reorder, a zero-row member, a
   deactivated member, and a signed-out session must each resolve to the right queue or to the
   explicit no-personal-queue state. It does **not** claim real-staff sign-in coverage. Still owed:
   in a supervised owner session, every active creative signs in with their real credentials and
   sees only their own personal queue. Real staff credentials must never be issued to unattended
   automation.
5. **F95 two-tab convergence.** Two foreground tabs, one second device: assignment, status,
   tweak/comment, artifact, and archive changes all converge within one tick, with drafts, scroll
   position, and the open composer preserved, and a forced failure showing the degraded state and
   recovering on Retry.
6. **Read-path re-baseline.** Re-run `qa/probes/prod_read_path_timing.js` after a week of normal
   growth and confirm the delta tick has not drifted.

## 4. Owner decisions this slice deliberately defaulted (one line each)

Each was shipped at its **strictest** reading and is a one-value change to widen. None of them can
be widened by accident: the defaults live in `CREATIVE_STATUS_TRANSITIONS`,
`CREATIVE_ROLE_BY_TEAM`, and the `production_assignee_eligibility` flag.

1. **F94 roles** — may an Admin or SMM ever own a creative deliverable, or is Video=`editor` /
   Graphics=`designer` exact? *Shipped: exact.* (Costs nothing today: no admin/SMM roster row
   carries a team.)
2. **F136 peer work** — may a creative act on a same-team row assigned to someone else? *Shipped:
   no, for `status` and `attachment`.*
3. **F136 unassigned work** — may a creative pick up an unassigned same-team row? *Shipped: no.*
   This is the one default most likely to want widening for real day-one flow.
4. **F136 comments** — should `comment` also be assignee-bound? *Shipped: no — comments stay
   same-team-wide, because a comment cannot regress work.*
5. **F136 tweak** — may a creative set `tweak` (a reviewer verdict) on their own work? *Shipped:
   no; they may only move out of `tweak`.*
6. **F136 cancel/duplicate** — Admin/SMM only? *Shipped: yes.*
7. **F95 staleness threshold** — the register's open question 17 asks what maximum foreground age
   should trigger visible stale state. *Shipped: 30 s tick, 120 s before "degraded", 10 min full
   reconcile, exponential backoff to 5 min.*
8. **F94 provider verification** — the `production_assignee_eligibility` flag row does not exist and
   should not be created now; absence means strictest. At Linear retirement, set it to exactly
   `{"provider_mapping_required": false}` to drop only the provider requirement, atomically.
