# Guarded retirement switch preparation

This component is preparation for an operator-controlled retirement window. Installing its SQL does not activate retirement or authorize deployment.

The activation RPC requires the current closed application epoch, exact native capability values, pinned routine and trigger contracts, and classified drained provider work. It records the retirement high-water mark atomically while leaving application admission closed. A separate native reopen RPC binds the retained switch receipt and operator evidence hash, supports exact lost-response replay, and refuses stale epochs. The evidence hash records an operator assertion; SQL does not verify external worker shutdown, custody, hosting, or evidence truth.

The provider admit v1/v2 routines and an ALWAYS private insertion trigger permanently refuse new provider attempts after retirement. Existing receipts remain intact. Unknown historical rows and unresolved attempts remain refusal conditions; source-validated historical receipts do not establish fresh provider truth.

## Isolated evidence

`ISOLATED_POSTGRES`: receipt `e130848457d043bcaa95b4a21b00258a` passed 29 checks on PostgreSQL 17 and stopped its disposable server. The tested switch owner SHA-256 was `c0fc33fd633fd826e85fe47d59ae02cab82b8bc379239dc2f60383516eb48453`. This component run preceded the comment-observation terminal predicate override in owner 181213.

Checks cover exact dependency refusals, rollback of a failed switch, a concurrent provider admission waiting across activation and then refusing, closed-gate rollback, separate native reopening and replay, preserved pre-switch receipts, actual post-cutoff native writes, provider v1/v2 and private insertion fencing, and stale reopen refusal. The shared post-cutoff assertions exercise their selected source paths; this is not every application lifecycle or hosted-worker coverage.

The current source additionally pins the terminal predicate from owner 181213 and requires installation order 62741, 181213, then 62149. The final component rerun `f03ea6ab9b9c42208a77f93ca896ea0e` passed the same 29 checks, exited zero, and stopped its server. Its switch SHA-256 is `4714999649049ea845d5e94c53b50a13d6f1739d82d2c52ba498fbf42176cc14`, dependency artifact SHA-256 `191196787a602bc5200f555a898184fbbceceb974ec7dfb88144e6d6235fdc27`, and test SHA-256 `df7064bbdff5756ddf1749a936f99a3832c9eaf16ec2b38cda5c6c57d25e9f88`. This confirms the exact installed predicate metadata in the switch composition; it does not replace the comment observer's separate operation-specific proof. Earlier failed rehearsal receipts remain retained as failures; no assertion was relaxed to authorize a business write.

## Remaining boundaries

The fixture is source-composed application schema, not an assertion of exact current hosted schema. Full final installation and recovery must include the new private fence through an explicitly versioned control profile. External worker coverage, historical ambiguous attempts, final snapshot and object custody, deployed configuration, and the owner-approved activation window remain separate requirements. No provider request, hosted write, deployment, or operational retirement occurred in this proof.
