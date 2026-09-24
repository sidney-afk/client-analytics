# Installation recovery: stop, choose the route, verify

This procedure is prepared, not executed. It grants no permission to merge, deploy, restore production data, dispatch workflows, send notifications or change n8n. The owner authorizes each real recovery and any data-loss decision in the execution session. Keep private records under D:/Sidney/Codex/2026-09-13-final-review-repairs. Start from the [living checkpoint](LINEAR_EXIT_PREPARATION_CHECKPOINT_20260914.md).

## First two minutes

1. Stop advancing the installation. Record the last successful step, exact deployed versions, failed response, time and SQL journal prefix. Do not retry an ambiguous write or deployment.
2. Tell the owner whether saves are still accepted, refused or uncertain. Do not assume closing the browser stops other writers. Any containment of writes/workers needs its own authorized, effective boundary; preserve existing SQL maintenance guards. No n8n pause or edit is implied.
3. Preserve current database evidence and accepted-save/notification receipts before any rollback. Never erase uncertain work to make the system look clean.
4. Choose the route below. If the prerequisite evidence is missing, stop for the named operator; do not improvise a destructive command.

## A. Database recovery

**Trigger:** SQL cannot finish safely through the exact journal/prefix resume, or verification shows data/schema corruption. A failed browser build or Edge deployment alone is not a reason to rewind the database.

**Proven:** the encrypted public-schema backup restores into an owned, isolated PostgreSQL database and matches catalog, rows and archive sequence state. **Not proven:** hosted in-place restore, hosted downtime, all platform/Auth/Storage recovery, or replay of saves made after that snapshot.

**Important tooling limit:** our scripts/linear-exit-native-preinstall-backup.js restore function deliberately requires loopback and verifies the local cluster identity. It cannot restore its encrypted package into the live project. The package covers 67 public tables, not a full Supabase project. There is no reviewed generic live overwrite command for it; changing the hostname or using pg_restore --clean against production is not this recovery procedure.

> **Update 2026-09-16, storage session.** "67 public tables" was the 2026-09-12 world. The module no longer hard-codes a count. A capture takes the count from the reviewed catalog it expects: 68 for the settled live world. A restore takes it from the backup's own authenticated manifest, which must agree with that manifest's evidence. **Every earlier 67-table package still restores; this was measured** on both 2026-09-14 packages. **A 68-table package needs this code:** older copies of the module refuse it with `NATIVE_BACKUP_MANIFEST`, loudly. Full record: journal entry "Backup path: the expected table count now comes from the world".

### Closest real live-project route: Supabase-managed backup/PITR restore (UNTESTED here)

Read-only Management API observation on 2026-09-14 found eight COMPLETED managed backups; the latest record was inserted at 2026-09-14T11:26:28.793Z. PITR was disabled. This confirms backup listing availability, not permission to restore or a successful restore. The listed insertion time is not a proven transaction-exact recovery cutoff; inspect the actual eligible recovery point in the Dashboard. Recheck on installation day. Evidence: managed-backup-availability-20260914.private.json in the private directory.

**Operator/prerequisites:** the owner or explicitly designated database operator must have the correct project's Dashboard restore permission. Before installation, open [Supabase Dashboard](https://supabase.com/dashboard), select the private-recorded project, then Database > Backups. Record available backups, restore permissions and an eligible recovery time before installation. PITR is usable only if already enabled and the time is available; do not assume upgrading creates historical coverage. No plan upgrade is authorized by this document. This route restores a Supabase-managed backup, NOT our encrypted archive.

1. If the database remains readable, preserve its current state and independently enumerate accepted saves and pending/uncertain effects since the proposed restore point. Capture schema, relevant receipts and current sequence state. If reads fail, record that the loss set is unknown.
2. Present the owner with the exact restore timestamp, expected outage and the newer saves that would be removed. Choose explicitly: preserve/reconcile those saves, repair forward, or accept the stated loss. **Overwriting newer accepted saves requires the owner's decision; it is never automatic.** Unknown loss is also an explicit decision, not assumed zero.
3. Inventory external writers and database replication/subscriptions. Establish the separately authorized write boundary and record how each writer will remain contained after restore, since restoring runtime flags can itself reopen old behavior. Never delete or pause an unrelated integration by inference.
4. In Database > Backups select the eligible pre-incident backup, or the available Point in Time restore point. Recheck project and timestamp, review the confirmation, and only then have the authorized operator confirm Restore. Wait for the platform to report completion. If permission, eligible backup or restore control is absent, STOP; this route is unavailable. Contact [Supabase support](https://supabase.com/dashboard/support) with private project/operation evidence rather than issue a custom destructive SQL restore.
5. After completion, keep business writes contained until identity, expected catalog, required functions/grants, sequence validity, runtime authority and affected saved records are checked. Compare against the selected managed restore point; it may differ from the encrypted archive timestamp. Verify Auth and Storage references separately, then only approved internal TEST saves. Do not send client messages.
6. Reconcile newer accepted saves from preserved evidence under a reviewed, owner-approved repair. Reconcile provider receipts before retrying any uncertain external effect; restoring the database cannot retract a Slack message or another already-completed external action. Reopen only after compatibility checks and explicit approval.

**Time:** no hosted measurement or guaranteed ETA exists for this project. The project is inaccessible while the restore runs; duration depends on database size. The isolated restore time is not an estimate of this outage. Before authorizing the outage, obtain the available platform estimate/support guidance and allow additional verification/reconciliation time.

**Loss/risk:** writes newer than the selected point are absent unless separately recovered. Managed database restore does not restore Storage object bytes; compare against separate file custody. Auth/configuration and external side effects need separate validation. Custom-role passwords and non-Realtime replication arrangements can require restoration work. These are platform caveats, not permission to change them. [Supabase backup/restore documentation](https://supabase.com/docs/guides/platform/backups).

### If only the encrypted archive is available

Use the existing private restore command to recover and inspect it locally; keep the live project unchanged. A qualified operator can use that verified data to design a targeted forward repair or separately tested managed-project import. Neither full live import nor replacement-project cutover is built/tested here; both need schema/platform mapping, validation and owner approval. Do not call this a ready emergency full-project restore. If managed restore is unavailable and journal recovery is insufficient, remain stopped and obtain database support before installation or further mutation.

## B. Website recovery

**Trigger:** Pages publishes a broken browser while database/function state is otherwise compatible. Prefer a browser-only recovery over rewinding valid saves.

**Prerequisites/operator:** owner-authorized repository operator with PR/merge rights; privately captured previously served index.html and every changed browser asset, their SHA-256 hashes, the matching previous Git commit and the current served revision. Capture these immediately before the release. An old branch name or Git checkout alone does not prove those bytes were served. Check the old browser against the currently installed SQL/functions before restoring it.

1. From a clean checkout of the current main create a recovery branch. Use the captured, hash-matched previous commit to restore only index.html and the reviewed browser-asset set. If the capture does not match a Git commit, restore the exact captured bytes instead. Do not revert the entire migration or unrelated owner's work.

```powershell
# "the current main" is the reviewed requirement in the line above. origin/main
# is only as current as the last fetch, so fetch it, and REFUSE rather than fall
# back to a stale local ref -- during a recovery a network problem is exactly
# when that would happen, and branching from an old main would publish it and
# silently revert everything merged since.
git fetch origin main
if ($LASTEXITCODE -ne 0) {
  throw "REFUSING: could not fetch origin/main. Do not continue on the local ref; it may be stale, and publishing from a stale main reverts every merge since it."
}
# Print what you are about to branch from, and look at it before continuing.
"branching from: " + (git rev-parse origin/main).Trim() + "  " + (git log -1 --format='%ci %s' origin/main)

git switch -c recovery/linear-exit-browser origin/main
git restore --source=<verified-previous-browser-commit> -- index.html
# Restore each changed browser asset from the same verified capture as well.
git diff --check
git diff --stat
```

2. Compare every restored file hash with the captured manifest; review that no backend/workflow file changed. Commit and publish the recovery branch as a PR targeting main. Only the separately authorized owner merges that browser recovery PR. This current preparation does none of those actions.
3. The existing main:/ GitHub Pages source rebuilds and publishes the recovered browser. Watch the [repository Actions page](https://github.com/sidney-afk/client-analytics/actions) and [Pages settings](https://github.com/sidney-afk/client-analytics/settings/pages); do not assume a Git merge is already served.
4. Download the served page/assets without cache and compare hashes with the capture. Open a fresh browser session and verify boot, reads and the explicitly approved save checks. Existing tabs can keep old JavaScript; request reload for the operator's test session. A green Pages build alone is insufficient.

**Time:** GitHub documents up to 10 minutes for publication after a push, plus review/build queue and verification time. Existing tab/CDN cache convergence is not measured here. [GitHub Pages publication guidance](https://docs.github.com/en/pages/getting-started-with/github-pages/creating-a-github-pages-site).

**Loss/risk/status:** no stored saves are rewound by this code-only recovery. Unsaved browser drafts and cached sessions remain at risk; old UI may be incompatible with newly accepted native data or functions. The mechanism is established, but this exact release's live rollback and cache convergence are **UNTESTED**. Restore compatible function behavior or repair forward if the old browser is incompatible.

## C. Function recovery

**Trigger:** a function deployment fails, its readback/JWT fingerprint differs, or approved save verification exposes a regression. Record every function actually changed before choosing a route; a failed workflow can already have deployed some functions.

**Operator/prerequisites:** owner-authorized release operator with the protected production Environment and Supabase deployment permission. Before the forward release, privately capture each of the 13 served source/dependency closures, current version, source fingerprint, entrypoint-path hash, file count, verify_jwt and relevant configuration. Keep secrets private. Pin the capture manifest and independently verify its bytes. Candidate pins are not previous-serving pins.

### Previous pins: required day-of record

There is no verified, current, sealed previous-13-function pin set in this preparation. The dated live-functions.private.json is metadata, not a complete source-exact rollback bundle. Therefore all prior source/JWT/version pins below are **NOT CAPTURED FOR THE INSTALLATION WINDOW**; do not substitute historical Section 4 pins or candidate HEAD fingerprints.

| Deployment group | Functions whose previous pins must be captured |
| --- | --- |
| Staff group (8) | onboarding-list, ai-onboarding-list, legacy-onboarding-list, onboarding-full, client-credentials, filming-plans, smm-weekly-reports, key-verify |
| Track-B group (5) | linear-outbound, notify, production-write, production-comments, production-archive |

Store one private previous-functions.json row per slug with captured_at, prior_version, source_sha256, entrypoint_path_sha256, file_count, verify_jwt, matched_git_sha (or null) and capture location; record the exact configuration backup separately. Fill this from served source, not from expected-only output. If no complete restorable set is established before release, STOP before deploying.

### Route C1: one older main commit matches ALL previous functions (conditional, UNTESTED rollback)

1. Find the exact 40-character previous main commit whose function closures and JWT posture match every captured prior row; verify all 13. Verify that it remains compatible with the current database and has the required attestor. Read the workflow at the dispatch ref and selected source; its preflight must accept the intended recovery schema without bypasses.
2. The owning lane is [Deploy staff-sensitive edge functions](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-onboarding-edge-functions.yml). It accepts commit_sha, requires main ancestry and redeploys eight staff functions followed by linear-outbound, notify, production-write, production-comments and production-archive. It is NOT a per-function undo and has no captured-13 restore option. All use verify_jwt=false in the reviewed lane; a captured different posture is incompatible with this route.
3. This forward deployment order is not automatically a safe rollback order. In particular, an old writer with a still-new reader can be incompatible. Require an effective, separately authorized request boundary across the transition and a reviewed compatibility check. If it cannot be contained without unauthorized changes, do not use this lane for rollback; repair forward or prepare a separate recovery lane.
4. After explicit recovery authorization, run through the workflow UI or:

```powershell
gh workflow run deploy-onboarding-edge-functions.yml --ref main -f commit_sha=<verified-previous-40-character-main-SHA>
```

5. Wait for completion. Independently retrieve served source and verify all 13 previous fingerprints/JWT postures, then check compatible reads and authorized TEST saves and confirm no new sender/flag was enabled. A new active provider version number is normal for redeployment: source equivalence, not numeric version equality, proves recovery. Restore configuration only if changed and separately approved. No client delivery test.
6. If deployment fails or times out, stop, inventory actual deployed versions and receipts, and choose recovery for that mixed state. Never blindly rerun all 13.

### Rolling back `notify` is a different operation from the other twelve

**Owner-approved amendment, 2026-09-15.** The release set is thirteen functions,
but only twelve of them have a previous deployed version. `notify` does not
exist on frozen main; it is new code this migration adds, and it has never been
deployed.

So "roll back the thirteen" is two operations, not one:

- **The twelve** have a prior served version, and rolling back means restoring
  it, as the routes below describe.
- **`notify` has nothing to restore.** Rolling it back means **removing the
  function, or leaving it deployed but inert**. Choose and state which before
  the forward release; do not treat it as a restoration, and do not let a
  thirteen-function count imply thirteen previous versions exist.

The same reasoning applies to any function this migration adds later.

### Route C2: previous functions were mixed versions or unmatched captured source

The onboarding lane cannot select a different previous commit per slug or deploy arbitrary captured source. The separate [Section 4 lane](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml) has restore-captured-prior-three for its sealed set (batch-write, deliverable-write, production-write; linear-outbound is deleted live, B2 Slice 8); it is NOT a rollback for notify, the readers or all eight staff functions. Do not substitute it for a 13-function recovery.

No ready captured-13 restoration lane has been prepared or tested. Stop before the forward release unless C1 is proven applicable or a separate exact-capture recovery lane has been prepared, reviewed and authorized. Direct laptop deployments, a newly invented CLI loop or a generic old-SHA dispatch are not equivalent recovery. This is a concrete conditional blocker, not a promised automatic restore.

**Time:** exact rollback duration is unmeasured. Budget at least the forward deployment workflow's measured duration for the chosen 13-function set, plus containment and readback; record that estimate on installation day. No promise of an instant previous-version switch or fixed completion time.

**Loss/risk/status:** redeploying code does not rewind accepted database saves or reverse notifications. A previous function can misread newly accepted data; mixed versions and changed secrets/configuration are separate risks. Source/preflight/attestation mechanisms are inspected; this 13-function hosted rollback, prior pin set and safe transition are **UNTESTED/UNESTABLISHED until day-of checks pass**.

## Stop or continue: owner decision table

| Installation point | Default decision |
| --- | --- |
| Before SQL / only captures or failed CI | Stop cheaply: production is unchanged. Fix the failed check/capture; no live restore needed. |
| Partial SQL, exact journal prefix valid, no corruption | Prefer reviewed forward resume under maintained protection. Rewinding a whole database is usually more disruptive. Unknown prefix means stop and inspect. |
| SQL complete, native controls dormant, browser/functions not released | Keep compatible additive SQL in place and stop the release. Do not delete installed schema merely to make the checkout look old. |
| Browser broken, previous browser still compatible | Browser-only rollback is usually the cheapest live recovery; preserve all accepted saves. |
| Partial function release | Stop and inventory. Continue only when the remaining reviewed deployment repairs the actual mixed state safely; otherwise use a proven-compatible C1 or a separately prepared recovery route. Never assume forward order is safe backward. |
| Native capabilities accepted new writes / external effects occurred | Prefer containment and forward repair. Code/schema reversal may strand native data; full restore needs explicit owner disposition of all later saves and external receipts. |
| Corruption with no safe forward repair | Owner chooses the eligible managed restore point and explicit loss/reconciliation plan. If no verified restore route exists, escalate; do not pretend a local backup guarantees a live undo. |

## Readiness and evidence

Documentation is complete; emergency hosted execution is not newly proven by writing it. Before the day-of mutation gate, verify managed-backup availability/permissions (or the accepted alternative), prior browser/13-function captures, C1 applicability or an actual alternate function lane, compatibility and the accepted-save boundary. Storage custody remains the pending owner-window capture. Previously identified capability-acceptance/website-provider-closure gates remain in the checkpoint; this document does not erase them.

No proofs with unchanged pins were rerun for this document. No recovery, deployment, production write, merge, dispatch, notification send or n8n action was executed.
