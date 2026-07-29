# F27 write-authorization — owner-gated apply window

**Status:** APPLIED 2026-07-28. The owner later re-applied the function body
after F55 removed the retired authority alias. Do not run this historical
window again. Its readbacks are historical existence evidence, not the complete
F27 preinstall-subset gate.

## In one paragraph

The deployed `production-write` gateway asks the database a permission question
before every write. On 2026-07-28 the owner applied the exact table and function
that answer it, then re-applied the function after F55 removed the retired
authority alias. The full F27 rollback migration remains unapplied. These two
objects are now the exact required baseline for its later install.

## What was applied

| | |
|---|---|
| Creates | `public.track_b_f27_team_fences` (one new table, 2 rows, both generation 0) |
| Creates | `public.track_b_f27_write_authorization(text)` (one read-only function) |
| Alters | nothing |
| Replaces | nothing |
| Triggers | none |
| Flags / authority | untouched |
| Edge Functions | none deployed |
| n8n | untouched |

Both objects are copied **verbatim** from `migrations/2026-07-20-f27-team-rollback.sql`.

## What it deliberately does NOT do

This is **not** the F27 install. The parent migration is 1,294 lines and also
alters `mirror_outbox`, replaces the live `mirror_outbox_enqueue` function, and
installs the `track_b_f27_hold_guard` trigger — all of which change live outbox
behaviour and remain gated behind the two owner windows in
`F27_INSTALL_RUNBOOK.md`. **None of that is in this file.**

It also does not fix the native-comment failure. That refusal happens at
`index.ts:3482`, one line *earlier* than the fence, on a different check.

## Offline proof (done 2026-07-28, disposable PostgreSQL 16)

- Applies cleanly.
- `track_b_f27_write_authorization('video')` returns
  `{"ok": true, "team": "video", "type": "f27_write_authorization", "authority": "linear", "generation": 0}`
  — exactly the shape the deployed gateway validates. Same for `graphics`.
- Re-applying is idempotent: still 2 fence rows, not 4.
- The disposable-only inverse (`drop function` + `drop table`) succeeds and
  leaves nothing behind; it is not authorized against production.

## Applied record

The owner applied
`migrations/2026-07-28-f27-write-authorization-only.sql` in the Supabase SQL
editor on 2026-07-28. The F55 function body was separately re-applied later that
day. `EXECUTION_LOG.md` records the public-safe existence/permission readbacks.
Do not re-run this window as an F27-install step.

## Readbacks (all read-only)

These compact queries document what the completed narrow window checked. They
must not substitute for `f27-mirror-outbox-snapshot.js --mode
window-p-preflight` or the later sealed snapshot gate, which also hard-fail on
every extra F27 object/overload, rollback state, outbox addition, and catalog
definition/ACL drift.

```sql
-- 1. the function exists and answers correctly for both teams
select public.track_b_f27_write_authorization('video');
select public.track_b_f27_write_authorization('graphics');
-- expect ok=true, generation=0, authority matching prod_authority for that team

-- 2. exactly two fence rows, both at generation 0
select team, generation, updated_by from public.track_b_f27_team_fences order by team;

-- 3. sampled historical absence checks (not the complete future install gate)
select count(*) as should_be_zero from pg_proc
where proname in ('track_b_f27_begin','track_b_f27_classify','track_b_f27_finalize');
select count(*) as should_be_zero from pg_trigger where tgname = 'track_b_f27_hold_guard';

-- 4. authority is unchanged
select value from public.syncview_runtime_flags where key = 'prod_authority';
-- expect {"video":"linear","graphics":"linear"}
```

Passing only these four historical readbacks does not authorize Window P or the
full migration.

The completed Slice 5 TEST drills subsequently passed the write-authorization
gate; their evidence is recorded in `EXECUTION_LOG.md` and
`docs/independence/GO_LIVE_CHECKLIST.md`.

## Rollback

Do not drop these objects as an operational rollback: the deployed gateway now
depends on them, and removing them would restore the known 503 refusal. Any
future removal requires an owner-approved gateway rollback first, an exact live
dependency readback, and a separate reviewed database inverse. The F27 install
rollback must preserve this table/function baseline while returning
`production_assert_authority` and every other full-install object to their
captured preinstall state.

## Forward compatibility

Every statement is idempotent (`create table if not exists`, `on conflict do
nothing`, `create or replace function`), so the full F27 migration is designed
to re-apply over this subset. The install preflight must nevertheless prove the
exact table definition/ACL, two generation-zero rows, and exact function
definition/attributes/ACL before the one-shot migration is allowed to run.
