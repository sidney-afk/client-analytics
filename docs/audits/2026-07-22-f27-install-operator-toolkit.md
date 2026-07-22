# F27 install operator toolkit — source-only evidence

Date: 2026-07-22
Base: `origin/main@753b0b815fae19327f48fb5babeaa66d2b0a073b`
Status: draft source candidate; cloud review and owner merge required
Live effect: **none**

## Scope and owner decision

This candidate makes the already-merged corrective F27 brake installable. It
does not perform the installation. No DDL, DML, Edge deployment, drill, runtime
flag write, authority change, webhook/n8n operation, or client-data read/write
was run.

The owner selected the narrow dependency correction:

- only `supabase/functions/linear-inbound/index.ts` changes its import, from
  floating `https://esm.sh/@supabase/supabase-js@2` to exact
  `npm:@supabase/supabase-js@2.49.8`;
- `linear-inbound` alone carries the already-produced, function-local frozen
  `deno.json`/Deno v4 `deno.lock` as a predeploy candidate-source gate only.
  It is not captured from live state, included in a restore bundle, compared in
  deployed readback, or treated as historical provenance. No vendoring or
  cross-function lock work was added;
- the four install closures retain the existing exact npm `2.49.8` import
  surfaces—direct in `linear-outbound`/`production-write` and through
  byte-identical `_shared/b4-write.ts` for `deliverable-write`/`batch-write`—
  and their historical capture uses provider-returned source only, without
  synthetic lock companions;
- no other function import changes;
- six onboarding-family npm `@2` imports remain out of scope because changes in
  those directories are automatic-deploy triggers. They require a later,
  deliberate release.

Candidate source hashes:

```text
linear-inbound/index.ts  0daf70183e4f5f3a94b6772faac1019ef38ac12ec542b635739bc9805da0aa05
linear-inbound/deno.json e13cf0336d14f38013762c11935bd6123978f809120f530738d5b69669281524
linear-inbound/deno.lock a42630fbcde6d3f93da9ca2f5a9a39fd92ad23614853338443a56e7d4ab525ed
```

## Platform recovery boundary

Supabase CLI 2.109.0 can download deployed source and deploy a new version, but
cannot reactivate an old ESZip. The owner's carried-in cloud-verified fact is
that current live `linear-inbound` v39 was built from a floating import. The
owner decision records its historical transitive graph
as unrecoverable through every available platform recovery option: provider
readback supplies source, while the CLI cannot reactivate the prior ESZip.

`docs/ops/F27_INSTALL_RUNBOOK.md` therefore defines a separate owner-gated
preparatory deployment. It captures v39 source, deploys only the pinned inbound
closure in a quiet window, immediately proves inbound freshness, and records
the resulting version/source/JWT hashes as the new baseline.

The final F27 rollback standard is source exact for every target: redeploy the
exact captured provider-returned source paths/bytes and entrypoint with its
captured JWT posture, then independently download it and require the deployed
source/entrypoint and JWT hashes to match. This same standard applies to v39;
there is no weaker or non-exact exception. Inbound's local lock/config is only
a candidate-source gate and is excluded from the captured live baseline,
restore bundle, deployment readback equality, and historical provenance. No
tool attempts to reconstruct or attest a historical transitive graph. That
graph remains unrecoverable for the currently deployed functions, is
irrelevant to the owner-defined rollback standard, and remains recorded as
F51. Prior version IDs are provenance; restored deployments receive new
versions.

## Executable toolkit

| Tool | Fail-closed contract |
|---|---|
| `scripts/f27-mirror-outbox-snapshot.js` | One `REPEATABLE READ, READ ONLY` psql session captures every queue row in stable order, the complete constraint/trigger/dependent-function/table boundary, exact authority/F2/F4 values, and total flag-flip count; emits one deterministic sealed bundle and a redacted receipt. Capture refuses partial F27 state and admits only the two exact pre-F27 boundary-function identities; clean HEAD must equal origin/main. `verify-after` checks the old-column count/hash, no probe residue, zero-generation fences/empty ledgers, exact disposable-derived F27 post-contract hash/privileges, and zero flag/value drift. Deployed-function/frozen-writer hashes remain a separate readback gate. |
| `scripts/f27-apply-migration.js` | Executes only the exact checked-in migration from clean `HEAD == origin/main == release`, mechanically binds the sealed true pre-F27 snapshot to the same release/migration/project/database, leaves transaction/self-probe ownership to the migration, keeps the database URL out of argv, and stores only a private content-addressed transcript. |
| `scripts/f27-private-snapshot-store.js` | Stores explicit `mirror-outbox` or `edge-source` artifacts under distinct content-addressed names in the provisioned private Track-B Google Shared Drive only; refuses My Drive, repository/symlink sources, overwrites, collisions, or any parent/Drive/name/length/MD5/byte/SHA mismatch; independently downloads and re-hashes before PASS. |
| `scripts/f27-edge-source-rollback.js` | Captures an inbound-only, four-install-function, or five-function allowlisted set of exact provider-returned source paths/bytes, entrypoint, and JWT posture into one sealed file. Restore requires the exact capture hash and function-set confirmation, deploys only that source/JWT posture, performs a version-stable Management readback, and rejects any source/entrypoint/JWT mismatch. Local dependency config/lock files are never members of the live capture or restore equality contract. |
| `scripts/f27-inbound-freshness.js` | Read-only REST GET/HEAD against `deliverable_events`; PASS requires a latest `mirror_in_*` event from actor `Linear webhook` under six hours and a nonzero exact 12-hour count. Before attaching the service key, it binds an independently confirmed project ref to the exact canonical Supabase root URL. Output contains no event ID/body, project URL, or credential. |
| `scripts/f27-drill-runner.js` | Runs only the reserved `__f27_drill__` contract; proves snapshot/hash, negative classifications, replay/no-provider correlated receipt, idempotent terminal readback, required real authority-CAS refusal, permanent audit, and unchanged real rows/fences/flags. Live and disposable transports have distinct exact start/resume confirmations; a lost response exposes only the reserved rollback UUID and required resume token. |
| `scripts/f27-database-rollback-recipe.js` | Generates one private, readback-hashed, release/project/database/snapshot-bound additive rollback SQL recipe from the sealed baseline. It restores captured operative boundary functions, disables the F27 hold trigger, revokes mutating RPC grants, preserves additive schema/audit, and asserts queue/runtime/audit equality before COMMIT. |
| `scripts/f27-database-rollback-execute.js` | Requires a second exact confirmation and the recipe/snapshot/release/project/database hashes, rejects unsafe paths/meta-commands/endpoints, streams already-verified SQL bytes to psql via stdin, passes credentials only through an allowlisted private PG environment, and writes a non-overwriting private bounded transcript. |
| `scripts/f27-install-checklist.js` | Generates `docs/ops/F27_INSTALL_CHECKLIST.md` from one marked runbook block and embeds the SHA-256 of the complete runbook; `--check` fails on any drift. |

The private destination is not invented by this candidate. It reuses the
provisioned Track-B Shared Drive selected by
`TRACK_B_BACKUP_DRIVE_FOLDER_ID` plus the scoped private credential. The prior
availability proof is retained in `docs/ops/TRACK_B_BACKUP.md` (run
`29444939853`). This source-only pass made no Drive request. Its hermetic test
executes the full token → folder capability → collision preflight → create-only
upload → metadata readback → byte download → unique-name postflight and rejects
every integrity fault.

## Source-exact rollback rehearsals

The hermetic orchestration test is the source/JWT contract proof: captured prior
source → different candidate → restored capture → independent provider
source/entrypoint and JWT readback. Its final public-safe receipt is:

```text
result=PASS
rehearsal=hermetic-throwaway-source-exact-rollback
source_path_bytes_entrypoint_readback=PASS
jwt_readback=PASS
network_calls=0
live_provider_calls=0
hermetic_provider_reads=3
hermetic_provider_deploys=2
source_closure_sha256=1cac8b3f42d67fff3a2077843d0a0b68e3306897ebdee76cda8422343c1976f3
bundle_manifest_sha256=7eccbc51e4353d443102dfe89dae21431ce2f4bd54cc963b991e23de7fd97916
sealed_bundle_sha256=aa818d0c5b955e1176a7b23a2c3060fe4e75a89cb37203cfc2b0e8a7f7254899
```

The rehearsal proves only the sealed provider source/entrypoint and JWT
capture/restore/readback contract. No Docker rehearsal or dependency-provenance
harness is added, and no historical transitive graph is reconstructed or
attested. The actual future operator command may use `--use-docker` solely as
its deployment mechanism; that is not rollback evidence. The real preparatory
deployment is not part of the rehearsal and awaits a separate explicit owner
go.

## Runbook correction

The future operation is now two windows:

1. **Preparatory inbound baseline:** capture current v39 source, deploy only the
   merged pinned inbound closure, run freshness immediately, and record the new
   exact rollback baseline.
2. **F27 install:** full queue/definition/source snapshot first, apply the exact
   migration and its pre-COMMIT self-probe, deploy only `linear-outbound`,
   `production-write`, `deliverable-write`, and `batch-write`, run the reserved
   drill, and verify dormant/fresh.

The generated checklist is mechanically bound to the complete runbook. Final
generation and `--check` both passed at complete-runbook SHA-256
`7dcfa11be108e9c19b2e96ab30e65a695229705974416d939e11886df6c91d92`.
No merge of this source candidate authorizes either window.

## Invariants and validation

- Migration is untouched and remains SHA-256
  `6af9b6bd16bd310f1a25ccfc762cb1556e980d2497ea0125960d23c95af245ff`.
- Frozen writer source blobs are unchanged:
  `calendar-upsert/index.ts`
  `c5acadd69fc56507fad43ec1bd89f99381977921` and
  `sample-review-upsert/index.ts`
  `23485ee6f74c2a2dff3758e6fa9ff86c27035dae`.
- No n8n path changes.
- Authority, F2, F4, schema, live functions, webhooks, audit rows, and client
  rows were not read or mutated by this source-only session.
- Final offline validation passed all 155 repository unit suites, including all
  focused F27 operator contracts and the 24-check source/JWT rollback suite;
  truth-sync passed 400/400 and repository-map sync passed 148/148. All 20
  changed/new JavaScript files passed `node --check`; the F27 workflow parsed as
  valid YAML; the generated checklist matched the complete-runbook hash; the
  public-hygiene, exact-scope, invariant-hash, and whitespace checks passed.
- Deno 2.2.15 consumed the inbound Supabase-compatible v4 lock in frozen mode
  without rewriting it. That result is only a candidate-source gate and does
  not appear in the live baseline, restore receipt, or deployed readback
  equality.
- The disposable PostgreSQL workflow now runs the complete operator drill and
  requires `F27_DRILL_RUNNER_OK`; local host availability is not treated as
  proof of a live operation.

Cloud review must verify this candidate before owner merge. The preparatory
deployment and live F27 install remain separate, later, owner-gated work.
