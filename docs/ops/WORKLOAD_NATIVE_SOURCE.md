# Workload needs a native source — scope

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

## 3. The four hard parts

**a. Status vocabulary — and it is an improvement, not a tax.** The board tests
`statusType` (`wlIsActiveStatus` excludes `completed`, `canceled`, `duplicate`,
`triage`, and by the 2026-08-23 owner ruling `backlog`). Native status is a
closed set we own. Linear's is not, and the live data shows why that matters:
`workload_issues` currently holds **both `For Client approval` and
`For Client Approval`** as distinct statuses — 31 rows and 20 rows. Two spellings
of one state, because the vocabulary is a human-editable display string in
someone else's product. A native source ends that class of bug outright.

**b. Row identity.** Every board row is currently keyed by a Linear uuid, and
`_wlV2MapRow` puts it in `id`. Switching to `del_…` touches anything that
round-trips an id — selection, the due-date write path, deep links. Choosing
`linear_issue_uuid` instead keeps the change smaller **but keeps a Linear column
load-bearing**, which is the thing being removed. Recommend native `id`, and
budget for the call sites.

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

## 5. Suggested phasing

Each step is independently shippable and independently reversible, and no step
requires the next to have happened.

1. **Build the view** — `workload_issues_native_v1`, shaped to §2 so
   `_wlV2MapRow` needs one small change rather than a rewrite. No browser change.
   Diffable against `workload_issues` in isolation.
2. **Read it behind a flag** (`?wlnative=1`), same pattern the Workload v2
   rollout itself used. Both sources readable side by side, so the diff is
   measured on real data instead of argued about.
3. **Reconcile the diff to zero** for active-roster clients. Item 95's 40 rows
   should appear on the native side and not the Linear side — that is the
   acceptance test, not an incident.
4. **Default it on**, keep `?wlnative=0` as the one-browser rollback.
5. **Only then** stop writing Linear sub-issues, and retire the reconcile.

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
