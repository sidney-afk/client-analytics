# Samples (Review) — Go-Live Checklist

The samples feature is **built, verified, and committed**. It ships behind the
`?sxr=1` flag (**default OFF**), so merging changes nothing for anyone until you
flip that flag. This is the short list of steps to take it live.

---

## Already done (no action needed)

- ✅ **Database** — `sample_reviews` + `sample_review_events` tables, RPC, the
  `*_status_at` trigger, RLS + realtime. (You ran the SQL.)
- ✅ **n8n writers** — `sample-review-upsert` / `sample-review-reorder` (live).
- ✅ **Inbound Linear sync** — runs as a parallel branch (`Handle Sample Linear
  Event`) **inside your existing calendar Linear webhook** (`MJbMZ789B5ExZz9x`),
  so it adds **zero** extra n8n executions and needs **no change in Linear**.
  Live + wiring-tested.
- ✅ **Front end** — full review lifecycle (SMM ↔ Kasper ↔ Client), Kasper
  "Samples" sub-tab, client review surface, and the Linear FE layer
  (push / suppression / outbox / point-adoption / stale-regress / tweak-comment).
  Fully isolated; dormant while `?sxr` is OFF.
- ✅ **Reconciler** — `scripts/sample-linear-reconcile.js` +
  `.github/workflows/sample-linear-reconcile.yml` (10-min convergence net).

---

## Go-live steps (in order)

### 1. Merge to `main`
Create the PR and merge. Safe at any time — the feature is `?sxr=1` default-OFF.
Merging also puts `sample-linear-reconcile.yml` on `main` (required for step 2)
and turns on the GitHub reconcile cron.

### 2. Activate the reconcile backstop (AFTER the merge)
n8n workflow **`SyncView Samples — Linear Reconcile Trigger`** (`ZJOtYpQZj73DcBB1`):
1. Open the **`Trigger GitHub Reconciler`** node → in **Credential for Header
   Auth**, select **`GitHub PAT — reconcile`** → Save.
2. Toggle the workflow **Active**.

> Do this **after** the merge — until `sample-linear-reconcile.yml` is on `main`,
> the dispatch returns 404.

### 3. Flip the flag when you're ready to show it
Append `?sxr=1` to the app URL (it's sticky per browser). The "Samples (Review)"
nav item appears only with the flag on. The old samples module keeps running in
parallel until you choose to retire it.

---

## One thing to confirm at first live test

For **real-time** inbound routing to find the right row, a sample's Linear issue
should sit under a **project (or parent project) whose name slugifies to the
client slug** — e.g. "Sidney Laruel" → `sidneylaruel`. If it doesn't match, the
real-time webhook skips it, but the **10-min reconciler still heals it** (it keys
off the card's stored link, not the project). So a mismatch means up-to-10-min
lag, not data loss.

---

## Rollback / off-switches

- **Hide the feature:** remove `?sxr=1` (or set `syncview_sxr_off`); everything
  goes dormant. No data is touched.
- **Stop the reconciler:** toggle `ZJOtYpQZj73DcBB1` Inactive (and/or disable the
  GitHub workflow).
- **Undo the inbound embed:** in n8n, re-publish the calendar workflow's
  pre-embed version `3f99f865-bc1b-4b72-ab8f-6e153236100e`, **or** just delete the
  `Handle Sample Linear Event` node. (The standalone `sample-linear-status-sync`
  workflow `qmDGbKnvrK0sPFKj` is still there, deactivated, as a fallback.)
- ⚠️ **If you edit the calendar Linear workflow (`MJbMZ789B5ExZz9x`) for any
  reason, keep the `Handle Sample Linear Event` branch** — deleting it silently
  breaks samples inbound sync. (Tracked in `SAMPLES_PARITY_LOG.md`.)

---

## Reference

| Thing | ID / location |
|---|---|
| Inbound sync (embedded branch) | calendar workflow `MJbMZ789B5ExZz9x` → node `Handle Sample Linear Event` |
| Standalone inbound (deactivated fallback) | `qmDGbKnvrK0sPFKj` |
| Reconcile backstop (activate after merge) | `ZJOtYpQZj73DcBB1` |
| Reconcile script / workflow | `scripts/sample-linear-reconcile.js` · `.github/workflows/sample-linear-reconcile.yml` |
| GitHub PAT credential (n8n) | `GitHub PAT — reconcile` (`fygMapRRjtItIsaE`) |
| Plan / parity / backups | `SAMPLES_V2_PLAN.md` · `SAMPLES_PARITY_LOG.md` · `n8n-backups/` |
| Flag | `?sxr=1` (sticky `syncview_sxr_on` / `_off`), route `#sample-reviews` |
