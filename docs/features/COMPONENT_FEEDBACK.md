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
current body, author/role, known audience, known tweak provenance, timestamps,
attachments and lifecycle metadata. Tweak provenance follows the F42 importer's
rule exactly — an entry read out of a `*_tweaks` cell is a tweak even when the
historical row omitted the flag — because a projection that recorded it as
unknown could never match an imported canonical `true`, making that duplicate
permanent. The shared `calendar_posts.tweaks` cell is outside the importer's
vocabulary, so its tweak metadata stays unknown and, like unknown role and
unknown audience, does not disqualify an otherwise exact identity match.
Equal text or names alone never deduplicate. Alias reconciliation uses
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

Reads settle PER DELIVERABLE. The Workload popover lists several rows and each
one is an independent read, so one row failing — an aborted read on the
timeout, the endpoint's per-actor rate limit — renders the failure on that row
only; the rows that answered render their real feedback. The two degraded
states are deliberately not alike, because they are opposite facts: a row that
could not be read says "Couldn't load this deliverable's feedback" in amber,
and a deliverable read whole with nothing on it says "No feedback is available
here" in the muted italic. A row absent from the read counts as the first, not
the second. Only the signed-in staff identity moving mid-read invalidates every
row at once, and that still refuses outright.

They also settle WITHIN A BOUND, which per-row isolation on its own does not
give: read sequentially, N independent aborts cost N x the per-row timeout, so a
wide rollup of unreachable rows held every box on a skeleton far longer than the
all-or-nothing chain it replaced. The native reads run through a pool of 4, the
collection carries a 20s wall-clock deadline that also clips each row's own abort
so a late read cannot report after it, and the batched legacy webhook — which
carried no timeout at all — runs beside the pool under the same deadline. Rows
still outstanding when the deadline expires are aborted and render as the
"couldn't load" state, never as an empty thread. Each deliverable is painted the
moment it settles rather than at the end of the collection, so a row that
answered in 200ms is readable while a neighbour is still hanging. The pool size
and the deadline are product numbers about how long staff wait, not tuning
constants; both are declared next to `WL_TWEAK_FEEDBACK_PAGE_SIZE`.

Bounding the wait made a quota failure reachable, so reads are also not repeated.
`production_comment_read_budget_take` allows 120 requests per actor per fixed
five-minute window and is principal-wide, so exhausting it from this popover also
stops SyncLinear's comment panel for the rest of that window; a 20-row rollup is
20+ requests, and the pool compressed six such opens from about sixteen minutes
across four windows into two minutes of one. A whole, verified read is therefore
cached per deliverable, and a read still queued when the popover closes or
reopens elsewhere is abandoned rather than having only its paint suppressed,
between pages as well as between rows.

That cache carries its own TTL (`WL_NATIVE_TWEAK_COMMENTS_TTL_MS`, one minute)
rather than borrowing the legacy lane's five, because a cached native read cannot
revalidate a card binding. The endpoint reads the linked card before and after
building the projection and answers `link_changed` when the deliverable no longer
names it; serving a cached response skips that refusal, and a deliverable
re-linked to another client's card would put that client's notes under this one.
No browser-side check can prove a binding without spending the read the cache
exists to avoid, so an entry is pinned to the two things the browser can prove:
that short life, and the exact snapshot row the read was made for — `wlApplyData`
replaces `issueSnapshot` with fresh row objects on every refresh, so a hit dies
the moment the board learns anything new about that deliverable. The verified
scope travels with the answer, so a stored response always states which binding
it was true for. Only a projection read WHOLE is stored: the endpoint answers 200
with an incomplete projection for `source_unavailable`, `link_changed` and
`source_limit`, and remembering one of those would hold the degraded view for the
rest of the TTL after the source recovered or the link was repaired — caching an
outage extends it, and what it keeps invisible is card-only notes. Residual,
stated rather than hidden: a re-link the browser has not yet refreshed into can
still be served for up to that minute.

`retain_previous` is granted only on a binding the same response revalidated. The
size refusal (`source_limit`) used to return on the first card read alone, so a
card detached after that read still authorised the reader to keep its notes; it
now rechecks the reciprocal link first, reading the binding columns only so an
already-oversized card is not pulled twice. A failure is never cached:
remembering "we could not ask" as an answer would turn one aborted read into five
minutes of false outage on a healthy row. A cache entry is served only to the
staff identity that took it, since serving it to another is the mid-read identity
failure deferred by up to a TTL. Rows abandoned or cut off keep the "couldn't
load" state, never the empty-thread one. The cost of this is staleness: feedback
posted within the TTL may not appear until it expires, which is the behaviour this
surface already had on the legacy lane.

The popover's feedback generation is RECORDED, never inferred from the DOM. It
advances where the previous popover's feedback boxes are destroyed — on every
replacement, including a rollup that starts no read of its own — and again in
`wlClosePopover`. Reading it off the `open` class cannot work: the class is added
after the read is started, so every sample taken before then sees "not open yet",
and a popover closed before its first page returned is never sampled while open
at all, which is exactly when the abandon protection has to work. In-flight reads
are shared rather than raced, so two popovers overlapping on the same deliverable
cost one request; a shared read is abandoned only once every generation waiting on
it has given up, so one popover walking away never fails the row for the popover
that replaced it. A flight belongs to the snapshot row it was started for, like a
cache entry: after a refresh the next popover starts its own read rather than
joining a flight that will reject at its own identity check and hand back an
unavailable row.

Source-row identity fields are derived by mirroring the F42 importer's rules
exactly rather than re-deriving them, because `sameCurrentComment` compares them
strictly and any divergence makes coverage impossible — the note then duplicates
forever and can displace a source-only tweak from the popover's three-row
preview. That now covers `is_tweak`, `source_created_at`
(fallback list ending at `updated_at`, as the importer's does), `resolved_at`
(the importer's whole branch: when either boolean says resolved it takes
`done_at || updated` and never consults `resolved_at`, which only dates an entry
carrying no boolean at all),
`author_name` (labelled from the role, never "Unknown author", because the
canonical twin already carries that label), `role` (lower-cased) and
`resolved_by_name` (`done_by` first, as the importer has it). Reply AUDIENCE is
mirrored for matching only: the planner makes a reply inherit its thread root's
audience — a reply never sets its own client visibility — so a canonical twin
carries the inherited value, and matching on the reply's row-local value could
never meet it. The emitted `source_audience` deliberately stays row-local,
because the panel renders it as "Card: client-visible" / "Card: internal", a
label about what the CARD recorded; replacing it with an inherited value would
make a displayed provenance label say something the card never said. The emitted
`role` still stays null when the entry has none: an unknown role is deliberately
non-disqualifying in the match, and inventing one would start refusing coverage
rather than granting it. `test/component-feedback-read.js` holds a parity matrix
that drives both real functions over every raw shape a historical card contains,
so a new divergence fails there rather than being found one at a time.

Two places the mirror deliberately stops, both named in the matrix so they are
visible rather than assumed. An entry with no timestamp at all, where the importer
defaults to the epoch: the projection reports an honest absence instead, because
printing a 1970 date beside a tweak note invents a fact. And an entry whose deleted/resolved flag is any value
`truthy` accepts but the importer does not, across `done`, `resolved`, `deleted`
and `is_deleted`. The importer counts only a literal `true`, so mirroring would
make the projection strict, and the identical predicate governs `deleted`, so it
would start showing the body of a note the card marked deleted. The matrix
GENERATES that set from the predicate's declared vocabulary — every
`value === <literal>` comparison and every member of its token list — expands each
string token into the normalisation forms its own `clean(...).toLowerCase()` makes
equivalent, and then verifies every generated form against the executed
predicate. A token added to `truthy` therefore enters the matrix automatically,
and a change to its normalisation fails the verification rather than quietly
under-generating the family. Values the predicate rejects are asserted to stay
covered, which confines the exception to the accepting branch rather than to flag
fields in general. Both keep a visible duplicate rather than trade it for a
note hidden by a loosened match or for content that should stay suppressed.

The popover's three-row preview is ordered newest-first across both sources.
Concatenating canonical then source put every card note behind every canonical
one regardless of when it was written, so a tweak submitted minutes ago sat
behind older canonical rows and was collapsed as an "older comment" — the exact
note this surface exists to surface. Ties keep canonical before source, and an
undated row sorts last.

## Compatibility and serving dependencies

The canonical `comments`, cursor, audience and lifecycle fields are unchanged.
Staff-only optional `feedback_origin` and `resolved_by_name` display fields are
added by the reader; old writer receipts still work and missing metadata stays
unknown. Old browsers ignore the extension. A new browser with an old reader
preserves canonical comments and explicitly marks source feedback unavailable.
That held on the SyncLinear panel but NOT on the Workload popover, which read a
missing `feedback` key as proof the record was whole; because the deploy lane
only accepts a `commit_sha` already on `main`, that mixed-version window is
forced rather than hypothetical. An absent projection is now incomplete on both
surfaces. Card prewrite/canonical projection reads remain canonical-only.

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

Local result: 31 actual-handler checks, 13 Chromium scenarios, and 15 focused
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

The pixel `row context menu inventory` red is now classified and corrected.
Bounded actual-menu comparisons on exact base `731e7c2` and candidate `294b359`
reproduced the same Project-row failure: leading icon and shortcut match, but the
shipped menu deliberately omits the reference artifact's submenu arrow because
cross-client moving is unsupported. The old comparator combined every SVG path
in the row and misreported that arrow difference as icon drift.

The corrected comparator checks leading icons, labels and shortcuts exactly,
keeps submenu-arrow equality for the other rows, and requires Project to remain
disabled without an action/submenu. A real Project click must explain its refusal,
open no picker and preserve every issue field. Fourteen offline comparator checks
include thirteen negative corruptions; the actual full pixel suite now passes
in **light and dark**, including global no-write and console checks. Initial
screenshots also wait for the existing read phases to settle; no screenshot error
is swallowed or retried. The earlier base screenshot-detachment receipt remains
historical evidence, superseded for menu classification by the bounded comparison.
No runtime context-menu code changed and no second full-house run was performed.

The coordinator owns the separate no-loss/history and monitoring work. Correlate
source acceptance, reader visibility, link validity and mirror state separately;
never treat this view or an HTTP success as history retention, zero loss or
terminal queue health. Alerts must contain safe reasons/counts, not note bodies.
