# SyncView Go-Live Checklist — Linear → SyncView cutover

**Purpose.** The ordered, owner-facing steps to move a production team's work from
Linear into SyncView, one team at a time, with an instant flip-back. Written to be
followed calmly on the day. If anything here disagrees with `ROLLBACK.md` or the live
runtime flags, trust the live flags and stop.

_Last updated: 2026-07-13._

---

## Golden rules (read first)

1. **The owner holds every switch.** No team goes live except by a deliberate flag flip
   the owner makes. Nothing here happens automatically.
2. **One team at a time.** Graphics first, then Video (decision D-28). Never both at once.
3. **Flip-back is always one step.** At any moment you can return a team to Linear by
   flipping its authority back. Rehearse it before you need it.
4. **Cosmetic vs. data (decision D-29).** A *cosmetic* bug (something looks wrong) is
   fixed in place — you do **not** flip the team back. Only a *data-integrity* bug
   (a status/comment/assignment lands wrong or gets lost) pauses that team back to Linear.
5. **Green before you move.** Every step waits on the watchers being quiet. A noisy
   watcher is a stop sign.

---

## Current state (the starting line)

Live runtime flags as of last check:

| Flag | Value | Meaning |
|---|---|---|
| `prod_authority` | `{video: linear, graphics: linear}` | Both teams still run on Linear |
| `linear_outbound_enabled` | `off` | SyncView is not writing back to Linear |
| `linear_inbound_enabled` | `enabled` | SyncView mirrors Linear → SyncView (the always-on copy) |
| `auth_enforcement` | `permissive` | Sign-in checked but not yet required |
| `linear_legacy_parity_enabled` | `disabled` | The transition write-lane is off (armed only at go-live) |

Everything the team does today runs exactly as before. The new system is installed
but dormant.

---

## Phase 0 — Preconditions (ALL must be true before flipping ANY team)

Do not flip a team until every box is checked.

- [ ] **Code merged and dormant:** #810 (gateway), #811 (guards + monitors), #812
      (write UI) merged to `main`. _(Status: #810 ✅, #811 ✅, #812 pending.)_
- [ ] **The reroute switch merged:** #813 rebased, re-reviewed, and merged. It ships
      inert — it only takes effect for a team once that team's authority flips.
- [ ] **Project mappings complete:** all **62** team-tagged project mappings persisted
      and owner-reviewed. _(Currently 0/62 — this is the hard blocker for new-batch
      submissions. Needs a dedicated review session with the owner.)_
- [ ] **Backend deployed and proven live:** the `production-write` gateway and the
      `linear-outbound` writer are deployed, and the auth behavior is verified with real
      principals — a wrong/blank credential is refused (401), a valid-but-forbidden
      action is refused (403), and a real-team write while that team is still on Linear
      is refused (409).
- [ ] **Everyone can sign in:** every active staff member has completed role-key sign-in,
      and every client link in circulation carries its access token.
- [ ] **Quiet soak passed** (see Phase 1).
- [ ] **Flip-back rehearsed:** you (or Codex) have practiced the rollback flip on the
      TEST client and confirmed it returns to Linear cleanly.

---

## Phase 1 — Quiet soak (prove it before anyone touches it)

Let the system run untouched and watch the automatic monitors for **several clean days
in a row**:

- [ ] Daily TEST-write drill: green every day.
- [ ] Nightly full audit: 0 differences every night.
- [ ] The reconciler (Linear vs SyncView): 0 differences on its regular runs.
- [ ] The alarm channel: quiet (no real alerts — see `docs/ops/MONITORING.md`).

If any of these is noisy, diagnose and clear it before moving on. A clean soak is the
evidence that the write path is safe.

---

## Phase 2 — Flip Graphics first

Pick a **low-activity window** (e.g. end of day) so few people are mid-action.

1. [ ] Post a heads-up to the Graphics team: "In ~15 min, Graphics moves to SyncView.
       Finish what you're mid-way through, then switch to working in SyncView."
2. [ ] Turn on the transition write-lane: `linear_legacy_parity_enabled` → **enabled**.
       (This is what lets SyncView mirror Graphics changes back into Linear during the
       transition, so anyone still watching Linear stays in sync.)
3. [ ] Flip authority: `prod_authority.graphics` → **syncview**.
4. [ ] Enable the mirror-back: `linear_outbound_enabled` → **live** (start at `shadow`
       for a few minutes first if you want a dry-run, then `live`).
5. [ ] Confirm the exact resulting flag values against `ROLLBACK.md` (have Codex hand you
       the exact command for steps 2–4 during prep — the owner runs it, but the precise
       payload should come from the deploy runbook, not memory).
6. [ ] Tell the Graphics team: "You're live — work in SyncView now."

> ⚠️ Video is untouched. `prod_authority.video` stays `linear`. Video keeps working in
> Linear exactly as before.

---

## Phase 3 — Watch the live Graphics window

For the first hours/days after the Graphics flip:

- [ ] Watch the reconciler and the alarm channel — they should stay at 0 differences /
      quiet.
- [ ] Spot-check a few real Graphics actions end-to-end: a status change and a comment
      made in SyncView should appear correctly in Linear within a minute.
- [ ] Collect team feedback. Apply decision D-29:
  - **Cosmetic** issue → fix in place, keep Graphics live.
  - **Data-integrity** issue → go to Rollback for Graphics, tell the team to work in
    Linear meanwhile, fix, re-flip.

Only move to Video once Graphics has been stable and quiet for a comfortable stretch.

---

## Phase 4 — Flip Video

Same as Phase 2, for the Video team:

1. [ ] Heads-up to the Video team.
2. [ ] `prod_authority.video` → **syncview**. (The parity lane and outbound are already on
       from the Graphics flip — confirm, don't re-toggle blindly.)
3. [ ] Tell the Video team: work in SyncView now.
4. [ ] Watch as in Phase 3.

When both teams are live and stable, the migration's active phase is done.

---

## Rollback — return a team to Linear (any time)

If a **data-integrity** problem shows up for a team:

1. [ ] Flip that team's authority back: `prod_authority.<team>` → **linear**.
2. [ ] Tell that team: "Work in Linear for now while we fix something — don't use SyncView
       for status/comments until I say."
3. [ ] The mirror keeps copying Linear → SyncView, so nothing is lost; the team's work in
       Linear flows back in.
4. [ ] Fix the issue, re-run a quick soak check, then re-flip when clean.

This is per-team — flipping Graphics back does not affect Video, and vice-versa.

> The full "stop everything" rollback (both teams back, outbound off, parity off — the
> D-26 pause we already rehearsed live) is documented in `ROLLBACK.md`.

---

## Phase 5 — Later: retire Linear (B5)

Only after both teams are live and stable for a good while, and as a separate deliberate
project:

- [ ] Point the remaining read-only views (e.g. the Workload board) at SyncView's own data
      instead of the Linear-fed cache.
- [ ] Retire the Workload reconciler and the `workload_issues` cache (this is what froze
      during the n8n outage — it goes away).
- [ ] Retire the legacy Linear readers and the transition parity lane.
- [ ] Turn off Linear.

At that point SyncView is fully independent and there is no per-seat Linear cost or n8n
execution cap left to hit.

---

## Flag quick-reference

| Flag | Off / Linear state | Live / SyncView state |
|---|---|---|
| `prod_authority.<team>` | `linear` | `syncview` |
| `linear_outbound_enabled` | `off` | `live` (or `shadow` for dry-run) |
| `linear_inbound_enabled` | `enabled` (always on until B5) | `enabled` |
| `linear_legacy_parity_enabled` | `disabled` | `enabled` (during transition only) |
| `auth_enforcement` | `permissive` | `enforcing` (tighten once everyone's signed in) |

_Confirm the exact JSON payloads with `ROLLBACK.md` / the deploy runbook at prep time.
The owner makes every flip; nothing here is automatic._
