# 2026-08-05 — Every path that creates a deliverable, and whether it stamps

**Status:** enumeration only. Nothing changed, nothing deployed.

Written because the same mistake happened three times in one day: **read one
path, generalise to the whole.**

| # | the claim | what was read | what was actually true |
|---|---|---|---|
| 1 | "the deployed `production-write` writes a ten-key stamp" | the repository source | the deployed version was older and wrote none |
| 2 | "a real client is missing a team's project id" | one counter, unsplit | the only affected row was `kind: test` |
| 3 | "`production-write` stamps created rows" | `handleProductionCreate` | the drill uses `handleIntakeCreate`, which does not |

Each reading was correct. Each generalisation was not. The rule that follows:
**before claiming what a function does, state which path was read and which
paths exist.** This document is that statement for attribution stamping.

---

## 1. Create operations in `production-write`

The router accepts exactly two creating operations (`assertSurfaceOperation`,
lines 1004–1013). There is no third — every other operation mutates a row that
already exists.

| operation | surfaces | handler | writes `linear_raw` at create? | stamps? |
|---|---|---|---|---|
| `create` | `production` | `handleProductionCreate` (2821) | **yes** — `linear_raw: { issue, attribution }` (2975) | **YES** |
| `intake_create` | `submission`, `calendar` | `handleIntakeCreate` (4137) | **no** — row (4343–4362) has no `linear_raw` key at all | **N/A — nothing to stamp** |

`intake_create` is not "failing to stamp". It creates a purely native row with
**no Linear issue yet**, so there is no `linear_raw` to put a stamp in. The
Linear issue is created later, by the outbound drain.

**The drill uses `intake_create`** (`scripts/production-write-drill.js:301`).
That is how this was found and how it is verified — by reading the operation
the drill actually sends, not by inferring from the function's name.

## 2. Where an intake row's `linear_raw` actually comes from

`linear-outbound`, when it drains the create intent:

```ts
linear_raw: { ...raw, issue: completeIssue },   // linear-outbound/index.ts:770
```

`raw` is `{}` for an intake row, so the result is `{ issue }` — **no
attribution**. The string `attribution` appears **zero** times in the whole of
`linear-outbound`.

There is a second linkage branch above it (`production_issue_create_linkage`,
line 734). It is **not** this path: the RPC raises
`production_create_linkage_conflict` unless `linear_raw->'issue'` is *already*
an object (`migrations/2026-07-23-f203-production-issue-create.sql:553`), so it
serves rows that were created with a stamp — the native path.

**So the writer that first gives an intake row its `linear_raw` is
`linear-outbound`, and it does not stamp.** A fix aimed at
`production-write`'s intake path would have been aimed at the wrong function.

## 3. Full inventory

| writer | creates rows? | stamps? |
|---|---|---|
| `production-write` `create` | yes | **yes** |
| `production-write` `intake_create` | yes | no `linear_raw` written |
| `linear-outbound` create linkage (`deliverable_write`) | no — links | **no** — writes `linear_raw.issue` only |
| `linear-outbound` `production_issue_create_linkage` | no — links | n/a — requires an existing stamped raw |
| B1 backfill create (`b1-linear-backfill.js:729`) | yes | **yes** — `withAttribution` |
| B1 incremental refresh (`:1034`) | no — updates | **yes** — `withAttribution` |
| `deliverable-write` / `batch-write` | no | preserves existing `linear_raw` |

Both of B1's `linear_raw` writes go through `withAttribution`; an exhaustive
grep finds only those two sites.

## 4. How long an unstamped row stays unstamped

**Not permanent — bounded by one B1 incremental cycle.**

B1's incremental refresh writes when a field differs, and `linear_raw` will
differ (its version carries `attribution` and an `incremental_refresh` key; the
stored one carries only `issue`). The lane's staleness budget is 240 minutes.

The empirical support is the estate itself: 4,262 of 4,552 rows carry a *stale*
stamp — meaning they **have** stamps. If neither the intake path nor the
outbound linkage ever stamped, and nothing else did, those rows would have no
stamp at all. Something stamps them, and B1 is the only writer that can.

This matters for how the soak counter should be read. An intake-created row
diffs for **up to one B1 cycle**, not forever. That is real pollution and worth
fixing — a soak that creates rows through the submit flow will show a rolling
population of unstamped rows — but it decays rather than accumulating
monotonically, which is a different shape from what §4 of the soak-signal audit
describes for the native create path.

**Not yet verified:** that B1's incremental selection includes these issues in
practice, on live data. The reasoning above is from source plus the estate-wide
stamp population; it has not been watched happening to a specific row. Stated as
a bounded claim, not a measurement.

## 5. What a fix would have to touch

`linear-outbound`'s create linkage, not `production-write`'s intake path — it is
the writer that first materialises `linear_raw` for an intake row, and it is the
only place where the Linear issue and the client roster are both in hand.

That is a **different Edge Function** from the one deployed on 2026-08-05, and
it is one of the four the Section 4 lane already covers.
