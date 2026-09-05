# Native-intake reliability: executable evidence and engineering handoff (2026-09-05)

**Scope.** Submit root intake, append to an existing batch, and component fill, with only their
direct validation, native persistence, retry/idempotency and Calendar-card materialization
dependencies. Samples correction and client monitoring are other tasks and are not touched here.

**Source under test.** `main` at `3bbc9620d7dc05037b4bf40afe51ffb2215e8d4f` (recorded at session
start, 2026-09-05). Strategy context: draft PR
[#1268](https://github.com/sidney-afk/client-analytics/pull/1268) at analysis commit
`c1aa4d934d1a1532632842295cddaf0b176c1b73`, operative sections G2 (native authority and catalogs),
G3 (durable acceptance and materialization), T4 (conservation and concurrency) and T5
(provider-denied canary). Its historical checklist is nonoperative and was not used.

**What ran.** `node test/native-intake-reliability.js` executes three lanes against a disposable
PostgreSQL 16 built from the repository's own migrations, with no route to any live backend:

| Lane | What is real | What is substituted |
|---|---|---|
| `sql` | `production_intake_append` (v7), `production_component_fill`, `production_batch_write`, `production_deliverable_write`, `production_outbox_replay`, `production_assert_authority`, the outbound-intent trigger; rows planned by the repository's `planAppendIntakeItems` | nothing: two `psql` sessions race in the database |
| `gateway` | `supabase/functions/production-write/index.ts` itself, executed under Node type stripping, plus `policy.mjs`, `selected-label-pages.mjs`, `_shared/*` | the supabase-js client (a one-statement-per-call SQL translator over psql, the PostgREST contract), `Deno.env`, `Deno.serve`, and `fetch` (Linear, the outbound drainer, the service-role probe, all recorded, none leaving the process) |
| `browser` | the intake job machinery brace-extracted from `index.html` (`_linearIntakePending`, `_runNativeIntakeJob`, `_resumeNativeIntakeJob`, `_writeNativeSubmissionCardsToCalendar`, `_linearIntakeDiscardTerminallyRefused`, `_linearIntakePurgeSensitiveState`, the diagnostics ring, and their helpers) | `localStorage`, Web Locks, `fetch`, the calendar upsert transport, the staff identity reader (all scriptable) |

Results: `docs/audits/2026-09-05-native-intake-reliability-results.json` (62 current-behavior checks
pass, 14 readiness checks red). Every check id quoted below is in that file with its evidence.
Package: `scripts/native-intake-reliability/`. Re-run: `node scripts/native-intake-reliability/run.js`;
refresh the results file with `--write-results`; hold a release to the gates with
`NATIVE_INTAKE_READINESS_STRICT=1 node test/native-intake-reliability.js`.

---

## 1. The answer to the central question

For these three paths to work without Linear while every accepted request stays durably
recoverable and creates no duplicate work, the following changes are required and sufficient on
the evidence below. They are ordered by rollout dependency; each is expanded in section 4.

1. **Stop the provider read in front of every native write** (`projectForIntake` and the parent-issue
   confirmation in `parentRouteForAppend`), behind a per-team native-epoch flag, keeping the same
   project identifier strings in the intent fingerprint so in-flight retries still replay. Gateway only.
2. **Write the provider intent terminal at insert** under that epoch (`mirror_outbox` row still written,
   because it is the idempotency receipt, but with `status='skipped'` and a `native_epoch` decision) so
   the drainer never selects it and no new provider intent is created. One migration (enqueue RPC).
3. **Let the append route accept a native parent**: accept a `native_epoch` terminal dependency and
   extend the append RPC's shared-parent waiver to a batch with no recorded parent map, exactly as the
   fill RPC already does. One additive migration (`production_intake_append` v8) plus the matching
   gateway eligibility list.
4. **Give card materialization a server-side owner**: a scheduled, idempotent materializer that derives
   the missing card from the durable `deliverables` rows (client, `card_id`, title, `sort_key`,
   origin, deliverable ids) and writes it through the existing card writer. No new table: the pending
   state is already derivable, and this is the recovery method for browser loss, actor loss and
   repeated failure. The browser materializer becomes the fast path.
5. **Stop counting outages as refusals in the browser** so a provider or authority outage does not
   discard the typed submission (`_linearIntakeDiscardTerminallyRefused`). Browser only.
6. **Remove the provider user-id filter from auto-assignment** under the epoch, and flip the existing
   `production_assignee_eligibility` policy flag so an explicit picker override no longer needs the
   provider pool. Gateway plus one flag row.
7. **Log the public-intake slot after validation**, so a refused public submission does not spend the
   client's hourly allowance. Gateway only.

Things that already satisfy the requirements and are reused, not replaced: the request identity
(`request_id` to deterministic native ids to `dedup_key` plus intent fingerprint on `mirror_outbox`),
`production_outbox_replay`, the batch CAS cursor, `deliverable_events`, the browser job store with
its native-result checkpoint and recovery copy, the public-intake rate ledger, and the fill's
existing repair arm. No new ledger subsystem is needed.

---

## 2. Where each piece of state actually lives (proved)

| State | Store | Written by | Survives browser loss | Checks |
|---|---|---|---|---|
| Typed submission before acceptance | `localStorage[syncview_native_intake_pending_v1]` job at stage `request_pending`; a fire-and-forget request-log beacon to n8n before the first gateway call | `_linearIntakePending`, `_linearIntakeLogSubmissionRequest` | No. The beacon is at-least-once and unverified | B1, B4, B8, B9 |
| Accepted native work | `batches`, `deliverables`, `deliverable_events`, in one RPC transaction | `production_batch_write`, `production_deliverable_write`, `production_intake_append`, `production_component_fill` | Yes | G0, G6, G8, S8 |
| Idempotency receipt | `mirror_outbox` row: `dedup_key`, `payload._intent_fingerprint`, actor, role, `test_only`, `legacy_parity`, written by the `deliverable_events` trigger in the same transaction | the RPCs above | Yes | S0, S1, S2, G2, G3, G4, G5 |
| Pending card creation | Browser job only: `result` (native ids), `stage: materializing_cards`, `completed_card_ids`. Server: nothing explicit; derivable as a deliverable whose `card_id` has no card row | `_runNativeIntakeJob`, `_writeNativeSubmissionCardsToCalendar` | No (derivable, not recorded) | B2, B3, G9, R3 |
| Card and its link to the work | `calendar_posts` / `sample_reviews` (`video_deliverable_id`, `graphic_deliverable_id`) via `calendar-upsert`, a separate request per card | browser materializer; `_calFillWriteCardLink`; `_calAdoptDeliverableLinks` restores URLs only, never cards | Yes once written | B1, B2, G8, S8 |
| External mirror debt | `mirror_outbox` rows in `pending`/`failed`/`shadow_ok`; one batch intent plus one per item for every native intake and fill | the same trigger | Yes | S0, G0, G10, R2 |
| Refusal record | 50-row `localStorage` ring in the refusing browser | `_writeUiQueueDiagnostic` | No | B10, R9 |

### 2a. Classification the strategy asks for

* **Unsubmitted draft**: a job with no `result`. Enumerable only in that browser. Deleted silently on
  sign-out (B9), on two background 4xx refusals, or on six page loads with a 5xx (B4). Its only other
  copy is the request-log beacon.
* **Accepted work**: rows in `batches`/`deliverables` plus their outbox receipt. Enumerable server-side.
  Exactly one per request identity under every fault exercised (S1, S7, G2, G2b, G5).
* **Pending card creation**: a deliverable with `origin in (calendar, samples)` and a `card_id` that no
  card row carries. Enumerable server-side with the G9 join. Owned by nothing server-side today.
* **External mirror debt**: `mirror_outbox` non-terminal rows. Enumerable server-side. Separate fact
  from acceptance; the drainer owns it.

---

## 3. What was reproduced, in one table

| Requested fault | Result today | Checks |
|---|---|---|
| Linear validation unavailable | Root, append and fill all refuse 503 `project_mapping_validation_unavailable` before any native write; no partial state; a missing read key refuses with zero provider requests; a provider 200 carrying `errors` also refuses | G1-*, G8-fill-provider-down |
| Native commit succeeds, response lost | Exact resend replays with the same native ids and no new row (root 201, append 200, fill `replay:true`); the browser keeps the job and resends a byte-identical request | G2-root-replay, G6-append-replay, G8-fill-replay, B1-* |
| Gateway dies mid-request | Batch and first child durable, request reported as failed; the exact retry converges to one batch and two children | G2b-* |
| Repeated and simultaneous submissions | Same identity, different intent or actor: 409, nothing written (RPC level and gateway level). Two identical submissions held to the same commit instant, and two database sessions with one holding its transaction open: one result, second returns replay | S1, S2-*, S7, G3, G4, G5, B7 |
| Browser closure, storage loss, later recovery | After the native commit and before the cards, clearing storage leaves nothing in the browser and nothing server-side that owns the cards; the orphan is detectable by join | B3, G9, R3 |
| Native work exists but card creation fails | Native result is checkpointed before the first card write; resume writes only the remaining card without a second gateway call; a fill on a component whose card was never written is refused `component_fill_card_missing` | B2-*, G8-fill-requires-card |
| Recovery fails repeatedly | A recovery copy is removed after four background failures with a notice; an uncommitted job is removed with its payload after six page loads of a 503 outage; live clicks never count | B4-* |
| Delayed response after actor or client change | A response landing after the actor changed is stored as a scrubbed recovery copy with the native ids, nothing is re-sent, and the original actor finishes it; cards go to the job's client, not the open view | B5-*, B6 |
| Provider intents and egress from a native intake | Every native intake and fill enqueues pending provider intents; with the outbound flag live the gateway request itself calls the drainer | S0, G0, G10, R2 |
| Native batch that Linear never drained | Video-only append works through the local batch-create dependency; a mixed append is refused until the drain records `linear_parent_ids`, and then needs a provider read of the parent issue; once the intent is terminal even a video-only append is refused | G6-append-*, S5-* |
| Roster and catalog dependencies | No provider user id on any editor: 409 `video_assignee_pool_unavailable`; no per-team project mapping: 409 `project_mapping_missing`; per-team projects: fill refused by the gateway route lookup | G11, G12, G8-fill-split-projects |
| Public intake | Preserved (credential-less, flag on, `created_by=public-intake`); a provider-refused public submission still spends one hourly slot | G7-* |
| Anonymous client link | A saved submission resumes and materializes without a staff identity | B11 |

---

## 4. Each reproduced failure mapped to the smallest concrete change

Line anchors are `index.ts` = `supabase/functions/production-write/index.ts` and `index.html`, both at
`3bbc962`. "Epoch" means a per-team native-epoch decision the server reads
(proposed: runtime flag `native_intake_epoch`, `{"video":bool,"graphics":bool,"client_slugs":[...]}`,
absent = off), scoped first to the designated TEST client so G2's staged canary needs no global flag.

### F1. Provider read before every native write (R1 root/append/fill)

* **Reproduced by** G1-root-provider-down, G1-append-provider-down, G8-fill-provider-down,
  G0-provider-read-before-write, G6-append-provider-read, G8-fill-provider-read, G6-append-mixed-after-drain.
* **Where** `projectForIntake` (index.ts:2398, called at :6003 for root and append, :5719 for fill),
  `readLinearProject` (:2213), `linearRead` (:2176); `validateLinearBatchParent` (:2233) from
  `parentRouteForAppend` (:2253) for written parents and direct parent ids.
* **Smallest change** under the epoch: `projectForIntake` returns the roster mapping
  (`projectIdsForTeam(client.linear_project_ids, team)`) without `readLinearProject`, and
  `parentRouteForAppend` is called with `validateExternal=false` (the parameter already exists for exact
  retries). Keep the same project identifier string in the payload so `_intent_fingerprint` does not
  change and in-flight retries still replay. For clients provisioned after the exit, the catalog value is
  a native token written into `clients.linear_project_ids` at onboarding (`native:<team>`), no schema change;
  `intakeAttribution` should stamp that shape as native rather than `direct_project_unmapped`.
* **Acceptance** R1-root-without-provider, R1-append-without-provider, R1-fill-without-provider turn green
  with `net.linear='down'` and zero `api.linear.app` requests recorded; G2, G6-append-replay and
  G8-fill-replay stay green across the change (fingerprint stability).
* **Rollout dependency** manual `production-write` deploy through the four-function lane (owner capture
  first). Off by flag until F2 and F3 are installed (G2 says caller activation waits for G3's contract).
* **Recovery** flag off restores the provider read; the captured previous closure redeploys if needed.

### F2. Every native intake creates provider intents and can trigger provider egress (R2)

* **Reproduced by** S0-batch-intent-row, G0-root-create (`outbox_status: pending x3`), G10-live-drain-egress.
* **Where** `mirror_outbox_enqueue` (migrations/2026-07-11-b4-linear-outbound.sql, `status` hardcoded
  `'pending'`) via `track_b_enqueue_outbound_intent` (migrations/2026-07-12-write-ui-outbox-parity.sql:47);
  `scheduleSyncviewLiveDrains` (index.ts) when `linear_outbound_enabled.mode='live'`.
* **Smallest change** one migration: `mirror_outbox_enqueue` reads the epoch and, when the row's team or
  client is native, inserts `status='skipped'` with `linear_result={"conflict":{"decision":"native_epoch"}}`
  (a terminal shape the drainer already understands, next to `already_applied`). The row still carries
  `dedup_key` and the fingerprint, so `production_outbox_replay` keeps working unchanged. Gateway:
  `mirror_pending` false and no drain scheduled for epoch teams.
* **Acceptance** R2-zero-provider-intents green (zero pending rows after a native intake) while
  G2/G5/S1/S7 stay green (replay still recognised through a terminal row); G10 records zero drainer calls.
* **Rollout dependency** must land together with F3, or every epoch append refuses on the terminal
  dependency (S5). Migration is inert until the epoch flag is set.
* **Recovery** epoch off; rows inserted terminal stay terminal (they were never provider work).

### F3. Terminal dependency and undrained parent map block native appends (R4, R6)

* **Reproduced by** S4-project-id-required, S4-parent-route-required, S5-terminal-dependency-skipped,
  S5-terminal-dependency-stale, G6-append-terminal-parent-intent, G6-append-mixed-undrained.
* **Where** `production_intake_append` v7 (migrations/2026-08-26-production-intake-append-v7.sql):
  `v_terminal_dependency` on `skipped|stale`, `v_shared_parent` requires a recorded parent map, and the
  route must name a provider parent issue or a dependency row; `parentRouteForAppend` eligible-status list.
* **Smallest change** `production_intake_append` v8 (additive `create or replace`, same rollback pattern
  as v7): (a) a dependency whose `linear_result.conflict.decision='native_epoch'` is not terminal;
  (b) extend the shared-parent waiver with the fill RPC's second branch, "the target team has no recorded
  parent and the dependency is the batch's own create lane", so a batch with an empty `linear_parent_ids`
  accepts a mixed append; (c) keep `project_id` required (it now carries the native token). Gateway
  `parentRouteForAppend`: include `native_epoch` skipped rows in the eligible candidates.
* **Acceptance** R6-mixed-append-without-drain and R6-append-after-provider-cutoff green; S2, S3, S5 for
  non-epoch rows unchanged; the existing fill rehearsal stays green.
* **Rollout dependency** migration first (safe alone, only widens), then gateway. Independent of F4.
* **Recovery** re-run v7 (documented in the v7 header); no drop.

### F4. Card materialization has no server-side owner (R3, R5 recovery half)

* **Reproduced by** B2-native-checkpoint-before-cards, B3-storage-loss-forgets-accepted-work,
  B4-recovery-copy-discarded-after-4, B5-delayed-response-after-actor-switch, G8-fill-requires-card,
  G9-orphan-components-detectable, R3-server-card-pending-state.
* **Where** `_writeNativeSubmissionCardsToCalendar` (index.html:47034) writes one card per
  `calendar-upsert` request after the gateway responds; the only record of "cards owed" is the job in
  that browser; nothing server-side records or reconciles it.
* **Smallest change** a scheduled job (same shape and secrets as `scripts/linear-deliverables-reconcile.js`,
  run from its own workflow) that selects the G9 join (deliverables with `origin in (calendar,samples)`,
  a `card_id`, and no card row for `(client, card_id)`), groups by card, and writes the card through the
  existing writer with the same row the browser builds (`id=card_id`, `name=title`, `order_index` from
  `sort_key`, statuses `In Progress`, the two deliverable ids). The write is idempotent with the browser's:
  both go through `calendar-upsert`'s upsert, keyed on `(client, id)`. Bound it to rows older than a few
  minutes so the browser fast path usually wins. No new table or column: the pending state is the join.
  The fill's `component_fill_card_missing` refusal then becomes a transient the job clears.
* **Acceptance** a new check in the sql lane: after G9's orphan exists, run the materializer twice; one
  card row with both deliverable ids, second run a no-op; B3 followed by the job gives a present card;
  R3-server-card-pending-state redefined as "orphan count returns to zero within one job run".
* **Rollout dependency** none on F1..F3; script plus workflow only, merges live. Needs the service-role
  secret the reconcilers already use.
* **Recovery** disable the cron; rows it wrote are ordinary cards.

### F5. The browser discards work on repeated failure (R5)

* **Reproduced by** B4-recovery-copy-discarded-after-4, B4-uncommitted-discarded-after-6-provider-503s.
* **Where** `_linearIntakeDiscardTerminallyRefused` (index.html:47260): recovery copies get 4 strikes on
  any failure, uncommitted jobs get 6 strikes on any 5xx at boot.
* **Smallest change** treat codes matching `/_unavailable$/` (503 `project_mapping_validation_unavailable`,
  `authority_unavailable`, `batch_lookup_unavailable`, `native_intake_lock_unavailable`) as outages that
  never strike; keep the 500 budget for genuine server faults (the 2026-08-18 missing-function case).
  With F4 in place the recovery-copy discard is safe and its notice should say the server will finish
  the card; without F4 it is the loss B4 proves.
* **Acceptance** R5-provider-outage-does-not-discard-draft green; B4-live-click-never-strikes unchanged.
* **Rollout dependency** browser only, live on merge; independent.
* **Recovery** revert the constant.

### F6. Auto-assignment and eligibility need provider identities (R7)

* **Reproduced by** G11-roster-needs-provider-id.
* **Where** `autoAssigneeForIntake` (index.ts:2597) filters `team_members` on `linear_user_id`;
  `assigneeEligibilityPolicyFor` (:2463) defaults to provider-required when the
  `production_assignee_eligibility` flag row is absent (used only for explicit picker overrides).
* **Smallest change** under the epoch, drop the `linear_user_id` filter (the mirror leg is terminal, so an
  unmirrorable assignee is no longer a defect); set the existing flag row to
  `{"provider_mapping_required": false}` for overrides. No schema change.
* **Acceptance** R7-native-assignee-catalog green; a new gateway check for an explicit `assignee_id`
  override with no provider pool (not exercised here, see section 6).
* **Rollout dependency** gateway deploy; the flag row can be set before it.
* **Recovery** epoch off; flag row back.

### F7. A provider outage spends the public allowance (R8)

* **Reproduced by** G7-public-outage-burns-allowance (12 per client per hour, index.ts:234).
* **Where** the `public_intake_log` insert (index.ts:5990) runs before `projectForIntake` (:6003).
* **Smallest change** move the insert below the read-only validations and above the first native RPC,
  keeping the documented "logged before the work is created" property.
* **Acceptance** R8-public-outage-allowance green; G7-public-intake-preserved unchanged.
* **Rollout dependency** gateway deploy; moot once F1 is on, still correct for other 503s.

### F8. Fill route compares the wrong team's project (current defect, no readiness id)

* **Reproduced by** G8-fill-split-projects.
* **Where** `handleComponentFill` (index.ts:5660) passes the fill team's `projectId` to
  `parentRouteForAppend` while resolving the route for the sibling's team; the append path passes the
  parent team's project (`projectByTeam[appendParentTeam]`).
* **Smallest change** resolve `projectForIntake(client, routeTeam)` for the route comparison. Affects the
  minority of clients with per-team projects; harmless after F1.

### F9. Refusals leave no server-side receipt (R9, OPEN_REPAIRS 101)

* **Reproduced by** B10-refusal-ring-local-and-capped.
* **Smallest change** in the gateway's `GatewayError` response path, when `request_id` and `client_slug`
  are known, insert a `deliverable_events` row with `source='system'`, action `refused`, and the code, card
  and team in `payload`. No grant change. Optional for the exit; listed because item 101 asks for it.

### What needs no change

* G2b: a gateway crash between the batch and a child leaves durable partial state that the exact retry
  converges. The browser already keeps the request. Acceptable; document in the runbook.
* G4/S2: actor is part of the receipt identity, so a retry by another actor is refused rather than
  adopted. Correct for staff; the browser's recovery copy already handles the interrupted-actor case (B5).
* B9: an uncommitted job is dropped on sign-out. That is an unsubmitted draft. Acceptable; the notice
  could say so.

---

## 5. Readiness gate

Each readiness id is held red by `test/native-intake-reliability.js` until its change ships; the strict
mode turns the suite red on any remaining red id.

| Readiness id | Cleared by |
|---|---|
| R1-root-without-provider, R1-append-without-provider, R1-fill-without-provider | F1 |
| R2-zero-provider-intents | F2 |
| R4-native-parent-identity, R6-mixed-append-without-drain, R6-append-after-provider-cutoff | F3 |
| R3-server-card-pending-state, R3-browser-loss-recoverable, R5-no-silent-discard-of-accepted-work | F4 (with F5 for the notice) |
| R5-provider-outage-does-not-discard-draft | F5 |
| R7-native-assignee-catalog | F6 |
| R8-public-outage-allowance | F7 |
| R9-server-side-refusal-receipt | F9 |

Invariants the current-behavior checks must keep green through every change: one native result per
request identity under replay, concurrency and gateway crash (S1, S7, G2, G2b, G5); refusal on a changed
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
* **Not exercised.** `linear-outbound` and `linear-inbound`; the `calendar-upsert` function's own guards
  (card writes were answered locally); the `sxr` surface materialization (same code path, not run);
  the `test_override` principal; an explicit `assignee_id` override and the provider pool
  (`assertEligibleAssignee`); the graphics `smm_approval` artifact gate; thumbnail-text generation
  (provider key absent, so its gates close); `reclaimMirrorBatches` mirror-drift adoption; the 429
  rate-limit branch; the Excel import and Create Post UI dialogs; SyncLinear sub-issue creation (closed by
  `assertSurfaceOperation` and `_prodCreateGateText`, covered by existing suites).
* **Determinism.** The gateway race uses a barrier before the first RPC; the SQL race holds one session's
  transaction open for 1.5 s. Both ran deterministically here and in the results file; a heavily loaded CI
  runner could make S1/S7 spurious in principle (the second session would then be a plain replay, still one row).
* **Clock.** `source_edited_at` is validated against the server clock, so payloads are stamped at run time
  and memoised per request id; the results file therefore differs between runs only in timestamps.
* **CI.** The unit job pins PostgreSQL 16 and sets `F63_REQUIRE_POSTGRES=1`; the database lanes are required
  there. Locally without `initdb`/`psql` they skip and only the browser lane runs. The local
  `truth-sync` failures seen in this sandbox are the shallow clone (freshness commits not present), not
  this change.

---

## 7. Files

* `scripts/native-intake-reliability/harness.js`: cluster boot (reuses the F42 `Cluster`/`FOUNDATION_SQL`),
  migration chain, synthetic fixture.
* `scripts/native-intake-reliability/supabase-shim.mjs`: the translating client and fault hooks.
* `scripts/native-intake-reliability/gateway-lane.mjs`: the seam and scenarios G0..G12.
* `scripts/native-intake-reliability/sql-lane.js`: scenarios S0..S8.
* `scripts/native-intake-reliability/browser-lane.js`: scenarios B1..B11.
* `scripts/native-intake-reliability/run.js`: orchestrator and results writer.
* `test/native-intake-reliability.js`: unit-suite entry; ratchet semantics and results cross-check.
* `docs/audits/2026-09-05-native-intake-reliability-results.json`: the recorded run.
