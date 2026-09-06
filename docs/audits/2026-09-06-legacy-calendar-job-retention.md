# Legacy Calendar job retention — source preparation only

This bounded G6 correction extends the one [execution checklist](../independence/GO_LIVE_CHECKLIST.md). Base `a0c10ccd01414f07536e0f177818bfa1c3f8ab34` remains the previously reviewed and hosted-green candidate. No production behavior is changed by an unmerged draft.

## Behavior and evidence

The actual `_resumePendingCalCardJobs` deletes version1 records when a required team is no longer Linear-authoritative, after48 hours, after five attempts, or for a known invalid job shape. These removals are not proof that work was never accepted. Its previous notice encouraged Create Post, risking duplicate work when the provider outcome is unknown.

The correction keeps those exact stored records without rewriting them or dispatching their writer in those conditions. A generic once-per-page notice says completion is unconfirmed and requests administrator review before recreation; it exposes no client name, job ID, title or raw error. Diagnostics use bounded retention reasons only. The notification latch is in memory, not a new durable owner. A late sibling checkpoint is not overwritten because retention makes no storage write.

Existing completed checkpoint cleanup and eligible provider jobs retain their prior contracts. The actual provider/card writer, job-create/save helpers, native intake runner and actor guard are byte-identical to the base. Frozen writers, authentication, SQL, flags, transport selection and n8n are unchanged. No native receipt, ownership or replay capability is inferred for an actorless job.

`node test/legacy-calendar-job-retention.js` executes the real extracted queue functions: **23 groups**, including **four baseline-deletion controls**. Candidate cases preserve exact record bytes for authority/age/attempt/invalid refusals, make zero writer calls on held paths, retain outage behavior, preserve completed-checkpoint cleanup and fresh heartbeat handling, exercise unchanged eligible provider dispatch, and preserve sibling progress and records when notifications/storage fail. The test explicitly demonstrates that later authority reversal can make a retained job eligible again. Five byte-equality controls pin unchanged writer/actor contracts. Classification: **OFFLINE_ACTUAL_SOURCE**, synthetic storage and a recording writer seam, no browser/server/serving proof.

The existing Calendar card-writer suite still executes the actual writer and checks its success/failure behavior; only its obsolete deletion/backfill expectations and new helper loading are adapted. The lifecycle source assertion now requires retention while preserving the exact Linear-authority gate. These tests do not establish live client journeys or database durability.

## Release holds and rollback

Hosted exact `012a8fe87ad8291bc87767083fd248cdf28d1567`, run34059572206/job101557564277, finished **457/458**, not green. The sole failed suite, `test/import-from-linear-sealed.js`, still required the removed retry-cap Create Post message; it reproduces locally. Later dedicated history/Workload/v7/v8 steps were **SKIPPED**. Browser, type, F27 and identity checks passed. The test-only correction preserves all seven other assertions and replaces the obsolete advice check with the reviewed retention contract plus two negative controls rejecting false absence and recreate guidance. All ten checks pass locally; runtime is unchanged. Two other legacy writer notices still recommend Create Post and remain outside this correction. New hosted validation is required.

This is retention, **not durable quarantine or automatic recovery**. The original record lacks a verified actor, immutable provider receipt and complete original source. It cannot safely be assigned a new native identity or shown a same-owner retry button by analogy with version3. Old bundles, a live writer already in flight, whole-array writes by other tabs, storage eviction/corruption and shared-device/sign-out behavior remain separate risks. A fresh page can notify again; no periodic alarm is installed.

Reversing authority to Linear can resume a retained otherwise-eligible record. Before any such rollback, the operator must preserve and reconcile this queue and prove compatible recovery. Neither flag reversal nor restoring the old deletion bundle is a safe data rollback. After future use, retain these records and compatible refusal handling until each outcome is established; do not clear storage or encourage recreating unknown work.

Client-visible behavior during preparation is unchanged because this draft is not deployed. After a future approved release, the existing eligible path still runs, refused records remain local, and a generic review notice replaces deletion/recreation advice. Independent review, combined hosted checks, old-caller/n8n closure, live TEST/serving evidence and active watchers remain release gates. Global G6 and Decision A remain open.
