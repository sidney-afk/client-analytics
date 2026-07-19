# SyncView AI Agent Instructions

Production is a Linear-style, authority-gated native mirror. Its deployed status, comment, due-date, and assignee controls can write only for verified compatible roles on SyncView-authoritative teams, plus the bounded active-TEST override. Linear-authoritative, missing/malformed authority, unsigned, and unsupported operations remain read-only and fail closed. Always read back current runtime authority; a dated Linear/Linear snapshot is not a permanent guarantee.

- Keep Production changes scoped to `index.html`, `docs/syncview-design/tests/`, and the related docs unless the task needs backend work.
- Preserve the single authenticated `production-write` gateway and its role, team, authority, active-client, operation, and stale-write guards. Do not add direct browser writes, n8n/Linear calls, or unsupported operations; guarded controls must leave adapter state unchanged.
- Preserve `?prod=1` deep links, browser back/forward behavior, scroll reset when opening a new detail, and local display/filter state.
- Treat hover, focus, right-click, Escape, keyboard navigation, selection cleanup, and clipping as first-class behavior.
- Before opening a PR for Production UI work, run `npm test` and `npm run test:prod-polish`. The latter intentionally combines locked live-read/zero-mutation coverage with a fully mocked native-write lane. No suite may mutate a live backend. F105 made locked fixtures, inline project-parent layout, empty-data synchronization, and recovered-read correlation explicit: persistent/pending/unmatched errors and every live mutation remain fatal. The exact candidate still needs the full aggregate, because a green fast PR job alone is insufficient.
- Update `docs/syncview-design/WIRED-PARITY.md`, the relevant audit note, `EXECUTION_LOG.md`, and `ROLLBACK.md` when Production behavior or gates change.
- If a screenshot or owner reference is provided, turn it into a focused behavioral/layout assertion so the same polish issue does not regress.
