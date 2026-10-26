# Leads (CRM), step 1

The Leads page is where we keep everyone we might sell to, where each person is
in the conversation, and what happens next. It lives at **`/leads`** and is
linked from **Kasper > More > Pipeline & Admin > Leads**. Admin only today.

Step 1 (this page) is the model, the Pipeline and the person panel. Today,
Sequences and Systems are tabs that say what is coming; nothing is sent to
anyone by this step.

## What is where

| Piece | File |
|---|---|
| Tables | `supabase/migrations/20261026120000_crm_leads.sql` |
| Edge Function | `supabase/functions/crm-leads/index.ts` |
| Shared rules (access, normalisers, validation, events, import) | `supabase/functions/_shared/crm-leads-core.mjs` |
| Page | `src/index/328-crm-leads.js.part` (route `leads`, `092` navTo, stub `leads.html`) |
| Import | `scripts/crm-import.js` (run by a person, never by CI) |
| Tests | `test/crm-leads.js`, `docs/syncview-design/tests/crm-leads-browser.js` (real browser, fully mocked), plus the Kasper nav keys in `test/kasper-priority-more-nav.js` and `test/hiring-process-ui.js` |

## The model

- **`crm_people`**: one row per person. Display name, email, phone, Instagram
  handle, lead type (`dream100`, `ad_lead`, `past_call`, `email`), niche,
  source (the import batch), stage, owner, next step and its due date, lost
  reason (`price`, `trust`, `timing`, `budget`, `no_show`), tags and
  `state_version`. Email, phone and handle are each unique **after
  normalising** (lower-case trimmed email, digits-only phone of 7 or more,
  handle without `@` or `[bracketed tags]`), through generated columns, so the
  database itself refuses a duplicate.
- **Stages**, in order: to contact, contacted, replied, call 1 booked, no-show,
  call 1 done, call 2 done, nurture, won, lost.
- **`crm_events`**: the timeline. Append-only: the service role may only insert
  and read, and a trigger refuses update and delete for every role. Each row
  has a kind (`stage_changed`, `owner_changed`, `next_step_set`, `note`,
  `lost_reason_set`, `tags_changed`, `imported`, and for later `message_sent`,
  `reply`, `call`), a channel, the actor, optional sequence and step ids, and
  a `detail` JSON.
- **`crm_sources`**: where a batch of people came from (name, kind, link).
  The Pipeline's "Batch" filter is this.
- **`crm_sequences`, `crm_sequence_steps`, `crm_enrolments`**: the follow-up
  plans, ready for step 2 (below). Empty and unused in step 1.

**Access.** The tables hold contact details. RLS is on and every privilege is
revoked from `public`, `anon`, `authenticated` and `service_role`; then the
service role gets back exactly what it needs. The browser never reads them;
only the `crm-leads` function (and the import script, with the service role
key) does.

## The function

`POST /functions/v1/crm-leads`, staff role key in `X-Syncview-Key`:

| action | body | answer |
|---|---|---|
| `list` | `{ filters: { lead_type, niche, owner, source_id, stage, due_this_week } }` | `{ people, sources, truncated }`, up to 500 cards, no email or phone |
| `get` | `{ id }` | `{ person, source, events }`, events newest first |
| `update` | `{ id, expected_version, patch, note? }` | `{ person }`, or `409 { error: "conflict", current }` |
| `note` | `{ id, note }` | `{ person }` |

`patch` may set `stage`, `owner`, `next_step`, `next_step_due`, `lost_reason`
and `tags`, nothing else. Unknown filter values are dropped (the list just has
fewer filters); a bad patch is refused with a code. A change goes through the
database function `crm_apply_change`, which does the compare-and-swap on
`state_version` and writes the `crm_events` rows in the **same transaction**,
so a change without its timeline row cannot happen. A save that changes
nothing writes nothing.

On the page, a refused write is recorded with `_writeUiRecordFailure('leads', ...)`
(the write-refusal log) and the person is told what happened. A lost race shows
the newer copy and asks them to make their change again if it still applies.

## Who can use it, and adding one person

The `leads` capability is `role === 'admin'` in `_syncviewStaffCan` (page) and
`LEADS_ROLES = ['admin']` in `crm-leads-core.mjs` (function).

To let **one** non-admin staff member in, add one line in each of two places,
in the same PR:

1. `supabase/functions/_shared/crm-leads-core.mjs`: `LEADS_MEMBER_GRANTS`, add
   `{ role: 'smm', actor: '<their display name as SyncView shows it>' }`.
2. `src/index/328-crm-leads.js.part`: `CRM_LEADS_MEMBER_GRANTS`, add the same
   display name (this only makes the page open for them; the Kasper link is
   already admin-only, so they use `/leads` directly).

The function redeploys by itself on merge. Plainly: staff keys are per role,
not per person, and the actor header is attribution the browser sends. So this
grant keeps Leads out of everyone else's way but cannot stop another member of
the same role who forges the header. It is a grant inside an already-trusted
role. Real per-person isolation needs per-person keys (a key per staff member
checked by `staff-role-auth.ts`), which SyncView does not have yet. To open
Leads to a whole role instead, add the role to `LEADS_ROLES` and the
`_syncviewStaffCan('leads')` line.

## Importing people

```
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/crm-import.js --source="<batch name>" --lead-type=dream100 [--tag=bench] [--apply] export.csv
```

- Dry run unless `--apply`; prints counts only, never a name or contact.
- Dedupes on email, then phone, then handle, against the stored people and
  within the files.
- Cuts `[NEAR-MISS: ...]` (and any other bracketed tag) out of handles and tags
  the person `near-miss`; a `bench` column saying yes, or `--tag=bench`, adds
  `bench`; a row whose `excluded` / `exclude` / `status` column says yes or
  `excluded` is skipped; a row with no email, phone or handle is skipped.
- An existing person only has blanks filled and tags added: stage, owner and
  next step are never touched. Each new or changed person gets one `imported`
  timeline row. The batch name becomes a `crm_sources` row.

## How sequences will plug in (step 2)

1. A sequence is a named list of steps for a lead type: day offset, channel
   (`instagram_dm`, `email`, `sms`, `call`, `task`) and template text. Editing a
   live sequence makes a new `version`, so people already in it keep the
   wording they were enrolled with.
2. Enrolling a person writes a `crm_enrolments` row (one active enrolment per
   person per sequence, enforced by a unique index) pointing at the current
   step.
3. **Today** lists, for each active and not paused enrolment, the step whose
   day has come, beside every person whose own next step is due. Doing it
   (sending the DM by hand, logging the call) appends a `message_sent` or
   `call` event with `sequence_id` and `step_id`, and moves the enrolment on.
4. A reply (`reply` event) or a stage change to won, lost or call booked
   pauses or stops the enrolment, so nobody gets a follow-up after they
   answered.
5. Anything that sends by itself (email, SMS) is a later step, behind its own
   switch and the owner's go.

**Systems** will show where leads come from (`crm_sources`: imports, the quiz,
ads) and how each is doing.

## Applying the migration (Lighthouse)

The migration starts with an `ef-auto-deploy-applied-when` line, so the merge
lane holds `crm-leads` until the tables exist, then deploys it by itself.

1. Apply `supabase/migrations/20261026120000_crm_leads.sql` in the Supabase SQL
   editor and read back: `select to_regclass('public.crm_people'),
   to_regclass('public.crm_events'), to_regclass('public.crm_enrolments');`
   (three names, none null).
2. If the merge's lane run held `crm-leads`, run
   [the merge lane](https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-edge-functions-on-merge.yml)
   by hand: `commit_sha` = the merge commit, `migrations_applied` = ticked.
3. Check: `/leads` as an admin shows an empty Pipeline that says how to import.

Rollback: the drop statements are at the top of the migration file; nothing
else depends on these tables.
