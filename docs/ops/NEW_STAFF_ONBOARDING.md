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
| Supabase `team_members` | Gates the SyncView "Staff sign in" roster dropdown, and carries role/team | Manual insert. No admin UI and no invite flow exist for this. |
| Shared role key (`ROLE_KEY_ADMIN` / `ROLE_KEY_SMM` / `ROLE_KEY_CREATIVE`) | The actual credential. One key per role tier, not one per person | Nothing to generate, just hand over the key that already exists |
| `team_members.team` | For an editor or designer, this must exactly match the team they work in (`video` / `graphics`), it gates both assignee eligibility and their write permissions | Manual, set at insert time, not optional for these two roles |
| Linear workspace | Lets them log in and, once invited, gives you the ID to put in `team_members.linear_user_id`, which gates whether an editor or designer can be picked as an assignee | Seat invite is manual. Nothing currently backfills `linear_user_id` on its own, see §4 |
| SMM's personal Linear API key | Only relevant once they are assigned a client. Stored per client assignment row in the Google Sheet, not on `team_members` | Self generated in Linear once they have a seat |
| `pto_members` | Whether their Time Off request form works at all | Admin sets it in SyncView's own Time Off panel, see §6. Not every hire gets this benefit, that is an owner call |
| SyncView Google Sheet, "Social Media Managers" tab | Keyed by client, not by person, one row per client assignment | Not a general onboarding step, only touched when an SMM is actually assigned a client, see §7 |
| Slack workspace | The client creative channel automation reads the assigned SMM's row in the Sheet above, not anything on `team_members` | Seat invite is manual; the rest happens at client assignment time |
| SyncView Google Sheet, "Video Editors" tab | For an editor only: who the `send-urgent-slack` n8n workflow can resolve and tag in its `#video-editing` channel post for "URGENT TWEAKS NEEDED" pings on their work | Manual row (name, email only, no Slack column on the sheet itself), plus a separate n8n edit, see §5 |
| Company email | Identity anchor for the above | Owner's call. Some existing staff use a personal address instead, and that is fine |

## 1. Quick checklist

- [ ] Get: full name, email, role (`admin` / `smm` / `editor` / `designer`), and for an editor or designer, which team they are in (`video` for editor, `graphics` for designer, this is mandatory, not situational)
- [ ] Insert their `team_members` row (see §2)
- [ ] Hand them the existing shared role key for their tier, through a channel you would already trust with a secret. Never in this repo, never in a public Slack channel
- [ ] Invite them to the Linear workspace. For an editor or designer, look up their Linear user ID once they have joined and set `team_members.linear_user_id` by hand, nothing does this for you (see §4)
- [ ] Invite them to Slack (§5). If they are an editor, also register them for urgent tweak pings (§5), this is a separate step
- [ ] If this hire gets the Time Off benefit, set them up in SyncView's Time Off admin panel (§6), otherwise their request form will not work
- [ ] If assigning a client right away, that is a separate, per client step, follow §7 and `NEW_CLIENT_ONBOARDING.md`
- [ ] For an editor or designer, also register them in Workload's roster (§8), a working login and Linear mapping are not enough on their own for Workload's planning views
- [ ] Confirm they can actually log in: SyncView, Staff sign in, their name should now be in the dropdown, then their tier's role key. For an editor, also confirm they appear in the Create Post assignee picker for the video team. A designer has no equivalent picker, see §2's `default_for_team` note instead

## 2. The `team_members` insert

This table's row level security grants `SELECT` to anon/authenticated and nothing else.
`INSERT` / `UPDATE` / `DELETE` is `service_role` only, on purpose (see the gotchas below).
Run this with the Supabase service role, not the browser key. Fill in every placeholder,
including `role` and `team`, there is no safe default to copy as is:

```sql
insert into public.team_members (name, email, role, team, active)
values ('<full name>', '<email>', '<role>', <team>, true)
returning id, name, email, role, team, active, created_at;
```

- `role`: exactly one of `admin`, `smm`, `editor`, `designer` (a check constraint). There is
  no separate "social media manager" string, `smm` is it.
- `team`: `'video'` for `editor`, `'graphics'` for `designer`, an exact match, this is
  required. `assigneeEligibility()` in `supabase/functions/production-write/policy.mjs`
  denies `assignee_out_of_scope` the moment `team` does not match the target team, `null`
  included. Use `null` for `admin` and `smm`, an SMM usually spans both teams.
- Leave `linear_user_id` out of the insert, there is nothing to put there yet, see §4. Leave
  `slack_user_id` out too, it has no reader anywhere in the codebase (§5), setting it buys
  nothing.
- `default_for_team` is not in the insert above either, so it lands on its column default,
  `false`. For a **designer only**, this is what actually gets new graphics work
  auto-assigned to them: exactly one active designer may hold it `true` at a time
  (`autoAssigneeForIntake()`, `supabase/functions/production-write/index.ts`). A second
  `true` row does not just misroute work, it makes every graphics intake fail outright with
  `graphics_default_assignee_unavailable`. There is no manual fallback either, Create Post
  deliberately does not offer a graphics picker at all (`index.html`'s own comment: "that
  team assigns by its single `default_for_team` designer... the gateway still refuses a
  graphics override outright"). If this hire replaces the current default designer, flip
  both rows in the same operation, the old one to `false` and the new one to `true`. If
  they are an additional, non-default designer, leave it `false` and settle with the owner
  how their work is meant to route before calling onboarding complete, this doc does not
  have an answer for that.

## 3. The role key handoff

There is no per-person password anywhere in this system. SyncView's staff sign in form is
a name picker (reading `team_members` live) plus one shared "role key" field per tier. The
key lives as an edge function secret (`ROLE_KEY_ADMIN` / `ROLE_KEY_SMM` /
`ROLE_KEY_CREATIVE`) and is not retrievable through any tooling, including this one, by
design. Whoever already holds that tier's key (the same `ROLE_KEY_ADMIN` / `ROLE_KEY_SMM` /
`ROLE_KEY_CREATIVE` named above, matching the role picked in §2, not always the SMM one)
relays it to the new hire directly. There is nothing to rotate or generate for one new
person, unless you are deliberately rotating that tier's key for everyone at once.

## 4. Linear

Two separate things ride on a Linear seat, and neither happens automatically.

**Their personal Linear API key.** Only matters once they are assigned a client: it gets
stored in the Google Sheet's Social Media Managers tab, one copy per client row they cover
(§7). Nothing to do here if they have no client yet.

**`team_members.linear_user_id`.** This is what actually gates whether an editor or
designer can be picked as an assignee (`assigneeEligibility()`,
`supabase/functions/production-write/policy.mjs`). As of this writing, nothing fills this
in for you: `scripts/b1-linear-backfill.js` runs on a schedule
(`.github/workflows/b1-linear-incremental-refresh.yml`, every 30 minutes) but only ever in
`--incremental` mode, and `buildIncrementalPlan()` / `applyIncrementalPlan()` do not
construct or apply `team_member_link_updates`, that logic lives only in the full plan path
(`applyPlan()` / `applyReconciliation()`). The full path is manual only, never scheduled,
and is currently frozen anyway: it requires Linear authority for the teams it writes, and
both teams are SyncView authoritative post flip, so it throws `B1 authoritative write
frozen` before it would reach that logic. Assigning them a Linear issue and waiting does
not work right now.

So: once they have accepted the Linear invite, find their Linear user ID (their account's
`id` in Linear, not the personal API key above, for example via Linear's own member
settings or the Linear API) and set it directly:

```sql
update public.team_members set linear_user_id = '<their linear user id>'
where id = '<their team_members row id>'
returning id, name, linear_user_id;
```

## 5. Slack

Invite them to the workspace. `team_members` has a `slack_user_id` field, but as of this
writing nothing in the codebase reads it, filling it in is harmless bookkeeping, not the
thing that actually wires up client notifications. The real mechanism is per client
assignment: the Client, Slack Creative Channel Finalizer reads the `slack_profile_url`
column (misnamed, it actually holds a bare Slack user ID) on the assigned SMM's row in the
Google Sheet's Social Media Managers tab, not anything on `team_members`
(`NEW_CLIENT_ONBOARDING.md` §6c). A missing value there parks that client's channel job in
`waiting` rather than failing loudly. So there is nothing Slack specific to do at general
onboarding beyond the workspace invite, the rest happens at client assignment time (§7).

**If this hire is an editor**, there is a second, separate Slack mechanism, general to
them rather than tied to any one client: the "URGENT TWEAKS NEEDED" ping
(`index.html`, `URGENT_SLACK_URL`, the `send-urgent-slack` n8n workflow) posts to the
`#video-editing` channel and tags them there, it is not a DM, `URGENT_PING_KINDS.editor`
in `index.html` confirms `sentWhere: 'Posted to #video-editing'`. It resolves who to tag
by looking them up in the SyncView Google Sheet's "Video Editors" tab (name and email
only, `docs/truth/SHEETS.md`). That sheet has no Slack column at all, the actual Slack
identity comes from a second, hardcoded fallback map inside the n8n workflow itself. So a
new editor needs a row in that sheet tab, and separately needs that n8n map updated to
include them, or an urgent ping on their work resolves to nobody. Editing an n8n workflow
needs the owner's explicit go-ahead in the same request (`client-analytics/CLAUDE.md`
standing constraint), this is not something to do unilaterally even for a small addition.
Confirming with an actual urgent ping on a TEST card is worth doing once both are in
place, no automated check covers this path.

## 6. Time Off (if this hire gets the benefit)

Not every hire does, that is an owner decision, not a technical one, and nothing below
applies if they do not. Otherwise: completing everything above still leaves their Time Off
request form dead. `requestTimeOff()` (`supabase/functions/pto/index.ts`) returns
`pto_not_enabled` (403) whenever no `pto_members` row exists for them, or one exists with
`pto_enabled` false, which is the column's default.

This is set through SyncView itself, admin only, not a raw SQL write: sign in as admin,
open the Time Off admin panel, choose their name from the member picker, set their real PTO
start date, and check the enabled box. That submits the `set_start_date` action, which
runs through the `pto_set_member_start_v1` database function rather than a plain insert, so
balances and history stay consistent from day one. A raw insert against `pto_members`
skips that and is not the supported path.

## 7. Assigning a client

Not a general onboarding step; skip this section entirely for a hire with no client yet,
there is no "blank" roster entry to create for them in advance. What to do next also
depends on whether the client is brand new or already has a different SMM, the two are
not interchangeable and following the wrong one either creates a duplicate resource or
silently does nothing.

**The Sheet row, either way.** The "Social Media Managers" Sheet tab is keyed by client,
one row per assignment, not one row per person (`NEW_CLIENT_ONBOARDING.md` §5, "Social
Media Managers" row, not §6e, which is a different, automated write-enrollment step).
Columns: `client_name | social_media_manager | linear_api_key | slack_profile_url`.

- `client_name`: the client this row is for, this is the row's key
- `social_media_manager`: their first name
- `linear_api_key`: copied from any of their existing rows if they already cover another
  client, otherwise their own personal key from §4
- `slack_profile_url`: their Slack user ID from §5, needed for the creative channel
  automation to run at all

**A brand new client, no SMM assigned before now.** Follow
`docs/ops/NEW_CLIENT_ONBOARDING.md` §6c (Slack), §5 (this roster, above), and §6g
(Linear project) as written, all three create their resource from scratch.

**An existing client changing SMM.** Do not follow §6c or §6g as written, both assume
nothing exists yet. §6c's Slack finalizer only fires when the client's `creative_channel_id`
is not already set, so once a channel exists it silently does nothing on a re-run. §6g's
steps create a brand new Linear project, which would duplicate the one already there
rather than reassign it. Instead, directly: in Linear, change the existing project's lead
to the new hire; in Slack, invite them to the existing `{client}-creative` channel. Both
are ordinary manual actions in their respective tools, this doc's automation was built for
a client's first SMM, not a handoff between two.

## 8. Workload roster (editor and designer)

A separate system from everything above, and easy to miss because nothing else in this
doc touches it: Workload's capacity and assignment-filter views read from three constants
hardcoded directly in `index.html`, not from `team_members` or any database table.
`WL_ALLOWED_EDITORS` and `WL_ALLOWED_GRAPHICS` are the normalized-name allowlists Workload
filters assigned rows through (`wlIsAllowedEditor()`), and `WL_VIDEO_EDITORS` separately
seeds the "freest first" capacity ranking with every video editor, including one currently
at zero active work, keyed by Linear user id. None of this reads `team_members` or
`linear_user_id`, or anything else this doc has set up. A hire can pass every check above,
the `team_members` row, the role key, the Linear mapping, and still be invisible to
Workload: excluded from the capacity ranking, and their assigned work filtered out of the
normal planning views.

This needs a code change, not a data change: add the new hire's normalized name
(`wlNormalizeEditor()` has the exact rule, roughly lowercase, accents stripped, separators
removed) to the matching allowlist, and for a video editor, their Linear user id and a
display name to `WL_VIDEO_EDITORS` too. Use a short label for that display name, a first
name is enough, not their full `team_members.name`. The existing entries there are full
names (`index.html:15974-15977`), but they predate
`scripts/repo-identity-exposure-check.js` and are grandfathered; a new line that adds a
hire's full name verbatim is exactly what that check's diff mode exists to catch
(`.github/workflows/calendar-unit-tests.yml`), and diff mode has no baseline to raise, any
match fails the PR outright. The check matches the complete stored name as one substring,
so a first name alone will not trip it. That means an ordinary PR to `index.html`, reviewed
and merged like any other code change, using a short display label from the start rather
than discovering the CI failure after the fact. Verify by opening Workload after it ships
and confirming the hire actually shows up.

## What's automatic, and what is not

- Automatic: the SyncView staff sign in dropdown, the moment the `team_members` row exists.
  That is the only thing on this list that is.
- Manual, every time: the `team_members` insert (`team` included, for editor/designer), the
  `linear_user_id` lookup and update, the Linear and Slack invites, relaying the role key by
  hand, Time Off enablement if this hire gets that benefit, the Workload roster code change
  for an editor or designer (§8), and everything in §7, which happens once per client
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
3. **`team_members` and `social_media_managers` are two different rosters, and only the
   Sheet feeding the second one is client-keyed, not the table itself.** `team_members` is
   what this whole doc is about, SyncView login and permissions. `public.social_media_managers`
   backs an unrelated feature, the SMM Weekly Reports form dropdown (`smm-weekly-reports`
   edge function), and it is person-keyed: primary key `slug`, a unique index on
   `lower(name)`, with every client an SMM covers rolled into one `source_clients` jsonb
   column on their single row. The client-keyed one is the Social Media Managers Sheet tab
   (§7): n8n's Manager Sync workflow reads it, normalizes its per-client rows into unique
   people, and upserts the result into this table on its own schedule. There is still
   nothing to create here by hand: an SMM with no client yet has no Sheet row to normalize,
   so they get no row in this table either, but that is a consequence of what the Sheet
   holds, not because the table is keyed by client.
4. **`team` is mandatory for editor and designer, not a default-to-null field like it is
   for admin/SMM.** Leaving it `null` passes the insert but silently fails every
   assignment for that hire (`assignee_out_of_scope`) and blocks their status/comment
   writes on production work. Get the exact value at intake time (§1), not after something
   breaks. The insert template in §2 has no safe copy-paste default for this reason,
   `role` and `team` are placeholders on purpose.
5. **`linear_user_id` does not backfill on its own right now.** The scheduled
   reconciliation job runs every 30 minutes but never reaches the code that links it (§4);
   the path that does is manual only and is currently frozen by an authority guard besides.
   Set it by hand after the Linear invite is accepted, do not wait for it to appear.
6. **Verifier failures fail closed for capabilities either way, but only a 401 clears the
   cached session.** `_syncviewVerifyStaffIdentity()` throws with `error.status` set from
   the HTTP response. The browser's boot logic branches on that status alone: exactly `401`
   clears the cached identity and prompts a fresh sign in; any other failure (network error,
   5xx, timeout) retains the cached identity locally but still invalidates verification, so
   gated capabilities are unavailable either way, just without forcing a re-prompt. The
   `auth_enforcement` runtime flag does not factor into this branch at all; two earlier
   versions of this doc attributed browser behavior to it, both were wrong, corrected
   2026-09-11.
7. **A working login says nothing about Time Off or assignability.** `key-verify` only
   checks role compatibility, so a brand new editor can sign in fine while still being
   unable to appear in the assignee picker (§4, gotcha 5) or file a Time Off request (§6).
   "They can log in" is not the same question as "they can do their job", check both.
8. **Graphics has no picker and no second default.** Create Post never offers a graphics
   assignee choice at all, work routes to whichever single `team_members` row has
   `default_for_team` true. Giving a new designer that flag without clearing it from
   whoever had it before does not create a second option, it breaks all graphics intake
   (§2).
9. **Workload has its own hardcoded roster, entirely separate from `team_members`.**
   `WL_ALLOWED_EDITORS`, `WL_ALLOWED_GRAPHICS`, and `WL_VIDEO_EDITORS` in `index.html` are
   what Workload actually reads. Nothing else in this doc updates them, so nothing else in
   this doc is sufficient to make a new editor or designer visible there (§8).
10. **Registering that same hire in `WL_VIDEO_EDITORS` can fail CI on its own.**
    `scripts/repo-identity-exposure-check.js` runs in diff mode on every PR
    (`.github/workflows/calendar-unit-tests.yml`) and fails outright the moment an added
    line contains a `team_members` full name verbatim, with no baseline to raise in that
    mode, unlike its whole-tree scheduled run. A hire's real display name is exactly that.
    Use a short label instead, see §8.

## Reference appendix

| What | Where |
|---|---|
| Staff sign in UI | `index.html`, `_syncviewRenderStaffIdentityForm` |
| Role key check | `supabase/functions/key-verify/index.ts`, `supabase/functions/_shared/staff-role-auth.ts` |
| Capability gating (what each role can see or do, browser side) | `index.html`, `_syncviewStaffCan()` |
| Assignee eligibility and write permission policy (server side, authoritative) | `supabase/functions/production-write/policy.mjs`, `assigneeEligibility()` / `staffOperationAllowed()` |
| Staff roster, login gate | Supabase `public.team_members` |
| `linear_user_id` reconciliation logic (not reached by the scheduled run, see §4) | `scripts/b1-linear-backfill.js`, `.github/workflows/b1-linear-incremental-refresh.yml` |
| Time Off gating and admin setup action | `supabase/functions/pto/index.ts` (`requestTimeOff`, `setStartDate`), `index.html` (`ptoAdminMember` / `ptoAdminStart` / `ptoAdminEnabled`) |
| SMM roster, client assignment, Linear key, Slack ID | SyncView Google Sheet, "Social Media Managers" tab (client-keyed, see §7), normalized by n8n's Manager Sync into person-keyed Supabase `public.social_media_managers` (gotcha 3) |
| Identity exposure gate (diff mode, blocks a PR that adds a name or client slug) | `scripts/repo-identity-exposure-check.js`, `.github/workflows/calendar-unit-tests.yml`; see gotcha 1, gotcha 10 |
| Editor urgent-tweak Slack resolution | `index.html` (`URGENT_SLACK_URL`), n8n `send-urgent-slack` workflow, SyncView Google Sheet "Video Editors" tab (`docs/truth/SHEETS.md`); see §5 |
| Graphics single-default auto-assignment | `supabase/functions/production-write/index.ts` (`autoAssigneeForIntake()`), `team_members.default_for_team`; see §2 |
| Workload's hardcoded roster (separate from `team_members`) | `index.html` (`WL_ALLOWED_EDITORS`, `WL_ALLOWED_GRAPHICS`, `WL_VIDEO_EDITORS`, `wlNormalizeEditor()`); see §8, gotcha 10 |
| Role and auth scaffold migration | `migrations/2026-07-05-b0-linear-auth-scaffold.sql` |
| Historical one time seed script, not a live path | `scripts/b0-seed-auth-scaffold.js` |
| Client onboarding, for assigning a client afterward | `docs/ops/NEW_CLIENT_ONBOARDING.md` |
