# Why the B3 "zero" gate stopped reading zero — investigation, 2026-07-29

**Why this exists.** The scheduled Track-A/B3 health check reports
`diff_count / repair_list_size / linkage_actionable` and expects `0 / 0 / 0`. It has read
`4,262 / 27 / 2` since 2026-07-23, so the B4 seven-day clock never started. This is the
read-only investigation into what actually changed. **Nothing was fixed, no flag, secret,
workflow, or client row was touched.**

**Answer in one line:** the 4,262 is a cosmetic stamp counter and is not a health signal; the
**27 is a real regression** on the gate's own metric, and the outside-n8n alarm that should have
reported it **has never run**.

---

## 1. The 4,262 is stamp drift, not damage — cause proven

`compareAttribution` in `scripts/linear-deliverables-reconcile-lib.js` compares each row's
**stored** attribution object against a **freshly computed** one and flags any difference. Its
own reason string is `attribution_state_or_revision_mismatch` (line 253). The compared object
embeds `mapping_revision`, so a row whose stamp predates the current mapping counts as a diff
even when it names the correct client.

That function **did not exist before** commit `3730e42` "Implement Production attribution and
descriptions" (merged as **PR #920, 2026-07-23 19:15 UTC**) — verified by reading its parent
commit, where `compareAttribution` occurs zero times. The counter jumped inside exactly that
window:

| Reconcile summary (UTC) | diff_count | repair_list_size |
|---|---:|---:|
| 2026-07-23 17:47 | 9 | 0 |
| **PR #920 merges 19:15** | | |
| 2026-07-23 23:33 | 4,570 | 147 |
| 2026-07-29 13:29 | 4,267 | 27 |

The deliverable population did not move across the jump (4,519 → 4,519). Same rows, new
comparison.

**The reconciler's own attribution census confirms the rows are fine:**

| | |
|---|---:|
| issues resolving to the correct client | **4,535 of 4,562 (99.4%)** |
| `needs_attribution` | 25 |
| `provisional_child_family` | 2 |
| rows showing a diff | **4,262** |

If 4,262 rows genuinely had broken attribution, `needs_attribution` would read ~4,262. It reads
25. With `outbound_diff_count = 0`, healthy webhooks (2/2 enabled), and zero failure-like events
across `calendar_post_events`, `sample_review_events`, and `deliverable_events` in the sampled
12-hour windows, **no client is affected**.

**Correction to an earlier claim.** The 2026-07-29 00:00 health-check reply named `2ae3cc9`
"F200: apply roster attribution cleanup" as the prime suspect. That is wrong — `2ae3cc9` landed
**2026-07-24 17:26 UTC**, a day *after* the jump. PR #920 is the cause.

## 2. The 27 IS a real regression — and it is the part that blocks the gate

`B4_READINESS.md` row 1 keys the seven-day gate on **`repair_list_size`** and
**`outbound_diff_count`**, not on `inbound_diff_count`. Against that definition:

- `outbound_diff_count` = **0** ✅ (unchanged)
- `repair_list_size` = **27** ❌ — the same row records **`repair_list_size = 0` across all
  sampled runs for 8 consecutive days as of 2026-07-15**

So the gate's own metric went `0 → 147 → 27` on 2026-07-23 and has not returned to zero. That is
the genuine blocker; the 4,262 is noise sitting on top of it.

The 27 are all `client_attribution`, and they are bounded and nameable:

| reason | count |
|---|---:|
| `direct_project_unmapped` | 18 |
| `projectless_parent_unanimous_child_family` | 2 |
| (remainder within `needs_attribution` / `provisional_child_family`) | 7 |

`direct_project_unmapped` means a Linear project resolves to no active roster client — the same
family as the 2026-07-28 `linear_project_ids` fix, in the opposite direction (project → client
rather than client → project).

## 3. The outside-n8n inbound alarm has never run

`scripts/linear-reconcile-inbound-pager.js` pages when two consecutive scheduled runs report
`inbound_diff_count > 0`. That condition has held continuously since 2026-07-23. It has produced
nothing:

- the pager's marker ledger (`deliverable_events`, action `linear_reconcile_inbound_pager`) is
  **empty** — no marker has ever been written;
- on the 2026-07-29 11:40 UTC **scheduled** run, step 7 *"Page persistent inbound diffs outside
  n8n"* has conclusion **`skipped`**.

The workflow guards that step on `SLACK_ALERT_WEBHOOK` being configured
(`.github/workflows/linear-deliverables-reconcile.yml:81`) and emits a warning when it is not.
`MONITORING.md` already documents this as designed behaviour; what was not known is that the
secret is in fact absent, so the repository-hosted observer has **never** been active.

This matters beyond the current numbers. `MONITORING.md` also records that the remaining n8n
pager gives diff/repair/linkage **one shared two-summary rule with an hourly throttle**, so "a
first repair/linkage breach is quiet and one class can suppress another." With
`inbound_diff_count` permanently non-zero since 2026-07-23, that suppression risk is not
hypothetical — it is the standing condition, and it is exactly the F131/F132 "observer outside
n8n" requirement.

Had the repair count risen for a client-affecting reason instead of a cosmetic one, the design
intent was that somebody be told. Nobody would have been.

## 4. Capacity signal (minor, recorded)

The scheduled run at 2026-07-29 09:22 UTC failed with Postgres `57014 canceling statement due to
statement timeout` while reading `deliverable_events` in `loadLiveData`
(`linear-deliverables-reconcile.js:127`). One occurrence; the next scheduled run succeeded. A
failed run does fail loudly and reaches the owner by GitHub failed-run email, so this is not a
silent failure — but a reconciler read that is now brushing the statement timeout is worth
watching as that ledger grows.

---

## What this changes, and what needs an owner decision

**Established (no decision needed):**

- `inbound_diff_count` has been a stamp-age counter since 2026-07-23 and is not a health signal.
  A health check that demands it be `0` cannot pass, and waiting will not make it pass.
- The gate that matters — `B4_READINESS.md` row 1 — is blocked on `repair_list_size = 27`, not
  on the 4,262.

**Owner decisions, deliberately not taken here:**

1. **Set `SLACK_ALERT_WEBHOOK`** so the repository-hosted pager actually runs. One repository
   secret; no code change. Until then the only inbound observer is the n8n one that F131/F132
   says is insufficient.
2. **Re-key the pager off `inbound_diff_count`.** As written it would fire immediately and latch
   on a condition now known to be cosmetic, which is its own kind of dead alarm. Keying it to
   `repair_list_size` / `linkage_actionable` / `outbound_diff_count` would restore the signal —
   but that is a behaviour change to live monitoring and is not made unilaterally.
3. **Drain the 27 attribution repairs**, or record them as accepted with a dated reason. This is
   the only work standing between today and a truthful seven-day clock.

**No rollback is warranted.** Track A is healthy; `linear_inbound_enabled false` would break
working sync and fix none of the above.
