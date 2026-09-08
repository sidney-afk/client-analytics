# Linear exit — handoff to the next session

**Written 2026-09-08 ~03:15 UTC, at the end of a long working night.**
Read this before anything else. It replaces re-reading the whole conversation.

---

## 0. First, the two things the owner asked for by name

**The owner has switched to Fable 5.1. Be careful with tokens.** Do not re-audit
what is already recorded here and in the ledger. Read this file, read
`docs/ops/OPEN_REPAIRS.md` items **163-178**, and start from what they say. If a
claim here is load-bearing for what you are about to do, verify that ONE claim
rather than re-deriving the programme.

**Your first job is a health check, not more building.** The owner's words:
*"do a quick checkup on everything we've done to make sure this makes sense …
this is important to make sure that we always do a checkup on what we're doing."*

That is not a formality. On the night this was written, an independent reviewer
returned **twenty-one findings across two rounds, fifteen of them P1**, on work
the previous session had already judged ready. Eleven landed on four pull
requests that were minutes from merging. Six more landed on the *fixes* for
those. Four landed on this very handoff and its sibling coordination documents,
including one that would have cost an owner deploy window. The single most
valuable thing you can do first is look hard at work that has already been
called done.

**A session was already spawned to start this**, tagged `health-check`, pointed
at the four PRs that merged to `main` during the night and are therefore live:
#1348 (monitoring), #1349 (exporter and naming mint), #1345 (media rescue
preparation), #1342 (samples self-completion). Nobody had re-read those after
they shipped. Look for its report on PR #1351 before repeating that work.

### Where to point the health check

1. **Read `docs/ops/OPEN_REPAIRS.md` item 178** (the night summary). Then item
   **177**, the live outage, which is **NOT on `main`**: it lives on branch
   `claude/lx-a-workload-native` and lands with PR #1344. Permanent link, pinned
   to a commit so it survives the branch:
   [OPEN_REPAIRS.md @ `996d61f5`](https://github.com/sidney-afk/client-analytics/blob/996d61f53ac17ecca701f756cfc8ce5dce1ed2a9/docs/ops/OPEN_REPAIRS.md).
   Because this file must not depend on a branch that can disappear, the two
   load-bearing pieces of 177 are restated here:

   **The rule the night earned.** *A deliberate-manual Edge Function that changes
   how an EXISTING action is served must be proven against production data before
   it is deployed.* A green CI on a lane with no database access is not evidence
   about the database. Check that the open PRs actually honour this.

   **The mechanism, in one sentence.** `projectNativeSnapshot` discarded the
   entire snapshot when any single stored plan's client no longer matched its
   owner's, so six drifted rows blanked every editor's Workload board; the fix
   drops the row and counts it instead of failing the board.

   **The six drifted rows are still drifted.** A guarded repair is written in 177
   and has NOT been run. It is not urgent: the code change protects the board
   whether or not those rows are ever touched. If you run it, its step-1 SELECT
   is the ONLY undo, because `workload_plan` keeps no history and the prior
   `client` value is recorded nowhere this repo can read. Save that result before
   the UPDATE.
2. **The four open PRs are all CI-green and all unmerged, and green means very
   little here.** The second review round returned six more findings on two of
   them (§3), all against the fixes. Do not take a session's own "all tests pass"
   at face value either — one reported green while its own run contained a real
   failure it had misread as the known baseline. Run the suite yourself and
   compare the FAILURE SET, not the count.
3. **Look specifically for changes that only affect rows created AFTER the
   outbound flip.** Three P1s of that shape have now been found on #1344 across
   two review rounds. They cannot be hit today, so they ship invisibly and break
   on cutover day when attention is elsewhere and rollback is hardest. If more
   exist, they matter most.
4. **Question whether the lane split still makes sense.** It was chosen when the
   scope was believed larger. The media lane shrank to almost nothing on
   evidence; others may too.

---

## 1. Where the programme actually is

**Roughly 55-60% complete** toward "staff and clients work without Linear and the
account can be cancelled safely". Source work is near 80%; execution near 25%.
That gap is the whole story: a great deal is built and reviewed, and very little
is installed.

| | State |
|---|---|
| Authority flip (both teams native) | **Done before this programme began** |
| B7 label-catalog capture | **DONE.** The only unrecoverable item in the whole exit |
| Monitoring survives the cutoff | **MERGED** (#1348) |
| Label exporter + native naming mint | **MERGED** (#1349) |
| Media rescue preparation | **MERGED** (#1345), and the lane shrank on evidence |
| Workload native source | Built; **second review round returned 2 more P1s** (#1344), then held on the owner |
| Endpoints / Submit / editors-week | Built; **second review round returned 4 more findings** (#1346) |
| Native comment + feedback UI | Built, reviewed, **held** (#1347) |
| Cutoff sequence + watchers | Built, reviewed, **merges last** (#1350) |
| n8n workflow replacements | **Barely started.** Needs owner go-ahead per workflow |
| Probe fixtures for the native lane | **Not done.** New finding, see §4 |
| F48 deactivation | **Not done.** Security item, still open |
| The cutoff itself, then observation | **Not started** |

**Nothing is time-critical any more.** September 15 ends Linear *access*; the one
thing that needed Linear alive is captured. Everything else can be redone.

---

## 2. The two things blocked on the owner, exactly

### (a) Prove the Workload backend, then deploy it

Read-only, ~20 seconds, in the Supabase SQL editor:

```sql
with s as (select public.workload_native_snapshot_v1() as v)
select v->>'ok' as ok, v->>'complete' as complete, v->>'contract' as contract,
       (v->>'count')::int as count,
       jsonb_array_length(v->'rows')  as rows_len,
       jsonb_array_length(v->'plans') as plans_len,
       v->'authority' as authority
from s;
```

`count` must equal `rows_len` and the contract must read
`workload-native-snapshot-v1`. **This is the step that was skipped and caused the
outage in item 177.**

**RUN, AND IT PASSES.** On 2026-09-08 the owner ran it and it returned
`ok=true`, `complete=true`, `contract=workload-native-snapshot-v1`,
`count=6450`, `rows_len=6450`, `plans_len=262`,
`authority={"video":"syncview","graphics":"syncview"}`. `count` equals
`rows_len`, so the snapshot is whole. This gate on #1344 is **satisfied**; keep
the query, because it is the right first move after any later change to the view
or the membership function.

**What it does not prove.** This is the Postgres RPC. The drop-instead-of-fail
logic that caused and then fixed the outage lives in
`supabase/functions/workload-plan/native-snapshot.mjs`, which runs in Deno over
these rows and is covered only by unit fixtures. So the remaining unknown is how
many of the 262 plans that projection drops, which is answered by the step-1
SELECT of the repair in item 177 rather than by this query.

#### The second query, which answers that. Also read only.

`workload_native_snapshot_v1()` is `revoke all ... from public,anon,authenticated`
and granted only to `service_role`, so no session can take this measurement
itself. It needs the owner, in the SQL editor, and it is worth about thirty
seconds:

```sql
create or replace function pg_temp.nc(v text) returns text language sql immutable as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(lower(coalesce(v,'')), '^dr\.?\s+', ''),
             '\s+(and|&)\s+', '&', 'g'),
           '[^a-z0-9&]+', '', 'g');
$$;

select p.issue_id, p.client as stored, pg_temp.nc(n.client_name) as expected,
       p.plan_date, p.updated_at
from public.workload_plan p
join public.workload_issues_native_v1 n
  on n.is_sub_issue and (n.id = p.issue_id or n.linear_id = p.issue_id)
where p.client is distinct from pg_temp.nc(n.client_name)
order by p.issue_id;
```

**Every row it returns is a saved work day the board will silently drop.** Six
were seen on 2026-09-07. If it returns six again, nothing has moved. If it
returns more, drift is ongoing and the repair matters more than it did.

`pg_temp.nc` replicates `normalizeWriteClient`
(`supabase/functions/_shared/browser-write-auth-policy.mjs:9`) closely enough for
the rows seen so far. It does **not** strip accents, which none of them needed;
check that assumption against the `expected` column before trusting it for a row
you have not seen before.

**This result is also the only undo for the repair in item 177.** Save it before
running any UPDATE.

Then, and only if that reads correctly:

```powershell
cd C:\Users\Sidney\client-analytics
git fetch origin claude/lx-a-workload-native
git checkout <THE EXACT 40-CHAR SHA HANDED OVER, not the branch name>
supabase functions deploy workload-plan --project-ref uzltbbrjidmjwwfakwve --no-verify-jwt
git checkout main
```

**Check out the SHA, not the branch.** `docs/ops/EF_DEPLOY_MANIFEST.md:58` records
`workload-plan` as having **no CI deploy lane** and being deliberate-manual, and it
requires an *exact-SHA* release with `--no-verify-jwt`. A `git checkout <branch> &&
git pull` deploys whatever the tip happens to be at that second, which is precisely
the ambiguity that makes an incident hard to unwind afterwards. Whoever hands this
over must state the SHA and must not push to that branch afterwards without saying
so. Deploying from the branch rather than `main` is deliberate and correct: the new
function still answers the old `list` call the live board makes.

**Two readbacks, and they answer different questions.**

1. *Which code is live.* `docs/ops/EF_DEPLOY_MANIFEST.md:58` asks for a fingerprint
   readback: `node scripts/ef-fingerprint.js <sha> --slugs=workload-plan`. It needs
   `SUPABASE_ACCESS_TOKEN` with `edge_functions:read`, which the owner's machine
   already carries in `.syncview\` and no session should ever ask about. This is
   the authoritative answer and the one the manifest requires.
2. *Which behaviour is live*, needing no token at all: post
   `{"action":"native_snapshot"}` to
   `https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/workload-plan`.
   `401 unauthorized` means the new function is live; `400 invalid_action` means the
   old one is, because action validation runs before auth. **This is the probe that
   caught a rollback the owner believed had run and had not**, and it is worth
   keeping for exactly that: it can be run by anyone, from anywhere, in one command.

Run 2 always. Run 1 as well when the owner has a shell with the token loaded.

**Rollback**, if the board misbehaves: the same command from `main`. The applied
migration is additive and needs no reversal.

### (b) Deploy the comment reader, after merging #1347

Order is forced and reversed here: the deploy lane only accepts a `commit_sha`
already on `main`, so #1347 must merge first. Between merge and deploy, staff see
an honest "feedback unavailable" banner; clients see nothing different.

**Link:** https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-onboarding-edge-functions.yml
→ **Run workflow** → paste the 40-character `main` SHA into `commit_sha`.

**That lane redeploys FOUR functions** from that one SHA — `linear-outbound`,
`production-write`, `production-comments`, `production-archive` — not just the
comments one. The other three go out byte-identical, but it is a bigger action
than its name suggests.

---

## 3. The open pull requests

All four are CI-green and rebased onto current `main`. **The previous session
merged nothing after the review findings landed**, deliberately. Green CI is not
the gate on any of them.

| PR | Lane | Merge order | Gate |
|---|---|---|---|
| [#1344](https://github.com/sidney-afk/client-analytics/pull/1344) | Workload native | after B | 2 new P1s in flight (LX-A3), then owner query **and** deploy (§2a) |
| [#1346](https://github.com/sidney-afk/client-analytics/pull/1346) | Endpoints, Submit, editors-week | after A/D | 4 new findings in flight (LX-C3) |
| [#1347](https://github.com/sidney-afk/client-analytics/pull/1347) | Comments + feedback UI | after A | merge then deploy immediately (§2b) |
| [#1350](https://github.com/sidney-afk/client-analytics/pull/1350) | Cutoff + watchers | **last** | every flag step presumes A/B/C/D live |

### The second Codex round came back, and it is not clean

A re-review was requested on #1344 and #1346 after their first round of fixes.
Both verdicts landed at ~03:07 and ~03:10 UTC and returned **six further
findings, five of them P1, every one of them against the fixes themselves.**
Sessions LX-A3 and LX-C3 were spawned on the two branches to close them; check
their PR comments for where that ended up.

**#1344, on head `996d61f5`:**

1. **P1.** The dropped-plan warning is *still* invisible. It now reaches
   `wlState.backgroundError`, but `renderWorkloadPlanStatus` replaces every
   `backgroundError` except the exact legacy-team sentinel with the generic
   "could not check for newer changes" text, and a manual refresh clears it
   whenever `legacyTeams` is empty. **Third pass on one defect:** counted into a
   field nothing read, then written into a field the renderer discards.
2. **P1.** A second, independent link-resolution path in the popover header
   derives `soleSubIdent` from `soleSub.identifier` and falls through to
   `parentIdent`, so a one-video popover's most prominent action opens the batch
   parent, or vanishes, for a row with no Linear identifier.

**#1346, on head `57d77e03`:**

3. **P1.** `_writeUiRerouteRosterUsable` only asks whether normalization produced
   at least one slug. A corrupt flag value normalizes to the bogus slug
   `objectobject`, which clears the unusable signal and routes every real client
   back to the retiring Linear webhooks. The fail-closed contract has now been
   defeated by a *different* input on each of two consecutive rounds.
4. **P1.** `p28`/`p29`/`p30` still wait on `linear-set-status` and
   `linear-add-comment`, and their seeded cards have no native deliverable ids,
   so on the production lane they refuse with `native_link_required` first.
5. **P1.** `qa/write_ui_reroute_fixture.js` returns the reroute row but not
   `client_comment_gateway_enabled`, so the comment front door is OFF in every
   harness while production has it ON.
6. **P2.** editors-week totals include TEST and internal clients, against
   `TRACK_B_LINEAR_REPLACEMENT_SPEC.md:1425-1431`.

**The pattern is worth more than the six items.** Findings 1 and 3 are second and
third attempts at the same defect: a fix was written, believed, and reviewed
green while still not doing the thing it claimed. Findings 4 and 5 are a harness
green about behaviour production does not take — the same class as the previous
round's finding 4. When you read a fix on these branches, do not check that the
code changed; check that the changed code reaches a user.

---

## 4. Open items nobody owns yet

1. **The probe fixtures are not production-shaped.** The harnesses now describe
   production, but no probe seeds `video_deliverable_id` / `graphic_deliverable_id`,
   and 11 seed `linear_issue_id: ''`. On the native lane a targetless card is
   refused with `native_link_required`. 97 of 136 probes touch those surfaces.
   **Do not close this by putting the roster fixture back to `[]` — that restores
   the green, and the green was the defect.** Owner decision owed: does this land
   in lane C or its own lane?
2. **F48 is open and is a security item.** `webhook/editors-week` is still a
   deployed, unauthenticated n8n workflow returning confidential metadata.
   Closing it needs an evidenced deactivation with the owner's go-ahead in the
   same request: export the JSON to the private Drive backup first, deactivate,
   commit only a public-safe stub to `n8n-backups/`.
3. **Six drifted `workload_plan` rows.** After #1344 they are dropped rather than
   fatal, which stops the outage and does not give back six work days someone
   dragged. A guarded repair is prepared in item 177 and **not run**. Its SELECT
   is the only undo — save it before the UPDATE.
4. **The n8n replacements** for the remaining Linear-reading webhooks. Each needs
   the owner's go-ahead in the moment, a private Drive JSON export first, and a
   public-safe stub in `n8n-backups/`.

---

## 5. How to work here

- **The lane map is `docs/independence/LINEAR_EXIT_LANES.md`** and the per-lane
  briefs are `LINEAR_EXIT_BRIEF_A..F.md`, both in `docs/independence/`. They were
  stranded on an unmerged branch for the whole night and merged with this file;
  that is why a session reported them missing.
- **`index.html` region ownership (item 166) is the reason six sessions never
  collided.** If you spawn sessions, keep it.
- **Do not merge to `main` casually.** It deploys the live site instantly.
- **A browser half without its backend half is the trap.** Before merging any PR,
  check whether its `index.html` calls a gateway action the DEPLOYED function does
  not know, and whether it needs a migration applied first.
- **`npm test`** baseline in a session sandbox: `truth-sync` fails on shallow-clone
  freshness stamps. Compare failure SETS, not counts. `npm run test:prod-polish`
  cannot pass without a route to the live backend.
- **The ledger is `docs/ops/OPEN_REPAIRS.md`, append-only.** The owner reads it and
  asked explicitly that it stay current. Reserved numbers and the four pre-existing
  duplicate headers are recorded in item 168.

---

## 6. The two things to carry from the night

### One coordination defect

**Two documents, or a document and a process, disagreeing because someone
changed one of them**: a lane map stranded off `main`, a ledger heading reserving
different numbers from the map beside it, a brief telling a lane to edit the one
file the lane map forbids any lane to touch, a brief telling the owner to install
a migration that was already installed, a test asserting the old behaviour was
correct, a rehearsal passing because it never killed the thing it claimed to
kill, a counter surfaced nowhere while its comment said it was surfaced.

### One code defect, and this is the expensive one

**All-or-nothing over a collection: one member fails, and the failure is allowed
to destroy every member that succeeded.** Three confirmed instances so far, and
it has already taken the site down once:

1. `projectNativeSnapshot` discarded a whole 5,000+ row snapshot because ONE
   stored plan's client no longer matched its owner's. Six drifted rows blanked
   every pill on every editor's Workload board and disabled editing. This is the
   live outage in item 177.
2. `_writeUiFetchRerouteFlagOnce`: a read that succeeded with an empty or
   malformed roster left the flag reporting itself healthy, routing **every**
   staff write to webhooks that are about to stop existing.
3. `_wlNativeTweakComments` (#1347): one row's rejection escapes the serial loop
   and the call-site catch replaces **every** feedback box with the error state,
   discarding rows already fetched successfully.

The tell is always the same: a loop or a `Promise.all` over per-row work where a
single rejection escapes, or one shared error state standing in for a collection.
The fix is always the same shape too: settle per row, render what succeeded, and
say specifically what failed. **When you review anything on these branches, grep
for this before you read anything else.** And check the degraded state renders
distinguishably: a blank box meaning "nothing here" and a blank box meaning "could
not ask" are the same pixels and a completely different fact.

Every one of these passed CI. Unit fixtures do not produce them, because a
fixture where every row succeeds never exercises the path. Most were caught by an
independent reader looking at work that had already been called done. **Do that
first.**
