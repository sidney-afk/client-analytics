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
| F01 | P1→P2 | n8n quota: 110,995/135,000 at Jul 13 22:33Z. **Burn already dropped** to ~6.4k/day (Jul 12-13) from ~15k/day (Jul 8-11); at 6.4k/day cap hits ~Jul 17. Consumers identified (Codex 2026-07-13): calendar reconciler `GP8CSZDNcy5sGdFr` ~3,300/day (redundantly dispatched by GitHub cron + `AkiFmromoDkmsh39` q10m + qll q15m; ~12 executions/run), TikTok pilot cron `LR6R1mV4NaLNLlLG` 1,440/day (runs every minute with ZERO pending rows), filming-plan-tabs ~610/day (legit browser). **No foreign writer / no D-9 burn.** Cap is a HARD STOP (Cloud Pro, no auto-overage) but raisable to 500k immediately if monthly Pro-2 (annual → contact support). | (a) Codex: deactivate `AkiFmromoDkmsh39` + the redundant GitHub cron (keep monitored qll dispatch), deactivate the TikTok cron → burn ~3.0-3.5k/day. (b) Owner: confirm monthly vs annual; if annual, ask support to raise the cap now. | IN-PROGRESS (cuts pending) |
| F09 | P1→P2 | The reconciler DID detect today's 6.4h mirror gap AND **the pager DID fire** — Codex verified qll DM'd Sidney at 05:00/06:00/07:00/08:00/09:00/10:15/11:30/12:45Z (v2_nonzero), plus a synthetic test DM (Edge Alert Relay exec 263676) delivered 22:40Z. So detection + last-mile are PROVEN (closes B6). Residual (still real): the pager IS n8n, so if n8n dies at the quota cap the alarm dies with it → silence reads as health. | Add the NON-n8n GitHub reconcile pager on 2 consecutive nonzero inbound diffs; configure its Slack webhook and prove the scheduled two-run latch/reset path. | IN-PROGRESS (schedule-only, run-deduped incident latch in fix-pack code; secret + scheduled proof pending) |

## B. Merge-day landmines (must close before #813 lands on Pages)

| ID | Sev | Finding (verified) | Next action | Status |
|---|---|---|---|---|
| F02 | P0 | "#813 ships inert" is FALSE: with today's flags every rerouted Linear-linked status/comment 409s (`legacy_parity_disabled`) and the new code blocks the SOURCE save too — approvals freeze company-wide between merge and parity-arm. GO_LIVE ordering would have caused days of this. | Gate the reroute behind a per-client allowlist flag (default TEST-only) so merge is genuinely dark; staged enrollment replaces big-bang. See D-32. | IN-PROGRESS (TEST-only flag seeded; PR pending) |
| F23 | P1 | GitHub Pages = single-deploy to 100% of users, no staging/canary; rollback = revert + multi-minute rebuild during which all writes fail. Same fix as F02 (allowlist = canary). | Same as F02. | IN-PROGRESS (TEST-only flag seeded; PR pending) |
| F03 | P1 | Every circulating client link is token-less; the write gateway has NO permissive bypass → post-merge client approves/comments would be lost at click. Tokens live only in service-role-only `client_access`; the public Clients Info CSV must never contain them. A 2026-07-13 attempted sheet export exposed the column, so it was immediately cleared and all 32 tokens were rotated. Exposure-window review found zero token-auth successes and zero non-TEST gateway UI events. | Replace D-31's unsafe sheet step with a staff-authenticated, service-side link issuer used by every copy-link builder; deploy it, then each SMM re-shares from the existing button. | IN-PROGRESS / SECURITY-CONTAINED (public column removed; 32 tokens rotated; secure issuer + browser wiring implemented/tested in fix-pack; deploy + re-share pending) |
| F11 | P1 | ~62 active calendar slots (~10 real clients) hold Linear URLs with no resolvable mirror row (e.g. GRA-6447, live in Kasper Approval) → post-merge those approvals hard-404 forever where n8n succeeds today. | Pre-merge sweep script + backfill (~60 mirror rows) + checklist gate "active-card resolvability = 0 failures". | OPEN (guarded dry-run found 191 vs ~60; apply blocked) |
| F12 | P1 | First real-client Submit post-merge is a never-executed path with 3 independent 409/503 modes, incl. unverified GRAPHIC_TITLE_* EF secrets (graphics title generation). | Run a graphics-mode TEST intake drill against the deployed EF NOW; add Phase-0 gates. | DONE (live graphics TEST drill, 2026-07-13) |
| F06 | P2 | No CI deploy path for production-write EF; the deployed EF is ALREADY ahead of main (hand-deployed from the #813 branch — how today's E2E passed). Pages merge ships a browser against an unpinned gateway. | Add production-write and its paired linear-outbound provider to one pinned EF deploy workflow; checklist step: redeploy both from the exact merge commit + re-drill. | IN-PROGRESS (paired deploy wiring in PR; merge-SHA deploy pending) |
| F10 | P2 | Post-merge, a signed-out Kasper/SMM clicking Approve gets a dead-end "Write not saved" toast — the sign-in dialog exists but is never invoked from write failures. | One-line patch: 401 → open the existing sign-in dialog. Sign-in coverage IS auditable server-side (syncview_auth_events; 11/14 signed in as of Jul 13 — missing: Rocio, Martin, "Sidney" SMM row). | IN-PROGRESS (fix-pack PR) |
| F21 | P2 | Genuinely-pending legacy outbox items (last-minute approvals) are silently quarantined at first post-merge load — never replayed, no operator surface. | Visible notice on nonzero quarantine ("N pending updates parked — redo or tell Sidney") + pre-merge quiesce step. | IN-PROGRESS (fix-pack PR) |
| F20 | P2 | The legacy +2-day overdue due-date auto-bump dies at reroute; dropping it was specced (D-8) but never owner-ratified. **Owner decided 2026-07-13: KEEP the bump** → it must be ported into the native path. See D-30. | Port flag-gated +2d-overdue-on-status-change behavior into the gateway write path. | IN-PROGRESS (default-on flag seeded; fix-pack PR) |
| F19 | P2 | Create-Post build (now landed in #813) still has: latest-batch picker can offer team-incompatible batches, and live duplicate same-name active batches (verified) are indistinguishable in the picker. | Filter/annotate the batch picker for team compatibility; disambiguate duplicates (created-time/team chips). | IN-PROGRESS (fix-pack PR) |
| F24 | P3 | At parity-arm, editors' tweak delivery transport + comment author identity change ("SyncView Mirror" + real name in body) with zero comms planned. | One comms line to both teams at parity-arm. | OPEN |

## C. Flip-day gaps (must close before the first team flips)

| ID | Sev | Finding (verified) | Next action | Status |
|---|---|---|---|---|
| F04 | P1 | After the Graphics flip, natively-created thumbnails NEVER enter Kasper's queue: his visibility gates test only the legacy URL column, which native intake leaves empty forever. | Shared predicate (URL-column OR deliverable-id) swapped into the 4 Kasper gates + 2 pill locks + regression test. | IN-PROGRESS (fix-pack PR) |
| F07 | P1 | Flipped-team writes are never synchronously mirrored to Linear — 10-60+ min lag by design (cron/pager drains only). GO_LIVE's "appears in Linear within a minute" check fails on a HEALTHY system → invites the F05 rollback. The 157-314ms E2E proof ran on the TEST lane, not this lane. | Add a syncview-live targeted-drain lane (fire-and-forget on write) OR rewrite expectations to 10-60 min. | IN-PROGRESS (fix-pack PR; paired production-write + linear-outbound merge-SHA deploy pending) |
| F05 | P1 | Flip-back rollback strands up to ~1h of the flipped team's undrained native writes (outbound pauses them; inbound then re-applies stale Linear over native rows). GO_LIVE said "nothing is lost" — false. | Mandatory rollback step 0: dispatch outbound drain, confirm team backlog=0, THEN flip authority back. Now in FLIP_RUNBOOK. | DONE (docs) / code unchanged |
| F15 | P1 | Editors' planned post-Linear push channel reads team_members.slack_user_id — NULL for all 20 rows; notify EF doesn't exist; no substrate replaces Linear Inbox. (n8n's hardcoded email→Slack map keeps today's ping alive mid-epoch.) | Backfill slack_user_id for active members (source: Slack member IDs / the n8n map); smoke-test the re-sourced ping on TEST before epoch re-source. | IN-PROGRESS (13/14 active IDs; Rocio + re-source smoke pending) |
| F16 | P1 | Pager can't see a stalled outbound path at flip volumes: backlog alert needs >100 rows AND growth; no oldest-pending-age alert; retry-exhausted rows vanish from all counts. | Add per-team oldest_pending_minutes to drain summary + page at threshold. | IN-PROGRESS (fix-pack PR; linear-outbound merge-SHA deploy + pager install pending) |
| F08 | P2 | Both daily write-path monitors hard-require authority=linear/linear → go permanently red the moment any team flips; Phase-3 "watch the monitors" becomes alarm fatigue. | Make drill + shadow-audit flip-tolerant before Phase 2. | IN-PROGRESS (fix-pack PR) |
| F14 | P1 | D-9 (nightly ~23:45Z due-date roller, unattributed) has an explicit "neutralize before authority flip" disposition + exit gate — GO_LIVE never mentioned it. Rotation fallback contradicts decision D9 and is blocked on mapping the shared `Form` key. | Phase-0 gate added (neutralize or owner-signed detect-only acceptance; map `Form` key first). Tripwire verdict pending tonight. | DONE (docs) / roller unresolved |
| F13 | P1 | Post-flip Supabase = sole system of record; owner-approved backup plan (6-hourly GH export + restore rehearsal + PITR-on for flip weeks, decision D-1) was never BUILT; weekly dump runs inside n8n (dies with F01). | Build the D-1 package as a blocking gate: GH-Action export + one timed restore rehearsal + PITR toggle checklist line. | IN-PROGRESS (authenticated, transactionally consistent pg_dump package in PR; read-only DB/Drive/HMAC credentials, PITR verification, and timed restore rehearsal pending) |

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
| B1 | ~~RLS posture~~ **CLOSED 2026-07-13**: Codex read live `pg_policies` — deliverables/calendar_posts/sample_reviews/batches/clients all have RLS enabled with SELECT-only policies and no INSERT/UPDATE policy → direct browser-anon writes are default-denied. The gateway cannot be bypassed via raw REST. | — |
| B2 | New-client onboarding post-flip is broken by construction: onboarding writes no project mapping and no review token → client #32 gets 409s + 401s. 62/62 was a one-time backfill, not a process. | Desk-walk onboarding EFs; add "new-client procedure" (mapping + token mint) — likely a small build ticket. |
| B3 | Rocio's day-one flipped-Graphics flow was never walked as a persona (her queue surface, assignment, done-marking, silent Linear inbox). | 1-hour desk walk of graphics-role surfaces before Phase 2. |
| B4 | Deployed-EF version fingerprinting: only production-write's drift was caught (by accident). Other EFs' deployed commits unknown. | Codex: dashboard version list vs merge timestamps; add commit-hash header to EFs. |
| B5 | ~~n8n burn source unidentified~~ **CLOSED 2026-07-13**: identified as redundant calendar-reconciler dispatch (3 triggers) + an idle every-minute TikTok cron — NOT a foreign writer or D-9. See F01. | — |
| B6 | ~~Pager last-mile unproven~~ **CLOSED 2026-07-13**: qll DM'd Sidney 8× during today's gap + a synthetic test DM delivered (exec 263676, 22:40Z). The last mile works — but see F09 (it's n8n-based, so a non-n8n backup is still needed). | — |
| B7 | Shared role keys + staff churn: no offboarding story (leaver keeps write access; rotation forbidden by old D9 decision). | 1-paragraph offboarding procedure; verify key replacement works without code change. |
| B8 | Supabase capacity/backup reality: Pro-plan limits vs post-#813 load never sized; "daily backups exist" rests on a doc note. | Owner: 5-min dashboard check (tier, backup list, usage graphs). |
| B9 | Concurrent-writer collisions (Kasper approves while SMM edits): CAS exists server-side but browser senders per path unverified; 409 UX likely a generic toast. | Grep senders; one two-tab TEST collision drill. |
| B10 | Stale-tab population unmeasured (no build-version telemetry); mobile/second-device sign-in & failure-toast behavior unwalked. | Add build-stamp check; 15-min phone walk. |

## Decisions taken from this audit (recorded in spec §14)

- **D-30 (owner, 2026-07-13):** KEEP the +2-day overdue auto-bump — port it into the native write
  path, flag-gated. Supersedes D-8's "drop it".
- **D-31 (owner intent, security-corrected 2026-07-13):** Fixed copy-link builders issue
  client-scoped links and each SMM re-shares from their own calendar's button. The token cannot
  transit the anonymously-readable Clients Info sheet; issuance must be staff-authenticated and
  service-side. The original sheet-export mechanism was contained and its tokens were rotated.
- **D-32 (owner, 2026-07-13):** #813's reroute ships behind a per-client allowlist flag defaulting
  to TEST-only. Merge is dark; real clients enroll in staged cohorts with parity armed. This
  replaces the "merge = everyone at once" model and satisfies D-28's soak intent with real traffic.
