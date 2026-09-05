# Calendar feedback reconciliation: local candidate

**BLOCKED: native/source atomicity is not established.** The non-racing controls
below pass, but the added native edit/delete/resolve-before-source-commit controls
all fail on the experimental copy path. The second read only detects the race
after stale source content has been inserted. This is not release-ready.

**A separate current-server receipt compatibility blocker also remains.**
The normal add fingerprint includes top-level `action` and comment CAS-null
fields (`expected_version`, `expected_updated_at`); `reconcileEntityOperation`
omits them. Stored add fingerprints are compared exactly. The coordinator's
independent actual-source execution found conflicts for Calendar video/graphic
notes/tweaks (four mismatched digests, with matching-add and changed-body
controls; 12 checks). Local source inspection confirms the differing objects
at `production-write/index.ts` around lines 2063 and 5183. No fingerprint is
guessed or weakened in this frontend. Even the already-exact-source success
case remains conditional on fixing that separate server compatibility issue.

**Current held behavior supersedes the experimental insertion described below.**
The unsafe source-insertion path is preserved only in local experimental commit
`9f584374231dac4f52b19fa688a72f13c2ac06c9` and has been removed from this candidate.
Current Retry attempts read-only confirmation: an already-exact source copy can
retire its owned attempt only with an exact compatible receipt. Current server
fingerprint conflicts keep it pending. A missing copy remains visible and held
even under a compatible receipt control. Normal commenting and approvals remain available through their existing
paths. No new source-copy write is dispatched by this recovery function.

The missing server capability is an atomic expected-native-comment
identity/version/lifecycle check **with** source insertion. The frozen
`calendar_merge_comments(p_client,p_id,p_video,p_graphic,p_caption,p_title,p_base)`
merges only current Calendar cells by ID/timestamp; it never checks
`production_comments`. Its source tombstone protection cannot protect a native
edit, delete or resolve that has not yet reached the source. The existing
`production-write` reconcile-only read cannot supply that transaction. No
server/auth/reader widening is attempted here.

This extends the stopped local experiment `f51ba369a7a4f0be47e13e97307136e607c452e7`,
based on preserved draft #1304 at `78e6b3eaf35e254daa23dd69b2d8f9ee54974434`.
The original draft and separate consumption recovery remain unchanged. Nothing
here is installed or production-proven. The earlier failing experiment and its
receipts remain preserved; its blocker document describes that historical state.

## Visible behavior and exact scope

After a Calendar client submits a tweak, its original text remains reachable in
Review while confirmation is pending, even if the component leaves Client
Approval. This is an owned recovery panel, not broader Tweaks Needed eligibility.
It offers Retry card sync, the existing Sheet jump and a newer unsent note.
It never offers another native tweak or approval for that pending attempt.
Wholly refused requests retain their existing expanded Review retry behavior.
Samples and staff/Kasper review behavior are unchanged.

New Calendar client gateway tweak attempts capture the actual serialized native
request in their existing owned composer record before transport. The existing
gateway's before-attempt hook captures the original ID, timestamp, component,
body, parent, round, audience and card/native binding. The owning principal and
client capability lease remain required. No token/header credential is stored,
no second queue or durable store is introduced, and capture failure keeps the
draft without sending an uncheckpointed native request.

Retry revalidates the current client/capability/card/component/native binding,
reads one complete scoped source row with exact count proof, and uses the
existing authenticated `production-write` **reconcile_only** operation with the
original fingerprint. Its exact receipt and current public comment must match
the original identity/body/audience/round/timestamps and an unmodified version.
Unknown metadata keys cannot introduce another gateway action. Failed, partial,
edited, wrong-owner or rebound reads keep the user's text and pending warning.

- If source and an actually compatible exact native receipt both contain the
  original comment, readback retires only that owned attempt without a write.
  The current server fingerprint mismatch prevents claiming this as installed
  or current-server success.
- If native acceptance is proven but source lacks the comment, current Retry
  holds the original text and reports that its Calendar copy needs review.
  The experimental comment-only insertion plus second read was insufficient
  against a native lifecycle race and is no longer executable in this candidate.
- An already committed source copy can be confirmed without resending it,
  including after its original save response was lost.

The experiment's non-racing controls conserved concurrent source comments and
status, but that does not close the cross-store race. Current held Retry makes
no source changes. Newer local typing keeps its
own revision and remains visible after the earlier attempt is acknowledged.
Existing status/source journal records are not cleared by comment confirmation.
Their normal replay is held for this exact card while its owned feedback remains
unresolved, preventing status-only replay from replacing the comment checkpoint.
No native comment is automatically replayed by this recovery code.

## Server contracts and limits

The existing `production-comments` client reader admits Samples only; this
change does not widen its policy or call it as a Calendar client. Calendar
verification instead attempts the `production-write` reconcile-only receipt
response, including its current canonical comment, and retains the pending
attempt when the current add/reconcile fingerprint mismatch returns conflict.

Source reconciliation requires the existing EF-routed Calendar source with a
complete, scoped `calendar_posts` row. Legacy source routing, incomplete rows,
unbound/rebound native cards, modified comments, and missing original metadata
remain unresolved. No routing flag is changed to make verification possible.
The server's cross-store native/source concurrency remains its existing
contract: browser readback cannot create a transaction spanning both stores.
The experimental post-write warning was insufficient; current missing-source
insertion is held. This is not a claim of cross-store atomicity or installed
repair frequency, nor a proof about every pre-existing writer/repair entrypoint.

**G6 / recovery accounting:** old 78e-shaped attempts have no complete original
receipt fingerprint after their other metadata disappears. They remain visible
with their original text and a precise missing-metadata notice. No round, actor,
parent or source timestamp is guessed. This candidate does not claim to recover
all legacy debt. Those attempts require separate exact receipt accounting before
Decision A; widening a server reader or authentication is not part of this work.

Frozen `calendar-upsert` / `sample-review-upsert` Edge Functions are byte-identical.
No Edge Function, n8n, migration, flag, authentication, team authority, native
gateway request contract or Samples writer is changed. The existing pinned
source transport is unchanged in the held candidate.

## Local proof

`node qa/feedback-drafts/calendar-recovery-access.js` loads the complete app with
fictional intercepted receivers. Its 16 groups cover source refusal versus
already-committed response loss, fresh/reload continuity, completely refused
requests, pending repeat-click suppression, exact original fingerprint/ID and
one native comment, malformed/partial/failed reads, changed source/native body,
wrong native owner, tampered metadata, old 78e-shaped attempts, recovery response
loss, concurrent comments/status, late acknowledgment with newer typing, same-ID
client replacement with a held read, unrelated review eligibility, keyboard
retry and six viewport/theme states (360/768/1440 px, light/dark).

The same test fails unchanged 78e at the initial missing pending-card access.
The earlier f51 candidate also failed fresh-page recovery. Those failures remain
recorded; no assertion was removed to claim recovery. The committed-source case
explicitly requires zero additional writes. Successful comment confirmation
also requires unrelated journal bytes to remain unchanged.

The 16 non-racing groups passed before the experimental source insertion was
held, using a compatible receipt mock. That mock did not faithfully represent
the newly identified current-server fingerprint mismatch. They do **not**
establish current-server compatibility or race closure. The default fixture now
returns the actual current add/reconcile conflict. The default complete-repair suite
now remains red at the missing-source repair requirement; selecting `lost,refused`
with `CAL_RECOVERY_OUTCOMES` and `CAL_RECOVERY_COMPATIBLE_RECEIPTS=1` verifies only
explicit compatible-contract controls, never current-server proof.
`calendar-recovery-contract.js` passes three current-contract holds: missing
source, already-saved source and old 78e metadata, all with visible owned text
and no repair write. `calendar-recovery-races.js` explicitly uses a compatible
receipt control to isolate atomicity and separately records seven
safe holds (four verified null/empty video/graphic cells and three withheld
native lifecycle race setups). Its full repair acceptance stays red rather
than passing vacuously because no source commit occurred. Divergent legacy
video alias content is preserved and held; malformed/nonarray cells and
incomplete entire reads are not treated as empty.

The receiver models exact reconciliation fingerprints and current comment
readback, plus the frozen EF's atomic comment-cell merge. These are declared
local fixture contracts, not deployed RPC, auth, or live journey evidence.
Reports and synthetic screenshots stay under ignored `.codex-tmp/` and are not
public attachments. Existing 18 feedback-failure, 15 behavior and three real
BFCache groups passed during the extension. Exact final-head reruns and unit
results are recorded in the handoff. The work-in-progress full unit invocation
was diagnostic, not an immutable-head certification: it exposed two known
Windows failures, a dirty-tree guard and an extracted staff fixture missing its
`_isClientLink:false` global. The fixture was corrected without changing its
assertions; the clean-tree guard is rerun after the local commit. Neither known
Windows failure is waived or silently made green.

## Recovery and release hold

The local change is reversible from its preserved parent; nothing has been
published or deployed. Rolling a future installed build back to 78e would retain
the owned record bytes but reintroduce the known Calendar access gap, so it is
**not** a complete client-continuity recovery procedure. The separate 6d
consumption artifact remains proved only for its original defect class; this
extension has no newly approved installed recovery artifact.

Independent exact-head review, complete candidate recovery proof, legacy-debt
accounting, add/reconcile receipt compatibility, atomic native/source repair,
monitoring integration, reserved client-continuity journeys and
production release proof remain gates. Do not update or release the preserved
draft solely because this local browser lane passes.
