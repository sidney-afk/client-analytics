# ROLLBACK.md — the "back to a working website in one step" runbook

**This file is law.** The owner's requirement, verbatim in spirit: *"I need to make sure that if
there's a bug or a problem or anything happening, I can click on a button and everything goes
back to normal. Our whole business depends on this."* Every phase of the independence plan is
executed under the rules below, and the **Live State table** in this file must be updated in the
same PR as any change it describes. If this file is out of date, the migration is out of
compliance — stop and fix it.

## 1. Standing rules (non-negotiable)

1. **One-step rollback, always.** Every cutover ships behind a single flip point — a runtime
   kill switch where possible (URL param / localStorage flag / config row checked at load), a
   single frontend constant otherwise. Rolling back must never require re-implementing anything:
   flip the switch, or `git revert` the one flagged commit and merge to `main` (GitHub Pages
   redeploys automatically; allow ~10 min for Pages cache).
2. **The old path stays alive until the new path has baked.** n8n workflows being replaced are
   left ACTIVE during canary, then only DEACTIVATED (never deleted) after their gate passes,
   then archived only at final cleanup. Rollback = one click ("Activate") in n8n. Before
   touching ANY n8n workflow, export its JSON to `n8n-backups/` (dated) in the same PR.
3. **Additive-only database changes during the entire migration.** New tables and new columns
   are allowed; DROP/RENAME/type-changes are forbidden until the final cleanup phase after
   everything has baked. This guarantees the old code path always still works against the
   current schema — which is what makes rule 1 honest.
4. **Snapshot before every phase.** (a) git tag `pre-<phase>` (e.g. `pre-A1`) on `main`;
   (b) JSON export of every n8n workflow the phase touches; (c) Supabase dump (CSV or SQL) of
   every table the phase writes, stored in the private weekly-backup Drive folder, and note the
   public-safe file names in `EXECUTION_LOG.md`.
5. **Log everything.** `EXECUTION_LOG.md` (create in the first execution PR) gets a dated entry
   for every deploy, flag flip, n8n change, DB migration, backup taken, incident, and rollback —
   with enough detail to reconstruct events later. This complements the in-app event ledgers
   (owner decision D7).
6. **Gates are hard stops.** At every gate in `INDEPENDENCE_PLAN.md` §6: post the evidence
   (test results, canary metrics, reconciler-correction count), get the owner's explicit OK,
   only then proceed.
7. **Verify the rollback, not just the deploy.** For each phase, before its canary starts,
   actually EXERCISE the rollback once on the QA client (flip back, confirm the old path works,
   flip forward again). An untested rollback is a hope, not a button.
8. **The repo is public.** No secrets in code, docs, commits, or logs — ever.

## 2. Live State table — what is serving production RIGHT NOW

Update in the same PR as any change. "Rollback" must be executable by the owner alone.

| Surface | Current production path | Kill switch / rollback | Last verified |
|---|---|---|---|
| Calendar writes (upsert/reorder) | n8n webhooks (pre-migration baseline) | n/a — baseline | 2026-07-03 |
| Samples New (SXR) writes | n8n webhooks (baseline) | n/a — baseline | 2026-07-03 |
| Samples Old writes | n8n webhooks (baseline; out of migration scope, D4) | n/a | 2026-07-03 |
| Linear → app realtime sync | n8n workflow `MJbMZ789B5ExZz9x` (re-enabled 2026-07-03); two Linear webhooks now cover **both VID and GRA** | Deactivate the workflow in n8n; reconciler continues healing every 10 min regardless | 2026-07-03 (VID execs 190909/190910; GRA exec 190952) |
| App → Linear pushes (set-status/comment) | n8n webhooks + FE localStorage outboxes (baseline) | n/a — baseline | 2026-07-03 |
| Status drift healing | GitHub Actions reconcilers every ~10 min (n8n triggers `AkiFmromoDkmsh39` active, `ZJOtYpQZj73DcBB1` inactive) | Must stay ACTIVE until Track B5 — this is the global safety net | 2026-07-03 |
| Templates / caption prompts | Google Sheets via n8n (baseline) | n/a — baseline | 2026-07-03 |
| Filming plans runway | Production still uses n8n `filming-plan-tabs` (baseline). QA/headless harness stubs this endpoint by default to stop cold-cache n8n load; set `SYNCVIEW_QA_LIVE_FILMING_TABS=1` for a deliberate live probe. | Revert the QA harness commit, or run QA with `SYNCVIEW_QA_LIVE_FILMING_TABS=1`. Production rollback remains n/a; baseline n8n path is still live. | 2026-07-03 |
| Production tab (Track B) | does not exist yet | — | — |

## 3. Emergency full rollback (worst case, any time during Track A)

1. `git revert` the offending commit(s) or reset `main` to the last `pre-<phase>` tag; push.
   GitHub Pages redeploys the site (~10 min worst case; hard-refresh to bypass cache).
2. In n8n: re-activate any workflow the current phase had deactivated (they were never deleted).
3. Confirm the reconciler trigger (`AkiFmromoDkmsh39`) is active — it heals any status drift the
   incident caused within ~10 minutes.
4. Run the relevant `qa/master.js` lane against production to confirm green.
5. Write the incident + timeline into `EXECUTION_LOG.md` before resuming any migration work.

During Track B the same applies, plus: the Production tab is flag-gated and additive — turning
the flag off returns everyone to the Linear-era flow, and the one-way mirror means Linear was
kept current the whole time, so nothing is lost.

## 4. Backup inventory (what exists, where)

- **Weekly** (Sun 02:00, n8n `jlVfbg0Njxf1It7h`): main Sheet copy, repo zip, ALL n8n workflow
  JSONs, Supabase dumps (calendar_posts, content_samples, + onboarding tables) → private
  weekly-backup Drive folder.
- **Repo**: `n8n-backups/` (point-in-time workflow JSONs), `migrations/` (schema), git history
  + tags. Phase snapshots per rule 4 add to these.
- **Phase 0 baseline closed 2026-07-03**: live schema committed at
  `migrations/live-schema-baseline-2026-07-03.sql`; private full n8n export confirmed via
  weekly-backup execution `191240`. Because this repo is public, raw unredacted workflow JSON
  remains private; repo evidence is summarized in `n8n-backups/2026-07-03-phase0-snapshot-status.md`.
