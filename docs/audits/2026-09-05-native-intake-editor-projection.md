# Native Create Post editor projection — source candidate

**2026-09-06 integrated test correction:** PR1326 source `dd831df58adba6b7398e17ce49f3a7a6e1665e7b`
adds reviewed accepted-native card routing metadata to the intake response. The
old whole-function pin therefore failed locally. The test now removes only that
exact additive block/field before comparing every remaining historical byte;
existing assignment authorization/response pins remain unchanged. Nine additional
actual-expression controls bring the picker suite to 46 passing checks. The
unchanged card-routing suite passes 11 checks. An injected unrelated intake change
still fails the pin. These are offline source/VM results, not new runtime changes
or serving proof; the original component evidence below retains its dated scope.

Base: public PR1309 `69ae5d338486bd8084e6bbdbe65be1c44f63dbe1`.
Remote main was separately recorded as
`ab6366136c03239965c97b050ab5cf7c9763a228`; it was not merged into this branch.
Current remote AGENTS, including frozen anonymous writers and named re-review
rules, was read. This slice adds no database migration, runtime flag or service
operation. Installed/serving behavior is **UNPROVEN**.

## Actual route and change

Calendar and Samples staff Create Post share `_calOpenNativePost`. It requires
the existing Admin/SMM identity before calling `_calNativeVideoEditorPool`.
The client-link branch of `addCalBlankCard` returns through its separate
collaborative suggestion path before staff intake; this change does not send
anonymous clients to the new read.

The old browser roster query excluded editors without `linear_user_id` even
when `intakeAssigneePool`/`nativeIntakePool` allowed them under an accepted native
epoch. The exact baseline browser reproduces that omission. The new protected
`production-write` action `intake_editor_options` is limited to Calendar/SXR
and the existing staff Admin/SMM roles, with an active client. Public Submit's
credentialless exception, client tokens and creative roles do not gain access.
Only the existing video editor choice is projected; graphics still uses its
existing default designer and accepts no override here.

The existing service-only `production_native_intake_epochs()` RPC determines
the current **new-admission preview**. Missing/unreadable/malformed policy is
a refusal. A provider response returns no roster and selects the original
browser loader, whose body is byte-identical except for its function name.
A native response returns only eligible `id`, `name`, `openCount` values;
provider mappings and other roster fields remain private.

Native roster, open-work and parent reads require an exact total, array body
and unique nonempty row identities. A server row cap or inconsistent envelope
refuses. Reads request at most 10,000 rows each; exceeding any effective cap
cannot certify complete data. No native editor is an explicit unavailable-pool
refusal, not a successful empty list. Video load uses `todo`, `in_progress`,
`tweak`, excludes parents through the same view-derived parent identity and
orders by count, raw cleaned name, then ID before adding display fallbacks.

The browser validates contract, surface/client/team, lane, row identities and
counts. It binds responses to the exact dialog and captured scalar staff
identity. Errors or timeouts retain visible picker unavailability and the
existing automatic-assignment option; they do not invoke a guessed provider
fallback. An explicit successful provider decision retains the old provider
loader's ranking and degraded-count behavior.

## Preview and submission boundary

The preview is not a reservation, permission receipt or acceptance guarantee.
It may become stale after opening. The displayed default remains a suggestion
and is omitted from the payload exactly as before; a changed explicit choice
is included in the original intake signature and items. The unchanged writer
revalidates that explicit choice and independently chooses the automatic one.
The immutable accepted-request epoch wins on replay; a new request uses current
admission. Disabling admission does not convert an already accepted native
request to provider work. Deactivated explicit choices still refuse, including
the existing refusal on an accepted request's explicit replay.

`autoAssigneeForIntake`, `intakeAssigneePool`, `assertEligibleAssignee`,
`handleIntakeCreate`, `handleAssigneeOptions`, and `handleCreateOptions` remain
byte-identical to the base. Their older read-completeness and degraded-load
behavior is preserved, not newly repaired or universally certified here.
No existing-work reassignment, Production create, general picker, sub-issue
creation permission, public-intake contract or frozen client writer changes.

## Focused evidence

- `node test/native-intake-editor-browser.js`: 37 assertions, including exact
  provider/writer source equality, malformed responses, no failure fallback,
  dialog/scope/actor transitions and in-place identity mutations.
- `node test/native-intake-editor-projection.js` with explicitly enabled
  disposable loopback PostgreSQL and `INTAKE_EDITOR_BROWSER=1`: 47 assertions,
  including six intercepted Chromium checks. Actual HTTP handler, native RPCs,
  native default/explicit assignment, role/team/activity refusals, original
  accepted epoch replay, policy changes, strict read envelopes, parent exclusion
  and blank-name tie order. Native cases made zero provider requests.
- Exact base HTTP handler returns `400 unsupported_action` for the new read.
  Exact base browser hides the unmapped editor that the candidate displays.
- Existing editor-picker, parent-count and Create Post presentation assertions
  are retained; their provider-loader extraction/registration follows its new
  name rather than deleting an old behavioral assertion.
- Repository map (299), truth (530), system map (17), deployment manifest and
  Section4 source-closure checks pass. The full unit suite was not rerun in this
  bounded slice. No pinned Deno binary was available locally, so the actual
  production-write type ratchet remains **UNPROVEN** until the hosted or
  separately available pinned tool runs; its baseline was not altered.

Reviewed runtime SHA256 values: `index.html`
`28cedb9078c2162672bde8b8f9a4c17cfa89c6967f99b333e57ebd574de339ff`;
`production-write/index.ts`
`05438500498544f04ef4399e76fc0a12ff924260a0c0f2cf63ab222759850f74`.
The five-file expected gateway closure is
`fa34e467c5e94fc3145b56304b6ae747d35b1064da7b09a8205d384d39d6fa27`;
this is source-only, with no serving fingerprint substituted for it.

The SQL harness reuses PR1309's real migration bootstrap and unchanged SQL
adapter. A count-aware adapter executes data and total in one SQL statement.
The bootstrap omits the browser view, so this lane installs its six consumed
columns with the exact parent CASE extracted from the repository's current
view migration; unrelated artifact/label columns are outside this fixture.
Provider responses are simulated and never leave the process. The Chromium
lane executes the real picker and selection handlers against intercepted
HTTP/SQL, not a complete application boot or card-materialization journey.
No installed PostgREST cap, live projection, service grants, serving version,
full migration reconstruction, client journey or production zero-egress proof
is claimed. SQL is explicitly skipped when no disposable database is opted in;
such a skip is not a passing SQL rehearsal.

Two earlier development receipts remain preserved privately: the first exposed
the fixture's missing read view, and the second reached all 39 initial SQL
assertions before the browser fixture lost an `async` keyword while extracting
source. Both fixture defects were corrected without changing an assertion's
expected behavior. No earlier failed run is reported as successful.

## Release and rollback gate

1. Independently review the exact final source and current Section4 closure.
   Integrate the stacked manifest/native-intake prerequisites with current main
   and rerun affected gates. This branch is not a standalone deploy bundle.
2. In a separately owner-approved window, verify the installed prerequisite RPCs
   and exact reviewed gateway closure through the existing manual deployment
   lane before releasing its browser caller. Capture the previous closure first.
   Confirm anonymous/client/creative refusal and authorized staff projection.
3. Release only the reviewed browser integration. Pre/post checks cover both
   staff Create Post entries, default and changed editor, failure/timeout,
   actor/client switch, native/provider admission and accepted replay. Live
   mutation checks require the separately owner-designated test context.

Clients continue their existing review, comment and approval paths: none call
this staff-only action, and both frozen writers remain byte-identical. Staff
may see editor suggestions unavailable until the matching gateway is serving;
ordinary automatic assignment remains offered and the writer remains decisive.

Abort progression on changed source/serving pins, unauthorized roster access,
native provider egress, a partial native success response, lost ownership,
default/explicit mismatch under unchanged state, or altered accepted work.
Rollback the browser wrapper/caller first, preserving all pending/accepted
intake jobs and identities, then use the captured gateway closure only if
required. No data deletion, epoch flip, migration reversal or writer re-gate
belongs to this rollback. Publication, merging, deployment and owner activation
remain separate decisions.
