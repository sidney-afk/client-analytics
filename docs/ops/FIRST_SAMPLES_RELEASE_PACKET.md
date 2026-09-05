# First Samples release: prepared, not authorized

This bounded G0/G1 packet belongs to the canonical Linear-exit plan (#1268).
Decision A remains NOT READY. The candidate contains Samples continuity and
inactive monitoring/recovery tools. Native manifest repair #1293 stays separate.

## September 5 current-main integration: local candidate only

The isolated merge `bce37c6ab3e8211351b588bb7740facb60ef5f53` has exactly two
parents: reviewed first-Samples head
`51fae03cda4335f883aaf854b11026251f1c8f4d` and captured remote main
`5b9c0720e98f81324948bf2de932520226bc9832`. The merge was conflict-free. The
original release checkout and historical heads are preserved. This preparation
does not push or update #1295, merge to main, deploy, apply a migration, or run a
live client action. Drafts #1304, #1297, #1299, #1303 and #1302 are not added.

Relative to the reviewed first release, the entire HTML differs only in one
inherited asset-fallback comment; executable browser bytes are identical. All
Samples, monitoring and recovery helpers and assertions are retained verbatim.
Every Edge Function source file equals captured main, including its inherited
production-write change. Captured main also contributes crosswalk repair and
deployment-lane source. These are inherited source, not evidence that this
integration deployed a gateway or applied a migration. Frozen anonymous writer
source and client authorization are unchanged by the integration.

The new exact artifact pair, built from the merge above, is:

| Artifact | SHA256 |
|---|---|
| Forward HTML | `f60303eb472890187c5c273aa802a43f4c0bcd56973ef3e8de24b03f8a1a8d47` |
| Compatible recovery HTML | `3063d5426aa44ce574ecb7582e9f456cd24c45c936c967aa9acf1cd01f350c63` |
| Forward `_sxrFetchPosts` | `674d6303683703e9336188f08eb2102fbfeb8b98e2f50cf1873cf153d9b0709d` |
| Recovery `_sxrFetchPosts` | `392c29beadbb25cb66229fa07a6c81f114c722b82a3072104d90fc267188f9c2` |

The paired inverse changes only that reader and restores the forward document
byte-for-byte. It retains owned work, save/cache compatibility and client
authorization; it is not a whole old-document revert.

Exact-source local proof: 8 actual-browser owned-work groups, 13
forward/recovery/forward groups and 24 boot groups passed in Chromium
141.0.7390.37. The strict monitor suite passed 146 assertions. The full unit run
reported 407 of 408 suites passing. Its sole failure,
`test/asset-access-any-team.js`, is the same Windows
`ERR_UNSUPPORTED_ESM_URL_SCHEME` reproduced on preserved `51fae03c`; the test
file is identical across that head, captured main and this merge. The failure
remains recorded. Optional PostgreSQL, bash and type-signature execution lanes
were skipped under their existing local prerequisites, and Node emitted
experimental/module warnings. This is not a fully green hosted run or proof of
those skipped lanes. Repository-map 313, truth 527 and system-map 17 assertions
also passed after updating this packet. No production database proof is claimed.

Separately, the coordinator's static public-document read at
2026-09-05T20:28:29Z matched captured main's HTML, SHA256
`03b1a904c56fe8c0b5299d531bbe80db3c90056b2cacccdf17e280be9e27e826`.
It did not match the forward candidate above and did not exercise a share-link
journey, a writer, or an Edge Function serving closure. The earlier `a05e1126`
observation below remains historical evidence.

Release remains held for independent review of the final exact integration,
applicable hosted checks, refreshed serving/writer pre-state, the approved
populated TEST journey and persistence/readback, and operational watcher and
alert/fallback proof specified in the ordered gates below. The separately
identified comment refusal/reopen defects and their repair are not closed by
these Samples tests. During this local preparation clients continue to receive
the existing deployed document; none of the candidate bytes or synthetic writes
reach production. The historical composition, artifacts and receipts below are
retained as the earlier packet, not substituted for this new artifact pair.

## Exact composition

| Component | Immutable source |
|---|---|
| Main baseline | `a05e1126437bb8c36bd3f33e3701a58924a8627d` |
| Samples #1269 | `a3f86c96e99b0d1ff3e93d6ac9f8e2ee496f8ca5` |
| Samples/monitor #1270 | `83de7ae397ae4c69d04811582798a5668312d8ce` |
| Operations #1292 | `22ea853919268c1f076c0668a020bb5c9e1c9a92` |
| Separately pinned monitored document | `5b9e0191c17c2199ab94c3d6adc2b10ee34a3014` |
| Refused proxy reset recovery | `637e15c14b8278f3bbb7a5ab659efcfe8d0eaf46` |
| Closed denial diagnostics and actual-run handoff | `6383bd915bc0403d1b26140adda3cafe0d5f6749` |
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

The two later monitoring corrections were independently reviewed and composed
at `cd07f918607bef7790d1846328c4ff2f35b2ebed`. They change no product HTML or
writer. Viewer 57, operations 75 and transport 27 assertions passed on that
composition; the synthetic transport receiver recorded zero escapes.
The document pin now identifies the actual serving HTML independently of the
monitor code revision; the refusing proxy retains its denial on TCP reset while
letting the worker produce a terminal failure receipt.

Actual read-only TEST evidence on 2026-09-05: serving HTML matched source
`a05e1126437bb8c36bd3f33e3701a58924a8627d`, SHA256
`27db2f4e5e40f03cf599fbd43c5d14fdae226ddef987f3b245506012bf1ee638`.
Fresh census counted 24 Calendar rows (including the settings sentinel) and
zero Samples rows. The first run crashed on a proxy socket reset; the actual
observer then reported missing terminal receipts. After the correction, both
lanes terminated and retained `mutation_blocked`. Their read coverage remains
HELD while background traffic is classified. This is not evidence of a failed
website save or a successful live viewing journey. No business writes occurred.

The diagnostic extension through `6383bd91` was independently reviewed and
composed at `cd9bfe57cb1ef86b6910a072d3c5f944e7e1594e`. Viewer 57, operations
87 and transport 30 assertions passed, with zero synthetic receiver escapes.
All denials remain in force. At 19:15:19Z, actual read-only TEST runs on the same
document pin identified blocked metadata POST, realtime and proxy activity for
Calendar, and blocked realtime for Samples. Both starts and terminals were
retained; neither whole viewing journey passed. The private empty Samples census
cannot establish positive card rendering. A separately defined initial-Samples
read subset would need independent safety outcomes through teardown and an
approved eligible nonempty canary; these are pending, not waived release gates.

The owner-approved primary alert drill delivered exactly two labelled DRILL
DMs, failure and recovery, at 2026-09-05T18:36:02Z. Separate Slack reads matched
the exact messages and relay receipts. Human acknowledgment, recurring
scheduling and independent fallback remain unproven. No product watcher has
been installed or enabled.

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
| 2 / coordinator + owner | Primary-only two-message drill delivered and independently read back; owner acknowledgment remains. Preserve those receipts; no repeated drill is implied. | Only the owner's two DRILL DMs; no client/card data or business webhook. | Unknown acceptance stops sends; preserve UUID/journal and reconcile by reads, never blind POST retry. |
| 3 / infrastructure owner + coordinator | Bind fresh scoped census/canaries and served bytes; approve/install view and receipt schedules; prove actual runs/failures/delivery. Provision and drill an observer/fallback outside Actions and n8n. | Read-only TEST viewing, with normal token access logging. | Missing starts/terminals/artifacts/delivery or independent coverage hold release. Disable only this monitor and preserve incident state. |
| 4 / owner + supervised operator | Complete separately reviewed TEST journey packet and live persistence/readback. One Calendar Notes video comment has read-only preflight; reservation/seed and request-bound executor remain held. Approve/tweak and staff/Kasper journeys need their own populated fixtures. | Reserved synthetic TEST content and ordinary audit/realtime visibility to staff; real clients unchanged. | Scope drift, competing editor, unexpected egress or ambiguous acceptance stops writes. Keep residue; no retry, cleanup or ID reuse. |
| 5 / owner merge + coordinator observation | Only after prior gates: authorize Samples release, verify actual serving bytes, share-link journeys, continuity and alert/queue receipts. | Complete reads show current content; failed/incomplete reads preserve owned/cache content with stale/retry feedback; authoritative emptiness remains valid. | Lost work, wrong-client content, failed approval, false success/empty or silent monitoring stops progression. Use the compatible reader inverse. |

The runbook [CLIENT_CONTINUITY_OPERATIONS.md](CLIENT_CONTINUITY_OPERATIONS.md)
defines the proposed five-minute view/observer cadence, durable alert intents,
external sentinel and disable/recovery. GitHub cannot guarantee the interval.
Both Actions jobs share a failure domain. The verified destination is the
owner's SyncViewbot DM; the two-message primary drill is delivered and
independently read back. Acknowledgment, schedules and independent fallback
are NOT PROVEN. A primary-only drill does not turn these gates green.
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
