# Current website baseline and proposed TEST drill — 2026-09-05

**Bounded result: client reading partially observed; mobile Calendar FAIL;
authenticated staff workflows UNPROVEN. No business write drill ran.** This is
Task 1's handoff, not a whole-site health certificate or a Linear exit plan.
Application code, frozen writers, flags, workflows and deployment are unchanged.

## Source and serving provenance

| Evidence | Exact identity / time (UTC) |
|---|---|
| Isolated branch base; remote main fetched at task start | `706359752e861969e6c68898daa26e29a2eb6edb`; timestamp recorded `2026-09-05T06:36:59.414Z` immediately after fetch/read |
| Initial served HTML and base `index.html` SHA-256 | `8f64f648d4b92ac2147bd9ecf3c3f0747f4081331df275b8c10ff25e0f10c53a`; independent HTTP capture `06:39:20Z`; initial Chromium observations agree |
| Main advanced during observation; separately fetched at `06:52:11.939Z` | `a4925097aad2be1d8b4710e56da1220a19c850c5` |
| Later served HTML and that main's `index.html` SHA-256 | `0fc2e652bcb03916a04c45ed8c3c40bb67940142214badacf7f898cecab89f5e`; first seen in Chromium `06:51:05.874Z`; all 12 final navigations agree |
| Final finite pass | `2026-09-05T06:55:29.023Z`–`06:57:25.249Z`; Chromium `141.0.7390.37`; 1440×1000 and 390×844; Guatemala timezone |
| Runner bytes exercised by final pass | `run.cjs` SHA-256 `2fa136f422fe2c9f1b815f4a141cf6f810164f9767bd92c3d4dd322abba96603` |
| Policy bytes exercised by final pass | `policy.cjs` SHA-256 `6ba62406538f2dd48fff79358e6708414885cd8ff82949c15c978bd66b7fb0b5` |

The checkout remained at the first base with uncommitted tooling during the
browser run; **the browser loaded the live site, not that checkout**. Per-page
document hashes retain the distinction. The PR's head identifies the final
tooling/docs commit, not a website deployment. No branch was merged here.

Separate Management API **LIVE_READ**, `06:39:20Z`: deployed
`client-token-verify` v33 entry-source SHA-256
`1ea739f13aa5cd3394a7d772354a4d884120ef04f771f9728056ec6c926c5ef6`;
`key-verify` v39 entry-source SHA-256
`7151cf0827216d47e9963135c40d7d23fe4c04508279e88a3544d62fd932bb89`.
Their captured source contains ordinary access-audit inserts. The coordinator
explicitly clarified that normal access logging during requested viewing is
authorized; the real TEST verifier ran unchanged. This does **not** establish
any writer's deployed revision. Frozen/manual writer provenance remains UNPROVEN.

## Coverage ledger for this finite pass

| Surface / persona | LIVE_READ: observed at both widths | Blocked / NOT_TESTED |
|---|---|---|
| Client Calendar / existing anonymous TEST link | Normal strict verifier; Review empty; real Sheet toggle; 23 rendered cards from 24 raw reader rows | No review-ready component, so approve/change controls and populated review panels unavailable; no saving |
| Client Samples / same designated TEST scope | Normal strict verifier; Review and Sheet empty; primary response has zero rows | Populated cards, threads, media, review actions and persistence NOT_TESTED |
| SMM Calendar / fresh unsigned browser | Password screen, shell and logo render | Existing authorized SMM state/key unavailable; planning, staff review, cards and role actions UNPROVEN |
| Kasper review board / fresh unsigned browser | Password screen at its real route | Authorized reviewer state unavailable; queue, threads and decisions UNPROVEN |
| SyncLinear / Production / fresh unsigned browser | Password screen at `?prod=1` | Authenticated board/detail, assignment and due-date actions UNPROVEN |
| Workload / fresh unsigned browser | Landing/password screen only | Authenticated landing UNPROVEN; detailed semantics belong to Task 3 |

The independent scoped service-reader census at `06:49:43Z` returned exact
counts: Calendar 24, Samples 0, with zero `Client Approval` components. Calendar's
24 includes its documented settings sentinel (`_calSplitSettings`); 23 are cards.
A fresh-context read confirmed all 23 normalized cards rendered. This refutes
the suspected 24-to-23 card-loss discrepancy. It is not a full value/audience
comparison or an atomic before/after census. Empty Samples is genuine within
this designated scope; it says nothing about another client's Samples.

Media: one Calendar thumbnail decoded at 640×1138 in a fresh context; two other
image nodes were lazy/unloaded, so those assets and video playback are UNPROVEN.
The independently opened existing Calendar Notes panel was visible but had no
thread entries. `openCalComments` changes a browser-local seen cursor and starts
canonical reads; it was inspected before clicking. No typing/submission occurred.
Populated comment/reply correctness and canonical-reader success remain UNPROVEN.

Final request accounting: 226 HTTP 200 responses, 4 real verifier POSTs with
ordinary access logging, 2 intercepted `linear-issue-statuses` webhook requests,
55 intercepted WebSocket attempts, 14 request failures and 2 console errors;
zero page JavaScript exceptions. The console failures accompanied the blocked
Calendar webhook. Failures are retained, including close/abort failures; they
are not silently relabeled successful reads. Realtime, webhook-derived status,
unrequested readers, thumbnail history, and full media retrieval are excluded.

### B-01 — confirmed client Calendar horizontal overflow (FAIL)

Reproduce using the private existing TEST Calendar link in a fresh 390×844
context. Let Review settle, then select Sheet without editing. Expected:
toolbar stays inside the viewport and the document does not scroll sideways.
Actual: Review document width **431 px**, Sheet **564 px**, versus **390 px**.
The overflowing element is `.cal-toolbar-mid`; Sheet additionally pushes view
buttons and zoom controls beyond the viewport. Desktop is contained.

Independent confirmation: initial native-browser observation, later fresh
context at `06:53:16Z` on the newer served hash (toolbar right edge 431.234375),
and final guarded-transport pass agree. The narrower Samples view is contained.
No application fix is included. `run.cjs --assess` preserves both failing view
checks and exits **1**; the completed pass is deliberately not green.

## Runnable lane and safety review

Install/use the repository's pinned Playwright dependency through established
local setup. This session reused an existing local Playwright installation.
Create the filled config from `config.schema.json` **outside all checkouts**;
keep screenshots, DOM, source captures, request URLs and tokens private there.
All six surfaces must be named exactly once. Supply only existing authorized
staff `storageState`, with its provenance attested; omit it when unavailable.
Client contexts always start anonymous. No staff unlock or identity is invented.

```text
node qa/current-site-baseline/guard.test.cjs
node qa/current-site-baseline/run.cjs <private-config-file> <existing-private-output-directory>
node qa/current-site-baseline/run.cjs --assess <private-output-directory>/report.json
```

Exit codes: guard tests 0/1; observation/assessment **1 = observed contract
failure**, **2 = incomplete/partial proof with no asserted product failure**.
The observer never returns a whole-site health pass. No command here runs a
live write drill, starts a schedule, sends a notification, or mints a link.

Endpoint review: `policy.cjs` permits exact Pages assets, the two shipped CDN
libraries, font assets, final-host image reads, the established workbook's gviz
CSV reader, and explicitly enumerated PostgREST SELECT relations. Those readers
are documented in `docs/truth/APP.md`, `docs/independence/SYSTEM_MAP.md` §4 and
their `index.html` callers. The sole non-GET/HEAD exception is the strict verifier
for the exact private TEST slug/token, plus its harmless preflight. No blanket
GET exemption, webhook, raw RPC, issuer, writer, or unspecified EF is admitted.
`production-comments` remains excluded: its source also consumes a persistent
read budget; that side effect was not included in the verifier-only exception.

The final transport uses Playwright `route.fetch({maxRedirects:0})` and fulfills
Chromium with the **live response bytes**. It preserves TLS verification and
blocks redirects before a second endpoint is contacted. This is live transport,
not recorded data or mocked persistence. Service workers, WebSockets, beacon,
keepalive, worker and unsupported peer transports are blocked; attempted blocks
remain limitations. Source/hash drift is recorded, not substituted with local HTML.

**ISOLATED_BROWSER guard evidence:** a loopback canary caught two real harness
defects during development: beacon POST and redirected GET escaped plain
Playwright routing. The final guard keeps those adversarial checks, exercises
fetch/POST/beacon/keepalive/Request-keepalive/popup/WebSocket and redirect denial,
and observes only the one deliberately allowed synthetic reader at the server.
Earlier exploratory captures remain private/provisional; the final finite pass
above used both corrected guards. **OFFLINE_TEST** covers method/endpoint,
foreign-token/foreign-client/unknown-payload refusal, config, credential-free
browser child environment and honest FAIL/UNPROVEN assessment.

## Local validation

Validation of this tooling: the new offline/Chromium guard passes; repo-map,
truth-sync and system-map checks pass; the public-identity diff scan found zero
matches across 51 roster terms. Full `node test/run-all.js` on the recorded base
ran 399 suites: 397 passed and two failed. One was the validation wrapper's
omitted Windows `ComSpec`; `test/f27-edge-source-windows-cli.js` passed when
rerun with the normal environment. The other, unchanged
`test/asset-access-any-team.js`, independently reproduces Windows
`ERR_UNSUPPORTED_ESM_URL_SCHEME` because it imports a drive-letter path as an
ES module URL. That suite remains failing, with no assertion or application
change. Disposable database skips, where reported by the existing fleet, are
not live database proof. The live layout assessment exits 1 as described above.

## Proposed TEST-only live drill — ready for review, NOT EXECUTED

**LIVE_WRITE_DRILL unavailable in this task.** Execution still needs owner
approval of an exact serving release, real authorized staff personas, the
private reservation/adapter and the side-effect/restore receipt. Reading this
plan authorizes none of those writes.

Private selector: the existing project QA TEST selector was matched to exactly
one `clients` row with `kind=test, active=true`; its already-issued token was
read through existing authorized access. The local private handoff holds that
exact selector. Do not substitute a fabricated identity, another client's link,
or the first arbitrary test row. Recheck the same selector and its scope version
immediately before **every** mutation, including reservation and cleanup.

Reserve **two disposable representatives** under that scope: one Calendar video
card and one Samples graphics card, each with working synthetic media and exact
native component/crosswalk bindings. Samples is empty today, so its seed is an
explicit future write, not an existing canary. Reserve new IDs under one run ID;
never adopt the 23 pre-existing Calendar cards. Calendar owns any required
sub-issue creation. **SyncLinear must create no sub-issues.** If the adapter
cannot provide the required native Samples binding within that boundary, abort
that representative as UNPROVEN rather than inventing a Production create path.

| Step, repeated for each representative | Actual offered UI / expected durable and visible result |
|---|---|
| Prepare and staff review | The scoped adapter seeds synthetic content and routes the relevant component to `For SMM Approval`. In the real SMM Review view, choose the offered **Approve → Kasper** destination. `_calReviewApprove` / `_sxrReviewApprove` route to `Kasper Approval`; empty-content gates must stay enforced. |
| Kasper review | Open the card in Review/Samples and use its offered **Approve → Client** action. `_kasperApproveComp` / `_sxrKasperApproveComp` route to `Client Approval`. A clean fully-decided card may leave automatically; do not invent a Finish click. Where Finish is offered after explicit tweak decisions, it is a handoff (`_kasperDismiss` / `_sxrKasperDismiss`), not implicit approval. |
| Client comment, reply, change request | In a fresh anonymous TEST context verify the correct card/media, leave one synthetic plain comment, then a reply in that thread, then **Request change**. `_calReviewComment` / `_sxrReviewComment` preserve status; request-change handlers move the component to `Tweaks Needed`. Check thread identity/audience and the actual waiting/Review-versus-Sheet state after each action. |
| Staff response and resolution | Staff replies in that client-audience thread, makes the synthetic revision, then uses the offered Notes **Mark done** / review resolution chooser. Resolve only this run's request and choose **Client** when offered; retain the chosen destination receipt. `_calResolveLastTweak` / `_sxrResolveLastTweak` and review resolve paths must not resolve a request silently while refusing the requested route. |
| Final client approval | Fresh client context must show revised content, staff reply and resolved request. Use the offered Approve action, then independently verify `Approved` and the client approval stamp. It leaves the actionable Review queue; the Sheet retains the approved card. Do not force approval from internal-review state or call an unavailable handler. |
| Assignment and due date | In authenticated SyncLinear detail for the existing scoped native deliverable, use the offered assignee and due-date pickers (`_prodRunPickerWrite`). Select a privately designated active compatible TEST assignee and an approved date. Read back `assignee_id`, `due_date`, version/updated_at and the visible fresh-context labels. No creation, team switch or Workload-consistency claim. |
| Fresh-context proof and cleanup | After each step query the authoritative row/receipt independently and open the counterpart's new browser context. A 200, optimistic toast, acting DOM or mock store alone never passes. At the end quiesce pending work; archive only run-owned cards, tombstone only run-owned comments, and apply the pre-reviewed native cleanup/restore. Read back zero active run-owned residue and unchanged pre-existing rows/settings. Keep audit/reservation history as expected evidence. |

Proposed mutation allowlist is **operation- and ID-bound**, not origin-wide:
the two frozen source-save endpoints (`calendar-upsert`, `sample-review-upsert`)
for run-owned card fields/comments and cleanup; `production-write` only for
the actual UI's `status`, `comment` (including the identified parent/root and
resolve semantics), `assignee`, `due` envelopes on those exact linked targets;
the existing adapter's reviewed reserve/seed/cleanup operations. Capture current
CAS/base timestamps before each action and use stable idempotency IDs; do not
retry an ambiguous mutation. No raw mutation RPC or arbitrary service-role
browser call is allowed. No gate is added to either frozen anonymous writer.

Before approval, privately enumerate transitive effects: native activity/audit,
outbox/Linear provider mirroring, client/editor/Kasper notification and email or
Slack handoffs, media/provider fetches and any deferred jobs. UI request blocking
cannot contain **server-side** provider work. The operator must prove the TEST
recipient/provider sinks are already isolated or obtain approval for the exact
TEST effects. No global flag change, notification switch, workflow execution,
credential change or deploy is part of this plan. Abort if containment is unknown.

Other aborts: wrong/missing/inactive TEST scope; changed approved source; missing
staff role; wrong client/team/crosswalk; unavailable UI transition; unexpected
endpoint or provider effect; CAS conflict; duplicate/missing receipt; altered
pre-existing row; inconsistent fresh readback; timeout with unknown commit; or
failed quiescence/cleanup. Preserve the private journal and report failure;
never erase audit history or call incomplete restoration clean. Real clients
should see no drill card/comment/status/date/assignment change; prove that with
non-TEST sentinel hashes/counts. This pass did not establish that future isolation.

Monitor boundary: PR #1270 was read at
`be39f7972adf7617e0e9b828e39b1c4937b6b597` (heads can advance).
Its `scripts/client-continuity-actions.js` is dependency-injected and currently
has **no live adapter**. Reuse its `readScope`, atomic version fence, durable
reserve, `mutate`, fresh-context `readback`, `quiesce` and `cleanupReadback`
contract for approve/comment/request_changes. Its 90-second action deadline
does not fit a manual multi-role session: review bounded per-step reservations
with that owner, not an unattended extension or second monitoring system.
This task adds no scheduling, integration or notification implementation.

## Private evidence, freshness and next gate

Private evidence reference **T1-20260905** contains `provenance.json`, the
off-repo selector/config, source captures, preliminary captures, `final-pass/`
report plus per-surface DOM/screenshots/request ledger, `census.json`, and
`followup.json`. Its exact local location is in the task's private handoff.
Nothing from those raw files belongs in this public PR.

The existing site-assurance arithmetic ran read-only for 2026-09-05: **15/19
ledger rows expired**, and four older Tier-3 FRESH labels compute NEAR today.
That is proof freshness, not an outage finding. This scoped table supplements
`docs/testing/ASSURANCE_LEDGER.md`; no full surface promise is freshly certified
by an empty TEST fixture or an unauthenticated shell.

Next concrete gate: review this draft's failing mobile contract and read-only
lane; supply existing authorized SMM/reviewer states for their missing proof;
then have the monitor-adapter owner prepare the exact private two-card
reservation, side-effect isolation and cleanup receipt for owner approval.
No merge, deployment or write-drill execution is requested by this handoff.
