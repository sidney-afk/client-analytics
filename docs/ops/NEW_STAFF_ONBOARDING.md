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
| Linear workspace | Lets them log in. Also, for an editor or designer, the eventual source of `team_members.linear_user_id`, which gates whether they can be picked as an assignee in Create Post | Seat invite is manual. `linear_user_id` itself normally fills in on its own, see §4 |
| SMM's personal Linear API key | Only relevant once they are assigned a client. Stored per client assignment row in the Google Sheet, not on `team_members` | Self generated in Linear once they have a seat |
| SyncView Google Sheet, "Social Media Managers" tab | Keyed by client, not by person, one row per client assignment | Not a general onboarding step, only touched when an SMM is actually assigned a client, see §6 |
| Slack workspace | The client creative channel automation reads the assigned SMM's row in the Sheet above, not anything on `team_members` | Seat invite is manual; the rest happens at client assignment time |
| Company email | Identity anchor for the above | Owner's call. Some existing staff use a personal address instead, and that is fine |

## 1. Quick checklist

- [ ] Get: full name, email, role (`admin` / `smm` / `editor` / `designer`), and whether they are tied to one production team (`video` / `graphics`) or neither
- [ ] Insert their `team_members` row (see §2)
- [ ] Hand them the existing shared role key for their tier, through a channel you would already trust with a secret. Never in this repo, never in a public Slack channel
- [ ] Invite them to the Linear workspace (§4). If they are an editor or designer, do not assume the seat alone makes them assignable, see the `linear_user_id` note
- [ ] Invite them to Slack (§5)
- [ ] If assigning a client right away, that is a separate, per client step, follow §6 and `NEW_CLIENT_ONBOARDING.md`
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
- Leave `slack_user_id` and `linear_user_id` out of the insert. Neither should be set by
  hand: `slack_user_id` has no current reader anywhere in the codebase (§5), and
  `linear_user_id` fills in on its own once Linear has something assigned to this person
  (§4). Setting them at insert time does not buy anything.

## 3. The role key handoff

There is no per-person password anywhere in this system. SyncView's staff sign in form is
a name picker (reading `team_members` live) plus one shared "role key" field per tier. The
key lives as an edge function secret (`ROLE_KEY_ADMIN` / `ROLE_KEY_SMM` /
`ROLE_KEY_CREATIVE`) and is not retrievable through any tooling, including this one, by
design. Whoever already holds the SMM key relays it to the new hire directly. There is
nothing to rotate or generate for one new person, unless you are deliberately rotating that
tier's key for everyone at once.

## 4. Linear

Two separate things ride on a Linear seat, and they are easy to conflate.

**Their personal Linear API key.** Only matters once they are assigned a client: it gets
stored in the Google Sheet's Social Media Managers tab, one copy per client row they cover
(§6). Nothing to do here if they have no client yet.

**`team_members.linear_user_id`.** This is what actually gates whether an editor or
designer can be picked as an assignee in SyncView's Create Post picker (`index.html`'s
roster queries for those roles filter on `linear_user_id=not.is.null`). It is normally
filled in automatically: `scripts/b1-linear-backfill.js`, run every 30 minutes by
`.github/workflows/b1-linear-incremental-refresh.yml`, matches Linear issue assignees back
to `team_members` by email and patches `linear_user_id` in once it finds one. A brand new
hire has no assignment history yet, so there is nothing for it to match on the first few
cycles. If you need them assignable sooner, assign them one issue directly in Linear itself
under their invited email (not through SyncView's picker, which already excludes them);
the next reconciliation run picks it up.

Either way, invite them to the workspace first. The personal API key only exists once they
are in; `linear_user_id` only fills in once Linear itself has an issue assigned to that
email.

## 5. Slack

Invite them to the workspace. `team_members` has a `slack_user_id` field, but as of this
writing nothing in the codebase reads it, filling it in is harmless bookkeeping, not the
thing that actually wires up client notifications. The real mechanism is per client
assignment: the Client, Slack Creative Channel Finalizer reads the `slack_profile_url`
column (misnamed, it actually holds a bare Slack user ID) on the assigned SMM's row in the
Google Sheet's Social Media Managers tab, not anything on `team_members`
(`NEW_CLIENT_ONBOARDING.md` §6c). A missing value there parks that client's channel job in
`waiting` rather than failing loudly. So there is nothing Slack specific to do at general
onboarding beyond the workspace invite, the rest happens at client assignment time (§6).

## 6. Assigning their first client

Not a general onboarding step, and it works differently than the rest of this doc might
suggest: the "Social Media Managers" Sheet tab is keyed by client, one row per assignment,
not one row per person (`NEW_CLIENT_ONBOARDING.md` §6e). Columns: `client_name |
social_media_manager | linear_api_key | slack_profile_url`. For a new client assignment:

- `social_media_manager`: their first name
- `linear_api_key`: copied from any of their existing rows if they already cover another
  client, otherwise their own personal key from §4
- `slack_profile_url`: their Slack user ID from §5, needed for the creative channel
  automation to run at all

Then follow `docs/ops/NEW_CLIENT_ONBOARDING.md` §6c (Slack), §6e (this roster), and §6g
(Linear project) for the rest of that client's setup. There is no "blank" roster entry to
create for a hire before they have a client; skip this section entirely until they do.

## What's automatic, and what is not

- Automatic: the SyncView staff sign in dropdown, the moment the `team_members` row
  exists. `team_members.linear_user_id`, within about 30 minutes of them being assigned a
  Linear issue under a matching email (§4).
- Manual, every time: the `team_members` insert itself, the Linear and Slack invites,
  relaying the role key by hand, and everything in §6, which happens once per client
  assignment, not once per hire.

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
3. **`team_members` and `social_media_managers` are not the same table, and the second one
   is keyed by client, not by person.** A hire only gets a `social_media_managers`-backed
   row once they are assigned a client (§6); there is nothing to create for them before
   that, and no per-person roster entry to keep in sync.
4. **A brand new editor or designer will not be pickable in Create Post right away.**
   `linear_user_id` only backfills once Linear has an issue assigned to their email, on a
   30 minute cycle (§4). If someone reports they cannot find the new hire in an assignee
   list right after onboarding, this is why, not a bug.
5. **Verifier outages fail closed for capabilities, not open.** If `key-verify` is
   unreachable, `_syncviewVerifyStaffIdentity()` throws and the browser invalidates
   `_syncviewStaffIdentityVerified` rather than granting anything; `_syncviewStaffCan()`
   requires that flag to be true, with no exception. The `auth_enforcement` runtime flag's
   `permissive` mode governs whether the browser also hard clears the cached identity and
   forces a fresh sign in prompt during that outage, it does not bypass verification for
   gated actions either way. An earlier version of this doc described this as failing
   open; that was wrong, corrected 2026-09-11.

## Reference appendix

| What | Where |
|---|---|
| Staff sign in UI | `index.html`, `_syncviewRenderStaffIdentityForm` |
| Role key check | `supabase/functions/key-verify/index.ts`, `supabase/functions/_shared/staff-role-auth.ts` |
| Capability gating (what each role can see or do) | `index.html`, `_syncviewStaffCan()` |
| Staff roster, login gate | Supabase `public.team_members` |
| `linear_user_id` backfill | `scripts/b1-linear-backfill.js`, run every 30 minutes by `.github/workflows/b1-linear-incremental-refresh.yml` |
| SMM roster, client assignment, Linear key, Slack ID | SyncView Google Sheet, "Social Media Managers" tab, synced into Supabase `public.social_media_managers`; keyed by client, see §6 |
| Role and auth scaffold migration | `supabase/migrations/2026-07-05-b0-linear-auth-scaffold.sql` |
| Historical one time seed script, not a live path | `scripts/b0-seed-auth-scaffold.js` |
| Client onboarding, for assigning a client afterward | `docs/ops/NEW_CLIENT_ONBOARDING.md` |
