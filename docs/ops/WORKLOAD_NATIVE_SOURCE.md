# Workload native membership — implementation and retained scope

## 2026-09-05 candidate: native default and compatible saved plans

**SOURCE_ONLY; not deployed, not G5 closed.** Base is remote main
`99d31c815de3e1a46deeb01c45c09bf2937040ad`. This current section supersedes the
older proposed identity/default-read choices below; dated measurements below
have not been refreshed by this implementation.

The staff board now opens, force-refreshes, refreshes after intake, and refreshes
in the background through `workload-plan` action `native_snapshot`. The new
service-only `workload_native_snapshot_v1()` reads the current `prod_authority`,
population and every saved-plan row in one PostgreSQL statement snapshot. Its
exact count must match all returned identities; more than 50,000 population or
plan rows refuses rather than returning a partial success. A missing flag,
dependency, grant, alias proof or complete native weight projection holds the
read. The previous board remains visible with a retry warning; saved-plan and
deadline writes are held. An auth denial purges the private plan/metadata state.
The old `wl2` switch, cache and provider transport cannot rescue a failed native
snapshot. Historical `_wlLegacy*` functions remain inert compatibility source.

VID/GRA use the existing native view only when their actual authority is
`syncview`. Existing status mapping, imported-container exclusions, completed
status filtering, item order, weighted Video capacity and unweighted Graphics
capacity remain. Active native client and exact active assignee team/creative
role determine native membership; a missing provider user mapping is allowed.
Excluded/unassigned work retains the existing visible exclusion accounting.
Legacy rows retain their previous membership rules. **CON/STR remain explicit
legacy source coverage, with a visible warning.** A provider-authority VID/GRA
team also remains explicitly legacy and uses the existing metadata gateway.
Failure does not replace a native population with a provider population.

Native board IDs are deliverable IDs. Mapped old UUIDs are aliases, never new
storage identities inferred from a name or title. The snapshot projects each
saved plan onto its currently visible native or provider card; old `list`
callers receive both exact aliases. Writes resolve the same owner again under
locks. Existing UUID/native storage keys are retained; conflicting dual rows,
cross-client ownership and ambiguous aliases refuse without deleting anything.
A first native-authority plan uses the native ID; a first provider-authority
mapped plan uses the provider UUID after exact current mirror/client validation.
The SQL writer rechecks and locks the authority row before choosing that key.
The original sidecar remains last-write semantics; this is not a new general
plan CAS or replay protocol. New schema contains three functions and **no new
table, epoch, data migration or flag**.

Native Workload links use native deliverable IDs. Native feedback preview uses
the existing staff `production-comments` canonical reader with exact complete
pagination, identity/session checks and deleted/resolved suppression, without a
Linear fallback. Empty preview explicitly directs staff to the post's review
notes. This does **not** prove source-only Calendar/Samples feedback coverage or
feedback write/retry continuity. Those remain G4/G5 integration gates. CON/STR
feedback retains its existing legacy path; native membership is not full
provider independence.

### Evidence and release gates

- `test/workload-native-membership.js`: 47 isolated real-source reader/adoption
  checks, including exact-base forced-provider negative control. No network.
- `test/workload-native-postgres.js` plus `qa/workload-native/handler.mjs`:
  opt-in disposable PostgreSQL proof; 28 SQL and 29 full-handler/shared-auth
  checks. Includes >1,000 rows, real statement snapshot/concurrent plan commit,
  both flip directions, first/existing storage keys, alias refusal and service
  privileges. The SDK is replaced with SQL transport; the consumed production
  view columns use the actual label helper. Legacy/flag tables are minimal
  fixtures. This is not installed-schema, Deno serving or live continuity proof.
- Existing capacity, saved-plan optimistic restoration, actor and authority
  tests must still pass after their fixture interfaces follow the atomic reader.
  Full integrated house/CI checks and named independent review remain required.

**Targeted compatibility result:** all six adapted Workload suites passed in
one run, 2026-09-06 01:41:52–01:42:50 UTC, with unchanged runtime/test hashes:
`workload-linear-browser`, `workload-plan-failclosed`, `workload-plan-source`,
`workload-syncview-links`, `workload-overdue-ruling`, and
`workload-tweak-exclusive-bucket`. The browser fixture composes the actual
atomic loader and preserves receipt/session/write-race/auth assertions; it does
not redirect them to dead `_wlLegacy*` code. This is offline VM/source proof,
not Chromium, serving, a full integrated house suite or release approval.

**Required SQL CI lane:** the existing unit job now runs the 28 SQL and 29
handler checks in a separate, mandatory step against its disposable PostgreSQL
16 service. The step resolves an executable `psql` path and supplies explicit
confirmation, loopback port and a purpose-specific synthetic password. Required
mode refuses missing setup or failed authentication; ordinary manual execution
without confirmation still skips. Both SQL clients discard ambient `PG*`
environment variables, use fixed loopback arguments and prohibit password
prompts. A local SCRAM fixture passed all 57 checks with deliberately conflicting
ambient connection settings; an incorrect explicit password refused. The exact
prior harness failed before fixture creation on that same password-protected
server, with only a generic bounded SQL failure recorded. The unit job has a
20-minute limit for the expanded suite and SQL rehearsals: the coordinator's
local integration already exceeded ten minutes. Shorter SQL process timeouts
remain. This is a finite CI bound, not a hosted-CI pass or a deployment claim.

**Separate actual Chromium smoke:** `node qa/workload-native/browser.js` loads
the complete integrated HTML through the existing boot stream server and
intercepts all external requests. Five groups passed against integration
`688947308c96e6f00b09a495a1f16f939fde479d` on 2026-09-06: staff verification
and native-only card visibility using the real client-group expander; actual
plan handler acknowledgement and forced-refresh alias continuity; missing SQL
preserving visible cards with a warning and disabled writes; successful retry;
and a storage receipt arriving during an older background read causing a new
post-flight read before debt clears. The run made six synthetic snapshot reads,
one synthetic plan write and zero unknown/provider/WebSocket requests. It does
not replace or extract product loaders/renderers. Endpoint responses and the
boot fixture's third-party SDK are synthetic, so this does not add SQL, serving,
live roster, OS containment or full-release proof. Timestamped receipts contain
source hashes, synthetic scenario labels and counts. Playwright and Chromium are
required; this optional browser lane is separate from the dependency-free unit
discovery and makes no workflow change.

Execution remains owner-coordinated: (1) capture exact serving `workload-plan`
closure, current flags, grants, stored-plan counts/keys and schema/data restore
point privately; prove installed native view/label helper and eligible population
against the same authority. Classify every active provider-only row before
release: absence from the native view is not proof that its work is obsolete.
(2) Include the three additive functions in the
schema/grant restore corpus and test restoration; install the manual migration
only after approval. (3) Manually deploy/read back the complete `workload-plan`
closure, including `native-snapshot.mjs`; prove old/new list aliases, read roles,
write roles and preserved dates. (4) Release the browser only after those gates,
then designated staff canaries for each team, normal/forced/background refresh,
weights, unassigned/excluded counts, deadlines, pins/clear/group move, native
links and failed reads. Clients keep their existing anonymous review surfaces:
this staff-only route adds no compulsory client descriptor or writer gate.

Abort on count/alias drift, missing weights, a lost pin, enabled writes after
failed authority, unexpected provider egress for native requests, or serving
closure mismatch. Keep the prior visible staff board while investigating.
Do not flip authority as a rollback shortcut. Preserve the additive reader and
alias-aware writer during a browser rollback: restoring the older Edge Function
can hide native-key plans from old UUID callers. An old browser cannot display
native-only work; therefore a full old-source rollback is **not** a proven
continuity recovery after new native work/pins exist. Require a forward repair
or an approved, tested exact data/alias restore. Never delete native plans to
make an older viewer appear consistent. Helpers may be removed only before any
new caller/plan depends on them, or after that separately proved recovery.

Remaining: known native-view eligibility differences need current reconciliation;
CON/STR authority/provider paths; source-only feedback; broader roster/default
picker and native label ownership; manual serving proof; client/staff integrated
release canaries and observation. This implementation does not close Decision A.

## Retained historical investigation

**Why this file exists.** Owner, 2026-09-01: *"we have to think about leaving
linear soon, like in a week we'll remove anything regarding linear."* That is not
reachable today, and the reason is one sentence: **the Workload board is the only
major surface that still reads a Linear-derived table.** Production and Samples
were moved to the native projection at the flip. Workload was not.

Companion to `OPEN_REPAIRS.md` item 95, which measures what that already costs
in live work — 40 rows across 10 active clients — and is not a future risk.

---

## 1. What Workload reads today

```
Linear  ──(n8n reconcile, ~10 min)──▶  public.workload_issues  ──(REST)──▶  board
        └─(Linear webhook)───────────▶
```

`workload_issues` carries 1,995 active rows and is rebuilt from a Linear query.
Its shape is Linear's, not ours: `identifier`, `url`, `linear_created_at`,
`linear_updated_at`, `parent_identifier`, `status` (Linear's display name),
`status_type` (Linear's type), `team_key` (`VID`/`GRA`), `active`, `synced_at`.

Three consequences follow from that one arrow, and each is load-bearing:

- **Linear is a mandatory relay, not a legacy mirror.** Turn it off and the board
  is empty. Nothing else populates that table.
- **Sub-issue creation in Linear cannot stop**, because the rows the board draws
  ARE those issues. (Creation must still originate in the content calendar, per
  the standing rule — this is about the Linear write existing at all, not about
  where it is triggered.)
- **A native write is invisible to Workload until it round-trips through Linear.**
  `index.html` already carries `_wlPendingNativeDueReceipt*` — a mechanism that
  holds native due-date receipts in memory across refreshes — with the comment
  *"Native writes do not advance `workload_issues.synced_at`."* That is a
  workaround for exactly this, and it can be deleted when this lands.

## 2. The mapping, field by field

`_wlV2MapRow` (index.html) is the whole contract. Everything the board consumes
comes through it, so a native source has to answer these twenty fields and
nothing more.

| board field | from `workload_issues` | native answer | work |
|---|---|---|---|
| `id` | Linear issue uuid | `id` (`del_…`) or `linear_issue_uuid` | **identity decision, §3** |
| `identifier` | `identifier` | `linear_identifier` / `identifier` | direct |
| `title` | `title` | `title` | direct |
| `url` | `url` | `linear_issue_url` | **Linear-shaped, §3** |
| `isSubIssue` | `is_sub_issue` | derived: has `batch_id`, is not the parent | derive |
| `parentId` | `parent_id` | `batch_id` / `raw_issue_parent_id` | direct |
| `parentIdentifier` | `parent_identifier` | join `batches` | join |
| `dueDate` | `due_date` | `due_date` | direct |
| `createdAt` | `linear_created_at` | `created_at` | direct |
| `updatedAt` | `linear_updated_at` | `updated_at` | direct |
| `syncedAt` | `synced_at` | — | drop; native IS the source |
| `sortOrder` | *(column does not exist)* | — | see §4 |
| `status` | Linear display name | native status | **vocabulary, §3** |
| `statusType` | Linear type | derive from native status | **vocabulary, §3** |
| `teamKey` | `VID` / `GRA` | `video` / `graphics` | map |
| `teamName` | `team_name` | derive | derive |
| `assigneeId` | `assignee_id` | `assignee_id` | direct |
| `assigneeName` | `assignee_name` | join `team_members` | join |
| `assigneeEmail` | `assignee_email` | join `team_members` | join |
| `clientName` | `client_name` (display) | `client_slug` → display | map |

Twelve are direct or trivially derived. The work is in four places.

### …but the row mapper is NOT the whole source contract

Review on #1208 caught two more Linear reads that never pass through
`_wlV2MapRow`, so a scope built from that table alone would have been costed
short. Both are named here rather than discovered during the cutover:

- **Tweak comments.** Opening a Tweak Needed popover calls
  `wlFetchTweakComments()` (index.html), which POSTs the board's row ids to
  `LINEAR_TWEAK_COMMENTS_WEBHOOK` — an **n8n** webhook,
  `…/webhook/linear-tweak-comments`. Change the row id to `del_…` and that
  endpoint matches nothing, immediately; remove Linear and the source is gone
  entirely, leaving editors without the feedback that sent the work back. This
  has to move to native comments (`production-comments` already serves them) or
  keep an explicit Linear-UUID adapter for as long as it exists. **Touching that
  n8n workflow needs the owner's explicit go-ahead.**
- **Plan-day writes.** See §3b — the plan sidecar is keyed the same way, and the
  gateway validates against `workload_issues` itself.

## 3. The four hard parts

**a. Status vocabulary — and it is an improvement, not a tax.** The board tests
`statusType` (`wlIsActiveStatus` excludes `completed`, `canceled`, `duplicate`,
`triage`, and by the 2026-08-23 owner ruling `backlog`). Native status is a
closed set we own. Linear's is not, and the live data shows why that matters:
`workload_issues` currently holds **both `For Client approval` and
`For Client Approval`** as distinct statuses — 31 rows and 20 rows. Two spellings
of one state, because the vocabulary is a human-editable display string in
someone else's product. A native source ends that class of bug outright.

**b. Row identity — and it is not only a browser concern.** Every board row is
currently keyed by a Linear uuid, and `_wlV2MapRow` puts it in `id`. Switching to
`del_…` touches anything that round-trips an id — selection, the due-date write
path, deep links.

**Two of those are server-side and must move in the same change, or the board
silently loses saved work.** Raised by review on #1208 and verified:

- `public.workload_plan` has `issue_id text primary key`, and its own comment
  says *"keyed by the stable workload issue id"* — the Linear uuid. Every
  manual plan day already saved is keyed that way. Change the browser's id
  without migrating this table and those rows stop joining to the board: the
  days do not error, they simply stop appearing.
- `workload-plan`'s `requireWritableIssue()` validates every write against
  `workload_issues` (index.ts:168). A native id fails that lookup, so every
  subsequent drag or date write returns `issue_not_writable`.

So the identity change needs a key migration (or a compatibility mapping) **and**
a validation-source change in the gateway, both landed before the browser
cutover. That is real work and it belongs in the estimate.

Choosing `linear_issue_uuid` instead avoids all of it **but keeps a Linear column
load-bearing**, which is the thing being removed. The recommendation is still
native `id` — now with its actual cost stated rather than "budget for the call
sites".

**c. `url`.** Today every row links to Linear. After the exit there is no Linear
to link to. This needs an owner answer — a SyncView deep link (`?prod=1&d=…`)
is the obvious replacement and already exists.

**d. Assignee and client display names.** `workload_issues` denormalises name and
email onto every row. Natively these are joins to `team_members` and the client
roster. Straightforward, but it is a view change, not just a query swap — and it
should be a view, so the browser keeps making one request.

## 4. Two things that quietly do not exist today

- **`sortOrder` is already dead on this path.** `_wlV2MapRow` reads
  `r.sort_order`; `workload_issues` **has no such column**. `wlSortSubIssues`
  degrades safely (it requires *every* row to have a finite value before using
  it, then falls back to the trailing number in the identifier), so nothing is
  broken — but Linear's manual ordering has not reached this board for as long as
  v2 has been the default. Do not reintroduce it as a requirement without asking
  whether anyone wants it.
- **Realtime is off.** `WL_V2_REALTIME = false`, because the reconcile rewrites
  every row each run and would emit one event per row per run. A native source
  writes only what changed, so realtime becomes available for free — the comment
  in `index.html` already says "flip to true once the reconcile only writes
  changed rows."

## 4b. The wider Linear surface — eight live browser endpoints, not one

Review on #1208 found two reads the row mapper does not cover. **Two independent
misses is a signal about the method, not the document**, so the browser was swept
for every direct Linear-touching call rather than reasoning from the mapper
again. Eight, all live — every one is actually fetched today:

| endpoint | called from | direction |
|---|---|---|
| `linear-issues` | `loadLinearIssues` | read — **Workload's fallback source**; v2 falls back here on any Supabase failure so the board can never blank |
| `linear-tweak-comments` | `wlFetchTweakComments` | read — the Tweak Needed popover |
| `linear-projects` | `fetchLinearProjects` | read |
| `linear-subissues` | `_calSyncStatusFromLinear` | read |
| `linear-issue-statuses` | `_calRefreshParentLinkFlags` | read |
| `linear-set-status` | `_calLegacyPushStatusToLinear` | **write** |
| `linear-add-comment` | `_calLegacyPostLinearComment` | **write** |
| `log-linear-submission` | `_submitLinearFormOnce` | write (logging) |

Three consequences for the exit estimate:

- **The Workload board is not the only surface.** Five of the eight are the
  calendar's legacy Linear path, not Workload's.
- **`linear-issues` is Workload's safety net, and it dies with Linear.** The v2
  rollout's whole rollback story is "any Supabase failure falls back to the
  webhook, so v2 can never blank the board". After the exit there is no fallback,
  so the native source has to be reliable enough to stand without one — that is a
  different bar from "correct".
- **Two are writes.** They cannot simply be deleted; each needs its native
  replacement confirmed live first.

**Every one of these is an n8n workflow, and those are production sales
automation — none may be edited without the owner's explicit go-ahead.** This
table is an inventory, not a work plan.

This section is deliberately not costed. It exists so the one-week question is
answered against the real surface rather than against the Workload board alone.

## 5. Suggested phasing

Each step is independently shippable and independently reversible, and no step
requires the next to have happened.

1. **Build the view** — `workload_issues_native_v1`, shaped to §2 so
   `_wlV2MapRow` needs one small change rather than a rewrite. No browser change.
   Diffable against `workload_issues` in isolation.

   **BUILT 2026-09-02 — `migrations/2026-09-02-workload-native-view.sql`,
   pending owner apply.** Read-only, additive, re-runnable; applying it changes
   nothing anyone sees. It answers all twenty `_wlV2MapRow` fields as two
   `union all` arms (one row per deliverable, one per batch that carries at
   least one), refuses to commit if any `deliverables.status` escapes its map,
   and is pinned by `test/workload-native-view-contract.js`.

   It takes **none** of the §6 decisions: it answers both `id` and `linear_id`,
   still points `url` at Linear, and publishes `sort_key` as `native_sort_key`
   rather than `sort_order` so the board's ordering cannot switch on by
   accident. The one policy choice it does make is `active` — natively that can
   only mean "its batch is not archived", which is exactly why item 95's rows
   appear on the native side.

   Two facts fell out of building it, both from measuring rather than reading:
   `Approved`, `Scheduled` and `Posted` are all workflow type `completed` (the
   parked-NAME list in `index.html` suggests otherwise, and a wrong guess here
   hides or shows real work), and the live table currently holds
   `For Client approval` (391 rows), `For Client Approval` (366) and
   `Tweak Needed ` with a trailing space (13) — three spellings of two states,
   plus 19 rows with no status at all. §3a said the vocabulary problem was
   real; it is bigger than the 31/20 it cited.
2. **Read it behind a flag** (`?wlnative=1`), same pattern the Workload v2
   rollout itself used. Both sources readable side by side, so the diff is
   measured on real data instead of argued about.

   **BUILT 2026-09-02, as a DIFF and not a swap.** `?wlnative=1` reads the
   native view alongside `workload_issues` and prints what differs;
   `window.wlNativeDiff()` runs the same thing by hand. It changes nothing the
   board renders — no `wlState` write, no render call, no sticky flag — and a
   missing view answers "apply the migration first" rather than looking like a
   broken board.

   **It is not a swap because a swap is not yet safe, and that is worth stating
   plainly rather than filing as caution.** `public.workload_plan` is keyed on
   the Linear uuid and `requireWritableIssue()` validates every write against
   `workload_issues`; a deliverable that has never been mirrored has no Linear
   uuid at all. Switching the read source would therefore put rows on the board
   whose plan day **silently fails to save** — a drag that looks like it
   worked, which is strictly worse than a row that is not there yet. That
   repair is §6.1's decision plus a key migration, not a flag.

   The report deliberately excludes the fields the two sources are SUPPOSED to
   disagree about (`id`/`parent_id` while §6.1 is open, `url`, `assignee_id`'s
   different namespace, `parent_identifier`) and says so in its own output, so
   a zero diff reads as *"these agree about what was checked"* rather than
   *"these are identical"*. Status is compared trimmed and lower-cased, with
   spelling-only differences counted separately — they are the thing the native
   source exists to end, not evidence against it. Rows with no Linear uuid are
   reported as **never mirrored** rather than as drift; there is nothing to
   compare them to.
3. **Reconcile the diff to zero** for active-roster clients. Item 95's 40 rows
   should appear on the native side and not the Linear side — that is the
   acceptance test, not an incident.
4. **Default it on**, keep `?wlnative=0` as the one-browser rollback — which is
   only a rollback while `workload_issues` is still being populated (see below).
5. **Only then** stop writing Linear sub-issues, and retire the reconcile.

**Steps 4 and 5 contradict each other unless the flag is retired first**, and
review on #1208 was right to refuse the original wording. `?wlnative=0` falls
back to `workload_issues`; step 5 stops that table receiving anything new. A
browser opted out after step 5 would show a board that silently degrades as
every newly created deliverable fails to appear — the worst shape, because it
looks like a working board. So either **keep mirroring through the whole
rollback window**, or **remove/expire the flag and define a different rollback
before executing step 5**. Do not carry a rollback lever that stops being one.

## 6. Owner decisions this needs

1. **Row identity** — native `del_…` (fuller exit, more call sites) or
   `linear_issue_uuid` (smaller change, keeps a Linear column load-bearing)?
2. **What `url` points at** after Linear.
3. **Is a one-week exit still the intent** given steps 1–5? Steps 1–3 are the
   bulk of it, and step 3 is measurement rather than construction, so it is not
   obviously impossible — but it is not a switch either.

## 7. What must not be done before this ships

- Do not stop creating Linear sub-issues.
- Do not disable the reconcile or the Linear webhook.
- Do not "fix" item 95 by patching the `workload_issues` path — that work is
  thrown away by step 4.
