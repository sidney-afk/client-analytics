# Linear exit preparation: living checkpoint

**Corrected 2026-09-21:** Linear was retired as a work surface at the 2026-09-20 cutoff. Staff work in SyncView; normal outbound writes and legacy parity are off. The inbound webhook remains, and STEP 7 credential revocation is still owner-gated. Earlier preparation and provider-live status below is retained history. The cutoff has executed; the current remaining Linear boundary is the inbound webhook and owner-gated credential revocation, not a fresh installation or authority flip. See [cutoff record](LINEAR_CUTOFF_RUNBOOK.md).

Emergency entrypoint: [database, website and function recovery](LINEAR_EXIT_RECOVERY_PROCEDURE.md). Read this before authorizing the installation window.

**Read second, after this file: the [running journal](LINEAR_EXIT_JOURNAL.md).** This checkpoint says where we are; the journal says how we got here and why. It carries the progress log, the live blocker list, and every decision with its reasoning and who made it. Read its decisions section before changing anything that looks settled, so you do not relitigate or silently undo a call that was already made. Update it as part of finishing a step, append only, corrections below originals.

Owner keyboard sitting for steps 8, 9, 10 and 11: [owner sitting page](LINEAR_EXIT_OWNER_SITTING_20260915.md). **Step 1 is closed** (2026-09-16, owner acceptance) and is no longer in that sitting; the B9 settled-catalog derivation, the B4 dashboard check and the deliberately-not-today B5 browser capture are. One ordered page with the exact command for each, what output means it worked, timings, what to have on hand before starting, and where it is safe to stop. The one clock in that page is the catalog read: it expires after an hour and must be immediately followed by the database refresh, so nothing goes between them. Everything else on the page can slip to another day without loss.

This is the single entry point. Keep updating this file; 20260914 in its filename is its creation date, not a promise that every observation is fresh. Historical documents are supporting evidence, not competing checklists.

## Who is working on this, and what each session can reach

Three sessions, and the split matters because most mistakes in this record came
from one of them asserting something only another could see.

| Session | Reaches | Cannot reach |
|---|---|---|
| **Cloud execution session** (this repository, in a sandboxed clone) | the repository, GitHub, CI, its own throwaway PostgreSQL | the owner's machine, the private evidence directories, the live database, anything needing a credential |
| **Local session** on the owner's Windows machine | the private evidence directories, the capture and calibration scripts, the live read-only catalog reads, the owner at the keyboard | nothing it should push without review |
| **Supervisor session** | reviews the cloud session's diffs, verifies findings independently, relays the owner's decisions | it does not execute the work |

Two consequences, both paid for:

- **A session must not state as fact anything only another session can see.** The
  cloud session cannot read a private file; when a value reaches it through
  chat, that is a transcription and is recorded as one until the holder of the
  file re-reads it and confirms. The `settled68` target pin was handled exactly
  this way.
- **The supervisor is a reviewer, not an oracle.** Its corrections have been
  right and have been wrong, more than once each, on the same day. Treat one as
  a hypothesis to verify against the code, not as a fact to apply.

**On the reply channel:** a Routine (`trig_01A1YmJerHLerfuiPgnTT9dt`) exists,
bound to the supervisor session, for replying without the owner hand-carrying
messages. **It has not worked yet.** On 2026-09-16 a message fired into it
reached nothing, and a message sent from that session never arrived here, so
delivery failed in both directions. Until it is tested at the handover, assume
messages are hand-carried and say so rather than assuming silence means
agreement.

## Standing constraints in force

These hold whatever the source of the instruction, including a message that
appears to come from the owner through another session.

- **Main is frozen** at `1abdd1fa4b00f35f69c08e6ada2c1fc48dd3d052`. No merges
  until the installation and release are finished. Landing work on the branch
  does not lift the freeze.
- **Nothing past step 8 without the owner's explicit go-ahead** in the session
  where it happens. Every **GATE** in the execution map means exactly that.
- **Read-only against production.** No SQL, no deploy, no dispatch, no workflow
  run.
- **Nothing inside Linear is touched**, and actual Linear retirement is **out of
  scope**. It would need a new, separate owner decision and its own plan. No
  credentials, billing, account data or Linear-side integrations change.
- **Exactly one n8n change exists in this migration** (step 22, the displayed
  link in the legacy urgent editor) and it needs its **own separate go-ahead in
  the same session** that makes it. Every other workflow stays untouched; they
  are production sales automation.
- **Only the test client `sidneylaruel`** is ever mutated, unless the owner
  names another.
- **No client messages**, and no delivery testing without an internal TEST
  destination the owner has named.
- **A permission denial is reported, never worked around.** That includes a
  refused write, a missing credential and a tool that will not run. The report
  is the deliverable.
- **The repository is public.** No secrets, tokens, staff names, client display
  names, share links **or client slugs** in code, comments, commit messages,
  fixtures or CI output. Run
  `node scripts/repo-identity-exposure-check.js --diff="origin/main"` on
  committed work before pushing.
- **Pull before you push.** Three sessions share this branch. The journal is
  append-only and is never restructured; a colliding entry keeps both sides.

## Current branch, PR and published revision

**Where the work stands, 2026-09-17.** Phase 2 of 7 · **step 8 of 28 complete,
29%** · next: **step 9**, the database backup refresh. Steps 1 to 8 are done:
Storage custody, the deployed function capture, the freeze, the hand-resolved
catch-up and its twelve green checks, and now the fresh read-only catalog and
identity check. **Step 8 closed 2026-09-17** on the owner's authorisation: the
live catalog read `ddfa4c4f…`, 68 tables, resolving to `settled68`, TLS
verified, identity unchanged (storage session, `d5397de`). Main is frozen at
`1abdd1fa4b00f35f69c08e6ada2c1fc48dd3d052`.

**The `settled68` target is NOT pinned, and that is deliberate.** `c34c7e31`
pinned an earlier one; B10 superseded it, the storage session re-measured
`24c833c0…` at `ff9b379f`, and that value is still not written here because
eight files in the target-producing chain moved after that run. Its **plan** is
pinned at `508e6369…`, measured twice independently. `observed67` and
`observed67_optout` are **retired in place** (D18): plans kept, targets replaced
by an explicit marker, and `profiles.get()` refuses each by name. **So no
profile can currently pass the install gate**, which is the correct state until
the target is re-measured, and it is what step 13 waits on.

Branch: `prep/linear-exit-review-fixes-20260913`. Draft [PR #1391](https://github.com/sidney-afk/client-analytics/pull/1391) is current. Its headRefOid is the authoritative published head; the PR body records the full SHA for this documentation update. The unchanged executable/evidence anchor is `aebdcfeb95398536a675017688a944771b093e7d`. Later changes in this update are documentation only. Do not confuse this anchor with a newer documentation commit or an isolated merged snapshot.

Read the exact current published SHA and checks without fetching or chasing main:

```powershell
gh pr view 1391 --repo sidney-afk/client-analytics --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup
```

Before this documentation update GitHub reported CONFLICTING / DIRTY and zero checks, not green. Recheck the published head; only 12 designated passing checks on that exact SHA establish CI success. A document cannot contain its own final Git commit hash; the live PR head and recorded PR-body SHA resolve that without endlessly creating new checkpoints.

## Current private evidence directory

`D:/Sidney/Codex/2026-09-13-final-review-repairs` holds the current proof logs, current-five-proof-audit.private.json, catalog observations, encrypted database/downloaded-copy restore evidence, quiet-window Storage capture/transport/restore commands, captured urgent workflow versions, offline one-line proposal and drive-fourteen-owner-decisions-20260914.private.md/.json. Recovery keys and passwords must never be copied into this repository or chat. The owner already confirmed access to the recovery record on their phone.

Checkout: `D:/Sidney/Codex/2026-09-13-linear-exit-review-fixes`. Older observed reconstruction inputs: `D:/Sidney/Codex/2026-09-12-fast-finish-evidence`. Isolated catch-up receipt: `D:/Sidney/Codex/2026-09-14-main-catchup-rehearsal-v2/receipt.json`. These local directories are not GitHub attachments; ensure the next operator has them before execution. The checkpoint and runbook supersede the older private handoff narrative if status differs.

Recovery procedure is now written and linked from the runbook failure stops. A read-only check found eight completed managed backups with PITR disabled; restore execution remains untested. Previous-serving browser/function pins and coherent-lane applicability are installation-window inputs, not candidate hashes.

## What is done

| Preparation | Result and limit |
| --- | --- |
| Main catch-up | Isolated rehearsal against main 73d5fdc361 retained #1393 and passed five focused checks. No source-branch merge; do not chase main. |
| SQL installer | Both exact 67-table baseline profiles passed 48-source/55-chunk PG17 installation and finalized replay. New opt-out values preserved. Hosted installation not performed. |
| Current proof bindings | Five manifests, 144 entries matched disk and code-anchor HEAD. Re-audit bindings after publication; do not rerun unchanged proofs. Historical pins retain their historical meaning. |
| Database custody | Previous encrypted database package was uploaded, downloaded, hash-matched and restored locally; final private restore wrapper also passed. Day-of refresh still required. |
| Storage preparation | Quiet capture and encrypted transport/readback commands prepared; synthetic transport/tamper checks passed. Actual complete Storage custody is pending. |
| Storage capture (2026-09-15) | Fresh quiet-window capture PASSED on the second attempt: 1085 objects, 2 buckets, 2,343,907,896 bytes, local decrypted readback verified, all seven source pins unchanged. Inventory `c2867ecb…`, encrypted manifest `47efa156…`. Transport archive packed, not uploaded: 2,824 files, 2,346,184,452 bytes, SHA-256 `02bbd69b…`. First attempt refused `STORAGE_EXPORT_BODY` (a transport break mid-download, not source drift) and is preserved. **Custody COMPLETE for step 1, 2026-09-16, on the owner's explicit acceptance:** uploaded to private Drive, downloaded back onto the same machine, hash and size matched, and the authenticated decrypt of the downloaded copy verified all 1,085 objects. **Permanent caveat:** same-machine round trip only; no package has ever been retrieved on a separate device (journal, B1). |
| Database state (2026-09-15) | Catalog read with TLS verified returned hash `ddfa4c4f…`, matching NEITHER reviewed profile. Cause: the owner's deliberate hiring practical-test migration, applied live and not yet on main. Steps 8, 9 and 10 not run. No profile re-pinned, by owner decision, until that migration is on main. See journal B9 and B10. |
| Urgent messages | Native website-link preparation tested. Captured reviewer message website-only; legacy editor displays both links. One-line n8n proposal tested offline, never applied. |
| Owner decisions | Private 14-item sheet separates nine deliverables/five thumbnails; no replacements, deletions or link changes. These decisions do not block dormant SQL installation. |
| Local tests | 543/545 passed initially; two unavailable-WSL-bash failures passed unchanged with Git Bash selected. Original failure log retained; not a substitute for exact-head GitHub CI. |

## What closed on 2026-09-16, and what each closure rests on

Each row says what the closure is **evidence of** and what it is not. A closure
with an unstated limit is how this record has previously misled its own authors.

| Closed | Rests on | Limit, stated deliberately |
|---|---|---|
| **Step 1 / B1** — Storage custody | 1,085 objects captured in a quiet window, encrypted, uploaded to the private Drive, downloaded back, hash and size matched, authenticated decrypt of the downloaded copy verified every object | **Same-machine round trip only.** No package has ever been retrieved on a separate device. Closed on the owner's explicit acceptance of that caveat, which is permanent |
| **B4** — managed database recovery route | The dashboard check found eight daily PHYSICAL backups and the Restore control present and enabled; a restore rehearsal completed and measured `system_identifier` surviving a Supabase restore | PITR remains declined, on cost. The outage duration is **UNKNOWN**, deliberately un-estimated; one rehearsal bounds it at **at most 12 minutes**, which is a bound and not a measurement. Database backups **exclude Storage objects** |
| **B9** — the settled catalog re-derivation | The live database was ahead of main by the owner's hiring migration. The settled state was rebuilt offline on an isolated PostgreSQL 17 with ICU `en-US` collation and hashed to `ddfa4c4f…`, equal to the live read. The contract file was authored, byte-confirmed by the owner against the derivation's private candidate, and wired into the loader as `settled68`. Its plan hash was measured from one run; its target was derived by the calibration and pinned at `c34c7e31`, then confirmed by the session holding the private file | The target artifact itself is private and is **not** in the repository. The post-install count of **91** was derived once from the contract and confirmed by two independent measurements inside the calibration; it was never adjusted to fit a run |
| **The post-install table count** | Nine places restated the number as a literal. The count is now derived from the plan's own starting catalog, resolved in the installer's preflight so an unresolvable world refuses before anything is written, with the opt-out world mapped to the contract whose table count governs it | The derivation's own provenance, including which links were independently checked and which were not, is carried in the code comments rather than here |
| **Runner neutrality** | Before-and-after installer runs for `observed67` and `observed67_optout` exit zero with byte-identical plans and artifacts, the only differences being source-pin records declared before the runs | It proves the change altered **what gets checked**, not what gets built. It is not a hosted installation |

## What is open, and what comes next

**B10 is the next task.** It adds `hiring_practical_test_jobs` to the admission
guard list and re-derives the retirement trigger contract blob against a real
PostgreSQL 17.

**Why it was held until B9 landed, and why the order is not arbitrary.** The
installer asserts `production_retirement_contract_assert_v1` twice, and that
function compares the live admission triggers against a frozen expected blob.
Adding the table adds two triggers, so doing B10 before the blob was re-derived
would have made **step 14 refuse**. The ordering recorded as D12 is: hiring
migration on main (done), profile re-derived (B9, done today), then the guard
list. B10 is now unblocked and is the first thing to pick up.

B10 does not block the install by itself: the admission guard installs **open**,
verified in the migration source, and is inert until something explicitly closes
it. An earlier note calling B10 "blocked on PG17 access" was wrong and is
corrected in the record; the sandbox lacked a package repository, not a server,
and PostgreSQL 17 installs there cleanly.

Still open, in the journal's live list:

- **B2** — step 8 is incomplete. The fresh full-catalog hash and the direct
  TLS check are what remain; identity and profile are already confirmed.
- **B3** — the fourteen inaccessible Drive references. Deferred by owner
  decision, past the merge. Does not block the dormant install.
- **B5** — no captured compatible browser and function versions with an
  executable restoration route before the merge. The capture block's **dry run**
  passed under PowerShell 7; the block itself refuses loudly on PowerShell 5.1
  rather than producing a wrong hash. The block is **not** the same as the
  capture, which must be taken from main's tip immediately before the exit
  merge, because every merge republishes Pages.
- **B8** — the recovery procedure does not say what rollback means for a
  brand-new function. `notify` has no previous version, so rollback means
  removing it or leaving it inert, not restoring. The procedure should say
  which.
- **B6/B7** — C1 exists: frozen `0aa5954` matched all twelve functions that
  have deployed versions, and remains an ancestor of frozen main. It does not
  close B5.

## Working rules this record earned the hard way

These are not general advice. Each one cost a real defect, most of them on
2026-09-16, and a session that does not know them will pay for them again.
The house-standard short forms live in `AGENTS.md`.

1. **A search proves what it found. It never proves what it did not find.** A
   clever pattern finds the forms you expected. Closing a set needs a second
   search of a different shape, reconciled against the first. A clever regex
   found one site where the count was restated as a literal; a dumb search for
   the bare number found nine.
2. **A rewrite is not a refactor.** Rewriting a file wholesale deletes every
   warning in it by default and re-adds only what you remembered. Diff it
   against what it replaces and say which constraints were dropped and why.
   This was learned by writing an owner sitting page that ordered steps the
   wrapper it was documenting could not run.
3. **A reviewer's correction is a hypothesis, not a fact.** Verify it against
   the code before applying it, and say what you verified. A supervising review
   found a real defect and also stopped one site short of the nine that existed.
4. **A block handed over in chat skips every check that work in the repository
   gets.** It is not swept, not reviewed, not run. Put it on a page, execute it
   as written from where the instructions say to stand, then hand over the page.
   Relaying someone else's block unchecked is the same failure.
5. **A claim about a set needs evidence from every member of it.** "The two
   existing profiles are unaffected" was true of one of them, and the other was
   broken for hours behind a generic error.
6. **A sentence describing a precondition is not a check of it.** Prose plus an
   enforcing callee is fine; prose plus an unguarded primitive is a defect.
7. **A composite claim is only as verified as its weakest part**, and **never
   write a hash you did not read in full from a command's output.**

## Remaining before installation day

Complete Storage custody in a freshly confirmed quiet window (20-30 minutes capture/readback plus transfer), or make it the first day-of task before freeze. **Update 2026-09-15:** the capture itself passed; what remains is the owner's upload, second-device download, hash compare and downloaded-copy restore of the packed archive. **Update 2026-09-16:** Storage custody is complete for step 1 on the owner's acceptance of a same-machine Drive round trip plus a full decrypt; it carries the permanent no-separate-device caveat recorded under B1. Separately, the live database is ahead of main (journal B9): re-derive the catalog profile once, after the hiring migration lands on main, then run steps 8, 9 and 10 back to back. **Update 2026-09-16:** the hiring migration is on main at `1abdd1fa`, so B9 is unblocked, and it is larger than a re-pin — the plan builder refuses any starting catalog but the reviewed one, and the hiring delta spans six object classes. Route, runnable derivation and the knock-on to the install operator's hard-coded post-install table count are in [B9 catalog re-derivation](LINEAR_EXIT_B9_CATALOG_REDERIVATION.md). This is the long pole before the install gate (step 13) is reachable. **Update 2026-09-16, B9 CLOSED:** the settled catalog was derived, its contract authored and byte-confirmed, the `settled68` profile pinned on both its plan and its target, and the post-install table count is now derived rather than hard-coded. See the closure table above. The freeze still holds. **It is not itself what lifts the freeze** — B9 lands on the branch, not on main, and the freeze holds until the installation and release are finished. Corrected 2026-09-16; the earlier wording said "freeze-lift dependency", which is looser than it should be. Ensure private evidence and recovery records are available to the operator. Resolve the website dependency closure items below before claiming full independence. The recovery procedure now documents database/Pages/function routes and limits. Confirm managed restore availability and the previous-version recovery record at the day-of gate; isolated restore evidence alone does not prove live recovery. **Update 2026-09-16:** managed restore availability is confirmed and B4 is closed — eight daily PHYSICAL backups, Restore control present and enabled, PITR still declined. The restore's outage duration is recorded as UNKNOWN, deliberately un-estimated, and database backups exclude Storage objects. A no-risk way to measure the duration, and to settle whether the installer's identity value survives a restore, is proposed but NOT adopted in [restore to new project](LINEAR_EXIT_RESTORE_TO_NEW_PROJECT_PROPOSAL.md); the reviewed recovery procedure is unchanged.

## Remaining on installation day

Follow the [single runbook](LINEAR_EXIT_INSTALLATION_DAY_20260914.md): completed Storage custody, freeze and one main catch-up, 12 green checks, fresh catalog/identity, database backup refresh and downloaded-copy restore, authorized dormant SQL installation, coordinated merge and Edge release, separately approved one-line n8n fix, then separately authorized capability acceptance. New controls remain dormant until accepted; preserve existing normal behavior.

Storage captured earlier must still cover files needed at cutover; account for intervening changes. New main/schema changes require classification, not arbitrary re-pinning. The 13-function Edge lane requires its SHA already on main and does not deploy the separate Calendar/Samples composers, follow-up or diagnostics components. Complete those release prerequisites before accepting the corresponding capability.

## Decisions waiting on the owner

- Actual quiet Storage window; no service or automation pause is assumed.
- Exact installation revision/window and coordinated Pages/main-push/manual Edge interval; no merge, deployment, install or dispatch is authorized now.
- In the execution session itself, a separate go-ahead for the one-line n8n edit and any needed recovery. This is the only permitted proposed n8n change; all others stay untouched.
- Capability activation, compatible recovery/containment actions and an internal TEST destination if delivery testing is proposed. No client messages are authorized.
- The 14 optional file decisions. No substitution or deletion is assumed.
- Actual Linear retirement would require a new, separate decision. It is outside the current website-only scope, even if considered much later. No credentials, billing, account, data or Linear-side integrations are to be changed.

## End-to-end review: remaining website dependencies

SOURCE_ONLY search of the current browser, Edge functions, scripts and scheduled workflows found the following provider routes. This is a source inventory of concrete paths, not a hosted reachability proof or a claim that every textual Linear reference is active. Revalidate changed source at the frozen-main catch-up.

| Path found | Required closure before website independence |
| --- | --- |
| Workload: index.html LINEAR_ISSUES_WEBHOOK, LINEAR_TWEAK_COMMENTS_WEBHOOK and WORKLOAD_LINEAR_URL calls; workload-linear function | Native snapshot/metadata/comment/due-date paths must cover legacy and foreign-team rows, or the remaining route needs an explicit product decision. Verify old paths cannot be reached for supported work. |
| Intake: VIDEO_FORM_WEBHOOK and legacy dispatch selection | Prove accepted native intake routes and durable follow-up cover supported submissions without falling back to the legacy provider workflow. |
| production-write provider label/metadata branches and Linear credential reads | Verify exact native label/intake/assignment configuration and route selection, with no required provider request. Dormant flags do not establish this. |
| Legacy urgent editor assignee lookup | Removing the displayed URL leaves the Linear lookup input intact. Accept/reroute to the native urgent sender before claiming independence; do not make an additional n8n edit. Preserve normal alerts without duplicates. |
| linear-inbound / linear-outbound and b1-linear-incremental-refresh, linear-deliverables-reconcile, linear-outbound-drain schedules | Establish the website-side gates/authority and zero pending provider-bound work; prove legacy inbound/mirror work cannot overwrite native state or remain required. Do not disable unrelated automations or modify Linear itself. |
| Historical Linear import/link UI and retained URL fields | Distinguish optional historical references from required fetches. Any still-supported import that needs Linear must be explicitly replaced, excluded by owner decision or documented as a remaining dependency. |

### Step 28 closures recorded so far

One row per capability that has finished step 27. A capability appears here only
after every one of its acceptance checks is measured; a flag being on is not a
closure.

**One exception, added 2026-09-19 and marked so it cannot be mistaken for a
closure:** a capability whose step 27 is being run right now may carry a
**pre-written** entry — the form, with every measurement left as an unfilled
`«…»` placeholder and a ⛔ header saying it closes nothing. It becomes a closure
when the placeholders carry measurements and its ⏳ becomes ✅. The section
heading still means what it says: **only the ✅ rows are recorded closures.**

#### Labels — `production_native_label_catalog`, recorded 2026-09-18

> **Withdrawn and restored the same day, and both are on the record.** This
> closure was first written while acceptance check 6 was two of its three
> refusals — a Codex P1 on #1420 caught it and it was marked withdrawn. Check 6b
> has since been measured offline and its clause amended to accept either
> refusal code, so step 27 is complete and this closure stands. Nothing in the
> body below changed: the gate, the replacement, the bounded sense of
> "unreachable" and the scope limits were never what was wrong. Only its
> completeness was.

| | |
|---|---|
| **Table row it acts on** | *"production-write provider label/metadata branches and Linear credential reads"* — the **label** half only. See the scope note below. |
| **The exact gate** | `production_label_catalog_capability()`. It returns `native` only for a runtime flag row of `{"schema_version":1,"mode":"native","version_id":…}`; `provider` and `hold` are the other two modes. Live since **2026-09-18T20:02:56Z** on catalog version `f55a7dd2`, deployed at `b7c30c74` with `production-write` **v77**. |
| **The accepted replacement** | The staged and attested catalog in `production_label_catalog_versions`, served through `production_label_catalog_read_version` and read by `production_label_catalog_read_attested`. The read path makes **no Linear request at all** (`index.ts:5608-5618`, check 1, seen by the owner). The write path fingerprints one full set, commits canonical native nodes under CAS, and returns that selected set; `zzz_native_label_receipt_guard` on `mirror_outbox` holds the receipt shape. Proven by step 27 checks 1, 2 (receipts **10536**, **10537**), 3, 4 and 6-409 (receipt **10579**, journal `edf78a6a`), 5, 6-403 (offline, `test/production-write-gateway.js`) and 7 (video, then graphics on receipts **10575** and **10576**). |
| **Why the legacy route is unreachable** | For supported label work, while the capability is `native`: the provider branch is selected by this one gate and nothing else consults the provider catalog on either the read or the write path, so no supported label operation can issue a provider request. The refusals fire rather than falling back — a `native` mode with nothing staged answers **503** from `production_label_catalog_read_attested` instead of reaching Linear, and a client principal is refused **403** before any route is chosen. |
| **What that does NOT claim** | The provider branch is **switched off, not removed.** `mode:"provider"` still exists and is still selectable: that is deliberate, because `mode:"hold"` is the kill switch and the modes share one flag. So "unreachable" here means *no supported label operation reaches it while the capability is native*, not *the code path is gone*. Anyone who can write the runtime flag can reach it again in one statement, which is the property the rollback depends on. |
| **Scope: this row is only partly closed** | The same table row also covers **metadata branches, Linear credential reads, intake and assignment**. Labels closes none of those. The row stays open until the capabilities behind them finish their own step 27 and are recorded here. |
| **Not measured by this session** | Checks 1, 3 and 5 are the owner's and the supervisor's; checks 4, 6-409 and 7-graphics are the storage session's, whose primary record is journal `edf78a6a` — not reachable from this repository at the time of writing and therefore not read here. Only the 403 half of check 6 was measured in this repository. |

#### Ordinary receipts — `production_native_ordinary_receipts`, recorded 2026-09-19

> **Source: the storage session's step-27 readback, journal entry `09a7f579`.**
> That session holds the private evidence directories and the live read; this
> repository cannot re-derive these counts, and does not pretend to. The
> measurements below are recorded as that session reported them, exactly as the
> labels row records checks 4, 6-409 and 7-graphics from the same source.

| | |
|---|---|
| **Table row it acts on** | *"production-write provider label/metadata branches and Linear credential reads"* — the **metadata** half. Labels closed the label half; this closes the metadata half of the same row. |
| **Native since** | **2026-09-18T16:13:49Z.** |
| **What was measured** | **138 receipts, 10418 to 10595.** All terminal. All typed. **None without the native marker.** |
| **Criterion 6d — not zero, and why that is still a pass** | 41 failed rows exist. **All 41 predate the flip** (17 known, 24 test-only), so not one of them is a failure of the native path. The criterion is read as "no post-flip failures", which is the only reading under which a non-zero count can close: a pre-flip row is evidence about the route being replaced, not about the replacement. |
| **Why the legacy route is unreachable** | Same bounded sense as labels: the **provider branch is switched off, not removed.** For supported ordinary-receipt work, while the capability is native, the provider branch is not selected. It remains selectable, deliberately — that is the kill switch. |
| **What that does NOT claim** | It does not claim the provider code is deleted, and it does not claim retirement. **Retirement activation is a separate, later switch** and is not part of this closure. |

#### Assignment — `native_assignment_epochs`, recorded 2026-09-19

> Same source and same limit as the row above: the storage session's step-27
> readback, journal entry `09a7f579`.

| | |
|---|---|
| **Table row it acts on** | The **assignment** half of the same provider-branch row, named explicitly in the labels closure's *"Scope: this row is only partly closed"*. |
| **Native since** | **2026-09-18T16:29:34Z.** |
| **What was measured** | **11 receipts.** All terminal. All typed. |
| **Why the legacy route is unreachable** | The bounded sense again: provider branch switched off, not removed, and still selectable as the kill switch. |
| **What that does NOT claim** | No claim of deletion, and no claim of retirement. |

#### Identifier mint — `production_native_identifier_mint`, ⏳ FILLED 2026-09-19, **NOT RECORDED — one check open**

> ## ⏳ TWELVE OF THIRTEEN CLAUSES MEASURED. CHECK 7 IS OPEN, SO THIS IS NOT A CLOSURE.
>
> The form was written before the run and is now filled from it. **Step 27 is
> not complete**, because check 7 asks for a graphics allocation on **real
> work** and no organic graphics card has been created since the graphics flip
> at 03:27:59Z. Everything else passed.
>
> **This stays ⏳ until that card exists.** One unmeasured clause is exactly what
> the labels closure was withdrawn for, and the temptation here is stronger, not
> weaker, because twelve clauses passed and a test-client card was seen carrying
> a native graphics name forty minutes later (see the owner observation below).
> That sighting is real and it is not check 7.
>
> **Source, and what this repository measured for itself.** The step-27 results,
> the seeds, the flips and the backfill are the **storage session's**, journal
> **`e19e791c`**, recorded as that session reported them — the same standing as
> the labels and ordinary-receipt rows above. Where a value could be checked
> from here it was, read-only, and the two are distinguished throughout:
> **storage-reported** vs **corroborated here**. They agree everywhere, with one
> exception that is not a disagreement but a clock (see the graphics cursor).

| | |
|---|---|
| **Table row it acts on** | **Candidate, not established:** the **naming** half of the `linear-outbound` dependency — the reason lane F's outbound-off step is gated on this capability. The execution map's phase 7 table records this column as *unknown, verify* for the identifier mint, and **confirming it against this table is part of step 28, not an input to it.** If no row matches, the honest entry is that this capability closes no existing row and the table gains one. Note this is a **partial** entry either way: see the unreachability rows below — the row it acts on does not close at step 27. |
| **The exact gate** | `production_native_identifier_capability(p_team)`. It returns `native` only when the runtime flag says native for that team **and** a seed row exists in `production_native_identifier_mint` — the self-guard that makes a premature flip inert rather than half-armed, deliberately unlike `production_label_catalog_capability()`. **Native since: video 2026-09-19 (flipped between the 03:16:47Z seed and the 03:24:04Z observation; the flip's own timestamp was not reported and is not inferred here), graphics 2026-09-19T03:27:59Z.** Readback after the second flip returned `native` for both teams. Corroborated here: the flag reads `{"schema_version":1,"video":{"mode":"native"},"graphics":{"mode":"native"}}` and both teams carry a seed row, so both halves of the self-guard are satisfied. |
| **The accepted replacement** | The `zzz_production_native_identifier_mint` trigger on `public.deliverables`, allocating through `production_native_identifier_allocate` against a per-team cursor. Installed **2026-09-17**, bodies verified against the committed migration **2026-09-19** by `md5(prosrc)` per routine plus `prosecdef`/`provolatile`/`proconfig` and `pg_get_triggerdef`. Seeded, both teams, each arithmetically self-consistent:

| team | seeded at | prefix | observed max | gap | next_ordinal | check |
|---|---|---|---|---|---|---|
| video | 03:16:47Z | `VID` | 13,935 | 1,064 | 15,000 | 13,935 + 1,064 + 1 = 15,000 ✓ |
| graphics | 03:27:54Z | `GRA` | 7,559 | 440 | 8,000 | 7,559 + 440 + 1 = 8,000 ✓ |

Graphics was **hand-seeded by owner decision** (see the scope note): its own seed function refuses the team, and the `observed_provider_max` recorded is `GRA`'s own 7,559 — **not** the 12,851 the function would have derived from the `VID`-prefixed rows on that team. Both gaps were chosen to land the first native name on a round number. Corroborated here: all five columns on both rows, and both `seeded_at` timestamps, read back exactly as reported. |
| **What was measured — step 27, per check and per clause** | All from the storage session's run, journal **`e19e791c`**, unless marked corroborated. **1** ✅ capability returned `native` / `VID` / cursor 15,001 for video with **graphics still `provider`** at that moment — the per-team independence is in the measurement, not assumed. **2a** ✅ and **2b** ✅ on the test card: the stored `linear_identifier` and the matching row in `production_native_identifier_grants`. **3** ✅ owner-observed 03:24:04Z, card `del_670c2cb9` showed **`VID-15000`** in the Production list **without a refresh** — which also answers the procedure's one open code question: the create response carries the post-trigger name, so **no `production-write` change is needed** and the conditional Section 4 deploy sketched in the step 26 doc does not arise. **4a** ✅ cursor **15,000 → 15,001**, exactly one. **4b** ✅ cited from the offline proof (`qa/native-identifier-mint/sql-proof.js`, the 25-concurrent-allocation case) — not re-run against production, by design. **5** ✅ **path decided from the receipt, not by waiting**: the card came through **native intake**, receipt **10608**, so **5a–5c are NOT APPLICABLE** and are recorded as such rather than left blank; **5d** ✅ the plan was filtered from the drain, no Linear issue, the minted name stands. **6a** ✅ and **6b** ✅ — the reseed refusal (`native_identifier_already_seeded`) and the invalid-team refusal (`native_identifier_team_invalid`), both exercised **inside rolled-back transactions**, so the refusals were proven without moving a cursor. **6c** ✅ `native_identifier_prefix_ambiguous` on graphics, run at order-of-operations step 5 **before graphics was seeded** — the one check that becomes unmeasurable if it is not taken first, and it was. **7** ⏳ **OPEN**, see below. |
| **⏳ Check 7 is the one open clause, and what would close it** | Check 7 asks for the capability proven **on both teams, on real work**. Video has it. Graphics does not: no organic graphics card has been created since the flip at 03:27:59Z. It closes on the **first organic graphics card after 03:27:59Z** — repeat 2a, 2b and 4a on it and record the identifier. Nothing else is outstanding. |
| **Owner observation, 03:40Z — corroborating, and explicitly NOT check 7** | A **Thumbnail-only test post on the test client** showed **`GRA-8021`** in the Production list. It is genuine: corroborated here, that identifier is in `production_native_identifier_grants` against a single card, and it is the next ordinal after the backfill's last. So the graphics mint is demonstrably allocating from its seeded band through the normal Create Post path. **It does not close check 7**, because check 7 says real work and this is a test-client post created to look at the result. Recording it as the check would be closing a clause on the nearest available measurement — the exact move that withdrew the labels closure. It is kept here because it is real evidence, under its own name. |
| **⚠ The graphics cursor moved after the final readback — the readback was right when taken** | Storage's verbatim final readback: **video `next_ordinal` 15,025, graphics `next_ordinal` 8,021**, taken at the backfill (~03:29Z). Corroborated here at ~03:55Z: video **15,025** (identical), graphics **8,022**. **That is not a disagreement.** The 03:40Z thumbnail post consumed `GRA-8021` and advanced the cursor by one, exactly as designed. Both numbers are correct for their moment, and the pair is itself evidence the mint is live. Recorded because a later reader comparing two honest readbacks would otherwise see a contradiction where there is a clock. |
| **Corroborated independently from this repository** | Read-only, ~03:55Z. **47 grants; 47 rows carry the exact identifier their grant names** — one-to-one, no orphan grant and no card wearing a name that is not its own. `count(distinct deliverable_id)` equals the grant count on both teams (video 25, graphics 22), so no card was handed a second name. **`provider_identifier_refused` is null on all 47**, consistent with check 5's finding that nothing has drained to the provider. **Zero rows in `deliverables` remain without an identifier**, down from the 45 measured before the run. Video grants span `VID-15000`–`VID-15024`, graphics `GRA-8000`–`GRA-8021`. |
| **The backfill — ✅ RUN 03:29Z** | Owner decision 2026-09-19: yes, and it ran. **Video: 24 rows named `VID-15001`–`VID-15024`. Graphics: 21 rows named `GRA-8000`–`GRA-8020`.** Both ranges are contiguous and their sizes match the cohort measured before the run (24 video, 21 graphics, 45 total). One-to-one verified. **No card that already carried a name was changed**, **no outbound row was produced**, and **no notification was sent** — the three things a mass `update` on `deliverables` could have triggered and did not. Corroborated here: zero rows remain without an identifier, and `count(distinct deliverable_id)` equals the grant count on both teams. **This was never a step 27 check**, but it is why the surface #1419's truncation was shipped for is now actually repaired rather than merely fixed-for-new-cards. |
| **⚠ Incident during the run — a flag stored as a JSON string for 16 seconds** | Storage's step 7, journal **`c2d24fd3`**. The runtime flag was written as a JSON **string** rather than a JSON **object**, noticed and reverted within **16 seconds**. **No card was created in the window, so nothing was affected.** It is recorded anyway, because the failure mode is worth knowing and is not the one people would assume: `production_native_identifier_capability` opens with `if jsonb_typeof(v_value) is distinct from 'object' … raise exception 'native_identifier_config_invalid'`, and the trigger calls it on **every** insert of a video or graphics row. So a malformed flag does **not** degrade to the provider lane and does **not** sit inert — it **raises, and card creation fails outright** for both teams until the flag is valid. That is the correct design (a flag nobody can parse must not silently pick a lane), but it means **a malformed flag is a creation outage, not a no-op**, and the only reason this one cost nothing is that no one happened to create a card in those 16 seconds. Anyone editing this flag should write the object and read it back before walking away. |
| **Why the legacy route is unreachable** | ⛔ **THIS ROW CANNOT BE FILLED AT STEP 27. It is deferred to lane F's outbound-off step, by construction.** An earlier draft of this form expected "the same bounded sense as every row above — provider branch switched off, not removed". **That is false for this capability and a review caught it before it could be recorded.** The other closures switch a branch off: the provider code is not selected. **This one does not.** While `linear_outbound_enabled` is `live`, a draining card still goes to `mirror_outbox`, `linear-outbound` still creates the Linear issue, and `production_issue_create_linkage` / `deliverable_write` still submit its identifier (`linear-outbound/index.ts:834-869`). The provider mint **still runs and still mints at Linear**; all the trigger does is refuse to let the result land on a row that already holds a native grant. So what this capability changes is *whose name wins*, not *whether the provider route executes* — and the draining branch that checks 5a–5c exercise is the direct observation of it. The route becomes unreachable when **outbound is switched off**, which is a separate later step this closure is a prerequisite for. |
| **What this closure therefore claims, and what it is for** | That the estate can **name its own cards without Linear** — the prerequisite lane F's outbound-off step is gated on. Nothing more. Two properties specific to this capability, stated rather than inherited: **(a)** name stability is **not** flag-gated — once a row carries a name from the grants table the UPDATE branch refuses a provider overwrite whatever the flag says, so flipping back to `provider` stops new minting and renames nothing; and **(b)** provider-named rows are **not** protected, so `linear-inbound:810` keeps refreshing them normally while Linear is connected. |
| **What that does NOT claim** | No claim that the provider mint code is deleted, **and no claim that it is not running** — see the row above. No claim of retirement, a separate later switch. And **no claim that outbound is off**: at the time of writing `linear_outbound_enabled` is `{"mode":"live"}`. |
| **⚠ Do not record this capability as closing its dependency row until outbound is off** | The table row this acts on stays **open** after step 27, with this capability recorded against it as *replacement built and proven, legacy route still live*. Writing "unreachable" here on the strength of a green step 27 would mark a dependency closed while the code behind it is still executing on every draining card — the exact overclaim the labels withdrawal was about, one level further out. |
| **Scope: the hand-seed is an override and is recorded as one** | Graphics could not be seeded by its own function — two prefixes on the team, so `production_native_identifier_seed` raises `native_identifier_prefix_ambiguous`. The owner chose the hand-seed from `GRA`'s own maximum (**7,559**) rather than the 12,851 the function would have derived from the contaminated set. **The twelve `VID`-named graphics rows still exist and are unrepaired**; the team/provider disagreement behind them is untouched by this closure and stays open. |
| **Scope: the first flip is estate-wide** | The flag is keyed by team, not by client, so the first native name on a team could land on any client's card. Accepted by the owner 2026-09-19 as a timing decision rather than a scoping one. Recorded because the standing constraint *"mutate only the test client"* was knowingly set aside here, and a closure that does not say so misrepresents how the evidence was obtained. |
| **Not measured by this session** | Every step-27 check, the seeds, the flips and the backfill are the **storage session's** (journal `e19e791c`); the step 7 incident is its journal `c2d24fd3`; check 3 and the 03:40Z sighting are the **owner's**. This repository independently corroborated only the **end state** — the flag, both seed rows, all 47 grants, the one-to-one card/grant correspondence, the empty nameless cohort and the two cursors. **That corroboration is consistency, not provenance:** it shows the database is in the state the run describes, and it cannot show that the checks were run the way they are written. The two are recorded separately above for that reason. |

#### Open notes carried forward from the recorded closures

These are recorded as open rather than resolved, because closing step 28 is not
the same as having nothing left to watch.

1. ~~**The calendar bridge trigger has not yet been observed on a genuine editor
   change.**~~ **CLOSED 2026-09-19.** The trigger fired correctly on **six real
   editor changes between 00:50Z and 00:56Z on 2026-09-19**. The bridge is now
   correct-by-measurement on genuine work, not only by construction. The note is
   struck through rather than deleted, because what it was worth is the record
   that a live mechanism went a day unobserved, and how long that took to close.

   What remains after it is a different thing and should not inherit its name:
   the trigger projects a CHANGE and does not reconcile history, so the cards
   already behind when it was installed are still behind. The watcher's first
   live run measured that as 25 of 27 slots, last changed between April and
   2026-08-24, and now buckets them as **pre-bridge** — counted and listed,
   never gating. Clearing them is `production_native_calendar_status_backfill`,
   which has still never been run (OPEN_REPAIRS 212).
2. **Retirement activation is a separate later switch**, not implied by either
   closure above and not scheduled by them.
3. **`production_syncview_retirement_activate_v2` exists — and whether it is the
   replacement the repair spec's definition of done means is UNRESOLVED here, on
   purpose.** Both versions are in the repository:
   `production_syncview_retirement_activate` in `migrations/`, and `..._v2` in
   `supabase/migrations/20260913062149_retirement_switch_preparation.sql`
   (referenced by `test/linear-exit-retirement-switch-postgres.js` and
   `test/linear-exit-observed-full-pipeline.js`). No phrase "definition of done"
   was found anywhere in `docs/` from this sandbox, so the question is flagged
   for whoever holds the repair spec. **This note decides nothing and authorises
   nothing.**

Therefore the dormant installation plus the one-line n8n edit does NOT, by itself, finish website independence. Capability acceptance must explicitly close these paths. Actual Linear retirement cannot be used as a shortcut for missing website replacements.

## Recovery review and approval limits

The runbook now names stop/recovery paths for capture, merge conflicts, SQL interruption, partial browser/Edge release, the n8n edit and capability acceptance. Two concrete day-of prerequisites remain: an executable hosted database recovery route if journal resume cannot finish, and captured compatible browser/function versions with an executable restoration route before merge. Without those, a failed SQL or partial release could leave maintenance protection or mixed versions with no ready operational restoration. Stop before mutation until those routes are established. Never overwrite newer accepted saves with a stale snapshot or blindly retry uncertain external effects.

No runtime action is approved by this checkpoint. The proposed sequence is sound with its explicit prerequisites; full end-to-end readiness is not yet proven. Preserve all existing normal notification behavior, tokenless review access, and everything inside Linear.

## Supporting documents and current proof manifests

- [Installation runbook](LINEAR_EXIT_INSTALLATION_DAY_20260914.md), [owner before/after](LINEAR_EXIT_OWNER_BEFORE_AFTER_20260914.md), [release matrix](LINEAR_EXIT_RELEASE_MATRIX_20260912.md), [urgent link review](LINEAR_EXIT_URGENT_LINK_VERIFICATION.md).
- [Installer profiles/proof](../independence/LINEAR_EXIT_INSTALL_OPERATOR_PG17_20260914.json), [full installation pipeline](../independence/LINEAR_EXIT_OBSERVED_FULL_PIPELINE_20260913.json).
- [Switch proof](../independence/LINEAR_EXIT_RETIREMENT_SWITCH_PG17_20260913.json), [recovery proof](../independence/LINEAR_EXIT_CONTROL_RETIREMENT_PROOF_20260913.json), [online-sequence backup proof](../independence/LINEAR_EXIT_NATIVE_ONLINE_SEQUENCE_PG17_20260914.json).
- [Notification handover/recovery](NATIVE_NOTIFICATION_HANDOVER_PREPARATION_20260912.md), [follow-up supervisor](LINEAR_EXIT_FOLLOWUP_SUPERVISOR.md), [repository recovery requirements](../../ROLLBACK.md).

## Main catch-up rehearsal

Fetched main once at 73d5fdc361b202a185bb9ba7425e906c126585b8, including PR #1393. Source branch remained at 3ae2f573037f31b9dfb40880ef0999402863a232 during rehearsal. No repeated main integration is requested before installation day.

The isolated combination identified exactly three conflicts: Section 4 deploy workflow, its test and EXECUTION_LOG. Snapshot 4f1756606250dd10f4b63cf0f4d59962229555ac / tree d9c6d024d571c894f014de77c8f1360c91b01164 passed the deploy-lane, workload placement, workload source, workload bucket and identity-exposure checks. The page and production-write combined cleanly and retained #1393's work. This snapshot is local rehearsal evidence, not the published branch or hosted build.

Combined production-write fingerprint: 4e716d1008d992d4681d91b59dd8e0f325c24b2f45de48f7aff1b85fc42f4b7b; six files; entrypoint 7a3136a65709c21c4b07d9b18873f8eb6732766fdd9b5c5c0677a4f69f849de5. These are rehearsal values, not future day-of pins. Regenerate after the one frozen-main catch-up.

The catch-up helper resolves only those reviewed conflict shapes. Its separate staging mode checks the real merge identity, clean isolated snapshot, tree and hashes, expected index stages and unedited conflict files before staging. It does not merge, commit or push. See the exact [installation-day procedure](LINEAR_EXIT_INSTALLATION_DAY_20260914.md).
