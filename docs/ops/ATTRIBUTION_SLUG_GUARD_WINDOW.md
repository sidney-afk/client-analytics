# Attribution slug guard — owner-gated apply window

**Status: APPLIED 2026-08-23** by the owner in the Supabase SQL editor, pinned to
`8887d2a0`. One transaction, committed clean; the assertion at its end read 0
offending roster slugs. Every readback in §3 passed and is repeated in §3a with
the post-apply numbers. Receipt in `EXECUTION_LOG.md`.

**Scope:** one read-path defect, in two halves.

1. **Database (this window).** `production_deliverables_browser_v1` sanitises
   `raw_attribution_client_slug` behind a hand-written character class and
   returns NULL when a real roster slug fails it. Exactly one ACTIVE roster slug
   does, and 147 deliverables reach the browser with
   `raw_attribution_state = 'resolved'` and no slug.
2. **Browser (already merged, no window needed).** `_prodResolveAttributions`
   read that absence as a *disagreement* and stamped
   `persisted_resolved_client_disagrees_with_current_mapping`, which the family
   fixpoint then propagated to every relative as
   `hierarchy_conflict_propagated`. 147 of the 176 "Client attribution conflict"
   banners in the app were this. Those rows were read-only and mis-grouped.

The browser half now fails soft on its own: an absent persisted slug falls
through to the freshly computed mapping and says
`persisted_client_slug_unavailable_in_read_path`. **So the banners are already
gone without this migration.** What the migration adds is the truth underneath —
the rows carry their slug again, and the next projection column somebody tightens
cannot silently drop a roster value.

**Companion documents:** `migrations/2026-08-23-attribution-slug-guard-widening.sql`
(the SQL), `ROLLBACK.md` (this row), `test/attribution-absent-slug-not-conflict.js`
(the browser half, executed not scanned).

---

## 1. What changes

| Artifact | Change | Goes live when |
|---|---|---|
| `public.production_deliverables_browser_v1` | Two character classes gain `&`: `raw_attribution_client_slug` and `raw_attribution_provisional_client_slug`. Nothing else moves. | The owner runs the migration |
| Browser attribution resolver | Absent persisted slug ≠ disagreement | Already merged; live at next deploy |

`&` is the minimal widening. Of the 38 active roster slugs, exactly one fails the
current guard and it fails on `&` alone. No roster slug contains `.`, so the
class is not widened to admit one.

## 2. How to apply

Paste `migrations/2026-08-23-attribution-slug-guard-widening.sql` into the
Supabase SQL editor and run it. It is one transaction. The body of the view is
`pg_get_viewdef` of the LIVE view as of 2026-08-23 with two string literals
changed, so a diff against what is running is two lines.

The transaction ends with an assertion that **fails the whole migration** if any
active roster slug still fails the widened guard. That check reads live client
rows, which is why it lives in the SQL and not in a repository test: this is a
public repo and no roster slug belongs in it.

Re-running it is a no-op. Nothing else in the file writes a row.

## 3. What has already been proved, and how

Taken 2026-08-23 against the live database with **zero permanent change**: the
new body was instantiated as a TEMPORARY view — which dies with the session —
and compared row-for-row against the live view in the same query.

| Measure | Live view | Widened body |
|---|---:|---:|
| Rows | 5,316 | 5,316 |
| `resolved` rows with no slug | **147** | **0** |
| Columns | 46 | 46 |

Symmetric difference (`EXCEPT ALL` in both directions): **294 rows**, which is
the same 147 rows counted once per direction. That is the entire blast radius —
147 rows change, in one column, and every other row and column in the view comes
back byte-identical.

## 3a. What the apply actually produced

Five independent readbacks, taken immediately after the commit:

| check | before | after |
|---|---:|---:|
| `resolved` rows with no slug | 147 | **0** |
| total rows | 5,316 | 5,316 |
| columns | 46 | 46 |
| `security_barrier` | true | true |
| `anon` / `authenticated` SELECT | both | both |

And the same fact from the other direction: **147** rows now carry a slug that
the OLD guard would have rejected. Same population, arriving as a positive
count rather than as an absence — which is the reading that would have caught
this in the first place.

## 4. Rollback

Re-run the view body with the original class `^[a-z0-9][a-z0-9_-]{0,99}$` in both
guards; the pre-change definition is `migrations/2026-07-25-slice5-production-read-path.sql`.
Read-path only: no table is touched, no row is written, no flag or authority
value moves, and the browser half is safe either way — it treats an absent slug
as missing evidence regardless of which guard is installed.

## 5. What this does NOT fix

The other 29 conflicts are real and are data decisions, not code:

- **28 cross-client families.** A parent in one client's Linear project with
  sub-issues sitting in a different active client's project. One family, two
  clients — the banner is TRUE. Three families are affected. Fixing them means
  moving the sub-issues, detaching them, or merging two roster rows if they are
  the same account in reality. Note that moving them in Linear alone does **not**
  clear the banner on a Linear-authoritative team: a moved issue is stamped
  `needs_attribution` with its slug cleared, and something must then re-derive
  and persist the resolution.
- **1 stale invalidation.** A single graphics row carries a
  `project_or_parent_changed_reconcile_required` stamp that nothing re-derives,
  because graphics is SyncView-authoritative. It should read as a repair, not a
  conflict.
