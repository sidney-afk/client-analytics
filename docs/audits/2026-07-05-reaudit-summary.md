# Track B deep re-audit — SUMMARY & INDEX (2026-07-05)

Mandatory re-audit per `docs/TRACK_B_FABLE5_HANDOFF.md` §2–§3, run 2026-07-05 (repo @ `7a58b97`,
index.html 36,555 lines). Everything read-only; no live system was mutated. Eight parallel audit
passes, each diffed against the 2026-07-03 snapshots; the most plan-changing claims were then
**independently re-verified by a second reader** (marked ✅ below).

## The nine files

| File | Domain |
|---|---|
| `2026-07-05-linear.md` | Live Linear: teams/states/users/projects, exact open-issue counts, batch structure, comments, due-date roller |
| `2026-07-05-n8n.md` | Live n8n: inventory diff, deep reads of every Track-B workflow, bumper hunt, execution health, security |
| `2026-07-05-supabase.md` | Live Supabase via anon REST: tables, counts, flags, column shapes, ledger reality |
| `2026-07-05-sheets.md` | Clients Info / Video Editors / SMM tabs, roster 3-way diff, calendar-mirror workbook |
| `2026-07-05-logic-calendar.md` | index.html: content-calendar end-to-end logic (model, lifecycle, statuses, YT title, links, intake) |
| `2026-07-05-logic-samples.md` | index.html: SXR + Samples Old end-to-end logic |
| `2026-07-05-logic-reviews.md` | index.html: the three review flows (client / Kasper / SMM) as state machines + transition table |
| `2026-07-05-logic-sync.md` | index.html + scripts/: every Linear consistency surface (status/assignee/due/name/comments), reconcilers, outboxes, flags |
| this file | Headline diffs, verified claims, implications routing |

## Headline findings that CHANGE the Track B plan

1. ✅ **No `client_review_token` column exists** in Clients Info (12 cols A–L, `select M` → NO_COLUMN;
   0/29 tokens). All token-gate sites fail open ⇒ every client link is unguarded today. Spec §6.4
   changes from "move tokens" to **"mint tokens + re-issue every client link"** before fail-closed.
2. **SECURITY (act now, independent of Track B):** the "Social Media Managers" tab carries a
   `linear_api_key` column with 7 per-SMM Linear API keys, **publicly readable** via the same
   unauthenticated gviz CSV the app fetches (values not recorded anywhere in this audit). Also: the
   house Linear key is hardcoded in 6 n8n workflows; an Anthropic API key is hardcoded in 2 VIDEO
   PRODUCTION AUTOMATION nodes. Rotation + removal needed regardless; B5 teardown must rotate all.
3. **Linear sizing was ~2× off:** 89 non-archived projects (~75 unique clients), not 48. Open issues:
   **1,869** (GRA 470 / VID 1,399) including **841 backlog/triage items outside cycles** that the
   07-03 cycle-scope numbers missed. Open-by-createdAt: ≤3 mo **697**, ≤6 mo **924**, ≤12 mo
   **1,045**, older **824 (44% zombies, mostly 2023 VID backlog)**. `updatedAt` is unusable for the
   §5 cutoff (bulk touches make ~95% look recent) — **cut on createdAt/completedAt**.
4. **Batch mirroring is NOT universal:** July batches include one true GRA+VID mirrored pair, VID-only
   and GRA-only batches, single parents with mixed-team children, and bidirectional cross-team
   parenting. The spec's batch model + backfill must handle all four shapes. **137 open issues have
   no project** (client-attribution gap); archived history has legacy states ("Tweak Applied") and
   ghost authors. Hard-deleted issue ids exist (QA probes now delete).
5. ✅ **Priority is used again** on current work (Urgent/High/Medium on July batches, e.g. GRA-6450
   "Medium") — the "unused, do not build" premise is stale; owner decision needed (drop vs minimal
   urgent flag; the locked design has no priority UI).
6. **The nightly due-date roller is NOT in n8n** (measured elimination: full 22:30–23:59 UTC execution
   sweep). It still fires ~23:45 UTC but has degraded (15 bumps Jul 3, 2 on Jul 4, ~500 overdue
   untouched). Actor invisible read-only — needs Linear admin audit log / owner. The only n8n dueDate
   writer is linear-set-status's "+2d when overdue, on every call".
7. **SyncView's Linear comment prefix is now `**{Reviewer} (via SyncView):**`** (e.g. "Lily Baker"),
   not the fixed "Kasper" prefix documented on 07-03.
8. ✅ **Calendar "Posted" IS pushed to Linear** — `_calPushStatusToLinear` (15642) and its call sites
   have no Posted/Scheduled guard (the code comment claiming otherwise is stale), and n8n set-status
   maps 'Posted' exactly. Only SXR rejects Scheduled/Posted (29066/29097).
9. ✅ **Status pills are Linear-link-locked** on BOTH calendar and SXR cards ("Link a Linear sub-issue
   first", SXR 27458–27467, calendar mirror) — component status flow structurally depends on Linear
   links today; §9.2 re-point to `deliverable_id` is load-bearing, not cosmetic.
10. **Ledger reality:** 100% of 22,000 `sample_review_events` and all 473 `calendar_post_events` are
    `source='ui'` — `linear_in`/`linear_out`/`reconcile` have NEVER fired. The inbound/reconcile
    paths bypass the event ledger; `deliverable_events` must not clone that bypassability.
11. ✅ **SXR `kasper_finish_log` is dropped end-to-end** (FE writes it; column absent from
    `sample_reviews`; not in the EF allow-list). Calendar has the column + EF allows it.
12. **The SXR stale-Linear-regress protection is dead code** (`_sxrReassertLinearStatus` defined,
    never called; recent-save reconcile absent) — samples' only drift protections are a 5-min
    local-fresh merge guard + the 10-min reconciler… and **the samples reconciler is likely not
    running at all** (GH cron commented out; its n8n trigger `ZJOtYpQZj73DcBB1` inactive since 07-03).
13. **workload_issues contains 4 teams** (VID/GRA/CON 15/STR 13) and 56 messy client_name variants —
    the "2 teams" model needs an explicit filter; STR is a team key the 07-03 audit never saw.
14. **Runtime-flag audit trail unreliable:** `syncview_runtime_flags.updated_at` provably not
    maintained on update — Track B kill switches need an update trigger or flip log.
15. **Name/due/assignee: definitively NO sync in either direction today** (app rename never reaches
    Linear; Linear title/due/assignee reach only the read-only workload mirror + a nudge banner).
    §9.4/§9.6 are green-field builds, and the B3 "exact mirror" needs a NEW inbound writer — the
    existing inbound patch is status-only. Inbound COMMENT sync doesn't exist either (webhooks are
    Issues-only): B3's "reflect comments exactly" requires a new Linear webhook or polling.
16. **VIDEO PRODUCTION AUTOMATION ground truth:** Pick Freest Editor = fewest open sub-issues among
    Video Editors-tab emails (ties by API order); graphic-form assigns a **hardcoded single
    designer**; Claude generates graphics titles; **the AI-thumbnail chain is disconnected dead code**
    (already at baseline) — don't budget a port.
17. **Traffic collapsed** 25.6k → 4.0k executions/day after the QA filming-tabs stub (12,725→31);
    sample-review error burst gone (815→0). Real production write volume is small (~25 calendar
    upserts, ~41 set-status, ~27 inbound Linear events/day) — sizing comfort for EF-based sync.
18. **Roster truth:** app's effective roster = 33 names (sheet 29 + 4 seed-only); 3 sheet-only
    clients invisible to parts of the app; 1 SMM+Linear-only client (Jessica Encell Coleman)
    invisible to the app entirely; Terrina Mar duplicate slug pair (`terrinamar`/`terrinammar`)
    confirmed in the mirror workbook (63 tabs). `wlNormalizeClient` (9001) strips accents +
    leading "dr.", maps and/&→'&' — Track B §3 must port it exactly.
19. **Video Editors tab has NO slack_user_id column** (2 cols: name, email) — urgent-Slack resolution
    runs on a hardcoded fallback map inside the n8n workflow. Spec §5's "Slack ids from the Video
    Editors sheet tab" is wrong today; team_members backfill needs the n8n fallback map + the
    hardcoded FE allowlists (WL_VIDEO_EDITORS 8973, WL_ALLOWED_GRAPHICS 8964) + a manual Rocío row.
20. **Supabase plan/PITR unknown** — spec §7 assumes PITR; docs imply free tier where PITR is
    unavailable. Owner confirmation required before B1 (upgrade vs daily-export-only RPO).

## Confirmed unchanged (the plan may rely on these)

- Teams/states: only VID+GRA alive; all state UUIDs identical to 07-03; hazards re-verified
  char-exact (VID `"Tweak Needed "` trailing space; VID "For Client Approval" vs GRA "For Client
  approval"). Users: same 14; sidney@ still the integration identity. ~120 new issues/week.
- MJbMZ789B5ExZz9x (inbound Linear sync) ACTIVE again with A1/A2 flag routing inside it; all other
  Linear bridges byte-identical to baseline; weekly backup ran on schedule 07-05.
- Runtime flags all `{"clients":["sidneylaruel"]}` (TEST only) — matches ROLLBACK.md exactly.
- Spec §2 is fully additive: all six new tables 404 live; `deliverable_id` absent from
  `calendar_posts`/`sample_reviews`; no name collisions. `?prod`/`_prod*` namespace verified free.
- Write contract unchanged: `{client, post|sample, comments_base_at}`, `__CLEAR_LINK__` sentinel,
  guard gauntlet in n8n + EF ports; grabFunc extracts 11 symbols BY NAME (rename = silent break).
- calendar_posts 3,438 rows (299 live / 3,139 archived; 77% of rows are the TEST client);
  sample_reviews real-client usage ≈ 2 rows (SXR is GA but barely adopted by real clients yet).

## Corrections to the 2026-07-03 snapshots

- "Posted never pushed" (calendar) — FALSE (see #8). "~48 projects" — undercount (see #3).
- "Comments prefix `**Kasper (via SyncView):**`" — now `**{Reviewer} (via SyncView):**` (see #7).
- "Labels/priority unused" — priority now used (see #5); labels still unused.
- "Slack ids from Video Editors sheet" — no such column (see #19).
- Roller time fingerprint 23:00 → 23:45 UTC; coverage collapsed (see #6).
