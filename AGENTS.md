# Agent Guide

This repo is a single-file SyncView app served by GitHub Pages from `index.html`.

**New session? Read `docs/truth/BRIEFING.md` first** — it front-loads what you'd otherwise
re-discover (system shape, where truth lives, enforced invariants, live-system safety).
Check `docs/truth/` before re-auditing anything; those docs are current-state,
updated in place, and drift-checked by `test/truth-sync.js`.

- **`docs/CLIENT_LIFECYCLE_MAP.md` is a MIRRORED doc** — the identical file
  lives in the `synchrosocial` repo at `docs/CLIENT_LIFECYCLE_MAP.md`. It maps
  the entire client lifecycle (traffic → booking → sales → onboarding →
  provisioning → samples → production). If you change either copy, apply the
  identical change to the other repo in the same session/PR; keep them
  byte-identical. Because the path is part of the mirror contract, it stays at
  `docs/CLIENT_LIFECYCLE_MAP.md` — do not move it into a docs/ subfolder.

Repo layout is documented in `REPO_MAP.md` — when you add, move, or remove files,
update the map in the same change (`test/repo-map-sync.js` enforces it in CI).

For the visible **Linear** mirror (internal key/module `production`) polish:

- Keep the deliberate label/route split: **Linear** = `navProd` / `production` / `#production` with `?prod=1`; **Submit** = `navLinear` / `linear` / `#linear`. Never derive routing from the visible labels.
- Production is an authority-gated native mirror. Status, comment, due-date, and assignee controls may write only for a verified compatible role on a SyncView-authoritative team, plus the bounded active-TEST override. Linear-authoritative, missing/malformed authority, unsigned, and unsupported operations stay read-only and fail closed. Read back current runtime authority before acting; never treat a dated Linear/Linear snapshot as a permanent guarantee.
- Run `npm run test:prod-polish` for Production UI changes. It includes a locked live-read/zero-mutation lane and a fully mocked `production-write` capability lane, plus boot, structure, interaction, accessibility/focus, layout, behavior, and pixel coverage. Live-observation lanes may issue read-only requests; no suite may mutate a live backend. F105 is open until the stale interaction/heavy guard-mode assertions are rewritten and the aggregate gate is green.
- Keep fixes tight and add tests for owner feedback such as stuck hover states, clipped dates, broken right-click behavior, scroll position, filter/display menus, and selection cleanup.
- Preserve URL/deep-link behavior for `?prod=1`, `team`, `view`, `client`, and `d` query params.
- Keep docs current: `docs/syncview-design/WIRED-PARITY.md`, `docs/audits/2026-07-09-production-foundation-audit.md`, `EXECUTION_LOG.md`, and `ROLLBACK.md`.
