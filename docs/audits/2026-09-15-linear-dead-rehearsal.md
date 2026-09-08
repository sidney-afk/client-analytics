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

Pin one shape when chasing a single defect:

```
SYNCVIEW_QA_LINEAR_DEAD=ok_lie node qa/master.js --profile=full
```

### FOUR PROBES ARE NOT REHEARSED BY THIS, AND THE COMMAND ABOVE DOES NOT COVER THEM

Found by the Codex review of this PR, verified against the tree, and it is the
same defect one layer out from the one this whole document exists to correct.

`SYNCVIEW_QA_LINEAR_DEAD` is honoured by the centralized interceptor in
`qa/sxr_courier_lib.js`. Four probes never reach it — they register their own
`ctx.route('**/webhook/linear-…')` handlers that fulfil `200 {"ok":true}`
unconditionally, and a later-registered Playwright route wins:

| probe | what it self-mocks |
|---|---|
| `qa/probes/p28_linear_sync.js` | `linear-set-status`, `linear-add-comment` |
| `qa/probes/p29_linear_kasper.js` | `linear-set-status`, `linear-add-comment` |
| `qa/probes/p30_linear_client.js` | `linear-set-status`, `linear-add-comment` |
| `qa/probes/p36_full_sync.js` | `linear-set-status`, `linear-add-comment` |

**So a full-manifest run with dead mode on exercises HEALTHY Linear for exactly
the status-and-comment write flows the rehearsal most needs to see die.** A pass
on those four is not evidence about the cutoff. Read them as unrehearsed, not as
green.

**This is not fixed here, deliberately.** `qa/probes/**` is not among the files
this lane owns, and the house rule is to write the need into the ledger rather
than edit another lane's file. The fix is small and mechanical — each probe's
`route.fulfill` becomes a call that honours the mode, four files, roughly four
lines each — and it is recorded in OPEN_REPAIRS 175 for whoever owns those
probes.

**Until then, R9 and R10 below are scoped to the seven webhooks the interceptor
sees, and these four probes are excluded from every claim this document makes.**
`test/linear-dead-rehearsal.js` enforces the exclusion list against the probe
directory, so a new self-mocking probe fails the suite until it is either
converted or listed here — the list cannot silently rot.

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
| R10 | All four fault shapes were injected | distinct `dead` values in `linear_calls.jsonl` | | |

**R7 is the one that matters and it is the one a machine cannot judge.** Every
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
