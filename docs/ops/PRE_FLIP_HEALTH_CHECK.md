# Pre-flip health check — canonical gating spec

The recurring read-only watch that runs while the graphics flip is pending.

**Why this file exists.** Until 2026-08-10 this spec lived only inside a
scheduled prompt. That is the same failure `OPEN_REPAIRS.md` was created to
fix: a rule nobody can diff, review, or correct except by re-typing it. It also
made the one amendment below impossible to record — the gate kept producing a
daily FAIL that the reader had to remember to discount, which is precisely the
alarm-fatigue mode the 2026-08-04 Slack work was undone by.

**Public-repo rule (F64):** this file never names a client. Membership is
written as placeholders; read the live values and compare.

- `<TEST_CLIENT>` — the disposable drill client
- `<WAVE_1_A>`, `<WAVE_1_B>` — the two real clients enrolled 2026-08-07 15:17 UTC

---

## GATING — every one must hold to report ALL CLEAR

1. **`outbound_diff_count` = 0 on BOTH teams**, from the most recent
   `linear_deliverables_reconcile_v2` summary event in `deliverable_events`.
   This is the counter that means real client work is diverging. It is the
   signal that matters; it has never left 0.
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
4. **Flags exact:** `prod_authority {"video":"linear","graphics":"linear"}`;
   `linear_outbound_enabled {"mode":"off"}`; `linear_inbound_enabled
   {"enabled":true}`; `auth_enforcement {"mode":"permissive"}`;
   `linear_legacy_parity_enabled {"enabled":true}`.
5. **`write_ui_reroute_clients`** — print its exact contents every time.
   Enrollment wave 1 was executed and announced 2026-08-07 15:17 UTC
   (`updated_by owner-enrollment-wave-1`). Expected during the soak: exactly
   `<TEST_CLIENT>`, `<WAVE_1_A>`, `<WAVE_1_B>`. Any OTHER membership — an
   unexpected extra slug OR a missing enrolled client — is a FAIL in either
   direction. On an announced rollback the expected value returns to
   `<TEST_CLIENT>` alone.
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
9. **SOAK WATCH.** Wave 1 clock started 2026-08-07 15:17 UTC; target 4–5 clean
   days; report the day number (day 1 ended 2026-08-08 15:17 UTC).
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
     and `sample_review_events` rows for the two wave-1 clients in the window.
     If they were visibly ACTIVE but `legacy_parity_written` stayed 0 across
     the whole window, that is a WARNING to investigate (stale tabs may still
     be on the legacy lane). Quiet days are fine — never FAIL on quiet alone.
   - **c. One-step soak rollback** if a genuine parity failure occurs: restore
     `write_ui_reroute_clients` to its captured prior value (`<TEST_CLIENT>`
     alone) and read it back.
10. **F40 workload readiness** — `node scripts/f40-workload-readiness.js
    --team=graphics` must report **3** unprovable rows, the accepted floor (see
    below). Read-only, needs no secret. Report the number every time; it is a
    real flip gate.
    - **The floor is 3, not 0.** Owner ruling 2026-08-11: three stale Backlog
      sub-issues belong to two people who are no longer clients, so attribution
      cannot resolve a slug and B1 will never import them. Accepted as-is. Three
      non-editable rows for ex-clients is not a flip risk; treat a reading of 3
      as PASS and only a reading ABOVE 3 as a failure.
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

- **`repair_list_size`**, with its by-team split. Known causes: the TEST
  client's graphics project is unregistered in the f200 mapping, plus
  accumulated drill fixtures. Flag ONLY if it moves by more than 5 since the
  last check, or if the by-team split changes shape.
- **`linkage_actionable`.** The card→deliverable linkage backlog. Flag ONLY if
  it moves by more than 5. (Reached 0 on 2026-08-10.)
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
