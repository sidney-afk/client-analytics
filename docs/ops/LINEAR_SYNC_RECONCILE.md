# Linear ⇄ SyncView status reconciler

Keeps each post's **video** and **graphic (thumbnail)** sub-status in agreement
with its linked Linear issue, automatically and in both directions.

## The problem it solves

Status changes flow both ways through best-effort webhooks:

- **Linear → card** — editors and graphic designers work *in Linear* and move the
  review lifecycle (In Progress → For SMM → For Client/Kasper → Approved; Tweak
  Needed as the interrupt). An n8n webhook mirrors that onto the card.
- **card → Linear** — the SMM and the client work *in SyncView* (approvals,
  scheduling, posting). Another webhook mirrors that onto Linear.

Webhooks occasionally drop a delivery. When that happens the change lands on one
side and the other side is left **silently stale** — and there was no safety net,
so the drift persisted until someone happened to touch the card again. (That's the
"card says Tweaks Needed but Linear says For SMM approval" bug.)

## The principle (2026 best practice)

> Don't try to make message delivery perfect — make **reconciliation** the
> backbone. Events are the *fast path*; a periodic reconciler is the *guarantee*.

And critically: **neither system is the universal source of truth.** Truth is
*whichever side changed most recently* — because real changes legitimately
originate on both sides. "Linear always wins" would, for example, silently undo a
client approval whose push to Linear was the delivery that dropped.

## How it works

`scripts/linear-sync-reconcile.js`, run every ~10 min by
`.github/workflows/linear-sync-reconcile.yml`:

1. Reads every (non-archived) linked card from Supabase and resolves the current
   state of every linked Linear issue (one batched call).
2. For each card-component, compares the card status to the Linear status, using
   `index.html`'s **own** mapping/overall-status functions (extracted at runtime,
   so this can never fall out of step with the app).
3. If they disagree, **most-recent-action-wins** decides the direction:
   - a small **ledger** records, per component, the status last seen on each side
     and *when it changed* (to polling granularity);
   - the side whose value changed more recently is written onto the other;
   - near-concurrent changes tie-break to: **a Tweaks-Needed request never loses**,
     otherwise the more-advanced lifecycle state wins.
4. Writes go only through the existing safe endpoints — `calendar-upsert-post`
   (card; also recomputes the overall pill and clears stale approval stamps, just
   like the UI) and `linear-set-status` (Linear; team-aware — it silently skips a
   state a team doesn't have).

It touches **no** website code and **no** database schema, and needs **no
secrets** (the endpoints are public and the Supabase key is the already-public
anon key shipped in `index.html`).

## Safety

- **Safety cap** — if a single run wants to make more than `CAP` (default 15)
  corrections it **aborts without writing**. A mass divergence means a bulk
  dropped event or a bug; a human should look before hundreds of rows move.
- **Archived** cards are skipped; **unmapped** Linear states (Canceled/Triage/…)
  are never propagated; **Posted/Scheduled** and other forward states are never
  regressed unless Linear genuinely changed more recently.
- Idempotent and convergent — running it repeatedly is a no-op once in sync.

## Running it

```bash
node scripts/linear-sync-reconcile.js            # dry-run: report only, no writes
node scripts/linear-sync-reconcile.js --apply    # apply corrections + persist ledger
CAP=40 node scripts/linear-sync-reconcile.js --apply   # raise the cap (e.g. a known backlog)
```

In CI the ledger persists between runs via the Actions cache (`.sync-ledger/`).

## Activation

`schedule:` triggers only fire from the repository's **default branch**, so the
timer goes live once this is merged. Until then (or any time) run it manually from
the **Actions → Linear ⇄ SyncView status reconcile → Run workflow** button — keep
*dry_run* checked to preview first.

## Possible enhancements

- **Exact write-time timestamps.** The ledger currently times changes to polling
  granularity. Adding `video_status_at` / `graphic_status_at` columns (written
  whenever a status changes) would make "most recent" exact rather than
  poll-rounded. Additive, but needs a Supabase migration.
- **Alerting.** Post a Slack note when the reconciler has to correct something, so
  dropped events become a visible metric (needs a Slack webhook secret).
- **Data hygiene.** A few posts have duplicate cards pointing at the same Linear
  issue; they're force-converged together (correct, but worth de-duping).
