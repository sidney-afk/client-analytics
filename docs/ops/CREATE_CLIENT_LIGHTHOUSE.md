# "Create client": what Lighthouse runs, in order (each step only after the owner's go)

Session Beacon, 2026-10-08. Step 2.5 of `docs/plans/2026-10-01-onboarding-checklist-and-profile.md`.
Nothing below has been run. The page, the function code and the migration are in the PR; until steps 1
to 3 are done, the New client button previews (after step 3) or answers "not installed yet" and makes
nothing. **No n8n change is needed for any of it.**

What the button does once live: an admin types a name, picks a social media manager and (optionally) an
email; SyncView checks the name against the live roster and lists what it will make; "Create client" then
makes the roster row, review link, four save permissions, profile, manager link and the 27-step
checklist (4 steps ticked) in **one database transaction**. A name starting `ZZ THROWAWAY` makes a
removable test client that never reaches the Clients Info Sheet or Slack. For a real client the Slack finalizer is nudged (see the end).

## 1. Apply the test-only path (owner's go)

`migrations/2026-10-03-native-client-test-provision.sql` (merged in #1931, never applied). SQL editor, whole
file. Readback:

```sql
select to_regprocedure('public.production_native_client_test_provision(text,text,text,text)') is not null as provision,
       to_regprocedure('public.production_native_client_test_teardown(text,text)') is not null as teardown,
       to_regclass('public.production_native_client_test_provisions') is not null as receipts;
-- expect true, true, true
```

## 2. Apply Create client (owner's go)

`migrations/2026-10-08-create-client.sql`. Functions and one trigger only: no table, no data change. Readback, all four
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

## 3. Deploy the function (owner's go)

Deploy `client-onboarding` through
[Deploy one allowlisted Edge Function](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-single-function.yml)
with the merge commit's SHA on `main`. Safe in either order with step 2: before the migration, a create
answers `create_not_installed` and writes nothing. The checklist reads and writes it already serves are
unchanged (same handler, two new actions).

## 4. The live proof on a throwaway (owner's go at that moment)

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

**Slack (owner request 2026-10-08; built, no n8n edit).** The Slack Creative Channel Finalizer (n8n) already
waits for its missing pieces and re-checks every 15 minutes and once a day: a pending queue row (written by the
onboarding form's provisioning), exactly one Clients Info row with the same name (case included) and email, the
manager with a Slack user id, and a linked filming plan. Create client supplies the client row and the manager,
so the database now **nudges** the finalizer's existing webhook (`slack-creative-finalize`, body `{client_name}`)
through `slack_finalizer_nudge()`:

- at the end of a real create (the create answer says `slack: finalizer_nudged`), and
- whenever a filming plan link is saved for a real, active client with no Slack channel yet (trigger
  `filming_plans_slack_finalizer_nudge`, any writer: the Filming Plans tab, the pipeline, a session).

Never for a test client: kind `test` or a `zzthrowaway` slug is refused inside the nudge itself. A nudge goes out
through pg_net after the transaction commits and never fails the save it rides on. A real client now needs an
email (an empty one sends the finalizer's job to manual), and the preview blocks a name or email that differs
from an onboarding form already on file, with a one-click "use the form's name / email".

Extra readbacks after step 2:

```sql
select tgname from pg_trigger where tgname = 'filming_plans_slack_finalizer_nudge';       -- 1 row
select r.rolname, has_function_privilege(r.rolname, 'public.slack_finalizer_nudge(text)', 'execute')
  from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role') order by 1;  -- all f
```

In the throwaway proof (step 4) the create answer must say `slack: not_queued`. The first real client is the end
to end Slack proof: its channels appear within a minute or two of the last piece arriving (that run also serves as
the proof the runbook asks for before removing the finalizer's 15 minute timer).

**What still needs n8n (owner's go, not done).** A client who never submits the onboarding form never gets a queue
row, so no channels. Every real client fills the form today, so this is not needed now. If it ever is, the exact
change: in **Client - Slack Creative Channel Finalizer** (`udkwwzdFuPW3K2CE`) add a Webhook node `Enqueue From
SyncView` (POST `/webhook/slack-creative-enqueue`, header auth with the existing "Roster service key" credential)
followed by a Code node that builds `client_name`, `email`, `viewer_slug`, `client_key` (`email|viewer_slug`),
`channel_name`, a `kickoff` text (same template as provisioning's, with "No onboarding form yet") and a one-line
`form_brief`, then a Data Table "Insert" into **Slack Creative Channel Queue** (`SLpem4MfCeVoli4G`) with
`status: pending` only when no row with that `client_key` exists. Create client would then call it for real
clients with no form on file. Undo: delete the three nodes.
