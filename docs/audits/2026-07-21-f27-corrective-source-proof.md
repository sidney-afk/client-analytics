# F27 corrective source proof — two P1 races and a bounded drill

**Status:** source-only corrective candidate. Nothing in this work applied SQL,
deployed an Edge Function, changed a runtime flag or authority value, edited an
n8n workflow, or mutated live/client data. PR #901 is the stop-evidence record:
the attempted install was correctly aborted before F27 became live. The
pre-install posture it recorded remains the required starting posture for any
future attempt: Linear/Linear authority, F2 off, F4 false, and no F27 database
objects.

PR #894 remains useful design history, but its merged source is not safe to
install. It had two P1 races and no live-safe drill contract. The exact-head
corrective PR and its cloud run must be linked here before merge; no PR number,
commit, run, artifact, or live proof is inferred in advance.

## P1-1: close the late native-write handoff race

The unsafe interleaving was:

1. a native writer passed its Edge Function authority check;
2. `track_b_f27_finalize` observed no active team rows and returned authority to
   Linear; and
3. the already-authorized writer inserted its outbox intent after finalization.

That late commit violated the claimed team-zero boundary. The corrective source
adds a server-owned generation fence for each real team:

- `track_b_f27_write_authorization(team)` returns the exact current authority
  and non-negative generation;
- every real-team outbox producer carries that generation through reserved
  enqueue-only fields, which `mirror_outbox_enqueue` removes from the persisted
  payload and writes into trusted columns;
- the `mirror_outbox` trigger validates the generation at INSERT/reactivation
  time, after the request-level authority check, and fails closed on a stale
  value;
- real rollback begin snapshots the team generation; and
- real finalization locks the outbox/flags/fence in the documented order, CASes
  only the requested authority key, and advances only that team's generation in
  the same transaction.

The disposable PostgreSQL proof reproduces the exact race, rather than a
nearby approximation: authorize at generation 0, commit finalization and the
generation advance, then attempt the delayed insert with generation 0. The
required result is `f27_authority_generation_stale:<team>`. It also asserts the
other team's generation did not move and a fresh generation-bound TEST enqueue
still succeeds inside a rolled-back transaction.

The before/after unit fixture in `test/f27-authority-fence-race.js` also pins
the old hold-only acceptance and the new stale-generation refusal.
Classification now takes the same outbox-table then rollback-row lock order as
finalization, closing the inverse-lock deadlock. Reconciler reactivation uses
the service-only `track_b_f27_requeue` RPC to replace an old row generation and
reactivate it in one trigger-checked statement; the disposable proof rejects
the old unfenced post-CAS requeue and rolls back a successful fresh-generation
requeue.

Normal semantics stay pinned: a current-generation normal write still requires
SyncView authority, a parity write still requires Linear authority plus F4
true, TEST scope bypasses authority but not the generation, and an idempotent
dedup hit returns the existing intent without firing a stale-generation insert.
With no rollback row, there is no team hold.

## P1-2: recognize an exact rollback replay echo

The post-merge failure fixture is an F27 replay whose exact binder was persisted
in `mirror_outbox.linear_result` before the Linear mutation. The matching issue
webhook has no usable actor and arrives while the row is intentionally
`skipped`, so #894's actor-or-terminal rule misclassified the replay's own echo
as a foreign write.

`test/f27-linear-inbound-echo.js` was written against that behavior first. The
red fixture proves the exact issue and value match while both old proofs are
false, and failed with:

```text
FAIL: an exact open rollback preflight must be an acknowledged echo proof
```

The corrective inbound source accepts the preflight as echo proof only when all
of these remain exact:

- the persisted binder says `f27_preflight=true`;
- rollback ID, correlation ID, team, outbox ID, dedup key, and operation match;
- that rollback is still open;
- the webhook issue and intended value match through the existing value matcher;
  and
- the candidate is the F27 skipped-state shape.

A missing/closed/mismatched rollback, lookup error, wrong issue, wrong value, or
tampered binder fails closed. Ordinary pending rows still need the exact actor;
ordinary written terminal rows keep the established actor-independent proof;
ordinary skipped rows remain ineligible. No rollback lookup is made unless a
rollback-bound preflight candidate exists. The focused regression and the
existing inbound/outbound/gateway source suites are the after-fix green gates;
their exact-head cloud handles belong in the corrective PR when available.

## Safe drill contract

The drill is deliberately outside both real team namespaces:

- `is_drill=true` is valid only with the reserved team and client value
  `__f27_drill__`;
- a strict outbox check binds exactly one synthetic TEST row to its drill
  rollback ID, requires generation 0 and non-parity, and rejects generic inserts
  into the reserved scope;
- `track_b_f27_begin_drill` is available only at exact Linear/Linear authority,
  F2 off, and F4 false, and creates/snapshots/hashes only that one synthetic row;
  it retains the immutable row hash separately and computes the snapshot hash
  with the same ordered row-hash aggregate algorithm as a real rollback;
- `F27_ROLLBACK_DRILL` follows the full select, classify, claim, receipt, and
  completion machinery, but branches to
  `track_b_f27_execute_drill_replay` before viewer/entity/issue/provider reads;
  its terminal result is a deterministic, exact-bound no-external-call result;
- the hash-bearing replay receipt is written to the intent atomically with the
  synthetic outbox terminal and returned by the Edge response, so a lost HTTP
  response cannot strand the drill; exact receipt readback is idempotent;
- drill classification is exactly `replay`; quarantine, discard, and
  already-reflected classifications are refused, and finalization independently
  requires one exact server-built replay receipt;
- the real authority finalizer must refuse a drill with
  `f27_drill_authority_cas_refused`; and
- `track_b_f27_finalize_drill` records that refusal, exact zero, the immutable
  snapshot hash, receipt binding, unchanged authority/stops, and permanent audit
  retention.

The disposable proof snapshots every real-team row, both real-team fences, the
three controlling runtime flags, and the flag-audit count before the drill. It
requires all of them to be byte/state-identical afterward. It also proves an
open drill cannot hold a real-team TEST enqueue, rejects an unbound replay and
receipt, retains the completed drill row/intent/outbox receipt, and ends with no
open rollback. Drill history is evidence and is never deleted.

## Source gates and boundaries

The exact corrective head must pass:

- `test/f27-team-rollback.js` for additive SQL, fence, install self-probe, drill,
  audit-retention, and public-scope invariants;
- `test/f27-linear-inbound-echo.js` for the before/after inbound P1 fixture and
  ordinary no-rollback behavior;
- `test/f27-authority-fence-race.js` for the before/after handoff fixture and
  exact disposable-proof ordering;
- `test/f27-linear-outbound-replay.js` for real replay plus the no-provider drill
  branch;
- the production-write, reconciler, inbound, outbound, and B4 writer source
  suites for generation propagation and no-rollback behavior; and
- `scripts/f27-team-rollback-proof.sql` in the disposable PostgreSQL workflow,
  ending in `F27_PROOF_OK` with the late-insert rejection and full drill
  assertions.

An exact-head run/artifact/hash is intentionally not recorded until it exists.
Local or cloud validation may close the source proof; it cannot prove anything
about the live project.

Hard boundaries for this corrective session:

- `calendar-upsert` and `sample-review-upsert` are byte-identical and were not
  deployed. Worktree and HEAD Git blob IDs match:
  `calendar-upsert/index.ts` is
  `c5acadd69fc56507fad43ec1bd89f99381977921` and
  `sample-review-upsert/index.ts` is
  `23485ee6f74c2a2dff3758e6fa9ff86c27035dae`. These prove source preservation,
  not live deployment identity;
- n8n is untouched;
- no migration, DDL, DML, deployment, flag change, authority change, client-row
  read/write, or provider mutation occurred;
- ordinary outbound/inbound behavior without an F27 row is regression-pinned;
  and
- merge remains owner-only after cloud review. A live install is a separate,
  owner-gated operation using `docs/ops/F27_INSTALL_RUNBOOK.md`.
