# Combined Samples repair and viewing monitor ? inactive

This draft combines the exact Samples candidate **6f0ac283d12a7d5c02fe3066c70e12eeead29bc3**
(PR #1269, commits c10ebc84 and 6f0ac283) with monitoring preparation
**d920c1ae94ec7f823e36a030ef12531256e6997f** and the runnable integration in PR #1270.
The local merge is **d6e6c980efbe621e6eef4051ab53ffe423aa82d1**. Original remote-main
baseline: **13e187a7d0043ed110b486feb50502758a026229**. The PR description records the
final tested head/tree and results. Neither PR is merged into main by this work.

The product index.html bytes remain identical to the exact Samples head. There
is **no additional product hook**, authentication change or writer change. Its
client-owned drafts, non-authoritative fallback, verified-cache distinction and
frozen open-writer contract remain intact. Imported Production comment fixture
and writer durability test corrections belong to that same exact candidate.

Independent review of monitoring head be39f797 reproduced transport escapes and
late verdict omissions. The follow-up transport guard addresses those findings;
its exact new head/tree and targeted results are in PR #1270. The same review
also found residual Samples durable-draft, asynchronous cache-owner and mixed
legacy-cache defects. Those product repairs remain with the Samples owner and
are **not fixed or newly integrated here**. Release remains blocked pending the
coordinator's confirmation of an independently reviewed replacement Samples head.

## What runs, and what remains inactive

- scripts/client-continuity-view.js observes actual document/REST responses and
  visible Calendar/Samples DOM; scripts/client-continuity-run.js is the manual
  launcher. No fabricated health global or replacement product function.
- scripts/client-continuity-monitor.js retains closed reports, alert formatting,
  bounded relay/fallback delivery interfaces and missed-check/terminal/ack logic.
- scripts/client-continuity-actions.js is still a **fixture-tested future action
  runner**, not a live adapter. No backend gate was built to enable these tests.
- No scheduling, notifications, live client action, deployment, n8n edit, flag or
  credential change is activated. Both example activation switches default false.

## Observation and limits

The browser uses a fresh anonymous context, blocked service workers and empty
storage. It permits only GET/HEAD/OPTIONS plus the exact client-token-verification
POST. Other mutations and unapproved origins abort and produce fixed error codes.
The n8n origin permits only Calendar/Samples/templates/caption-prompt readers,
including for GET: an arbitrary GET webhook is not presumed safe. Additional
runtime GET interfaces on allowed origins still need owner review before live
activation; an origin allowlist is not a general proof that every GET is pure.
The browser receives no census credential or staff identity. All fixtures intercept
requests; no fixture is allowed to fall through to a live backend.

The Chromium context now has a dedicated loopback **refusing proxy**: it never
forwards HTTP, CONNECT or WebSocket traffic, and disables Chromium's implicit
loopback bypass. This is an independent network barrier for native transports
that evade browser routing or run in an initial/inherited blank realm. An
approved request is forwarded by a separate anonymous Node request client only
after method/origin/interface checks, with zero redirect follows and zero
transport retries; every 3xx response is refused before browser delivery.
Never replace this with route.continue/fallback or inherit the browser proxy in
the Node reader. No proxy credentials, certificate changes or external service
are required. The local refusing listener is per run and closed at teardown.

Context init scripts and synchronous blank popup/iframe guards deny Beacon,
keepalive (including Request objects), WebSocket, WebTransport and worker
constructors before use. Service workers stay blocked. WebSocket routing closes
without connecting; it is itself injected instrumentation, so the refusing
proxy is still required. Receiver tests bypass injected guards in isolated
native realms to prove that the proxy prevents actual delivery. A denial, late
authorization failure or page error remains latched through the final census,
DOM read and teardown. Teardown has a three-second deadline; timeout stays red,
disposes the Node reader and closes the refusing proxy. The outer launcher's
120-second process deadline remains the final worker bound.

This forwarding path buffers responses, including the document, before browser
delivery. It does not prove streamed first-paint timing; the unchanged existing
boot suite retains that coverage. The proxy is a barrier for this Chromium
context, not an operating-system sandbox for hostile local code or an approved
GET interface that itself mutates state. Preserve exact release binding and
privately review the allowed readers before any later activation. Blocking an
unsupported transport may make a journey red; do not relax it to obtain green.

The serving document SHA-256 is compared with the approved checkout's index bytes.
The observer collects the exact scoped primary reader rows. An independent Node
GET census runs before and after navigation using a private existing read credential,
the exact designated client scope, non-Archived filter, select=*, exact-count
receipts, bounded keyset pages and duplicate/scope checks. Twenty pages of 1,000
rows maximum; five-second request deadlines. Missing receipts/caps/paging errors
cannot establish completeness. No new database role, backend service or gate is
created. The credential must have complete read visibility for the designated
scope: if RLS can hide records, its count is not authoritative. The owner must
verify that property privately before enabling the lane.

Sorted canonical row-content digests (not counts alone) must agree across both
censuses and the browser responses. A changed census, mismatched browser snapshot,
new load generation or missing census produces **inconclusive**, with at most one
fresh-context retry. After two inconclusive attempts, report unknown coverage;
do not call it a product data-loss incident or successful journey. Auth refusals,
false empty, unannounced stale content, blocked writes and rendered defects do
not receive that retry exemption.

The census describes all unarchived reader rows; the client view is filtered.
Private requiredVisibleIds identify stable, owner-designated cards expected in
that exact route/view. Their visible card identities and titles must match the
census. Nonempty data with no canaries or canaries missing from the census is
inconclusive. Genuine authoritative emptiness is checked separately with zero
reader rows and visible empty DOM. A missing visible configured canary or stale
rendered title fails. Keep canary cards eligible and their route/view known;
changes to eligibility require private configuration review.

**Limits:** equal counts cannot prove identities, values, audience, assets,
comments or persistence. Equal before/after digests are bounded stable-window
observations, not an atomic snapshot: an A?B?A change between reads can escape.
Related-table changes, omitted RLS populations, media decoding and unexercised
controls are not proven. Visible canaries do not prove every filtered/history
card. Fresh-context viewing does not prove retained old bundles or real live
approval/comment/change-request persistence. Those need separate approved drills.
No whole-population or full T1/T3/G1 closure is claimed by this package.

## Offline commands and CI

From the combined checkout:

~~~text
node test/client-continuity-monitor.js --strict-source
node test/client-continuity-view.js
node test/samples-authoritative-read.js
node qa/client-continuity.js
node qa/client-continuity-transport.js
node scripts/client-continuity-run.js --fixture
npm run test:boot
node test/run-all.js
npm run test:prod-polish
~~~

The continuity/boot commands are fully intercepted or isolated, without
credentials/backend writes. The existing Production aggregate also includes its
established live-read/zero-mutation lanes; keep all raw output and optional visual
artifacts private. Use PROD_POLISH_PUBLIC_SUMMARY for its aggregate fixed-code
report. Never publish raw test output containing real records.

The source harness imports the actual repaired loader/cache/pager/merge/draft
functions and dependencies from the Samples test. Rejections require exact expected
errors and request counts; missing helpers/incidental exceptions fail. Positive
complete/empty/fallback/cache/recovery/client-switch paths must run. It also reads
the original committed reader and demonstrates its seven false-empty cases; missing
git history fails rather than skips. Strict-source now passes on the repaired
combined candidate, not merely because all calls threw.

The existing [Client entry visible boot workflow](https://github.com/sidney-afk/client-analytics/actions/workflows/client-entry-visible-boot.yml)
keeps its complete boot coverage and adds continuity, strict-source and fixture
launcher steps plus the independent loopback transport receiver suite, with full
git history and no secrets or schedule. Existing unit CI
auto-discovers the unit suites. Publishing the draft triggers normal offline PR
checks; no production workflow is manually dispatched.

## Private configuration (create only for later approved use)

Copy docs/ops/client-continuity.config.example.json to an existing private folder
outside **every** Git checkout, for example the owner's .syncview/continuity
folder. Do not put it in this worktree or a synced public folder. Restrict that
folder and its existing runs subfolder to the operator using the platform's ACLs;
on Unix use owner-only permissions. The launcher rejects config/output paths in
a Git checkout, resolves symlinks, writes receipts with mode 0600 and never loads
an env file automatically. Windows ACLs still require operator confirmation.

Leave enabled and deliveryEnabled false. After exact release approval, fill
releaseSha from git rev-parse HEAD and pageSha256 from SHA-256 of index.html.
The launcher requires matching clean source files. Supply the example's environment
references through the owner's private secret loader, not command arguments:

| Reference | Private value/meaning |
|---|---|
| CONTINUITY_OUTPUT_DIR | Existing absolute private runs directory |
| CONTINUITY_BACKEND_ORIGIN | Approved Supabase origin, no path/query |
| CONTINUITY_READER_FALLBACK_ORIGIN | Approved existing n8n reader origin |
| CONTINUITY_CENSUS_READ_KEY | Existing credential with complete scoped read visibility; Node GET census only |
| CONTINUITY_READ_ORIGINS_JSON | JSON array of exact additional read/CDN origins approved from the serving app |
| CONTINUITY_CALENDAR_LINK / CONTINUITY_SAMPLES_LINK | Owner-designated currently valid anonymous links |
| CONTINUITY_CALENDAR_SCOPE / CONTINUITY_SAMPLES_SCOPE | Exact canonical database client scope for each link; never inferred from the display name |
| CONTINUITY_CALENDAR_CANARIES_JSON / CONTINUITY_SAMPLES_CANARIES_JSON | JSON arrays of stable expected visible card IDs in that scope; empty only for an approved genuine-empty check |

Use fictional placeholders only in shared material. Neither identities, links,
tokens, recipient values, row digests/content nor response bodies enter public
reports. Private run files contain UUID, release SHA, lane, timestamps, closed
code and count only. No screenshots, tracing, storage dumps or raw page logs are
saved by the launcher. Never print its environment or unfiltered exception objects.

## Activation, cadence and independent observation

Activation remains owner-gated: approve exact combined release, passing affected
checks, deployed-byte readback, private baseline/restore evidence, scoped census
visibility, visible canary eligibility, allowed interfaces and incident ownership.
Then privately change enabled to true. With the private environment already loaded,
run from the approved clean checkout (the config path is not a secret value):

~~~powershell
$continuityConfig = Join-Path $env:USERPROFILE '.syncview\continuity\config.json'
node scripts/client-continuity-run.js --config $continuityConfig --activate OWNER_APPROVED_VIEW_CHECKS
~~~

There are no default links, scheduled jobs or automatic alerts. No arguments exits
inactive; --fixture always uses synthetic intercepted data and ignores live config.
Viewing returns an aggregate report and exit 1 for any non-green lane, without
sending notifications. Exit 2 is inactive/config/launcher failure. Each lane has a
unique persisted start and terminal receipt; one lane's exception does not skip
the other. The output directory lock prevents overlap. The worker exits at a
120-second hard deadline; a killed run leaves missing terminal evidence and may
leave its lock, deliberately requiring operator inspection rather than blind retry.

After later approval, an independent scheduler can invoke this exact command every
five minutes. Provision its own process-tree teardown and missed-start monitoring.
GitHub cron/queueing alone cannot guarantee exact five-minute timing. A separate
observer outside the scheduler and n8n must read the protected start/terminal
receipts (through the owner's private shared storage or receipt transport), feed
assessLiveness, and watch the primary scheduler itself. Missing two view checks
means ten minutes; a start without terminal after two minutes also alarms. The
observer needs its own independently observed heartbeat. Its private transport,
schedulers and notification recipients are **not installed by this PR**.

Fifteen-minute approval/comment/change-request checks remain a distinct inactive
lane. The retained action runner requires explicit expiring owner approval, exact
release binding, the exact active TEST scope before every mutation, a reviewed
live adapter for real anonymous controls and independent persisted readback, plus
quiescence and run-owned CAS cleanup. Its atomic scope/ownership fence must use
an already suitable reviewed server path; **do not add a backend gate merely for
these tests**. If no suitable path exists, leave live actions blocked. Preserve
pre-existing data and private reservation receipts; never retry ambiguous writes
or guess a TEST identifier. No real action journey was exercised here.

## Alert delivery drill (separate later owner approval)

The viewing launcher never calls notification delivery. Set deliveryEnabled true
only for an approved drill and confirm delivery.independenceConfirmed plus
recipientsConfirmed in the private config. The separate command is:

~~~powershell
node scripts/client-continuity-run.js --config $continuityConfig --alert-drill --activate OWNER_APPROVED_DELIVERY_DRILL
~~~

This sends one synthetic false-empty alarm through the existing relay, then invokes
independent fallback if correlated final delivery is absent. Its refs are
SLACK_ALERT_WEBHOOK, CONTINUITY_FALLBACK_URL, CONTINUITY_FALLBACK_TOKEN, N8N_API_KEY
and CONTINUITY_N8N_ORIGIN. Different hostname is not operational independence:
the owner must verify fallback hosting, credentials, recipient and observer do
not depend on n8n or the primary scheduler. Relay HTTP200 is acceptance only.
The fallback must return matching run_id and delivered:true after final delivery;
human acknowledgement remains separate. Neither is proven by mocks/configuration.

Drill primary refusal, accepted-without-terminal, n8n unavailability, fallback
failure, missed checks, missing terminal and ten-minute unacknowledged escalation
using an isolated transport fault for this monitor; do not disable a shared relay.
Confirm final owner/backup receipt and acknowledgement privately. GitHub failed-run
email is only a secondary path after subscription and delivery are confirmed.
Recovery requires fresh successful evidence, then an explicitly approved recovered
report through routeAlert and a human acknowledgement. Silence never closes an
incident. Leave deliveryEnabled false after the bounded drill.

## Disable and recovery

Set private enabled and deliveryEnabled false and stop admissions in this package's
scheduler. Mark intentional deactivation in its independent observer. Do not stop
shared watchdogs or relay workflows. Let the bounded read worker exit; if it was
killed, confirm its process tree has ended before removing only its private
continuity.lock. Preserve start/terminal/incident receipts. Do not automatically
clear stale locks, delete directories or erase failures to get a green run.

No viewing data rollback is needed. Any later TEST action residue needs a fresh
explicit cleanup approval, quiescent requests and exact scope/run-owned CAS with
independent zero-residue and pre-existing-data readback. Scope drift or expiry
blocks cleanup writes too; preserve the ledger and escalate instead of widening.

For a defective Samples release, the coordinator restores only captured prior
Pages bytes under its approved release process, verifies serving hashes and reruns
anonymous/readback checks. Preserve accepted client writes, owned drafts and
recovery receipts. Never restore a database snapshot, re-gate client writers,
change authority, flags or resurrect legacy write routes. Prior original Samples
bytes retain the known reader defect, so that restoration is containment rather
than green G1. No merge/deployment/rollback is performed by this package.
