# First Samples release: prepared, not authorized

This bounded G0/G1 packet belongs to the canonical Linear-exit plan (#1268).
Decision A remains NOT READY. The candidate contains Samples continuity and
inactive monitoring/recovery tools. Native manifest repair #1293 stays separate.

## Exact composition

| Component | Immutable source |
|---|---|
| Main baseline | `a05e1126437bb8c36bd3f33e3701a58924a8627d` |
| Samples #1269 | `a3f86c96e99b0d1ff3e93d6ac9f8e2ee496f8ca5` |
| Samples/monitor #1270 | `83de7ae397ae4c69d04811582798a5668312d8ce` |
| Operations #1292 | `22ea853919268c1f076c0668a020bb5c9e1c9a92` |
| Recovery #1290 | `2bcca5b156a9313b41ea096b7e70cd1043963639` |
| Integrated browser-tested source | `a8390d0342477058c4dcb39062e878f6a5848afd` |

All component heads and the earlier private all-frontend assembly are preserved.
Composition was conflict-free. Other unmerged frontend repairs are not added.
The coordinator's only test change accepts a validated full target SHA and
records it; an independent reviewer accepted it without weakening assertions.

Forward HTML SHA256:
`d9088588a11d7616dd4d12f20a63f0f959091d6324abc5704e6aa3d8e07712bf`.
Paired recovery HTML SHA256:
`2a779a02c1933908e1bdbc93df3561cf223d3cf2ac7df382f54918b013b02a08`.
These identify candidate artifacts, not deployed documents.

## Proof and limits

Local integrated proof on 2026-09-05: seven focused source suites passed
(Samples reader/local work, strict monitor, viewer and three upstream asset/count
compatibility suites), then eight actual-browser local-work groups. Operations
72 assertions and recovery builder checks passed after composing their deltas.
The exact integrated document passed all 13 forward/recovery/forward groups in
Chromium141.0.7390.37 and all 24 boot groups. Product bytes are unchanged across
those composition commits. No full unit-suite rerun is claimed; hosted CI is a
separate gate.

Recovery covers old false-empty controls, typing before debounce, held/failed/
ambiguous saves, accepted creates with trailing field debt, refresh, client and
same-client actor changes, late settlement and exact owned-byte conservation.
All writes are intercepted synthetic writes. Live server idempotence, real
client persistence, deployment/cache propagation and delivered monitors remain
UNPROVEN. The six additional UI action fixtures are not a live writer adapter.

## Ordered held gates

| Order / actor | Completion gate | What clients see | Abort and recovery |
|---|---|---|---|
| 1 / coordinator + owner | Review exact composition and CI; approve release SHA and capture serving document/writer pre-state. | Existing production; local review changes no serving bytes. | Unreviewed drift holds release. |
| 2 / coordinator + owner | Approve prepared primary-only SyncViewbot drill: labelled failure then recovery only after correlated relay confirmation; independently read exact DM and record human acknowledgment. | Only the owner's two DRILL DMs; no client/card data or business webhook. | Unknown acceptance stops sends; preserve UUID/journal and reconcile by reads, never blind POST retry. |
| 3 / infrastructure owner + coordinator | Bind fresh scoped census/canaries and served bytes; approve/install view and receipt schedules; prove actual runs/failures/delivery. Provision and drill an observer/fallback outside Actions and n8n. | Read-only TEST viewing, with normal token access logging. | Missing starts/terminals/artifacts/delivery or independent coverage hold release. Disable only this monitor and preserve incident state. |
| 4 / owner + supervised operator | Complete separately reviewed TEST journey packet and live persistence/readback. One Calendar Notes video comment has read-only preflight; reservation/seed and request-bound executor remain held. Approve/tweak and staff/Kasper journeys need their own populated fixtures. | Reserved synthetic TEST content and ordinary audit/realtime visibility to staff; real clients unchanged. | Scope drift, competing editor, unexpected egress or ambiguous acceptance stops writes. Keep residue; no retry, cleanup or ID reuse. |
| 5 / owner merge + coordinator observation | Only after prior gates: authorize Samples release, verify actual serving bytes, share-link journeys, continuity and alert/queue receipts. | Complete reads show current content; failed/incomplete reads preserve owned/cache content with stale/retry feedback; authoritative emptiness remains valid. | Lost work, wrong-client content, failed approval, false success/empty or silent monitoring stops progression. Use the compatible reader inverse. |

The runbook [CLIENT_CONTINUITY_OPERATIONS.md](CLIENT_CONTINUITY_OPERATIONS.md)
defines the proposed five-minute view/observer cadence, durable alert intents,
external sentinel and disable/recovery. GitHub cannot guarantee the interval.
Both Actions jobs share a failure domain. The verified destination is the
owner's SyncViewbot DM; new delivery, acknowledgment, schedules and independent
fallback are NOT PROVEN. A primary-only drill does not turn these gates green.
The read watcher cannot certify media playback, every rendered detail, staff
authority, real writes or zero Linear egress. Automatic TEST mutations remain
unavailable under their existing stronger scope/quiescence contract; do not add
a frozen client-writer gate to enable a robot.

## Recovery and remaining exit work

Use [SAMPLES_RECOVERY_REHEARSAL.md](SAMPLES_RECOVERY_REHEARSAL.md) and the guarded
builder with the exact clean release SHA. It changes only `_sxrFetchPosts`,
preserves ownership/save/cache compatibility, retains strict fallback checks and
treats old primary pagination as incomplete. Empty recovery reads are refused;
clients retain work/content with a warning until the forward reader returns.
Keep request IDs, field debt, receipts and verified cache. Whole old-document
revert cannot display new owned debt and is not this release's operational
inverse. A defect in the retained compatibility layer needs a reviewed forward
repair. No database restore, writer re-gate, flag/credential change or n8n edit
belongs to this recovery.

The owner reconfirmed September15 cancellation. A14-day observation period
beginning September5 ends September19. Continued account access must be verified
or cancellation postponed by the owner; no billing change or data-retention
assumption is made here. Native provider reads, missing-card materialization,
history/assets/exports and zero-egress proof remain under the canonical exit
gates even after this first Samples release succeeds.
