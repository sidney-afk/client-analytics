# Quality tiers — what this website promises, zone by zone

**Owner-ratified contract** (draft assignments below proposed 2026-07-17; the owner may move
any surface between tiers — that placement IS the product decision). Every QA skill
(`/site-assurance`, `/bug-archaeology`, `/master-test`, `/overnight-test`, `/human-audit`,
`/feedback-expansion`) uses this file as its prioritization ground truth.

The principle: a living website is never permanently perfect. What it CAN have permanently
is **a kept promise per zone** — and perfection *per zone, per polish pass*, preserved by
regression guards. Different zones carry different promises; that is what a standard is.

## Tier 0 — Never knowingly broken (client-facing)

**Promise:** zero tolerated defects; monitored daily; any incident is drop-everything;
every fix ships with a regression guard. Changes near this tier follow the strictest
review; the ⛔ client-writer freeze (AGENTS.md) governs its writers.

- Client review links (`?c=` load, calendar view, samples review) — reading AND saving
  (approve / comment / status).
- Share-link issuance (`client-review-link`) — staff mint links clients depend on.
- Client-visible thumbnails/media rendering.

**Freshness window** (max age of the last positive proof): 7 days (plus the existing
daily monitors/reconcilers).

## Tier 1 — No silent failures (staff daily workflow + HR data)

**Promise:** may break, but never silently — fail closed, preserve typed work (drafts /
receipts), alert; defects fixed within ~a working day; core paths regression-guarded.

- Calendar planning + staff writes; Samples/SXR + Kasper approval flow.
- Submit intake (form → n8n → Linear → cards), including its receipts/fallback.
- Staff sign-in/identity; the Linear mirror's data correctness (dark lanes included).
- **PTO data correctness** (balances, approvals, accrual math — HR numbers are Tier 1
  even though PTO's cosmetics are Tier 2).

**Freshness window:** 14 days.

## Tier 2 — Correct, with batched polish (staff comfort)

**Promise:** functions correctly; cosmetic/UX imperfections are tolerated for days-to-weeks
and batched into polish passes (`/feedback-expansion`, `/human-audit`); data shown must
still be true.

- PTO tracker UI/UX; Workload view; analytics/market-research views; templates;
  filming plans; weekly reports UI.

**Freshness window:** 30 days.

## Tier 3 — Substance over looks (internal/ops)

**Promise:** content accuracy enforced (truth-sync/repo-map/system-map guards); appearance
irrelevant; reviewed when touched.

- docs/, monitors' own dashboards/logs, admin/ops tooling, deploy workflows.

**Freshness window:** quarterly, or on change.

## Cross-tier invariants (promises that hold everywhere, always)

1. **Existing client links keep working** (the freeze; re-gating = owner approval + full
   re-issue, never a side effect).
2. **No silent data loss** — a failed save must announce itself and preserve the input.
3. **HR/balance/approval values never change without an audit trail.**
4. **Dark lanes stay dark** — TEST-only allowlists gate every unreleased behavior.
5. **A fixed bug gets a guard** — the same bug must not be findable twice.

## Amendment rule

Agents propose tier moves as one-line owner decisions; only the owner ratifies. Record
ratified moves here with a date.
