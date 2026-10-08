# "Create client": what Lighthouse runs, in order (each step only after the owner's go)

Session Beacon, 2026-10-08. Step 2.5 of `docs/plans/2026-10-01-onboarding-checklist-and-profile.md`.
Nothing below has been run. The page, the function code and the migration are in the PR; until steps 1
to 3 are done, the New client button previews (after step 3) or answers "not installed yet" and makes
nothing. **No n8n change is needed for any of it.**

What the button does once live: an admin types a name, picks a social media manager and (optionally) an
email; SyncView checks the name against the live roster and lists what it will make; "Create client" then
makes the roster row, review link, four save permissions, profile, manager link and the 27-step
checklist (4 steps ticked) in **one database transaction**. A name starting `ZZ THROWAWAY` makes a
removable test client that never reaches the Clients Info Sheet. Slack is never touched (see the end).

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

**Slack, an open owner decision.** The button does not queue the Slack channel finalizer. The finalizer
is fed by the onboarding form's provisioning snapshot and needs a filming plan link, neither of which
exists when an admin creates the client; queueing it at create time could only end in "manual
reconciliation". It picks the client up the usual way once the form and the filming plan are in. If the
owner wants the button to call the finalizer's webhook as well, that is a small follow-up.
