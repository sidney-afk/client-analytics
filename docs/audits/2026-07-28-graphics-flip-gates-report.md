# Graphics-specific flip gates — drill report (2026-07-28)

**What this is.** Owner asked to run and report the five drills the 2026-07-28 re-scope
(`GO_LIVE_CHECKLIST.md` "OWNER RE-SCOPE — 2026-07-28", lines 74-98) kept as Graphics flip
gates while deferring the rest of the ~55-item QA-drill bucket: **F53** (graphics canonical
media delivery), **F12** (submit-graphics TEST drill against the deployed EF), **F201/F202/F203**
(graphics mutation surface — labels/description/create), and **F40** (per-team Workload
authority). Findings only; **nothing was fixed, no flag/secret/provider changed, no drill run
against a live provider, no checklist box ticked.** Run at `d3d5393`.

**Method.** For F53/F201/F202/F203: ran the existing offline/hermetic source-contract suites
(`test/` — network-free per `test/run-all.js`'s own header, safe to run unconditionally) plus
cross-referenced the freshness-verified truth docs (`docs/truth/APP.md`, verified 2026-07-26) and
`EXECUTION_LOG.md` for what's actually deployed vs. merely merged source. For F40: same, plus the
Workload-specific truth-doc callouts. For F12: **no drill was run.** The checklist's own F12 box
(lines 754-761) says this in as many words: *"This checklist item is a closure requirement, not
authorization: before either run, bring the owner the exact TEST-only change and rollback."* That
gate is respected below — the report brings the plan, not a run.

---

## Summary table

| Gate | Hermetic test | Result | Live/deployed status | Verdict |
|---|---|---|---|---|
| F53 | `test/production-attachments.js` | 61/61 checks pass | Migration + edge fn **live** since 2026-07-24 (Slice 4) | Code proven; **no live TEST walk yet** |
| F201/F202/F203 | `test/production-write-gateway.js` (+ `test/production-write-drill.js` for F202) | 116/116 + 46/46 pass | Migrations + `production-write` **live** since 2026-07-24; UI source (`_prodCreate*`) present in current `index.html` | Code proven; **"TEST drills still owed" per truth doc** |
| F40 | `test/workload-linear-browser.js` | 285/285 assertions pass | **Partially built** — only the metadata-partition seam; broader adapter is OPEN | Test passes for what exists; **gate itself is not fully built** |
| F12 | — | **not run** | Nightly routine drill explicitly skips real generation | **Correctly withheld — see plan below, needs your go-ahead** |

All four hermetic suites are green. That is real signal, but it is signal about *source
correctness*, not about the live drills the checklist actually requires to close these boxes —
see per-gate detail.

---

## F53 — Graphics canonical media delivery

**Checklist box** (line 741-744): protected file/link write or first-class picker updates
`deliverables.file_url`, preserves actor/time/replacement history, projects the correct card
asset; SMM Approval rejects media-less work; a fresh TEST intake completes every review/tweak
surface.

**Ran:** `node test/production-attachments.js` — **61/61 checks passed**, exit 0. Covers: canonical
link identity (Drive resourcekey / Dropbox rlkey), credential/private-host/non-HTTPS URLs failing
closed, typed source docs never becoming canonical, the Linear `attachmentCreate` mirror contract
with revision markers, A-B-A replay suppression, attachment auth/role/client-activity gating, the
F34 rescue-and-reconcile machinery (HMAC-certified independent export, gap detection, stream-bounded
downloads), and the archive reader's auth/retry/race behavior.

**Deployed status:** `migrations/2026-07-23-f34-f53-production-attachments.sql` was applied to
production Supabase 2026-07-24 (`EXECUTION_LOG.md` "Five Slice 4 migrations applied to
production"), and `production-write`/`production-archive` were deployed from `1738ad3` the same
day. `docs/truth/APP.md` (verified 2026-07-26) confirms this and states plainly: **"TEST drills
still owed."**

**Verdict:** the code path is live and its source contract is proven. What's still open is exactly
what the checklist box asks for and what "undrilled" meant in the 2026-07-28 audit: a live TEST
intake exercising SMM Approval's media-less rejection and the full attach/replace/refresh/
second-device walk. No such drill exists yet under `qa/probes/` (checked the nightly manifest and
the probe directory — no F53-named live probe).

---

## F201/F202/F203 — Graphics mutation surface (labels / description / create)

**Checklist box** (line 415-418): Production reads and guarded-sets the real label catalog
(including exact Workload labels), reads and guarded-writes parent/sub-issue descriptions, and
creates parents/sub-issues with durable recovery; label reaches native Workload capacity after
flip; description/create survive conflict/retry/second-device paths.

**Ran:**
- `node test/production-write-gateway.js` — **116/116 checks passed**, exit 0. Exercises the
  gateway's F201/F202/F203 operations directly: label-catalog reads, guarded label sets, Markdown
  description read/write with CAS and conflict handling, and the F203 create path (exact retries,
  replay-before-authority, exact label-node requirement, single deliverable enqueue, redacted public
  audit).
- `node test/production-write-drill.js` — **46/46 checks passed**, exit 0 (offline scaffold check
  for the description-mutation drill contract, distinct from the live nightly drill below).

**Deployed status — and a doc-staleness finding:**
`migrations/2026-07-23-f201-production-labels.sql`, `f202-production-descriptions.sql`, and
`f203-production-issue-create.sql` were all applied to production 2026-07-24, and
`production-write` was redeployed the same day from `1738ad3` (PR #931, "Slice 4 reland"). The
current `index.html` at `d3d5393` contains the full F203 create-form UI (`_prodCreateFormHTML`,
label catalog search, Markdown description field, role gate text "Only Admin and SMM staff can
create Production issues") — this is live source, not a stub.

**However:** `docs/syncview-design/WIRED-PARITY.md` lines 37/54-56 still read *"the migration/
function/UI source is not live"* / *"F203 source-only candidate."* `git blame` shows those lines
were last touched by commit `3029560` — **"Revert Slice 4 source to restore live client comments
(#928)"** — i.e. they describe the state *during the revert*, before PR #931 relanded Slice 4 and
before the migrations were applied. Nobody reconciled this ledger afterward. Per the project's own
convention (`WIRED-PARITY.md matches runtime truth` is a stated invariant elsewhere in this repo),
**this doc is stale and should be corrected** — flagging per "report, don't fix."

`docs/truth/APP.md` (2026-07-26, current) has the accurate summary: *"F201/F202/F203/... migrations
applied 2026-07-24, functions deployed from `1738ad3`... **TEST drills still owed**."*

**Verdict:** backend + UI source for all three are live; the hermetic contract is proven. The actual
live-drill proof (real label set, real description edit, real create, surviving refresh/conflict/
second device) has not been run — matches the audit's Bucket E characterization exactly.

---

## F40 — Per-team Workload authority

**Checklist box** (line 657-659): flipped teams read the reconciled native adapter with native
links/realtime/catch-up and no Linear fallback; the parity report resolves stale ghosts,
top-level visibility, CON/STR, parents, clients, assignees, and mixed authority.

**Ran:** `node test/workload-linear-browser.js` — **285/285 assertions passed**, exit 0 (hermetic;
extracts and sandbox-runs the actual `index.html` functions). Confirms: the due-date/label metadata
partition by exact `prod_authority` team value; Linear-authoritative IDs use the isolated
`workload-linear` reader while SyncView-authoritative IDs read native `deliverables.due_date` and
the native label relation; missing/ambiguous/incomplete native metadata fails closed rather than
falling back to Linear; the two authority partitions settle independently (a Linear outage can't
discard a proven native snapshot).

**This is real, but it is not the whole gate.** `docs/truth/APP.md` (2026-07-26) is explicit:
*"F201/F40 candidate source partitions deadline/label metadata by the exact `prod_authority` team
value... **The broader F40 issue adapter, native links, realtime/catch-up, and top-level policy
remain open.**"* `docs/independence/SYSTEM_MAP.md:1002` agrees: *"F40 remains partially addressed:
F201's source-only due/label metadata seam reads flipped-team `deliverables` without a foreign
round trip... "* — i.e. only one seam of F40 is built.

**Verdict:** the test suite is green for what exists, but what exists is a subset of the checklist
box. The full native issue adapter, native links, realtime/catch-up, and the top-level policy
(stale-ghost resolution, CON/STR, parents/clients/assignees, mixed authority) are not yet built, so
this box cannot be closed by a drill alone — it needs the remaining implementation first. This
matches the audit's framing of F40 as one of the "mechanical minimum" items rather than a pure
prove/QA gate.

---

## F12 — Submit-graphics TEST drill against the deployed EF (NOT RUN — plan for your go-ahead)

**Checklist box says, verbatim** (`GO_LIVE_CHECKLIST.md` lines 754-761): drill the submit-graphics
path live on the private TEST fixture only against the deployed EF, including real
`GRAPHIC_TITLE_*` generation. The *routine* drill's explicit generation skip is not real-generation
evidence. Retain `graphic_generation_verified:true`, `0/0/0`, unchanged-flags and cleanup receipts,
plus a provider-failure zero-write/recovery receipt. **"This checklist item is a closure
requirement, not authorization: before either run, bring the owner the exact TEST-only change and
rollback. This docs reconciliation authorizes no drill, provider/secret change, runtime-flag
change, or client write."**

I did not run anything for F12. Here is the exact change/rollback for you to bless, per that gate:

### What already runs today (no action needed)
`.github/workflows/production-write-drill.yml` fires nightly (`cron: 17 4 * * *`) and on
`workflow_dispatch`, running `scripts/production-write-drill.js` against the live Supabase project
and Linear, using repo secrets `SUPABASE_SERVICE_ROLE_KEY`/`LINEAR_API_KEY`. For the graphics lane
it currently **always** sets `skip_graphic_generation: true`
(`scripts/production-write-drill.js:214`), so the drill never calls the real title provider — this
is the "routine drill" the checklist says is not real-generation evidence. `EXECUTION_LOG.md`
confirms F12 was previously marked done in error and was corrected back to OPEN on 2026-07-20.

### The one change that would exercise real generation
`scripts/production-write-drill.js:22` reads
`PRODUCTION_WRITE_DRILL_REAL_GRAPHIC_GENERATION` (truthy → `1`/`true`/`yes`). When set, line 214's
`skip_graphic_generation` override is not sent, so the TEST-fixture graphics intake goes through the
real `GRAPHIC_TITLE_*` provider; line 271-274 then asserts the returned brief is a real generated
title (not the `"Video 1"` fallback) and that it round-trips to the mirrored Linear issue, setting
`graphic_generation_verified: true` in the run's report.

**Exact change for one run:** a `workflow_dispatch` of `production-write-drill.yml` with the repo/
environment variable `PRODUCTION_WRITE_DRILL_REAL_GRAPHIC_GENERATION=1` added for that invocation
only (`PRODUCTION_WRITE_DRILL_TEAMS` can stay at its default `video,graphics`, since it already
includes `graphics`).

**Blast radius:** the drill still only touches the one active TEST client fixture
(`preflight()` asserts exactly one `kind=test, active=true` client) and archives it at the end of
its own run — no real client row is touched. The real, non-reversible-by-us cost is: **one live
call to the real title-generation provider** (external spend/rate-limit, not a TEST double) and one
disposable but real Linear TEST issue. That external-provider call is precisely why the checklist
gates this on your say-so rather than treating "the code already supports it" as authorization.

**Rollback:** trivial — it's a one-shot `workflow_dispatch` input, not a stored config or schema
change. Not setting the variable (or simply not repeating the dispatch) reverts to the default
skip-generation behavior on the very next nightly cron run automatically. Nothing to undo in code.

**The second half — provider-failure receipt:** the checklist also wants a "provider-failure
zero-write/recovery receipt," proving that if the title provider fails, zero native writes happen
and the drill recovers cleanly. That needs a *second*, separately-blessed TEST-only change (e.g. a
deliberately invalid TEST-scoped provider credential for one run) — I have not designed that one in
detail since it's a distinct owner decision from the happy-path run above.

**What I'd need from you to proceed:** an explicit go-ahead to (a) add
`PRODUCTION_WRITE_DRILL_REAL_GRAPHIC_GENERATION=1` for one `workflow_dispatch` run, and separately
(b) bless a specific provider-failure simulation for the recovery receipt. I have not triggered
anything and won't without that.

**Also missing:** there is no dedicated runbook doc for this window (the repo has one for F27 —
`docs/ops/F27_INSTALL_RUNBOOK.md` — but nothing equivalent for F12's real-generation window). If you
approve, that's worth writing down the same way before either run, not just doing it ad hoc.

---

## Bottom line

- **F53, F201, F202, F203:** backend is live (Slice 4, 2026-07-24), source contracts are proven by
  116+61+46 green hermetic checks, and `docs/truth/APP.md` already says the live TEST-drill proof
  is the remaining work — consistent with what you kept these as flip gates for. One doc
  (`WIRED-PARITY.md`) is stale and worth a quick correction pass.
- **F40:** hermetic test is green (285/285), but it only covers the metadata-partition seam that's
  actually built. The broader native adapter/links/realtime/top-level-policy scope the checklist box
  asks for is still open per two independent truth docs — this one isn't drill-ready yet, it's
  build-incomplete.
- **F12:** correctly not run. Plan above is ready for your go-ahead on both the real-generation run
  and the provider-failure run.

No code, flags, secrets, or checklist boxes were changed by this report.
