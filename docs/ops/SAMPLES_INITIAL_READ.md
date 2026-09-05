# Samples initial card-list preparation — disabled

This is a separate, bounded milestone based on monitor commit
`6383bd915bc0403d1b26140adda3cafe0d5f6749`. PR #1292 and its historical
receipts retain their meaning. No product/index, authentication, client access,
writer, backend gate or transport allowance changes belong to this package.

## Exact claim and limits

`samples_initial_card_list_v1` can certify one anonymous **initial Samples
card-list read only**, after teardown. The ordinary full-journey result remains
`mutation_blocked`, non-green. Calendar, realtime updates, approval/comment/
change-request persistence, media, reload recovery and installed protection are
not certified by this milestone.

The browser uses the actual product document, native primary reader and DOM.
The observer delegates real Supabase `createClient`, `channel`, `on`, and
`subscribe` calls. It never supplies fake `SUBSCRIBED` or successful socket
events. Only exact synchronous read-subscription attempts with pinned SDK bytes,
backend, channel descriptors, table/filter, rate and protocol are attributable.
The socket still throws and every network/proxy denial remains enforced.
Other channels, unknown realms, HTTP mutations, metadata POST, raw proxy traffic,
late read/auth/browser errors and incomplete teardown disqualify the run.
Independent outcomes survive the legacy result's mutation precedence.

Success additionally requires exact served-document bytes; a successful strict
token verifier response for the configured principal and scope; successful
complete native primary pages with valid exact Content-Range totals; matching
private before/after census row identities and full-row digests; stable visible
DOM; an owner-approved positive eligible TEST canary and its exact title; and
no stale/error warning. Census rows, IDs, titles, URLs, credentials and digests
stay private/in memory. Reports contain closed codes, counts and safety facts.

Equal counts alone cannot prove identity, completeness, freshness, render
eligibility or title accuracy. Even equal before/after full snapshots cannot
rule out an intervening change that was reversed. This is a bounded observation,
not database snapshot isolation. Changed/mismatched snapshots remain
inconclusive; a later run is separate evidence, never a retry that erases an
earlier safety failure. The launcher does not retry its initial read.

Authoritative emptiness is recorded separately and **never passes the positive
canary gate**. The currently reviewed TEST census was empty of eligible active
cards; no seed was authorized/performed by this package. A future owner seed
packet must designate exact scope, one fresh eligible card, exact title,
preservation/inverse and fresh readback. Do not guess IDs, use real clients as
canaries or create data from this launcher. Existing live-action adapter and
owner-approved persisted-write drills remain separate requirements.

## Local proof (no backend or recipient I/O)

Install the pinned development dependencies and Chromium in the isolated
checkout, then run:

```text
node test/samples-initial-read.js
node scripts/samples-initial-read-run.js --fixture
node qa/client-continuity-transport.js
node test/client-continuity-monitor.js --strict-source
```

The fixture reuses boot instrumentation, replaces only its fake Supabase stub
with the installed real `@supabase/supabase-js` 2.115.0 UMD bytes, and intercepts
every browser/backend response. It preserves the existing boot suite. Positive,
empty, auth401 after known block, browser error, failed teardown, unknown socket/
realm/channel/POST, blocked metadata, failed-read empty success, wrong scope,
orphan counts, concurrent census, stale title and warning cases are asserted.
No incidental fixture exception is accepted as a positive defect assertion.
The independent loopback transport suite checks receiver escapes separately.

The fixture's npm SDK version is **not authority for the current CDN**. Before
any approved live read, privately acquire/approve the exact script bytes actually
served at the product's SDK URL and record their SHA256. The runtime hashes the
actual browser response against that pin. Different bytes stay red; do not
relax the descriptor, protocol or complete-primary checks to obtain live green.
If the serving reader does not emit the required complete exact count evidence,
that product integration remains HELD for its owner; this package does not
invent it or patch index.html.

## Private configuration and manual launch

Copy `samples-initial-read.example.json` to a private directory outside **every
Git repository**. Keep all booleans false until explicit release/drill approval.
Set up a fresh private output directory for this exact code/document/SDK/canary
binding. Never share that directory with old full-continuity receipts.

Use an exact clean tooling HEAD as `releaseSha`; an available immutable local
Git commit as `pageSourceSha`; independently approved document and actual SDK
SHA256s; and UTC epoch milliseconds for `activatedAt` and canary approval dates.
The approved canary reservation and continuing read authorization persist; no
arbitrary daily reapproval is required for nonmutating viewing. `canary.expiresAt`
is null unless the actual reservation/authority supplies an expiry. A supplied
expiry is checked before I/O and terminal publication; never extend it to keep
a job green. Each run still verifies current principal/scope, exact canary/title
and authoritative snapshots. A changed scope, link, title, row, document or SDK
needs an explicitly approved binding/config/output directory. Preserve the
previous directory for incident analysis.

Supply the example's named environment references through the approved private
secret store. Read origins are an explicit JSON array of origins. Canary IDs
are a JSON array of 1–10 owner-designated IDs; titles are a JSON object mapping
those exact IDs to approved titles. Supply the existing correctly scoped
read-only census credential; confirm its authority covers all unarchived rows
in that scope. A restricted RLS subset can report a misleading exact count, so
authority/role confirmation is a required owner configuration prerequisite.
The browser remains anonymous; the census credential is never injected into it.

After approval, enable only the selected operation in the private file and use:

```text
node scripts/samples-initial-read-run.js view --config <absolute-private-config> --activate OWNER_APPROVED_SAMPLES_INITIAL_READ
node scripts/samples-initial-read-run.js observe --config <absolute-private-config> --activate OWNER_APPROVED_SAMPLES_INITIAL_READ
```

`view` persists `samples-initial-UUID.start.json` before launching and a validated
terminal after full cleanup. A killed/expired worker leaves no success terminal.
A separate owned lock prevents overlap through terminal persistence and is
released only by that owner. Never replace a live runner's lock. A stale lock
requires human review of the process and orphan receipt before removal. A 120-second process deadline and
bounded browser/context/proxy cleanup apply. No data cleanup/writes occur.
Logs must remain aggregate-only: no traces, screenshots, HAR, console bodies or
private environment dumps in public CI/PRs.

`observe` reads **only** this namespace and verifies matching code/document/SDK/
approval pins and start/terminal pairing. It rejects zero-count success, missing
safety proof and `recovered` as a product-run terminal. Old observers ignore this
namespace and cannot become green from it. Observer recovery is a distinct
event, never a rewriting of failed run evidence. Observer state is private and
durable; preserve attempted delivery IDs until read-only reconciliation proves
delivery or the owner investigates. Never delete state to force another send.

## Alert drill, activation and independent host

Nothing is installed, scheduled or delivered by this draft. With delivery
disabled, observation prepares alert intent without sending. The new alert type
and text explicitly say `INITIAL_READ_ONLY` and `FULL_JOURNEY_UNPROVEN`.
Routing reuses the existing relay confirmation and direct bot/DM validation/
persisted readback adapter. A failed primary can use the configured independent
direct bot fallback; it does not retry a POST. Mocked fallback proves routing
logic only, not infrastructure independence or receipt by a human.

Future drill prerequisites: approve the exact two-message drill, verify private
recipient/account/team/DM and readback permissions, confirm that the fallback
does not depend on the primary relay, and verify the independent host. Enable
`drillEnabled` plus the delivery booleans **only** for that approved drill:

```text
node scripts/samples-initial-read-run.js drill --config <absolute-private-config> --activate OWNER_APPROVED_SAMPLES_INITIAL_READ
```

This sends a labelled synthetic failure then recovery with intent/readback
receipts. An unconfirmed first send stops the drill. Do not rerun an ambiguous
drill: reconcile its exact ID privately first. Separately approve a forced
primary-unavailable drill using a private intentionally unreachable primary
configuration (no n8n/credential edits), verify fallback readback and obtain
human acknowledgment. Then restore the approved primary config. These live
drills have **not** been performed by this package.

After release approval, an owner-provided always-on runner can invoke the view
command every five minutes under the distinct job name
`samples-initial-card-list-v1`, and an independently operated observer can read
replicated private receipts and invoke `observe` at least every minute. A start
without terminal after two minutes is `terminal_missing`; no fresh terminal
within ten minutes is `monitor_missing` (absence is red immediately at startup).
The independent host must also page on nonzero observer exit, missing observer
invocation/heartbeat, stale copied receipts, corrupt state, config expiry and
failed artifact transport. The observer cannot detect its own absence while it
is stopped. Host, replication, independent scheduler/dead-man service, private
configuration and recipient confirmation remain **missing activation inputs**.
No scheduler is installed by these commands. GitHub scheduling alone cannot
guarantee an exact five-minute interval or independence from GitHub outages.
Do not point the existing full-continuity scheduler/observer at this new result.

The future fifteen-minute approved TEST action job remains the existing separate
gated action lane, requiring its live-action adapter/reservation, explicit fresh
owner TEST scope verification before each mutation, and persisted readback.
This initial-read command does not enable or substitute for that job.

## Recovery and inverse

For a red run, keep its start/terminal and alert intent. Diagnose with approved
private reads; never change writers/flags/credentials or seed data as automatic
recovery. Restore the approved source/config or let the responsible product
owner repair the fault. Under the continuing approved read scope and a freshly verified exact canary, a new
complete run may produce initial-read recovery. It does not clear full-journey
`mutation_blocked` or prove a client action. Release remains gated on the
separate full journey and required live drills.

Disable: set private `viewEnabled`, `observeEnabled`, `drillEnabled` and
`delivery.enabled` false; stop only `samples-initial-card-list-v1` and its
distinct observer/dead-man after acknowledging the planned coverage gap; confirm
no process remains and no new starts appear. Retain all receipts/state. Return
to the preserved 6383 tooling checkout/config if needed; no product inverse or
backend/data rollback is required. Never re-gate frozen writers. PR #1292 and
all prior monitor evidence remain unchanged.
