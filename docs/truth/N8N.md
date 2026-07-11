# n8n — current truth

> Last verified: 2026-07-11 @ ae8a492
> Live facts from `docs/audits/2026-07-05-n8n.md` (verified 2026-07-05) unless noted.
> n8n is the primary production write path — snapshot to `n8n-backups/` before any change
> (`ROLLBACK.md` rule 2).

## Inventory

The app-facing webhook surface (55 endpoints) is enumerated and machine-enforced in
`docs/truth/ENDPOINTS.md`. Deep per-workflow reads: `docs/audits/2026-07-05-n8n.md`.

## Known state (spot-verify before relying — n8n changes outside git)

- Inbound Linear sync workflow `MJbMZ789B5ExZz9x` is ACTIVE, with A1/A2 flag routing inside
  it; other Linear bridge workflows were byte-identical to baseline at last check.
- The samples reconciler's n8n trigger (`ZJOtYpQZj73DcBB1`) has been **inactive since
  2026-07-03** and its GitHub cron was commented out — samples drift protection is likely OFF.
- `linear-set-status` is the only n8n dueDate writer (+2d when overdue, on every call). The
  nightly due-date roller is NOT in n8n (see `docs/truth/LINEAR.md`).
- VIDEO PRODUCTION AUTOMATION ground truth: "Pick Freest Editor" = fewest open sub-issues
  among Video Editors-tab emails (ties by API order); graphic-form assigns a hardcoded single
  designer; the AI-thumbnail chain is **disconnected dead code** — don't budget a port.
- Traffic normalized after the QA filming-tabs stub: ~25 calendar upserts, ~41 set-status,
  ~27 inbound Linear events/day — small real write volume (sizing comfort for EF migration).
- Weekly backup workflow runs on schedule (last verified 2026-07-05).

## Standing hazards

- **Hardcoded credentials inside workflows:** the house Linear API key in 6 workflows; an
  Anthropic API key in 2 VIDEO PRODUCTION AUTOMATION nodes. Rotation owed; never add more.
- Workflow JSON is not in git — the only history is `n8n-backups/` snapshots + n8n's own
  version history. Snapshot before touching, restore path documented in `ROLLBACK.md`.
