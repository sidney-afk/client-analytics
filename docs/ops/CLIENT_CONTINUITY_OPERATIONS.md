# Continuity operations: inactive review package

This is a separate continuation of preserved draft #1270 at
`83de7ae397ae4c69d04811582798a5668312d8ce` (tree
`ea09c55f46de9273b7c683f2b6ad57cc816c161d`). That combined commit contains monitor
`f68746a981d06f1c00f73279a3cc7fcd9298fcc1` and Samples
`a3f86c96e99b0d1ff3e93d6ac9f8e2ee496f8ca5`. This continuation changes no product
bytes, writers, authentication, authority, transport guards or earlier tests.
It does not integrate later main or modify #1269/#1270 or the coordinator's
separate private assembly. Review the new draft's exact head/tree before use.

Implemented locally: hosted read launcher, receipt observer, external-host
sentinel command, typed relay delivery with correlated terminal confirmation,
durable notification intent, and actual anonymous Calendar/Samples controls
against isolated file-backed fixtures. Installed watchers, alert delivery,
human acknowledgement and live TEST action journeys are **NOT PROVEN** here.
No schedule, secret, recipient, flag or relay has been configured by this work.

A later approved read attempt exposed a monitor-process defect: peer reset on a
refused CONNECT/upgrade socket could emit an unhandled `ECONNRESET` after Node
removed its HTTP parser listeners. The proxy now handles that socket error,
latches transport denial and destroys the socket; it never forwards or converts
the event into healthy viewing. The existing offline transport suite includes
isolated child-process controls that reproduce the crash only when that exact
handler is removed, plus surviving CONNECT/upgrade resets with zero receiver
escapes and closed sockets. This is harness recovery evidence, not website
failure or live viewing success. Keep missing/blocked receipts non-green and
rerun only under the coordinator's read approval. Canary eligibility is unchanged.

### Closed denial diagnostics

Viewing results and terminal receipts now include a bounded `denialReasons` array.
It contains only these enums: `metadata_post_blocked`, `realtime_transport_blocked`,
`worker_transport_blocked`, `beacon_transport_blocked`, `keepalive_transport_blocked`,
`realm_guard_failed`, `proxy_http_blocked`, `proxy_tunnel_blocked`,
`proxy_socket_error`, `other_request_blocked`. No URLs, bodies, credentials,
recipients or stacks are emitted. Unknown page-supplied reasons become
`realm_guard_failed`; receipt ingestion refuses unknown values. Denials are
deduplicated and retained through teardown, including proxy denials during setup.

Every existing denial remains non-green. The metadata label identifies only a
non-redirected POST to the exact configured fallback origin's
`/webhook/linear-issue-statuses` path without a query; it does **not** certify the
current server's behavior or authorize forwarding it. All other POSTs remain
blocked. Realtime/worker/beacon/proxy labels establish a monitor coverage limit,
not a website outage or a successful live journey. Proxy tunnel denial alone
cannot identify the underlying browser API. Do not allow WebSockets, arbitrary
provider writes or receiver escapes to make these reports green.

The existing boot fixture stubs Supabase subscription transport. Local diagnosis
on separately pinned serving source reproduced the Calendar metadata POST using
a synthetic linked row, and reproduced Samples' no-visible-HTTP denial using a
subscription stub that attempts native WebSocket construction. Those controls
expose a browser coverage gap; they do not identify the live SDK's exact behavior.
Use the new reasons in a separately approved live read to confirm attribution.
Historical endpoint backup code is not current hosted read-only proof.

The current launcher does not yet configure a view selection. An isolated
actual-source experiment showed that a fully approved synthetic card is absent
from Review but visible, with matching census ID/title, after the real read-only
`[data-cal-view="organizer"]` Sheet button is clicked. A future separately reviewed
`view:review|organizer` option should click that visible control, verify active
view and persist the choice before judging configured canaries; it must not call
product render functions or set health globals. The owner must select actual
eligible IDs privately for that exact view/filter. No such option or guessed IDs
are added in this diagnostic change. Nonempty census plus empty configured IDs
remains inconclusive, and empty Review is not authoritative whole-client emptiness.

## Read readiness and TEST action readiness are separate

The viewing command reuses the approved request/DOM observer and refusing
loopback proxy. Its browser has no private census credential; independent Node
reads carry it. No redirects, alternate browser transports or late teardown
requests escape the existing guard. See [the preparation contract](CLIENT_CONTINUITY_PREPARATION.md)
for exact allowed reads, private scoping, warning/empty distinctions and census
requirements. Counts alone cannot establish row identity, content freshness,
correct rendering, media playback or clickability. The observer also compares
scoped snapshots and required visible IDs. Concurrent or mismatched snapshots
stay inconclusive with bounded read retry; do not reduce that to count equality.

`node scripts/client-continuity-test-ui.js --fixture` drives six real UI actions:
comment, video approval and graphic change request on each surface. A separate
loopback reader fetches persisted fixture rows, and a new anonymous context must
fetch those rows after every action. The comment must also render. Assertions
check exact scope, exactly one write per action, actual persisted comment fields,
no page exceptions, and preservation of the unrelated fixture row. Media are
synthetic; playback is not tested. Cleanup deletes only the isolated fixture row.

All other invocations of that command, including `--live`, return
`existing_writer_contract_insufficient` before browser/network setup. The existing
writers read and then update by client/id; they do not provide the atomic TEST
scope/version/run-owned fence, request quiescence or ambiguous-commit receipt
required by the automatic action runner. Setting `atomicScopeFence:true` in an
adapter would not establish those guarantees. Do not build a new backend gate
for this test or change the frozen writer contract. Fifteen-minute automatic
action scheduling remains unavailable. A future approved adapter would re-read
the exact owner-designated active TEST scope before **every** mutation, use only
reserved disposable rows, issue each write once, independently read persistence,
and refuse cleanup on ambiguity or scope drift. A separately reviewed supervised
one-shot drill, if feasible under existing contracts, is a different milestone.

## Private inputs and manual launch

Keep configuration outside every Git checkout with owner-only filesystem access.
Start from [the operations template](client-continuity-operations.example.json)
and [the viewing template](client-continuity.config.example.json). No token,
private link, client identity, recipient or content belongs in Git or PR output.

After exact-head approval, bind `releaseSha` to the clean executable checkout.
The optional viewing `pageSourceSha` separately pins the **full 40-character local
commit ID** containing the approved target `index.html`; `pageSha256` must match
that immutable blob before any network access. A branch/tag, abbreviated ID, URL,
missing commit, tree/blob in place of a commit, missing/non-regular document, or
hash mismatch is refused. Git replacement refs are ignored. The launcher never
fetches or guesses a target. Omitting `pageSourceSha` preserves the original strict
current-HEAD/current-file behavior.

This permits reviewed monitoring code to observe a separately approved current
document before the Samples repair is released. The owner supplies the exact
current source commit and expected byte hash privately; source presence is not
deployment evidence. Actual served bytes must still match `pageSha256` through
the existing guarded observer. After a later release, explicitly approve/rebind
`pageSourceSha` and `pageSha256`, then require a fresh successful viewing receipt;
do not treat a receipt for the old target as proof of the new target. No writer,
auth, census, request policy or browser transport changes with this binding.

New start/terminal receipts and the viewing result record `releaseSha`,
`pageSourceSha`, `pageBlobSha` and `pageSha256`. Receipt ingestion preserves these
safe public revisions/hashes and refuses partially populated provenance or
start/terminal mismatches. Old receipts with no document fields remain readable
for historical compatibility; they do not prove a separately pinned target.

The unchanged index in this
candidate has SHA256
`8d91a1f00144f92483f6607f256e26991d368a3fbb7814c61e1c0e0bfb010380`;
this is **not** a claim that those bytes are currently served. A deployment-byte
mismatch refuses the read rather than certifying a different release.

Load these private environment references without logging their values:

| Reference | Required private input |
|---|---|
| `CONTINUITY_OPERATIONS_JSON` | Operations JSON with exact release, UTC epoch-ms `activatedAt`, separate enable booleans and delivery references |
| `CONTINUITY_PRIVATE_VIEW_JSON` | Viewing JSON with same release, approved page hash, `enabled:true` only after read approval, output reference `CONTINUITY_OUTPUT_DIR` |
| `CONTINUITY_CALENDAR_LINK`, `CONTINUITY_SAMPLES_LINK` | Existing owner-designated valid anonymous links, taken from private handoff; never guess or reissue |
| `CONTINUITY_CALENDAR_SCOPE`, `CONTINUITY_SAMPLES_SCOPE` | Exact verified canonical scope for each link |
| `CONTINUITY_CALENDAR_CANARIES_JSON`, `CONTINUITY_SAMPLES_CANARIES_JSON` | Arrays of currently eligible visible IDs from fresh private census; never adopt them as write fixtures |
| `CONTINUITY_BACKEND_ORIGIN`, `CONTINUITY_READER_FALLBACK_ORIGIN`, `CONTINUITY_READ_ORIGINS_JSON` | Exact reviewed read origins, matching existing reader interfaces |
| `CONTINUITY_CENSUS_READ_KEY` | Existing private read credential capable of a complete correctly scoped non-Archived census |
| `GH_TOKEN` | Repository Actions/artifact read access for observer/sentinel; hosted workflow token has contents/actions read only |
| `SLACK_ALERT_WEBHOOK`, `CONTINUITY_N8N_ORIGIN`, `N8N_API_KEY` | Existing primary relay URL and read-only execution-confirmation access; coordinator holds private route handoff |
| `CONTINUITY_PUBLIC_OUTPUT` | Existing empty directory outside Git; only aggregate receipts written here |

The coordinator has existing private TEST selector/token and route handoffs;
do not ask the owner to paste those again. Fresh census visibility, canary
eligibility, served bytes, exact recipients and release binding still require
review. Empty canaries are justified only by a fresh scoped census, not an old
empty UI. Do not import the legacy live probe helpers: they contain their own
targets and are outside this package's scope.

With privately loaded references, Node 22, Git, GitHub CLI and Playwright Chromium
installed in the approved clean checkout, the later approved commands are:

```powershell
# Enable only the matching private mode after its specific approval.
$env:CONTINUITY_ACTIVATION = 'OWNER_APPROVED_CONTINUITY_VIEW'
node scripts/client-continuity-hosted.js view
$env:CONTINUITY_ACTIVATION = 'OWNER_APPROVED_CONTINUITY_OBSERVE'
node scripts/client-continuity-hosted.js observe
```

No config or matching activation returns exit 2 before network access. Each
command exits within 120 seconds. View writes start/terminal UUID receipts for
both lanes. Exit 1 means a non-green result; exit 2 means config/operation failure.
Keep raw exceptions, traces and browser screenshots private; do not upload them.

## Hosted cadence and independent observation

The dormant workflows propose a five-minute viewing cron and a five-minute
observer cron offset by two minutes. GitHub schedules can be delayed or dropped;
they cannot guarantee exact intervals. No schedules run from this unmerged draft.
After a separately approved installation, these are the direct workflow links:

- [Viewing](https://github.com/sidney-afk/client-analytics/actions/workflows/client-continuity-hosted-view.yml)
- [Receipt observer](https://github.com/sidney-afk/client-analytics/actions/workflows/client-continuity-hosted-observer.yml)
- [Manual delivery drill](https://github.com/sidney-afk/client-analytics/actions/workflows/client-continuity-hosted-delivery-drill.yml)

Jobs require `CLIENT_CONTINUITY_RELEASE_SHA` and their own
`CLIENT_CONTINUITY_VIEW_ENABLED`, `CLIENT_CONTINUITY_OBSERVER_ENABLED` or
`CLIENT_CONTINUITY_DRILL_ENABLED` repository variable equal to `true`, plus the
matching private JSON enable flag. Keep all false/unset until approved. The
observer can run with delivery disabled. The drill has no cron. No action-write
workflow exists. Workflows check out the approved SHA, run with read-only GitHub
permissions and upload only aggregate JSON artifacts for seven days.

Receipt collection uses six recent viewing runs from the last 20 workflow runs,
matching the exact approved trigger SHA and schedule/manual event. GitHub's run
head describes its trigger, not a custom checkout: when default main moves,
approve/rebind an appropriately tested release before relying on these schedules.
Do not silently relax this binding. Artifact receipt SHAs must match too.
This is a bounded recent window, not an all-history audit. Missing two viewing
intervals (ten minutes), a start without terminal after two minutes, failed reads
and absent artifacts are red. Young queued/running jobs receive two minutes of
artifact grace. A later healthy run cannot hide an orphan within the window.

An **independent always-on host is still missing**. It can run the following
command every five minutes with `sentinelEnabled:true` only after approval:

```powershell
$env:CONTINUITY_ACTIVATION = 'OWNER_APPROVED_CONTINUITY_SENTINEL'
node scripts/client-continuity-hosted.js sentinel
```

The command checks both hosted workflows for recent successful executions and
current failure/stoppage. GitHub/API failure returns aggregate `monitor_missing`
and nonzero exit. It never sends notifications or writes observer state. Its
external host must independently page on nonzero exit **and missed sentinel
invocations**, using its own confirmed recipient/transport. Running it on the
same Actions scheduler, an occasionally awake laptop, or only n8n does not provide
that independence. Do not run a second delivery-enabled receipt observer on that
host: the artifact store is not a distributed notification lease.

## Bounded primary drill and alert recovery

Use the new hosted `drill` command for this package; the preserved older launcher's
fallback-required drill is a separate preparation interface. The new path reuses
the existing Edge Alert relay that the coordinator privately confirmed routes
to SyncViewbot's owner DM. It requires delivery `enabled:true`,
`activation:OWNER_APPROVED_CONTINUITY_DELIVERY`, `recipientConfirmed:true`, and
separate `drillEnabled:true` after exact-head/recipient approval:

```powershell
$env:CONTINUITY_ACTIVATION = 'OWNER_APPROVED_CONTINUITY_DRILL'
node scripts/client-continuity-hosted.js drill
```

It issues one synthetic failure, then one recovery only if failure delivery was
confirmed. Rendered fields contain `type=client_continuity_DRILL`,
`issue_identifier=DRILL_samples_false_empty` / `DRILL_samples_recovered`,
`team=client_surfaces`, count zero and a UUID in `details.run_id`. The relay drops
top-level text, so the DRILL label is placed in fields it actually renders.
Each POST occurs at most once; confirmation polls at most 20 times with one-second
spacing inside a 25-second deadline, requiring matching UUID/type and terminal
success. HTTP acceptance alone stays unknown. An ambiguous result stops the drill.
Owner receipt and acknowledgement must be checked privately; execution success
does not independently prove that the configured human read the DM.

Normal observation persists `prepared`, then `attempted` intent before posting.
Same confirmed incident is quiet; recovery emits one recovered event. An ambiguous
attempt is reconciled with **reads only**, even if the view has since recovered.
There is no blind POST retry. If an observer crashes before uploading state, the
next observer refuses to discard that missing state or fall back to older state.
Preserve artifacts, reconcile exact UUIDs privately, and restore a reviewed
aggregate state artifact through a supervised observer recovery before resuming
delivery. For that separately approved recovery only, save a reviewed state JSON
outside Git, set private `recoveryEnabled:true`,
`CONTINUITY_RECOVERY_STATE` to its absolute path and
`CONTINUITY_RECOVERY_ACTIVATION=OWNER_APPROVED_CONTINUITY_STATE_RECOVERY`, then run
the ordinary `observe` command. Keep ambiguous events `attempted` so it performs
read-only reconciliation. This bypasses only the missing prior artifact, and
still validates release/state and current viewing receipts. Preserve the output
`observer-state.json` as the new supervised observer artifact through the approved
host's upload step, then unset the recovery environment and flag. The dormant
hosted workflow deliberately supplies no recovery environment. Read viewing can
continue separately. Do not delete incident state just
to make the observer green. Exactly-once delivery across process/artifact failure
is not claimed; delayed primary/fallback delivery can duplicate notifications.

Default configuration uses primary relay only and always reports
`independentFallbackProven:false`. No independent fallback credential or host is
presently established. A future optional `syncviewbot` route uses private
`tokenEnv`, `dmEnv`, `botUserEnv`, `ownerUserEnv`, `teamEnv` references; it checks
bot identity/team and the exact existing owner DM before one message POST, then
reads that message back. It never opens conversations or guesses recipients.
The needed Slack scopes/readback semantics are documented by
[chat.postMessage](https://docs.slack.dev/reference/methods/chat.postMessage/),
[conversations.info](https://docs.slack.dev/reference/methods/conversations.info/)
and [conversations.history](https://docs.slack.dev/reference/methods/conversations.history/).
A different endpoint alone is not independent fallback proof. Provisioning or
changing these credentials is outside this milestone.

After an approved primary drill, disable drill/delivery immediately and preserve
aggregate receipts. Full W10 readiness additionally needs independently approved
primary-failure/fallback delivery, missed-start/missing-terminal/external-host
failure drills and recipient acknowledgement. Never disable a shared relay to
inject a failure; use isolated transport faults scoped to this monitor.

## Disable and rollback

Set the three package enable variables false, set all private enable booleans
and delivery enabled false, and stop admissions in this package's external host.
Record intentional shutdown with its independent observer to avoid a false page.
Let bounded jobs finish or cancel only this package's runs. Preserve artifacts and
private intent receipts. Confirm the process tree has ended before removing only
its private viewing lock; do not recursively erase output directories.

There are no live writes or database changes to roll back. A defective monitoring
delta can be reverted or its gates left false without touching product bytes.
The coordinator/Samples owner owns any product rollback, with its captured bytes
and separate approval. Never restore a database, erase pre-existing client work,
re-gate writers, edit n8n or change business authority to recover a monitor.
