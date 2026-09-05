# Mapped component feedback

Status: isolated draft, source and fictional-fixture proof only. No deployment,
production data read, source import, migration, or writer change was performed.
Base: `731e7c248fd8c055a577e7c7f40a81236532250c` (main captured once; includes
the separate crosswalk bind/import work). No dependency on draft Samples #1295
or native-intake #1293. Later integration must preserve those independently.

## Behavior and ownership

SyncLinear's existing component detail now labels its comment space **Feedback &
tweaks**. Every canonical/general/imported/unknown comment remains in the existing
cache, page order and lifecycle controls. Proven component, tweak/round, origin
and current resolution metadata receive visible labels; unknown origin remains
visible. Current resolution is not a lifecycle-history timeline.

The existing protected `production-comments` handler accepts optional
`include_feedback: true`. Only its already-authorized staff principal may receive
the additive `feedback` object. Client-token callers neither read legacy source
cells nor receive this projection, even when they request it. Existing staff key,
active-roster/team checks, read budget and durable allow audit remain prerequisites.
No client permission is widened; anonymous source-writer attribution is still a
stored claim, not independently verified authorship.

The server derives the source from the live deliverable's exact five-field F42
crosswalk (`id/client_slug/team/origin/card_id`). It reads only that client's exact
Calendar or Samples card and the selected video's `video_tweaks`/`tweaks` aliases
or graphics' `graphic_tweaks`. The card must reciprocally name the same deliverable.
It rereads the card and deliverable before releasing the response; changed scope
refuses the response, and changed source content/link withholds source rows. This
is a bounded revalidation, not a serializable database snapshot.

Source-only rows remain outside the canonical comment cache and have no Reply,
Edit, Delete, Resolve or Reopen controls. They identify their original source and
component. No speculative navigation URL is invented. Existing source cards and
writers continue to own changes; no discussion store, import or sub-issue is made.

## Identity and completeness

Coverage requires an exact existing import crosswalk, F42 composite identity, or
native comment identity in the same deliverable/component, followed by matching
current body, author/role, known audience, timestamps, attachments and lifecycle
metadata. Equal text or names alone never deduplicate. Alias reconciliation uses
maximum multiplicity of identical stable-ID records; one canonical row covers at
most one source occurrence. A covered source row stays visible until the browser
has actually loaded its canonical row at the proven version and database update
clock. Canonical-only refreshes and write receipts cannot reuse earlier coverage
after an edit or resolve. Divergent versions and unknown identities
remain visible. Reply coverage requires the exact corresponding parent identity.

Reads cap source payload at 1 MiB and source/identity comparison at 500 rows each.
They do not silently certify truncated/malformed data, hidden or contradictory
component entries, failed source reads, missing bindings, or incomplete canonical
pagination. These states say the record is incomplete. Hidden source content is
never resurrected. A transport/parse/size failure may retain already-loaded content
with a stale notice in the same verified scope. Partial reads carry an explicit
`retain_previous` decision; observed hidden/deleted/contradictory component rows
disable it. Changed-during-read snapshots also withhold prior content rather than
guess whether a newly hidden body is safe. A confirmed link change drops prior source content. Source read failure
never becomes “No feedback.” This only covers readable, mapped video/graphics
feedback; unmapped cards, caption/title-only cells, restore and complete historical
versions remain outside this slice.

## Compatibility and serving dependencies

The canonical `comments`, cursor, audience and lifecycle fields are unchanged.
Staff-only optional `feedback_origin` and `resolved_by_name` display fields are
added by the reader; old writer receipts still work and missing metadata stays
unknown. Old browsers ignore the extension. A new browser with an old reader
preserves canonical comments and explicitly marks source feedback unavailable.
Card prewrite/canonical projection reads remain canonical-only.

Exact runtime changes: `index.html` plus the `production-comments` closure
(`index.ts`, `policy.mjs`, new `feedback.mjs`, unchanged shared staff-role auth).
Existing card tables, comment table, F42 links and read-auth RPCs are required;
there is no new SQL. Existing correct crosswalks are required, not presumed live
because a repair migration appears in git. The generated deploy manifest records
the new dependency. Deployment/source fingerprint, installed serving behavior,
live latency, completeness counts and alert delivery remain UNPROVEN.

The registered manual onboarding deploy workflow deploys several functions,
including writers; it is not a reader-only release or rollback. Do not dispatch
that broader lane for this draft without a separately reviewed release closure.
No workflow was dispatched here. A coordinated future release should verify the
exact reader closure before publishing its browser; both mixed-version directions
degrade compatibly. Revert this browser diff and restore only the previously
captured reader closure to roll back this slice. Keep current canonical/source
data, receipts and independent writer releases. No table drop or queue replay is
part of rollback. A browser-only revert hides the new view, not its stored notes.

## Finite proof

Local result: 26 actual-handler checks, 13 Chromium scenarios, and 15 focused
existing compatibility/registration suites passed. These are synthetic/local
results, separate from hosted checks and live serving proof.

Independent review corrected cross-alias suppression: a hidden or deleted stable
identity is collected across both video fields before any body is emitted,
including suppression beyond the projected row cap. Stale aliases cannot revive
it; unrelated identities retain their multiplicity and actual tombstones/replies
remain visible. Hosted type checking also required a literal key tuple for the
five-field target recheck; no baseline type allowance was changed.

`node test/component-feedback-read.js` executes the actual request handler,
staff auth, policy and projection against finite mocked Supabase tables. It is
auto-discovered by the unit runner. The mock substitutes transport, not policy;
it is not a disposable-SQL or deployed PostgREST proof.

`node docs/syncview-design/tests/prod-feedback-browser.js` executes the actual
comment renderer, normalizer, page/cache loader and shared focus restoration in
Chromium with fictional transport and component mounting. It is registered in the
fast Production gate. It covers row preservation, exact-ID coverage, pagination,
old responses, read failures, deleted parents/replies, actor switch, client
exclusion, keyboard retry and 360/768/1280 light/dark layouts. It does not prove
the complete app router or full Production polish. Optional local synthetic
screenshots use `FEEDBACK_SCREENSHOTS=1`; no public artifact upload is added.

The required `npm run test:prod-polish` ran once on `120fb0d9610fda381ab8e900c487b9908268d83b`:
8/11 suites passed; structure, wired behavior and pixel parity failed. The
feedback-related structure failure was a stale visible-state selector, followed
by an exact read-shape allowlist missing `include_feedback: true`. The final
test-only correction recognizes the visible feedback notice and that exact
optional read shape. Actual structure and smoke suites then passed; the existing
UI-source suite exercises both real guards, including 22 refused malformed or
write-shaped requests. Runtime code is unchanged after the independently reviewed
`120fb0d` privacy correction.

The behavior red reproduced at `5510ce0`: `keyboardStatusGuardOpens` correctly
showed the sign-in refusal with no picker, while the whole-model snapshot changed.
Private aggregate diagnostics identified population and project-projection
replacement, not a status/assignee/due mutation. The existing loader paints its
first projection before its terminal tail adds ancestors, replaces synthesized
parents and resolves project keys. The reset predicate had ignored both
`refreshing` and `terminalTailPending`. Requiring those existing reads to settle
before a guard snapshot fixes that readiness error; the actual behavior suite
then passed **168/168**, retaining exact whole-model equality and all global
no-write/console assertions. No runtime keyboard code was changed.

Pixel `row context menu inventory` remains open. An isolated run serving the
captured base's exact `index.html` passed the unchanged behavior suite, but the
base pixel attempt stopped earlier at an element-detached screenshot. The pixel
red is not established as a baseline defect; product regression versus timing or
test infrastructure remains UNPROVEN. No assertion was weakened and no unrelated
context-menu code was changed. No second full-house run was performed.

The coordinator owns the separate no-loss/history and monitoring work. Correlate
source acceptance, reader visibility, link validity and mirror state separately;
never treat this view or an HTTP success as history retention, zero loss or
terminal queue health. Alerts must contain safe reasons/counts, not note bodies.
