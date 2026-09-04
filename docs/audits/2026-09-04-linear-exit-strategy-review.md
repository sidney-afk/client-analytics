# Linear exit strategy: review of the 2026-09-03 set, and the spine it was missing

Status: review and planning. Analysis only. This document changes no production
behaviour, data, runtime flag, Edge Function, n8n workflow, client link, or
credential.

---

## ⚠ PROVENANCE — two separate bodies of work, do not read them as one

**This document is a SECOND-OPINION REVIEW layered ON TOP of someone else's
strategy. It is not part of that strategy, and its author did not write it.**

| | The reviewed set | This review |
|---|---|---|
| **Author** | Codex session, 2026-09-03 | Claude Code session, 2026-09-04 |
| **Files** | `2026-09-03-synclinear-linear-exit-strategy.md`, `-deep-dive.md`, `-closure-ledger.md` | `2026-09-04-linear-exit-strategy-review.md` (this file) |
| **Shipped as** | PR #1257 (draft) | branch `claude/linear-exit-strategy-7wirkw` |
| **Commits** | authored 2026-09-03, no `Co-Authored-By: Claude` trailer | carry `Co-Authored-By: Claude Opus 5` |

**The three 2026-09-03 documents in this branch are byte-identical to PR #1257.
Not one line of them was edited, rewritten, corrected in place, or merged with
this review.** They were merged into this branch unchanged so that the owner can
read the original and the review side by side in one place. Where this review
disagrees with them, it says so here, in its own file, under its own date, and
never by altering their text.

Everything asserted in this file is the reviewer's, including its verification
results, its corrections, its B5 staging, and its recommendation in §3. Nothing in
it should be attributed to the 2026-09-03 authors, and nothing in the 2026-09-03
set should be attributed to this reviewer.

**Two files outside `docs/audits/` were also changed by this review, and both
carry their own dated attribution block naming this document:**
`docs/independence/GO_LIVE_CHECKLIST.md` (a factual correction to its live-state
table, see §2.2) and `docs/ops/OPEN_REPAIRS.md` (ledger item 144). Those edits are
the reviewer's, not the 2026-09-03 authors'.

---

Reviewed set, as merged here unchanged:

* [strategy](2026-09-03-synclinear-linear-exit-strategy.md) (427 lines)
* [deep-dive addendum](2026-09-03-synclinear-linear-exit-deep-dive.md) (352 lines)
* [closure ledger](2026-09-03-synclinear-linear-exit-closure-ledger.md) (172 lines)

Review base: `c59c962` (`origin/main`, 2026-09-04). The reviewed set was written
against `00d0e888`, which `main` has since moved past.

---

## Verdict

**The analysis is right. The strategy is not yet usable.**

The central conclusion, that Linear cannot be switched off and that native
authority does not prove client continuity, is correct, and I re-verified its
three load-bearing claims independently below. The epistemic discipline is the
best thing in the set: `SOURCE-REACHABLE` versus `DEPLOYMENT-UNPROVEN`, and the
rule that a protected-table `401` means unproven rather than empty, are exactly
the right instincts for this system, and they are what the reverted PR 1248
attempt lacked.

Three things stop it being a strategy:

1. It is a **fifth parallel plan**. This repository already has an owner-ratified,
   owner-facing exit sequence: `docs/independence/GO_LIVE_CHECKLIST.md` Phase 5
   ("B5: retire Linear"), backed by `TRACK_B_LINEAR_REPLACEMENT_SPEC.md` §13 and
   executed through `docs/ops/FLIP_RUNBOOK.md`. The reviewed set never opens any
   of them. It therefore neither supersedes nor extends the ratified sequence; it
   sits beside it, silently competing with it.
2. It carries **35 gates across four numbering schemes** (Steps 0 to 9, D0 to D7,
   E0 to E9 plus E0a, C0 to C5) with no crosswalk, and the closure ledger says the
   order "remains D0--D7 and E0--E9", which is two orders, not one. There is no
   single first action anywhere in 951 lines.
3. It **conflates live bugs with exit prerequisites**. Its best find is a client
   bug that is hurting clients today and has nothing to do with Linear. Filing it
   as gate D1 of a 35-gate programme delays a one-hour fix behind a multi-month
   one.

This review supplies the missing spine, the crosswalk, the corrections, and the
first action. It keeps the reviewed set's findings intact; almost all of them are
good.

---

## 1. What I re-verified independently

I did not take the audit's evidence on trust. Everything below is a fresh check
made on 2026-09-04 against `origin/main` and, where noted, the live backend read
through the published browser key.

| Claim under test | Method | Result |
|---|---|---|
| Samples legacy read fallback can render a false empty success | Read `_sxrFetchPosts` at the audited base and on current `main` | **CONFIRMED, and still live.** The fallback does `const j = await resp.json(); return { ok: true, posts: (j && (j.items \|\| j.samples \|\| j.posts)) \|\| [] };` with no `resp.ok` check and no envelope validation. |
| The Calendar twin already guards against exactly this | Read `_calV2FetchPosts` | **CONFIRMED.** It throws on `!resp.ok`, on an unusable payload, and on a zero-row payload, with a 16-line comment citing OPEN_REPAIRS item 86. The two readers sit ~26,000 lines apart in one file. |
| A failed routing-flag read routes client writes to the legacy Linear lane | Read `_calFetchUpsertFlagOnce` and `_writeUiFetchRerouteFlagOnce` | **CONFIRMED, and it is deliberate.** The catch block sets an empty roster and the in-code comment reads "fail-legacy, never fail-open". |
| `production-write` validates a Linear project before its first native intake write | Read the intake path | **CONFIRMED.** The source comment above `projectForIntake` reads "This read-only validation happens before the first native row write." |
| Live flag posture: both teams SyncView-authoritative, outbound live, full cohorts | Live read of `syncview_runtime_flags` on 2026-09-04 | **CONFIRMED.** `prod_authority = {video: syncview, graphics: syncview}`, `linear_outbound_enabled = {mode: live}`, `linear_inbound_enabled` / `linear_legacy_parity_enabled` / `client_comment_gateway_enabled` all enabled, `auth_enforcement = permissive`, and all three client rosters at 43 entries with identical membership. |
| Every script the set cites actually exists on `main` | `git cat-file` over all nine | **CONFIRMED.** None are inventions of the audit branch. |
| The line citations still resolve | Spot-check of cited ranges against `main` | **FAILED.** See §2.4. |

That is a good verification rate. The audit's factual core holds up.

---

## 2. Corrections

### 2.1 The set does not reconcile with the repository's own exit programme

`docs/independence/` already contains: `INDEPENDENCE_PLAN.md`,
`TRACK_B_LINEAR_REPLACEMENT_SPEC.md` (1,817 lines), `GO_LIVE_CHECKLIST.md`
(1,066 lines), `LINEAR_CUTOVER_TOUCHPOINT_INVENTORY.md` (562 lines),
`CUTOVER_AUDIT_2026-07-13.md`, `SAMPLES_LEGACY_REMOVAL_MAP.md`, and
`PHASE0_AUDIT_2026-07-28.md`. `GO_LIVE_CHECKLIST.md` describes itself as "the
single canonical, owner-facing sequence", says "this sequence supersedes all
earlier flip orderings (audit F17)", and its Phase 5 is titled "B5: retire
Linear" and already carries ten owner-ratified retirement gates (F32/F61,
F58/F61/F92, F62/F68, F103, F104, F125, F126, F34, F60, and the F26 note that
retiring Linear does not retire n8n).

The reviewed set cites `docs/independence/SYSTEM_MAP.md` four times and none of
the above. The consequence is not academic: several of its E-gates restate a
ratified Phase 5 gate under a new name. E7's "egress poison in every restore
runbook" is F60's "each teardown action has a proved inverse" plus the restore
concern. E8 is largely F34. E5's "provider-admin census before disabling the
account" is the B1 stray-catcher problem that
`docs/ops/B1_STRAY_CATCHER_DESIGN.md` already owns.

**Correction:** the exit plan is not new work. It is Phase 5 of an existing,
ratified programme, and it should be written inside that programme. §4 does this.

### 2.2 `GO_LIVE_CHECKLIST.md`'s live-state table is stale in the dangerous direction

This is the most consequential thing neither the audit nor the previous attempt
caught, and I only found it because the audit's live snapshot disagreed with the
checklist.

`GO_LIVE_CHECKLIST.md` carries a table headed **"Current state (update when flags
move)"**. As of this review it said:

| Flag | Table said | Actually live, read 2026-09-04 |
|---|---|---|
| `prod_authority` | `{video: linear, graphics: linear}`, "Both teams still run on Linear" | `{video: syncview, graphics: syncview}` |
| `linear_outbound_enabled` | `off`, "No mirroring back to Linear" | `{mode: live}` |
| `write_ui_reroute_clients` | "last verified live TEST-only allowlist" | full roster, 43 clients |

The prose under the table said "The reroute cohort was last verified TEST-only;
no real-client enrollment is authorized by the merge or deployment." Enrollment
wave 3 put the full roster on the lane on 2026-08-14; graphics flipped
2026-08-16 and video 2026-08-28.

So the document that calls itself the canonical owner-facing cutover sequence was
describing a pre-flip world in which Phases 2 and 4 had not happened. An owner
opening it to plan the exit would have read three false facts before reaching
Phase 5, which is the only phase that is actually current work.

**This is the third recorded instance of one fracture pattern in this repository:
a hand-maintained live-state row decaying silently in the direction that makes an
incident worse.**

* First instance: `ROLLBACK.md`'s "what is live" row, found stale twice, once
  eleven deploys behind. Fixed by a machine check, `scripts/rollback-row-freshness-check.js`
  (OPEN_REPAIRS 118 and 137), whose header says outright that "a written rule has
  now failed twice, which is the argument for a derivable check rather than a
  third reminder."
* Second instance: `docs/truth/BRIEFING.md`, corrected by hand on 2026-08-25 with
  the note "the text that stood here described the pre-flip world, and was wrong
  in the dangerous direction: it said writes were off when they are on."
* Third instance: this one. Unguarded, and still wrong until this branch.

`docs/ops/PRE_FLIP_HEALTH_CHECK.md` item 4 and `ROLLBACK.md` row 139 are both
current and correct, so the repository does hold the right values. The defect is
that the checklist is not derived from them and nothing checks that it agrees.

**Correction applied in this branch:** the table and its following paragraph are
updated to the live values, with the correction dated and evidenced in place. No
gate checkbox was touched. The durable fix is a freshness check, modelled on
`scripts/rollback-row-freshness-check.js`, that compares every hand-written
live-flag claim in `GO_LIVE_CHECKLIST.md`, `ROLLBACK.md`, `BRIEFING.md`, and
`PRE_FLIP_HEALTH_CHECK.md` against one another and fails when they disagree. That
is proposed, not built, in §7.

### 2.3 The Samples false-empty is a live bug today, not an exit gate

The deep-dive correctly calls this P0 and correctly identifies it as the most
client-damaging thing it found. It then files it as gate D1 of the exit
programme, which is the wrong home for it.

The bug does not need Linear to fire. It fires whenever the primary Supabase read
throws and the n8n fallback answers with anything other than the exact expected
shape. OPEN_REPAIRS item 86 measured precisely that happening: `calendar-get`
answered HTTP 200 with a zero-byte body for two live clients holding 32 and 17
non-archived rows, and `{"ok":true,"posts":[]}` for a third holding 24. The cause
is a Google Sheets node with no error branch in a workflow that must not be
edited without the owner. That cause is still live and it is shared: the Samples
fallback resolves the same class of legacy Sheets-backed endpoint.

Item 86 enumerated "three unsafe handling sites, one shared assumption" and fixed
two of them. It missed the fourth site. `_sxrFetchPosts` is a straight twin-drift
instance, which is the pattern OPEN_REPAIRS 139 shipped a watcher for after "a
written prediction failed three times."

**Correction:** this belongs in the fix-now lane (§7), as a repair of item 86, not
in the exit programme. The fix is small and the pattern to copy is already in the
file, 26,000 lines up.

### 2.4 The citations have already rotted

The set pins every citation to `00d0e888` and cites by line number only.
`index.html` has moved roughly 294 lines since. Spot-checking the deep-dive's
headline citation, `index.html:60922-60938`, against current `main` lands in a
localStorage cache writer, not the Samples fallback. The claim is true; the
pointer is not.

For a document set whose entire value is its citations, and in a repository whose
tests string-extract from `index.html` by symbol, citing by line alone guarantees
the evidence becomes unfollowable within days.

**Correction:** cite the symbol first and the line second, for example
`_sxrFetchPosts (index.html:61017 at c59c962)`. Symbols in this file are stable;
line numbers are not. Applied in this review throughout.

### 2.5 No ledger entry

`docs/ops/OPEN_REPAIRS.md` is the ledger the owner reads. PR #1257 updates
`REPO_MAP.md` but adds no ledger entry, so a 951-line audit that identifies a
live client P0 is invisible to the repository's own process. Added as item 144 in
this branch.

---

## 3. The strategic gap: one decision was presented where there are three

Every document in the set treats the exit as a single binary event with an
irreversible tail, and then spends most of its length managing that
irreversibility. That framing creates the problem it then works so hard to
mitigate.

There are three decisions here, and they separate cleanly:

| Decision | What it is | Reversible? | What it costs |
|---|---|---|---|
| **A. Stop depending on Linear** | No client or staff action, read, or background job needs Linear to be reachable. Outbound stops, inbound stops, the last provider call disappears. | Yes, entirely. Flags and adapters both ways while the workspace exists. | The engineering programme. This is the real work. |
| **B. Stop paying for Linear** | Drop to the free tier or one seat. The workspace, its issues, comments, attachments, and export API stay reachable. | Yes, by re-upgrading. | Nearly nothing, once A is done. |
| **C. Delete the Linear workspace** | Cancellation and deletion. Export, attachment bytes, comment history, and audit trail become permanently unavailable after the documented window. | **No.** | Nothing. It saves no money that B did not already save. |

The reviewed set collapses A, B, and C into one event, which is why its archive
requirements are so heavy: it has to prove that the private Exit Archive is
byte-complete and cursor-complete *before* the flip, because after the flip Linear
is gone.

**Decouple them and that requirement mostly dissolves.** If the workspace stays
alive read-only for a defined window after A, then:

* The Exit Archive stops being a gate on the cutover and becomes a soak activity
  that runs against a stable, no-longer-changing source. Exporting a frozen
  workspace is strictly easier than exporting a live one, and a delta reconcile
  against a frozen source is trivial rather than racy.
* Every "irreversible boundary" in the strategy, the whole of D5/E8 and most of
  E7, moves from blocking to non-blocking.
* Attachment rescue (F34) gets a second and third attempt instead of one.
* If a historical gap surfaces three weeks later, the answer is "go and look"
  rather than "it is gone".
* The provider-admin census (E5, E7) gets to be an observation period rather than
  a pre-flip proof, because strays land somewhere still visible.

The cost of that option is one cheap seat for a few months. The reviewed set
never names it. It is the single largest risk reduction available on this
programme and it is missing from all three documents.

**Recommendation: commit to A. Schedule B immediately after A's soak. Put C behind
its own dated owner decision, no earlier than the end of the archive-retrieval
window, and treat it as a separate change with its own checklist.** That is also
consistent with Phase 5's existing F60 rule ("prefer deactivate/archive; never
delete a webhook/workflow graph or rotate a credential under a generic
reversibility claim").

One caveat the owner should weigh: Linear's free tier caps issue count and
history retention, so "free tier" may not preserve everything. Confirm the exact
tier behaviour against the current Linear plan before choosing between free-tier
and one-paid-seat; one paid seat is the safe default.

---

## 4. The spine: B5.0 to B5.5

This replaces four numbering schemes with one, and it extends the repository's own
Track B naming rather than inventing a sixth. `GO_LIVE_CHECKLIST.md` Phase 5 is
"B5: retire Linear". These are its stages.

The ordering rule is the reviewed set's, and it is correct: **a later stage may
never compensate for a missing earlier client-safety guarantee.**

| Stage | Name | Question it answers | Exit condition |
|---|---|---|---|
| **B5.0** | Serving baseline | What is actually deployed and live, as opposed to what is in `main`? | Every client-critical Edge Function has a serving fingerprint, an auth posture, and a deploy receipt. Every hand-written live-state claim in the repo agrees with the live flags. |
| **B5.1** | Client continuity | Can any client action be lost, silently localised, or falsely emptied, on any supported page age? | No client read can produce a false empty success. Every offered client action yields one durable native receipt or one visible native pending state, under every fault shape, on fresh and held-prior bundles. No failure path selects a provider endpoint. |
| **B5.2** | Native semantics | Does a successful write have a place to land? | Creation, linkage, comment threads, lifecycle/archive, and card materialization are native facts with owners. Zero actionable half-linked components. Production create stays closed; sub-issue creation stays Calendar-only. |
| **B5.3** | Staff surfaces | Can staff do their jobs with Linear unreachable? | Workload reader, plan identity, due writes, tweak reads, and deep links are native. Submit picker, labels, and assignee eligibility are native. Visibility check exits zero. |
| **B5.4** | Archive | Is anything only in Linear? | Cursor-complete export, asset bytes rescued or dispositioned, retrieval rehearsal passes with provider egress blocked. **Under §3 this is a soak activity, not a flip gate.** |
| **B5.5** | Teardown | Is anything still calling, or able to call, Linear? | Every trigger root has a provider-free disposition. Zero egress across scheduled, manual, cached, and restore paths for the agreed horizon. Then decision B. Then, separately and later, decision C. |

Client continuity (B5.1) is the only stage with a hard client invariant, and it is
the only one that cannot be soaked away. Everything else can be run long.

## 5. Crosswalk

Every gate in the reviewed set, mapped. Nothing is discarded.

| B5 stage | Strategy | Deep dive D | Deep dive E | Ledger C | Existing ratified gates |
|---|---|---|---|---|---|
| **B5.0** | Step 0 | D0 | E0, E0a | C0 | `PRE_FLIP_HEALTH_CHECK.md` item 4; `EF_DEPLOY_MANIFEST.md`; F51 |
| **B5.1** | Steps 1, 2 | D1, D2 | E1, E2 | C1 | F125 (Calendar recovery never splits read and write authority); F67 |
| **B5.2** | Steps 3, 4 | D3 | E3, E4 | C2 | F126 (sub-issue expansion complete before mutation); F50; F103 |
| **B5.3** | Steps 5, 6 | D4 | E5 | C2 | F40 (per-team workload authority); F104; `WORKLOAD_NATIVE_SOURCE.md` |
| **B5.4** | Step 7 | D5 | E8 | C4 | F34 (archive usable, assets rescued); F62/F68 |
| **B5.5** | Steps 8, 9 | D6, D7 | E7, E9 | C3, C5 | F32/F61, F58/F61/F92, F60, F26 |
| **Not in this programme** | (none) | (none) | E6 | (ledger §21) | Raw-read/RLS and link-auth modernization. The set correctly rules this out of scope; keep it out. |

Three observations from building the crosswalk:

1. **E6 is correctly excluded and should stay excluded.** Bundling an RLS or
   writer-auth change into the cutover is exactly how the two historical
   client-wide `401` outages happened (`ROLLBACK.md` row 140, `AGENTS.md:3-14`).
   The set is right to fence it off and right to say it is not required to revoke
   Linear credentials.
2. **D6 and E9 both describe monitoring-before-teardown.** They are the same gate.
   Merged into B5.5.
3. **Steps 1 and D2 and E2 are three passes at one thing:** an action receipt that
   survives faults. That is B5.1's whole content and it is the largest single
   piece of engineering in the programme.

---

## 6. B5.0: the first action, concretely

The reviewed set ends every path at "an owner-authorized private preflight" and
never says what that is. This is it. It is read-only, it changes nothing, and it
is the only thing blocking every other stage.

**Owner runs, or authorizes someone to run:**

1. **Flag readback.** Read `syncview_runtime_flags` live and record all values
   with a timestamp. (I did this on 2026-09-04; the values are in §1. Re-read
   before any action, per the standing rule.)
2. **Serving fingerprints.** For each of `calendar-upsert`, `sample-review-upsert`,
   `client-token-verify`, `production-write`, `production-comments`,
   `production-archive`, `linear-inbound`, `linear-outbound`, `workload-linear`,
   `workload-plan`: the deployed version number and the deploy receipt. Most come
   from `EXECUTION_LOG.md` and the F27 Section 4 receipts; the no-CI ones need a
   Supabase dashboard read. **The single most important row is whether the two
   frozen client writers are still open and tokenless**, because `main` source
   imports a credential-required helper and the live contract must not have it.
3. **Protected aggregates.** One privileged read, counts and ages only, of:
   `mirror_outbox` by state and operation with oldest-pending age;
   `production_comments` total and canonical coverage; `workload_plan` key shape;
   intake receipts; archive rows. Anonymous RLS returned `401` for all of these,
   which the set correctly refused to read as zero.
4. **n8n published-graph export.** Read-only. Version and active trigger-to-sink
   path for each workflow named in the strategy's Phase 1 map. No edits.
5. **Provider-admin inventory.** Linear workspace: API keys, OAuth apps, personal
   tokens, webhooks, automations, member-connected integrations, and the current
   plan tier and its export/retention terms. This is also the input to the
   decision in §3.

**Output:** one private document, aggregate only, no slugs, no tokens, no bodies.
Everything after this stage reads from it.

**What it costs:** an afternoon. It is not a programme.

Nothing in stages B5.1 to B5.5 can be sequenced or estimated until this exists,
which is why 951 lines of planning currently bottom out at the same place.

---

## 7. The fix-now lane: things that are bugs today

These are not exit work. They are live defects the audit found on its way past.
They should ship on their own, ahead of and independent of the exit programme.

| # | Defect | Why now | Shape of the fix |
|---|---|---|---|
| 1 | **`_sxrFetchPosts` can render and cache a false empty Samples board.** No `resp.ok` check, no envelope validation, `ok: true` with `posts: []` for any wrong-shaped payload. | Fires today whenever the primary read throws and the legacy endpoint misbehaves, which OPEN_REPAIRS 86 measured happening to three live clients. A client sees "no samples" instead of their content. | Copy the ratified `_calV2FetchPosts` guard: throw on `!resp.ok`, on an unusable envelope, and on zero rows; let `loadSxrCards` keep last-good cards and show the stale notice. Add a twin-parity test beside `test/comment-family-twin-parity.js`. |
| 2 | **`GO_LIVE_CHECKLIST.md`'s live-state table was wrong on three of six rows.** | An owner planning the exit reads it first. Corrected in this branch; the recurrence is what needs fixing. | A derived freshness check over every hand-written live-flag claim in `GO_LIVE_CHECKLIST.md`, `ROLLBACK.md`, `BRIEFING.md`, and `PRE_FLIP_HEALTH_CHECK.md`, failing when they disagree. Model: `scripts/rollback-row-freshness-check.js`. |
| 3 | **Four duplicate `## N.` headers in `OPEN_REPAIRS.md`** (13, 14, 22, 23). | `CLAUDE.md` names this as the thing to check after every merge. It is pre-existing, not from this work. | Renumber the later duplicates and note the moves. Cheap, and the ledger is the owner's primary surface. |

Item 1 is the one that matters. It is a client-facing data-loss-shaped bug with a
ratified fix pattern already in the same file, and the exit programme should not
be its blocker.

---

## 8. What this review did not establish

Stated plainly, in the set's own vocabulary, because the same discipline applies
to me.

* I did not fingerprint any deployed Edge Function. Every `DEPLOYMENT-UNPROVEN`
  label in the reviewed set stands, including for the two frozen client writers.
* I did not read any protected table. The set's protected-state unknowns stand.
* I did not execute a client action, a fault injection, or a provider-denied test.
* I did not re-derive the set's live aggregate counts (587 component slots, 197
  legacy-link-without-native slots, 21 and 14 invisible Workload rows, 20
  one-way comment slots, 5,173 of 5,176 Workload rows with a provider URL). I
  verified the scripts that produce them exist and are read-only; I did not run
  them. Those numbers remain the set's, at its timestamps.
* I did not inspect n8n, and I did not verify the strategy's published-graph map.
* The §3 recommendation depends on Linear's current plan and export terms, which
  I did not read. Confirm before acting on it.

The status the set assigns is unchanged and correct: **not ready for Linear
shutdown.** What changes is that there is now one ordered path, one first action,
and three separable decisions instead of one irreversible event.
