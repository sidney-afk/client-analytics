# F27 write-authorization — owner-gated apply window

**Status:** NOT APPLIED. One SQL file, one step, no deploy.

## In one paragraph

The deployed `production-write` gateway asks the database a permission question
before every write. The database function that answers it was never created, so
the gateway errors out and **refuses every write** — which is why the assignment
feature shipped in the 2026-07-26 window has never worked, and why the TEST drill
fails. This window creates that one missing function (and the small table it
reads), and nothing else.

## What it changes

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
- Rollback (`drop function` + `drop table`) succeeds and leaves nothing behind.

## Apply

Supabase SQL editor, `migrations/2026-07-28-f27-write-authorization-only.sql`,
verbatim, in one transaction. Record the SHA being applied.

## Readbacks (all read-only)

```sql
-- 1. the function exists and answers correctly for both teams
select public.track_b_f27_write_authorization('video');
select public.track_b_f27_write_authorization('graphics');
-- expect ok=true, generation=0, authority matching prod_authority for that team

-- 2. exactly two fence rows, both at generation 0
select team, generation, updated_by from public.track_b_f27_team_fences order by team;

-- 3. nothing else from the parent migration leaked in
select count(*) as should_be_zero from pg_proc
where proname in ('track_b_f27_begin','track_b_f27_classify','track_b_f27_finalize');
select count(*) as should_be_zero from pg_trigger where tgname = 'track_b_f27_hold_guard';

-- 4. authority is unchanged
select value from public.syncview_runtime_flags where key = 'prod_authority';
-- expect {"video":"linear","graphics":"linear"}
```

Then re-dispatch the **Slice 5 TEST drills** workflow with `preflight_only: false`.
The `f94_negative` stage should get past `503 authority_unavailable`. Whatever it
reports next is the *real* state of blocker #8 — this window does not prove the
blocker, it only lets it be tested.

## Rollback

```sql
drop function if exists public.track_b_f27_write_authorization(text);
drop table if exists public.track_b_f27_team_fences;
```

Both objects are new and hold no real data — the table has only the two seeded
generation-0 rows. Dropping them returns the system exactly to its current state,
where every entity write refuses with 503. Verified offline.

## Forward compatibility

Every statement is idempotent (`create table if not exists`, `on conflict do
nothing`, `create or replace function`), so the full F27 migration re-applies
cleanly over this when its install windows eventually run. Applying this now does
not consume, skip, or pre-empt any step of that install.
