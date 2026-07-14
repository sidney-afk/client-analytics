# Track A — Moving the interactive SyncView write path from n8n to Supabase Edge Functions

> **Historical execution spec; Track A closed 2026-07-10.** Do not execute open/future wording in
> this file as current work. `ROLLBACK.md`, `docs/truth/*`, and the cutover register own live state.
> In particular, the shipped topology did not port every A3/A4 planning row below; retained n8n
> fallbacks and accepted baselines are deliberate until separately owner-approved retirement.

**Parent doc:** `INDEPENDENCE_PLAN.md` (read it first, including Appendix A).
**Reference doc:** `EDGE_FUNCTIONS_MIGRATION.md` (2026-06-29) — its guard-by-guard analysis of
`calendar-upsert-post` and `linear-status-sync` is authoritative for port fidelity. This spec
extends its scope (adds reorders, SXR, templates/prompts, filming-plan-tabs, event ledger) and
changes one decision: **both Phase 1 and Phase 2 of that doc are now committed, not conditional.**
**Ground truth:** `docs/audits/2026-07-03-n8n.md` (live workflow inventory + node detail),
`docs/audits/2026-07-03-code.md` (every FE call site), `docs/audits/2026-07-03-supabase.md`
(schema + what n8n enforces that the DB does not).
**These audits are a 2026-07-03 snapshot — the master plan's MANDATORY FIRST STEP (re-audit and
diff) applies before executing anything in this spec.** In particular: re-export the live n8n
workflows named below (guards/ALLOWED lists drift), and re-locate every `index.html` reference by
symbol, not line number.

## 1. Endpoint disposition table

Every interactive endpoint the SPA calls today, and what happens to it. "EF" = new Supabase Edge
Function. n8n workflow IDs are in the n8n audit.

| n8n webhook | Phase | Disposition |
|---|---|---|
| `calendar-upsert-post` | A1 | **Port to EF `calendar-upsert`** (the hot path; full guard gauntlet) |
| `calendar-reorder-batch`, `calendar-reorder` | A2 | **Port to EF `calendar-reorder`** (one function, batch payload; keep both FE fallback shapes) |
| `sample-review-upsert` | A2 | **Port to EF `sample-review-upsert`** (Supabase-only already; includes `sample_review_events` insert) |
| `sample-review-reorder` | A2 | **Port to EF** (same function pattern as calendar-reorder) |
| `linear-status-sync` (inbound Linear webhook, incl. samples + workload branches) | A3 | **Port to EF `linear-status-sync`** with HMAC verification, per `EDGE_FUNCTIONS_MIGRATION.md` Phase 1 |
| `linear-set-status` | A3 | **Port to EF** (mechanical; team-aware state mapping; keep the dueDate+2d bump behavior) |
| `linear-add-comment` | A3 | **Port to EF** (mechanical) |
| `linear-issue-statuses` (batched load-time reconcile) | A3 | **Port to EF** (one batched GraphQL query in, statuses out) |
| `templates-get` / `templates-save` | A4 | **Replace**: new `templates` table; FE reads Supabase directly (+realtime), writes via EF `templates-save` |
| `caption-prompts-get` / `caption-prompts-save` | A4 | **Replace**: new `caption_prompts` table, same pattern |
| `filming-plan-tabs` | A4 historical proposal | **Not ported / no current commitment.** QA route containment shipped; the existing n8n endpoint plus browser cache is the accepted baseline. Any server-cache replacement is a separately scoped optimization. |
| `calendar-get`, `kasper-queue`, `samples-get`, `sample-review-get` | A4 | **Retire the FE fallbacks** once A1–A2 have baked (they exist only as error fallbacks for reads the FE already does directly); keep the n8n workflows until Phase-4 cleanup |
| `calendar-append-post`, `calendar-delete-post` | A4 | **Dead code** — FE constants exist but are never called; archive the n8n workflows |
| `samples-upsert`, `samples-reorder` (Samples Old) | — | Phase-1 staff-route retirement shipped; legacy client/backend compatibility remains until owner-approved Phase 2 (F57). Do not delete or silently reactivate it. |
| `generate-caption`, `caption-job-status`, `caption-job-update` | — | Stay on n8n (long-running AI pipeline; D1) |
| `send-urgent-slack`, `linear-tweak-comments`, `editors-week`, `linear-projects`, `linear-subissues`, `video-form`, `graphic-form`, `log-linear-submission`, `add-to-calendar` | — | Stay on n8n; they are Linear-era machinery that **Track B deletes or replaces** — porting them now is wasted work |
| onboarding, sales-intake, TikTok (all), briefs/summaries, content-ready, weekly-slack | — | Stay on n8n (D1/D2) |

## 2. Conventions for all new Edge Functions

- Location: `supabase/functions/<name>/index.ts`, registered in `supabase/config.toml` with
  `verify_jwt = false` (same as the two existing functions). Deno; **pin `supabase-js`** and read
  the raw body before parsing (both quirks documented in `EDGE_FUNCTIONS_MIGRATION.md` §Risks).
- Follow the structure of `supabase/functions/client-credentials/index.ts` — it is the in-repo
  precedent for guarded service-role writes (CORS handling, timing-safe key compare, audit
  events, rev-ping bumping).
- Secrets via `supabase secrets set`: the service-role key is auto-injected; add
  `LINEAR_API_KEY`, `LINEAR_WEBHOOK_SECRET` (A3), `GOOGLE_SA_JSON` (A4 filming tabs),
  `SLACK_BOT_TOKEN` (Track B). **Never** commit any of these (public repo).
- Response contracts are **byte-compatible** with the n8n endpoints they replace. The FE, the
  reconciler, and the inbound sync all pattern-match on `{ok}` / `{ok:false, conflict:true}` —
  do not "improve" the envelope.
- Every function logs one structured line per request: `{fn, action, client, id, actor, role,
  outcome, ms}`. Actor/role come from new optional headers `X-Syncview-Actor` /
  `X-Syncview-Role` that the FE starts sending in A1 (self-declared in Track A — they feed the
  event ledger, not access control; enforcement arrives in Track B with role keys, D6/D7).
- `updated_at` stamping moves into each EF (n8n does it today; the DB does not — audit
  `2026-07-03-supabase.md` §6a). Keep the existing ISO-text format for ported columns exactly.

## 3. New tables in Track A

DDL sketches — final DDL must be written against the recovered live baseline (Phase 0.3):

```sql
-- A1: calendar gets the same append-only ledger samples already has.
-- Insert from the calendar-upsert EF (diff-based, same fields/semantics as
-- sample_review_events; source values: ui | linear | reconcile).
create table calendar_post_events (
  id bigint generated always as identity primary key,
  client text not null, post_id text not null,
  ts timestamptz not null default now(),
  actor text, role text, action text not null, component text,
  from_status text, to_status text, source text not null default 'ui',
  payload jsonb
);
create index on calendar_post_events (client, post_id, ts desc);
-- anon SELECT using(true) + add to realtime publication (parity with sample_review_events)

-- A4: templates + caption prompts leave Google Sheets.
create table templates (
  client_slug text primary key, data jsonb not null,
  updated_at timestamptz not null default now(), updated_by text
);
create table caption_prompts (
  client_slug text primary key, prompt text not null,
  updated_at timestamptz not null default now(), updated_by text
);
-- anon SELECT using(true); writes service-role only (via EF); realtime for templates.

-- A4: filming-plan-tabs server-side cache.
create table filming_plan_tabs_cache (
  doc_id text primary key, tabs jsonb not null,
  fetched_at timestamptz not null default now()
);
```

Backfill for A4: one-off script reads the Sheets tabs (Templates, CaptionPrompts on the
"SyncView Calendar" sheet `1Gsn…`) and inserts rows; after one clean week the n8n Sheets writers
for these two are retired and the tabs get a "MIGRATED — read-only" banner row.

## 4. Per-endpoint port notes (the non-obvious parts)

### 4.1 `calendar-upsert` (A1) — the one that matters

Everything in `EDGE_FUNCTIONS_MIGRATION.md` §Phase 2 applies verbatim. Summary of what must
survive the port, in order of how expensive a miss is:

1. **The 7-guard gauntlet** (read-failure, phantom-row, `__CLEAR_LINK__` sentinel, link-clobber,
   duplicate-link, conflict/LWW on `comments_base_at` vs stored `updated_at`, ALLOWED column
   allow-list). The live ALLOWED list must be captured from the live n8n workflow at port time —
   the newest repo backup (2026-06-14) predates `thumb_rev`, `kasper_finished_at/closed_at`,
   `kasper_finish_log`, and `title_*`.
2. **Comment merge stays in the DB**: call the existing `calendar_merge_comments` RPC with the
   service-role key. Do not reimplement the merge in TypeScript.
3. **Never write `video_status_at`/`graphic_status_at`** — DB triggers own those.
4. **Sheets mirror**: keep it during canary (fire-and-forget POST to the old n8n endpoint on a
   mirror-only flag? No —) simplest correct approach: during canary the OLD n8n workflow stays
   live and un-edited; the EF does **not** write Sheets. The Sheet mirror for calendar therefore
   goes stale for canaried clients only. Acceptable: the mirror is a backup, the weekly Drive
   backup (Supabase dumps) continues, and full cutover retires the calendar mirror entirely.
   Note this in the canary announcement to the owner.
5. **NEW: event ledger** — after a successful write, diff old→new row and insert
   `calendar_post_events` rows (status changes, comment adds/resolves/deletes, link set/clear,
   approvals, archive). Copy the diff logic from the live `sample-review-upsert` n8n workflow's
   "Diff & Insert Event" node.
6. **Cutover fan-in (the classic trap):** the URL lives in one FE const
   (`index.html:12625` area, used at ~13685, 15738, 19784, 20190, 24414, 28998) **plus**
   `scripts/linear-sync-reconcile.js` (`UPSERT_URL`) **plus** the inbound sync's internal upsert
   call. Flip via a canary allowlist (`CALENDAR_UPSERT_URL_EF` + client-slug list) applied in
   ALL of those places in one PR. Add a CI grep asserting the old URL string appears only in
   the fallback constant.
7. **Canary (historical execution record)**: start with the privately configured QA fixture, then 2–3
   real clients for 48 h, then all. Watch: `{ok:false}` rates, conflict rates, reconciler
   corrections (must be zero), p95 latency.

### 4.2 Reorders (A2)

Port from the live n8n JSON (repo backups are pre-Supabase = stale). The n8n version does 3
fixed Sheets batchUpdate calls + per-row Supabase mirror updates; the EF drops Sheets and does a
single transactional update of `order_index` for the submitted `{id, order_index}` items,
skipping unknown ids (same semantics). Response `{ok:true}`. FE already serializes/coalesces and
handles rollback (`_calReorderOptimistic`, 12 s pin, Undo toast) — do not change FE behavior
beyond the URL.

### 4.3 `sample-review-upsert` / `-reorder` (A2)

The n8n workflow (`gPY5DL4D0n5nwius`, backup `sample-review-upsert.2026-06-25.initial.json` is
current) is already Supabase-only — this is the cleanest port and should be templated from the
calendar-upsert EF. Preserve: patch-vs-whole-row handling, `sample_review_merge_comments` RPC
call, conflict contract, `sample_review_events` diff-insert, thumb_rev passthrough. The samples
status map differs from calendar (`scheduled`/`posted` → null) — see §4.4.

### 4.4 Linear bridges (A3) — minimal, faithful, disposable

These get deleted in Track B5; port them mechanically, no redesign.

- **`linear-status-sync` (inbound):** implement per `EDGE_FUNCTIONS_MIGRATION.md` Phase 1 —
  HMAC-SHA256 `Linear-Signature` over the raw body, ~60 s `webhookTimestamp` replay window,
  then the three branches exactly as the live n8n workflow (calendar patch, samples patch,
  workload_issues upsert). Internal upserts call the **EF** endpoints (they exist by A3).
  Deploy strategy: create a SECOND Linear webhook pointing at the EF, shadow-run (EF in dry-run
  log-only mode) alongside n8n for a few days, compare, then disable the n8n-pointing webhook.
  **Scoping gotcha (learned 2026-07-03, see master plan Phase 0.2/0.2b):** the existing n8n
  webhook was scoped to the Video team only, which silently deprived Graphics of realtime sync
  for its entire life. The new EF webhook MUST be created with **All public teams** (or at
  minimum both GRA and VID), Issue resource type — and the shadow-run comparison must include
  at least one Graphics state change.
- **The status mapping** becomes its 4th copy: hardcode in a shared module
  `supabase/functions/_shared/status-map.ts` + a CI test that extracts
  `_calMapLinearStatusStrict`/`CAL_PRIORITY` from `index.html` (the `grabFunc` pattern the tests
  already use) and asserts equivalence. **Map by Linear state UUID/type where possible, not
  name** — the live workspace has "Tweak Needed " (trailing space, Video team) and
  "For Client approval"/"For Client Approval" casing mismatches (audit `2026-07-03-linear.md`).
  The existing substring-based `mapStatus` handles these today; keep its exact semantics.
- **Outbound** (`linear-set-status`, `linear-add-comment`, `linear-issue-statuses`): straight
  ports; `LINEAR_API_KEY` from EF secrets. The FE's durable localStorage outbox + per-issue
  serialization stays as-is (it's the retry layer).

### 4.5 `filming-plan-tabs` (A4) — historical proposal, not committed work

The QA cold-context hammer was contained by route stubbing. The existing n8n endpoint and browser
cache remain the accepted production baseline. The former Edge Function/cache design below never
shipped and must not be treated as an outstanding Track-A promise; any future replacement needs a
fresh live response/credential/access audit, exact parity, a rollback gate, and separate approval.

## 5. What Track A explicitly does NOT do

- No auth enforcement (headers are logged, not checked) — Track B.
- No RLS changes, no per-client read scoping — Track B0 at the earliest.
- No Samples Old changes (D4). No onboarding/sales/TikTok/caption/brief changes (D1).
- No FE UX changes beyond URL constants + the new actor/role headers.
- No n8n workflow deletions until the Phase-4-style cleanup at the end of A4 — deactivate first,
  archive after a quiet week, delete only after B5.

## 6. Acceptance criteria (per phase, enforced at the gates in the master plan)

- Byte-parity harness: for each ported endpoint, a script replays a recorded request corpus
  (captured from the live n8n executions where retention allows, else synthesized from the FE
  payload shapes in `docs/audits/2026-07-03-code.md` §3) against old and new endpoints on a QA
  client and diffs both the response envelopes and the resulting Supabase rows.
- `npm test` green; `qa/master.js` full pass; nightly calendar+samples e2e green two nights in
  a row post-cutover.
- Reconciler correction count = 0 over the gate window (add the Slack alert first, Phase 0).
- p95 interactive save latency < 1 s measured from the FE (the existing "Saving…" chip timing),
  vs the current 5–16 s stall tail.
