# SyncView design kit — the locked Linear-replacement design

This folder is the **design source of truth** for the in-app Linear replacement (the
"Production" / SyncView workspace tab) planned in
[`../independence/TRACK_B_LINEAR_REPLACEMENT_SPEC.md`](../independence/TRACK_B_LINEAR_REPLACEMENT_SPEC.md).

It was produced by a dedicated design session that pixel- **and** behavior-matched the
prototype to real Linear via a capture → match → verify loop (11 adversarial re-audits, the
last several 0-high / 0-regression; a 138-assertion behavioral suite green). The build session
wires logic to this; it does not redesign it.

## Model (how the workspace maps to our world)
- **client = project**
- **shoot / batch = parent issue**
- **deliverable (video / thumbnail) = sub-issue** — with status, assignee, due date, comments
- **No manual "new issue."** Issues are created from the content-calendar / samples system
  (SMM makes a card → a sub-issue is auto-created under a chosen batch, or a new batch).

## Deliberately removed vs real Linear (simpler by design)
priority, labels, cycles, the Triage/Views/Inbox/Invite nav, the workspace switcher, and manual
new-issue. **Kept:** the Triage *status* (needed to migrate existing data). Light theme now;
dark mode is a later whole-site effort.

## Files (read in this order)
1. `HANDOFF.md` — start here; the design session's own handoff.
2. `CONTINUATION.md` — operational resume: prototype architecture, build/verify commands, gotchas.
3. `PARITY.md` — the parity checklist / backlog (what matches Linear, what's left).
4. `linear-design-tokens.md` — the **visual build spec** (measured Linear colors, type, geometry,
   status-icon system, interaction/menu specs). Build the real UI to these values.
5. `SyncView.html` — the **behavior source of truth**: the working single-file prototype.
   Live version: https://claude.ai/code/artifact/50e256f7-1438-45df-a808-bc2f312327e6
6. `PARITY-LOOP.md` — the behavioral changelog / "brain" (every interaction audit + fix).
7. `syncview-app.src.html` — survivable copy of the prototype source (has the `__INTER_B64__`
   font placeholder). `probe-data/*.json` are the raw pixel measurements from the probe.

## What's intentionally NOT committed here
The design session's **~19 MB of raw Linear reference screenshots** (`*.png`) are left out to
keep this public repo lean — they are reproducible from the probe and live in Sidney's local
`linear-design-probe/out/` folder. The measured values that matter are captured in
`linear-design-tokens.md` and the `probe-data/*.json` measurement files.

> **Note:** `SyncView.html` contains mock/sample data, including one example Google Drive folder
> link. It is placeholder content, not a live integration.
