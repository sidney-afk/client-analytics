# Native-intake reliability: executable evidence and engineering handoff (2026-09-05)

**Revision note.** The first published head (`3ac16e6`) carried two scenarios that did not exercise
what their labels claimed: the "partial commit" injected its fault after the second child had already
committed, and the "provider-denied fill" posted a root intake rather than a fill. Both are corrected
below (G2b, G8-fill-provider-down), the readiness checks were audited for the same shape (one
name-based and two hardcoded checks replaced by behavioural ones or moved to an explicit
"unproven" list), and every claim in section 4 was narrowed to what the executed evidence supports.

**Scope.** Submit root intake, append to an existing batch, and component fill, with only their
direct validation, native persistence, retry/idempotency and Calendar-card materialization
dependencies. Samples correction and client monitoring are other tasks and are not touched here.
This package changes no application code, Edge Function, migration, workflow, flag, credential,
n8n workflow or live data, and it schedules, merges or activates no writer of any kind.

**Source under test.** `main` at `3bbc9620d7dc05037b4bf40afe51ffb2215e8d4f` (recorded at session
start, 2026-09-05; main merged into the branch afterwards without touching any tested file).
Strategy context: draft PR [#1268](https://github.com/sidney-afk/client-analytics/pull/1268) at
analysis commit `c1aa4d934d1a1532632842295cddaf0b176c1b73`, operative sections G2 (native authority
and catalogs), G3 (durable acceptance and materialization), T4 (conservation and concurrency) and
T5 (provider-denied canary). Its historical checklist is nonoperative and was not used.

**What ran.** `node test/native-intake-reliability.js` executes three lanes against a disposable
PostgreSQL 16 built from the repository's own migrations, with no route to any live backend:

| Lane | What is real | What is substituted |
|---|---|---|
| `sql` | `production_intake_append` (v7), `production_component_fill`, `production_batch_write`, `production_deliverable_write`, `production_outbox_replay`, `production_assert_authority`, the outbound-intent trigger; rows planned by the repository's `planAppendIntakeItems` | nothing: two `psql` sessions race in the database |
| `gateway` | `supabase/functions/production-write/index.ts` itself, executed under Node type stripping, plus `policy.mjs`, `selected-label-pages.mjs`, `_shared/*` | the supabase-js client (a one-statement-per-call SQL translator over psql, the PostgREST contract), `Deno.env`, `Deno.serve`, and `fetch` (Linear, the outbound drainer, the service-role probe, all recorded, none leaving the process) |
| `browser` | the intake job machinery brace-extracted from `index.html` (`_linearIntakePending`, `_runNativeIntakeJob`, `_resumeNativeIntakeJob`, `_writeNativeSubmissionCardsToCalendar`, `_linearIntakeDiscardTerminallyRefused`, `_linearIntakePurgeSensitiveState`, the diagnostics ring, and their helpers) | `localStorage`, Web Locks, `fetch`, the calendar upsert transport, the staff identity reader (all scriptable) |

Three kinds of check come back. **Current** checks characterize what the code does today and must
pass. **Readiness** checks assert what G2/G3 require, behaviourally (a status, a row count, a request
count) on the same code paths, and are expected red until the mapped change ships. **Unproven**
entries name requirements this package cannot exercise; they are listed and never counted as a pass.

Results (`docs/audits/2026-09-05-native-intake-reliability-results.json`): 63 current checks pass,
13 readiness checks red, 7 unproven. Verified in both modes: `node test/native-intake-reliability.js`
exits 0 (characterization) and `NATIVE_INTAKE_READINESS_STRICT=1 node test/native-intake-reliability.js`
exits 1 naming the 13 red gates. Every check id quoted below is in the results file with its evidence.
Package: `scripts/native-intake-reliability/`. Re-run: `node scripts/native-intake-reliability/run.js`;
refresh the results file with `--write-results`.

---

## 1. The answer to the central question, at the strength the evidence supports

The question was: what exactly changes so these three paths work without Linear while every accepted
request stays durably recoverable and creates no duplicate work. The evidence establishes the
**dependencies that must be removed** and the **conservation properties that already hold**; it does
not establish that any particular implementation is sufficient. Each candidate below therefore carries
the proof still owed before it can be called sufficient.

Candidate changes, ordered by dependency (details in section 4):

1. **Remove the provider read in front of every native write** (`projectForIntake`; the parent-issue
   confirmation in `parentRouteForAppend`). Tested dependency: G1-*, G8-fill-provider-down. Proof owed:
   replay of a request first attempted before the change still returns the same ids after it
   (fingerprint stability across the deploy).
2. **Stop creating provider intents for native work** while keeping the idempotency receipt the
   `mirror_outbox` row provides. Tested dependency: S0, G0, G10, R2 (normal lane only). Proof owed:
   parity lane, inbound lane and every scheduled or legacy worker (U2-*), see F2.
3. **Let the append contract accept a native parent** (batch with no drained parent map; terminal
   provider intent). Tested dependency: S4-*, S5-*, G6-append-mixed-undrained, G6-append-terminal-parent-intent.
   Proof owed: the existing fill rehearsal and the S/G append checks stay green with the widened RPC.
4. **Give card materialization an owner other than the submitting browser.** Tested dependency: B2, B3,
   B4, G2b, G9, R3-*. The mechanism is **unproven**; "no new ledger is needed" is withdrawn as a
   conclusion and stated as an open question in F4, with the five proofs it needs.
5. **Stop deleting browser recovery records on error suffixes or retry counts while a partial server
   commit remains possible** (B4, G2b). The discard rule needs positive server evidence, see F5.
6. **Auto-assignment must not depend on a provider user id** (G11). The override path and the
   eligibility policy flag are a separate owner decision and are untested here (U6).
7. Whether a provider-refused public attempt should consume the hourly allowance is an **owner policy
   decision** (P8), not a readiness requirement; the allowance also protects against repeated rejected
   attempts, and the 429 branch is untested (U7).

Reused, not replaced, because the evidence shows they already hold: the request identity
(`request_id` to deterministic native ids to `dedup_key` plus intent fingerprint on `mirror_outbox`),
`production_outbox_replay`, the batch CAS cursor, `deliverable_events`, the browser job store with its
native-result checkpoint and recovery copy, the public-intake rate ledger, and the fill's existing
repair arm.

---

## 2. Where each piece of state actually lives (proved)

| State | Store | Written by | Survives browser loss | Checks |
|---|---|---|---|---|
| Typed submission before acceptance | `localStorage[syncview_native_intake_pending_v1]` job at stage `request_pending`; a fire-and-forget request-log beacon to n8n before the first gateway call | `_linearIntakePending`, `_linearIntakeLogSubmissionRequest` | No. The beacon is at-least-once and unverified | B1, B4, B8, B9 |
| Accepted native work | `batches`, `deliverables`, `deliverable_events`; one RPC transaction per batch and per child on the root path, one transaction for the whole append or fill | `production_batch_write`, `production_deliverable_write`, `production_intake_append`, `production_component_fill` | Yes | G0, G2b, G6, G8, S8 |
| Idempotency receipt | `mirror_outbox` row: `dedup_key`, `payload._intent_fingerprint`, actor, role, `test_only`, `legacy_parity`, written by the `deliverable_events` trigger in the same transaction | the RPCs above | Yes | S0, S1, S2, G2, G3, G4, G5 |
| The requested item set of a root intake | Only in the browser job payload. The batch intent stores a fingerprint of it, not the items; the root path writes no item-count event (the append path does: `intake_append`) | browser | No | G2b-partial-boundary-durable-inventory, R3-partial-root-intake-detectable |
| Pending card creation | Browser job only: `result` (native ids), `stage: materializing_cards`, `completed_card_ids`. Server: nothing explicit; a deliverable whose `card_id` has no card row is discoverable by join | `_runNativeIntakeJob`, `_writeNativeSubmissionCardsToCalendar` | No (discoverable, not recorded) | B2, B3, G9, R3-server-materializes-orphan-card |
| Card and its link to the work | `calendar_posts` / `sample_reviews` (`video_deliverable_id`, `graphic_deliverable_id`) via `calendar-upsert`, a separate request per card | browser materializer; `_calFillWriteCardLink`; `_calAdoptDeliverableLinks` restores URLs only, never cards | Yes once written | B1, B2, G8, S8 |
| External mirror debt (normal lane) | `mirror_outbox` rows in `pending`/`failed`/`shadow_ok`; one batch intent plus one per item for every native intake and fill | the same trigger | Yes | S0, G0, G10, R2 |
| Refusal record | 50-row `localStorage` ring in the refusing browser; no server-side row references a refused request id | `_writeUiQueueDiagnostic` | No | B10, R9 |

### 2a. Classification the strategy asks for

* **Unsubmitted draft**: a job with no `result`. Enumerable only in that browser. Deleted silently on
  sign-out (B9), on two background 4xx refusals, or on six page loads with a 5xx (B4). Its only other
  copy is the request-log beacon.
* **Accepted work**: rows in `batches`/`deliverables` plus their outbox receipt. Enumerable server-side.
  Exactly one per request identity under every fault exercised (S1, S7, G2, G2b, G5). A root intake can
  be accepted **in part**: after an interruption between child RPCs the batch and one child are durable
  and the second item exists nowhere server-side (G2b).
* **Pending card creation**: a deliverable with `origin in (calendar, samples)` and a `card_id` that no
  card row carries. Discoverable server-side with the G9 join. Owned by nothing server-side today.
* **External mirror debt**: `mirror_outbox` non-terminal rows in the normal lane. Enumerable
  server-side. Separate fact from acceptance; the drainer owns it. The parity lane is not exercised here.

---

## 3. What was reproduced, in one table

| Requested fault | Result today | Checks |
|---|---|---|
| Linear validation unavailable | Root, append and a fill on a real half-complete card all refuse 503 `project_mapping_validation_unavailable` before any native write; the denied fill made exactly one provider request, zero drainer requests, wrote no component or intent and left the card link untouched; a missing read key refuses with zero provider requests; a provider 200 carrying `errors` also refuses | G1-*, G8-fill-provider-down |
| Native commit succeeds, response lost | Exact resend replays with the same native ids and no new row (root 201, append 200, fill `replay:true`); the browser keeps the job and resends a byte-identical request | G2-root-replay, G6-append-replay, G8-fill-replay, B1-* |
| Gateway interrupted between child commits | Interrupting before the second child RPC leaves the batch and exactly one child durable; the caller is told the request failed; the exact retry converges to one batch and two children. What the server holds at that boundary cannot name the missing item | G2b-* |
| Repeated and simultaneous submissions | Same identity, different intent or actor: 409, nothing written (RPC level and gateway level). Two identical submissions held to the same commit instant, and two database sessions with one holding its transaction open: one result, second returns replay | S1, S2-*, S7, G3, G4, G5, B7 |
| Browser closure, storage loss, later recovery | After the native commit and before the cards, clearing storage leaves nothing in the browser; server-side, the orphan is discoverable by join but no component wrote its card during the run; at the G2b boundary the lost item is not reconstructable from the server | B3, G9, R3-server-materializes-orphan-card, G2b-partial-boundary-durable-inventory |
| Native work exists but card creation fails | Native result is checkpointed before the first card write; resume writes only the remaining card without a second gateway call; a fill on a component whose card was never written is refused `component_fill_card_missing` | B2-*, G8-fill-requires-card |
| Recovery fails repeatedly | A recovery copy is removed after four background failures with a notice; an uncommitted job is removed with its payload after six page loads of a 503 outage; live clicks never count | B4-* |
| Delayed response after actor or client change | A response landing after the actor changed is stored as a scrubbed recovery copy with the native ids, nothing is re-sent, and the original actor finishes it; cards go to the job's client, not the open view | B5-*, B6 |
| Provider intents and egress from a native intake | Every native intake and fill enqueues pending provider intents in the normal lane; with the outbound flag live the gateway request itself calls the drainer | S0, G0, G10, R2 |
| Native batch that Linear never drained | Video-only append works through the local batch-create dependency; a mixed append is refused until the drain records `linear_parent_ids`, and then needs a provider read of the parent issue; once the intent is terminal even a video-only append is refused | G6-append-*, S5-* |
| Roster and catalog dependencies | No provider user id on any editor: 409 `video_assignee_pool_unavailable`; no per-team project mapping: 409 `project_mapping_missing`; per-team projects: fill refused by the gateway route lookup | G11, G12, G8-fill-split-projects |
| Public intake | Preserved (credential-less, flag on, `created_by=public-intake`); a provider-refused public submission spends one hourly slot (recorded as a policy question, P8) | G7-*, P8 |
| Refusal receipts | After a refused fill, no row in `deliverable_events`, `mirror_outbox` or `public_intake_log` references its request id | R9 |
| Anonymous client link | A saved submission resumes and materializes without a staff identity | B11 |

---

## 4. Each reproduced failure mapped to the smallest change the evidence supports

Line anchors are `index.ts` = `supabase/functions/production-write/index.ts` and `index.html`, both at
`3bbc962`. "Epoch" means a per-team native-epoch decision the server reads (proposed shape: a runtime
flag, absent = off, scoped first to the designated TEST client so G2's staged canary needs no global
flag). Nothing here is scheduled, merged or activated by this package; each item is a candidate for its
own reviewed release with its own rollback.

### F1. Provider read before every native write (R1 root/append/fill)

* **Reproduced by** G1-root-provider-down, G1-append-provider-down, G8-fill-provider-down (a real fill on
  a real half-complete card), G0-provider-read-before-write, G6-append-provider-read, G8-fill-provider-read,
  G6-append-mixed-after-drain.
* **Where** `projectForIntake` (index.ts:2398; called at :6003 for root and append, :5719 for fill),
  `readLinearProject` (:2213), `linearRead` (:2176); `validateLinearBatchParent` (:2233) from
  `parentRouteForAppend` (:2253) for written parents and direct parent ids.
* **Smallest change** under the epoch: `projectForIntake` returns the roster mapping
  (`projectIdsForTeam(client.linear_project_ids, team)`) without `readLinearProject`, and
  `parentRouteForAppend` is called with `validateExternal=false` (a parameter that already exists for
  exact retries). Keep the same project identifier string in the payload so `_intent_fingerprint` does
  not change. For clients provisioned after the exit, a native catalog value in the same column.
* **Acceptance** R1-root-without-provider, R1-append-without-provider, R1-fill-without-provider green with
  the provider denied and zero provider requests; G2, G6-append-replay, G8-fill-replay stay green.
  **Proof still owed:** a request first attempted under the old gateway and replayed under the new one
  returns the same ids (cross-deploy fingerprint stability); not exercised here.
* **Rollout dependency** a reviewed `production-write` release through its documented lane; held behind
  the epoch until F2 and F3 are installed. **Recovery** epoch off restores the provider read.

### F2. Native work creates provider intents and can trigger egress (R2, normal lane)

* **Reproduced by** S0-batch-intent-row, G0-root-create (`outbox_status: pending x3`), G10-live-drain-egress.
* **Where** `mirror_outbox_enqueue` (migrations/2026-07-11-b4-linear-outbound.sql, `status` hardcoded
  `'pending'`) via `track_b_enqueue_outbound_intent` (migrations/2026-07-12-write-ui-outbox-parity.sql:47);
  `scheduleSyncviewLiveDrains` (index.ts) when `linear_outbound_enabled.mode='live'`.
* **Candidate change** the enqueue RPC reads the epoch and inserts the row terminal at insert (a terminal
  status plus a decision the drainer already treats as final), keeping `dedup_key` and the fingerprint so
  `production_outbox_replay` is unchanged; the gateway schedules no drain for epoch teams.
* **What the evidence covers** only the normal lane of `mirror_outbox` (`legacy_parity=false`). It does
  **not** cover: the parity lane (no scenario runs a Linear-authoritative team, U2-parity-lane-suppression);
  the inbound lane (`linear-inbound` is not run, U2-inbound-cutoff); the scheduled drainer and older
  workers (U2-scheduled-worker-safety). `linear-outbound` has at least one selection that reads `skipped`
  rows (index.ts of that function, `fetchLane(null, ["pending", "skipped"], ...)` near line 1074), so a
  terminal-at-insert row is not known to be invisible to every lane.
* **Acceptance** R2-zero-provider-intents green while G2/G5/S1/S7 stay green. **Proof still owed:** the
  drainer executed against terminal-at-insert rows in every lane it has (normal, parity, targeted, "any");
  a parity-lane scenario with a Linear-authoritative team; `linear-inbound` under the epoch; a legacy
  browser bundle's queued jobs against the new server.
* **Rollout dependency** must land together with F3, or every epoch append refuses on the terminal
  dependency (S5). **Recovery** epoch off; terminal rows stay terminal.

### F3. Terminal dependency and undrained parent map block native appends (R4, R6)

* **Reproduced by** S4-project-id-required, S4-parent-route-required, S5-terminal-dependency-skipped,
  S5-terminal-dependency-stale, G6-append-terminal-parent-intent, G6-append-mixed-undrained.
* **Where** `production_intake_append` v7 (migrations/2026-08-26-production-intake-append-v7.sql):
  `v_terminal_dependency` on `skipped|stale`, `v_shared_parent` requires a recorded parent map, and the
  route must name a provider parent issue or a dependency row; `parentRouteForAppend` eligible-status list.
* **Smallest change** `production_intake_append` v8 (additive `create or replace`, the v7 rollback pattern):
  a dependency carrying the epoch decision is not terminal; the shared-parent waiver gains the fill RPC's
  second branch ("the target team has no recorded parent and the dependency is the batch's own create
  lane"); `project_id` stays required and carries the native catalog value. Gateway `parentRouteForAppend`
  includes those rows among eligible candidates.
* **Acceptance** R6-mixed-append-without-drain and R6-append-after-provider-cutoff green; S2, S3, S5 for
  non-epoch rows unchanged; the existing fill rehearsal green. **Proof still owed:** a batch with two
  distinct recorded parents (pre-2026-08-18 shape) still routes each team to its own parent.
* **Rollout dependency** migration first (safe alone, only widens), then gateway. **Recovery** re-run v7.

### F4. Card materialization has no owner other than the submitting browser (R3, R5)

* **Reproduced by** B2-native-checkpoint-before-cards, B3-storage-loss-forgets-accepted-work,
  B4-recovery-copy-discarded-after-4, B5-delayed-response-after-actor-switch, G8-fill-requires-card,
  G9-orphan-components-detectable, R3-server-materializes-orphan-card, G2b-partial-boundary-durable-inventory,
  R3-partial-root-intake-detectable.
* **Where** `_writeNativeSubmissionCardsToCalendar` (index.html:47034) writes one card per
  `calendar-upsert` request after the gateway responds; the only record of "cards owed" is the job in
  that browser; nothing server-side records, reconciles or writes it (no card for any orphan appeared
  during the run).
* **What the evidence establishes** the G9 join proves **discoverability** of a component without a card.
  It does not prove that the card the browser would have written can be reconstructed, and G2b proves a
  case where it cannot: a root intake interrupted between children leaves a batch and one child that
  look exactly like a complete one-item intake, because the batch intent stores only a fingerprint of the
  items and the root path records no item count (the append path does, as `intake_append`).
* **Conclusion withdrawn** "no new ledger is needed" is not supported. It becomes **unproven** until five
  things are shown: (1) **reconstruction**: the card the browser builds (`name`, `order_index` from the
  client's current max order, four `In Progress` statuses, both deliverable ids) is derivable server-side
  and equal to what the browser would have written; (2) **incomplete child creation**: a half-committed
  root intake is detectable so a one-item card is never minted for a two-item intent; (3) **card
  ordering**: a server-written `order_index` cannot collide with or reorder cards the client already
  has; (4) **concurrent edits**: the browser fast path and a server writer both going through
  `calendar-upsert` cannot leave a card with one link or a stale revision; (5) **non-resurrection**: an
  archived or deleted card is never re-created for a component that still names it (the join cannot
  tell "never written" from "removed").
* **Smallest evidence-backed step** record the accepted item set with the accepted request server-side
  (the root path already carries every item through one gateway call; the append path already writes an
  `intake_append` event with `item_count`). That alone clears R3-partial-root-intake-detectable and is a
  precondition for any server-side materializer, which stays a design candidate until (1) to (5) are proven.
* **Acceptance** R3-partial-root-intake-detectable green; then, for any materializer candidate, a new sql
  lane check per proof (1) to (5). **Rollout dependency** none on F1 to F3. **Recovery** rows a materializer
  wrote are ordinary cards; a materializer that cannot pass (5) must not be run.

### F5. The browser deletes its recovery record on retry counts and error classes (R5)

* **Reproduced by** B4-recovery-copy-discarded-after-4, B4-uncommitted-discarded-after-6-provider-503s,
  together with G2b (a partial server commit exists while the browser still holds the only complete request).
* **Where** `_linearIntakeDiscardTerminallyRefused` (index.html:47260): recovery copies get 4 strikes on
  any failure, uncommitted jobs get 6 strikes on any 5xx at boot, 2 on a background 4xx.
* **Corrected proposal** a discard must **not** be keyed on an error-code suffix or a retry count while a
  partial server commit remains possible: after a 5xx the server may hold the batch and some children
  (G2b) and the browser payload is the only complete copy. The record may be deleted only on positive
  server evidence that the request identity is terminal and committed nothing (a receipt, see F9), or it
  is parked visibly and never deleted. Until F4 gives cards a server-side owner, a recovery copy whose
  native work committed must not be deleted at all.
* **Acceptance** R5-provider-outage-does-not-discard-draft and R5-no-silent-discard-of-accepted-work green;
  a new browser check: a job whose gateway response was a 5xx after a partial commit is never discarded by
  background resumes. **Rollout dependency** browser only. **Recovery** revert.

### F6. Auto-assignment depends on a provider user id (R7)

* **Reproduced by** G11-roster-needs-provider-id.
* **Where** `autoAssigneeForIntake` (index.ts:2597) filters `team_members` on `linear_user_id`.
* **Smallest change** under the epoch, drop that filter for auto-assignment, keeping every role, team and
  active check intact. **Not proposed here:** changing the `production_assignee_eligibility` policy flag.
  That flag governs explicit picker overrides through `assertEligibleAssignee`, is a global policy change,
  and that path is untested in this package (U6-assignee-override-path).
* **Acceptance** R7-native-assignee-catalog green with the role/team checks still refusing a cross-team or
  inactive member. **Proof still owed:** the override path with and without the provider pool.

### F7. A provider outage spends the public allowance (P8, policy)

* **Reproduced by** G7-public-outage-burns-allowance (12 per client per hour, index.ts:234).
* **Where** the `public_intake_log` insert (index.ts:5990) runs before `projectForIntake` (:6003).
* **Status** an owner policy decision, not a readiness requirement. The current order also protects the
  path against repeated rejected attempts, which is the reason the ledger exists. If the owner decides
  a provider-refused attempt should not count, the insert moves below the read-only validations and above
  the first native RPC; the 429 branch is untested here (U7-public-rate-limit-429).

### F8. Fill route compares the wrong team's project (current defect, no readiness id)

* **Reproduced by** G8-fill-split-projects.
* **Where** `handleComponentFill` (index.ts:5660) passes the fill team's `projectId` to
  `parentRouteForAppend` while resolving the route for the sibling's team; the append path passes the
  parent team's project.
* **Smallest change** resolve the route team's project for the comparison. Affects the minority of clients
  with per-team projects; harmless after F1.

### F9. Refusals leave no server-side receipt (R9, OPEN_REPAIRS 101)

* **Reproduced by** R9-server-side-refusal-receipt (behavioural: no row in `deliverable_events`,
  `mirror_outbox` or `public_intake_log` references the refused fill's request id), B10.
* **Candidate change** in the gateway's error path, when `request_id` and `client_slug` are known, insert
  a `deliverable_events` row (`source='system'`, action `refused`, code, card and team in `payload`). This is
  also the positive evidence F5 needs before any browser record may be discarded.

### What needs no change

* G4/S2: actor is part of the receipt identity, so a retry by another actor is refused rather than
  adopted. Correct for staff; the browser's recovery copy already handles the interrupted-actor case (B5).
* B9: an uncommitted job is dropped on sign-out. That is an unsubmitted draft. Acceptable; the notice
  could say so.

---

## 5. Readiness gate

Each readiness id is a behavioural assertion held red by `test/native-intake-reliability.js` until its
change ships; strict mode turns the suite red on any remaining red id (verified: exit 1, 13 named).

| Readiness id | Cleared by |
|---|---|
| R1-root-without-provider, R1-append-without-provider, R1-fill-without-provider | F1 |
| R2-zero-provider-intents (normal lane) | F2, with U2-* still owed |
| R4-native-parent-identity, R6-mixed-append-without-drain, R6-append-after-provider-cutoff | F3 |
| R3-partial-root-intake-detectable | F4, first step |
| R3-server-materializes-orphan-card, R5-no-silent-discard-of-accepted-work | F4 (mechanism unproven) with F5 |
| R5-provider-outage-does-not-discard-draft | F5 |
| R7-native-assignee-catalog | F6 |
| R9-server-side-refusal-receipt | F9 |

Unproven, listed and never counted: U2-parity-lane-suppression, U2-inbound-cutoff,
U2-scheduled-worker-safety, U3-browser-loss-recovery, U6-assignee-override-path, U7-public-rate-limit-429,
P8-public-outage-allowance (policy).

Invariants the current-behavior checks must keep green through every change: one native result per
request identity under replay, concurrency and interruption (S1, S7, G2, G2b, G5); refusal on a changed
intent or actor (S2, G3, G4); stale cursor refused (S3, G6-append-stale-cursor); authority missing fails
closed (S6); public intake admitted and stamped (G7); anonymous-link resume (B11); SyncLinear sub-issue
creation stays closed (not re-proven here; `test/component-fill-gateway.js` and the surface gate cover it).

---

## 6. Limits: mocked boundaries, missing evidence, cases not exercised

* **Serving behaviour is not proven here.** The gateway lane runs the repository source at `3bbc962`.
  PR #1268 read the deployed `production-write` v66 through the Management API on 2026-09-04 and found it
  matched its baseline; this session made no Management API read. The SQL lane applies the repository
  migrations to a fresh database; the installed definitions in the live database were not read. Any
  drift between deployed and repository code is outside this evidence.
* **Substituted boundaries.** Gateway: supabase-js replaced by a one-statement-per-call SQL translator
  (PostgREST semantics, no session state); `fetch` replaced for Linear, the outbound drainer, the
  service-role probe, Google Docs and the thumbnail-text provider; `Deno.env` and `EdgeRuntime.waitUntil`
  shimmed. Browser: `localStorage`, Web Locks, `fetch`, `_calUpsertFetch`, the staff identity reader and
  the calendar view state are stubs; two tabs are modelled as one process sharing one store and one lock,
  not two real browsing contexts; no BFCache, no real network.
* **Not exercised** (each also appears as an unproven entry where it bears on a requirement):
  `linear-outbound` and `linear-inbound`; the parity lane; the `calendar-upsert` function's own guards
  (card writes were answered locally); the `sxr` surface materialization (same code path, not run);
  the `test_override` principal; an explicit `assignee_id` override and the provider pool; the graphics
  `smm_approval` artifact gate; thumbnail-text generation (provider key absent, so its gates close);
  `reclaimMirrorBatches` mirror-drift adoption; the 429 rate-limit branch; the Excel import and Create Post
  UI dialogs; SyncLinear sub-issue creation (closed by `assertSurfaceOperation` and `_prodCreateGateText`,
  covered by existing suites); recovery after browser loss (nothing server-side exists to run).
* **Determinism.** The gateway race uses a barrier before the first RPC; the SQL race holds one session's
  transaction open for 1.5 s. Both ran deterministically here, in the results file and in hosted CI; a
  heavily loaded runner could make S1/S7 spurious in principle (the second session would then be a plain
  replay, still one row).
* **Clock.** `source_edited_at` is validated against the server clock, so payloads are stamped at run time
  and memoised per request id; the results file therefore differs between runs only in timestamps.
* **CI.** The unit job pins PostgreSQL 16 and sets `F63_REQUIRE_POSTGRES=1`; the database lanes are required
  there and executed on the reviewed head. Locally without `initdb`/`psql` they skip and only the browser
  lane runs. The local `truth-sync` failures seen in this sandbox are the shallow clone (freshness commits
  not present), not this change.

---

## 7. Files

* `scripts/native-intake-reliability/harness.js`: cluster boot (reuses the F42 `Cluster`/`FOUNDATION_SQL`),
  migration chain, synthetic fixture.
* `scripts/native-intake-reliability/supabase-shim.mjs`: the translating client and fault hooks.
* `scripts/native-intake-reliability/gateway-lane.mjs`: the seam and scenarios G0..G12, the R and U entries.
* `scripts/native-intake-reliability/sql-lane.js`: scenarios S0..S8.
* `scripts/native-intake-reliability/browser-lane.js`: scenarios B1..B11.
* `scripts/native-intake-reliability/run.js`: orchestrator and results writer.
* `test/native-intake-reliability.js`: unit-suite entry; ratchet semantics and results cross-check.
* `docs/audits/2026-09-05-native-intake-reliability-results.json`: the recorded run.
