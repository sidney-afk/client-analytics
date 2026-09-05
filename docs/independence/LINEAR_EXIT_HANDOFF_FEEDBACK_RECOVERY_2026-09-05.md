Start a dedicated Claude session for complete Calendar feedback recovery.

Repository: sidney-afk/client-analytics. This is an isolated implementation/review task under the coordinator's existing Linear-exit program, not a new exit audit. Read current AGENTS.md completely, including the frozen anonymous-client-writer directive, then the owning truth/runbook documents and deployment manifest. Work from the exact base below in your own checkout/branch; record main drift without integrating unrelated changes.

No production or TEST data access/mutations, merges, deployments, migrations applied to a real service, flag changes, n8n edits/execution, provider calls, credentials/billing changes, alerts, or scheduled check-in loops. Local disposable databases and fully intercepted synthetic browser tests are allowed. Never expose client identities, secrets or sensitive records. Preserve historical commits and failed receipts. Frozen calendar-upsert/sample-review-upsert and anonymous access must remain unchanged. SyncLinear must never create subissues.

Deliver a clean separately stacked draft PR, exact head/base, meaningful baseline-fails/candidate-passes tests, client-visible behavior, rollback, and explicit unproved serving/live gates. Do not broaden scope or weaken tests to get green. Stop at a finite handoff; the coordinator owns integration and release.

Fetch the published branch fix/calendar-comment-receipt-fingerprint-20260905 and start at exact 7e5a743cce8a1552bc822e0e560896451f983cdf. It includes the preserved frontend safe-hold work at ce63c74d and a separately reviewed add/readback fingerprint correction. Read docs/ops/CALENDAR_FEEDBACK_RECONCILIATION.md and qa/comment-receipt-fingerprint/README.md. The238 handler checks use RPC-shaped persistence, not PostgreSQL. Seven complete-repair cases remain red. Do not restart the Samples reader or assignment work.

Your scope: safely finish an owned client Calendar root note/tweak when its native comment was accepted but its source-card save failed or the response was lost. Support video and graphic components. Begin with a short executable contract, then implement and test the smallest complete slice.

Known constraints you must account for:
- The frozen comment-cell merge does not lock/check the canonical comment lifecycle. Browser readback followed by copying source feedback can race an edit/delete/resolve. A second read after writing is too late.
- Native adds can have a mutation receipt without an outbox. The current repaired readback still refuses that case. Prove exact accepted native receipt/canonical identity without requiring provider mirroring or adding another native comment.
- A real tweak flow accepts the comment, then its OWN native status change, then can fail the source POST. Comparing the target to its pre-status version would falsely refuse normal recovery.
- Existing receipts do not prove original source-card revision, complete original review context or which status action belonged to the comment. Capture necessary context atomically for future eligible acceptance. Reserve the exact companion status identity in the existing owned attempt before sending; receipt its result, including lost responses. Do not infer ownership from matching status text or the shared client actor.
- The failed source POST also owed component/overall status and approval-field changes. This task may implement only those exact original owned fields beside the comment under original-source-row CAS. Never replay a whole old row. A comment copy alone must not clear the whole tweak's debt.
- Keep the first slice conservative: unrelated source changes may hold recovery visibly. No per-component epoch redesign. Old attempts without trustworthy original context remain visible and unresolved.

Use additive service-only RPCs behind production-write's existing authorization; do not modify/re-gate frozen writers. Lock and verify reciprocal client/card/deliverable binding and canonical lifecycle. Preserve independent video aliases, existing entries and tombstones; reject malformed/incomplete/conflicting data. Retain idempotent materialization evidence. Do not promise permanent source/native synchronization after later lifecycle changes.

Decisive proof must drive the ACTUAL offered client button, actual handler and disposable PostgreSQL: comment accepted -> own status accepted -> source403 -> refresh -> retry completes exactly once. Test both components, notes/tweaks, outbox-less acceptance, response loss, concurrent lifecycle/review changes, wrong clients, unrelated source edits and transaction failure. Count comments, status events, receipts, outboxes and source changes; preserve newer typing and all remaining debt. Source/serving parity and live TEST journeys remain separate release gates.

Return working bounded code and explicit remaining reds, not another general commenting strategy.
