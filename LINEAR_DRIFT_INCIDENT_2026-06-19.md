# Incident: Linear ⇄ SyncView status drift (Oprah 2 thumbnail) — 2026-06-19

**Status:** root-caused. The card is *stale*, Linear is correct. It will self-heal on
the next reconciler run; remediation below removes the multi-hour delay.

## TL;DR

A real-time **Linear→card** webhook was dropped, so one card shows a stale sub-status.
That is a *known, designed-for* failure mode (best-effort webhooks). The safety net that
is supposed to auto-heal it within ~10 min — `scripts/linear-sync-reconcile.js` — **is
deployed and healthy, but GitHub Actions throttles its `*/10` schedule to ~3.4 h on
average**, so the drift stayed visible for hours instead of minutes. Nothing is corrupted.

## Resolution (deployed 2026-06-19)

- **Oprah 2 healed** to "For SMM Approval" by reconciler run **#25** (15:27 UTC) — the
  GitHub cron firing **3.6 h** after the prior run (#24, 11:50), i.e. the throttling
  reproduced live.
- **Cadence fix deployed:** new n8n workflow **"SyncView Calendar — Linear Reconcile
  Trigger"** (`AkiFmromoDkmsh39`) — a `scheduleTrigger` every 10 min → HTTP
  `workflow_dispatch` of `linear-sync-reconcile.yml` (apply mode), authenticated by a
  fine-grained GitHub PAT (Header Auth credential `fygMapRRjtItIsaE`). The tested reconcile
  logic stays in the GitHub Action (single source of truth); GitHub's `*/10` cron remains a
  free backstop. Verified end-to-end: n8n execution `82144` → GitHub run **#26**
  (`workflow_dispatch`, success). Definition backed up at
  `n8n-backups/linear-reconcile-trigger.2026-06-19.json`.
- **Net effect:** worst-case visible drift drops from ~hours to ~10 min. The Linear→card
  durable-retry gap and the optional Slack alert-on-correction remain as future hardening.

## The symptom

- Card `p_mqfo6nbg_jgdv9` "Oprah 2" (client `jesseisrael`), **thumbnail/graphic** component.
- Website (Supabase `calendar_posts`): `graphic_status = "Tweaks Needed"`, overall `status = "Tweaks Needed"`.
- Linear graphic issue **GRA-6373** ("Jesse Israel | July 1st–15th | Thumbnail #2",
  *"both heads of Jesse and Oprah"* → "Oprah 2"): **`For SMM approval`**.

## Timeline (UTC, 2026-06-19)

| Time | Event | Synced to card? |
|------|-------|-----------------|
| 00:31:52 | Client requested a tweak → GRA-6373 → **Tweak Needed** (caption client-approved 00:33:44) | ✅ reached the card |
| 02:08 / 07:28 / 11:50 | Reconciler runs #22–#24: both sides "Tweaks Needed" → **in sync, 0 corrections** | n/a |
| **13:32:40** | Designer re-submitted → GRA-6373 → **For SMM approval** | ❌ **webhook dropped** |
| 14:46 | Card row touched (unrelated field; `graphic_status` unchanged) | n/a |

**Evidence the 13:32 event was dropped:**
- Linear `stateHistory` for GRA-6373 shows `Tweak Needed` (00:31:52→13:32:40) then
  `For SMM approval` (13:32:40→now).
- n8n workflow **"SyncView Calendar — Linear Status Sync"** (`MJbMZ789B5ExZz9x`) has **no
  execution for GRA-6373** around 13:32. The only nearby runs (13:40:04, 13:40:11) were
  unrelated issues (VID-12466, VID-12557 → "Posted"). The inbound event never executed.
- Supabase still holds the pre-13:32 value (`Tweaks Needed`).
- The same inbound workflow demonstrably drops/errors in bursts (4 timeout-errors on
  2026-06-18 18:41:29, each ~60 s then failed), so dropped inbound events are recurring.

## Why the safety nets didn't catch it

1. **Front-end on-load pull is OFF under the v2 realtime calendar — by design.**
   `_calReconcileLinearStatuses()` returns immediately when `_calV2Ready()` (v2 trusts
   Supabase + realtime; the old pull made statuses "jump"). So opening the calendar no
   longer masks a dropped event.

2. **The backend reconciler is healthy but its schedule is throttled by GitHub.**
   - Merged to `main` 2026-06-16; **24 scheduled runs, all `success`**, warm ledger
     (`Cache hit … linear-reconcile-ledger-*`, 324 keys), `MODE: APPLY`.
   - Configured cadence: `cron: */10` (≈ every 10 min ⇒ ~470 runs over the window).
     **Actual: 24 runs over 78.2 h ⇒ avg gap 3.40 h** (several 5 h gaps) ⇒ only ~5% of
     ticks fired. This is the well-documented GitHub behaviour of delaying/skipping
     `schedule:` workflows under load.
   - The last run before the drop was **#24 at 11:50** — *before* 13:32 — so it simply
     has not had a turn since the drift appeared.

When it next runs it will pull **Linear→card** (Linear changed most recently; warm
ledger ⇒ unambiguous direction) and set `graphic_status = "For SMM Approval"`
(`_calMapLinearStatusStrict("For SMM approval") → "For SMM Approval"`), recomputing the
overall pill to **For SMM Approval** (lowest-priority sub among Client Approval / For SMM
Approval / Approved).

## Root-cause-worthy findings

1. **The guarantee layer rides an unreliable clock.** A 10-minute reconciler that
   actually fires every ~3.4 h means any dropped inbound event is user-visible for hours.
2. **Durability is asymmetric.** The **card→Linear** direction has a durable retry outbox
   (`syncview_linear_outbox_v1`, 6 retries, retries on load/focus/60 s). The
   **Linear→card** direction — the one that dropped here — has **no per-event durable
   retry**; it relies solely on Linear's own webhook retry + the periodic reconciler.

## Remediation

**Primary — run the reconciler on n8n's reliable scheduler (fixes the cadence).**
n8n's `scheduleTrigger` already fires dependably every 10 min in production (see
**"SyncView Workload — Reconcile"**, `lGwC9WWPVJtxphtf`). Add a tiny workflow:

> **"SyncView Calendar — Linear Reconcile Trigger"**
> `Schedule (every 10 min)` → `HTTP Request`:
> `POST https://api.github.com/repos/sidney-afk/client-analytics/actions/workflows/296618163/dispatches`
> body `{"ref":"main","inputs":{"dry_run":"false"}}`, auth = GitHub PAT (scope: `workflow`).

This keeps the **single source of truth** (the tested GitHub script, which extracts the
app's own mapping/overall-status functions from `index.html` at runtime) and only swaps
the flaky *cron scheduler* for n8n's reliable one. `workflow_dispatch` runs are not
subject to schedule throttling, so cadence becomes a true ~10 min. Keep the existing
GitHub `cron` as a free backstop.

**Alternative — native n8n reconcile (no secret).** Port `linear-sync-reconcile.js` into
an n8n `Code` node behind the 10-min `scheduleTrigger`: `httpRequest` the deployed
`index.html` (to extract the canonical functions), the Supabase `calendar_posts`, and the
`linear-issue-statuses` webhook; persist the ledger in `this.getWorkflowStaticData('global')`;
POST corrections to `calendar-upsert-post` / `linear-set-status`. Needs no secret (all
endpoints public + anon key) but duplicates logic (divergence risk vs. the GitHub script).

**Optional — visibility.** Post a Slack note whenever a run makes `corrections > 0`, so
dropped events become a tracked metric instead of a silent drift (already listed under
"Possible enhancements" in `LINEAR_SYNC_RECONCILE.md`).

## Immediate heal for Oprah 2 (one card)

Either:
- **GitHub Actions → "Linear ⇄ SyncView status reconcile" → Run workflow** with
  `dry_run = false`. The tested reconciler converges GRA-6373 → the card (and any other
  genuine drift; safety cap 15) in ~30 s, and persists the ledger. *(Recommended — the
  sanctioned path.)*
- Or a single scoped write to the safe upsert endpoint (the exact patch the app itself
  would produce):
  ```
  POST https://synchrosocial.app.n8n.cloud/webhook/calendar-upsert-post
  {"client":"jesseisrael","post":{"id":"p_mqfo6nbg_jgdv9","graphic_status":"For SMM Approval","status":"For SMM Approval"}}
  ```

## Investigation note

This write-up is from **read-only** investigation across Linear, n8n, Supabase (a `GET`),
and GitHub Actions. **No client data, Linear issue, n8n workflow, or Supabase row was
modified.** The two heal/remediation steps above are pending explicit authorization.
