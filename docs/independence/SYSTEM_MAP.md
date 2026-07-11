# SyncView System Map — v1 (Track-B optics)

**Status: LIVING DRAFT — deliberately incomplete.** First drawn 2026-07-11 as a working map for
the Linear-replacement program: every user-facing surface, what it reads/writes, and what
Track B touches at each phase. **The lens of this version is the Production tab / Track B**, not
the whole product — a v2 with whole-website optics (per-surface logic, state, edge cases, all
data flows at full depth) is planned and should replace the "verify" placeholders below.

**Freshness contract:** update this file in the same PR whenever a surface gains/loses a backend
(new EF, new n8n webhook, new table, retired path) — polish-level changes don't count. The
endpoint inventory below can be re-derived mechanically (`grep -oE "webhook/[a-z-]+" index.html`
and `grep -oE "functions/v1/[a-z-]+" index.html`) — if those lists drift from this file, the map
is stale. A `test/system-map-sync.js` enforcing that automatically is a wanted v2 addition
(mirror of the `repo-map-sync` pattern).

## 1. Surfaces

| Surface | What it does | Reads | Writes | Track-B impact |
|---|---|---|---|---|
| **Production tab** (`?prod=1`) | The in-app Linear: live mirror of all production work | `batches`, `deliverables`, `deliverable_events`, `team_members`, `clients` (REST, lightweight boot select since #779) | none (guarded read-only) | **CORE** — B4: writes via EFs + outbox→Linear; B5: the only production surface |
| **Linear tab** (submission) | Creates batch parent+subs in real Linear, background-writes calendar cards | `linear-projects`, `linear-issues` (n8n) | `linear-subissues`, `log-linear-submission` (n8n), cards via calendar-upsert EF | **HIGH** — B4: native create (spec §9.1, batch adoption); B5: webhook family retired (§13.4.g) |
| **Content Calendar** | Scheduling/review board; cards carry video+graphic slots | `calendar_posts` REST + realtime | calendar-upsert/-reorder EFs (n8n fail-safe); Linear pushes via n8n `linear-set-status`/`linear-add-comment`; caption AI via n8n | **HIGH** — B4: 4 link-predicate families re-point `linear_issue_id`→`*_deliverable_id` (§9.2); Linear legs → outbox; B5: link columns inert (§13.4.i) |
| **Samples New (SXR)** | Sample review lifecycle (SMM→Kasper→client) | `sample_reviews` REST + realtime | sample-review-upsert/-reorder EFs | **HIGH** — same re-point story as calendar |
| **Kasper mode** (`#kasper`) | Reviewer approval queue across clients | `kasper-queue` (n8n, batched) | approvals via calendar/samples EFs | **MEDIUM** — queue visibility gates are one of the §9.2 predicate families |
| **Workload** | Editor-load overview | Linear-derived rows via n8n (`editors-week`; feeder *verify*) | none | **MEDIUM** — B5: cuts to reading `deliverables` (§13.4.e) |
| **Client links** (`?c=`) | No-login client review pages, token-checked | calendar/samples tables, client-scoped | approvals via EFs; gate: client-token-verify EF | LOW — hardened by the auth flip, otherwise untouched |
| **Samples Old** | Legacy Sheets samples module | `samples-get` (n8n→Sheets) | `samples-upsert`/`-reorder` (n8n→Sheets) | RETIRING independently (SXR GA) |
| **Templates / Caption prompts** | Reusable templates; per-client caption prompts | `caption-prompts-get` (n8n, *verify*) | templates-save, caption-prompts-save EFs | LOW |
| **Filming Plans** | Per-client filming docs | filming-plans EF (new source table), `filming-plan-tabs` (n8n legacy) | — | LOW — filming/footage links also live on `batches` |
| **Analytics (home)** | Client performance overview | *verify — not yet traced* | *verify* | LOW (none known) |
| **TikTok Upload** | Upload/scheduling helper | n8n (*verify*) | n8n (*verify*) | LOW (none known) |
| **Onboarding / Sales intake** (`?onboarding`, `?intake`) | New-client forms with never-lose-a-submission fallbacks | — | `onboarding-submit`, `sales-intake-submit` (n8n); onboarding-capture EF fallback | LOW |

## 2. Backends

- **Supabase** — content: `calendar_posts`, `sample_reviews`, `content_samples`, filming plans,
  weekly reports · Track B: `batches`, `deliverables`, `deliverable_events`, `mirror_outbox`,
  `linear_archive` · auth/admin: `clients`, `team_members`, `client_access(+events)`,
  `syncview_auth_events`, `syncview_runtime_flags`, `flag_flips` · ledgers:
  `calendar_post_events`, `sample_review_events`.
- **Edge Functions (12 live):** calendar-upsert/-reorder, sample-review-upsert/-reorder,
  templates-save, caption-prompts-save, linear-inbound (mirror), client-token-verify, key-verify,
  client-credentials, filming-plans, thumbnail-folder-resolve, smm-weekly-reports,
  onboarding-capture.
- **n8n (55 webhook endpoints referenced by the app):** legacy write fail-safes (dormant since
  2026-07-07, one-flag rollback) · the `linear-*` bridge family (retires at B5) · reads + AI
  generation · intake · watchers (Edge Alert Relay, 15-min Monitoring Pager).
- **Linear:** 4 webhooks in → linear-inbound EF (realtime, measured ~1 s); new-issue adoption via
  the 30-min B1 incremental refresh; API out via n8n bridge until the B4 outbox; frozen at B5.
- **Google Sheets:** legacy mirrors, shrinking. **GitHub Actions:** 3 reconcilers, 2 nightlies,
  polish gate, unit tests, B1 refresh, Pages hosting. **Slack:** alerts + pings.

## 3. What changes, when

- **B3 (live now, metrics at zero 2026-07-11):** Linear authoritative; tab is a read-only
  mirror; team workflow unchanged; reconciler v2 every ~15 min.
- **B4 (gate ~2026-07-15, auth first):** per-team authority flip (`prod_authority[team]`,
  one-flag rollback); tab writable; calendar/samples predicates re-point; intake creates
  natively; outbound mirror keeps Linear current.
- **B5 (after 2 clean batch cycles/team):** Linear frozen → archived; `linear-*` n8n family and
  legacy card-write webhooks retired; Workload reads `deliverables`; SyncView is the whole
  production system.

## 4. Auth touches everything

The §6 login (three role keys + roster-name actor) lives at the write layer — every surface
saves through the same EFs, so one modal + the single `auth_enforcement` flag covers the whole
site at once. Client links stay no-login (minted tokens, server-verified). See
`B4_READINESS.md` §3 for the work-packages.

## 5. Verify list for v2 (mapped from docs, not re-traced)

Analytics data sources · TikTok Upload backend · Workload's exact n8n feeder · caption-prompts
read path · per-surface state/logic depth (localStorage keys, kill switches, caches) · the
mechanical `system-map-sync` test described in the freshness contract.
