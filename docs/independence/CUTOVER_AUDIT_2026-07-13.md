# Full Cutover Audit — 2026-07-13 (findings register)

**What this is.** On 2026-07-13 the owner commissioned an exhaustive multi-agent audit of the
entire Linear→SyncView cutover: 8 parallel system maps (SMM / Kasper / client / editors+designer /
samples lifecycle / intake / live systems / docs), 4 gap-hunting lenses (merge-day, flipped
operations, dependencies & retirement, plan soundness), adversarial verification of every
candidate finding against code and live data, and a completeness critic. **26 findings survived
verification (0 were refuted).** This file is the durable register so later sessions build on it
instead of rediscovering it. Full evidence (file:line cites, live queries) lives in the audit
session transcript; this register carries the operative one-liners.

**Status legend:** `OPEN` (nothing landed) · `IN-PROGRESS` (assigned/being built) ·
`DONE` (fix merged/verified) · `ACCEPTED` (owner accepted the risk/behavior).

Severity: P0 breaks a real user's day or loses data at the step where it occurs; P1 must fix
before that step (merge / flip / B5); P2 has a workaround; P3 polish/comms.

## A. Urgent — independent of go-live

| ID | Sev | Finding (verified) | Next action | Status |
|---|---|---|---|---|
| F01 | P1 | n8n quota: 109,287/135,000 on Jul 13, ~8.5k/day burn → exhaustion ~Jul 16-17. At cap, ALL n8n dies: today's staff+client Linear write bridges, calendar/sample inbound, all Slack/DM alerting, weekly backup. The ~8.5k/day burst consumer is unidentified. | Codex: per-workflow execution breakdown Jul 8-13; kill/throttle the burner; confirm hard-stop vs overage; owner pre-authorizes emergency upgrade. | IN-PROGRESS (Codex session running) |
| F09 | P1 | "Green before you move" is unsound: the only thing that can PAGE on inbound divergence is n8n itself (dies with quota); reconciler detected today's 6.4h mirror gap but DM delivery is unproven. GitHub lanes stay green during divergence → silence reads as health. | Codex: add a non-n8n paging step to the reconcile workflow (Slack webhook on 2 consecutive nonzero inbound diffs); prove the pager last-mile with a synthetic DM. | OPEN |

## B. Merge-day landmines (must close before #813 lands on Pages)

| ID | Sev | Finding (verified) | Next action | Status |
|---|---|---|---|---|
| F02 | P0 | "#813 ships inert" is FALSE: with today's flags every rerouted Linear-linked status/comment 409s (`legacy_parity_disabled`) and the new code blocks the SOURCE save too — approvals freeze company-wide between merge and parity-arm. GO_LIVE ordering would have caused days of this. | Gate the reroute behind a per-client allowlist flag (default TEST-only) so merge is genuinely dark; staged enrollment replaces big-bang. See D-32. | IN-PROGRESS (fix-pack) |
| F23 | P1 | GitHub Pages = single-deploy to 100% of users, no staging/canary; rollback = revert + multi-minute rebuild during which all writes fail. Same fix as F02 (allowlist = canary). | Same as F02. | IN-PROGRESS (fix-pack) |
| F03 | P1 | Every circulating client link is token-less; the write gateway has NO permissive bypass → post-merge client approves/comments would be lost at click. Tokens for all 31 clients ALREADY exist (client_access.review_token) but the sheet has no column and 3 of 4 copy-link builders never append `&t=`. | Wire tokens into the sheet + all copy-link builders; then each SMM re-shares via the existing "share link with client" button (owner decision D-31). | OPEN (fix-pack) |
| F11 | P1 | ~62 active calendar slots (~10 real clients) hold Linear URLs with no resolvable mirror row (e.g. GRA-6447, live in Kasper Approval) → post-merge those approvals hard-404 forever where n8n succeeds today. | Pre-merge sweep script + backfill (~60 mirror rows) + checklist gate "active-card resolvability = 0 failures". | OPEN (fix-pack) |
| F12 | P1 | First real-client Submit post-merge is a never-executed path with 3 independent 409/503 modes, incl. unverified GRAPHIC_TITLE_* EF secrets (graphics title generation). | Run a graphics-mode TEST intake drill against the deployed EF NOW; add Phase-0 gates. | OPEN (fix-pack) |
| F06 | P2 | No CI deploy path for production-write EF; the deployed EF is ALREADY ahead of main (hand-deployed from the #813 branch — how today's E2E passed). Pages merge ships a browser against an unpinned gateway. | Add production-write to the EF deploy workflow; checklist step: redeploy from the exact merge commit + re-drill. | OPEN (fix-pack) |
| F10 | P2 | Post-merge, a signed-out Kasper/SMM clicking Approve gets a dead-end "Write not saved" toast — the sign-in dialog exists but is never invoked from write failures. | One-line patch: 401 → open the existing sign-in dialog. Sign-in coverage IS auditable server-side (syncview_auth_events; 11/14 signed in as of Jul 13 — missing: Rocio, Martin, "Sidney" SMM row). | OPEN (fix-pack) |
| F21 | P2 | Genuinely-pending legacy outbox items (last-minute approvals) are silently quarantined at first post-merge load — never replayed, no operator surface. | Visible notice on nonzero quarantine ("N pending updates parked — redo or tell Sidney") + pre-merge quiesce step. | OPEN (fix-pack) |
| F20 | P2 | The legacy +2-day overdue due-date auto-bump dies at reroute; dropping it was specced (D-8) but never owner-ratified. **Owner decided 2026-07-13: KEEP the bump** → it must be ported into the native path. See D-30. | Port flag-gated +2d-overdue-on-status-change behavior into the gateway write path. | OPEN (fix-pack) |
| F19 | P2 | Create-Post build (now landed in #813) still has: latest-batch picker can offer team-incompatible batches, and live duplicate same-name active batches (verified) are indistinguishable in the picker. | Filter/annotate the batch picker for team compatibility; disambiguate duplicates (created-time/team chips). | OPEN (fix-pack) |
| F24 | P3 | At parity-arm, editors' tweak delivery transport + comment author identity change ("SyncView Mirror" + real name in body) with zero comms planned. | One comms line to both teams at parity-arm. | OPEN |

## C. Flip-day gaps (must close before the first team flips)

| ID | Sev | Finding (verified) | Next action | Status |
|---|---|---|---|---|
| F04 | P1 | After the Graphics flip, natively-created thumbnails NEVER enter Kasper's queue: his visibility gates test only the legacy URL column, which native intake leaves empty forever. | Shared predicate (URL-column OR deliverable-id) swapped into the 4 Kasper gates + 2 pill locks + regression test. | OPEN (fix-pack) |
| F07 | P1 | Flipped-team writes are never synchronously mirrored to Linear — 10-60+ min lag by design (cron/pager drains only). GO_LIVE's "appears in Linear within a minute" check fails on a HEALTHY system → invites the F05 rollback. The 157-314ms E2E proof ran on the TEST lane, not this lane. | Add a syncview-live targeted-drain lane (fire-and-forget on write) OR rewrite expectations to 10-60 min. | OPEN (fix-pack) |
| F05 | P1 | Flip-back rollback strands up to ~1h of the flipped team's undrained native writes (outbound pauses them; inbound then re-applies stale Linear over native rows). GO_LIVE said "nothing is lost" — false. | Mandatory rollback step 0: dispatch outbound drain, confirm team backlog=0, THEN flip authority back. Now in FLIP_RUNBOOK. | DONE (docs) / code unchanged |
| F15 | P1 | Editors' planned post-Linear push channel reads team_members.slack_user_id — NULL for all 20 rows; notify EF doesn't exist; no substrate replaces Linear Inbox. (n8n's hardcoded email→Slack map keeps today's ping alive mid-epoch.) | Backfill slack_user_id for active members (source: Slack member IDs / the n8n map); smoke-test the re-sourced ping on TEST before epoch re-source. | OPEN |
| F16 | P1 | Pager can't see a stalled outbound path at flip volumes: backlog alert needs >100 rows AND growth; no oldest-pending-age alert; retry-exhausted rows vanish from all counts. | Add per-team oldest_pending_minutes to drain summary + page at threshold. | OPEN (fix-pack) |
| F08 | P2 | Both daily write-path monitors hard-require authority=linear/linear → go permanently red the moment any team flips; Phase-3 "watch the monitors" becomes alarm fatigue. | Make drill + shadow-audit flip-tolerant before Phase 2. | OPEN (fix-pack) |
| F14 | P1 | D-9 (nightly ~23:45Z due-date roller, unattributed) has an explicit "neutralize before authority flip" disposition + exit gate — GO_LIVE never mentioned it. Rotation fallback contradicts decision D9 and is blocked on mapping the shared `Form` key. | Phase-0 gate added (neutralize or owner-signed detect-only acceptance; map `Form` key first). Tripwire verdict pending tonight. | DONE (docs) / roller unresolved |
| F13 | P1 | Post-flip Supabase = sole system of record; owner-approved backup plan (6-hourly GH export + restore rehearsal + PITR-on for flip weeks, decision D-1) was never BUILT; weekly dump runs inside n8n (dies with F01). | Build the D-1 package as a blocking gate: GH-Action export + one timed restore rehearsal + PITR toggle checklist line. | OPEN |

## D. Plan & docs (truth/executability) — fixed in this PR unless noted

| ID | Sev | Finding | Status |
|---|---|---|---|
| F17 | P1 | Three docs prescribed three different flip sequences; D-28's ratified shadow-week missing from the checklist; Phase-2 misdescribed the parity lane. | DONE — GO_LIVE rewritten as the single canonical sequence (parity soak model per D-32; D-28 satisfied by staged parity enrollment + nightly shadow audit — ratified by owner merging this PR). |
| F18 | P1 | No paste-able flag payloads anywhere; "deploy runbook" cited twice didn't exist; checklist's `enforcing` value silently fails open (code accepts only `enforced`). | DONE — docs/ops/FLIP_RUNBOOK.md created; checklist corrected. |
| F22 | P2 | ROLLBACK.md rows for #811/#812/gateway were in stale pre-merge voice; row 68 claimed "no browser caller" after the caller shipped. | DONE — rows corrected to merged-state, caller-first rollback. |
| F25 | P3 | GO_LIVE Phase 5 was 4 ownerless bullets while spec §13 has the real ordered B5 plan. | DONE — Phase 5 now links spec §13; replacement build tickets still to be assigned. |
| F26 | P2 | "No n8n execution cap left to hit" post-B5 is false: ~20 non-Linear n8n webhooks (templates, briefs, TikTok, filming plans, hook library, weekly Slack…) + Google Sheets remain load-bearing; A4/Track-A spec rows exist but are incomplete. | DONE (claim corrected in GO_LIVE) / migrations OPEN |

## E. Residual blind spots (completeness critic) — not yet closed

| # | Blind spot | Cheapest closure |
|---|---|---|
| B1 | RLS posture: can the public anon key INSERT/UPDATE core tables directly (bypassing the gateway)? Never verified. | Codex: pg_policies review, read-only. (Bundled into the urgent Codex session.) |
| B2 | New-client onboarding post-flip is broken by construction: onboarding writes no project mapping and no review token → client #32 gets 409s + 401s. 62/62 was a one-time backfill, not a process. | Desk-walk onboarding EFs; add "new-client procedure" (mapping + token mint) — likely a small build ticket. |
| B3 | Rocio's day-one flipped-Graphics flow was never walked as a persona (her queue surface, assignment, done-marking, silent Linear inbox). | 1-hour desk walk of graphics-role surfaces before Phase 2. |
| B4 | Deployed-EF version fingerprinting: only production-write's drift was caught (by accident). Other EFs' deployed commits unknown. | Codex: dashboard version list vs merge timestamps; add commit-hash header to EFs. |
| B5 | The n8n ~8.5k/day burn source is unidentified (may itself be a foreign writer à la D-9). | Same Codex session as F01. |
| B6 | Pager last-mile never proven end-to-end (all "it pages" claims are doc-faith; 2h dispatch gap observed today). | Synthetic DM test + qll execution log for today 05:00-13:30Z. |
| B7 | Shared role keys + staff churn: no offboarding story (leaver keeps write access; rotation forbidden by old D9 decision). | 1-paragraph offboarding procedure; verify key replacement works without code change. |
| B8 | Supabase capacity/backup reality: Pro-plan limits vs post-#813 load never sized; "daily backups exist" rests on a doc note. | Owner: 5-min dashboard check (tier, backup list, usage graphs). |
| B9 | Concurrent-writer collisions (Kasper approves while SMM edits): CAS exists server-side but browser senders per path unverified; 409 UX likely a generic toast. | Grep senders; one two-tab TEST collision drill. |
| B10 | Stale-tab population unmeasured (no build-version telemetry); mobile/second-device sign-in & failure-toast behavior unwalked. | Add build-stamp check; 15-min phone walk. |

## Decisions taken from this audit (recorded in spec §14)

- **D-30 (owner, 2026-07-13):** KEEP the +2-day overdue auto-bump — port it into the native write
  path, flag-gated. Supersedes D-8's "drop it".
- **D-31 (owner, 2026-07-13):** Client links get tokens via the sheet + fixed copy-link builders;
  each SMM re-shares from their own calendar's "share link with client" button. No central re-send.
- **D-32 (owner, 2026-07-13):** #813's reroute ships behind a per-client allowlist flag defaulting
  to TEST-only. Merge is dark; real clients enroll in staged cohorts with parity armed. This
  replaces the "merge = everyone at once" model and satisfies D-28's soak intent with real traffic.
