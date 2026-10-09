# "Create client": what Lighthouse runs, in order (each step only after the owner's go)

Session Beacon, 2026-10-08. Step 2.5 of `docs/plans/2026-10-01-onboarding-checklist-and-profile.md`.

**Status (2026-10-09): Create client is LIVE.** Steps 1 to 4 below were done by Lighthouse on 2026-10-08: both
migrations applied, `client-onboarding` deployed, and the throwaway create and teardown passed. They stay here
as the record. **Open: step 6, the Slack nudge** (`migrations/2026-10-09-create-client-slack-nudge.sql`, a NEW
file on top of the applied one, plus a redeploy of `client-onboarding`), each with the owner's go. **No n8n
change is needed for any of it.**

What the button does once live: an admin types a name, picks a social media manager and (optionally) an
email; SyncView checks the name against the live roster and lists what it will make; "Create client" then
makes the roster row, review link, four save permissions, profile, manager link and the 27-step
checklist (4 steps ticked) in **one database transaction**. A name starting `ZZ THROWAWAY` makes a
removable test client that never reaches the Clients Info Sheet or Slack. For a real client the Slack finalizer is nudged (see the end).

## 1. Apply the test-only path (DONE 2026-10-08)

`migrations/2026-10-03-native-client-test-provision.sql` (merged in #1931, never applied). SQL editor, whole
file. Readback:

```sql
select to_regprocedure('public.production_native_client_test_provision(text,text,text,text)') is not null as provision,
       to_regprocedure('public.production_native_client_test_teardown(text,text)') is not null as teardown,
       to_regclass('public.production_native_client_test_provisions') is not null as receipts;
-- expect true, true, true
```

## 2. Apply Create client (DONE 2026-10-08)

`migrations/2026-10-08-create-client.sql`. Functions only: no table, no data change. Readback, all four
roles named (house rule):

```sql
select r.rolname,
       has_function_privilege(r.rolname, 'public.client_create_native(text,text,text,text,text,text,text)', 'execute') as create_fn,
       has_function_privilege(r.rolname, 'public.client_create_native_test_teardown(text,text)', 'execute') as teardown_fn
  from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'postgres') order by 1;
-- expect: anon f f, authenticated f f, service_role t t (postgres t t as owner)
select count(*) from information_schema.routine_privileges
 where routine_name in ('client_create_native', 'client_create_native_test_teardown') and grantee = 'PUBLIC';
-- expect 0
```

Rollback (one statement each): `drop function public.client_create_native(text,text,text,text,text,text,text);`
and `drop function public.client_create_native_test_teardown(text,text);`.

## 3. Deploy the function (DONE 2026-10-08)

Deploy `client-onboarding` through
[Deploy one allowlisted Edge Function](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml)
with the merge commit's SHA on `main`. Safe in either order with step 2: before the migration, a create
answers `create_not_installed` and writes nothing. The checklist reads and writes it already serves are
unchanged (same handler, two new actions).

## 4. The live proof on a throwaway (DONE 2026-10-08, passed)

1. SyncView, Kasper › More › Clients › **New client**. Name `ZZ THROWAWAY Beacon`, any manager, no email.
   The dialog must say "Ready. This will make:" with six lines and the Test client badge. Create.
2. Readback (counts only):

```sql
select (select count(*) from clients where slug = 'zzthrowawaybeacon' and kind = 'test') as roster,
       (select count(*) from client_access where slug = 'zzthrowawaybeacon') as token,
       (select count(*) from client_profiles where slug = 'zzthrowawaybeacon') as profile,
       (select count(*) from client_onboarding_progress where client_slug = 'zzthrowawaybeacon') as steps,
       (select count(*) from client_onboarding_progress where client_slug = 'zzthrowawaybeacon' and status = 'done') as ticked,
       (select count(*) from roster_sheet_outbox where client_slug = 'zzthrowawaybeacon') as sheet_rows,
       (select count(*) from syncview_runtime_flags where key in ('calendar_upsert_ef_clients','sample_review_ef_clients','settings_ef_clients','write_ui_reroute_clients')
           and value->'clients' @> '["zzthrowawaybeacon"]') as routing_lists;
-- expect 1, 1, 1, 27, 4, 0, 4
```

3. Teardown, then the same readback must be all zeros:

```sql
select public.client_create_native_test_teardown('zzthrowawaybeacon', 'Lighthouse');
```

The checklist history rows and the manager-move history row stay by design (history is never deleted).

## 5. After that

The first real client made with the button is the end to end proof of the real path (kind `client`,
on the Clients Info Sheet copy, immutable receipt). It cannot be undone except by archiving, by design of
the 2026-09-09 provisioning function.

## 6. Slack nudge (APPLIED; live database checked 2026-10-10)

The Slack Creative Channel Finalizer (n8n) already waits for its missing pieces: a pending queue row (written by
the onboarding form's provisioning, standard or AI funnel), exactly one Clients Info row with the same name (case
included) and email, the manager with a Slack user id, and a linked filming plan. Create client supplies the
client row and the manager, so the database **nudges** the finalizer's existing webhook
(`slack-creative-finalize`, body `{client_name}`) through `slack_finalizer_nudge()` at exactly two moments:

- at the end of a real create (the create answer says `slack: finalizer_nudged`), and
- whenever a filming plan link is saved for a real, active client with no Slack channel yet (trigger
  `filming_plans_slack_finalizer_nudge`, any writer: the Filming Plans tab, the pipeline, a session).

Nothing else triggers it: when the last piece to arrive is the onboarding form or the manager's Slack id, the
finalizer's own **15 minute timer** picks the client up (and the daily safety check catches anything left).

Never for a test client: kind `test`, a `zzthrowaway` slug or a "ZZ THROWAWAY" name is refused inside the nudge.
The whole nudge, its lookup included, sits inside one exception handler, so it can never fail a create or a
filming plan save; pg_net sends it after the transaction commits. The redefined `client_create_native` differs
from the live one by exactly two lines: a real client needs an email (step 7 undoes this; an empty one sends the finalizer's job to
manual), and the `slack` answer. The page (already in this PR) blocks a name or email that differs from an
onboarding form on file (both form tables are read; extra spaces do not count), with a one-click fix.

Steps, in order, each with the owner's go:

1. Apply `migrations/2026-10-09-create-client-slack-nudge.sql` in the SQL editor (whole file). Readback:

```sql
select tgname from pg_trigger where tgname = 'filming_plans_slack_finalizer_nudge';       -- 1 row
select r.rolname,
       has_function_privilege(r.rolname, 'public.slack_finalizer_nudge(text)', 'execute') as nudge,
       has_function_privilege(r.rolname, 'public.client_create_native(text,text,text,text,text,text,text)', 'execute') as create_fn
  from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role') order by 1;
-- expect: anon f f, authenticated f f, service_role f t
select position('slack_finalizer_nudge' in prosrc) > 0 from pg_proc where proname = 'client_create_native'; -- t
```

2. Deploy `client-onboarding` through
   [Deploy one allowlisted Edge Function](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml)
   with the merge commit's SHA on `main` (the preview now reads both form tables and requires a real client's email).
3. Throwaway check: create `ZZ THROWAWAY Beacon` again; the create answer must say `slack: not_queued`; tear it down
   with step 4's SQL. Then re-save the test client's (sidneylaruel) filming plan link with a changed link and
   confirm nothing went to the finalizer: `select count(*) from net._http_response where created > now() -
   interval '2 minutes';` is 0 (run it when no scheduled job fired in those two minutes), then put the link back.

Rollback: `drop trigger filming_plans_slack_finalizer_nudge on public.filming_plans;`, drop the two nudge
functions, then re-run `migrations/2026-10-08-create-client.sql` to restore the previous `client_create_native`.

The first real client is the end to end Slack proof. Its channels are made on the first finalizer pass after
the last piece is in: within a minute or two when that piece is the create itself or a filming plan link save
(both nudge it), otherwise on the next 15 minute timer run. That run also serves as the proof the runbook asks
for before removing the finalizer's 15 minute timer; until then the timer must stay.

## 7. Email optional again (built 2026-10-10, NOT applied; owner decision)

The owner decided a real client must not need an email ("sometimes I don't have it"). Steps after merge:

1. Paste `migrations/2026-10-10-create-client-email-optional.sql` in the SQL editor (whole file). It redefines
   `client_create_native` without the email check; nothing else changes (the Slack nudge stays). Readback:

```sql
select position('client_create_email_required' in prosrc) = 0 as email_optional,
       position('slack_finalizer_nudge' in prosrc) > 0 as nudge_kept
  from pg_proc where proname = 'client_create_native';                                   -- t, t
select r.rolname, has_function_privilege(r.rolname, 'public.client_create_native(text,text,text,text,text,text,text)', 'execute')
  from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role') order by 1;  -- f, f, t
```

2. Redeploy `client-onboarding` through
   [Deploy one allowlisted Edge Function](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml)
   with the merge commit's SHA on `main`.

Without an email the client's Slack channels wait: the dialog lists **Client email** as missing. If the onboarding
form is already in, the finalizer would send the job to the owner to sort out by hand (it treats an empty email
as a mismatch, on its own timer too), so the dialog warns and offers the form's email in one click. Adding the
email on the profile later lets the next finalizer pass make the channels. Rollback: re-run
`2026-10-09-create-client-slack-nudge.sql`.

**What still needs n8n (owner's go, not done).** A client who never submits the onboarding form never gets a queue
row, so no channels. Every real client fills the form today, so this is not needed now. If it ever is, the exact
change: in **Client - Slack Creative Channel Finalizer** (`udkwwzdFuPW3K2CE`) add a Webhook node `Enqueue From
SyncView` (POST `/webhook/slack-creative-enqueue`, header auth with the existing "Roster service key" credential)
followed by a Code node that builds `client_name`, `email`, `viewer_slug`, `client_key` (`email|viewer_slug`),
`channel_name`, a `kickoff` text (same template as provisioning's, with "No onboarding form yet") and a one-line
`form_brief`, then a Data Table "Insert" into **Slack Creative Channel Queue** (`SLpem4MfCeVoli4G`) with
`status: pending` only when no row with that `client_key` exists. Create client would then call it for real
clients with no form on file. Undo: delete the three nodes.
