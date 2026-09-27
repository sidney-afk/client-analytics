# Public-key database read inventory (2026-09-26)

Source baseline: `3f5bd46e6086911ae2a7bb0d32507f03d5a44da8`. This inventory reconciles explicit `anon` grants and `USING (true)` SELECT policies in the repository with a **read-only, zero-row** live probe. It is not a complete catalog of effective live privileges: default grants, uncommitted changes, and exposed-schema settings are not fully captured in migrations. [Supabase's API security guide](https://supabase.com/docs/guides/api/securing-your-api) explains why both grants and RLS must be checked.

At 2026-09-26 20:45 UTC, the browser publishable key from source made `HEAD /rest/v1/<relation>?select=<one-column>&limit=0` requests. No row body or client identifier was retrieved. A `200` proves that this requested column's read route accepted the key, not that a row exists or every column is readable. A `401` proves that this particular read was denied. Three expected-private controls (`client_access`, `mirror_outbox`, `rename_propagation_outbox`) all returned `401`.

## Every table with an explicit anonymous SELECT grant in the scanned migrations

The source starts with six grants in `migrations/live-schema-baseline-2026-07-03.sql`, then adds fourteen in the A1, A4, B0, B1, filming-plan, thumbnail, and weekly-report migrations. Every listed policy uses `USING (true)` rather than a client principal. Later files revoke four table grants in `2026-07-14-f88-safe-sensitive-read-revocations.sql` and replace table-wide SELECT with column lists for `batches`, `deliverables`, and `team_members`. The probe outcome follows the current public-key route, not an assumption that every migration ran in order.

| Table | Public-key `HEAD` | Source read boundary / concern |
|---|---:|---|
| `calendar_posts` | 200 | Full-row `USING (true)`; already being handled separately, so no repeat repair here. |
| `content_samples` | 401 | Source grants full SELECT, but current route denies it; investigate source/live drift before any grant change. |
| `sample_reviews` | 200 | Full-row review data, no client-scoped RLS. |
| `sample_review_events` | 200 | Full-row review history, no client-scoped RLS. |
| `workload_issues` | 200 | Full-row historical workload mirror, no client-scoped RLS. |
| `client_credentials_rev` | 200 | Full-row client revision/name metadata, no client-scoped RLS. |
| `calendar_post_events` | 200 | Full-row calendar event history, no client-scoped RLS. |
| `syncview_runtime_flags` | 200 | Full-row routing/roster flag values, no scoped policy. |
| `templates` | 200 | `data` column also accepted (`200`); client-specific brand material has no client-scoped RLS. |
| `caption_prompts` | 200 | `prompt` column also accepted (`200`); no client-scoped RLS. |
| `team_members` | 200 | Later column grant narrows the row, but `email` still accepted (`200`); no role-scoped RLS. |
| `clients` | 200 | Full-row client roster; `brand_kit` also accepted (`200`); no client-scoped RLS. |
| `flag_flips` | 200 | Full-row flag history; `old_value` also accepted (`200`); no scoped RLS. |
| `batches` | 200 | Column grant, but `description` accepted (`200`); no client-scoped RLS. |
| `deliverables` | 200 | Column grant, but `title` accepted (`200`); no client-scoped RLS. |
| `deliverable_events` | 200 | Full-row production history, no client-scoped RLS. |
| `filming_plans` | 401 | F88 script revokes SELECT; the current route denies this probe. |
| `thumbnail_media_revisions` | 401 | F88 script revokes SELECT; the current route denies this probe. |
| `social_media_managers` | 401 | F88 script revokes SELECT; the current route denies its valid `slug` column. |
| `smm_weekly_reports` | 401 | F88 script revokes SELECT; the current route denies this probe. |

The result is **15 of these 20 tables accepting a public-key column read**, five denying it. `content_samples` is the extra denial beyond the four F88 revocations; no matching source revoke was found. This difference should be reconciled with the current schema owner, without restoring an older grant by default.

## Public views are additional read paths

| View | Public-key `HEAD` | Source concern |
|---|---:|---|
| `production_deliverables_browser_v1` | 200 | Grants anonymous SELECT on a cross-client deliverable projection. |
| `workload_issues_native_v1` | 200 | Grants anonymous SELECT on the cross-client workload projection. |
| `rename_propagation_status_v1` | 200 | `client` column accepted (`200`) even though its base outbox returned `401`; the view selects source IDs, client, state, and time without a client filter. |

The rename status view has no `security_invoker` declaration. [Supabase's RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security) warns that views commonly bypass base-table RLS by default. This is a **source-backed cross-client metadata capability**, not proof that the view currently contains rows. A follow-up should verify its intended audience and replace raw anonymous access with a principal-scoped projection or a guarded reader if it is not meant to be public. The other anonymous tables and views need the same explicit field-by-field owner decision under existing F88; a client token in the browser is not a database principal. No policy, grant, data, or function was changed here.
