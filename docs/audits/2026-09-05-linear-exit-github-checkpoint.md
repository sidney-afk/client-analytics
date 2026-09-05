# GitHub program checkpoint

Captured 2026-09-05T23:15:28Z through public GitHub REST. PR1268 metadata was read immediately before the remaining batched snapshot. All check-run and commit-status pages were complete; no request failed.

| Target | Exact current head | GitHub state | Hosted checks at that head |
|---|---|---|---|
| PR1268 canonical plan | `1cc9664c079642e576e2cfe1d0a4a73a7c75fe1c` | OPEN, draft, unmerged | 3 success |
| PR1295 Samples continuity | `56fad300638094e268d2f10dabaf0ffc5661ec6d` | OPEN, draft, unmerged | 6 success, 2 skipped |
| PR1303 initial-read monitoring | `92d261c45ab9bacef38829c0fc7c9597e344ca61` | OPEN, draft, unmerged | 4 success |
| PR1308 native completion | `48f75012a3826d27ef087556eca90b941709d3c1` | OPEN, draft, unmerged | 3 success |
| PR1309 native assignment | `69ae5d338486bd8084e6bbdbe65be1c44f63dbe1` | OPEN, draft, unmerged | 4 success |
| PR1311 history-v5 corpus correction | `aab2acd23112f7bdff849a9c0b68306d41bbf62c` | OPEN, draft, unmerged | 3 success |
| Branch `fix/calendar-comment-receipt-fingerprint-20260905` | `7e5a743cce8a1552bc822e0e560896451f983cdf` | Published; PR/merge state not queried | 0 check runs: hosted proof absent |

No current check failed or remained pending. PR1295 skipped `production-polish-interaction` and `production-polish-heavy`; skips are not passes. All seven heads have zero legacy commit-status contexts: the API's aggregate `pending` label for an empty status set does not indicate a running or failing check.

Material reconciliation:

- PR1311 has advanced from `aadb010184d4fe23017ac681c663df8cc9a3e1e4`. Its restricted-role authentication CI failure belongs to that old head. The current `aab2acd2` head has three successful checks. This inventory does not independently certify the new code or schema/restore completeness.
- PR1309's current head is `69ae5d33`, not the pasted Claude `3a32f592fd5456469d5b4e6ed556a6ce573a4a47`. Earlier actual-handler/SQL proof at the unchanged runtime parent and the later 39 reader checks remain separately pinned local evidence. Current hosted checks are all four successful.
- PR1308 remains the corrected Claude `48f75012` head. Its three green hosted checks do not refute or close the separately reproduced replay/rename defect.
- Fingerprint `7e5a743c` is publicly available and previously source-hash verified, but has no hosted checks. Its independently rerun 238 handler checks remain local, RPC-shaped persistence evidence, not SQL or serving proof.

No local tests were rerun, and no main or live-product state was refreshed. GitHub status alone proves neither deployment nor database installation, activation, scheduling, complete client journeys, or permission to merge. Source judgments and remaining program holds continue to require their separate exact-head evidence.

[Machine-readable snapshot](2026-09-05-linear-exit-github-checkpoint.json). This is the immutable 23:15 snapshot; a later documentation publication on PR1268 has its own head and checks. The operative sequence remains [GO_LIVE_CHECKLIST](../independence/GO_LIVE_CHECKLIST.md).
