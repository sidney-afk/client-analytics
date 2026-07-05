# Track B B0 n8n snapshot status - 2026-07-05

Public-safe status for the Track B B0 auth/scaffold phase. Raw n8n workflow JSON can contain
credential references and private business configuration, so no raw workflow export is committed to
this public repository.

Before B0 live changes, the existing `SyncView - Weekly Backup` workflow (`jlVfbg0Njxf1It7h`) was
run manually in production mode.

| Item | Status |
|---|---|
| n8n execution | `204072` |
| Execution result | success |
| Started / stopped | `2026-07-05T21:29:10Z` / `2026-07-05T21:29:33Z` |
| Private Drive folder | `2026-07-05`, folder ID `1eidMH3rtOgycApT7GQ7A-yYp6E2b4xJo` |
| n8n workflows JSON | `n8n-workflows-2026-07-05.json`, file ID `1tZBOX2vAp5NbIV8UBF3hOjACMGuL-BFR` |
| Supabase JSON backup | `supabase-2026-07-05.json`, file ID `1_rLIGI8FEU--gJrlWHNcunHF4qLLc5rB` |
| Main Sheet copy | `SyncView Main Sheet - 2026-07-05`, file ID `1Cr-toJqzvft0zIA73xQ7--qudsehiFquG2iPwpK_ztU` |
| GitHub repo zip | `client-analytics-2026-07-05.zip`, file ID `1VTZJBbkoAq9S6pVuWlojQyn-DLOx6Z7b` |

Additional private local Supabase JSON snapshots were written outside the public repo under:

`C:\Users\Sidney\Documents\Codex\private-backups\2026-07-05-pre-B0-track-b\supabase`

Snapshot counts: `syncview_runtime_flags` 3, `calendar_posts` 3438, `sample_reviews` 2654,
`calendar_post_events` 473, `sample_review_events` 22000, `templates` 6, `caption_prompts` 25,
`workload_issues` 2085. B0 target tables `clients`, `client_access`, `team_members`, and
`flag_flips` were absent before the B0 migration.

Rollback posture:

- No n8n workflow was edited, deactivated, or deleted during the B0 auth scaffold work in this PR.
- B0 database changes are additive. The auth kill switch is
  `syncview_runtime_flags.auth_enforcement={"mode":"permissive"}`.
- The B0 n8n hard-gate item was cleared after this snapshot: `SyncView - Error Alerts -> DM
  Sidney` (`itqDXSl2ybsRSAiQ`) exists, is active, and is now wired as workflow-level
  `errorWorkflow` on the critical B0 workflow set. A throwaway error workflow verified the alert
  path without forcing a production workflow error.
