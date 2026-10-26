# Audit: "duplicate" ui rows in `calendar_post_events` (session Ledger, 2026-10-26)

Read-only. No database writes and no deploys. Counts only, no client or staff names.
All numbers were measured on 2026-10-26 with SQL reads on the live project.

## Short answer

**The rows are almost never duplicates.** The original grouping key
`(post_id, ts, action, role)` leaves out `component`. One card save that moves
several parts writes **one `status_change` row per part that moved** (`video`,
`graphic`, `caption`, `title`) **plus one card-level row** (`component` null)
when the overall status moved. They share `ts`, `action`, `role` and `actor` because
they come from the same save. This is by design.

- **Example from the brief:** ids 90483 and 90484 (25 Oct 22:51:09.733 UTC) are
  not identical. 90483 has `component` null (the card's overall status) and 90484
  has `component = caption`. Both go from Client Approval to Posted. The two
  native-bridge rows a few seconds earlier are the deliverable-to-card status
  projection for `video` and `graphic`. That is a separate writer with its own
  `source`.
- **With `component`, `actor`, `from_status`, `to_status` and `payload` added to
  the key**, since 2026-08-27 and for source `ui`:

  | action | groups on the brief's key | groups that are truly identical | extra rows |
  |---|---:|---:|---:|
  | status_change | 8,728 | **0** | 0 |
  | link_set | 100 | **4** | 4 |
  | comment_add | 39 | **0** | 0 |
  | comment_delete | 38 | **0** | 0 |

- **Every multi-row `status_change` group has a different `component` on each
  row.** The most common shapes are card+caption (2,965 groups), all three
  deliverable parts together (about 3,160), card+video (1,370) and card+graphic
  (368). In some groups the parts move to different statuses (`to_status`
  differs), so they could not collapse into one row anyway.

## 1. Who writes `source = 'ui'`, and why one save makes several rows

| Writer | How it sets `source` | Rows per save |
|---|---|---|
| `calendar-card-write` (`logic.mjs` `buildEvents`, inserted in one batch by `index.ts` `insertEvents`) | `ledgerSource()`: anything except `linear`, `reconcile` or `auto-posted` becomes `ui` | One per changed fact: `create`/`archive`/card `status_change`; one `status_change` per moved component; one `approve_<comp>` per newly stamped client approval; `kasper_approve`/`finish`/`close`; `urgent_ping`; `link_set`/`link_clear` per link column; `comment_add`/`comment_delete` per component |
| `calendar-upsert` (`index.ts` `buildEvents`) | Same rule | Same rows (the card saver is a port of it) |
| `calendar-reorder` | From the request header | One per card moved |
| Database functions | Never `ui`. The native status projection writes `native-bridge`, the Kasper ping trigger writes `db`, and the backfill and repair functions write their own sources | n/a |
| Browser | Writes nothing directly. It sends `x-syncview-source`, `x-syncview-actor` and `x-syncview-role` to the functions above | n/a |

All rows from one save share the same `ts` (one `isoNow()`) and the same
`created_at` (one insert statement). Ids 31094–31096 are an example: one
`created_at`, one `ts`, and components null, video and caption.

### The only real duplicates: 4 `link_set` rows, 28 Aug to 1 Sep, none since

All 4 sit inside bursts of 10 or more `link_set` rows written to one card within
about half a second. Each pair has the same `ts` but a different `created_at`, 0.1
to 33 ms apart, so they came from **two separate requests**, not from one batch
written twice. Two link saves for the same change ran at the same moment. Each read
the card before the other wrote, so each logged the same change. That is a
read-then-write race between overlapping saves. It last happened on 1 Sep, it never
produced a duplicate `status_change` or approval, and it is 4 rows in about two
months.

## 2. Is the multi-row shape intentional? Yes. Readers depend on it

- **Kasper queue (`src/index/330-kasper-review-history.js.part`, `_kasperSentAtMs`)**
  reads `status_change` rows with `to_status = 'Kasper Approval'` **per
  component**. It uses a card-level row only when no part has one. If the
  component rows were collapsed into one, the "waiting since" time would break.
- **Kasper "moved without your decision" note (`_kasperFetchSkips`)** lists *which
  parts* moved (`comps`). That list comes from these same per-component rows.
- **Caption history (`caption-generate/history.mjs`)** reads `component = caption`
  rows only.
- **`calendar-auto-posted`** only asks whether *any* `status_change` row with a
  given source exists. Row counts do not matter to it.
- **Archived restore (`186-archived-restore`)** reads the `archive` row. A save
  writes exactly one of those.
- **Client review page:** it does not read this table.
- **Backup and digest tooling** (`b3_scoped_calendar_event_digest`, track-b
  backups) copies every row. Rows must stay as they are.

## 3. Who could double-count

No reader in the repo counts rows naively. The risk is in **ad-hoc counts**, such
as the supervisor's weekly approval count that filters `role in ('client','kasper')`.
Measured over the last 7 days:

| role | action | rows | distinct saves | distinct cards |
|---|---|---:|---:|---:|
| client | status_change | 282 | 167 | 124 |
| client | comment_add | 140 | 140 | 99 |
| client | approve_caption / video / graphic / title | 87 / 72 / 45 / 12 | same | 82 / 70 / 45 / 12 |
| kasper | kasper_approve | 115 | 115 | 105 |
| kasper | kasper_finish | 59 | 59 | 59 |
| kasper | status_change | 36 | 18 | 18 |

- **Counting every row with `role in ('client','kasper')` overstates approvals in
  two ways:**
  - It counts `status_change` once per component. The client figure is 1.7×
    (282 rows from 167 saves) and the Kasper figure is 2× (36 rows from 18 saves).
  - It counts comments and Kasper finishes as if they were approvals.
- **The approval actions themselves are clean:** for `approve_<comp>` and
  `kasper_approve`, rows equal distinct saves.
- **Correct counts:**
  - **Client approvals:** `action like 'approve\_%'`. Count rows for *part*
    approvals, or `count(distinct post_id)` for *cards*.
  - **Kasper approvals:** `action = 'kasper_approve'`.
  - **Status moves:** `count(distinct (post_id, ts))` for *saves*, or filter
    `component is null` for *card-level moves*.
- **"Last action" readers** are not affected: same-save rows share one `ts`, so the
  latest time is the same whichever row comes first.
- **Notifications** do not read this table.

## 4. Proposed fix (none applied)

1. **Writers: no change.** Do not dedupe at write and do not add a unique key on
   the brief's four columns. Either one would drop real per-component rows, and
   the Kasper queue and caption history depend on those rows.
2. **The 4 `link_set` duplicates: leave them.** The race has not repeated since 1
   Sep and costs nothing. If it ever matters, a partial unique index on
   `(post_id, ts, action, coalesce(component,''), md5(coalesce(payload::text,'')))
   where action in ('link_set','link_clear')` would block it. The `ts` values from
   the two requests would differ by milliseconds, though, so this is not a
   reliable guard. Not recommended.
3. **Readers that count:** use the definitions in section 3. The one known reader
   to change is the supervisor's weekly approval count. It lives outside the repo.
   It should count `approve_%` and `kasper_approve`, not every row with a client or
   Kasper role.
4. **Existing rows: no cleaning.** There is nothing to dedupe except 4 harmless
   rows, and the ledger is append-only history that backups and digests hash.

## How it was measured

These are read-only SQL queries on `public.calendar_post_events`, `source = 'ui'`,
`ts >= 2026-08-27`:

- The brief's key `(post_id, ts, action, role)` against the full key
  `(post_id, ts, action, role, actor, component, from_status, to_status, payload)`.
- The components in each multi-row group.
- The `created_at` gaps of the four exact pairs.
- `pg_proc` and `pg_trigger` for database writers.
- A 7-day role-by-action breakdown.
