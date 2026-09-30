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
