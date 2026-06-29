# Edge Functions Migration Plan — `linear-status-sync` & `calendar-upsert-post` (n8n → Supabase Edge Functions)

> **Status:** PLAN — FUTURE / NOT YET IMPLEMENTED (drafted 2026-06-29). No Edge
> Function has been deployed, no n8n workflow has been changed, no Linear webhook
> has been repointed. This is a review-first plan; **apply nothing until signed
> off.** It needs more investigation and a dedicated implementation pass before
> any of it goes live. Snapshot/rollback IDs for the two hot handlers are
> recorded in [Snapshots / rollback](#snapshots--rollback-capture-before-any-edit).
>
> Companion docs (read these for current truth): `N8N_SAVE_LATENCY_AUDIT_2026-06-15.md`
> (the latency problem this targets), `LINEAR_SYNC_RECONCILE.md` (the safety net
> that stays unchanged), `CALENDAR_REALTIME_MIGRATION.md` (how the browser already
> reads Supabase directly), `AUDIT_2026-06-15.md` (Supabase-primary write path).

## TL;DR

The save-latency pain (`N8N_SAVE_LATENCY_AUDIT`) is n8n Code-node **cold-start /
runner-queue** latency on the shared n8n Cloud instance — the same trivial code
node measured **5 ms vs 14,622 ms** purely from waiting for a runner. The fix is
to move the two **hot, latency-sensitive** backend paths off n8n onto **Supabase
Edge Functions** (Deno isolates, ~42 ms median cold start, ~460 ms P99 — a 10–35×
improvement over the 5–16 s stalls), while **keeping n8n for everything else**
(AI caption/brief generation, TikTok pilot, onboarding intake, Slack, weekly
backups). The two paths:

1. **`linear-status-sync`** — the Linear→card webhook. **Migrate this first.** It
   is async, idempotent, Linear retries it, and it carries the **plaintext Linear
   API key** (a known security finding). Moving it also removes the
   runner-starvation amplification that *worsens* the calendar save latency.
2. **`calendar-upsert-post`** — the FE save webhook (the actual "Saving…" chip).
   **Migrate second**, once the pattern is proven. Riskier (it owns the guard
   gauntlet), but the hardest piece — the **atomic comment merge — already lives
   in Postgres** (`calendar_merge_comments`), so the port is thinner than it looks.

This is **not** a rip-out of n8n. It is a surgical, reversible, one-handler-at-a-
time move of two paths. Cost impact: **$0** (Edge Functions are inside the
Supabase free tier; see [Cost](#cost--does-this-force-us-onto-a-paid-plan)).
Rollback is **repointing one webhook URL**.

## Why now (the symptom)

- **Save latency.** `calendar-upsert-post`'s first Code node sometimes sits in the
  task-runner queue for 5–16 s before its JS even starts. Saves are optimistic, so
  no data is lost, but the per-card "Saving…" chip hangs and reads as "broken."
- **Amplification.** Every Linear state change fans a `linear-status-sync` run
  (historically a full `calendar-get`), and a single hung run can hold a runner
  for ~60 s — starving the upsert code nodes into the cold-start queue above.
- **Security.** The live `LINEAR_KEY` is a **plaintext string constant inside the
  "Handle Linear Event" code node** of each Linear-sync workflow (not an n8n
  credential). Repo backups redact it (`[REDACTED-LINEAR-KEY]`); it lives only in
  n8n. It must be rotated and moved to a secret regardless of this migration.

## What is NOT changing (scope guardrails)

- **Browser reads stay direct.** The FE already reads `calendar_posts`,
  `content_samples`, and `workload_issues` straight from Supabase REST and
  subscribes to **Supabase Realtime** (`cal-<slug>`, `kasper-cal`, `sm-<slug>`,
  `workload_issues` channels) with the publishable anon key under RLS. "Supabase →
  website" is **already** as direct as it gets. This migration does not touch it.
- **The reconciler stays as-is.** `scripts/linear-sync-reconcile.js` (+ the samples
  clone) runs on **GitHub Actions every ~10 min**, not on n8n. It is the
  most-recent-action-wins **guarantee** behind the best-effort webhooks and is
  unaffected by where the webhook handler runs. It keeps being the safety net
  during and after the migration.
- **n8n keeps everything else.** AI generation (`generate-caption`,
  `generate-brief`, …), TikTok pilot (`ttp-*`, `tiktok-upload*`), onboarding
  (`onboarding-submit`, `ai-onboarding-*`), Slack (`send-urgent-slack`,
  `weekly-slack-top-reel`), `syncview-weekly-backup`, and the shared read/push
  webhooks (`calendar-get`, `linear-issue-statuses`, `linear-set-status`). These
  are low-frequency; their cold-start cost is irrelevant.
- **The samples equivalents** (`sample-linear-status-sync`, `sample-review-upsert`)
  follow the *same* pattern and are explicitly **Phase 3+ / later** — out of scope
  for the first cut, but the design below is written so they drop in identically.

## Architecture today (what the two handlers actually do)

### `calendar-upsert-post` (n8n id `pWSqaqVw7dmqhYOA`)

- **Called by:** FE save → `POST /webhook/calendar-upsert-post`, body
  `{ client, post, comments_base_at }` (`CALENDAR_UPSERT_URL`, index.html:12625).
- **Node flow:** `Receive POST → Build Row From Patch → Read Existing Row → Read
  Link Twins → Merge Comments → Is Conflict? → (true: respond no-write | false:
  Strip Routing → Sheets mirror [fire-and-forget] + Prep Mirror → Supabase Mirror
  Update/Create)`. Supabase is primary; the Google Sheet is a best-effort
  off-path mirror (`onError: continueRegularOutput`).
- **The guard gauntlet (these MUST be preserved exactly — high blast radius):**

  | Guard | Protects against | Notes for the port |
  |---|---|---|
  | **Read-failure guard** | a store outage masquerading as "row not found" (→ phantom create / lost save) | `Read Existing Row` is `onError:continueRegularOutput`; detects `_readItem.error` and early-returns retryable `{ok:false}`. Real incident: exec 68798 hung 185 s. |
  | **Phantom-row guard** | misrouted skeleton save creating an empty ghost row in the wrong tab | refuses CREATE when no existing row AND zero `CONTENT_FIELDS`. THROWS (loud). |
  | **3-way comment merge** | concurrent comment loss / tombstone resurrection | `mergeCell` per `video/graphic/caption_tweaks`: union-by-`id`, newer `updated_at` wins (ties→incoming), keep existing only if newer than `comments_base_at`, drop tombstones >30 d. **Now done atomically in Postgres** — see below. |
  | **`__CLEAR_LINK__` sentinel** | needing to *intentionally* clear a Linear link | literal `'__CLEAR_LINK__'` forces stored link to `''`; a plain `''` never clears. |
  | **Link-clobber guard** | a stale/secondary-tab full-card save overwriting a real Linear link with `''` | carry stored link forward when incoming is blank. |
  | **Duplicate-link guard** | two live rows sharing one `linear_issue_id` (cards "disappear"/swap titles) | "Read Link Twins"; CREATE proceeds unlinked, UPDATE keeps its own link. |
  | **Conflict / LWW window** | two SMMs' date/title flip-flop | block scalar-changing saves when stored `updated_at` is newer than `comments_base_at`; comment-only and no-base saves pass. |

- **Atomic-merge addendum (APPLIED 2026-06-18, `migrations/2026-06-18-atomic-comment-merge.sql`):**
  the UPDATE branch now calls **`calendar_merge_comments(client, id, video, graphic,
  caption, title, base)`** inside a single row-locked `UPDATE calendar_posts`, then
  strips `*_tweaks` from the scalar mirror so the whole-cell race can't recur. The
  SQL `_calmerge_comment_cell` mirrors the JS `mergeCell` exactly. The function is
  `security invoker`, `revoke all … from public`, `grant execute … to service_role`
  — **callable only with the service-role key, never the anon key.** *This is the
  single most important fact for the port: the hardest guard is already in the DB.*

### `linear-status-sync` (n8n id `MJbMZ789B5ExZz9x`)

- **Triggered by:** a **Linear webhook** (Issue create/update) → `POST
  /webhook/linear-status-sync`. The FE never calls it.
- **What it does:** skip non-Issue / no-id / `create` / non-state-change events →
  GraphQL-fetch the issue (`identifier, state.name, team.key, project.name`) →
  `mapStatus` the Linear state → `slugify` the project to a client slug → find the
  matching card(s) → POST a **minimal** `{ id, video_status | graphic_status }`
  patch back through `calendar-upsert-post` per matched card.
- **Status mapping** (`mapStatus` in n8n == `_calMapLinearStatusStrict`,
  index.html:14643; substring match, first wins):

  | Linear state contains | → card sub-status |
  |---|---|
  | `tweak` | Tweaks Needed |
  | `scheduled` | Scheduled |
  | `posted` | Posted |
  | `approved` | Approved |
  | `smm` | For SMM Approval |
  | `kasper` | Kasper Approval |
  | `client` | Client Approval |
  | `backlog`/`todo`/`in progress`/`in process` | In Progress |
  | anything else (Canceled/Triage/…) | `null` → skipped, never propagated |

  Which sub-status an issue drives depends on **which link matched**:
  `linear_issue_id`→`video_status`, `graphic_linear_issue_id`→`graphic_status`
  (word-boundary regex). **Samples differ:** `scheduled`/`posted` map to `null`.
- **Ownership note (critical for the port):** the live handler does **not**
  recompute the overall pill or clear stale approvals itself — it sends the
  minimal patch and lets `calendar-upsert-post` + the FE (`computeOverallStatus`,
  `_calClearStaleApprovals`, index.html:12770/12785) + the reconciler own that.
- **Fan-out:** the original full `calendar-get` read (Google-Sheets-backed, pulls
  *every* row for the client on *every* state change) was the load problem. The
  current/targeted version uses `supaCandidates(slug, ident)` — a direct Supabase
  REST `ilike` query over a handful of rows, with the full read kept as fallback.
- **Lock-step warning:** `CAL_PRIORITY` (index.html:12720) is documented to "stay
  in lock-step with the n8n linear-status-sync PRIORITY table." There are **three**
  copies of the mapping/priority today: the FE, the n8n handler, and the reconciler
  (which extracts the FE's functions at runtime to stay in sync). See
  [Risk: a third copy of the mapping](#risk-a-third-hardcoded-copy-of-the-mapping).

## Decision

Move **only** `linear-status-sync` and `calendar-upsert-post` to Supabase Edge
Functions, **Linear-sync first**, using a **strangler-fig / shadow-then-cutover**
pattern with the existing n8n workflows kept as hot standbys. Keep n8n for all
other workflows. The reconciler remains the convergence guarantee throughout.

Rationale for **Linear-sync first**, despite the calendar save being the
user-visible symptom:
- **Lowest blast radius.** It is async and backend; a brief failure is invisible
  to users, Linear retries the delivery, and the reconciler heals any miss within
  ~10 min. The calendar upsert, by contrast, is in the user's save path.
- **It carries the security fix** (plaintext Linear key → secret).
- **It does not own the guard gauntlet** — it only maps a state and POSTs a
  minimal patch, so it is a smaller, safer first port that proves the whole
  pattern (signature verify, secrets, deploy, rollback) end-to-end.
- **It removes the amplification** that worsens the calendar latency — which may
  relieve enough of the save-stall pain that the riskier upsert port can be
  scheduled calmly rather than under fire.

## New problems this introduces (eyes open)

Edge Functions fix the cold-start latency but are not free of trade-offs. Take
these on deliberately:

1. **No durable retry / queue.** An Edge Function invoked by a webhook does **not**
   auto-retry on failure; it is request/response, not a queue. *Mitigation:* lean
   on **Linear's own webhook retries** for the sync handler, make every handler
   **idempotent** (upsert keyed on `(client, id)` / external issue id), and keep
   the **reconciler** as the convergence backstop. For the calendar upsert, the FE
   already retries; preserve that contract (return the same `{ok, conflict}` shape).
2. **Weaker observability.** You lose n8n's visual, per-execution, node-by-node
   replay. You get the Invocations tab + text logs (Logs Explorer, 1,000-row
   cap), with **1-day retention on Free / 7-day on Pro**. *Mitigation:* structured
   `console.log` with a correlation id per event; consider Sentry for the two
   handlers; keep the n8n version runnable for comparison during bake-in.
3. **Code-and-deploy, not click-around.** Functions deploy via the **Supabase CLI**
   (`supabase functions deploy`) / CI, not a browser workflow editor. This is a
   *win* long-term (version-controlled, unlike n8n today — `n8n-backups/` is the
   current workaround) but a different muscle. Keep functions in this repo.
4. **Deno runtime quirks.** Edge Functions run on Deno, not Node. `fetch` and Web
   Crypto (HMAC-SHA256 for signature verification) are built in — everything these
   two handlers need works. Gotchas: prefix every dependency (`npm:` / `jsr:` /
   `node:`), **pin versions** (a bad `supabase-js@2.49.9` once broke deploys; pin
   `2.49.8` or a known-good), and read the **raw request body before any JSON
   parse** so the signature is computed over the exact bytes.
5. **Single region per invocation + DB anchored to one region.** Not globally
   ubiquitous. For DB-heavy handlers, **pin the function to the DB's region**
   (`forceFunctionRegion` for webhook callers that can't set headers). The calendar
   upsert (DB writes) is a candidate to pin.
6. **Hard limits** (well clear for these handlers): CPU 2 s, wall-clock 150 s Free
   / 400 s Paid, memory 256 MB, function size 20 MB. Verify against the live limits
   page before relying on any number — Supabase has changed them (a stale doc still
   says 200 ms CPU; the canonical figure is 2 s).

## Migration plan (phased, each phase reversible)

### Phase 0 — Prerequisites (no production change)
- [ ] Install/auth the **Supabase CLI**; `supabase init` in this repo (or a
      `supabase/` subdir). Confirm the project ref `uzltbbrjidmjwwfakwve`.
- [ ] Create the Linear **webhook signing secret** + a **dedicated Linear API key**
      for the function (so the rotation is clean and scoped). Store both as Supabase
      secrets: `supabase secrets set LINEAR_API_KEY=… LINEAR_WEBHOOK_SECRET=…`.
- [ ] Confirm the `service_role` key is available to functions via the auto-injected
      `SUPABASE_SERVICE_ROLE_KEY` (or the new `SUPABASE_SECRET_KEYS` JSON). It is
      needed to call `calendar_merge_comments` (service-role-only) and to write
      `calendar_posts`. **Never ship it to the browser.**
- [ ] **Confirm the `calendar_posts` anon-SELECT RLS policy DDL.** The base table
      DDL is **not in the repo** (only ADD-COLUMN migrations exist). Capture the
      live policy so it can be recreated/verified — the function will write with the
      service-role key (bypasses RLS), but the browser still depends on that policy.

### Phase 1 — `linear-status-sync` → Edge Function (the first, safest cut)
1. [ ] `supabase functions new linear-status-sync`. Implement:
   - read `await req.text()` (raw) **before** parsing;
   - **verify** the `Linear-Signature` HMAC-SHA256 over the raw body with
     `LINEAR_WEBHOOK_SECRET` (Web Crypto `crypto.subtle`), and check
     `webhookTimestamp` is within ~60 s (replay guard);
   - port `mapStatus` + the link-match + the targeted `supaCandidates` read +
     dedupe-to-one-best-row;
   - POST the minimal `{ id, video_status | graphic_status }` patch to the **upsert
     endpoint** (still n8n `calendar-upsert-post` at this phase — they compose);
   - call Linear's GraphQL with the **raw key** in the `Authorization` header
     (Linear personal keys use **no** `Bearer ` prefix here).
2. [ ] Decide the mapping-source strategy — see
   [Risk: a third copy of the mapping](#risk-a-third-hardcoded-copy-of-the-mapping).
3. [ ] Local test: `supabase functions serve --no-verify-jwt`, tunnel with ngrok,
   point a **throwaway Linear webhook** at the tunnel, fire real Issue events,
   confirm signature + replay + correct patch.
4. [ ] Deploy with `verify_jwt = false` (Linear sends no Supabase JWT; the HMAC is
   the auth). URL: `https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/linear-status-sync`.
5. [ ] **Shadow run:** in Linear → Settings → API → Webhooks, add a **second**
   webhook at the function URL while the n8n one stays live. Run the function in
   **dry-run** (log the intended patch, don't POST it) and diff against n8n for a
   few days. Zero user impact (the n8n webhook is still authoritative).
6. [ ] **Cut over:** flip the function to write for real; **disable** (do not
   delete) the n8n `linear-status-sync` workflow. Keep both webhooks during bake-in.
7. [ ] **Rotate** the old plaintext Linear key (it is compromised-by-exposure).
8. [ ] Bake in 1–2 weeks; watch logs + the reconciler's correction count (a spike =
   the function is missing events).

### Phase 2 — `calendar-upsert-post` → Edge Function (the riskier cut)
1. [ ] `supabase functions new calendar-upsert-post`. Port the **guard gauntlet**
   faithfully (read-failure, phantom-row, `__CLEAR_LINK__`, link-clobber,
   duplicate-link, conflict/LWW) — reuse the JS from the n8n node nearly verbatim.
2. [ ] For the comment merge, **call the existing `calendar_merge_comments` RPC**
   with the service-role key — do **not** re-implement the merge in the function.
   This keeps the atomicity guarantee and a single source of truth for merge logic.
3. [ ] Preserve the **exact response contract** the FE depends on (`{ok}`,
   `{ok:false, conflict:true}`, retryable `{ok:false}`), so optimistic save +
   retry behavior is unchanged.
4. [ ] Keep the **best-effort Google-Sheets mirror** off the response path (or drop
   it if the Sheet is now purely vestigial — decide explicitly, don't drop silently).
5. [ ] Pin the function to the **DB region**.
6. [ ] Shadow/canary: route a **single low-traffic client** (or a `?ef=1` FE flag)
   to the function endpoint; compare written rows against n8n for that client; then
   widen. Keep n8n as the fallback URL.
7. [ ] Cut over by switching `CALENDAR_UPSERT_URL` in `index.html` (and the
   reconciler's `UPSERT_URL`) to the function; disable the n8n workflow; bake in.

### Phase 3+ — Samples & cleanup (later)
- [ ] Repeat Phases 1–2 for `sample-linear-status-sync` / `sample-review-upsert`
   (same pattern; samples merge RPC is `sample_review_merge_comments`; remember the
   samples mapping nulls `scheduled`/`posted`, and the append-only
   `sample_review_events` ledger).
- [ ] Only after clean bake-ins: delete the disabled n8n workflows and their Linear
   webhooks; remove the now-dead `calendar-get` full-read fallback if unused.

## Remediation options (ranked by leverage ÷ risk)

### 1. `linear-status-sync` → Edge Function (medium-low risk, high leverage)
Async, idempotent, Linear-retried, reconciler-backstopped; fixes the security
finding and the amplification. **Do this first.**

### 2. `calendar-upsert-post` → Edge Function (medium risk, highest user-visible payoff)
Directly kills the "Saving…" stall. Riskier (guard gauntlet) but de-risked by the
already-in-Postgres merge. **Do this second, canaried.**

### 3. Do nothing structural — just tune n8n (lowest risk, partial)
The latency audit's option 1 (runner concurrency / keep-warm on the n8n plan) and
option 2a (targeted read, already shipped) reduce the pain without a migration. If
the cold-start stalls become rare enough after those, this whole plan can stay a
plan. **Re-measure after the audit's infra fixes before committing to Phase 2.**

**Recommended sequence:** confirm the latency audit's infra/targeted-read fixes are
in and re-measure → Phase 1 (Linear sync, fixes security + amplification) →
re-measure the save stalls → Phase 2 only if the user-visible latency persists →
Phase 3 (samples) later.

## Snapshots / rollback (capture BEFORE any edit)

n8n's version history is the authoritative rollback; export each workflow to
`n8n-backups/` with a `_backup_note` **before** disabling it (never an inexact
hand-transcription). Capture the live `versionId` at edit-time.

| Workflow | n8n id | repo backup (latest) | rollback |
|---|---|---|---|
| Calendar — Linear Status Sync | `MJbMZ789B5ExZz9x` | `n8n-backups/linear-status-sync.2026-06-18.pre-freshness-guard.Handle-Linear-Event.js` (+ `.PROPOSED-targeted-read.jsCode.js`) | re-enable workflow; repoint Linear webhook URL back to n8n |
| Calendar — Upsert Post | `pWSqaqVw7dmqhYOA` | `n8n-backups/calendar-upsert-post.2026-06-14.post-readfail-guard.json` (+ `.2026-06-18.pre-atomic-merge.md`) | re-enable workflow; revert `CALENDAR_UPSERT_URL` in `index.html` |
| Samples sync / upsert (Phase 3) | _capture at edit-time_ | `n8n-backups/sample-linear-status-sync.2026-06-26.initial-create.json`, `sample-review-upsert.2026-06-25.initial.json` | same pattern |

**Rollback is fast and per-handler:** because the cutover point is a single URL
(the Linear webhook target, or `CALENDAR_UPSERT_URL`), reverting is seconds and
needs no redeploy. The two handlers roll back **independently** — a failed calendar
cutover never touches the (already-stable) Linear handler.

## Safety

- **Idempotency is mandatory** (no durable retry): every write is an upsert keyed
  on `(client, id)` / the external issue id, so a duplicate delivery during the
  shadow/overlap window is a no-op, not corruption.
- **Keep n8n as a hot standby** through a 1–2 week bake-in per handler; disable,
  don't delete, until clean.
- **The reconciler is the net.** It converges any missed event within ~10 min and
  **aborts without writing** if a single run wants > `CAP` (15) corrections — so a
  migration regression that drops many events fails loud and safe, not silently.
- **Preserve every guard.** The phantom-row, link-clobber, duplicate-link,
  conflict, and read-failure guards exist because of real incidents
  (`LINEAR_DRIFT_INCIDENT_2026-06-19.md`, the 2026-06-11 clobber, the 2026-06-24
  batch-poisoning). A port that "looks simpler" by dropping one is a regression.
- **Never expose the service-role key.** It lives only in the function's env. The
  browser keeps using the publishable anon key under RLS, unchanged.

## ⚠️ Security finding (carry over from `N8N_SAVE_LATENCY_AUDIT` / `AUDIT_2026-06-15`)

The live **Linear API key is plaintext** in the "Handle Linear Event" code node of
the Linear-sync workflows (`const LINEAR_KEY = 'lin_api_…'`), not an n8n
credential. This migration is the natural moment to fix it: provision a dedicated
key, store it as `LINEAR_API_KEY` via `supabase secrets set`, read it with
`Deno.env.get`, and **rotate the old key** at cutover. Until then it remains a live
exposure independent of this plan. (The Supabase keys in those same nodes are the
already-public publishable key — no action.)

## Risk: a third hardcoded copy of the mapping

`CAL_PRIORITY` and the Linear→card status map exist today in **three** places kept
in lock-step: `index.html` (FE), the n8n `linear-status-sync` PRIORITY table, and
`scripts/linear-sync-reconcile.js` — which cleverly **extracts the FE's functions
at runtime** (`grabFunc`/`grabConst` + `new Function`) so it can never drift. An
Edge Function port would, naively, add a **fourth** hardcoded copy that must be
manually kept in sync — exactly the drift risk the reconciler was built to avoid.

**Decide explicitly (open question):**
- **(a) Hardcode + test.** Copy `mapStatus`/`CAL_PRIORITY` into the function and add
  a CI check that diffs them against `index.html` (fail the build on drift). Simple,
  fast, but introduces the fourth copy.
- **(b) Fetch at runtime,** as the reconciler does: the function fetches the public
  `index.html`, extracts the canonical functions, caches them. No drift, but a
  startup dependency on fetching a ~2 MB page (cache aggressively).
- **(c) Move the mapping to one shared module** the FE, function, and reconciler all
  import. Cleanest long-term; biggest refactor; out of scope for a first cut.

Recommendation: **(a)** for the first cut (a CI drift-check is cheap and loud),
revisit **(c)** if a third consumer ever appears.

## Cost — does this force us onto a paid plan?

**No.** Edge Functions are included in the Supabase **Free tier** (500,000
invocations/month; no per-function fee). Two webhook/write handlers generate
hundreds–to–low-thousands of invocations/month — ~100× under the limit. The app is
already on Supabase Free for DB + Realtime, and live browser traffic keeps the
project from the 7-day inactivity pause. The thing that would *eventually* force
the $25/mo Pro plan is **not** Edge Functions — it is the **500 MB database size
cap** (Pro raises it to 8 GB). Verify current numbers on the live pricing page
before relying on them.

## Open items / first steps for the next session

- [ ] Re-measure save latency **after** the latency audit's infra + targeted-read
      fixes — option 3 may defer Phase 2.
- [ ] Recover/confirm the **`calendar_posts` base-table DDL + anon-SELECT RLS
      policy** (absent from the repo today).
- [ ] Choose the **mapping-source strategy** (a/b/c above) before writing Phase 1.
- [ ] Stand up the **Supabase CLI + secrets + a throwaway Linear webhook** in a dev
      project and validate signature verification end-to-end (the smallest possible
      proof before touching production).
- [ ] Decide the fate of the **Google-Sheets mirror** (still wanted as backup, or
      vestigial?) before Phase 2 drops or keeps it.

## Sources (research, accessed 2026-06-29)

- Edge Function cold starts (~42 ms avg / ~460 ms P99, July 2025 overhaul):
  https://supabase.com/blog/persistent-storage-for-faster-edge-functions ;
  architecture https://supabase.com/docs/guides/functions/architecture
- Limits (CPU 2 s, wall-clock 150 s/400 s, 256 MB, 20 MB, function counts):
  https://supabase.com/docs/guides/functions/limits
- Deno deps / npm+node compat: https://supabase.com/docs/guides/functions/dependencies ;
  https://supabase.com/blog/edge-functions-node-npm
- Regional invocation / `forceFunctionRegion`:
  https://supabase.com/docs/guides/functions/regional-invocation
- No built-in retry (request/response, not a queue):
  https://supabase.com/docs/guides/functions/error-codes ;
  large/durable work → Queues+Cron https://supabase.com/blog/processing-large-jobs-with-edge-functions
- Secrets: https://supabase.com/docs/guides/functions/secrets ; service-role vs anon
  & RLS: https://supabase.com/docs/guides/functions/auth
- Deploy / local dev: https://supabase.com/docs/guides/functions/deploy ;
  https://supabase.com/docs/guides/functions/quickstart
- Linear webhooks (config, signing, `Linear-Signature` HMAC-SHA256, raw body,
  `webhookTimestamp` replay): https://linear.app/developers/webhooks
- Strangler-fig migration pattern:
  https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig
- Pricing / free-tier limits (verify live before relying): https://supabase.com/pricing ;
  free-project pausing https://supabase.com/docs/guides/platform/free-project-pausing
