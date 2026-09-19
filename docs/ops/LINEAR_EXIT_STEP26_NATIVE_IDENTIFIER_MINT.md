# Step 26/27 — native identifier mint

Execution map phase 7, for the **one** capability
`production_native_identifier_mint`.

Steps 26/27/28 are the per-capability triple the execution map repeats — the
map's own status line reads *"next: the next capability's step 26"* — so this
file does not collide with
[step 26/27 for native labels](LINEAR_EXIT_STEP26_NATIVE_LABELS.md). That file
is this one's worked precedent and every shape below is borrowed from it.

> **Status, 2026-09-19: the three owner decisions are taken and execution has
> started elsewhere.** B-2 → **shape (ii)**, hand-seed graphics from `GRA`'s own
> maximum. B-3 → **accepted**, the first flip is estate-wide for its team. B-4 →
> **yes**, name the existing rows. Steps 0 and 5 to 11 of the order-of-operations
> table are being run by the **storage session**; steps 1 and 12 were done from
> this repository. **No result of that run is recorded in this file** — nothing
> below has been amended to claim an outcome, and the step 27 table is still
> entirely unmeasured.

**Written as scoping, and still only scoping.** Everything marked *measured* is
a read-only `select` issued against the live database on **2026-09-19**;
everything else is a reading of committed source. From this repository: no SQL
was written, no flag was moved, no function was deployed.

Companion documents:
[`NATIVE_IDENTIFIER_MINT.md`](NATIVE_IDENTIFIER_MINT.md) is what the source does
and why it is a trigger — still correct on mechanism, **wrong on status**, see
B-1. `migrations/2026-09-07-native-identifier-mint.sql` is the source itself and
its header comment is the best single account of the problem.

---

## What the capability is for, in one paragraph

`deliverables.linear_identifier` is the short human name on a card — `VID-13553`,
`GRA-7197`. Every writer of it today is Linear: `linear-inbound` refreshes it,
and `linear-outbound` **mints** it for cards SyncView created. `production-write`
writes `identifier: null` and never mints. So a card created after outbound goes
off has no short name, and `index.html`'s `_prodAdapter` — which resolves
`displayId: linear_identifier || identifier || id` — falls through to the
40-character row id. Nothing errors; the estate just stops producing names.
**#1419 shipped the stopgap**: `.prod-id` clips the cell and `_prodIssueIdHTML`
puts the full value on the hover, with a comment in the source saying in as many
words that the proper fix is this capability. This step is that fix.

---

## Read this before anything else: five blockers

Four of these are not "do it carefully" cautions. They are reasons the step
cannot complete as written, and three of them are not written down anywhere else
in this repository.

| | Blocker | Shape |
|---|---|---|
| **B-1** | The repository says the migration is not applied. **It is applied.** | stale record |
| **B-2** | `graphics` **cannot be seeded** — two prefixes, the seed refuses | owner decision |
| **B-3** | There is no test-client rehearsal, because the flag is per *team*, not per client | owner decision |
| **B-4** | Flipping the flag names **no existing card** — the 45 already-nameless rows stay nameless | missing backfill |
| **B-5** | Outbound is `live` but native intake already suppresses the drain for most new cards, so the provider write-back the checks assume **may never happen** | conditional check |

### B-1. `NATIVE_IDENTIFIER_MINT.md` says SOURCE ONLY. It is installed.

That document opens: *"Status: SOURCE ONLY.
`migrations/2026-09-07-native-identifier-mint.sql` has not been applied to the
live database and no team has been seeded."* The execution map's phase 7 table
says **code installed but not wired**.

Measured live, 2026-09-19:

| | measured |
|---|---|
| `production_native_identifier_capability(text)` | present |
| `production_native_identifier_seed(text, bigint)` | present |
| `production_native_identifier_allocate(text, text)` | present |
| `production_native_identifier_guard()` | present |
| trigger `zzz_production_native_identifier_mint` on `deliverables` | present |
| flag `production_native_identifier_mint` | present — `{"schema_version":1,"video":{"mode":"provider"},"graphics":{"mode":"provider"}}`, `updated_by: native-identifier-mint`, `updated_at` **2026-09-17T16:14:54Z** |
| `production_native_identifier_mint` (seed rows) | **0** |
| `production_native_identifier_grants` | **0** |

Grants read back exactly as the migration writes them, with nothing left behind
by Supabase's default-grant behaviour: the two tables carry `postgres` only —
no `anon`, no `authenticated`, no `service_role`; `capability` and `seed` carry
`service_role` EXECUTE; `allocate` and `guard` carry **none**, which is correct,
because only the trigger calls them and it calls them as definer. This capability
owns no sequence, so the sequence half of the standing grant trap does not apply
to it.

**The installed bodies were then compared, not assumed.** An earlier revision of
this file said the migration was installed "verbatim" on the strength of the
table above, and a review was right that counting four names and a trigger says
nothing about what those four routines contain — a drifted body would install
under the same name and flipping the flag would activate it. The comparison now
exists. `md5(prosrc)` for each live routine against the body extracted from
`migrations/2026-09-07-native-identifier-mint.sql` between its `$fn$` markers:

| routine | md5 | match |
|---|---|---|
| `production_native_identifier_capability` | `62285d09…` | ✅ |
| `production_native_identifier_seed` | `e75108f9…` | ✅ |
| `production_native_identifier_allocate` | `16349cc5…` | ✅ |
| `production_native_identifier_guard` | `79ce1fde…` | ✅ |

All four also read back `security definer`, `volatile`, and
`search_path=pg_catalog, public`, which are the three properties the body hash
alone would not catch if the routine had been re-created with different options.
And `pg_get_triggerdef` returns
`CREATE TRIGGER zzz_production_native_identifier_mint BEFORE INSERT OR UPDATE ON
public.deliverables FOR EACH ROW EXECUTE FUNCTION
production_native_identifier_guard()` — the migration's statement exactly. The
`zzz_` prefix is load-bearing and now measured: `deliverables` carries eight
triggers and PostgreSQL fires them in name order, so the mint runs **last** among
the BEFORE triggers, after the application-DML admission guard and the label seed.

*Worth keeping as a rule: **existence is not equality.** A name-and-count query
answers "is something installed", never "is the right thing installed", and the
gap between those two questions is exactly where a drifted body lives.*

**So step 26's action 1 is already done, and the half-done state is exactly the
state the design calls inert.** Flag at `provider`, no seed row — the capability
self-guards on both, so nothing mints.

*This is the same failure the labels file recorded as B-1 and it is the second
instance in eight days.* A status line written in advance was read back as a
measurement, by this session too, until it ran the query. The general form is
already in the record: **a status line in a document is a claim until something
measures it.** The narrower lesson this instance adds: the execution map's own
"code installed but not wired" vocabulary has no cell for *applied to the
database but not called from code*, and the mint is precisely that — so the map
recorded the half it could see from the repository and the other half went
unstated. Part of this step is fixing both documents.

### B-2. `graphics` cannot be seeded — the seed will refuse, and the ordinal is contaminated too

`production_native_identifier_seed` derives the prefix from what the provider
actually minted for that team, and **refuses with
`native_identifier_prefix_ambiguous` when a team shows more than one**, rather
than guessing which name a human reads. Measured live, 2026-09-19:

| team | rows | named | distinct prefixes | prefix breakdown |
|---|---|---|---|---|
| video | 3,975 | 3,951 | **1** | `VID` ×3,951, max ordinal **13,935** |
| graphics | 2,694 | 2,673 | **2** | `GRA` ×2,661, max ordinal **7,559** · `VID` ×12, max ordinal **12,851** |

So **video seeds cleanly and graphics does not.** The twelve rows are graphics
rows whose `linear_identifier` is still a `VID-` name; all twelve carry a
provider issue uuid, ten are in a terminal status, the oldest was created
2026-02-27 and the newest row-update among them is 2026-09-07.

**They are not the cohort the team-move repair fixed.** That repair
(`2026-09-07-deliverable-identifier-team-move-repair.sql`) corrected the stale
`identifier` *snapshot* against the maintained `linear_identifier` column, and it
has been applied — measured live, **zero** rows now disagree between the two
columns. These twelve disagree between our `team` column and the team encoded in
the provider name, which that repair never touched and was never about.

**And the second half of this blocker is quieter than the first.** The seed
computes `max(ordinal)` over every matching row on the team, so for graphics that
is **12,851 — a VID ordinal** — while `GRA`'s true maximum is 7,559. The refusal
fires first and hides it. A hand-fix that resolves only the prefix (for example
by excluding the twelve from the derivation) and then re-reads the number from
the same query would seed the graphics cursor from the video namespace. It would
not collide — the gap is larger, not smaller, and the allocator steps over a
collision anyway — but it would be a wrong number nobody would have a reason to
look at again.

**⚠ The obvious resolution does not work, and an earlier revision of this file
offered it.** That revision proposed re-keying the twelve in
`deliverables.linear_identifier` so graphics would show one prefix, on the model
of the team-move repair. **It is not durable, and a review was right to refuse
it.** All twelve rows carry a provider issue uuid, `linear-inbound` resolves a
row by that uuid **before** it looks at the name, and at `:810` it then writes
`row.linear_identifier` from the issue. The trigger's UPDATE branch would not
stop it: that branch protects a name only when a matching row exists in
`production_native_identifier_grants`, and these twelve have none — it reaches
`if not found then return new` and lets the write through. So the next webhook
touching any of them puts the `VID` name back, and the prefix ambiguity returns
**after** seeding, when the cursor has already been derived. The "retired" name
would also not have been retired anywhere except in our own column; the provider
still calls the issue what it calls it.

**So the two honest shapes are:**

- **(i)** Fix the underlying disagreement rather than the symptom: these rows are
  filed under graphics in SyncView and under the video team at the provider.
  Either move them at the provider so its name re-keys on its own — the mechanism
  the team-move repair documents — or correct our `team` column if the provider
  is right. Then the seed derives one prefix honestly, with nothing to overwrite.
- **(ii)** Seed graphics by hand and say so. `production_native_identifier_seed`
  takes only a team and a gap, so this means a direct insert into
  `production_native_identifier_mint` with `prefix='GRA'` and
  `next_ordinal = 7559 + gap + 1` — **7,559, GRA's own maximum, not the 12,851
  the function would have derived** — recording in the go-ahead that the
  derivation was overridden and why.

Shape (ii) is the safer of the two while Linear is still connected, because it
touches no row a webhook can reach. Shape (i) is the one that leaves the estate
consistent afterwards. Ten of the twelve are in a terminal status, which is worth
weighing: it lowers the odds of a webhook touching them, and it lowers the value
of fixing them.

Do **not** resolve it by widening the seed function to pick a winner. Refusing to
guess which prefix a human reads is the whole point of that branch.

### B-3. There is no test-client rehearsal, because the flag is per team

The label lane's equivalent blocker was that the lane *refused* the test client.
This lane has the opposite shape and it is not obviously better.

The mint is a `before insert or update` trigger on `deliverables`. It has no
principal, no role gate and no `test_only` notion at all, so a card created for
the test client `sidneylaruel` exercises it exactly like any other card — there
is nothing to rehearse *around*. **But the flag is keyed by team, not by client.**
The moment `video` goes to `native`, the next video card created **for any
client** is minted natively. There is no arrangement of this flag under which the
test client goes first and everyone else follows.

So the standing constraint *"mutate only the test client `sidneylaruel`"* cannot
be honoured by scoping the flip. What can be honoured is ordering and timing:
flip **video only**, create the first card on `sidneylaruel`, measure, and only
then decide about graphics. The window in which a real client could get the first
native name is whatever time passes between the flip and that first test card,
and it is the owner's to accept or to shrink by picking a quiet moment. Name that
acceptance in the go-ahead; do not let it be implied by the flip.

### B-4. Flipping the flag names no card that already exists

The trigger's INSERT branch mints only when `linear_identifier` arrives empty.
Its UPDATE branch exists solely to *protect* a name already handed out. **Neither
one names a row that already exists without one**, and no backfill exists
anywhere in the repository.

Measured live, 2026-09-19 — rows carrying neither identifier column:

| team | nameless | created since 2026-09-01 | carrying a provider issue uuid |
|---|---|---|---|
| video | 24 | 22 | 0 |
| graphics | 21 | 20 | 0 |

Forty-five rows, forty-two of them from this month, none of them with a provider
issue behind them. **These are exactly the rows #1419's truncation was shipped
for**, and turning this capability on leaves every one of them showing a clipped
raw id for ever.

**And the cohort is growing, fast, for a reason that is measurable.** Thirty-six
of the forty-five were created on a single day, 2026-09-18 — the day after native
intake went live (see B-5). Of the fifty-one cards created since that flag
landed, **thirty-six are nameless and fifteen reached Linear**. This is not a
historical backlog settling; it is the current rate. Whatever the decision is, it
gets more expensive daily.

Naming them is a separate, deliberate operation, and it is a prerequisite
*decision* of step 26, not a step 27 check. It has the same shape as the calendar
bridge's never-run backfill, which is the reason it is called out here rather
than discovered afterwards: a trigger fixes the future and says nothing about the
past.

**⚠ How the backfill must be written, because the obvious form is wrong.** An
earlier revision of this file described it as "a one-time call of
`production_native_identifier_allocate` per row", and a review was right that
this does nothing. `allocate` advances the cursor, inserts a grant row, and
**returns** the identifier — it never touches `deliverables`. Calling it in a
loop would leave all forty-five rows exactly as nameless as they started while
creating forty-five orphan grants, and because `production_native_identifier_grants`
has a primary key on `identifier` and only a plain index on `deliverable_id`,
**a retry would hand the same deliverable a second name** with nothing to stop
it. The backfill must therefore:

- **assign** the returned value — `update public.deliverables set linear_identifier
  = public.production_native_identifier_allocate(team, id) where …`, one
  statement, one transaction, per team;
- **verify one-to-one afterwards**: every targeted row now has a name, and
  `count(*) = count(distinct deliverable_id)` over the grants created in that
  window. Not "the statement succeeded";
- **be written to be safely re-runnable**, by selecting only rows that are still
  nameless, so a partial run does not double-allocate on the retry.

The trigger does not fight this: its UPDATE branch returns immediately when the
old `linear_identifier` is empty, which for every row in this cohort it is. The
INSERT branch is not involved at all.

It is also the one place in this capability where anything calls `allocate`
directly, and `allocate` is granted to **nobody** — so the backfill runs as the
database owner in the SQL editor, not as `service_role` from a script, or the
grant has to widen. Widening it is the worse option: nothing else needs it, and
it is the only thing standing between a script and the cursor.

### B-5. Outbound is live, but native intake already stops most cards reaching Linear

Measured live: `linear_outbound_enabled` is `{"mode":"live"}` — **and
`native_intake_epochs` is `enabled: true` for both teams**, since
2026-09-18T00:16Z.

Those two facts together are the blocker, and an earlier revision of this file
had only the first. It reasoned that a minted card would go to `mirror_outbox`,
the outbound worker would create the Linear issue, Linear would name it, the
write-back would be refused by the trigger's UPDATE branch and recorded in
`provider_identifier_refused` — so every minted card would carry two names for
the length of the window.

**For a card created through normal intake, none of that happens.**
`providerDrainPlans` in `production-write` reads each plan's `mirror_outbox`
receipt and **filters out every plan whose payload carries
`_native_intake_epoch`** before any Linear drain. With native intake enabled, a
Create Post card is stamped with that epoch, so it never drains, never gets a
Linear issue, and never has a provider name to refuse.

The measurement says both paths are live at once. Of the fifty-one cards created
since native intake landed: **thirty-six never reached Linear** (no issue uuid,
no name — B-4's cohort) and **fifteen did**.

**So there are two cases and the procedure has to name which one it is in:**

- **Native-intake card (the common case today).** No provider write-back ever
  arrives. There is no divergence, no `provider_identifier_refused` row, and
  nothing to wait for. The mint is the *only* namer.
- **Card that still drains.** The original reasoning holds exactly: two names for
  the length of the window, survivable because `linear-inbound`'s
  `readDeliverableForIssue` resolves by `linear_issue_uuid` **first** and outbound
  stamps that uuid on the same write that carries the name. The identifier lookup
  is its second fallback and is the part that goes stale, along with anything
  else joining cards on the name rather than the uuid.

**This is why check 5 below is conditional rather than required.** Written as an
unconditional "wait for the write-back and confirm it was refused", it would wait
for evidence that cannot exist on the common path and read a working mint as a
failure. Gate 0 must read the intake epoch state so the session knows which case
the test card is in *before* it starts waiting.

The clean sequence is still **mint first, outbound off second** — which is what
lane F says from the other direction: its outbound-off step is gated on this
capability landing. The window is not avoidable, only short, and for most cards
it is already closed.

---

## Gate 0 — read the live state before anything else (session, read-only, ~1 minute)

Free, read-only, and it is what turned three of the five blockers above from
reasoning into measurement. Run it again in the session that acts; the numbers
below are from 2026-09-19 and every one of them can move.

```sql
-- 1. Is it installed, and what do the flags actually say?
--    `native_intake_epochs` is here because B-5 turns on it, not on outbound alone.
select (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname like 'production_native_identifier%') as functions,
       (select count(*) from pg_trigger
         where tgname = 'zzz_production_native_identifier_mint' and not tgisinternal) as trigger,
       (select count(*) from public.production_native_identifier_mint) as seed_rows,
       (select count(*) from public.production_native_identifier_grants) as grants,
       (select value from public.syncview_runtime_flags
         where key = 'production_native_identifier_mint') as flag,
       (select value from public.syncview_runtime_flags
         where key = 'linear_outbound_enabled') as outbound,
       (select value from public.syncview_runtime_flags
         where key = 'native_intake_epochs') as intake;

-- 1b. Are the installed BODIES the reviewed ones? Existence is not equality.
--     Compare each md5 against the body between the `$fn$` markers in
--     migrations/2026-09-07-native-identifier-mint.sql, and check the options
--     a body hash cannot see.
select p.proname, md5(p.prosrc) as src_md5, p.prosecdef, p.provolatile, p.proconfig
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'production_native_identifier%'
 order by 1;
select pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where c.relname = 'deliverables'
   and t.tgname = 'zzz_production_native_identifier_mint' and not t.tgisinternal;

-- 2. What will the seed derive, per team and per prefix?
select team,
       substring(linear_identifier from '^([A-Z][A-Z0-9]{1,9})-[0-9]{1,9}$') as prefix,
       count(*) as rows,
       max(substring(linear_identifier from '^[A-Z][A-Z0-9]{1,9}-([0-9]{1,9})$')::bigint) as max_ordinal
  from public.deliverables
 where linear_identifier ~ '^[A-Z][A-Z0-9]{1,9}-[0-9]{1,9}$'
 group by 1, 2 order by 1, 3 desc;

-- 3. How many rows will the flip NOT name? (B-4's cohort)
select team, count(*) as nameless
  from public.deliverables
 where coalesce(btrim(linear_identifier), '') = ''
   and coalesce(btrim(identifier), '') = ''
 group by team;
```

**Group the second query by prefix, not just by team.** A `count(distinct …)`
answers whether the seed refuses; only the breakdown tells you what the right
ordinal is once it has. That distinction is the whole of B-2's second half.

---

## (a) What needs code

**Very little, and that is the finding — not an oversight.** The mint is a
database trigger on the table every creation path writes, so the write side is
already covered for `production-write`, `batch-write` and the intake RPCs at
once. Measured against committed source:

| Surface | Change needed |
|---|---|
| `migrations/2026-09-07-native-identifier-mint.sql` | **none** — installed, verbatim, grants correct |
| `supabase/functions/production-write/index.ts` | **none for correctness.** It writes `identifier: null` and never writes `linear_identifier`, which is exactly the shape the trigger's INSERT branch mints into. There is no gateway operation for this capability and none is needed. See the caveat below. |
| `supabase/functions/linear-outbound/index.ts` | **none.** Its write-back at `:852`/`:868` is what the trigger's UPDATE branch is built to refuse. |
| `supabase/functions/linear-inbound/index.ts` | **none.** Its refresh at `:810` is refused the same way, and its row resolution prefers the uuid. |
| `index.html` | **none for correctness.** `_prodAdapter` already resolves `displayId: linear_identifier \|\| identifier \|\| id`, so a minted name appears wherever a provider one does. |
| `index.html`, `_prodIssueIdHTML` + `.prod-id` | **optional cleanup, not part of this step.** #1419's truncation and hover stop being load-bearing once B-4's cohort is named; removing it is a separate PR with its own browser-gate run, and it must not ride this one. |

**The one caveat, and it is a step 27 check rather than a code change.** The
gateway's `publicRow` projection *does* return `linear_identifier`, read off the
stored row. Whether a freshly created card shows its new name **immediately** or
only after the next fetch depends on whether the create path returns the row as
it stands after the trigger has run. That is unmeasured here and it is check 3
below. If it turns out the response predates the trigger, the fix is small and
lives in the gateway's readback — but do not write it speculatively.

**So step 26 for this capability is not a deploy. It is four database actions and
two document corrections.** That is unusual for phase 7 and it is the reason this
file spends more space on blockers than on procedure.

---

## (b) What needs a deploy, and which lane

**Nothing.** No Edge Function source changes, so neither lane runs.

Stated explicitly because it is the question this file exists to answer and
because getting it wrong is expensive in both directions. For the record:

| Lane | Needed here? |
|---|---|
| `deploy-f27-section4-closures.yml` (`linear-outbound`, `production-write`, `deliverable-write`, `batch-write`) | **No.** No source under `supabase/functions/` changes, so there is nothing to deploy and no sealed rollback bundle to capture. |
| `deploy-f27-linear-inbound.yml` (`linear-inbound`) | **No.** Same reason. |

If check 3 turns out to need a gateway readback fix, **that** is a
`production-write` change and it then needs the Section 4 lane with its full
capture — captured minutes before dispatch, uploaded to the `SyncView Backups/`
Shared Drive root **before** the dispatch, and with nothing merged between the
SHA handover and the owner's dispatch. Treat it as a separate step with its own
go-ahead; do not fold a deploy into this step on the strength of a check that has
not been run.

---

## (c) The flag flip, the readback, and the rollback

### The exact on value

The flag is one row, `syncview_runtime_flags.production_native_identifier_mint`,
and it holds both teams. **Flip one team at a time, video first**, so the value
is written twice:

```json
{"schema_version":1,"video":{"mode":"native"},"graphics":{"mode":"provider"}}
```

then, only after video's step 27 checks pass and B-2 is resolved:

```json
{"schema_version":1,"video":{"mode":"native"},"graphics":{"mode":"native"}}
```

`schema_version` must stay `1` and both team keys must stay present with a mode
of exactly `provider` or `native` — `production_native_identifier_capability`
raises `native_identifier_config_invalid` on anything else, which is a refusal,
not a fallback.

### Order is load-bearing, and here the capability enforces it for you

**Seed before you flip.** The capability returns `native` only when the flag says
native **and** a seed row for that team exists, so a premature flip is *inert*
rather than half-armed — deliberately unlike
`production_label_catalog_capability()`, which reports native with nothing staged
and 503s one call later. That is a safety net, not a licence: seeding first means
the capability turns on when you say so rather than when the seed lands.

### The readback (service role, read-only, immediately after each flip)

```sql
select public.production_native_identifier_capability('video') as video,
       public.production_native_identifier_capability('graphics') as graphics;
```

Video must come back `mode: "native"`, `seeded: true`, with the `prefix` and
`next_ordinal` it was seeded with. Graphics must come back `mode: "provider"`
until its own turn. **`seeded: false` with `flag_mode: "native"` is the
half-armed state** — the flip landed and the seed did not. Fix the seed; do not
re-flip.

### The rollback

Set the team back to `{"mode":"provider"}`. It stops new minting immediately and
**renames nothing, by design** — the UPDATE branch that protects a handed-out
name is not flag-gated, so a card that has been published under a native name
keeps it whatever the flag says afterwards.

That is the whole rollback and it is deliberately one-way in one respect: the
seed cursor must **not** be deleted and re-seeded once any name has been handed
out for that team, because re-seeding re-issues names. Delete the cursor only
while `production_native_identifier_grants` is empty for that team.

---

## Step 27 acceptance checks

Seven checks, with check 5 conditional on which creation path the test card
took (B-5) and check 4b already satisfied offline. **Each is closed only when every clause in its own text is named
and measured** — a check with sub-clauses is not closed until each clause is.
That rule is the labels file's, earned the hard way on #1420, and the sub-clauses
below are lettered so it is harder to miss one here.

| # | Check | How it is measured | Where |
|---|---|---|---|
| **1** | The capability reports `native` for the flipped team and `provider` for the other, with `seeded: true` and the seeded prefix and cursor | `select production_native_identifier_capability('video'), production_native_identifier_capability('graphics')` — compare the returned `prefix`/`next_ordinal` against the values recorded at seed time | live, read-only |
| **2a** | A card created on the test client gets a native name | create one video card on `sidneylaruel` through the normal Create Post flow; read back `deliverables.linear_identifier` for that row id — non-null, matching `^VID-[0-9]+$`, ordinal at or above the seeded `next_ordinal` | live, one write on the test client |
| **2b** | The name came from **us**, not from Linear | a row in `production_native_identifier_grants` with that identifier, that `deliverable_id` and that team, `minted_at` inside the create window | live, read-only |
| **3** | The browser shows the name **without a refresh** | create the card with the Production list open; the row's id cell shows the short name immediately, not a clipped raw id. This is the unmeasured gateway-readback question from (a) — if it shows the raw id and a refresh fixes it, the check **fails** and the fix is a `production-write` readback change with its own deploy | live, by eye, screenshot both states |
| **4a** | The cursor advanced by exactly one | `next_ordinal` in `production_native_identifier_mint` for that team, before and after check 2 | live, read-only |
| **4b** | Two concurrent creates cannot take the same name | already proven offline against a disposable PostgreSQL — `qa/native-identifier-mint/sql-proof.js`, the 25-concurrent-allocation case. Cite the run; do not attempt concurrency against production | offline, `F63_REQUIRE_POSTGRES=1` |
| **5** | **Which case is this card in?** Read the test card's `mirror_outbox` payload for `_native_intake_epoch` and its `linear_issue_uuid`. **Epoch present / uuid null → the card never drains: 5a–5c do not apply and must be recorded "not applicable, native intake", not left blank and not failed.** No epoch and a uuid appears → run 5a–5c. Deciding this by waiting and seeing is the failure mode; decide it from the receipt | live, read-only |
| **5a** | *(draining cards only)* The provider write-back is refused and the native name survives | wait for the card's `mirror_outbox` row to drain, then re-read `linear_identifier` — **unchanged** from check 2a | live, read-only |
| **5b** | *(draining cards only)* The refusal is recorded rather than dropped | that grant row's `provider_identifier_refused` now holds Linear's own name for the issue, which is **different** from ours | live, read-only |
| **5c** | *(draining cards only)* The card is still resolvable despite the divergence | open the card from the Production list and from a Workload deep link; both resolve. The uuid is what makes this work (`readDeliverableForIssue` tries it first), so also confirm `linear_issue_uuid` is non-null on the row | live, by eye + read-only |
| **5d** | *(native-intake cards only)* The mint is the **only** namer, and nothing is waiting behind it | the card's plan is absent from the drained set — `providerDrainPlans` filtered it — and after a settling period `linear_issue_uuid` is still null and `linear_identifier` is still the minted name. This is the positive form of "there is nothing to refuse" | live, read-only |
| **6a** | Refusal: a second seed for a seeded team is refused, not silently accepted | `select production_native_identifier_seed('video')` → raises `native_identifier_already_seeded`. **Run this against the live database deliberately** — it is a refusal, it changes nothing, and it is the one check that proves the cursor cannot be moved under a name that has been handed out | live, expected-exception |
| **6b** | Refusal: an invalid team is refused | `select production_native_identifier_capability('marketing')` → `native_identifier_team_invalid` | live, expected-exception |
| **6c** | Refusal: an ambiguous prefix is refused | `select production_native_identifier_seed('graphics')` **before** B-2 is resolved → `native_identifier_prefix_ambiguous`. Run and record it **before** B-2 is resolved by either shape, or it becomes unmeasurable | live, expected-exception |
| **7** | Both teams, on real work | repeat checks 2a, 2b, 4a and 5a for graphics after its own flip, on a real graphics card, and record which team each piece of evidence belongs to | live |

**Two things that are not step 27 checks, said here so they are not quietly
counted as passes.** B-4's existing nameless rows are untouched by
every check above — naming them is its own operation with its own go-ahead, and
a step 27 that passes while they sit there has not closed the surface #1419 was
about. And the `.prod-id` truncation stays in place through all of this; removing
it is a later PR that needs
`node docs/syncview-design/tests/prod-write-gateway-browser.js` before it pushes,
because it touches the Production write surface.

---

## Step 28 — the dependency this closes

The execution map's phase 7 table records **"unknown, verify"** in this
capability's *Closes* column: no checkpoint row and no OPEN_REPAIRS entry was
identified for it. Part of step 28 is answering that rather than inheriting it.

The honest candidate, to be confirmed against the checkpoint's dependency table
rather than asserted here: this capability closes the **naming** half of the
`linear-outbound` dependency — the reason lane F's outbound-off step is gated on
it. What it does **not** close is anything about issue creation, linkage or the
outbox itself, which outbound still owns.

Record the exact gate, the accepted replacement, and evidence the legacy route is
unreachable, in the checkpoint dependency table, the same way labels and ordinary
receipts were recorded on 2026-09-19.

---

## Order of operations

Nothing below is authorized by this file. Each database action needs its own
owner go-ahead, and B-2 and B-3 need owner decisions before the sequence can
start at all.

| # | Action | Who | Gate |
|---|---|---|---|
| 0 | Run Gate 0 and record all three results | session | none — read-only |
| 1 | ~~Correct `NATIVE_IDENTIFIER_MINT.md`'s status line and the execution map's phase 7 row against Gate 0~~ **DONE 2026-09-19.** The map also gained a state, *applied and inert*, because its vocabulary had no cell for "on the live database but not called from code" and that gap is what produced the wrong row | session | docs only |
| 2 | **DECISION** B-2: shape (i) fix the team/provider disagreement at its source, or shape (ii) seed graphics by hand from GRA's own maximum. **Re-keying our column alone is not an option** — a webhook undoes it | owner | recorded in the go-ahead |
| 3 | **DECISION** B-3: accept that the first flip is estate-wide for that team, and pick the moment | owner | recorded in the go-ahead |
| 4 | **DECISION** B-4: name the existing nameless rows, or accept they stay truncated. Re-count first — the cohort grows daily | owner | recorded in the go-ahead |
| 5 | Run check 6c (graphics prefix refusal) and record it — **before** B-2 is resolved either way | session | read-only refusal |
| 6 | `select public.production_native_identifier_seed('video');` — record `prefix`, `observed_provider_max`, `next_ordinal` | session | owner go-ahead |
| 7 | Flip **video only** to `native`; run the readback | session | owner go-ahead |
| 8 | Step 27 checks 1–6 for video, per check, per clause | session + owner | — |
| 9 | Resolve B-2 by the decided shape; seed graphics; record both numbers | session | owner go-ahead |
| 10 | Flip graphics to `native`; readback; check 7 | session + owner | owner go-ahead |
| 11 | B-4's backfill, if decided — assigning `update`, one transaction per team, database owner, after both seeds, with the one-to-one verification | session | owner go-ahead |
| 12 | Step 28: record the closure in the checkpoint dependency table. **PRE-WRITTEN 2026-09-19** as a form with unfilled `«…»` placeholders and a ⛔ header — it closes nothing until the storage session's measurements fill it and its ⏳ becomes ✅ | session | — |
| 13 | Hand lane F its unblocked outbound-off step | session | separate |

The last row is the point of all of it. Everything above exists so that when
`linear_outbound_enabled` goes to `{"mode":"off"}`, the next card created still
has a name.
