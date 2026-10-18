# The raw copy of every upload

Every upload from the client and videographer link (`/?intake=1`) and from the staff Submit tab is
written to the database **as received** before anything is built from it. If a later step refuses the
request, half applies it or is rolled back, what the person typed still exists here.

- Table: `public.intake_raw_submissions`, one row per request id (a retry of the same upload adds to
  `attempts`, it does not make a second row). Created by `migrations/2026-10-18-intake-raw-submissions.sql`.
- Taken by `production-write`, in `handleIntakeCreate`, after the caller is accepted (a public caller only
  after the hourly rate slot is taken) and before the epoch lookup and any row is built. Best effort: a
  missing table or a database error never refuses an upload.
- `received_as` says how it arrived: `public-intake` (the link, no sign-in) or `staff`.
- `outcome` is `received` until the answer is known, then `created` (the work exists), `refused` (with the
  error code in `outcome_detail`) or `accepted_not_committed`. A row stuck on `received` means the request
  stopped before an answer was recorded: look at it first.
- Secret-shaped keys are dropped from the body. A body over 600,000 characters is kept truncated and
  marked `truncated`.
- Not readable with the browser keys. Only `service_role` has rights (the revoke names all four roles).

## How staff read it

Through the gateway, with an admin or SMM key (the same key the Submit tab already uses):

```
POST /functions/v1/production-write
{ "action": "intake_raw_list", "limit": 50 }                       newest first, no bodies
{ "action": "intake_raw_list", "request_id": "submission:..." }    one row with its raw_body
```

Or in the Supabase SQL editor:

```sql
select first_received_at, client_slug, received_as, item_count, attempts, outcome, outcome_detail, request_id
  from public.intake_raw_submissions order by first_received_at desc limit 50;

-- Uploads that arrived but whose work was never created:
select request_id, client_slug, first_received_at, outcome, outcome_detail
  from public.intake_raw_submissions where outcome <> 'created' order by first_received_at desc;
```

## Applying it (Lighthouse)

Apply the migration in the SQL editor and read it back (`select to_regclass('public.intake_raw_submissions')`
must not be null). Nothing else is needed: the gateway deploys on merge and copes without the table, and
starts keeping copies the moment the table exists. To stop keeping copies, run the ROLLBACK block at the
bottom of the migration.

## Tests

`node test/intake-raw-copy.js` (where the copy is taken, the migration's shape, and the helper behaviour
against a fake database) and `node docs/syncview-design/tests/upload-never-lost-browser.js` (the browser side).
