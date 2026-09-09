# Native urgent video handoff

SOURCE_ONLY, inactive. `production-write` action `native_urgent_dispatch` accepts
only action, client_slug, deliverable_id, card_id, surface (calendar or samples)
and video_status_at (RFC3339). Existing staff key plus one exact active roster
actor must authorize admin or SMM. Client tokens, creative keys, unsigned callers
and test overrides cannot use this action. No caller recipient/message authority.
Frozen ordinary Calendar/Samples writers remain unchanged.

The handler reads active client, SyncView video authority, exact native card and
deliverable ownership, active batch, current tweak/Tweaks Needed round and active
same-team video editor. Existing production_assignment_context must return a
native epoch. Missing/provider/hold capabilities and unresolved legacy assignee
IDs refuse. Only exact team_members.id resolves the assigned editor. The complete
snapshot is checked again after signing immediately before one request. A later
reassignment between that read and delivery remains possible; no atomic lock.

## Configuration and signed protocol

No request unless NATIVE_URGENT_HANDOFF_ENABLED is exactly true,
NATIVE_URGENT_HANDOFF_URL exactly
`https://synchrosocial.app.n8n.cloud/webhook/native-urgent-video`, and
NATIVE_URGENT_HANDOFF_KEY_HEX exactly 64 lowercase hex characters. These are ENV
names only; no credentials created/changed. The characters are the **UTF8 HS256
passphrase, not hex-decoded bytes**. Separately approved n8n jwtAuth credential
must use HS256/passphrase on the dedicated native webhook. No staff key forwarding.

Exact JSON body fields, in order: contract=native_urgent_video_v1,
audience=syncview:n8n:native-urgent-video:v1, dispatch_id (UUIDv4), issued_at,
expires_at (Unix integer seconds, exactly 60 later), context. Context fields in
order: deliverable_id, client_slug, client_name, card_id, surface, team=video,
video_status_at (canonical ISO), assignee_id, assignee_email, assignee_name, title,
actor_member_id. IDs are trimmed strings 1..160 without ASCII controls; names and
title 1..300; lowercase email 1..254, matching `^[^\s@]+@[^\s@]+\.[^\s@]+$`.
Native IDs need not be UUIDs.

Authorization Bearer JWT has header {alg:HS256,typ:JWT}, exact claims
purpose=native-urgent-handoff-v1, aud (same audience), jti (dispatch ID), iat, exp,
body_sha256 (lowercase SHA256 of exact UTF8 body). Receiver credential validates
signature; native branch checks authenticated claims against raw body, exact
purpose/audience/context, 60-second TTL and at most five seconds future skew.
Receiver must escape human text and preserve the existing email-to-Slack mapping,
bot and fixed channel. Native requests must never reach legacy provider lookup.

One POST, five-second timeout, no redirects/retries. Only HTTP success plus exact
{ok:true,contract:native_urgent_video_v1,dispatch_id,delivered:true,slack_ts} from
the completed Slack node returns delivery=sent. slack_ts matches
`^\d{10,}\.[0-9]{6}$`. Missing/malformed/oversized/negative/wrong-attempt response
or transport uncertainty returns HTTP502 delivery_unknown, delivery=unknown,
retry_safe=false. Pretransport refusal returns delivery=not_sent,retry_safe=true;
browser must require that explicit shape before allowing another attempt.

## Proof and held work

`node test/native-urgent-dispatch.js`: 40 OFFLINE_TEST groups execute the complete
handler, real authentication/imports, synthetic SDK and synthetic transport. Both
surfaces, context/refusal, post-sign races, expiry, JWT/body binding and uncertain
single attempts covered. Targeted Deno2.5.2 adds no errors to existing 15 baseline.
No SQL/serving/n8n credential/Slack/browser workflow proof. Browser hookup and
offline n8n draft are separate coordinated changes; neither activated here.

Fixture scope follows the actual native-only intake SQL (deliverable kind/origin,
card_id, batch status/purpose), native card materialization SQL (`client` plus
`id`, not client_slug), and existing card status-at migration. The initial
synthetic fixture used the wrong client column; independent review caught and
corrected it before freeze. Both real-shaped surfaces and wrong-client refusal
are now exercised. These source contracts do not replace actual installed SQL.

No table/durable receipt/new recovery owner. No consumed nonce, cross-process
deduplication, durable exactly-once or automatic reconciliation. Token replay
inside 60 seconds is possible. Inspect actual Slack outcome manually after
unknown before another attempt. A browser local hold is not a global ledger.
Disabling this lane cannot undo sent messages. Recovery retains separately
approved gateway/n8n configuration and credential custody outside source.
Activation needs reviewed serving closures, matching credentials and dedicated
native webhook, exact roster mapping and scoped real delivery drill. All held.

## Combined preparation checkpoint

This slice combines the protected gateway, four existing staff UI callers and
the [isolated JWT receiver draft](NATIVE_URGENT_N8N_DRAFT.md) on green parent
`5bcc03bd7d286f437ad51d4cc86a5ce80b7b63ea`. The parent passed all476 unit suites
and all8 applicable hosted jobs; those results are not inherited by this slice.
Its six-file production-write closure is
`663e7e423dfe150449f820ecb1e7aa3f2506d6c55c3770cfdc65b556d1311e14`.
The deployment preparation pin changes with that source; this authorizes no
deployment or secret configuration.

Coordinator source review found and corrected two real fixture omissions:
calendar/sample cards store `client`, and the shared UI must use global
`WRITE_UI_PRODUCTION_WRITE_URL`, not the private Production closure constant.
Corrected actual-handler fixtures use the real card shape; the UI fixture loads
the actual global declaration and keeps the private constant undefined. A known
pretransport failure releases only its own local hold. Unknown/replaced holds
remain, and an old-round acknowledgement cannot mark a changed round Sent.

On the combined source,40 actual-handler groups pass with the actual receiver
envelope validator inserted at the synthetic transport seam: generated JWT
claims and exact emitted body satisfy the receiver's purpose/audience/expiry/
body-digest contract. This is not n8n authentication or engine execution.
The28 actual-VM UI checks and31 receiver controls also pass. Deno2.5.2 previously
checked these unchanged gateway bytes with no new type errors. The private
exact captured graph has9 original nodes plus9 isolated native nodes; inverse,
old-reference exclusion, expiry boundary and no-retry controls pass. Current
credential binding, code sandbox capability, actual Slack response and complete
installed browser-to-delivery behavior remain unproven. No messages were sent.

### Final refusal-guidance correction

Hosted run34157272824 on `1e9bb39668925ec8381b50aedab0f8c224b73ad5`
failed one of479 unit suites: `write-ui-failure-messages` found nine urgent
codes without shared guidance. Later SQL/recovery did not run; that failed
receipt remains evidence, not a green run.

The correction supplies all nine messages and connects known-not-sent responses
to that shared resolver in all four staff callers. Configuration, assignment
and stale-round refusals explain what to check instead of offering a blanket
retry. Unknown delivery still retains the local hold and asks for manual Slack
verification. The gateway and its six-file closure are unchanged.

The unchanged total-coverage failure-message suite passes (40 browser and185
gateway codes), and the actual-VM urgent suite passes32 groups, including all
four surfaces with deterministic refusal guidance. This is focused offline
proof; the new commit still needs its own hosted outcome and review.
