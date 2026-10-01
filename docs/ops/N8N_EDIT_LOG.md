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

