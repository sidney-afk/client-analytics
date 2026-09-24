# SyncView feature usage audit (2026-09-24)

Read-only inventory by the Pruner session. Nothing was changed. Counts only; no client names or slugs.

**Evidence windows.** Database rows: last 30 days (`updated_at`/`created_at`/`submitted_at`). Edge Function calls: **last 24 hours only** (the Supabase log API caps queries at 24 h, so "0 calls" means "not called today", not "dead"). n8n executions: since 2026-08-25. Fragment sizes are line counts from `src/index/INDEX.md`. TikTok pilot (`#tiktok-pilot`) skipped per owner (being removed).

| Page / tab / route / tool | What it is | Fragments (lines) | 30-day evidence | Verdict |
|---|---|---|---|---|
| Analytics home (`#` / `#<client>`) | Staff overview and per-client analytics numbers. | 050 (1.7k), 000/005/030 shell | `key-verify` 1,582 calls in 24 h (every staff load) | Live |
| Calendar (`#calendar`, `#calendar/<slug>/<card>`) | Content calendar where staff plan posts and clients approve them. | 120–190 (~16.8k) | 4,758 posts and 19,064 post events written; `calendar-upsert` 15,971 calls / 24 h | Live, heaviest |
| Calendar: Generate Caption | Button that transcribes a video and drafts a caption. | 180/190 | 5 n8n runs (all on 2026-09-22) | Live, light |
| Calendar: caption prompts | Per-client caption prompt editor. | 190 | 1 row; 2 `caption-prompts-save` calls / 24 h | Live, rare |
| Production (`?prod=1`) | Linear-style production board (cards, comments, descriptions). | 210–260 (~16.2k) | 2,499 deliverables, 617 comments, 38 description images; `production-write` 8,034 / 24 h | Live |
| Workload (`#workload`) | Editor workload calendar and plan. | 070–090 (~9.5k) | 225 plan rows; `workload-plan` 2,284 / 24 h | Live |
| SyncLinear (`#linear`) | Linear issue list view. | 070/090 | reads `workload_issues` (3,836 rows); no write endpoint to measure | Likely live (read-only, unmeasured) |
| Sample reviews (`#sample-reviews`, `?sxr`) | Client/Kasper review of sample videos. | 270–290 (~7.3k) | 1,339 reviews, 12,981 events; `sample-review-upsert` 125 / 24 h | Live |
| Old Samples (`#samples`) | Retired route; now redirects to Sample reviews. | inside 270–290 | `content_samples` 0 rows written | **Dead (redirect only)** |
| Templates (`#templates`) | Per-client template/brief sheet. | 060 (1.8k), 020 CSS | 8 rows updated; n8n `templates-save` 0 runs (moved to Edge Function) | Live, light |
| Filming plans (`#filming-plans`, Kasper tab) | Filming plan editor. | 060 | 4 plans updated; `filming-plans` 304 / 24 h | Live |
| Market / general briefs (brief tab renderers) | AI-generated market research briefs. | 050 (1.7k) | Calls `generate-*-brief` n8n webhooks; **no matching workflow exists in n8n** | **Likely dead** |
| TikTok upload (`#tiktok-upload`) | Staff uploads a video to TikTok via Post For Me. | 300 (1.7k) | 6 n8n submits, 1 account touched | Live, light |
| Time off (`#time-off`, Kasper tab) | Staff PTO calendar. | 110 (2.2k) | 12 requests total, 0 adjustments in 30 d; `pto` 254 / 24 h (reads) | Live (viewed, rarely written) |
| SMM weekly reports (`#smm-weekly-report[s]`) | Weekly form SMMs fill in, plus Kasper's viewer. | 110 | 21 reports; `smm-weekly-reports` 973 / 24 h | Live |
| Kasper: Review Session | Kasper's queue of posts to review. | 320/330 (~5.5k) | 4 urgent-review Slack runs; reviews counted under Calendar/Samples | Live |
| Kasper: Messages | Reply thread view for Kasper. | 320 | no dedicated endpoint (reads calendar comments) | Unmeasured |
| Kasper: Editors | Editor labor-week report. | 330/340 (~1.3k) | n8n `editors-week` **0 runs** | **Likely dead** |
| Kasper: Sales Intake | Form that creates the agreement and payment email for a new sale. | 310 (shared with pilot) | 4 `sales_intakes` rows, but 0 n8n runs of the submit workflow in 30 d (conflict, worth a look) | Live, rare |
| Kasper: Hiring Process | Job application pipeline. | 330 | 23 applications updated; `hiring-applications` 69 / 24 h | Live |
| Kasper: Onboarding | Viewer of onboarding form submissions. | 100 (2.3k) | list endpoints ~47 calls / 24 h | Live |
| Kasper: Client Credentials | Stores client login credentials. | 320 | 12 rows updated | Live |
| Kasper: Ad Performance | Meta ad numbers for the agency. | 320 | 36 daily rows, 12 leads synced; 2 reads / 24 h | Live, rare views |
| Kasper: Quiz Leads | List of quiz funnel leads. | 320 | 4 quiz responses; `quiz-leads-list` 0 / 24 h | Live, rare |
| Onboarding form (`?onboarding=`, `/onboarding_form`) | Public client onboarding form. | 100 | 4 submissions, 5 fallback rows; `onboarding-full` 260 / 24 h | Live |
| AI onboarding form (`?onboarding=ai`) | AI-avatar variant of the onboarding form. | 100 | `ai_client_onboarding` **0 rows** | **Likely dead** |
| Onboarding viewer (`?onboarding_view=`) | Private link to view one submission. | 100 | covered by list calls above | Live |
| Intake (`?intake=1`) | Legacy intake page. | 200 (1.5k) | no write endpoint found; `legacy_*` tables only | **Likely dead (verify)** |
| Client link (`?c=<token>`) | Client's private view of calendar/samples. | 005/260 | `client-token-verify` 259 / 24 h; `client-review-link` 94 | Live |
| Write diagnostics | Background error reporter. | 120 | `write-diagnostics` 75 / 24 h | Live (infra) |

## Likely dead, in order of confidence

1. **Old Samples route** (redirect only, table untouched in 30 d).
2. **AI onboarding funnel** (0 submissions in 30 d).
3. **Market/general brief generators** (their n8n webhooks no longer exist).
4. **Kasper Editors tab** (its n8n workflow ran 0 times).
5. **`?intake=1` page** (no live write path found; confirm before removing).

Also worth a look: Sales Intake wrote 4 rows while its n8n workflow shows 0 runs.
