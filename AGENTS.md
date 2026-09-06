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

**When telling the owner to run a GitHub Actions workflow, always give the
direct link to it** (owner directive, 2026-09-01, after being asked twice in
one session): `https://github.com/sidney-afk/client-analytics/actions/workflows/<file>.yml`
— never just the workflow's display name in prose. He runs these by hand from
the Actions "Run workflow" UI, not `gh`; naming a workflow without the link
means he has to go find it himself every time.

**When a guard could go either way, choose PERMISSIVE (owner directive, 2026-08-27):
"I prefer things to be not strict than strict."** Said after a picker rule that
hid batches the server would have accepted. The asymmetry is the reason: an
over-strict client makes a working thing INVISIBLE, and an absence is the one
failure a user cannot debug or report accurately — it arrives as "it's not in
the list", which costs a day of investigation. An over-permissive client shows
the option and lets the server refuse, which is legible, actionable, and lands
in a message you can improve. So do not encode a guess about state the client
cannot see (project mappings, ownership, authority) as a refusal in the browser;
let the authority that can see it decide, and make its refusal say something
useful. This does not license writing without checks — server-side guards stay
fail-closed. It governs what the UI HIDES.

**Before building or polishing visible UI, read
`docs/features/UI_DESIGN_STANDARDS.md`.** Browser-native select menus, date
popups, and number spinners are not acceptable on branded surfaces; reuse the
documented SyncView controls and verify keyboard, tooltip, theme, and mobile
states as part of the feature, not as optional cleanup.

**New session? Read `docs/truth/BRIEFING.md` first** — it front-loads what you'd otherwise
re-discover (system shape, where truth lives, enforced invariants, live-system safety).
Check `docs/truth/` before re-auditing anything; those docs are current-state,
updated in place, and drift-checked by `test/truth-sync.js`.

**Consult the vault FIRST — standing rule (owner directive, 2026-07-19).**
Before any substantive work — answering a question, planning a change, auditing,
or hunting for a fact — go through the vault instead of re-deriving from
scratch: `docs/FIND_ANYTHING.md` routes every question to its owning doc in
≤2 opens, including company-level truth (the Enterprise Atlas: `docs/ATLAS.md`
in the `synchrosocial` repo) and the numbered registers (F-/D-/OQ-/KQ-numbers).
The rule cuts both ways: a session that learns a durable fact the vault doesn't
hold updates the owning doc before it ends — consulting only stays cheap if
every session also deposits.

- **`docs/CLIENT_LIFECYCLE_MAP.md` here is the CANONICAL copy** (byte-mirror
  retired 2026-07-19). It maps the entire client lifecycle (traffic → booking →
  sales → onboarding → provisioning → samples → production). The
  `synchrosocial` repo keeps only a stub at the same path pointing here — edit
  ONLY this copy, never grow the stub back into a full mirror (the
  synchrosocial `atlas-freshness` CI guard fails loud if that happens). The
  path stays at `docs/CLIENT_LIFECYCLE_MAP.md` so existing links keep working —
  do not move it into a docs/ subfolder.

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

For the visible **SyncLinear** mirror (internal key/module `production`) polish:

- Keep the deliberate label/route split: **SyncLinear** = `navProd` / `production` / `#production` with `?prod=1`; **Submit** = `navLinear` / `linear` / `#linear`. Never derive routing from the visible labels.
- Production is an authority-gated native mirror. Status, comment, due-date, and assignee controls may write only for a verified compatible role on a SyncView-authoritative team, plus the bounded active-TEST override. Linear-authoritative, missing/malformed authority, unsigned, and unsupported operations stay read-only and fail closed. Read back current runtime authority before acting; never treat a dated Linear/Linear snapshot as a permanent guarantee.
- Run `npm run test:prod-polish` for Production UI changes. It includes a locked live-read/zero-mutation lane and a fully mocked `production-write` capability lane, plus boot, structure, interaction, accessibility/focus, layout, behavior, and pixel coverage. Live-observation lanes may issue read-only requests; no suite may mutate a live backend. F105 repaired the stale post-#813 test epoch: locked row assertions select an explicit non-TEST row, layout follows the owner-ratified inline project-parent breadcrumb, and behavior tolerates a legitimately empty active-team fixture only after loaded state plus an independent owner-active row count prove it is empty. Recovered reads require exact eligible method+URL failure→success; each generic resource-console error additionally requires one-to-one URL/time correlation. Persistent, pending, unrelated, and unproven failures stay red, and mutation checks run after settling.
- Keep fixes tight and add tests for owner feedback such as stuck hover states, clipped dates, broken right-click behavior, scroll position, filter/display menus, and selection cleanup.
- Preserve URL/deep-link behavior for `?prod=1`, `team`, `view`, `client`, and `d` query params.
- Keep docs current: `docs/syncview-design/WIRED-PARITY.md`, `docs/audits/2026-07-09-production-foundation-audit.md`, `EXECUTION_LOG.md`, and `ROLLBACK.md`.

## F27 Section 4 sealed capture — Sidney's local flow

The dispatch itself is
`https://github.com/sidney-afk/client-analytics/actions/workflows/deploy-f27-section4-closures.yml`
(`Run workflow` → `commit_sha` = current `main`, `operation` = `deploy-reviewed-release`,
`confirm` = `DEPLOY_REVIEWED_F27_SECTION4_CLOSURES`, plus the two
`rollback_bundle_*` values from his capture). It is owner-only — the sealed
capture needs a private Management token and Google service-account
credential neither this session nor any future one holds — so hand him this
exact link rather than describing the workflow.

His sealed-capture/upload step (`docs/ops/F27_INSTALL_RUNBOOK.md` Section 1)
runs from a saved script on his own machine, not typed by hand each time:
`$env:USERPROFILE\.syncview\f27-capture.ps1` (Windows PowerShell, aliased
`f27capture` in his `$PROFILE`). It cds into the repo, loads his saved
`PROJECT_REF` / `SUPABASE_ACCESS_TOKEN` from a sibling file in that same
`.syncview\` folder, runs the capture, and drops a Drive-ready copy already
named `syncview-f27-edge-source-<source_bundle_sha256>.sourcebundle` — the
exact content-addressed name `scripts/f27-private-snapshot-store.js` would
give it (`ARTIFACT_KINDS['edge-source']`) — so it can go straight into the
`SyncView Backups/` Shared Drive root by drag-and-drop, no rename step.

**Do not ask him to paste `PROJECT_REF` or `SUPABASE_ACCESS_TOKEN` again** —
both live only in that local script, off-repo. When he reports a capture, he
is reading straight from its JSON output (`sealed_bundle_sha256`,
`sealed_bundle_byte_length`); use those directly as `rollback_bundle_sha256` /
`rollback_bundle_byte_length` for the Section 4 dispatch — no re-derivation,
no re-explaining the naming convention.

## Two working rules learned the expensive way (2026-09-05)

Both cost a real defect on the same day, on the post-level asset work
(`OPEN_REPAIRS` 155). Neither is about this codebase; both are about how a
session works, which is why they live here rather than in the ledger.

### DO NOT MERGE INSIDE A REVIEW WINDOW

The Codex pass on this repo takes about four minutes and it earns its keep: on
one PR it found two P1s, one of which would have made the owner's very first
action — clearing a Frame folder — silently do nothing. The fix for those two
P1s was then merged **six seconds** after its PR opened, so no review ran on it,
and it shipped a fail-open that a second read caught only by luck.

So: open the PR, let the review finish, then merge. A green CI is not a review.
If a push follows a review, **the review does not re-run on it** — Codex triggers
on open, on ready-for-review, and on an explicit `@codex review` comment, not on
every push. After pushing a fix for a finding, ask for the re-review by name and
say which commit you want looked at.

The only thing that makes an instant merge tempting is that the change looks
small. Every one of the three defects found this day was in a change that looked
small.

### MEASURE WITH THE KEY THE SHIPPED CODE USES

A count published in a comment, a ledger entry or a PR body is load-bearing here
— later sessions plan against it. On this change the first figures came from a
grouping that treated any row with children as a post root, while the shipped
code groups by immediate parent. The published numbers were wrong by 2.5× in the
scary direction (109 split posts, actually 44) and mis-stated the exposure they
were justifying (41, actually 8).

Nothing about the fix changed, but the correction cost a PR and the numbers had
already been written into six files. So: before quoting a measurement, derive it
with the **same key, filter and ordering the code uses**, and cross-check it
against one case you can name and verify by hand. If two methods disagree,
reconcile them before publishing either — the disagreement is the finding.
