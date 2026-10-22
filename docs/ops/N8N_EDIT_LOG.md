# n8n edit log

Append only. One entry for every PR that edits an n8n workflow (owner rule, 2026-09-30, from
`docs/plans/2026-09-30-n8n-exit-phase-2.md`). An entry says which workflow and which version, exactly what changed and why,
how it was tested, and how to undo it (which earlier saved version to restore in n8n's own version history). Nothing is
deleted, only deactivated. **No secret value, key or token is ever written here or anywhere in this public repo.** Test client
only (`sidneylaruel`); no client names or slugs.

An entry uses this shape:

```
## <date> <PR link> <step>
Workflow: <name> (<workflow id>)
Version before: <version id>      Version after: <version id>
Changed: <which steps, exactly>
Why: <one line>
Tested: <how, on the test client, with the real last lines>
Undo: restore version <version id before> in n8n (workflow history), then <any follow-up, e.g. turn a flag back>
```

## 2026-09-30 step D (TikTok poll trim): no n8n workflow edited

Workflow: none. Step D is browser only: the TikTok Upload page asks n8n less often. `TikTok Upload, List` and
`TikTok Upload, Status` are unchanged (same version as before), so there is nothing to restore in n8n.
Changed: the page's own polling pace (`src/index/300-tiktok-upload.js.part`).
Tested: `node test/tiktok-poll-backoff-browser.js` (fake clock, offline, CI job `entry-links-boot`); see the PR for the real
last lines of every run.
Undo: revert the PR's commit (the page goes back to the old fixed pace). No n8n step.

The first entry that edits a workflow will be step B (Generate Caption), step A (Slack Creative Channel Finalizer) or step C
(Booking Recovery Dispatch).

## 2026-09-30 step B2 (caption progress in Supabase): Generate Caption edited and published

Workflow: SyncView Calendar, Generate Caption (`rNrRCwKPGuau7sLH`)
Version before: `2ac32e2c-331f-4fd4-8b31-637330e5ef27`      Version after: `8d2ffd70-bb0c-49c5-b529-bbaad90176e0` (published 2026-09-30, about 20:43 UTC)
Changed:
- Every progress write and cancel check that used to be made from inside a Code step (to the n8n `caption-job-status` and
  `caption-job-update` webhooks) is now an HTTP Request step calling the `caption-jobs` function with the saved login
  "SyncView Client Credentials Staff Key": Guard read jobs, Progress scraping, Progress transcribing, Cancel check 1, Progress
  writing, Cancel check 2, Progress done, Post job outcome. Each is set to continue on error, so a tracking failure never stops a
  caption (same as before).
- The Claude call moved from a Code step with a typed-in key to an HTTP Request step using the saved login "Claude"
  (Build Prompt and Read Claude Answer hold the logic around it). The Apify step uses the saved login "APIFY @HOUSE". No key is
  typed anywhere in the workflow any more.
- Code steps now keep only logic: Prepare Apify Input (validation and input), Check duplicate run, Extract Video URL, Extract
  Transcript and Save Caption to Sheet (decide cancel from the status answer), Mark Job Failed (builds the outcome), plus three
  small new ones (Build Done Response, Build Error Response, Read Claude Answer). Generation itself, the Replicate wait and the
  order of stages are unchanged.
- Not changed: the finished caption is still saved through the n8n `calendar-upsert-post` webhook from the Save Caption to Sheet
  step. That is a separate later step (plan: "Later step"). The sticky note inside the workflow still describes the old flow.
Why: owner decision 2026-09-30, moves caption progress off the n8n data table and removes the two typed-in keys, with no extra
n8n runs.
Tested (test client only, real services, draft first, then the published version):
- Full run, job `job_e2e_full_2`: rows in Supabase went `running/scraping`, then `running/transcribing` (20:37:57), then `done/done`
  (20:38:36) with a 377 character caption; the two cancel checks between them read `transcribing` and `writing`; the caption was
  saved to the test card (377 characters, updated 20:38:32). Apify, Replicate and the Claude login all answered.
- Cancel mid run, job `job_e2e_cancel_1`: cancel requested while `transcribing`; final row `cancelled/cancelled`, no caption, and
  the test card's caption and update time did not change.
- Duplicate guard, job `job_e2e_dup_1` with another running job on the same card: row `error` with "A caption is already
  generating for this card".
- Error path, job `job_e2e_error_1` (link that cannot be scraped): row `error` with "Could not read the video from the Frame.io
  page ...". Same on the published version (`job_e2e_prod_1`, production run, mode webhook).
- First attempt, before the function accepted this key, got 401 and wrote nothing; fixed by OPEN_REPAIRS 300.
Undo: in n8n, restore version `2ac32e2c-331f-4fd4-8b31-637330e5ef27` (workflow history) and publish it. That brings back the old
flow, which still has the two typed-in keys and uses the n8n caption job webhooks (their workflows and data table are untouched
and stay on for 30 days). Nothing is deleted.

## 2026-09-30 step A (Finalizer trigger and daily safety check): Slack Creative Channel Finalizer edited and published, 15 minute timer kept

Workflow: Client, Slack Creative Channel Finalizer (`udkwwzdFuPW3K2CE`)
Version before: `8f194a42-e578-446d-97af-2c30f4f0767a`      Version after: `7afd1d3c-1099-400d-b682-f7f57585b7a8` (published 2026-09-30, about 22:29 UTC)
Changed (five steps added, one changed, nothing removed):
- Added **Finalize Webhook**: `POST https://synchrosocial.app.n8n.cloud/webhook/slack-creative-finalize`, answers at once. It feeds the same
  first step as the timer (Get Pending Slack Jobs), so every readiness check and every channel step is the old code, untouched.
- Changed **Pick One Pending Job** (Code): if the run came from the webhook and the body has `client_name`, it picks only that client's
  pending queue row (trimmed, case insensitive) and does nothing if there is none; with no name, or from the timer, it still picks the
  oldest pending row exactly as before.
- Added the **daily safety check**: Every Day Safety Check (15:07 instance time) then List Pending Clients, One Item Per Pending Client
  and Trigger Finalizer For Client, which calls the webhook once per pending row, 20 seconds apart, continue on error. Each call is its
  own run, so one waiting client can no longer hold up another (the timer path picks the oldest pending row only).
- Not changed: **Every 15 Minutes stays on** (owner decision 2026-09-30: no real Slack channels for a test; the next real client is the
  proof, then the timer is removed in a small follow-up PR).
Why: owner decision 2026-09-30, the finalizer starts from the onboarding runbook instead of polling 96 times a day.
What "ready" means (read from the workflow, not from the plan): a queue row in status `pending` (written by Onboarding Provisioning),
exactly one Clients Info row with the same name and email and no `creative_channel_id` and no `slack_channel_id`, exactly one assigned
SMM row with a Slack id, exactly one filming plan row for the row's `viewer_slug` with a link and a doc id. Not ready yet: row goes back
to `pending` and nothing is posted. Wrong or duplicate data: `manual` plus one private DM to the owner.
Tested (no Slack channel created, by owner decision): before the edit the queue held 3 rows, all `manual`, none pending (last activity
2026-09-03), and the timer had run 705 times finding nothing. After publishing, one webhook call with a name matching no pending row
answered `{"message":"Workflow was started"}`; execution 654438 (mode webhook) succeeded in 0.07 s and changed nothing, and the next
timer run (654436, mode trigger) also succeeded. NOT yet proven: the ready path through the webhook. That is proven by the next real
client (see the onboarding runbook section 6c and the plan, step A).
Undo: in n8n restore version `8f194a42-e578-446d-97af-2c30f4f0767a` (workflow history) and publish it. That removes the webhook and the
daily check and leaves the 15 minute timer as it was. Nothing else to undo; the queue table is untouched.

## 2026-10-01 step E (Filming Plan Docs BatchUpdate): workflow switched off (deactivated, not deleted)

Workflow: Filming Plan - Docs BatchUpdate, webhook (`qR1Wgr71HTohlCzH`)
Version before and after: `9eb8dc13-0435-4c90-b132-8c6682f8f66c` (no content change; only the published state changed)
Changed: unpublished (active: false). Nothing deleted, nothing edited.
Why: its only caller, the filming plan pipeline (`synchro-pipelines/filming_plan_write_doc.py`), already writes Docs through the `pipeline-google` function (password header from the `PIPELINE_GOOGLE_KEY` environment variable), recorded in that repo's `GOOGLE_WRITES.md` on 2026-09-30. The n8n webhook had no sign-in and wrote any Doc the connected Google account could reach.
Evidence: 58 runs in the last week measured on 2026-09-30, the last on 2026-09-29 15:55 UTC; none after that, checked again immediately before switching off (search for runs after 2026-09-29 16:00 UTC returned 0). Owner go given 2026-10-01.
Backup: the whole graph (two nodes, no key in it) is committed as `n8n-backups/filming-plan-docs-batchupdate.2026-10-01.deactivated.json`.
Undo: in n8n open this workflow and publish it (the saved version `9eb8dc13-0435-4c90-b132-8c6682f8f66c` is the one that comes back), then point `DOCS_UPDATE_HOOK` in `filming_plan_write_doc.py` back at it if the pipeline ever needs the old path.
Not built: a second signed-in function. An earlier attempt (client-analytics PR 1893, closed unmerged) was redundant with `pipeline-google` and was built from an out-of-date checkout of the pipelines repo.

## 2026-10-01 backup stubs for step A and step B2 (no workflow edited)

Workflows: Client, Slack Creative Channel Finalizer (`udkwwzdFuPW3K2CE`) and SyncView Calendar, Generate Caption (`rNrRCwKPGuau7sLH`).
Changed: nothing in n8n. Added the key-free status stubs `ROLLBACK.md` section 2 asks for:
`n8n-backups/slack-creative-channel-finalizer.2026-09-30.step-a.stub.json` (the graph before the edit, the five added nodes, restore `8f194a42-e578-446d-97af-2c30f4f0767a`) and
`n8n-backups/generate-caption.2026-09-30.step-b2.stub.json` (the published graph `8d2ffd70-bb0c-49c5-b529-bbaad90176e0`, credentials by reference only, restore `2ac32e2c-331f-4fd4-8b31-637330e5ef27`).
The pre-edit Generate Caption graph had keys typed into Code steps and is NOT committed to this public repo; it exists only in n8n workflow history.
Step C (Booking Recovery Dispatch): no n8n edit; the gate and its replay proof are in `docs/ops/BOOKING_RECOVERY_GATE.md`.
Undo: delete the stub files; nothing else depends on them.


## 2026-10-01 PR 1905, Doctors campaign patch: Kasper Ad Performance Daily Pull edited and published (booked calls only; partial leads NOT done)

Workflow: Kasper Ad Performance, Daily Pull (`2Ax4c78jgI7roXzv`)
Version before: `74798eb9-6b7f-449a-a526-64c7fdfd274b`      Version after: `0fee453a-81d9-46d4-995a-66edce6bdfbd` (published 2026-10-01, about 15:43 UTC; an in between version `062aa2eb-2633-4141-af1f-244088894cb4` was live for about two minutes)
Changed (two steps, nothing else):
- **Extract Lead Emails** and **Build Daily Rows** (Code): the test `utm_campaign !== 'prospecting'` is now `!isTrackedCampaign(...)`, true for `prospecting` or a campaign tag starting "doctors | booked calls" (case, spacing and `+` insensitive). Build Daily Rows also gives a booking its campaign id from the campaign name when it has no `utm_id`, and returns `campaignIdByName` next to `adCampaign`.
- **Pull Unfinished Leads**: was changed to also read calendar `doctor-strategy-call`, then PUT BACK to the original filter (see Tested). It is the same as before this PR.
Why: show Doctors bookings in the Kasper Ad Performance panel (owner request, PR 1905).
Tested (real services, manual runs, nothing but this workflow's own tables written):
- Run `655279` (patched, including the calendar filter): every branch succeeded except **Upsert Unfinished Leads**, answered 400 "invalid input syntax for type timestamp with time zone: n/a-no-sms-consent". The Doctors partial rows hold that sentinel text in `sms_sent_at`, and the Supabase column is a timestamp, so one such row fails the whole batch. Nothing was written by that branch. The filter was put back at once (version `0fee453a`).
- Run `655289` (final version): status success. Supabase counts before and after are identical: Prospecting | Leads 18 days, spend 1372.35, 7 bookings (4 held); Prospecting | Booked Calls 6 days, spend 561.27, 1 booking (0 held); all campaigns rollup 46 days, spend 4178.55, 17 bookings (6 held); 17 lead rows; 14 unfinished lead rows.
- **Not proven:** a Doctors booking in the panel. There are no Doctors rows to show yet: the Meta pull returned no spend for that campaign in the 8 day window and no Doctors booking is in the window. The panel itself was not opened (it needs the admin key). The run was the whole 8 day window, not one day; the workflow has no single day setting and I did not add one.
Undo: in n8n restore version `74798eb9-6b7f-449a-a526-64c7fdfd274b` (workflow history) and publish it. Backup stub: `n8n-backups/kasper-ad-performance-daily-pull.2026-10-01.doctors-patch.stub.json`.
Still open (needs the owner's go): partial leads. `Map Unfinished Leads` must turn a non timestamp `sms_sent_at` (the sentinel text) into null before the Pull filter is widened again; that node was outside this request. Also one Doctors test row (calendar `doctor-strategy-call`, test source) would show as an unfinished lead until excluded.

## 2026-10-01 PR 1905 follow-up: owner approval of the full Doctors patch; read-back of the live workflow (no new edit made by this entry)

Workflow: Kasper Ad Performance, Daily Pull (`2Ax4c78jgI7roXzv`)
Version before the PR: `74798eb9-6b7f-449a-a526-64c7fdfd274b`      Version live now: `4202aeaa-e0df-4adc-851f-8c0e02f4a97b` (active version and latest version are the same)
Apply: nothing was applied by this entry. When the owner's approval arrived the live workflow already held the whole patch. It was saved in two steps after the entry above, by another session on the same account: `a8ee561b-8024-4f0d-8334-33d0c7e7f8ac` (15:58 UTC, Map Unfinished Leads) and `4202aeaa-e0df-4adc-851f-8c0e02f4a97b` (16:02 UTC, Pull Unfinished Leads widened again). Re-applying would have changed nothing, so it was not done.
Read-back (n8n version diff, `74798eb9` to `4202aeaa`): exactly four steps changed, none added or removed, no connection changed, schedule and every credential reference untouched.
- Extract Lead Emails and Build Daily Rows: as proposed in the PR (shared `isTrackedCampaign`, campaign id by name, `campaignIdByName` in the output).
- Pull Unfinished Leads: `anyCondition`, `utm_campaign eq prospecting` OR `calendar eq doctor-strategy-call`, as proposed.
- Map Unfinished Leads: goes **beyond the PR text**. It falls back to the campaign id by name (the campaign NAME column stays empty on that fallback), turns any non date value in the four timestamp fields into null (the fix for the 2026-10-01 400 error above), and skips rows whose `utm_source` contains "test".
Tested: a manual run of the live version, execution `655402` (16:06 UTC), status success. Supabase afterwards, read only: all campaigns rollup 46 days, spend 4178.55, 17 bookings (6 held); Prospecting | Leads 18 days, 7 bookings (4 held); 17 lead rows; 14 unfinished lead rows. Identical to before the PR.
Not proven: a Doctors row in the panel. There are still no Doctors spend days or bookings in the data, and the only Doctors partial rows in the recovery table are tests, which the new test skip drops on purpose.
Undo: restore `74798eb9-6b7f-449a-a526-64c7fdfd274b` in n8n and publish it (all four steps go back). To keep the booking part and drop only the partial leads part, restore `0fee453a-81d9-46d4-995a-66edce6bdfbd`.

## 2026-10-01 New Client → Slack DM (Notion Onboarding) turned off (owner's go, session Beacon)

Workflow: New Client → Slack DM (Notion Onboarding) (`y1bEpXLggfR5HqYV`)
Version: `bc52163a-70e6-4e63-a03a-3f3b5c91d253` (the only version; the graph was not edited)
Changed: **unpublished only** (active true to false). No step, connection or credential touched.
Why: it was active and failing on every poll (24 errors in the 8 days n8n keeps, no error workflow, so nobody was alerted). The Notion form it watched was replaced by the SyncView onboarding form, and the docs already say it is not an operational fallback (F111). The owner decided on 2026-10-01 to turn it off.
Read back after: `active: false`, `activeVersionId: null`, trigger count unchanged.
Not done: not archived or deleted, so its definition stays for the F60 retirement proof. No private JSON export was made by this session (nothing was edited; the only version is unchanged in n8n history and the Sunday weekly backup exports every workflow). Public-safe stub: `n8n-backups/new-client-notion-dm.2026-10-01.deactivation.stub.json`. Inventory updated: `docs/truth/N8N.md`, `docs/ATLAS.md`.
Undo: in n8n open the workflow and publish it again (version `bc52163a-70e6-4e63-a03a-3f3b5c91d253`). It will resume failing until a Notion credential is attached.

## 2026-10-02 Project Central, Sheet API turned off (owner's go, session Roster)

Workflow: Project Central, Sheet API (`Jr7JviDpBHee508N`)
Version: `b6d3c2e7-5a85-4c1b-a1be-6816e7091f53` (the only version, published and active before; the graph was not edited)
Changed: **unpublished only** (active true to false). No step, connection or credential touched. Its two inactive siblings (Inspect, 3-Tab Migration) were already off and are unchanged.
Why: owner decision 2026-10-02 to archive Project Central. Its save path cleared all three live tabs of its own workbook before rewriting them, with no staging or restore (audit F123), and nothing in this repository calls its address (`/webhook/project-central`; searched 2026-10-02).
Read back after: search by name shows `active: false` for all three Project Central workflows.
Not done: not archived or deleted in n8n, and the workbook itself is untouched, so the definition and the data stay for the retirement proof.
Undo: in n8n open the workflow and publish it again (version `b6d3c2e7-5a85-4c1b-a1be-6816e7091f53`); its webhook address works again at once. Nothing else to restore.

## 2026-10-02 Roster, Steps 2 and 3 (owner's go in the request): six workflows edited, one switched off, two temporary test workflows (session Roster)

Plan: `docs/plans/2026-10-02-roster-native.md`. Every edit below reads or writes the roster through the Edge Functions
`roster-read` / `roster-write` with the n8n login "Roster service key" (header `X-Roster-Key`). Test client only for every proof. No key is written here.

Before any edit: `roster-read` and `roster-write` `status` were called with that login from a temporary manual workflow (`6j7bQHBRuFegK6gl`, owner's go, run
once as execution 657172, archived after). Both answered 200: authority `sheet`, 36 clients, 6 managers. (Without the key both answer 401.)

Readers first (published while the Sheet was still the main copy):

1. Clients, Content Ready Notify (`II3sJbSLrptmtWLR`). Before `9f692c9d-d978-4871-8ecd-67d00b945d0c`, after `e65371dd-8e8a-4a46-b70f-3f9d5823e17c` (published about 19:52 UTC).
   Changed: the Sheets step "Get Client Row" became two steps: an HTTP call to `roster-read` (`clients`, with the client name) and a Split Out named "Get Client Row" so the next steps read the same fields.
   Tested: manual run 657173 on the test client: `roster-read` returned the one row; the email step then refused only because the test client has no email (nothing was sent). No real run since.
   Undo: restore `9f692c9d-d978-4871-8ecd-67d00b945d0c` and publish.
2. VIDEO PRODUCTION AUTOMATION (`BrJSe8zCKUccfmIq`). Before `e95369ca-de40-400c-802e-413efbbba853`, after `59e397fd-5cc8-4490-8c2e-5bed3695db0c` (about 19:55 UTC).
   Changed: the two managers-tab downloads (Fetch SMM, Fetch SMM1) now call `roster-read` `managers` as CSV (same three headers, same quoting, same `data` field). The dead Linear step (Code in JavaScript7, the `/linear-issues` webhook, which read each manager's Linear key) now answers `{issues: [], error: "linear_retired"}` and reads nothing.
   Tested: manual run 657174 of the `/linear-issues` trigger returned that answer. The two download steps could not be run alone without creating real tasks, so their CSV was proven by calling the same request from a temporary workflow (output has the three headers and 41 rows; the Lookup step's parsing is unchanged). No real run since.
   Undo: restore `e95369ca-de40-400c-802e-413efbbba853` and publish.
3. MARKET RESEARCH (`FD2QUIOlobkdLOgs`). Before (live) `7ba33725-5c02-42bd-bcf3-f8804f0c3301`, after `cee4d459-5a1c-4f37-9e24-b7e239f2d4d4` (about 19:56 UTC). The unpublished draft `f365365a-08eb-4b89-ada0-c66b3b8a7996` (a login rename only) went live with it.
   Changed: the live CSV download "Fetch Client Config2" and its disabled copy "Fetch Client Config" now call `roster-read` `clients` as CSV. The disabled Sheets step "Get Clients1" was left alone.
   Tested: the Parse step's own code run offline on the new CSV for all 36 current clients found the test client. The workflow was not run (it scrapes and spends money). No real run since.
   Undo: restore `7ba33725-5c02-42bd-bcf3-f8804f0c3301` and publish.
4. SyncView SMM Reports, Manager Sync (`y3rEWCVdB0esN3tO`). Before `2652b79d-b9a4-4bd9-a2ee-79b9c534446d`, after `ac986654-b6e8-4f7b-9460-dc07a8419451` (published about 19:58 UTC).
   Changed: the payload now carries each manager's Slack id, and the call goes to `roster-write` `sync_managers` instead of `smm-weekly-reports`.
   Tested: manual run 657177 answered `{"ok":true,"synced":6}`; afterwards 6 of 6 active managers had their Slack id in the database.
   Then, right after the switch (about 20:01 UTC): **unpublished** (switched off, as the plan says; the function now refuses it anyway). Undo: only valid with the switch back to `sheet`: restore `2652b79d-b9a4-4bd9-a2ee-79b9c534446d` or republish `ac986654-b6e8-4f7b-9460-dc07a8419451`.

Step 3, the switch (20:00:39 UTC): parity first (`node scripts/sheets-mirror-parity.js --strict`: `client_profiles` 36 of 36 matched, **PARITY: clean**; manager rows 41 of 41 equal, 0 differences), then `client_profiles_authority` set to `{"source":"syncview"}`, then the two writers were published:

5. Onboarding, Append Client Row (`RFi70kokkNFHoRC0`). Before `9e4c984e-4ad0-470e-b50a-62c3b2bab9f6`, after `cd50743f-a30c-4857-b210-580b24e33d27` (published about 20:01 UTC).
   Changed: the two Sheets steps became one HTTP call to `roster-write` `upsert_client` with the manager in the same call (adds `postforme_instagram_account_id`, drops `linear_api_key`); the answer is `{ok, roster}`. The webhook still has no sign-in (not changed here).
   Tested: manual run 657183 on the test client: `changed: 1`, manager kept, Sheet copy done; the Sheet showed the new keyword. Undo: restore `9e4c984e-4ad0-470e-b50a-62c3b2bab9f6` and publish (and set the switch back first).
6. Client, Slack Creative Channel Finalizer (`udkwwzdFuPW3K2CE`). Before `7afd1d3c-1099-400d-b682-f7f57585b7a8`, after `aedcda8b-4ccc-4ddd-ab86-f455117c0a91` (published about 20:01 UTC; saved as a draft earlier, never run before the switch).
   Changed: "Read Clients Info" and "Read SMM Assignment" read from `roster-read` (HTTP call, then a Code step of the same name that keeps only this client's rows and always outputs at least one item, as the Sheet read did); "Write Clients Info Creative Channel" is one `roster-write` `set_client_fields` call with the "still empty" check; the read back reads from `roster-read`. Every new step sends its error output to "Prepare Manual Reconcile" like the old ones. The 15 minute timer, the webhook and the daily safety check are unchanged.
   Tested: **the whole published workflow was NOT run.** The test client has a filming plan, so a run would create two real Slack channels and invite people (owner decision 2026-09-30: no real Slack channels for a test), and a test row left in the queue cannot be removed with the tools available. Instead the same calls the steps make were run from a temporary workflow on the test client: write both channel ids with the "still empty" check (changed 2, Sheet copy done), read back, both manager reads (JSON and CSV), a second write against a filled field refused with `expectation_failed`, then cleared. The next real client is the real proof.
   Undo: restore `7afd1d3c-1099-400d-b682-f7f57585b7a8` and publish.

Catch-up copy (about 20:02 UTC): `queue_full_copy` queued 77 rows (36 Clients Info, 41 Social Media Managers), `copy_to_sheet` copied 77, failed 0, pending 0 (execution 657182); parity read again afterwards: **PARITY: clean**.

Proofs on the test client (all cleaned up afterwards): create or change through the Onboarding workflow (above); assign to another manager and back (the Sheet showed the other manager, then the original one); the Finalizer's write (above); the Clients tab save: the database function behind it (`client_profile_admin_edit`) was run as the admin role for the test client, queued one row, and the copy put the change into the Sheet (the function's door needs the admin key, which no session holds, so that door itself was not exercised).

Temporary workflows: `TEMP Roster status check` (`6j7bQHBRuFegK6gl`, archived) and `TEMP Roster switch runner` (`TgepIyq71B4mOf8M`, archived after the proofs). Both manual only, never published.
Way back for the whole change, one step: set `client_profiles_authority` back to `{"source":"sheet"}` after `queue_full_copy` and `copy_to_sheet` until nothing is pending, then restore the versions above (plan, "Way back").

## 2026-10-03 Generate Caption's Save step moved off the n8n Calendar save (owner's go in the request, session Sunset)

Workflow: SyncView Calendar, Generate Caption (`rNrRCwKPGuau7sLH`)
Version before: `8d2ffd70-bb0c-49c5-b529-bbaad90176e0`      Version after: `079050d3-db68-4e10-9828-d6764e7fbe6e` (published 2026-10-03, about 18:57 UTC)
Changed (only the save; generation, progress, cancel and error handling are as before):
- Before: the Code step "Save Caption to Sheet" checked for a cancel, then posted `{client, post: {id, caption}}` to the n8n
  `calendar-upsert-post` webhook from inside the code, with no login, and treated anything but `ok: true` as a failure.
- After: three steps in a row. "Check cancel before save" (Code: the same cancel check, builds the same body) then
  "Save caption (calendar-upsert)" (HTTP Request, POST to the `calendar-upsert` Edge Function, same body, 30 second timeout, saved
  login "SyncView Client Credentials Staff Key", continue on error) then "Save Caption to Sheet" (Code: only `ok: true` counts as
  saved, otherwise the same error message as before, so Mark Job Failed keeps the caption on the job row). The step keeps its
  name so the steps after it are unchanged. No key is typed anywhere.
- About the login: the live `calendar-upsert` is the un-gated build (see the freeze banner in its source), so today it does not
  check a key at all. The login is sent so the call is not anonymous, but it holds `CREDENTIALS_STAFF_KEY`, which the gated
  source in this repo would NOT accept (that source accepts a role key or `SYNCVIEW_WRITER_STAFF_KEY`, and no n8n login holds
  either). If the gated source is ever deployed, this save fails closed: the caption stays on the job row and the card shows the
  usual "could not be saved" message. Give the step a login holding the writer key before that deploy.
Why: the n8n Calendar Upsert workflow was waiting on this one real caller before it can be switched off (step K report).
A copy of the old step, verbatim: `n8n-backups/generate-caption.2026-10-03.pre-save-move.json`.
Tested (test client only, real services):
- Draft, manual run 658538, job `job_sunset_save_draft_1`: the function answered `ok: true`; the test card's caption changed
  from 377 to 363 characters, `updated_at` 2026-10-03T18:56:41.752Z; job row `done/done`. The n8n Calendar Upsert workflow had
  0 runs from 18:50 UTC on (it last ran at 14:48 UTC).
- Published, production run 658543, job `job_sunset_save_prod_1` (mode webhook, success): card caption
  now 341 characters, `updated_at` 2026-10-03T18:58:58.527Z; job row `done/done`. Calendar Upsert again had 0 runs.
Not tested: a failed save on the new path (the function was not made to fail on purpose).
Undo: in n8n, restore version `8d2ffd70-bb0c-49c5-b529-bbaad90176e0` (workflow history) and publish it. Nothing else changes.

## 2026-10-08 Calendar Upsert Post, its Comment Merge helper and six TikTok Upload workflows switched off (owner's go, session Lighthouse)

Workflows and the version that stays saved in each (unpublished only; no step, connection or credential touched):
- SyncView Calendar, Upsert Post (`pWSqaqVw7dmqhYOA`): `7ef44971-5c6b-46d7-b7d1-68a504913d28`
- Calendar Comment Merge (helper) (`meM78zr1Gcl72c6f`): `d9e14bb7-080c-4f42-9c0e-587d00c535c0`
- SyncView TikTok Upload, Submit (`o6wWaGNlIlyZFTX7`): `e95ee3d7-57ec-4e2d-8594-2adbf8edbffb`
- SyncView TikTok Upload, Submit (Direct) (`qGJ7mUjml98DSiGo`): `264ea658-39c2-449c-b215-d7daa08e53ac`
- SyncView TikTok Upload, Media Upload URL (`FlvoUXIFwRDg8KUb`): `f7acdd9b-3738-491b-a14f-bae0956bffc7`
- SyncView TikTok Upload, List (`iYb1896sIAclGvy8`): `6323674d-fc89-424a-bed7-7047b220a114`
- SyncView TikTok Upload, Status (`IjayuU6jkA21aKo3`): `965543e4-7adc-468c-b7e9-ab31b3276476`
- SyncView TikTok Upload, Cancel (`4ca3li54eRFtSfXE`): `bfa573f0-1964-4bdc-bab0-83c3c27932cc`
Changed: unpublished (active true to false). Nothing deleted, nothing edited.
Why: SyncView no longer calls them. Calendar staff saves go only to the `calendar-upsert` function since #1858 (client links
always did), Generate Caption saves through the function since 2026-10-03, and the QA write-path probes assert zero
`calendar-upsert-post` calls. TikTok has run on Supabase since the `tiktok_upload_source` switch was set to `supabase` on
2026-10-07 17:42 UTC (OPEN_REPAIRS 362). The helper is only ever called by Upsert Post.
Evidence, checked immediately before switching off on 2026-10-08: zero runs of Upsert Post and the helper after 2026-10-07 15:00
UTC, and zero runs of the six TikTok workflows after 2026-10-07 17:45 UTC.
Read back after: search by name shows `active: false` for all eight; `SyncView TikTok Upload, Result` (`1qZmOQPtG6rKYlK7`) is
still `active: true`.
Left on, on purpose: `TikTok Upload, Result`, because Post For Me's result webhook still points at it (3 runs on 2026-10-07 after
the cut-over). It goes off once the function's result action is deployed and the webhook is re-pointed.
Backup: the saved versions above stay in n8n (deactivated, not archived), and the Sunday weekly backup exports every workflow to
the private Drive folder. The Upsert Post graph names a client in its code comments, so no copy is committed to this public repo.
Undo: in n8n open the workflow and publish it again (the version above comes back). For TikTok, publish all six, then set
`tiktok_upload_source` back to `n8n`. For Calendar, publish the helper first, then Upsert Post.

## 2026-10-09 Five unused SyncView workflows switched off (owner's go, session Lighthouse)

Workflows and the version that stays saved in each (unpublished only; no step, connection or credential touched):
- SyncView Caption Prompts, Save (`RGkuE8d4uJg6CPde`): `9b750ccb-cdf5-43f0-a70b-c478ed73c62f`
- SyncView Caption Jobs, Status (`5KnYvvZ33B78Khny`): `56879e80-1a36-4a71-a005-c2baa021e7d6`
- SyncView Caption Jobs, Update (`vwRfBZsmUMtDqbYM`): `1af36f80-f31f-4314-bd12-4b4f84142678`
- SyncView Calendar, Get (`KViFEOqSRBNdCJRk`): `51dcb7ec-f756-4d06-ac8f-39dbfc7b7b1d`
- SyncView Kasper, Queue (batch) (`TcWOfnKd4Csdnnbv`): `6fd805a3-be1e-4cd7-ab44-906aa635de7c`
Changed: unpublished (active true to false). Nothing deleted, nothing edited.
Why: replaced by `caption-prompts-save` and the `caption_prompts` table (OPEN_REPAIRS 291), the `caption-jobs` function (303)
and the page's own database reads (308). Listed as ready by session Shipwright (OPEN_REPAIRS 389, docs/ops/OWNER_SHIP_LIST.md).
Evidence, checked immediately before switching off on 2026-10-09: zero runs of all five since 2026-10-02 00:00 UTC.
Read back after: workflow details show `active: false` for all five.
Left on, on purpose: `Caption Prompts, Get` (first-load fallback, 291), `Sample Review, Upsert` (still running, cause under
investigation) and `TikTok Upload, Result` (until Post For Me's webhook is re-pointed, 370).
Backup: the saved versions above stay in n8n (deactivated, not archived), and the Sunday weekly backup exports every workflow.
Undo: in n8n open the workflow and publish it again.

## 2026-10-09 TikTok Upload, Result switched off (owner's go, session Lighthouse)

Workflow and the version that stays saved (unpublished only; no step, connection or credential touched):
- SyncView TikTok Upload, Result (`1qZmOQPtG6rKYlK7`, webhook `/webhook/tiktok-result`): `fa247b1c-26c6-472b-b4c1-031afbab9afa`
Changed: unpublished (active true to false). Nothing deleted, nothing edited.
Why: Post For Me results now reach the `tiktok-upload` function directly (OPEN_REPAIRS 370). On 2026-10-09 the owner ran
`node scripts/tiktok-pfm-webhook.js --register`, which answered "Already there" and listed exactly one Post For Me webhook,
the function's own. The owner asked to finish moving TikTok results off n8n.
Evidence, checked immediately before switching off: the workflow's last run was 2026-10-08 18:47 UTC, and four posts on
2026-10-09 (14:03 to 15:29 UTC) were flipped to `posted` with their TikTok link in `tiktok_uploads` with no n8n run at all.
`tiktok_upload_source` reads `supabase`.
Undo: in n8n open the workflow and publish it again, then register its URL as a Post For Me webhook.

## 2026-10-06 Sales email fixes in five workflows (owner's go, session Lighthouse; recorded late on 2026-10-16)

Written down ten days late, from the session transcript and n8n's own version history (each version carries its own
description). The edits were made through the n8n connector, not a PR.
- Normal Sales, Booking Handler (`ghpbQQJizAnR6p2b`): before `2d1251a3-c12b-4c05-b124-07158026b7ba`, after
  `8ec62fc6-300a-4531-9541-5b01829e8607` (14:48 UTC, same-day new leads no longer start the nurture twice) and
  `9db9a023-54c8-44c7-9c7c-e1ded6702392` (16:48, new lead decided by HubSpot deal id; a contact created in the last day or
  with a sequence started in the last 14 days is the same lead rebooking).
- Normal Sales, Pre-Call Nurture (`310kO3OnG1yytE2D`): before `3c1aaee9-89ad-4b82-9bac-558c54c07a88`, after
  `9fed15bf-4ec2-4c06-8306-5a8cbe27d26b`, `b8a44a19-f018-4ab3-baf9-ec4f9fd6d56e` (same-day calls get no nurture, owner's
  decision) and `c2f093c6-c645-4c5b-be47-c681ce5922e0` (one sequence per booking; a rebook supersedes the old sequence at
  its next step; email 1 skipped if already sent in the last 7 days; older cancellations ignored).
- AI Sales, Pre-Call Nurture (`GaYgLJy8NCPUUfw5`): before `2df4bdaf-d68d-4c49-8806-6cef994395c2`, after
  `6be68c03-4aa8-456a-887e-11d00e804fd2` (the same guard as the normal nurture).
- Sales, Call Booked (iClosed) (`xoPqojySDriQ8Mzh`): before `53b41eeb-365a-492d-b49c-83f55381bd68`, after
  `2458d5a7-de48-48b6-a933-53297c074128` (16:50, AI funnel: single sequence start, new lead by deal id, same-lead rebook),
  then `15b2bfc5-a89d-45e1-99d1-d746abd5cdf9` and `2f2414c5-f2fc-4317-9434-fc92ac47bd5e` (19:19, emails carry the
  booking's own iClosed meeting link; Roam links refused).
- Sales, Doctors Instant Booking Link (`cM3G9REliKpwicnR`): before `a36d56f1-9a10-4260-9fa4-f28de44ea4ff`, after
  `ffd58a03-7b2f-4a48-a0b5-dc5fa8d1a9c8` (waits 3 minutes after Submit; a lead who booked meanwhile gets no instant email
  or text).
- Sales, Booked Call to Meta CAPI (`s8lsPpKqWYhscLPV`): settings only (an error workflow so a failure alerts), no new
  saved version.
Why: leads got duplicate or missing pre-call emails (owner's reports 2026-10-06).
Tested: each change on fake addresses with the sending steps pinned, so nothing was sent; every test sequence stopped by
itself at the "still the current booking?" check (checked 2026-10-06 21:06 UTC). Not tested end to end: the 3 minute pause
and the HubSpot deal lookup (first real run on the next real booking).
**Regression this caused, found and fixed by another session:** the 19:19 edit of `xoPqojySDriQ8Mzh` was made from a copy
older than 2026-09-15 and dropped the video-editor interview admit. Restored 2026-10-14 in `afaa0f36-f917-47ce-89f3-a63bf6d55f72`
(see `docs/truth/`, #2075).
Undo: restore the "before" version of each workflow in n8n's version history and publish.

## 2026-10-06 CLIENTS METRICS and TOP VIDEOS switched off (owner's go, session Lighthouse; recorded late on 2026-10-16)

Workflows: CLIENTS METRICS (`Q4n1bagJYBkurEaI`) and TOP VIDEOS (`DyVPx0neUZ94R0hJ`), 20:47 UTC.
Changed: unpublished (active true to false). Nothing deleted, nothing edited.
Why: the owner paused analytics (2026-10-06) and both were the main Apify spenders. The replacement jobs'
practice runs were switched off the same evening. A daily watcher checks they stay off.
Undo: in n8n open each workflow and publish it again (Apify must still be paid for).

## 2026-10-13 Four SyncView Calendar workflows switched off (owner's go, session Lighthouse; recorded late on 2026-10-16)

Workflows (unpublished only; no step, connection or credential touched), 14:42 UTC:
- SyncView Calendar, Append Post (`iA54ipMOybicmYBh`)
- SyncView Calendar, Delete Post (`JcekBKUzELgX4HjH`)
- SyncView Calendar, Reorder (`OXd0sUoSJYMspGTF`)
- SyncView Calendar, Reorder (batch) (`lTtZNLrQLpIZqwAY`)
Changed: unpublished (active true to false). Nothing deleted, nothing edited. With the three switched off earlier, all
seven Calendar workflows are off.
Why: the old Calendar workbook is kept as a frozen backup (owner's decision 2026-10-13); the page has saved to the
database since 2026-10-07.
Evidence, checked immediately before: no run of any of the four since 2026-10-07.
Undo: in n8n open each workflow and publish it again.

## 2026-10-16 SyncView Calendar, Generate Caption switched off (owner's go, session Lighthouse)

Workflow and the version that stays saved (unpublished only; no step, connection or credential touched):
- SyncView Calendar, Generate Caption (`rNrRCwKPGuau7sLH`, webhook `/webhook/generate-caption`): `09a03ded-d354-4c84-a90e-46c428014eb7`
Changed: unpublished (active true to false) at about 05:45 UTC. Nothing deleted, nothing edited.
Why: owner decision 3 on the calendar-upsert retirement plan (2026-10-16): remove the page's fallback first, then switch
the workflow off. The fallback removal is #2102 (merged `e680a69f`); every caption runs on `caption-generate`.
Evidence, checked immediately before: the live page and every bundle it loads no longer contain the webhook address; the
workflow's last run was 2026-10-09 14:03 UTC; on main only backups, tests and mocked probes mention the address.
Read back after: workflow details show `active: false`.
Undo: in n8n open the workflow and publish it again (the page no longer calls it, so it would also need #2102 reverted).

## 2026-10-11 /doctors early follow-up: partial capture and recovery sender edited and published (owner's go, website session briefed from the Ads lane; recorded late on 2026-10-16 by Billboard)

Written down five days late, from the Ads lane's campaign tracker and n8n's own version history. Edits made through the n8n
connector; the page half is synchrosocial PR #181 (merge `de8da99`, live 2026-10-12 about 15:08 UTC).
- Sales, Doctors Partial Lead Capture (`8nq6jGbpmCDZxnQz`): before `0aa042b8-9e5f-4a19-b9dd-6a92045959d9`, after
  `d45a36a5-04f8-4ae3-b7a6-32ecddd8a31d` (save as soon as the email is valid; one row per lead; "Not right now" cancels),
  `668af30d-5c78-4995-94ed-cbe0b72378f3` (update and cancel match the row by email only) and
  `b7f8eb47-b786-41bc-847f-8790ad103ae4` (first follow-up due 20 minutes after the visitor's last change), published 2026-10-11.
- Sales, Booking Recovery Dispatch (`nQ4vnZ8bmG3E3Lor`): before `2a92756f-b635-4a72-9f71-70f797552acd`, after
  `5bdeec03-4376-4a07-bd3b-4a14c0eecde7` (2026-10-11 20:02 UTC: "finish your application" wording for /doctors leads who
  never pressed Submit; everyone else unchanged).
Why: visitors who typed name, email and phone but left before the $3,000 question got no follow-up (owner's decision 2026-10-11).
Tested: five cases with test addresses and `utm_source=test`; one real text to the owner's own phone (2026-10-12 14:22 UTC);
live test row emailed 2026-10-12 15:29 UTC; nothing reached Meta; test rows cancelled or closed.
Undo: restore `0aa042b8-9e5f-4a19-b9dd-6a92045959d9` (capture) and `2a92756f-b635-4a72-9f71-70f797552acd` (sender) and
publish, then revert synchrosocial `de8da99`.

## 2026-10-15 Booking Recovery Heartbeat digest counts only the ads (owner's go, session Tally, Ads lane; recorded on 2026-10-16 by Billboard)

Workflow: Sales, Booking Recovery Heartbeat (`a2sJJ3oZMefASPl2`)
Version before: `d5310994-fd1e-4ef5-9afc-d7819c1859f8`      Version after: `f25786e8-ff6f-41d1-aac6-3d389cdf4fb3` (2026-10-15 15:16 UTC, published)
Changed: the "Summarise 24h" code step only. The digest numbers now count only rows with `utm_source=facebook` and
`utm_medium=paid`, broken down by ad (`utm_content`), with one line for everything not from the ads. The four alarms and the
whole-table "nothing captured" alarm are unchanged and still cover every row.
Why: the daily Slack message mixed every iClosed calendar into one total (owner's request 2026-10-15).
Tested: one manual run 2026-10-15 15:16 UTC (execution 670165, success); first scheduled run 2026-10-16 13:00 UTC
(execution 670891, success). Session Tally has not sent its own report yet; this entry is from n8n's history.
Undo: restore version `d5310994-fd1e-4ef5-9afc-d7819c1859f8` in n8n and publish.

## 2026-10-17 Booked Call to Meta CAPI: real page per calendar, referral and DM links skipped (owner's go, session Lighthouse)

Workflow: Sales, Booked Call to Meta CAPI (`s8lsPpKqWYhscLPV`), Code node "Authenticate + Evaluate" only.
Version before: `f120ace1-5d63-4396-8c7a-48207ec2660a`      Version after: `69044008-85e0-4c20-9e97-a4bec7fa187c` (2026-10-17 17:56 UTC, published)
Changed: (1) `event_source_url` follows the booking calendar (`doctor-strategy-call` to /doctors,
`social-media-consultation` to /apply, `ai-intro-call` to /ai, anything else the home page) instead of always /apply;
(2) `utm_source` exactly `referral` or `outbound_dm` (any case, trimmed) is skipped like test traffic, the same rule as
`MetaPixel.astro` on synchrosocial.com since synchrosocial #182; (3) the skip label reads `excluded_traffic`. Nothing else.
Why: Meta could not tell which page a booking came from, and our own referral and DM links taught Meta the wrong people
(Ads lane, Pixelfix proposal in synchrosocial #182; owner's go 2026-10-17).
Tested: version diff checked (only these lines). Two manual runs with simulated bookings, with the Meta call and the
`meta_capi_sent` table pinned so nothing was sent or written: execution 671857 (doctors calendar, facebook source: fires,
URL /doctors) and 671858 (`utm_source=Referral `: skipped, `excluded_traffic`).
Undo: restore version `f120ace1-5d63-4396-8c7a-48207ec2660a` in n8n and publish.

## 2026-10-18 One-off DoctorEmailEntered backfill to Meta (owner's go, Ads supervisor Billboard)

Workflow: Ads, One-off DoctorEmailEntered backfill (18 Oct 2026) (`PCChAls5J5KwV5aP`), new, version `6cec4132-5c5b-44f4-a46c-6bf5fcfe9777`. Never published; run once by hand (execution 672759, 2026-10-18 20:02 UTC), then archived.
Changed: no existing workflow touched. The new workflow read `booking_recovery` (`xEhLpKwNv8uTaeAK`, doctor-strategy-call, utm_source facebook, utm_medium paid, last 6.9 days), left out test addresses and row 296 (already sent live on 2026-10-17), and sent one `DoctorEmailEntered` event per remaining row to dataset 4309835332571875 through the existing "Facebook Graph account" credential: real event time, event_id `dee-backfill-<row id>`, page /doctors, hashed email/phone/name, fbc built from the stored fbclid, custom_data `backfill: true`.
Why: the event went live on 2026-10-17 (synchrosocial #182). The new ad sets will aim at a custom conversion on it, so Meta gets the past week's real form starters as history. Meta accepts website events up to 7 days old.
Tested: Meta answered `events_received: 9` (fbtrace AsxRKrFNREymJWxJ2BMkEXE). Rows sent: 219, 220, 221, 222, 224, 248, 250, 289, 293.
Undo: not possible to delete events from Meta; they are marked `backfill: true` and use their own event_id prefix. The workflow is archived and can be restored from n8n's archive if ever needed.

## 2026-10-21 Educators test page: five workflows learn the educator-strategy-call calendar (owner's go in the request, Ads lane)
Why: a separate test page (synchrosocial.com/educators, not built yet) books on its own copy of the iClosed doctor calendar, `educator-strategy-call`. The old calendar name was written into five workflows, so a booking or lead on the new calendar would have been ignored (no Meta Schedule, no HubSpot or Kasper alert) or sent back to /doctors. Every edit only ADDS the new calendar; doctors and every other calendar behave as before. A lead is told apart by a new `page` tag the new page will send (absent on /doctors).
- Sales, Booked Call to Meta CAPI (`s8lsPpKqWYhscLPV`), Code node "Authenticate + Evaluate": version before `69044008-85e0-4c20-9e97-a4bec7fa187c`, after `9ae0c6e0-8865-4e7d-a568-521d65f0be3b`. Added the calendar to the acquisition list and mapped it to /educators for `event_source_url`. Diff checked: only those two places.
- Sales, Call Booked (iClosed) (`xoPqojySDriQ8Mzh`): before `afaa0f36-f917-47ce-89f3-a63bf6d55f72`, after `6cca8532-9840-4f5b-b2d3-7ce4d930935d`. "Is Normal Funnel Event?" accepts the new calendar (same handler path as doctors); the Kasper Telegram alert labels it Educators. Diff checked: only those two nodes.
- Sales, Doctors Partial Lead Capture (`8nq6jGbpmCDZxnQz`): before `b7f8eb47-b786-41bc-847f-8790ad103ae4`, after `c05a1df4-6cb4-4adb-8bc1-58a5ceef62e1`. The saved row's calendar follows the `page` tag; the saved answers also keep "Which fits you?" (`fit`) when sent.
- Sales, Doctors Instant Booking Link (`cM3G9REliKpwicnR`): before `96ab1b9d-8e78-492c-a6ab-63c688361f9c`, after `cc73e41e-22ed-4f0b-9a06-1415bbc3f3e8`. Same two changes; the instant email and text carry the booking link of the lead's own calendar.
- Sales, Booking Recovery Dispatch (`nQ4vnZ8bmG3E3Lor`), Code node "Select Due": before `5bdeec03-4376-4a07-bd3b-4a14c0eecde7`, after `18c7d590-53b3-4e46-a94b-328f7a303f2e`. The new calendar is in the link list, the "practice" word list and the human-wording calendars; a lead who left early is sent back to /educators, not /doctors.
Read and found no change needed: Booking Recovery Heartbeat (`a2sJJ3oZMefASPl2`; counts Facebook paid rows by ad name, not by calendar). Not read: Kasper Ad Performance Daily Pull (it filters on the doctor calendar and campaign names; educator bookings may need a campaign-name rule in the panel).
Tested: not run end to end yet, because the page and the iClosed question do not exist. Two of the diffs were checked line by line. The first full test uses test traffic after the page ships (`?utm_source=test`, a plus-address email, no phone), and its result goes in the Ads tracker.
Undo: restore each "before" version above in n8n's workflow history and publish.

## 2026-10-21 Educators page: the saved fit answer is labelled "Where are you today?" (owner's go in the request, Ads lane)
Why: the educator page's iClosed question "Which fits you?" was replaced by a new question "Where are you today?" (identifier where-are-you-today) on the educator event only. The two workflows that store the page's answer now print the new label in the lead notes. Label text only; no logic, calendar or answer check changed. Nothing in n8n reads the old question id or its position.
- Sales, Doctors Partial Lead Capture (`8nq6jGbpmCDZxnQz`), Code node "Authenticate + Normalize": before `c05a1df4-6cb4-4adb-8bc1-58a5ceef62e1`, after `e611bfee-1108-4098-aedb-1251248e3676`. Diff checked: one string.
- Sales, Doctors Instant Booking Link (`cM3G9REliKpwicnR`), Code node "Authenticate + Normalize": before `cc73e41e-22ed-4f0b-9a06-1415bbc3f3e8`, after `14e43579-b3e2-4532-8d55-4cca381f1954`. Diff checked: one string.
Left alone: Meta CAPI and Booking Recovery Dispatch still point educator links at /educators, which forwards to the new address with the query kept.
Tested: not run end to end yet (first full test waits for the owner's go, test traffic only).
Undo: restore each "before" version in n8n's workflow history and publish.

## 2026-10-22 Meta CAPI: educator bookings get the new page address and their own label (owner's go in the request, Ads lane)
Why: the doctors-who-teach page moved from /educators, and every booking carried the same `content_name`, so Meta could not count bookings from the new page apart from /doctors.
- Sales, Booked Call to Meta CAPI (`s8lsPpKqWYhscLPV`), Code node "Authenticate + Evaluate": before `9ae0c6e0-8865-4e7d-a568-521d65f0be3b`, after `6404214a-d39e-4338-8993-932213e5a39c` (published). `educator-strategy-call` now maps to `https://synchrosocial.com/doctors-who-teach` and its Schedule carries `content_name: educator_call_booked`; every other calendar keeps `acquisition_call_booked`. Nothing else changed. An intermediate version `79e49b88-6518-44a8-97c6-058724741069` saved the new code in a stray nested field (no behaviour change) and was replaced within two minutes.
Tested: two manual runs with a test booking on the educator calendar (executions 675887 on the stray version, 675888 on the final): skipped as test, nothing sent to Meta; the final run's payload shows the new address and label.
Undo: restore `9ae0c6e0-8865-4e7d-a568-521d65f0be3b` in n8n's workflow history and publish.

## 2026-10-22 Booking Handler: test bookings skip the HubSpot contact and deal (owner's go in the request, Ads lane)
Why: every test booking on the doctor or educator calendar created a HubSpot contact and a deal in "appointment scheduled". The owner chose to skip only the HubSpot step for tests; the confirmation email, the confirmation text, Kasper's Telegram and the pre-call emails still run so a test shows the whole experience.
- Normal Sales, Booking Handler (`ghpbQQJizAnR6p2b`): before `3b5667f6-f2ae-4a88-b79b-8a223ef7bd92`, after `fd551429-581e-4765-8c95-a2b093156336` (published). New If node "Test Booking?" between the input and "Find Contact": an email matching the owner's own plus-address test pattern (the same pattern the Meta CAPI workflow uses) goes straight to "Normal New Booking Today?"; everything else goes to "Find Contact" exactly as before. No other node changed.
Tested: not run yet. This workflow is only started by the Call Booked router, so the first check is the owner's next full test booking (planned later); its run should show no HubSpot node executed.
Undo: restore `3b5667f6-f2ae-4a88-b79b-8a223ef7bd92` in n8n's workflow history and publish.

## 2026-10-22 Recovery email and text ready for the Doctors who teach page (owner's go in the thread, Ads lane)
Why: a launch check of the recovery flow for synchrosocial.com/doctors-who-teach (internal name educators, calendar `educator-strategy-call`) found the iClosed capture did not know the new calendar, the educator wording still said "practice" and "application", the 21 Oct label edit was never published, and one refused text (Twilio 21612, 2026-10-20, execution 673654) stopped the whole hourly send. Doctors and every other calendar keep their behaviour and wording. The owner chose to keep texting non-US numbers and to keep Kasper's alerts for test leads.
- Sales, Booking Recovery Capture (iClosed) (`31DnMJLU3YM89py1`), "Authenticate + Normalize": before `6210da40-812f-4931-abfb-05e460f9c24d`, after `c4be7354-3aca-48d3-9655-777fb5f37f84`. `educator-strategy-call` added to the sales calendar list, so an educator lead who opens the calendar is no longer closed as `other_calendar` (seen on run 675232) and still gets the 30 minute reminder.
- Sales, Doctors Partial Lead Capture (`8nq6jGbpmCDZxnQz`), "Authenticate + Normalize" and "Decide Insert": before `c05a1df4-6cb4-4adb-8bc1-58a5ceef62e1` (live), after `424a5859-42c0-4146-b4e5-cdb7be5adae0`. The consent stamp records the page (`educators-step1-2026-10-22` for the new page, the old stamp for /doctors). Publishing also put the 21 Oct label change live.
- Sales, Doctors Instant Booking Link (`cM3G9REliKpwicnR`), "Human Wording": before `cc73e41e-22ed-4f0b-9a06-1415bbc3f3e8` (live), after `20c14a33-e72f-4605-b5f7-e5e54fe83ff8`. Educator email and text talk about "what you've built" and "our call", not an application. Also puts the 21 Oct label change live.
- Sales, Booking Recovery Dispatch (`nQ4vnZ8bmG3E3Lor`): before `18c7d590-53b3-4e46-a94b-328f7a303f2e`, after `bbb6da3b-fed5-4231-acca-a163b493acfa`. "Select Due": educator wording for the reminder and the early-leaver message, early-leaver links go straight to /doctors-who-teach. "Send Recovery SMS" now continues on error into a new Slack node "Alert: Recovery Text Failed" (DMs the owner the lead, calendar and error), so one refused number no longer stops other leads. "DM Sidney (Sent)" says 8am to 6pm, matching the code.
- Sales, Booking Recovery Heartbeat (`a2sJJ3oZMefASPl2`), "Summarise 24h": before `f25786e8-ff6f-41d1-aac6-3d389cdf4fb3`, after `86270c84-b963-4787-a5a0-74729fb4a116`. Each ad line in the 9am digest starts with its page (Doctors page or Doctors who teach page, from the calendar). Totals and alarms unchanged.
Tested: each changed code step was run locally against sample rows (doctors, educators, other calendar, test lead); doctors output unchanged, educator output as approved. Saved code read back from n8n and compared. Not yet run end to end: the owner will do one full test with test traffic later.
Undo: restore each "before" version above in n8n's workflow history and publish.

## 2026-10-22 Educator call emails: own confirmation and pre-call nurture, built but not switched on (owner's go in the thread, Ads lane)
Why: bookings on `educator-strategy-call` reached the same handler as /doctors and got the /doctors confirmation, text wording and six pre-call emails, because the router never tells the handler which calendar was booked. The owner approved new copy for this page. /doctors and every other calendar keep every email word for word. Plan and source copy: synchro-pipelines `ads/nurture-educators/`.
- New workflow `Educators Sales — Pre-Call Nurture` (`lU5RlPUBsmlMsFSf`), published version `5429b1af-7e00-4c8e-968a-d33eaed55bd5`. An exact copy of `Normal Sales — Pre-Call Nurture` (`310kO3OnG1yytE2D`, version `c2f093c6`: same waits, cancel check, supersede and duplicate checks, same data tables) with the six new emails and its starts labelled `educators`. Connections and parameters diffed against the planned build: identical apart from the email bodies and the funnel label. Nothing calls it until the switch below.
- Normal Sales, Booking Handler (`ghpbQQJizAnR6p2b`): before `fd551429-581e-4765-8c95-a2b093156336` (the "Test Booking?" edit above, published one minute earlier and kept), after `811f4f65` (published). Input gains `event_slug`. New If nodes "Educator Booking? (Confirmation)" and "Educator Booking? (Nurture)", new Gmail node "Send Confirmation (Educator)" and new "Start Educator Nurture" (calls `lU5RlPUBsmlMsFSf`). The text wording says "what you've built or want to build" for the educator calendar and "your brand/work" otherwise. Any slug other than `educator-strategy-call`, including an empty one, takes exactly the old path.
- Tested with pinned data, nothing sent and both nurtures pinned: execution 675894 (educator calendar, test address) took the educator confirmation and the educator nurture; 675895 (doctor calendar, non-test address) took the old confirmation and the old nurture.
- Preview: a throwaway workflow (`ovnsyauVqjBuOTNf`) sent the educator confirmation and all six emails once to the owner's own plus-address (execution 675898, all seven delivered to the Primary inbox), then was archived.
- NOT done, waiting for the owner: the switch. `Sales — Call Booked (iClosed)` (`xoPqojySDriQ8Mzh`, live `6cca8532`) must pass `event_slug` in "Start Normal Funnel". Until then the handler always sees an empty slug and educator bookings still get the /doctors emails.
Undo: restore `fd551429-581e-4765-8c95-a2b093156336` on the handler and publish; archive `lU5RlPUBsmlMsFSf`.

## 2026-10-22 Educator call emails switched on: the router passes the calendar (owner's go in the thread, Ads lane)
Why: the owner read the preview and said to switch on now (entry above built everything but this).
- Sales, Call Booked (iClosed) (`xoPqojySDriQ8Mzh`), node "Start Normal Funnel": before `6cca8532-9840-4f5b-b2d3-7ce4d930935d`, after `73723410-f331-4c14-b002-489259d4657f` (published). Adds the `event_slug` input, filled from "Normalize Booking". Version diff checked: only that field and its schema entry. Handler `ghpbQQJizAnR6p2b` confirmed still on `811f4f65`.
- Effect: `educator-strategy-call` bookings now get the educator confirmation, text wording and pre-call emails (`lU5RlPUBsmlMsFSf`). /doctors and /apply bookings carry their own slug and take the unchanged path.
Tested: not yet end to end; the owner's planned full test booking (book, reschedule, cancel) is the first live run.
Undo: restore `6cca8532-9840-4f5b-b2d3-7ce4d930935d` on the router and publish.

## 2026-10-22 Recovery reminder text goes even after the booking-link text (owner's go in the thread, Ads lane)
Why: the launch test of the Doctors who teach page (22 Oct) showed that a lead who submits but does not book got the 3 minute booking-link text and then never the 30 minute reminder text: the instant link stamps `sms_sent_at`, so the sender treated the lead as already texted (execution 676018 stopped at "Send SMS?"). The owner chose to let the reminder text go too, at most two texts per lead.
- Sales, Booking Recovery Dispatch (`nQ4vnZ8bmG3E3Lor`), Code node "Select Due": before `bbb6da3b-fed5-4231-acca-a163b493acfa`, after `d7af558d-2f77-4722-a230-b08ce29d5cab` (published). A text is still owed when the only text so far is the booking-link text (`sms_sent_at` equals `raw.instant_sent_at` and `raw.instant_sms` is yes). Once the reminder goes, `sms_sent_at` changes and no third text is possible. Quiet hours, opt-out, consent and the booked check are unchanged. Applies to every calendar that uses the instant link (doctors and doctors who teach).
Tested: saved code read back from n8n and compared (identical apart from a trailing newline); run locally on four sample rows (booking-link text only: email and text; reminder already sent: email only; no text yet: both; no consent: email only). Live test on a test lead follows in the Ads tracker.
Undo: restore `bbb6da3b-fed5-4231-acca-a163b493acfa` in n8n's workflow history and publish.
