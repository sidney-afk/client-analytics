# Isolated card lifecycle browser lane

## September 7 bounded feedback-reader fixture correction

Only the `comments` cell was rerun against unchanged product source
`b60a9705492002830eed60ece874e0686fc4b538`: **1 cell / 4 steps PASS**,
with zero unexpected blocked requests, page errors, socket attempts or console
errors. Private artifacts: `.codex-tmp/card-lifecycle/2026-09-07T15-07-10-283Z/`.
The earlier unchanged-tooling run at `2026-09-07T15-00-21-034Z` in the original
tooling checkout remains **2 PASS / 2 FAIL**; its failed record is not rewritten.

The old synthetic `production-comments` response omitted `feedback` despite the
browser requesting `include_feedback:true`. The `.prod-comment` selector remains
valid for source notes. `feedback-reader.js` now executes the selected product
source's actual TypeScript handler, staff authorization and feedback projection
in a bounded child process. Supabase tables, rate/allow-audit RPC results and
role secrets remain synthetic. Only the handler's feedback response is added;
the existing canonical-comment response and write transport remain modeled.
No application code is changed and no text-matching import is introduced.

The finite source read uses the current synthetic Calendar row and exact
deliverable/card/client linkage. Assertions require the original note under
**From the original card**, read-only source guidance, no source-note action
buttons and byte-identical canonical storage. The missing-feedback negative
control still requires incomplete feedback and absence of the note. This is a
response-contract repair, not evidence of installed feedback, real SQL grants,
durable audit persistence or complete multi-page/real-population behavior.
Unsupported cursor reads and table writes fail explicitly. Child-process fetch
is refused; temporary handler copies are cleaned in `finally`.

Reproduce with `node qa/card-lifecycle/run.js --source <local-b60-checkout> --case comments`.
Existing source/serving hashes and tooling file hashes bind the run; the source
remained clean and unchanged. Do not replace the older failure with this result
or infer a full lifecycle pass. The original `undo-reopen` edge remains red as a
Comments-history control whose relevance/contract is still undetermined; it is
not an owner decision blocking the normal workflow.

The owner clarified the normal video path: Kasper requests a change, the video
editor fixes it and sends **For SMM Approval**, then the SMM sends **Kasper
Approval**. Existing journey cells use an SMM for resolution and do not prove
that full editor-to-SMM path. This comments-only run adds no proof of it and
does not change reopening policy.

## Run

```sh
npm install --ignore-scripts --no-audit --no-fund
npx playwright install chromium
node qa/card-lifecycle/run.js
node qa/card-lifecycle/run.js --source "/absolute/local/candidate"
node qa/card-lifecycle/run.js --case rejected-save,stale-version
```

Dependency/browser installation is setup only. The lane itself never targets a
remote site. `--source` must be a local Git checkout containing the unchanged
document and existing `prod-test-utils.js::serveStatic`. The default is this
checkout; an assembled candidate may be dirty, in which case the report explicitly
records that state and its content/diff hashes. The served main-document bytes
are hashed and compared with the pinned source. A changed source during a run,
unknown case, missing browser, unexpected request or failed assertion exits nonzero.

Outputs go to ignored `.codex-tmp/card-lifecycle/<UTC timestamp>/`. Only the closed
summary schema (counts, enum outcomes and hashes) is suitable for public review.
The `*-private.json`, `*-private.txt` and screenshots stay untracked: the real
document contains a built-in roster, which can appear if a picker is opened.
No raw headers, tokens or network captures are published. Console-error counts
are recorded for diagnosis; page errors and unhandled requests are fatal. Injected
HTTP rejection/response loss deliberately produces resource-console errors.

The lane uses one Chromium process with a new context per role/checkpoint, no
shared storage unless the case explicitly retains its existing context. Staff
identity is bootstrapped using the existing PTO fixture pattern; verifier replies
are mocked. Third-party Chart and Supabase subscription objects are transport
stubs from the boot pattern. No application review/status handler is replaced or
called to perform an action. Worker/SharedWorker/service-worker registration and
WebRTC are disabled; WebSockets are intercepted before connection; unexpected
HTTP is aborted; browser host resolution is restricted to loopback as a second
barrier. Only tracked static assets can be served locally.

## Declared matrix (written before implementation)

Every cell drives visible controls in the unchanged local SyncView document. Synthetic
transport persistence is an assumption, never a proof of a server/RPC. No live runner
from the Calendar catalog or shared scenario engine is imported or executed.

| Cell | Finite interaction contract |
| --- | --- |
| journey-video | SMM resolves last tweak and selects Kasper; Kasper requests changes; staff resolves to Kasper; Kasper approves to client; client notes, requests changes, approves; immediate status/queue and fresh-context readback at each transition |
| journey-graphic | Same independent journey for graphic/thumbnail |
| undo-reopen | Kasper approval Undo; client approval undo if offered; resolved request reopened; new request clears prior approval |
| comments | Plain note leaves status; request changes status; root/reply/edit/resolve/reopen/delete where offered; client/internal visibility in Calendar, review, and Production |
| controls | Production status, assignee and due date; allowed staff and denied role controls; visible saved result, fresh context and Calendar projection |
| rejected-save | Approval rejected before persistence: failure visible, original row survives fresh context |
| lost-response | Approval accepted but response lost: no duplicate accepted effect and fresh context sees accepted state |
| duplicate-click | Two rapid visible approval clicks: one accepted transition |
| stale-version | Two contexts; stale CAS rejected: error and fresh state, no overwrite |
| delayed-refresh | Delay a transport refresh/realtime delivery across transition: no stale repaint |
| switch-client | Hold save, visibly select other fictional client, release: no wrong-client write or repaint |
| navigate-saving | Hold save, navigate away, release, return: visible result agrees with fixture |
| archive-race | Archive while another reviewer approves: no accidental resurrection under declared archive-conflict assumption |
| cache | One retained-storage reload versus empty fresh context at the same fixture revision |
| touch | One mobile touchscreen review interaction |
| keyboard | One review interaction using Tab/Enter and typing only |
| network-guard | Unexpected HTTP request, websocket and worker negative controls are rejected before external transport |

Start with both journeys; failures remain red and later dependent steps remain
NOT_TESTED. Fault cases use independent snapshots so one failure cannot erase the
rest of the matrix. Unsupported controls are explicitly recorded, not silently passed.
Detailed Workload planning/capacity/identifier semantics, Samples repair, monitoring,
native intake, deployments, authentication and live writers are outside this lane.

## Initial provenance

Fetched remote main on 2026-09-05; observed at 2026-09-05T06:37:21.2951514Z:
`706359752e861969e6c68898daa26e29a2eb6edb`.
Serving is local loopback, not GitHub Pages. Deployed Edge Function revision is
UNPROVEN. The deploy manifest describes ownership, not deployed bytes; the frozen
anonymous writers remain untouched.

## Evidence vocabulary

ISOLATED_BROWSER: actual document and visible interaction with fictional backend.
OFFLINE_TEST: tooling/source checks. SOURCE_ONLY: inspection without execution.
LIVE_READ, LIVE_WRITE_DRILL: NOT_TESTED (the latter unavailable).
UNPROVEN: real persistence, server authorization, RPC atomicity and deployment.

Relevant contracts: [Calendar catalog](../../docs/testing/CALENDAR-TEST-CATALOG.md),
[review transition evidence](../../docs/audits/2026-07-05-logic-reviews.md),
[surface truth](../../docs/truth/APP.md),
[owning repairs](../../docs/ops/OPEN_REPAIRS.md),
[assurance ledger](../../docs/testing/ASSURANCE_LEDGER.md).
This scoped ledger does not refresh unrelated site-assurance rows.

## Backend assumptions requiring separate proof

The fake store applies submitted scalar fields and explicit comment CRUD only.
It does not choose the next reviewer, compute overall status, clear approval
stamps, infer queue membership, or resolve tweaks. Those changes must come from
the real document. Native status vocabulary is fixture data, not a transition
engine. Request IDs are stored as replay receipts; stale timestamps/statuses and
archived rows are refused under declared browser assumptions.

- Native CAS, replay receipts, comment versions/audience/authorization:
  `production-write` and the `production_comment_write`,
  `production_comment_lifecycle_write`, `production_deliverable_write` RPCs need
  separate disposable-backend or authorized live proof.
- Calendar patches are shallow fixture persistence. The real frozen
  `calendar-upsert` merge/concurrency behavior is **UNPROVEN**; do not deploy a
  repository copy or change its anonymous access to satisfy this lane.
- The controls cell explicitly delivers one status projection to Calendar.
  That assumption needs independent real native-to-card mirror evidence.
- The original client-note/Production projection failure is preserved as dated
  evidence. The September 7 correction above exercises the actual source-feedback
  reader over synthetic rows; it requires no native import. Installed reader,
  frozen writer persistence and real database access remain **UNPROVEN**.
- Source locations describe repository contracts only. The
  [deploy manifest](../../docs/ops/EF_DEPLOY_MANIFEST.md) does not prove serving
  function revisions. No LIVE_WRITE_DRILL is available here.

Reused infrastructure/patterns: `qa/boot/client-entry-sequence.js`,
`docs/syncview-design/tests/prod-write-gateway-browser.js`,
`prod-comments-browser.js`, `prod-test-utils.js::serveStatic`, and
`qa/pto-lifecycle/{harness.js,mock-backend.js,ui.js}`. Existing shared scenario
implementations and application files remain unchanged.
