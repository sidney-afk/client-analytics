# Linear exit: execution map

One flat, numbered list of every step from here to a website that no longer
depends on Linear. This is the map an execution session follows and reports
against. It does not replace the detailed instructions; each step links to
them.

**Read first:** [living checkpoint](LINEAR_EXIT_PREPARATION_CHECKPOINT_20260914.md) ·
[step detail](LINEAR_EXIT_INSTALLATION_DAY_20260914.md) ·
[recovery](LINEAR_EXIT_RECOVERY_PROCEDURE.md) ·
[owner before/after](LINEAR_EXIT_OWNER_BEFORE_AFTER_20260914.md)

Preparation only. Publishing this map authorizes nothing. Every step marked
**GATE** requires the owner's explicit go-ahead in the session where it happens.

---

## How to report progress

Count completed steps out of 29 (step 29 is the Close-out sweep, added
2026-09-19). Report it like this at the start of every
execution session and after every completed step:

```
Phase 3 of 7 · step 14 of 29 · 48% complete · next: 15 (verify installed catalog)
```

**Current position, 2026-09-18:** phase 7 is under way and the counter above is
only an example of the format. Phase 7 repeats steps 26 to 28 **per
capability**, so a single number out of 29 stops being meaningful there — report
the capability by name and its own step:

```
Phase 7 of 7 · labels: ✅ through step 28 (7 of 7 checks, check 6 three of three) · next: the next capability's step 26
```

A step is complete only when its **Done when** column is satisfied and its
evidence is recorded. A step that was started and stopped is not complete;
report it as in progress with what remains. Never report a GATE as complete
because the preceding work is done; it is complete when the owner said yes.

---

## Phase 0 — Before the day (no freeze needed)

| # | Step | Who | Done when |
|---|---|---|---|
| 1 | Storage custody: capture, encrypt, upload privately, owner downloads, hash matches, isolated restore of the downloaded copy | Session + owner | Restore of the downloaded copy verifies, scratch server stopped, receipt recorded |
| 2 | Capture the currently deployed version of every Edge function and record its source pins | Session | Every deployed function has a recorded previous version; state whether one single older main commit matches all of them |

Step 2 answers the one open unknown in the recovery procedure. If no single
commit matches all functions, say so and stop to decide before the day, because
route C1 in the recovery procedure will not be available.

## Phase 1 — Freeze and go green

| # | Step | Who | Done when |
|---|---|---|---|
| 3 | Owner freezes main; no further merges until the day is finished | Owner | Owner states main is frozen and records the frozen SHA |
| 4 | Run the main catch-up rehearsal against the frozen SHA | Session | **Amended 2026-09-15, see below.** Rehearsal receipt written; conflicts are exactly the three reviewed files; any new main SQL is classified |
| 5 | **GATE** approve the actual branch catch-up | Owner | Explicit go-ahead recorded |
| 6 | Merge frozen main, stage the resolution, regenerate the production-write fingerprint, run the deploy-lane test and identity-exposure check | Session | **Amended 2026-09-15, see below.** Every command exits zero; fingerprint, entrypoint hash and file count agree with the deploy lane |
| 7 | Push and wait for GitHub checks on that exact head | Session | 12 checks pass on the pushed head. Not green means stop |

### Amendment 2026-09-15 — steps 4 and 6, hand-resolved catch-up

Recorded so the deviation is visible rather than silent. **Owner-approved in
session before execution.**

At the freeze, the branch conflicted with frozen main `0aa5954` in FIVE files,
not the three the rehearsal covers: the Section 4 deploy workflow, its test,
`EXECUTION_LOG.md`, `REPO_MAP.md` and `index.html`. The last two are outside
`scripts/linear-exit-main-catchup.js`'s `KNOWN` set, and `index.html` is
application code, so the helper refused with `STOP_UNEXPECTED_CONFLICT`. That
refusal is correct and the helper was NOT widened: its narrow allowlist is what
lets `--stage-resolution` verify a rehearsal byte for byte, and teaching it to
merge real code would have destroyed that property. Because a receipt can only
be produced for exactly the three known conflicts, steps 4 and 6 as written were
not executable.

**What replaced the rehearsal receipt, by owner decision:** owner review of the
resolution diff, plus the substitute proofs below. No blanket `ours`/`theirs`
was used anywhere.

- `EXECUTION_LOG.md`, `REPO_MAP.md` — bookkeeping; both sides' entries kept,
  verified no reference from either side was dropped.
- Deploy workflow and its test — resolved by the helper's own exported
  `resolve()`, reused rather than reimplemented, so both sides' provenance
  comments survive. Pins then regenerated with `ef-fingerprint`, never by hand.
  The branch's stored entrypoint pin was stale; the regenerated value is the
  correct hash of the real entrypoint path.
- `index.html` — both sides rewrote the same Workload notice-priority ladder.
  The branch had converted it from a suppression chain into an ordered
  `notices` array; main had added two new notices as early returns. Both of
  main's became pushes at the rank main shipped them with, gates unchanged.
  The unmatched-saved-work-days notice (item 210) stays above the metadata
  note, above 209's short-refresh note and above the completeness note, as its
  own comment requires. Behavioral note: under main that notice SILENCED
  everything below it; under the merged ladder it leads and lesser notices are
  appended, so it can no longer be buried.

Substitute proofs, all green on the merged tree:
`docs/syncview-design/tests/prod-write-gateway-browser.js`,
`test/f27-section4-deploy-lane.js`, `test/workload-capacity-placement.js`,
`test/workload-plan-source.js`, `test/workload-tweak-exclusive-bucket.js`,
`test/workload-plan-failclosed.js`, inline-JS syntax check,
`git diff --cached --check`, the identity-exposure check, and the twelve
GitHub checks on the pushed head. `prod-boot-budget.js` fails in a sandbox with
no route to Google Fonts, jsDelivr or Supabase, and fails identically on frozen
main, so it is not a regression.

This amendment covers THIS catch-up only. The helper is unchanged and remains
the mechanism for any future catch-up whose conflicts are its three known files.

---

## Phase 2 — Recoverable pre-state

| # | Step | Who | Done when |
|---|---|---|---|
| 8 | Fresh read-only catalog and identity check against the published baseline | Session | Exact supported baseline matched, project identity confirmed, TLS verified |
| 9 | Refresh the database backup: capture, encrypt, upload to the private Drive folder | Session + owner | Encrypted package uploaded, hash recorded |
| 10 | Owner downloads it on another device; restore the downloaded copy into an isolated database | Session + owner | Hash matches and the isolated restore verifies tables, rows and sequences |
| 11 | Record the pre-state: current authority, capability settings, Linear inbound/outbound settings, worker state | Session | Written snapshot exists, to compare against at step 25 |

If Storage custody was not completed in step 1, it is done here, before the
freeze holds any longer. Do not start it while files are being changed.

### Step 8 CLOSED — 2026-09-17T00:10Z (2026-09-16 18:10 on the owner's machine)

Authorised by the owner. A read-only live catalog read through the private
wrapper, run from a Windows PowerShell 5.1 host, with the receipt read back from
disk:

- **Receipt:** `day-catalog-20260916-5/receipt.private.json`, SHA-256
  `685482e88f490d3e81235cbf2126b539d112c8d352bd27b3eaf073fbca45ec41`.
- **Baseline matched:** catalog `ddfa4c4f…` (supported baseline `settled68`),
  68 public tables.
- **TLS verified.**
- **Project identity** identical to three earlier reads.

Evidence and cross-checks are in the journal entry "STEP 8 CLOSED".

**Progress:** Phase 2 of 7 · step 8 of 28 · 29% complete · next: 9 (refresh
the database backup). **Step 9 is not started and not authorised.** It will need
a fresh step 8 read immediately before it, because a receipt older than one
hour is refused.

### Steps 9 and 10 CLOSED — 2026-09-17 (2026-09-16 evening on the owner's machine)

Authorised by the owner. Full evidence is in the journal entry "STEPS 9 AND 10
CLOSED".

- **Step 9.**
  - A fresh read-only catalog read (`ddfa4c4f…`, `settled68`), then the live
    capture through the private refresh wrapper, from a Windows PowerShell 5.1
    host: `DATABASE_CAPTURE_PASS`, 68 tables.
  - Local restore passed.
  - Packaged with the recorded `Compress-Archive` command. **Upload hash**
    `228fe177b0b6dbef316c82dde5df1f6d2b697eb41301eb9b509021498b2841cb`.
  - Uploaded to the private Drive folder by the owner.
- **Step 10.**
  - Downloaded on a separate Windows laptop; its SHA-256 matched the upload
    (**owner-reported**).
  - A fresh Drive download on this machine matched the upload hash, and all 45
    extracted members matched the local package.
  - That download restored in the isolated scratch cluster:
    `ISOLATED_DATABASE_RESTORE_PASS`, exact catalog, rows and sequences. The
    restored database was measured independently at 68 tables, catalog
    `ddfa4c4f…`.
  - **The separately retrieved laptop copy was not itself restored.**

**Progress:** Phase 2 of 7 · step 10 of 28 · 36% complete · next: 11 (record
the pre-state). **Step 11 is not started and not authorised.**

### Step 11 CLOSED — 2026-09-17T03:19Z (2026-09-16 21:19 on the owner's machine)

Authorised by the owner. Read-only, and nothing was changed.

- **Snapshot:**
  `D:/Sidney/Codex/2026-09-13-final-review-repairs/pre-state-snapshot-20260916-2/pre-state.private.json`,
  SHA-256 **`ad3bdf6a3d6c61f14f20725a5c0b7ed7247352bb1c6abf02c328d1796dc43033`**.
  Private JSON with sorted keys; diff its `compare` section at step 25. The
  collector used is kept beside it.
- **Database half:** restore-derived from the step 10 copy, as of capture
  2026-09-17T01:11:49Z, catalog `ddfa4c4f…`.
- **Edge Function env:** every key as name and SHA-256 of value.
- **Workers:** GitHub Actions API, with frozen main `1abdd1fa`.
- **Gates:** 25 recorded, 19 of them explicitly **ABSENT**.

Full detail is in the journal entry "STEP 11 CLOSED".

**Progress:** Phase 2 of 7 complete · step 11 of 28 · 39% complete · next: 12
(install operator, read-only observation). **Step 12 is not started; it waits
on the pipeline proof re-run.**

## Phase 3 — Install the SQL, dormant

| # | Step | Who | Done when |
|---|---|---|---|
| 12 | Run the install operator in its default read-only observation mode | Session | Identity, TLS and catalog observed; existing installation state reported |
| 13 | **GATE** approve APPLY for the exact plan, with the window evidence hash | Owner | Explicit go-ahead recorded; evidence hash supplied |
| 14 | Execute the 48-source, 55-chunk installation | Session | All 55 chunks journaled |
| 15 | Verify the installed result | Session | Exact catalog, routine and ACL comparison passes; retirement dependency check unchanged; finalizer removed only registered guards |

If step 14 stops partway: do not restart from zero and do not mark a chunk
complete by hand. Classify the committed prefix and resume the same plan with
the same identity. Nothing is activated by this phase.

### Step 12 CLOSED — 2026-09-17T15:04Z (09:04 on the owner's machine)

Authorised by the owner. The install operator ran in its default **read-only
observation** mode against the live database, through the private wrapper
`run-install-operator.private.cjs`:

- **Wrapper:** SHA-256
  `ddec698855b672677018fe6ceaf68e83718de50a23c75e46c7f83aaa5b765b45`, recorded
  before the run at `669e7898` and unchanged after it.
- **Apply token:** none supplied.
- **Operator result:** `READ_ONLY_OBSERVATION`, with existing install state
  `maintenance: false, journal: false`.
- **What passed:** identity equal to the expected identity, TLS verified, and the
  live catalog equal to the plan's starting catalog `ddfa4c4f…`.
- **Drift against the step 11 snapshot:** none. The catalog hash is equal, the
  table and function name lists are equal (68 and 122), identity is equal, and
  both install namespaces and both gate tables are absent.
- **Nothing was changed.**

Full record is in the journal entry "STEP 12 CLOSED".

**Progress:** Phase 3 of 7 · step 12 of 28 · 43% complete · next: **13, the
owner's GATE** (approve APPLY for the exact plan, with the window evidence hash).
**Not started.**

### Step 13 GATE approved — 2026-09-17 (owner)

The owner approved APPLY for plan `508e6369…` on the supervisor's verification,
at a moment the owner confirmed nobody was mid-task. Window evidence hash
`20fcabcb2317831f2fc514899e38aa996e9640b31285299f778da8ed4b6971a5`, the receipt
of the catalog read `day-catalog-20260917-3`. Recorded in the journal before step
14 ran.

### Steps 14 and 15 CLOSED — 2026-09-17T16:52Z (10:52 on the owner's machine)

**Step 14:**

- **What ran:** the wrapper `run-install-operator.private.cjs` (`ddec6988…`,
  unchanged before and after), with the apply token derived by the operator's own
  `consent()`. The token was never written.
- **Operator result:** **`INSTALLED_SCHEMA_TARGET_MATCH`**, finalizer
  `PREPARED_MAINTENANCE_FINALIZED`, 91 guards removed, activation not performed.
- **Timing:** 16:04:41Z to 16:37:40Z, about 33 minutes. **Unexplained:** the
  install journal records no timestamps.

**Step 15:** the read-only verifier `verify-install-state.private.cjs`
(`b1a2cdbd…`) found:

- **55 of 55** journaled chunks exactly equal to the plan's, in order;
- **0** maintenance guards remaining;
- live public catalog `331aabb2…` with **91** tables, and public and private
  catalogs **matched** target `24c833c0…`;
- the retirement contract assertion **passed**.

**Verifier result hash
`1227392aa28f3eee13a4c26853e48d69d07dac78afa6a3f5f231c4bfe79a5544`.**

One follow-up read, authorised by the owner, confirmed that the journal's and the
maintenance gate's plan hash are both the derived maintenance plan
`18697ad2…`, as the installer requires.

Full record is in the journal entry "STEPS 14 AND 15 CLOSED".

**Progress:** Phase 3 of 7 complete · step 15 of 28 · 54% complete · next:
**16, the owner's GATE** (approve the merge, accepting that it publishes the
live browser and may auto-deploy staff functions). **Not started.**

## Phase 4 — Release the website and functions

| # | Step | Who | Done when |
|---|---|---|---|
| 16 | **GATE** approve the merge, accepting that it publishes the live browser and may auto-deploy staff functions | Owner | Explicit go-ahead recorded, ordering interval accepted |
| 17 | Merge the PR; Pages publishes | Session + owner | Merge complete |
| 18 | Verify the served browser | Session | Served browser SHA matches the merged commit; safe existing reads work |
| 19 | Run the 13-function Edge release lane and verify fingerprints | Session + owner | Every deployed function matches its expected fingerprint |

## Phase 5 — The one n8n change

| # | Step | Who | Done when |
|---|---|---|---|
| 20 | Capture the current published legacy editor workflow version and full graph privately | Session | Exact restorable capture recorded |
| 21 | **GATE** separate go-ahead for the one-line edit | Owner | Explicit go-ahead recorded in this same session |
| 22 | Remove only the displayed Linear link; read back the published version | Session | Exactly the reviewed text-only difference; every other field unchanged; no message sent |

This is the only n8n change in the entire migration. Every other workflow stays
untouched.

## Phase 6 — Observe, everything still dormant

| # | Step | Who | Done when |
|---|---|---|---|
| 23 | Verify safe existing reads across Calendar, Samples and Production | Session | Reads succeed; no page errors |
| 24 | **GATE** approve TEST saves, then run them | Owner + session | Status, stored row, receipt and event all verified. An HTTP 200 alone is not enough. No client Slack delivery |
| 25 | Confirm every new control is still dormant and pre-state settings are unchanged | Session | Compared against step 11 snapshot; notification sender, wake, follow-up supervisor, reconcile apply and census gates all still off |

At the end of phase 6 the install is live and inert. Existing behavior is
unchanged. This is a safe place to stop for days.

## Phase 7 — Turn on capabilities, one at a time

Repeat steps 26 to 28 per capability. Enable one, watch real work, then the
next. Linear stays running underneath the whole time.

| # | Step | Who | Done when |
|---|---|---|---|
| 26 | For the chosen capability: complete its deployment and configuration, then **GATE** approve enabling it | Owner + session | Configuration in place; explicit go-ahead for this one capability |
| 27 | Enable the single flag and watch real work flow through it | Session + owner | Its own acceptance checks pass against real usage |
| 28 | Record the website dependency it closes: the exact gate, the accepted replacement, and evidence the legacy route is unreachable | Session | Recorded for that capability in the checkpoint dependency table |

### Status by capability

| Capability | Flag | Step | Evidence |
|---|---|---|---|
| **Labels** (`production_native_label_catalog`) | `native` since **2026-09-18T20:02:56Z**, version `f55a7dd2` | ✅ **28 COMPLETE** — through phase 7 | Deployed at `b7c30c74`, `production-write` v77; version read back from `production_label_catalog_versions` at 19:45Z. **All 7 acceptance checks measured:** 1 (read, owner), 2 (receipts **10536**, **10537**), 3 (row changed, updated 20:08:02Z), 4 and 6-409 (storage session on the test card, receipt **10579**, journal `edf78a6a`), 5 (labels debt 0 before and after), 6-403 (offline, `test/production-write-gateway.js` — a client principal is refused `403 operation_forbidden`), 7 (video, then graphics on receipts **10575** and **10576**). **Check 6 across all three refusals:** 6a (client → 403, offline), 6b (a staff role outside `admin|smm` → 403 `operation_forbidden` from the policy table, offline, with a policy-flip control), 6c (stale version → 409, receipt 10579). 6b's clause was **amended on 2026-09-18** to accept either refusal code, because it named `native_label_scope_forbidden`, which the role refusal never reaches. Check 4 remains **only satisfiable by a staff principal** — it passed on the test *card*, not as the test *client*. Served per team: video **2**, graphics **6**. Kill switch: `mode:"hold"`. |

#### What is left — the to-do list from here

Every remaining capability, one row each. **This table is the working list from
now on: each later PR updates its own row rather than adding a new list
somewhere else.** States are derived from the code and docs on `main` at the
time of writing, and a row says **`unknown, verify`** wherever the repository
cannot answer — a live runtime-flag value is read from the database, not from
this repository, so no row here asserts one it has not seen recorded.

State vocabulary, used exactly: **native** (flipped and recorded), **on but
step 27 unmeasured** (flag on, acceptance checks not all measured), **code
installed but not wired** (SQL is in the repo and nothing calls it from
`index.html` or an Edge Function), **not built**.

| Capability | Flag | State | Closes |
|---|---|---|---|
| **Ordinary receipts** | `production_native_ordinary_receipts` (gate `production_native_ordinary_capability`) | **unknown, verify** — live flag value not recorded in this repository. Deeply integrated in SQL (its gate is read by four migrations, including two repairs and the test-client parity row), and the calendar bridge's header states the flip has happened, which is why the Linear round trip no longer carries native writes. Not a step-28 closure on the record. | Checkpoint row *"production-write provider label/metadata branches and Linear credential reads"* — the **metadata** half. Labels closed that row's label half only. |
| **Assignment** | `native_assignment_epochs` | **unknown, verify** — live flag value not recorded. Wired: read by one Edge Function and three scripts. Auth-kind binding landed 2026-09-18 (`migrations/2026-09-18-native-assignment-auth-kind-binding.sql`). | Same checkpoint row, the **assignment** half, named explicitly in the labels closure's *"Scope: this row is only partly closed"*. |
| **Calendar bridge** | none — an AFTER UPDATE trigger, not a flag | **native.** Applied live 2026-09-18T22:38Z; the trigger half worked from the apply. Its backfill refused every call until `migrations/2026-09-18-native-calendar-backfill-temp-table-clear.sql`, and **the backfill has still never been run** — the cards that already lagged at the flip are still lagging. | OPEN_REPAIRS **212** (the backfill has still never run). No checkpoint row: the bridge repairs a hole the exit *opened*, rather than replacing a Linear dependency. |
| **Card-vs-calendar watcher** | none — a CI lane | **code installed but not wired.** Script, unit suite, fixture and `card-calendar-status-drift.yml` land in this PR; the lane cannot pass until the repository secret **`SUPABASE_URL`** is set, which is an owner action. Registered as watchdog lane `card_calendar_drift`. | Nothing in the checkpoint. It is the measurement that the calendar bridge is holding — the reconciler cannot be, because it compares the two surfaces through Linear and native receipts send Linear nothing. |
| **Intake form path** | `native_intake_epochs` | **unknown, verify** — live flag value not recorded. The most wired of the remaining set: read from `index.html` (2), two Edge Functions and nine scripts. | Checkpoint row *"Intake: VIDEO_FORM_WEBHOOK and legacy dispatch selection"*, plus the **intake** half of the provider-branch row. |
| **Workload page** | **unknown, verify** — no single flag key identified in this repository | **unknown, verify.** The checkpoint records the dependency as three `index.html` calls plus the `workload-linear` function; whether a native replacement is wired was not established here. `scripts/workload-native-visibility-check.js` and `workload-source-freshness.yml` measure the native side. | Checkpoint row *"Workload: index.html LINEAR_ISSUES_WEBHOOK, LINEAR_TWEAK_COMMENTS_WEBHOOK and WORKLOAD_LINEAR_URL calls; workload-linear function"*. |
| **Urgent editor assignee lookup** | `urgent_video_destination` | **code installed but not wired.** The flag is read by two migrations and two scripts, and by nothing in `index.html` or any Edge Function. The checkpoint notes that removing the displayed URL leaves the Linear lookup input intact — so the lookup is the part that has to be accepted or rerouted, not the link. | Checkpoint row *"Legacy urgent editor assignee lookup"*. |
| **Identifier mint** | `production_native_identifier_mint` (gate `production_native_identifier_capability`) | **code installed but not wired.** `migrations/2026-09-07-native-identifier-mint.sql` installs allocate / guard / seed / capability; the gate is referenced by that migration alone, and `production_native_identifier_allocate` is called from one script and from nothing in `index.html` or any Edge Function. | **unknown, verify** — no checkpoint row or OPEN_REPAIRS entry was identified for it here. |
| **Brief media** | **unknown, verify** — no runtime-flag key identified; `migrations/2026-09-07-native-brief-media.sql` | **unknown, verify.** Referenced by one Edge Function and six scripts, so it is not inert, but no flag and no recorded step-27 measurement. | **unknown, verify** — likely the *"Historical Linear import/link UI and retained URL fields"* row, not established here. |
| **Card materialization** | `native_card_materialization` | **code installed but not wired.** `migrations/2026-09-06-native-card-materialization-boundary.sql` is the only file in the repository that references the flag; nothing in `index.html`, any Edge Function or any script reads it. | **unknown, verify** — no checkpoint row or OPEN_REPAIRS entry identified. |
| **Step 29 health check** | none — a procedure | **not built.** Step 29 is added to this map in this PR; no sweep has been run and nothing is journaled. | Closes nothing by itself. It is the whole-system check that every other row here has in fact been closed, removed or explained. |

Two honest gaps in the table above, both deliberate rather than tidied over.
**Live flag values are not in this repository.** Every `unknown, verify` in the
Flag/State columns is one read of `syncview_runtime_flags` away, and that read
belongs to a session that can reach the database; guessing them from the
presence of a migration is exactly how a capability gets called done. And
**"wired" here means a call exists in `index.html`, an Edge Function or a
script** — it is evidence of integration, not of a passing acceptance check.
No row below labels claims a step-28 closure, because none has one.


**Labels is the first capability through phase 7**, on the second attempt at
saying so. The first was withdrawn the same day after a Codex P1 established
that check 6 names three refusals and only two were measured; check 6b is now
measured and its clause amended, and the closure in
[the checkpoint's dependency table](LINEAR_EXIT_PREPARATION_CHECKPOINT_20260914.md#step-28-closures-recorded-so-far)
is restored. Both the withdrawal and the restoration are kept on the record.

A capability is not through phase 7 because its flag is on, and not because six
of seven checks passed. It is through when every acceptance check is measured —
**including each clause of a check that has several** — and the closure is
recorded with the exact gate, the accepted replacement, and the sense in which
the legacy route is unreachable. For labels that sense is already known to be
bounded: the provider branch is switched off, not removed, because the kill
switch shares its flag.

Procedure and its corrections:
[step 26/27 for native labels](LINEAR_EXIT_STEP26_NATIVE_LABELS.md). Three of
the four blockers that file opens with were resolved on the day and one of them
was never real; its correction blocks say which and why.

Stop on any required path with no accepted replacement. If a capability
misbehaves, turn that one flag back off; Linear is still underneath.

Website independence is complete when every row of the dependency table in the
checkpoint has an accepted replacement and an unreachable legacy route.

---

## Close-out

Runs once, after the last capability in Phase 7 has closed. Steps 26 to 28
prove each capability's own dependency is replaced; this step asks the
different question those cannot — what is STILL pointing at Linear across the
whole system, including the things no capability ever owned.

| # | Step | Who | Done when |
|---|---|---|---|
| 29 | Whole-system health check after the last capability closes. Sweep for anything still pointing at Linear: GitHub Actions workflows and secrets, n8n workflows (read only, list them, do not edit), Edge Function env references, `index.html` calls, scripts, docs. Report per item: removed, intentionally kept, or dead. Nothing is retired in this step. | Owner + session | The sweep report is journaled with zero unexplained items |

"Zero unexplained items" is the whole bar, and it is deliberately not "zero
items". An intentionally-kept Linear reference is a passing result once it says
why it is kept; an item nobody can classify is the failure, because that is the
one that later surprises somebody. Read-only on n8n is not a formality either —
those workflows are production sales automation and are never edited without the
owner's explicit go-ahead in the same request.

---

## Out of scope

Actual Linear retirement is not in this map and is not a later step of it.
Retiring, cancelling or disconnecting Linear, its credentials, billing, data or
its own integrations would need a new, separate owner decision and its own plan.
Verified native receipts are kept, never deleted.

## Stop conditions

Stop and report, at any step:

- GitHub checks are not green on the exact head
- The fresh catalog does not match the supported baseline
- New main schema changes appear that are not classified
- The installation stops partway
- A deployed function does not match its expected fingerprint
- A TEST save returns success but leaves no stored row or receipt
- Any approval is missing for the step in front of you

Then open the [recovery procedure](LINEAR_EXIT_RECOVERY_PROCEDURE.md) and use
its stop-or-continue table before doing anything else.
