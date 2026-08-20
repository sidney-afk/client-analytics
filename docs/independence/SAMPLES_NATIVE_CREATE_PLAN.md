# Samples native create — implementation plan (owner task: "samples get their own batches")

> Status: **IN PROGRESS** (2026-08-19).
>
> BUILT and owner-applied: layer 1 (gateway lane), layer 2 (batches.purpose),
> and a layer discovered mid-build and NOT in the original plan -- **2b,
> batch_write persistence**. Both owner SQLs are applied.
> BUILT: layer 3 (append RPC, v5 — APPLIED), layer 4 (browser
> materialization) and layer 5 (the create dialog).
> ALL THREE owner SQLs are applied. Remaining: merge + deploy #16.
>
> What that means in practice: the feature is code-complete. The Samples "+"
> opens the SAME native Create Post dialog the Calendar uses, with both modes
> live (start a new samples batch, or add to an existing one). It reaches the
> live site on merge; the gateway half needs deploy #16.
>
> The owner expected this feature complete on 2026-08-19 and it was not -- the
> overnight session produced this plan and no code, and recorded that only
> inside a long status message. Every layer below is marked, so the state of
> this feature is readable without reconstructing a conversation.
>
> Originally: PLANNED, deliberately not built unattended (2026-08-19, overnight session).
> The append chain took three rounds because layers were changed one at a time on
> inference. This feature crosses the same contracts (gateway lanes, RPC origin
> checks, batch parents, the create dialog) plus TWO owner-run SQLs, so it gets a
> supervised session with live verification at each layer, not a pre-dawn solo build.

## Owner rulings this encodes

- Samples get the SAME pipeline as Calendar Create Post, but their OWN batches
  (owner, 2026-08-18: "samples should have their own batches").
- The create dialog is the option-E shape the owner picked: mode toggle, "Start a
  new batch" first and default, ONE previous-batch card with always-visible
  dropdown, incompatible batches not rendered.
- Sample batches must never appear in the CALENDAR dialog's previous-batch
  picker, and calendar batches never in the SAMPLES picker.

## The layers, in build order

1. **[BUILT 2026-08-19]** **Gateway (`production-write`)** — the sxr lane today allows only
   `status`/`comment` (index.ts:1058); `intake_create` is submission|calendar
   only (policy.mjs:448). Widen: `lane === "sxr"` admits `intake_create`, rows
   carry `origin: "samples"`, and the batch the intake creates carries
   `purpose: "samples"`. Unit-pin in test/ the same way the calendar lane is
   pinned. Needs deploy #16.
2. **[BUILT + APPLIED 2026-08-19]** **Schema (owner SQL #1)** — `migrations/2026-08-19-samples-batch-purpose.sql`. `batches.purpose text` (default `'calendar'`,
   check in `('calendar','samples')`). Compile on the local PostgreSQL 16
   first (house rule since the v2 CASE defect: no migration is handed over
   unexecuted).
2b. **[BUILT + APPLIED 2026-08-19]** **Persistence (owner SQL #2)** —
   `migrations/2026-08-19-samples-batch-write-purpose.sql`. NOT in the original
   plan; found while building. `batch_write` inserts through an EXPLICIT column
   list, so the `purpose` the gateway stamps was dropped with no error and every
   samples batch would have been written as 'calendar'. Its guarded conflict
   branch matters as much as its insert: without it a later rename or status
   change resets a samples batch back to calendar.
3. **[BUILT 2026-08-19 — awaiting owner apply]** **RPC (owner SQL #3)** — `migrations/2026-08-19-production-intake-append-v5.sql`. — the append RPC pins `origin = 'calendar'`
   (v4, row validation). Widen to `('calendar','samples')` AND pin
   batch-purpose/row-origin agreement: a samples row only into a
   purpose='samples' batch, calendar only into calendar. Same local-PG
   reproduction discipline: fixture both shapes, prove refusals both ways.
4. **[BUILT 2026-08-19]** **Browser materialization** — the samples twin of
   `_linearIntakeMaterializeCards`: after intake, materialize the sample card
   (`content_samples` upsert lane) and adopt links via
   `_sxrAdoptDeliverableLinks`. The gateway writes batches/deliverables/outbox
   only; the browser materializes, exactly like Calendar.
5. **[BUILT 2026-08-19]** **UI** — the option-E dialog mounted from the Samples tab create buttons,
   client pinned from the samples context, batch list filtered to
   `purpose='samples'`; the Calendar dialog's list filtered to
   `purpose='calendar'` (today that means `purpose is null or 'calendar'` for
   pre-column batches).
6. **Unchanged on purpose** — `linear-outbound` (the drain already stamps
   per-team parents on any batch), Linear-side routing, and the calendar
   create flow.

## Verification plan

- Local PG: both SQLs compiled + append/create fixtures for both purposes,
  refusal matrix proven before handover (the v4 method).
- Gateway unit pins for the sxr intake lane.
- Live: one end-to-end sample create + append on the TEST client
  (`sidneylaruel`) before any real client touches it.
- The Samples E2E nightly and sample-review browser suites extended last.

## Open UX decision for the owner

The Samples tab currently exposes four create/link buttons (two original-Linear,
two our-Linear, owner's description 2026-08-18). Which of the four routes into
the native dialog on day one, and do the original-Linear pair stay as-is?
