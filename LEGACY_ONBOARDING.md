# Legacy (Old Notion) Onboarding — "Old forms"

A third section in **Templates → Onboarding**, alongside *Standard onboarding* and
*AI avatar onboarding*. It shows the historical onboarding forms that lived in **Notion**
before the centralized SyncView form (see `ONBOARDING_FORM.md`) existed.

**Design principle: shown _as-is_.** Old forms are NOT remapped to the new form schema —
each record keeps its original question → answer list verbatim. Different form generations
asked different questions; we preserve whatever each client actually answered.

## Where the data came from

A Notion export (Markdown pages + a database CSV) dropped in a Google Drive folder
("Old_Forms"). **21 client pages** were parsed into structured records — one `{label, value}`
per question, in original order.

**Credentials were stripped on import.** The old form asked for social-account
usernames/passwords and backup codes. Every such field (Instagram / TikTok / Facebook /
LinkedIn / YouTube logins, backup codes) is dropped before storage — it never reaches
Supabase or the browser. A leak scan over all kept values confirmed zero passwords remain.

## Data flow (mirrors the live funnels)

```
Notion export (Drive) ──parse + strip logins──▶ legacy-onboarding-migration.sql
                                                          │  (run once in Supabase)
                                                          ▼
                                             Supabase  legacy_onboarding   (service-role only, NO anon)
                                                          │
                    GET /webhook/legacy-onboarding-list (n8n, service-role, reshape) 
                                                          ▼
                              Dashboard: Templates → Onboarding → "Old forms"
```

Same security posture as `client_onboarding` / `ai_client_onboarding`: the table has **no anon
policy**, so the public browser key can neither read nor write it. Only the service-role n8n
webhook reads it. Nothing sensitive ships in the static site.

## Files

- `legacy-onboarding-migration.sql` — creates `public.legacy_onboarding` and upserts all 21
  rows (idempotent; safe to re-run). **Run once in the Supabase SQL editor** (project
  `uzltbbrjidmjwwfakwve`).
- `n8n-backups/legacy-onboarding-list.2026-07-07.created.json` — the `GET
  /webhook/legacy-onboarding-list` workflow. Import into n8n and **activate**.
- `index.html` — the "Old forms" group, per-client detail (renders `fields` verbatim), and the
  Onboarding search bar (reuses the analytics `.search-bar-*` component; filters all three
  sections by name / email / slug in place).

## Table shape

| column        | notes                                                        |
|---------------|--------------------------------------------------------------|
| `id`          | original Notion page id (primary key)                        |
| `slug`        | `wlNormalizeClient(first+last)` — matches the analytics client key, so a later "open their onboarding" link is trivial |
| `first_name`, `last_name`, `email`, `phone` | contact info                           |
| `submitted_on`| original submission time, verbatim                           |
| `fields`      | `jsonb` — `[{label, value}, …]` original Q&A, credential-free |
| `source`      | `notion-legacy`                                              |
| `created_at`  | ISO parsed from `submitted_on` (ordering only)               |

## Go-live checklist

1. **Run** `legacy-onboarding-migration.sql` in Supabase (creates table + loads 21 rows).
2. **Import + activate** `n8n-backups/legacy-onboarding-list.2026-07-07.created.json` in n8n.
3. Deploy `index.html`. The "Old forms" section lights up with all 21 clients.

Until step 1+2 are done the section renders a soft "couldn't load" note (same graceful
degradation the AI funnel had before its table existed) — no other part of the app is affected.
