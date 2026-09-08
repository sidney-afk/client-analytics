# B7 — capture the Linear label catalog before it is gone

**Status: SOURCE ONLY. The capture has NOT been taken. Nothing here has been
run against Linear or against the live database by any session.**

This is the one item in the Linear exit that cannot be done later. Everything
else in the programme can slip to the 14th and still be recoverable. This
cannot: it needs `api.linear.app` to answer, and after **2026-09-15** nothing
reproduces it.

---

## Why it exists

`migrations/2026-09-05-native-label-catalog-foundation.sql` and
`migrations/2026-09-06-native-label-writes.sql` give SyncView its own label
lane, so staff can still see and change labels after Linear is gone. Both are
inert until a row exists in `production_label_catalog_versions` carrying an
operator attestation, and the only door in is
`production_label_catalog_stage_attested(uuid, manifest, attestation)`.

Nothing in this repository produced that manifest before
`scripts/linear-label-catalog-export.js`. `git ls-tree -r 5bcc03bd7 | grep -i
label` returns migrations, docs, QA harnesses and tests — and no exporter.

If the capture is not taken by the 15th, labels are frozen at whatever the
database happens to hold, permanently, for every card on both teams.

---

## The two halves, and why their scopes differ

The owner ruled: export **"only on active cards"**. That ruling applies cleanly
to one half and not to the other, so the script does two different things.

### (a) The catalog itself — taken WHOLE

`production_label_catalog_check_manifest`
(`migrations/2026-09-05-native-label-catalog-foundation.sql:40`) validates a
**closed cursor chain**: every page must carry the previous page's `endCursor`,
exactly one page may say `hasNextPage: false`, cursors may not repeat, archived
entries are checked *before* applicability filtering, and the node count must
equal a declared `expected_count`. It refuses partial evidence by construction.
**A filtered catalog cannot satisfy its own manifest.**

Taking it whole is cheap: the checker itself bounds the capture at 50 pages ×
100 rows, 5000 rows and 5 MiB.

Archived and group entries are captured even though
`production_label_catalog_read_version` filters them back out when it serves a
team. They are evidence of completeness, not applicable labels — dropping them
is a `label_catalog_count_mismatch`, not a tidier manifest.

### (b) Per-card label state — ACTIVE cards only

This is `deliverables.linear_raw -> issue -> labels`, and it is where the
owner's ruling bites. The predicate, as the script issues it:

```sql
select d.id, d.client_slug, d.team, d.status, d.linear_issue_uuid,
       d.linear_raw -> 'issue' -> 'labels' as labels,
       d.linear_raw ->> 'archived'         as archived
  from public.deliverables d
 where d.status not in ('posted', 'canceled', 'duplicate')
   and d.linear_raw ->> 'archived' is null
 order by d.id;
```

"Active" is decided at the **deliverable**, not at the client. The three
excluded statuses are the terminal ones in the `deliverables` status check
(`migrations/2026-07-06-b1-linear-data-model.sql:38-41`); `archived` is the
marker `linear-inbound` stamps onto `linear_raw` at `index.ts:903`. A
client-level filter (`clients.active`, `clients.board_status`) was considered
and rejected: it would also drop in-flight cards belonging to a client whose
flag is stale, and the capture is cheap enough that the narrower filter buys
nothing.

**Run the script and it prints the row count. Record that number here and in
OPEN_REPAIRS 170 before you attest, because after the 15th the exclusion is
permanent and nobody will remember it was a choice.**

#### The part of (b) that is genuinely one-way

Most of half (b) is a snapshot of our own database, so it is not lost when
Linear lapses. One part of it is:

`production_labels_write`
(`migrations/2026-09-06-native-label-writes.sql:163-165`) raises
`native_label_state_incomplete` unless the stored relation has a `nodes` array
**and** `hasNextPage` exactly `false`. A card whose stored relation is
paginated, missing or malformed therefore **can never have its labels changed
on the native lane** — and the only repair is a re-read from Linear.

So the script classifies every active card as `complete` / `paginated` /
`missing` / `malformed`, and re-reads from Linear only the ones the native
writer would refuse. Those re-reads are in `active-card-label-state.json` as
`repaired_relation`. Applying them to `deliverables.linear_raw` is a separate
owner decision and is **not** part of this runbook — see OPEN_REPAIRS 170.

---

## THE COMMAND

From the repository root, with credentials supplied only through the approved
private secret mechanism:

- `LINEAR_API_KEY` (or `LINEAR_API_TOKEN`)
- `LINEAR_VIDEO_TEAM_ID`, `LINEAR_GRAPHICS_TEAM_ID`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — half (b) only; omit them and
  pass `--skip-card-state` to take the catalog alone

```powershell
node scripts/linear-label-catalog-export.js export --out=$env:USERPROFILE\.syncview\b7-label-capture
```

That is the whole deadline-bound step. It is **read-only**: it sends no
mutation to Linear and writes nothing to Postgres. It writes a private package
to `--out` and prints a receipt.

If PostgREST will not project the JSON path on your instance, run the SQL in
(b) above in the Supabase SQL editor, save the result as JSON, and pass
`--card-state-file=<that file>`. The catalog half is unaffected either way.

**The package is PRIVATE.** It contains workspace label names, client slugs and
card ids. Write it outside the repository. It is never committed, never pasted
into an issue, never attached to a PR.

### What "good" looks like

The receipt must say `RECONCILED`. The script walks the whole catalog twice at
two different page sizes and compares the id sets and every label's content. If
the two walks disagree, the workspace changed mid-capture, the cursor chain is
not a coherent snapshot, and the script exits non-zero and tells you to
re-capture. **Do not attest a package that did not reconcile.**

---

## What you are attesting to

`production_label_catalog_stage_attested` will not accept a manifest without an
operator attestation, and two of its fields are assertions **a human makes**,
not things SQL or this script can check
(`migrations/2026-09-06-native-label-writes.sql:11-13` says so in as many
words). Read `review-evidence.json` in the package, then satisfy yourself of
exactly these four things:

1. **`archived_pages_verified`** — the export really did include archived
   labels. The evidence file reports how many archived entries were captured;
   the query asked for `includeArchived: true`. If that count is zero, decide
   whether the workspace genuinely has no archived labels, or the flag did not
   take.
2. **`independent_count_reconciled`** — the two independent walks agreed. The
   evidence file reports both counts and any divergence.
3. **The team mapping is right** — `teams.video` and `teams.graphics` in the
   manifest are the two team ids you mean, and they are different. The script
   resolves both against the live workspace before it captures, so a wrong id
   fails early rather than producing a plausible-looking wrong manifest.
4. **The catalog is the WHOLE workspace** — a closed page chain proves internal
   structure, not that the provider returned everything. This is the judgement
   only you can make. The foundation migration's own header says the same.

Then, and only then:

```powershell
node scripts/linear-label-catalog-export.js attest `
  --package=$env:USERPROFILE\.syncview\b7-label-capture `
  --subject="<who reviewed it — a role or handle, not an email>" `
  --confirm=REVIEWED_COMPLETE_LINEAR_LABEL_EXPORT
```

The `--confirm` token is your assertion, not the script's. That is the whole
point of it.

This writes `3-stage-attested.sql` and `4-capability-flag.sql` into the
package. Still nothing has been sent to Postgres.

---

## The live actions, in order, each with its undo

These are for the owner. **No session runs any of them.**

| # | Action | Undo |
|---|---|---|
| 1 | Apply `migrations/2026-09-05-native-label-catalog-foundation.sql` | Both migrations seed `mode:provider` and refuse to serve until a version is activated, so installed-but-provider is a genuine no-op. Undo is dropping the new tables, functions and triggers while `production_label_catalog_versions` is still empty. |
| 2 | Apply `migrations/2026-09-06-native-label-writes.sql` (it alters the first's table) | Drop `zzz_native_label_receipt_guard` and `zzz_native_label_truncate_guard` on `mirror_outbox`, and the new RPCs. Once a native receipt exists in `mirror_outbox` it is retained by trigger and must not be deleted. |
| 3 | Run `3-stage-attested.sql`. **Require `ok: true` in the result.** | None needed and none possible: `production_label_catalog_versions` is immutable by trigger on update, delete and truncate. Staging a version changes no behaviour by itself. |
| 4 | Run `4-capability-flag.sql` | `mode:"hold"` — blocks new label writes with 503 `native_label_catalog_held` and keeps the gateway. `mode:"provider"` is *not* real containment: provider stops working the moment Linear dies. |

### ⚠ Step 4 does not guard itself

`production_label_catalog_capability()`
(`migrations/2026-09-06-native-label-writes.sql:57-72`) reads **only** the
`production_native_label_catalog` runtime flag. It never queries
`production_label_catalog_versions`.

Set that flag to `mode:"native"` with any well-formed UUID and capability
reports `native` with **no version staged**. The refusal lands one call later,
inside `production_label_catalog_read_attested`, as a 503. So the flag flip is
not self-guarding, and step 3 must be *observed to succeed* before step 4 is
run — the flag will not tell you.

The generated `4-capability-flag.sql` carries this warning in its own header,
and `test/native-label-catalog-export.js` fails if that warning is ever
removed, or if `capability()` ever starts reading the versions table without
this document being revisited.

---

## Rehearsing it offline

The whole pipeline runs with no credentials and no network against a recorded
fixture:

```
node scripts/linear-label-catalog-export.js export --out=/tmp/rehearsal --fixture=<fixture.json>
node scripts/linear-label-catalog-export.js attest --package=/tmp/rehearsal --subject=rehearsal --confirm=REVIEWED_COMPLETE_LINEAR_LABEL_EXPORT
node scripts/linear-label-catalog-export.js verify --package=/tmp/rehearsal
```

`test/native-label-catalog-export.js` builds such a fixture and drives all
three, and additionally re-reads every bound and every refusal string out of
the two migrations so the script's mirrors cannot drift from the SQL.

## Re-checking a package later

```
node scripts/linear-label-catalog-export.js verify --package=<dir>
```

Re-validates the manifest against the mirrored checker and re-derives
`source_sha256` from `raw-pages.ndjson`, so the package can be proven intact
without trusting the receipt.
