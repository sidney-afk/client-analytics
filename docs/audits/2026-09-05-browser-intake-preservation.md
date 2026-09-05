# Browser intake preservation: bounded repair, not native independence

Draft implementation only. Baseline: fetched `main` at
`a4925097aad2be1d8b4710e56da1220a19c850c5`. Evidence PR [#1274](https://github.com/sidney-afk/client-analytics/pull/1274)
was verified OPEN/draft at `92d50240cebe8dc6855a89e69c08f76bd0a1ddc1` before use.
Its handoff and corrected G2b explain why a failed response can follow a committed
batch and one child. Its 63 current checks, 13 red readiness gates, and seven
unproven entries are not a native-independence certificate.

## Name-only routing correction

Independent re-review of `6c2be5a8a55a6ec2573c9ec6ad24b85b607aef4f` found that a
legitimately restored form can carry a unique client name and an empty saved
slug. The real `_linearResolveClientRow` resolves that name to the original
client, but the archive guard compared only the raw optional slug. A false
routing flag therefore dispatched once through the legacy wrapper, bypassing
the marker. The extended browser test reproduces that failure on the reviewed
head (exit 1, one legacy call where zero is required).

For an actor with unresolved markers, Submit now resolves the canonical client
before comparing marker scope or selecting a transport. If needed it awaits
catalog loading and rechecks the original input element, name and slug before
continuing. An ambiguous/unresolvable name or failed catalog read cannot prove
the request is unrelated, so no transport is selected. No client resolution
grants authorization. Actors without unresolved markers retain the existing
routing behavior; the earlier F44 receipt-recovery branch remains unchanged.

The Chromium fixture now uses the actual `renderLinearView` restored input,
`_linearResolveClientRow`, routing-flag fetch/failure/prime functions, and legacy
wrapper (with an inert F44 receiver counter). Candidate checks pass for normal
slug and name-only forms with both false and failed flag reads, ambiguous and
missing names, an unrelated client using the established legacy fallback,
selection changing during asynchronous catalog loading, catalog failure, and
existing F44 receipt priority. All requests are intercepted. The existing 23
preservation cases stay green; no unrelated full-suite run is claimed.

## Independent-review correction

The adversarial review of initial repair head
`013eb53a2ec3c7242e5027671153a2f186607f45` reproduced two defects. Its script was
rerun against that exact source (only its result-file destination was relocated):
actor B/client B was blocked by A's invisible unknown marker, and a legacy
accepted job paused at `resume_refusals=3` resumed one card write after sign-out
reset its budget to zero. Both are corrected on this branch.

Unknown markers now move to `syncview_native_intake_pending_v1:unresolved` under
the existing intake lock. Only scrubbed metadata is archived, keyed by request
identity; the entire archive must read back exactly before freeing the active
slot. Duplicate protection is conservative within the original actor/client
scope, across teams and surfaces. Unrelated authorized scopes can use the active
slot; foreign markers remain hidden. Original-scope Submit cannot escape to a
legacy submission when its routing allowlist changes. Returning to the original
scope shows its unresolved notice, without a retry button for incomplete data.
Multiple markers remain distinct; none is evicted to make room for another.

If the separate archive write fails, the scrubbed active marker remains and a
later locked request can finish moving it. New work is refused while that move
cannot be verified. An unreadable archive is never overwritten as an empty list.
This temporary storage-failure boundary is distinct from the original permanent
global-slot obstruction. The existing privacy fallback still applies if even
the initial scrub cannot be stored.

One helper now normalizes the effective current/legacy attempt budget for both
retry execution and recovery copies. Paused legacy accepted jobs stay paused
through repeated sign-outs; current-format and malformed budgets stay bounded.

Corrected targeted results: `node test/native-intake-preservation.js` **23/23**;
Chromium fixture adds A uncertainty/sign-out -> B successful unrelated submit ->
A visible notice/duplicate refusal, multiple markers across reload, and archive
storage failure -> no dispatch or lost evidence -> verified recovery. Existing
native-intake UI, Create Post picker, public intake, and routing guard tests pass.
The unrelated full suite was not rerun for this review correction. The prior
399/400 full-suite result below belongs to the initial repair head, not this head.
Backend recovery remains UNPROVEN. The rollback prerequisite below is an open
release requirement, **not a rehearsed safe rollback**.

## Behavior

Only browser intake handling changes. No gateway, RPC, migration, provider
validation, eligibility, public rate policy, authority flag, anonymous writer,
sub-issue route, deployment, schedule, or live data changes. SyncLinear still
cannot create sub-issues. Samples-specific code and Calendar layout are untouched;
the existing shared Create Post/recovery machinery serves Samples too.

* An intake has a durable `dispatch_started:false` marker until the first send.
  Before fetch it checkpoints `true`. No result after that means **unknown
  acceptance**, including partial acceptance, not "unsubmitted".
* Errors and exhausted retry counts never delete a request. Up to three automatic
  attempts are persisted under the existing Web Lock before traffic, across
  refreshes. Manual clicks retry once; they do not reset that budget. Existing
  refusal counts contribute to the budget. No new timer or watcher exists.
* Submit and the matching client's Create Post dialog expose **Retry saved
  request** and distinguish unsent drafts, unconfirmed acceptance, and validated
  native results with incomplete cards. A failed manual retry restores focus.
  Staff-bound records remain invisible/unusable to another actor or anonymous
  entry. Card writes keep the original client and team mappings.
* Resends keep the original payload, timestamp, request ID, card IDs and actor
  context. Validated results and `completed_card_ids` retain their existing
  checkpoint semantics. Unreadable storage cannot be overwritten as an empty
  slot; an unavailable checkpoint prevents the next request.
* A Submit snapshot and the live form are compared before clearing form and
  last-link storage. Newer edits survive success even if their storage write
  failed. Anonymous retries cannot adopt a newer draft
  snapshot into an older request. Manual recovery never clears the current form.

## Sign-out: explicit privacy and recovery boundary

The B9 wording in #1274's handoff is too broad: **absence of `job.result` does not
prove a request never committed**. That assertion does not survive B1/G2b.

The existing sensitive-data purge is retained. A known never-sent draft can be
removed on explicit sign-out. A validated accepted result becomes the existing
scrubbed materialization copy. An attempted or legacy no-result job becomes a
scoped, scrubbed marker with `result:null` and `requires_original_payload:true`.
It is archived separately from the active job, retaining its original scope.
It preserves request/timestamp/client/actor/card identifiers, but no notes, links,
batch payload, brief, or form snapshot. It says staff recovery is required and
cannot be replayed as an incomplete request. Repeated sign-out keeps it unknown.

**UNPROVEN / RELEASE GATE:** lost/partial response -> repeated failure -> sign-out
-> restart -> exact recovery is not achievable by this patch. The privacy purge
removes the complete item intent, and no server-owned recovery exists. A marker
is visible evidence of unresolved work, not evidence of completion or an
implemented staff recovery tool. It blocks another intake in its original
actor/client scope until staff recovery exists; unrelated scopes remain usable.
If storage cannot save even a scrubbed marker, the existing privacy removal wins
and a notice requests staff attention. No-lock/purge-failure fallback and actual
browser-storage loss also remain recovery gaps. Do not clear these gates.

## Executed proof

All fixtures are fictional. No external request was allowed to reach a service.

* Reused #1274's unchanged `browser-lane.js` against baseline: **17/17 current
  browser checks**, both R5 gates red, U3 unproven. Reproduced deletion after six
  outage resumes and four accepted-copy card failures. SQL/gateway lanes were
  read in the corrected handoff, not rerun here; PostgreSQL 16 is unavailable
  locally. The complete original package is not copied into this PR.
* `node test/native-intake-preservation.js`: **15/15** candidate checks. Runs the
  real extracted job functions; fresh VM realms share storage between attempts.
  Covers outage, accepted-response loss, partial-response failure, exhausted card
  retries, immutable subsequent recovery, duplicate clicks, actor/client switch,
  anonymous snapshot stability, read/quota failure, and sign-out privacy markers.
  Samples runs the actual shared materializer and retains completed card IDs.
  Against baseline the pre-Samples 14-check matrix had **4 pass / 10 fail**;
  six failures directly reproduce payload/recovery deletion, one reproduces
  storage overwrite, one snapshot replacement, and two check new UI/notice
  behavior absent on baseline. These last two are not extra loss reproductions.
* `node qa/browser-intake-preservation.js`: actual Submit/Create Post handlers,
  actual retry HTML/callback, real Chromium localStorage and Web Locks. All HTTP
  routes are intercepted. Baseline fails because native success deletes newly
  typed notes; candidate preserves them. Seven page reloads send only three
  automatic requests; manual failed retry retains focus and identity; keyboard
  recovery succeeds with that same payload. Create Post retains its 409 record
  and describes unknown acceptance. Light/dark checks at 360/768/1280 verify
  visible focus, a 44px retry target, and contained controls. Screenshots stay in
  ignored `.codex-tmp/intake-browser/`. This is a controlled fixture with actual
  functions/styles/controls, not a complete application navigation proof.
* Initial repair head's full offline run: **399/400 suite exits pass**, with the affected
  native-intake UI, Create Post picker and public-intake tests green. The unchanged
  `test/asset-access-any-team.js` imports a Windows drive path as an ESM URL and
  fails `ERR_UNSUPPORTED_ESM_URL_SCHEME`; it is not changed in this repair.
  Disposable PostgreSQL suites skip locally and remain required in hosted CI.

The VM's acceptance faults are transport simulations, not cloned backend rules.
The browser suite cannot prove real partial commits, server idempotency,
calendar-upsert validation, concurrent card edits/order/non-resurrection,
provider independence, cross-device recovery, or serving/deployed-source parity.
Those remain #1274's server/release gates. No existing readiness gate is weakened.
Legacy assertions that required deletion were replaced with preservation checks.

## Rollback and review boundary

Code rollback is a revert of this PR's commits, newest first; no backend inverse
is needed. **That is not a safe data-recovery rollback while jobs remain.** The
baseline bundle can delete retained records and cannot interpret unknown markers.
Before any rollout/rollback, a reviewed private preservation/reconciliation plan
must keep pending records away from the older bundle and prove their recovery.
Do not purge storage, resend scrubbed markers, or recreate uncertain work to make
the UI unblock. No rollback was executed against a user browser or backend.

This draft is ready for independent source/proof review, not for a claim that
native intake is reliable without server-owned acceptance and card recovery.
