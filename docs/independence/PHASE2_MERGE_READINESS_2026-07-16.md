# Phase-2 merge readiness — whole-system audit (2026-07-16)

**Candidate:** branch `claude/reduce-n8n-linear-deps-vmphp6` @ `bb0ee4b` = current `main` (`6f2e0d4`)
+ the reconciled #813 write-UI Linear-replacement work + the F06 deploy guard (Parts A+B).
**Method:** eight parallel surface reviews (truth layer, Calendar writes, Samples/SXR, Submit/native
intake, Production mirror + gateway, sync machinery, ops/deploy, client-surfaces + roadmap), then
independent adversarial verification of all 33 medium/high claims against the checkout and read-only
live probes. Verdict of every surface: **READY_WITH_NOTES** — no surface returned NOT_READY.
**This document is the notes.** The dark merge is safe **after the Part C fix list below**; nothing
here blocks it besides those items.

## 1. What the dark merge actually does (verified, not assumed)

- **Pages redeploys `index.html`.** Every real client and staff member stays on the legacy lanes:
  the reroute allowlist (`write_ui_reroute_clients`) contains only the TEST client, and a
  missing/unreadable flag read deliberately fails to the LEGACY lane (opposite fail direction from
  the Track-A allowlists — documented in `docs/truth/BRIEFING.md` as of this PR).
- **No guarded backend deploys.** The F06 guard makes `linear-outbound` → `production-write`
  (provider first) deployable only via manual `workflow_dispatch` pinned to a 40-character SHA that
  must be an ancestor of `main`, with fingerprint attestation. `client-review-link` is in no deploy
  list. The frozen pair is untouched (byte-identical to `main`).
- **One honest exception:** the merge push re-fires `deploy-onboarding-edge-functions` (its own
  file is in its push paths and the candidate modifies it), redeploying the eight push-safe staff
  readers. Live fingerprinting shows all eight already match repo source byte-for-byte, so this is
  a same-source no-op redeploy. It is listed here so nobody is surprised by eight new version
  numbers on merge day.
- **The TEST client's new gateway lanes will 4xx until the release step runs.** Live
  `production-write` (hand-deployed v11) predates the candidate's contract (`intake_create`,
  batch append, reroute writer). This is expected, documented in `docs/truth/ENDPOINTS.md`, and
  confined to the TEST client; it resolves at the pinned dispatch deploy + intake migration apply.

## 2. Part C — pre-merge fixes (ALL FOUR SHIPPED AND CLOUD-VERIFIED at `139a4c8`)

1. **`production-write` CORS allowlist omits `x-syncview-source`** while both new write-UI callers
   send `X-Syncview-Source`. Browser preflight would kill enrolled-client (today: TEST) gateway
   saves and receipt reconciliation with the same `Failed to fetch` signature as the 2026-07-15
   share-button incident. One-line header fix in the candidate source (deploys with the release
   step). **FIXED at `139a4c8`** (`x-syncview-source` in the allowlist + caller-header contract test).
2. **Submit's client dropdown re-sources for ALL users at merge** (from the n8n `linear-projects`
   webhook to Supabase `clients.display_name`, ungated), while the untouched legacy n8n intake still
   resolves the per-SMM Linear key and target project from the submitted name. Any
   display-name/project-name divergence breaks that client's Submit for everyone. Fix: gate the
   re-source behind the reroute allowlist, or prove exact name equality for the full roster and add
   a guard test. **FIXED at `139a4c8`** — allowlist-gated: non-enrolled clients keep the legacy
   `webhook/linear-projects` names (endpoint restored to the truth layer; webhook count stays 55).
3. **Samples legacy-lane ordering inversion:** the candidate fires Linear status pushes/tweak
   comments BEFORE the sample row save (previously only after a successful save), for ALL clients.
   A failed save after a fired push = Linear told, SyncView not saved (reconcilers heal, but the
   legacy contract regressed). Fix: restore push-after-successful-save ordering in the legacy lane. **FIXED at `139a4c8`**
   (`deferLegacyUntilSourceSave` — legacy Linear pushes wait for a confirmed source save).
4. **Standing freeze landmine (pre-existing on `main`, NOT triggered by this merge — verified the
   candidate touches none of its trigger paths):** `deploy-thumbnail-edge-functions.yml` redeploys
   `calendar-upsert` + `sample-review-upsert` from repo source (the GATED, fail-closed versions) on
   any push touching `supabase/config.toml`, `_shared/staff-role-auth.ts`, its own file, the four
   function dirs — or ANY manual dispatch. One accidental trigger re-breaks every client link
   (the exact 2026-07-15 double outage). Fix: remove the frozen pair from that workflow's deploy
   loop (or add an explicit owner-approval input gate) until the owner-approved re-lock.
   **FIXED at `139a4c8`** — the deploy loop now covers only the two thumbnail functions.

## 3. Post-merge release runbook (replaces the #813 body's runbook)

1. Owner merges the candidate; records the merge SHA. (Nothing visible changes.)
2. Apply `migrations/2026-07-13-production-intake-append.sql` (+ the two small flag migrations if
   not already present) in the Supabase SQL editor; read back.
3. Manual `workflow_dispatch` of `deploy-onboarding-edge-functions` pinned to the exact merge SHA:
   deploys `linear-outbound` before `production-write`, runs fingerprint attestation.
4. TEST drills: gateway create/status/comment/due ladder on the TEST client, 401→sign-in flow,
   non-enrolled real client proven byte-identical to pre-merge behavior; reconcilers 0/0/0.
5. Obsolete #813 runbook items — do NOT execute: its F13 backup item (superseded by the live #840
   backup), its F03 token/re-share item (superseded by the freeze + live issuer), its
   `SLACK_ALERT_WEBHOOK` requirement (now optional warn-skip).
6. F11 card-resolvability backfill runs fresh at first enrollment (its last dry run found 191
   proposed promotions / 2 unresolved / 4 duplicates vs the ~60 estimate — resolve that discrepancy
   before applying).

## 4. Gate checklists (verified against the register at the checkout)

**Before enrolling the FIRST real client** into `write_ui_reroute_clients`:
F27 (executable rollback/undo), F42 (import legacy comments), F133 (canonical title — confirmed
still present in the candidate: intake commits generic `Video N` titles), F134 (browser-only intake
recovery — confirmed still present), F32 (Linear-outage resilience for intake), F53 (delivery
attach), F65 (Samples audit trail), F101 (single-team Advanced intake unguarded in the new-batch
lane), F11 backfill at zero-unresolved, Part C items deployed live, plus the release-step drills.
**2026-07-20 correction:** the earlier “F12 is DONE” conclusion was unsupported. The guarded
generation source is deployed; the opt-in TEST harness is merged and available in the
repository/Actions, not part of the deployed artifact. The ordinary drill skips real generation,
and no durable receipt proves `graphic_generation_verified:true` plus provider-failure
zero-write/recovery behavior. F12 remains OPEN in the current register.

**Before the first Graphics authority flip:** F37 (identity-bound "My issues"), F136 (transition
matrix), F98 (fail-safe forward order — docs corrected, executable drill missing), F131/F132
(monitoring terminal receipts / lane isolation), plus the enrollment gate above proven on the TEST
client and the F42/F133/F134 cohort items closed for the flipped team.

## 5. Documentation corrections shipped in this PR

- `docs/truth/LINEAR.md`: the #813 reroute is merged-and-dark in the candidate (was "unmerged, not
  dark-gated").
- `docs/truth/BRIEFING.md` + `docs/truth/SUPABASE.md`: `write_ui_reroute_clients` (and its
  legacy-fail direction) + `pto_v1` added to the flag story.
- `docs/truth/ENDPOINTS.md`: PTO entry corrected to LIVE-ON under owner decision D-36 (the stale
  "Do not enable yet" directive was an outage-by-doc risk for a live HR tool); ⛔ freeze markers on
  the two upserts (was "deploy after merge", contradicting the freeze); EF count 17→18 literal (`pto`); webhook count stays 55 (Part C restored `linear-projects` for the
  legacy Submit lane); onboarding SPA callers marked live
  (were "candidate until merge").
- `docs/truth/N8N.md`: webhook count 54. `docs/truth/APP.md`: status-pill/`parent_id`/transport
  invariants scoped per cohort (legacy lane vs enrolled gateway lane).
- `docs/independence/SYSTEM_MAP.md`: internal 17-vs-18 self-contradiction fixed.

Full audit transcripts (8 surveys + 33 verifications) remain in the private session record; this
file is the public-safe distillation. No client names, tokens, keys, or HR values appear here.
