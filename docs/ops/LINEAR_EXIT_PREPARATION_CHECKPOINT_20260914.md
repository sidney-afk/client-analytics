# Linear exit preparation: living checkpoint

Emergency entrypoint: [database, website and function recovery](LINEAR_EXIT_RECOVERY_PROCEDURE.md). Read this before authorizing the installation window.

**Read second, after this file: the [running journal](LINEAR_EXIT_JOURNAL.md).** This checkpoint says where we are; the journal says how we got here and why. It carries the progress log, the live blocker list, and every decision with its reasoning and who made it. Read its decisions section before changing anything that looks settled, so you do not relitigate or silently undo a call that was already made. Update it as part of finishing a step, append only, corrections below originals.

Owner keyboard sitting for steps 8, 9, 10 and 11: [owner sitting page](LINEAR_EXIT_OWNER_SITTING_20260915.md). **Step 1 is closed** (2026-09-16, owner acceptance) and is no longer in that sitting; the B9 settled-catalog derivation, the B4 dashboard check and the deliberately-not-today B5 browser capture are. One ordered page with the exact command for each, what output means it worked, timings, what to have on hand before starting, and where it is safe to stop. The one clock in that page is the catalog read: it expires after an hour and must be immediately followed by the database refresh, so nothing goes between them. Everything else on the page can slip to another day without loss.

This is the single entry point. Keep updating this file; 20260914 in its filename is its creation date, not a promise that every observation is fresh. Historical documents are supporting evidence, not competing checklists.

## Current branch, PR and published revision

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

## Remaining before installation day

Complete Storage custody in a freshly confirmed quiet window (20-30 minutes capture/readback plus transfer), or make it the first day-of task before freeze. **Update 2026-09-15:** the capture itself passed; what remains is the owner's upload, second-device download, hash compare and downloaded-copy restore of the packed archive. **Update 2026-09-16:** Storage custody is complete for step 1 on the owner's acceptance of a same-machine Drive round trip plus a full decrypt; it carries the permanent no-separate-device caveat recorded under B1. Separately, the live database is ahead of main (journal B9): re-derive the catalog profile once, after the hiring migration lands on main, then run steps 8, 9 and 10 back to back. **Update 2026-09-16:** the hiring migration is on main at `1abdd1fa`, so B9 is unblocked, and it is larger than a re-pin — the plan builder refuses any starting catalog but the reviewed one, and the hiring delta spans six object classes. Route, runnable derivation and the knock-on to the install operator's hard-coded post-install table count are in [B9 catalog re-derivation](LINEAR_EXIT_B9_CATALOG_REDERIVATION.md). This is the freeze-lift dependency. Ensure private evidence and recovery records are available to the operator. Resolve the website dependency closure items below before claiming full independence. The recovery procedure now documents database/Pages/function routes and limits. Confirm managed restore availability and the previous-version recovery record at the day-of gate; isolated restore evidence alone does not prove live recovery. **Update 2026-09-17:** managed restore availability is confirmed and B4 is closed — eight daily PHYSICAL backups, Restore control present and enabled, PITR still declined. The restore's outage duration is recorded as UNKNOWN, deliberately un-estimated, and database backups exclude Storage objects. A no-risk way to measure the duration, and to settle whether the installer's identity value survives a restore, is proposed but NOT adopted in [restore to new project](LINEAR_EXIT_RESTORE_TO_NEW_PROJECT_PROPOSAL.md); the reviewed recovery procedure is unchanged.

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
