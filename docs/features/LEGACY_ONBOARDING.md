# Legacy (Old Notion) Onboarding — "Old forms"

> **F77 PARTIAL CONTAINMENT — MERGE-GATED UI.** `legacy-onboarding-list`, `onboarding-list`, and
> `ai-onboarding-list` now authenticate before service-role access; missing/wrong keys return `401`.
> Candidate Pages callers obtain the key only after verified Admin sign-in, while current Pages
> fails closed until that caller merges. Wildcard CORS, full-list background discovery, shared-key
> lifecycle, access-log/embedded-link review and incident disposition remain open.

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

**Credentials were excluded from the public backfill and ordinary list.** The old form asked for
social-account usernames/passwords and backup codes. Those fields are not present in `fields` or
the public repository; where operationally retained, they are loaded out of band into the separate
service-role-only `credentials` column and returned only by `onboarding-full`. **F85 correction:**
that reader currently accepts shared/legacy secret possession without active-member binding or read
audit, so “authenticated Admin” overstates the boundary. A private human review must classify free
text/share links and decide whether retained credential arrays are still required (F64/F85).

## Data flow (mirrors the live funnels)

```
Notion export (private Drive) ──private reviewed loader──▶ Supabase legacy_onboarding
                                                          (service-role only, NO anon)
                                                          │
              Edge Functions: legacy-onboarding-list (Admin-gated, credential-stripped — F77)
                              onboarding-full (shared/legacy-key-only unstripped — F85)
                                                          ▼
                              Dashboard: Templates → Onboarding → "Old forms"
```

Same table posture as `client_onboarding` / `ai_client_onboarding`: **no anon policy**, so the
public browser key can neither read nor write it. Current browser reads go through the two Edge
Functions above; `onboarding-full` currently has F85's shared/legacy-key-only boundary, not an
individually revocable active-admin session. The old n8n reader is only a
transition rollback asset. F64 records the historical repository exposure; “not in the current
static site” does not mean public git history/caches/clones are already remediated.

## Files

- `migrations/legacy-onboarding-migration.sql` — the public file remains row-bearing under F64.
  A reviewed data-free schema/RLS/revoke replacement exists only in the access-restricted incident
  package because GitHub expanded its deletions despite the attempted diff guard. Restore it only
  inside the coordinated history rewrite, then complete cache/fork/reclone cleanup.
  Historical rows already live in the protected table; any restore/import must come from an
  encrypted private artifact through a separately reviewed loader. Never add row values again.
- `n8n-backups/legacy-onboarding-list.2026-07-07.created.json` — historical transition reader
  artifact. Do not activate as normal provisioning; any rollback restoration must pass the current
  graph/version/credential/error-handler/owner/duplicate-path/first-green gates.
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
| `credentials` | `jsonb` — loaded out of band; service-role only; returned only by the authenticated Admin reader |
| `source`      | `notion-legacy`                                              |
| `created_at`  | ISO parsed from `submitted_on` (ordering only)               |

## Go-live checklist

1. **Run only when provisioning a new schema:** `migrations/legacy-onboarding-migration.sql`
   creates/locks the table but loads no customer data.
2. Restore rows only from the encrypted private artifact with the reviewed private loader; verify
   exact aggregate count and anonymous denial without publishing identities or content.
3. Deploy/read back `legacy-onboarding-list` and `onboarding-full`; require authorized-role and
   admin-only responses respectively with anonymous/cross-role denials. Field stripping is additive
   defense, not the gate. Do not activate n8n.
4. Deploy `index.html`; verify the Old forms surface through the authorized staff path.

The protected table and Edge readers are live. Current Pages does not yet attach the Admin key, so
the section fails closed with its soft load error until the candidate caller merges; no other part
of the app is affected.
