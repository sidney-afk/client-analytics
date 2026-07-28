# Phase 0 audit — 2026-07-28

**What this is.** A full pass over every unchecked Phase 0 / 0.5 / 0.75 box in
`GO_LIVE_CHECKLIST.md`, classifying each against what is actually live today. Run because the
checklist read "115 unchecked" while this week's work had discharged several without ticking them,
and the owner needs a real number to plan against, not an unknown.

**Method.** Every box read in full; verdicts drawn from live reads (flags, rosters, reconcile
summaries, EF probes — all with the anon key), the drill evidence of runs #13–#18, EXECUTION_LOG,
and merged-PR history. Items verified live today are marked; items whose verdict rests on the
checklist's own dated evidence are taken at face value and say so.

---

## Headline

| Bucket | Count | Meaning |
|---|---|---|
| **A. Closed by this week's evidence** (ticked today) | **5** | F37, F94, F136, F95, and the entity-write fence — all proven by drill runs #17/#18 |
| **B. Closeable with a tick** — evidence exists, box stale | **~6** | listed below; each needs only the evidence line written in |
| **C. Mechanical minimum for flipping Graphics** | **~12** | the true critical path; build + prove work |
| **D. Security containment, open regardless of flip** | **~18** | P0 exposures that exist today with Linear as boss; flipping neither causes nor cures them |
| **E. Prove/QA gates** — mostly implemented, undrilled | **~55** | deployed behaviour whose named test/drill has not run |
| **F. Owner-decision-only** — an answer, not a build | **~15** | each is one recorded choice |

The buckets overlap the checklist's own grouping, not each other; a few boxes carry both an owner
question and a drill and are counted where the *blocking* half lives.

---

## A. Closed today (ticked in the checklist with evidence)

- **F37** identity, **F94** eligible assignment + stale picker, **F136** 13×13 matrix,
  **F95** convergence — drill runs #17 (`196afb8`) and #18 (`c0faa84`) green end to end.
- **`production-write` entity writes** — the F27 write-authorization objects applied 2026-07-28
  (PR #970); runs #13–#18 completed entity writes.

## B. Closeable with a tick (evidence exists; write it in and close)

1. **F44 intake acknowledgement** — the never-refuse fallback is live and proven by a real
   no-staff probe (202 `received`, retained receipt, unconditional staff DM; PR #966). Remaining
   sliver: the double-click / timeout drills named in the box, most of which
   `qa/probes/ot4_t1_submit_intake_guards.js` now exercises. Verify that mapping, then close.
2. **Phase 0.5 "passively observe one organic real-client save through the legacy path"** —
   observed continuously: real-client calendar/sample events flow daily through the legacy lane
   with zero failure-like events (checked again today: 278 + 300 events, 0 failures).
3. **D-8/D-30 overdue bump** — the fix-pack (#850) ported it per the owner's KEEP decision; the
   box itself says so. Needs only the tick.
4. **F82 filming-plan links, first half** — anon SELECT revoked (verified live 2026-07-27: anon
   read returns 401) and the protected Pages caller is merged. The private Google-sharing review
   remains the open half.
5. **F39 team-scoped comment reads** — implemented and live per the blocker-1-through-7 record;
   the box's own-team/cross-team negative tests are the residue.
6. **F124 CLIENTS METRICS half** — the box already records the live proof (29/29 receipts);
   TOP VIDEOS is the open half. Split the box or annotate it.

## C. Mechanical minimum to flip Graphics (the real critical path, in order)

1. **Mark-done comment regression** (new box, added today) — client-facing daily-work blocker,
   ~273 cards / 24 clients. A flipped team lives on exactly the failing path. Fix in flight.
2. **F27 install, both owner windows** (`F27_INSTALL_RUNBOOK.md`) — the one-click team rollback.
   Golden rule 3 calls it live-BLOCKED; flipping without the undo button violates the owner's
   founding requirement. The write-authorization subset applied 2026-07-28 is one piece of it,
   not the install.
3. **Outbound mirror armable** (F2 + F131/F132 receipts) — Phase 2 step 3 requires
   `linear_outbound_enabled → live` with correlated terminal drainer receipts and an observer
   outside n8n. Today's B1 silent-partial failures are direct evidence F131 is real and open.
4. **F55 authority vocabulary** — SOURCE COMPLETE 2026-07-28, one live re-apply owed: the backend
   `supabase` alias was removed from every source consumer, including both F27 SQL copies, before
   any `prod_authority` change. `2026-07-28-f27-write-authorization-only.sql` is the one copy that
   WAS applied live (2026-07-28), so its `create or replace` block must be re-pasted before the
   live function stops accepting the alias.
5. **`linear_project_ids` shape conversion** — 7 bare-string rows resolve to zero ids and refuse
   the first native create the moment a team flips. One reviewed data window.
6. **F56 preflight manifest + F63 paste-ready flag actions** — the machinery every flip step
   consumes; prose checkmarks cannot authorize a flip.
7. **Phase 0.75 auth enforcement** — F38 verifier deploy/readback, F89 exact-token roster proof
   (currently zero valid events in the window — not evidence), then the single F5 CAS
   `permissive → enforced` with the TEST denial matrix.
8. **Phase 1 parity soak** — arm F4, enroll 2-3 real clients in `write_ui_reroute_clients`,
   watch, then full roster ~1 week clean. This is calendar time, not build time.
9. **F50 one status authority to every reviewer** — flipped-team status must reach
   Calendar/Samples/Kasper/client readers; both-team TEST walks.
10. **F32 Linear-unavailability resilience** — native mutations must commit while Linear is down.
11. **F36 concurrency matrix residue** — the 409/compare/reapply drills beyond the initial
    collision.
12. **F07 first-write SLO receipt** — proven at flip time (Phase 2 step 6, hard stop).

## D. Security containment — open regardless of flip

F64 (public-repo hygiene/rewrite), F122 (public Actions artifacts), F118 (media rights),
F76/F77 (weekly-report + onboarding reader residue), F91 (public Linear mutation routes /
`?intake=1` contract), F106/F107/F115/F116 (sales intake auth + callbacks + two-of-two gate),
F123 (Project Central), F84 (credential vault), F85 (onboarding corpus reads), F86 (raw
directories), F87 (verifier resilience), F81 (capture abuse bounds), F48 (Editors reader),
F52 (title-provider credential incident), F129 (account-access values in Slack), F110/F111
(onboarding job truthfulness).

These are real, and most exist **today, with Linear as boss** — flipping Graphics neither causes
nor cures them. As ratified, the checklist blocks real-client enrollment on all of them. Whether
they stay pre-flip gates or become dated post-flip commitments is an **owner re-scope decision**
(see Recommendation), not something this audit can decide.

## E. Prove/QA gates — implemented, undrilled (largest bucket)

The client-entry family (F102/F117/F149/F150–F199) is furthest along: final cloud review completed
at `babbb2d`, several rows open "only through owner merge" — i.e. merge-pending, not build-pending.
The rest are named drills over deployed behaviour: F42/F43 comment-truth residue, F65, F73, F75,
F101 (with its owner half), F45, F11 sweep, F112, F133, F134, F135, F137, F138, F53, F54, F12,
F99/F100 (calendar/date), F96/F121/F130 (mobile/recovery), F29/F30, F40, F46, F127, F70,
F131/F132/F09/F66/F01 (monitoring/alerting family), F124 TOP VIDEOS half, F15/F47, F31, F41.
None is exotic; each is a bounded drill or census. The honest cost of this bucket is volume.

## F. Owner-decision-only

F88 (read-confidentiality model), F33 (token distribution), F101 (pairing semantics),
F99 (timezone contract), F109/F113 (approval-edit semantics), F119 (TikTok pilot), the F91
`?intake=1` shareability question, F94's §4 defaults ratification, F49 (egress/spend-cap answer),
F14 (D-9 roller acceptance), F24 (comms draft), F28 people questions inside F31/F85.
Each is a sentence from the owner, recorded. A single sitting clears most of this bucket.

---

## Recommendation (owner call, stated plainly)

**As written, the checklist is weeks-to-months of work** — bucket E alone is ~55 drills. The fast
path that stays honest has three parts:

1. **Do bucket C in order.** Items 1–7 are build/prove work (roughly 1–2 weeks of builder
   sessions at this week's pace); item 8 is ~1–2 weeks of calendar soak that overlaps everything
   else.
2. **One owner re-scope sitting.** Walk buckets D, E, F with this table; mark each item
   `pre-flip` / `post-flip by <date>` / `accepted risk`, and record it in the checklist. The
   checklist is owner-ratified, so only an explicit owner decision can narrow it — silently
   skipping items is how the mark-done regression shipped.
3. **Close bucket B and F cheaply.** Ticks and one-line answers; an afternoon.

With that, a realistic Graphics flip is **~2–3 weeks out**, dominated by the F27 install windows
and the parity soak — not by new feature work. Without the re-scope sitting, the honest answer
stays "months."
