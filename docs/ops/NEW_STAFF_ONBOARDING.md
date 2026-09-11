# New staff onboarding (admin / SMM / editor / designer)

This is the staff equivalent of `docs/ops/NEW_CLIENT_ONBOARDING.md`. Until now nothing
documented how a new hire actually gets into SyncView, Linear, and Slack, so every session
was rederiving it from scratch. This was written immediately after running the steps below
for the team's first tracked SMM hire, so it reflects what is actually required, not a
guess.

**This repo is PUBLIC.** Never commit a new hire's full name, or any role key value, into
this file or any file in this repo. The real roster lives in Supabase's `team_members`
table, not in git. A bare first name is fine on its own; two or more words that match a
`team_members` row (active or not) will fail `scripts/repo-identity-exposure-check.js` on
push, since that check reads the live table straight from Supabase, not a fixture.

## 0. The systems involved (mental map)

| System | What it does here | Manual or automatic |
|---|---|---|
| Supabase `team_members` | Gates the SyncView "Staff sign in" roster dropdown, and carries the person's role | Manual insert. No admin UI and no invite flow exist for this. |
| Shared role key (`ROLE_KEY_ADMIN` / `ROLE_KEY_SMM` / `ROLE_KEY_CREATIVE`) | The actual credential. One key per role tier, not one per person | Nothing to generate, just hand over the key that already exists |
| Linear workspace | Lets them log in and mint their own personal API key | Manual invite, done in Linear itself |
| SyncView Google Sheet, "Social Media Managers" tab | A second, separate roster. Holds each SMM's personal Linear API key. What gets read when assigning them to a client. Syncs into Supabase `social_media_managers` | Manual row add. The sync into Supabase runs on its own once the row exists (this doc does not yet pin down its schedule, confirm the row landed rather than assuming timing) |
| Slack workspace | `team_members.slack_user_id` feeds the client creative channel automation | Manual invite |
| Company email | Identity anchor for the above | Owner's call. Some existing staff use a personal address instead, and that is fine |

## 1. Quick checklist

- [ ] Get: full name, email, role (`admin` / `smm` / `editor` / `designer`), and whether they are tied to one production team (`video` / `graphics`) or neither
- [ ] Insert their `team_members` row (see §2)
- [ ] Hand them the existing shared role key for their tier, through a channel you would already trust with a secret. Never in this repo, never in a public Slack channel
- [ ] Invite them to the Linear workspace. Once they are in, have them generate their own personal API key (Linear, Settings, Security & access, Personal API keys)
- [ ] Invite them to Slack. Once you have their Slack user id, update their `team_members` row with it
- [ ] Add their row to the SyncView Google Sheet's "Social Media Managers" tab: name, email, their new Linear API key. Confirm it synced into `social_media_managers` in Supabase
- [ ] If assigning a client right away, follow `NEW_CLIENT_ONBOARDING.md` §6e (roster enrollment) and §6g (Linear project)
- [ ] Confirm they can actually log in: SyncView, Staff sign in, their name should now be in the dropdown, then their tier's role key

## 2. The `team_members` insert

This table's row level security grants `SELECT` to anon/authenticated and nothing else.
`INSERT` / `UPDATE` / `DELETE` is `service_role` only, on purpose (see the gotchas below).
Run this with the Supabase service role, not the browser key:

```sql
insert into public.team_members (name, email, role, team, active)
values ('<full name>', '<email>', 'smm', null, true)
returning id, name, email, role, team, active, created_at;
```

- `role` is a check constraint: `admin`, `smm`, `editor`, `designer`. There is no separate
  "social media manager" string in the column, `smm` is it.
- `team` is nullable. Leave it `null` unless this hire is genuinely scoped to one
  production team; an SMM usually spans both.
- `slack_user_id` and `linear_user_id` start `null` and get filled in once §4 and §6 below
  are done. Nothing downstream breaks while they are empty, the login dropdown just will
  not show a Linear or Slack linked identity yet.

## 3. The role key handoff

There is no per-person password anywhere in this system. SyncView's staff sign in form is
a name picker (reading `team_members` live) plus one shared "role key" field per tier. The
key lives as an edge function secret (`ROLE_KEY_ADMIN` / `ROLE_KEY_SMM` /
`ROLE_KEY_CREATIVE`) and is not retrievable through any tooling, including this one, by
design. Whoever already holds the SMM key relays it to the new hire directly. There is
nothing to rotate or generate for one new person, unless you are deliberately rotating that
tier's key for everyone at once.

## 4. Linear

An SMM needs an actual Linear seat, not for issue syncing (SyncView drives that on its
own), but because their personal Linear API key is what gets stored against their row in
the Google Sheet and referenced whenever they are assigned to a client
(`NEW_CLIENT_ONBOARDING.md` §6g: "copy the `linear_api_key` value from any existing row for
that same SMM," which only works once this hire has minted their own). Invite them to the
workspace, then have them generate that key themselves. Nobody else can do it on their
behalf.

## 5. The Google Sheet roster

This is a second, separate roster from `team_members`. It is what `social_media_managers`
in Supabase syncs from (`source = 'google_sheet'`), and it is what
`NEW_CLIENT_ONBOARDING.md` reads from when assigning an SMM to a client. Add a row: name,
email, and the Linear API key from §4. Check `social_media_managers` in Supabase afterward
to confirm the row actually synced before relying on it downstream.

## 6. Slack

Invite them to the workspace. Once you have their Slack user id, update the `team_members`
row from §2 with it. This is what the client creative channel automation uses to notify or
tag them; without it they simply will not show up there.

## 7. Assigning their first client

Not part of this doc. Once they exist in both rosters, follow
`docs/ops/NEW_CLIENT_ONBOARDING.md` §6e (roster enrollment) and §6g (Linear project) for
whichever client they are picking up.

## What's automatic, and what is not

- Automatic: SyncView's staff sign in dropdown, the moment the `team_members` row exists.
  The `social_media_managers` Supabase sync, once the Google Sheet row exists (timing
  unconfirmed, verify it landed rather than assuming a schedule).
- Manual, every time: the `team_members` insert itself, the Linear invite, the Slack
  invite, the Google Sheet row, and relaying the role key by hand. None of these can be
  done from inside SyncView as of this writing.

## Gotchas & drift to watch

1. **Never put a new hire's full name in this repo.**
   `scripts/repo-identity-exposure-check.js` reads `team_members` (and `clients`) live from
   Supabase at scan time, not a fixture, and fails on any match of two or more words in
   lines your diff adds, active or not. A first name alone is fine. Run
   `node scripts/repo-identity-exposure-check.js --diff="origin/main"` before pushing if
   this doc ever gets a real example dropped into it.
2. **`team_members` being locked to `service_role` for writes is correct, not a bug.**
   Do not loosen that policy just to make onboarding easier, without thinking through who
   else would gain write access to the entire staff roster as a result.
3. **`team_members` and `social_media_managers` are not the same table.** One gates login,
   the other drives client assignment and reporting. A new hire needs to land in both, and
   the two are kept in step by hand.
4. **`auth_enforcement` defaults to `permissive`** (`syncview_runtime_flags`), meaning role
   key verification currently fails open if the verifier edge function is down. Not
   something to change as part of onboarding, just worth knowing the key is not the only
   thing standing between a browser and a staff view.

## Reference appendix

| What | Where |
|---|---|
| Staff sign in UI | `index.html`, `_syncviewRenderStaffIdentityForm` |
| Role key check | `supabase/functions/key-verify/index.ts`, `supabase/functions/_shared/staff-role-auth.ts` |
| Capability gating (what each role can see or do) | `index.html`, `_syncviewStaffCan()` |
| Staff roster, login gate | Supabase `public.team_members` |
| SMM roster, client assignment, Linear key | Supabase `public.social_media_managers`, synced from the SyncView Google Sheet's "Social Media Managers" tab |
| Role and auth scaffold migration | `supabase/migrations/2026-07-05-b0-linear-auth-scaffold.sql` |
| Historical one time seed script, not a live path | `scripts/b0-seed-auth-scaffold.js` |
| Client onboarding, for assigning a client afterward | `docs/ops/NEW_CLIENT_ONBOARDING.md` |
