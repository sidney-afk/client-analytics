# Digger: preventive bug archaeology, 2026-10-10

Nineteen defects survived skeptical verification (the twentieth row is the
stale-guard repairs). Seventeen are fixed here, each with a regression guard
that fails on the code before the fix; two (rows 6 and 10) are fixed by other
pull requests the owner chose to keep (#2037, #2033). The biggest single
finding is a process one: 30 fully mocked browser regression tests had never
been started by any workflow, 9 of them had drifted to failing, and one of
those was catching a real crash (a fresh Kasper sub-tab address showed an admin
"Could not load data"). Nothing was deployed, applied, merged or switched; no
n8n workflow was read or edited; the only live access was read-only SQL counts.

Three branches carry the work (ledger entries 405, 404, 398):

- **405, never-run browser guards** (`claude/laughing-edison-mzgxbl`, pushed,
  no pull request yet): a unit test that fails when a browser test exists and
  no workflow runs it; a CI job running the 28 passing guards; six stale
  guards repaired; the Kasper deep-link crash they were hiding, fixed.
- **404, wrong client and lost work (page)**, #2038: the credentials dialog,
  the Instagram Calendar cover, the TikTok retry key and fallback, Samples
  Notes, a restored SyncLinear comment, Analytics "This week" on the 1st, the
  Ads panel dates. Kasper's Samples notes were dropped in favour of #2037.
- **398, server and ops**, #2039: the Instagram client lookup and Cancel,
  Higgsfield's unconfirmed creates, an unreadable Pages source, an empty
  roster in the name check, paging order in the drift robot. The Brain "&"
  fix was dropped in favour of #2033.

## Scope and stop rule

Audit base: main at `1be8547` (#2029). Corpus: `docs/ops/OPEN_REPAIRS.md`
entries 331 to 393 (2026-10-02 to 10-10, everything after the previous run,
`docs/audits/2026-10-02-bug-archaeology.md`), plus the merged fix commits of the
same window. Live mutation allowed only on the test client; none was needed.
Cycle cap 5; stop after two consecutive cycles with no new confirmed finding.

## History through the six lenses (condensed)

| Pattern | Archetype in the corpus | Mechanism | Class | Isomorphs swept |
|---|---|---|---|---|
| Q1 Null read as zero | 382: `Number(null)` is 0, a reply got round 0, the database check threw, 500 | coercion passes the integer check | validation trusts a coerced value | every `Number(x)` on nullable data in page and functions |
| Q2 Retry without a ceiling | 382: one reply resent 670 times in 21 hours | a deterministic failure classed retryable | poison message | page retry journals, outboxes, server claims |
| Q3 Authority flip leaves an old-direction reader | 374: copy job sent Clients Info after the database owned it; 371: Instagram id read from the Sheet | consumer not moved with the owner | ownership drift | Sheet readers/writers, help text, roster sync |
| Q4 Closed list broken by a new member | 387: backup corpus refused new foreign keys | inventory fixed, world grew | closed-world assumption | Pages allowlist, deploy manifest, timer list, test registry |
| Q6 Tool failure read as nothing to do | 390: lane-ticker parsed an unsupported flag, exited green | unknown state skips the work | silent green | workflows and scripts behind monitors and deploys |
| Q7 Context read at completion | 375: an edit saved under the client on screen when the save finished | global read after an await | wrong-target write | every async flow outside the Sentinel-covered ones |
| Q8 Refusal inside a 200 | 375: `{ok:false}` with 200 counted as saved | status checked, body not | soft refusal | every caller of a function that answers 200 not-ok |
| Q9 Paged read without total order | 376: Today paged 1,000 rows by nothing | ties straddle a page | unstable pagination | page, functions, scripts |
| Q10 Date-only read as UTC midnight | 383: "date has passed" on the evening of the day | `new Date('YYYY-MM-DD')` | time zone | every date-only parse shown to people |
| Q12 Character class missing a member | 384: "&" in a slug fell through the route check | allowlist narrower than the minting rule | allowlist gap | slug checks and normalisers in page and functions |
| Q13 Merge drops a fix | 2026-10-09: a merge dropped the comment-round reader fix | conflict resolution | regression by merge | every window fix, by running its guard |
| Q14 Growth hits a hard limit | 382: the identity check joined 551 MB | unbounded retained bundles | capacity | the published site size |
| Q16 Cap before scope | 370: TikTok refreshed only the newest 100 rows | limit applied before the filter | starvation | new functions since 2026-10-02 |
| Q17 In-flight guard returns nothing | 371: a second pick silently dropped and toasted | undefined read as done | silent no-op | other in-flight helpers |

Two patterns were new this run and got their own mini-sweep in cycle 2:
**R1 startup call into a file not yet loaded** (from the Kasper crash) and
**R2 a fix applied to one twin only** (from the credentials dialog and the
Samples notes).

## Survivors

| # | Finding | Evidence | Guard (fails on the old code) | PR |
|---|---|---|---|---|
| 1 | 30 offline browser regression tests ran in no workflow; 9 failed on main | ran all 30 locally on `1be8547` | `test/browser-guards-wired.js` (lists all 30 on the old tree) | 405 |
| 2 | A fresh `/kasper/<subtab>` crashed boot when the staff check beat the later script files (since #1848): "Could not load data … _kasperResolveSubtab is not defined", and, once that was fixed, "KASPER_SUBTABS is not defined" (its list is in a third file) | reproduced deterministically with the later files held 1.5 s, together and one at a time | `test/kasper-deep-link-split-race-browser.js`; `test/clean-urls-browser.js` now passes | 405 |
| 3 | Credentials dialog closed while A's list loaded, reopened for B: B showed A's logins, and Edit moved A's login to B | real browser, real page | `test/credentials-modal-client-switch-browser.js` part 1 | 404 |
| 4 | Credentials Edit, Reveal and Copy read the Kasper store's older copy (the 2026-08-22 fix reached Mark reviewed only): an old password copied, and saved back | real browser | same test, part 2 | 404 |
| 5 | Instagram: a client change during a Calendar thumbnail copy made A's thumbnail B's Reel cover; A's card caption stayed | real browser | `test/instagram-cover-client-switch-browser.js` | 404 |
| 6 | Kasper's typed note or change request on a Sample vanished from thread and box when the save was refused before it committed (four roads) | real functions from the built page | fixed by #2037 (its guards in `test/kasper-never-lose-decision.js`) | #2037 |
| 7 | Analytics "This week" views on the 1st of a month: a large negative number in the team's zone | real function, TZ America/Guatemala (old: -491,000) | `test/date-only-team-zone.js` A | 404 |
| 8 | Kasper Ads panel showed lead dates a day early | same (old: Oct 7 for Oct 8) | `test/date-only-team-zone.js` B | 404 |
| 9 | TikTok: an unreadable switch with nothing saved sent uploads to the n8n webhooks switched off 2026-10-08 | real function | `test/tiktok-source-unknown-default.js` | 404 |
| 10 | The client whose slug has "&" never found its Brain folder ("-and-"): empty Brain panel, captions and thumbnail titles without its voice | live: its title prompt is seeded `generic:no_brain_folder`; local brain checkout | fixed by #2033 | #2033 |
| 11 | Instagram looked a client up by the squashed display name; 2 active clients would be refused once they have an account | live count | `test/instagram-upload-source.js` | 398 |
| 12 | Pages: one failed read of the Pages source skipped the live deploy with a green run | the workflow's own shell under a stand-in `gh` | `test/pages-deploy-source-unreadable.js` | 398 |
| 13 | Name check: an empty roster read (rows hidden from the publishable key) passed every diff with no warning | code | pin in `test/repo-identity-exposure.js` | 398 |
| 14 | Drift robot paged 16,419 cards by an id 43 rows share | live counts | pin in `test/card-calendar-status-drift-check.js` | 398 |
| 15 | TikTok: a create Post For Me may have taken (HTTP 200 not-ok after a timeout) dropped its key, so Submit again could post twice (cycle 2, twin of the Instagram rule) | code + the function's own answer shape | `test/tiktok-create-keeps-key.js` | 404 |
| 16 | Samples Notes Mark done / Reopen on a linked sample lacked the Calendar twin's busy and thread-ready guard (cycle 2) | real functions | `test/samples-notes-lifecycle-busy.js` | 404 |
| 17 | Instagram Cancel trusted its own "scheduled" row and marked a post cancelled after a 2xx or 404 with no read-back (cycle 2, twin of the TikTok cancel) | code | cases in `test/instagram-upload-source.js` | 398 |
| 18 | A SyncLinear comment restored after a reload mid-send minted a new request id and could post twice (cycle 3) | real functions; server derives the comment id from the request id | `test/prod-comment-restored-request-id.js` | 404 |
| 19 | Higgsfield recorded a gateway 5xx or a missing job id as refused, outside the duplicate check and the budget: a retry could pay for a second job (cycle 3) | code | `test/higgsfield-create-unconfirmed.js` | 398 |
| 20 | Six stale guards (beacon helpers, TikTok selector, rename mock, dialog inventory, client review on phones, refresh timing) | each run before and after | the guards themselves, now in CI | 405 |

## Confirmed, not fixed here (owner one-liners)

- **Retry queue has no ceiling (Q2, the 382 mechanism, still open).** A replay
  that keeps failing is resent every minute with nothing shown to the person;
  a status that needs an explicit reapply throws 409 forever and blocks later
  replays. A cap could drop a save that would later succeed (the 2026-10-08
  reply did save once the server was fixed). Proposal: back off per row (up to
  an hour) and, after a few deterministic refusals, tell the person and keep the
  text. *Owner: back off and tell after N refusals, yes or no?*
- **Server answers 500 for data errors** (check, not-null, foreign key, bad
  value) in production-write and the two upsert functions, which the page then
  retries. Needs a Section 4 deploy. *Owner: next Section 4 change?*
- **The daily roster sync still switches clients on and off from the Clients
  Info tab**, which is now a copy the database writes. A failed copy or a hand
  edit on the tab (not yet protected) would switch a client. No flip since
  2026-09-27. *Owner: should it read the database now?*
- **The published site is 653 MB and grows about 40 MB a day** (old split
  bundles; GitHub supports 1 GB). `scripts/prune-split-js.js` exists and has
  never run. *Owner: how many old bundles to keep?*
- **Duplicates after an ambiguous answer, needing a server key or n8n** (cycle 3): a time-off request answered 504 after it was saved can be sent again (no request id on `pto_create_request_v1`); the Kasper urgent ping via n8n says "Try again" after an answer that never came, and the flow has no dedupe; Create Post's "Discard" says nothing was created when only the local copy knows (a 5xx may have committed it); the sales intake "Create agreement" abort says "Nothing was lost" (server side already F106/F107). *Owner: give these sends request ids?*
- **Samples twins still missing** (cycle 2): a status the gateway committed followed by a failed card save shows "Save failed" (Calendar shows "Saved, syncing" and heals); the client link's Samples Approve has no durable send queue (Calendar has one); a Samples note restored after a reload mid-send can be sent twice. Each is a port of a larger Calendar mechanism.
- Latent, recorded only: `smm-weekly-reports` `sync_managers` has no authority
  check (needs an old n8n version restored to fire); the alert digest reads
  only `event=schedule` runs (matters once the database timer and the digest
  are both on); Instagram's list refresh looks at the newest 100 rows (2 rows
  today); Workload, after a failed snapshot with a cached board, says
  "deadline fallback" but leaves cards on their automatic day.

## Seen ledger

**Refuted or pruned, with the reason.** Q13: every window fix with a unit
guard still holds on main (13 suites pass). Q5: CRLF in the repository is
deliberate and pinned. R1: all 281 clean addresses pass with every later
script held back (no other startup-order crash). A second probe holds each later file back alone, with the staff check answered after the files before it: 30 app addresses, as admin and as SMM, 240 loads, all clean on the fix (the same probe flags the four Kasper sub-tab addresses on the first version of the fix). C3 (onboarding n8n answering
200 not-ok): the saved workflow responds ok only. D2 and D5 (Ads 1,000-row and
weekly-report caps): live counts 188 and 56 rows, far below. F3 (Calendar link
move): reachable only on a Linear-owned team. Low or display-only, pruned:
share-link toast, Filming plans and Templates repaints over another tab, hiring
status message, scroll preference, reorder of a restored card, hook library
"Saved", ad-performance tooltips, Kasper events paging, analytics shadow
collectors (paused), reorder null-as-0 (the page sends numbers), the "&"
checks in archive repair and the notify preview (owner-only tools).

**Undecidable without access.** The sales intake n8n workflow's failure
branch: n8n was out of scope for this run, so whether it can answer 200 with
`ok:false` was not read.

**Not wired, with a reason in the meta test.** `workload-board-browser` and
`workload-render-browser` (their harness still serves the reads retired in
#1391), `b4-staff-login` (keyboard checks predate the menu rework).

## Per-cycle self-supervision

**Cycle 1.** Goal: siblings of the 2026-10-02 to 10-10 incidents. Six parallel
sweeps (Q1/Q2, Q7, Q8/Q17, Q9/Q16, Q10/Q12, Q3/Q4/Q6) and my own checks of Q4,
Q5, Q13 and Q14 produced about 70 candidates. Every survivor was reproduced on
the old code (real browser or the real function from the built page) before a
fix. Running the never-run guards found the Kasper crash.

**Cycle 2.** Goal unchanged. Cycle 1 cost about six sweeps and three
diagnoses and yielded fourteen fixes. R1 (startup call into a file not yet
loaded): all 281 clean addresses pass with every later split file held back,
so the Kasper crash had no sibling. R2 (fix on one twin only): eight
candidates, three confirmed and fixed (TikTok key, Instagram Cancel, Samples
Notes), three reported as larger ports, one refuted by a live count (Kasper's
14-day events: 408 rows, one page). An independent skeptical review of every
cycle 1 fix found no regression and five gaps, all closed (the Pages retry
missed `gh` printing an error body; the drift re-check matched by id alone;
a boot exit skipped its error handler; a non-numeric floor override; the
Analytics fallback counted 8 days). One review point was declined with a
reason: treating an empty TikTok switch row as "no answer" would rewrite nine
mocked tests for a case that needs the live row deleted.

**Cycle 3.** Goal unchanged. New pattern from cycle 2: an ambiguous answer to
a create or a cancel treated as final. Eight candidates: two confirmed and
fixed (SyncLinear restored comment, Higgsfield unconfirmed create), four
reported because they need a server key or n8n, two low (wording).

**Process critique (cycle 3 rule).** The sweeps over-produced low-impact
display candidates (Q7 especially); the findings that mattered came from
running existing guards and from live counts, which were cheap. Scoring live
counts earlier would have pruned D2 and D5 at once. No permanent change to the
skill is applied; proposed to the owner: "run every offline browser test once
at the start of an archaeology run".

**Cycle 4.** Goal unchanged. Running the refresh-skeleton guard ten times
showed 2 failures, both the Kasper crash by a second road (its list,
`KASPER_SUBTABS`, is in a third split file): confirmed and fixed in 405, and
the guard now holds each later file back alone. The sweep (saved drafts
that lose their send identity, paid answers read as refusals) returned six
candidates; one duplicates row 15. Not yet verified when the owner re-scoped
the session to fixing #2038 and #2039, so none is a finding:
C4-1 a Calendar Notes reply restored after a reload can be sent twice (the
root-note fix never reached replies); C4-3 TikTok's Retry after an
ambiguous create posts again without looking for the first post; C4-4
Instagram's create treats a failed earlier-attempt lookup as "no earlier
post"; C4-5 and C4-6 the analytics and market-research collectors give back
an attempt after paid scraper work (dormant while analytics are paused).
The stop rule was not reached: the loop stopped at the owner's request
after cycle 4's sweep.

## Verification boundary

Local runs only (Node 22, Playwright 1.56.1, Chromium 141). Hosted CI on each
pull request is the proof for the new CI job. Nothing touched a live write;
the Brain, Instagram and title fixes need the owner's single-function deploys
(listed in entry 398).
