# The anon key reads every client's cards — measurement and proposal (2026-09-26)

Read-only investigation. Nothing here is applied. First flagged in
`docs/audits/2026-07-03-supabase.md:73`.

## What the anon (publishable) key can read today

Measured live with `has_table_privilege` / `has_column_privilege` and `pg_policy`.

| Table | Rows anon reads | Columns anon reads | Realtime |
|---|---|---|---|
| `calendar_posts` | **all rows, every client** (`using (true)`) | all 58 | yes, all rows |
| `sample_reviews` | **all rows, every client** (`using (true)`) | all 42 | yes, all rows |
| `deliverable_events` | all rows, except comment, description and attachment event bodies (three restrictive policies) | all 15 | yes |
| `deliverables` | all rows (`using (true)`, anon and authenticated) | 24 of 28 (not `brief`, `file_url`, `comments`, `linear_raw`) | yes |
| `batches` | all rows (`using (true)`, anon and authenticated) | 13 of 17 (not the three folder links, `comments`) | yes |
| `production_comments` | none (RLS on, no policy, no grant) | none | not published |
| `calendar_post_events`, `sample_review_events` | **all rows, every client** (`using (true)`) | all | — |
| views `production_deliverables_browser_v1`, `workload_issues_native_v1`, `rename_propagation_status_v1` | **all rows** — they run with their owner's rights, so table policies never reach them | their own columns | — |

Scale at the time of measurement: calendar rows for 34 clients, sample rows
for 9, and about 125,000 production events. Anyone holding the publishable key
(it ships in `index.html`) can read them, or subscribe to live changes, without a
client token.

**Also:** anon and authenticated still hold INSERT, UPDATE, DELETE, TRUNCATE,
REFERENCES and TRIGGER on the five card tables. Row level security refuses the
row writes (no write policy exists), but **TRUNCATE ignores row level security**.
No PostgREST route issues TRUNCATE, so this is defence in depth.

## Where the browser reads these tables

27 sites, every one sending only `apikey` / `Authorization: Bearer <anon>`; no
supabase-js `.from()` reads, and no direct browser writes. The client link's
token is verified once at entry (`client-token-verify`) and is then sent only
on Edge Function writes, never on these reads.

- **Client link and staff Calendar:** `_calV2FetchPosts` (150:1041), realtime `_calV2EnsureSubscribed` (150:1130, `client=eq.slug`), `_crqReadServerRow` (185:219, client link only), `_writeUiLegacySourceRows` (140:958, calendar or samples), `_calFetchDeliverableLinkRows` (150:147, deliverables).
- **Client link and staff Samples:** `_sxrFetchPosts` (270:890), realtime `_sxrV2EnsureSubscribed` (290:968).
- **Staff only, all clients:** Kasper `_kasperFetchAllRelevantPosts` (330:461) and realtime `kasper-cal` (320:573, no filter); `_sxrKasperFetchAllSamples` (290:1169) and realtime `kasper-sxr` (290:1026, no filter); `_calReadFreshCardStamp` (120:2798); `_kedFetchNativeWeek` (330:2558/2593, events and deliverables).
- **Staff Production and Workload:** `_prodLoadData` (250:1962/1573, batches), `_prodReadBatchDescriptionRow` (240:350), `_prodLoadEventsFor` (250:2116), `_prodLoadDeliverableProjection` legacy fallback (210:1032), `_prodFetchCrosswalkRows` (120:1122), `_writeUiReadCurrentNativeStatus` (290:432), `_calFillLookupExisting` (160:2407), `_calLatestNativeBatches` (180:149), `wlFetchNativeMetadata` fallback (070:1624), realtime on deliverables and batches (070:655/656, no filter).
- Not confirmed to run on a client link: `_prodFetchCrosswalkRows` and `_writeUiReadCurrentNativeStatus` (comment and replay-repair paths).

## Why the fix has to be in the database

Making the client link *ask* for only its own rows changes nothing: the anon
key can still read every row directly. So the anon key must lose its read path,
and every legitimate reader — staff as well as client links — must present
something the database can check.

## Proposal

**Phase 0 — now, no behaviour change.**
`migrations/2026-09-26-anon-write-grants-revoke.sql` revokes every write privilege
(including TRUNCATE) from `public`, `anon` and `authenticated` on the five
tables. It refuses to run if any anon/authenticated write policy exists.

**Phase 1 — code, before any read policy changes.** A short-lived signed session
for every reader:
1. A new Edge Function, `syncview-session`, verifies either a client link's token
   (the same `client_access` check `client-token-verify` does) or a staff role key
   (`authorizeStaffKey`). It returns a JWT with `role: authenticated`, a short
   expiry (for example 60 minutes), and the claims `svc_scope` (`staff` or
   `client`) and `svc_client` (the verified slug, for client sessions).
2. The browser sends that JWT as `Authorization: Bearer` on the 27 reads above,
   and calls `realtime.setAuth(jwt)` on its supabase-js clients (Calendar,
   Samples, Kasper and Workload). It refreshes the JWT before expiry and on
   visibility return.
3. It ships while the old `using (true)` policies still stand, so a missing or
   failed session falls back to today's behaviour. Measure until every read and
   subscription carries a session.

**Prerequisite (owner check):** the Edge Function must be able to sign a JWT that
PostgREST and Realtime accept. In Supabase that means the project's JWT signing
key (Project Settings → JWT Keys). If the legacy HS256 secret is still the active
signing key, it can be given to the function as a secret. If the project has
moved to asymmetric signing keys, the session has to come from Supabase Auth
instead (for example anonymous sign-in plus a custom-access-token hook that adds
the two claims). This choice decides phase 1's shape.

**Phase 2 — after phase 1 is measured.** It also covers the two card event
ledgers and the three owner-rights views (found in review). The views cannot
simply switch to `security_invoker`: two of them read `deliverables.linear_raw`,
which the session role must not read, and one reads a table the session role
cannot read at all. They cannot be renamed either, because seven server-side
functions name them (the Workload snapshot, plan and intake loaders, none of
them callable by anon or authenticated). So the originals stay exactly as they
are for those functions and are closed to anon and authenticated. New
`<name>_session` views return only the rows a session may see, and phase 1
points the browser's three view reads at the `_session` names.


`migrations/2026-09-26-scoped-read-policies.sql` drops the five `using (true)`
policies and adds `authenticated` policies. A staff session reads every row, and
a client session reads only rows whose `client` or `client_slug` equals its
`svc_client`. It then revokes anon's SELECT, including the per-column grants on
`deliverables` and `batches`. Realtime applies the same policies to the
subscriber's JWT, so a client link's live updates stay scoped. Column grants
and the restrictive event-body policies are unchanged.

**Considered and not chosen:**
- Check the client token from a request header inside RLS. That works for REST,
  but Realtime sends no custom headers, so client links would lose live updates,
  and staff reads would still need a credential.
- Route client-link reads through a token-checked Edge Function only. That
  protects nothing while the anon key can still read directly, and moving staff
  reads too means rewriting all 27 sites plus realtime.

## Proof

`scripts/anon-read-scope-rehearsal.js` (disposable local PostgreSQL 16, fixture
built with the live policies and grants): 16 checks, including the event ledgers, the views and an unaffected server-side function. They cover anon reading
everything and TRUNCATE succeeding before any change; phase 0 removing every
write privilege while reads stay the same; phase 0 refusing when a write policy
exists; and, under phase 2, anon reading nothing, staff reading everything, a
client reading only its own rows, a missing or unknown scope reading nothing,
and hidden columns and comment bodies staying hidden. Both rollbacks restore
access exactly.
