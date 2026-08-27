# Pre-flip health check — canonical gating spec

The recurring read-only watch that runs while the graphics flip is pending.

**Why this file exists.** Until 2026-08-10 this spec lived only inside a
scheduled prompt. That is the same failure `OPEN_REPAIRS.md` was created to
fix: a rule nobody can diff, review, or correct except by re-typing it. It also
made the one amendment below impossible to record — the gate kept producing a
daily FAIL that the reader had to remember to discount, which is precisely the
alarm-fatigue mode the 2026-08-04 Slack work was undone by.

**The prompt swap is DONE — 2026-08-11 17:05Z.** The 2x-daily scheduled
health-check prompt (cron `0 13,1 * * *`) was replaced with a pointer to this
file, so this spec is now the single copy: the prompt no longer carries its own
membership lists, roster counts, or gating text, and the pre-canonical prompt's
false-FAIL modes (hard-coded wave-1 roster, shadow-audit gating, no F40 item)
are retired with it. Amend the check by editing THIS file.

**Before the VIDEO flip, read `FLIP_BUG_LEDGER.md` alongside this file.**
It records every defect the 2026-08-16 graphics flip produced in the four days
after it, and marks each one as recurring for video or not. Two items in THIS
file are named there as needing work before the video flip: item 1's gate is
phrased as "the Linear-authoritative team(s)" and becomes vacuous once video
flips too, and item 10 (F40) was demoted to CONTEXT for graphics only and
remains a real gate for video.

**Public-repo rule (F64):** this file never names a client. Membership is
written as placeholders; read the live values and compare.

- `<TEST_CLIENT>` — the disposable drill client
- `<WAVE_1_A>`, `<WAVE_1_B>` — the two real clients enrolled 2026-08-07 15:17 UTC

---

## GATING — every one must hold to report ALL CLEAR

1. **`outbound_diff_count` = 0 on every LINEAR-authoritative team** (post-flip:
   video), from the most recent `linear_deliverables_reconcile_v2` summary
   event in `deliverable_events`. This is the counter that means real client
   work is diverging on a team Linear still owns.
   - *AMENDED 2026-08-18 — the GRAPHICS component of this counter is CONTEXT,
     not gating.* For a SyncView-authoritative team the reconciler is
     detect-only: its "outbound diffs" count fields where LINEAR was edited
     without the native store ever hearing about it, and no soak action can
     clear them. The first post-flip working day proved the shape: the counter
     sat at 17–22 field diffs across exactly 11 rows, root-caused NOT to
     anyone working in Linear but to LEGACY CARDS with no native linkage — a
     status set on such a card reaches Linear through the card lane while the
     native row goes stale, because the inbound echo that used to close that
     loop is deliberately detect-only after the flip. 8 rows were repaired
     Linear->native by owner SQL, 3 by the reconciler apply lane, and the
     durable fix is card->deliverable linkage (of 195 unlinked live-card
     slots, 193 have NO native row at all — B1 never imported those issues —
     so they cannot drift; only linked-work drift matters). Report the
     graphics number and flag GROWTH the known repairs do not explain — the
     same rule the shadow audit uses. The old text claimed the counter "has
     never left 0"; that was true only pre-flip.
   - *PRE-REGISTERED FOR THE VIDEO FLIP (written 2026-08-22, NOT yet in
     effect).* `FLIP_BUG_LEDGER.md` §0-6 flags that this gate is phrased over
     "every LINEAR-authoritative team". After the video flip that set is
     **empty**, so the gate passes vacuously — it does not fail loudly, it
     stops meaning anything, which is worse. At F1(video), apply the 2026-08-18
     graphics amendment to BOTH teams and keep a real gate by changing what is
     measured:
     - Report `outbound_diff_count` for video and graphics separately. Neither
       is gating on its absolute value; detect-only counters cannot be cleared
       by any soak action, so demanding zero would be a gate nobody can ever
       satisfy.
     - **GATE on unexplained GROWTH**, per team, against the previous run —
       the same rule the shadow audit and the graphics amendment already use.
       Growth is what "real client work is diverging" looks like once nothing
       is Linear-authoritative.
     - Record the repairs that DO explain a rise (owner SQL, reconciler apply)
       in the same run that reports it, or the next run cannot tell an
       explained rise from a new one.
     Do not delete the original clause when this takes effect: leave it and
     mark it superseded, so a reader who finds the old phrasing quoted
     elsewhere can see what replaced it and why.
2. **Reconciler webhooks:** checked 2, enabled 2, disabled 0.
3. **Inbound alive:** fresh `mirror_in_*` events with actor `Linear webhook`.
   Silence >12h during a workday is a warning — the webhook may have
   auto-disabled. Bound the query by `ts`; unbounded reads of
   `deliverable_events` intermittently return `57014` statement timeouts. A
   `57014` is a known database condition, NOT missing data — narrow the window
   and retry.
   - *Interpretation note (2026-08-10):* weekend/quiet silence is expected and
     is not by itself evidence of a disabled webhook. `linear-inbound`
     deliberately drops our own writes coming back and records
     `mirror_out_echo_dropped` when it does, so those rows are independent
     proof the webhook is still DELIVERING even when no `mirror_in_*` appears.
     Check them before escalating.
4. **Flags exact — POST-FLIP VALUES (the graphics flip EXECUTED 2026-08-16;
   EXECUTION_LOG entry of that date):**
   - ⚠️ *Same defect as POST-FLIP item 1, same remedy — see the warning there.
     The `prod_authority` pair written below is the GRAPHICS-era value; at
     F1(video) it must be re-derived from `flag_flips`, or this item starts
     failing on a healthy system and passing on a video rollback.*
   `prod_authority {"video":"linear","graphics":"syncview"}` (F1, `flag_flips`
   id 54, 19:58:55Z); `linear_outbound_enabled {"mode":"live"}` (F2,
   `flag_flips` id 53, 19:36:49Z); `linear_inbound_enabled {"enabled":true}`;
   `auth_enforcement {"mode":"permissive"}`;
   `linear_legacy_parity_enabled {"enabled":true}`.
   The pre-flip values (`graphics:"linear"` / `{"mode":"off"}`) are now the
   ROLLBACK signature: seeing them means an R2/F27 rollback or an emergency
   kill has run — check `flag_flips` and the owner before treating either
   state as the fault.
   - `client_comment_gateway_enabled` (added 2026-08-14, the gateway comment
     front-door rollout switch): **absent-or-off pre-rollout, `{"enabled":
     true}` post-rollout** — its expected state follows the FLIP_RUNBOOK
     "GATEWAY COMMENT FRONT DOOR" go-condition, not this list. Absent/off
     means client comments ride the legacy lane (the PR #1064 stopgap);
     on means the front-door chain's step 3 has executed. Flag it ONLY if
     it reads ON while the production-write front-door EF deploy (chain
     step 2) has not happened — that would mean someone flipped rollout
     out of order.
5. **`write_ui_reroute_clients`** — print its exact contents every time.
   **Read `updated_by` FIRST and derive the expectation from it**, rather than
   from a membership list written into this file. An enrollment is a planned,
   announced act; a hard-coded list turns every planned enrollment into a
   guaranteed FAIL on the next run, which is the alarm-fatigue failure this
   whole document exists to prevent. It already happened once with the roster
   count in item 6.

   | `updated_by` | expected membership |
   |---|---|
   | `owner-enrollment-wave-1` | `<TEST_CLIENT>`, `<WAVE_1_A>`, `<WAVE_1_B>` |
   | `owner-enrollment-wave-2` | the wave-1 three **plus** `<WAVE_2_A>`, `<WAVE_2_B>` |
   | `owner-enrollment-wave-3-full-roster` | the ENTIRE roster (all three `*_ef_clients` lists; equality with them is the check, never a count written here) |
   | an announced rollback stamp | the membership captured when the rolled-back wave enrolled: wave 3 rolls back to the wave-2 five; wave 2 rolls back to the wave-1 three; wave 1 rolls back to `<TEST_CLIENT>` alone |

   FAIL only when the membership does not match the stamp it carries — an extra
   slug the stamp does not account for, or a missing client the stamp implies.
   An `updated_by` value this table does not list is itself a FAIL: it means
   somebody changed enrollment without announcing it.

   Wave 1 was executed 2026-08-07 15:17 UTC. **Wave 2 was executed 2026-08-11
   15:56 UTC** (`updated_by=owner-enrollment-wave-2`, `flag_flips` ledger id
   51; the two new clients chosen for being the most active on the roster, to
   fix a soak that was accumulating clock rather than evidence). Parity was
   clean through the wave-2 soak (35+ writes, 0 failures).

   **Wave 3 — the FULL roster — was executed 2026-08-14 16:52 UTC**
   (`updated_by=owner-enrollment-wave-3-full-roster`, `flag_flips` ledger id
   52, trigger-written), per the FLIP_RUNBOOK go-conditions enrollment ruling
   and only after its sequencing constraint was satisfied (PR #1064 merged AND
   live on Pages). **Wave 3 is now the expected state.** Membership is judged
   by EQUALITY with the three `*_ef_clients` rosters — never a count written
   into this file (item 6's rule applies here too). The captured rollback
   value is the wave-2 five-client membership from the owner's step-1 readback
   (ledger id 52's `old_value`): a wave-3 rollback restores THAT value and
   reads it back; rolling further back is a separate, announced decision.
   Enrollment moves client STATUS/APPROVAL writes to the gateway; client
   COMMENTS are governed by the item-4 context line (the front-door chain),
   not by enrollment.
6. **The three `*_ef_clients` rosters:** equal length AND identical membership
   to each other. **The gate is EQUALITY BETWEEN THE THREE, not any particular
   number** — the count moves whenever the owner onboards, and a stale number
   in this file produces a false alarm, which is the failure this whole
   document exists to avoid.
   - 36 each as of 2026-08-10 19:50 UTC. Was 34 earlier the same day: the
     owner added two SECOND BRANDS for existing people (one client now has a
     social brand and a DJ brand; another has a second brand of their own).
     Distinct display names give distinct slugs, so these are four separate
     clients, correctly. An older instruction said 33, which predates a client
     added 2026-07-29.
   - Multi-brand clients are now a normal shape. Do not treat two slugs that
     share a person's name as a duplicate.
7. **Zero** error/failure/reject/conflict/stale events in
   `calendar_post_events` or `sample_review_events` in the last ~12h. Both
   tables key the verb on `action`/`to_status`; neither has an `event` column.
8. **Three reconciler workflows green:** `Linear ⇄ SyncView status reconcile`,
   `Samples ⇄ Linear status reconcile`, `Linear ⇄ deliverables reconcile v2`.
   - *Post-flip note (2026-08-10):* once graphics is SyncView-authoritative,
     the two status reconcilers deliberately FREEZE (exit 1) if the live
     `linear_outbound_enabled` read fails mid-APPLY after 3 retries, or if the
     world changes mid-run. One isolated red in that shape is the freeze doing
     its job — investigate, but gate on TWO consecutive reds, not one.
9. **SOAK WATCH.** Wave 1 clock started 2026-08-07 15:17 UTC; wave 2 enrolled
   2026-08-11 15:56 UTC (five clients on the reroute). Target 4–5 clean days;
   report both wave day numbers (wave-1 day 1 ended 2026-08-08 15:17 UTC).
   - **a. Parity delivery health.** Sum `counts.legacy_parity_written`,
     `counts.failed` and `counts.legacy_parity_paused` over
     `action=linear_outbound_summary` rows since the previous check. **A
     nonzero `failed`/`paused` is a FAIL only when it touches the PARITY
     lane** — a rerouted client write that committed natively but did not
     reach Linear. Check the same event's `legacy_parity_written`/`_paused`
     before judging: the daily write drill produces TEST-fixture failures on
     the NORMAL lane at drill time (~04:17–05:50 UTC) with
     `legacy_parity_written: 0`, and those are not soak failures. Also FAIL on
     a red **SyncView Linear outbound drain** scheduled run.
   - **b. Traffic evidence (vacuous-soak guard).** Count `calendar_post_events`
     and `sample_review_events` rows for the enrolled clients (the full roster
     as of wave 3, 2026-08-14) in the window.
     If they were visibly ACTIVE but `legacy_parity_written` stayed 0 across
     the whole window, that is a WARNING to investigate (stale tabs may still
     be on the legacy lane). Quiet days are fine — never FAIL on quiet alone.
   - **c. One-step soak rollback** if a genuine parity failure occurs: restore
     `write_ui_reroute_clients` to its captured prior value and read it back.
     **Corrected for wave 2 (ledger id 51):** the captured prior value is now
     the wave-1 membership (`<TEST_CLIENT>` + the wave-1 two), NOT
     `<TEST_CLIENT>` alone — rolling all the way back to `<TEST_CLIENT>` alone
     is a separate, announced decision, not the wave-2 rollback.
10. **F40 workload readiness** — `node scripts/f40-workload-readiness.js
    --team=graphics`; report the number every time.
    - *AMENDED 2026-08-18 — CONTEXT for graphics, no longer gating.* The gate
      logic inverted at the flip: F40 counted rows a pre-flip B1 refresh could
      still repair, and that repair lane closed the moment graphics became
      SyncView-authoritative (B1 never writes a team it does not own). Post-
      flip the counter can only ever GROW, by exactly one for every graphics
      issue a human hand-creates in LINEAR — proven on day one, when two new
      unprovables (GRA-7109, GRA-7101) appeared above the accepted floor of 5,
      both hand-made in Linear on 2026-08-17, neither ever importable. The
      remedy is behavioral, not a repair: graphics work is created in
      SyncView, where Create Post now offers Video / Thumbnail / Both. Report
      the number and NAME any new identifiers so the hand-creation habit is
      visible; do not gate on it. (F40 remains a real GATE for the future
      VIDEO flip — item text below stands for that purpose.)
    - **HEALED 2026-08-11.** The B1 label fix (#1054) plus one full-window
      refresh (`changed_since=2020-01-01T00:00:00Z`, run `31509332785`) took
      graphics from **0 provable / 83 unprovable to 70 provable / 5**. Label
      state incomplete went 78 → **0**. Both the defect and its repair are now
      proven on live data.
    - **The floor has been restated twice; this version has a mechanism, not a
      theory.** It first said 3 (two ex-clients' stale rows) — wrong, those are
      off-roster and the page never loads them. It then said 0 — also wrong. The
      five that remain are `GRA-4260`–`4264`, real sub-issues of a CURRENT
      roster client, non-parked, so the page does load them. They are absent
      because B1's operational filter is
      `linked || alreadyTracked || created >= cutoff`
      (`b1-linear-backfill.js:1286-1294`) and all three are false: created
      **2025-06-16**, outside the **12-month** `--cutoff-months` default, with no
      card link and no existing row. B1 archives them rather than importing.
      **No refresh will ever pick them up**, at any `changed_since` — the cursor
      is not what excludes them.
    - **OWNER RULING 2026-08-11 — ACCEPTED, do nothing.** In the owner's words:
      *"Luciana doesn't even work with us anymore… if it's backlogged, does it
      really matter… they were created like a year ago, so yeah, it doesn't
      matter. I guess we just do nothing."* **5 is PASS; above 5 is FAIL.**
      F40 is therefore CLOSED as a flip gate. The ruling was encoded in the
      script itself (`ACCEPTED_FLOORS { graphics: 5 }`, merged PR #1061), so a
      bare run's exit code is the gate — PASS at or under the floor, FAIL
      above it.
    - **FLOOR RETIRED 2026-08-23 — this doc caught up 2026-08-27.** The
      2026-08-23 Backlog ruling removed all five accepted rows from the
      audited population (they are Backlog, which Workload no longer loads),
      so the allowance became empty — and an empty count-based allowance is a
      place for five FUTURE failures to hide. The script now carries
      `ACCEPTED_FLOORS = {}` with the full rationale in place; **any nonzero
      unprovable count exits red.** Read a graphics red as this section
      already instructs — CONTEXT, name the identifiers — and do not expect
      the old floor-5 arithmetic. (The 13:16 UTC 2026-08-27 check reported
      "floor overshoots reality" against the retired constant it remembered;
      the script was already right, this paragraph is the correction.)
    - The cost of accepting is smaller than it first sounds, and worth stating
      so nobody re-opens this expecting a loss: all six issues have **no due
      date set at all**. Nothing disappears from anyone's screen at F1 — the
      box is already blank. The only forfeited capability is *adding* a
      deadline to those six from the Workload page; Linear still can.
    - **The audited population is much smaller than the raw table.** Graphics on
      2026-08-11: 327 active sub-issues, of which 243 are parked/terminal and 4
      are off-roster, leaving **80** the page actually loads. Gate on the 80.
    - **Order of operations, learned the expensive way.** Dispatching the
      healing full-window refresh while the B1 label fix is NOT yet on `main`
      makes the number strictly worse: it happened on 2026-08-11 (run
      `31444949880`) and took graphics from 186 provable to 0. Confirm the fix
      is merged, THEN dispatch.
    - *Why it is a gate and not context.* After F1 the Workload page reads a
      graphics issue's due date and workload weight natively instead of through
      the Linear gateway. That branch is never taken while both teams are
      Linear-authoritative, so every defect in it is invisible until the flip
      and then applies to the whole team at once. Two were found this way on
      2026-08-10, weeks after the code was called done: 133 of 319 resolvable
      active graphics sub-issues had their label relation erased by B1, and 9
      more had no `deliverables` row at all. An unprovable row loses its due
      date and its editability — silently, from the designer's side.
    - **Ordering.** The repair is a full-window B1 refresh and it must run
      BEFORE F1. B1 writes a deliverable only while its team is
      Linear-authoritative, so once graphics flips it can no longer repair
      graphics at all.
    - Video is measured too (`--team=all`) and is far worse (798 of 1161
      unprovable on 2026-08-10). That does not gate the GRAPHICS flip — video
      keeps using the Linear gateway — but it must be closed before any video
      flip is considered.

---

11. **Roster hygiene (added 2026-08-27, OPEN_REPAIRS item 52).** No
    `team_members` row with `active = true` may carry a `linear_user_id`
    that the shipped `WL_INACTIVE_EDITOR_IDS` set (index.html) names as
    departed. The gateway's auto-assign pool is `team_members.active`, and a
    departed editor holds zero live briefs, so under the freest-editor rule
    he wins EVERY assignee-less create and real work funnels to a queue
    nobody reads — three issues went that way on 2026-08-27 before this was
    caught. One-step repair: deactivate the row (owner SQL, keyed by
    `linear_user_id`) and reassign anything live it collected.
    - *WIDENED 2026-08-27 evening by the pre-flip bug archaeology: the
      deactivated ghost is only half the class — LIVE WORK STILL ASSIGNED to
      already-inactive members is the other half, and it is invisible by
      construction (the Workload board renders active members, so a ghost's
      queue is on nobody's screen).* Measured: **25 live video rows**
      (todo/in_progress/tweak) across 3 inactive members — 18 on the departed
      editor item 52 deactivated (10 of them a consecutive freshly-imported
      todo block), 6 on a second departed editor, 1 on a group pseudo-member —
      plus 1,098 more in approval/backlog states. **Timing matters: reassign
      these IN LINEAR before F1** — inbound still applies video assignee
      changes today and mirrors them for free; after F1 that door is
      detect-only and the repair becomes owner SQL forever. Re-measure with:
      live deliverables joined to `team_members.active = false`, per team.
12. **Query-shape sweep clean (added 2026-08-27).** Run
    `scripts/query-shape-sweep.js` (live schema via `SUPABASE_ACCESS_TOKEN`,
    read-only) and require ZERO missing columns and ZERO unknown relations.
    This is the 42703 class that killed the B1 lane and silently disabled the
    v55 gateway correction on the same day — a wrong column name survives
    every offline suite because nothing executes the query until production
    does. Text-order rows in its third section are judgement candidates, not
    failures; the archive-thread defect it caught is fixed and pinned by
    `test/archive-comment-thread-order.js`.

## CONTEXT — report these numbers, never gate on them

Non-zero for known, diagnosed, in-repair reasons. Treating them as alarms
trains everyone to skim the report, which is the exact failure mode the
2026-08-04 Slack alerting work fixed.

- **Attribution nobody re-derived** — `node scripts/attribution-stuck-check.js`
  (read-only, public key, safe anywhere). A Linear structure change clears a
  row's `client_slug` and marks it for repair; nothing re-derives it, and
  post-flip nothing can on the graphics side. A row with no `client_slug`
  appears in NO client view, so its state has no owner.
  **Report the "an ACTIVE client is waiting" column, never the total.** Measured
  2026-08-22: 92 unresolved, 90 answerable from their own project mapping, 87
  still live — and only **2** belonging to an active client (`GRA-7068` and
  `GRA-7084`, both sitting in Kasper's queue past their due dates, OPEN_REPAIRS
  item 27). Sixty of the live ones resolve to a test fixture and twenty-five to
  former clients: real, countable, and nobody waiting. Leading with 87 would be
  true and useless, which is this section's whole point.
  - Flag GROWTH in the waiting column, and flag anything landing in
    `unmapped_project` — that bucket is a decision somebody owes, not a repair.
  - Cross-check: this defect is also the largest reason bucket in the shadow
    audit residue (item 18), so the two numbers should move together. If they
    stop moving together, one of them is lying.

- **Cards born without their work** — `node scripts/card-linkage-leak-check.js`
  (read-only, public key, safe anywhere). **Report "unlinked AND live", never
  the percentage.** Measured 2026-08-22 over eight weeks: 6.0% unlinked, which
  is the same figure `GRAPHICS_FLIP_STATUS` carried since 2026-08-06 and which
  had been quoted as current ever since — but 14 of those 20 are a single July
  day of bulk-created, same-day-archived cards. Over the five weeks since: 2.3%,
  and the most recent full week is 0 of 43. Two live unlinked cards exist in
  eight weeks and neither is lost work (one is a note card, one an abandoned
  blank). The leak is closed; re-run rather than re-quote.

- **Stranded foreign writes** — `node scripts/foreign-write-strand-check.js`
  (read-only, public key, safe anywhere). Post-flip, editing a GRAPHICS issue
  in Linear records `foreign_write_detected` and is deliberately not applied.
  **Report the STRANDED number, never the raw count.** Measured 2026-08-22
  (corrected same day, see below): 978 foreign writes over 14 days across 402
  state-bearing rows, of which 322 agreed with SyncView and 78 were rows
  SyncView had already moved on afterwards — the native value being the correct
  one. Exactly **2** were stranded (Linear moved, the native row never caught
  up): `GRA-6950` (roccopiazza, Linear says Approved since 2026-08-20, SyncView
  says smm_approval since 08-12) and `GRA-7112` (Backlog vs todo — the same row
  as OPEN_REPAIRS item 23). Raising the raw 978 would be a 900-a-week false
  alarm, which is the exact failure this section exists to prevent.
  - **Correction, same day.** The first version of this line read 976 / 409 /
    320 / 64 and was computed over an incomplete set. The script took the newest
    detection of any kind per row, but a comment echo carries no issue at all,
    so an echo landing after an unresolved status edit became that row's entry
    and the stranded change it hid was never evaluated — 16 rows were dropped
    that way. The stranded answer happened to stay 2, but it was right by luck
    rather than by construction. The names shown were also the issue's
    ASSIGNEE, not the editor: no detection in the window records an actor, so
    the report now says `assigned_to` and says the editor is unknown. Do not
    send anyone to have a conversation on the strength of that name alone.
  - The volume is still worth a human's attention even when nothing is
    stranded: it is one person doing daily graphics work in Linear, where
    SyncView now owns the answer, so the work is being re-done rather than
    lost. That is a conversation, not a repair — and a stranded row is never
    auto-healed, because SyncView owns graphics and the Linear value is not
    automatically the truth. Flag GROWTH in the stranded number.
- **`repair_list_size`**, with its by-team split. **23 as of 2026-08-12, all
  known-cause:** the TEST client's graphics project is unregistered in the
  f200 mapping, plus accumulated drill fixtures. Flag ONLY if it moves by more
  than 5 since the last check, or if the by-team split changes shape.
- **`linkage_actionable`.** The card→deliverable linkage backlog. Flag ONLY if
  it moves by more than 5. (Corrected 2026-08-12: an earlier version of this
  line claimed it "reached 0 on 2026-08-10" — that was wrong; the counter read
  31–33 in the same period, per `docs/independence/GRAPHICS_FLIP_STATUS.md` §2
  and the ~40 actionable linkage writes the dry-run reconciler was reporting in
  `OPEN_REPAIRS.md` item 3. Report the measured number each run; never assume
  0.)
- **`inbound_diff_count`.** A stamp-age counter from PR #920. Not a health
  signal. Report it; never gate on it.
  - *EXPECTED JUMP, pre-registered 2026-08-27 evening — then MEASURED the same
    night, and the prediction was wrong in an instructive way.* Former clients
    now attribute (owner ruling, f200 graph includes inactive roster
    mappings), and the pre-registration predicted ~84
    `attribution_claim_mismatch` inbound diffs on the first post-change run.
    The first two runs (21:03, 22:03) showed video inbound 147→145 — FLAT.
    Why, measured rather than guessed (first draft blamed a "TEST exclusion"
    that does not exist — Codex on #1170 caught it; `loadLiveData` scans TEST
    rows like any other): the 84 split exactly into **61 graphics-team LIVE
    rows + 23 video-team TERMINAL rows, zero video-live**. The 61 sit on the
    SyncView-authoritative side, whose detect-only lane does not run the
    attribution claim comparison; the 23 canceled rows leave the diff-eligible
    population on the liveness filter. Estate-wide, the roster-hash change
    (inactive clients entering the graph) landed in the DESIGNED
    `attribution_stamp_revision_stale` tolerated lane (~4,950 rows) —
    provenance, not claim, never a diff. The graphics outbound rise 79→105 in
    the same window is NOT attributed to this change and has not been
    decomposed; treat it under item 1's growth rule, not this note.
    **Remediation, corrected:** an `apply=true` dispatch would heal
    essentially NONE of the 84 — canceled rows are dropped before planning,
    and SyncView-authoritative rows get outbound intents, not restamps — so
    do not dispatch one for this purpose. The stamps simply REMAIN STALE,
    harmlessly: every row has its owner (that was the repair), the browser
    and the stuck-check agree, and the stuck-check's `repaired_state_stale`
    watchlist is the tracker of record. They restamp only if those rows are
    ever legitimately re-imported. Lessons kept: run a predicted count
    through the consumer's population filters before pre-registering it, and
    never prescribe a mutation without tracing that it reaches the rows it
    promises to fix.
- **The `production_shadow_audit` lane result.** *Amended 2026-08-10 by owner
  decision.* It was previously gating under item 9a. It has **never** passed —
  red continuously since 2026-07-24, two weeks before wave 1 existed — so it
  produced a guaranteed daily FAIL that no soak action could clear, and the
  prescribed remedy (rolling back enrollment) could not possibly address a
  condition that predates enrollment. Report `unexpected_divergences` and the
  by-reason map, and **flag only if the residue GROWS**. The residue is now
  itemised per row by PR #1046 (`unexpected_divergence_sample`), so it is a
  work list, not an alarm. Shrinking on its own: 14 → 12 between 08-09 and
  08-10.
  - *Growth-rule caveat (2026-08-10):* #1051 made the importer's per-team
    parent maps ACCUMULATE, and the 2026-08-10 SQL repair re-batched five GRA
    rows — both change the residue's COMPOSITION once. Expected next-run
    shape: total ≤7 with the five GRA parent rows gone. A one-time composition
    shift matching that expectation is NOT growth; flag only a rise the
    repairs do not explain.

- **Rows Workload will withhold after F1 — read the BUCKETS, never a single
  total** (added 2026-08-24). `node scripts/f40-workload-readiness.js
  --team=video` (and `--team=graphics`). Service-role key required; it is
  read-only.

  The gate decomposes `unprovable_total` into four causes, and they call for
  completely different work:
  - `missing_from_projection` — an active issue with **no native row at all**.
    A backfill/import gap, not a label problem.
  - `label_state_incomplete` — the row exists but `workload_labels_complete`
    is not `true`. This is the one B1 heals.
  - `native_target_unprovable` — the row exists and its labels are sound, but
    its id/slug/team/`updated_at` do not prove a write target.
  - `ambiguous_projection_rows` — two native rows claiming one Linear issue.

  All four blank the row's due date and withhold its weight, so a total tells
  you a number and nothing about what to do. **Read the buckets and the
  `sample` list of identifiers the gate prints with them.**

  *Why this entry exists.* On 2026-08-24 a hand-written `deliverables` census
  was used instead of this gate, saw only `label_state_incomplete`, and
  produced two confident conclusions that both turned out to be wrong — it
  named a graphics row that has no Linear issue and therefore cannot be the
  one raising the banner, and it put seven video rows on the flip-day critical
  path when five of them sit in `approved`, which `wlIsActiveStatus` never
  requests. See FLIP_BUG_LEDGER §10. A gate that already decomposes a symptom
  is not optional because an ad-hoc query is faster to write.

  If no service-role key is to hand, this read-only query covers
  `label_state_incomplete` **only** — it is one of four buckets, so report it
  as that and not as the answer:

  ```sql
  select d.team,
         d.identifier,
         d.linear_identifier,
         d.client_slug,
         d.status,
         d.due_date,
         (d.linear_issue_uuid is null) as no_linear_issue,
         d.workload_labels_complete,
         jsonb_array_length(coalesce(d.workload_labels, '[]'::jsonb)) as label_count,
         d.updated_at
    from public.production_deliverables_browser_v1 d
   where d.team in ('video','graphics')
     and (d.workload_labels_complete is distinct from true
          or jsonb_typeof(d.workload_labels) is distinct from 'array')
   order by d.team, d.status, d.identifier;
  ```

  A row in a PARKED status (`approved`, `posted`, any of the approval
  columns) is dormant, not broken: Workload never asks about it, so it cannot
  withhold anything or raise the banner. It becomes live the moment someone
  moves it back to a working status — which is why parked rows still belong on
  the pre-F1 repair list even though they are quiet today.

  **The repair window closes at F1.** B1 will not write a team it does not
  own, so a video row still unprovable after the flip stays that way.

---

## POST-FLIP — the first checks after F2/F1 (added 2026-08-12, flip eve)

Everything above describes the PRE-flip world. The moment the owner runs F2 and
Graphics F1, item 4's "flags exact" expectations invert, and the first
post-flip check (Saturday morning, if the flip lands Friday night) gates on
this section instead:

1. **Flags exact, post-flip:** `prod_authority
   {"video":"linear","graphics":"syncview"}` and `linear_outbound_enabled
   {"mode":"live"}`. The other three are unchanged: `linear_inbound_enabled
   {"enabled":true}`, `auth_enforcement {"mode":"permissive"}`,
   `linear_legacy_parity_enabled {"enabled":true}`. Anything else is a FAIL —
   including the old pre-flip values, which post-flip mean the flip did not
   hold or was reversed without an announcement.
   - ⚠️ **THE PAIR ABOVE IS THE GRAPHICS-FLIP-ERA VALUE, AND AT F1(video) IT
     INVERTS THIS ALARM. Re-derive it before the video flip, not after.**
     Found 2026-08-26. After F1 the healthy state is
     `{"video":"syncview","graphics":"syncview"}`, so a hard-coded
     `video:"linear"` reports **FAIL twice daily on a perfectly healthy
     system** — and, far worse, `video:"linear"` is precisely the *post-R2
     video rollback signature*. A real unannounced rollback would therefore
     match the expectation and report **ALL CLEAR**. The check would be exactly
     backwards on the one morning it has to be right.
     Apply the treatment item 5 already got: **read the flip's own `flag_flips`
     row and `updated_by` and derive the expectation from it**, rather than
     restating a pair in prose that goes stale the moment the thing it
     describes changes. A hard-coded value here is the same alarm-fatigue
     defect item 5 exists to prevent, one document section later.
   (`client_comment_gateway_enabled` is judged by pre-flip item 4's context
   line, not here: post-F1 it should read `{"enabled": true}` if the front-door
   chain ran before the flip — and if it does NOT, item 4 below is live for
   comments.)
2. **Expected Saturday signals — report them, do not false-alarm on them:**
   - Weekend quiet is normal (item 3's interpretation note applies). Sparse
     `mirror_in_*` traffic proves nothing by itself; check
     `mirror_out_echo_dropped` rows before escalating a "silent" webhook.
   - `linear_outbound_summary` events now legitimately carry nonzero
     normal-lane `written` for graphics — post-F2 that is the system working,
     not residue. `outbound_diff_count` = 0 on both teams remains the gate
     that matters (item 1 above survives the flip unchanged).
   - The two status reconcilers deliberately FREEZE (exit 1) if the live
     outbound read fails mid-APPLY or the world changes mid-run (item 8's
     post-flip note). ONE isolated red in that shape is the freeze doing its
     job; gate on TWO consecutive reds.
3. **`oldest_pending_minutes.graphics` <= 30 — manual read.** Read it from the
   most recent `linear_outbound_summary` event in `deliverable_events`
   (anon-readable); nothing pages on it for a freshly flipped team, so this is
   a hands-on read every check. Over 30 minutes means drains are not keeping
   up or the drainer stopped — look at the **SyncView Linear outbound drain**
   run history before anything else.
4. **Client-write darkness watch** — *(rescoped 2026-08-14 for the client
   comment lane fix, PR #1064)*. Two distinct populations now sit in this
   watch, and only one of them is conditional on a partial roster:
   - **Client COMMENTS — applies to EVERY roster client, enrolled or not.**
     Since PR #1064, all client comments travel the legacy n8n lane regardless
     of enrollment (the gateway comment door can never authorize a
     calendar-surface or unlinked-samples client comment). Post-F1 that legacy
     lane is what the n8n authority guards block for graphics, so unless the
     gateway comment-door repair shipped before F1, a client's graphics
     comment parks silently for the FULL roster. The old "applies only if
     partial roster" scoping is stale for comments — do not skim past this
     item on the strength of a full-roster enrollment. *(2026-08-14: the
     repair exists — "shipped" means the FLIP_RUNBOOK "GATEWAY COMMENT FRONT
     DOOR" go-condition's full four-step chain completed, ending with
     `client_comment_gateway_enabled` ON and a drilled comment on both
     surfaces. Merged-but-flag-off does NOT clear this watch.)*
   - **Client STATUS/APPROVALS — applies only if the owner's enrollment ruling
     (see the `FLIP_RUNBOOK.md` go-conditions block) chose to flip with a
     partial roster.** An unenrolled client's graphics status write commits to
     the card but is 409-blocked at both n8n authority guards with no gateway
     leg — it parks silently, with no error anyone sees.

   Either way: treat any real-client graphics change that is visible on the
   card but absent from Linear as a page, not a statistic, and re-raise the
   enrollment ruling.
5. **Rollback pointers, corrected for wave 2:** the SOAK rollback restores
   `write_ui_reroute_clients` to its captured wave-1 value (item 9c above,
   ledger id 51's prior value) — while the TEAM rollback is F27 §R2 in
   `FLIP_RUNBOOK.md`, never a blind F1 reversal. Item 14 of `OPEN_REPAIRS.md`
   adds one standing post-flip rule: watch `outbound_parent_mismatch` in the
   deliverables reconciler's dry-run output, and never dispatch that
   reconciler with `apply=true` without first checking the mismatch list by
   hand.

---

## Reporting

One line `ALL CLEAR` plus the gating numbers, or name exactly which gating item
failed, what it means, and its one-step rollback:

- roster / Track-A drift → remove the unexpected slug from the roster flags
- inbound problem → set `linear_inbound_enabled false` / disable the two EF
  webhooks
- unexpected `write_ui_reroute_clients` entry → restore its captured prior
  value via the `FLIP_RUNBOOK.md` §F6 rollback block

## Onboarding note — multi-brand clients (2026-08-10)

One person can now hold more than one client row, one per brand. Two such
pairs exist. Consequences worth knowing before the next onboarding:

- **The slug rule does the work.** Slugs derive from the display name
  (`wlNormalizeClient`, `index.html:8014`), so each brand needs its OWN display
  name — never the person's name twice, or the two brands silently share a
  calendar, samples, caption prompts and Supabase rows. Both existing pairs got
  this right.
- **The Roam creative-group finalizer may park.** It requires *exactly one*
  matching Clients Info row for the display name **and email**
  (`NEW_CLIENT_ONBOARDING.md` §6c). If a second brand reuses the first brand's
  email, that check can match two rows, and the job parks as "manual
  reconciliation" and posts nothing rather than failing loudly. Confirm which
  email a second brand carries BEFORE queueing it.

## Standing context

**Corrected 2026-08-22.** This section said "the graphics flip has NOT
happened; authority is still linear/linear and outbound is off" for six days
after it did happen — in the very file the scheduled check now treats as
canonical. That is the same defect class that left GRAPHICS_FLIP_STATUS.md
reading NO-GO for four days post-flip, and a stale control doc is how the
eleven-deploy-stale rollback pointer happened. If you are reading this section
to decide anything, read the flags live instead (item 4); this paragraph is
context, never authority.

The graphics flip EXECUTED 2026-08-16: `prod_authority` is
`{"video":"linear","graphics":"syncview"}` and `linear_outbound_enabled` is
`{"mode":"live"}`. Enrollment reached the FULL roster (wave 3) on 2026-08-14
16:52 UTC — every client's calendar/SXR status/comment/intake writes travel
the gateway, and for a Linear-authoritative team they are pushed to Linear
synchronously through the parity lane.

The B3 "7 consecutive days at zero" gate CANNOT start until the f200 mapping
and the linkage repair land — do not report a day count for THAT gate until
told the clock has started. The item 9 soak day count is a different clock and
SHOULD be reported.

Track A has been clean for weeks; confirm its flags rather than re-checking its
history. Full current state, blockers and PR merge order live in
`docs/independence/GRAPHICS_FLIP_STATUS.md`.
