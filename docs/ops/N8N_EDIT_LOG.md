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
