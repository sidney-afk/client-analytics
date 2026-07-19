# Agent Guide

> ## ⛔ FROZEN — client write gate (owner directive, 2026-07-15). READ BEFORE TOUCHING WRITERS.
> The Edge Functions **`calendar-upsert`** and **`sample-review-upsert`** are **INTENTIONALLY
> UN-GATED** (open / tokenless) right now, by explicit owner decision, so that clients' existing
> review links keep saving approvals and comments. **DO NOT re-gate them, re-apply the F35
> write-auth lock, revert this, or "secure/clean up" them — not as a fix, a rollback, a
> follow-up, or a "permanent" hardening — without the owner's EXPLICIT affirmative approval in
> that same request.** Re-gating them while clients still hold pre-existing links silently
> `401`s every client's approvals/comments (this broke clients **twice** on 2026-07-15).
> Re-locking is permitted ONLY after **(a)** the owner says so affirmatively **AND (b)** every
> active client has been re-issued and confirmed on a fresh link. **If you believe they should
> be re-gated: STOP and ASK THE OWNER FIRST — do not proceed until they say yes.** Full incident
> in `EXECUTION_LOG.md` (2026-07-15) and the F35 row of `ROLLBACK.md`.

This repo is a single-file SyncView app served by GitHub Pages from `index.html`.

**Before building or polishing visible UI, read
`docs/features/UI_DESIGN_STANDARDS.md`.** Browser-native select menus, date
popups, and number spinners are not acceptable on branded surfaces; reuse the
documented SyncView controls and verify keyboard, tooltip, theme, and mobile
states as part of the feature, not as optional cleanup.

**New session? Read `docs/truth/BRIEFING.md` first** — it front-loads what you'd otherwise
re-discover (system shape, where truth lives, enforced invariants, live-system safety).
Check `docs/truth/` before re-auditing anything; those docs are current-state,
updated in place, and drift-checked by `test/truth-sync.js`.

**Looking for any documented fact?** `docs/FIND_ANYTHING.md` routes every
question to its owning doc in ≤2 opens — including company-level truth (the
Enterprise Atlas: `docs/ATLAS.md` in the `synchrosocial` repo) and the
numbered registers (F-/D-/OQ-/KQ-numbers).

- **`docs/CLIENT_LIFECYCLE_MAP.md` is a MIRRORED doc** — the identical file
  lives in the `synchrosocial` repo at `docs/CLIENT_LIFECYCLE_MAP.md`. It maps
  the entire client lifecycle (traffic → booking → sales → onboarding →
  provisioning → samples → production). If you change either copy, apply the
  identical change to the other repo in the same session/PR; keep them
  byte-identical. Because the path is part of the mirror contract, it stays at
  `docs/CLIENT_LIFECYCLE_MAP.md` — do not move it into a docs/ subfolder.

Repo layout is documented in `REPO_MAP.md` — when you add, move, or remove files,
update the map in the same change (`test/repo-map-sync.js` enforces it in CI).

**The test robots are part of the product (owner directive, 2026-07-17).** The
nightly E2E probes (`qa/probes/`, `qa/ef-writepath/`, driven by the harness libs
in `qa/`) simulate real staff and clients on the TEST client. If your change
affects how anything saves or loads, which transport/lane a client uses, a
runtime flag the page reads, or an endpoint the harness exercises:

1. **Run the affected probes on your branch BEFORE merge** — the nightly E2E
   workflows accept manual dispatch on any branch; smaller changes can run the
   relevant `node qa/probes/<probe>.js` subset directly.
2. **Update the harness in the same PR when the road moves.** The harness must
   keep simulating what REAL clients/staff experience (archetype: the 2026-07-17
   incident — #850 put the TEST client on the dark gateway lane, the probes were
   never told, and the nightly went red for a product behavior that was correct;
   see `EXECUTION_LOG.md` 2026-07-17). If your change deliberately makes the
   TEST client behave differently from real clients, the harness needs a
   matching decision, not silence.
3. **A change that leaves the nightly red is not finished** — either the probes
   are updated with it, or the PR explains exactly why the red is expected and
   what will clear it.

For the visible **Linear** mirror (internal key/module `production`) polish:

- Keep the deliberate label/route split: **Linear** = `navProd` / `production` / `#production` with `?prod=1`; **Submit** = `navLinear` / `linear` / `#linear`. Never derive routing from the visible labels.
- Production is an authority-gated native mirror. Status, comment, due-date, and assignee controls may write only for a verified compatible role on a SyncView-authoritative team, plus the bounded active-TEST override. Linear-authoritative, missing/malformed authority, unsigned, and unsupported operations stay read-only and fail closed. Read back current runtime authority before acting; never treat a dated Linear/Linear snapshot as a permanent guarantee.
- Run `npm run test:prod-polish` for Production UI changes. It includes a locked live-read/zero-mutation lane and a fully mocked `production-write` capability lane, plus boot, structure, interaction, accessibility/focus, layout, behavior, and pixel coverage. Live-observation lanes may issue read-only requests; no suite may mutate a live backend. F105 repaired the stale post-#813 test epoch: locked row assertions select an explicit non-TEST row, layout follows the owner-ratified inline project-parent breadcrumb, and behavior tolerates a legitimately empty active-team fixture only after loaded state plus an independent owner-active row count prove it is empty. Recovered reads require exact eligible method+URL failure→success; each generic resource-console error additionally requires one-to-one URL/time correlation. Persistent, pending, unrelated, and unproven failures stay red, and mutation checks run after settling.
- Keep fixes tight and add tests for owner feedback such as stuck hover states, clipped dates, broken right-click behavior, scroll position, filter/display menus, and selection cleanup.
- Preserve URL/deep-link behavior for `?prod=1`, `team`, `view`, `client`, and `d` query params.
- Keep docs current: `docs/syncview-design/WIRED-PARITY.md`, `docs/audits/2026-07-09-production-foundation-audit.md`, `EXECUTION_LOG.md`, and `ROLLBACK.md`.
