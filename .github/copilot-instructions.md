# SyncView AI Agent Instructions

Production tab work is a Linear-style read-only preview unless a task explicitly says the write path is being enabled.

- Keep Production changes scoped to `index.html`, `docs/syncview-design/tests/`, and the related docs unless the task needs backend work.
- Do not add real writes from Production preview controls. Mutating controls should show the read-only guard and keep adapter state unchanged.
- Preserve `?prod=1` deep links, browser back/forward behavior, scroll reset when opening a new detail, and local display/filter state.
- Treat hover, focus, right-click, Escape, keyboard navigation, selection cleanup, and clipping as first-class behavior.
- Before opening a PR for Production UI work, run `npm test` and `npm run test:prod-polish`.
- Update `docs/syncview-design/WIRED-PARITY.md`, the relevant audit note, `EXECUTION_LOG.md`, and `ROLLBACK.md` when Production behavior or gates change.
- If a screenshot or owner reference is provided, turn it into a focused behavioral/layout assertion so the same polish issue does not regress.
