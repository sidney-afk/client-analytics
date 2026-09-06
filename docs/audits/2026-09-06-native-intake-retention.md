# Browser v3 refusal retention — unapplied source correction

The canonical execution authority remains [GO_LIVE_CHECKLIST.md](../independence/GO_LIVE_CHECKLIST.md). This bounded G6 evidence does not close global recoverability or authorize a release.

Base `16a701a318eaf829a6357bb0352ff7babd51b1c6` deletes the existing v3 pending job after four accepted-recovery failures, six server-error page loads, or two other non-auth refusals. The actual extracted baseline reproduces all three deletions. A repeated refusal does not establish whether an earlier request committed or whether its missing card can be reconstructed.

## Change and ownership

`_linearIntakeDiscardTerminallyRefused` now keeps the same existing `NATIVE_INTAKE_PENDING_KEY` record, original request ID/payload, accepted result and completed-card IDs. At the existing threshold it adds `resume_held: true`; `resume_refusals` remains the existing counter. No new storage owner or server receipt is introduced. The historical function name is retained for callers; it always returns false because it discards nothing. Holding affects background execution, not a deliberate retry of the same request.

`_resumeNativeIntakeJob` checks current ownership and the held state inside the existing Web Lock. Failed-attempt bookkeeping reacquires that lock and rereads the current request before changing its counter, so a replacement job cannot be overwritten by an old failure. A held background job produces no new gateway/card attempt. A failed storage write leaves the previous record and does not announce successful retention of a new hold.

The existing Calendar/Samples Create Post and Submit error areas offer **Retry saved post** for a held job belonging to the exact selected client, surface and current initiating staff actor. The button closes over the exact persisted record; both click and execution under the lock recheck it. Another actor, role refusal, a client change, detached view, changed record or replaced ID prevents dispatch. A staff-owned request is not exposed by changing to the anonymous intake view. Anonymous intake keeps its preexisting server-controlled identity boundary; this patch adds no anonymous identity proof. No payload or identity is serialized into markup. Text states that completion is unconfirmed and does not encourage a new creation.

Manual retry calls the unchanged runner with the original request ID and accepted state. Accepted recovery executes the existing card transport without sending another intake-create request. An unacknowledged retry sends the original payload and ID through its existing gateway path; this does not establish provider idempotency or non-acceptance. Held manual 4xx/5xx responses retain the request. The completion message appears only after the unchanged runner succeeds and removes its current record. An existing in-flight resume is reported as busy, rather than being adopted as this button's completion.

Recovery scrubbing retains the hold and counter for accepted jobs. The sign-out function, actor authorization, actual intake/card runner, native-versus-generic card transport, frozen writers, SQL, workflows and server authorization are unchanged. Native-epoch jobs retain their earlier exemption from these refusal limits.

## Finite proof

Run `node test/native-intake-retained-refusals.js`. Its **35 groups** include three expected baseline-deletion controls and 32 candidate/invariance groups. They execute the actual extracted resume, Web Lock wrapper, checkpoint, result validation, card composer and Calendar/Samples submit functions, using synthetic storage, a serialized lock model and refusing/recording transport seams. They cover exact unknown payload replay, accepted-only card recovery on all three surfaces, stale-button checks before/after lock acquisition, manual refusals, a replacement between failed execution and bookkeeping, quota failure, busy refusal, and accepted sign-out scrubbing. This is not PostgreSQL or server acceptance proof. Submit error-area wiring is source checked; its whole form journey is not executed by this lane.

`node test/native-intake-retained-refusals.js --browser` adds six Chromium helper/DOM cases at 360, 768 and 1280 px, light/dark, using the actual button rule and theme tokens. Keyboard/focus, mouse/touch, 44 px fit, loading/disabled and success states pass with zero external requests. It does not boot the full site or verify installed behavior. Seven affected preexisting suites and the extractor-integrity check pass; source hashes are in [the evidence record](2026-09-06-native-intake-retention.json).

The old baseline remains pinned. Two early test-only failures are retained privately: an external-helper wrapper confused the extractor audit, and a browser locator still named the button's pre-loading text. A subsequent styling fixture initially selected the combined staff selector rather than the standalone button rule; the anchored rule now exercises the actual intended style. No product guard was weakened for those failures.

## Remaining release holds and rollback

G6 remains incomplete: the separate actorless `CAL_CARD_JOBS_KEY` v1 queue, its five-run/48-hour expiry and authority-switch loss, unaccepted sign-out purge, unheld live-click 4xx removal, storage eviction/quota, previously deleted jobs, and old deployed tabs are outside this bounded correction. The existing single v3 slot still blocks a different request until recovery completes; this patch does not offer an unverified discard or pretend to solve permanent server refusal. Browser-local retention is not a durable server backup or a 30-day retention guarantee. Provider in-flight uncertainty and both n8n bypasses remain unresolved by this UI change.

Source review, combined browser verification, hosted checks and exact serving evidence remain separate gates. No live calls, writes, deployments, flags, n8n edits or public publication were performed for this local proof.

Before publication this source may be withdrawn without changing installed clients. After future use, a rollback must keep hold-aware retry/removal behavior or first preserve and reconcile each exact affected record. Restoring the old expiry logic can delete retained work. Do not clear browser storage or regenerate requests as a rollback. Accepted identities, partial completion and unknown outcomes must be retained for compatible recovery; existing shared-device/sign-out privacy constraints still apply.
