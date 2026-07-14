# SyncView Go-Live Checklist — Linear → SyncView cutover

**Purpose.** The single canonical, owner-facing sequence for cutting production over from
Linear to SyncView. Rewritten 2026-07-13 after the full cutover audit
(`CUTOVER_AUDIT_2026-07-13.md`) — that register is the authority on WHY each gate exists.
Exact flag payloads and emergency procedures live in **`docs/ops/FLIP_RUNBOOK.md`** (owner-
executable, paste-able; no Codex required). If anything here disagrees with the live runtime
flags, trust the live flags and stop.

_This sequence supersedes all earlier flip orderings (audit F17). D-28's shadow-week soak is
satisfied by the staged parity enrollment below plus the nightly shadow audit — ratified by the
owner merging this file (see D-32)._

---

## Golden rules

1. **The owner holds every switch.** Nothing flips without a deliberate owner action.
2. **One team at a time.** Graphics (one person) first, then Video (D-28).
3. **Flip-back is one step — but drain first.** Before flipping a team's authority back to
   Linear, ALWAYS run the outbound drain and confirm that team's backlog is 0 (F05: skipping
   this strands up to ~an hour of the team's work). The exact recipe is in FLIP_RUNBOOK §R2.
4. **Cosmetic vs. data (D-29).** Looks-wrong → fix in place, keep going. Wrong-data-written →
   drain, then pause that team back to Linear, fix, re-flip.
5. **Green before you move — with real eyes.** A quiet alarm channel only counts once the
   non-n8n inbound pager (F09) is live; until then, silence can mean "the alarms are dead".

## Current state (update when flags move)

| Flag | Value today | Meaning |
|---|---|---|
| `prod_authority` | `{video: linear, graphics: linear}` | Both teams still run on Linear |
| `linear_outbound_enabled` | `off` | No mirroring back to Linear |
| `linear_inbound_enabled` | `enabled` | Linear → SyncView copy (always on until B5) |
| `linear_legacy_parity_enabled` | `disabled` | Transition write-lane off (armed at Phase 1) |
| `auth_enforcement` | `permissive` | Sign-in recorded but not required |
| `write_ui_reroute_clients` *(ships with the fix-pack)* | TEST only | Which clients' buttons use the new pipes (D-32 allowlist) |

Merged & live: #810 gateway (deployed), #811 guards + daily TEST drill + nightly shadow audit,
#812 mirror write-UI (locked for real teams), 62/62 client→project mappings, Samples retirement
+ rename. Parked: **#813** (reroutes + native Create-Post/Submit intake) — merges only at
Phase 0.5 below, after the fix-pack.

---

## Phase 0 — Preconditions (ALL boxes before #813 merges)

**Build/fix gates (Codex):**
- [ ] **Fix-pack landed in #813** (audit B-section): per-client allowlist gate (F02/F23),
      Kasper linkage predicate (F04), 401→sign-in dialog (F10), quarantine notice (F21),
      batch-picker team-filter + duplicate disambiguation (F19), +2d overdue bump ported per
      D-30 (F20), sync-drain lane for flipped teams (F07), oldest-pending-age pager (F16),
      monitors made flip-tolerant (F08).
- [ ] **Production-write TEST contract resolved** (F06): owner/implementation chooses the
      service-only spec contract or a newly justified browser-safe alternative; SPA, gateway, and
      one cross-boundary test agree. A complete dependency-aware EF manifest then deploys the exact
      merge SHA, download-fingerprint/readback matches, and positive/negative TEST drills are green.
- [ ] **Intake migration applied** (`production_intake_append` RPC) and pilot-verified on the
      TEST client.
- [ ] **Card resolvability sweep = 0 failures**: every active Linear-linked calendar slot
      resolves to exactly one mirror row; the ~60 missing rows backfilled (F11).
- [ ] **Client-token distribution rebuilt safely** (F03/F33): the public Clients Info sheet
      contains **no** review-token column; a staff-authenticated exact-client endpoint powers all
      four copy-link builders; then every SMM re-shares their clients' links. D-31's sheet
      mechanism is blocked pending the explicit owner decision in F33.
- [ ] **Track-A writers actually enforce auth** (F35): all six Calendar/Samples/settings write
      functions authenticate and authorize the exact client/operation, derive actor server-side,
      and emit real write-attempt telemetry; anonymous negative probes are green and the 72-hour
      zero-unkeyed-write gate is measured from those attempts, not sign-in events.
- [ ] **Submit graphics path drilled live** against the deployed EF, including real
      GRAPHIC_TITLE_* generation (F12).
- [ ] **Non-n8n inbound-divergence pager live + pager last-mile proven** with a synthetic DM
      (F09/B6).
- [ ] **Backup package built per D-1** (F13): 6-hourly GitHub export + one timed restore
      rehearsal into a scratch project; freshness alarm.
- [ ] **n8n quota fire resolved** (F01): burner identified/killed, hard-stop vs overage known,
      headroom projected past the flip window.

**People gates (owner/Kasper):**
- [ ] **Sign-ins 14/14** — server-verified via `syncview_auth_events` (as of Jul 13: 11/14;
      missing **Rocio**, **Martin**, the "Sidney" SMM row).
- [ ] **Slack IDs backfilled** for active team members and the URGENT-ping re-source
      smoke-tested on TEST (F15).
- [ ] **D-9 nightly roller** neutralized per the touchpoint-inventory owner actions, OR
      owner-signed detect-only risk acceptance; the shared `Form` API key consumer-mapped
      before any rotation (F14).
- [ ] **D-8/D-30 confirmed in code**: the +2d overdue bump behavior exists in the native path
      (owner chose KEEP, 2026-07-13).
- [ ] **Comms drafted** for parity-arm day (F24): "SyncView-relayed comments in Linear show
      author 'SyncView Mirror' with the real name in the body; if a tweak seems missing in
      Linear, check SyncView."

## Phase 0.5 — Merge #813 DARK

- [ ] Merge #813 with `write_ui_reroute_clients` = TEST only. **Nothing changes for real
      clients or staff** — their buttons still use the legacy paths.
- [ ] Same window: redeploy production-write from the merge commit; run the TEST drill; walk
      the TEST client through Create-Post (latest batch + new batch), Submit, approve, tweak,
      comment end-to-end.
- [ ] Verify a real client's calendar still saves/approves through the legacy path (allowlist
      really is dark).

## Phase 1 — Staged parity soak (real traffic, Linear still boss)

- [ ] Arm the parity lane: `linear_legacy_parity_enabled` → enabled (FLIP_RUNBOOK §F4).
- [ ] Enroll a first small cohort (2-3 real clients) in `write_ui_reroute_clients`. Their
      staff/client/Kasper writes now flow through the gateway and land in Linear via the
      parity drain — same outcome as before, new pipes.
- [ ] Watch 2-3 days: reconciler 0-diffs, drill green, no oldest-pending-age alerts, no
      quarantine/409 noise, spot-check tweak comments arriving in Linear.
- [ ] Enroll the rest of the roster in cohorts. Full-roster clean for **~1 week** = D-28's
      soak satisfied.
- [ ] During the soak: complete Rocio's day-one desk walk (B3) and the two-tab collision
      drill (B9).

## Phase 2 — Flip Graphics (Rocio)

Pick a low-activity window.
1. [ ] Toggle PITR ON for the flip week (D-1; owner dashboard).
2. [ ] Tell Rocio: work in SyncView only; problems → tell Sidney, never fall back to Linear
       silently.
3. [ ] `prod_authority.graphics` → `syncview`, then `linear_outbound_enabled` → `live`
       (FLIP_RUNBOOK §F1/§F2). Confirm readbacks.
4. [ ] Verify her first real write lands in Linear via the sync-drain lane (seconds if F07's
       lane shipped; otherwise expect 10-60 min and do NOT treat that lag as a failure).

## Phase 3 — Watch the Graphics window

- [ ] Reconciler 0-diffs; oldest-pending-age quiet; drill/audit lanes green (flip-tolerant
      per F08).
- [ ] Kasper's queue shows her natively-created thumbnails (F04 fix proven live).
- [ ] Apply D-29 on anything found. Rollback = FLIP_RUNBOOK §R2 (drain first!).

## Phase 4 — Flip Video

Same steps for `prod_authority.video` once Graphics is boring. All four editors signed in
first; tweak-delivery comms sent (F24).

## Phase 5 — B5: retire Linear (its own project)

Follow **TRACK_B_LINEAR_REPLACEMENT_SPEC.md §13** (8-week grace, archive-completeness + full
private export, then the reversible retirement order — Workload feeder, tweak-comments,
editors-week, inbound, readers). Assign an owner + ticket per replacement before starting.
Note (F26): retiring Linear does NOT retire n8n — ~20 non-Linear webhooks (templates, briefs,
filming plans, TikTok, hook library, weekly Slack, content-ready…) remain until their own
migrations (Track-A spec A4 rows) complete. New-client onboarding must mint mapping + token
(B2) before B5 makes Linear-side creation impossible.

---

## Rollback — always through FLIP_RUNBOOK §R2

Short version: **drain → confirm team backlog 0 → flip authority back → tell the team →
fix → re-soak → re-flip.** Never flip back without the drain step (F05).
