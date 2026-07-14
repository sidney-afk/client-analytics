# n8n — current truth

> Last verified: 2026-07-14 (live configuration/execution readback + second-pass reconciliation)
> Live facts from `docs/audits/2026-07-05-n8n.md` (verified 2026-07-05) unless noted.
> n8n remains load-bearing for many unmigrated readers/writers and as dormant Track-A fallback;
> full-active-roster Calendar/SXR/settings writes now use Edge Functions. Snapshot workflows
> privately plus a public-safe `n8n-backups/` stub before any change (`ROLLBACK.md` rule 2).

## Inventory

The app-facing webhook surface (55 endpoints) is enumerated and machine-enforced in
`docs/truth/ENDPOINTS.md`. Deep per-workflow reads: `docs/audits/2026-07-05-n8n.md`.

## Known state (spot-verify before relying — n8n changes outside git)

- Inbound Linear sync workflow `MJbMZ789B5ExZz9x` is **inactive/unpublished**
  (`activeVersionId=null`). Its five-node saved graph contains the A1/A2 routing and the later
  authority gates, but that graph is not serving traffic. A 24-execution crash cluster ended before
  the last saved version and no later execution was present at the 2026-07-13 readback. Do not call
  Calendar/Samples/Workload inbound "real-time" and do not publish this saved graph as an automatic
  fix: first explain the crash/soft-error topology, then deliberately choose and drill either a
  published fast path or the existing reconciler-only latency.
- The old dedicated Samples n8n trigger (`ZJOtYpQZj73DcBB1`) remains inactive, but Samples drift
  protection is **on twice**: pager `qllIDZPkdNAPRj0b` dispatches the GitHub workflow every 15
  minutes and `sample-linear-reconcile.yml` still has its own `*/10` schedule. Recent executions
  contain both trigger types. Remove one cadence (not both), retain the monitored healer, and prove
  the post-cut 24-hour execution rate (audit F01).
- `linear-set-status` is the only n8n dueDate writer (+2d when overdue, on every call). The
  nightly due-date roller is NOT in n8n (see `docs/truth/LINEAR.md`).
- VIDEO PRODUCTION AUTOMATION ground truth: "Pick Freest Editor" = fewest open sub-issues
  among Video Editors-tab emails (ties by API order); graphic-form assigns a hardcoded single
  designer; the AI-thumbnail chain is **disconnected dead code** — don't budget a port.
- Historical 2026-07-05 sizing was ~25 calendar upserts, ~41 set-status, and ~27 inbound Linear
  events/day across the then-current topology. Do not use the inbound count as current n8n traffic:
  B3 now enters through the Edge Function and the legacy n8n receiver is inactive (F46).
- Weekly backup workflow runs on schedule (last verified 2026-07-05).

## Standing hazards

- **Hardcoded credentials inside workflows:** the house Linear key remains embedded across legacy
  bridges. A plaintext provider key documented in the July 5 audit remains in the live Graphics
  title-generation workflow and all 50 retained versions (F52). Restrict workflow/history/export
  access immediately; stage and TEST-prove a managed replacement for the known live branch; owner
  revoke/rotate; then finish the complete version/export/backup/provider census while monitoring for
  an unknown consumer. Never place a value in this repository.
- Raw workflow JSON is not in git. The private weekly backup corpus holds the unredacted all-workflow
  exports; n8n retains its own version history; public `n8n-backups/` files are status stubs only.
  Snapshot before touching and use `ROLLBACK.md` for the restore contract.
- Reachable legacy Calendar/SXR/settings write fallbacks remain unauthenticated through B5 (F67).
  Routing a client back to n8n or calling a webhook directly can bypass later Edge Function auth.
  Authenticate/scope each fallback or retire it before enforcement; rollback must preserve the same
  principal/client boundary.
