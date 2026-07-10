## Summary

-

## Production Tab Checklist

If this PR touches `?prod=1`, `_prod*`, `docs/syncview-design/**`, or Production UI behavior:

- [ ] The Production preview remains read-only unless this PR explicitly enables a write milestone.
- [ ] Mutating-looking controls are live-local, guarded, or clearly disabled; no silent dead ends.
- [ ] Hover, focus, Escape, right-click, keyboard, selection, scroll, and deep-link behavior were considered.
- [ ] `npm run test:prod-polish` passed locally or in CI.
- [ ] The `production-review-packet` artifact gallery was reviewed when the change affects visible UI.
- [ ] `docs/syncview-design/WIRED-PARITY.md`, `EXECUTION_LOG.md`, and `ROLLBACK.md` were updated if behavior, gates, or rollback scope changed.

## Validation

-
