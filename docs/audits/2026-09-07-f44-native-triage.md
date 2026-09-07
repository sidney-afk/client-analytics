# F44 native completion through website triage

SOURCE_ONLY preparation from PR1332 `cfb042aca6394edc0f6f9c4ebab928b1e223f806`.
The canonical go-live checklist remains the release authority. No deployment,
workflow edit/execution, live SQL, flag, credential, or provider write occurred.

Old F44 bodies omit the selected team set. Their two keys cannot establish
whether a second team was never intended or its send was interrupted. The
existing strict `received` response already promises staff triage. The protected
Submit inbox now makes that promise actionable: an actual admin/SMM reads the
complete original and explicitly confirms the intended teams. Normal current
native Submit keeps its existing automatic path.

## Runtime owner and completion

`production-write?action=legacy_intake_receive` accepts the original body bytes
using the existing public intake flag, active unique client binding, rate ledger
and maximum. UTF-8 decoding is fatal. Missing team, hash, matching receipt and
idempotency key, extra payload fields, or canonical/hash mismatch refuse. The
marker selects a protocol and supplies no authority. Forwarders use the existing
public anonymous gateway transport binding; they must not invent staff headers.

`legacy_intake_native_triage` groups immutable canonical payloads by their hash,
retains exact first envelopes for each received team, and records public origin
separately from the real completing staff actor. The unchanged F44 receipt table
keeps its provider vocabulary and IDs. Fresh capture commits both owners before
202 `received`; historical created receipts retain their actual UUID response.
Historical pending/failed/partial and mixed unknown ownership are held. The
protected inbox also reads unresolved historical receipts which have never
retried, without falsely claiming their raw envelope was captured.

Staff confirmation fixes one request ID, timestamp, native payload and team set.
The native gateway checks its real epoch before provider preparation; a server
argument requires this path to be native. Root acceptance additionally checks
the triage owner under receipt-first locks. After acceptance, the original
manifest owns child recovery and the existing card materialization boundary
owns Calendar creation/replay. Another verified admin/SMM can finish accepted
work without replacing its original actor or plan. Before root acceptance, only
the original confirming staff actor may resend the frozen request.

All original content remains in the immutable payload and received envelopes;
native briefs retain aggregate notes and every original footage value. No mode
or per-video notes are reverse-engineered. Confirmed teams share one root and one
paired card per video. A late included key joins that mapping. A late excluded
key becomes a visible hold; it cannot split the card or change accepted intent.
Materialization refusal remains pending completion. Human edits are preserved;
deleted/replaced/archived lifetimes remain held by the existing boundary.

## Provider admission and its practical limit

The fresh serving F44 capture was read only at 17:01:17Z on September 7: 142
nodes, matching active/draft version `e95369ca-de40-400c-802e-413efbbba853`, raw
SHA-256 `10ebf24b63ee6ef72f1c7aa0f019dec2830e1d682d85649fc74bb332270b0e8f`.
Its fresh owner is receipt INSERT, and its replay/finalization owners are
receipt UPDATEs. The provider guard rejects all UPDATE/DELETE of fresh native
keys and provider INSERT of another team for that native-owned payload hash.
Historical provider receipts retain their old write rules. A narrow transaction
local SQL context permits only the receiver's late-key capture; no browser flag
or global runtime control is added. INSERT first takes the receiver's same
per-payload advisory lock before looking for an owner, covering the absent
other-team key during first capture. UPDATE/DELETE take no advisory lock:
receipt locks precede triage-owner locks.

This cannot revoke a provider request already authorized before native capture.
If the old provider receipt wins first, native capture marks it historical and
refuses recreation. Installation still requires exact forwarder review,
quiescence of old authorized workers, and held-debt review. Historical `created`
responses preserve the old browser's provider-discovery behavior; this slice
does not claim those old browser continuations are provider independent.

## Proof and recovery boundary

Hosted review at9a33 found four failing suites: two stale deploy-closure pins,
an older byte-preservation test missing the exact new native-only seam, and
missing plain-language guidance for13 new refusal codes. The correction adds
guidance, checks the exact new seam and its disabled/enabled behavior while
preserving byte equality elsewhere, and binds the unchanged five-file gateway
closure. No gateway/SQL behavior changed in this correction; the24-group SQL
receipt below remains its original evidence. Focused46 editor and11 failure
message checks pass. Historical hosted failure is retained, not relabeled.
Both focused release-pin checks also pass. The local four-function fingerprint
needed more than its old30-second test deadline; the bounded test now allows120
seconds and reports timeout errors explicitly, retaining every closure assertion.

Final focused result: **24 actual-handler/disposable-SQL groups pass, with zero
provider/drainer requests; 13 isolated Chromium inbox checks pass**. The exact
original nine-key body, including leading/trailing whitespace, is exercised at
the query-action endpoint and retained byte-for-byte. Two real SQL sessions
exercise the receipt-first lock order and old provider UPDATE refusal. Two more
real-session races observe advisory blocking before the first owner commits:
native-first rejects the old other-team INSERT; provider-first preserves its
receipt and refuses native acceptance. Existing
F44 durability retains all 72 checks; receipt contract, native intake UI and
16-group owned selector checks pass. Repository map 520 and truth 542 checks pass.
No full suite or live probe was run.

Final review found that the earlier 22-group result did not fence a different
team's INSERT while the first owner was still uncommitted. The separate
correction adds the INSERT-only advisory admission and both winning-order
regressions; the 24-group result includes that fix. It does not place an
advisory lock after an UPDATE's already-acquired receipt lock.

Earlier retained attempts found a genuine SQL alias ambiguity (fixed), a test
that confused malformed with disabled native flags (split into explicit controls),
and a missing service-role extension-schema grant in the minimal generic fixture
(added only to the fixture to exercise the old INVOKER hash constraint). Assertions
were retained. The generic fixture uses existing composed schema dependencies;
this is not evidence that those dependencies are installed in production.

Tested gateway bytes SHA-256:
`c82489a8710a08d0df7a0fd79d904d31e8b3b803876b409241ca8219686a59ad`.
Tested triage migration bytes SHA-256:
`1faf9a28114124ac5631db4d7561c514e19615ad60806afdd902ba335d484831`.

`test/f44-native-triage-sql.js` runs the complete actual gateway through the
existing translating SDK seam into real disposable SQL. It requires explicit
loopback ownership and the exact private F44 capture; no installed endpoint is
used. Without that binding it explicitly skips (or fails when
`F44_NATIVE_REQUIRE=1`). Failure databases and private logs are retained.
`test/f44-native-triage-browser.js` runs actual inbox functions and repository
CSS in Chromium behind a refusing proxy with a modeled gateway: explicit team
selection, completion/hold, safe original text, keyboard, three widths/two themes,
touch targets, and sign-out during a pending read. It proves the inbox behavior,
not a deployed journey or whole-app browser coverage.

`scripts/f44-native-recovery-extension.js` is a separately composable inventory
for the reviewed successor to v8. It adds this owner plus the existing
`public_intake_log`, which v8 omitted. It names private bytes, dependencies and
exact migration files; it does not redefine v8 or activate a schedule. The
focused SQL lane round-trips/restores the exact owner images and resumes their
accepted manifest. Combined authenticated schema/data packaging, trigger closure,
restricted restore grants, sequence handling, custody and freshness still need
the root's combined successor-version rehearsal before installation.

Release order: review the combined recovery closure and reader first; stage the
SQL dependencies and this migration; stage this gateway plus website; verify
native epochs/materialization admission and real staff access; atomically replace
the two F44 ingress tails with exact-body terminal forwarding; prove old worker
quiescence and caller journeys. These are future owner-controlled steps, not
authorization granted here. Before serving, withdraw source normally. After any
capture, retain the mapping, private originals, provider guard, manifests and
compatible completion reader; never restore provider creation or drop recovery
owners as rollback.
