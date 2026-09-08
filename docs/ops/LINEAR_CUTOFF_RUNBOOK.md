# Linear cutoff runbook

**Status: PREPARED, NOT EXECUTED.** Nothing in this file has been run. Every step
is written to be run by the owner, in order, one at a time, with the read-back
before and the restore statement beside it.

Linear access ends **2026-09-15**. This document is how SyncView stops depending
on it, in an order chosen so that the cheapest-to-reverse steps come first and the
one-way step comes last.

**The owner's rule outranks every step here: do not break the client lifecycle.**
Clients approve posts and request changes through anonymous tokenless links. No
step below touches `calendar-upsert`, `sample-review-upsert`, or any client-facing
read. If a step ever appears to, stop and escalate rather than adapting it.

---

## 0. The headline: this cutoff needs no Edge Function deploy

The lane was scoped to install `migrations/2026-09-06-linear-outbound-cutoff.sql`
and deploy a cutoff-aware `linear-outbound`. That route costs an
**F27 Section 4 dispatch**, which costs a **merge freeze for all six exit
sessions** — the lane requires `commit_sha` to equal main's tip at dispatch time,
and dispatches were rejected on 2026-09-02 and 2026-08-08 for exactly that.

**It is not needed, and here is why, computed rather than assumed.**

`supabase/functions/linear-outbound/index.ts` gates every provider request behind
one condition:

```ts
// index.ts:1355
if (initialMode !== "off" || parityEnabled || f27ReplayRequestValue) {
  rows = await readRows(...);
  ...
  mirrorActor = await readViewer();   // :1371 — the only pre-loop provider read
}
```

With `linear_outbound_enabled = {"mode":"off"}` and
`linear_legacy_parity_enabled = {"enabled":false}` and no F27 replay in the request
body, that block is skipped entirely: **no rows are read, no `readViewer()` fires,
no request reaches `api.linear.app`.** `readRows` agrees independently — `mode ===
"off"` resolves the normal lane to `[]` (`:1083`) and `parityEnabled === false`
resolves the parity lane to `[]` (`:1084`).

Both flags fail CLOSED, which is what makes this safe to do with a flag instead of
a deploy:

| mechanism | where | behaviour on a bad value |
|---|---|---|
| `modeFrom()` | `:164-167` | any value outside `off`/`shadow`/`live` returns **`off`** — a typo stops traffic, it cannot start it |
| `readFlag()` | `:183-194` | a missing or non-object flag row **throws** `runtime flag unavailable/malformed` — the drain errors loudly, it does not fall through to live |
| `parityEnabled` | `:1331-1332` | requires `.enabled === true` exactly; anything else is false |

**And the deployed isolate is the code above.** The live `linear-outbound` is v47
with source closure `1489a4c2…` (`EXECUTION_LOG.md`; `ROLLBACK.md` §4 lane deploy
#28, run `34151869293`). `node scripts/ef-fingerprint.js <this branch> --slugs=linear-outbound --expected-only`
returns the same `1489a4c2…`. The repository source and the running isolate are
the same closure, so the gate analysed here is the gate production executes. There
is no caching: `readFlag` is called per invocation, so an old isolate obeys a new
flag on its next request.

**SCOPE THIS CLAIM PRECISELY — it is about `linear-outbound`, not about the
estate.** Everything above concerns one Edge Function: the outbound MIRROR stops
when the flags say off. It does **not** mean nothing in SyncView reaches Linear
afterwards. `supabase/functions/production-write/index.ts` reaches
`api.linear.app` (`:241`, `:2291`) through four helper functions and nine call
sites that **no runtime flag gates** — it declares
`const OUTBOUND_FLAG = "linear_outbound_enabled"` at `:239` and then never reads
it, so that constant is dead and the label, project-mapping, status-mapping and
assignee reads run regardless of every flag in STEP 1-4. Those are lane B's to
remove and they gate STEP 7, not the earlier steps; see P5 and STEP 7, where they
are enumerated with their staff-visible failures.

So the accurate sentence is: **the flags stop the outbound mirror without a
deploy. They do not stop production-write, and nothing in this runbook claims
they do.** After 2026-09-15 those reaches fail on a revoked credential rather than
on a flag, which is exactly why STEP 7 is gated on their removal rather than
ordered by the calendar.

**Recommendation: drop F1 and F2 from the exit.** Ship the flags, the schedulers
and the watchers. No migration, no deploy, no capture bundle, no merge freeze.

**What that costs, stated plainly — this is not free:**

1. **No server-side fence.** With flags only, anyone who sets the mode back to
   `live` or `shadow` resumes provider traffic. The migration's
   `linear_outbound_cutoff_activate_v1` makes that impossible. After 2026-09-15
   the credential is revoked, so a re-enable cannot reach Linear anyway — the
   fence protects a window of days, not the end state.
2. **The read path stays unauthorized at the transport boundary.** The candidate's
   `authorizeProviderDispatch` puts every read *and* write behind a claim. Without
   it, `mode:"off"` is the only thing standing between the worker and a provider
   read. Given the table above, that one thing fails closed.
3. **One in-flight invocation can still finish.** An invocation that read
   `mode:"live"` microseconds before the flip completes its loop and can apply a
   terminal receipt afterwards. The candidate's rehearsal proves exactly this bug
   exists in the unchanged worker. The window is one drain, once. STEP 2 drains to
   zero first, and STEP 3's verification waits a full drain interval, which reduces
   the observable effect to nothing — but it is a real difference and it is not
   closed by a flag.
4. **No `cutoff_disposition` census.** The five dispositions the debt view would
   report do not exist. STEP 0 and the debt-census watcher use the raw
   `mirror_outbox` status counts instead, which is what the adversarial review
   concluded they must do in every scenario anyway (the view's sixth branch,
   `cutoff_inactive`, masks all four debt dispositions while `cutoff_enabled` is
   false).
5. **The F27 recovery-contract extension is not written.** That is a saving, not a
   loss — the extension would have had to own 7 functions, 3 triggers, 1 view, 1
   table, 4 columns, 1 check constraint and the migration's grant lines, and the
   migration is not re-runnable (plain `create function` / `create trigger` inside
   one transaction).

**If the owner wants the fence anyway**, F1+F2 stay lift-ready on branch
`5bcc03bd` and can ship after the exit, on a calm day, without a deadline forcing
the schedule. Doing it then costs one dispatch and no merge freeze, because the
six sessions will be finished.

> **Do not reuse this lane brief's stated undo if you take that path later.**
> `docs/independence/LINEAR_EXIT_BRIEF_F.md`'s cutoff `undo:` drops "the four
> functions"; `migrations/2026-09-06-linear-outbound-cutoff.sql` creates **seven**
> — four service-only RPCs plus three trigger functions that share their triggers'
> names — so that undo leaves three functions installed (OPEN_REPAIRS 179, point
> 6). Cost item 5 above already counts them correctly; the brief does not. The
> migration is also not re-runnable (plain `create function` / `create trigger`
> inside one transaction), so a partial undo cannot be repaired by re-applying it.

---

## 1. Preconditions — do not start until every one is true

| # | gate | why | who confirms |
|---|---|---|---|
| P1 | **Lane B's native naming mint is APPLIED, SEEDED AND FLIPPED — all four steps, not merely merged** | `linear-outbound:852` (into `production_issue_create_linkage` as `p_issue.identifier`) and `:868` (into `deliverable_write` as `linear_identifier`) mint `deliverables.linear_identifier` for SyncView-native cards. *(Item 162/163 cite `:857`; verified against the source, it is `:852` — lane B's item 170 records the same correction. The conclusion is unchanged; only the line number was off by five.)* Flip outbound off before the mint lands and every card created afterwards renders as `b1_d_188ba4ad…` in the Production list, the command palette, the Workload parent header and all three deep links merged this week. Nothing errors; the estate just stops producing names. (OPEN_REPAIRS 162, 163) **Merging lane B is NOT enough.** PR #1349 merged on 2026-09-08 and `docs/ops/NATIVE_IDENTIFIER_MINT.md` opens with *"Status: SOURCE ONLY. `migrations/2026-09-07-native-identifier-mint.sql` has not been applied to the live database and no team has been seeded."* **And applying and seeding is not enough either — there are FOUR steps and the fourth is the gate.** This row said "applied AND seeded" until 2026-09-08, which names only steps 1-3; `docs/ops/NATIVE_IDENTIFIER_MINT.md:82-91` is explicit that **step 4 — flipping `syncview_runtime_flags.production_native_identifier_mint` to `{"schema_version":1,"video":{"mode":"native"},"graphics":{"mode":"native"}}` — "is what lane F's outbound-off step waits on"**, because `production_native_identifier_capability(team)` returns `native` only when the flag says native AND a seed row exists. Stop after step 3 and the allocator is installed and refusing: the mint is inert, the TEST card still takes its name from Linear, and STEP 3 produces the exact nameless-card failure this row exists to prevent. Do step 4 **per team, video first.** *(A premature flip is inert rather than half-armed — the capability self-guards, deliberately unlike `production_label_catalog_capability()`, which reports `native` with nothing staged and 503s one call later.)* **Undo for step 4:** set the team back to `{"mode":"provider"}` — stops new minting immediately, renames nothing by design. Steps 2 and 3 are safely undoable only while no name has been handed out for that team; once one has, deleting the cursor and re-seeding re-issues names. Verify by creating one card on the TEST client `sidneylaruel` after step 4 and reading back a non-null `deliverables.linear_identifier` that Linear did not mint — **before flipping the SECOND TEAM'S FLAG**, not before seeding it. *(Corrected 2026-09-08: this row said "before seeding the second team", copying a line the source document has since corrected against its own table. Steps 2 and 3 seed both teams; a seed row is inert until the flag moves, so the per-team caution belongs on the step-4 flag transition, which is the only step that changes behaviour.)* That readback is the one check that cannot be satisfied by a half-done gate. | coordinator |
| P2 | **Lane A is live AND has taken its acceptance measurement** | That measurement compares against `public.workload_issues`, and STEP 6 is what stops that table being rebuilt. After STEP 6 the measurement is unrunnable. | coordinator |
| P3 | **Lanes C and D are live** | They own the browser's Linear surfaces and the comment reader. Turning the endpoints off underneath them strands the UI. | coordinator |
| P4 | **STEP 0's census has been read by a human** | You cannot classify debt you have not counted. **Gates STEP 3**: after outbound goes off the queue stops being consumed, so whatever the census would have shown you is what you are freezing in place. *(Added 2026-09-08 — this row named no step, the only precondition in the table that gated nothing. A precondition no step references is decoration, and the reader who notices that is entitled to conclude the same about its neighbours.)* | owner |
| P5 | Lane B has removed production-write's Linear call sites | Only gates STEP 7, not the earlier steps. See STEP 7. | coordinator |
| P6 | **The Linear-dead rehearsal has been RUN and its result form completed** | `docs/audits/2026-09-15-linear-dead-rehearsal.md`, four pinned runs (R11). **Gates STEP 3 and the nightly flip in STEP 6.** *(Added 2026-09-08: the rehearsal was this lane's answer to "does the app survive Linear being unreachable" and no step required it — the same defect as P4, in the deliverable the session brief called the thing that converts the deadline from a hope into a test.)* **It also protects the monitoring estate:** `samples_e2e_nightly` and `calendar_e2e_nightly` are REGISTERED dead-man lanes (`monitoring-watchdog.js:135-138`, `max_age_minutes: 2160`). Flip them to dead mode before the rehearsal has proven the app survives it and they fail nightly — latching `failing` and emailing a red run every day, which is precisely the harm this lane's part 1 (#1348) existed to remove for the four Linear-credentialed lanes. Doing it in the wrong order re-creates it with two different lanes. | owner |
| P7 | **With Linear dead, on the TEST client `sidneylaruel`, EIGHT write surfaces SUCCEED — and refusing cleanly is a FAIL, not a pass** | (1) Calendar post, (2) Samples/SXR post, (3) staff submission, (3b) **append to an EXISTING batch**, (4) component fill, (5) set a label and open the picker, (6) change an assignee **after** the flag flip, (8) a **client-link** submission. **Any subset, or any of them refusing cleanly, is a FAIL.** *(Handed to this lane by the coordination lane and accepted 2026-09-08; `LINEAR_EXIT_MASTER_SEQUENCE.md` states outright that its own entry gate is "a note in a coordination document rather than an enforced precondition" until this runbook carries it, because **the operator at cutoff time has this file open, not that one.**)* **Why this is not what P6 already asks.** P6 requires the rehearsal to have been RUN. It does not require these surfaces to WORK — and my result form R1-R12 covered reads plus two writes, so **a rehearsal in which every intake path refused cleanly would have completed the form and been read as a pass.** On the intake paths, failing cleanly is the defect, not the proof: post creation, Samples/SXR intake, staff submission and component fill all read Linear through `production-write`, and none of the held PRs changes that file. **`projectForIntake` alone does not cover it** — `parentRouteForAppend` reaches `validateLinearBatchParent` independently, at `handleComponentFill:6038` (seven args, `validateExternal` defaults `true`) and `handleIntakeCreate:6701`/`:6721` (eight args, `!exactRowRetry`), which is why 3b and 4 are separate rows. | owner |
| P7a | **`write_ui_reroute_clients` read LIVE, and equal to the current writer rosters** | Entry-gate row 0. **Without it every one of P7's eight can pass on TEST while real clients still take the legacy lane.** The two live-state docs disagree — `BRIEFING.md` says the full roster, `ROLLBACK.md` says TEST plus wave 1, two real clients — and **nothing else resolves it.** Neither document's written value substitutes for the live read. | owner |
| P7b | **THREE read checks, each defeating its cache** | (a) the **Workload board** read with Linear dead **against known-changed data** — "freezes rather than empties" is the failure mode, so a board that looks fine is not evidence; (b) the **Editors subtab** after an **explicit Refresh** — `_kasperLoadEditors(false)` hits `_kedLoadEditorsCache()` and returns **with no network call at all** on a hit; (c) **tweak comments** in a browser where that row's comments were **not fetched in the last five minutes** — `wlFetchTweakComments` skips the fetch inside a 5-minute TTL. **Each also needs a correlated successful native request observed in the network panel: rendering is not evidence, the request is.** This is "failing cleanly is the defect" inverted — there the trap is reading a clean refusal as a pass, here it is reading a cached render as one. Both come from checking the surface instead of the path. | owner |
| P7c | **The `send-urgent-slack` decision is RECORDED, either way** | It is shaped like a pure Slack write and resolves the issue's **current Linear assignee** to choose the mention, so it dies with the account and **no merged replacement exists**. The gate does not require a repair; it requires the owner's decision to exist in writing rather than be discovered on the day. | owner |

**P1, P2 and P3 gate STEP 3 onward. Nothing gates STEP 0 — run it today.**

---

## 2. How to run a flag step

Every flag step below is one fenced, idempotent block modelled on
`docs/ops/FLIP_RUNBOOK.md:893-916`. Each one:

- names the **exact expected prior value** in its `where` clause, so a value you
  did not expect stops the operator instead of silently widening the change;
- raises unless **exactly one** row matched;
- has a restore block that is the same shape with the values reversed.

**Run the read-back first, every time. Run exactly one block. Never paste two
together.** An exception means STOP AND DIAGNOSE — never loosen the predicate.

Read-back (run before and after every flag step):

```sql
select key, value, updated_at, updated_by
from public.syncview_runtime_flags
where key in ('linear_outbound_enabled', 'linear_inbound_enabled', 'linear_legacy_parity_enabled')
order by key;
```

**Record what it returns in `EXECUTION_LOG.md` before you change anything.** The
expected prior values below come from `ROLLBACK.md` rows dated 2026-07-14 and
2026-08-02 — they are the documented state, **not a live read**. If the read-back
disagrees with a block's `where` clause, the block will refuse, which is the
correct outcome: bring the real value to the coordinator rather than editing the
predicate.

---

## STEP 0 — Census. Read-only. Run it today.

Nothing is changed. This is the single highest-value unread observable in the
lane (OPEN_REPAIRS 75), and every later step's disposition depends on it.

As `service_role`:

```sql
select status, legacy_parity, test_only, count(*)
from public.mirror_outbox
group by 1, 2, 3
order by 1, 2, 3;
```

```sql
select status,
       count(*) as rows,
       min(created_at) as oldest,
       max(created_at) as newest
from public.mirror_outbox
where legacy_parity = false
  and test_only = false
  and status in ('pending', 'failed', 'shadow_ok')
group by 1
order by 1;
```

**What to do with the answer.** The target for STEP 3 is **zero real-client rows in
`('pending','failed','shadow_ok')`**. If STEP 2 cannot reach zero, every remaining
row must be named here with a disposition before STEP 3 runs — not waved past.
Write the classification into this file under a dated heading, one line per row
class, and say who decided it.

**Known-good exception, do not chase it.** Structurally-unsendable duplicate rows
are `skipped`, not `pending`/`failed`, and deliberately so — the comment at
`linear-outbound/index.ts:1415-1436` explains that failing them instead buys an
identical outcome plus eight pointless API calls and a permanent false alarm.
`skipped` is a terminal status and is not debt.

**Open question the census settles.** OPEN_REPAIRS 75 records a constant backlog of
14 with `oldest_pending_minutes` null. `backlogCount` (`:974-979`) filters neither
`test_only` nor `legacy_parity`, while the alert does — so those 14 may be entirely
test or parity rows and not real-client debt at all. The second query above is the
one that answers it. **Unverified until someone runs it; no step below assumes an
answer.**

Undo: none. Read-only.

---

## STEP 1 — Legacy parity off

**Do this before the drain, not after.** The legacy-parity lane is dead across the
whole stack and its failure mode is silent infinite retry (OPEN_REPAIRS 75), so
draining with it on can spin on rows that can never leave. Turning it off also
removes the second half of the `:1355` gate, which STEP 3 needs.

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"enabled":false}'::jsonb,
      updated_by = 'owner-linear-cutoff-step1'
  where key = 'linear_legacy_parity_enabled'
    and value = '{"enabled":true}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'legacy parity off refused: expected exact {"enabled":true}'; end if;
end $$;
```

**Stops:** parity rows are no longer read (`:1084` resolves the parity lane to
`[]`). No other lane changes.

**Restore:**

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"enabled":true}'::jsonb,
      updated_by = 'owner-linear-cutoff-step1-restore'
  where key = 'linear_legacy_parity_enabled'
    and value = '{"enabled":false}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'legacy parity restore refused: expected exact {"enabled":false}'; end if;
end $$;
```

Fully reversible. Parity rows are not deleted or terminalized; they resume being
read the moment the flag returns.

---

## STEP 2 — Drain to zero, with outbound still `live`

No flag changes. Dispatch the drain repeatedly until STEP 0's second query
returns no rows:

**https://github.com/sidney-afk/client-analytics/actions/workflows/linear-outbound-drain.yml**

(Run workflow → default inputs. The direct link is here rather than the
filename because you run these from the Actions UI by hand, per `AGENTS.md`.)

**Mode matters here.** `normalStatuses` is
`["pending","failed","shadow_ok"]` only when `mode === "live"` (`:1050`); in
`shadow` it is `["pending","failed"]` and `shadow_ok` rows are never consumed.
**So the drain must run while the mode is still `live`.** This is why STEP 2 comes
before STEP 3 and not after.

Re-run STEP 0's second query after each dispatch. Stop when it returns zero rows,
or when two consecutive dispatches move nothing — at which point the remainder is
not drainable and must be classified per STEP 0.

**Watch the pending-age alarm.** `supabase/functions/linear-outbound/monitoring.mjs:17` (`pendingAgeAlertTeams(..., threshold = 30)`)
fires on `oldest_pending_age` over 30 minutes for syncview-authoritative teams —
both teams are syncview, so it applies to everything. Draining to zero before
STEP 3 is what keeps that alarm from pinning ON permanently after the cutoff.

Undo: none needed. Draining delivers work that was already queued to be delivered.

---

## STEP 3 — Outbound off  *(GATED ON P1, P2, P3, P4, P6, P7, P7a, P7b, P7c)*

**Do not run this before lane B's naming mint is live — all FOUR steps, not
three.** See P1: the migration applied, both teams seeded, **and**
`production_native_identifier_mint` flipped to `native` per team, proven by a
readback on `sidneylaruel`. Steps 1-3 alone leave the allocator installed and
refusing, which looks done and is not. This is the step
that stops human-readable card names being minted, and it does so the minute it
runs — days before 2026-09-15, under our own hand.

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"mode":"off"}'::jsonb,
      updated_by = 'owner-linear-cutoff-step3'
  where key = 'linear_outbound_enabled'
    and value = '{"mode":"live"}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'outbound off refused: expected exact {"mode":"live"}'; end if;
end $$;
```

**Stops:** every provider request from `linear-outbound`. With STEP 1 already done,
`:1355` is false, so no rows are read, no `readViewer()` fires, and nothing is
claimed. `linear-outbound` is **turned off, never deleted** — it is one of five
frozen slugs in `scripts/f27-edge-source-rollback.js`, appears 43 times in the
Section 4 deploy lane, and is baked into the owner's local capture script.

**Never use `shadow` as an intermediate.** `shadow` still enters `:1355` and still
reads rows. Only `off` stops it.

**Verify** (wait one full drain interval — 10 minutes — first, so any in-flight
invocation has finished; see §0 cost 3):

- the drain summary reports `mode:"off"`;
- `alerts.oldest_pending_age` is `false`;
- STEP 0's second query still returns zero rows.

**Restore:**

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"mode":"live"}'::jsonb,
      updated_by = 'owner-linear-cutoff-step3-restore'
  where key = 'linear_outbound_enabled'
    and value = '{"mode":"off"}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'outbound restore refused: expected exact {"mode":"off"}'; end if;
end $$;
```

Fully reversible **until the credentials are revoked in STEP 7**. Nothing was
terminalized, so the queue resumes exactly where it paused.

**What this does NOT stop:** rows keep being *enqueued*. `production_comment_write`
durably enqueues comments into this same lane, so from this minute on every mirror
intent becomes a row that will never be delivered and never fail — permanent,
silent, invisible debt that no `failed_write` alert will ever report, because the
rows never reach `failed`. **That is what the outbox-debt-census watcher exists
for.** Schedule it before running this step, not after.

---

## STEP 4 — Inbound off

```sql
do $$ declare n integer; begin
  update public.syncview_runtime_flags
  set value = '{"enabled":false}'::jsonb,
      updated_by = 'owner-linear-cutoff-step4'
  where key = 'linear_inbound_enabled'
    and value = '{"enabled":true}'::jsonb;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'inbound off refused: expected exact {"enabled":true}'; end if;
end $$;
```

**Stops:** Linear webhook deliveries are still verified and acknowledged, but no
mirror write is applied (`supabase/functions/linear-inbound/index.ts:3-5`).

**Restore:** the same block with the values reversed and
`updated_by = 'owner-linear-cutoff-step4-restore'`.

**Restoring the lane does NOT restore the missed events.** Deliveries during the
off window are acknowledged and dropped, not queued, so they are never replayed.
That is the one asymmetry in this runbook and it is why STEP 4 sits after STEP 3:
by then nothing SyncView does is producing Linear-side changes worth hearing about.

---

## STEP 5 — Delete the two EF-bound webhooks in Linear's own settings

The hard stop for inbound delivery. Done in Linear's UI, not in SQL.

**CAPTURE BEFORE DELETING OR THIS IS ONE-WAY.** Write both of these into the
private Drive backup — **not into this repository, which is public**:

1. the exact webhook URL of each of the two EF-bound webhooks;
2. the value of `LINEAR_INBOUND_SIGNING_SECRET`.

**Undo:** re-create the two webhooks from the captured URL and secret. **Only
possible while Linear still answers** — after 2026-09-15 the account is gone and
this is permanent.

Because STEP 4 already stops the effect, STEP 5 is optional before 2026-09-15 and
can be skipped entirely: on 2026-09-15 Linear stops delivering on its own. **Skip
it unless the owner wants the belt-and-braces.** A step that cannot be undone and
buys nothing the previous step did not already buy is not worth taking under a
deadline.

---

## STEP 6 — Stop the schedulers  *(GATED ON P2)*

**Not before lane A is live AND has taken its acceptance measurement.** After this
step `public.workload_issues` stops being rebuilt, and that measurement compares
against it.

### What actually happens when the reconcile stops — read this first

`workload_issues` **does not empty.** The n8n reconcile returns `[]` on a bad read
and its own safety gate keeps the old rows, so the board **FREEZES**: about 2,000
rows stay `active=true` with a `synced_at` that stops advancing. Stale-and-plausible
is worse than blank.

The browser will not catch it. `_wlV2CheckWatermark` (`index.html:14485-14505`)
refreshes only when `Date.parse(latest) > Date.parse(wlState.sourceSyncedAt)`
(`:14501`); on an unchanged value it does nothing, and on no watermark at all it
calls `wlClearBackgroundRefreshFailure()` and returns (`:14491-14494`) — it
actively CLEARS the failure banner. **Freeze is indistinguishable from health, client-side.**

**And the other half, which the exit scoping missed.** If the mirror ever *does*
return zero active rows, or the read fails, the board does not go blank either —
`index.html:14553` (zero active rows) and `:14555` (read failed) both fall
through to `LINEAR_ISSUES_WEBHOOK`, the n8n endpoint
that reads Linear. Post-cutoff that fallback is a dead endpoint. So the two
possible outcomes are a silently frozen board or a board reaching for a corpse,
and neither one announces itself. **The workload-source-freshness watcher is the
only thing that will say so. Schedule it before this step.**

### The order within STEP 6

Disable in this order, each one reversible by re-enabling:

1. **n8n pager nodes** on workflow `qllIDZPkdNAPRj0b` that dispatch the two card
   reconcilers (every 15 min) and gate B1 refresh (every 30 min).
2. **The GitHub scheduled workflows.** Each link opens the workflow's page;
   disable from the `…` menu, or land the commented-out cron (preferred — see
   below).

   - https://github.com/sidney-afk/client-analytics/actions/workflows/sample-linear-reconcile.yml
   - https://github.com/sidney-afk/client-analytics/actions/workflows/linear-deliverables-reconcile.yml
   - https://github.com/sidney-afk/client-analytics/actions/workflows/b1-linear-incremental-refresh.yml
   - https://github.com/sidney-afk/client-analytics/actions/workflows/production-shadow-audit.yml
   - https://github.com/sidney-afk/client-analytics/actions/workflows/production-write-drill.yml
3. **The n8n `SyncView Workload — Reconcile` workflow** (every 10 min) — LAST, and
   only once the Workload board no longer depends on `workload_issues` freshness.

**n8n edits are lane C's authorization, not this runbook's.** `CLAUDE.md` forbids
editing an n8n workflow without the owner's explicit go-ahead in the same request.
Items 1 and 3 are written here as an instruction for lane C or the owner; **this
lane does not perform them.** Capture the exact active version id before either.

### The coupling that makes this dangerous, and how it is already closed

`linear-deliverables-reconcile.yml:120-126` carries BOTH the `reconciler_pager`
heartbeat AND the second, independent host of `monitoring-watchdog.js --check`.
`monitoring-deadman.yml`'s own header says the two hosts watch each other and *a
checker cannot report its own death*. Disabling that workflow without re-homing the
second host silently reduces the dead-man's switch to one host on the exact day it
matters most.

**Already closed** by the merged monitoring PR (OPEN_REPAIRS 174):
`.github/workflows/monitoring-crosscheck.yml` is a second Linear-free host, and
`test/monitoring-watchdog.js` refuses a tree where fewer than two actively-scheduled
Linear-free hosts run `--check`.

### Retiring the four lanes — one change, enforced by the suite

Disabling the workflows in item 2 **must** be accompanied, in the same commit, by
retiring their watchdog lanes:

```js
// scripts/monitoring-watchdog.js — for each of reconciler_pager,
// production_write_drill, production_shadow_audit, b1_incremental_refresh:
retired: { at: '2026-09-15', reason: 'linear-cutoff' }
```

You cannot forget: `test/monitoring-watchdog.js` fails a watched lane whose hosts
are all unscheduled, and fails a retired lane whose host still runs. Comment out the
`cron:` lines rather than disabling in the Actions UI, so the repository does not
lie about itself.

**Two pins drift when you do this** and both must be re-pinned in the same PR
(`scripts/f27-reconciler-closure.js`, `REVIEWED_BLOB_SHA256`): the blob for
`scripts/monitoring-watchdog.js`, and the blob for
`.github/workflows/linear-deliverables-reconcile.yml`, which is that closure's
`WORKFLOW_PATH`. The drift is invisible until the change is committed, because
`test/f27-reconciler-closure.js` reads closure files from git HEAD rather than the
working tree. Verify with `git show HEAD:<path> | sha256sum`.

**Open, and an owner decision:** the F27 reconciler-closure capture/rollback
apparatus is defined over a workflow this step turns off. Retire it with the
workflow, freeze it as a historical capture, or re-point it — nobody has decided.

**Undo:** re-enable the nodes / re-activate the workflow / revert the PR. Restoring
the workflows without un-retiring the lanes will fail the suite, which is the
intended signal.

---

## STEP 7 — Revoke the credentials  *(GATED ON P5. LAST. IRREVERSIBLE.)*

Revoke `LINEAR_MIRROR_API_KEY`, `LINEAR_API_KEY`, `LINEAR_READ_API_KEY`,
`LINEAR_INBOUND_SIGNING_SECRET`.

**HARD PRECONDITION — every one of production-write's Linear reaches must be
removed and deployed first**, not two. The exit scoping says two; the adversarial
review counted four and it is right about the helpers (OPEN_REPAIRS 165 point 3).

**Say what is being counted, because "four call sites" was wrong and got fixed
here on 2026-09-08.** There are **four HELPER FUNCTIONS that reach
`api.linear.app`**, through **nine direct call sites**, depended on by **five
request handlers** — `handleLabelsRead`, `handleEntityOperation`,
`handleCreateOptions`, `handleProductionCreate`, `handleAssigneeOptions` — plus
the intermediates `linearLabelCatalog`, `linearLabelSnapshot`,
`assigneeEligibilityContext`, `readLinearProject` and `validateLinearBatchParent`.
Counting helpers is the useful unit for "what must lane B remove"; counting call
sites is the useful unit for "have they all gone". They are not the same number
and this row used to give one figure for both:

| Linear-reaching helper | direct call sites | code | staff-visible failure |
|---|---|---|---|
| `linearLabelsRequest` `:832` (throws `:834`/`:843`/`:847`) | 3 — `:871`, `:918`, `:946` | 503 `label_catalog_unavailable` | cannot pick a label **on create** (`handleCreateOptions` `:3345`), cannot **read** a card's labels (`handleLabelsRead` `:4947`), and cannot **write** one on an existing card (`handleEntityOperation` `:5491`) — three surfaces, one helper. This row previously named only the first. |
| `linearRead` (throws `:2325`, code default `:2285`) | 4 — `:2326`, `:2345`, `:2540`, `:2587` | 503 `project_mapping_validation_unavailable` | reaches via `readLinearProject` and `validateLinearBatchParent`. **The create path that used to head this row is CLOSED — see below.** |
| `linearStateIdForCreate` (throws `:2539`, `:2548`, `:2556`) | 1 — `:3604` | 503 `linear_team_mapping_unavailable` / 409 / 409 `status_mapping_unavailable` | **not staff-visible today**: its only call site is inside `handleProductionCreate`, below the `production_create_closed` throw — see below |
| `assigneeProviderPool` (throws `:2600`, code `:2592`) | 1 — `:2619` | 503 `assignee_provider_unavailable` | assignee picker dead — **live**, reached from `handleAssigneeOptions` (`index.html:50116`), which is not behind the create gate |

**WHICH OF THESE IS ACTUALLY STAFF-VISIBLE TODAY — corrected 2026-09-08, because
this row overstated it.** Production create has been closed since the owner's
2026-08-23 ruling, and the closure is enforced in **two independent places that do
not reference each other**:

- **Server:** `handleProductionCreate` throws `403 production_create_closed` at
  `:3592`, which is **above** its Linear reaches at `:3604`/`:3605`. So that
  handler never touches Linear.
- **Browser:** `_prodCreateGateText` returns `PROD_CREATE_CLOSED_TEXT` as its
  *first statement* (`index.html:53854`), above code the source labels *"kept,
  unreachable, as the exact undo if the ruling is ever revisited"*.

| surface | live today? |
|---|---|
| read a card's labels (`handleLabelsRead` `:4947`) | **YES** — no create gate on this handler |
| write labels on an existing card (`handleEntityOperation` `:5491`) | **YES** |
| assignee picker (`handleAssigneeOptions` → `assigneeProviderPool`) | **YES** |
| **component fill** (`handleComponentFill` `:6038`) | **YES** — reaches `parentRouteForAppend`, which calls `validateLinearBatchParent` → `linearRead`. That call passes **seven** positional arguments, so `validateExternal` takes its default `true`. |
| **append into an existing batch** (`handleIntakeCreate` `:6701`, `:6721`) | **YES, and this is the COMMON CASE** — both pass **eight** arguments with `validateExternal = !exactRowRetry`, which is `true` on any normal append. Most posts join a batch that already exists, so this is the surface most staff hit most often. |
| create a deliverable (`handleProductionCreate`) | **no** — server-closed above the Linear reach |
| `create_options` (`handleCreateOptions` `:3345`) | **no, but only because the UI is disabled.** The handler itself has **no closure check** — it validates surface and goes straight to `linearLabelCatalog` + `mappedCreateAssignees`. It is a live endpoint behind a dead UI, and it becomes staff-visible the moment the create ruling is revisited. |

**So anyone assessing reachability in this repo must check both halves.** One
handler is unreachable because the *server* refuses; the other because the
*browser* refuses. Tracing either one teaches you nothing about the other. (Lane
LX-N8N's session was caught by each separately, hours apart, having already
learned it from the first.)

Also note `production_assignee_eligibility` (`:2566`): `assigneeEligibilityPolicyFor()`
returns `{ providerMappingRequired: true }` when the flag row is absent or
unreadable — *absence means strictest*. That is today's state, so the assignee path
is provider-gated by default and this flag belongs in lane B's scope, not a
credential decision.

`handleCreateOptions` has **two** ungated reaches in one `Promise.all`
(`linearLabelCatalog` AND `mappedCreateAssignees`), not one.

**Revoking before these are removed turns reading a card's labels, writing a
label, the assignee picker, component fill and every append into an existing
batch into HTTP 503 for staff, on a day when nobody will connect the two
events.** The last two matter most and were the last to be found: appends reach
the provider through `parentRouteForAppend` by a route that touches neither the
create path nor `projectForIntake`, so a reader tracing the create flow — or a
repair scoped to it — misses them entirely, and **an append is what most posts
actually are.** This sentence used to say *"create a deliverable and
pick a label"*; creating is already closed, so naming it here inflated the
urgency with a failure that cannot happen and understated the three that can.

**Undo: NONE after 2026-09-15.** The account is gone. Before that date the undo is
to re-issue keys from Linear's settings, which requires Linear to still answer.

The rehearsal (§4 below) runs production-write with the keys unset specifically to
surface all four codes **before** the date rather than after it.

---

## 3. Two workflows outside the inventory

Neither is scheduled, so neither pages anyone, but both break on credential
revocation and both are dispatched by hand from time to time:

- `.github/workflows/slice5-test-drills.yml`
- `.github/workflows/graphics-f2-evidence.yml`

Add a line to each saying the Linear lane is retired, or expect a confusing manual
failure some months from now.

Also: `.github/workflows/linear-outbound-drain.yml` (cron `*/10`) has **no
heartbeat step and no watchdog lane**, so nothing reports it stopping. STEP 2 leans
on it. Registering it is worth doing while its disposition is being decided.

**And STEP 6 must DECIDE that disposition rather than leave it running by
omission** *(added 2026-09-08 by a sweep of this step's own list against the
scheduled workflows on disk)*. After STEP 3, the drain invokes `linear-outbound`
every ten minutes forever with `mode:"off"`, so `readRows` returns `[]` and it does
nothing. **Harmless, and therefore easy to leave behind:** it holds no Linear
credential, so the cutoff inventory never flags it, and it has no lane, so the
dead-man's switch never mentions it. Either disable it in the Actions UI at STEP 6
or register it as a retired lane in the same commit — but make it a decision that
appears in this list, not a leftover.

### The nightlies keep proving the app survives a Linear that no longer exists

**Found by the same sweep, and it is the polarity error of this whole lane
repeated one level up.** `grep -l SYNCVIEW_QA_LINEAR_DEAD .github/workflows/`
returns **nothing**. `samples-e2e-nightly.yml` and `calendar-e2e-nightly.yml` run
the probe manifest on a schedule with Linear mocked **healthy** — that is what
`samples-e2e-nightly.yml:8` means by *"Linear is ALWAYS mocked+captured by the
harness"* — and nothing flips them after the cutoff.

So from 2026-09-16 onward both suites go on asserting, green, every night, that
the app works against a Linear that has been switched off. **A green run that
cannot fail for the reason you care about is worse than no run**, because it
occupies the slot where the check would have been. This is the same defect the
rehearsal exists to correct, at the schedule level instead of the harness level.

**Do this at STEP 6, not before, and only once P6 holds.** Set
`SYNCVIEW_QA_LINEAR_DEAD=1` in the `env:` of both nightly workflows. **Not
earlier:** before the cutoff the app is *supposed* to talk to a live Linear, so
flipping these today turns both nightlies red for a condition that is not yet
true, and a red nightly that everyone learns to ignore costs more than the gap it
announces.

**And not before the rehearsal has passed, because these two are REGISTERED
dead-man lanes.** `samples_e2e_nightly` and `calendar_e2e_nightly`
(`scripts/monitoring-watchdog.js:135-138`, `max_age_minutes: 2160`) latch and page
like any other lane. Flip them to dead mode while the app still fails under a dead
Linear and they fail nightly — a latched `failing` incident and a red run in the
owner's inbox every day. **That is exactly the harm this lane's part 1 (#1348)
existed to remove**, and doing this step out of order re-creates it with two
different lanes. The rehearsal is what turns "we hope it survives" into "it does",
and P6 is what makes that a precondition rather than an intention.

| | |
|---|---|
| **undo** | remove the `env:` line from each workflow — one line per file, no other change |
| **verify** | one nightly run after the flip whose `linear_calls.jsonl` carries `dead` values **on rows whose `path` is a webhook name**, or any `backed:true` row. **NOT simply "contains `dead`"** — the `api.linear.app` guard writes `{path:"api.linear.app", dead:"refused"}` in *every* mode including healthy, so that weaker check passes on a run that never entered dead mode. *(This row said exactly that weaker thing when it was written, hours earlier in the same sitting.)* |
| **not done here** | this runbook does not edit those two workflows. They belong to the nightly suites, and changing them now would alter behaviour before the cutoff — see above. It is an operator step with an exact undo, which is what this document is for. |

---

## 4. Abort — the whole cutoff, in reverse

Run in reverse order. Everything up to and including STEP 6 is reversible.

| step | undo | reversible? |
|---|---|---|
| 7 | re-issue keys in Linear settings | **only before 2026-09-15** |
| 6 | re-enable workflows/nodes; un-retire the lanes in the same commit; **re-enable `linear-outbound-drain.yml` if it was disabled**; **remove the `SYNCVIEW_QA_LINEAR_DEAD=1` line from both nightly workflows** | yes |
| 5 | re-create webhooks from captured URL + secret | **only before 2026-09-15, and only if captured** |
| 4 | restore `{"enabled":true}` | yes — but missed events are **not** replayed |
| 3 | restore `{"mode":"live"}` | yes, fully — nothing was terminalized |
| 2 | nothing to undo | n/a |
| 1 | restore `{"enabled":true}` | yes, fully |
| 0 | nothing to undo | n/a |

**There is deliberately no irreversible database step in this runbook.** The
one-way `linear_outbound_cutoff_activate_v1` fence is not installed (see §0). If
2026-09-15 arrives with any real-client row still non-terminal, that is an argument
*for* this shape, not against it: a flag at `off` is equally effective at stopping
traffic and is fully reversible.

---

## 5. What this runbook does not cover

- **The rehearsal's EXECUTION**, though no longer its requirement — see **P6**,
  added 2026-09-08 when a sweep found it gated nothing. Proving the app works with
  Linear unreachable is `docs/audits/2026-09-15-linear-dead-rehearsal.md` and the
  `SYNCVIEW_QA_LINEAR_DEAD` harness mode. Run it before STEP 3, not after.
  *(That path said `2026-09-XX` until this sweep — a placeholder filename that
  resolves to nothing, in the one line telling a reader where to find the
  rehearsal.)*
- **The watchers.** `docs/ops/MONITORING.md` carries the post-cutoff coverage
  table. Every watcher this cutoff depends on must be scheduled and must have
  fired once on purpose before STEP 3.
- **Historical Linear media.** `docs/ops/LINEAR_MEDIA_RESCUE.md` and OPEN_REPAIRS
  164 — lane E's, and its deliberate abandonments are recorded there.
- **Anything about the client lifecycle.** No step here touches it. If one appears
  to, stop.
