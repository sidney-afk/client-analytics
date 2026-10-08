**Corrected 2026-09-21:** Historical record; its Linear workflow/topology statements describe the period recorded, not current operations. See the [cutoff record](docs/ops/LINEAR_CUTOFF_RUNBOOK.md) for the 2026-09-20 retirement (outbound and parity off; inbound remains; STEP 7 pending).

# SyncView Independence Execution Log

All times are UTC unless noted.

## 2026-10-08 — Sentinel site assurance, desktop, cycle 1 (batch 1)

Mandate: the site-assurance loop on the six riskiest desktop screens (Calendar,
Samples, Today, SyncLinear cards, Clients, TikTok upload), test client only,
fixes as PRs the owner merges. Cycle 1: 24 candidates from three pattern sweeps
plus a signed-in walk of the live site; batch 1 took the SyncLinear, upload and
link-box group. Nine confirmed and fixed in the browser, each with a guard that
fails on the previous main; one confirmed and left for the owner because it
needs a database change and a deploy (OPEN_REPAIRS 371). The Calendar and
Samples save-engine group and the Today and Clients group are verified and
shipped in later batches. No live write beyond one unchanged-value save on a
test-client card, no deploy, no merge, no flag, no n8n edit.
## 2026-10-02 — Digger preventive bug archaeology over September 19 to October 2

Three bounded cycles: 22 candidates, four confirmed, 16 refuted, two undecidable;
two consecutive dry sibling cycles met the stop rule. Independent skeptical
verification and real-code offline counterexamples preceded every finding.
Four source fixes and four regression guards: Analytics essentials HTTP truth,
whole-backfill completeness, caption scoped-query ordering, and complete HubSpot
identity reads. Pattern matrix, seen ledger and proof limits:
`docs/audits/2026-10-02-bug-archaeology.md`. The affected guard tests and all 23
visible split-page boot groups passed locally. Whole-unit and hosted status are
reported separately in the PR; no clean-health claim follows from focused proof.
No live writes, deployment, merge, n8n edit or protected-owner file change.


**Older entries are archived.** Entries more than 60 days old live word for word in [docs/ops/execution-log-archive/](docs/ops/execution-log-archive/), one file per month. Each one leaves a single "Archived entry" line below, in its original place, with a link and a fingerprint of the entry's exact text. Nothing in them was edited; `node scripts/ledger-archive.js log --check` proves it, and fails if an archived entry is later changed. Three entries older than 60 days stay in this file on purpose: the repo identity check refuses their lines as new text in a new file, and it has no exemption for a move between ledgers.

## 2026-10-01 — Calendar overall status now moves with the bridge; 5 cards repaired (owner's go; OPEN_REPAIRS 317)

`migrations/2026-10-01-calendar-overall-status-bridge.sql` applied by Lighthouse after the owner's go, about 19:10 UTC, in
three steps (the two helper routines, then the trigger routine with a 5 s lock timeout, then the repair routine). Before the
apply the live `production_native_calendar_status_project` body md5 was `e37dd97bae5735c3130a4774641ccf82`, the value the
deploy preflight pinned. Read back after: `production_native_calendar_status_norm` `ff2e9a4b84c1f9668dd982105501209c`,
`production_native_calendar_overall_status` `b723a160d4f2c8441c87fcda9c07c8d8`, `production_native_calendar_status_project`
`8177b7005675f0537ce44bfad0a3ee2d`, `production_native_calendar_overall_status_repair` `25d227d63577533b7578e7f3104f2ef4`,
each equal to the committed file. Repair dry run listed 5 linked, non-archived cards whose overall disagreed with their parts
(2 Approved to Posted with all three parts Posted, 1 Kasper Approval to Client Approval, 1 In Progress to Tweaks Needed,
1 Tweaks Needed to In Progress); applied, 5 of 5 written with an `overall_status_change` event each; a rerun lists 0. The
preflight now points this routine at the new file. **Way back:** the rollback block at the bottom of the migration (restore
the 2026-09-18 trigger body, drop the three new routines); corrected overall values stay, they match their parts.

## 2026-10-01 — analytics_mirror_read_enabled set to {"enabled": true} (owner's go; plan step 6)

The scheduled "Sheets mirror daily copy and parity" run of 2026-10-01 (started 16:31 UTC, run 36892689003) was green and
ended `PARITY: clean`: metrics 5168 of 5168 groups matched, top_videos 2759, content_summaries 1, market_research_briefs 13,
client_profiles 36, 0 differing. Lighthouse then changed the flag row from `{"staff":true,"clients":[<test client>],"enabled":false}`
to `{"enabled": true}` with a compare-and-set update (updated_by `lighthouse:owner-go-2026-10-01`, 16:49 UTC); read back
returned the new value. It takes effect on each page's next load; no function was published. **Way back:** set the value back to
`{"enabled": false, "clients": ["<test client slug>"], "staff": true}`; pages read the Sheets again on their next load.

## 2026-10-01 — sample status bridge trigger made live on deliverables (owner's go; OPEN_REPAIRS 313)

`migrations/2026-10-01-native-sample-status-bridge.sql` applied by Lighthouse after the owner's go ("yes, apply the sample fix"),
in two steps (the five functions, then the trigger with a 5 s lock timeout). Read back: trigger `zzz_native_sample_status_project`
on `deliverables`, tgtype 17, enabled, no WHEN clause; all five function bodies have the same md5 as the committed file; each
function grants EXECUTE to `service_role` only (no `anon`, `authenticated` or PUBLIC). The catch-up dry run over 60 days returned
0 rows. Live proof on the test client inside a transaction that was rolled back: moving one samples-origin work item to
`tweak` moved its sample from Approved to Tweaks Needed (overall status too) with one `native-bridge` event row; afterwards
the sample, the work item and the event count were exactly as before. Not yet pinned in the deploy preflight or the install
inventory: pinning needs the install inventory regenerated in the same change (OPEN_REPAIRS 313). **Way back:** the rollback block at the bottom of the migration (drop the trigger and the
five functions; samples already projected stay, they were correct).

## 2026-10-01 — 20 duplicate Metrics rows removed from analytics_metrics (owner's go; OPEN_REPAIRS 309)

The owner first published `analytics-write` through the one-function lane at main `76ef0062693e961fee256bd62db13f65766effa2`
(reported green), so a lone `""` in `yt_shorts_views` / `yt_longs_views` no longer gives n8n a second fingerprint. Then
`migrations/2026-10-01-analytics-metrics-dedupe-quoted-empty.sql` was applied by Lighthouse after the owner's go ("yes, delete
them"). Before it: 92 rows on 2026-09-29 and 2026-09-30 (36 n8n plus 10 sheet-backfill per day), 20 client-days doubled, no
rows yet for 2026-10-01. Read back after: `analytics_metrics_dedupe_log` holds 20 rows, 72 rows remain on the two days, 0
client-days have more than one row, and the log table has no grants to `anon`, `authenticated` or `service_role`. The daily
parity run confirms against the Sheet. **Way back:** the undo in the migration header re-inserts the 20 rows from the log.

## 2026-09-30 — instagram_uploads table created (owner's go; OPEN_REPAIRS 301)

`migrations/2026-09-30-instagram-uploads.sql` (the version with `last_checked_at`) applied by Lighthouse after the owner's go.
Read back after: the table exists with row security on; grants are `service_role` INSERT, SELECT and UPDATE only (no `anon`,
`authenticated` or PUBLIC). This is a table creation only: no function was published and no secret was set, so nothing reads
or writes the table yet. The `instagram-upload` function, the `POST_FOR_ME_API_KEY` secret and the sheet column are still to do
(`docs/ops/INSTAGRAM_UPLOAD.md`). **Way back:** `drop table public.instagram_uploads;` (queue rows only).

## 2026-09-30 — caption_jobs table created and the caption-jobs function made live (owner's go; OPEN_REPAIRS 298, 299)

`migrations/2026-09-30-caption-jobs.sql` applied by Lighthouse after the owner's go ("go on the caption table"); before it,
`to_regclass('public.caption_jobs')` was null. Read back after: the table exists with row security on and 0 rows; grants are
`service_role` DELETE, INSERT, SELECT, UPDATE and the owner role only (no `anon`, `authenticated` or PUBLIC). The owner then
published the `caption-jobs` function through the one-function lane at main `72d8f80d6ba471f1f71514f22757d5a5cc062f74`.
Read back: a call without a staff key answers 401, OPTIONS 204. Nothing reads or writes the table yet; the Generate Caption
workflow edit (step B2) is next. **Way back:** `drop table public.caption_jobs;` and remove the function (progress rows only).

## 2026-09-24 — six native rows re-stamped with the native attribution (owner-approved)

Attribution fields only (`source`, `reason`, `native_epoch`) on 6 rows whose Linear issues never existed; before values and the one-line undo are in OPEN_REPAIRS 246. A read-only sweep found no other row in this state.
## 2026-09-24 — two imported Linear parent rows archived (owner-approved)

`linear_raw.archived = true` on `b1_d_1e3acd42ec9940988c8ec801a804372a` and `b1_d_54f839e2875a4a369331e399ac9de1a1` (batch `b1_b_5924c395f710cb46e22a9a368541`). Nothing was deleted; the one-line undo is in OPEN_REPAIRS 245.

## 2026-09-24 — the batch view stopped listing the batch itself as a deliverable (browser only)

`_prodBatchRows` kept the synthetic batch parent (it carries the batch id) and,
for B1 imports, a Linear parent row filed beside its own children, so both
drew as an extra first "deliverable" titled with the batch name. They are now
filtered out. Read-only investigation against live data; no data changed.
Guard: `test/prod-batch-view-hides-batch-parent.js`.

## 2026-09-19 — one shared capture-phase guard fixed the backdrop-dismiss-on-drag bug across all twenty-four dialog overlays (OPEN_REPAIRS 215)

## 2026-09-19 — the naming mint was applied on 2026-09-17 and nobody wrote it down

**This is a discovery entry, not a record of an action taken.** No session in
this log applied `migrations/2026-09-07-native-identifier-mint.sql`. It was
found already installed by a read-only check on 2026-09-19, which is why it is
being logged two days late and by someone who did not run it.

**What is on the live database**, measured read-only:

- the four routines `production_native_identifier_capability` / `_seed` /
  `_allocate` / `_guard`, and the trigger
  `zzz_production_native_identifier_mint` on `public.deliverables`;
- **bodies verified**, not merely present: `md5(prosrc)` per routine against the
  body between the committed migration's `$fn$` markers — all four match — plus
  `prosecdef`, `provolatile` and `proconfig` as written, and a
  `pg_get_triggerdef` identical to the migration's statement;
- grants exactly as the migration writes them: both tables `postgres` only,
  `capability` and `seed` to `service_role`, `allocate` and `guard` to nobody;
- flag `production_native_identifier_mint` =
  `{"schema_version":1,"video":{"mode":"provider"},"graphics":{"mode":"provider"}}`,
  `updated_by` `native-identifier-mint`, `updated_at` **2026-09-17T16:14:54Z**;
- **0 seed rows, 0 grants** — so the capability is applied and **inert**, which
  is the state the migration is designed to install into. Nothing has minted.

**The apply time is inferred, and is recorded as inferred.** 2026-09-17T16:14:54Z
is the flag row's `updated_at`, and the migration writes that row, so it is the
best available evidence rather than an observation of the apply. Who ran it, and
through what, is not recorded anywhere this session can reach.

**What this cost.** Three documents said the migration was source-only —
`docs/ops/NATIVE_IDENTIFIER_MINT.md`'s status line, the execution map's phase 7
row, and `docs/independence/LINEAR_EXIT_MASTER_SEQUENCE.md` P1, which is the
canonical operator route. An operator following the master sequence would have
re-run an install of a non-idempotent-owner migration. All three are corrected
in the same change as this entry.

**The rule, for the third time in eight days** (the label catalog's B-1 was the
second): *a status line is a claim about the world until something measures it,
and agreement between documents is not measurement — it is usually one
unverified sentence with copies.* Rollback rule 5 exists so the log is the thing
that gets checked instead. It only works if an apply is written down when it
happens.

## 2026-09-18 — the bridge's backfill could not be called at all, and the fixture could not have told us

The bridge migration applied live at 22:38Z. The trigger half works: a native
status change on a production card now projects onto the linked calendar post.

The backfill half never ran. Every call through PostgREST — dry-run as much as
apply — refused with SQLSTATE 21000 "DELETE requires a WHERE clause" before
reading a single row. `production_native_calendar_status_backfill` clears its
two `on commit drop` temp tables at entry so a second call in one transaction
cannot see the first call's rows, and it cleared them with a bare
`delete from <table>;`. Supabase loads the `safeupdate` guard for the role
PostgREST connects as, and that guard rejects any DELETE or UPDATE whose plan
carries no qualifier. It does not exempt a temporary table the routine created
itself moments earlier.

`migrations/2026-09-18-native-calendar-backfill-temp-table-clear.sql` replaces
the routine using `truncate`. `delete ... where true` was the other candidate
and was rejected on purpose: the planner folds `where true` away before the
guard inspects the plan, so it would be a fix resting on the guard not
constant-folding. Two statements change; the body was extracted from the applied
file and patched by script rather than retyped, and the lint below holds the two
to being identical apart from those two lines. The applied migration is not
edited — it ran against production, and rewriting it would make the ledger
describe a database that never existed.

The part worth keeping is not the SQL. All 38 disposable-PostgreSQL assertions
were green, honestly, against a statement the real caller could never execute:
the fixture is a plain PostgreSQL 17 with no `safeupdate` loaded and no
PostgREST in front of it. No assertion added to that lane could have caught
this, because the difference is the connection and not the SQL. So the guard is
`test/migration-bare-delete-lint.js`, which reads the committed bytes of every
routine body in the repository — 362 of them — and refuses the pattern outright.
Running it over the repository as it stands found the two statements in the
bridge migration and no others, so nothing else was silently broken in the same
way. It was seen to fail on a wrapped bare delete and on one planted in an
unrelated routine before being accepted.

Two smaller things went with it. The backfill script carried the live project's
REST origin as a `SUPABASE_URL` default; the repository is public, so that
published an identifier for the production database, and separately it made the
dangerous direction the silent one — an unset or misspelled variable would have
pointed a `--apply` at production rather than refusing. It is now required, with
no default. `scripts/linear-label-catalog-export.cli.js` has the same fallback
at line 384; that is recorded in OPEN_REPAIRS and deliberately not fixed here,
because it has its own callers and its own lane and does not belong in a
regression PR.

## 2026-09-18 — the calendar stopped hearing about production status changes, and the fix is a trigger

Priority regression from the ordinary-receipts flip, reported the same day.

An editor's status change on a production card reached the content calendar by
one route and one only: the write landed in `deliverables`, the outbound mirror
carried it to Linear, and `scripts/linear-sync-reconcile.js` pulled it back onto
`calendar_posts.video_status` / `graphic_status`. Native receipts send nothing to
Linear. The reconciler still runs, still resolves the link, still gets the stale
Linear state, and its own provenance test correctly refuses to write it — so
nothing wrote the calendar's copy at all. Changes made FROM the calendar were
never affected; they have always written both copies.

Measured: four video cards moved to `smm_approval` between 19:12Z and 19:25Z and
the calendar still read "Tweaks Needed" at 20:20Z, when the SMM re-set all four
by hand. At 20:44Z ten components across seven clients were lagging their linked
card (six video, four graphics), oldest since 17:34Z.

`migrations/2026-09-18-native-calendar-status-bridge.sql` projects the change in
the database — the mapped calendar value, its `*_status_at` stamp through the
existing BEFORE trigger, and one `calendar_post_events` row with
`source = 'native-bridge'`. `scripts/native-calendar-status-backfill.js`,
dry-run by default, catches up the cards that already lagged.

**Trigger, not gateway, and the reason is the reconciler's ledger.** That ledger
decides direction by comparing the card's EXACT change time against Linear's
poll time, and exists because a card whose stamp did NOT move when the card
really changed looks OLDER than Linear and gets reverted
(`LINEAR_DRIFT_INCIDENT_2026-06-19.md`). Its expectation is about the column on
every write path, in the same transaction — not about one caller. A gateway
projection is a second step that can be skipped, can fail, or can ship in a
version of `production-write` that is not deployed yet, and `production-write` is
not the only writer of `deliverables.status` anyway. Same reasoning, same shape,
as the 2026-09-10 Kasper ping ledger trigger. No Edge Function changes, so no
fingerprint moves and no sealed bundle is needed.

**The duplicate-notification hazard was real and it was not the obvious one.**
The client-channel status intent is a trigger on `deliverable_events` keyed on
`source='ui'`, which this cannot reach — that one was easy. The sharp one is
that `calendar_posts.video_status_at` IS the urgent editor ping's deduplication
key: `production_notification_enqueue_urgent` builds
`intent_key = 'urgent:' || sha256(deliverable_id || '|' || video_status_at)` and
leans on `on conflict do nothing`. A projection that re-stamps that column
without a card-visible change mints a fresh key and lets the same tweak be
pinged twice. Every write is therefore predicated on the MAPPED value differing
from the card's, so a no-op, a native move between two statuses that map to the
same calendar value, the four cards the SMM already fixed by hand, and a second
backfill run all write nothing. Asserted in the units that decide it — the
`sha256` key itself — not in prose.

One repair falls out: `urgentSnapshot` requires the card to read `Tweaks
Needed`, so the urgent ping has been unreachable on natively-changed cards since
the flip and is reachable again.

**Amended 2026-09-18, before merge, after review found three defects.** The
biggest: a component regressing `approved` -> `tweak` kept its client approval
stamp, so the card read "Tweaks Needed" beside a live sign-off and nothing
recomputed it. The projection now mirrors `_calClearStaleApprovals` for the
component that regressed, clearing `client_<component>_approved_at` and, when no
component is left above the client-approval line, `kasper_approved_at` — in the
same statement that moves the status. The header line saying this projection
does not copy `computeOverallStatus` was right and had quietly been read as
covering `_calClearStaleApprovals` too; they do different jobs, and only the
first is recomputed on reload. The backfill's apply now re-reads the deliverable
in the same statement and writes its events rows only from what an UPDATE
returned, so a row a concurrent change took out from under it reports
`applied: false` rather than being clobbered and logged. And the usage block is
absolute, run as written from an unrelated directory before being handed over.

Proofs: `test/native-calendar-status-bridge.js` executes
`_calMapNativeStatusStrict` out of `index.html`, parses the migration's `case`
arms out of the SQL and compares them over all 90 status/origin pairs — seen to
fail on a planted one-character drift before being accepted.
`test/native-calendar-status-bridge-postgres.js` is 32 assertions on a real
disposable PostgreSQL, including a CONTROL that drops the trigger and reproduces
the reported regression, and the `ROLLBACK.md` inverse rehearsed in the same
lane so it re-runs rather than being a dated claim.

## 2026-09-18 — A native card has no identifier, so its row cell escaped

Browser-only. `.prod-id` declared `width: 76px` and no truncation at all. A
provider card shows a 9-character Linear identifier; a native card has none and
`_prodIssueLabel` falls through to the raw 40-character deliverable id, which is
hyphenated, so it wrapped and the cell grew taller than its 44px row. Every card
created after 13:35Z that day was native, and `prod-layout-polish` went red on
rows nothing had changed.

The cell now truncates with an ellipsis and does not wrap, and all three
identifier render sites go through `_prodIssueIdHTML`, which carries the full
value on the hover. **The proper fix is the identifier mint capability** — a
native card should carry its own short identifier instead of showing a raw id.
This is a readability stopgap, not that.

Found by the gate's new per-child assertion ids: `plp_list_metadata` alone named
the sweep and left six candidate cells, and a fix aimed at the wrong one of the
six shipped first. The id now names the cell.

## 2026-09-18 — The client chip escaped its row on a longer client name

Browser-only, CSS. `.prod-chip-client` inherited `flex: none` and therefore
could not shrink, so at any row narrower than its content it hung outside the
row. Harmless while the longest active client display name was 13 characters;
`prod-layout-polish` went red on `plp_list_metadata` at compact-desktop when a
19-character name arrived with 32 new cards, on rows no change had touched, and
it went red on two unrelated pull requests at once.

The chip now yields and the label ellipsizes. Pinned by
`test/prod-client-chip-name-width.js` with a synthetic 24-character name,
confirmed to fail without the fix.

Named in the gate's public summary for the first time: the layout suite now
prints the ids of the assertions that fired, harvested by the gate from that
suite's own source, so a red lane says which check rather than `error_generic`.

## 2026-09-18 — The browser refused the test client's own native cards

Browser-only change, not deployed and not deployable: `index.html` is served by
Pages on merge to `main`. No migration, no Edge Function, no runtime flag, no
schema, no write path and no client delivery.

The native-intake attribution proof in `_prodResolveAttributions` demanded
`owner_kind === 'client'`. The gateway writes that field as the roster row's own
kind, so every native card of a `kind: 'test'` client failed the proof, resolved
`needs_attribution`, and showed the repair banner with the comment box and write
controls gated shut — long after `production-write` began accepting that client
(#1414). The proof now takes the expected kind from the roster row and requires
the stamp to equal it, accepting `client` or `test`. `internal` stays refused.

The existing suite could not have caught this: its only client fixture is
`kind: 'client'`, so a green run was never evidence about this path. Six
assertions were added to `test/native-intake-attribution-ownership.js` and
confirmed to fail on the pre-fix file with the reported symptom before being
accepted. Roster lookups were checked and needed no change — they gate on
`active === true` alone and always carried `kind` through.

Reversal and current state are in `ROLLBACK.md`; the behaviour contract is in
`docs/syncview-design/WIRED-PARITY.md`.

## 2026-09-14 ? Draft installation-day preparation

Prepared isolated frozen-main catch-up, guarded installation adapter, urgent website links and owner/day-of documents. No branch merge, deployment, installation, messages, n8n changes or production writes. Main #1393 was rehearsed in isolated Git objects and its known catalog change reviewed separately. See docs/ops/LINEAR_EXIT_PREPARATION_CHECKPOINT_20260914.md for exact scope, evidence and pending quiet Storage custody.


## 2026-09-08 — Deployed: workload-plan native snapshot, verified live

**The redeploy that yesterday's outage earned.** `workload-plan` deployed by the
owner from the exact SHA `d4b2365eab03302b88953a63a610399643fc71ec` on branch
`claude/lx-a-workload-native`, with `--no-verify-jwt`, per
`docs/ops/EF_DEPLOY_MANIFEST.md:58` (NO CI DEPLOY PATH, deliberate-manual).
Five assets uploaded including `native-snapshot.mjs`.

**Verified two ways, which is the whole point of this entry.**

1. *Which code is live.* POST `{"action":"native_snapshot"}` returned **401**.
   Action validation runs before auth, so a 401 proves the isolate recognises
   the action; the pre-incident function answered `400 invalid_action`.
2. *Whether it works.* The owner opened the Workload board and read it. Every
   pill carries a real date and a real editor. No "Deadline fallback" anywhere,
   across five day columns and every team on screen.

**The second check is the one that matters and it is the one that was skipped
before.** Yesterday CI was green on nine checks and the board was blank for
every editor. A person looking at the surface is not a formality here; it is
the only evidence that has ever caught this class of failure.

**Preconditions, both met before the deploy rather than after.**
`workload_native_snapshot_v1()` had already answered whole (`ok`, `complete`,
`count` = `rows_len` = 6450, both teams `syncview`), and the drifted-plan census
was re-run and returned the same six rows as 2026-09-07 — unchanged, so nothing
regressed in the interval. Those six saved work days are now DROPPED rather than
fatal: the board paints, and six days are missing instead of all of them.

**One process note worth keeping.** Three deploys ran in sequence. The middle
one was issued from `main`, which does not carry `native-snapshot.mjs`, and it
briefly restored the pre-incident function (visible in the CLI output as four
assets uploaded instead of five). The third deploy, from the exact SHA, is the
one that stands. Net state is correct and the intermediate state was simply the
previously working code, but it is a reminder that **the SHA in the checkout is
the whole safety property** of a deliberate-manual lane.

**Rollback**, unchanged and unused: the same command run from `main`. The applied
migrations are additive and were not reversed.

## 2026-09-08 — Applied, recorded late: the two Workload native migrations

**Recorded after the fact, which is the whole point of this entry.** Both
migrations below were applied to production and neither was logged here. The
omission had a real cost: `docs/independence/LINEAR_EXIT_BRIEF_A.md` inferred
from their absence in this file that the view had never been applied, and told
lane A and the owner to apply it, which would have spent an owner migration
window re-doing installed work. **Absence from this log is absence of a record,
not absence of the change**, and this file is the deployment ledger a future
session will consult first.

- **`migrations/2026-09-02-workload-native-view.sql`** — applied on an unrecorded
  date before 2026-09-07. Creates the read-only view
  `public.workload_issues_native_v1` and grants select to anon and authenticated.
  Writes nothing, drops nothing, re-running is a no-op (the file says so at
  :28-29). Discovered applied by measurement, not by record: OPEN_REPAIRS 176
  read it live over REST while the n8n Workload reconcile was still running.
- **`migrations/2026-09-05-workload-native-membership.sql`** — applied by the
  owner on 2026-09-07, in the window before the `workload-plan` deploy that
  caused that night's outage. Creates three SECURITY DEFINER functions
  (`workload_native_snapshot_v1`, `workload_native_plan_target_v1`,
  `workload_native_plan_set_v1`), `service_role` execute only, revoked from
  public/anon/authenticated. No table, row, flag, or grant on an existing object
  changed.

**Proof both are live, taken 2026-09-08 in the SQL editor.** `select
public.workload_native_snapshot_v1()` returned `ok=true`, `complete=true`,
`contract=workload-native-snapshot-v1`, `count=6450`, `rows_len=6450`,
`plans_len=262`, `authority={"video":"syncview","graphics":"syncview"}`. The
function is from the membership migration and it reads the view, so one answer
establishes both. `count` equalling `rows_len` says the snapshot is whole rather
than truncated.

**Nothing was deployed or reverted by this entry.** It is a record of state that
already existed. The outage of 2026-09-07 was caused by the `workload-plan` Edge
Function deployed alongside these, not by either migration; both are additive and
neither was rolled back when that function was. OPEN_REPAIRS 176, 177 and 178.

## 2026-09-08 — Built: Create Post explains itself once, in a receipt, instead of four times

Owner, on the dialog as it stood: *"I just want to make this create post menu more UI
friendly... I would remove all the hint things. It's too much text."* Three mockups went
back; he picked the conservative one and then trimmed it further over two rounds.

**The diagnosis, because it decided the shape.** Every hint block in the dialog described
an OUTCOME, not a control, and three of them described the same outcome in three
registers: the sub-issue total, a worked example of a composed title, and the parent's
name in quotes. One live receipt states all three from real state, so all three
paragraphs are gone. The fourth, under the video-editor picker, was removed outright at
the owner's request in the second round, and `_calNativeEditorDisclaimer` went with it --
it had no other caller. What it guaranteed is not lost: the option itself still carries
the open count and the `(suggested)` marker, and `test/native-post-editor-picker.js` now
pins those against the option builder, including that no paragraph returns to re-explain
the control above it.

**The receipt answers something no hint could.** On an APPEND it shows the ordinals the
post will actually get -- invisible until now, and only discoverable in Linear after the
fact. The number is mirrored from the gateway, never counted: a batch's post COUNT is not
its highest ordinal (delete one card and they part company permanently), and the ordinal
is recorded nowhere but the title. So `_calFetchNativeBatchPostCounts` now also selects
`title` on rows it was already fetching and reads the max back with the RPC's own rule,
returning `{ counts, ordinals }`. One column, no extra round trip. A read that fails or
stalls renders the ordinal as an ellipsis rather than a guess. **This is a preview**: the
server still allocates, and `production_intake_append` still fails closed if the two ever
disagree.

**The batch name is prefilled, not placeheld** (owner: *"it should be clear that we can
change the name"*). A greyed placeholder read as a system-issued value rather than a
field you own, so the generated title is now real, selectable text, and the field gained
a `Batch name` label of its own. Clearing it still lands on the same default --
`_calNativeBatchNameFor` already treats empty as untouched -- so the fallback is
unchanged.

**The batch pair became a segmented toggle** and only the chosen branch renders its
controls; both used to sit open at once, spending about a third of the dialog on the
option nobody picked. The radios move into the tab strip, so every read of
`calNativeBatchChoice` -- the submit path included -- is untouched by this.

**Two focus-ring bugs, both real, found from one owner note** (*"there's like white
corners on the post name field"*). First, `--sv-focus` is defined NOWHERE in `index.html`,
so all four Create Post fields fell through to `--text-primary` -- near-white in dark mode
-- while the app's other 22 rings use `--focus-ring`. Second, and the actual "corners":
`.cal-native-name-list` is a scroll container, `overflow-y: auto` computes `overflow-x:
auto` with it, and the clip happens at the padding box -- so the ring, which sits 3px
outside the input's border box, lost all four straight edges and kept only its corner
arcs. 4px of padding gives it room; a matching negative margin keeps the row in place.
Isolated before it was fixed: with `overflow: visible` the ring drew complete.

**Browser only.** No migration, no Edge Function, no gateway change -- the payload shape
is byte-identical. It goes live with the Pages deploy on merge, and the rollback is
reverting the commit. Verified in the real app under a headless browser (both themes, one
and three posts, and an append to a batch holding three previewing Video 4/5/6), plus
415/415 under CI-equivalent conditions.
## 2026-09-07 — Built (SOURCE ONLY, draft PR): every piece of feedback on a deliverable, in one place, without Linear

Linear exit, lane D. Owner: *"in the planner we also have a new system to view
comments, so instead of when Kasper or the client asks feedback, it appears as if
it was commented on the sub-issue, we planned also a new UI experience to view
the comments."*

Today a client or Kasper tweak note lands on the Calendar/Samples card cell and is
mirrored into a Linear sub-issue comment. **Linear is the union point** — the only
surface showing the canonical `production_comments` thread and the card-cell notes
together. SyncLinear's panel shows only the canonical half; the Workload popover
reads Linear through the `linear-tweak-comments` n8n webhook. On 2026-09-15 the
union point disappears and a note that took the legacy write lane becomes visible
nowhere in the staff view, with no notice that anything is missing.

**What landed in source.** `production-comments` gains `feedback.mjs` (214 lines,
zero Linear references) and honours `include_feedback: true` for staff principals
only, after the existing read budget, target-team authorization and durable
allow-audit, re-checking the five crosswalk fields before responding. It adds no
SQL. The SyncLinear panel becomes **Feedback & tweaks** and renders a read-only
"From the original card" section with every action control suppressed. The Workload
popover reads native rows from `production-comments` and keeps a legacy fall-through
for everything else.

**One live defect fixed on the way in.** The lifted `feedback.mjs` selected a
`tweaks` column from `sample_reviews` for every video deliverable. That column
exists only on `calendar_posts`; on Samples the select errors and the panel words it
as "could not load" — indistinguishable from a transient failure. Every Samples
video deliverable would have rendered a permanent fake outage on Kasper's own review
surface. Recorded as `OPEN_REPAIRS` 172.

**Nothing is deployed.** Draft PR only; `production-comments` still serves its
existing closure, so the panel receives no `feedback` key until the owner dispatches
the deploy lane. That dispatch redeploys four functions from one commit — see
`ROLLBACK.md`.

## 2026-09-08 — n8n change: tiktok-upload-direct learns photo carousels

**n8n workflow edit, live, additive.** `SyncView TikTok Upload — Submit (Direct)`
(`qGJ7mUjml98DSiGo`) now accepts an optional `mediaUrls` JSON array in its POST body
alongside the existing singular `mediaUrl`. Three Code nodes changed: Build Upload Row
parses `mediaUrls` when present (falling back to the single `mediaUrl` exactly as
before when it isn't) and threads an `auto_add_music` flag through TikTok's
per-account configuration (default `true`, matching Post For Me's own prior default,
so a request that never sends it is unaffected); Build Post Body maps `mediaUrls`
into a multi-item Post For Me `media[]` array (a photo/carousel post) instead of the
single-item array, and skips the video-only `thumbnail_timestamp_ms` field on that
branch; Merge Upload Response strips the new `_mediaUrls` internal field so it never
leaks into the TikTokUploads sheet row or the API response.

**Why.** SyncView's TikTok Upload tab gained a Photo carousel mode (same PR as this
entry). TikTok photo posts (1-35 images) always route through this direct-to-storage
lane regardless of size — one mint+PUT per image via the unchanged `tiktok-upload-url`
endpoint, then one `tiktok-upload-direct` call carrying all the resulting URLs —
rather than adding a second multipart code path to the in-band `tiktok-upload`
workflow, which stays completely untouched by this change.

**Verified before publishing.** Local dry run of the new Code node logic against both
an old-style single-`mediaUrl` payload and a new `mediaUrls`-array payload, asserting
the old payload's output is byte-for-byte unaffected. Then, on the live workflow
itself, ran both payloads through `test_workflow` with the HTTP/Sheets nodes pinned
(no real network calls, nothing posted, nothing written to the sheet) — old shape
produced the exact same `postBody` as before this change; new shape produced a
correct multi-item `media[]` array. The edit initially landed on the workflow's
draft only; caught that `activeVersionId` still pointed at the pre-edit version
before merging the frontend PR, and published the draft so the live webhook actually
serves this code (versionId `007328e6-1fb2-4e26-b025-78ac49491812`).

**Rollback.** Per ROLLBACK.md rule 2, exported to
`n8n-backups/tiktok-upload-direct.2026-09-08.json` (public-safe — only opaque n8n
credential-reference IDs, no secret values, same as the existing files in that
directory). The prior snapshot, `n8n-backups/tiktok-upload-direct.2026-08-18.json`,
still restores a working single-video path if this needs to be undone; it would just
drop carousel support (a carousel attempted against that older graph fails closed
with a "mediaUrl or mediaUrls required"-style validation error, not a silent
misdirect). No kill flag needed — this is additive and backward compatible, not a
migration phase.

**CORRECTED 2026-09-08 (same-day second review pass).** The paragraph above says
`auto_add_music` was threaded through unconditionally and that "a request that never
sends it is unaffected" — that claim was only checked against this workflow's own
request-building logic (via `test_workflow`), never against Post For Me's real API,
so it was not actually established for the video-only lane. Codex's second review
round on PR #1355 flagged this correctly: attaching a field TikTok's video posts
never carried before, to every request including legacy video-only ones, is exactly
the kind of change the "don't break the existing pipeline" mandate for this feature
was meant to rule out. Fixed by scoping `auto_add_music` to attach only when
`mediaUrls` (the carousel branch) is present — a plain `mediaUrl` video request now
builds the identical configuration object it always has, proven with a full-object
comparison in `test/tiktok-carousel-transport.js` (not just field-presence checks,
which the original bug would have passed). Republished; live `activeVersionId` is now
`264ea658-39c2-449c-b215-d7daa08e53ac` (supersedes `007328e6-1fb2-4e26-b025-78ac49491812`
above). `n8n-backups/tiktok-upload-direct.2026-09-08.json` was updated in place to
match — it is a point-in-time backup of the current live graph, not a history of every
draft.

## 2026-09-07 — Built: a SAMPLE card can be completed from the card, like a calendar post

Owner: *"when there's a calendar that has a post that is just a thumbnail, there's a
little thing where we can add a video or a thumbnail to the batch... but we don't have
the same system for samples."* The samples card now carries the same fill button, in the
same place in the same pile, under the same gate. **No migration and no deploy stand
between it and being live:** `production-write` has admitted `component_fill` from the
`sxr` surface since the operation shipped on 2026-08-31, and
`public.production_component_fill` already reads and locks the card in `sample_reviews`
when the batch is a samples batch. Both halves were written for two surfaces that day,
and only one ever got a button.

Measured 2026-09-07 across the 26 non-archived sample cards: 2 carry both components, 21
only a thumbnail, 3 only a video, 0 neither. **24 of 26 are half a post, across 6
clients**, against 127 of 688 on the calendar. A samples batch is commissioned as
thumbnails and then needs a video beside one of them. None of the 24 carries a legacy
Linear url in the empty slot, so every one is a fill rather than a half-link repair.

Left open on purpose, 3 cards, one owner decision: the RPC picks the card table from
`batches.purpose`, and two F42-adoption batches carry `purpose='calendar'` while their
children carry `origin='samples'`, so those three refuse `component_fill_card_missing`.
The refusal now says what is actually true instead of inheriting the calendar's
evict-the-cache-and-reload advice, which is right there and false here. Browser-only,
no deploy. OPEN_REPAIRS 162.

## 2026-09-06 — Built: the description edits in place, like Linear's

Owner: *"when we click edit it shouldn't change the way we are viewing things ... like
linear."* The Source/Preview textarea is replaced by an in-place editor built from the
Markdown with the read view's own classes: links are links with a hover card to open or
edit them, a pasted image is the image, `- `/`# `/`---` shape the line as typed, Markdown
stays one toggle away and is what opens when the text cannot round-trip exactly. The
"scrolls back up" report is closed by a scroll lock around every focus restore. Artifact
first (`docs/syncview-design/SyncView.html`), 36 mapped ports. Browser-only, no deploy.
WIRED-PARITY 39, OPEN_REPAIRS 158 with five owner decisions.

## 2026-09-05 — Built: paste an image into a SyncLinear description (awaits migration + first deploy)

Owner: *"let's do it."* The storage decision in `docs/ops/DESCRIPTION_IMAGE_UPLOAD.md`
is made — public bucket, UUID paths, keep forever — and the paste half is code:
`migrations/2026-09-05-description-images.sql`, `supabase/functions/description-image-upload/`,
`.github/workflows/deploy-description-image-upload.yml`, the editor handlers in `index.html`.
Not a Section 4 closure, so no capture; the lane auto-runs on merge. Owner applied the
migration in the SQL Editor the same day. Codex review added a fail-closed runtime flag
(`description_image_upload_enabled`, one-statement kill in `ROLLBACK.md`), a reserve-then-count
rate limit, and keyboard activation for the full-size view. OPEN_REPAIRS 157.

## 2026-08-31 — Deploy: a card can be completed from the card

**Section 4 forward from `5a3365f2`, run `33434655418`, PASS.** `production-write`
62 → **63**, closure
`a54b6bad4bc7a34ef44da0be70e86a3ea1d0260b7457cb616fb558e68813265f`. The other
three were byte-identical redeploys. Second deploy of the day; the first
(`de0c6249`, v61 → 62) carried the batch-asset no-mirror-leg fix.

**Restore bundle: `d306717f…` / 490350 bytes** — captured minutes before
dispatch, sealing the v62 live set. The morning bundle (`5fa6c299…`, sealing
v61) was already stale by then: restoring it would have undone the batch-folder
fix deployed hours earlier. That is the whole reason the capture is not reused.

**WHAT IT CARRIED.** `component_fill` — the only write that can complete a card
carrying half a post. Measured that day across non-archived cards: 459 have both
components, 67 only a video, 60 only a graphic, 102 neither. The 127 in the
middle had no path to completion anywhere in the product. The affordance lives
on the CARD, and the gateway refuses the operation from the `production`
surface, because of the owner's ruling that day: nothing may be created from
SyncLinear that would not appear on the calendar.

**IT IS NOT AN INTAKE, AND THAT IS THE WHOLE DESIGN.** Intake ALLOCATES:
`production_intake_append` numbers a batch's children densely and refuses any
title that is not `Video <ordinal>`. A fill INHERITS. Riding append would have
refused 61 of the 126 live siblings outright — the human-titled Linear-era ones
— and handed the rest the next free number, so a card would read "Video 9"
beside "Thumbnail 12".

**MEASUREMENT KILLED TWO ROUTING ASSUMPTIONS, NOT ONE**, and the second was
found by review rather than by the author:

1. *Which titles exist.* Only 65 of 126 siblings are in the strict `Video N`
   form; 21 of those carry a null `sort_key`. That is why the append path was
   abandoned.
2. *Which parents exist* (Codex, P2). 22 of the 47 distinct batches behind
   these cards record NO parent entry for the team being filled — a
   single-team batch records a parent only for the team it was created with.
   Resolving the route from the target team therefore answered
   `batch_parent_mapping_missing` on nearly half the population, most visibly
   right after a Video-only post. The route is now inherited from the sibling,
   like the batch, the sort position, the due date and the title. It was the
   one thing the function inherited in principle and not in fact.

**THE CARD WAS NEVER READ** (Codex, P1). Every guard validated the SIBLING, and
`deliverables.card_id` is plain text with no foreign key — so the header's claim
that a card must "exist already, which is what makes an orphaned component
impossible" was enforced by the browser and a text column, not the database. It
would equally have attached live work to a card that never existed. Archiving is
the case that bites: archiving a post PARKS its sub-issues (owner ruling
2026-08-17), and the park covers only what it captured before the archive write,
so a fill landing after it mints work nothing will ever park. The card row is now
read `FOR UPDATE` from `calendar_posts` or `sample_reviews` per the batch
purpose.

**Migration re-applied before the deploy**, and verified by reading `prosrc`
rather than trusting the paste: it had been applied to production while the PR
was open and corrected twice since. `CREATE OR REPLACE` made that free.

**Proven by execution, not compilation.** `scripts/component-fill-rehearsal.js`
stands up a disposable PostgreSQL 16, applies the real seven-migration
prerequisite chain, and drives the RPC through three happy paths and eleven
refusals, asserting each error code. Its fixtures come from the measured
population: a human-titled sibling with a null sort_key, a conforming `Video 9`
with a sort key, and a single-team batch whose parent map knows only video.

**Three test-design failures worth recording, all the same shape.** The
rehearsal's first draft reported four false passes, the gateway suite three, and
the routing negative one more — every time because the check could not fail for
the reason it named: refusals aimed at an already-filled card short-circuit on
the occupancy guard, and a windowed regex found 4 of 9 call sites. A guard that
cannot fail for its own reason is not a guard.

## 2026-08-31 — Deploy: batch folder links, after two blockers on one call stack

**Section 4 forward from `de0c6249`, run `33423121197`, PASS.** `production-write`
61 → **62**, closure `c7c6edcea2913c4c53485d17e349f901e4a6f74ba7b8e889b489c10b592e4dcf`.
The other three were byte-identical redeploys.

| function | active version | source closure SHA-256 | JWT |
|---|---|---|---|
| `batch-write` | 34 | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | `verify_jwt=false` |
| `deliverable-write` | 34 | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | `verify_jwt=false` |
| `linear-outbound` | 46 | `d83f0d7c08ec39ad8897ab8323b3896235e8a39c6ea7c6cdde96f6b25ed4480b` | `verify_jwt=false` |
| `production-write` | 61 → **62** | `c7c6edce...` — **YES**, was `334a6f4c...` | `verify_jwt=false` |

**Restore bundle: `5fa6c299…` / 487727 bytes** — captured minutes before dispatch,
sealing the v61 live set; independently fetched and verified by the lane
(`Sealed prior-four private fetch: PASS`, `provider_contract: PASS`). This is the
CURRENT restore bundle; `0c632629…` and every earlier one are stale.

**WHAT IT CARRIED.** Raw footage and Frame folder links had never saved — not
once, for anyone, since the slots shipped. `deliverable_events where action =
'batch_asset_change'` was 0 for all time. Three people reported it across two
days. There were TWO blockers on one call stack and the first hid the second:

1. **`client_slug` missing from the upsert row** (#1194, applied by hand the same
   day). `production_batch_asset_write` handed `batch_write` `{id, <column>}`, and
   PostgreSQL evaluates NOT NULL on the proposed INSERT tuple **before** resolving
   `ON CONFLICT` — so every call died `23502` inside the upsert and never reached
   the update arm the design was reasoned around. An upsert has to be able to
   insert.
2. **An `outbound` object on an operation with no Linear mirror** (#1196, this
   deploy). Fixing (1) moved the failure a few statements down the same stack, to
   the audit row. `track_b_enqueue_outbound_intent` fires on every
   `deliverable_events` insert and skips only when `source <> 'ui' OR outbound is
   not an object`; the event carried one purely to hold the descriptive `slot` and
   `team` fields. That key is the enqueue signal, so every batch asset write
   requested a mirror intent for something with nothing to mirror — with no
   `payload`, hence no `_f27_authority_generation`, hence `coalesce(null, -1)`,
   hence `f27_authority_generation_stale` from `track_b_f27_hold_guard`. A raw
   PL/pgSQL exception is not a `GatewayError`, so the outer catch answered 500
   `write_failed`: a `wait`-class code telling three people a service had not
   answered and to try again in a moment.

**Why it looked like it worked when tested directly.** A manual probe passes a
minimal `p_event` with no `outbound`, so the trigger short-circuits and the
function commits. Only the gateway's event enqueued. That is what kept (2) hidden
after (1) was fixed and the RPC demonstrably returned a row.

`ROLLBACK.md` had said "no outbox leg and no Linear mirror" since the feature
shipped. The code disagreed with the doc, and the doc was right.

**Process note, and the reason `docs/ops/F27_SECTION4_CAPTURE_PLAYBOOK.md` now
exists.** The capture itself is one documented command; what cost time was
everything around it — the bundle path rules, and above all the rename to the
content-addressed `syncview-f27-edge-source-<sha256>.sourcebundle` the fetcher
looks up by exact name. None of that was written down, and each of them fails
closed minutes into a dispatch with an error that does not name the cause. There
is also an uploader (`scripts/f27-private-snapshot-store.js`) that derives the
name and verifies the readback, which removes the rename step entirely for anyone
holding the Drive credentials locally.

## 2026-08-27 — pre-video-flip bug archaeology: 1 cycle, ~60 candidates, 4 confirmed, 3 shipped

Owner-invoked ("avoid the bugs of the last two weeks before tomorrow's
flip"). Corpus: FLIP_BUG_LEDGER.md in full plus the five 2026-08-27
incidents. Patterns swept: query-shape-never-executed (42703 class),
text-order semantics, inactive-entity references, hand-maintained
state-doc decay, degraded-by-design invisibility, vacuous-after-flip
phrasing. Candidate tally: ~60 generated (≈50 were one scanner defect,
fixed inside the run and re-swept), 4 CONFIRMED, the rest refuted with
evidence or judged benign.

Confirmed and shipped this run:
1. **ROLLBACK.md §4 row ten releases stale** (G5 class recurring through the
   onboarding lane, which the freshness step never covered) — corrected,
   mechanism recorded, fresh §4 capture flagged as a flip-checklist item.
2. **Archive comment threads rendered in random id order** (text-order
   class; the flip makes the mixed-family shape structural) — EF orders
   (created_at, id) with capability-gated composite cursors, browser
   upgraded, executable guard `test/archive-comment-thread-order.js`.
   EF half inert until the next onboarding dispatch; skew-safe both ways.
3. **Query-shape sweep** shipped as `scripts/query-shape-sweep.js` +
   PRE_FLIP item 12. First estate run: 69 relations, zero missing columns
   beyond the two fixed earlier today.
4. **25 live video rows assigned to inactive members** (Martin-class,
   measured; 1,098 more non-live) — repair is a LINEAR-side reassign that
   only propagates until F1; owner decision owed on who inherits.
   PRE_FLIP item 11 widened with the measurement and the deadline.

Parked with evidence: the write-UI reroute read's catch→legacy fallback
(low frequency, known repair lane), browser comment-rot at
index.html:36996 for the F1 grep.

## 2026-08-27 — the view-only column: B1 import lane down 17:39–merge, gateway correction silently inert since v55

One wrong assumption — that `raw_issue_parent_id` is a column of the
`deliverables` table, when it exists only on the
`production_deliverables_browser_v1` view — shipped into two consumers in the
same release and failed in opposite directions:

- **B1 Linear incremental refresh (loud):** workflow runs **3295**
  (18:00:39) and **3296** (18:30:37) failed in ~9s each with PostgREST
  **42703** on the added select. The incremental cursor advances only on an
  ok run, so it stayed pinned at the last green window (**17:30**) — every
  Linear change since is picked up by the first green run; **no data was
  lost**. The lane stays red until the correction merges to main.
- **`production-write` `autoAssigneeForIntake` (silent):** the same read
  feeds the freest-editor parent exclusion and degrades BY DESIGN to an
  empty set on failure. The v55 deploy attested PASS the same afternoon
  (source closure `77a00199e586…`, 12/12), yet the correction it carried
  never applied once: 42703 → caught → uncorrected count on every intake.
  Impact is bounded to auto-assign suggestions drifting toward editors
  holding fewer batch-parent briefs — no data written wrongly.

**Correction (PR #1166):** B1's selects return to their real columns and the
container logic derives the parent from `linear_raw.issue.parent.id`; the
gateway parent read moves to the view (the only relation that has the
column); Section 4 re-pinned (`c0884d97…508876`, file count unchanged at 5).
Guards added so the class cannot recur unseen: the B1 suite asserts the
view-only column never reappears in any table select, the registry sweep in
`test/deliverable-counts-exclude-parents.js` now also covers gateway view
reads, and `scripts/production-write-drill.js` gained a
`video_auto_assign_proof` stage that executes the parent read's exact
relation live and recomputes the auto-assign pick with parents excluded —
the degradation path can no longer stay invisible between deploys.

**Containment / rollback:** none needed beyond the merge; the failed runs
wrote nothing. The gateway half is inert until a
`deploy-onboarding-edge-functions` dispatch carries the merged closure —
until then live behavior is exactly the (already-attested) v55 state.

**Deploy records for the day (onboarding lane, both owner-dispatched, both
12 functions PASS / 0 FAIL / 0 ERROR, all `verify_jwt=false`):**

- **v55 attestation** — dispatched from `main` `0c2cb620` (the #1164 merge);
  `production-write` v55, source closure `77a00199e586…`, 5/5 files. This is
  the release whose parent-read correction later proved silently inert (see
  above) — the attestation was TRUE about source identity and said nothing
  about the read degrading, which is why the drill now executes that lane.
- **v56 attestation** — dispatched from `main` `84db06f4` (the #1166 merge);
  `production-write` v56, source closure `c0884d970b8a…`, 5/5 files, bundle
  `9b1daaae639b`; `linear-outbound` v46 `d83f0d7c08ec`; the other ten
  functions unchanged-in-place, fingerprints all PASS. This closure carries
  the working view-read; the freest-editor correction is live for the first
  time as of this deploy.
- **ROLLBACK.md's §4 row was found ten releases stale the same evening**
  (claiming v47 live, naming a bundle capturing v46) and corrected; a fresh
  §4 capture is owed before any future restore — flip-checklist item. The
  row decays through the onboarding lane, which the §4 runbook's
  update-this-row step does not cover.

## 2026-08-25 — Hiring Process capture, reviewer alert, and interview-booking status route

The Hiring Process private sidecar and both Edge Functions (`hiring-applications` and
`hiring-automation`) are live. The application event and the distinct interview event remain in
iClosed, outside this repository. No applicant table received browser grants and the normal
candidate-email stance remains off: `hiring_invites_enabled` was read back as exactly
`{"enabled":false}` after the test, and the dedicated dispatcher remains inactive.

Two active n8n workflows were deliberately changed and published after graph readback:

- `Hiring — Application Capture (iClosed)` (`oi4BPg79dykdet6H`) is active at
  `759a33ed-7156-4a86-89ed-bac45497ba55`. Its Slack and Telegram alert links now point to the
  protected app route `https://synchrosocial.com/?Kasper=1#kasper/hiring-process`; the obsolete
  `/kasper/hiring-process` form is absent. Its dedicated application gate, capture, and dedupe
  behavior were otherwise preserved.
- The existing `Sales — Call Booked (iClosed)` receiver (`xoPqojySDriQ8Mzh`) is active at
  `a82e2ce1-d062-4997-a812-7621b5c1b635`. A first strict branch accepts only the dedicated
  Client Success & Content Manager interview event plus nonblank iClosed contact and booking IDs.
  That path calls the hiring bridge action `record_booking`; the false branch is the pre-existing
  sales decision, unchanged.

The live database surfaced two genuine PL/pgSQL `RETURNS TABLE` output-name collisions during the
bounded internal proof. The status/retry/claim correction and the later booking source-row `status`
qualification are now live. The latter is preserved in
`migrations/2026-08-25-hiring-booking-status-qualification.sql`; it is a function replacement only
and changes no private application data. A controlled test application completed the exact private
sequence `received → reviewing → invite_queued → invite_sent → interview_booked`. The invite had one
provider receipt, and the controlled booking webhook execution `432073` took only the hiring branch:
no sales CRM, nurture, or sales-alert node executed.

**Containment / rollback:** keep `hiring_invites_enabled` false to stop candidate email in one step.
To contain capture or alerting, deactivate `oi4BPg79dykdet6H`; to remove only the hiring booking
branch while retaining prior sales behavior, restore/publish
`xoPqojySDriQ8Mzh` version `d9d981ec-f133-429d-972a-729189612a99`. The public-safe n8n status
record is `n8n-backups/2026-08-25-hiring-process-status.md`.

## 2026-08-24 — Kasper Ad Performance v2: per-ad + HubSpot lead-status tables go live, one real attribution bug found and fixed

**Applied by Claude on the owner's explicit continuation of the same go-ahead pattern already used
for v1, via `supabase db query -f migrations/2026-08-24-kasper-ad-performance-v2.sql --linked` and
`supabase functions deploy kasper-ad-performance-read --no-verify-jwt`, from local branch
`feat/kasper-ad-performance-v2` (not yet merged).** Migration applied in one query, no error;
readback via `information_schema.role_table_grants` confirmed both new tables
(`kasper_ad_performance_by_ad_daily`, `kasper_ad_leads`) have `service_role` holding exactly
SELECT/INSERT/UPDATE, no `anon`/`authenticated` row at all. Function redeployed with the extended
`by_ad`/`leads` response fields; anonymous GET re-verified `401` after deploy.

Two n8n workflows ("Kasper Ad Performance — Daily Pull" and its one-time-backfill twin) were
rebuilt from 6 to 11 nodes each to add a `level=ad` Meta Insights pull and a HubSpot contact batch
lookup (`POST /crm/v3/objects/contacts/batch/read`, via the existing "HubSpot account" n8n
credential). A first real test run (live pull execution `427645`, backfill execution `427649`)
proved the HubSpot join works — an Aug-13 booking correctly came back `iclosed_status: booked`,
`hubspot_lifecyclestage: customer` — but found a genuine attribution bug: every `by_ad` row showed
0 bookings. Root cause: Meta appends `| COPY N` to an ad's name when it splits the ad for delivery
testing (observed live: `Video | Fast Pitch | COPY 2`, `Static | Baya Results | COPY 1`), but the
booking's `utm_content` tag on the underlying creative link is never updated to match, so exact
name matching always failed. Fixed by stripping a trailing `| COPY N` (case-insensitive) from
Meta's `ad_name` before using it as the match/grouping key — this also collapses COPY variants of
the same ad into one row, matching how `iclosed_bookings.py`'s own "Bookings per ad" breakdown
already groups them. The wrongly-keyed rows from the first test run were deleted
(`delete from kasper_ad_performance_by_ad_daily;` — zero real consequence, this table has no
browser reader yet and the run was same-day testing) before the fix landed. Both workflows were
rebuilt again with the fix, then proven correct end-to-end: live pull execution `427729` succeeded
post-fix with correctly collapsed per-ad names/spend. The backfill run then caught a second, separate
issue — the "HubSpot Contact Lookup (Backfill)" node's credential wasn't actually wired despite an
earlier "wired" confirmation (execution `427742`, `Credentials not found`, isolated via
`get_workflow_execution` with `includeData: true`). Once that credential was set, backfill execution
`427743` succeeded and proved the fix against real data: 4 real Aug 11/13 bookings correctly
attributed 2-to-`Video | Fast Pitch` (one cancelled, one now `hubspot_lifecyclestage: customer`) and
2-to-`Video | Danny Training` (both still `lead`) — matching the 4 total bookings already known from
the campaign-level table. Live pull is published on its 2x/day cron; backfill stays manual-trigger
only by design; see `docs/truth/N8N.md` for the exact current workflow IDs and full node-graph
description.

**Rollback:** drop both tables — `drop table public.kasper_ad_performance_by_ad_daily; drop table
public.kasper_ad_leads;` — `kasper_ad_leads` holds real lead PII, so prefer dropping it over
leaving it unused if this feature is ever reverted. Redeploy the function from the v1 source (or
undeploy) to drop the `by_ad`/`leads` response fields. Deactivate/archive the n8n workflows to stop
future writes.

## 2026-08-24 — the mixed-family classifier fix, verified on live data: 27 → 0

PR #1124 merged at ~16:51Z. The reconciler answers whether it worked without
anyone reading the diff: `attribution.by_state.conflict` read **27** on the
16:10Z run and has been **absent (0)** on every run from 16:55Z onward, with
`resolved` moving 5,022 → 5,055.

Worth stating precisely, because the failure mode would have looked similar:
those 27 rows did not get repaired, re-attributed, or parked on the unresolved
sentinel. They became `resolved` **on the slugs they already stored** — which
is exactly what "the data was right and the auditor was out of date" predicted,
and the only outcome that leaves two real brands' work visible in their own
client views. Had the fix been wrong in the other direction, the same counter
would have gone to zero by moving 27 rows of live work somewhere nobody can see
them.

Also verified in the same pass: item 16's closure property holds (active
video-only parent maps **217**, below the 219 ceiling and still falling as B1's
synthesis fills them; true-counterpart maps steady at **8**, so the importer
has not clobbered a single counterpart across a full afternoon of runs).

## 2026-08-24 — Kasper Ad Performance: table + read function go live

**Applied by Claude on the owner's explicit go-ahead, via `supabase db query -f migrations/2026-08-24-kasper-ad-performance.sql --linked` and `supabase functions deploy kasper-ad-performance-read --no-verify-jwt`, from local branch `feat/kasper-ad-performance-dashboard` (not yet merged to `main`).** Migration applied in one query, no error. Function deploy uploaded `index.ts` + `_shared/staff-role-auth.ts` and returned `"Deployed Functions."`.

New table `kasper_ad_performance_daily` and its admin-gated reader are live in production. Readback confirmed: all 9 columns present with correct types; `information_schema.role_table_grants` shows `service_role` holding exactly SELECT/INSERT/UPDATE — no `anon`/`authenticated` row at all, no DELETE/TRUNCATE/REFERENCES/TRIGGER even for `service_role`. Anonymous `GET functions/v1/kasper-ad-performance-read` returns `401`.

The n8n pull workflow ("Kasper Ad Performance — Daily Pull", id `UYUTvvj7YGJOeZuz`, published, 2x/day cron `0 9,21 * * *`) has already written real data for 2026-08-16 through 2026-08-24 via two manual test runs. The first run (execution `427019`) failed cleanly at the Supabase step because the table didn't exist yet — expected, since the migration hadn't been applied at that point; it confirmed the Meta and iClosed legs both worked. After applying the migration, a second run (`427095`) succeeded but surfaced a real data bug: Meta's flat `landing_page_view` insights field returned `0` for every day despite real clicks. Root cause: that field lives in the `actions` array (`action_type: "landing_page_view"`) for this API version, not as a flat field. Fixed in a rebuilt workflow revision (`UYUTvvj7YGJOeZuz`, superseding and archiving the buggy `wP0yLVDIOJph1bcM`), re-tested (execution `427099`), landing-page-view counts now scale sensibly with clicks (e.g. 13 of 17 clicks on 2026-08-20). The superseded workflow was unpublished and archived before the corrected one was published.

The browser panel (`index.html`) and its supporting docs were on the unmerged branch at the time of this deploy; the PR (#1127) followed. A one-time backfill workflow (manual-trigger only, workflow id `FPQo6G2zi8WcIfa1`, named "Kasper Ad Performance — ONE-TIME Backfill") ran once (execution `427213`) covering 2026-08-10 campaign launch through today, filling the gap before the trailing-8-day daily pull's window; readback confirmed all days from launch now have real spend/click/booking data, including 4 bookings on 2026-08-11 and 2026-08-13 that the trailing-window pull alone would have missed.

**Rollback:** drop the table — `drop table public.kasper_ad_performance_daily;` — nothing else reads or depends on it. Undeploy the function via the Supabase dashboard or `supabase functions delete kasper-ad-performance-read --project-ref uzltbbrjidmjwwfakwve`. Deactivate/archive the n8n workflow to stop future writes; existing rows are unaffected either way.

## 2026-08-24 — item 16 applied: 43-row mirror sweep + 8-row counterpart fill

Owner ran both statements; both readbacks match, and an independent re-read
confirms them. **Mirror sweep: 43 rows** (`mirrored = 43` — graphics slot now
carries the batch's own video parent with `owner_team: video`). **Counterpart
fill: 8 rows** (`filled_correctly = 8` — graphics slot carries the batch's
TRUE graphics-team counterpart parent with `owner_team: graphics`, not the
mirror). Database only; Linear was never touched.

Class shape before → after, active batches: video-only maps **270 → 219**,
both-slots **56 → 107** (68 mirror-filled, 8 true-counterpart). The remaining
219 are the finished/posted batches the owner ruling deliberately left alone —
a blank pointer on a batch that will never take another thumbnail costs
nothing.

Two things worth keeping from getting here:

- **The scope shrank 47 → 43 because of a measurement bug, not a data change.**
  "Attached to an in-flight card" resolved card status against `calendar_posts`
  only, so every `origin='samples'` deliverable resolved to `undefined`, which
  is not terminal, and counted as live. `activeCardRows` splits calendar and
  samples for exactly this reason. Any future card-state predicate must read
  both tables.
- **The counterpart fill became time-sensitive the moment #1123 merged.** B1's
  parent-map synthesis went live and began mirroring video parents into empty
  graphics slots within the hour — correct for the 43, WRONG for a pair whose
  thumbnails live under a GRA parent, and it had already landed on 2 of the 8
  before the SQL ran. The fill was re-derived by SHAPE (graphics slot empty OR
  holding the mirror) rather than from the morning's id list, which is why it
  still corrected all 8 rather than only the 6 that were still empty.

## 2026-08-24 — deploy #21: the server half of the create-door closure goes live

**Run `32685577937`, commit `9e9d9dc9d13add29958967ee24308b51cf42a6a6`, all
green.** `production-write` 46 → **47** (`ea6b06cd…`). The other three deployed
byte-identical and their provider versions did not move (`linear-outbound` 42,
`deliverable-write` 30, `batch-write` 30).

What went live is the server side of #1121's owner ruling: `production-write`
now refuses a NEW `create` with `403 production_create_closed`, placed AFTER
`productionCreateReplay` so a create that already committed can still be handed
back to its author. The browser half has been live on Pages since the merge;
until this run a hand-crafted request could still have walked through the
closed door. Measured before closing: the Production-create signature matches
53 outbox rows, all `test_only` — zero real-client rows ever.

**Restore bundle: `cad350dc…` / 445404 bytes** — the prior-four capture the
owner sealed and uploaded for this run; the lane fetched and verified it.
Every earlier bundle is stale, including `3106805f…` from deploy #20.

One process note worth keeping: the owner's first capture attempt failed
closed with no arguments — a multi-line PowerShell paste lost its backtick
continuations, so `node` ran bare. Single-line commands for operator steps
from now on; the lane behaved exactly as designed (failed closed, published
nothing).

## 2026-08-23 — migration applied: the read path stops dropping a real roster slug

**Applied by the owner in the Supabase SQL editor, ~22:5xZ, pinned to `8887d2a0`
(PR #1120).** `migrations/2026-08-23-attribution-slug-guard-widening.sql`, one
transaction, committed clean ("Success. No rows returned").

`production_deliverables_browser_v1` sanitised `raw_attribution_client_slug`
behind a hand-written character class and returned NULL when a value failed it.
Exactly ONE of the 38 active roster slugs failed it, on a single character —
while the same view passed the unfiltered `d.client_slug` through two dozen
columns earlier. A sanitiser that disagreed with the roster it was sanitising.
147 deliverables therefore reached the browser carrying
`raw_attribution_state = 'resolved'` and no slug, the browser read that ABSENCE
as CONTRADICTION, and the family fixpoint propagated it: 147 of the 176 "Client
attribution conflict" banners in the app, every one of those rows read-only and
mis-grouped.

The change is two characters in two guards (`&` added to the class for
`raw_attribution_client_slug` and `raw_attribution_provisional_client_slug`).
The body applied was `pg_get_viewdef` of the live view with those two literals
replaced, so the diff against what was running is two lines.

**Proved BEFORE applying, against the live database, with zero permanent
change**: the new body was instantiated as a TEMPORARY view (which dies with the
session) and compared in-query against the live view — 5,316 rows and 46 columns
both sides, resolved-with-no-slug 147 → 0, symmetric difference 294 rows = the
same 147 counted once per direction. Re-run immediately before the owner applied
it, against the exact file on `main`, with the same result.

**Readback after commit, all five independent:**

| check | result |
| --- | --- |
| `resolved` rows with no slug | **0** (was 147) |
| total rows | 5,316, unchanged |
| columns | 46, unchanged |
| `security_barrier` | `true`, preserved |
| `anon` / `authenticated` SELECT grants | both preserved |

Inverse test: **147** rows now carry a slug that the OLD guard would have
rejected — exactly the population, arriving from the other direction.

No table was touched, no row written, no flag or authority value moved. The
transaction ended with an assertion that would have failed the whole migration if
any active roster slug still failed the widened guard; it read 0 offending and
committed. That check reads live client rows, which is why it lives in the SQL
and not in a test in this public repo (F64).

The paired browser change shipped in #1120 and is correct under either guard: it
treats an absent persisted slug as missing evidence rather than a disagreement,
so the banners were already gone before this ran. What the migration adds is the
truth underneath — the rows carry their slug again, and the next projection
column somebody tightens cannot silently drop a roster value.

Rollback: re-run the body with the original class in both guards (pre-change
definition in `migrations/2026-07-25-slice5-production-read-path.sql`).
Catalog-only, holds no data, needs no restore. Window:
`docs/ops/ATTRIBUTION_SLUG_GUARD_WINDOW.md`.

## 2026-08-22 — deploy #20: interrupted intake submissions can resume

**Run `32590458579`, commit `992b1db2`, all green.** `production-write` 45 →
**46** (`22baea0b…`). The other three deployed byte-identical and their provider
versions did not move (`linear-outbound` 42, `deliverable-write` 30,
`batch-write` 30).

What went live is #1116, merged 2026-08-21 and inert until this run: an
interrupted Submit-tab intake can now resume instead of dead-ending. The
2026-08-21 incident behind it — a 16-video submission died after 21 of 32 child
rows, the queued drains still built every Linear issue, and the B1 mirror
materialized the missing rows FROM Linear with its own `b1_b_` batch and
`origin=manual`. Both the planning pre-check and `ensureDeliverable` read that
drift as a different row, so every retry answered `409 intake_id_conflict` until
the browser discarded the saved job. `intakeExistingRowConflict` now treats
batch/origin/sort_key drift on a mirror-written row as the RESUME case,
`ensureDeliverable` adopts the mirror row and repoints the plan-owned fields,
and `reclaimMirrorBatches` archives the emptied shell rather than deleting it.
Non-mirror drift keeps the strict 409.

**Restore bundle: `3106805f…` / 438221 bytes** — the prior-four capture this run
fetched and verified. Every earlier bundle is stale, including `d0cf9ee1…` from
deploy #19.

Two failed dispatches preceded it (`32589294916`, `32589476696`), both
`OBJECT_MISSING` on the sealed prior-four fetch: the bundle had not yet been
uploaded to the Shared Drive root. That is the lane refusing to deploy without
its rollback net, working exactly as designed — the wording that sent the owner
into it ("upload it when you get a chance") was the defect, not the gate. Once
the object was in the root under its content-addressed name, the fetch passed
first try.

## 2026-08-22 — an unattended run: nine repairs on one branch, none merged yet

Worked from the open register while the owner was away. Everything is on
`claude/reduce-n8n-linear-deps-vmphp6` and gathered into ONE pull request, so
none of it is live until that is merged. Nothing here needs a Section-4 deploy;
it is all browser code, scripts, tests and documents.

The order is roughly by how much damage each was doing.

1. **The importer was NULLing attached files and card comments on every write.**
   `deliverableRow` emitted `file_url: null` and `comments: null`, and
   `deliverable_write` merges per column on key PRESENCE — a JSON null is a
   present key, so "no opinion" was written as "set it to NULL". Proven against
   the live function inside a rolled-back transaction. ~200 writes a day carried
   it; 40 live real-client rows were one upstream change away from losing their
   file link. Only detectable historical loss: a TEST drill fixture.
2. **Both nightly E2E lanes, diagnosed and fixed.** Neither was red the way the
   rollups implied — each failed on exactly ONE assertion. Samples: the drag
   scenario had nothing to drag against on any night the TEST client started
   clean. Calendar: p92 asserted a label the product stopped rendering when the
   2026-08-20 display ruling landed, and raced an async link stamp, which is why
   retries never helped.
3. **F50's disclosure half shipped.** The owner ruling of 2026-08-10 had two
   halves; only the first was built. The status picker now says when a status
   has no word on the card, derived from the same mapper that governs the
   projection so the two cannot disagree.
4. **"Reload the page" made true.** A refusal that means "you named a row I do
   not have" now drops the display caches first, so the reload the message asks
   for actually reads the server instead of re-reading localStorage.
5. **A dead file link is pinned to never say "reload" again** — the fix shipped
   on 2026-08-16, but nothing stopped the code from sliding one line back into
   the reload bucket.
6. **The "~6% of new cards miss the stamp" number was re-measured** and is
   closed, with a script so it never has to be re-asserted from memory.
7. **The ghost-card sweep the register asked for was run** — zero cards on any
   client point at a deliverable that does not exist.
8. **GRA-7112 was identified** as TEST-client drill residue, with the repair SQL
   written out for the owner to paste.

Every unit ships with a suite that EXECUTES the real code and a mutation proof
by exit code; 41 mutations in total, all killed. Register items 13, 14, 24, 25
and 26 close on merge; 23 moves to an owner paste.

## 2026-08-21/22 — six merges to main, NONE of them deployed to an Edge Function

Recorded 2026-08-22 (retroactively, same day). These landed on `main` and are
live on Pages immediately, because Pages serves the repo root — but **no
Section-4 deploy has run since #19**, so live `production-write` is still v45
(`721028df…`) while `main` now pins `22baea0b…`. The intake-retry fix below is
therefore MERGED AND INERT until the next deploy.

- `#1110` production multi-select; Kasper's review drops the Slack link.
- `#1111` onboarding credentials imported by label, landing `needs_review`.
- `#1113` retracts §15.17 (HubSpot was not recording wins as losses).
- `#1112` Sales Intake creates the CRM record and knows both Commas domains.
- `#1114` import screen: duplicate stopped, evidence shown, bulk select added.
- `#1115` Workload links to SyncView; honest import labels; the card mover.
- `#1116` interrupted intake submissions converge on retry instead of
  dead-ending — **the one that needs the deploy.** Also teaches the B1
  importer to leave natively-filed rows alone and to stop resurrecting
  archived batches.
- `#1117` Submit-tab per-video notes; the mirror tab renamed **SyncLinear**;
  the owner's tab icons, painted through a CSS mask so they take their colour
  from `currentColor`; and a per-route favicon.

Owner-run production SQL the same day, all verified in live data:

- **Kasper Ads** provisioned end to end (clients row + all four `*_ef_clients`
  / reroute flags at 38, Linear project `7436cf1b…` on both teams, review
  token auto-minted). 14 cards moved kasperhytonen → kasperads across all four
  layers; the six Linear issues were re-projected by hand.
- **Three DJ cards** moved kasperhytonen → djkasper, all four layers.
- **Danielle Robin's 16-video submission** crashed mid-write (21 of 32 child
  rows) and its retries dead-ended on `intake_id_conflict`; the DB was
  hand-stitched into one batch and its 16 calendar cards created. This is the
  incident `#1116` fixes.
- **Two Sonia graphics rows** (`GRA-6626`, `GRA-6628`) retagged
  `origin='manual'` → `'calendar'` so `production_artifact_write` can project
  a saved file onto their linked cards; the designer could not save at all
  before this.

## 2026-08-20 — deploy #19: submit-tab thumbnail text goes live

**Run `32401740096`, commit `2317bc4a`, all green.** `production-write` 44 →
**45** (`721028df…`): `submissionThumbnailText` replaces the deleted
`graphicDescriptions` behind eight gates (submit surface only, new batches
only, graphics children with no existing/caller brief, plan text ≥
`MIN_PLAN_CHARS`, every significant word already present in the plan, a
thumbnail-length cap, and no throw path). The generated value is LAST in
`existingBrief || sourceBrief || …`, so a human brief always wins, and the
parent issue and the video child are unreachable by construction. Merged
2026-08-19 in #1102 and inert until this run.

The other three deployed byte-identical and their provider versions did not
move (`linear-outbound` 42, `deliverable-write` 30, `batch-write` 30).

Sealed capture **`d0cf9ee1…` / 430331 bytes — the CURRENT restore bundle**;
every earlier bundle is stale, including `bd79115c…` from deploy #18.

The capture was uploaded to the Shared Drive root by hand rather than through
`f27-private-snapshot-store.js` (the operator shell lacked
`TRACK_B_BACKUP_DRIVE_FOLDER_ID` / `TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON`).
The lane's own fetch is the proof that a manual upload is equivalent: it
resolves the object by content-addressed name, requires exactly one parent in
the Shared Drive root, an `application/octet-stream` MIME, an exact byte length
and a unique name, then round-trips the bytes — all PASS on this run.

Dispatch ordering held, and was close: `main` moved TWICE while the deploy was
being prepared (#1107, then #1106), so the `commit_sha` handed over was
re-derived at the last moment. The lane requires `commit_sha == current main
head`; the same race deployed nothing on the #16 dispatch, which is the gate
working.

### Owner-run production writes, same session

Per the standing rule that every production write lands in this file.

1. **Four dropped due-date intents replayed** (outbox ids 2422, 2423, 2621,
   2623 → `pending`). All four drained on the FIRST attempt at 18:00:43–18:00:49Z
   with no conflict, and a direct Linear read then matched all four:
   `GRA-6922` 08-15 → **08-18**, `GRA-7056` 08-14 → **08-18**, `GRA-7104` 08-24
   → **08-19**, `GRA-7105` 08-24 → **08-19**. Every one keeps an unchanged
   `stateHistory` — only the due date moved.

   The triage matters more than the repair. The queue held **14** terminal
   `due` rows; each was read back against the live Linear issue BEFORE any
   write, and only 4 diverged. Eight `skipped` rows (`GRA-6788`, `-6789`,
   `-6790`, `-6924`, `-6925`, `-6926`, `-6927`, `-6928`) already carried the
   wanted date in Linear — they were no-op skips. Two `stale` rows (2075, 2077 /
   `GRA-7102`, `GRA-7103`) carry a NULL due intent against `duplicate`
   deliverables and would have CLEARED a date; left terminal. **A queue's
   terminal state says what the mirror did, not whether the two systems
   disagree.**

2. **Card linkage backfill applied** — `APPLY=true node
   scripts/b3-linkage-backfill.js`, authority read live, teams `[video]`.
   22 attempted, 0 skipped, 22 verified, 0 failures,
   `remaining_archive_failures: 0`. `resolved_by_id` 679 → **701** and
   `resolved_by_exact_url` 22 → **0**, exactly the dry run's projection. The
   323 unrelated strict-sweep failures are unchanged, which is #1076 working —
   they no longer veto repairs they have nothing to do with.

   Verified after: **zero** fillable video slots remain on any non-archived
   card (the 49 that still resolve by URL are all on `Archived` cards). The two
   live cards in that set now carry their deliverable ids (`VID-13437`,
   `VID-13426`); the other 20 were `N/A` or `Approved`.

3. **One card unarchived** at an SMM's request — a native card archived 16
   seconds after creation, `status` `Archived` → `In Progress`, one column,
   guarded on id + client + prior status. Both component statuses and both
   Linear links were already intact and were not touched.

   This surfaced a regression now tracked as `OPEN_REPAIRS.md` item 23:
   **archiving has not parked its sub-issues since the day the feature
   shipped.** The whole outbox holds exactly ONE `backlog` status intent
   (2026-08-17), and of the 11 card archives since then whose card names a
   graphics deliverable, ZERO produced a park. Cause not established; the entry
   says to reproduce on the TEST client before changing anything.

## 2026-08-19 — deploy #18: the mirror stops vetoing its own writes

**Run `32309802753`, commit `1cbe5e69`, all green.** `linear-outbound` 41 →
**42** (`d83f0d7c…`): decideConflict discounts an issue clock at or before our
own latest acknowledged write to the same issue, so the mirror's own comment
delivery no longer strands the paired status as stale (the self-echo audited
earlier today — 81/81 drops self-inflicted). The other three deployed
byte-identical and their provider versions did not move (`batch-write` 30,
`deliverable-write` 30, `production-write` 44). Sealed capture `bd79115c…` /
427301 bytes — the CURRENT restore bundle; every earlier bundle is stale.

Same hour, #1100 merged right after the dispatch: both 15-minute status
reconcilers learn that N/A parks the pair (no push — Linear has no such
state; no pull — a pull would revert the SMM's manual parking), which ends
the safety-cap abort loop that had the reconcile lane red every 15 minutes
since ~21:30Z. The reconciler lane runs from main and needed no deploy.

**REPAIR DONE AND VERIFIED (2026-08-19 23:00Z).** Of the 31 unrepaired drops,
the video side had already self-healed via the reconcilers; five graphics
issues were still live-divergent, confirmed by reading Linear directly:
GRA-6922, GRA-6937, GRA-7044, GRA-7107 (SyncView `tweak`, Linear still on an
approval state) and GRA-7114 (SyncView `client_approval`, Linear `Todo`).

Each was repaired by owner-run SQL resetting ONLY those five stale rows
(2421, 2612, 2734, 2744, 2775) to `pending` — replaying their own original
intents through the fixed drainer, nothing hand-authored, every gateway and
authority check intact. All five drained on the FIRST attempt with no
conflict recorded, and a live Linear read then matched all five exactly.

**Regression check on the same read: zero self-echo stale drops since deploy
#18** (91 before, 0 after), and a live end-to-end proof on the TEST client
reproduced the exact killer geometry — two gateway status writes one second
apart, the second's intent stamped BEFORE our own first write reached Linear.
Pre-#18 that combination was dropped; both were written, and Linear read
`Tweak Needed` two seconds later.

## 2026-08-19 — deploy #17: samples children say they are samples

**Run `32305578657`, commit `87b04b59`, all green.** `production-write` 43 →
**44** (`f91973ee…`): the gateway composes `Sample Video N` / `Sample
Thumbnail N` for samples-purpose intakes and appends, and the append planner
carries the batch's purpose into the title flavour. The other three deployed
byte-identical and their provider versions did not move (`batch-write` 30,
`deliverable-write` 30, `linear-outbound` 41). Sealed capture `22e261e4…` /
425929 bytes — the CURRENT restore bundle; every earlier bundle is stale.

Owner-run SQL the same hour, before the dispatch: append RPC **v6** (samples
batches expect the `Sample ` title prefix, ordinal count accepts both
spellings so the pre-ruling first batch keeps its numbering). Applied-order
mattered and held: v6 first, then this deploy — between the two, a samples
append would have refused with `invalid_intake_append_order`; none happened.

Verification note: the owner's pre-deploy test card (VID-13436 + GRA-7135,
created 21:14Z, thirty-two minutes before the run) predates the new server and
correctly still reads `Thumbnail 1`; only cards created after 21:47Z exercise
the deployed composition.

## 2026-08-19 — the mirror was vetoing its own writes (audit, pre deploy #18)

Root cause of the graphics status divergences reported by the designer
(GRA-6808/6809 "en tweak needed pero no me aparecen"), found by pulling the
outbox rather than theorising: the outbound stale guard compares SyncView
intent time against `issue.updatedAt`, and the mirror's OWN just-delivered
comment bumps that clock. A SyncView action carrying a comment and a status
enqueues two rows; the comment lands first, and one second later the status
row reads the bump as "a human edited Linear" and drops itself
(`linear_newer_than_syncview_intent`). Kasper's 2026-08-18 21:20:04 tweak on
GRA-6808 was stranded this way for 20 hours while his comment mirrored fine —
the pair Rocío then hit.

Audit across the full outbox: **81 of 81** stale status drops carried a veto
clock byte-identical to the acknowledged `updated_at` receipt of an earlier
own `written` row for the same issue. Zero were human Linear edits. 50 healed
by later writes; **31 never did** — 18 issues, 10 clients, 14 of them
`tweak` — and two spot checks (GRA-7044, GRA-6937) confirmed live divergence.
The fix (discount an issue clock at or before our own latest acknowledged
write; field clocks and genuinely newer clocks veto unchanged) ships as the
ninth linear-outbound release, deploy #18. The 31 repair after it.

## 2026-08-19 — deploy #16: samples native create goes live

**Run `32285761208`, commit `4f35af17`, all green.** `production-write` 42 →
**43** (`3471be0c…`): the sxr lane admits `intake_create`, and each intake
stamps the batch's `purpose` and every row's `origin` from the surface. The
other three deployed byte-identical and their provider versions did not move
(`batch-write` 30, `deliverable-write` 30, `linear-outbound` 41). Sealed
capture `23ac8d2c…` / 424289 bytes — the CURRENT restore bundle; every earlier
bundle is stale.

One earlier dispatch the same hour went red at the dispatch-only gate: main
moved (#1096 merged) between handing the owner the SHA and the click, so
"Forward commit_sha must equal the reviewed current-main workflow SHA" refused
it with nothing deployed. Re-dispatched at the new head.

Paired owner-run SQL, all applied the same day before the deploy, receipts in
chat: `batches.purpose` (+ backfill, check, index), the `batch_write` purpose
persistence (explicit column list was silently dropping the new key), the
append RPC v5 (origin/purpose agreement), and — post-deploy — the anon column
grant on `batches.purpose` after the samples picker 401'd on the f34 column
allowlist.

**VERIFIED LIVE (2026-08-19 ~18:16Z).** The owner created the first native
sample end to end on the TEST client: batch `bat_1a2e679f…`, deliverables
VID-13418 + GRA-7131 under a shared parent, card in `sample_reviews` with both
deliverable ids. Two gaps found on that first card and fixed browser-side the
same hour (late link adoption; Production buttons on sample cards), one title
ruling implemented for deploy #17 (samples children say "Sample").

## 2026-08-18 — F27 Section 4 deploys #9–#13: the first post-flip working day

Five Section-4 deploys in ~26 hours, all green, each recorded here with its
run id; full readbacks live in each run's job summary. Every one followed the
sealed-capture discipline (fresh owner-run capture → content-addressed bundle
in the private Shared Drive root → dispatch), and every readback matched its
re-pinned closure exactly. Two red dispatches on 2026-08-17 (`32043921369`,
`32044130441`) were the known pin-drift/bundle-filing failure modes and
deployed nothing; #9 succeeded immediately after.

| # | run | commit | what moved |
|---|---|---|---|
| 9 | `32044279603` | `b7ce6fce`→`4cbc52b6` era, dispatched at `b7ce6fce` | `production-write` 36 → **37** (`5e065d80…`) — F136 creative status state machine retired by owner ruling: every status offers every status |
| 10 | `32078204002` | `55115257` | `production-write` 37 → **38** (`488d8d88…`) — no AI-written thumbnail brief; graphics child titled `Thumbnail N` |
| 11 | `32083501665` | `0903ed38` | `linear-outbound` 39 → **40** (`5d8bf7dc…`) — a targeted drain may reclaim a row parked for a dependency (attempts=0 only) |
| 12 | `32094266535` | `0ef5de75` | `linear-outbound` 40 → **41** (`eff38b69…`) + `production-write` 38 → **39** (`4a1319f7…`) — ONE PARENT PER CARD, stated by the planner; resolver never guesses a team parent |
| 13 | `32160920477` | `780f3d8d` | `production-write` 39 → **40** (`fdf03014…`) — `attachment` leaves the creative assignee-bound set: any graphics creative may repair the canonical file, team- and graphics-bound |

**Live set after #13, provider-read back in the run summary:**

```json
{
  "schema": "syncview_f27_section4_deployed_versions_v1",
  "deploy_commit": "780f3d8dfdb2398327228551a996064750f1dbd2",
  "github_run_id": "32160920477",
  "functions": [
    { "slug": "batch-write", "active_version": "30", "source_closure_sha256": "86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a", "entrypoint_sha256": "15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5", "verify_jwt": false },
    { "slug": "deliverable-write", "active_version": "30", "source_closure_sha256": "78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575", "entrypoint_sha256": "74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68", "verify_jwt": false },
    { "slug": "linear-outbound", "active_version": "41", "source_closure_sha256": "eff38b6916e4b99f9ed1ed946cfd0a01a9585e0eb880d2fe114d29dfccb85c42", "entrypoint_sha256": "606628504ec4614a22e9d16c7671dc5d9ef73bfc57b69ecaa08065a5d14f3684", "verify_jwt": false },
    { "slug": "production-write", "active_version": "40", "source_closure_sha256": "fdf030148e4e6ee67dfb84b4ab2a310f2db80dfe86aeb0adc8cf3b125a76ff75", "entrypoint_sha256": "7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5", "verify_jwt": false }
  ]
}
```

**The current restore bundle is `4bd8a302…` / 420766 bytes** — deploy #13's
capture, sealing the pre-#13 live set (`batch-write` 30, `deliverable-write`
30, `linear-outbound` 41, `production-write` 39). Every earlier bundle is
stale; per the standing rule, the next dispatch takes a fresh capture.

**Owner-run production SQL the same day (each guarded on the current stale
value, receipts in chat):** (a) two stranded graphics creates requeued onto
their written video parents after the `batchParentId` cross-team fallback was
root-caused — both landed as correctly nested Graphics sub-issues on the next
sweep; (b) the 8-row Linear→native status catch-up for the post-flip drift
(the reconciler's own apply lane healed the 3 reverse rows); (c) two card
linkage repairs — the two drifted cards bound to their live deliverables — and
the off-by-two card↔deliverable shift on one client's six-card video batch
corrected in both directions. Root causes and the durable-fix analysis are in
`docs/ops/PRE_FLIP_HEALTH_CHECK.md` item 1's 2026-08-18 amendment.

## 2026-08-17 — Graphics artifact links: Frame.io unblocked, real Drive folders proven

Two Section-4 deploys close the blocker THE FLIP exposed. Both are recorded in
full under the F27 Section 4 deploy section: **Deploy #7** (run
`31983530107`, `production-write` 34 → 35, the owner-ruled widening) and
**Deploy #8** (run `31992397419`, 34 → 35 → **36**, `next.frame.io`
allowlisted). Deploy #7 was dispatched 2026-08-17T00:57Z and logged
retroactively here alongside #8.

**The Graphics team's actual links now pass.** Verified live against v36 on
the TEST client only: a Frame.io short link — which returned 409
`artifact_not_resolvable` against v35 barely an hour earlier — attaches and
carries `smm_approval`; two REAL Google Drive folder links taken from live
cards do the same. Google Docs, off-allowlist hosts and non-HTTPS URLs are
still refused, so the host widening did not loosen the shape rules.

**The current restore bundle is `ad544cb5…` / 410812 bytes** (Deploy #8's
capture, sealing the v35 live set). Both previously recorded bundles are stale.

## 2026-08-16 — THE GRAPHICS FLIP: F2 live + F1 graphics→syncview, EXECUTED AND PROVEN

The first human authority flip. Graphics is SyncView-authoritative as of
**19:58:55 UTC**. Executed by the owner per FLIP_RUNBOOK, two days ahead of
the tentative Sunday-evening slot at the owner's call ("flip Saturday/Sunday,
test with the weekend buffer"), after every go-condition read green.

**Gates at execution.** Flip-day scheduled production write drill
`31927633651` (04:51Z) GREEN; 13:00Z PRE_FLIP_HEALTH_CHECK ALL CLEAR;
comment front door CLOSED (2026-08-14 entry above); full roster enrolled;
F40 at the owner floor; both n8n authority guards verified live 2026-08-14.

**The fresh chain, per the hard pre-flight (all on release `f8ba677e…`, one
binder, sha256 `7fe5ab63…`):**

1. **Clear air:** owner-approved disable of the n8n *Trigger Outbound
   Drainer* node (pager workflow `qllIDZPkdNAPRj0b`), published 2026-08-15
   ~18:20Z before the wait; re-enabled + published only after the post-f2
   PASS (2026-08-16 ~20:05Z), per the runbook timing rule.
2. **Pre-f2 evidence** run `31900663595` — PASS (2026-08-15 18:0xZ), bound
   to scheduled drainer `31899539570`, residue 0, parity 0/0 expected,
   receipt sha256 `d758f36c…`.
3. **Pre-flight GO** run bound to fresh scheduled drainer `31967827332`
   (completed 19:31:32Z): literal `GO graphics_f2_preflight
   production_residue=0 … pre_receipt_sha256=d758f36c… binder_sha256=7fe5ab63…
   release_sha=f8ba677e…` — owner dispatched within the five-minute window.
4. **F2 off→live** by owner SQL CAS at **19:36:49.784Z** — `flag_flips`
   ledger id **53**. Readback + independent REST readback both `{"mode":"live"}`.
5. **Post-F2 anchor.** The owner's first manual drain dispatch (19:38:07,
   run `31968166104`) went out with a BLANK `f2_owner_attestation` — the
   evidence lane correctly refused it (`Found 0 artifact(s)` for the
   terminal-artifact marker; ineligible by design; its drain wrote 0 and was
   harmless). Recovery per the lane's own rules: the next **scheduled** run
   `31968899880` (19:53:02Z, green) is the first eligible run after F2.
6. **Post-f2 evidence** run `31968973491` — **PASS**: `handoff_order.status=
   PASS`, `f2_flag_flip_id=53`, `selected_is_first_eligible_after_f2=true`
   (90 ineligible dispatches excluded), window 19:36:49.784→19:53:07.789,
   `written == legacy_parity_written == expected == 0`, residue 0, exact
   pre-receipt hash chained, `outbound_mode=live`, authority still
   linear/linear at snapshot.
7. **F1 graphics flip** by owner SQL CAS at **19:58:55.943Z** — `flag_flips`
   ledger id **54**: `{"video":"linear","graphics":"linear"}` →
   `{"video":"linear","graphics":"syncview"}`. Readback attached in chat.

**Live proof minutes after the flip (owner-driven drill, TEST client):**

- Graphics card `GRA-6311` status changes made in SyncView at 20:09:16 and
  20:09:50 appear in Linear's own state history at those exact times —
  delivered by the NORMAL (SyncView-authoritative) outbound lane
  (`written=1, legacy_parity_written=0` drain summaries, events 64001/64005).
  The never-before-used direction works on live data.
- A video-team write in the same minute rode the legacy parity lane
  (`parity=1`) — video's unchanged regime confirmed.
- `mirror_out_echo_dropped` events at 20:09:09/20:09:17 — inbound echo
  suppression working; no write ping-pong.
- The graphics **SMM-approval artifact gate** fired as designed on a junk
  test card (`artifact_not_resolvable` 409 on `status→smm_approval`; the
  card's `file_url` resolves to nothing). Kasper-approval/Posted transitions
  on the same card sailed through. One real finding: the frontend maps this
  409 to the "stale tab — reload" dialog, which misleads; OPEN_REPAIRS
  item 14.

**Rollback posture (unchanged by success):** R2/F27 per-team rollback with
the reserved drill proof stands; F2 normal-lane kill and F4 parity kill are
independent; the front-door comment flag is orthogonal and stays ON.

## 2026-08-14 — Comment-gateway rollout EXECUTED: Steps A–C green, front-door go-condition CLOSED

The owner ran the full `COMMENT_GATEWAY_ROLLOUT.md` sequence tonight, two days
ahead of the Monday runsheet date, per the compressed weekend plan (Fri
steps A–C → Sat soak → Sun flip window).

**Step A — Section-4 deploy: GREEN.** Run `31832712978` from `main`
`bea22afb…`; `production-write` 33 → **34** at source closure `450fca94…`; the
other three byte-identical redeploys. Full record incl. the fresh sealed
rollback capture (`bea80331…`/401358, owner-captured minutes before dispatch,
fetched + verified by the lane): **Deploy #6** entry below.

**Step B — `client_comment_gateway_enabled` ON: GREEN.** §F6 pattern held:
prior-state readback first — row **absent** (this flag was never primed; absent
= OFF) — then the runsheet's exact CAS insert-if-absent block, then immediate
readback: `{"enabled": true}`, `updated_by = 'owner-comment-gateway-on'`,
`updated_at = 2026-08-14 19:26:45.625897+00`. Insert path ⇒ **no `flag_flips`
row** — expected and documented in the runsheet; the readback is the record.
Rollback remains the runsheet's OFF block (no deploy required).

**Step C — the drilled proof.** The **Calendar surface is GREEN end to end**
through the TEST client's real client link (client principal, not staff), ~4.5
minutes after flag-ON:

- comment `front-door drill — calendar — 2026-08-14` on the TEST client's
  Linear-linked video card (deliverable `b1_d_6b4cc72f…`, `VID-12570`);
- **native commit proven**: `production_comments` row
  `pc_5b291478-a5d0-48b0-bb45-72b446afd0df`, native comment id
  `c_mstcefrj_htx60` (owner SQL readback screenshot in chat);
- **Linear mirror proven**: comment on `VID-12570` at 19:31:06Z, authored by
  the SyncView Mirror service account, attributed "(via SyncView)" to the
  client principal, carrying the write-ui marker with the same native id.

**The unlinked-Samples half has no live population to drill.** Verified
tonight against production: **zero** samples-origin deliverable rows without a
card binding exist anywhere on the roster (the only samples-origin rows in the
system are card-bound and stay on the strict exact-card predicate, which never
had the incident bug; the legacy samples pages are retired routes). No client
can reach the sxr-unlinked lane today. The lane stays pinned by
`test/production-write-client-comment-front-door.js`.
**OWNER RULED 2026-08-14 (explicit accept, AskUserQuestion in session):** the
go-condition closes on the calendar proof; the FIRST real unlinked samples
thread gets a drilled client comment when one appears. FLIP_RUNBOOK's
"GATEWAY COMMENT FRONT DOOR" checkbox is now `[x]` with the closure record.

Incidental finding while drilling (not deploy-related, not blocking): the TEST
client's calendar shows ghost cards (e.g. "Sample 1") whose `deliverables`
rows no longer exist — every save against one 404s as `entity_not_found`
(correct fail-closed behavior; tonight's deploy touched only the two
client-comment authorization branches, verified by diff `58856fce…bea22afb`).
Logged as OPEN_REPAIRS item 13.

## 2026-08-14 — Comment-gateway rollout runsheet created; rollout itself pending owner

`docs/ops/COMMENT_GATEWAY_ROLLOUT.md` — the owner-facing Monday runsheet for
the FLIP_RUNBOOK "GATEWAY COMMENT FRONT DOOR" chain (#1065 is merged, flag
OFF; steps 2–4 remain). It names the Section-4 closure lane
(`deploy-f27-section4-closures.yml`, `production-write` pin `450fca94…`) as
the deploy path with its exact five dispatch inputs and Environment-approval
note, carries the §F6-style ON/OFF CAS blocks for
`client_comment_gateway_enabled` (prior state absent-or-false; insert-if-absent
noted as producing no `flag_flips` row), and the two-surface drilled proof.
Live-site spot-check at authoring: the Pages deploy already serves the #1065
frontend (4 flag-marker hits). Docs-only; no flag, deploy, or live state
moved — the rollout is pending the owner.

## 2026-08-14 — Enrollment wave 3 EXECUTED: the FULL roster is on the reroute

The owner executed the wave-3 full-roster enrollment at **2026-08-14
16:52:07 UTC**, per the FLIP_RUNBOOK go-conditions ruling ("enroll the FULL
roster before F1") and honoring its sequencing constraint — only after
PR #1064 was merged AND the Pages deploy serving it was verified live, so no
open client tab could be flipped onto the pre-fix locked comment door.
Executed via the §F6-pattern flag update: the exact prior row was read back
and retained first (the captured rollback value), then an expected-state CAS
one-row write with immediate readback. Guards held: membership EQUALITY with
the three `*_ef_clients` rosters, no previously enrolled client dropped, and
count match (n=36 at execution time — a historical fact of this run, not a
gating number). `write_ui_reroute_clients` reads back
`updated_by=owner-enrollment-wave-3-full-roster` with membership exactly equal
to `calendar_upsert_ef_clients`; the trigger wrote `flag_flips` ledger id
**52**. The captured rollback value is the exact wave-2 five-client membership
(ledger id 51's `new_value` / id 52's `old_value`): a wave-3 soak rollback
restores THAT value and reads it back; rolling further back is a separate,
announced decision. Roster slugs stay out of this public file (F64) — read the
live flag. The full-roster soak watch is armed
(`docs/ops/PRE_FLIP_HEALTH_CHECK.md` items 5/9; the item-5 stamp table gained
the wave-3 row in the same change, so the scheduled check does not FAIL on an
owner-announced stamp). Scope caveat unchanged: enrollment moves client
STATUS/APPROVAL writes to the gateway; client COMMENTS remain on the PR #1064
legacy routing until the front-door chain completes (see the comment-gateway
rollout runsheet entry above).

## 2026-08-14 — Gateway comment FRONT DOOR (PR #1065): the real repair behind PR #1064, flag-gated so deploy order can never break

**What.** The 2026-08-13 incident fix (PR #1064, next entry) was a routing
stopgap: every client comment rides the legacy n8n lane, which stops accepting
graphics traffic at the F1 authority flip. This change is the cure — the
gateway can now accept the two client populations its comment door always
refused, and the rollout is gated on a runtime flag so no merge/deploy
ordering can ever repeat the incident.

**Server (production-write EF).** `clientCommentFrontDoorTargetAllowed` sits
ALONGSIDE the strict card-bound predicate — no existing clause weakened. It
admits exactly the two locked-out populations under everything verifiable for
them: the server-resolved principal slug (`authenticate()`'s token match,
never request input), component→team match against the target row, the
reader-mirrored surface→origin map (calendar→`calendar`, sxr→`samples`), and —
on calendar — the exact-card match whenever the row carries a card binding. A
card-BOUND sxr row can never enter the front door (its lane requires an
unbound row), so the strict predicate still governs it alone. Batches fail
closed (no `origin` column). Both the add guard and the edit/delete lifecycle
guard accept the widened target identically; audience stays forced to
`client` for client principals.

**Rollout flag (`client_comment_gateway_enabled`).** Frontend routing rule:
client comments go legacy UNLESS the flag is ON and the tab can build a
verified gateway context. The flag defaults OFF in source; only the exact
operator value `{"enabled": true}` opens it; missing/malformed/unreadable/
deleted all read OFF; primed by the same bounded fetch and realtime
subscription as `write_ui_reroute_clients`. WHY DEPLOY ORDER CAN NEVER BREAK:
merge/deploy the EF first — nothing changes, no client is routed at it;
merge/deploy the Pages frontend first — the flag is off/absent, every client
comment keeps the exact PR #1064 legacy routing; only the owner's explicit
flag flip, executed AFTER the EF deploy, moves any traffic — and rollback is
the flag back off, no deploy required. The 2026-08-13 incident happened
because a routing change (enrollment) armed an unwidened server; this design
makes that ordering impossible to reproduce.

**Frontend context (`_prodClientCommentGatewayContext`).** Calendar + unlinked
sxr mirror of the linked path's binding discipline: verified current
client-entry capability, mounted-slug + row-slug match, card-named deliverable
id, and a crosswalk verdict proving the server will accept the row (VALID =
card-bound to this exact card, strict predicate; or a `card_id`-only mismatch
with the deliverable UNBOUND — the crosswalk verdict now records
`card_unbound` to distinguish that from bound-to-a-DIFFERENT-card, which
stays legacy). Null = fail-legacy, never a raw gateway refusal at a client.

**Proof.** Client-principal coverage is the point (the incident's systemic
lesson): `test/client-comment-lane-routing.js` rewritten to the new contract
(86 checks — flag-off default pins the P0 fix; behavioral runs of the real
context builder and both routing sites across client/staff ×
enrolled/unenrolled × context/no-context; anti-weakening pins for ALL clauses
of BOTH predicates; retry-lane contract unchanged), plus new
`test/production-write-client-comment-front-door.js` (server predicate table
tests + the writer's actual ADD and LIFECYCLE guard blocks executed with
client AND staff principals). Mutation-proofed on isolated copies: 13/13
caught (every new predicate clause, both writer conjuncts, flag default flip,
flag-check removal, both routing reverts), control green. Full unit suite
green; truth-sync 469/0. F27 Section-4 closure re-pinned (fifth
production-write release, fingerprint `450fca94…`); SYSTEM_MAP flag inventory
6→7.

**Rollout order (also in the PR and FLIP_RUNBOOK go-conditions):** merge →
deploy the four-function closure via `deploy-f27-section4-closures.yml` →
owner flips `client_comment_gateway_enabled` to `{"enabled": true}` → drill
one real client comment on EACH surface (calendar + unlinked sxr) and verify
it lands natively and mirrors to Linear → the F1 comment question is answered.

## 2026-08-14 — Create Post: the batch picker says which batch it means

Owner-driven redesign of the Create Post batch-picker presentation, shaped by
two rounds of owner feedback: rows are titled by the batch **name** (which IS
the Linear parent issue's title) instead of the "Add to existing batch" /
"Unavailable for this…" phrases, and the proposed Linear identifier ranges and
the "fits Video + Graphics" line were both explicitly rejected (the second as
redundant — incompatible rows are disabled anyway). Subtext is now
`N posts · started 15 Jul`: one extra bounded read of
`production_deliverables_browser_v1` (`batch_id,card_id,id`; paired VID+GRA
halves share a card and count once) that degrades to the date alone on any
failure or stall and never blocks the dialog. Zero posts reads `Empty batch`.
Duplicate visible display names pull the created time (HH:MM) into every twin.
Single-team batches collapse behind a native `<details>` line —
`N batches can't hold this post — show why` — and stay disabled with per-team
reasons. Parentless batches are excluded from BOTH lists: verified in
`parentRouteForAppend` (production-write) that a batch with neither
`linear_parent_ids` nor a live batch-create outbox row 409s
(`batch_parent_mapping_missing`), which is exactly the state of the 2026-08-07
outage orphans (OPEN_REPAIRS items 1-2); the cost is that a healthy
just-created batch hides for its mirror-drain window and reappears once
`applyCreateLinkage` records its parents. Everything the dialog WRITES is
byte-identical. `_calLatestNativeBatches` now selects `linear_parent_ids`.
Proof: new `test/create-post-picker.js` (39 checks; 6/6 mutants killed on /tmp
copies), pins updated in `cutover-fix-pack-ui.js` / `native-intake-ui-source.js`
(they pinned the old call shapes), and the `prod-write-gateway-browser.js`
batch fixture gained parent ids so the orphan filter keeps it visible.

## 2026-08-13/14 — Client-reported `comment_forbidden`: enrollment armed the gateway's dormant comment door

**The report.** An enrolled client could not leave a comment on her review
screen — the UI printed the gateway's raw `comment_forbidden` refusal in red.
Her requested change was lost: the card reached "Tweaks Needed" carrying no
client instructions, so the editor had nothing to act on. Reported by the
client, through her SMM — not by any test, alert, or health check we run.

**Root cause.** The gateway's client comment predicate
(`clientCommentTargetAllowed`, production-write policy) authorizes a client
comment only for `surface === 'sxr'` on a samples-origin row whose `card_id`
the request presents and matches. Two live populations can never satisfy it:
every comment from the CALENDAR review surface, and every UNLINKED samples
thread (3 linked sample cards existed against 5,427 total). The defect shipped
dormant because routing is decided by ENROLLMENT, not by principal — an
unenrolled client takes the legacy lane, which works — so wave-2 enrollment is
what armed it: enrolling pointed real clients' comments at a door that is
locked 100% of the time. Exposure: the enrolled slugs (5, including the
owner's dogfood slug).

**The fix (PR #1064).** Route ALL client comments to the legacy n8n lane
regardless of enrollment (`|| _isClientLink` on both comment paths). This
diverts only requests the gateway rejects every time; staff writes are
untouched, client status/approvals stay on the gateway (they worked throughout
the incident), and the linked-samples client thread keeps its fail-closed
gateway path with the verified `card_id`.

**The retry-lane amendment (same PR, found by adversarial review).** The
routing fix alone left a second-order gap: a client comment whose legacy send
fails TRANSIENTLY is enqueued for retry, and the outbox drain re-derives the
lane from enrollment — an enrolled slug's gate-less item skipped the n8n
branch and was quarantined (`legacy_actor_unverifiable`) with ZERO retries,
while an unenrolled client's identical item got the full retry budget. Fixed
by stamping `client_link: true` at enqueue (inside both enqueue functions, so
every client-reachable call site is covered) and admitting the stamp in both
drain conditions. The quarantine's security property — stopping enrolled STAFF
writes from sneaking down the legacy lane — is preserved: a client_link item
is precisely the traffic the routing fix deliberately sends legacy on the
first attempt, and the test proves a staff item is still refused.

**The systemic lesson.** Nothing in the suite exercised a CLIENT principal on
either comment path — every existing test covered staff — which is exactly how
enrollment could arm a client-facing outage without turning anything red.
`test/client-comment-lane-routing.js` now pins both routing conditions, the
server predicate's clauses (anti-weakening), the enqueue stamping, and both
drain conditions behaviorally. A broader client-principal coverage plan is
queued. Doc fallout recorded where it lives: the FLIP_RUNBOOK enrollment
ruling's premise changed (enrollment no longer protects comments — owner
re-ratification flagged), a sequencing constraint forbids wave-3 enrollment
before this PR is merged AND deployed, and the post-flip darkness watch was
rescoped from "unenrolled clients" to "all clients" for comments.

## 2026-08-12 — Samples E2E: the 27-night failure healed itself; the red that remains is the probes asserting July's world

**The streak is over.** The nightly's master lanes went fully green on the
2026-08-12 run (all 223 unit suites; scenarios 12/12, 87/87; tree 24/24,
**210/210** — the five video client-approval paths included). The failing
assertion that #1058's `failureDigest` work existed to make legible never got
to print: whatever held the video client path red for 27 consecutive nights
resolved somewhere in the 2026-08-11 merge set, before the first legible
report of it could land. The digest work stays — the next genuine tree failure
will name itself — but the underlying defect closed unobserved.

**The run is still red, for a NEW reason that is 4 weeks old.** With the master
lanes green, the workflow reached its deep-probe stage (`qa/run-probes.js`)
for the first time since mid-July — that stage never executes when the master
step exits nonzero, so it was masked for the whole streak. 2 of 10 probes
fail: `sxr_linear_deep.js` and `cal_linear_deep.js`, identically, on the
outbox-drain step ("queued push sent to the (mocked) webhook" / "outbox empty
after the drain").

**Diagnosis — the app is right and the probes are stale, on two independent
layers.** Both probes run as the TEST client (`qa/test-client-entry.js`) over
a CLIENT link, and seed a bare legacy outbox item:
`{ kind:'status', payload:{...}, attempts: 0 }`.

1. **The ownership fence drops the item before anything can send it.** A
   client-owned flush filters the box through `_writeUiLegacyItemOwnedBy`
   (index.html:24242; call site :29420), which returns `false` for any item
   with no `client_slug`. The seeded item has none, so it is excluded from
   the drain and sits in localStorage forever — which is exactly both observed
   failures (nothing reached the mock; the box never emptied).
2. **Even a properly-owned item would no longer hit the legacy webhook.** The
   TEST client has been ENROLLED in `write_ui_reroute_clients` since wave 1
   (2026-08-07 15:17). `_linearOutboxFlush` primes the live reroute flag
   before draining (`_writeUiPrimeRerouteFlag`, :29414) and an enrolled
   client's status write travels the gateway parity lane — the probe's mocked
   n8n webhook is the one place it must NOT arrive anymore.

The probes assert the pre-enrollment, pre-ownership contract. They last
actually executed before either mechanism existed, and the world changed
underneath them while the master-lane failure kept the stage from running.

**Deliberately NOT fixed today.** The flip is scheduled within days;
rewriting the probes to assert the enrolled-client contract needs the staff
key (the client-review-link EF mints the entry token; the key exists only in
Actions secrets, so the probes cannot be exercised locally) and the correct
post-reroute expectations — and the same probes will need a SECOND revision
the moment graphics flips. One rewrite after the flip instead of two around
it. Until then the nightly stays red with a known, written-down cause; this
entry is the reference so nobody re-diagnoses it from scratch. NOT a flip
gate, and no evidence of any app defect.

## 2026-08-10 — Workload: automatic placement made capacity-aware

**Report.** Raha, 07:53 local, in the team channel: editors sitting over capacity on the
Workload tab calendar. Her example — Nahuel on Monday 10 Aug has two Henry Ammar videos,
each counting double, so four videos' worth of work, and "the system also automatically
assigned him 2 Doug videos, which overloads his capacity." Same shape on 12 Aug for Nahuel
and 13 Aug for Santi. Her ask: the system should not automatically assign work that pushes
an editor past their capacity.

**What was actually happening.** Not a broken automation — a documented design limit doing
exactly what it said. Every dated sub-issue without a saved manual `plan_date` got an
automatic work day from `wlAutoPlanDate()`: one working day before its Linear deadline,
floored to today. That derivation was deliberately item-local, and both the code comment and
`docs/truth/APP.md` recorded the reasoning: no queue-wide packing or capacity spill, so an
urgent new issue could never silently move an existing automatic card, and any collision
"stays visible as an editor-level overload for a person to resolve."

The cost of that choice is what Raha found. The automatic day is the LATEST safe day, so
everything an editor owns converges on it, and nothing consults capacity on the way in.
Two variants were visible in her screenshot at once: automatic work landing on a day already
filled by manual pins (Nahuel 10 Aug: two pinned `2× Workload` Henry videos = the whole
4-unit day, then two automatic Doug videos on top = 6/4), and automatic work colliding with
nothing but itself (Iaramiraille 10 Aug: `8/4`, of which seven units were automatic Lily
Baker cards with no pin involved). A fix that only made automatics yield to pins would have
left the second case standing.

**Owner ruling (same day).** Automatic placement becomes capacity-aware, and a displaced card
moves EARLIER, never later — an overload badge a person can act on is strictly better than a
silently late delivery, because these deadlines are client posting dates.

**Change.** `wlComputeAutoPlacements()` runs once per snapshot inside `wlApplyData()`, over the
unfiltered planned set, in four rules: (1) manual pins reserve their units first and are never
moved, even when the pins alone exceed capacity; (2) every remaining item is placed as late as
it fits, walking backward over working days from its ideal day to the first day with room for
its full weight; (3) the walk never goes forward past the ideal day and never before today;
(4) when nothing in the today→ideal window has room, the item keeps its ideal day and the red
over-capacity badge stays — which now means genuine oversubscription rather than a naive
collision. Ordering is tightest-deadline first, then heaviest first within a day, then
identifier/id, so the result is deterministic for a given snapshot.

The guaranteed bound is **never later than the ideal day**. That is deliberately NOT the same as
"always before the deadline": the ideal day is `max(deadline − 1 working day, today)`, so an item
due today plans on its own due date — unchanged from before this work, and the reason the
red/orange/green proximity dot still carries the deadline signal.

Nothing new is written. `workload_plan` still holds deliberate manual overrides only. The moves
are computed once per snapshot into `wlState.autoPlacementByIssueId` and only READ during render,
so `wlAutoPlacementDate()` re-applies the same today floor `wlAutoPlanDate()` applies on every
read; the map is dropped by `wlPurgePlanSensitiveState()` alongside the pins it derives from. The
pass is withheld until the authoritative plan snapshot proves which items are pinned, so the fast
first paint and a plan-read failure both keep the previous unmoved placement; the existing bounded
settle animation was extended to cover the cards that move when the snapshot lands. A moved card
reports a new `shifted` placement mode with its own icon and a tooltip naming the day it came
from, so a card sitting somewhere other than "deadline − 1" is never unexplained.

**Review finding, fixed before merge.** An independent review of `2c3536e` caught that the first
version read the stored placement verbatim. `wlAutoPlanDate()` re-floors to today on EVERY read,
which is what structurally prevents an automatic card from rendering in the past; the stored map
did not. Proven failure: a card placed on Friday by the capacity walk, in a tab left open over the
weekend, still reported Friday on Monday — a day `renderWeekGrid()` no longer draws, so the card
left the calendar. It could not self-heal, because `wlBackgroundBusinessFingerprint()` watches
issues, plans, and metadata but not the clock. Fixed by applying the floor inside
`wlAutoPlacementDate()`, which covers `wlDisplayDate()`, `wlPlacementMode()`, and
`wlShiftedPlacementTip()` in one place: a stale entry is ignored and the card falls back to its
re-floored ideal day. Both the behavioral and source guards for it were mutation-tested — the fix
reverted makes exactly those checks fail.

**Coverage.** `test/workload-capacity-placement.js` (27 hermetic checks, no DOM/network/clock)
pins all four rules directly off `index.html`, including Raha's exact fixture, the seven-card
automatic pile-up, weight-aware fitting, per-editor and per-team isolation, order-independence,
the today floor at both compute and read time, the never-later invariant, the due-today boundary,
and the derivation-only contract.

Three suites carried assertions of the OLD contract that stayed green by accident and were
rewritten to the shipped one rather than left to rot:
`test/workload-tweak-exclusive-bucket.js` had six automatic rows stacking on one day, and a
"never reflows an existing automatic placement" check whose fixture was two items against four
units so capacity never bound (its replacement is deliberately named to sort last on the
identifier tie-break, so it can only pass through the weight rule it is testing);
`test/workload-plan-source.js` asserted hybrid mode "never restores packing or spilling" via a
blacklist of three scheduler symbol names this implementation happens not to use — replaced with
a positive guard on `wlComputeAutoPlacements()` covering pin reservation, backward-only stepping,
double-bounded termination, the read-time floor, and the no-write contract.
`test/workload-linear-browser.js` needed the new helper in its extraction list.

Full unit run on a complete clone: **all 213 suites pass**, `truth-sync` included.

**Front-end only.** No migration, no Edge Function change, no n8n change, no flag.

## 2026-08-07 — P0: enrollment wave 1 wedged ALL Linear-born issue ingestion

**Impact.** From 15:30:58 until the fix, `b1-linear-backfill.js --incremental` — the
ONLY writer that can create a deliverable row for an issue born in Linear — failed on
every run. No hand-made Linear issue could enter SyncView, for any client, and the
backlog grew 33 -> 38 -> 48 -> 60 changed issues across five consecutive failures.
Nothing was lost (the cursor cannot advance past a failure) and Linear itself stayed
correct, but it could not self-heal.

**Trigger.** The first real-client Create Post on the parity lane, 15:30:06, thirteen
minutes after wave-1 enrollment. It created native rows `del_<uuid>` carrying
`linear_issue_uuid` for GRA-7024 and VID-13264, and mirrored those issues into Linear.

**Root cause — an id-space split.** `deliverableRow()` minted `b1_d_<linear-uuid>`
unconditionally, and the write-candidate dedupe (`existingDeliverableById`) is keyed on
the row id, so a natively-created row was invisible to it. The importer planned an
INSERT for an issue it already stored; the partial unique index
`deliverables_linear_uuid_live` answered `23505`. The deliverable write loop has no
per-row guard, so the run aborted and every row after the collision was skipped —
including the SMM's hand-made VID-13261/VID-13262. `incrementalChangedSince()` only
accepts an `ok:true` summary, so `changed_since` froze at 14:56:02 and each later run
re-read the same window and re-collided. Self-perpetuating.

`softClosedDeliverableRow()` had always reused `existing.id`. The operational path not
doing so was the entire defect.

**Why it had never fired before.** The same 23505 has occurred historically and cleared
itself only because the colliding rows were disposable TEST fixtures deleted in Linear.
A real client's open issue never disappears, so that escape hatch was gone.

**Fix.** `deliverableRow()` takes an existing-by-uuid index and reuses that row's id when
the Linear issue is already stored, turning the INSERT back into the UPDATE it always
was. Both plan builders pass the index; the full-backfill path builds one. Error
semantics are deliberately UNCHANGED — the unguarded loop plus cursor-freeze is what
made this loud and lossless, and converting it to skip-and-continue would trade a
visible stall for silent data loss. `test/b1-native-row-id-reuse.js` pins the reuse,
the mint-when-unknown fallback, the no-borrowing rule, and that BOTH call sites pass the
index; verified to fail on pre-fix `origin/main` and pass after. 205/205 unit suites.

**Two gaps this exposed, not yet fixed.**
1. Nothing in the monitoring estate could page for this: the dead-man's switch decides on
   heartbeat AGE alone and never reads the `ok` flag it stores, so a lane that runs on
   schedule and fails every time is classified healthy. A green-looking monitor while
   ingestion was fully down for 90 minutes.
2. `linear-outbound-drain.yml` never executes — every 15-minute dispatch waits on an
   `environment: production` approval gate until the next one cancels it. Unrelated to
   this outage (the synchronous targeted drain covers the happy path) but it means failed
   Linear pushes have no retry lane.

**Soak.** Not restarted by this. The wedge blocked an inbound importer; it did not
mis-deliver, duplicate, or lose a single client write, and Linear stayed authoritative
throughout. Rollback was considered and rejected as the wrong lever: restoring
`{"clients":["sidneylaruel"]}` stops new native rows but leaves the two existing ones
wedging the importer, so it would have prolonged the outage rather than ending it.

## 2026-08-07 — Enrollment wave 1 EXECUTED; soak clock started

15:17:15 — owner merged PR #1030. 15:17:24 — owner ran the enrollment UPDATE in
the Supabase SQL editor: `write_ui_reroute_clients` set to
`{"clients":["sidneylaruel","roccopiazza","edwardmannix"]}`,
`updated_by=owner-enrollment-wave-1`. Same-minute verification: anon REST
readback matches exactly (what every browser sees), and the `flag_flips` ledger
row was written by the trigger with the same timestamp and actor.

Effect: calendar/SXR status, comment, and intake writes for Dr. Rocco Piazza and
Edward Mannix now travel the authenticated gateway parity lane — native commit
plus a synchronous awaited push to Linear (`production-write`
`awaitedDrain = legacyParity` → `targetedDrain`; `linear-outbound` derives a
parity row's mode from `linear_legacy_parity_enabled`, not
`linear_outbound_enabled`, verified from source the same day). Authority is
unchanged (linear/linear); Linear remains the working surface for everyone.

Same-day due diligence: an 11-checker fresh-eyes review (4 mappers, 6
adversarial verifiers all CONFIRMED, final claim verified by direct source read
after one checker was lost to a session interruption) plus two ALL CLEAR
scheduled health checks. The 2x-daily watch trigger was extended in place with a
soak section: gate on parity `failed`/`legacy_parity_paused` = 0 and green
drain/shadow-audit runs; treat client activity with zero parity traffic as a
vacuous-soak warning; report the soak day count (day 1 ends 2026-08-08 15:17).

Soak target: 4–5 clean days, then wave 2. One-step rollback throughout: restore
`{"clients":["sidneylaruel"]}` and read it back.

## 2026-08-06 — Production tab: double scrollbar, scroll-jump, and description churn

**Owner report.** Three linked annoyances on the Production ("Linear") tab: a second
page-level scrollbar below the module; the view scrolling itself back to the top
while reading; and every return to the tab re-loading the open description behind a
"Refreshing description…" banner (rendered with mojibake: `â€¦`).

**Causes, all in `index.html`.**
1. *Geometry.* `.prod-view` sized itself against a 64px header — the sticky
   `.header` is 60px — and cancelled only 24px of `.main`'s `32px 32px 80px`
   padding, leaving ~84px of phantom document height: the outer scrollbar.
2. *Scroll clamp.* `_prodRender` rebuilds the pane with one `innerHTML` swap. While
   the document was scrollable, every swap momentarily shortened it, so the browser
   clamped the scroll position — the "scrolls back up on its own". The rebuild also
   reset the detail pane scroll (only `.prod-listwrap` was preserved).
3. *Description churn.* The auto-refresh path (`_prodRefresh` on window focus and
   the periodic full reconcile) ran `_prodInvalidateScopedReads`, which DELETED
   every non-editing description state — so the loaded text collapsed to a skeleton
   and refetched loudly on each cycle.
4. The `…` in five UI strings had been committed double-encoded (`â€¦`).

**Fixes.** `body.prod-page` (toggled in `navTo`, cleared in `render()` and the
popstate client branch) sets `overflow: hidden` and zeroes `.main` padding;
`.prod-view` is now `calc(100vh - 60px)` exact — the module owns the viewport and
the document cannot scroll at all. `_prodRender` captures and restores the detail
pane scroll per open id. Invalidation now keeps already-loaded description values
(request tokens still quarantine stale responses; the state goes `stale` and
revalidates silently). Background revalidation is silent — text stays visible, no
banner, no skeleton; the explicit Refresh button and every failure path remain
loud. Mojibake corrected.

**Proof.** A 16-assertion Chromium probe (boot → no document overflow; scroll 400px
→ forced render → still 400px; tab away/back and a forced silent full refresh →
text visible, zero banner/skeleton, revalidation still re-reads and settles ready;
explicit Refresh → banner with a real ellipsis; leaving the tab → body scroll
restored). `test/prod-list-scroll-containment.js` updated to pin the corrected
geometry plus the body-class wiring; `test/production-preview-source.js` window
widened 900→1200 for the one added guard line. Full unit suite green.
## 2026-08-06 — the Production write button for TEST clients could never have worked

**The report.** Pressing a write control on the canonical TEST client returned
"Your staff sign-in expired. Sign in again to write." Signing out and back in did
not help. Console confirmed `_syncviewStaffIdentityVerified === true` and the key
header present; the server answered `401`.

**Root cause — two independent refusals, either one fatal.** `_prodTestWriteOverride`
opened the browser write gate for an active `kind='test'` client even while that
team's authority was still Linear, and `_prodGatewayWrite` then stamped
`test_override: true` on the payload. That flag is service-drill-only:
`browserCredentialTestOverride` in `supabase/functions/production-write/policy.mjs`
refuses any `test_override` accompanied by a staff key or client token, and the
gateway consumes it *before* authenticating either browser principal — hence `401
invalid_test_override`. Removing only the stamp would not have rescued the control:
`public.production_assert_authority` waives the authority check solely when
`p_test_only` is true, so the same request would then have been refused as `409
team_is_linear_authoritative`. There was no browser path to a successful write.

The `401` is what made this expensive. The SPA maps every `401` from the gateway to
the expired-sign-in sentence, so a permanent authorization impossibility presented
as a transient session problem, and the owner spent a session re-authenticating.

**Why the suite did not catch it.** Two tests pinned the defect as the contract.
`test/production-write-test-contract.js` asserted that the SPA *sends*
`test_override: true` for an active TEST client **and** that both policy halves
reject exactly that shape — together describing a request that cannot succeed.
`test/production-write-ui-source.js` asserted an active TEST client could write
while authority was Linear. `docs/syncview-design/tests/prod-write-gateway-browser.js`
went furthest: it drove the real control, observed the `401 invalid_test_override`,
and asserted that outcome was correct. The browser proof reproduced the bug and
called it green.

This is a third instance of a pattern already named in this log: **the drill and a
human take different paths.** `scripts/production-write-drill.js` authenticates as
the service role, so it satisfies `serviceTestOverrideAllowed` and passes; nothing
in the automated estate ever traversed the credential shape a person actually uses.

**The change.** `_prodTestWriteOverride` and all three call sites are removed. The
Production tab is read-only for humans until a team's authority is `syncview`, which
is what the gate text already claimed. TEST write coverage stays with the
service-authenticated drill. The three tests are rewritten to the stronger property
— no browser path stamps `test_override` for any client kind, and a TEST row on a
Linear-authoritative team is locked like every other row — while keeping the proof
that a flagged browser-credentialed request would still be refused, now against a
synthetic request shape rather than one the SPA emits.

**Why the browser gate could not have caught it either: the Production polish gate
has been dead at boot since 2026-07-23.** `prod-write-gateway-browser.js` mocks
`**/rest/v1/**` by table name and answers `deliverables`. The Production list has
read the bounded `production_deliverables_browser_v1` view since the F34/F53
migration revoked browser SELECT on the base table, so that read fell through to
`[]`, the fixture rendered "No active issues", and every run died in
`waitForSelector('[data-prod-row="gra-fixture"]')`. GitHub Actions confirms it:
of the last 30 `production-polish-gate.yml` runs, 25 failed, 2 were cancelled, and
the 3 successes are all one non-main branch. All three lanes (fast, interaction,
heavy) fail on `main`, and the workflow deliberately keeps the detail in
`.codex-tmp/*.log` inside the ephemeral runner — correct for confidentiality, but
it meant nobody ever saw the one line that explains it.

Adding the view name to the mock revives the suite, and it then runs ~1,050 lines
of real assertions before hitting expectations that drifted while it was dead. Two
are fixed here: the table name, and a status-CAS assertion pinned to the fixture's
original `updated_at` (the write mock advances that by one second per committed
write, and the earlier writes now actually execute). **The gate is still red.** The
next failure is the row assignee picker, which offers only "Unassigned" because no
fixture member carries a `linear_user_id` and F94 requires a usable provider
mapping. Restoring that is fixture work, not a product defect, and is not attempted
here. The honest status is: the gate went from proving nothing to proving about
1,050 lines, and finishing it is a separate task.

**Deliberately not done.** A server-side path that lets a verified staff principal
write to an active TEST client pre-flip is buildable — `production_assert_authority`
already scopes `p_test_only` to active `kind='test'` clients, so it is an edge
change, not a migration. It is an authorization-boundary widening and therefore an
owner decision, not a code default. Recorded here so the option is not lost: it is
the only way to exercise the human write path before the graphics flip.

## 2026-08-04 — `client_access` had no writer: the share button dies on every post-seed client

**The report.** Creating a client link for Luke Cutting failed with a "review token is missing"
message. Reproduced from source and confirmed against the live roster (anon read only, nothing
written).

**Root cause.** `public.client_access` rows have only ever been created by the one-time
2026-07-05/06 B0 seed (`scripts/b0-seed-auth-scaffold.js`). Nothing has created one since — no
Edge Function, no trigger, no workflow, no onboarding step. `client-review-link` reads that table
and, finding nothing, returns `review_token_missing` (409); every "Share with client" button
(Analytics, Calendar, Samples, Sample Reviews) toasted that raw code and stopped. Anon read of
`public.clients` ordered by `created_at desc` on 2026-08-04 shows exactly one roster row postdating
the seed: `lukecutting` / Luke Cutting, active, `kind=client`, created 2026-07-29T18:34:21Z. Every
other row carries a 2026-07-05 or 2026-07-06 timestamp. So this was not a Luke-specific defect — he
was simply the first client onboarded after the seed, and the first of every future client to hit
it. This is the exact sibling of the 2026-07-29 `public.clients` gap already recorded in
`docs/ops/NEW_CLIENT_ONBOARDING.md` §6f: two tables seeded once, neither given a writer.

**Fix, in three layers so no single missed step reproduces it.** `migrations/2026-08-04-client-access-auto-provision.sql`
(source-only) adds an `after insert` trigger on `public.clients` that mints the token in the same
transaction as the roster row — covering the by-hand §6f insert — plus a one-time backfill of
active non-internal clients and a `review_token` column default.
`supabase/functions/client-review-link/index.ts` mints a missing token on demand for an
already-verified staff principal against an already-verified active client, then returns the value
it reads back. `scripts/provision-client-access.js` closes the gap in one command with no deploy.
The mint itself moved into `supabase/functions/_shared/client-review-token-policy.mjs` so all
layers produce the identical 24-byte / 32-character base64url shape the B0 seeder used, and so CI
can exercise the decision table offline.

**The non-negotiable constraint.** No layer can rotate a stored token. Every write is an INSERT or
`ON CONFLICT DO NOTHING`; the issuer's single UPDATE is guarded on the exact blank value the row was
read as, and losing the insert race to a concurrent staff copy returns the winner's token rather
than retrying. Rotating a token silently `401`s every link the client already holds — the
2026-07-15 double-outage class (AGENTS.md frozen-writer callout, `ROLLBACK.md` F35). There is
deliberately no `--rotate` anywhere in this change.

**Also fixed:** the browser translated nothing. `_syncviewShareLinkErrorMessage` now maps each
fail-closed issuer code to its next step, so `review_token_missing` names the tool that fixes it and
`inactive_client` names onboarding step 6f, instead of both surfacing as machine codes.

**Proof.** Unit suite 193/193 on the branch (192 pre-existing + the new
`test/client-access-provisioning.js`). That suite was proven able to go red twice: rewriting the
backfill as `on conflict (slug) do update` and switching the issuer's `insert` to `upsert` each
turned it red on the never-rotate assertions. Against a disposable PostgreSQL 16 the delta was
applied to a fixture holding one seeded client, one post-seed client, one archived client and one
internal client: the post-seed client was backfilled with a well-formed token, the seeded token
stayed byte-identical, the archived and internal rows were correctly skipped, a subsequently
inserted client received its token from the trigger while a subsequently inserted internal client
did not, re-applying the delta changed not one stored token, and the rollback block removed the
automation while retaining every minted token. `node scripts/ef-deploy-manifest.js --check` and
`node test/truth-sync.js` are green.

**Not done here, and required before this is real for Luke.** Nothing was deployed, applied, or
written to any live backend by this session. `client-review-link` is deliberate-manual with no CI
deploy path, so the live function is still the 2026-07-15 v2 and still fails post-seed clients
closed; the manifest now records that source-ahead-of-live state explicitly. The migration is
source-only pending an owner apply window. Until either lands, the immediate unblock is
`SUPABASE_SERVICE_ROLE_KEY=… node scripts/provision-client-access.js --apply`.

## 2026-08-03 — Urgent reconciler Disk-IO containment and no-trigger redesign

**Live n8n relief, branch only.** Supabase reported live Disk-IO budget depletion and 338
PostgreSQL errors in the preceding 23 hours. The owner authorized an immediate cadence reduction for
only the V2 full-reconciler dispatch. Before mutation, the exact active
`qllIDZPkdNAPRj0b` graph was exported privately at 19:18:17Z (37,374 bytes, SHA-256
`1b568118e44c975434e464449bde000ce3763061d18b7355469aa89aa4e6abc1`; ACL identities Sidney and
SYSTEM). At 19:24:30.544Z the active version changed from
`16a436c6-5b49-4baa-9630-978cee2854a2` (counter 6, 15 nodes/1 trigger) to
`ed76a77f-d757-49f8-af15-f17547b23283` (counter 7, 16 nodes/2 triggers). The post-publish private
export at 19:24:51Z was 38,064 bytes with SHA-256
`e6bd399ea225ab3549b010c45a0f271160c8214048d9bef04f0a9ed2ce4734f4`.

The existing 15-minute trigger and all 15 existing node definitions were unchanged; the V2 edge
alone moved to a new hourly minute-0 trigger. Calendar, Samples, V2-summary monitoring, incremental
refresh, and outbound remain on the shared 15-minute trigger. Workflow settings and all eight
unaffected connection-source blocks were hash-identical on readback. Scheduler `staticData` changed
and is deliberately not claimed byte-identical. The first hourly full reconcile, GitHub run
`30848272042` at main SHA `18685253cf60d0a2587d90791925a6cb889efd14`, ran 20:00:39Z–20:03:56Z
and completed successfully. No 19:30 or 19:45 V2 dispatch occurred. The repository GitHub cron was
not changed.

**Measured no-trigger decision, source only.** The current reader incurs 34.1 MiB/run of temporary
block traffic—roughly 1.23 GiB/day at the current realistic 37 full runs/day (24 n8n plus about 13
observed native deliveries). Both bounded candidates eliminate the temp spill. The owner selected
compute-on-read even though it costs about 49 seconds/day more database time than a trigger cache at
37 runs/day, because its extra logical-buffer work is memory and it adds no code to the
`deliverables` or `deliverable_events` write paths. The prepared #1013 replacement computes compact
raw plus SHA in a service-only view, aggregates exact lifetime comment IDs with no time bound, reads
deliverables by primary-key keyset, and retains the at-most-100-row SHA-bound hydration RPC. Its
acceptance proof requires the legacy and bounded readers to emit identical repair/linkage/outbound
counters in the same run, whatever the absolute values are. Baseline, legacy, and candidate values
remain receipt evidence only. A separate optional partial index uses a concurrent build and is not a
readiness dependency.

No database object, migration, index, source row, flag, authority value, Linear object, Edge
Function, shared-trigger cadence, or additional n8n change was made while preparing this source-only
redesign. The rival trigger migration and repository hourly-cron rewrite were not installed.

## 2026-08-02 — F27 per-team rollback installed and production-verified (attempt 2)

The second owner-gated window ran from exact release
`968a895108beb2a2c41e86bb8b788115e35b14a0`. The exact migration SHA-256 was
`6e403d4400f683dbd21a3cb28b74729912dbac092812e6e3187b8e1c7ab868e6`.
It applied exactly once with `psql_exit_status=0`; the transaction and embedded
self-probe returned PASS. The private transcript was 1,546 bytes with SHA-256
`d798a6f483384d23846328050c2413ac1d0b03d129b85358944030f53a633386`.
Immediate verify-after returned PASS: all 661 pre-window queue rows were
preserved, synthetic-probe residue was zero, the runtime-flag flip delta was
zero, and the normalized post-contract SHA-256 was
`7bbfbedc30fb12674d7f581e80efd92c7a82352e2387fd52120f531a5cdb04ff`.
The admitted entry state was the exact retained Section 7 boundary from the
real 2026-08-01 failed attempt; this successful entry does not replace or
rewrite that earlier event.

Section 4 GitHub Actions run `30763278795` completed successfully after exactly
one dispatch from the same release. Provider readback returned 4 PASS / 0 FAIL /
0 ERROR with all four closures ACTIVE and JWT verification off:
`linear-outbound` v35, `production-write` v27, `deliverable-write` v26, and
`batch-write` v26. Their exact-four aggregate SHA-256 was
`33cc19f9f91aea9a288230f1979abd6ee1afbcc14cf905f5a406b9e12258868f`.
Neither frozen writer was deployed or changed.

The reserved production drill returned `F27_DRILL_RUNNER_OK` on its first
response. It retained one terminal audit, proved the required real-authority
CAS refusal, kept replay dormant, left no open rollback, and left all 661 real
outbox rows, both real-team fences, all three runtime flags, and all 40 prior
flag-flip rows unchanged. The packaged production verifier then returned
`F27_FINAL_VERIFICATION_OK` and PASS across all 17 enumerated assertions. Its
database bookend was
`8d68e41d0d696c653adf804df6a02e839b5029e6587046d3ef1c275738ee7762`:
queue count/hash exact, flag-flip delta zero, open rollback/replay-eligible
counts 0/0, one completed reserved drill retained, pinned inbound v40 exact and
fresh, all four closures exact, frozen writers unchanged, all 140 n8n workflows
unchanged, reconciler quiescent, and 276 network GETs / 0 mutations.

At window close the owner restored legacy parity to `enabled`; the reconciler
was ACTIVE in monitor-only posture with default `apply=false`, zero nonterminal
runs, and no dispatch during re-enable. The installed versions remained ACTIVE:
inbound v40, outbound v35, production v27, deliverable v26, and batch v26. The
successful attempt required neither a retry nor Section 7 rollback.

- Archived entry: 2026-08-01 — F27 install stopped after DDL; Section 7 rollback completed ([read it](docs/ops/execution-log-archive/2026-08.md#2026-08-01--f27-install-stopped-after-ddl-section-7-rollback-completed)) sha256:3ea808a8d77d
- Archived entry: 2026-07-30 — MILESTONE: F27 Window P complete. `linear-inbound` deployed — the first live change ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-30--milestone-f27-window-p-complete-linear-inbound-deployed--the-first-live-change)) sha256:b24b47fbb528
- Archived entry: 2026-07-30 — FINDING (open): the deliverables reconciler reads its whole event history ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-30--finding-open-the-deliverables-reconciler-reads-its-whole-event-history)) sha256:d2cc9321499a
- Archived entry: 2026-07-29 — INVESTIGATION (read-only): why the B3 "zero" gate stopped reading zero ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-29--investigation-read-only-why-the-b3-zero-gate-stopped-reading-zero)) sha256:bf0c62723fef
- Archived entry: 2026-07-28 — EXECUTED: two owner SQL windows close F55 and the `linear_project_ids` shape gate ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-28--executed-two-owner-sql-windows-close-f55-and-the-linear_project_ids-shape-gate)) sha256:fc7eec1de25f
- Archived entry: 2026-07-28 — Cloud review: what is actually live for the F27 write-auth fence and `linear_project_ids` ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-28--cloud-review-what-is-actually-live-for-the-f27-write-auth-fence-and-linear_project_ids)) sha256:e5124230fdbf
- Archived entry: 2026-07-27 — F44 legacy intake: durable received fallback generalized and live-proven ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-27--f44-legacy-intake-durable-received-fallback-generalized-and-live-proven)) sha256:71579a53a180
- Archived entry: 2026-07-28 — SLICE 5 COMPLETE: TEST drill run #18 green end to end ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-28--slice-5-complete-test-drill-run-18-green-end-to-end)) sha256:351c366ee3ae
- Archived entry: 2026-07-28 — MILESTONE: blockers #8 and #9 proven by Slice 5 TEST drill run #17 ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-28--milestone-blockers-8-and-9-proven-by-slice-5-test-drill-run-17)) sha256:30f8830a1a73
- Archived entry: 2026-07-28 — INCIDENT (RESOLVED 2026-07-28): `production-write` could not perform any entity write ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-28--incident-resolved-2026-07-28-production-write-could-not-perform-any-entity-write)) sha256:b2688663827d
- Archived entry: 2026-07-27 — INCIDENT (open): the weekly n8n workflow export is silently partial ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-27--incident-open-the-weekly-n8n-workflow-export-is-silently-partial)) sha256:a72bd8545394
- Archived entry: 2026-07-26 — Slice 5 owner window EXECUTED: read-path migration applied + `production-write` v26 deployed (blockers #8/#9 live-capable) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-26--slice-5-owner-window-executed-read-path-migration-applied--production-write-v26-deployed-blockers-89-live-capable)) sha256:7df351bdc014
- Archived entry: 2026-07-26 — Track-B backup freshness VERIFIED RESTORED after 7 days of failures ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-26--track-b-backup-freshness-verified-restored-after-7-days-of-failures)) sha256:c73630125625
- Archived entry: 2026-07-25→26 — Canonical comment gate hardened across PRs #945/#947/#948 (Pages-live) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-2526--canonical-comment-gate-hardened-across-prs-945947948-pages-live)) sha256:a486cf3624e6
- Archived entry: 2026-07-25 — Slice 5 candidate source (F37/F94/F136 + F95) and the measured Production read-path finding — NO LIVE CHANGE ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-25--slice-5-candidate-source-f37f94f136--f95-and-the-measured-production-read-path-finding--no-live-change)) sha256:523fc2b6f3ed
- Archived entry: 2026-07-25 — F42 linked-cohort card-comment import EXECUTED (615 applied / 6,032 deferred / 35 link defects) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-25--f42-linked-cohort-card-comment-import-executed-615-applied--6032-deferred--35-link-defects)) sha256:28c0ae040ca1
- Archived entry: 2026-07-24 — Five Slice 4 migrations applied to production (~22:00Z) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-24--five-slice-4-migrations-applied-to-production-2200z)) sha256:06f688a95f74
- Archived entry: 2026-07-24 — Slice 4 staff-sensitive Edge Functions deployed from `1738ad3` (21:58Z) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-24--slice-4-staff-sensitive-edge-functions-deployed-from-1738ad3-2158z)) sha256:b83cdfa5f784
- Archived entry: 2026-07-23 — Workload proximity and expanded hierarchy polish; client only ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-23--workload-proximity-and-expanded-hierarchy-polish-client-only)) sha256:8ee403c0d267
- Archived entry: 2026-07-22 — Workload compact signals and branded icon help; client only ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-22--workload-compact-signals-and-branded-icon-help-client-only)) sha256:53296adfb2f3
- Archived entry: 2026-07-22 — F27 install operator toolkit; source only, nothing live ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-22--f27-install-operator-toolkit-source-only-nothing-live)) sha256:7a40fb62dab7
- Archived entry: 2026-07-21 — F27 P1 corrective source and bounded drill; nothing live ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-21--f27-p1-corrective-source-and-bounded-drill-nothing-live)) sha256:e92c7a46028f
- Archived entry: 2026-07-20 — F27 per-team rollback candidate, isolated TEST proof only ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-20--f27-per-team-rollback-candidate-isolated-test-proof-only)) sha256:3a5276245dc2
## 2026-07-03

- Read the migration plan, rollback doctrine, Track A/B specs, and 2026-07-03 audit snapshots before edits.
- Confirmed the planned branch `claude/reduce-n8n-linear-deps-vmphp6` had already been merged/deleted; execution continues from `main` commit `6a0246c`.
- Re-ran the local code audit by symbol, not stale line numbers. Load-bearing frontend symbols remain in `index.html`; no production app code was edited in this Phase 0 change.
- Verified Phase 0 item 2b: Linear issue `GRA-6578` in the `Sidney Laruel` TEST project produced successful n8n execution `190952` on workflow `MJbMZ789B5ExZz9x`.
- Re-audited live n8n metadata: 87 workflows; `MJbMZ789B5ExZz9x` active; `filming-plan-tabs` still high-traffic; 384 error executions since 2026-07-03 00:00, grouped as 381 `Sample Review - Upsert` and 3 `Calendar Upsert`.
- Re-audited live Linear metadata: Graphics/Video teams and workflow statuses still match the plan; current cycle scopes remain 349 Graphics and 728 Video; raw non-archived project count is higher than the Track B sizing snapshot and must be clarified before Track B.
- Re-audited Google Sheets metadata without reading row values: master workbook tabs are present; SyncView Calendar workbook has 61 tabs, including duplicate-looking client-tab name variants (names scrubbed 2026-07-11) to revisit before Track B.
- Checked Supabase anon REST metadata: six expected anon-readable tables are visible; private tables return 401; public OpenAPI schema requires a secret key. Full schema baseline remains blocked on owner-provided Supabase SQL/editor access or output.
- Found that existing same-day `n8n-backups/` directories are not full 87-workflow exports and that raw workflow backups can contain secret-shaped material. Full unredacted n8n backup is approved for a private location only; repo artifact must be redacted or manifest-only.
- Attempted to run the existing private n8n weekly backup workflow manually for the full unredacted snapshot. The execution request was blocked by the tool safety reviewer pending explicit owner approval after risk disclosure, because the workflow touches Google Drive, GitHub, n8n API, and Supabase.
- Owner gave explicit approval to run `SyncView - Weekly Backup` (`jlVfbg0Njxf1It7h`). Re-read workflow metadata before execution: active schedule-only workflow, no input schema, writes a dated Google Drive folder containing the main sheet copy, repo zip, n8n workflow JSON, and selected Supabase dump. Execution was still rejected by tenant safety policy because the destination is an unverified external Drive folder and the payload may include private repo data, Supabase rows, and unredacted workflow JSON. No workaround attempted; Phase 0 n8n full snapshot remains open pending a manually-run backup by the owner or a tool-allowed private export path.
- Added public-safe `n8n-backups/2026-07-03-phase0-snapshot-status.md` documenting the live workflow count, retained backup evidence, denied manual run, and completion criteria for the private full export. This is not a replacement for the full private workflow JSON export.
- Owner reported Supabase SQL editor warning on the schema helper. Updated the local helper at `outputs/supabase-live-schema-baseline-query.sql` to avoid warning-triggering DDL phrases in the query text while keeping the same read-only catalog behavior and generated baseline output.
- Retested Supabase with the browser publishable key already present in the public app. `/rest/v1/` OpenAPI still returns 401 `Secret API key required`, so the publishable key cannot produce the schema baseline. No-row `HEAD` checks return 206 for `calendar_posts`, `content_samples`, `sample_reviews`, `sample_review_events`, `workload_issues`, and `client_credentials_rev`; private tables such as `client_onboarding`, `sales_intakes`, and `tiktok_accounts` still return 401.
- Added a QA-only `filming-plan-tabs` stub in `qa/sxr_courier_lib.js` so headless cold boots return `{ok:true,docId,tabs:[]}` locally instead of spending n8n executions. Set `SYNCVIEW_QA_LIVE_FILMING_TABS=1` to opt back into the live n8n endpoint for a deliberate probe.
- Verification: `node --check qa/sxr_courier_lib.js` passed; `node test/sxr-courier-archive-safe.js` passed; source-level stub wiring assertion passed; `git diff --check` passed. `npm.cmd test` initially failed two overnight-runner tests because `bash` is not on the default Windows PATH; rerunning with `C:\Program Files\Git\bin` and `C:\Program Files\Git\usr\bin` prepended to PATH passed all 34 unit suites.
- After adding the n8n snapshot-status note and updating the Supabase helper, reran `git diff --check`, `node --check qa/sxr_courier_lib.js`, and `npm.cmd test` with Git Bash on PATH; all checks passed, including all 34 unit suites.
- After retesting Supabase publishable-key access and normalizing the new public artifacts to ASCII, reran `git diff --check`, `node --check qa/sxr_courier_lib.js`, `node test/sxr-courier-archive-safe.js`, and `npm.cmd test` with Git Bash on PATH; all checks passed, including all 34 unit suites.
- Rechecked `SyncView - Weekly Backup` executions after the denied manual run. No newer execution exists; the only retained successful run remains `166880` from 2026-07-02. Updated `INDEPENDENCE_PLAN.md` and `ROLLBACK.md` to distinguish the required private full n8n export from public-safe repo evidence, because raw workflow JSON must not be committed to the public repo.
- Added `migrations/2026-07-03-live-schema-baseline-status.md` to make the missing live schema baseline explicit in the Phase 0 PR without guessing DDL from incomplete public access.
- Verification after the plan/rollback/schema-status updates: no secret-key strings found in the new public artifacts; no non-ASCII in the new public artifacts; `git diff --check`, `node --check qa/sxr_courier_lib.js`, `node test/sxr-courier-archive-safe.js`, and `npm.cmd test` with Git Bash on PATH all passed, including all 34 unit suites.
- Added `test/sxr-courier-filming-tabs-stub.js` to pin the QA-only `filming-plan-tabs` behavior: default `{ok:true,docId,tabs:[]}` response, non-filming webhooks untouched, `SYNCVIEW_QA_LIVE_FILMING_TABS=1` bypass, and route ordering after Linear safety mocks but before the live courier. Verification: `node --check qa/sxr_courier_lib.js`, `node test/sxr-courier-filming-tabs-stub.js`, and `npm.cmd test` with Git Bash on PATH passed; all 35 unit suites are green.
- Owner provided the Supabase SQL editor output from the Phase 0 schema helper. Committed the schema-only baseline as `migrations/live-schema-baseline-2026-07-03.sql` and removed the temporary missing-baseline status note.
- Owner manually ran the private weekly backup workflow after the MCP execution denial. n8n execution `191240` (`SyncView - Weekly Backup`, `jlVfbg0Njxf1It7h`) succeeded, mode `manual`, started `2026-07-03T21:28:30.983Z`, stopped `2026-07-03T21:28:54.203Z`.
- Recorded public-safe private backup evidence in `n8n-backups/2026-07-03-phase0-snapshot-status.md`: main sheet copy, repo zip, n8n workflows JSON, and Supabase JSON were verified in the private weekly-backup Drive folder. Raw private backup files, Drive file IDs, and artifact hashes were not committed.
- Phase 0 verification after schema/backup closure: schema baseline contains DDL only (15 `create table`, 6 `create policy`, 8 function definitions) and no row `insert`/`copy` statements or key-shaped strings found by scan; `git diff --check`, `node --check qa/sxr_courier_lib.js`, and `npm.cmd test` with Git Bash on PATH passed; all 35 unit suites are green.
- A1 preflight after owner approval: re-verified the calendar write fan-in by symbol. `index.html` has six `fetch(CALENDAR_UPSERT_URL)` call sites for settings, bulk import, card save, archive, Linear-tab import, and Kasper persist; `scripts/linear-sync-reconcile.js` has `UPSERT_URL`; live n8n `MJbMZ789B5ExZz9x` has an internal `UPSERT_URL` in `Handle Linear Event`.
- Live n8n drift from the 2026-07-03 audit: `SyncView Calendar - Linear Status Sync` (`MJbMZ789B5ExZz9x`) now reports `active=true`, so A1 treats it as live production write traffic.
- Pulled the authoritative guard set and `ALLOWED` column list from live workflow `pWSqaqVw7dmqhYOA` (`SyncView Calendar - Upsert Post`), active version `7ef44971-5c6b-46d7-b7d1-68a504913d28`. The port must include read-failure, phantom-row, `__CLEAR_LINK__`, link-clobber, duplicate-link, conflict/LWW, and the live allow-list including `thumb_rev`, `kasper_finished_at`, `kasper_closed_at`, `kasper_finish_log`, and `title_*`.
- GitHub preflight: connector access to `sidney-afk/client-analytics` has push/admin permission, but local `gh` is not installed. Initial local `git push --dry-run` failed until the repo was added to Git's safe-directory list for the Windows user.
- Published Phase 0 normally with `git push` from branch `codex/phase-0-baseline-qa-stub`; opened draft PR #667 (`[codex] Phase 0 baseline and QA filming stub`) against `main` at commit `134b06b6`. GitHub reports the PR mergeable; GitHub Actions run `28685702670` (`Calendar unit tests`, job `unit`) completed successfully.
- Marked Phase 0 PR #667 ready and merged it into `main` as merge commit `ba365410` after the updated PR head `421c2ed` passed GitHub Actions run `28685800137` (`Calendar unit tests`, job `unit`). Phase 0 rollback remains a single PR revert; no production write path was cut over.
- Created and pushed git tag `pre-A1` on `main` commit `ba365410` before starting A1.
- Started branch `codex/a1-calendar-upsert-ef` from `pre-A1`.
- A1 pre-snapshot: re-read live n8n workflows `pWSqaqVw7dmqhYOA` and `MJbMZ789B5ExZz9x`; both remain active at version IDs `7ef44971-5c6b-46d7-b7d1-68a504913d28` and `2fc824c2-1b60-413a-b2c3-e51135f7448a`. These match the private all-workflow export from weekly-backup execution `191240`; no A1 n8n workflow edits have been made.
- A1 pre-snapshot: dumped `calendar_posts` privately outside the public repo to `private-backups/2026-07-03-pre-A1/calendar_posts.pre-A1.2026-07-03.json` (3,074 rows). Confirmed `calendar_post_events` and `syncview_runtime_flags` are not present yet via read-only Supabase REST checks returning 404.
- Verified normal GitHub push access for A1 with `git push --dry-run origin codex/a1-calendar-upsert-ef`; future A1 publishes use normal git packfiles, not per-blob connector uploads.
- Staged A1 code only: additive SQL for `calendar_post_events` and `syncview_runtime_flags`; `calendar-upsert` Edge Function port; frontend and reconciler per-client routing via `calendar_upsert_ef_clients`; and a guarded parity harness for n8n vs Edge Function checks on TEST client `sidneylaruel`. No Supabase migration has been applied, no Edge Function has been deployed, no runtime flag has been enabled, and no A1 n8n workflow edit has been made.
- Verification after A1 staging: `node --check scripts/a1-calendar-upsert-parity.js`, `node test/calendar-upsert-edge-source.js`, `node test/calendar-upsert-routing.js`, `node --check scripts/linear-sync-reconcile.js`, `git diff --check`, and `npm.cmd test` with Git Bash on PATH passed; all 37 unit suites are green. Direct Node syntax-check of `supabase/functions/calendar-upsert/index.ts` is not applicable because it is a Deno/Supabase function; Deno/Supabase CLI typecheck remains before deployment.
- Installed Supabase CLI `2.109.0` outside the repo at `C:\Users\Sidney\Documents\Codex\tools\supabase-cli`. Expanded the A1 parity harness to include `comment-merge-video-tweaks`: a TEST-client row with existing comments plus an incoming write that must preserve an omitted stored-newer comment and add the new comment. Verification: `node --check scripts/a1-calendar-upsert-parity.js`, `node test/calendar-upsert-edge-source.js`, `git diff --check`, and `npm.cmd test` with Git Bash on PATH passed; all 37 unit suites are green.
- Owner completed Supabase browser login and linked the local project to `uzltbbrjidmjwwfakwve` (`syncview-calendar`, `us-east-2`, `ACTIVE_HEALTHY`). Added `supabase/.temp/` to `.gitignore`; no Supabase link metadata is committed.
- Applied additive A1 migration `migrations/2026-07-03-a1-calendar-upsert.sql` to live Supabase. Verified `calendar_post_events` and `syncview_runtime_flags` exist, both are in the realtime publication, and the runtime flag row is seeded as the full 33-slug active roster (slug list scrubbed from this public file 2026-07-11 — the authoritative roster is the live flag value in `syncview_runtime_flags`). Existing `calendar_posts` row count before the migration was 3,074.
- Deployed Supabase Edge Function `calendar-upsert` to project `uzltbbrjidmjwwfakwve` with JWT verification disabled as planned. Live function list reports `calendar-upsert` active at version `1`.
- Updated n8n workflow `MJbMZ789B5ExZz9x` (`SyncView Calendar - Linear Status Sync`) so its `Handle Linear Event` calendar-upsert calls use the same per-client `syncview_runtime_flags.calendar_upsert_ef_clients` routing as the browser and reconciler paths. Published the edited draft; active version is now `ece94b2c-cdba-46b3-a1e5-966abda0e8f6`. The old n8n calendar-upsert URL remains the default/fallback when the flag is empty or unreadable.
- Rehearsed A1 rollback on the TEST client only: set `calendar_upsert_ef_clients` to `{"clients":["sidneylaruel"]}`, verified it, set it back to `{"clients":[]}`, and verified it again. This is the one-step rollback for the A1 canary; no real client was added.
- Ran live A1 parity on TEST client `sidneylaruel`. The first two runs exposed parity-harness comparison bugs only: generated `*_status_at` timestamps were still being compared, and the harness included its own diagnostic endpoint label in the comparable response. Fixed both harness issues and rechecked with `node test/calendar-upsert-edge-source.js` and `node --check scripts/a1-calendar-upsert-parity.js`.
- Final A1 live parity result on `sidneylaruel`: `PASS create-basic`, `PASS link-clobber-guard`, `PASS clear-link-sentinel`, `PASS duplicate-link-guard`, `PASS stale-scalar-conflict`, and `PASS comment-merge-video-tweaks`. The comment-merge case confirmed both old n8n and the Edge Function preserve the stored newer comment, add the incoming comment, and keep `tweaks` mirrored with `video_tweaks`.
- Post-parity cleanup verification: `calendar_posts` contains 0 TEST rows matching `a1_parity_%`, `calendar_post_events` contains 0 TEST events matching `a1_parity_%`, and `calendar_upsert_ef_clients` remains `{"clients":[]}`. Hard gate remains in force: no real client may be added to the runtime flag without the owner's next explicit OK.
- Post-parity verification: `git diff --check`, `node --check scripts/a1-calendar-upsert-parity.js`, `node test/calendar-upsert-edge-source.js`, `node test/calendar-upsert-routing.js`, `npm.cmd test` with Git Bash on PATH, and `node qa/master.js --lane=unit --no-server` with Git Bash on PATH all passed; all 37 unit suites are green.
- `node qa/master.js --help` is not a help command and launched the default fast profile. That run failed because this workspace has no local `node_modules/playwright` and no bundled `/opt/node22` Playwright path; the wrapper's unit lane also failed without the Git Bash PATH setup. No Playwright-dependent `qa/master.js` lane is claimed green yet. Before any real-client runtime flag, install/configure Playwright and run the relevant master lanes.
- Installed the repo-declared Playwright dependency locally into ignored `node_modules/` and downloaded Chromium. Reran `node qa/master.js` fast profile with Git Bash on PATH against TEST-only QA paths: `unit` passed (37/37 suites), `parity` passed (`parity_logic.js`, `realtime_parity.js`), `probes` passed (2/2), `scenarios` passed (12/12, 87/87 assertions), and `visual` passed its scripted checks (1/1 flow, 15/15 assertions) with 6 screenshots. Manual screenshot review found no obvious layout breakage, overlap, or wrong terminal state in the `clean_both` flow. Runtime flag remains empty; no real client is enabled.

## 2026-07-04

- A1 TEST-client canary baseline: verified `syncview_runtime_flags.calendar_upsert_ef_clients` was `{"clients":[]}`, then triggered GitHub Actions `calendar-e2e-nightly.yml` on branch `codex/a1-calendar-upsert-ef` at commit `218f89d253685c5c4a976bc6f7716a90a755cdaf`. Run `28688510376` completed red: `e2e` failed because `p87_resolve_on_route.js` failed all three attempts with a DOM harness null-read (`Cannot read properties of null (reading 'hidden')`). The other 66/67 probes passed; A1-relevant probes `p89_cal_create_via_ui.js`, `p90_merge_midsave_keep.js`, and `p91_ui_realtime_multitab.js` passed.
- A1 TEST-client EF canary: set `calendar_upsert_ef_clients` to `{"clients":["sidneylaruel"]}` at `2026-07-04T00:31:18Z`, then triggered the same `calendar-e2e-nightly.yml` workflow on the same branch/commit. Run `28689365767` completed red with the same single failing probe, `p87_resolve_on_route.js`; the other 66/67 probes passed. A1-relevant probes passed after the failure: `p89` 9/0, `p90` 7/0, `p91` 7/0, `p92` 9/0, `p93` 4/0, and `p94` 6/0.
- Edge Function log check: the installed Supabase CLI (`2.109.0`) exposes no hosted function log command (`functions` supports list/delete/download/deploy/new/serve only). Supabase's hosted logs are in Dashboard Logs Explorer (`function_edge_logs` for executions, `function_logs` for `console` output). The deployed `calendar-upsert` function emits a final per-request console summary, but those hosted logs are not available through this CLI, so live evidence was also taken from the append-only `calendar_post_events` ledger.
- EF canary event evidence during the TEST flag window (`2026-07-04T00:31:18Z` through rollback): `calendar_post_events` recorded 217 UI-sourced events for `sidneylaruel`, including `create`, `archive`, `status_change`, `approve_*`, `kasper_*`, `link_set`, `link_clear`, `comment_add`, and `comment_delete`. This confirms the real-browser canary exercised the Edge Function path end to end for TEST writes.
- A1 TEST canary rollback: after run `28689365767` completed, set `calendar_upsert_ef_clients` back to `{"clients":[]}` at `2026-07-04T00:58:30Z` with `updated_by='codex-test-canary-rollback'`. Verified the flag is empty, `a1_parity_%` rows are 0, `a1_parity_%` event rows are 0, active QA-pattern `calendar_posts` rows are 0, and active QA-pattern `sample_reviews` rows are 0. One permanent `calendar_post_events` audit row remains for an archived `CAL UI Renamed ...` QA card; audit history was not deleted.
- PR #668 remains draft and unmerged. No real client was added to the runtime flag. Hard gate remains in force: owner review/approval is required before any real client can route to the Edge Function.
- Diagnosed the shared `p87_resolve_on_route.js` failure from runs `28688510376` and `28689365767` as a stale probe expectation: the app now treats the resolve chooser close button as immediately non-destructive and no longer renders the old keep/discard confirmation DOM. Updated the probe to assert the shipped behavior, then ran the single probe locally against the TEST client with the runtime flag still `{"clients":[]}`: `P87 resolve-on-route: pass=19 fail=0`. Post-run cleanup checks found `calendar_upsert_ef_clients` still empty and 0 active `p_rr_%`/`RR-*` rows.
- Attempted to dispatch a fresh `calendar-e2e-nightly.yml` baseline run on current PR head `ee2de4dd76fe0e96745ac1b1085d3c4c7cff6234` with the runtime flag empty, so the full browser canary evidence would include the `p87` harness fix. GitHub rejected the dispatch with `Cannot trigger a 'workflow_dispatch' on a disabled workflow`; `gh workflow list --all` reports `Calendar E2E (nightly)` is `disabled_manually`. No workflow was enabled, no flag was changed, and no real client was added. A fresh full GitHub e2e pair now requires explicit owner approval to temporarily enable that workflow, run TEST-only baseline/EF, roll back the flag to empty, and optionally disable the workflow again.
- Owner approved temporarily re-enabling `Calendar E2E (nightly)` for a supervised TEST-only browser canary and explicitly required leaving `Samples E2E (nightly)` disabled. Verified before enabling that both workflows were `disabled_manually`, then enabled only `calendar-e2e-nightly.yml`.
- Fresh A1 TEST-client canary baseline on current PR head `ee2de4dd76fe0e96745ac1b1085d3c4c7cff6234`: with `calendar_upsert_ef_clients` empty, GitHub Actions run `28690695855` (`Calendar E2E (nightly)`, job `e2e`) completed successfully. The log reports `All 67 probes passed`, including `p87` 19/0, `p89` 9/0, `p90` 7/0, `p91` 7/0, `p92` 9/0, `p93` 4/0, and `p94` 6/0.
- Set the TEST-only runtime flag to `{"clients":["sidneylaruel"]}` at `2026-07-04T01:56:39Z` with `updated_by='codex-supervised-test-canary'`. Dispatched the same workflow on the same branch/head; Edge Function path run `28691435661` completed successfully. The log reports `All 67 probes passed`, including `p87` 19/0, `p89` 9/0, `p90` 7/0, `p91` 7/0, `p92` 9/0, `p93` 4/0, and `p94` 6/0.
- EF canary event evidence during the TEST flag window (`2026-07-04T01:56:39Z` through rollback): `calendar_post_events` recorded 212 `sidneylaruel` events, including `create` 1, `status_change` 130, `comment_add` 44, `comment_delete` 2, `archive` 4, `link_set` 5, `link_clear` 2, `approve_video` 4, `approve_graphic` 2, `approve_caption` 7, `approve_title` 2, `kasper_approve` 7, `kasper_finish` 1, and `kasper_close` 1. The hosted EF log stream was not available through the installed Supabase CLI; the append-only event ledger was used as backend evidence.
- Rolled `calendar_upsert_ef_clients` back to `{"clients":[]}` at `2026-07-04T02:23:47Z` with `updated_by='codex-supervised-test-canary-rollback'`. Cleanup verification found the flag empty, active calendar QA rows 0, active sample QA rows 0, active p87 rows 0, `a1_parity_%` calendar rows 0, and `a1_parity_%` event rows 0.
- Re-disabled `Calendar E2E (nightly)` after the supervised run. Final GitHub workflow state: `Calendar E2E (nightly)` is `disabled_manually`; `Samples E2E (nightly)` is `disabled_manually`. PR #668 remains draft and unmerged, and no real client was added to the runtime flag.
- Owner approved merging PR #668 for the A1 calendar Edge Function work, with the hard gate still limited to the Sidney TEST client. PR #668 was already ready-for-review, checks were green, and it merged to `main` as merge commit `eecfa4b9fc3326cafd5bbf447d507136509464e9` at `2026-07-04T04:54:00Z`.
- Waited for GitHub Pages deployment run `28695476386` on merge commit `eecfa4b9fc3326cafd5bbf447d507136509464e9`; it completed successfully before the runtime flag was changed.
- Set `syncview_runtime_flags.calendar_upsert_ef_clients` to `{"clients":["sidneylaruel"]}` at `2026-07-04T04:55:16Z` with `updated_by='codex-a1-live-sidney-test'`. This routes only the Sidney TEST client to the Edge Function on the live site. No real client was added.
- Updated `ROLLBACK.md` live-state table for the post-merge TEST-only state. One-step rollback remains setting `calendar_upsert_ef_clients` to `{"clients":[]}`, which sends Sidney and all real clients back to n8n immediately even with the merged code live.
- A2 branch started from updated `main` commit `6e1fe77` as `codex/a2-writer-edge-functions`. Reconfirmed PR #668 was merged and its Pages deploy had completed before starting A2 work. No A2 merge has been performed.
- Authorized n8n MCP via a local `MCP_BEARER_TOKEN` environment variable and verified read access to workflow `MJbMZ789B5ExZz9x`.
- A2 n8n pre-snapshot: exported live workflow `MJbMZ789B5ExZz9x` privately outside the public repo to `private-backups/2026-07-04-a2/MJbMZ789B5ExZz9x.pre-a2.json` before editing. Raw workflow JSON was not committed because it contains secret-shaped material. Public-safe status is in `n8n-backups/2026-07-04-a2-snapshot-status.md`.
- A2 n8n edit: updated only the `Handle Sample Linear Event` code node in workflow `MJbMZ789B5ExZz9x` so sample Linear status-sync upserts read `syncview_runtime_flags.sample_review_ef_clients` and route to the `sample-review-upsert` Edge Function only for listed clients. Empty, missing, or unreadable flag state falls back to the old n8n `sample-review-upsert` webhook. Published the workflow; active version is now `405ab03a-12bb-43ca-b70a-14aee3ba7f35`.
- A2 n8n post-snapshot: exported the edited workflow privately outside the public repo to `private-backups/2026-07-04-a2/MJbMZ789B5ExZz9x.post-a2-sample-routing.json`. No real client was added to any flag.
- A2 local staging: added `calendar-reorder`, `sample-review-upsert`, and `sample-review-reorder` Edge Function code; added additive SQL to seed `sample_review_ef_clients` empty; routed browser sample writes, browser calendar reorders, and `scripts/sample-linear-reconcile.js` through per-client runtime flags with n8n fallback.
- A2 local verification: `node --check scripts/a2-writer-parity.js`, `node --check scripts/sample-linear-reconcile.js`, `node test/a2-writer-edge-source.js`, and `npm.cmd test` with Git Bash on PATH all passed. `npm test` reports all 38 unit suites green.
- A2 blocker: live Supabase deploy/parity cannot proceed yet because `SUPABASE_ACCESS_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` are not present in the Codex process or Windows user environment after restart. No Supabase migration was applied, no A2 Edge Function was deployed, no parity writes were run, and no real client was enabled.
- Owner set the Supabase access token and service-role key as local environment variables, then Codex copied them into the sandbox user's local environment so future Supabase commands can use variable names. The secrets had already appeared in chat; do not commit them and rotate them after this migration work.
- Applied additive A2 migration `migrations/2026-07-04-a2-writer-edge-functions.sql` to live Supabase via the linked project. Verified `syncview_runtime_flags.sample_review_ef_clients` exists with `{"clients":[]}`. The existing A1 flag remains `calendar_upsert_ef_clients={"clients":["sidneylaruel"]}`; no real client was added.
- Deployed A2 Supabase Edge Functions to project `uzltbbrjidmjwwfakwve` with JWT verification disabled: `calendar-reorder`, `sample-review-upsert`, and `sample-review-reorder`. Initial live versions were 1/1/1.
- First A2 live parity run on TEST client `sidneylaruel` passed all sample cases but failed `calendar-reorder-batch-shape` because the Edge Function response included an extra empty `skipped` array. Rows matched exactly. Updated `calendar-reorder` to return the n8n-compatible envelope `{ok:true,updated}` and redeployed it; final live function versions are `calendar-reorder` version 2, `sample-review-upsert` version 1, and `sample-review-reorder` version 1.
- Final A2 live parity result on `sidneylaruel`: `PASS calendar-reorder-batch-shape`, `PASS sample-review-reorder`, `PASS sample-review-upsert-create`, `PASS sample-review-upsert-link-clobber`, `PASS sample-review-upsert-clear-link`, `PASS sample-review-upsert-conflict`, and `PASS sample-review-upsert-comment-merge`. The comment-merge case confirmed the n8n and Edge Function paths keep the stored comments and add the incoming comment with matching final rows after normalizing server-generated fields.
- Post-parity cleanup verification: `calendar_posts` contains 0 TEST rows matching `a2_parity_%`, `sample_reviews` contains 0 TEST rows matching `a2_parity_%`, `sample_review_events` contains 0 TEST events matching `a2_parity_%`, and `sample_review_ef_clients` remains `{"clients":[]}`. No real client is enabled for A2; A2 remains unmerged.
- Final A2 local verification after the response-envelope fix and docs update: `node --check scripts/a2-writer-parity.js`, `node --check scripts/sample-linear-reconcile.js`, `node test/a2-writer-edge-source.js`, `git diff --check`, public-repo secret-shaped string scan, and `npm.cmd test` with Git Bash on PATH all passed. `npm test` reports all 38 unit suites green.
- A2 draft PR #670 was opened from branch `codex/a2-writer-edge-functions` at commit `6218f81`; it remains draft and unmerged.
- Ran `node qa/master.js` fast profile on the A2 branch with Git Bash on PATH and `SXR_COURIER=0`. Result: `unit` passed (38/38 suites), `parity` passed (`parity_logic.js`, `realtime_parity.js`), `probes` passed (2/2), `scenarios` passed (12/12 scenarios, 87/87 assertions), and `visual` passed its scripted checks (1/1 flow, 15/15 assertions) with 6 screenshots. Manual screenshot review of the `clean_both` flow found no obvious layout breakage, overlap, or wrong terminal state. No real client was enabled and A2 remains unmerged.
- Owner approved merging PR #670 for the A2 writer Edge Function work, with the hard gate still limited to the Sidney TEST client. PR #670 was marked ready-for-review and merged to `main` as merge commit `2904c6df86aa28958ecd4febd2d17b0d6e6b1acc` on 2026-07-04. No real client was added before the merge.
- Waited for GitHub Pages deployment run `28713539839` (`pages-build-deployment`) on merge commit `2904c6df86aa28958ecd4febd2d17b0d6e6b1acc`; it completed successfully at `2026-07-04T17:09:46Z` before the samples runtime flag was changed.
- Set `syncview_runtime_flags.sample_review_ef_clients` to `{"clients":["sidneylaruel"]}` with `updated_by='codex-a2-live-sidney-test'`. Read-back verification confirmed `calendar_upsert_ef_clients={"clients":["sidneylaruel"]}` and `sample_review_ef_clients={"clients":["sidneylaruel"]}`. This routes only the Sidney TEST client to A1/A2 Edge Function paths; no real client is enabled.
- Updated `ROLLBACK.md` live-state table for the post-A2-merge TEST-only state. One-step rollback remains setting `sample_review_ef_clients` to `{"clients":[]}` for samples and `calendar_upsert_ef_clients` to `{"clients":[]}` for calendar/reorder. A3 remains explicitly out of scope until owner review after Sidney testing.
- A4 branch started from `main` commit `5669b23` as `codex/a4-settings-edge-functions`. Scope is limited to `templates-get`/`templates-save` and `caption-prompts-get`/`caption-prompts-save`; caption generation, filming-plan tabs, A3 Linear bridges, and Linear replacement work are explicitly untouched.
- A4 n8n baseline metadata recorded in `n8n-backups/2026-07-04-a4-snapshot-status.md`: `RhEdtimfMUeogyL2` Templates Get, `oPX1nH7TxzCITNAz` Templates Save, `3hZnjXmHdNv4bttw` Caption Prompts Get, and `RGkuE8d4uJg6CPde` Caption Prompts Save are active and remain the fallback paths. No n8n workflow was edited, deactivated, or deleted.
- Applied additive A4 migration `migrations/2026-07-04-a4-settings-edge-functions.sql` to live Supabase via the linked project. It created `templates`, `caption_prompts`, anon read policies, realtime publication entries, and seeded `syncview_runtime_flags.settings_ef_clients` as `{"clients":[]}`.
- Deployed A4 Supabase Edge Functions to project `uzltbbrjidmjwwfakwve` with JWT verification disabled: `templates-save` version 1 and `caption-prompts-save` version 1. The old n8n Sheet writers remain active as fallback/default.
- Ran A4 backfill from live n8n Sheet reads into Supabase. Verified counts and values: 5 templates from n8n = 5 rows in Supabase with matching values; 24 caption prompts from n8n = 24 rows in Supabase with matching values.
- Ran A4 live parity on TEST client `sidneylaruel`: `PASS templatesSave` and `PASS captionPromptsSave`. Cleanup verification found `settings_ef_clients={"clients":[]}`, 0 `templates` rows for `sidneylaruel`, and 0 `caption_prompts` rows for `sidneylaruel`. No real client is enabled.
- A4 local verification: `node --check scripts/a4-settings-backfill-parity.js`, `node test/a4-settings-edge-source.js`, `git diff --check`, and `npm.cmd test` with Git Bash on PATH all passed. `npm test` reports all 39 unit suites green.
- A4 draft PR #673 was opened from branch `codex/a4-settings-edge-functions` at commit `ce86f10`; it remains draft and unmerged. Hosted GitHub Actions run `28714721464` (`Calendar unit tests`) completed successfully on the PR commit. No real client was added to `settings_ef_clients`.
- A4 merge-blocker fix: corrected the staged settings reads to use the same `settings_ef_clients` runtime flag as writes. Templates and caption prompts now load n8n as the base store and overlay Supabase rows only for flagged clients; empty flag, flag-read failure, or Supabase read failure keeps the n8n base. `settings_ef_clients` remains `{"clients":[]}` and PR #673 remains draft/unmerged.
- A4 pre-cutover snapshot: created and pushed git tag `pre-A4` on `main` commit `5669b2378612b33801bc190e07fb140c7d70ad81` before merging PR #673. Confirmed weekly-backup execution `191240` produced the private weekly-backup Drive folder copy of `SyncView Main Sheet - 2026-07-03`, which covers the source `Templates` and `CaptionPrompts` tabs used for the A4 backfill; public-safe backup evidence remains in `n8n-backups/2026-07-03-phase0-snapshot-status.md`.
- Owner approved A4 cutover on the TEST client only. Marked PR #673 ready-for-review and merged it to `main` as merge commit `48d651b67e149a8b646f44ebcf57d1bc777fa63e`. GitHub Pages deployment run `28716538905` completed successfully for that commit, and the live site served all four A4 read-routing markers: n8n-base template load, flagged Supabase template overlay, n8n-base caption-prompt load, and flagged Supabase caption-prompt overlay.
- A4 rollback rehearsal before canary: with `settings_ef_clients={"clients":[]}`, loaded the TEST client's settings from the n8n base paths. `templates-get` returned the Sidney template under the exact key `Sidney Laruel`; `caption-prompts-get` returned the `sidneylaruel` prompt entry. This confirmed the one-step rollback state before flipping the flag.
- A4 TEST-only flag flip: set `syncview_runtime_flags.settings_ef_clients` to `{"clients":["sidneylaruel"]}` with `updated_by='codex-a4-test-canary'`. Read-back verification returned the exact value `{"clients":["sidneylaruel"]}` at `2026-07-04T17:30:56.810657+00:00`. No real client was added.
- A4 backend overlay verification: with the TEST-only flag set, called the deployed `templates-save` and `caption-prompts-save` Edge Functions for `sidneylaruel` using the current live n8n values. Both writes landed in Supabase. The `templates` row has `client_slug='sidneylaruel'` and `data.client_name='Sidney Laruel'`, exactly matching the n8n templates map key; the `caption_prompts` row has `client_slug='sidneylaruel'`. Both rows were updated by `codex-a4-backend-verify`. No real client was added.
- 2026-07-04 frontend-only roster normalization: added `getClientRoster()` as the canonical client-list accessor and routed Templates plus analytics search/open paths through the `WL_CLIENT_NAMES` allowlist. Live roster diff: 31 old allData-derived names to 33 canonical names, 0 real clients dropped, only seed additions `Kasper Hytonen` and `Sidney Laruel` (already in the calendar picker). Verified local headless Templates/analytics search for `Sidney Laruel`, data-less analytics empty state, and unchanged `settings_ef_clients={"clients":["sidneylaruel"]}` with exactly one Sidney template row. Revert = one frontend/docs commit.
- 2026-07-04 roster normalization merge: PR #675 was marked ready-for-review and merged to `main` as merge commit `1fc7ad6047fd95a0a61704d401e5e428aa8e9997`. GitHub Pages deployment run `28718041354` initially hit a transient deploy error after a successful build, then passed on rerun; live `syncview.synchrosocial.com` served the roster markers `function getClientRoster() {`, `No analytics yet`, and `function _tplAllNames() { return getClientRoster(); }`. No runtime flags were changed; `settings_ef_clients` remains `{"clients":["sidneylaruel"]}`.

- Archived entry: 2026-07-05 ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-05)) sha256:c32f78934694
- Archived entry: 2026-07-06 ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-06)) sha256:2cccdcf91a14
- Archived entry: 2026-07-07 ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-07)) sha256:65e60885012d
- Archived entry: 2026-07-09 ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-09)) sha256:caa3f8084b41
- Archived entry: 2026-07-10 ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-10)) sha256:29940d97df47
- Archived entry: 2026-07-11 ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-11)) sha256:d7bbe0e2f0b5
- Archived entry: 2026-07-12 ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-12)) sha256:8383782334ef
- Archived entry: 2026-07-13 ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-13)) sha256:7a25c3541bc3
- Archived entry: 2026-07-13 / 07-14 — audit, docs, n8n cut, D-9 catch, #813 review ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-13--07-14--audit-docs-n8n-cut-d-9-catch-813-review)) sha256:6d97d2fdf3d6
- Archived entry: 2026-07-14 ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-14)) sha256:f515f23e69f6
- Archived entry: 2026-07-14 — authorized public-data exposure containment ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-14--authorized-public-data-exposure-containment)) sha256:89e1b43e7cb7
- Archived entry: 2026-07-15 — exposure PR merged + post-merge closure + independent re-verification (cloud reviewer) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-15--exposure-pr-merged--post-merge-closure--independent-re-verification-cloud-reviewer)) sha256:b1eb69544315
## 2026-07-15 — INCIDENT: client-review write outage (F35 gate ⇄ F03 token removal) + OWNER WRITER-GATE FREEZE

- **Impact.** From ~00:06Z 2026-07-15 (the #836 deploy of the gated `calendar-upsert` v38 / `sample-review-upsert` v39) until ~15:05Z, **every client-review-link write (approve / comment / status) returned `401`.** Clients could still READ their content; only their saves failed. Staff writes were unaffected throughout. Verified live: zero client-role writes in the window vs. active client writes immediately before (daniellerobin 20:40–21:17Z 07-14) and after.
- **Root cause.** F03 removed `client_review_token` from the anon Clients Info sheet (correct) and #836 gated the two client writers to require a token (correct) — but the live client-review WRITE path still sourced the token from the removed sheet column (`clientMap[...].client_review_token` in index.html) and therefore sent **no** token, which the newly-gated writers rejected (`401 credentials_required`). Two individually-correct fixes shipped without the client-write path being repointed to the new token source. Cloud reviewer confirmed the decisive fact live: the Clients Info sheet no longer has a token column at all.
- **Interim restore (owner-approved).** Codex redeployed `calendar-upsert` / `sample-review-upsert` reverted to their pre-#836 UNGATED source (from `a1e2622`); tokenless TEST writes returned `200`; real client writes resumed (lilybaker 15:05–15:10Z).
- **Permanent fix (PR #838, merged `2375f3e`).** A staff-only issuer (`client-review-link` v1) now mints the current rotated token into freshly-shared links; all four share buttons were repointed off the removed sheet column; all 33 clients provisioned tokens. Codex then **RE-GATED** the writers (`calendar-upsert` v42 / `sample-review-upsert` v43).
- **Second break.** Re-gating re-broke **every client still on a PRE-EXISTING link** — those links carry old/empty `?t=` tokens that don't match the rotated tokens, so they `401` again. Client writes stopped dead at 15:10Z (the re-gate). Cloud reviewer flagged this risk *before* the re-gate and confirmed it after (zero client writes post-gate; existing-link tokens are stale). The permanent fix only helps NEWLY re-shared links; existing links stay dead once re-gated.
- **Final state (owner directive).** Codex UN-GATED again — `calendar-upsert` v43 / `sample-review-upsert` v44, tokenless, OPEN. Cloud reviewer verified live: no-key POST → `400` phantom-row (open), and multiple real clients (lilybaker, jennaphillipsballard) writing on **existing** links at 15:17–15:18Z. Clients restored.
- **Current live posture.** The two client writers are **INTENTIONALLY UN-GATED** (F35 write-integrity lock OFF for these two only). No PII risk — the reader locks (F77/F76/F82) and repo/PII remediation (F64/F122) are untouched and stay closed; this is only the "anon could forge a calendar/samples write" integrity lock, off on purpose so links keep working. The #838 issuer + 33 provisioned tokens remain in place for a future, careful re-lock.
- **⛔ OWNER FREEZE (2026-07-15).** DO NOT re-gate `calendar-upsert` or `sample-review-upsert` without **EXPLICIT owner approval**. Re-locking is permitted ONLY after **(a)** the owner affirmatively says so AND **(b)** every active client is re-issued and confirmed on a fresh link (via the `client-review-link` issuer). Any agent that believes re-gating is needed must **STOP and ASK THE OWNER FIRST**. Recorded in `AGENTS.md` (top freeze callout) and `ROLLBACK.md` (F35 row).
- **Lesson.** Never flip a live auth gate that clients depend on while they still hold credentials issued under the old scheme; migrate every holder onto the new credential first, then gate. This documentation pass changed no runtime flag, DB row, workflow, Linear record, credential, or live client data.
- **F13 independent recovery staged (2026-07-15).** Created fresh branch `claude/f13-independent-backup-restore` from current `main`, transplanting only the backup/restore implementation from parked #813 rather than merging its unrelated write-UI work. Safety audit corrected the stale 26-hour threshold to seven hours, added exhaustive Drive pagination, exact 14-table manifest enforcement, deterministic zero-row handling, malformed-newer-candidate last-known-good retention, Drive-only HMAC alert dedupe (no production marker write), complete package/dump/compressed hashes, and all declared core Track-B foreign-key checks. Focused fault suite is green for truncation, error-item, valid-zero-row, pagination, corpus/workflow-count, and readback mismatch. This is draft code only: no GitHub secret/variable was created, no schedule is active on `main`, no production backup ran, no scratch restore ran, no PITR timestamp was asserted, and no production/n8n/runtime flag/Linear data changed.
- **F13 provisioning and local recovery proof (2026-07-15).** Kept PR #840 draft/unmerged and the recurring workflow inactive. Provisioned production `backup_reader` as a connection-limited BYPASSRLS login with SELECT on the exact 14-table corpus and zero INSERT/UPDATE/DELETE/TRUNCATE privileges; its live preflight passed. Configured the production URL, HMAC key, scratch URL, and expected scratch ref in GitHub without exposing values. A real 14-table backup produced package SHA-256 `3a5858eed3b8e441ba6759a67bb72cfa1e08b78e9bf06b49cc27aac1d0da30a4` (15,520,201 bytes); independent local readback verified its HMAC, source ref, exact table set/counts, dump SHA-256 `3724ce2ada37a3c43d89a519e6d5d957beda8d6ea577db5004a3fa8007fec7fd`, and compressed SHA-256 `a0a68a525b329c190fee0805c3eb72a2bc1beeb95c1c259a1dd81a82ee832a04`. The restore guard refused the production ref. Dedicated scratch `pmzamicipnansdgomxfd` was provisioned with the 14-table schema and a narrow restore role; a transactional rehearsal completed in 229.03 seconds, matched every table count, left all 12 core orphan checks at zero, and re-enabled all user triggers. The prior n8n Drive credential is non-exportable OAuth and its folder is not reachable by the connected Google principal; no reusable service-account JSON/private folder or direct non-n8n Slack webhook exists, so Drive readback/last-known-good and direct alert proof remain owner-supplied blockers. PITR was explicitly skipped by the owner as a paid-add-on opt-out and no timestamp was fabricated. Production data remained read-only; no runtime flag, authority, n8n workflow, Linear row, recurring schedule, or `main` commit changed.
- **F13 manual Drive proof failed closed (2026-07-15).** PR #840 remained draft/unmerged and its recurring schedule remained absent from `main`. Manual branch run `29443643690` produced no accepted artifact after the snapshot client step failed; the workflow's always-run freshness check independently returned missing and exited non-zero with Slack absent. After pinning the official PostgreSQL client, manual run `29443779820` passed credentials and the production SELECT-only snapshot path, then Drive file creation returned HTTP 403; freshness again independently returned missing and failed the run. Connected-Drive readback found the target normal My Drive folder empty and no Shared Drive available. Google service accounts have no Drive storage quota, so Editor access to that My Drive folder is insufficient for file creation; the remaining gate is a Shared Drive target or user-authorized OAuth JSON. No package became last known good, no production write occurred, no runtime flag/authority/n8n/Linear state changed, and no recurring schedule was activated. GitHub failed-run email is the primary alert path; Slack is optional and absent.
- **F13 Shared Drive proof completed (2026-07-15).** Kept PR #840 draft/unmerged and the workflow absent from `main`. Source `f9406b8` added fail-closed Shared Drive folder/capability resolution, `corpora=drive` plus the resolved `driveId` on every paginated list, `supportsAllDrives=true` on create/get/download, and parent/Shared Drive checks during metadata readback. Manual `workflow_dispatch` run `29444939853` passed the production SELECT-only privilege preflight, created a transactionally consistent 14-table/53,819-row package in the private Shared Drive, and independently matched filename, parent, 15,562,462-byte length, Drive MD5 `130c2ec109239be280453462d81698a1`, downloaded bytes, and HMAC. Package SHA-256 was `3bc3f19d50f4f6c3d64559e15dacb2b1863ffcfbe256538392a12790d7ed66db`; dump SHA-256 `101a7e7b48a8ddd44661f0bedfeb64182524b689fe597c98ad6cf5fc5e11a80c`; compressed SHA-256 `bc134b4a9bca13669c0ffd91b14f88993a2c99995f2af1c4785e1ac9f8bbb219`. The always-run freshness lane separately listed, downloaded, and authenticated the same file with zero invalid candidates; a separate connected-Drive listing confirmed the file remained after runner-local cleanup. Production remained strictly read-only; no restore ran, no runtime flag/authority/n8n/Linear state changed, no merge occurred, and no recurring schedule was activated.
- 2026-07-15 PTO / Time Off implementation staged in source only: added the additive locked-table migration, role-key-authenticated `pto` Edge Function and scoped deploy workflow, dark `pto_v1` UI/rollback contract, synthetic policy fixtures, and public-safe feature/system documentation. The final adversarial pass added per-member versioned approval RPCs and found a go-live blocker: shared role keys prove a role but cannot immutably bind a person, so same-role ownership of private HR detail is not secure until an individually revocable server session is deployed and negatively tested. Keep `pto_v1` off and do not seed real HR data. **No live PTO action is claimed:** this source change did not apply the migration, deploy the function, write or flip a runtime flag, seed a member, read HR data, change n8n, or alter the Production/Linear-mirror surface. Owner-run evidence must be appended only after each action actually occurs, using the following value-free templates:
  - **Migration apply — not yet executed:** record UTC timestamp/operator label, release SHA and migration filename, schema/index/RLS/grant readback, proof that anon/authenticated table access is denied, and `pto_v1={"mode":"off"}` readback; include no member rows, dates, notes, balances, or other HR values.
  - **Edge Function deploy — not yet executed:** record UTC timestamp, workflow run, release SHA, deployed `pto` version, `--no-verify-jwt`, public-safe source/dependency fingerprint, and missing/wrong/insufficient-role denial plus valid TEST-role proof; include no key or response data.
  - **Flag change — not yet executed:** record UTC timestamp/operator label, exact previous and new mode, database readback and `flag_flips` receipt, reason, and `on → off` behavior-kill proof. Real enablement additionally requires individually bound staff sessions, negative same-role impersonation/revocation tests, owner approval, and private seed completion; never log the private roster or per-person state here.

- Archived entry: 2026-07-15 — F13 backup MERGED + ACTIVE, and workload tweaks fix (#842) MERGED ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-15--f13-backup-merged--active-and-workload-tweaks-fix-842-merged)) sha256:d96a01b8b857
- Archived entry: 2026-07-15 — PTO / Time Off go-live ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-15--pto--time-off-go-live)) sha256:6a9981ea79bb
- Archived entry: 2026-07-16 — Phase-2 whole-system merge-readiness audit (cloud reviewer, read-only) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-16--phase-2-whole-system-merge-readiness-audit-cloud-reviewer-read-only)) sha256:30f36bfb198c
- Archived entry: 2026-07-16 — F21 write-UI quarantine popup owner decision ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-16--f21-write-ui-quarantine-popup-owner-decision)) sha256:91af1477eae5
- Archived entry: 2026-07-16 - INCIDENT: F88 Linear-intake lookup outage and bounded recovery ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-16---incident-f88-linear-intake-lookup-outage-and-bounded-recovery)) sha256:82896d3489e6
- Archived entry: 2026-07-17 - PTO transactional-write release evidence ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-17---pto-transactional-write-release-evidence)) sha256:d5d3613bf2ba
- Archived entry: 2026-07-17 — Calendar E2E nightly regression: harness lane mismatch (test-only fix) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-17--calendar-e2e-nightly-regression-harness-lane-mismatch-test-only-fix)) sha256:53198f140cdb
- Archived entry: 2026-07-17 — first /site-assurance run (read-only; coverage ledger established) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-17--first-site-assurance-run-read-only-coverage-ledger-established)) sha256:7746d6541fd4
- Archived entry: 2026-07-17 ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-17)) sha256:b7a387608d81
- Archived entry: 2026-07-17 — shadow-audit workflow startup failure + nightly paging (CI-only fix) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-17--shadow-audit-workflow-startup-failure--nightly-paging-ci-only-fix)) sha256:afd1685bdaa5
- Archived entry: 2026-07-18 — F140 Samples Kasper Finish regression ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-18--f140-samples-kasper-finish-regression)) sha256:c01236dc85a6
- Archived entry: 2026-07-18 — Feedback-expansion round 1: Production tab vs real Linear (owner observations 2026-07-17) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-18--feedback-expansion-round-1-production-tab-vs-real-linear-owner-observations-2026-07-17)) sha256:450cb5334977
- Archived entry: 2026-07-18 — Round-1 owner decisions applied (items 6 + 7) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-18--round-1-owner-decisions-applied-items-6--7)) sha256:16d16e515e06
- Archived entry: 2026-07-18 — F105 Production polish gate repair (test-only; cloud review pending) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-18--f105-production-polish-gate-repair-test-only-cloud-review-pending)) sha256:774c9f1140a8
- Archived entry: 2026-07-19 — /site-assurance run 2 (TEST-drill mandate; F141 root-caused + repo fix; Tier-0 drills sandbox-blocked) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-19--site-assurance-run-2-test-drill-mandate-f141-root-caused--repo-fix-tier-0-drills-sandbox-blocked)) sha256:658327d4652d
- Archived entry: 2026-07-19 — Workload static due-date mode (source only) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-19--workload-static-due-date-mode-source-only)) sha256:1febd0522ec5
- Archived entry: 2026-07-19 — F141 post-merge Edge deploy + live TEST drill ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-19--f141-post-merge-edge-deploy--live-test-drill)) sha256:cafc98d20493
- Archived entry: 2026-07-19 — F124 analytics scrape containment published + July-18 metrics repair ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-19--f124-analytics-scrape-containment-published--july-18-metrics-repair)) sha256:eff5fedcf3be
- Archived entry: 2026-07-19 — Workload editable internal plan date (candidate source only) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-19--workload-editable-internal-plan-date-candidate-source-only)) sha256:91d828746dee
- Archived entry: 2026-07-19 — Phase 3 kickoff / F145 true Linear hierarchy (candidate source only) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-19--phase-3-kickoff--f145-true-linear-hierarchy-candidate-source-only)) sha256:5770458c1e88
- Archived entry: 2026-07-20 — Workload editable internal plan date live release ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-20--workload-editable-internal-plan-date-live-release)) sha256:340d5653f199
- Archived entry: 2026-07-20 — Phase 3 F145 merge + Order-1 register reconciliation ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-20--phase-3-f145-merge--order-1-register-reconciliation)) sha256:9a58381a801c
- Archived entry: 2026-07-20 — F124 first scheduled production proof ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-20--f124-first-scheduled-production-proof)) sha256:a93f94225256
- Archived entry: 2026-07-20 — Workload compact display follow-up (candidate source only) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-20--workload-compact-display-follow-up-candidate-source-only)) sha256:c5ab9ff73330
- Archived entry: 2026-07-20 — Workload hybrid automatic/manual planning (candidate source only) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-20--workload-hybrid-automaticmanual-planning-candidate-source-only)) sha256:651308093f5e
- Archived entry: 2026-07-20 — Workload parallel deadline timeline (candidate source only) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-20--workload-parallel-deadline-timeline-candidate-source-only)) sha256:5b5208b8f380
- Archived entry: 2026-07-20 — Workload five-day planning display (candidate source only) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-20--workload-five-day-planning-display-candidate-source-only)) sha256:4512ac04f94c
- Archived entry: 2026-07-20 — Workload display feedback polish (candidate source only) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-20--workload-display-feedback-polish-candidate-source-only)) sha256:b46925341c99
- Archived entry: 2026-07-20 — Client-entry visible-boot remediation candidate (source only) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-20--client-entry-visible-boot-remediation-candidate-source-only)) sha256:22c1c491e15f
- Archived entry: 2026-07-22 — Workload Creative read-only shared plan (candidate source only) ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-22--workload-creative-read-only-shared-plan-candidate-source-only)) sha256:51ef5366915d
- Archived entry: 2026-07-22 — Workload weighted capacity, ordered work, due-date editor, and freshness candidate ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-22--workload-weighted-capacity-ordered-work-due-date-editor-and-freshness-candidate)) sha256:9e95fe9db9c0
- Archived entry: 2026-07-22 — Workload weighted planning live deployment ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-22--workload-weighted-planning-live-deployment)) sha256:d699c4252c4c
- Archived entry: 2026-07-22 — Workload background change-only refresh candidate ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-22--workload-background-change-only-refresh-candidate)) sha256:82083f61aff7
- Archived entry: 2026-07-22 — Workload pinned deadline-edit follow-up ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-22--workload-pinned-deadline-edit-follow-up)) sha256:f1f6bec3a20e
- Archived entry: 2026-07-23 — Workload editor matrix and unified calendar candidate ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-23--workload-editor-matrix-and-unified-calendar-candidate)) sha256:5b4197a801b9
- Archived entry: 2026-07-23 — Workload matrix always-visible follow-up ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-23--workload-matrix-always-visible-follow-up)) sha256:94d0ec8c9af9
- Archived entry: 2026-07-24 â€” F200 owner-approved attribution cleanup ([read it](docs/ops/execution-log-archive/2026-07.md#2026-07-24-â-f200-owner-approved-attribution-cleanup)) sha256:f82c5626c053
## 2026-08-05 — F27 Section 4 four-function deploy: APPROVED, NOT DISPATCHED

- **Approval.** The owner approved the four-function forward deploy
  (`linear-outbound`, `production-write`, `deliverable-write`, `batch-write`)
  on the grounds that two independent symptoms trace to one stale deployment,
  the alternative was a rejected gate-weakening, and `write_ui_reroute_clients`
  is still TEST-only so the blast radius is at its minimum. It also moves
  `linear-outbound` — the flip-night drain lane — onto a reviewed version.
- **NOT DISPATCHED. Two preconditions unmet.**
  1. **The sealed four-function capture does not exist.** The lane requires
     `rollback_bundle_sha256` / `rollback_bundle_byte_length`, sourced from
     `PRIOR_FOUR_SOURCE_BUNDLE_SHA256` / `_BYTE_LENGTH`. Every occurrence of
     both in this repository is still a placeholder; no run has recorded a
     value. It cannot be produced from a session or from CI by design — it
     needs a private Management token, seals outside every Git worktree, and
     uploads to the `SyncView Backups/` Shared Drive root. Owner-only.
  2. **`main` does not carry the fix.** PR #1020 is unmerged, so `main` still
     pins `PRODUCTION_WRITE_SOURCE_SHA256: 2efe6ee3…`. Deploying from main
     today would fix the probe but leave the mapped Video fixture at
     `diff_count: 1` — trading `attribution_stamp_absent` for a
     `mapping_revision` mismatch, because both the twelve-key stamp and the
     claim/provenance split are on the branch. Main has moved since the fork
     but **not** under `supabase/functions/` or the deploy workflow, so the
     regenerated pins stay valid across the merge.
- **F51 closed for these four, structurally.** The forward lane's final receipt
  previously ended at `PASS` and never said which version of each function was
  live; only the restore path printed per-slug versions. That missing fact cost
  two full diagnosis cycles on 2026-08-05 — an unfollowed 303 on the artifact
  probe and an attribution stamp that proved absent rather than partial were
  both investigated against source that was not the source running. The forward
  receipt now emits a per-function table plus a
  `syncview_f27_section4_deployed_versions_v1` JSON block (slug, active
  version, source closure SHA-256, entrypoint SHA-256, provider bundle SHA-256,
  JWT posture) to be pasted below after the run.
- **No flag, `prod_authority`, n8n workflow, enrollment list, schema, migration
  or Edge Function changed.** Re-enrollment stays parked.

### Deployed versions — RECORDED (run `31023890487`, 2026-08-05)

Dispatched by the owner from the web UI against `main` head
`9c596d5d5cbcfc32b2cefdee868cf6988cbef61c`. Forward deploy and readback PASS on
all four; `verify_jwt=false` on all four; strict serial provider readbacks PASS;
final four-function comparison PASS.

| function | version | source closure SHA-256 | changed? |
|---|---|---|---|
| `batch-write` | 26 → **27** | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | no — byte-identical |
| `deliverable-write` | 26 → **27** | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | no — byte-identical |
| `linear-outbound` | 35 → **36** | `008deee581b5f7712783574decc505a3b11eee25bc93001cf59d5faac158cb98` | no — byte-identical |
| `production-write` | 27 → **28** | `b974e809cb52066196072c665d4904ea7ba11856fe9112fd515765ed28f63171` | **YES** — was `2efe6ee3afc9f959cbe998be98061b91697cfce63a053139ae95664a4d79d60e` |

```json
{
  "schema": "syncview_f27_section4_deployed_versions_v1",
  "deploy_commit": "9c596d5d5cbcfc32b2cefdee868cf6988cbef61c",
  "github_run_id": "31023890487",
  "functions": [
    { "slug": "batch-write", "active_version": "27", "source_closure_sha256": "86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a", "entrypoint_sha256": "15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5", "verify_jwt": false },
    { "slug": "deliverable-write", "active_version": "27", "source_closure_sha256": "78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575", "entrypoint_sha256": "74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68", "verify_jwt": false },
    { "slug": "linear-outbound", "active_version": "36", "source_closure_sha256": "008deee581b5f7712783574decc505a3b11eee25bc93001cf59d5faac158cb98", "entrypoint_sha256": "606628504ec4614a22e9d16c7671dc5d9ef73bfc57b69ecaa08065a5d14f3684", "verify_jwt": false },
    { "slug": "production-write", "active_version": "28", "source_closure_sha256": "b974e809cb52066196072c665d4904ea7ba11856fe9112fd515765ed28f63171", "entrypoint_sha256": "7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5", "verify_jwt": false }
  ]
}
```

**The stale-deployment diagnosis is now machine-confirmed, not inferred.** The
lane's own pre-deploy capture recorded the live `production-write` at
`2efe6ee3…` — the previous repository pin — while the deployed function was
being investigated as though it matched current `main`. Two defects were chased
against source that was not the source running: an unfollowed HTTP 303 on the
Graphics artifact probe, and an attribution stamp that proved **absent** rather
than partial. Both were the same missing fact, and that fact now has a record.

**Real blast radius was one function, not four.** Only `production-write`'s
source changed; the other three redeployed byte-identical and moved version
solely because the lane deploys all four serially. That is worth stating because
"a four-function deploy" overstates what actually changed.

**F51 is closed for these four functions.** Any future question of the form "is
what is running the same as what is in the repository?" is answerable from this
block plus `scripts/ef-fingerprint.js`, without a diagnosis cycle.

### Deploy #2 — RECORDED (run `31031232820`, 2026-08-05)

Owner-dispatched from `main` head
`702d669a59e8dc6a48f85c41cae41c512b361fee`. Forward deploy and readback PASS on
all four; `verify_jwt=false` on all four.

| function | version | source closure SHA-256 | changed? |
|---|---|---|---|
| `production-write` | 28 → **29** | `05e7d1d167612f12d8ffcb9de7c4f6fd4c4540f8eecadb9520f89fb6d68734a8` | **YES** — was `b974e809cb52066196072c665d4904ea7ba11856fe9112fd515765ed28f63171` |
| `linear-outbound` | **36** | `008deee581b5f7712783574decc505a3b11eee25bc93001cf59d5faac158cb98` | no — no version bump |
| `deliverable-write` | **27** | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | no — no version bump |
| `batch-write` | **27** | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | no — no version bump |

```json
{
  "schema": "syncview_f27_section4_deployed_versions_v1",
  "deploy_commit": "702d669a59e8dc6a48f85c41cae41c512b361fee",
  "github_run_id": "31031232820",
  "functions": [
    { "slug": "batch-write", "active_version": "27", "source_closure_sha256": "86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a", "entrypoint_sha256": "15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5", "verify_jwt": false },
    { "slug": "deliverable-write", "active_version": "27", "source_closure_sha256": "78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575", "entrypoint_sha256": "74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68", "verify_jwt": false },
    { "slug": "linear-outbound", "active_version": "36", "source_closure_sha256": "008deee581b5f7712783574decc505a3b11eee25bc93001cf59d5faac158cb98", "entrypoint_sha256": "606628504ec4614a22e9d16c7671dc5d9ef73bfc57b69ecaa08065a5d14f3684", "verify_jwt": false },
    { "slug": "production-write", "active_version": "29", "source_closure_sha256": "05e7d1d167612f12d8ffcb9de7c4f6fd4c4540f8eecadb9520f89fb6d68734a8", "entrypoint_sha256": "7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5", "verify_jwt": false }
  ]
}
```

**Genuinely one function this time.** The other three did not take a version
bump at all, so the deploy touched exactly what changed. Deploy #1 moved all
four versions for one function's worth of change; this one did not.

**The rollback is exactly one step back.** A FRESH sealed bundle
(`5d738ab5…` / `387490`) was captured after deploy #1 and before this dispatch,
and the capture session confirmed `production-write` at `captured_version 28`
before use. Restore therefore lands on v28 / `b974e809…`, not on the stale
`2efe6ee3…` that a reused bundle would have reached. The constraint that made
this necessary — the lane never compares a sealed bundle against what is live,
so a stale bundle silently rolls back past every intervening deploy — is
recorded in `ROLLBACK.md`.

**Verified after the fact, not assumed:** `scripts/ef-fingerprint.js` at
`702d669` computes `production-write` = `05e7d1d1…`, matching the version the
provider reports as active. Repository and deployment agree.

### Deploy #3 — RECORDED (run `31046671471`, 2026-08-05)

Owner-dispatched from `main` head
`30f2846cbd85b2974afb6ea57b46e6f321dd6595`. Forward deploy and readback PASS on
all four; `verify_jwt=false` on all four. Ships the intake attribution stamp and
the asset-probe redirect fix (#1024, #1026).

| function | version | source closure SHA-256 | changed? |
|---|---|---|---|
| `production-write` | 29 → **30** | `50970ca24c74c9044b2c92492d6bdb6f8327e7d7ccd6de80a48926ed8a05913d` | **YES** — was `05e7d1d167612f12d8ffcb9de7c4f6fd4c4540f8eecadb9520f89fb6d68734a8` |
| `linear-outbound` | **36** | `008deee581b5f7712783574decc505a3b11eee25bc93001cf59d5faac158cb98` | no — no version bump |
| `deliverable-write` | **27** | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | no — no version bump |
| `batch-write` | **27** | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | no — no version bump |

```json
{
  "schema": "syncview_f27_section4_deployed_versions_v1",
  "deploy_commit": "30f2846cbd85b2974afb6ea57b46e6f321dd6595",
  "github_run_id": "31046671471",
  "functions": [
    { "slug": "batch-write", "active_version": "27", "source_closure_sha256": "86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a", "entrypoint_sha256": "15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5", "verify_jwt": false },
    { "slug": "deliverable-write", "active_version": "27", "source_closure_sha256": "78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575", "entrypoint_sha256": "74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68", "verify_jwt": false },
    { "slug": "linear-outbound", "active_version": "36", "source_closure_sha256": "008deee581b5f7712783574decc505a3b11eee25bc93001cf59d5faac158cb98", "entrypoint_sha256": "606628504ec4614a22e9d16c7671dc5d9ef73bfc57b69ecaa08065a5d14f3684", "verify_jwt": false },
    { "slug": "production-write", "active_version": "30", "source_closure_sha256": "50970ca24c74c9044b2c92492d6bdb6f8327e7d7ccd6de80a48926ed8a05913d", "entrypoint_sha256": "7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5", "verify_jwt": false }
  ]
}
```

**Verified after the fact, not assumed:** `scripts/ef-fingerprint.js` at
`30f2846` computes `production-write` = `50970ca2…`, and an independent
provider read (`GET /v1/projects/{ref}/functions/{slug}`) reports version `30`,
`ACTIVE`, `verify_jwt=false`. Repository and deployment agree. The other three
did not take a version bump, so again the deploy touched exactly what changed.

**⚠ The rollback for this deploy is TWO steps back, not one — and that was a
knowing choice made on bad advice.** This dispatch reused the already-stored
sealed bundle `5d738ab5…` / `387490`, which captured `production-write` at
**v28 / `b974e809…`**. Live is now v30. Restoring therefore skips v29
entirely — precisely the failure mode `ROLLBACK.md` warns about under
"the sealed rollback bundle must postdate the most recent deploy, and the lane
will NOT tell you if it does not."

The reuse happened because the reviewer searched for a freshness rule at
`docs/ops/ROLLBACK.md` — the wrong path; the file is at the repository root —
found nothing, and reported "no written rule requires a fresh capture." The
rule existed, had been written the same day, and said the opposite. This is the
`MONITORING.md` pattern **"read one path, generalise to the whole"** recurring
in the reviewer's own verification work: one negative lookup was treated as
proof of absence. The corrected discipline: a "no rule found" claim requires
the search to have covered every path the rule could live at, and must be
reported as "not found at X" rather than "does not exist."

Blast radius is bounded and was disclosed to the owner before dispatch: v28 is
a known-good state that served production for roughly ninety minutes earlier
the same day, and the gap between v28 and v30 is the intake attribution stamp
plus the asset-probe fix — neither load-bearing for data safety. The team-level
F27 undo is a separate mechanism and is unaffected.

**Standing remediation:** the next dispatch must use a bundle whose captured
`production-write` version equals **30**. That bundle now exists and has been
independently verified through the same `inspect` gate the deploy lane runs at
step 5 — `result=PASS`, `provider_source_exactness=PASS`, `function_count=4`,
`production-write captured_version=30`:

```
rollback_bundle_sha256        7eb8bdc83ad2c40c62a1c93d976d703a48b33192091b8d591eafc82ce5d419e7
rollback_bundle_byte_length   396609
```

Until it is stored in the F27 private Shared Drive root, the only *fetchable*
bundle remains the stale `5d738ab5…`, so dispatching with the values above
fails closed at `OBJECT_MISSING` rather than deploying against a bad rollback
target. That is the correct failure direction, but it does block the next
deploy.

**Store gap (open).** `OBJECT_MISSING` on run `31045473316` was diagnosed to
completion: the lane resolves the configured folder, authenticates, and lists it
successfully, then looks for one exact content-addressed filename
(`syncview-f27-edge-source-<sha256>.sourcebundle`) with an exact mimeType,
single parent and byte length. A manual browser upload cannot reliably satisfy
that contract, and the target folder is a Shared Drive root not visible to the
owner's own Google account in search. Capturing a bundle is therefore only half
the operation — `scripts/f27-private-snapshot-store.js` must place it, and that
requires `TRACK_B_BACKUP_DRIVE_FOLDER_ID` and
`TRACK_B_BACKUP_GOOGLE_CREDENTIALS_JSON`, neither of which is available to a
reviewer session. Until those are supplied to whoever runs the store, every
dispatch inherits the previous bundle's staleness.

### Deploy #4 — RECORDED (run `31214635190`, 2026-08-07)

Owner-dispatched from `main` head
`f04e08e01e542b30bdeb44f46390cb877ade01c4`. Ships the Linear autolink /
parent-linkage fix (#1035) — the cause of five days of orphaned Create Post
sub-issues.

**The run reported Failure. The deployment is correct.** All four functions
deployed and read back PASS individually; the run then failed at *"Verify the
final exact four-function release"*, and the workflow's `Deployed versions`
attestation block was therefore never printed. The values below are recorded
from an independent verification instead, which is why this entry exists at all.

| function | version | source closure SHA-256 | changed? |
|---|---|---|---|
| `linear-outbound` | 37 → **38** | `ef89adbf7245127516fad90877c3b00de0043b9430e7ad5f33cbfd675543b26a` | **YES** — was `008deee581b5f7712783574decc505a3b11eee25bc93001cf59d5faac158cb98` |
| `production-write` | **32** | `50970ca24c74c9044b2c92492d6bdb6f8327e7d7ccd6de80a48926ed8a05913d` | no |
| `deliverable-write` | **29** | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | no |
| `batch-write` | **29** | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | no |

```json
{
  "schema": "syncview_f27_section4_deployed_versions_v1",
  "deploy_commit": "f04e08e01e542b30bdeb44f46390cb877ade01c4",
  "github_run_id": "31214635190",
  "run_conclusion": "failure_at_final_verification_only",
  "functions": [
    { "slug": "batch-write", "active_version": "29", "source_closure_sha256": "86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a", "entrypoint_sha256": "15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5", "verify_jwt": false },
    { "slug": "deliverable-write", "active_version": "29", "source_closure_sha256": "78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575", "entrypoint_sha256": "74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68", "verify_jwt": false },
    { "slug": "linear-outbound", "active_version": "38", "source_closure_sha256": "ef89adbf7245127516fad90877c3b00de0043b9430e7ad5f33cbfd675543b26a", "entrypoint_sha256": "606628504ec4614a22e9d16c7671dc5d9ef73bfc57b69ecaa08065a5d14f3684", "verify_jwt": false },
    { "slug": "production-write", "active_version": "32", "source_closure_sha256": "50970ca24c74c9044b2c92492d6bdb6f8327e7d7ccd6de80a48926ed8a05913d", "entrypoint_sha256": "7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5", "verify_jwt": false }
  ]
}
```

**Verified after the fact, not assumed:** `scripts/ef-fingerprint.js` at
`f04e08e` in live mode returns `deployed == reviewed` and `entrypoint` true for
all four, `4 PASS / 0 FAIL / 0 ERROR`, `verify_jwt=false` on all four. A fresh
four-function `capture` returns `result=PASS`,
`provider_source_exactness=PASS`, `function_count=4` with exactly the versions
and closures above. Repository and deployment agree.

**Why the run went red.** The step failed at its FIRST sub-command — the
four-function version-stable capture — 4.5 seconds into an operation that takes
roughly 8, so partway through, on one of its twelve Management API reads. The
same command, byte for byte, passes on demand against the same live project.
Two defects turned one transient response into a red deploy of unknown standing:

- **No retry.** Every Management API read in the repository threw on the first
  non-2xx. One deploy run makes on the order of fifty of them within a few
  minutes (four CLI deploys, four per-slug captures at three reads each, four
  per-slug fingerprints, then twelve for the final capture).
- **No reason.** The step redirects stderr into the private directory, which the
  always-run cleanup step then destroys, and published only *"The final exact
  four-function version-stable capture failed"*. Even had it been echoed, the
  CLI's failure formatter collapsed every unrecognised error to one generic
  sentence. **The precise status is therefore unrecoverable for this run** — the
  evidence supports "transient provider read", not a specific HTTP code, and
  this entry does not claim one.

Both are fixed on the next release: transient statuses (429/5xx/timeout) retry
up to four times with backoff and a capped `Retry-After` while 401/403/404 still
fail on the first response; the failure names which read and which status; and
all thirteen stderr-redirect sites in the lane echo their formatter's own lines
back to the run log through a grammar-gated allowlist. Guarded by
`test/f27-provider-read-diagnostics.js`.

**Rollback for this deploy:** bundle
`a3bbdb1dffe19c1091efb3484fb25f81155b0850c579bc9ec4a321def825e851` /
`396609` bytes, stored in the F27 private Shared Drive root with
`independent_private_readback: PASS`. It captures the pre-deploy four, so it is
one step back and correct for this release.

### Deploy #5 — RECORDED (run `31217806479`, 2026-08-07)

Owner-dispatched from `main` head
`58856fce68252b0c405491c35a88fd1b5ab68b5a`. **Fully green, including the final
four-function verification step that failed on run `31214635190`.** Ships the
batch-parent `status: "todo"` fix (Create Post parents were inheriting the team
default, which put every Video batch in Triage) and the deploy lane's own
retry + failure-reporting fixes (#1036).

| function | version | source closure SHA-256 | changed? |
|---|---|---|---|
| `production-write` | 32 → **33** | `f7a285e147c4a23100e5befe2fc6e7011eb27affecb5b8af7e414dbed765e013` | **YES** — was `50970ca24c74c9044b2c92492d6bdb6f8327e7d7ccd6de80a48926ed8a05913d` |
| `linear-outbound` | **38** | `ef89adbf7245127516fad90877c3b00de0043b9430e7ad5f33cbfd675543b26a` | no — no version bump |
| `deliverable-write` | **29** | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | no — no version bump |
| `batch-write` | **29** | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | no — no version bump |

```json
{
  "schema": "syncview_f27_section4_deployed_versions_v1",
  "deploy_commit": "58856fce68252b0c405491c35a88fd1b5ab68b5a",
  "github_run_id": "31217806479",
  "functions": [
    { "slug": "batch-write", "active_version": "29", "source_closure_sha256": "86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a", "entrypoint_sha256": "15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5", "provider_bundle_sha256": "1d10eed973f1f171884348cc1563412b9889754e3c80f2677636cf8632e719ce", "verify_jwt": false },
    { "slug": "deliverable-write", "active_version": "29", "source_closure_sha256": "78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575", "entrypoint_sha256": "74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68", "provider_bundle_sha256": "26bb049fecf3922187e7029bfef3cece3186cbe01aee4bbb73ae4ce49988916c", "verify_jwt": false },
    { "slug": "linear-outbound", "active_version": "38", "source_closure_sha256": "ef89adbf7245127516fad90877c3b00de0043b9430e7ad5f33cbfd675543b26a", "entrypoint_sha256": "606628504ec4614a22e9d16c7671dc5d9ef73bfc57b69ecaa08065a5d14f3684", "provider_bundle_sha256": "964925232e9d71c4b8668c5d72c0e3a46ee0718d685b807ab0f0626d5980b97a", "verify_jwt": false },
    { "slug": "production-write", "active_version": "33", "source_closure_sha256": "f7a285e147c4a23100e5befe2fc6e7011eb27affecb5b8af7e414dbed765e013", "entrypoint_sha256": "7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5", "provider_bundle_sha256": "f75ccbfd415ae5b9c0db7a069d6d625b63baaa8e8658417bc60ce9849e5e9d68", "verify_jwt": false }
  ]
}
```

**Proved live, not inferred.** The TEST drill (run `31217933580`) exercised
`intake_create` end to end minutes later and produced, on the Video team:

- **VID-13266**, the batch parent, in state **Todo** (`statusType: unstarted`).
  Before this deploy the same path produced Triage.
- **VID-13267**, the item, with **`parentId: VID-13266`** — nested, not an
  orphan.
- VID-13266's stored description is
  `Filming Plan: [https://…](<https://…>)` — Linear's own auto-link rewrite of
  the bare URL we sent, the exact string that terminalized the parent's outbox
  row as an idempotency conflict for five days. It no longer reads as a
  create-intent mismatch.

That drill run still reported `ok:false`: its NEW nesting assertion had a bug
of its own (it read `linear_parent_ids` — a team-keyed object of
`{uuid, identifier, url}` — as a string, so `"[object Object]"` satisfied the
"a parent was recorded" check and failed the id comparison one line later).
Fixed in #1037. The product was correct throughout; only the check was wrong.

**Standing remediation discharged in advance.** The bundle dispatched with this
run (`e7b1179b…`) captured `production-write` at v32 and is now one deploy
stale. A fresh capture of the live four **including v33** has been taken,
stored in the F27 private Shared Drive, fetched back out independently, and put
through the same `inspect` gate the lane runs at step 5 —
`result=PASS`, `provider_source_exactness=PASS`, `function_count=4`:

```
rollback_bundle_sha256        7e40504cd4f9f43c510d9eea302bd24ef2b2f66bd7906a434693e3d6dd876a8f
rollback_bundle_byte_length   401358
```

Use those two values for the next dispatch. Unlike every previous entry in this
log, the next deploy is **not** blocked on a stale or unstored bundle.

### Deploy #6 — RECORDED (run `31832712978`, 2026-08-14)

Owner-dispatched from `main` head
`bea22afb08b6df98c29be7deb7bd6aa78c4179a0`. **Fully green.** Ships the #1065
gateway comment front door in `production-write` — step 2 of the FLIP_RUNBOOK
"GATEWAY COMMENT FRONT DOOR" chain. The other three functions redeployed
byte-identical (the lane deploys the four-function closure as one operation).
`client_comment_gateway_enabled` was OFF (absent row) for the whole run, so
nothing client-reachable changed at deploy time; the flag flip is the chain's
step 3, recorded separately when the owner runs it.

| function | version | source closure SHA-256 | changed? |
|---|---|---|---|
| `production-write` | 33 → **34** | `450fca94c8313746d3292f970de4a76f702d43fbf7aad4acb0d7d639fe9603be` | **YES** — was `f7a285e147c4a23100e5befe2fc6e7011eb27affecb5b8af7e414dbed765e013` |
| `linear-outbound` | 38 → **39** | `ef89adbf7245127516fad90877c3b00de0043b9430e7ad5f33cbfd675543b26a` | no — byte-identical redeploy |
| `deliverable-write` | 29 → **30** | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | no — byte-identical redeploy |
| `batch-write` | 29 → **30** | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | no — byte-identical redeploy |

```json
{
  "schema": "syncview_f27_section4_deployed_versions_v1",
  "deploy_commit": "bea22afb08b6df98c29be7deb7bd6aa78c4179a0",
  "github_run_id": "31832712978",
  "functions": [
    { "slug": "batch-write", "active_version": "30", "source_closure_sha256": "86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a", "entrypoint_sha256": "15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5", "provider_bundle_sha256": "88246f1e3e128a9a648df928ff3f231d0f1afe39642a1125c90346a85c498214", "verify_jwt": false },
    { "slug": "deliverable-write", "active_version": "30", "source_closure_sha256": "78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575", "entrypoint_sha256": "74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68", "provider_bundle_sha256": "c505f4ce6ef2e809083c38f9346c8b2b8867faaf498053b950fe00eced2158c0", "verify_jwt": false },
    { "slug": "linear-outbound", "active_version": "39", "source_closure_sha256": "ef89adbf7245127516fad90877c3b00de0043b9430e7ad5f33cbfd675543b26a", "entrypoint_sha256": "606628504ec4614a22e9d16c7671dc5d9ef73bfc57b69ecaa08065a5d14f3684", "provider_bundle_sha256": "5ac2e449d4aa1b3a4296b4e11fd3fc878df0f26a186fc7fe4b132214d63df460", "verify_jwt": false },
    { "slug": "production-write", "active_version": "34", "source_closure_sha256": "450fca94c8313746d3292f970de4a76f702d43fbf7aad4acb0d7d639fe9603be", "entrypoint_sha256": "7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5", "provider_bundle_sha256": "805bf991e5d5f2da28d20fc8d07d8cc630593e1d8c3a945c9243aba87961a0fa", "verify_jwt": false }
  ]
}
```

**Rollback bundle for this dispatch.** The owner captured a fresh seal minutes
before dispatch (`capture` receipt `result=PASS`, `provider_contract=PASS`,
all four prior fingerprints byte-equal to the Deploy #5 live set above) and
uploaded it to the F27 private Shared Drive root; the lane fetched and
independently verified it (`Sealed prior-four private fetch: PASS`):

```
rollback_bundle_sha256        bea80331d39d12847232505335bfbb8c1af6ba09edb4c04cdf425b4a0056f4a1
rollback_bundle_byte_length   401358
```

The 2026-08-07 recorded bundle (`7e40504c…`, same byte length) seals the same
prior set — either restores THIS deploy's prior four. Both are one deploy
stale for anything after run `31832712978`: any FUTURE Section-4 dispatch
needs a fresh capture that includes `production-write` v34.

### Deploy #7 — RECORDED (run `31983530107`, 2026-08-17T00:57Z)

Owner-dispatched from `main` head `4cbc52b6e6b6b1bc5b28123573d82f5705ae0473`
(#1070). **Fully green.** Ships the owner-ruled widening of the Graphics
approval-artifact gate (#1069): folders and Frame.io links qualify as
deliverables, a live page on an allowlisted provider host counts as evidence,
and an empty `deliverables.file_url` falls back to the BOUND calendar card's
`thumbnail_url`. Dispatched the day after THE FLIP, to clear the blocker the
flip exposed — measured that day, the strict reading would have refused SMM
approval to 1,972 of 2,009 active graphics deliverables.

| function | version | source closure SHA-256 | changed? |
|---|---|---|---|
| `production-write` | 34 → **35** | `5bbde6911efdf2a7841bd5325199f858e0b2e2a5fbb59b5887140cabf4a98888` | **YES** — was `450fca94…` |
| `linear-outbound` | 39 | `ef89adbf7245127516fad90877c3b00de0043b9430e7ad5f33cbfd675543b26a` | no |
| `deliverable-write` | 30 | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | no |
| `batch-write` | 30 | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | no |

Rollback bundle: owner-captured minutes before dispatch, receipt `result=PASS`
/ `provider_contract=PASS`, sha256 prefix `53725fa1…`, byte length `405575`.
**The full 64-hex value is in run `31983530107`'s job summary** — this entry
records the prefix as pasted in chat, and a restore must read the run summary
(or take a fresh capture) rather than trust the prefix.

Logged retroactively 2026-08-17 alongside Deploy #8; the gap, not the deploy,
was the defect.

### Deploy #8 — RECORDED (run `31992397419`, 2026-08-17T03:49Z)

Owner-dispatched from `main` head `e536dba8a348bc4569be6e90753233bda7c90293`
(#1071). **Fully green.** One-host change: `next.frame.io` added to
`ASSET_HOSTS` and to the Frame.io branch of `assetUrlType`. An `f.io/<id>`
short link 302s there, so without the host the probe's redirect allowlist
refused the hop and EVERY Frame.io artifact resolved `unavailable` — Deploy
#7's widening was inert for the exact case the owner asked for ("sometimes we
do put a Frame.io link for images"). Found by probing a real card link against
the deployed v35, not by reading code.

| function | version | source closure SHA-256 | changed? |
|---|---|---|---|
| `production-write` | 35 → **36** | `034704bc8d5db852ed4968062cc55d607b998a5a54b8b87ff569b0862c1c95d4` | **YES** — was `5bbde691…` |
| `linear-outbound` | 39 | `ef89adbf7245127516fad90877c3b00de0043b9430e7ad5f33cbfd675543b26a` | no |
| `deliverable-write` | 30 | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | no |
| `batch-write` | 30 | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | no |

Fresh sealed rollback capture, owner-run minutes before dispatch and
independently fetched + verified by the lane (`Sealed prior-four private
fetch: PASS`); it seals the Deploy #7 live set (`production-write` v35):

```
rollback_bundle_sha256        ad544cb56ffe642b9d5c1555e533f9403cb6571c93a6c5a4062a6e66c2ed434d
rollback_bundle_byte_length   410812
```

This is the CURRENT restore bundle. Every earlier recorded bundle
(`bea80331…`, `7e40504c…`) is now stale by two deploys.

**Proven live after the deploy** (TEST client `sidneylaruel` only, deliverable
`TEST 3`/GRA-6311, admin role key + roster actor):

| attempt | before (v35) | after (v36) |
|---|---|---|
| attachment `https://f.io/HXh_8tQv` | 409 `artifact_not_resolvable`, `asset_state=unavailable` | **200 ok** |
| `smm_approval` on that Frame.io deliverable | — | **200 ok** |
| attachment, real Drive folder `?usp=drive_link` (a link in live use on real cards) | — | **200 ok** |
| attachment, real Drive folder `?usp=sharing` | — | **200 ok** |
| `smm_approval` on a Drive-folder deliverable | — | **200 ok** |
| Google Doc as deliverable | 400 `invalid_artifact_url` | 400 `invalid_artifact_url` |
| off-allowlist host | 400 `invalid_artifact_url` | 400 `invalid_artifact_url` |
| `http://` (not HTTPS) | — | 400 `invalid_artifact_url` |

Widening the host allowlist did not loosen the shape rules: Docs, unknown
hosts and non-HTTPS are all still refused. The real-folder cases close the one
gap left open on flip day, when the only folder tested was a fabricated URL
that 404'd and so proved nothing.

---

### Deploys #9-#13 — GAP, recorded retroactively 2026-08-18

This log jumped from Deploy #8 straight to today. Five owner-dispatched forward
runs of the same lane went unrecorded, discovered while preparing Deploy #14 by
comparing the live versions against the last entry: the log's newest record was
`production-write` v36, live was v40. Each run below succeeded (the lane cannot
report success without its final four-function comparison passing), but no
per-run receipt was captured at the time, so only the dispatch facts are
recoverable from the run history.

| # | run | dispatched | release commit |
|---|---|---|---|
| 9 | `32044279603` | 2026-08-17T16:04Z | `b7ce6fce` |
| 10 | `32078204002` | 2026-08-17T22:55Z | `55115257` |
| 11 | `32083501665` | 2026-08-18T00:11Z | `0903ed38` |
| 12 | `32094266535` | 2026-08-18T03:06Z | `0ef5de75` |
| 13 | `32160920477` | 2026-08-18T16:33Z | `780f3d8d` |

Two earlier runs on 2026-08-17 (`32044130441`, `32043921369`) failed and were
not retried forward; the successful `32044279603` followed on the same commit.

**Why this matters beyond bookkeeping.** The rollback bundle recorded against
Deploy #8 (`ad544cb5...`, sealing `production-write` v35) was five versions
stale by today. Anyone reading this log to answer "what is the current restore
bundle?" would have dispatched a restore that reverted four releases. The
bundle below supersedes it.

### Deploy #14 — RECORDED (run `32196004592`, 2026-08-18T23:10Z)

Owner-dispatched from `main` head
`a769013caac83f569a86f5f779856d8062ffb979`. **Fully green**, including the
final four-function source/entrypoint/JWT/version/provider comparison.

Ships the batch-append repair in `production-write`: the planner accepts a
single-team card group (the 2026-08-17 Video only / Thumbnail only modes) as
well as a video+graphics pair, titles rows per kind (`Video N` / `Thumbnail
N`), and the gateway error map recognises `batch_not_found`. The other three
functions redeployed byte-identical -- the lane deploys the four-function
closure as one operation.

| function | version | source closure SHA-256 | changed? |
|---|---|---|---|
| `production-write` | 40 -> **41** | `07664530a168eea0ea4c323fc9546b3c1b8234e117be3605fb9218f23e9e99fa` | **YES** -- was `fdf03014...` |
| `linear-outbound` | 41 | `eff38b6916e4b99f9ed1ed946cfd0a01a9585e0eb880d2fe114d29dfccb85c42` | no -- byte-identical redeploy |
| `deliverable-write` | 30 | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | no -- byte-identical redeploy |
| `batch-write` | 30 | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | no -- byte-identical redeploy |

Fresh sealed rollback capture, owner-run minutes before dispatch and
independently fetched + verified by the lane (`Sealed prior-four private
fetch: PASS`, `provider_contract: PASS`); it seals the Deploy #13 live set
(`production-write` v40, `linear-outbound` v41):

```
rollback_bundle_sha256        ebd1585f74f3c13a88ad09723dca2a860ed7c09a7582431eb67195eafa1c1ad9
rollback_bundle_byte_length   421292
```

This is the CURRENT restore bundle. Every earlier recorded bundle
(`ad544cb5...`, `bea80331...`, `7e40504c...`) is stale.

**The deploy alone does not fix appends.** It is half of a two-part repair: the
RPC the new planner calls, `production_intake_append`, has never existed in the
live database -- the 2026-07-13 migration that defined it was written and never
run, which is why every append since the 2026-08-14 batch picker returned 500
`native_write_failed`. The completing half is the owner running
`migrations/2026-08-18-production-intake-append-v2.sql` in the SQL editor.
Deploy-before-SQL was chosen deliberately: applying the SQL against the OLD
gateway would have opened a window where an append commits server-side while
the browser cannot reconcile it, leaving deliverables with no calendar cards.

### Deploy #15 — RECORDED (run `32211908080`, 2026-08-19T03:22Z)

Owner-dispatched from `main` head
`f05c31322cd3786e4cea4683092bb4b15e5af318`. **Fully green**, including the
final four-function source/entrypoint/JWT/version/provider comparison.

Ships ONE fix in `production-write`: an append validates the batch parent
against the team that OWNS the parent issue, not the team asking for it. The
native flow creates a single Linear issue serving every team a card has, and
records it under each team's key with `owner_team` stamped -- `mapping.mjs`
says the stamp exists so consumers "validate the parent against the team that
owns it rather than against the team that is asking". The append route
validated against the asker, so the graphics half of a Video+Thumbnail append
resolved the batch's VIDEO issue and was refused because a video issue is not
a graphics issue. It refused a thumbnail append to EVERY batch whose only
parent is a video issue, which is every batch the native flow creates.

| function | version | source closure SHA-256 | changed? |
|---|---|---|---|
| `production-write` | 41 -> **42** | `18735baf9e2382e73671673f32bfcca9c6bb3cd4e62d242f5662fa20f50a5724` | **YES** -- was `07664530...` |
| `linear-outbound` | 41 | `eff38b6916e4b99f9ed1ed946cfd0a01a9585e0eb880d2fe114d29dfccb85c42` | no -- byte-identical redeploy |
| `deliverable-write` | 30 | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | no -- byte-identical redeploy |
| `batch-write` | 30 | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | no -- byte-identical redeploy |

Fresh sealed rollback capture, owner-run minutes before dispatch and
independently fetched + verified by the lane (`Sealed prior-four private
fetch: PASS`, `provider_contract: PASS`); it seals the Deploy #14 live set
(`production-write` v41):

```
rollback_bundle_sha256        0c632629e163e2c0125105a069af6ca462b8b8afd549d0bad39271d4a1fc1564
rollback_bundle_byte_length   421983
```

This is the CURRENT restore bundle. `ebd1585f...` (the Deploy #14 bundle) and
every earlier one are stale.

**Proven against live production data, without mutating it.** The decision was
replayed with the deployed policy module over the real parent map of the batch
that was failing (one video parent issue serving both teams, `owner_team`
video, project `f3f73bfb...`), and against that issue's real Linear team and
project read back from Linear:

| team asking | parent resolved | owner | validated against ASKER (old) | against OWNER (new) |
|---|---|---|---|---|
| video | `7e4add90...` | video | pass | pass |
| graphics | `7e4add90...` | video | **REFUSED** | **pass** |

That is the reported failure and its repair, on the exact row that produced
it. Video behaviour is unchanged.

**CORRECTION (2026-08-19, ~04:0xZ): the chain was NOT complete.** Two more
refusals hid behind the one this deploy fixed, both in the owner-applied RPC's
dependency validation, both the same class: comparing the SHARED video
batch-create dependency against per-lane attributes of the graphics row.
The v3 SQL (owner-applied minutes after this deploy) waived only the TEAM
equality; the parity equality directly below it refused the identical appends
next -- the video lane runs legacy_parity true while the graphics lane runs
false post-flip, read off the live outbox rows -- and the project equality
was queued behind that for any client whose per-team projects differ. The
owner-applied v4 SQL (migrations/2026-08-19-production-intake-append-v4.sql)
waives all three together, only when both teams resolve to the identical
single parent issue; a same-team mismatch still refuses. Reproduced and
proven on a disposable PostgreSQL 16 with the real parity values before v4
was handed over.

**VERIFIED LIVE (2026-08-19 03:51Z).** Minutes after the owner applied v4,
the first two `intake_append` events in the system's history landed on the
originally-failing batch: two Video+Thumbnail posts appended from the
Calendar dialog (item_count 2, card_count 1 each), deliverables Video 2/3 and
Thumbnail 2/3 written with per-kind titles and advancing ordinals, and all
four mirrored to Linear under the shared parent -- VID-13402/13403 on the
parity lane (parity true) and GRA-7124/7125 on the native lane (parity
false), every outbox row `written`. The end-to-end chain -- dialog, gateway
v42, v4 RPC, deliverables, outbox, drain, Linear -- is proven on real client
work, not a fixture.

**The append chain is now complete.** Deploy #14 shipped the planner and the
post-shape modes; the owner applied the v2 migration by hand (the RPC had
never existed); this deploy fixes the parent validation. All three were
required before a Video+Thumbnail post could be added to an existing batch.

## 2026-08-10 — owner-run production SQL: 5-row graphics batch repair (logged retroactively)

**What ran.** The owner pasted, into the Supabase SQL editor, a single guarded
`do $$` block updating `public.deliverables.batch_id` for exactly five rows —
identifiers GRA-6893…GRA-6897, `team='graphics'` — from the collided video
batch (`b1_b_5a47c5eab094cfe20edc40b509e0`) to the fresh graphics batch
(`b1_b_71dc83745f8bfdf00961d13600ec`), with `get diagnostics` refusing unless
exactly 5 rows matched. Read-back SELECT confirmed all six family rows
(GRA-6892…6897) on the graphics batch. Screenshot receipts in chat: "Success.
No rows returned" + the six-row read-back.

**Why.** The five children are in completed Linear states, so no importer path
recomputes their `batch_id` (`softClosedDeliverableRow` preserves it verbatim)
— the 2026-08-03 title-collision mis-filing was permanent without a direct
write. Full diagnosis: OPEN_REPAIRS item 5 addendum "Six of the twelve
diagnosed 2026-08-10".

**Rollback.** The inverse UPDATE with the two batch ids swapped and the same
exactly-5 guard.

**Logged retroactively 2026-08-10** after the fresh-eyes reset audit flagged
the missing entry (rule: every production write is logged here). The gap, not
the repair, was the defect.

## 2026-08-24 — Slack creative-channel migration: two real bugs caught by a live smoke test, and a logging gap

**What changed, and why this entry is late.** The Roam→Slack creative-channel
migration itself (Client — Onboarding Provisioning retargeted, new Client —
Slack Creative Channel Finalizer built, Sales — Call Booked's Kasper alert
dropped its Roam leg, Client — Roam Creative Group Finalizer archived) was
built and merged via PR #1125 without an EXECUTION_LOG entry or a private
pre-edit JSON export — a real miss against ROLLBACK.md rule 2/5, not a
judgment call. This entry, and the accompanying `n8n-backups/2026-08-24-
slack-creative-migration-status.md`, are that record, written after the fact
once a review comment on the follow-up PR (#1126) caught the gap.

**Two real bugs, found and fixed via a live smoke test the owner explicitly
approved ("yeah, let's do it").** First: roster verification on the new
Finalizer used `channel:get` with `includeNumMembers`, but that field does
not reliably come back from Slack on this n8n node version — a real
execution's response had no `num_members` at all, which would have parked
every real onboarding in manual reconciliation forever, silently. Switched to
listing actual channel members (`channel:member`, `returnAll:true`) and
matching each required Slack ID exactly. Second, caught immediately after by
the same smoke test: that member-list call returns each member as
`{"member":"U…"}`, not `{"id":"U…"}` as assumed — the rewritten check was
reading the wrong field and would have flagged everyone as missing even with
a correct invite. Both fixed and re-verified against real Slack (disposable
test channel, real invite, roster check returned `all_present:true` with
zero missing) before being republished to the live workflow.

**A separate, more basic tool-usage bug was found in the same pass.**
Several edits earlier in the session — made via `update_workflow`'s
`setNodeParameter` operation with a JSON-Pointer `path` — had silently
written into a dead nested `parameters.parameters.*` key instead of the real
top-level field. `appliedOperations` reported success; nothing was actually
live. This affected the Onboarding Provisioning retargeting and the Sales
Call Booked Roam-leg removal, both of which had already been reported
complete earlier in the session while still running their pre-edit graphs.
Root cause was compounded by a second, independent issue: neither workflow
had been re-published after editing, so even a correctly-applied change
would have sat in an unpublished draft. Both are now fixed (`updateNodeParameters`
instead of `setNodeParameter`, explicit `publish_workflow` after every edit
to an already-active workflow) and verified live via `versionId ===
activeVersionId` — not assumed from the edit call's return value.

**Version IDs, rollback instructions, and the disclosed private-export gap**
are in `n8n-backups/2026-08-24-slack-creative-migration-status.md`. Notably,
`Client — Roam Creative Group Finalizer` (`8LN6ReEIPhhWxA6v`) was archived
without a prior export and is now unreadable via every n8n MCP tool tried —
a genuine, currently-unrecoverable-by-this-session gap, flagged rather than
papered over.

**Verification, not just claims.** Every "fixed" line above was confirmed
two ways: a live execution against real Slack (not a validator pass), and a
`get_workflow_details` read-back showing `activeVersion.sameAsDraft: true`
on the production workflow after publishing. Earlier in this same session,
"complete" had been reported for changes that were not actually live; this
entry exists in part so that gap is on the record rather than repeated.

---

## 2026-08-24 — Two silent list-fallbacks and a banner that told the whole team something untrue

Three defects, all found from one owner sentence and one screenshot, all in
code that already had behavioural tests.

**1. A Production deep link did not survive the stale first paint.** The
Workload rollup's "Open SyncView →" link landed on the list and never opened
the item. `mountProductionView` paints from the localStorage snapshot before
reading live, and the drop-unresolvable-target guard ran on *both* paints — so
anything created since the reader last opened Production was discarded on the
cached paint, and the live read found `openId` already empty. What the reader
saw was the cached list: old data, no item. The cached paint now keeps the
request pending and the first authoritative read re-applies it, once, and never
over a reader who navigated meanwhile.

**2. A batch with two team parents kept only one of them.** `linear_parent_ids`
is a per-team map because one batch legitimately parents a video issue *and* a
graphics issue. The resolver keyed its node map by batch id, so the second team
overwrote the first — one synthetic row, both teams' children under it, and a
deep link by the losing identifier resolving to nothing. The existing coverage
only exercised the *mirrored* shape, where both slots hold the same uuid and the
dedupe hides the collapse; the correctly-filled shape was never written down.

**3. The Workload banner was making a false claim about the whole team.** Of
2,351 graphics rows exactly one was unprovable — a six-week-old TEST fixture
with no Linear issue — and every editor was reading *"Capacity may be
understated; due-date editing is paused."* Reading the code rather than the
banner: `wlDueWriteRoute` is per row and every provable row stayed fully
editable. Nothing was paused. A failed READ and individually unprovable ROWS
were collapsing into one sentence; they are now told apart and the row case
names its count. Load-bearing for the flip: the video side is pre-loaded with
seven of these, so on flip day the old banner would have fired for the whole
video team over rows nobody can see.

**Method note.** All three are the same shape: a fallback that is correct as
behaviour and wrong as *communication*. A silent list fallback and an
over-broad banner both leave a reader unable to describe what happened, which
is why the deep-link defect could only ever be reported as "it doesn't open
it". Every fix here adds a truthful message alongside the safe behaviour, and
the tests pin the messages, not just the states.

No live data was read for this entry — the container had no Supabase
credentials this session, so every claim above is from source, from the
already-measured counts in `docs/ops/FLIP_BUG_LEDGER.md` §10, or from the
owner's own report. The seven video rows still need a live repair before F1
and are still owed.

---

## 2026-08-24 — Kasper Ad Performance v2 merged (#1131): the leave-evidence class rename applied to new code, and a real conflict resolved rather than picked

PR #1131 (v2 UI: date-range toggle, per-ad breakdown, per-lead HubSpot funnel)
went stale against `main` when #1129/#1130 landed first. `git merge origin/main`
auto-merged everything except one hunk in `_kadPaint()`, but resolving that
hunk correctly required understanding *why* the two sides differed, not just
picking one.

**The real conflict.** #1129 had, same day, fixed a genuine defect: the
ad-performance panel was reusing six PTO/Time-Off CSS class names
(`pto-admin-card`, `pto-admin-title`, etc.) for its card chrome, and the
leave-evidence CI gate fingerprints every `index.html` line matching a PTO
class-name token — so an unrelated Kasper markup edit made a published
101-screenshot packet read as stale, turning that lane red on `main` for no
leave reason. #1129's fix gave the panel its own `kad-card`/`kad-section-title`
classes, declaration-for-declaration copies of the ones it dropped. v2's new
by-ad and per-lead sections were written before that fix landed, so they still
used the borrowed names — and also borrowed three more PTO classes
(`pto-table-scroll-cue`, `pto-table-scroll`, `pto-table`) for their scrollable
tables, which #1129 never had reason to touch since v1 had no tables.
Resolved by extending the same fix: added `.kad-section-sub` and
`.kad-table-*` (same declaration-for-declaration copy pattern) and repointed
`_kadByAdTableHtml()`/`_kadLeadsListHtml()`/the card wrappers at them.
Verified against `test/leave-evidence-fingerprint-coupling.js`'s own token
scan — zero `pto-` tokens left in the panel's source span — not just by eye.

**A second, unrelated bug the merge exposed.** `node test/run-all.js` then
crashed in `test/prod-multiselect-parity.js` with `Error: unclosed
_prodReconcileSelection`. Root cause: that test (and 31 others) extracts a
named function's body with a hand-rolled brace/quote scanner that has no
concept of `//` comments. `_prodReconcileSelection`'s own comment read "a
parent's sub-issue section" — the apostrophe opened a phantom string literal,
and the scanner silently consumed everything after it looking for the next
literal quote to close it. This was **already live and wrong on `main`**: it
grabbed ~958KB of unrelated downstream content instead of the real ~1.7KB
function body, and the test only passed because that wrong huge chunk happened
to still contain the substrings being checked for. The merge's file-length
shift moved where the scanner's runaway match would have landed, and this
time it ran off the end of the file instead, crashing the suite outright.
Fixed at the trigger — reworded the comment to drop the apostrophe — not the
scanner; `_prodReconcileSelection` itself was never broken, and hardening the
shared extractor pattern across 32 files is separate work (flagged, not done
here).

**Merge and deploy.** `node test/run-all.js` returned to 1 of 282 suites
failing (only the pre-existing `test/assurance-ledger-staleness.js` Windows
`/tmp`-path flake, unrelated). Merge commit `2ee80c3` pushed, PR #1131 turned
`MERGEABLE`, owner merged to `main` as `e1eaf9a`. Pages run `32782933105`
deployed the merge (watched to completion, not assumed). Live-HTML fetch from
`https://syncview.synchrosocial.com/` confirmed the date-range toggle,
`_kadByAdTableHtml`, and `_kadLeadsListHtml` markers are present, and the same
zero-`pto-`-token check that guards the merged source also passes against the
actually-served bytes. Kasper Ad Performance v1 + v2 — table, function, n8n
pipeline, and UI — is now fully live end to end.

---

## 2026-08-24 — Create Post learns to name the editor, and "freest" starts meaning free

Owner request: *"in the single view calendar, when someone creates a post, there
should be a drop-down for the editor. By default, it should be the one that's
the freest, and it should disclaim it, but people should be able to choose a
different video editor."*

**The default was already automatic — and already wrong.** `autoAssigneeForIntake`
has been picking the video editor since intake shipped, invisibly. It counted
every video row that was not a `duplicate`, which includes work approved and
posted months ago, so an editor's load never fell. The balancer therefore
drifted permanently toward whoever joined the roster most recently: it read as
load-balancing and behaved as a seniority ranking. It now counts only work still
owed — `todo`, `in_progress`, `tweak`.

**Three things the picker had to get right.** The dialog names a person and a
number, so the number has to be true; the browser and the gateway now run the
same rule over the same three statuses, ties broken the same way, and
`test/native-post-editor-picker.js` fails if the two lists ever diverge — the
failure mode being that both halves look correct in isolation while the dialog
promises an editor the server would never pick.

**Deploy order decided the payload shape.** `index.html` reaches users the moment
it merges; `production-write` is deployed by hand. Between those moments the live
gateway refuses every intake assignee, so an always-sent choice would have failed
*every* video Create Post in that window — for a default that changes nothing.
The browser therefore sends `assignee_id` only when the suggestion is actually
overridden. The default path is byte-identical to the pre-picker payload and
works against the gateway that is deployed today; the override needs the pending
`production-write` deploy and, until it lands, is refused with a message that
says so instead of a raw code.

**The gateway widens who may be picked, never how a pick is checked.** An override
is validated by the same `assertEligibleAssignee` as every other assignee write,
graphics still refuses an override outright (one `default_for_team` designer, so
there is nothing to choose), two items naming different editors are refused
before anything is written rather than resolved by item order, and a prior
attempt's assignee still beats a fresh choice so a retry cannot move work someone
has already started.

**Two gates caught real drift on the way.** `system-map-sync` refused the new
literal REST read until the map named it — and its extractor turned out to
truncate `production_deliverables_browser_v1` to `..._browser_v`, so no versioned
view could ever satisfy it; widened. `write-ui-failure-messages` refused the new
refusal code until it had user-facing guidance. Both are working exactly as
intended and are recorded here rather than worked around.

---

## 2026-08-24 — Kasper Ad Performance v3: unfinished leads, by way of a workflow that already existed

Owner feedback on the live v1/v2 panel, roughly: two visual spacing bugs, a
question about a duplicate-looking lead row, and a request to also show
leads who started booking a call but never finished ("potential", "qualified",
not "disqualified"), plus whether a follow-up email has gone out — "we have a
whole workflow for that, so you can check it out."

**Spacing (shipped, PR #1136).** `#kadBody`'s children (range toggle, stat
cards, chart, by-ad table, leads table) had no gap between them — v1's only
spacing came from `.kad-stats`'s own `margin-bottom`, which v2 never extended
to its new siblings. Fixed by giving `#kadBody` the same `display:grid;
gap:16px` as `.kad-wrap`, dropping the now-redundant margin.

**The "duplicate Mike" was real data, not a bug.** Queried `kasper_ad_leads`
directly: two distinct `iclosed_booking_id`s, same HubSpot contact id
(`534113609409`), different call dates (Aug 13 booked Aug 11, Aug 18 booked
Aug 13) — the same person genuinely booked twice, typing his name slightly
differently ("Mike" vs "Michael") the second time.

**Finding "the whole workflow."** iClosed's own `eventCalls` API (what the
existing pull already queries) only returns completed bookings — there is no
way to reach pre-booking "potential"/"qualified" leads through it, and the
matching HubSpot contacts carry `hs_analytics_source: OFFLINE` with no UTM
data, so that route was a dead end for campaign attribution. Searching n8n
for "recovery" surfaced the real system: "Sales — Booking Recovery Capture
(iClosed)" (`31DnMJLU3YM89py1`) already receives iClosed's Contact-by-status
webhook and arms anyone who starts the acquisition-calendar flow
(`social-media-consultation`/`ai-intro-call`) without completing a call into
an n8n Data Table, `booking_recovery` — full UTM/fbclid attribution, iClosed
qualification status, and `follow_up_due_at`; "Sales — Booking Recovery
Dispatch" (`nQ4vnZ8bmG3E3Lor`) sends the actual recovery email and sets
`email_sent_at`. Booked, disqualified, and other-calendar leads never reach
`status='pending'` there — filtering to `status='pending' AND
utm_campaign='prospecting'` gives exactly "unfinished, this campaign, not
disqualified" with no re-filtering needed. Verified against real rows via a
disposable read-only n8n test workflow (created, executed, archived): most
existing rows are test/smoke fixtures, but two real people with real Meta ad
UTM data (`utm_campaign: prospecting`, `utm_content: Video | Fast Pitch`)
were present, correctly marked `suppressed`/`disqualified` and so correctly
excluded by the filter. No `pending` rows exist yet — the recovery system is
10 days old — so the dashboard section will start empty and populate as the
campaign generates real abandons.

**What shipped (source, not yet merged).** New table
`kasper_ad_unfinished_leads` (PK `lead_key`, real PII: name/email/phone),
applied to production; `kasper-ad-performance-read` redeployed returning
`unfinished_leads`; the auth test extended to also forbid `email`/`phone`/
`first_name`/`last_name` in the console log. The live-pull n8n workflow was
rebuilt (`CdCYzye6Khp6x5A6`, superseding `BKl9OFVMb4VS2IHf`) with a 4th
independent branch — `Pull Unfinished Leads` (Data Table `get`, the two
filters above) → `Map Unfinished Leads` → `Upsert Unfinished Leads` — that
doesn't touch the existing three branches or `Build Daily Rows` at all.
Deliberately **not** added to the backfill workflow: `status='pending'` is a
current snapshot, not a historical range, so the live pull's first run
already captures everything currently pending. The UI adds a separate
"Unfinished leads" section (not merged into "Booked leads" — the columns
differ) showing status and a follow-up column ("Email sent \<date\>" / "SMS
sent \<date\>" / "Not yet — due \<date\>").

**Still owed before this is live:** the new workflow's 8 HTTP Request nodes
need credentials wired by hand (brand-new workflow record — same one-time
requirement every prior rebuild of this workflow has needed), then a first
test execution to prove it, then publish + archive the old revision, then
merge the UI branch. `node test/run-all.js` is green (283 suites, only the
pre-existing `assurance-ledger-staleness.js` Windows-path flake) but no live
n8n proof exists yet for this specific change.

---

## 2026-08-24 — A rename forked the batch; a backgrounded tab now takes the new version

Two independent changes, both from things the owner reported in the same
sitting.

### The forked batch

A family of 15 thumbnails opened as 15 top-level cards, each offering "Add
sub-issue" on something that already was one. The cause was not the resolver —
it was doing exactly the right thing.

`batchGroupKey` hashes `client | parent title | parent description`, and that
hash IS the batch's primary key. All three inputs are text a person edits in
Linear. Rename a parent issue and the next import mints a batch with a **new
id** for a parent the old batch still claims; nothing ever releases the old
claim. `_prodResolveBatchParentNodes` then fails closed on the ambiguity — it
refuses to guess which of two batches is the parent — so no synthetic parent row
is built and every child renders top-level.

Census over all 1,453 batch rows and 5,373 deliverable rows, keyset-paged: **86
parents claimed by 2+ batches, across 123 batch rows, orphaning 45 sub-issues.**
107 of the losing rows were minted by the importer. Only 12 forked on a visibly
different name; the rest forked on the parent **description**, which nobody
watches.

*An earlier figure in this session said 541 orphaned rows. That was wrong and
overstated: it counted every row whose parent uuid appears in a duplicated set,
but a parent the importer also imported as a deliverable row resolves through
the deliverable map and never reaches the batch resolver. The number a reader
actually sees is 45.*

**The fix is to adopt, not to mint.** `adoptExistingParentClaimants`: a freshly
hashed group with no stored row of its own, whose parent is already claimed by
an active batch, takes that batch's id. The rename lands as an ordinary UPDATE
to the existing name and the children file with their siblings. A group whose
minted id already exists is never moved, an archived shell is never a target,
and at most one group may adopt a target per run — two would put two rows with
one primary key into a single upsert. Every adoption reaches the run summary as
`batch_parent_adoptions`.

The 123 rows already forked are a data repair, handed to the owner as SQL and
simulated first against the shipped resolver over all 5,373 rows: 0 parents left
unowned, 0 parents still duplicated, 0 rows lose a parent, 45 regain one.

### The self-reload

The owner reversed the never-force-reload rule that OPEN_REPAIRS item 35 had
been holding open, and did it knowing the nudge already shipped in July: *"a tab
should reload itself when a new version is shipped, if it's in the background.
But if someone is in the tab, then they should just propose to reload it."*

A visible tab is unchanged. A hidden tab reloads itself **only when a reload
would cost nothing** — no rendered field moved off its default, no
contenteditable holding text, nothing open on top of the page. A refusal falls
back to the banner, waiting when the reader returns. One self-reload per tab per
half hour, stamped in `sessionStorage` *before* `location.reload()` so the stamp
survives the reload it caused; a host with an unstable version token therefore
reloads a tab once rather than forever, and no storage means no self-reload at
all.

The dirty check errs toward "dirty" deliberately, and its one known false
positive is named in the code and pinned in the tests: Workload sets its client
filter through `.value`, so a filtered Workload tab gets the banner and keeps
its filter.

`test/app-update-self-reload-behavior.js` lifts `wouldLoseWork` out of the
shipped file and runs it against a stub DOM rather than pattern-matching the
source. This session had already produced the lesson twice over — a
source-scanning check can pass for the wrong reason — and the condition that
decides whether someone's half-written caption survives is not one to leave to a
regex.

### Review found three, and one of them was the whole point of the feature

**The self-reload's dirty check could not see a SyncView control.** Every
branded control that carries a value is invisible by construction: `sv-select`
keeps its value in a `type="hidden"` input, `sv-date` in a 1px `opacity: 0`
one. And a hidden input uses HTML's *"default" value mode* — assigning `.value`
writes the content attribute too, so `defaultValue` moves with it and can never
disagree. A Time Off request is a select, two dates and a tick and nothing
else, on a panel rather than in a dialog. The check called it clean.

That is the exact failure the condition exists to prevent, and it survived a
behavioural test because the test was written against the same wrong model of
the DOM as the code. Fixed in two halves: field visibility is now judged from
`parentElement` so an invisible-by-design control is still checked, and a
capture-phase `input`/`change` listener stamps `data-sv-unsaved-edit` on
whatever the reader touched — the only signal that can see a hidden input's
pick at all. The marker lives on the element, so a re-render clears it; there
is no flag to reset.

Then verified against the real page rather than the stub: headless loads of the
staff Calendar, Production and Workload surfaces all read clean, so the feature
still fires, while a changed hidden input, a changed `opacity: 0` date input and
a ticked checkbox all read dirty.

**A second group reaching one parent used to keep its minted id.** The group key
includes the client, so an attribution change mid-run splits one parent's
children across two keys — 16 of the 86 live duplicates straddle `unattributed`
and a real client, so this is reachable, not theoretical. The first group
adopted and the second minted anyway, which would have inserted a fresh claim on
the parent just adopted and recreated the ambiguity on the next run. The second
group now redirects its children to the same batch and withholds its own row;
the children are safe because the adopted batch already exists.

**The adoption receipt never left the process.** It sat on the in-memory plan
only, and the scheduled workflow suppresses the private log and uploads just the
public artifact — so a run could rewrite which batch a family belongs to and
leave nothing behind. Now split by what each channel may carry: detail in the
persisted event (success and failure alike), an unconditional count in the
printed report so a zero is distinguishable from a stale report, and an
aggregate `{adopted, withheld}` in the public artifact, whose allowlist exists
precisely so nothing row-shaped escapes a public run. A new serializer test
feeds it real-shaped rows and asserts none of the ids appear in the output.

---

## 2026-08-25 — Kasper Ad Performance v3 goes fully live: credentials wired, proven, published

The owner wired credentials on all 8 HTTP Request nodes of the rebuilt
live-pull workflow (`CdCYzye6Khp6x5A6`, from #1137). Rather than take that at
face value, ran a real test execution (`428427`) to prove the whole pipeline,
not just the new branch — a credential mistake on any of the four services
(Facebook Graph, iClosed, HubSpot, Supabase) would otherwise only surface on
the next scheduled run, hours later, with nobody watching.

**What the execution proved.** All three pre-existing writers — `Upsert Daily
Rows`, `Upsert By-Ad Rows`, `Upsert Lead Rows` — reported `executionStatus:
success`, and no error appears anywhere in the execution data. The new `Pull
Unfinished Leads` branch ran too, returned zero rows (no `booking_recovery`
row currently matches `status=pending AND utm_campaign=prospecting`, the same
finding from the pre-build investigation), so `Map`/`Upsert Unfinished Leads`
correctly did not run — n8n's normal zero-item skip, not a failure.

**Independently verified against live data, not just n8n's status field.** A
direct Supabase readback immediately after the execution showed
`kasper_ad_performance_daily` and `kasper_ad_performance_by_ad_daily` both
carrying `updated_at = 2026-08-25 00:50:48`, matching the execution's own
`stoppedAt` to the second — proof the Facebook/Supabase credentials are
genuinely live, not merely present in the node JSON (recall: n8n's workflow-
creation API had already put the same credential references in place at
build time without them actually being usable — the established failure mode
for brand-new workflow records). `kasper_ad_leads` kept its prior
`updated_at` (an empty diff — no new/changed bookings since yesterday's proof
run — not a skipped write) and `kasper_ad_unfinished_leads` stayed at 0 rows,
consistent with the zero-item branch skip above.

Published the new revision (`activeVersionId` confirmed live, 2x/day cron)
and archived the superseded `BKl9OFVMb4VS2IHf`. Kasper Ad Performance v1
through v3 — every table, the Edge Function, both n8n workflows, and the full
UI — is now live end to end. The "Unfinished leads" panel section will render
empty until a real abandoned lead accumulates in `booking_recovery`, which is
the correct current state, not a defect.

## 2026-08-25 — Slack Creative Channel Finalizer: missing column silently dead-ended every client since the 2026-08-24 rebuild; live Sheets mutation to fix

**Incident.** The rebuilt `Client — Slack Creative Channel Finalizer` (§6/§19
of `docs/CLIENT_LIFECYCLE_MAP.md`) writes `creative_channel_id` back to the
`Clients Info` Google Sheet as its last step, verifying and recording the
channel it just created. That column was never actually added to the live
sheet — only ever documented/assumed to exist — so the write threw
`NodeOperationError: Column names were updated after the node's setup` on
every run since the rebuild. Channel creation and roster invites (earlier
steps in the same workflow) succeeded every time; only the write-back and the
two dependent Slack posts (kickoff, form brief) failed, routing silently to
manual reconciliation with `error_code: unexpected_failure`. 83 finalizer
runs over 17 hours all reported "success" at the workflow level before this
was caught — the DM-to-owner fallback fired correctly each time, but nobody
had connected the pattern to a schema gap rather than a readiness gate.
Found while onboarding a new client (identity withheld per §4's no-names
rule) when the expected automatic post never appeared.

**Root-caused via a synthetic probe, not guesswork.** Inserted a diagnostic
row directly into the `Slack Creative Channel Queue` n8n Data Table
(`SLpem4MfCeVoli4G`) with a client name that couldn't possibly match a real
Clients Info row, then manually triggered the finalizer. It picked up the
row within the same tick and correctly resolved it to `waiting` — proving
the read/claim/readiness-check path was never the problem, only the specific
downstream write-back. Also confirmed via `search_workflow_executions` that
the real client's original enqueue (`Client — Onboarding Provisioning`,
execution `428007`) reported `success` at the node level despite the row
never actually becoming queryable — the Data Table insert's own "success"
status does not guarantee the row landed the way callers expect.

**Live production mutation performed directly, outside the app/n8n write
paths — recorded here per rule 5.** n8n's Google Sheets node has no "add a
column" operation, only write-to-existing-named-columns. Used a scoped n8n
one-off workflow (`httpRequest` node, `predefinedCredentialType:
googleSheetsOAuth2Api`, credential `VpAfjgrqrjdzEJEf`) to call the Sheets API
directly:

1. `GET .../values/Clients%20Info!N1:P1` — confirmed the target range was
   genuinely empty (no `values` key in the response) before writing anything.
2. `PUT .../values/Clients%20Info!N1?valueInputOption=RAW` with body
   `{"values":[["creative_channel_id"]]}` — response confirmed
   `updatedCells: 1`, i.e. exactly the one intended cell.
3. Backfilled the affected client's own row via the standard
   `n8n-nodes-base.googleSheets` "update" operation (matching on
   `client_name`+`email`, same mechanism the real automation uses) now that
   the column existed.
4. Independently re-read the sheet via Drive's content index (a different
   path than the Sheets API call above) and confirmed the header row now
   shows 14 columns ending in `creative_channel_id`.

All three one-off n8n workflows created for this (the diagnostic-row insert
cleanup, the column write, and the row backfill) were archived immediately
after use; none were left active. `docs/truth/SHEETS.md`'s Clients Info
column list is corrected in the same change as this log entry (it was
already stale before this incident — 13 real columns, not the documented 12
— unrelated to this bug but caught in the same pass).

**Documented in `docs/CLIENT_LIFECYCLE_MAP.md` §19 and
`docs/ops/NEW_CLIENT_ONBOARDING.md`** (PR #1148) with the detection method
for future schema-drift cases: read the live header row and diff it against
the failing node's cached `columns.schema`, don't assume a readiness-gate
problem just because the failure mode looks like one.
---

## 2026-08-25 — Kasper Ad Performance: unfinished-leads gap backfilled from iClosed directly

The owner looked at the live (empty) "Unfinished leads" section and pushed
back: he could see real potential/qualified leads sitting in iClosed. He was
right — the gap was exactly the one flagged the same day: the live pipeline
only mirrors n8n's `booking_recovery` Data Table, which has no history before
2026-08-14 (when its capture webhook was built).

**Investigated rather than assumed.** Built a disposable read-only n8n probe
workflow (created, executed, archived — no writes) and confirmed iClosed's
public `/v1/contacts` API works and returns all 46 contacts on the account,
15 of them potential/qualified. But four different attempts to get campaign
attribution off that API — the list response itself, `/v1/contacts/{id}`,
`/v1/contacts/{previewId}`, and the `?preview=` query param the dashboard's
own URL uses — all came back without any UTM/tracking field. The public API
genuinely does not expose what the owner's internal dashboard view does.

**The owner then shared his iClosed "Leads" smart view directly** — 14 rows,
with UTM SOURCE and UTM CONTENT columns the API never returned. Cross-
referenced by email against the already-fetched API contact list (id, phone,
creation date) to build the full row shape. Two of the fourteen
(`utm_source=ig`, `utm_content=link_in_bio`) are organic Instagram bio-link
traffic, not paid ads, and were excluded — this is an ad-performance
dashboard, not a general lead list. Of the rest: disqualified and
already-booked (already present in `kasper_ad_leads`) rows were excluded,
leaving five real, currently-unfinished, `facebook`-sourced leads: Natalie
Geller, James Williams, Andrew Schwab, a phone-only contact surnamed
Hutchins, and Han Pat (qualified) — the last one's `utm_content` literally
reads `{{ad.name}}`, an unresolved Meta ad-name macro, kept as-is rather than
guessed.

`migrations/2026-08-25-kasper-ad-unfinished-leads-backfill.sql` inserts these
five rows directly (idempotent `ON CONFLICT (lead_key) DO UPDATE`, applied
via `supabase db query --linked`, readback confirmed). `utm_campaign` is set
to `prospecting` by inference, not because the owner's screenshot showed that
column — it's the only active Meta campaign this dashboard tracks, and every
`facebook`-sourced row carries the same `Video+++|+...` content pattern
already proven to belong to it. `captured_at` uses each contact's iClosed
creation date as a proxy for the true (unavailable) abandonment-event
timestamp. `email_sent_at`/`follow_up_due_at` are left null — correctly, no
automated follow-up ever ran against these before this backfill existed.
`updated_by` is tagged `backfill:kasper-ad-performance-iclosed-manual-
2026-08-25`, distinct from the live pipeline's own tag, so this data's
different provenance (manual, screenshot-cross-referenced, not from the
automated webhook capture) stays visible in the table itself. No schema, no
Edge Function, no n8n change — the panel already reads this table, so the
five leads appear on the next page load with no redeploy.

---

## 2026-08-25 — F27 Section 4 forward deploy executed

Dispatched from `61a1d5f6c074ddd0cba27ff2389d68ecb2e44b36`, run `32804779008`.
Prior-four sealed bundle `e7e3e385…` (446018 bytes) verified before anything
was touched. Deployed versions, recorded here because the lane's summary asks
for exactly this:

| function | active version | source closure SHA-256 | JWT |
|---|---|---|---|
| `batch-write` | 33 | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | `verify_jwt=false` |
| `deliverable-write` | 33 | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | `verify_jwt=false` |
| `linear-outbound` | 45 | `d83f0d7c08ec39ad8897ab8323b3896235e8a39c6ea7c6cdde96f6b25ed4480b` | `verify_jwt=false` |
| `production-write` | **51** | `0deb6b81090298dc02739ff7ca945ebbc1fefc30b8799b648d69a89a924f5858` | `verify_jwt=false` |

`production-write` 48 → 51 is the one that carried work: the intake editor
override and the server-side created-status guard are live from this deploy.
Its closure matches the workflow's pin exactly, which is what the lane checks
before and after.

**The first dispatch failed, and the reason is worth writing down.** It was
rejected in 16 seconds with `Forward commit_sha must equal the reviewed
current-main workflow SHA` — nothing was touched. The lane requires the input
sha to equal main's head *at dispatch time*, and main moved twice between the
sha being verified and the form being submitted (four PRs merged inside an
hour). The gate did its job; the operator instruction did not. Anyone handing
these values over should re-read main's head immediately before the dispatch,
not when the rest of the inputs are prepared — the other four inputs are stable
and only `commit_sha` decays.

`public_intake_enabled` stays `false` until the owner turns it on; the deploy
makes the capability possible and the flag is what admits traffic. That
separation is the reason the migration inserted the flag off.

## 2026-08-25 — the duplicate-parent repair was eroding within three hours

The owner ran the 86-parent repair at 00:42Z and the readback was clean. A
re-count at 03:24Z found one back: `b1_b_c53b1ba8…`, re-written by
`linear-backfill` with both slots claiming a parent another batch still owns.

Neither the repair nor `adoptExistingParentClaimants` was wrong. Clearing
`linear_parent_ids` leaves the batch ROW in place; the row still hashes to its
group; adoption deliberately leaves an existing id alone as an established
home; and B1 then recomputes the map and re-writes the claim. The fix was
aimed at MINT time, and this happens at WRITE time.

`dropClaimsOwnedByAnotherBatch` enforces the invariant where it actually has to
hold: a claim is dropped from an outgoing row when a different active stored
batch already holds that parent. Ownership comes from the store, never from the
other rows in the run — otherwise two groups reaching one parent could each
conclude the other owns it and both drop, or both keep. A batch keeps what it
already owns, an unclaimed parent writes normally, an archived holder never
blocks.

On the incremental path it runs AFTER `mergeBatchParentIds`, not before: that
merge accumulates the stored map, so a claim this run never recomputed can
still arrive through it. Putting the guard first would have missed exactly the
case that was observed.

Worth stating plainly, because it generalises past this bug: **a data repair
that a scheduled job can undo is a countdown, not a fix.** The repair was
verified by readback and was genuinely correct at the moment it ran. What made
it look durable was that nothing re-checked it three hours later.

---

## 2026-08-25 — The backfill was wrong, and so was the live pipeline: a real status-filter bug found from the owner noticing a blank column

The owner looked at the backfilled "Unfinished leads" section and said the
Follow-up column was empty for people he knew had actually been emailed.
That one sentence uncovered two separate mistakes, not one.

**Mistake 1 — the backfill overwrote real data it never looked for.**
Yesterday's backfill sourced only from iClosed's `/v1/contacts` API (no
follow-up fields exist there at all) and set `email_sent_at`/
`follow_up_due_at` to null for all five leads, reasoning that the automated
pipeline had never seen them. That reasoning was only checked in general,
never against these five specifically. Queried n8n's `booking_recovery`
Data Table directly for their exact `lead_key`s (a disposable read-only
probe, created/executed/archived) and found four of the five already had
real rows: Han Pat, James Williams, and Natalie Geller had all actually
received recovery emails (`status=completed`, real `email_sent_at`
timestamps from Aug 16/19); Hutchins had a real `follow_up_due_at` but no
email (phone-only contact, correctly routed to `awaiting_sms` instead — no
email address was ever captured for him). Only Andrew Schwab (created Aug
13, one day before the capture workflow existed) genuinely has no row.
`migrations/2026-08-25-kasper-ad-unfinished-leads-followup-correction.sql`
restores the real values for the other four, applied and read back.

**Mistake 2 — the live pipeline had the same blind spot, for everyone, going
forward.** The four leads above being invisible to yesterday's automated
pull wasn't a coincidence: `Pull Unfinished Leads` filtered strictly on
`status='pending'`, but the recovery Dispatch workflow moves a contact's
`status` to `completed` (or `awaiting_sms`) the moment it actually acts on
them — the exact three states Capture itself uses to mark someone
genuinely resolved (`booked`/`disqualified`/`other_calendar`) are recorded
in `suppressed_reason`, not `status`. So the filter was inverted from what
it should have checked: it kept people nothing had happened to yet, and
silently dropped anyone the moment a real recovery email or text went out
— exactly the leads Sidney most wanted visible. This was never going to
self-correct; every future contacted-but-still-unbooked lead would have
kept disappearing the same way.

Rebuilt the live-pull workflow again (`6OtjILbhkYLY6yVE`, superseding
`CdCYzye6Khp6x5A6`): `Pull Unfinished Leads` now filters only on
`utm_campaign`, and `Map Unfinished Leads` excludes exactly
`booked`/`disqualified`/`other_calendar` from `suppressed_reason` — every
other state (`pending`, `completed`, `awaiting_sms`, or any future
Dispatch-added state) is kept. Reused the same n8n credentials (no new
wiring needed this time) and proved it with a real test execution
(`431479`): all four writers succeeded, and a live Supabase readback showed
Han Pat/Hutchins/James/Natalie's rows freshly `updated_by:
n8n:kasper-ad-performance-pull` at the exact execution timestamp — the
automated pipeline re-discovered and corrected all four on its own, with
no manual data touch. Andrew Schwab's row was correctly left alone (still
no `booking_recovery` row for him — nothing for the pipeline to find).
Published; the buggy revision archived.

**Also added, per the owner's request:** a Phone column to the "Unfinished
leads" table (`tel:` link, matching the existing `mailto:` pattern) — the
field was already being read by the Edge Function, just never rendered.

No schema or Edge Function change this time — only the data correction, the
n8n workflow's filter logic, and one UI column.

---

## 2026-08-25 — the SMM who reported `native_link_required` had created it himself, the night before

The owner asked for two things about the calendar refusing a thumbnail status
change: fix every card that has it, and make it impossible to happen again. The
second turned out to depend entirely on a fact neither of us had: **who makes
these cards, and when.**

### The number was wrong three times before it was right

First pass called it ~714 broken cards. Second pass, a different filter, called
it 921. Both are true counts of *something* and both are useless, because they
answer "how many rows match a predicate" rather than "how many people are
blocked". The counts included the TEST client's daily drill fixtures (~758
slots), cards that were archived months ago, and cards whose post and thumbnail
are both long since Posted.

Measured properly — `scripts/calendar-native-link-gap-check.js`, written for
this and kept — the real-client figure is **163 blocked slots, 57 archived, 89
settled, 17 actionable, 2 created after the flip.** Of the 17, fifteen point at
Linear issues already `completed`; their thumbnails are finished and nobody will
ever change their status.

The lesson is not "check your filters". It is that **a defect count with no
reachability dimension is not a measurement of the defect**, and the difference
between 921 and 2 was the difference between commissioning a new bulk-minting
script and writing a nine-line SQL statement.

### The cause was a gesture that stopped meaning what it used to

`calendar_post_events` keeps a `link_set` row for every time someone pastes a
Linear URL into a card's link slot. There were 352 graphic ones since the
2026-08-16 authority flip. Thirteen left a card half-linked; ten are drill rows;
three are real, and one of them is:

> 2026-08-24 23:22 — actor **Sebastian**, role smm, source ui, card
> `p_mt7v1ebq_phmny`, payload `{"to": ".../GRA-6678/..."}`

He pasted the link at 23:22 and was refused on that exact card the next morning.
Before 2026-08-16 that paste was a complete link — graphics was
Linear-authoritative, `legacyParity` was true, and the URL *was* the write
target. After the flip the identical gesture produces a card whose thumbnail
status can never be changed, and nothing anywhere says so.

So the honest framing for the people using this: nobody did anything wrong. A
gesture changed meaning underneath them and the product kept accepting it.

### The tool already existed — twice

The first plan was a new one-off service-role minting script. It was not needed:

- `scripts/b3-linkage-backfill.js` fills the card-side linkage slot,
- `scripts/f42-linkage-defect-repair.js` finishes the deliverable side, and
- `B1_STRAY_CATCHER=1` is the sanctioned INSERT-ONLY lane for minting
  deliverables on a SyncView-owned team.

Rather than reason about what b3 *would* plan, its planner was **run** against a
fixture assembled from the live tables (8,805 cards, 5,380 deliverables, 6,086
sample reviews) through its own `--fixtures` path. It planned exactly one write,
and it was Sebastian's card. It refused the four other same-client candidates
for reasons that each hold up: one archived card, one card-side fan-in where
binding either card steals the row from the other, and two cards resolving to
another client's deliverables — which is a cross-client status write, and the
proof that the client assertion in that resolver is load-bearing rather than
defensive.

*Predicting a sanctioned tool's plan is worth less than running it.* Feeding
live rows through `--fixtures` cost one command and replaced an argument with a
verdict.

### What is now standing

`scripts/calendar-native-link-gap-check.js` reports the buckets above on demand
and, under `--gate`, exits non-zero when any post-flip slot exists — so once the
creation path is bound, a new one fails a check instead of arriving weeks later
as "Sebastian says the calendar is broken".
`test/calendar-native-link-gap-check.js` executes the real classifier against
fixtures for every judgement it makes, including the two it must NOT make: that
a Linear-authoritative team can produce this refusal, and that a card with no
link at all belongs in this count rather than the sibling report's.

---

## 2026-08-25 — sealing the paste, and teaching a red gate to say where

### The link slot stopped meaning what it used to, so it is closed now

Owner ruling, after the `native_link_required` diagnosis landed: *"can we make
it so people cannot paste a link anymore? Because I don't think we would need to
do that anymore."*

The seal is keyed on **authority**, not on the word "graphics":

```js
function _writeUiLinkSlotSealed(component) {
    const authority = _writeUiAuthoritySnapshot();
    return !!authority && authority[_writeUiTeam(component)] === 'syncview';
}
```

A slot is sealed exactly when its own team stopped reading the URL as the write
target. That is the same condition `makePayload` throws on, so the control and
the refusal can never disagree, and video needs no edit when it flips.

Three decisions inside it are worth keeping, because each is a way a
well-meaning seal breaks something else:

- **The render gate fails OPEN, the commit gate fails CLOSED.** The snapshot is
  null until the first live read lands; hiding a working video control during
  first paint would be a worse lie than showing one the commit gate then refuses
  out loud. The commit gate does its own live read and answers
  `authority_unavailable` on an unreadable flag — the same answer
  `_writeUiGatewayPost` already gives, and for the same reason: one paste let
  through an outage mints a card that stays broken for weeks, while one refused
  is visible and fixed in a minute.
- **Clearing is never sealed.** `val === ''` does not reach the gate. Removing a
  link already sitting on a card is the repair for every card this defect
  produced; sealing that away would trap exactly the rows the seal exists to
  stop making.
- **Every writer is gated, not just the surface that usually calls it.** The
  single-card commit, the "Move it here" conflict path, the bulk
  match-cards-to-sub-issues flow, and the sample-review twin. The repo's own
  lesson from the sub-issue multi-select bug is that a guard living only on the
  usual surface is a guard with a hole in it — there, the ordering fix and the
  CSS class both existed while nothing could put a row into the selection.

The nags went too. "Parent issue linked — paste the sub-issue link instead" and
the orange warn on an empty graphic slot were instructions to perform the exact
write now refused; under SyncView authority an unlinked Linear slot is the
correct state, and `_calProdSlotHtml` already shows where the work lives.

### A red gate that could not say where

`production-polish` went red on PR #1143 and reported `error_generic`. That is
not a rare tail: every one of `prod-write-gateway-browser.js`'s ~120 `expect()`
calls throws a plain `Error`, so **every assertion it can fail classifies that
way**, and the suite's output is deliberately runner-private.

What was ruled out first, because "not reproducible" had to mean something:
twelve consecutive local passes on a byte-identical tree (verified by fetching
`refs/pull/1143/merge` and diffing `index.html`, `docs/syncview-design/` and
`package.json`), the pinned Playwright 1.56.1 and its chromium-1194, a two-core
cpuset, and — after instrumenting every request the page makes — the CDN and
Google Sheets dependencies served from disk so nothing off-box differed. The
suite is otherwise hermetic: `page.route` intercepts `rest/v1`,
`production-write`, `production-comments`, `key-verify` and both n8n webhooks,
so live state cannot move it.

*An early reading that the suite POSTs to production n8n on every run was wrong
and is corrected here: `page.on('request')` fires before routing, so those
requests appear in a request log while never leaving the browser.*

So the fix is not another reproduction attempt. `PHASES` is a closed list of
seven section names; `expect()` prefixes the current one; `prod-polish-gate.js`
matches each with a literal pattern that emits a literal code. The phase entries
sit **after** every technical signature, so a selector timeout inside the submit
section still reports as a timeout — location only answers once cause has had
its chance. `test/prod-polish-failure-location.js` pins that the two lists name
the same set, so adding a phase and forgetting its code fails a test instead of
silently restoring `error_generic`.

### The failure-location codes earned their keep in under an hour

`production-polish` went red again on this branch — and this time the summary
said `Production write gateway [pwg_quarantined_identity]` instead of
`error_generic`. One line, and the search space collapsed from ~120 assertions
to one.

Reading that section settled two things immediately. It calls `_prodGatewayWrite`
**directly**, not through `_prodRunPickerWrite`, so the optimistic paint and its
rollback guard — the obvious suspects, both changed on this branch — cannot
reach it. And its ten-conjunct assertion contained two that were never about
quarantine at all:

```js
&& writes.length === writesBeforeQuarantineAttempts
&& createOptionReads.length === optionsBeforeQuarantineChild
```

Global array lengths. The assertion means *"the six refused attempts wrote
nothing"*, but as written it also fails whenever anything else in the run lands
inside that window — which is precisely the shape of a suite that passes twelve
times locally, passes twice on this same branch, and fails on a loaded runner.
Both conjuncts are now scoped to traffic that names the quarantined issue
(`body.id` or `body.parent_id`), which keeps the meaning — a quarantined
identity must not reach its Linear issue — and drops the part that was measuring
the rest of the run.

*Worth stating because it generalises:* **an assertion that can fail for reasons
outside its own subject is not a stricter assertion, it is a noisier one.** The
extra conjuncts made this suite fail for something it was not testing, and
because the failure arrived as `error_generic` the noise was indistinguishable
from signal for two days.

No claim is made here that this was the ONLY cause of the earlier reds. The two
on #1143 predate every change on this branch and their location was never
recorded, so they stay unattributed. What is different now is that the next one
names itself.

### It went red again, and the name was still lying

Fourth red, same code: `pwg_quarantined_identity`. The scoping fix above changed
nothing, and the five sub-phases carved out of that section changed nothing
either. Both were aimed at the wrong fifty lines.

`phase('quarantined_identity')` is called **twice** — once for the quarantine
block, and again immediately after the last sub-phase, for the authority restore
and the status/due writes. So the name covered two unrelated regions, and the
second one carries seven more assertions that have nothing to do with quarantine:
the CAS token on a status write, the staff attribution headers, the ISO due date,
and the native due receipt. Splitting the first region could never have helped,
because the failure was never provably in it.

*The lesson is narrower than "add more phases".* **A phase name is a location,
and a location that appears twice is not a location.** The mechanism was built to
turn a code into a place to look; entering the same name from two places quietly
un-does that, and nothing in the apparatus noticed — `test/prod-polish-failure-
location.js` check 2 proves the gate table and the phase LIST agree, which they
did. The list was right. The CALLS were wrong.

So the guard is now on the calls: no phase name may be entered twice, and every
declared phase must actually be entered. The reuse detector is additionally run
against a synthetic two-call input, because a check that passes on a correct
suite looks identical to one whose extraction silently matched nothing.

Two more real fragilities in that newly-named region, same family as the global
counters above:

```js
const statusWrite = writes.find(write => write.body.operation === 'status' && write.body.id === 'gra-fixture');
const dueWrite    = writes.find(write => write.body.operation === 'due');
```

`find` returns the FIRST matching write of the whole run, not the one the click
just made — so the CAS assertion compares a stale revision against a fresh token
the moment anything earlier touches that row, and the due lookup was not scoped
to the row at all. Both are now `findLast` and both are scoped.

**Not claimed: that this fixes the intermittent.** The suite passes locally for
the fifteenth time, which is exactly what it did before each of the four reds.
What is claimed is that the next red names one of eleven assertions instead of
twenty-one, and that two assertions which could fail for reasons outside their
own subject no longer can.

### The fifth red named one assertion, and the cause was on this branch

`pwg_due_receipt`. One assertion, in the region that had never been split. Three
attempts at the diagnosis had cost most of an evening; the first red precise
enough to act on arrived within minutes of naming that region.

**The cause is a change this branch made deliberately.** `_prodRunPickerWrite`
was rewritten to *"Paint first, then persist"* for the owner's 2026-08-25
report — *"it takes quite a lot of time to change. It should be, like,
immediate."* The row now takes its new value locally **before** the fetch is
issued.

The suite waits like this:

```js
await page.waitForFunction(() => window._prodIssue('gra-fixture').dueRaw);
```

Before the optimistic paint, `dueRaw` could only become truthy when the gateway
answered — so that line implicitly waited for the entire round-trip, and
everything downstream of it was already there. It no longer does. Downstream of
it the suite reads two things that have not happened yet:

- `writes`, pushed from the **route handler** — request-time state, and the
  paint now precedes the request;
- `__prodNativeDueReceipts`, published from `wlPublishNativeDueReceipt(json.row)`
  in the write's **success path** — response-time state.

On a fast machine both have landed by the time the test looks. On a loaded
runner neither is guaranteed to have. That is the entire mechanism, and it
predicts exactly the observed behaviour: red only on this branch, only in CI,
never in sixteen local runs.

*Worth stating because it generalises:* **a wait is only a wait for what it
observes.** `waitForFunction(row.dueRaw)` was never a wait for the round-trip;
it was a wait for a value that used to arrive with the round-trip and now
arrives before it. Making the UI faster silently deleted a synchronisation the
tests had been relying on without ever naming it.

Both sites now wait for the thing they assert on — a `waitForWrite` helper that
polls the recorded writes with a deadline, and a page-side wait on the receipt
array. Nothing is weakened: `length === 1` still refuses a duplicate publish,
and the CAS and header assertions are unchanged.

**Confidence, stated honestly.** The mechanism is proven from source, not
inferred: the paint precedes the fetch, and the receipt comes from the response.
That it accounts for all five reds is strongly supported — same branch, same
region, load-dependent, and the two earlier `pwg_quarantined_identity` reds fell
inside the mislabelled window that contained this very assertion — but the two
original reds on #1143 recorded no location and stay unattributed.

---

## 2026-08-25 — routing-flag repair: enrollment, and the stamp the repair broke

Recorded here because `ROLLBACK.md` rule 5 asks every flag flip to be
reconstructible from this file, and the first version of this work logged it
only in the repairs backlog. Slugs are withheld throughout (F64 — this repo is
public); the row-level evidence lives in the operator's own session.

**Flip 1 — enrollment.** One active client, onboarded 2026-08-25 15:13:45Z, was
absent from all four routing flags.

| flag | before | after | stamp written |
|---|---|---|---|
| `sample_review_ef_clients` | 38 slugs, last written 2026-08-21 `owner-onboarding-kasperads` | 39 | `owner-enroll-<slug>` |
| `calendar_upsert_ef_clients` | 38, same | 39 | `owner-enroll-<slug>` |
| `settings_ef_clients` | 38, same | 39 | `owner-enroll-<slug>` |
| `write_ui_reroute_clients` | 38, `owner-enrollment-wave-3-full-roster` (2026-08-25 15:13:54Z) | 39 | `owner-enroll-<slug>` |

Executed 2026-08-25 20:57:24Z, all four in one statement, owner-run.
Reversal is by slug removal from each `clients` array; the memberships before
the flip were the 38-slug wave-3 roster, identical across all four.

**Flip 2 — the stamp the repair broke, and why it is not cosmetic.**
`PRE_FLIP_HEALTH_CHECK.md` item 5 derives the expected membership FROM
`write_ui_reroute_clients.updated_by` and treats **any value its table does not
list as a FAIL** — an unannounced stamp reads as enrollment changed behind
everyone's back. So flip 1 left a correct enrollment carrying a stamp that
guarantees a red on the twice-daily check from the next run onward. A false
alarm, which is the precise failure that document exists to prevent, and it says
so in its own words. Restored to `owner-enrollment-wave-3-full-roster`, which is
the true state: the membership does equal the three rosters.

*Two things generalise past this incident.*

**A repair that satisfies the thing it was aimed at can still break the thing
that watches it.** The enrollment was right; the label made the watchdog wrong.
Nothing in the enrollment SQL was incorrect on its own terms — the defect was
only visible from the health check's side, which is a document the repair never
read.

**§6e already carried the right statement AND a note saying the stamp must not
change.** The new guidance did not correct §6e, it competed with it — which is
how a runbook ends up with two procedures that disagree and an operator
following whichever they reach first. Both are now one transaction in §6e that
rolls back rather than leave three flags written and the fourth stale, because a
partial enrollment is the production failure, not a smaller version of it.

---

## 2026-08-26 — Two answers to "why is it slow", and only one of them was the app

The owner asked two things in one message: whether SyncLinear could load faster,
and whether the CI gates are worth what they cost. They turned out to share a
shape — in both cases the thing that looked like a hard problem was masking a
cheap one that nobody had measured.

**The cache that could never be written.** SyncLinear paints from a
`localStorage` snapshot and revalidates behind it, which is the right design.
The snapshot was 5.44M characters — ~10.9MB once `localStorage` stores it as
UTF-16, against an origin budget of about 5MB. It had never been written
successfully, by anyone, on any browser. The slowness people reported was simply
the cold read that the cache was supposed to prevent: six sequential 1,000-row
pages, 1.9–3.5s measured live.

The part worth remembering is the second-order damage. The writer's
`QuotaExceededError` handler evicts one same-family snapshot and retries, in a
loop. Because no number of evictions could make room, **every** Production open
ran that loop to completion and deleted **every** calendar and samples snapshot
in the origin — then still failed. A feature that was doing nothing was
simultaneously destroying two neighbouring features' caches, on every use, for
as long as it had existed.

*What generalises.* **A retry loop is only a retry loop if success is possible.**
Otherwise it is a demolition loop with a hopeful comment above it. The budget
check now runs before the first write, so an impossible payload costs its
neighbours nothing — and that ordering, not the smaller payload, is the actual
fix. The payload also shrank, but a shrunken payload with the check in the wrong
place would have gone right back to demolishing the moment the estate grew.

**Measurement decided what to cache, and what not to do.** Batch descriptions
were 2.12M of the 5.44M on their own — 39% of a snapshot, for a field no first
paint renders. Terminal deliverables were 3,902 of 5,398 rows. Dropping both got
the snapshot to 1.29M chars without touching anything the default view shows.
The same measurement pass also priced a much larger idea — moving the 3.77MB
inline app script into an external file, worth a measured 261ms → 102ms on warm
boot — and then rejected it for this week: 220 test files read `index.html`
directly, and GitHub Pages serves the repo root with no build step, so it is a
deployment-mechanism change during a cutover week. Written down in the audit
rather than attempted.

**The gates were not wrong; their wiring was.** Four defects, three of which
produce a red mark that has nothing to do with the diff. The clearest evidence
was a single commit, `fc068d15`, running the unit suite twice because `push:
['**']` and `pull_request` both matched: run #3499 passed and run #3500 failed
**without either of its jobs leaving `queued`**. That red carried no information
about the code at all, and the duplication doubled how often such a thing is
seen. The heavy lane's own failure had been reporting as `unclassified` since
its assertions exit through the suite's summary rather than through a framework
error — red, and unownable, which the repo's comments show has happened before
and cost weeks.

*What generalises.* **A check that cannot say what it saw is not a check, it is a
mood.** The fix was the one already used twice here: emit the closed set of
identifiers the code itself defines, validate them against that same compile-time
list, and let nothing from the run's own output through. The allowlist extracted
168 names and the suite's own `TOTAL` is 168 — which is the kind of agreement
worth asserting in a test, because the day they disagree is the day a new check
becomes unnameable.

**What was deliberately NOT done.** Running the heavy and interaction lanes on
pull requests is the correct end state and is the single change that would stop
green pull requests turning `main` red. It is not this week's change: those lanes
are red right now, so switching them on would block every merge during the flip.
Cause first, then the trigger.

---

## 2026-08-26 (later) — Silence is a result, and it is usually mistaken for a wrong one

Two owner reports resolved in the same pass, and they turned out to be the same
shape of mistake in two different places.

**"It focused on another card."** An SMM's card deep link opened the calendar on
somebody else's card. The obvious explanation — a filter hiding the target — was
ruled out by the owner in his own words, and the row itself checked out live:
real card, right client, both deliverables bound. Which meant the lookup had
succeeded and the failure was entirely after it, in code that had two ways to
fail and no way to say so. It queried the DOM on exactly one frame and returned
without a word if the element had not painted yet; and it scrolled with
`behavior: 'smooth'`, which fixes its target offset up front and then lands on a
neighbour once the strip's thumbnails decode and shift everything.

*What generalises.* **A feature that fails silently does not read as "failed" —
it reads as "did the wrong thing",** because the reader attributes whatever they
are looking at to the action they just took. The calendar always has a card
carrying `.cal-card-current`; a deep link that did nothing leaves that card
highlighted, and the reader reasonably concludes the link opened it. The fix
that mattered was not the retry or the instant scroll; it was that the give-up
path now says something. The other two just make the give-up rarer.

**"Do we need to do this for other cards?"** Measured rather than guessed: 529
cards carry a video deliverable, 85 of those have no graphics deliverable bound,
and of those 85, **79 have no graphics deliverable in their batch at all** —
video-only posts, which is the normal shape and not a defect. Six cards are
genuinely in the repaired card's shape.

Three of those six first counted as *repairable* — each had exactly one free
graphics deliverable in its batch. Pulling the actual rows instead of the counts
showed all three naming **the same** free deliverable: one batch-level graphic in
a batch of separate videos. The real count of cards repairable without a person
choosing is zero.

*What generalises, twice.* **The first question about a defect found on one row
is how many rows are in that shape, and the second is how many only look like
they are** — a repair scripted from the one visible case would have found 85
candidates and been wrong about 79. And then: **a per-row uniqueness test is not
a global one.** "Exactly one free twin for this card" was true three times over
for a single row, and a script trusting that count would have bound the same
deliverable three times and reported success each time. The check that caught it
was reading the rows, not the totals.

**A note on what was NOT verified.** The deep-link fix is a diagnosis from the
code and the live row, not from a reproduction: the sandbox cannot reach Supabase
from a browser, so the calendar cannot be driven end to end here. Every change in
it is strictly safer than what it replaces — a bounded retry where there was an
immediate give-up, an instant scroll where there was an invalidatable one, a
notice where there was silence — which is why it ships ahead of a repro rather
than waiting for one. That is a judgement, and it is recorded as one.

## 2026-08-26 — the Kasper ad-performance pull went dark on a blocked credential, and four ads had already been silently cut

The owner asked how the ads were doing. The dashboard's own numbers hadn't
moved since the previous afternoon — worth checking before answering from
stale data.

**Finding 1 — the live-pull workflow stopped succeeding, and the cause is a
blocked Meta credential, not a Meta-side or account-side problem.**
`kasper_ad_performance_daily`/`_by_ad_daily`/`kasper_ad_unfinished_leads` all
stopped getting fresh writes after 2026-08-25 15:42 UTC. Checked
`6OtjILbhkYLY6yVE`'s own execution history directly: its two most recent
scheduled runs (`433765` at 2026-08-26T01:00Z, `436025` at 2026-08-26T13:00Z)
both errored in under a second, at the `Pull Meta Insights` node, on the exact
same fault: `OAuthException code 200, "API access blocked"` from
`graph.facebook.com`. This is the n8n `Facebook Graph account` credential
(`vW7IDgj0QTjANraI`) specifically — the Meta ad account itself is unaffected
(confirmed `ACTIVE`/queryable via a separate, working Meta connection used
directly for this investigation) and the campaign/ad set are both still
`ACTIVE`. **Not yet fixed** — an app-token block like this needs the owner (or
whoever controls that credential) to regenerate/reconnect it in Meta Business
Settings and re-save it in n8n; that's not something achievable through the
n8n API. Once reconnected, the workflow needs no other changes — it errors
cleanly and will resume on its own schedule.

**Data gap this caused, corrected.** Backfilled
`kasper_ad_performance_daily`/`_by_ad_daily` for 2026-08-25 (previously only a
partial mid-morning snapshot: $16.19 vs. the real $44.99) and added 2026-08-26
entirely (partial day, $25.93 so far). Pulled every value directly from Meta's
Graph API and verified it reconciles exactly against what was already correct
in the tables before writing anything. While in there, also closed the
**pre-existing** by-ad gap from 2026-08-14 (3 of 6 ads were missing:
Fast Pitch $93.97, Danny Training $21.13, Baya Training $15.07) and all of
2026-08-15 (5 ads, $88.37 total) — both from an earlier partial-branch
failure, unrelated to the credential block. Migration:
`migrations/2026-08-26-kasper-ad-performance-gap-correction.sql`. No bookings
fall on any of the four affected dates, so `bookings_all`/`bookings_held`
were untouched.

**Finding 2 — four of the six ads are paused, and there is no record of why
or by whom.** `Static | Baya Results`, `Video | Results Montage`,
`Video | Mechanism Pitch`, and `Video | Baya Training` are all `status: PAUSED`
(not just `effective_status` — someone/something set this deliberately, not a
Meta review action; no disapproval or error is logged against any of the six
ads). All six ads show the exact same `updated_time` window,
2026-08-19T10:51:12 to 10:52:48 -0600 — a single coordinated action, not four
separate edits. Only `Fast Pitch` and `Danny Training` remain active, and both
are still spending and clicking every day, including today.

**CONFIRMED BY THE OWNER (2026-08-26): this was deliberate and correct.** He
and a prior session turned those four off on 2026-08-19 because they were not
performing. The two left running are exactly the two that had produced
bookings (Danny Training: 2 held calls on $66 spend; Fast Pitch: the account's
one real customer). Nothing was wrong with the decision — **what was wrong is
that none of it was written down**, in this file or anywhere else, so a later
session reading only the record would have concluded the account had been
tampered with. The owner's instruction, recorded here verbatim in substance:
*be obsessive about putting things in the docs.* A campaign action taken in a
session and not logged is indistinguishable later from an outside change to
the account. Log every ad-state change — pause, resume, budget, creative — at
the time it is made, with the reason.

This pause is separately NOT the cause of the 2026-08-14 delivery drop (it
happened five days later); that earlier drop remains unexplained by anything
Meta-side (no policy/review issues on any ad in that window either).

**Finding 3 — the account's actual conversion setup, checked against the
owner's "fix your pixel conditioning" question.** The ad set
(`Broad | US | 30+ | Advantage+ Placements`) optimizes for
`OFFSITE_CONVERSIONS`. The pixel (`Synchro Social Data`, dataset
`4309835332571875`) fires a real qualification funnel, not one flat lead
event: `PageView` → `ViewContent` → `Potential` → `Qualified` →
`invitee_meeting_scheduled`, plus separate `Lead`/`Schedule` events and (new
as of 2026-08-25) `QuizStarted`/`QuizCompleted`. There's one custom
conversion, `Qualified Application` (id `2110443739684279`, last fired
2026-08-26T10:39:48-07:00), gated on `event = Qualified AND URL contains
iclosed.io OR synchrosocial.com` — so the qualification-before-optimization
idea is already partially in place. Where it likely falls short of the
advice pasted: **the optimization target is a custom conversion, not a
standard event** — the exact opposite of the specific fix given ("use
standard events, not custom conversions... switch to a standard event tied to
qualified call booking"). Couldn't confirm the ad set's exact
`promoted_object`/target event through the first pass of tooling, but a second
pass closed it definitively (below).

**CONFIRMED 2026-08-26 — the ad set optimizes for the custom conversion, not a
standard event.** Reading the ad set's `results` field returns the indicator
`actions:offsite_conversion.custom.2110443739684279` and `cost_per_result`
returns `$265.05 USD (Qualified Application)` on 5 results. So the optimization
target is custom conversion `Qualified Application`, which is itself built on
the **custom** event `Qualified` — a custom conversion stacked on a custom
event, the narrowest possible signal. The standard events `Lead` and `Schedule`
both fire on this funnel already and are NOT what the ad set optimizes toward.

The same read also corrected two stale facts encoded in the ad set's own name
(`Broad | US | 30+ | Advantage+ Placements`): `publisher_platforms` is
`["instagram"]` only — **not** Advantage+/all-placements — across stream,
story, reels, explore_home, profile_feed and ig_search; and `age_min` is 25
(`age_range` 26–65), not 30. Advantage audience is on, US-only, with four WARM
custom audiences excluded (page engagers 365d, website visitors 180d, IG
engagers 365d, video viewers 25% 365d), so it is genuinely cold prospecting.
The name is wrong on two counts and should be corrected — renaming an ad set
does not resubmit its ads for review.

The `QuizStarted`/`QuizCompleted` events that first appear on the pixel
2026-08-25 are **the owner's own work** (confirmed 2026-08-26): they belong to
a lead magnet he is building for later. Not an anomaly, not third-party — no
action needed, recorded so a future session does not re-flag it.

## 2026-08-28 — F1(video): the authority cutover (EXECUTED; receipt filled)

The video team's authority flip is scheduled for today (owner's go 14:30Z,
target ~21:00Z). This entry is written IN the cutover PR (#1173), which
merges the same day as the owner's F1 paste, so at the moment it lands on
`main` the paste receipt may be minutes either side of it. The fields below
that only exist at execution are therefore marked PENDING and are appended
to this entry, with real values, in the first post-flip commit of the same
day — a fabricated timestamp or ledger id here would be worse than a marked
gap. (Codex P1 on #1173 asked for the receipt in the same change; this is
the closest honest satisfaction.)

- **What changes:** `prod_authority` `{"video":"linear","graphics":"syncview"}`
  → `{"video":"syncview","graphics":"syncview"}`, by the owner pasting the
  FLIP_RUNBOOK §F1 "Flip Video forward" block (guarded: exactly-one-row or
  exception), stamped `owner-runbook`.
- **Paste timestamp:** `2026-08-28 23:54:16.565968+00`. (The owner's window
  moved twice during the day — 21:00Z target, then ~23:00Z — and the paste
  landed at 23:54Z. The guard made the slip free of consequence: the block
  matches on the exact pre-flip pair, so a late paste either finds that state
  and flips, or refuses.)
- **`flag_flips` ledger id:** 89 — `prod_authority`,
  `old_value {"video":"linear","graphics":"syncview"}` →
  `new_value {"video":"syncview","graphics":"syncview"}`, actor
  `owner-runbook`, ts `2026-08-28 23:54:16.565968+00`.
- **Read-back output:** verified against the live flags immediately after the
  paste — `prod_authority {"video":"syncview","graphics":"syncview"}`
  (`updated_at 2026-08-28T23:54:16.565968+00`, `updated_by owner-runbook`);
  the five supporting flags unchanged at their expected values
  (`linear_outbound_enabled {"mode":"live"}`,
  `linear_inbound_enabled {"enabled":true}`,
  `auth_enforcement {"mode":"permissive"}`,
  `linear_legacy_parity_enabled {"enabled":true}`,
  `client_comment_gateway_enabled {"enabled":true}`). Exactly one row moved.
- **Unrelated flag write inside the window (recorded, not a flip action):**
  `flag_flips` id 88, `hiring_invites_enabled` `false` → `true` at
  `2026-08-28 23:49:33.655627+00`, actor
  `codex-hiring-invite-enable-2026-08-28` — five minutes before the paste, by
  a different agent session, on an unrelated subsystem. It neither gated nor
  was gated by F1. Logged here so a future reader of the ledger around id 89
  does not have to wonder whether it was part of the cutover. It was not.
- **Companions merged/dispatched the same day:** cutover PR #1173 (B1
  stray-catcher standing mode + browser-suite video row-writes + doc truth);
  one-time full-window B1 dispatch (`changed_since=2020-01-01T00:00:00Z`,
  apply on) whose public artifact must read back `stray_catcher: true`;
  `deploy-onboarding-edge-functions` dispatch (archive comment ordering EF
  goes live; fresh §4 rollback capture owed per FLIP_BUG_LEDGER §2-G5).
- **Rollback:** FLIP_RUNBOOK §F1 "POST-R2 Video reversal while Graphics
  remains SyncView-authoritative"; the pre-flip pair above is the video
  rollback signature.

## 2026-08-30 — SyncLinear panel truth pass (owner live test, day 2 post-flip)

- **What changed (browser only; no migration, no edge-function deploy):** seven
  places the Production surface stated something false. See `REPO_MAP.md` row
  "SyncLinear panel truth" and `docs/syncview-design/WIRED-PARITY.md` items
  22-25 for the per-item detail.
- **The load-bearing finding:** a batch parent is a SYNTHETIC node minted from
  the `batches` row. Its Assets grid read `filming_doc_url` /
  `footage_folder_url` / `delivery_folder_url`, three columns the 2026-07-23
  f34/f53 migration deliberately revoked from the browser grant (`revoke select
  ... grant select (twelve columns)`), so they arrived `undefined`, became `''`,
  and printed **Missing** — while the same parent rendered the plan link from
  its granted `description` column three inches above, and its child resolved
  the plan correctly through `assetSnapshot` reading the SAME batch row under
  service_role. Two readers, one field, different privileges.
- **Measured live (all 1,643 batches x 6,161 deliverable rows, adapter liveness
  filter applied):** 199 synthetic batch parents, 189 with a URL in the
  description. Column privilege confirmed per column: `select=id,filming_doc_url`
  → 42501 (permission), `select=id,filming_plan_url` → 42703 (absent), which is
  how "forbidden" was distinguished from "missing".
- **Explicitly NOT done, and why:** `PROD_BATCH_SELECT` was not widened — that
  read 42501s and takes the entire Production tab down for every user; and the
  columns were not re-granted to `anon`, which would publish client Drive and
  Frame.io folder URLs to a public static page and reverse an owner-approved
  privacy decision.
- **Also not attempted:** making assets editable on video. `attachment` is
  graphics-only at six layers, the deepest being `production_artifact_write`
  raising `production artifact graphics only` plus a projection writing
  `thumbnail_url`. That needs a migration replacing a security-definer function
  carrying advisory-lock ordering, the outbox replay contract and the revision
  bump, plus two deploys — deliberately not run the night before the team's
  first working day on the surface. Separately, `raw_footage`, `delivery_folder`
  and `filming_plan` have NO write control anywhere in the app (written once at
  intake or by the b4 bridge), so editing them is a new capability rather than a
  gate lift.
- **Review caught three defects in the change itself:** the honest state never
  reached the first paint (the render seeds and paints before `_prodEnsureAssets`
  runs, and its synthetic branch returns without repainting — so the decision
  moved to seed time); removing the Description Refresh stranded a toast naming
  it; and the value column still read `Not provided` after only the state pill
  had been corrected.
- **Rollback:** revert the commits; nothing here changes a gate, a flag, a
  schema, or a write path, so no rollback scope is added.


---

## 2026-09-01 — F27 Section 4 forward deploy executed (post description release)

Dispatched from `15f3a5e0d9d3e7996df534f6083b39a7fc041d36`, run `33464544302`.
Prior-four sealed bundle `f2d74f9d…` (505119 bytes) fetched and independently
verified before anything was touched. Deployed versions, recorded here because
the lane's summary asks for exactly this:

| function | active version | source closure SHA-256 | JWT |
|---|---|---|---|
| `batch-write` | 34 | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | `verify_jwt=false` |
| `deliverable-write` | 34 | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | `verify_jwt=false` |
| `linear-outbound` | 46 | `d83f0d7c08ec39ad8897ab8323b3896235e8a39c6ea7c6cdde96f6b25ed4480b` | `verify_jwt=false` |
| `production-write` | **64** | `d1c2b6666e97b538961e8f9995a792c97e0c7fc96c0a6bd0187440840ab66faf` | `verify_jwt=false` |

`production-write` 63 → 64 is the one that carried work: the `batch_description`
operation, which makes a POST'S OWN DESCRIPTION writable for the first time.
Before it, the gateway refused every batch-entity mutation except `comment`, so
a description set at intake was permanent from every seat in the product —
1,186 batch parents carry one. The other three functions redeployed at
identical closures, which is the lane working as designed: it deploys the whole
set and proves each one byte-for-byte rather than trusting that an untouched
function stayed untouched.

**The order actually executed, and why it is the only order that works.** SQL
first (`migrations/2026-09-01-batch-description-write.sql`, additive and safe
before anything calls it), then merge (#1203), then capture, then deploy. The
deploy cannot precede the merge: the lane requires `commit_sha` to equal the
reviewed current-main SHA, so the gateway change has to be ON main before it
can be deployed. An earlier draft of #1203's body claimed otherwise and was
corrected.

That leaves a real window between merge and deploy where the Edit control is
live in the browser and the gateway does not yet know the operation. It was
about 50 minutes here. **The failure mode is an error toast on save; the
description is not touched and nothing is written** — the same bottom-up-deploy
/ top-down-rollback asymmetry `ROLLBACK.md` already documents for the folder
links. Keep the window short rather than trying to design it away.

**The capture's sanity check is the one worth not skipping.** The receipt's
`production-write` `source_closure_sha256` read
`a54b6bad4bc7a34ef44da0be70e86a3ea1d0260b7457cb616fb558e68813265f`, which is
exactly the pin the workflow carried BEFORE this release. That equality is what
proves the bundle sealed the live set rather than something else; a bundle that
seals the wrong set restores the wrong code, and nothing downstream would catch
it. `docs/ops/F27_SECTION4_CAPTURE_PLAYBOOK.md` §1 names this check, and it is
cheap — one string comparison against a value already in the repo.

No `commit_sha` decay this time: nothing else was queued to merge, so main's
tip was still `15f3a5e0` at dispatch. That is luck, not method — the 2026-08-25
entry records a dispatch rejected in 16 seconds for exactly this, and the rule
stands: re-read main's head immediately before pressing Run.

---

## 2026-09-01 — F27 Section 4 forward deploy executed (asset access, filming plan, three staff reports)

Dispatched from `da2195f0b9bb8febd5c8e3d01bc80a91fb3b71b9`, run `33555586230`.
Prior-four sealed bundle `08e9f50c…` (513294 bytes) fetched and independently
verified before anything was touched. Deployed versions:

| function | active version | source closure SHA-256 | entrypoint SHA-256 | provider bundle SHA-256 | JWT |
|---|---|---|---|---|---|
| `batch-write` | 34 | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | `15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5` | `88246f1e3e128a9a648df928ff3f231d0f1afe39642a1125c90346a85c498214` | `verify_jwt=false` |
| `deliverable-write` | 34 | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | `74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68` | `c505f4ce6ef2e809083c38f9346c8b2b8867faaf498053b950fe00eced2158c0` | `verify_jwt=false` |
| `linear-outbound` | 46 | `d83f0d7c08ec39ad8897ab8323b3896235e8a39c6ea7c6cdde96f6b25ed4480b` | `606628504ec4614a22e9d16c7671dc5d9ef73bfc57b69ecaa08065a5d14f3684` | `2951ae9e612079cb5aeda96eef5801d04bbdb335d4693b8c6981c61c5c3abf04` | `verify_jwt=false` |
| `production-write` | **65** | `2af7fe6d2590dc092fd0e011e57a2634fe88d25deae1858a7e3befb6da84e8c4` | `7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5` | `3a0018741c79d188ff65a6c820c7c87db5ba95397f4579a3503751e776a821fd` | `verify_jwt=false` |

The workflow's own instruction is "Copy the ATTESTATION block into
EXECUTION_LOG.md" — the full five-field object per function, not the
four-column human-readable summary table alone (Codex P2 on #1215; the prior
entry above copied only the summary table too, which is the same gap, left
uncorrected here since fixing it is outside this change). The raw block:

```json
{
  "schema": "syncview_f27_section4_deployed_versions_v1",
  "deploy_commit": "da2195f0b9bb8febd5c8e3d01bc80a91fb3b71b9",
  "github_run_id": "33555586230",
  "functions": [
    {
      "slug": "batch-write",
      "active_version": "34",
      "source_closure_sha256": "86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a",
      "entrypoint_sha256": "15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5",
      "provider_bundle_sha256": "88246f1e3e128a9a648df928ff3f231d0f1afe39642a1125c90346a85c498214",
      "verify_jwt": false
    },
    {
      "slug": "deliverable-write",
      "active_version": "34",
      "source_closure_sha256": "78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575",
      "entrypoint_sha256": "74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68",
      "provider_bundle_sha256": "c505f4ce6ef2e809083c38f9346c8b2b8867faaf498053b950fe00eced2158c0",
      "verify_jwt": false
    },
    {
      "slug": "linear-outbound",
      "active_version": "46",
      "source_closure_sha256": "d83f0d7c08ec39ad8897ab8323b3896235e8a39c6ea7c6cdde96f6b25ed4480b",
      "entrypoint_sha256": "606628504ec4614a22e9d16c7671dc5d9ef73bfc57b69ecaa08065a5d14f3684",
      "provider_bundle_sha256": "2951ae9e612079cb5aeda96eef5801d04bbdb335d4693b8c6981c61c5c3abf04",
      "verify_jwt": false
    },
    {
      "slug": "production-write",
      "active_version": "65",
      "source_closure_sha256": "2af7fe6d2590dc092fd0e011e57a2634fe88d25deae1858a7e3befb6da84e8c4",
      "entrypoint_sha256": "7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5",
      "provider_bundle_sha256": "3a0018741c79d188ff65a6c820c7c87db5ba95397f4579a3503751e776a821fd",
      "verify_jwt": false
    }
  ]
}
```

`production-write` 64 → 65 is the one that carried work. Diffed
`15f3a5e0..da2195f0` (the two commits each pin captured) against
`supabase/functions/production-write/` to confirm exactly what moved:
`index.ts` + `policy.mjs` only, 213 insertions / 23 deletions across six
commits (#1209, #1210, #1211, plus their review-fix commits). `#1212` and
`#1213` never touch `supabase/functions/` and were already live the moment
they merged — GitHub Pages, no deploy involved. The other three functions
redeployed at identical closures, proving each byte-for-byte rather than
trusting an untouched function stayed untouched.

**Three owner reports, bundled into one deploy because they landed the same
morning and none conflicts with the others:**

1. **Asset read and edit opened to any staff role, either team** (#1209).
   His only active graphics designer opened a VIDEO-parented post and got
   "Description could not load" over four `Unavailable` asset rows —
   `staffAssetReadAllowed` had admitted a `creative` on their OWN team only,
   live since 2026-07-24. Widened to any staff role on either team;
   `attachment` moved above the team match beside `batch_asset`. The filming
   plan stays refused in three independent places (absent from
   `BATCH_ASSET_SLOTS`, no `write` key in `PROD_ASSET_SPECS`, rejected by
   `production_batch_asset_write`), all three asserted, none touched.
2. **The filming plan resolves from the client when the batch has none**
   (#1210). `batches.filming_doc_url` is written exactly once, at intake
   create, and never re-synced — 1,340 live deliverables measured in a batch
   whose own description already carried the filming-plan URL the row called
   Missing. `assetSnapshot` now falls back to the client's `filming_plans`
   row through the same server-side helper the intake path uses
   (`intakeFilmingPlanForClient` renamed `clientFilmingPlanUrl`, since it now
   answers two callers). Read-only: the filming plan is still unwritable
   through every operation, which is exactly why the fallback is safe.
3. **Two more owner reports, same morning** (#1211): `raw_footage` and
   `delivery_folder` now accept a file as well as a folder — a working
   Dropbox share of one recording (`/scl/fi/...`) was painted `Invalid`
   because it is a FILE, not a folder, on a row nobody could repair; same
   widening `deliverable_file` got on 2026-08-16, same reason. And a post
   PARENT now borrows its filming plan / raw footage / frame folder from a
   readable CHILD's batch when its own carries none — the parent is
   frequently a B1-mirror row on an asset-column-empty batch while its
   children sit on the native batch that actually holds the links (5,729 of
   6,230 live deliverables measured sitting on a `b1_` batch that day).
   **Codex P1 caught the first version of that borrow querying
   `deliverables` for `raw_issue_parent_id`, a column only the browser VIEW
   derives — it would have answered 42703 and the deliberate error-swallow
   would have turned that into "no children", shipping a fix that repairs
   nothing.** Repointed at `production_deliverables_browser_v1` before
   merge; `test/deliverables-view-only-columns.js` now sweeps every
   `.from("deliverables")` chain in the edge functions for this exact
   mistake, since this was its third occurrence in this one file.

**The capture's sanity check.** The bundle's `production-write`
`source_closure_sha256` read
`d1c2b6666e97b538961e8f9995a792c97e0c7fc96c0a6bd0187440840ab66faf` — exactly
the pin the workflow carried before this release (the same value the
2026-09-01 morning deploy two entries above recorded as its OWN live
result). That equality is the check that proves this bundle sealed the live
set rather than something else.

**Capture and dispatch both owner-run**, via the local flow now recorded in
`AGENTS.md` — the sealed capture needs a private Supabase Management token
and a Google Drive service-account credential, neither of which any Claude
session holds. `commit_sha` matched current `main` (`da2195f0`) at dispatch;
no decay.

## 2026-09-01 (later) — the post description had never once saved, and the error told the SMM to wait for a service that was up

**PENDING APPLICATION.** This entry records a repair that is written, proven and
merged-ready but **not yet applied**: it is one SQL statement the owner pastes
into the Supabase SQL editor. Nothing here is live until that happens. Filled in
above the fold rather than below it because a pending row read as an executed one
is how a fix gets believed into production.

**What to do, in full.** Open the Supabase SQL editor for project
`uzltbbrjidmjwwfakwve`, paste the whole of
`migrations/2026-09-01-batch-description-cas-timestamptz.sql`, run it. That is
the entire procedure. **No edge-function deploy, no F27 Section 4 dispatch, no
capture.** The function's signature is byte-identical to the one it replaces, so
`create or replace` genuinely replaces rather than overloading, and every raise
it emits is already understood by the `production-write` that is deployed right
now (v65).

**What was wrong, and it was two things that compounded.** Second report from the
same SMM, hours after the first fix shipped. The first report ("the new
description he's trying to make isn't saving") was the browser gate refusing
`batch_description` at the door, fixed and deployed. The second screenshot proves
that fix worked — the save now reaches the database — and shows a completely
different sentence: *"A service the write depends on did not answer, and nothing
was committed. Try again in a moment."*

Nothing was down.

1. **The compare-and-swap was unsatisfiable.** `production_batch_description_write`
   declared `p_expected_updated_at text` — the only writer in the estate that
   does; `2026-08-26-production-intake-append-v7.sql:161`,
   `2026-08-31-production-component-fill.sql:89` and
   `2026-07-23-f34-f53-production-attachments.sql:772` all declare `timestamptz`
   — and compared `v_current.updated_at::text` against it. Measured against the
   live row behind the report and PostgreSQL 16.13 on 2026-09-01:

   | | |
   |---|---|
   | PostgREST → browser → gateway → RPC | `2026-08-31T20:18:54.574498+00:00` |
   | `updated_at::text` | `2026-08-31 20:18:54.574498+00` |

   ISO `T` against a space, `+00:00` against `+00`. `is distinct from` was
   therefore TRUE on a row nobody else had touched, so the CAS refused **every
   save the product has ever attempted** — a 100% failure rate for any UI write,
   not a race. The gateway's own pre-check passed because it compares the
   PostgREST rendering against itself, which is exactly why this surfaced only at
   the last step and why no test caught it: the browser gate had been blocking
   this path since the hour it merged, so the SQL half had never once been
   exercised end to end.

2. **The refusals were unreadable to the gateway.** All three `raise exception`
   messages were spaced English (`'production batch description write conflict'`)
   while the `rpc()` mapper matches underscore tokens (`/write_conflict/i`,
   `/batch_not_found/i`). None matched. Every one fell through to
   `GatewayError(500, "native_write_failed")`, which the browser classifies
   `wait`. **A correct, expected conflict was reported as a dependency outage,
   and the advice was to retry a refusal that could never succeed.**

**Why the parameter stays `text`, which is the whole reason this is SQL-only.**
Widening it to `timestamptz` changes the function's identity, so `create or
replace` would install a SECOND overload beside the broken one — and PostgREST
resolves an RPC by the argument names in the JSON body, not by type, so it would
then have two candidates and answer PGRST203 ambiguous. That turns a one-paste
repair into a repair plus a deploy plus an outage in between. The cast moved
inside the body instead.

**Proven, not argued.** `test/batch-description-cas-timestamptz.js` pins both
renderings as measured data and asserts they are different text naming the same
instant; lifts the deployed mapper's regex literals out of
`production-write/index.ts` and **executes** them against the migration's own
raise strings, proving the new tokens map to 409 and that all three superseded
ones mapped to nothing. Its optional `BATCH_DESCRIPTION_CAS_PROBE=1` leg installs
both bodies into a throwaway PostgreSQL and runs the real save: shipped body
refuses the untouched row, replacement commits it, a genuinely stale expectation
is still refused, and a malformed one is a conflict rather than a 22007 into the
generic 500. That leg was run against PostgreSQL 16.13 and is where the numbers
above come from. Opt-in on purpose — the suite must never depend on a service
being up.

**The lesson worth keeping.** A gate that blocks a path also hides every bug
behind it, and the bug behind this one was total. When a fix removes a gate, the
path it opens has never run — treat the first report after that deploy as the
first real test of everything downstream, not as a regression in what was just
shipped.

## 2026-09-02 — F27 Section 4 forward deploy executed (comment parent resolution, unsendable outbound writes)

**EXECUTED. Green.** Run `33684111985`, dispatched by the owner from
`152c050e0179ee127e02d0ea50853960d9019eab`. All four closures deployed, strict
serial provider readbacks PASS, final four-function source/entrypoint/JWT/
version comparison PASS.

| function | active version | source closure SHA-256 | JWT |
|---|---|---|---|
| `batch-write` | 34 → **35** | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | `verify_jwt=false` |
| `deliverable-write` | 34 → **35** | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | `verify_jwt=false` |
| `linear-outbound` | 46 → **47** | `1489a4c276ca343554df2f4840c4f4b8ac77c33914098ee59a5d8b5cdec6ce39` | `verify_jwt=false` |
| `production-write` | 65 → **66** | `cc44bf938fd666595061972c27721fbf10d17cb11b184e417f59478b0add5370` | `verify_jwt=false` |

`batch-write` and `deliverable-write` are unchanged source, redeployed because
the lane deploys the four as one serial set; their closures are byte-identical
to the prior capture.

**What is now live that was not.**

`production-write` — the comment parent lookup no longer conflates "no such
row" with "two rows". All three sites in that file resolved a parent with an
unordered `.or(id.eq.X,native_comment_id.eq.X).limit(2)` and then tested
`length !== 1`, which is true for 0 as well as 2. Zero rows now answers a
distinct `409 comment_parent_not_found`; two rows prefer the exact primary-key
hit before anything is called ambiguous. The lifecycle site keeps its `403` and
its deliberate non-enumerating response — it was reporting a missing row as a
PERMISSIONS failure, which sent operators to escalate to someone holding the
same unresolvable id (OPEN_REPAIRS 100).

`linear-outbound` — two writes Linear can never accept stop being retried
forever (OPEN_REPAIRS 114, formerly numbered 99 on its branch).

**Prior bundle sealed before dispatch**, per
`docs/ops/F27_SECTION4_CAPTURE_PLAYBOOK.md`:
`sealed_bundle_sha256 = 3010578bb45a80a5eba29b3c499274f27708da62171c3dc2925bbaf3bb919652`,
`byte_length = 524885`. Its `production-write` closure read `2af7fe6d…`, i.e.
the code that was live — the sanity check the playbook asks for, and the one
that proves the bundle would actually roll back rather than restore the release
being deployed.

**One dispatch was rejected first, and the cause is worth recording because it
is procedural, not technical.** Run #35 failed in 19 seconds on `Forward
commit_sha must equal the reviewed current-main workflow SHA`. The SHA handed to
the owner was `784eb380`, correct when it was read — and then a docs PR was
merged, moving main to `152c050e`, before the owner could paste it. Nothing
deployed, no partial state; the gate did exactly its job. The same trap is
already recorded for 2026-08-08, when four PRs merged inside the same window.
**Do not merge anything between giving the owner a deploy SHA and their
dispatch.**

**Still NOT deployed after this run.** `linear-inbound` has its own lane
(`deploy-f27-linear-inbound.yml`) and was untouched — this lane cannot deploy
it by design. Its `readStoredComment` still returns `null` for both 0 and 2
rows silently, which skips echo suppression and tombstone protection and can
overwrite a client-visible thread's author, body and audience. That lane is
additionally blocked on two stale pins (OPEN_REPAIRS 77 and 106); re-pinning is
a PR, not an operator step.

## 2026-09-03 — Browser-only: the deep link stopped calling a not-yet-loaded row missing

**No deploy.** Browser-only, live via Pages on merge to `main` (`a3231156`,
PR #1243). No Edge Function version moved, no migration, no F27 Section 4
dispatch, no capture. **`ROLLBACK.md` is unchanged and correct** — the rollback
boundary for this change is the Pages deploy itself.

**What it carried.** The sixth round of OPEN_REPAIRS 108. Refreshing a link to a
posted row showed four states: skeleton, "Deliverable not found", skeleton, then
the row. `terminalTailPending` answers *is a tail running*, which the phase-one
success path raises — so across the cached first paint and the whole live read
before it, a row that had simply not been fetched yet was reported absent.
`_prodRowSetComplete()` asks whether a tail has LANDED instead, which
`terminalTailLoadedAt` already recorded and nothing consulted.

**Measured in a real browser, warm cache** (the ingredient five earlier rounds
missed — the snapshot is written from the phase-one set, so it can never hold a
terminal row, and a cold browser does not reproduce it):

```
before   328ms  NOT-FOUND ..................... 1984ms  the row
after    333ms  skeleton, delay -295ms         1990ms  the row
```

Also in the same merge: the targeted deep-link read now matches
`linear_identifier` (rows do carry a different value there — VID-13553 carries
GRA-7197), and the reconciler keeps deleted-issue orphans in the plan while
excluding their ids from `attributionFamilyComplete`, so
`outbound_issue_missing` is raised for rows that need re-creating.

**Gate status, recorded honestly.** `production-polish-heavy` failed on `main`
after this merge — and failed identically before it, on `4931e1b1`, with the
byte-identical signature `behav_wired:chip+kbProj+titleTooltip+ringClearOnNav+pcardNameTooltip+1more`
plus `Production pixel parity [error_generic]`. It has been red on every merge
for weeks. This change did not cause it and did not clear it; it did flip
`production-polish-interaction` from failure to success. The standing red is a
real problem and is nobody's single PR to fix — it is recorded here so the next
session does not mistake it for its own regression.

**Reconciler, second fix (later the same day).** Item 119's deleted-issue
tolerance never matched the wire (`extensions.type: 'invalid input'`, not
`EntityNotFound`); the monitor stayed red 21 more hours. Re-fixed on the
captured shape, capped at `RECONCILE_NOT_FOUND_CAP` (10) so an access loss
cannot reconcile as a bulk deletion, closure re-pinned to `a4664cc9…`.
OPEN_REPAIRS 126.

**Caption change-requests, refused since the video flip.** A caption and a title
own no deliverable, but all four writers collapsed their component onto `video`
and aimed the note at `video_deliverable_id`. Invisible while video was
Linear-authoritative; from the 2026-08-28 flip it was a 409
`native_link_required` on the 188 non-archived cards with no video component,
and a note filed into the video deliverable's canonical thread on the 566 that
have one. Reported by Kasper six days later, as the raw code in a red banner.
Fixed at all four sites plus `_writeUiNativeId`; the panel banner now reads the
shipped failure-message table instead of printing the code; the two Kasper
rollbacks now restore the `*_tweaks` strings they were leaving behind.
OPEN_REPAIRS 127.

**Reconciler, third fix.** The 13:00Z run on the merged main still threw. By
elimination on its log the unmet conjunct was `json.data`: `issue(id:)` is
non-nullable, so one dead id nulls the entire query root and the chunk arrives
as `{data:null, errors:[...]}` rather than 34 issues and a null. Items 119 and
126 were both measured against a shape the wire does not produce, and one suite
assertion ("a response with no data at all throws") was pinning that belief in
place through both. The transport no longer requires `data`; the loader re-asks
for the surviving ids without the dead alias, because tolerating alone would
have read 1 of 35 and reported the gap as divergence. Closure re-pinned to
`7619b30d…`. OPEN_REPAIRS 128.

**The calendar refresh storm.** Reported as "it refreshes 10 to 15 times in a
row". Not the calendar re-entering its own load -- four candidates eliminated by
measurement. `calendar_posts` takes ~200 backend row writes an hour (the
reconcilers that still apply Linear -> card, item 76); the tab reloads the whole
client on every realtime event behind a 350 ms debounce, and the 4-second
coalescing window beside it keys off `_calLastLocalWriteAt`, so it only ever
applied to this tab's own writes. One refresh per row. `CAL_V2_RT_MIN_RELOAD_MS`
(8 s) now re-arms foreign bursts the same way: 15 reloads become 2, measured on
the real handler against a mutant. Browser half only; the cure is item 76.
OPEN_REPAIRS 129.

## 2026-09-04 — F27 P.3 `linear-inbound` forward deploy executed (first since 2026-07-30)

**Owner-dispatched, run `33899387402`, `deploy-f27-linear-inbound`, fully green.**
Reviewed release SHA `72fbc4a5be6c570c2d6638a49b320abd4e4b2c5c` (merge of #1238);
operation `deploy-reviewed-release`; confirmation accepted.

| field | value |
|---|---|
| deployed slug | `linear-inbound` |
| deployed function count | 1 |
| candidate source closure SHA-256 | `019a463dee2b4b91ff0b19a0220479e7602e9a5880da6d19519f9113716bf0fc` |
| candidate source files | 5 |
| JWT posture | `verify_jwt=false` |
| Supabase CLI | `2.109.0` |
| Deno | `2.2.15` |
| frozen `deno.json` SHA-256 | `e13cf0336d14f38013762c11935bd6123978f809120f530738d5b69669281524` |
| frozen `deno.lock` SHA-256 | `a42630fbcde6d3f93da9ca2f5a9a39fd92ad23614853338443a56e7d4ab525ed` |
| sealed v39 private fetch | PASS |
| sealed v39 bundle SHA-256 | `cd0b391962a18b5e912dacf0c0e63c2ae972818343d1c41f77058039dd570690` |
| sealed v39 bundle bytes | `49968` |
| F27 Shared Drive root id SHA-256 | `9d1480048b17bcd038650c4d3191e12cb94b65938374ab335b955a9cab2df042` |

**The receipt does NOT carry an active version number.** This lane's summary
reports the deployed CLOSURE, not the version, so the live version is recorded
here as "one past v40" and not as a number nobody read back. The workflow says so
itself in its closing line: *"Post-deploy provider readback, sealed capture, Drive
round-trip, freshness, and before/after state checks remain required outside this
workflow."* **That readback is owed and has not been done.** Until it is, v40
remains the last version this log can name from evidence.

**What went live, and what did not.** Five commits had accumulated on
`linear-inbound` since the 2026-07-30 deploy (`e3bcee98`), 136 lines:

- **Item 100's `readStoredComment` repair — LIVE and reachable.**
  `persistProductionComment` is called at index.ts:1245, *before* the
  detect-only gate at 1247, so the defect that answered "no such row" and "two
  rows" identically — skipping echo suppression and tombstone protection, and
  corrupting rows rather than refusing writes — is now fixed in production. This
  was the actively-harmful half.
- **Item 77's cleared-assignee repair — SHIPPED BUT UNREACHABLE on current
  authority.** `isDetectOnlyTeam` (index.ts:678-685) returns true whenever a
  team's `prod_authority` reads `syncview`; both teams have since the
  2026-08-28 video flip. The issue lane therefore returns inside the detect-only
  branch at ~line 803, and the assignee write is at line 868. No Linear
  unassignment can clear a stale `assignee_id` while that holds. See OPEN_REPAIRS
  143's correction.
- Self-echo labelling for the comment lane, plus review follow-ups and register
  units.

**ROLLBACK POSITION CHANGED, and not by one step.** This lane's only automated
restore is `restore-captured-v39`, which writes back the pinned
`V39_BUNDLE_SHA256` artifact. Before today that was one release behind live
(v39 → v40). It is now **two** behind, and there is no automated path to v40.
Restoring through the lane therefore undoes this release *and* the 2026-08-02
one. `ROLLBACK.md`'s Linear-inbound row is updated to say so.
## Social media manager on a SyncLinear sub-issue

Owner asked to see who runs the client, under `Project`. His constraint was
maintenance: no hardcoded client-to-manager map, because editing the Google
Sheet would not update it.

Nothing needed hardcoding. n8n `y3rEWCVdB0esN3tO` has mirrored the sheet into
`social_media_managers` nightly for weeks; `serializeManager` simply never
returned `source_clients` or `synced_at`, so no caller could answer the
question. Those two fields are now in the projection and the card reads the
mirror. No client-to-manager pairs exist in the app, and `test/prod-smm-line.js`
asserts there are none.

Three properties are load-bearing rather than incidental, each found by a
reviewer or by CI rather than by design:

1. **No unprompted staff-authenticated read.** The first version fetched on
   detail render and turned `production-polish` red — `prod-structure-subset.js`
   forges an admin identity (`structure-fixture-key`) to reach the
   Linear-authority refusal, the call 401'd, and the tab's console audit counts
   that as a persistent read failure. The tab makes no such read anywhere
   (descriptions hydrate on demand; `_prodLoadBriefs` is only a marker). The
   roster now comes from `_srpState`, which the weekly-reports page already
   fills, and a request happens only when nothing has answered yet.
2. **The cache is Admin/SMM data and dies with the identity.**
   `_prodSmmPurgeSensitiveState` joins `_syncviewStaffPurgeSensitiveState`;
   without it, signing out or switching to Creative left a protected
   client-to-manager assignment on screen that the new identity could not have
   fetched.
3. **Bounded, and failures are not answers.** A five-minute TTL, a one-minute
   retry, and a three-failure stop: cached forever would have made "follows
   within a day" require a reload, and caching one transient 401 as an answer
   would have hidden the row for the rest of the session.

The provenance is visible muted text, not a `title`. It is the only signal that
an assignment may be stale, and the Production tooltip layer listens for
mouseover/mouseout only — as an attribute it would reach neither a keyboard nor
a phone. OPEN_REPAIRS 146.

## Social media manager card — the provenance line removed

Reverses the third property recorded in the entry above. That entry says the
last-sync provenance is visible muted text rather than a `title`, and as written
it would have future Production work keep a line the owner does not want.

He asked for it gone twice. It was my call to add it and the wrong one for this
surface: the roster syncs nightly, the manager's name is the answer the reader
opened the sub-issue for, and a second line of bookkeeping under every card is
noise on a surface he uses all day. The card now renders the name alone.

**The accessibility reasoning that shaped it still stands**, and is now enforced
in the opposite direction: `test/prod-smm-line.js` asserts the card carries no
tooltip at all, so the provenance cannot come back as a `title` or
`data-prod-tip` — which would be worse than the visible line, because the
Production tooltip layer listens for mouseover/mouseout only and reaches neither
a keyboard nor a phone.

That guard was itself broken when first written, and Codex caught it: it read
`stripNonCode(card)`, which blanks every string literal — and the markup IS
string literals, so neither attribute could ever appear and the assertion could
not fail. It now reads a comments-stripped view that keeps the literals, and the
fix is proven by mutation: re-adding `data-prod-tip` to the card makes it fail.
Same could-not-fail class as OPEN_REPAIRS 144, in the very check meant to prevent
the regression.

`synced_at` still travels from `smm-weekly-reports`; the browser directory no
longer carries the unused field.

## 2026-09-05 — the two shared asset slots belong to the post, not to a batch row

Owner report on one post: a Frame folder set on the parent appeared on none of
its 32 sub-issues, and the raw footage the sub-issues showed appeared on no
parent. Root cause measured live across all 6,332 browser-visible deliverables:
`footage_folder_url` and `delivery_folder_url` are columns on one `batches` row,
and of 1,138 posts **44 span more than one batch row**, stranding 141 rows off
the bucket the post resolves first. The reported post has its parent on a `b1_b_`
mirror batch and all 32 children on a native `bat_` batch.

The 2026-09-01 borrow could not close it: it walked only downward, and it was
gated on the reader's own batch carrying none of the three — so the owner's own
save switched it off and removed the one thing the borrow had been getting right.

`assetSnapshot` now resolves the post from either direction, orders its batch
rows deterministically and answers per slot; the read names a write target per
slot so an edit lands where the value already is. Three symptoms shared this one
cause: the two slots, and the missing sub-issue file pills.

Two further defects on the same post, unrelated to each other:

- **Every Dropbox share link copied out of Dropbox was unsaveable.** `st` and
  three siblings were not on `SAFE_ASSET_QUERY_KEYS`, so `assetUrlType` answered
  `invalid` — which also refuses the write, nulls `canonicalArtifactUrl` and
  blocks the `smm_approval` transition. Measured over the readable proxy corpus
  (1,674 batch rows, 10,878 URLs, 514 Dropbox occurrences, 171 distinct): 19
  passed before, 171 after. Host-scoped to dropbox.com.
- **A deliverable whose `origin` had drifted could never receive an artifact.**
  `production_artifact_write` routes the card projection on `origin`, so a row
  saying `manual` while carrying a correctly two-way-bound card raised and rolled
  the whole write back. 7 live rows. Fixed by resolving the surface from the
  binding, plus the producer in `scripts/b1-linear-backfill.js` that made them.

**Review caught two P1s after merge and before deploy** (#1287, Codex), both in
the write path and both real:

1. The write target was panel-wide while a post's slots can sit on different
   rows — so clearing the Frame folder on the reported post would have written a
   blank over an already-blank column and the value would have reappeared, and
   replacing it would have left a stale duplicate. The target is per slot now.
2. The target could be a batch row carrying another post's work (43 of 1,567
   buckets hold more than one post; one holds ten), which would have put a
   link saved on one post onto posts nobody was looking at while the editor said
   "shared by the whole post". A shared bucket is no longer offered for an empty
   slot, and unknown exclusivity offers nothing.

Both were fixed before the `production-write` closure was deployed; the fingerprint
was re-pinned on the corrected tree.

## 2026-09-05 — F27 Section 4 deploy, run `33982906228`: production-write 66 → 67

Dispatched from `a05e1126437bb8c36bd3f33e3701a58924a8627d`. GitHub run #38; run #37
(`33982751799`) was the `OBJECT_MISSING` attempt described below and deployed
nothing. The first version of this heading said "run #37 attempt 2", which was
wrong: the owner dispatched again rather than re-running, so the green deploy is
its own run. Corrected 2026-09-05 when the rollback-row freshness guard was found
unable to read this entry at all (see the v68 entry below).

Capture receipt: sealed_bundle_sha256 = `b66c0ae103e18077521c153fe88b98191de6038a656251fbb2421c73118cde31`,
sealed_bundle_byte_length = `534985`.

| function | active version | source closure SHA-256 | JWT |
|---|---|---|---|
| `batch-write` | 35 | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | verify_jwt=false |
| `deliverable-write` | 35 | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | verify_jwt=false |
| `linear-outbound` | 47 | `1489a4c276ca343554df2f4840c4f4b8ac77c33914098ee59a5d8b5cdec6ce39` | verify_jwt=false |
| `production-write` | 66 → **67** | `d2914ac298988e37ac7f8a3b78301eb9ed7d65804927d5d78443f56baf49e062` | verify_jwt=false |

Only `production-write` moved; the other three redeployed at their existing
closures. Sealed prior four captured at `b66c0ae1…` (534,985 bytes), prior
`production-write` v66 / `cc44bf93…`. Forward deployment PASS, strict serial
provider readbacks PASS, final four-function source/entrypoint/JWT/version/
provider comparison PASS.

**The first attempt failed in 21 seconds and the reason is worth keeping.** The
lane does not receive the rollback bundle as an input — it FETCHES it out of the
`SyncView Backups/` Shared Drive root by content-addressed name during the run
and verifies an independent round-trip. The bundle had not been uploaded yet,
because CLAUDE.md listed the upload AFTER the dispatch:

```
{"status":"FAIL","code":"OBJECT_MISSING",
 "message":"The content-addressed private object was missing."}
```

Nothing deployed, the capture stayed valid (the live set had not moved) and the
SHA stayed valid, so the recovery was: upload the bundle, then run the lane again
with the same five inputs. The owner did that as a FRESH dispatch, which is why
run #38 (`33982906228`) carries the green deploy and #37 (`33982751799`) is the
failed attempt; two run ids is the evidence, since a re-run keeps its own id.
`Re-run jobs` on the failed run would have worked equally well and is the
shorter path, because it preserves all five inputs without retyping them; that
is what CLAUDE.md documents. CLAUDE.md now also states the order as a numbered
sequence and names the error, so the next session recognises it instead of
re-diagnosing it.

The alias `f27capture` also answered `CommandNotFoundException` in a fresh
window that had not loaded the owner's `$PROFILE`. CLAUDE.md now leads with the
full script path, which always resolves, and keeps the alias as the shorthand.

## 2026-09-05 — Crosswalk Phase 2: migration applied, first apply 89 of 100, 11 refused by the F27 fence

**DB migration, owner-applied, SQL Editor, ~18:25Z:**
`migrations/2026-09-05-crosswalk-bind-and-import.sql` as merged in #1291
(`287c16cd`). Creates `public.crosswalk_linear_identifier(text)` and
`public.production_comment_card_bind_and_import(jsonb, jsonb, jsonb)`
(`create or replace`, service-role only, no table/column/flag/data change).
"Success. No rows returned."

**Lane dispatches** (`crosswalk-phase2-repair.yml`, production Environment,
run id `crosswalk-phase2-2026-09-05`, commit `a6b8c3a2` after the export
ordering fix #1298; a first plan dispatch from `731e7c24` died in 21 s on
`export_read_clients_400`, wrote nothing):

| run | mode | result |
|---|---|---|
| `33987343682` | plan | PLANNED — 1,214 slots, 1,107 clean, 107 mismatching; 100 calls (18 with eviction; 64 with a thread, 132 comments); 7 skipped for a person |
| `33987430593` | apply | **PARTIAL** — 89 bound, 7 occupants detached, 97 comments imported, 23 already linked; **11 refused** |

**The 11 refusals** were every call whose eviction took the *cancel* branch (6
occupants at Kasper approval, 4 scheduled, 1 tweak): the live F27 outbox fence
(`track_b_f27_hold_guard`, installed 2026-08-02) raised
`f27_authority_generation_stale:video` because the intent carried no
`_f27_authority_generation`. Each refused call rolled back whole; those 11
slots are unchanged and still bindable. The 7 detach-only evictions and all 89
binds committed: `deliverable_events` holds 89 `crosswalk_bound` and 7
`crosswalk_occupant_evicted` (`mode=detached`) rows for the run; no outbox
intent was queued. Nothing reached Linear.

**What changed on live, and how it reverts.** 89 deliverable rows now carry the
card they always pointed at (`origin=calendar`, `card_id`, `client_slug`,
`team`, `kind` = slot key); 7 shell rows had `card_id` cleared; 97 legacy
comments were COPIED into the canonical store with links. The legacy threads
were not touched. Reversal, per the migration header: drop the canonical rows
and links written under the run id, and clear the five binding fields on the
89 rows (the `crosswalk_bound` events carry `kind_before`). Not exercised.

**Fix:** #1301 — the RPC mints the binder via
`track_b_f27_write_authorization`, asserts authority, detaches only under
Linear authority; the rehearsal carries the F27 fence verbatim. **Pending:**
owner re-applies the same migration file (Epoch 2) and re-dispatches plan →
apply. Expected: 11 calls, 11 cancels queued for the outbound drain, 0 refused,
7 slots left for a person. OPEN_REPAIRS 156; CROSSWALK_REPAIR_STRATEGY §5.

## 2026-09-07 — naming the batch and naming each post from Create Post

Owner: "when they create a new batch, they should be able to choose the name,
which would change the name in sync linear ... so that will be the name of the
parent issue and if they add to a previous batch so they will be adding a
sub-issue they should be able to name that sub-issue also."

**The batch half needed no server change.** `batch.name` has always travelled
from the browser to `batches.name` and into the parent create payload verbatim;
it was hard-coded to `<Client> · <date>` only because nothing asked for
anything else. The dialog now offers the field, falls back to the generated
title when it is left empty, and appends ` · Samples` to a typed Samples name
so the 2026-08-19 ruling that a samples parent must say so is not silently
dropped.

**The post half ended at the database.** A sub-issue title is now
`Video 4 — Launch hook` / `Thumbnail 4 — Launch hook`, and the exact shape
`[Sample ]Video N` was built into three layers. It is a SUFFIX rather than a
free title for two structural reasons: the number is the only record of a
post's ordinal (`deliverables` has no column for it, and both
`planAppendIntakeItems` and `production_intake_append` re-derive the next
number by reading it back out of the titles already in the batch), and the kind
has to stay visible (2026-08-17: two identically-titled halves read as "two
video sub-issues").

**Migration `2026-09-07-production-intake-append-v8.sql` — APPLIED by the owner
in the SQL Editor, 2026-09-07, "Success. No rows returned", before the dispatch
below.** It widens exactly two title predicates in the append RPC and moves no
table, column, index, policy or grant. Executed before handover against a
disposable PostgreSQL 16 built from the baseline plus deltas, not merely
compiled: a named append commits, the append after it allocates the FOLLOWING
ordinal, an unnamed append is unchanged, a wrong ordinal and a bare trailing
separator both still raise `invalid_intake_append_order`, and the same named
call against v7 is refused.

**The real order, which is not the order the plan wanted** (Codex P2 on #1340,
against an earlier draft of this paragraph that claimed migration → gateway →
browser and then said the browser was already live, which cannot both be true).
The BROWSER shipped first, on merge, because `index.html` goes out via Pages and
cannot wait for anything; then the migration was applied; then the gateway
deployed as v69. The safety-critical ordering is the one that did hold and is
the only one that had to: **the migration preceded the gateway.** Reverse those
two and every NAMED append raises `invalid_intake_append_order`, because a
gateway composing named titles in front of a v7 function is refused by it.
Unnamed appends would have gone on working: v69 leaves the unnamed path
byte-identical and still composes a bare `Video N`, which v7 accepts, and no
named row could exist to disagree about the ordinal because v7 would have
refused writing one. So the cost of getting that order wrong is the feature
itself, not the surface.

The browser being early is safe by construction rather than by luck: between
merge and the gateway deploy a typed name was simply ignored by the old
gateway, and Create Post compares the names it asked for against the titles
that came back and says so in the notification when one did not land. That
window is now closed — all three layers are in place, so a typed name reaches
the row.

## 2026-09-05 — the asset grid stops blinking; the gateway reuses a verdict it already holds

Owner, with the post-level fix live on the reported parent: the Open link pill
"disappears and reappears ... two or three times" on a tab return, and "99% of
the time the asset links are not gonna change" so why wait for the probe each
time. Two causes, both in code that already existed to solve the previous
version of the same complaint.

**The blink.** The 2026-08-31 preservation rule required `complete &&
scopeSignature`. A tab return invalidates twice with a re-read in between; the
re-read sets `complete` false; the second pass dropped the stamped in-flight
state; the next render reseeded a skeleton for a link that had not moved. Three
more places deleted cached reads outright (the delta tick, the pill cache, the
post-wide invalidation after a batch save). All four now keep what is on screen
and mark it stale, with the existing use-time scope gate (and a new one for
pills) deciding whether a kept value may be drawn. `_prodEnsureAssets` also stops
starting the read that `requestStillCurrent()` was going to refuse anyway.

**The wait.** Every read probed every slot live. `heldAssetEvidence` reuses a
verdict the evidence ledger already holds for the same `(slot, url_sha256)`
within `ASSET_EVIDENCE_MAX_AGE_MS`, in place of the network step only; the
approval gate is untouched. `recheck: true` from Refresh access skips the
ledger. The executed suite caught `Number(null) === 0` in the first draft, which
would have reused a timed-out probe as a status-0 verdict.

**Parent grid.** No empty Deliverable file row on a real hierarchy parent.

**Codex P1 on #1305, fixed before merge.** Keeping pill entries across a
refresh meant the re-ask was the only thing that could take one down, and
`batch_files_read` omits a deliverable whose file was cleared, so the cleared
file's pill would have stayed up for the session. A successful re-ask now
evicts every entry it answered for earlier that the batch no longer names;
the clear-then-reload journey is executed in `test/prod-asset-refresh-holds.js`.
No E2E probe exercises the pills or the asset read, so the harness had nothing
to be told.

Browser half live on merge. Gateway half re-pins `production-write` to
`d7fc8348…` (file count 5, entrypoint unchanged) and waits for the next Section 4
dispatch, which also carries the exclusivity truncation guard (`6a39a2bc…`,
#1294). Optional index migration `2026-09-05-asset-evidence-by-url.sql`. Ledger
item 155, addendum.

## 2026-09-05 — F27 Section 4 deploy, run `33991332628`: production-write 67 → 68

Dispatched from `3d534cfa5598ef16e61c5ee7dc8072afaa9963c7` (GitHub run #39).

| function | active version | source closure SHA-256 | JWT |
|---|---|---|---|
| `batch-write` | 35 | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | verify_jwt=false |
| `deliverable-write` | 35 | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | verify_jwt=false |
| `linear-outbound` | 47 | `1489a4c276ca343554df2f4840c4f4b8ac77c33914098ee59a5d8b5cdec6ce39` | verify_jwt=false |
| `production-write` | 67 → **68** | `d7fc8348d114b17a86de8ac82f6e7a14041f2c2cfe60f6931482292c9f45016a` | verify_jwt=false |

```json
{
  "schema": "syncview_f27_section4_deployed_versions_v1",
  "deploy_commit": "3d534cfa5598ef16e61c5ee7dc8072afaa9963c7",
  "github_run_id": "33991332628",
  "functions": [
    {
      "slug": "batch-write",
      "active_version": "35",
      "source_closure_sha256": "86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a",
      "entrypoint_sha256": "15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5",
      "provider_bundle_sha256": "ccc36ce94f39efbb8db84a554eeaef6b5ce013547be5d2349ee8adbdddc2fda5",
      "verify_jwt": false
    },
    {
      "slug": "deliverable-write",
      "active_version": "35",
      "source_closure_sha256": "78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575",
      "entrypoint_sha256": "74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68",
      "provider_bundle_sha256": "3868706acd8e86632c960a6d08cc8ed94e3e8787237a530b135c6e5a05a1f3dd",
      "verify_jwt": false
    },
    {
      "slug": "linear-outbound",
      "active_version": "47",
      "source_closure_sha256": "1489a4c276ca343554df2f4840c4f4b8ac77c33914098ee59a5d8b5cdec6ce39",
      "entrypoint_sha256": "606628504ec4614a22e9d16c7671dc5d9ef73bfc57b69ecaa08065a5d14f3684",
      "provider_bundle_sha256": "b72429af7131bc954c8140f8f15c0c437c1fa4568f300bb3134a4f2752f8d626",
      "verify_jwt": false
    },
    {
      "slug": "production-write",
      "active_version": "68",
      "source_closure_sha256": "d7fc8348d114b17a86de8ac82f6e7a14041f2c2cfe60f6931482292c9f45016a",
      "entrypoint_sha256": "7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5",
      "provider_bundle_sha256": "ce1b28208e0e3f591cf71cfdf8c18b984c4c8968fcaa6a9635054eaa5a5a4efc",
      "verify_jwt": false
    }
  ]
}
```

Capture receipt: sealed_bundle_sha256 = `fc9f12f78373f94b36fd6aac104fca4b373a5d61cbb1d2ad640fc787f123ddbe`,
sealed_bundle_byte_length = `546849`, sealing `production-write` v67 / `d2914ac2…`.

Only `production-write` moved; the other three redeployed at their existing
closures. Forward deployment PASS, strict serial provider readbacks PASS, final
four-function source/entrypoint/JWT/version/provider comparison PASS. Green on
the first attempt: the capture, the Drive upload and the dispatch ran in the
order CLAUDE.md now states, from the script path rather than the alias.

This deploy carries two changes: the ledger-verdict reuse in `asset_access_read`
(#1305) and the exclusivity truncation guard (#1294, `6a39a2bc…`, which had not
shipped on its own). The owner applied
`migrations/2026-09-05-asset-evidence-by-url.sql` before dispatching
("Success. No rows returned").

**The rollback-row freshness guard could not read either of today's deploys,
and the Live State row had been stale since v66.** Codex P1 on #1306. Both
entries were first written with the slugs unquoted in the versions table, no run
id in the heading and no attestation block, which is none of the three shapes
`scripts/rollback-row-freshness-check.js` parses; so the guard kept comparing
ROLLBACK.md against the 2026-09-02 receipt and reporting agreement while the row
named `production-write` v66 and bundle `3010578b…` (v65) as the one-step
restore. Restoring by that row after this deploy would have stepped back three
releases. Both entries now carry the run id, the quoted slugs, the arrow-shaped
version cell and the sealed bundle line, this one carries the JSON attestation,
and the guard itself now refuses a Section 4 deploy entry it cannot read, naming
the line and what to fix (Codex P1 on #1306, second round; the guard's own suite
already ran it against the real files, so a stale row is red rather than silent
from here on).

## 2026-09-05 — Crosswalk Phase 2, second apply: 11 of 11, 0 refused; 7 slots remain for a person

**DB migration, owner-applied, SQL Editor, ~20:1xZ:** the same file,
`migrations/2026-09-05-crosswalk-bind-and-import.sql` as merged in #1301
(`5b9c0720`, "Epoch 2"): `create or replace` of
`public.production_comment_card_bind_and_import(jsonb, jsonb, jsonb)` — the
cancel branch now mints the F27 authority binder and asserts authority before
enqueueing. No table/column/flag/data change. "Success. No rows returned."

**Lane dispatches** (`crosswalk-phase2-repair.yml`, production Environment,
run id `crosswalk-phase2-2026-09-05-b`, commit `5b9c0720`):

| run | mode | result |
|---|---|---|
| `33991070302` | plan | PLANNED — 1,214 slots, 1,196 clean, 18 mismatching; 11 calls (11 with eviction, 11 occupants; 4 with a thread, 12 comments, 0 deferred); relabels none; 7 skipped for a person; digest `b4130071…2677254` |
| `33991397920` | apply | **APPLIED** — 11 bound, 11 occupants evicted (`canceled` 11), 12 comments imported, 0 already linked, **0 refused**; after: 7 mismatching, 0 bindable (already_bound_elsewhere 5, client_mismatch 1, linear_identity_unproven 1) |

**Read-back, publishable key, 20:55Z, read-only.** `deliverable_events` for
the day: `crosswalk_bound` 100 (19Z: 89, 20Z: 11; 47 video / 53 thumbnail;
14 clients; 100 distinct deliverables), `crosswalk_occupant_evicted` 18
(`detached` 7, `canceled` 11). The 11 `canceled` rows (20:53:09–20:53:10Z)
carry `authority=syncview`, `authority_generation=0`; `from_status`
kasper_approval 6, scheduled 4, tweak 1. The 11 kept deliverables: `card_id`
set, `origin=calendar`, `kind=video`, statuses posted 5, client_approval 3,
approved 2, smm_approval 1. The 11 occupants: `card_id` null,
`status=canceled`. `mirror_outbox` is not readable with the publishable key
(42501); delivery is verified against Linear below.

**What changed on live, and how it reverts.** 11 more deliverable rows carry
the card they always pointed at; 11 duplicate shell rows (created by SyncView
Mirror, verified empty in Linear earlier today) are `canceled` with `card_id`
cleared; 12 legacy comments were COPIED into the canonical store with links;
11 outbox intents (`crosswalk-evict:<id>:canceled`, generation 0) cancel the
same issues in Linear through the outbound drain. The legacy threads were not
touched. **Reversal — what the ledger can and cannot restore** (this corrects
the recipe in the 19:3x entry above, which has the same gap): the canonical
rows and links are fully reversible (drop what was written under the run id;
the legacy threads are intact). The 11 occupants are reversible in binding
and status (the `crosswalk_occupant_evicted` event carries `from_status`, and
the `card_id` they held is the event's `card_id`) but **not in their
timestamps**: `track_b_deliverable_touch_timestamps` stamps `updated_at` on
every row the RPC updates and `status_at` on the rows whose status changed
(the 11 cancels), and neither prior value is recorded anywhere. **The 11
Linear cancels are not reversed by hand in Linear.** Video is
SyncView-authoritative (`prod_authority`), so a Linear-side edit is a foreign
mutation the authoritative reconciler may overwrite, and restoring the row's
status directly in the database enqueues no inverse outbound intent. The
reversal is the forward path run backwards: a native status write of each
occupant back to its `from_status` through a path that enqueues the outbound
intent with the F27 binder (`track_b_f27_write_authorization('video')` →
`mirror_outbox_enqueue` with `_f27_authority_generation`, exactly as the RPC's
cancel branch does), delivered to Linear by the drain. If a person must edit
Linear instead, hold the reconcilers first (the reconciler lanes are
manual-dispatch and cron; disable the cron or wait for a quiet window) and
restore the database rows in the same window, or flip Video's authority to
Linear for the duration. Not written as a script; not exercised. **The 100
kept rows are not fully
reversible from the ledger** (their `updated_at` moved too):
the RPC overwrites `card_id`, `client_slug`, `origin`, `team` and `kind`,
and the `crosswalk_bound` event records only `kind_before`. Of the other four,
`team` is re-derivable from the Linear identifier's prefix and `client_slug`
from the row's batch; the prior `origin` and the prior `card_id` (null or the
same card — the RPC refuses any other) are recorded nowhere this repo can read.
The runner's pre-apply export held the exact before-images, but the result
document is runner-local and gone with the runner. A complete before-image
exists only in a database backup taken before 19:31Z, which this repo cannot
verify exists. Not exercised; a reversal here would be undoing the ruling, not
repairing data — the cards still name these deliverables, so the binding is
re-derivable from the card at any time, which is what Phase 3's readback
checks. Follow-up recorded in OPEN_REPAIRS 156 "Still open": the events should
carry the before-values — the five binding fields, and `updated_at` and
`status_at` — for every row the RPC updates.

**Linear delivery.** At commit time the outbound drain had last run at 20:45Z,
before the apply (20:53Z); the next scheduled run (every 10 minutes) carries
the 11 cancels. The check against Linear itself — the 11 occupant issues in a
canceled state, nothing else in the VID team touched by the drain — is
recorded in the addendum below once it ran.

**Linear delivery — addendum, 21:02Z.** The drain ran at 21:00:35Z (run
`33991760541`, workflow_dispatch, 48 s, success). Read from Linear at
21:02Z: exactly 11 issues in the VID team updated in the preceding 15
minutes, all `Canceled`, `canceledAt` 21:00:46Z → 21:01:14Z in outbox order,
and the 11 identifiers are the 11 `occupant_linear_identifier` values the
`crosswalk_occupant_evicted` events carry — nothing else in the team was
touched. Delivered in one pass, no retries. For the 01:00Z pre-flip health
check: 11 outbound deliveries at 21:00Z, 100 `crosswalk_bound` and 18
`crosswalk_occupant_evicted` events on the day, are this repair, not drift.

**Totals for the day:** 100 of the 100 slots the ruling identified are bound;
18 occupants evicted (7 detached, 11 canceled); 109 legacy comments copied
into canonical threads. 7 slots remain, all for a person, named by reason in
every plan summary. OPEN_REPAIRS 156 ("Second live apply");
CROSSWALK_REPAIR_STRATEGY status table.

## 2026-09-05 — one-row crosswalk re-point under the owner's ruling

**DB mutation, owner-applied, SQL Editor, late evening UTC, after the second
apply.** One row of `public.deliverables`: `card_id` re-pointed from one card
to another card of the same client, applying a ruling the owner made while
reviewing the 7 slots the runner hands to a person (OPEN_REPAIRS 156, "The
seven, ruled"). The statement was guarded on the old value, so it could touch
at most that one row in that one state. The SQL Editor prints "Success. No
rows returned" for an UPDATE; the move was confirmed by reading the row back
with the publishable key (new `card_id`, `updated_at` at the moment of the
statement) and by the ledger guard's bare `update` event on the row at the
same second. Nothing here selects the row: `deliverable_events`,
`calendar_posts` and the browser projection are anonymously readable, so any
identifier, time, or card relationship in this file would be the identity. The
statement and the row are in the owner's SQL Editor history and the session
record.

**Why by hand.** The bind RPC refuses `already_bound_elsewhere` regardless of
what kind of card holds the row. The ruling was applied to this one row by a
person, which is the intended path for the slots the rule hands back.

**What changed, and reversal.** Only `card_id` and, via the touch trigger,
`updated_at` (status unchanged, so `status_at` did not move). No Linear
write, no outbox intent, no comment moved: the issue, its status, and both
cards' links are what they were. Reversal is the same statement with the two
card ids swapped. The old card id is **not** on the ledger event (the guard
records only op and reason, and the row keeps only the new value); it survives
in the owner's SQL Editor history and in the session record. The prior
`updated_at` (from the second apply) is not restorable. Not exercised.

**After.** The runner's classifier, re-run read-only minutes later: 1,214
slots, 1,207 clean, 7 mismatching, 0 bindable, the same three reason counts as
before (5 / 1 / 1). All 7 carry a recorded ruling (OPEN_REPAIRS 156). Phase 3
(b) closed; (c) open.

## 2026-09-07 — F27 Section 4 deploy, run `34151869293`: production-write 68 → 69

Dispatched from `70715496a44e7120f0b819deafdb84cd62d78f9b`.

| function | active version | source closure SHA-256 | JWT |
|---|---|---|---|
| `batch-write` | 35 | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | verify_jwt=false |
| `deliverable-write` | 35 | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | verify_jwt=false |
| `linear-outbound` | 47 | `1489a4c276ca343554df2f4840c4f4b8ac77c33914098ee59a5d8b5cdec6ce39` | verify_jwt=false |
| `production-write` | 68 → **69** | `ccbdd136f488c1e948ca49b429ff50e5c850057b3bd3eabb97c5cb47f1a3d164` | verify_jwt=false |

```json
{
  "schema": "syncview_f27_section4_deployed_versions_v1",
  "deploy_commit": "70715496a44e7120f0b819deafdb84cd62d78f9b",
  "github_run_id": "34151869293",
  "functions": [
    {
      "slug": "batch-write",
      "active_version": "35",
      "source_closure_sha256": "86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a",
      "entrypoint_sha256": "15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5",
      "provider_bundle_sha256": "ccc36ce94f39efbb8db84a554eeaef6b5ce013547be5d2349ee8adbdddc2fda5",
      "verify_jwt": false
    },
    {
      "slug": "deliverable-write",
      "active_version": "35",
      "source_closure_sha256": "78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575",
      "entrypoint_sha256": "74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68",
      "provider_bundle_sha256": "3868706acd8e86632c960a6d08cc8ed94e3e8787237a530b135c6e5a05a1f3dd",
      "verify_jwt": false
    },
    {
      "slug": "linear-outbound",
      "active_version": "47",
      "source_closure_sha256": "1489a4c276ca343554df2f4840c4f4b8ac77c33914098ee59a5d8b5cdec6ce39",
      "entrypoint_sha256": "606628504ec4614a22e9d16c7671dc5d9ef73bfc57b69ecaa08065a5d14f3684",
      "provider_bundle_sha256": "b72429af7131bc954c8140f8f15c0c437c1fa4568f300bb3134a4f2752f8d626",
      "verify_jwt": false
    },
    {
      "slug": "production-write",
      "active_version": "69",
      "source_closure_sha256": "ccbdd136f488c1e948ca49b429ff50e5c850057b3bd3eabb97c5cb47f1a3d164",
      "entrypoint_sha256": "7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5",
      "provider_bundle_sha256": "f67d8f183863d1d17b630ad105204c280b309bbef6cc5785683565e02b952525",
      "verify_jwt": false
    }
  ]
}
```

Capture receipt: sealed_bundle_sha256 = `4e3ed4681c768fae71d9959f891f768a19fff0b255e49cea6310882c571473a7`,
sealed_bundle_byte_length = `553951`, sealing `production-write` v68 / `d7fc8348…`.

Only `production-write` moved; the other three redeployed at their existing
closures. Forward deployment PASS, strict serial provider readbacks PASS, final
four-function source/entrypoint/JWT/version/provider comparison PASS. Green on
the first attempt, from the script path rather than the alias, in the order
CLAUDE.md states: capture, Drive upload, dispatch.

This deploy carries post naming (#1336) and nothing else. Its migration,
`2026-09-07-production-intake-append-v8.sql`, was applied by the owner before
the dispatch, which is the order that release required: the RPC refuses a named
title until it is applied, so a gateway composing named titles in front of a v7
function would have raised `invalid_intake_append_order` on every NAMED append.
Unnamed ones would have kept working -- the unnamed path is unchanged in v69 and
still composes a bare `Video N` that v7 accepts -- so the reversed order breaks
the feature rather than the surface.

The sealed capture read `production-write` at v68 / `d7fc8348…` — the code that
was live before this release, which is the check that proves a bundle sealed the
LIVE set rather than the release being deployed.

## 2026-09-07 — identifier team-move repair applied (7 rows)

**DB mutation, owner-applied, SQL Editor, evening UTC.** Seven rows of
`public.deliverables`, one column: `identifier` set from `linear_identifier`
for exactly the rows where both were present and disagreed. This is the data
half of OPEN_REPAIRS 161, merged as #1333 (`d2495eb`); the statement is
`migrations/2026-09-07-deliverable-identifier-team-move-repair.sql` and the
rollback entry is ROLLBACK.md, "2026-09-07".

**Why those seven existed.** `identifier` is the snapshot the b1 import took;
nothing maintains it, while `linear_identifier` is refreshed by every webhook.
Linear re-keys an issue when its team changes, so seven graphics rows across
two clients still carried a VID- number. Read from `deliverable_events`, the
import photographed five of them 40 seconds into a team move and two of them
eleven minutes into one; no `team_move` event exists on any of them because
the move landed before the row existed here.

**What ran.** The look-first step returned 7 rows with `collides_with` empty on
all of them, matching the count measured from the browser projection before the
PR was written. Step 2 then ran as one statement in one transaction: the cohort
selected once `for update`, one `deliverable_events` row written per row
carrying `retired_identifier` and `current_identifier`, and the update gated on
that insert having covered the whole cohort.

**Verified after, read-only through the browser projection** (which is
`public.deliverables` unfiltered, 6,369 rows): **0** rows still disagreeing,
**0** duplicate identifiers, and each of the seven now carries its Graphics
number with `identifier` and `linear_identifier` in agreement. The repair
receipt reads back seven `identifier_team_move_repair` events, one per row,
their retired/current pairs identical to the look-first output.

**What changed, and reversal.** Only `identifier` and, via the touch trigger,
`updated_at`; status was unchanged so `status_at` did not move. No Linear
write, no outbox intent, no card linkage touched. Each repaired row also gained
the ledger guard's own bare `update` event (`rpc_bypass_guard`) beside the
explicit repair event, both expected. Reversal is in ROLLBACK.md and reads the
repair's own events rather than the look-first output, restoring only rows
still holding the value this repair wrote. Not exercised.

**Owner ruling, same day.** The retired numbers stop resolving in SyncLinear
now that the two columns agree, and the owner ruled to leave it that way rather
than add a `retired_identifier` column, a browser-view migration and an adapter
read. Recorded in OPEN_REPAIRS 161; that decision is now closed.


## 2026-09-09 — Local Linear-exit attribution gap reproduced; installation held

On repair checkpoint `b1c4734ddd90e8945d18b3f412a5ede25bc1ae6f`, an executed
synthetic `_prodResolveAttributions` fixture with an active client, a resolved
`direct_project` stamp, and no mirrored project returned
`needs_attribution/persisted_resolution_is_not_currently_verifiable`.
`projectForIntake` at Lane A `5bcc03bd7d286f437ad51d4cc86a5ce80b7b63ea`
returns the existing team-tagged project under the native epoch short-circuit;
it does not itself create browser project evidence. PR #1372's actual diff was
read: its syncing copy retains the refusal and requires an empty persisted
stamp. Its reported live row count was not independently verified.

The local repair adds accepted-epoch legacy-project attribution, its bounded
browser projection and ownership validation, and P7 create-then-edit/reload
checks. Preflight v5 rejects the older projection that lacks the new source
marker. This is source preparation only: no merge, deploy, dispatch, production
write, or n8n change. Runtime/browser/database proof remains owed; source/VM
passes do not authorize installation. See `docs/ops/LINEAR_EXIT_REPAIR_INSTALL.md`.


## 2026-09-10 — Review returned local verification candidate

Imported and verified the private returned bundle at
`686add359bcf6c8a98e4d080cec763619013e852` in an isolated local review worktree.
The source diff confirms sparse-scope preservation and urgent extension lookup
repairs, stronger notification SQL writer fixtures, retained receipt checks,
and Windows runner portability fixes. Raw Windows logs and external browser
harness files were not supplied; the attached report remains attributed
execution evidence, not independently rerun PostgreSQL/browser proof.

Found and corrected the deploy preflight's stale urgent-routine search paths.
Preflight v6 now checks the declared `public, extensions, pg_temp`; unit coverage
compares every expected routine path to its migration header. No application
SQL was changed by this review. Nothing was merged, published, deployed,
dispatched, or written to production. Installation remains HOLD.

## 2026-09-09 — the twelve seconds a native card spends unattributed (browser, copy only)

An SMM reported a thumbnail he had just filed from the content calendar refusing
every edit under "Client attribution needs repair", naming a client whose roster
row and project mapping were both healthy.

**Measured, live, read-only.** `deliverable_events` has the row created from the
calendar at **19:28:29.255Z** (`action: create`, `source: ui`, `surface:
calendar`) and the mirror stamping it `resolved` / `direct_project` at
**19:28:41.440Z**: twelve seconds, with the right `client_slug` on the row the
whole time. The browser projection reads the row resolved today;
`scripts/attribution-stuck-check.js` puts it in no stuck bucket, and that client
has zero live rows with a missing project or an unresolved stamp. Both ends were
confirmed by running the shipped `_prodResolveAttributions` out of `index.html`
against the live row: `resolved` / `direct_project` as it stands, and
`needs_attribution` / `no_mapped_project_or_explicit_classification` with its
mirrored fields stripped.

**Cause.** Native creation writes the deliverable row first and mirrors it into
Linear after, and the resolver reads only the mirrored fields, never the
`client_slug` column SyncView itself wrote. The gate was right for those
seconds; its wording was not.

**Shipped: copy only.** The syncing shape now reads "Syncing to Linear" in the
neutral muted key. No verdict, gate, read, or authority path moves; the write is
still refused. Ledger OPEN_REPAIRS 187, parity WIRED-PARITY 2026-09-09.

**Left open, owner call.** Attribution still ignores the row's own
`client_slug`, so a mirror that fails outright rather than lagging leaves a card
read-only until somebody notices. Measured the same day: **139 live rows** carry
no `raw_project_id`.


## 2026-09-10 — Frozen client writers: urgent markers live, feature still off

Owner-authorized live-source deployment through the Supabase API: calendar-upsert 48 → 49 at 16:34:51 UTC, then sample-review-upsert 49 → 50 at 16:36:53 UTC after Calendar verification. Exact candidate source readback passed; both preserve verify_jwt=false and contain zero authorizeBrowserWrite occurrences. Tokenless name/comment saves and all six supported marker/component combinations persisted on database readback. Test fixtures were removed using last-write guards. Runtime flag kasper_urgent_ping_enabled remains absent.

See [complete receipt, bundle hashes and rollback](docs/ops/FROZEN_WRITER_URGENT_MARKER_DEPLOY_2026-09-10.md). This is the deliberately frozen pair, not an F27 Section 4 deployment; repository writer copies were not deployed.


## 2026-09-10 — Kasper urgent ping: on for all clients, and its ledger half-installed

Three production mutations today, all through the Supabase API, none of them an
Edge Function deploy. Recorded here because `ROLLBACK.md` §2 requires the live
state to move in the same PR as the change, and because the day's own finding
was a capability that existed only in a file which does not run.

**1. Runtime flag.** `kasper_urgent_ping_enabled` was inserted as
`{"clients": ["<one test slug>"]}` at roughly 17:10 UTC, exercised by the owner
on one card, then widened to `{"enabled": true}` at roughly 20:20 UTC on the
owner's instruction. The affordance now renders for every client, in exactly the
places the existing tweaks URGENT button already renders and to the same people;
on Samples the whole sub-status row remains hidden from read-only and client
links. Kill switch and narrowing procedure are in the new `ROLLBACK.md` row.

**2. Ledger trigger function.** `public.syncview_kasper_urgent_ping_ledger()`
created. Read back with `pg_get_functiondef` and compared against
`migrations/2026-09-10-kasper-urgent-ping-ledger.sql` line by line: every
executable line matched, one comment line differed, and the function was
re-created with the comment so the two are now identical. **The four triggers
that call it were NOT attached** — creating triggers on the production tables
was refused by the session environment, so the owner runs those four statements.
Until then the function is inert and pings go unrecorded.

**3. Backfill.** One pre-existing calendar ping written into
`calendar_post_events` with `via: backfill` and its original timestamp rather
than a live one; the samples backfill matched nothing. The de-dup predicate was
subsequently corrected to scope by `(client, id)` rather than id alone — both
tables are keyed that way and 13 card ids are genuinely shared across clients
today, so the original predicate could have let one client's ping suppress
another's. The corrected form was re-run and was a no-op, as expected with a
single ping in the system.

**Not done, deliberately.** The obvious repair for the missing ledger was six
lines in each live writer. That means redeploying the two functions that have
broken client approvals twice, which is not a trade worth making for an audit
row, so the write lives in the database instead. Both repo writer copies had
their never-deployed `ev("kasper_urgent_ping")` branch removed and now point at
the trigger, which also restores repo/live parity for those two files.

Ledger OPEN_REPAIRS 195; capability parity gate in
`docs/ops/LIVE_DIVERGENCE_REGISTER.md` and `test/live-divergence-register.js`.


## 2026-09-10 — Kasper ping ledger triggers attached, verified end to end; DM copy corrected

**Ledger triggers, owner-applied — the feature is now fully installed.** The four triggers from
`migrations/2026-09-10-kasper-urgent-ping-ledger.sql` were run by the owner and
read back as attached and enabled on both tables, each calling
`public.syncview_kasper_urgent_ping_ledger()`.

**Verified through the real writers, not the database — BOTH surfaces.** A marker
write was POSTed to the live `calendar-upsert` for one TEST-client card, and a
second to the live `sample-review-upsert` for one TEST-client sample, which is the exact call
the browser makes after Slack succeeds; the Slack step was deliberately skipped
so no DM was sent. The writer returned `ok:true` and the trigger wrote the ledger
row unaided: `action=kasper_urgent_ping`, `component=video`, `source=db`,
`payload.via=trigger`, carrying both the ping and round timestamps. The test
marker was then cleared under a last-write guard, and clearing produced NO second
event, which is correct — the triggers fire only when a ping appears. The Samples
probe was run after review pointed out that the first drill covered Calendar
only: Samples is a distinct code path writing a distinct table, and because the
trigger swallows every exception a Samples-specific failure would have been
silent while approvals kept working. It returned `ok:true` and the trigger wrote
`sample_review_events` unaided. Two synthetic audit rows remain, one per surface,
both labelled `LedgerVerification` and deliberately not deleted.

**n8n DM copy, owner-authorized in the same request.** Workflow
`1WjZZjfQjDlg1Crf`, node `Parse & Validate`, one string. It closed with "It is in
the Urgent section at the top", which the browser cannot guarantee: the DM is
sent BEFORE the marker is written, so the card can still sit under "Waiting for
your review" when Kasper reads it, and stays there if that write fails. Now
"Urgent cards sit at the top of your review tab", which is true regardless of
ordering. Version `f442f701` → `fddb0d5a`, **published** (the edit lands as a
draft otherwise, and the live webhook keeps running the old version — checked
rather than assumed). A version diff confirms one node, one parameter: no node,
connection, credential, recipient or validation change. Rollback is restoring and
publishing `f442f701`.

**Reconciler, investigated per owner request.** The corrected ledger entry raised
why `docs/truth/SUPABASE.md` believed reconcile bypassed the ledger. It does not
write events itself: it sets `X-Syncview-Source: reconcile` and posts through the
ordinary writer, which logs the change under the declared source. Ledger coverage
is a property of the ROUTE, not the caller — `upsertUrlForClient` picks the EF or
the legacy n8n lane per `calendar_upsert_ef_clients` (calendar) and
`sample_review_ef_clients` (Samples). A first draft of this entry said
pre-enrollment reconciler writes were invisible; review caught that as too
strong. The retained legacy writer appends `sample_review_events` as well, with
`source: 'ui'` hard-coded, so a reconcile through that lane was recorded and
MIS-LABELLED rather than lost. 2026-07-07 marks when source attribution became
truthful, not when coverage began; whether the original claim was ever true is
open. Nothing is broken and the ledger is MORE complete than the doc claimed.
Mechanism and caveat both recorded in the truth doc.


## September 13 review follow-up: staged-schema reads

Preparation in draft PR #1391 adds exact missing-column compatibility for the three planned native projection fields. Existing canonical reads remain in use and missing native proof remains absent; no authorization is synthesized. The encrypted native public-schema backup has separate observed/populated PG17 proofs. No live writes, merge, installation or deployment occurred. See docs/ops/LINEAR_EXIT_REVIEW_REPAIRS_20260913.md for evidence and remaining gates.

## 2026-09-14 — slot colours, auto-assign opt-out, earliest-fit Workload planning

**Calendar slot colours paired.** The Thumbnail and Video fields and the two
Production buttons beside the thumbnail were coloured independently: blue/pink
for the fields, teal/magenta for the buttons, so the button that opens the
thumbnail's sub-issue read as unrelated to the thumbnail field above it. Each
slot now carries one vibrant accent through both surfaces (blue thumbnail, pink
video) via new `--sv-slot-*` tokens with dark-mode values, rather than reusing
the shared `--sv-bg-*`/`--sv-fg-*` tokens that other surfaces also read.

**Automatic video-editor assignment can be opted out of, per roster row.** An
outsourced editor should not receive work nobody deliberately gave them. The
flag is DATA, not code: `team_members.auto_assign_opt_out` (additive migration,
defaults false), so adding or removing a person never needs a deploy — and the
public repo never learns who it is. `autoAssigneeForIntake` drops flagged rows
from the automatic video pool only; `assertEligibleAssignee` does not read the
flag, so an explicit pick still works. A roster where every eligible editor is
flagged falls back to the full pool rather than turning every submission into a
409. First draft also ranked flagged editors last in the Create Post picker, on
the reasoning that the dialog's suggestion must match the gateway's silent pick;
the owner rejected it — the picker is a deliberate human choice and belongs to
nobody's automation — and that half was reverted. `PRODUCTION_WRITE_SOURCE_SHA256`
re-pinned with `ef-fingerprint`; the migration must be applied BEFORE the deploy
or the select names a column that does not exist.

**Workload automatic planning is earliest-fit, not latest-fit.** The 2026-08-10
pass placed each automatic card one working day before its deadline and only
ever moved work EARLIER to relieve a day already OVER capacity. Four videos due
Friday therefore stacked on Thursday — exactly at the 4-unit cap, so the pass
considered it fine — while Wednesday sat nearly empty. Owner ruling: automatic
planning should always be as soon as possible, with capacity as the only brake.
The walk now starts at today and steps FORWARD to the first day with room,
stopping at the ideal day so nothing is ever planned late. Pins stay absolute,
weights and per-team capacity are unchanged, and a saturated window still lands
on the ideal day with the honest over-capacity badge.

The owner asked what happens at the tight end, which is where a "plan it
earlier" rule could plausibly lose work. Verified against the extracted
functions rather than reasoned about: due tomorrow, due today and already
overdue all land on TODAY (the ideal day is floored to today, so the window
shrinks to one day and the card sits in it), and six cards due today against a
4-unit cap all stay on today and turn the day red. Nothing is dropped, hidden or
pushed past a deadline. The capacity-placement suite was converted check by
check to the new rule rather than relaxed: 27/27.

**2026-09-15 — Hiring Process: Video Editor role + practical-test stage,
applied.** `migrations/2026-09-15-hiring-video-editor-role.sql` was dry-run
against a disposable local Postgres 16 loaded with the exact live hiring
migration chain (baseline hiring tables through the 2026-08-25 repair deltas)
before being applied to the live project via the Supabase SQL editor path.
Read back clean: `role_slug` backfilled all 14 existing rows to
`client-success-content-manager`; the new `hiring_practical_tests_enabled`
flag seeded `false`; `hiring_applications_source_event_slug_check` and
`hiring_invite_jobs_interview_event_url_check` now allow both roles' iClosed
slugs/URLs; seven new `hiring_*practical_test*` routines exist and are
service-role-only. The dry run caught and fixed one real bug before it ever
reached production: an ambiguous `application_id` reference in
`hiring_set_practical_test_verdict_v1` (its own RETURNS TABLE column
collided with the bare column reference — same class of bug the 2026-08-25
qualification pass fixed elsewhere), qualified with a table alias like the
existing fixes. Also noted in passing: `hiring_invites_enabled` reads back
`true` live (not the default-off state this doc elsewhere describes as
current) — the Client Success & Content Manager interview-invite flow is
actively sending, with one application already at `interview_booked`. This
migration's round-3 gate change is a no-op for that role (only role_slug =
'video-editor' is newly gated on a passed practical test), so nothing about
that live behavior changed.

**2026-09-15 — Hiring Process: Video Editor n8n wiring, plus a self-caused
incident during verification.** Three n8n changes, all live: `Hiring —
Application Capture (iClosed)`'s single event-slug gate now recognizes either
role's application event and forwards `role` to `hiring-automation`; `Sales —
Call Booked (iClosed)`'s existing hiring early-branch now recognizes either
role's interview event the same way (every other branch — contact/deal
creation, confirmation emails, nurture, SMS — untouched); a new `Hiring —
Practical Test Dispatch` workflow mirrors `Hiring — Interview Invite
Dispatch`'s claim/authorize/send/record shape against the new outbox, using
the same `Hiring Automation Key` and `Hello email` credentials, and is a
no-op while `hiring_practical_tests_enabled` stays `false`.

**Verifying the Application Capture change with `test_workflow` executed the
live production version for real** — pin data alone does not stop an
already-active workflow's own HTTP/messaging nodes, only nodes explicitly
given pin data. One synthetic "Test Person" / `test@example.com` application
was actually inserted into `hiring_applications`, and Kasper received one real
Slack DM and one real Telegram message announcing it. Both were deleted
immediately (`hiring_application_events` row 32, then the application row);
`hiring_applications` read back at exactly 14 (unchanged) and
`hiring_practical_test_jobs` at 0. No further `test_workflow` calls were made
against already-active workflows after this was understood; the
`Sales — Call Booked (iClosed)` change was verified by re-reading the staged
draft's exact node parameters instead, then published directly. One other
`test_workflow` call (against the not-yet-active `Practical Test Dispatch`,
and one earlier attempt on the Sales router before understanding this) also
reached the real `hiring-automation` endpoint with a fake contact id; both
correctly bounced `422 application_not_found` and wrote nothing.

**2026-09-20 — Linear outbound cutoff: STEP 3 (outbound off) and STEP 1
(parity off) executed live; drain dispatched once; STEP 0 census read before
and after.** `linear_outbound_enabled` moved `{"mode":"live"}` -> `{"mode":"off"}`,
verified inside the write transaction and again on a post-commit readback;
committed at 2026-09-20 17:26:22.363379+00. The write ran twice — one intended
call and one accidental re-run while checking the script's own exit code, both
writing the identical `{"mode":"off"}` value; the recorded timestamp is the
second (and current) call's `updated_at`. `linear_legacy_parity_enabled`
moved `{"enabled":true}` (last set 2026-08-02 21:00:51.83Z) ->
`{"enabled":false}`, same in-transaction verify-before-commit pattern, run
exactly once, committed at 2026-09-20 17:35:54.465602+00.

STEP 0 census, full breakdown (`status`/`legacy_parity`/`test_only`: count):
failed/false/false 17, failed/false/true 28, skipped/false/false 579,
skipped/false/true 177, skipped/true/false 499, stale/false/false 26,
stale/false/true 5, stale/true/false 70, written/false/false 5856,
written/false/true 2231, written/true/false 1097. STEP 0's second query
(real-client rows: `legacy_parity=false`, `test_only=false`, status in
pending/failed/shadow_ok): only `failed`, 17 rows, oldest
2026-09-18 15:30:34.658803+00, newest 2026-09-18 15:35:26.293057+00 —
unchanged on re-read after both flips and the drain dispatch.

The drain workflow (`linear-outbound-drain.yml`) was dispatched once (run
35526389014, `workflow_dispatch`, succeeded). Its summary: `mode: "off"`,
`backlog: 45`, `oldest_pending_minutes`: video 3005, graphics 3005, against a
30-minute alert threshold, and **`alerts.oldest_pending_age: true`** — not the
`false` this step expected. With outbound off, the backlog cannot drain and
its age only grows; this alert stays latched until the backlog is resolved or
the alert is otherwise addressed.

Disposition for the real-client rows still `failed` (the 17 above) and any
other real-client row in `pending`/`failed`/`shadow_ok`: **frozen at cutoff
by owner decision 2026-09-20; Linear is retired and these rows are not sent.**

**Owner override, recorded explicitly.** The cutoff (STEP 3, this entry) was
executed on 2026-09-20 by owner decision **before** the runbook's P7 write-path
gates, the three cache-defeating reads, and the urgent-action decision
(`LINEAR_CUTOFF_RUNBOOK.md:140-146,301`) were recorded. This is a deliberate
override of that gate order, not an oversight. **Containment:** the flag is
reversible — the same write with `{"mode":"live"}` restores prior behavior —
and the owner is running the full acceptance click-through the same day. The
latched `oldest_pending_age` alarm (above) is a **known state**, pending a
separate owner decision on whether to mark the frozen rows terminal so the
alarm can clear; it is not being treated as resolved by this entry.

**2026-09-20 — Frozen mirror_outbox backlog marked terminal (authorized live
write, owner decision), clearing the pending-age alarm.** Read-only census
first: the drain-counted backlog (`status` in `pending`/`failed`/`shadow_ok`)
was **45 rows** — 17 real `failed` (`test_only=false`), 28 test `failed`
(`test_only=true`), 0 `pending`, 0 `shadow_ok`; matched the earlier drain
summary's `backlog: 45` exactly. In one transaction, all 45 rows were updated
to `status='skipped'`, `last_error='frozen at cutoff 2026-09-20 by owner
decision; Linear retired, not sent'`; the updated row count (45) was verified
equal to the pre-write count before commit. Post-commit readback: 0 rows
remain in `pending`/`failed`/`shadow_ok`; all 45 carry the freeze note under
`status='skipped'`.

`linear-outbound-drain.yml` was dispatched once more to confirm (run
35534292911, `workflow_dispatch`, succeeded). Its summary: `mode: "off"`,
`backlog: 0`, `oldest_pending_minutes` both null, `oldest_pending_alert_teams`
empty, and **`alerts.oldest_pending_age: false`** — the alarm opened by the
2026-09-20 17:26Z cutoff (recorded in the entry above) is now clear. This
resolves that entry's "known state, pending a separate owner decision" note:
the decision has been made and executed.

## 2026-09-20 — Production: synthetic batch-parent node displays "Post"

Browser-only change on `main` via PR #1455, no live write. A natively-created
post has no short identifier (the mint covers videos and thumbnails, not the
batch), so the synthetic parent node minted by #1444 showed its raw
`bat_<uuid>` id in the list id cell, the breadcrumb and the detail header.
Those three sites now render through `_prodIssueDisplayLabel`, which answers
"Post" for `syntheticBatchParent === true`; `_prodIssueLabel` is unchanged, so
Copy issue ID, palette search, sort keys and deep links keep the real id.
Verified by `test/prod-create-parents-native.js` (executes both helpers and
pins the three presentation sites plus the copy path).

**2026-09-20 — One-time Linear brief-image copy run (`scripts/native-brief-media-copy.mjs`,
PR #1451, CLI fix PR #1452).** Read-only export: 487 `deliverables` rows had a
`brief` containing an `uploads.linear.app` occurrence; 0 had a null
`linear_issue_uuid` (none refused on that basis). `plan` (zero network calls):
487 rows, 1339 occurrences across 1168 distinct files. `apply --apply` ran
against the live database/storage/Linear API, authorized by the owner (service
role key set directly in session environment, never logged). Two transient
network failures during the run (`fetch failed`, then `storage_upload_failed_520`)
were retried — the script's idempotency (`findExistingVerified`) made retry
safe; no duplicate writes. Final result: **copied 238, skipped_idempotent 1100,
refused 1** (`byte_length_out_of_range` — a genuine content-validation refusal,
not transient). Coverage: 1338/1339 resolved, complete=false.
`native_brief_media_occurrences` now holds 1338 verified rows (read back
2026-09-20T22:56:19Z). Wrote only to the `syncview-native-brief-media` storage
bucket and `native_brief_media_occurrences`; nothing written to Linear.

**Flag not flipped.** With refused=1 (not 0), the script's own eligibility
check printed `NOT YET ELIGIBLE` (its `projectBriefMedia()` gate requires
`recovery_receipt_sha256` and `coverage_receipt_sha256`, generated only from
a zero-gap run) and did not print a real FLAG FLIP block, so
`syncview_runtime_flags.native_brief_media` was not touched. Per instruction,
no SQL was run for this step; the eligibility notice was reported verbatim
instead. Rollback SQL the script prints (for if the flag is ever turned on
later, not run here): `update public.syncview_runtime_flags set value =
'{"mode":"off","contract":"native_brief_media_v1"}'::jsonb, updated_by =
'native-brief-media-copy' where key = 'native_brief_media';`

Separately noted, not fixed here: the script's CLI entrypoint guard was
broken on Windows before PR #1452 (`file://${process.argv[1]}` never equals
`import.meta.url` on a Windows path), causing a silent no-op (exit 0, no
output) on `plan`/`apply`. Worked around before #1452 merged by calling the
exported `buildManifest()`/`assertPrivatePath()` directly; not needed after
the fix landed. rows.json, manifest.json and out-map.json were written under
`%USERPROFILE%\.syncview\brief-media\`, outside any git working tree, per
the script's own `assertPrivatePath` refusal.

**2026-09-20 — Native brief-media copy finished: the one over-50MB file
dropped from its brief by owner decision, coverage reached 1338/1338, flag
flipped to `required`.** Deliverable `b1_d_cd4b461d2ae34951a6cae0dc614e0c4c`
(video team) held the single `byte_length_out_of_range` refusal from the
earlier run. Its live `brief` was read, hashed, and matched the manifest's
recorded `source_sha256` before anything was touched; a private copy was
saved outside the git tree as a rollback point (never committed). Exactly one
occurrence — the markdown image/link carrying the `uploads.linear.app` URL,
at the manifest's own `source_offset`/`source_length` — was removed with a
guarded `update ... where id=... and brief=<the exact prior text>`,
committed once the row count and returned value were verified equal. Readback
confirmed the brief no longer contains `uploads.linear.app` and its byte
count dropped by exactly the removed occurrence's length. No other part of
the brief was touched.

`rows.json` was re-exported (486 rows, down from 487 — this deliverable's
brief no longer matches the export query). `plan` recomputed 1338
occurrences across 1167 distinct files. `apply --apply` against the same
live environment reported **copied=0, skipped_idempotent=1338, refused=0**
— coverage **1338/1338 resolved, complete=true**. With refused=0 the script
printed a real FLAG FLIP block (`recovery_receipt_sha256` and
`coverage_receipt_sha256` filled in from this run's own out-map), which was
run exactly once and verified inside the transaction before commit.
`syncview_runtime_flags.native_brief_media` now reads
`{"mode":"required","contract":"native_brief_media_v1","recovery_contract":"native_brief_media_recovery_v1","recovery_receipt_sha256":"93167ba556b113174a89df90bff60bb33e4e9179a48ec1083c62bba357fc0830","coverage_receipt_sha256":"566040f2e52ede33420a431461fb33988d7555c52906a3f0ef669003a196ed7c"}`,
committed 2026-09-21T00:02:42.896549Z, `updated_by='native-brief-media-copy'`.
No client name, signed URL or brief text appears in this entry or anywhere
in this repository; the brief backup and the rows/manifest/out-map files all
live under `%USERPROFILE%\.syncview\brief-media\`, outside any git tree.

**2026-09-21 — Two Workload/Calendar cleanups, read-only first, write only on a
matched count.**

**Cleanup 1 (stale saved work days in `workload_plan`) — STOPPED, no write.**
The read-only query (`workload_plan` joined to `workload_native_snapshot_v1()`
rows, comparing client identity) was expected to return exactly 6 rows; it
returned **307**. Per instruction this stopped the cleanup before any write —
`workload_plan.plan_date` was not touched. The scale of the mismatch (307 vs.
an expected 6) suggests the "6" estimate was based on a different criterion
or a stale read, not that the query is wrong; not diagnosed further without
direction.

**Cleanup 2 (cards archived in Linear before the August switch-over, still
open natively) — completed.** Read-only shape matched the supervisor's
evening estimate closely: video 6 whole batches (16 cards) / 3 mixed (3
cards); graphics 5 whole batches (80 cards) / 1 mixed (6 cards) — 15 batches,
105 stale-open cards total. Ids and prior status saved before any write.

11 whole batches set to `status='archived'` (all were `active` before):
  - `b1_b_4ff10a54a9b87f6eae07576fa232` (was `active`)
  - `b1_b_64862122ea19bf5e6502689c928b` (was `active`)
  - `b1_b_9b2d74bcda2db469bf632b71d12a` (was `active`)
  - `b1_b_4c900ef91872131fa62723b1d20b` (was `active`)
  - `b1_b_2b23eef88da72a3d7f8382149ab3` (was `active`)
  - `bat_36a00d31-c525-4517-9e60-71ae5ed2c454` (was `active`)
  - `b1_b_11ea3922f181eb4f5752f1e7e65d` (was `active`)
  - `b1_b_f4dc808cb7366b09fab0a375af17` (was `active`)
  - `bat_5f496790-69d1-423c-86e9-05e03bcb0101` (was `active`)
  - `b1_b_174ce84b1f1b2e240af93eb76055` (was `active`)
  - `b1_b_5861d3bb7a53c9e60a8721c377ea` (was `active`)

9 stale-open cards in mixed batches set to `status='canceled'`:
  - `del_c461b2a5-5e7a-4694-ada3-78561ce1c0b0` (was `todo`, `VID-13370`)
  - `b1_d_66b5a98d50a945faad5833d92c00ac0c` (was `in_progress`, `VID-13057`)
  - `b1_d_b594fa6e2f4f48f7ac4b7d9cbd755de2` (was `todo`, `VID-13109`)
  - `b1_d_472faad3f9794d6fb7c247704474b532` (was `todo`, `VID-13416`)
  - `b1_d_b5d151f920f44685a6ec0536ab20e82c` (was `todo`, `VID-13415`)
  - `b1_d_b76d0634f93c4abdbd404ba4a2517342` (was `todo`, `VID-13414`)
  - `b1_d_27dd558cf4444875aeaab5aaa812f0da` (was `todo`, `VID-13413`)
  - `b1_d_9a06085ca22d48fb8f2322bf8e1f8678` (was `todo`, `VID-13412`)
  - `b1_d_c928be8c1b66415b979d665aba7a01d9` (was `todo`, `VID-13411`)

Both updates ran as one guarded transaction (`update ... where id = any($1)`
for each set, row count verified equal to the saved id-list length before
commit). Post-commit reads: 11/11 batches now `archived`, 9/9 cards now
`canceled`; the read-only detection query re-run afterward returns **0**
remaining stale batches. The reporting video editor's late-card check
(`workload_issues_native_v1`, that `native_assignee_id`, `status='Todo'`,
`due_date < current_date`) now returns **1** (was reported as 14 before this
cleanup) — a small number, the genuinely late cards.

No client name or slug appears in this entry.

**2026-09-21 — Cleanup 1 retry, corrected query, completed.** The prior
attempt's query compared display names to the gateway's compressed form
without applying the same compression and returned 307 rows against an
expected 6; this retry normalizes `owner_name` the same way the gateway
does (lowercase, accent-fold, strip a leading "Dr.", collapse " and "/" & "
to "&", strip remaining non-alphanumerics) before comparing to
`workload_plan.client`, and only considers rows that are native sub-issues
or already carry a `native_plan_id`. Read-only check returned **exactly 6**
rows, matching the supervisor's own read of this query at 00:40Z.

6 `workload_plan` rows had their `plan_date` set to null (all had a non-null
date before):
  - `3cb8855d-acce-4a91-9968-039ee2c49bbf` (was `2026-07-31`)
  - `649bc7c3-50fd-4380-9071-a6172f245a01` (was `2026-07-31`)
  - `6d82ba8e-7454-4477-b3b9-a1f77cc8ed00` (was `2026-07-31`)
  - `7c7b873a-3dfe-4925-bc2c-5fe8d6d79658` (was `2026-07-31`)
  - `d00d5767-6e18-46c9-a107-58179c9bdd63` (was `2026-08-19`)
  - `fc306311-8b7a-4d52-a406-8dbcb8c62314` (was `2026-08-14`)

Single guarded update (`where issue_id = any($1) and plan_date is not null`),
row count verified equal to 6 before commit. Re-running the corrected
read-only query afterward returns **0**. No client name in this entry.

## 2026-09-21 — Production: batch detail view orders deliverables like the parent view

Browser-only change, no live write. `_prodBatchDetail` (`?prod=1&batch=<id>`)
rendered `_prodBatchRows(batchId)` as-is, and that function only filtered —
it never sorted — so a 16-video batch showed videos and thumbnails
interleaved and out of numeric order. The parent view's sub-issue section
already orders correctly via `_prodChildrenOf` (owner ruling 2026-08-19:
video team first, then graphics, titles compared numerically, stable id
tiebreak). The comparator is now lifted into a shared `_prodChildOrder(a, b)`,
used by both `_prodChildrenOf` and `_prodBatchRows`, so the two views agree.
Other `_prodBatchRows` callers checked: the keyboard-selectable-order list
now matches what the batch view displays (was arbitrary fetch order, an
improvement), and the batch view's asset-prefetch picks the numerically-first
row instead of an arbitrary one (harmless). Verified by
`test/prod-batch-detail-order.js` (synthetic 16-video/16-thumbnail batch in
shuffled fetch order; red on `origin/main`, green after).

## 2026-09-21 — Production: batch view opens a batch's real parent card, and draws batch rows like sub-issues

Browser-only change, no live write. Owner report: opening a batch parent
from the Workload calendar landed on the plain batch view
(`?prod=1&batch=<id>`, a status chip and "Deliverables N"), while the parent
card's own detail view (`?prod=1&d=<identifier>`, "Sub-issues N" with client
chip, link, due date, assignee) is the correct page. A batch imported from
Linear has a real parent deliverable row (`isHierarchyParent` true, not the
read-only synthetic node a batch mints for its own children); a native
post-cutoff batch does not.

Added `_prodBatchParentIssue(batch)`: reads `linear_parent_ids` (keyed by
team, same vocabulary `_calNativeBatchParentTeams` reads), resolves each
named id through `_prodIssue()`, keeps only real hierarchy parents, and
answers with the row only when exactly one resolves — two team parents, or
none, means no single card and the caller stays on the batch view. Consulted
before the batch view is entered from two places: `_prodOpenBatch` (click)
and the authoritative wanted-id branch of `_prodApplyDeepLinkFallback` (the
boot read, once live data lands — also corrects the URL from `?batch=` to
`?d=<identifier>` via `_prodSetQuery(..., false)`, a replace rather than a
push since nobody navigated to the redirect). `_prodPrimeFromUrl` (the
`?batch=` URL prime, run before any data is loaded) deliberately does NOT
attempt the redirect itself — see the 2026-09-21 correction entry below. The
three Workload deep links that send a native batch to the batch view on
purpose (`wlParentUrl`, the client-groups `syncUrl`, the popover
`parentSyncUrl`) are untouched — this is the one place every other deep link
into a batch benefits from the redirect.

`_prodBatchDetail` now renders its deliverables list with
`_prodSubIssueRowHTML` (the parent view's own row: client chip, due date,
assignee, file pill) instead of a second, plainer `prod-subrow` markup string
— one client's 32-deliverable batch was the case checked, and its batch view
and its parent's sub-issue section now render byte-identical rows for the
same deliverable.

Verified by `test/prod-batch-parent-route.js` (one real parent resolves →
routes to detail; two team parents or none → batch view stays; a synthetic
batch-mint node never counts even when it resolves; source assertions that
all three call sites consult the helper and that `_prodBatchDetail` calls
`_prodSubIssueRowHTML`; red on `origin/main`, green after), plus
`test/prod-batch-detail-order.js`, `test/prod-batch-parent-panels.js`, and
`docs/syncview-design/tests/prod-write-gateway-browser.js` (all still green).

## 2026-09-21 — Correction: batch-parent redirect dropped from `_prodPrimeFromUrl` (Codex, PR #1471)

The first version of the change above also resolved `_prodBatchParentIssue`
inside `_prodPrimeFromUrl`'s `batch` branch, so a warm in-memory adapter
(from earlier the same session) could redirect to the parent's detail on the
very first paint, before any network read. Codex caught the bug this
introduced: `_prodPrimeFromUrl` runs before `_prodState.deepLink` is
recorded (`{ kind: 'batch', id: <the batch id> }`), so setting `openId` to
the PARENT's id there made `_prodApplyDeepLinkFallback`'s `openedElsewhere`
guard — `_prodState.openId && !sameAsWanted(_prodState.openId)` — read as
true (the parent's id is never the same as `wanted.id`, the batch id). That
skipped the whole authoritative branch, including the `_prodSetQuery` call
that corrects the URL, leaving `?batch=` in the address bar while a `?d=`
detail was already showing; a batch whose cached parent no longer resolved
live also risked the settling-eviction clearing the pane with no missing
notice. Removed the early attempt; only `_prodApplyDeepLinkFallback`'s
authoritative pass performs the redirect now, so the batch view is the
honest first paint and the one code path that redirects is also the one
that corrects the URL. `test/prod-batch-parent-route.js` updated to assert
the negative (`_prodPrimeFromUrl` does not call `_prodBatchParentIssue`) in
place of the removed assertion.

## 2026-09-21 — B1-1: the orphan Samples Linear re-assert cluster removed

First deletion of roadmap phase B1
(`docs/plans/2026-09-21-post-modularization-roadmap.md`), taken from the A2
inventory's suggested PR order, item 1
(`docs/audits/2026-09-21-base-audit/A2-dead-code-inventory.md`).

Removed from `src/index/290-samples-writes-review.js.part`:
`_sxrLinearReassertAt`, `SXR_LINEAR_REASSERT_MS` and
`_sxrReassertLinearStatus` — fifteen lines, the whole cluster.

Proof of deadness, re-measured on `b08377ca` before the edit rather than
taken from the audit: the three symbols had exactly five references in the
assembled page (74814, 74815, 74816, 74824, 74825) and all five were the
cluster's own declarations and internals. No executable caller existed
anywhere in `index.html`, and no timer, event handler, `window` export or
string reference reached it. After the deletion the assembled page contains
zero references to any of the three.

The Calendar twin `_calReassertLinearStatus` is NOT touched: it is live and
called. A2's suggested order says so explicitly and the two are easy to
confuse by name.

Page bytes 5,776,430 → 5,775,541 (−889). New assembled sha256
`a0c2a6064cf9b52e548860a0bb6802d840004ebeb71c6f14d42067abe5091850`.

Gates: `npm run check:index`, `node test/run-all.js`,
`node docs/syncview-design/tests/prod-write-gateway-browser.js`,
`node scripts/repo-identity-exposure-check.js --diff="origin/main"`.

## 2026-09-21 — Workload's native read now checks a deliverable's own Linear archive state, not only its batch's (OPEN_REPAIRS 229, browser only)

`wlFetchNativeSnapshot` (`src/index/070-workload-source.js.part`) walked the
real board load path, not the `window.wlNativeDiff` diagnostic: it POSTs
`action: 'native_snapshot'` to `workload-plan` and calls
`workload_native_snapshot_v1()`, which excludes a row only when its BATCH is
archived (`workload_issues_native_v1.active`). It carries no per-issue Linear
archive/delete state at all, so a deliverable whose own Linear issue was
archived -- while its batch stayed active -- reached the board as live work
under any open status, exactly the same class of row `_prodDeliverableLive`
already refuses on Production
(`src/index/210-production-state-writes.js.part`).

Measured on the live database, excluding the test client: deliverables
carrying `raw_issue_archived_at` (`production_deliverables_browser_v1`) with
an open status: 71 backlog, 32 in_progress, 24 todo, 4 posted -- matching the
figures the fix was measured against. Fetching the fuller `_prodDeliverableLive`
marker set (also `raw_webhook_delete`, `raw_deleted`, `raw_delete`,
`raw_removed`, `raw_archived`) finds 4 more `todo` rows; all 4 already carry
an archived batch and were already invisible on the board through the
existing (unrelated) batch-`active` gate, both before and after this change --
recorded rather than silently reconciled. Cross-checking
`workload_issues_native_v1.active` for the full 71/32/24/4 set found that all
but the 4 `posted` rows (already parked off the active board by
`wlIsActiveStatus`, since `posted` is workflow type `completed`) already had
an archived batch as of 2026-09-21, from OPEN_REPAIRS 224's manual Storage
cleanup the day before -- so most of the measured class was already
incidentally hidden, and the fix's directly-verified live effect is the class
item 224 called a "phantom" row: an active-batch, archived-issue deliverable
under an open status that nobody has archived by hand.

Fix: `wlFetchNativeSnapshot` now runs a second, independent browser-side read
of `production_deliverables_browser_v1` (already `select`-granted to
`anon`/`authenticated`; no new SQL, no Edge Function change) for the native
sub-issue ids the snapshot returned, and calls `_prodDeliverableLive` directly
to decide which are archived -- a literal shared function call, not a second
copy of the rule, since `src/index/040-...` through `340-...` are one
top-level `<script>` and `_prodDeliverableLive` is hoisted across the file
split. Archived rows are dropped before `wlApplyData` buckets anything, so
they are excluded from the board entirely rather than folded into the "no
assignee and no work day or deadline" footer count. A failed archive-marker
read fails open (leaves rows unfiltered) rather than blanking the board.

Verified: `npm run build:index`, `npm run check:index`, `node test/run-all.js`,
`node docs/syncview-design/tests/prod-write-gateway-browser.js`,
`node docs/syncview-design/tests/prod-boot-budget.js`, and the new
`test/workload-archived-hidden.js` (archived row excluded; live row kept; a
post-2026-09-20-cutoff native row with no archive state at all is unaffected;
a failed marker read fails open). `test/workload-native-membership.js` updated
so its isolated fixture (no anon key configured) takes the same fail-open
path with no new network call, keeping its existing `calls.length` assertions
true.

## 2026-09-21 — B1-2 removed the orphan legacy Submit sender chain

Browser-only dead-code deletion; no live write, deployment, flag, backend, or
workflow change. Removed the unreachable legacy Submit webhook sender and its
private receipt/confirmation helpers from `200-intake-data-startup.js.part`,
then removed its two endpoint constants and timeout from
`060-templates-filming.js.part`. The active native intake hold, raw legacy
receipt detection, draft identity/conflict checks, and visible recovery path
remain. Pre-deletion assembled-page proof found no executable caller outside
the chain; post-build proof found zero target-symbol references. The assembled
page shrank from 5,781,350 to 5,750,579 bytes (−30,771), with the new assembled
sha256 `ed3407bc0c5fdd7d405032aaaa31160dd05ba4c98b2538c1e034017f5baf0155`.

Those two figures are the committed artifacts, verified with `git cat-file -s`,
and they are NOT the ones the executor session measured. It worked from a base
that predated the B1-1 deletion and the Workload archive fix, so it recorded
5,776,430 → 5,745,660 against a page that no longer existed by the time the
change was published. The supervisor applied its patch onto current main and
re-measured. The delta is identical either way, which is what made the stale
absolutes easy to miss; the Codex review on #1487 caught them. Anyone auditing
a byte count later needs the absolutes to match a real commit, so record the
numbers from the committed artifact rather than from the working base.
The first full-suite run exposed stale Linear-dead harness coverage for the two
removed webhook routes; the harness regex and its contract test were narrowed
to the one remaining non-prefixed Linear-backed route before publication.

## 2026-09-22 — Workload cold load: the native snapshot read gets its own 30 s budget (OPEN_REPAIRS 230, browser only)

The owner reported an empty Workload calendar under the "Saved work days are
unavailable" banners at about 00:10Z; the console read `Workload fetch failed:
AbortError`. Every server answer in the window was 200 in 3 to 4 s with a
2,013,991-byte body; the browser's own 8 s `WL_PLAN_READ_TIMEOUT_MS` cancelled
each one before the body finished. Edge Function execution had peaked at
8,195 ms earlier the same day, so the budget could not have held even on a fast
line. Fix: `WL_SNAPSHOT_READ_TIMEOUT_MS = 30000`, read only by the snapshot
fetch in `wlFetchNativeSnapshot`; the other three reads keep 8 s. Fixture
contexts in `test/workload-native-membership.js` and
`qa/workload-consistency/source-harness.js` gained the new constant, and
`test/workload-plan-source.js` gained a guard that the snapshot fetch never
falls back onto the 8 s budget. Proven in headless Chromium against a
production-scale snapshot held for 9 s: pre-fix page aborts with the owner's
exact console line, fixed page paints 8,151 rows. The reproduction also showed
item 229's 44 parallel archive-marker reads being cancelled on the same 8 s
budget (fail-open held, rows left unfiltered); that is the next PR, recorded
under item 230's open list. `index.html` 5,750,579 → 5,751,934 bytes, from the
committed artifact. `docs/truth/README.md` freshness date refreshed in the
same commit: truth-sync's 30-day rule rolled over at midnight, with the whole
truth suite re-verified green on main `bb5266cb` in this session.

## 2026-09-21 — Removed Workload's external Linear navigation

Removed the two reachable "Open in Linear" anchor branches from the loose-issue
strip while preserving its grouping, local SyncLinear navigation, and
`wlSyncLinearUrl` path. This is an intentional UI behavior change now that
outbound Linear sync is off and the key is being revoked; it made no live write,
deployment, flag, backend, or workflow change.

The six style rules for the two removed controls (`.wl-loose-open-linear`,
`.workload-chip-linear` and their `svg` / `:hover` variants in
`010-styles-foundation.css.part`) went with them in a second commit on the same
PR: the executor's "0 assembled hits" counted the anchors, not their styling.

## 2026-09-22 — Workload archive markers use one filtered read (OPEN_REPAIRS 230, open item 1)

Browser-only read-path repair; no live write, deployment, flag, backend, or
workflow change. `_wlFetchArchiveMarkerRows` now replaces the per-snapshot
`id=in.(...)` burst with one server-filtered, id-ordered marker read from the
same public view. `_wlArchivedNativeIds` still delegates marker judgment to
`_prodDeliverableLive`, then intersects the answer with the native sub-issue ids
in the current snapshot. The existing 8-second abort and fail-open catch remain:
a failed marker read leaves the board unfiltered. For a 5,254-id snapshot and
the measured marker answer of 278 rows, the path makes one view request instead
of 44.

The executor's paging carried `limit=1000` in the URL as well as a `Range`
header per page. Measured live against the view before publication: page one
(`Range: 0-999`) is fine, but page two (`Range: 1000-1999` with the same
`limit`) answers `PGRST103 "Requested range not satisfiable"`, which this
function turns into a throw and the caller turns into an unfiltered board. So
the follow-up page could never have worked -- latent today only because the
whole marker set is 278 rows, well under one page. The `limit` parameter is
dropped and `Range` alone drives the paging: measured, `Range: 0-999` returns
all 278 rows with `content-range: 0-277/*`, and a page past the end answers
`200 []` rather than an error, so the loop terminates cleanly either way.

A follow-up on the same PR: the first draft of the cap's comment cited the
review as a bare four-digit PR reference with a leading hash, and
`test/no-hardcoded-colors.js` read it as a hex colour and failed the suite.
Its allowlist skips a line only when the line's TRIMMED text opens with a
comment marker, and this file's block comments do not prefix their
continuation lines, so prose inside a multi-line comment is scanned as if it
were code. Every other such reference in the fragments sits on a `//` line,
which is why none of them trip it. PR numbers in these continuation lines are
written without the hash.

## 2026-09-22 — Removed Calendar and Samples external Linear navigation

Removed the reachable external Linear anchors and marks from the Calendar and
Samples linked slots while retaining native Production navigation, link editing,
and existing-link clearing. Removed the now-dead linked-anchor and overlay CSS
from `020-styles-surfaces.css.part`; `010-styles-foundation.css.part` contained
no matching rule. This is an intentional UI behavior change because outbound
Linear sync is off and the key is being revoked. No live write, deployment,
flag, backend, or workflow changed.

Supervisor follow-up on the same PR: with the Linear anchors gone, the
`is-linked` class survived only on the two SyncView Production anchors, where
it now matched no rule at all (the executor removed
`.cal-linear-btn.is-linked` and `.cal-linear-btn-graphic.is-linked:not(.cal-prod-btn)`
with the anchors). Their appearance never depended on it -- 
`.cal-linear-btn.cal-prod-btn` sets the raised background and the ring, and the
per-component `.cal-linear-btn-video/-graphic.cal-prod-btn` rules set the
colour, all at equal specificity and later in the stylesheet -- so the class
was dead weight whose only historical meaning was "this is a Linear link".
Left in place it would be a trap for the next `.is-linked` rule, which is
precisely the collision the deleted `:not(.cal-prod-btn)` guard existed to
prevent, so the class is removed from both anchors. Nothing reads it: no CSS
rule, no JS selector, no test.

Second supervisor follow-up, from the Codex review: removing the anchors also
removed the only thing that gave a LINKED slot its component colour. The edit
and clear controls carry `cal-linear-btn-video`/`-graphic`, but those classes
are styled only in combination with `.cal-prod-btn`, so the video control and
the thumbnail control directly below it rendered as identical grey squares,
told apart only by a `title` tooltip a touch device never shows -- on controls
that REMOVE a link. That is the 2026-09-15 "both of them look the same" report
one surface over. A `cal-linear-btn-linked` class restores pink for Video and
blue for Thumbnail on both Calendar and Samples, deliberately NOT reusing the
retired `is-linked` name (which also rode the Production anchors and needed a
`:not(.cal-prod-btn)` guard for exactly that reason). The empty slot keeps its
neutral/warn styling, unchanged, because that is the "needs linking" cue.
`test/cal-comp-dot-matches-slot-colors.js` now pins the colours, that the two
halves differ, that all four linked controls emit the class, and that the empty
slot does not.

## 2026-09-22 — Kasper video tweak comments were self-conflicting out of the Calendar row (mirror bug)

**Symptom, measured 2026-09-22 14:05Z.** Kasper's "Request change" on a video
component committed the native comment (visible immediately on both the
Production/SyncLinear card detail and the Calendar Notes panel -- both read
native comments, never `calendar_posts.<comp>_tweaks`) but the follow-up
Calendar-row save failed, threw "Card sync incomplete", and the text never
landed in `calendar_posts.video_tweaks`. Of Kasper's 9 tweaks in a 90-minute
window, all 8 video ones were affected; the 1 graphic one was not.

**Root cause.** `migrations/2026-09-18-native-calendar-status-bridge.sql`
(OPEN_REPAIRS 212) projects a native deliverable's status straight into
`calendar_posts.<comp>_status` + `updated_at` the instant it commits, out of
band, and by its own documented design never recomputes the card's overall
`status` roll-up column ("Not done here... worth a decision, not a silent
addition"). `_kasperRequestTweakComp` pushes exactly that kind of native status
change and then, in the same action, calls `calendar-upsert` with the comment
plus the freshly recomputed overall `status`. The bridge's write already moved
`updated_at` past the browser's `_baseAt`, and `status` sits in calendar-upsert's
`SCALAR_FIELDS` conflict list while the server's copy of `status` is now stale
-- so calendar-upsert answers `HTTP 200 {ok:false, conflict:true}` ("someone
else updated this card (status)..."), a self-inflicted conflict, not a real
concurrent edit. `_kasperPersistPostWrite` threw after the native comment had
already committed, which is exactly the branch that raises the "Card sync
incomplete" dialog.

Both video and graphic route through the identical bridge/conflict mechanism;
the asymmetry is NOT a per-component code path. `wire.status` is only sent when
the overall roll-up actually MOVES relative to the browser's own last-saved
snapshot (`_patchBase`) -- a component's FIRST transition into "Tweaks Needed"
moves it (worst-of, priority 0, nothing is lower), a second/third tweak comment
on a component already sitting at "Tweaks Needed" does not, and with nothing
scalar left to compare, calendar-upsert's conflict guard has nothing to trip on
and the write goes through. All 8 video tweaks that day were fresh transitions;
the 1 graphic tweak most likely was not. Not fully verifiable without a live
read of that card's history, and said here as inference from the code, not
confirmed against production.

**Also found, not touched:** `calendar_posts.<comp>_tweaks` is not an orphaned
mirror. `supabase/functions/production-comments/feedback.mjs`'s
`readLegacyFeedback` reads it live, as the staff "Feedback & tweaks" panel's
fallback for any card whose comment history predates canonical/native coverage
-- most cards, per the F42 import's own count (615 applied / 6,032 deferred).
So the honest fix keeps writing the column, rather than deprecating it.

**Fix.** `_kasperPersistPostWrite` (`src/index/330-kasper-review-history.js.part`)
now retries the `calendar-upsert` call exactly once when the response is this
specific conflict AND this same call already committed a native status change
(`gatewayCommitted`) -- reading a fresh `updated_at` first via the new
`_calReadFreshCardStamp` helper (`src/index/120-calendar-flags-write-repair.js.part`)
so the retry is no longer stale.

State the guarantee at its real timing boundary rather than more broadly, so
later repair work is not misled (Codex P2 on this PR corrected an earlier draft
of this entry). Adopting the fresh stamp deliberately disarms the scalar guard
for that one write, so only an edit landing BETWEEN the fresh read and the
retry still conflicts and falls through; a third party's scalar edit that
landed just BEFORE the read is absorbed into the new baseline and overwritten.
That clobber is accepted -- it needs a second editor inside the same ~1s
window, against a conflict that used to lose the comment outright every time it
fired.

Comments are explicitly NOT part of that accepted trade (Codex P1 on this PR).
One `comments_base_at` field drives both the scalar guard and calendar-upsert's
per-cell comment merge, and that merge keeps an existing comment missing from
the incoming list only while the comment is newer than the baseline -- so
advancing the baseline would have re-read another reviewer's fresh note as a
deliberate deletion and pruned it. The two baselines cannot be separated from
the browser, so `_calReadFreshCardStamp` now also returns `video_tweaks`,
`graphic_tweaks` and `caption_tweaks`, and the retry unions every comment the
server currently holds into its own payload via `_calUnionCommentCell`: an id
present in the incoming list is never pruned, and ours still wins on a shared
id because the server keeps the newer stamp.

The "Card sync incomplete" dialog's wording no longer promises an automatic
retry that was never implemented. It now reports which path was taken -- the
retry runs only when the freshness read returns a genuinely newer stamp, and a
failed read or an equal stamp is a supported path that throws the original
conflict with no second attempt -- so it never claims a retry that did not
occur. No Edge Function, migration, or live data changed.

**Proof.** `test/kasper-tweak-calendar-sync-retry.js` (new), extracting the real
`_kasperPersistPostWrite` from the built `index.html` and covering both video
and graphic: the self-conflict retries once and keeps the comment on the
retried write, a conflict with no native precommit does not retry, and a
genuinely repeated conflict still surfaces after the one retry.
`test/write-ui-writer-durability.js`'s pinned status-before-save ordering for
`_kasperPersistPostWrite` still holds.

**Not done here, flagged for a decision.** Backfilling the 8 already-missing
video comments needs the owner's go-ahead (see the ledger entry) -- the text is
recoverable from the native/canonical comment store (already committed there)
and from each browser's local outbox/journal, matched by author + created_at
per the id-namespace mismatch already on file (`pc_<uuid>` vs `c_<id>`), never
by id.

## 2026-09-22 — Native cards added to a pre-cutoff batch never attached to their parent

Reported by an SMM: 4 videos plus 4 thumbnails added to an existing post did
not show up in its sub-issue list. Root cause was a gap between two shapes
`_prodResolveBatchParentNodes` (`src/index/210-production-state-writes.js.part`)
already handled correctly on their own: a fully Linear-backed batch (every
child resolves through its own `raw_issue_parent_id`) and a fully native-born
batch (no Linear parent at all, so one synthetic parent node is minted). A
batch that is BOTH -- born on Linear, then added to natively after the
outbound cutoff -- already has a Linear-backed node, so the native-minting
branch correctly refuses to mint it a second one (ONE PARENT PER CARD, owner
ruling 2026-08-18). But the fallback meant to point a parentless native-born
child at that existing node only ever looked at nodes it had just minted
itself, which is empty for a batch the Linear-backed pass already claimed --
so every native-born child of a mixed batch fell out as a bare top-level
card. Measured live against one reported batch (project
uzltbbrjidmjwwfakwve): 8 pre-cutoff children resolved fine, 10 post-cutoff
native-born ones did not. Estate-wide: 4 mixed batches, 22 orphaned cards, 4
clients, growing whenever staff add to a pre-cutoff batch.

Fixed by building the fallback from every node the function has by that
point -- Linear-backed or synthetic -- keyed by `batch_id`, instead of only
the nodes the native-mint loop had just minted. The two invariants that made
the native branch safe are unchanged: a row with a real Linear identity that
simply has no recorded parent still stays a root, and an unresolved parent
edge (missing, duplicated, self-referential, cyclic) still fails closed. No
data was touched -- `batch_id` was already correct on every orphaned row, so
the fix alone re-attaches all 22 on the next read. A new regression case
(`docs/syncview-design/tests/prod-structure-subset.js`) covers a batch with
one Linear-born and one native-born child landing under one node; the
existing `same-batch-root` case, and everything else in the suite, still
passes.

Second, unrelated finding on the same surface, reported and closed with no
code change: renaming a card in the Calendar dialog does not reach the
deliverable's title. The rename writes only the calendar post's own `name`
column; the deliverable's Linear-composed title is written once at creation
from that same field and afterward only by `linear-inbound` echoing a change
made directly in Linear. No write path on any surface pushes a Calendar
rename into an existing deliverable's title -- confirmed by reading
`production-write`'s action set (no title-update operation exists) and by
reproducing the exact reported divergence live. This is an architectural gap
in the current write surface, not a regression; closing it is a scoped
feature (a production-write title operation plus a Linear outbound push),
so nothing was changed for it. Full writeup: `docs/ops/LINEAR_EXIT_JOURNAL.md`,
2026-09-22.

## 2026-09-19 — F27 Section 4 deploy, run `35424627891`: production-write 78 → 79 (recorded retroactively 2026-09-23)

Dispatched from `0b2f16ae6863482caf410b5137d5f77af65d2ad4`. This deploy was never
written into this log when it ran; it is recorded here from the run's own job
summary, which the owner copied from the Actions page on 2026-09-23 (ledger 241).
The prior sealed bundle it was dispatched against:
rollback_bundle_sha256 = `83e03566aaa5cc73683b1a0575e08885aa240f39e6acf742e8ddd71d892e6fac`,
rollback_bundle_byte_length = `662320`. Prior live `production-write` was v78
(closure `9dd41919d1690b6035146fad49504aa8d08fbc990efa62ac55ddd66abf5994aa`).

| function | active version | source closure SHA-256 | JWT |
|---|---|---|---|
| `batch-write` | 39 | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | verify_jwt=false |
| `deliverable-write` | 39 | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | verify_jwt=false |
| `linear-outbound` | 52 | `f59b6206e3ccabb7b2fe1972d8abddac5d2622f5948f759b66381dc71ec1cf9d` | verify_jwt=false |
| `production-write` | 79 | `9630884e62bb80934444800995a39f40cc70f37b3bff42bd2a09551d159ef1e4` | verify_jwt=false |

```json
{
  "schema": "syncview_f27_section4_deployed_versions_v1",
  "deploy_commit": "0b2f16ae6863482caf410b5137d5f77af65d2ad4",
  "github_run_id": "35424627891",
  "functions": [
    {
      "slug": "batch-write",
      "active_version": "39",
      "source_closure_sha256": "86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a",
      "entrypoint_sha256": "15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5",
      "provider_bundle_sha256": "ccc36ce94f39efbb8db84a554eeaef6b5ce013547be5d2349ee8adbdddc2fda5",
      "verify_jwt": false
    },
    {
      "slug": "deliverable-write",
      "active_version": "39",
      "source_closure_sha256": "78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575",
      "entrypoint_sha256": "74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68",
      "provider_bundle_sha256": "3868706acd8e86632c960a6d08cc8ed94e3e8787237a530b135c6e5a05a1f3dd",
      "verify_jwt": false
    },
    {
      "slug": "linear-outbound",
      "active_version": "52",
      "source_closure_sha256": "f59b6206e3ccabb7b2fe1972d8abddac5d2622f5948f759b66381dc71ec1cf9d",
      "entrypoint_sha256": "606628504ec4614a22e9d16c7671dc5d9ef73bfc57b69ecaa08065a5d14f3684",
      "provider_bundle_sha256": "3ffd5097baa1d9e75e86cd649e71385ec7503ef429a278b575f0838fdc4e6ba9",
      "verify_jwt": false
    },
    {
      "slug": "production-write",
      "active_version": "79",
      "source_closure_sha256": "9630884e62bb80934444800995a39f40cc70f37b3bff42bd2a09551d159ef1e4",
      "entrypoint_sha256": "7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5",
      "provider_bundle_sha256": "8e86d5eb34553ac61eb0cf8b4cedf09243373015173cdae0c5e94ebf10c1543a",
      "verify_jwt": false
    }
  ]
}
```

## 2026-09-23 — F27 Section 4 deploy, run `35800967363`: production-write 79 → 82 (WR-101 refusal receipts, PR #1499)

Dispatched from `344006c511dcd03d668ee8bafec11e6f7c9218d6`.

Released in four steps, in order.

1. **SQL owner.** `20260913044451_write_refusal_diagnostics_preparation.sql` was
   found ALREADY applied on the live project before this release: the
   `write_refusal_diagnostics` schema, `receipts_v1` and the three
   `production_write_refusal_*_v1` functions existed. Their bodies were compared
   by md5 of `prosrc` against the committed file and matched exactly for all
   three; `SECURITY DEFINER` and `search_path=pg_catalog, public` match; EXECUTE
   is held only by `postgres` and `service_role`; the table's ACL is `postgres`
   only, RLS is on, and it held 0 rows. No SQL was re-run. When it was applied
   is not recorded in `supabase_migrations` (only two rows exist there).
2. **`write-diagnostics`** deployed deliberate-manual from main `344006c511dcd03d668ee8bafec11e6f7c9218d6`
   (4 files: the function plus `_shared/staff-role-auth.ts`,
   `_shared/write-refusal-diagnostics.mjs`, `_shared/write-refusal-codes.mjs`),
   `verify_jwt=false`, version 1. Readback of all four files matched the
   committed source. It answered `503 dormant` before step 3.
3. **Enabled** by the owner: `WRITE_DIAGNOSTICS_ENABLED=true` and a private
   `WRITE_DIAGNOSTICS_RUNNER_KEY` (value not recorded anywhere in the repo).
   Verified from outside: an unauthenticated `health` now answers `401`
   instead of `503 dormant`.
4. **Section 4 lane**, run `35800967363`, from `344006c511dcd03d668ee8bafec11e6f7c9218d6`,
   rollback bundle `3e58e8e0e0f222f4efdd8ea3af10b974e0a76b9f0b660952da7e55f3ae8a5cb2` (662946 bytes). Green.

| function | active version | source closure SHA-256 | JWT |
|---|---|---|---|
| `batch-write` | 41 | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | verify_jwt=false |
| `deliverable-write` | 41 | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | verify_jwt=false |
| `linear-outbound` | 54 | `f59b6206e3ccabb7b2fe1972d8abddac5d2622f5948f759b66381dc71ec1cf9d` | verify_jwt=false |
| `production-write` | 82 | `af8bf801b45830f95951d00636ce1103fb1b043652337b2c1bae68a37fd17422` | verify_jwt=false |

rollback_bundle_sha256 = `3e58e8e0e0f222f4efdd8ea3af10b974e0a76b9f0b660952da7e55f3ae8a5cb2`,
rollback_bundle_byte_length = `662946`.

```json
{
  "schema": "syncview_f27_section4_deployed_versions_v1",
  "deploy_commit": "344006c511dcd03d668ee8bafec11e6f7c9218d6",
  "github_run_id": "35800967363",
  "functions": [
    {
      "slug": "batch-write",
      "active_version": "41",
      "source_closure_sha256": "86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a",
      "entrypoint_sha256": "15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5",
      "provider_bundle_sha256": "ccc36ce94f39efbb8db84a554eeaef6b5ce013547be5d2349ee8adbdddc2fda5",
      "verify_jwt": false
    },
    {
      "slug": "deliverable-write",
      "active_version": "41",
      "source_closure_sha256": "78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575",
      "entrypoint_sha256": "74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68",
      "provider_bundle_sha256": "3868706acd8e86632c960a6d08cc8ed94e3e8787237a530b135c6e5a05a1f3dd",
      "verify_jwt": false
    },
    {
      "slug": "linear-outbound",
      "active_version": "54",
      "source_closure_sha256": "f59b6206e3ccabb7b2fe1972d8abddac5d2622f5948f759b66381dc71ec1cf9d",
      "entrypoint_sha256": "606628504ec4614a22e9d16c7671dc5d9ef73bfc57b69ecaa08065a5d14f3684",
      "provider_bundle_sha256": "3ffd5097baa1d9e75e86cd649e71385ec7503ef429a278b575f0838fdc4e6ba9",
      "verify_jwt": false
    },
    {
      "slug": "production-write",
      "active_version": "82",
      "source_closure_sha256": "af8bf801b45830f95951d00636ce1103fb1b043652337b2c1bae68a37fd17422",
      "entrypoint_sha256": "7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5",
      "provider_bundle_sha256": "e14418caf7ea2f425d209193e7848d7e907f2f3f6c29b62ef1608c1d6244b907",
      "verify_jwt": false
    }
  ]
}
```

**Live acceptance, one probe.** An unauthenticated `production-write` POST with no
request id was refused exactly as before (`400 valid_request_id_required`, body
unchanged) and carried `x-write-diagnostic-status: recorded`. One receipt landed:
origin `gateway`, surface `calendar`, operation `comment`, that code, status 400,
principal `unverified`, identifiers holding only a hashed `id`. That row is the
probe, not a user refusal. Not yet proven live: a browser-claim receipt from a
real page, and the runner-key `health` / `lookup` actions.

## 2026-09-23 — Dawn check: a weekday morning walk of the seven flows that matter most

New skill `/dawn-check` + `qa/dawn/dawn-check.js` + `.github/workflows/dawn-check.yml`
(Mon–Fri 11:30 UTC). Test client only; three disposable seeds archived and verified;
the rename target (a card whose sub-issue has no Linear mirror) renamed and put back.
Nine validation runs on the branch; the last one passed every check that could run,
with everything put back each time (a too-strict restore check in run 1 was corrected;
the live state was verified clean by hand).

Findings from building it, value-free:
- A seeded card cannot take a client VIDEO approval: refused `native_link_required`
  (by design since the video flip), so the client flows act on the caption.
- The repo's staff key is refused by `workload-plan` (401): Workload cannot be timed
  in CI without a staff ROLE key. Reported ⚠️ "not measured" until `SYNCVIEW_ROLE_KEY`
  is set.
- First measurements, one run each, fresh context: SyncLinear first rows ~1.4 s and
  Analytics first numbers ~1.2 s, both well under the speed map's cold medians
  (4.4 s / 5.9 s).


## 2026-09-24 — F27 Section 4 deploy, run `36023623936`: production-write 82 → 88, deliverable-write 41 → 45, batch-write 41 → 45 (B2 Slice 8 narrow lane)

Dispatched from `049d3e6882902ab13f75a4a2fc5e05879974ed42`, operation
`deploy-reviewed-release`, confirmation `DEPLOY_REVIEWED_F27_SECTION4_CLOSURES`.
Green; the forward path deployed three functions (`production-write`,
`deliverable-write`, `batch-write`), the restore step was skipped. `linear-outbound`
was not deployed by this run.

The prior sealed bundle it was dispatched against:
rollback_bundle_sha256 = `70129953cc18ba80883cb3d5ad86ade555a365e1e4dbe7f7a840205fd4b65aa3`,
rollback_bundle_byte_length = `682023`. **That bundle is the FOUR-function prior set**
(captured before this PR narrowed the lane; the run's steps are "Fetch and
independently verify the sealed prior-four source" and "Inspect the exact sealed
prior-four rollback set"). After PR #1562 merges the lane only restores three, so
this bundle can no longer be restored by the lane; the next capture is three
functions.

File counts from the run's env: `production-write` 9, `deliverable-write` 2,
`batch-write` 2. Supabase CLI 2.109.0.

Sources: deploy commit, source closures, entrypoint hashes, file counts and the
bundle values are read from the job log (job `107714440486`). The job-summary
table itself was not readable through the API, so the active versions and the
provider bundle hashes below were read back read-only from the Supabase function
list on 2026-09-24 (`version` and `ezbr_sha256`; `updated_at` for all three falls
inside the run's deploy steps, 15:55:28–15:55:55Z). Earlier entries' provider
bundle hashes equal the Supabase `ezbr_sha256` for the same version.

| function | active version | source closure SHA-256 | JWT |
|---|---|---|---|
| `batch-write` | 41 → 45 | `86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a` | verify_jwt=false |
| `deliverable-write` | 41 → 45 | `78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575` | verify_jwt=false |
| `production-write` | 82 → 88 | `eda3cf74353aaab14b7773db86f98773d85e3dae4d855dccfc847cbe9c750a79` | verify_jwt=false |

```json
{
  "schema": "syncview_f27_section4_deployed_versions_v1",
  "deploy_commit": "049d3e6882902ab13f75a4a2fc5e05879974ed42",
  "github_run_id": "36023623936",
  "functions": [
    {
      "slug": "batch-write",
      "active_version": "45",
      "source_closure_sha256": "86f9f187b39e187512886c0d33f4702ce3a766ee0cb4b0777d665917b3d83d6a",
      "entrypoint_sha256": "15a369f856a363f5c2926b3f251b1e154da805d5489d31432d07bfde145e8cf5",
      "provider_bundle_sha256": "46dcbfd8adf52bb8df7dcbd3dcbeab0c0524e2c0ba751578503ce0d7472b0bd3",
      "verify_jwt": false
    },
    {
      "slug": "deliverable-write",
      "active_version": "45",
      "source_closure_sha256": "78df060b7dd5b611e77b5427d7ab9a6cab1d0a18664f2e15562e098880074575",
      "entrypoint_sha256": "74da8449a9f753a09cdf00326449df31664d18449c866b81923725aa6bad1e68",
      "provider_bundle_sha256": "2e869b9fa7df13953823b0bbfad4fa186b0a51c987ca22122c492c873a4ba3c6",
      "verify_jwt": false
    },
    {
      "slug": "production-write",
      "active_version": "88",
      "source_closure_sha256": "eda3cf74353aaab14b7773db86f98773d85e3dae4d855dccfc847cbe9c750a79",
      "entrypoint_sha256": "7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5",
      "provider_bundle_sha256": "54c516cdd70c8cd420b9bdffd70fac535c08b4e4a7a56393440f022f539ba8b3",
      "verify_jwt": false
    }
  ]
}
```

**After the run (owner, 2026-09-24):** `linear-outbound` was deleted and three
Supabase secrets were removed. Supabase bumped every function's version by 3 with
no code change, so the provider list now reads `production-write` v91,
`deliverable-write` v48, `batch-write` v48, with `ezbr_sha256` and `updated_at`
unchanged from this deploy (same source). The versions above (v88/v45/v45) are
this run's own result. `linear-outbound` is confirmed absent live.

## 2026-09-24 — Receipt recorded after the fact: workload snapshot cache migration and `workload-plan` `native_snapshot_v2` live (B2 Slice 9 evidence)

Nobody logged these two installs at the time they happened. This entry records what a read-only check on 2026-09-24 found live. It is not a first-hand log of the apply or the deploy.

- **Migration** `migrations/2026-09-23-workload-native-snapshot-cache.sql` (PR #1511, plus #1520): `supabase_migrations.schema_migrations` records it as version `20260923164647`, name `workload_native_snapshot_cache`, so it was applied 2026-09-23 16:46:47Z. The objects it creates exist live: the `workload_snapshot_cache` table, `workload_native_snapshot_cached_v1`, `workload_native_snapshot_slim_v1` and `workload_native_snapshot_warm_v1`. The live `pg_get_functiondef` of `workload_native_snapshot_slim_v1` matches the repo migration line for line. The older `workload_native_snapshot_v1` is still present.
- **Edge Function** `workload-plan`: the provider list shows it last updated 2026-09-24 02:29:44Z, with `ezbr_sha256` `aac6a2ba829274939b3cce38912d45c164927ba6f991691c1270fd3261fbdeb3`. It read v26 after that deploy and reads v29 now, because of the three secret deletions recorded above (no code change). The repo source (latest change #1542) serves the `native_snapshot_v2` action. The deploy's run id and source-closure readback were not recorded, and this check did not take them.
- **Cached snapshot body on 2026-09-24:** 6,770 rows, all native. 7,286,083 bytes.

## 2026-09-24 — Browser refusal reason codes live: `receipts_v1_code_check` widened and `write-diagnostics` deployed (PR #1570, OPEN_REPAIRS 247)

- **Migration** `migrations/2026-09-24-refusal-receipt-browser-codes.sql`, applied by the session named Lighthouse. `supabase_migrations.schema_migrations` records it as version `20260924171734`, name `refusal_receipt_browser_codes`. A read-only check afterwards counted 218 codes in the live `receipts_v1_code_check`, which is exactly the gateway + browser list in `_shared/write-refusal-codes.mjs`. No grant or revoke: only the check constraint changed.
- **Edge Function** `write-diagnostics`, deployed by the owner from `3469b785622519d63a70b2e98e6d4d64a2515dc3`. Attestation PASS. The run id and version were not recorded in this session.
- **Not deployed:** `production-write` shares the changed module and picks it up the next time it is released (its re-pinned source closure is in `deploy-f27-section4-closures.yml`); nothing in this entry deployed it.

## 2026-09-24 — n8n: seven dead workflows archived (OPEN_REPAIRS 252, session Pruner)

Owner-approved cleanup after `docs/audits/2026-09-24-feature-usage.md`. Archived, not deleted, via the n8n connector around 23:00Z. Each had no call in `main`'s `index.html` and no run in n8n's kept history (~5 days).

| Workflow | ID | Was active |
|---|---|---|
| SyncView TikTok Pilot — Status Cron | `LR6R1mV4NaLNLlLG` | no |
| SyncView TikTok Pilot — Submit | `u9VtMGDArppPniYC` | yes |
| SyncView TikTok Pilot — Creator Info | `ORcudnHjQGUt17Rq` | yes |
| SyncView TikTok Pilot — Auth Callback | `jhBWizKWtirUjfEe` | yes |
| SyncView Samples — Upsert | `23jv00ihCX75TjaB` | yes |
| SyncView Samples — Reorder | `3WDxAYW23RBJTuFW` | yes |
| COMPETITOR RESEARCH | `0KMfHmYqVdlr5EhG` | yes |

- **Rule deviation:** no pre-edit JSON export was taken (ROLLBACK.md rule 2 / 4(b)). The connector cannot read archived workflows, so one can no longer be taken from here.
- **Rollback:** in n8n, Archived view, then Unarchive and re-activate the ones marked "yes". n8n keeps each workflow's version history through archive.
- **Permanent deletion is blocked** until each is unarchived, exported privately to the SyncView Backups Drive folder, and given a public-safe stub in `n8n-backups/`.

## 2026-09-24 — n8n: remaining five dead workflows archived (OPEN_REPAIRS 252, session Pruner, approved by owner via Lighthouse)

| Workflow | ID | Was active |
|---|---|---|
| SyncView TikTok Pilot — Accounts List | `76Y1a5eN6wHCW7iN` | yes |
| SyncView TikTok Pilot — List | `biL6G1HbSCtePeJs` | yes |
| SyncView TikTok Pilot — Auth Init | `8dYHvU6RaoLts4GU` | yes |
| SyncView TikTok Pilot — Token Refresh | `4quw8c3zwhJFwJWZ` | yes |
| SyncView Samples — Get | `HyrucW0X8ckJogip` | yes |

- Same deviation and rollback as the entry above: no pre-edit export; Unarchive restores; permanent deletion is blocked until exported.
- **Database, by Lighthouse:** `content_samples` anon read policy dropped. Rights revoked from public, anon and authenticated. `service_role` keeps read. The three TikTok tables were verified already locked. No table was dropped.

## 2026-09-26 — Production live updates over realtime (OPEN_REPAIRS 263)

- Production subscribes to postgres_changes on `deliverables`, `batches` and
  `deliverable_events`, and routes events, debounced 300 ms and coalesced, into
  the existing `_prodDeltaRefresh`. A batch change, a delete, an event insert or
  a row whose `updated_at` did not move (a propagated rename) forces a full read.
- Poll kept as the fallback: 90 s while SUBSCRIBED, 30 s otherwise, and one full
  catch-up after a re-subscribe. `prodRtStatus()` in the console.
- Kill switch `prod_realtime` runtime flag (default on when the row is absent)
  plus localStorage `syncview.prodRealtime` = `off`; see ROLLBACK.md. No row was
  written; no database change.
- Live WebSocket delivery was not observed in the build sandbox (proxy blocks
  WebSockets); the unit test drives the controller with a mocked channel.

## 2026-09-27 — Smart defaults for creatives (session Anchor, owner decision)

- A creative (a non-admin whose team is video or graphics) opens SyncLinear on
  My issues and Workload filtered to themselves, once per page load.
- SyncLinear: `_prodPrimeFromUrl` treats a missing `view` as `my` for a
  creative only when the address names no `view`, `d`, `batch` or `client`.
  No write path, gateway, role or authority check changed.
- Workload: the editor filter resolves to the person by id or by name once
  their rows load; picking an editor by hand cancels it.
- Offline browser test: `docs/syncview-design/tests/smart-defaults-browser.js`.

## 2026-09-29 - SyncLinear sub-issue header shows the parent's name (session Quill)

- The "Sub-issue of" header used to print the parent's internal key when a batch
  parent had no short identifier or no title. A shared rule now keeps any
  `bat_`, `del_`, `b1_b_` or bare-uuid key out of every name slot: header,
  breadcrumb, Parent issue card, topbar title, Favorites, command palette and the
  create-parent picker.
- Unknown name: a grey skeleton, then the name. The one-off name read (batches
  or deliverables, read-only) gives up after 6 s and may retry after 15 s; an
  empty answer shows "Untitled post" / "Untitled issue".
- No write path, gateway, role or authority check changed. Browser only.
- Test: `test/prod-subissue-parent-name.js`.

## 2026-10-01 - SyncLinear speed: measured on the live site, three changes, same page (session Comet, OPEN_REPAIRS 314)

- Measured first, cold and warm, on the live site as admin staff: rows on screen about 1.1 s warm and 3.0 to
  4.9 s cold; fresh data 3.5 s warm; the complete list 7.9 s in; 78 requests and 3.25 MB cold, 71 and 2.37 MB warm.
  The tab was already quick to use; it was slow to finish. The 09-24 speed map measured first content only.
- Changes: the finished-items read starts beside the live read, with a catch-up point the next refresh starts from for rows that moved during
  the overlap; page one of the two big reads starts when sign-in passes (head script, waits for the check);
  lookup tables for the per-row issue scans and a per-second memo for the policy day.
- Same rig, interleaved: cold first rows 3.69 to 3.15 s, complete list 8.24 to 5.85 s; warm fresh data
  3.46 to 3.16 s, complete list inside 5.3 s. 1,642 rendered rows compared old against new: 0 differences.
- Browser only. No write path, gateway, role, authority, flag, Edge Function, database or n8n change.
- Tests: `test/synclinear-early-read.js`, `test/prod-tail-prefetch.js`, `qa/boot/staff-entry-gate.js` (Linear tab cases).
- Record and owner decisions: `docs/audits/2026-10-01-synclinear-speed.md`.

## 2026-10-02 - PTO Accrual Tracker file archived (owner's go, session Roster)

- The interim PTO Sheet (the Time Off page and the `pto` function use the database; nothing reads the file, checked in
  the repo and in every n8n workflow) was moved into a new `Archive` folder at the top of the Drive. Not deleted, not edited.
- Undo: drag the file back out of `Archive` to the top level of the Drive. No ids are recorded here (public repository).
- Same day: the Project Central, Sheet API n8n workflow was unpublished; entry and undo in `docs/ops/N8N_EDIT_LOG.md`.

## 2026-10-01 - Opening an item feels instant: measured on the live site, five changes, same pages (session Comet, OPEN_REPAIRS 323)

- Measured first, as admin staff on the test client, every entry point, 5 runs cold and warm: the staff check (about 1.0 s)
  is the floor under every new-tab open and was not touched. Worst case: a link at a finished batch showed its title at
  5.3 s and everything at 6.5 s; a link at a finished card opened 0.7 s late on every warm visit; every new-tab link went
  through a 404 and a redirect first; a SyncLinear row click started its reads only at the click.
- Changes: a batch link reads its batch, children and parent directly; the saved copy keeps finished rows in IndexedDB
  and reads only what changed (hourly full pass kept, Refresh is always full); the saved list lives 7 days; new-tab links
  use the app document itself; row reads start on hover or press.
- Same rig, interleaved: finished batch warm title 5.27 to 1.46 s, everything 6.51 to 2.74 s; finished sub-issue warm
  2.16 to 1.42 s; row click everything 1.59 to 1.22 s; SyncLinear list warm complete list 5.25 to 3.17 s, 2.36 MB to
  1.25 MB, 71 to 63 requests (fresh data 0.2 s later). Content compared old against new: identical.
- Browser only. No write path, gateway, role, authority, flag, Edge Function, database or n8n change.
- Tests: `test/open-item-speed.js` plus six suites taught the new link form and helpers.
- Record and owner decisions: `docs/audits/2026-10-01-open-item-speed.md`.

## 2026-10-01 - Notes dialog: loading skeleton instead of "All clear" (session Comet, OPEN_REPAIRS 325)

- The dialog said "All clear" or "No notes yet" for about 1.3 s while the crosswalk lookup and comment reads were still
  on their way. It now shows a shimmer (announced as busy) until they answer; rows already held show at once; a failed
  read settles to the old empty state. Calendar and Samples dialogs.
- Browser only. No write path, gateway, role, authority, flag, Edge Function, database or n8n change.
- Tests: `test/notes-loading-skeleton.js`. Live check: skeleton from 22 ms to 1,283 ms, then the thread.

## 2026-10-01 - Edge Functions: preflight cache header and parallel reads in key-verify (session Comet, OPEN_REPAIRS 326)

- Owner decisions: A yes except production-write (waits for the next sealed Section 4 deploy); B1 yes; B2 no.
- Source only, NOT deployed. `Access-Control-Max-Age: 7200` on seven hot-path functions; `key-verify` reads the flag and the member
  together and selects six columns; its audit insert stays before the answer.
- Three functions deploy by themselves on merge (key-verify, smm-weekly-reports, thumbnail-revision-read; owner agreed 2026-10-02); production-comments waits for the next staff-sensitive dispatch; analytics-read, brain and workload-plan need one dispatch each.
- Tests: `test/key-verify-behavior.js`, `test/cors-maxage-and-key-verify-reads.js`.

## 2026-10-02 - Clients Info and Social Media Managers: flag flip to the database and six n8n edits (session Roster, OPEN_REPAIRS 331)

- Owner's go in the request. Parity first (36 of 36 client rows, 41 of 41 manager rows, `PARITY: clean`), then `client_profiles_authority` set to `{"source":"syncview"}` at 20:00:39 UTC.
- n8n: Content Ready Notify, Video Production Automation, Market Research, Manager Sync (then unpublished), Onboarding Append Client Row, Slack Creative Channel Finalizer; versions, tests and undo in `docs/ops/N8N_EDIT_LOG.md`; key-free stubs in `n8n-backups/*2026-10-02.roster.stub.json`.
- Catch-up copy: 77 queued, 77 done, 0 failed, 0 pending; parity clean again. Test client proofs cleaned up afterwards.
- Not proven: the Finalizer end to end (next real client), the Clients tab HTTP door (admin key). Way back: see the ROLLBACK.md Live State row.
