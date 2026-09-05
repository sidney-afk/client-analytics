# Calendar feedback reconciliation: local candidate

**BLOCKED: native/source atomicity is not established.** The non-racing controls
below pass, but the added native edit/delete/resolve-before-source-commit controls
all fail on the experimental copy path. The second read only detects the race
after stale source content has been inserted. This is not release-ready.

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

- If the source already contains the exact original comment, readback retires
  only that owned attempt. It performs no additional write.
- If the exact native receipt is proven and source lacks the comment, Retry
  sends only that original comment through the existing pinned Calendar source
  writer and atomic comment-cell merge. It sends no status or whole-card
  snapshot. It then rereads source and native before retiring the attempt.
- A lost response during this repair remains pending. A later exact readback
  can confirm the committed copy without resending it.

Concurrent source comments are conserved by the existing atomic server merge;
current source status is untouched by this patch. Newer local typing keeps its
own revision and remains visible after the earlier attempt is acknowledged.
Existing status/source journal records are not cleared by comment confirmation.
Their normal replay is held for this exact card while its owned feedback remains
unresolved, preventing status-only replay from replacing the comment checkpoint.
No native comment is automatically replayed by this recovery code.

## Server contracts and limits

The existing `production-comments` client reader admits Samples only; this
change does not widen its policy or call it as a Calendar client. Calendar
verification instead uses the already supported `production-write`
reconcile-only receipt response, including its current canonical comment.

Source reconciliation requires the existing EF-routed Calendar source with a
complete, scoped `calendar_posts` row. Legacy source routing, incomplete rows,
unbound/rebound native cards, modified comments, and missing original metadata
remain unresolved. No routing flag is changed to make verification possible.
The server's cross-store native/source concurrency remains its existing
contract: this browser adds before/after readback, not a transaction spanning
both stores. A native edit racing the source write is reported as unconfirmed;
this is not a claim of cross-store atomicity or installed repair frequency.

**G6 / recovery accounting:** old 78e-shaped attempts have no complete original
receipt fingerprint after their other metadata disappears. They remain visible
with their original text and a precise missing-metadata notice. No round, actor,
parent or source timestamp is guessed. This candidate does not claim to recover
all legacy debt. Those attempts require separate exact receipt accounting before
Decision A; widening a server reader or authentication is not part of this work.

Frozen `calendar-upsert` / `sample-review-upsert` Edge Functions are byte-identical.
No Edge Function, n8n, migration, flag, authentication, team authority, native
gateway request contract or Samples writer is changed. The browser's existing
pinned source transport accepts an optional abort signal for this bounded retry.

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

The receiver models exact reconciliation fingerprints and current comment
readback, plus the frozen EF's atomic comment-cell merge. These are declared
local fixture contracts, not deployed RPC, auth, or live journey evidence.
Reports and synthetic screenshots stay under ignored `.codex-tmp/` and are not
public attachments. Existing 18 feedback-failure, 15 behavior and three real
BFCache groups also pass locally. Full unit results are recorded in the handoff.

## Recovery and release hold

The local change is reversible from its preserved parent; nothing has been
published or deployed. Rolling a future installed build back to 78e would retain
the owned record bytes but reintroduce the known Calendar access gap, so it is
**not** a complete client-continuity recovery procedure. The separate 6d
consumption artifact remains proved only for its original defect class; this
extension has no newly approved installed recovery artifact.

Independent exact-head review, complete candidate recovery proof, legacy-debt
accounting, monitoring integration, reserved client-continuity journeys and
production release proof remain gates. Do not update or release the preserved
draft solely because this local browser lane passes.
