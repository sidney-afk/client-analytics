## Summary

-

## Production Tab Checklist

If this PR touches `?prod=1`, `_prod*`, `docs/syncview-design/**`, or Production UI behavior:

- [ ] Current runtime authority was read back when relevant; no dated Linear/Linear snapshot was treated as permanent.
- [ ] Status/comment/due/assignee writes still require the authenticated gateway, a verified compatible role, active target, valid SyncView team authority (or bounded active-TEST override), and fail-closed handling for missing/malformed authority.
- [ ] Unsupported mutating-looking controls remain live-local, guarded, or clearly disabled; no direct browser/n8n/Linear writes and no silent dead ends.
- [ ] Hover, focus, Escape, right-click, keyboard, selection, scroll, and deep-link behavior were considered.
- [ ] The **aggregate** `npm run test:prod-polish` passed on the exact candidate, including locked live-read/zero-mutation, fully mocked write-gateway, interaction, and heavy lanes; the fast PR job alone is insufficient.
- [ ] A locally generated `production-review-packet` was reviewed when the change affects visible UI; visual packets are never uploaded from the public repository workflow.
- [ ] `docs/syncview-design/WIRED-PARITY.md`, `EXECUTION_LOG.md`, and `ROLLBACK.md` were updated if behavior, gates, or rollback scope changed.

## Validation

-
