# Linear exit — the lane map

**Read this before you touch anything.** Six parallel sessions are removing Linear
from SyncView. This file says who owns what. It exists because `index.html` is one
79,418-line file and every lane edits it, and because merging to `main` deploys the
live site instantly.

Authority: `AGENTS.md` outranks this file. `docs/ops/OPEN_REPAIRS.md` items **163-168 and 175**
carry the evidence behind every rule here; read 166 (the collision map) and 167 (the
fingerprint pin) before your first commit.

Scoped and adversarially verified 2026-09-07 against `origin/main` `d2495eb` and the
integration candidate `5bcc03bd7`. Every line number below was checked against `d2495eb`.

---

## The lanes

| Lane | Session title | Branch | Owns |
|---|---|---|---|
| **A** | `LX-A Workload native` | `claude/lx-a-workload-native` | The Workload board's source, realtime, refresh and plan days |
| **B** | `LX-B Write path` | `claude/lx-b-write-path` | `production-write`'s Linear reads, native intake, labels, native naming mint |
| **C** | `LX-C Endpoints and Submit` | `claude/lx-c-endpoints` | The n8n Linear webhooks, Submit routing, urgent alerts, editors-week, the Calendar/Samples legacy Linear surface |
| **D** | `LX-D Comments and feedback` | `claude/lx-d-feedback` | The native comment reader and the feedback panel, including the Tweak popover body |
| **E** | `LX-E Media rescue` | `claude/lx-e-media` | Re-hosting `uploads.linear.app` files for cards still being worked |
| **F** | `LX-F Cutoff and watchers` | `claude/lx-f-cutoff` | Turning Linear off in the right order, and the watchers that catch what breaks after |

**Lane G was dissolved.** Its findings were folded into the lanes that own the code:
G3 → C, G4/G5 → C, G6 → F, G11 → F, G1 → B. Nothing is lost; see item 165.

---

## `index.html` region ownership — the single most important table here

A second session editing a region it does not own produces either a conflict nobody
has time to resolve, or a clean-looking auto-merge that silently drops the first
session's change. Stay inside your rows.

| Region | Lines on `d2495eb` | Sole owner |
|---|---|---|
| `LINEAR_ISSUES_WEBHOOK`, `loadLinearIssues` + its fallbacks | 13969, 14533-14575 | **A** |
| Workload snapshot, realtime, `wlLoadSnapshot` / `wlRefetchSilent` / `wlManualRefresh` | 14025-14575, 15323, 16323-16600 | **A** |
| `wlFetchTweakComments`, `wlRenderTweakComments`, call site, catch copy | 19270-19600 | **D** |
| write-UI reroute flag and its dark fallback | 25349-25600 | **C** |
| `WRITE_UI_FAILURE_CODE_TEXT` object literal | 26859-27450 | **B** |
| Calendar legacy Linear surface (`_cal*`, `LINEAR_OUTBOX_KEY`) | 30384, 32358-34049, 38485-38880 | **C** |
| Native video editor pool, `_calNativePostErrorText` | 40522-40560, 41331-41400 | **B** |
| Submit router and card-write job tail (`_linear*`, `_submitLinearForm*`) | 47059-48450 | **C** |
| `displayId` resolution | 51816 | **B** |
| Comment renderer (`_prodCommentHTML`, `_prodLinkify`, `_prodCommentNormalize`) | 3013 CSS, 54912-55164, 62068 | **D** |
| Samples legacy Linear surface (`_sxr*`) | 63149, 64363-64525, 67641-68160, 68903-68960 | **C** |
| Kasper editors-week panel | 77615-78000 | **C** |

**Lane E touches `index.html` not at all.** Hold it to that.

---

## Single-writer resources

Two files are single-writer for the whole program. Editing them out of turn burns an
owner window, not just a merge.

1. **`.github/workflows/deploy-f27-section4-closures.yml`** — the fingerprint pins
   (`PRODUCTION_WRITE_SOURCE_SHA256`, `LINEAR_OUTBOUND_SOURCE_SHA256`, and the two
   file counts). Three lanes need three different values and only one can be right.
   **No lane edits this file.** You state the value you need in your PR body; the
   coordinator computes it on the actual merge commit with
   `node scripts/ef-fingerprint.js <sha> --slugs=<slug> --expected-only` and lands
   one re-pin commit. See item 167.
2. **`docs/ops/OPEN_REPAIRS.md`** — append only, never rewrite. Reserved numbers:
   **A=169, B=170, C=171, D=172, E=173, F=174.** Take more by appending upward from
   175 and saying so in your PR. Four duplicate headers (`## 13.`, `## 14.`, `## 22.`,
   `## 23.`) already exist on main and predate this program; do not "fix" them (item 168).

---

## Merge order

The coordinator merges. Sessions open **draft PRs and stop.**

1. **F-monitoring** (split out of F, merged first) — four watchdog lanes hard-require a
   Linear credential and will latch permanent failures the day it dies. Pure hygiene,
   touches no `index.html`.
2. **B** — the loudest total break. Nothing new can enter the system on either team
   without it, and today's error strings actively lie about the cause.
3. **A** — must be live **and measured** before `workload_issues` stops being rebuilt.
   Its acceptance check compares against that table and becomes unrunnable afterwards.
4. **D** — depends on A. Its deploy lane redeploys four functions from one commit.
5. **C** — the largest destructive surface; merging it last among the browser lanes
   means every other lane's hunks already landed.
6. **E** — last among anything that rewrites `deliverables.brief`, so its
   compare-and-swap fails loudly instead of overwriting another lane's rewrite.
7. **F (the rest)** — F turns things off. Every flag flip presumes A/B/C/D are live
   and observed.

**Safe to run fully in parallel:** (B, E), (A, E), (D, E), (A, D) once the tweak block
is D's alone, and F-monitoring alongside everything.

---

## The order Linear is actually turned off

`workload_issues` does not empty when Linear dies. The reconcile returns `[]` on a bad
read and its safety gate keeps the old rows, so **the board FREEZES**: about 2,000 rows
stay `active=true` with a `synced_at` that stops advancing. Stale-and-plausible is worse
than blank, and it is why lane A must be observed before lane F stops the reconcile.

`linear-outbound` is **turned off, never deleted** — one reversible flag
(`linear_outbound_enabled={"mode":"off"}`), and the handler reads no rows at all above
that gate. It is hard-coded 43 times in the only deploy path for `deliverable-write` and
`batch-write`, and it is baked into the owner's local capture script.

**The outbound flip is gated on lane B's native naming mint** (item 175's correction):
`linear-outbound` is what mints `linear_identifier` for native cards, so flipping it off
before the mint lands means every new card loses its readable name.

---

## Hard rules for every session

- **Do not merge.** Draft PR, then stop.
- **Do not edit another lane's region.** Write the need into the ledger instead.
- Never reformat, reflow, or tidy `index.html` while you are in it.
- `calendar-upsert` and `sample-review-upsert` stay tokenless. Never deploy the
  repository copies of those writers as-is.
- Never edit an n8n workflow unless your brief names that specific workflow. Export its
  JSON to the private Drive backup first; commit only a public-safe status stub to
  `n8n-backups/`.
- **`log-linear-submission` is NOT a Linear endpoint.** Despite the name it appends to a
  Google Sheet and touches no Linear API. Deleting its three call sites re-opens the
  2026-08-26 incident where the only copy of a videographer's submitted work lived in his
  own browser. Leave it.
- The repo is PUBLIC. No secrets, tokens, client display names, share-link tokens or
  private file URLs anywhere, including tests and CI output. Slugs are fine; prefer counts
  to names.
- Mutate only the test client `sidneylaruel` unless the owner names another.
- Additive-only SQL. No DROP, no RENAME, no type change.
- `npm test` before every push. `npm run test:prod-polish` cannot pass in a sandbox; all
  8 lanes fail identically on `origin/main`, so check against main before calling a
  failure a regression.
- Do not claim a live system state you did not read. Unverified goes in the PR body as
  unverified.

## Two test failures you WILL see, and neither is yours

Verified on a clean `origin/main` checkout in this environment, 2026-09-07.

1. **`test/truth-sync.js` fails 14 of 529** — seven `docs/truth/*.md` files each fail
   "freshness commit resolves" and "is an ancestor of HEAD". The session clone is
   **shallow** (`git rev-parse --is-shallow-repository` = true, 348 commits), so the
   commits those freshness stamps name are simply not present. Baseline is
   **515 passed, 14 failed**. If you see exactly that, you changed nothing. If the
   count moves, you did.
2. **`npm run test:prod-polish` cannot pass here at all** — all 8 lanes fail
   identically on `origin/main` because there is no route to the live backend.

Do not "fix" either one. Do not deepen the clone to make a stamp resolve. Record the
baseline count in your PR body so the coordinator can tell your delta from the noise.

## What every PR body must state

- what is done and proven, with the test names
- what is **not** done
- every live action the owner must take, each with its exact undo
- the fingerprint value you need, if any (you do not set it yourself)
- anything you found that belongs to another lane
