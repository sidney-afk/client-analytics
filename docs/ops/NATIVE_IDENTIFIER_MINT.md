# The native naming mint

**Status: SOURCE ONLY. `migrations/2026-09-07-native-identifier-mint.sql` has
not been applied to the live database and no team has been seeded.**

## What it is for

`deliverables.linear_identifier` is the human-readable name on a card —
`VID-13553`, `GRA-7197`. It has three writers and all three are Linear:

- `supabase/functions/linear-inbound/index.ts:810` refreshes it;
- `supabase/functions/linear-outbound/index.ts:852` and `:868` **mint** it for
  SyncView-native cards. `production-write` writes `identifier: null` and only
  ever copies an existing value through (`index.ts:1576`); the row goes to
  `mirror_outbox`, the outbound worker creates the Linear issue, and the minted
  name comes back through `production_issue_create_linkage` and
  `deliverable_write`.

`index.html:51816` resolves `displayId: linear_identifier || identifier || id`,
so a card created with no mint displays as its raw row id (`b1_d_188ba4ad…`) in
the Production list, the command palette, the Workload loose-strip header and
every deep link the three PRs in OPEN_REPAIRS 163 just built. Nothing errors.
The estate simply stops producing names.

**The deadline is not 2026-09-15.** It is the moment `linear_outbound_enabled`
is set to `{"mode":"off"}` — earlier, and under our own hand. Lane F's
outbound-off step is gated on this.

## Where it lives, and why it is a trigger

`zzz_production_native_identifier_mint`, a `before insert or update` trigger on
`public.deliverables`.

Both provider mint sites write the column through RPCs that update that table,
and so does every native creation path — `production-write`, `batch-write`, the
intake RPCs. A trigger on the table covers all of them at once. The alternative,
a change inside `production_intake_append` or `production_deliverable_write`,
would collide with the composed intake artifact that lane B's other work items
install, and would still miss whichever path nobody thought of. This migration
replaces no existing function.

## Why native ordinals start high

Native names keep the provider's shape, so they share a namespace with every
name Linear already minted. `production_native_identifier_seed` reads what the
provider actually minted for that team, derives the prefix from it, and sets the
cursor to `observed_provider_max + gap + 1` (gap defaults to 100000). Native
allocations therefore sit in a band the provider cannot reach before the cutoff.

The prefix is **derived, never configured**. If a team's existing names use two
different prefixes the seed refuses (`native_identifier_prefix_ambiguous`)
rather than guessing which one a human reads — the failure mode OPEN_REPAIRS 161
was about.

The allocator also checks each candidate against `deliverables` and against its
own grant table and steps forward on a hit, so the gap is a convenience rather
than the thing correctness rests on.

## Two properties worth stating explicitly

**The capability self-guards.** `production_native_identifier_capability(team)`
returns `native` only when the flag says native **and** a seed row for that team
exists. This is deliberately unlike
`production_label_catalog_capability()`, which reads only its flag and reports
`native` with nothing staged, 503-ing one call later (OPEN_REPAIRS 165.6). A
premature flip here is inert, not half-armed.

**Name stability is not flag-gated.** Once a row carries a name from
`production_native_identifier_grants`, a later write that would replace it —
outbound minting, or inbound refreshing — keeps the native name and records the
provider name it refused. That branch runs whatever the flag says, because
allocation is a policy choice and a published name changing under a reader is
not. Flipping back to `provider` stops minting; it cannot rename existing cards.

Provider-named rows are **not** protected, so `linear-inbound:810` keeps
refreshing them normally while Linear is still connected.

## Live actions, in order, each with its undo

**No session runs any of these.**

| # | Action | Undo |
|---|---|---|
| 1 | Apply `migrations/2026-09-07-native-identifier-mint.sql` | It is inert on install — both teams seed `provider` and allocation is refused without a seed row. Undo while `production_native_identifier_grants` is empty: drop the trigger, the four functions and the two tables, and delete the flag row. |
| 2 | `select public.production_native_identifier_seed('video');` — record the returned `prefix`, `observed_provider_max` and `next_ordinal` | `delete from public.production_native_identifier_mint where team='video';` — safe **only** while no name has been handed out for that team. Once one has, deleting the cursor and re-seeding re-issues names. |
| 3 | Same for `'graphics'` | Same. |
| 4 | Flip `syncview_runtime_flags.production_native_identifier_mint` to `{"schema_version":1,"video":{"mode":"native"},"graphics":{"mode":"native"}}` | Set the team back to `{"mode":"provider"}`. Stops new minting immediately; renames nothing, by design. |

Step 4 is what lane F's outbound-off step waits on. Do it per team, video first,
and create one post on the test client `sidneylaruel` to confirm the name before
the second team.

### Before step 2, on the live database

The seed derives everything from live data, so read it first and keep the
numbers:

```sql
select team,
       count(*) filter (where linear_identifier ~ '^[A-Z][A-Z0-9]{1,9}-[0-9]{1,9}$') as named,
       count(distinct substring(linear_identifier from '^([A-Z][A-Z0-9]{1,9})-[0-9]{1,9}$')) as prefixes,
       max(substring(linear_identifier from '^[A-Z][A-Z0-9]{1,9}-([0-9]{1,9})$')::bigint) as max_ordinal
  from public.deliverables
 group by team;
```

If `prefixes` is anything but 1 for a team, the seed will refuse and the choice
of prefix becomes an owner decision.

## Proof

- `test/native-identifier-mint.js` — offline contracts: additive-only DDL, the
  inert seed, the self-guarding capability, unflagged name stability, the row
  lock, the derived prefix, the grants, and that `index.html`'s `displayId`
  still prefers `linear_identifier` so the mint is actually visible.
- `qa/native-identifier-mint/sql-proof.js` — the behaviour, against a disposable
  PostgreSQL 16: 17 cases covering the no-op install, seeding, the half-armed
  flip, minting, collision step-over, 25 concurrent allocations, the provider
  write-back, the undo, and the two refusals. Run it with
  `F63_REQUIRE_POSTGRES=1` and a disposable cluster; `test/native-identifier-mint.js`
  invokes it when that is set.

## Still open

Whether native naming covers every surface that shows a name. `displayId` is one
resolution point and it is the one the Production list, the command palette and
the deep links go through — but Slack alert text and the Workload row header
were not walked. OPEN_REPAIRS 162 raised that question and it is still open.
