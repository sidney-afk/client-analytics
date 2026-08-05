# 2026-08-05 — The attribution stamp pollutes the soak signal

**Status:** BUILT in the reconciler. Nothing deployed. The `production-write`
change in §3 is committed but has no effect until the four-function lane is
dispatched, and the reconciler fix is deliberately independent of that deploy —
see §7 for what was built and where it deviates from the design below.

`outbound_diff_count` is the counter the owner would watch for two weeks to
decide whether the Graphics flip is safe. Today every row `production-write`
creates adds one permanent diff to it, on ordinary traffic, for reasons that
have nothing to do with drift. This document says why, what the correct fix is,
and — specifically — why the two obvious fixes are both wrong.

---

## 1. The mechanism

`compareAttribution` (`scripts/linear-deliverables-reconcile-lib.js`) compares
the attribution stamp **stored** on a row against one **recomputed** from
Linear, as a whole object:

```js
if (stableJson(current) !== stableJson(attribution)) {
  addReal(out, 'client_attribution', …, 'attribution_state_or_revision_mismatch');
}
```

The recomputed object (`f200-attribution.js`, `baseResult` + `resolvedResult`)
carries **12 keys**. `production-write` hand-builds **10**:

| key | reconciler computes | production-write writes |
|---|---|---|
| `schema`, `state`, `client_slug`, `owner_kind` | ✓ | ✓ |
| `source`, `project_id`, `direct_project_id` | ✓ | ✓ |
| `repair_required`, `reason` | ✓ | ✓ |
| `ancestor_issue_id` | ✓ (null for direct-project) | **absent** |
| `ancestor_distance` | ✓ (null for direct-project) | **absent** |
| `mapping_revision` | real roster hash | **`""`** |

Two independent guarantees of mismatch, on every created row, for a client
whose project is correctly mapped. Nothing is wrong with the row.

## 2. Why the obvious fix does not work

> "Make `production-write` write the full 12-key stamp the reconciler computes."

`mapping_revision` is not a property of the row. It is:

```js
mapping_revision: sha256({ schema, roster, entries })
```

— a hash over **the entire active client roster and every project→client
mapping**. It changes whenever any client is onboarded, offboarded, or has its
project ids edited.

So a writer that stamps the exact current revision produces a row that matches
**until the next client is added**, at which point *every stamp in the system*
goes stale simultaneously. That converts a steady per-row bug into a fleet-wide
one that fires in bursts correlated with business events — strictly worse
during a soak, because the noise would arrive exactly when someone is trying to
read the counter.

This is not hypothetical: it is the already-documented `inbound_diff_count`
situation, where 4,262 of 4,552 rows carry a stale stamp while naming the
correct client.

> "Widen the comparison so the diffs stop."

Rejected on the owner's own grounds: `client_attribution` is where a genuine
ownership error would surface. Dropping the comparison removes real detection
along with the noise.

## 3. The correct fix — separate the claim from its provenance

The stamp currently conflates two different things. Split them.

**The attribution claim** — what the row asserts about ownership:
`state`, `client_slug`, `owner_kind`, `source`, `project_id`,
`direct_project_id`, `ancestor_issue_id`, `ancestor_distance`,
`repair_required`, `reason`.
**Compare these strictly.** Any change here is real drift and must diff.

**The provenance** — `mapping_revision`. This records which roster version
produced the claim. It is a fact about the *computation*, not about the row.
**Do not diff on it.** Surface it as a separate non-gating counter, e.g.
`attribution_stamp_revision_stale`, so staleness stays visible and countable
without competing with drift.

### What this preserves

| scenario | still detected? |
|---|---|
| stamp says client A, recomputation says client B | **yes** — `client_slug` differs |
| `resolved` → `needs_attribution` | **yes** — `state` differs |
| ancestor path changes | **yes** — `ancestor_issue_id`/`_distance` differ |
| resolution source changes | **yes** — `source`/`reason` differ |
| row computed under an older roster hash | **no** — and it never should have been a diff |

### What the writer should still do

`production-write` should emit the **full key set**, with
`ancestor_issue_id: null` and `ancestor_distance: null` for direct-project
resolution. Those are not unknowable at create time — for `source:
'direct_project'` they are definitionally null. Only `mapping_revision` is
genuinely awkward for a writer to produce, and under this design it no longer
needs to be exact, because nothing gates on it.

## 4. Blast radius on the soak signal

Measured from drill runs `30961476712` / `30962249685`, per-fixture scoped:

| condition | diffs per created row | repairs |
|---|---:|---:|
| project mapped (e.g. `VID-13196`) | **1** (`client_attribution`) | 0 |
| project unmapped (e.g. `GRA-6982`) | **2** (+`client_slug` sentinel) | 1 |

**Direction: outbound.** `inbound_diff_count` was 0 on both teams;
`outbound_diff_count` carried all of them (video 3, graphics 6 at whole-client
scope). `compareAttribution` runs in both classifiers — the direction follows
team authority: `linear` → inbound, `syncview` → outbound. **The flip moves
teams to `syncview`, so rerouted clients' new rows land in
`outbound_diff_count`** — precisely the soak counter.

The scheduled reconcile is dry-run, so nothing heals these. The count is
therefore **monotonic: +1 outbound diff per created deliverable, permanently.**
A soak creating N deliverables a day raises the counter by N a day on healthy
traffic.

## 5. Which writers are affected

| writer | stamp | matches reconciler? |
|---|---|---|
| B1 incremental refresh | full f200 stamp via `withAttribution` | **yes** — same code path |
| `production-write` | hand-built 10-key, `mapping_revision: ""` | **no** — structurally, always |
| `deliverable-write` | none written | n/a — **preserves** existing `linear_raw` |
| `batch-write` | none written | n/a — **preserves** existing `linear_raw` |

`deliverable-write` and `batch-write` read `linear_raw`, mutate only archive
keys, and write it back (`_shared/b4-write.ts`), so they neither create nor
destroy a stamp. **Only `production-write` is a source of new pollution.**

## 6. Sequencing

The probe fix and the stamp fix should ship in **one** deploy of the same
four-function lane, not two. The lane's candidate fingerprints are pinned to
current `main` and verified before deployment, so the stamp fix must land on
`main` — and the pins updated — before the deploy is dispatched.

---

## 7. What was built, and where it differs from the design above

Three deliberate deviations. Each makes the change strictly safer than the
design as written; none of them widens the comparison.

### 7.1 Subtract one field, do not allowlist ten

§3 enumerates ten claim fields. Implementing that literally as an allowlist
would have been a silent loss of detection: the `conflict` and
`provisional_child_family` states add keys that are not in that list and that
absolutely do say who a row belongs to — `provisional_client_slug`,
`child_client_slugs`, `conflicting_parent_issue_id`, `mapped_client_slug`. An
allowlist stops comparing them.

The claim is therefore **every stamped field except `mapping_revision`**. That
is the only shape for which "removed the noise and nothing else" is a provable
statement rather than a hopeful one. `test/attribution-claim-provenance.js`
sabotages a provisional owner flip specifically to hold this line.

### 7.2 Absent and null are the same claim

`production-write` omits `ancestor_issue_id`/`ancestor_distance` where they are
definitionally null. A missing key and an explicit null are different JSON, so
without normalising them the comparison stays unsatisfiable **until the Edge
Function is deployed** — which would have made a soak-signal fix depend on an
owner-gated action that has not happened and may not happen soon.

Normalising `undefined` to `null` is not a widening: a value change is still a
change. `null` → a real ancestor id still diffs, which is the case §3's table
promises. There is a test for exactly that, because it is the one place this
normalisation could plausibly have hidden something.

The consequence is worth stating plainly: **the per-created-row diff count goes
to zero against the currently deployed function, with no deploy.**

### 7.3 Stale and unstamped are counted apart

`production-write` writes `mapping_revision: ""` by design (§2 — stamping the
live hash is worse, not better). If empty and stale shared one counter, the
writer's own rows would dominate it and a mapping that had genuinely gone stale
would be invisible inside the noise the counter exists to make visible.

- `attribution_stamp_revision_stale` — a real, non-empty, no-longer-current
  roster hash. **This is the one to watch.**
- `attribution_stamp_revision_unstamped` — the writer recorded no revision.

### 7.4 Where the counter is visible

Non-gating everywhere. It cannot fail a run, fire a page, or latch an incident.

| surface | what it shows |
|---|---|
| reconcile run summary | a banner stating the affected share of rows in words, above the metric table — not a row buried in twenty |
| metric table | both counters as their own rows |
| per-team table | a `Stale stamps` column |
| `deliverable_events` summary payload | both counters, so the trend is queryable |
| pager message body | `stale_stamp_context=` trend, as context |
| pager marker rows | `attribution_stamp_revision_stale_counts` |

It is deliberately **not** in `ALERT_CLASSES`. A counter that rises on every
client onboarding would latch the pager exactly the way `inbound_diff_count`
already did — that defect is documented in the pager's own header and repeating
it would be the whole mistake again in a new place.

### 7.5 What did not change

`production-write` still writes `mapping_revision: ""`. It now writes the full
key set with explicit nulls, which is correct but no longer load-bearing. That
change is inert until the four-function lane is dispatched.
