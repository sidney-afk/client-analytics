# The "Linear is dead" rehearsal

**Status: PREPARED, NOT RUN.** This file is the protocol and the result form.
The results table is empty because nobody has run it yet. Fill it in on the day.

**What it converts.** 2026-09-15 is currently a hope: everyone believes the app
survives Linear going away, and nobody has watched it happen. This rehearsal makes
it a test with a pass/fail, runnable any day before the date, repeatable, and
cheap.

---

## 1. The correction this rehearsal is built on — read this first

The exit scoping says the house already has "a Linear-mocked headless harness" and
suggests pointing it at this question. **It cannot answer this question as it
stood, and the reason matters.**

`qa/sxr_courier_lib.js` intercepted the Linear webhooks and fulfilled
`200 {ok:true}` for every one. That is a mock of Linear **WORKING**. There was no
failure-injection path anywhere in the file. So every "we tested with Linear
mocked" result in this repository is evidence that the app survives a **healthy**
Linear — which is not in doubt and is not the question.

It was also incomplete. The interception regex named four webhooks by hand
(`linear-set-status`, `linear-add-comment`, `linear-subissues`,
`linear-issue-statuses`). **The browser calls seven.** `linear-issues`,
`linear-projects` and `linear-tweak-comments` were never intercepted, so in an
open-egress environment a probe could reach live n8n on those three.

Both are fixed. `LINEAR_HOOK` is now a prefix match over every
`/webhook/linear-*`, so a Linear webhook added tomorrow is intercepted the day it
is added rather than the day someone remembers.

**A number correction while we are here.** The brief says ten Linear webhooks and
the review says "four of the ten". The tree contains **eight** distinct
`/webhook/linear-*` names. Seven are called by `index.html`. The eighth,
`linear-status-sync`, is an INBOUND receiver Linear posts to — the browser never
calls it, and `docs/ops/MONITORING.md` records its workflow (`MJbMZ789B5ExZz9x`)
as inactive/unpublished. So the honest figure is **four of seven intercepted
before this change, seven of seven after.**

**And the prefix is not the whole surface — corrected 2026-09-08.** Counting
`linear-*` names answers "which Linear-NAMED webhooks are intercepted", which is
not the same question as "does anything still reach Linear". Lane LX-N8N
(OPEN_REPAIRS 181) named four webhooks that reach Linear through their n8n
workflow while carrying no `linear-` prefix, each verified against this tree:

| webhook | how it reaches Linear |
|---|---|
| `editors-week` | queries Linear for the week's editor workload |
| `send-urgent-slack` | shaped like a Slack write, but resolves the issue's **current Linear assignee** to pick who to mention |
| `video-form` | creates a Linear issue |
| `graphic-form` | creates a Linear issue |

Left alone, a dead-Linear run would have sent these four to real n8n and a
**healthy** Linear — reporting four Linear-dependent flows as surviving Linear's
death on the strength of them having quietly used a live one. That is this mode's
own founding error, one layer further out, and it would have passed every
assertion in the suite. `LINEAR_BACKED_HOOK` now covers them **in dead mode
only**: healthy-mode behaviour is unchanged, because the courier has never mocked
these four and altering that would silently change every existing probe rather
than only the rehearsal. `kasper-queue` is excluded with `log-linear-submission`
for the same reason — it reads Sheets and survives Linear untouched.

**So the coverage claim is now two claims, and both belong in the result form:**
seven of seven `linear-*` webhooks, **and** four of four Linear-backed webhooks
that carry no such name.

**`log-linear-submission` is deliberately NOT intercepted and NOT blocked.**
Despite the name it is not a Linear endpoint — it appends to a Google Sheet and
touches no Linear API. Blocking it re-opens the 2026-08-26 incident where the only
copy of a videographer's submitted work lived in his own browser. `test/linear-dead-rehearsal.js`
asserts it stays untouched.

---

## 2. What "dead" means here

`SYNCVIEW_QA_LINEAR_DEAD=1` answers every `/webhook/linear-*` call as a dead
upstream. **The faults are mixed, deterministically, rotating by call index** —
a single failure shape only proves the app handles that shape, and real death is
ragged.

| shape | response | why this one |
|---|---|---|
| `refused` | connection aborted | the n8n host itself gone |
| `gateway` | **502**, `text/html` body | a proxy answering for a dead upstream. Non-JSON on purpose: a caller doing `await resp.json()` breaks differently from one checking `resp.ok`, and the rehearsal must surface that difference before the date |
| `timeout` | **504**, `text/html` body | upstream accepted, never answered |
| `ok_lie` | **200**, `{"ok":true}` and nothing else | **the important one.** OPEN_REPAIRS 78 records twenty legacy webhook calls that were silent 409s which n8n logged as `success`. A dead lane that still answers 200 is an OBSERVED shape here, and it is the only one `resp.ok` cannot catch. A rehearsal without it proves the app handles loud failure and says nothing about quiet failure — which is the entire subject of this exit |

`api.linear.app` and `uploads.linear.app` are aborted at page level in **every**
mode, dead or healthy. A probe must never reach Linear's own API: that would
mutate a real editor's issue.

The rotation is deterministic, so a failure reproduces. To isolate one defect,
pin a single shape: `SYNCVIEW_QA_LINEAR_DEAD=ok_lie`.

Every injected fault is written next to the request in `linear_calls.jsonl` as
`{path, dead, at}`, so an assertion can state which shape the app was handed
rather than guessing.

---

## 3. How to run it

Offline, no browser, no network — proves the harness itself is correct:

```
node test/linear-dead-rehearsal.js
```

The rehearsal proper, against the live backend with Linear dead:

```
SYNCVIEW_QA_LINEAR_DEAD=1 node qa/master.js --profile=full
SYNCVIEW_QA_LINEAR_DEAD=1 node qa/run-probes.js
```

**Run it PINNED, once per shape. The rotating run is not sufficient on its own.**

```
for shape in refused gateway timeout ok_lie; do
  SYNCVIEW_QA_LINEAR_DEAD=$shape node qa/run-probes.js
done
```

Why this matters, and it is the difference between a rehearsal and a ritual: the
rotation hands each intercepted call whichever fault is next on a shared counter.
The probes record the payloads they were sent but not the SHAPE they were given,
`p30` starts several actions before settling, and `p36` shares one counter across
three browser contexts. So call ordering decides which flow meets which fault, and
a probe that makes only two calls (`p29` typically does) can never see all four in
a single run.

**A rotating run therefore proves the overall fault distribution, not that any
particular write flow survived a particular fault.** R10 below reads as satisfied
either way, which is exactly the kind of aggregate that looks like evidence and is
not. Four pinned runs give every flow every shape, and `ok_lie` — the one that
cannot be caught by checking `resp.ok` — is the one worth being certain about.

Found by Codex on PR #1350.

### The four probes that used to escape the interceptor — now fixed

Found by the Codex review of this PR, and it was the same defect one layer out
from the one this whole document exists to correct.

`SYNCVIEW_QA_LINEAR_DEAD` is honoured by the centralized interceptor in
`qa/sxr_courier_lib.js`. Four probes never reached it — they registered their own
Playwright route for the same webhooks and fulfilled `200 {"ok":true}`
unconditionally, and a later-registered route wins. **So a full-manifest run with
dead mode on exercised a HEALTHY Linear for exactly the status-and-comment write
flows this rehearsal exists to watch die.**

**There were SEVEN, not four.** The first sweep matched only patterns that spelled
a Linear webhook literally. Three more build theirs by concatenation —
`for (const wh of ['linear-set-status', …]) ctx.route('**/webhook/' + wh, …)` —
and sailed past a check that reported itself green. All seven now answer through
the shared helper.

| probe | pattern | status |
|---|---|---|
| `qa/probes/p28_linear_sync.js` | literal | answers through the shared helper |
| `qa/probes/p29_linear_kasper.js` | literal | answers through the shared helper |
| `qa/probes/p30_linear_client.js` | literal | answers through the shared helper |
| `qa/probes/p36_full_sync.js` | literal | answers through the shared helper |
| `qa/probes/p47_title_review.js` | **concatenated** | answers through the shared helper |
| `qa/probes/p60_modal_smm.js` | **concatenated** | answers through the shared helper |
| `qa/probes/p68_linear_link_clear.js` | **concatenated** | answers through the shared helper |

`ot4_t1_submit_intake_guards.js` is deliberately NOT in this table. Its
`route('**/*')` catch-all names two Linear paths, but it is a sealed fixture whose
default is `route.abort` — it refuses everything it does not name, so it is not
pretending Linear is healthy.

They cannot simply drop their routes and inherit the library's, because they need
to RECORD the calls they intercept. So they share one answer:
`qa/probes/linear-hook-fulfil.js`. Healthy mode is the historical `200 {"ok":true}`
byte for byte, so a probe green before the helper existed stays green for the same
reason; dead mode gets the same four-shape rotation as everything else.

Measured rather than asserted, six calls in dead mode:
`ABORT/connectionrefused · 502 · 504 · 200 · ABORT/connectionrefused · 502`.
Healthy mode: `200 · 200 · 200 · 200`. Before the fix, dead mode was `200` every
time.

**What keeps it fixed.** `test/linear-dead-rehearsal.js` does not maintain a list
of names — an exclusion list has to be updated by whoever adds the next probe, and
that is precisely the person who does not know it exists. It slices **every**
Linear route handler in `qa/probes/` by balancing parens from its `.route(` and
requires each one to answer through the helper and never to fulfil directly. A new
probe that hand-rolls its own answer fails immediately, and so does reverting a
single handler out of the two each of these probes registers.

**Run it BEFORE the cutoff's STEP 3, not after.** The point is to find the
breakage while the flags can still be put back.

**Run the server-side half separately, with the keys unset.** The browser harness
cannot exercise `production-write`'s Linear reads, and those are where staff-visible
503s live. See §5.

---

## 4. What must be true — the result form

Fill in `observed` and `verdict`. **A blank row is not a pass.**

| # | assertion | how to see it | observed | verdict |
|---|---|---|---|---|
| R1 | The Production list renders its cards | open `?prod=1`, count rendered rows against a REST census of the same scope | | |
| R2 | A status write commits and reads back | change a status on the TEST client `sidneylaruel`, re-read the canonical row | | |
| R3 | A comment posts and reads back | post a production comment, reload, confirm it renders | | |
| R4 | The Workload board renders | open Workload, count parents and children | | |
| R5 | The client-facing Calendar link renders its cards | open the anonymous Calendar link, count cards | | |
| R6 | The client-facing Samples link renders its cards | open the anonymous Samples link, count cards | | |
| R7 | **Zero silent empties.** No surface renders an empty or partial state without saying why | screenshot every surface in R1-R6 and read it as a person would | | |
| R8 | No request reached `api.linear.app` | `linear_calls.jsonl` contains no row whose `path` is `api.linear.app` with a non-`refused` outcome | | |
| R9 | Every one of the seven webhooks was exercised at least once | distinct `path` values in `linear_calls.jsonl` | | |
| R10 | All four fault shapes were injected | **all four of** `refused`/`gateway`/`timeout`/`ok_lie` present as `dead` values in `linear_calls.jsonl` **on rows whose `path` is a webhook name — `path:"api.linear.app"` rows do NOT count** (see the warning below) | | |
| R10b | **The four Linear-backed webhooks were intercepted too, not just the `linear-*` ones** | `linear_calls.jsonl` carries `"backed":true` rows for every one of `editors-week`, `send-urgent-slack`, `video-form`, `graphic-form` that the run exercised — and a run that exercised none of them does not satisfy this row, it fails to test them | | |
| R11 | **Each shape was run PINNED across the probe manifest** — four runs, not one rotating run | four separate `SYNCVIEW_QA_LINEAR_DEAD=<shape>` invocations, each recorded here | | |
| R12 | The status-and-comment write flows survived `ok_lie` specifically | the pinned `ok_lie` run, read as a person: a 200 that carried nothing must not be reported anywhere as success | | |


> **⚠️ R1-R12 CAN ALL PASS WHILE EVERY INTAKE PATH IS BROKEN. Added 2026-09-08.**
> The rows above check that surfaces *render*, that two writes commit, and that the
> harness did its job. **None of them requires a post to be creatable.** A rehearsal
> in which Calendar post, Samples/SXR post, staff submission, append, component fill,
> label, assignee and client-link submission all **refused cleanly** would complete
> this form and read as a pass — because "fails cleanly" is what a rehearsal usually
> looks for.
>
> **On the intake paths, failing cleanly is the DEFECT, not the proof.** Those
> surfaces read Linear through `production-write`, and none of the held PRs changes
> that file. The rows below are therefore stated as behaviour that must **succeed**;
> a clean refusal is a FAIL. They are `LINEAR_CUTOFF_RUNBOOK.md`'s **P7**, restated
> here because this is the form somebody fills in.

| # | Must SUCCEED with Linear dead, on `sidneylaruel` | a clean refusal is a FAIL | pass/fail | notes |
|---|---|---|---|---|
| W1 | Calendar post created | ☐ | | |
| W2 | Samples/SXR post created | ☐ | | |
| W3 | Staff submission accepted | ☐ | | |
| W3b | **Append into an EXISTING batch** — the common case, and the one `projectForIntake` alone does not cover (`handleIntakeCreate:6701`/`:6721`, `validateExternal = !exactRowRetry`) | ☐ | | |
| W4 | **Component fill** — reaches `validateLinearBatchParent` independently (`handleComponentFill:6038`, seven args, `validateExternal` defaults `true`) | ☐ | | |
| W5 | Set a label AND open the picker | ☐ | | |
| W6 | Change an assignee **after** the flag flip — the flag readback proves what the flags table holds, not what the deployed function does | ☐ | | |
| W8 | A **client-link** submission | ☐ | | |

**And three READ checks that must defeat their caches**, because a cached render
looks exactly like a pass:

| # | Must be true | why the obvious check is unsound |
|---|---|---|
| D1 | Workload board read with Linear dead **against known-changed data** | it FREEZES rather than empties, so a board that looks fine is not evidence |
| D2 | Editors subtab after an **explicit Refresh** | `_kasperLoadEditors(false)` hits `_kedLoadEditorsCache()` and returns **with no network call at all** on a hit |
| D3 | Tweak comments in a browser where that row's comments were **not fetched in the last 5 minutes** | `wlFetchTweakComments` skips the fetch inside a 5-minute TTL |

**Each read check also needs a correlated successful native request in the network
panel. Rendering is not evidence; the request is.** D1-D3 are the inverse of the
write trap: there, a clean refusal read as a pass; here, a cached render does. Both
come from checking the surface instead of the path.

**Also record, either way: the `send-urgent-slack` decision.** It is shaped like a
pure Slack write but resolves the issue's current Linear assignee to pick the
mention, so it dies with the account and has no merged replacement.
> **⚠️ `dead` in the log does not by itself mean dead mode ran.** The
> `api.linear.app` / `uploads.linear.app` guard writes
> `{path:"api.linear.app", dead:"refused"}` **in every mode, healthy included** —
> it is a belt-and-braces abort so a real-browser probe can never mutate a real
> editor's issue, and it is deliberately not conditional on
> `SYNCVIEW_QA_LINEAR_DEAD`. So a perfectly ordinary healthy run produces `dead`
> rows, and any check of the form *"the log contains `dead` values"* passes
> without dead mode ever being entered.
>
> **Read only the rows whose `path` is a webhook name**, or the `backed:true`
> rows, which exist only in dead mode. *(Found 2026-09-08 by sweeping this form
> against what the harness actually writes — after a verification line in
> `LINEAR_CUTOFF_RUNBOOK.md` STEP 6 had already been written with exactly this
> defect, in the same sitting that established sweeping restatements as this
> lane's standing check. The check found its own author's newest sentence.)*

**R7 and R12 are the ones that matter, and they are the ones a machine cannot judge.** Every
other row can be asserted. "The board looked normal and was a photograph" is
exactly the failure this exit is about, and a person has to look. Take the
screenshots.

---

## 5. The server-side half — run it with the keys unset

The browser harness cannot reach these. Run `production-write` with
`LINEAR_API_KEY` / `LINEAR_READ_API_KEY` unset and confirm **all four** codes.
The exit scoping says there are two call sites; there are four distinct
staff-visible surfaces behind two transport functions (OPEN_REPAIRS 165 point 3),
and a rehearsal that observes only two will be recorded as complete while status
mapping and the assignee picker were never exercised.

| # | call site | expected | observed | verdict |
|---|---|---|---|---|
| S1 | `linearLabelsRequest` `:832` (throws `:834`/`:843`/`:847`) | 503 `label_catalog_unavailable` | | |
| S2 | `linearRead` (throws `:2325`) | 503 `project_mapping_validation_unavailable` | | |
| S3 | `linearStateIdForCreate` (throws `:2539`/`:2548`/`:2556`) | 503 `linear_team_mapping_unavailable`, 409 `status_mapping_unavailable` | | |
| S4 | `assigneeProviderPool` (throws `:2600`) | 503 `assignee_provider_unavailable` | | |

Note `handleCreateOptions` has **two** ungated reaches in one `Promise.all`
(`linearLabelCatalog` AND `mappedCreateAssignees`), so exercising it once can
surface either.

**This table is the hard precondition for revoking the credentials** (cutoff
runbook STEP 7). Until all four are removed and deployed, revocation turns
"create a deliverable" and "pick a label" into HTTP 503 for staff, on a day when
nobody will connect the two events.

---

## 6. What this rehearsal does NOT prove

Say these out loud rather than letting a green run imply them:

- **It does not prove the n8n workflows survive.** It mocks their HTTP surface
  from the browser's side. What n8n itself does with a dead Linear credential is
  not exercised here at all.
- **It does not prove the reconcilers behave.** They run in GitHub Actions against
  the live backend, not in this harness.
- **It does not prove the alarms ring.** That is the alarm-proof lane's job, and
  acceptance (relay HTTP 200) is explicitly not accepted as proof —
  `docs/ops/MONITORING.md` F09/F66/F81.
- **It does not prove the board stays fresh.** A frozen `workload_issues` renders
  perfectly in this harness, because freezing is not an error. That is the
  workload-source-freshness watcher's job, and it is the reason that watcher
  exists.
