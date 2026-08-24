# B1 stray-catcher — design (pre-implementation)

**Status:** DESIGN, ratified rulings recorded in `FLIP_BUG_LEDGER.md` §0-5.
Implementation pending; nothing here is live. Owner rulings 2026-08-24: B1
survives the video flip as the stray-catcher ("in case someone forgets and
creates a sub-issue in Linear — we import it, but that's it"), and the estate
converges on "everything active is in SyncView."

## The five constraints, and where each comes from

The ledger's review cycle named four pieces. Reading the importer end to end
adds a fifth, and it is the one that would have caused the incident:

1. **Explicit mode, never authority-sniffing.** The new behaviour ships behind
   a flag (`B1_STRAY_CATCHER=1`, a workflow-env line), adopted at F1 as a
   flip-day paste. Every E-class bug in the ledger was a gate that silently
   changed meaning the day authority moved; this one changes meaning only when
   a human flips the flag, and the runbook records the flip.

2. **INSERT-ONLY. This is the load-bearing constraint.** Today's incremental
   lane builds a FULL deliverable row from the Linear issue — status, due date,
   title, brief — and writes every tracked issue whose fields drifted
   (`deliverableChanged` compares all fields). Pre-flip that is the design:
   Linear owns those fields. Post-flip it is a foreign write. Re-scoping the
   authority gate WITHOUT narrowing the write set would have B1 clobbering
   native SyncView state with Linear state on every pass — the exact write
   class `linear-inbound` deliberately refuses. In stray mode:
   - deliverables: written ONLY when no row exists for that
     `linear_issue_uuid`. Existing rows are never touched — no scalar refresh,
     no `linear_raw` refresh, no soft-close writes.
   - batches: written ONLY when the batch id does not exist.
   - `linear_archive`: keeps updating (a pure Linear-state mirror; no native
     authority in it).
   Known limitation, accepted: the `linear_raw` label-shape refresh on
   EXISTING rows (the F40 repair lane) goes dormant. New inserts carry the
   GraphQL shape, editors are told to stop editing in Linear, and if label
   drift reappears the revisit is this paragraph.

3. **Authority inverts, strictly.** Stray mode requires `write_safe === true`
   AND the team SYNCVIEW-authoritative — it withholds any team still on
   Linear, exactly as the classic lane withholds any team that is not. One
   importer behaviour per authority world, no overlap: classic mode cannot run
   in the post-flip world (its gates empty), stray mode cannot run in the
   pre-flip world (its gate refuses). The per-write re-read
   (`assertFreshLinearAuthority`) gets a stray twin demanding `syncview`.

4. **The filter becomes "active ⇒ import" — in stray mode only.** The classic
   operational filter (`linked || alreadyTracked || created >= cutoff`) is the
   reason 655 video issues have no native row. Stray mode's scope is
   `isTrackIssue && isOpenIssue`, nothing else. The owner's invariant is the
   spec: everything active is in SyncView.

5. **Parent-map synthesis — and this piece ships UNCONDITIONALLY, before F1.**
   `batchRowsFor` builds `linear_parent_ids` from the teams present in the
   imported group, which is how B1 mints ~6 video-only maps a day (item 16's
   regrowth). Synthesis: when a new batch row carries exactly one team's
   parent, mirror it into the other slot with `owner_team` naming the source
   board — byte-for-byte the shape the modern native flow writes and the
   item-16 backfill applied. `mergeBatchParentIds` already guarantees an
   existing different entry is never overwritten. Shipping this outside the
   flag ends the regrowth NOW rather than at F1, and its pre-flip behaviour
   change is nil beyond that: new imports simply arrive whole.

## The standing 655 need no new loader — they need the mode plus one dispatch

`buildIncrementalPlan` loads `loadIssues({ updatedSince: changedSince })`
before any filter runs, so no filter change can reach an unchanged issue; and
`mode=full` refuses since the graphics flip (`assertFullApplyAuthority` demands
BOTH teams on Linear). But the incremental lane already accepts an arbitrary
`changed_since`, and the repo has the precedent: the 2026-08-11 label repair
ran `changed_since=2020-01-01T00:00:00Z` (run `31509332785`) and traversed the
full window. So the one-time import is: **flip day + 1, dispatch the workflow
in stray mode with `changed_since=2020-01-01T00:00:00Z`, apply on.** Insert-only
materializes the missing rows; everything already present is skipped by
definition. The cursor advances off the terminal summary as today.

## What the plan reports (so the first run is auditable)

Stray mode's summary separates `inserted`, `skipped_existing`,
`withheld_authority`, per team. `test/public-b1-artifact.js` gates the public
artifact's fields and must learn the new keys in the same PR.

## Test plan (each with a mutation that must fail)

- stray mode refuses a Linear-authoritative team; classic mode refuses a
  SyncView-authoritative one (the existing assertions keep proving the second).
- insert-only: an issue with an existing row produces NO deliverable write in
  stray mode — mutate the split to "update anyway" and the suite must go red.
- synthesis: a video-only group yields both slots with `owner_team: 'video'`;
  an existing different graphics entry survives the merge untouched; mutate the
  mirror away and the suite must go red.
- filter: stray scope is open-track-issue only; classic scope is unchanged —
  byte-identical plans on a fixture where the modes should agree.

## Rollout order

1. PR 1: synthesis (unconditional) + its tests. Mergeable immediately; ends
   item-16 regrowth pre-flip.
2. PR 2: the stray mode behind the flag + tests + the public-artifact fields.
   Mergeable immediately; inert until the workflow env line flips.
3. Flip day: the workflow env paste + the full-window dispatch, recorded in
   `FLIP_RUNBOOK.md` alongside the F1 flag flip itself.
