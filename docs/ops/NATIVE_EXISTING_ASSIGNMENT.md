# Existing-card native assignment — draft, unapplied

This bounded G2 change starts from validated integration
`38f29bc6d3159ddda4b698819626f1efbd37c0b3`. It covers the SyncLinear existing-card
`assignee` operation and its existing exact-card `assignee_options` reader.
It changes no browser, intake selection, Production creation, frozen client
writer, n8n workflow, current capability value or deployed function.

## Authority and accepted intent

`migrations/2026-09-06-native-existing-assignment.sql` introduces no table.
It seeds `native_assignment_epochs` with both teams in **provider** mode:
native assignment admission is disabled. The per-team contract is:

| Mode | New assignment or null clear | Exact accepted native retry |
|---|---|---|
| `provider`, `epoch: null` | Original provider eligibility and pending mirror contract | Original terminal receipt; no reassignment or provider call |
| `native`, nonempty versioned epoch | Current native creative roster; atomic terminal receipt | Original epoch and receipt |
| `hold` | Visible refusal, no mutation or provider request | Original epoch and receipt |

The intake epoch never decides this lane. Missing/malformed installed
capabilities and transport failures hold. Pre-install compatibility requires
an exact missing-function error plus a successful flag read proving absence;
neither condition alone permits provider fallback. After installation, the
outbox guard also refuses a paused old/unmarked caller if native/hold became
authoritative before its insert.

The existing `mirror_outbox` dedup key and caller-intent fingerprint remain
unchanged. Current caller authorization precedes receipt lookup. Entity,
client, team, actor, role, test/parity scope and fingerprint must all match;
another author or another target cannot adopt a receipt. Accepted native replay
may precede current target-member eligibility because it returns current
scoped state, without applying the old assignee again. Changed caller intent
remains a conflict. No automatic retry is introduced for an ambiguous response.

Fresh native writes recheck the epoch and active, exact-team, compatible-role
member inside the SQL transaction. Null clears remain valid. The wrapper owns
only `assignee_id` and reuses the existing row CAS, event, journal, dedup and F27
enqueue/hold chain. Terminalization happens on insert after the existing F27
checks. Failure rolls back the row, event, journal and receipt together.

The exact-card picker reuses the native eligibility projection and its existing
DTO. Exact counts must match returned rows within the bounded 5,000-row read;
failure/truncation refuses visibly. It is a preview, not a reservation. A
changed roster/epoch is checked again at commit. Provider mode retains the old
catalog and old retirement-flag behavior, including its pending mirror debt.

## Recovery and release holds

The safe admission kill is **hold**, preserving receipt-reading compatibility.
Restoring provider mode is a separate explicit pre-cutoff rollback decision;
disabling native admission after provider cutoff must never restore provider
mode implicitly. A historical provider receipt remains provider debt and is
held before provider validation/drain when the assignment capability is held.
No old receipt is relabeled, canceled, replayed or rewritten by this migration.

Native receipts reject edits, deletion and truncation. Their guard/read
functions must remain installed after admission is held. Reverting to a
pre-capability gateway loses accepted-native replay compatibility; a blind
inverse that drops the flag/functions/triggers or removes receipts is unsafe.

**Schema and restore integration remain mandatory before installation or
activation**, despite no new table: capture/reconstruct the five functions,
two triggers, service-only grants and seeded capability row. Restore tools must
preserve the terminal receipt payload/state and explicitly accommodate retained
receipt DELETE/TRUNCATE guards. Existing data-only packages are not proof of
that schema or trigger-aware retained-target restore contract.

The gateway makes no provider request or drain dispatch for accepted native
assignment. Actual ordinary and ordinary targeted drainer selectors exclude
its terminal receipts. This does **not** prove zero worker/provider traffic:
the full worker can read its provider viewer even with an empty selection, and
emergency F27 replay deliberately selects skipped rows under its separate
operator protocol. Full drainer/F27 compatibility, G8 provider cutoff, schema
recovery, served closure and live/operator proof remain release holds.

The reviewed migration and gateway must be included in a future exact-source
manual release. The coordinator has updated only the Section 4 declarative
source fingerprint and matching test to the reviewed gateway at `2b6c718`:
`8aeb7197ed8b4f8c3360c8697f12d9217cbfbc9aa50bbc81bc77801b9848d485`,
still five files with unchanged entrypoint. The workflow remains manual;
this source pin is not deployment or activation evidence.
No merge, deployment, flag change or live drill occurred.

An independent private v6 restore extension passed 15 PostgreSQL/handler
groups on exact implementation `82ccefba` and unchanged assignment migration
`ece90c9290d3ab8154692afd7c506e220d3202f0acec441a8fd2dd88c8e1e146`.
All 35 restored table images matched, including the original terminal receipt
and a later human assignment. Replaying the original request preserved that
later assignment and all stored rows; a late COPY failure preserved retained
target rows and trigger states. Provider attempts were zero in the isolated
fixture. This closes the bounded data/trigger compatibility probe, not the
authenticated full-schema reconstruction, installed permissions or external
F27 recovery gates. The later `2b6c718` change touches only the gateway's
malformed pre-install response check; this SQL/restore evidence is not
misrepresented as a new gateway execution at that later revision.

## Finite evidence

`test/native-existing-assignment.js` runs under the existing explicit disposable
PostgreSQL job guard (`F63_REQUIRE_POSTGRES=1` or
`INTAKE_MANIFEST_REQUIRE_POSTGRES=1`) and refuses non-loopback connections.
It reuses the existing real-handler loader, SQL foundation and transport mocks.
The journal uses the actual repository migration; fixture card owner keys are
adapted explicitly to its prerequisite contract. This is not a complete live
schema rehearsal. Expected fault paths retain their non-success responses.

The preserved exact-base real-handler/SQL baseline has eight characterization
checks: non-null existing assignment and its picker require Linear, null clear
does not read Linear but remains pending mirror work, and changing the old
eligibility flag alone does not retire the mirror obligation. The preserved
candidate `82ccefba0553c2d7dda087877d93d29156bbbb7b` passed **46 focused
actual-handler/SQL checks**, including a separately asserted
fresh `service_role` commit/replay, guest RPC refusal, two overlapping blocked
SQL sessions, real journal/outbox rollback and actual ordinary/targeted worker
selection. Most reads/RPCs use the inherited administrative fixture adapter;
the separate role canaries establish only their stated privilege boundaries.
Ten intake/create/provider helpers and five browser/policy/frozen-auth source
paths are unchanged from the exact base. See the
[public-safe source and test receipt](../audits/2026-09-06-native-existing-assignment-evidence.json).
The existing assignment/transition policy and native-assignee policy checks
pass; deployment manifest ownership remains unchanged. No full
unit suite, aggregate Production polish, hosted CI, live/provider call or
deployment proof is claimed by this document.

**Bounded pre-install correction after that SQL checkpoint:** independent
actual-function fault injection found that the old `!flag.data` check admitted
malformed `false`, `0`, empty-string and undefined data values as absence.
The helper now requires a non-array response object with exactly `error: null`
and `data: null`. All **28 offline actual-function controls** pass, including
the four falsy negative controls, valid absent-row compatibility and unchanged
installed provider/native responses. The exact original helper reproduces all
four false fallbacks; the corrected helper refuses them. No migration, picker,
writer transaction, fingerprint or drain behavior changed in this correction.
The 46-case SQL receipt is preserved at its original source hash, not claimed
as rerun. Real SDK transport-shape reachability remains unproven: no suitable
existing local SDK fixture was available, and no package or network setup was
introduced. `test/native-existing-assignment-preinstall.js` is always offline.
