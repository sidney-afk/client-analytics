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
      F40 is therefore CLOSED as a flip gate. The ruling is now encoded in the
      script itself (`ACCEPTED_FLOORS { graphics: 5 }`, merged PR #1061), so a
      bare run's exit code is the gate — PASS at or under the floor, FAIL
      above it.
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

## CONTEXT — report these numbers, never gate on them

Non-zero for known, diagnosed, in-repair reasons. Treating them as alarms
trains everyone to skim the report, which is the exact failure mode the
2026-08-04 Slack alerting work fixed.

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

The graphics flip has NOT happened; authority is still linear/linear and
outbound is off. Enrollment wave 1 IS live as of 2026-08-07 15:17 UTC — those
clients' calendar/SXR status/comment/intake writes travel the gateway parity
lane and are pushed to Linear synchronously; everything else is unchanged.

The B3 "7 consecutive days at zero" gate CANNOT start until the f200 mapping
and the linkage repair land — do not report a day count for THAT gate until
told the clock has started. The item 9 soak day count is a different clock and
SHOULD be reported.

Track A has been clean for weeks; confirm its flags rather than re-checking its
history. Full current state, blockers and PR merge order live in
`docs/independence/GRAPHICS_FLIP_STATUS.md`.
