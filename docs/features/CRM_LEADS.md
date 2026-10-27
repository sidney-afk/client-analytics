# Leads (CRM)

The Leads page is where we keep everyone we might sell to, where each person is
in the conversation, and what happens next. It lives at **`/leads`** and is
linked from **Kasper > More > Pipeline & Admin > Leads**. Admin only today.

Step 1 was the model, the Pipeline and the person panel. Step 2 adds the
sequence engine (data only), four draft sequences, and the Today, Sequences
and Systems tabs. **Nothing in Leads sends a message.** Sending is a later
n8n step that asks the `due` action what it may send and records each result
with `log_send`.

## What is where

| Piece | File |
|---|---|
| Tables | `supabase/migrations/20261026120000_crm_leads.sql` |
| Edge Function | `supabase/functions/crm-leads/index.ts` |
| Shared rules (access, normalisers, validation, events, import) | `supabase/functions/_shared/crm-leads-core.mjs` |
| Sequence rules (timing, quiet hours, stop rules, step edits, send log) | `supabase/functions/_shared/crm-sequences-core.mjs` |
| The n8n automations list (Systems tab) | `supabase/functions/_shared/crm-automations.mjs` |
| Page | `src/index/328-crm-leads.js.part` (route `leads`, `092` navTo, stub `leads.html`) |
| Import | `scripts/crm-import.js` (run by a person, never by CI) |
| Tests | `test/crm-leads.js`, `test/crm-sequences.js`, `docs/syncview-design/tests/crm-leads-browser.js` (real browser, fully mocked), plus the Kasper nav keys in `test/kasper-priority-more-nav.js` and `test/hiring-process-ui.js` |

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
- People also have `timezone` (IANA name; blank means America/New_York),
  `call_at` (when call 1 is booked for) and `opted_out_at`.
- **`crm_sequences`, `crm_sequence_steps`, `crm_enrolments`**: the follow-up
  sequences (below).

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

## Sequences (step 2)

**Model.**

- `crm_sequences`: `key`, name, description, `stay_stages` (the stages a person
  must still be in; a move anywhere else stops their enrolment) and `active`
  (**off** by default).
- `crm_sequence_steps`: `step_key`, position, `day_offset`, `hour_offset`,
  `send_hour` (an hour in the lead's own time, or blank for "N hours after
  they joined"), channel (`sms` or `email`), `audience` (`all`, or a lost-reason
  variant: `lost_price`, `lost_trust`, `lost_other`), subject (email), template,
  `version`, `is_current`, and `approval_state` (`draft` or `approved`) with
  `approved_by` / `approved_at`. Texts are capped at 300 characters by the
  table itself.
- **Editing a step** (`crm_step_new_version`) marks the current row not current
  and inserts version + 1 as a **draft**, so every edit needs approving again.
  Enrolments record what they sent by `step_key` (`sent_step_keys`), so a step
  already sent stays sent and only unsent steps pick up the new wording.
- `crm_enrolments`: one active row per person per sequence, `paused`,
  `sent_step_keys`, `skipped_step_keys`, `stop_reason`. Enrol, pause, resume,
  skip, stop, complete and every send result go through `crm_enrol` /
  `crm_enrolment_apply`, which write the `crm_events` row in the same
  transaction (`enrolled`, `enrolment_paused`, `enrolment_resumed`,
  `step_skipped`, `enrolment_stopped`, `enrolment_completed`, `message_sent`,
  `send_failed`, `send_skipped`).

**Placeholders.** `{first_name}` (first word of the name, without "Dr") and
`{niche}` are filled from the person. `{rebook_link}`, `{call2_link}`,
`{case_study_link}`, `{testimonials_link}` and `{useful_link}` are left in place
and listed in `needs` for the sender to fill. An edit with any other
`{placeholder}` is refused.

**The `due` rules** (`evaluateEnrolment`, tested in `test/crm-sequences.js`),
for each active enrolment, in this order:

1. **Stop** if the person opted out (`opted_out_at`, or an `opted_out` event),
   replied (`reply` event) or booked (`booked` event) after enrolling, or their
   stage is no longer one of the sequence's `stay_stages`.
2. **Complete** when every step for them (their lost-reason variant only) is
   sent or skipped.
3. Otherwise the next step in position order, one at a time (a backlog never
   sends a burst):
   - **wait** until it is due;
   - **hold** if the enrolment is paused, the sequence is **off**, the step is
     **not approved**, the person has no phone (text) or email (email), the
     rendered text is over 300 characters, or, for a text, it is outside
     **08:00 to 18:00 in the lead's time zone**;
   - else **send**: channel, to, subject, rendered body, `needs`.

`due` is a dry run unless the body says `dry_run: false`; only then does it
write the stops and completions it found. It never sends. `log_send
{ enrolment_id, step_id, result: sent|failed|skipped, provider_id?, error? }`
records the result as an event (and marks the step sent on `sent`), even if the
enrolment stopped in between, so nothing a sender did goes unlogged.

**Who may call what.** `due`, `log_send` and `ingest` take only the server key: header
`X-Crm-Sender-Key` equal to the `CRM_SENDER_KEY` secret (24 characters or
more; unset means off), or `Authorization: Bearer <service role key>`. They
refuse a staff key, and the page never calls them. Every other action takes
the staff key with Leads access; `step_approve` takes the **admin** role only.

**The four seeded sequences** (all OFF, every step a DRAFT for Kasper):

| Sequence | Stays while | Steps |
|---|---|---|
| No-show on call 1 | `no_show` | text right away with the rebook link, text next morning 09:00, email day 2, text day 4, email day 7 "Rebook or close your file?" |
| Did call 1, no call 2 | `call1_done` | text 2 hours later with the call-2 link, email day 2 (case study from their field), text day 4, email day 7 (something useful for their account), text day 10, email day 14 |
| Did call 2, did not sign | `call2_done`, `lost` | six touches over 14 days: text day 0, email day 2 by lost reason (price: case study; trust: testimonials; other: an example), text day 5, email day 8, text day 11, email day 14 "What would need to change?" |
| Nurture | `nurture`, `lost` | one useful email a week for six weeks |

The copy is in Kasper's voice (plain, short, warm, first person, signed
"Kasper"), written for doctors who sell a course, a program or a membership,
and claims no results or numbers. The test checks each text is under 300
characters, each email signs off Kasper, and only known placeholders appear.

## The tabs

- **Today**: next steps due today or overdue, grouped by owner; calls whose
  `call_at` has passed while the person is still "Call 1 booked", each with
  **Showed** (stage to Call 1 done) and **No-show** (stage to No-show, and the
  person is **enrolled** in the No-show sequence; enrolment only, it sends
  nothing while the sequence is off or its steps are drafts); and the
  automatic sends due in the next 24 hours with their state (ready, scheduled,
  or held and why).
- **Sequences**: one card per sequence: on/off switch, people in it now,
  approved count, and each step (when, channel, lost-reason variant, subject
  and text, Draft/Approved). **Edit** opens the step in place (Escape keeps
  what you typed; Cancel throws it away) and saves a new draft; **Approve** is
  shown to admins.
- **Systems**: read-only map of every automation: the sequences (generated
  from the data) and the n8n automations in
  `supabase/functions/_shared/crm-automations.mjs`. For each: trigger, who gets
  it, channel, who it comes from, timing, and whether it is logged in the
  Leads timeline yet (n8n ones are not, until they call `ingest` or `log_send`). **To
  change that list, edit that one file**; describe senders by role only (no
  phone numbers, addresses or ids: the repo is public).
- The **person panel** also lists their sequences (pause/resume, skip the next
  step, stop) and can add them to one.

A staff sign-out or a change of staff member clears everything Leads holds in
memory (people, notes, drafts, sequences) and ignores any read still in
flight (`_crmPurgeSensitiveState`, `_crmOnIdentity`, called from
`100-onboarding-staff-controls`).

## Ingest: n8n logs lead activity

`ingest` is a server-key action (same key rules as `due`) that n8n calls once
per fact: a form, a booking, a cancel, a send, a reply. No migration was
needed: each event maps onto a `crm_events` kind the table already allows,
and the n8n event name is kept in `detail.event`.

Request (POST `/functions/v1/crm-leads`, header
`Authorization: Bearer <service role key>` or `X-Crm-Sender-Key`):

```json
{
  "action": "ingest",
  "event": "booked",
  "idempotency_key": "iclosed:booking:<booking id>:booked",
  "occurred_at": "2026-11-01T14:03:00Z",
  "call_at": "2026-11-03T16:00:00Z",
  "person": { "name": "First Last", "email": "a@example.com", "phone": "+1 555 010 0000", "instagram": "@handle", "timezone": "America/Chicago" },
  "source": { "name": "doctors-ad", "kind": "ad" },
  "channel": "call",
  "actor": "n8n:Booking Handler",
  "detail": { "utm_source": "facebook", "utm_campaign": "c1", "provider_id": "abc" }
}
```

- `event`, `idempotency_key` (1-200 chars) and at least one of email, phone
  or instagram are required. `call_at` is required for `booked` and
  `rescheduled`. `source.kind` is one of `csv_import`, `quiz`, `ad`,
  `referral`, `manual`, `other` (anything else becomes `other`). `channel`
  overrides the default below. `actor` defaults to `n8n`.
- `detail` is flat: strings (cut to 300), numbers, booleans; at most 30 keys.
  Keys like `body`, `text`, `html`, `message`, `content`, `transcript` and
  anything token-, secret-, password- or key-shaped are dropped. **Never send
  message bodies**: send a provider id or template name instead.
- `occurred_at` is stored in `detail.occurred_at` (the row's own time is when
  it was logged).

| event | kind written | default channel | person change |
|---|---|---|---|
| `form_capture`, `form_submit` | `imported` | system | none |
| `booked` | `booked` | call | stage to Call 1 booked if it was To contact, Contacted, Replied or No-show; sets `call_at` |
| `cancelled` | `call` | call | clears `call_at` (old slot kept in detail); stage unchanged |
| `rescheduled` | `call` | call | sets `call_at` |
| `no_show_marked` | `call` | call | none (staff mark the outcome in Today) |
| `sms_sent`, `recovery_sms_sent` | `message_sent` | sms | none |
| `email_sent`, `recovery_email_sent`, `confirmation_sent`, `nurture_sent` | `message_sent` | email | none |
| `sms_reply` | `reply` | sms | stage to Replied if To contact or Contacted; **stops every active sequence** (reason `replied`) |

A `booked` row also stops sequences at the next `due` run (the stop rule
reads `booked` and `reply` rows). Every stage or `call_at` change also writes
its `stage_changed` / `call_at_set` row.

The person is found by normalised email, then phone, then handle. A new one
is created as `ad_lead` at To contact with a `created` row; an existing one
only has blanks filled (name, email, phone, handle, timezone, source), never
with a value another person holds. The source is created if missing.

**Dedupe.** The key is stored in `detail.idempotency_key`. The key check runs
after reading the person's version and the row is written by
`crm_apply_change` on that version, so a parallel retry loses the
compare-and-swap, re-reads and answers `{ ok: true, duplicate: true }`. Use a
key that is stable per real fact (provider id + event).

**Test leads.** `sidney.laruel+anything@gmail.com` or `detail.utm_source`
`test` are accepted and tagged `test` (person tag and `detail.test`).

Answer: `{ ok, person_id, created, stage, stopped_enrolments, test }`, or
`{ ok, duplicate: true, person_id }`. Errors: 400 `bad_event`,
`bad_idempotency_key`, `no_contact`, `bad_occurred_at`, `bad_call_at`,
`call_at_required`, `bad_channel`; 401 without the server key; 409 after four
lost races. The function logs counts and the event name only, never contact
details.

Once a workflow calls `ingest`, mark its row `logged: true` in
`crm-automations.mjs` (Systems tab).

## Plugging in the sender later (n8n, not built)

1. Set the `CRM_SENDER_KEY` secret (Edge Function secrets).
2. Every few minutes: POST `{ action: "due", dry_run: false }` with the key;
   for each `send` row fill the `needs` links, send by `channel` (email from
   hello@ signed Kasper, texts from the toll-free number), then POST
   `log_send` with the result.
3. Switch a sequence on in the Sequences tab only once its steps are approved.
4. Mark the matching row in `crm-automations.mjs` `logged: true` once an n8n
   automation calls `log_send`.

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
3. Check: `/leads` as an admin shows an empty Pipeline that says how to import,
   and the Sequences tab shows the four sequences, all Off, every step Draft.

Rollback: the drop statements are at the top of the migration file; nothing
else depends on these tables.
