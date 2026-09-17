# Native urgent receiver: review-only graph preparation

> **Superseded implementation route — owner clarification, 2026-09-09.**
> Preserve this draft as historical evidence; do not install its new n8n root.
> The current repair uses `production-write` and the native notification outbox
> plus `notify`, with zero new n8n executions. Workflow `TJVMyfwl85qrFGeK`'s
> hardcoded editor fallback is replaced by active `team_members.slack_user_id`
> mapping for the assigned native deliverable. The old live map remains an
> operational dependency until native urgent receipts and the old-route cutoff
> are verified. See `LINEAR_EXIT_REPAIR_INSTALL.md`; no workflow is changed here.


`scripts/n8n-native-urgent-draft.js` prepares an additional authenticated root in
one privately captured urgent workflow. It preserves every original node, edge,
credential reference and metadata field. An exact inverse verifies preservation.
The nine added nodes have no edge into the old provider lookup or response tails.
The existing roster, exact email fallback map, fixed channel and Slack bot are
reused. Unknown or conflicting recipients are refused; callers cannot supply a
Slack recipient. This draft does not retire the old root or change any caller.

Run `node scripts/n8n-native-urgent-draft.js PRIVATE_BINDING PRIVATE_CAPTURE PRIVATE_OUTPUT`.
The output directory must be outside this checkout. Inputs require `sourceBase`
equal to `5bcc03bd7d286f437ad51d4cc86a5ce80b7b63ea`, exact `captureSha256`,
`activeVersionId`, `mappingCodeSha256`, `nativeUrl` and `appOrigin`. Optional
`jwtCredential` is an already separately approved `{id,name}` reference, never a
secret. The output is `native-urgent.review.json` and `RECEIPT.private.json`;
existing files are not overwritten. Raw captures, mappings, endpoints and output
graphs remain private. The original `activeVersion` is deliberately retained as
captured evidence, so this is not an API update body or deployment manifest.

The receiver uses Webhook 2.1 `jwtAuth` credential-store authentication and raw
binary `data`. Exact n8n tag `n8n@2.37.7` Webhook/description source and the
official `packages/nodes-base/nodes/Webhook/utils.ts` establish that credential
authentication occurs before graph execution and verified claims appear in
`json.jwtPayload`. The private utils file SHA256 is
`be2447ce969060de76aecfad5c8130aa61450b743325272c4b40bb61c2d6b557`.
No Code node reads a secret or authenticates a body-supplied claims object.

The separately prepared sender is commit
`f6d372a588a4be1c1f10a291ce29b080b07b904b`. Its dedicated key environment name is
`NATIVE_URGENT_HANDOFF_KEY_HEX`: 64 lowercase hex characters interpreted as a
UTF-8 string, not decoded bytes. A future n8n JWT credential must explicitly use
passphrase/HS256 and the same string. No credential has been created or bound.
There is no environment-secret fallback in the receiver.

JWT claims are exactly `purpose`, `aud`, `jti`, `iat`, `exp`, `body_sha256`.
Purpose is `native-urgent-handoff-v1`; audience is
`syncview:n8n:native-urgent-video:v1`. The UUID dispatch, 60-second lifetime,
five-second future skew and SHA256 of original UTF-8 bytes must match the exact
`native_urgent_video_v1` body. Only JSON with at most one UTF-8 charset parameter
and identity encoding is admitted. Context binds native deliverable, client,
card, surface, video team/round, current editor and staff actor; no missing
identity is inferred. The sender's configured fixed destination and protected
database checks remain necessary parts of the contract.

Only a successful Slack result with a timestamp matching
`^[0-9]{10,}\.[0-9]{6}$` produces `{ok:true,contract,dispatch_id,delivered:true,slack_ts}`.
Failures, empty roster output, missing credentials, runtime failures or ambiguous
Slack output cannot produce a healthy acknowledgement. No automatic retry is
prepared. Replays during the 60-second window remain possible: there is no
durable consumption record or exactly-once claim. The sender rechecks the same
assignment snapshot before its request; reassignment after that check cannot be
made atomic with Slack and remains a stated limitation.

Validation is local/offline: 31 synthetic groups exercise the generated verifier,
strict bindings, recipient refusals, graph preservation and Slack acknowledgement.
The private exact nine-node capture also passes generation/inverse checks and
retains its captured fixed Slack channel. This does not execute n8n, test hosted
JWT credentials, prove Code crypto availability, verify actual Slack response
shape, send a message or establish operational continuity. The unbound credential,
reviewed installation, exact hosted runtime checks, caller integration and a
separately authorized delivery drill remain held. Existing urgent functionality
is unchanged. No source-only receipt is evidence of deployment or delivery.
