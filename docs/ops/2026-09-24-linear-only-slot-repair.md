> **Superseded 2026-09-26:** the dry run found 0 slots to connect, so there is nothing to apply; kept as the script's record. See [STATE_OF_THINGS](../STATE_OF_THINGS.md).

# Linear-only Calendar slots: repair proposal (NOT APPLIED)

**Date:** 2026-09-24 · **Session:** Keel · **Status: NOT APPLIED.** Lighthouse
reviews and applies, test client first. Counts only; ids live in the local plan
file the script writes outside the repository.

## Why

Since Linear was retired, a Calendar card's video or thumbnail slot is linked
only by its own SyncView deliverable id. A slot that still holds an old Linear
URL but no deliverable id now reads as absent (the companion UI change: locked
N/A pill, SyncView's own "add the missing video/thumbnail", no Linear banners).
The question here: are any of those slots pointing at a Linear issue that
already exists in SyncView as a deliverable and just was never connected?

## Measured (read-only, 2026-09-24)

`node scripts/linear-only-slot-repair.js` against `calendar_posts` and
`production_deliverables_browser_v1`, publishable key, no writes.

| scope | video | thumbnail |
|---|---|---|
| Linear-only slots, not archived | 81 | 97 |
| current: not posted, dated 2026-08-25 or later | 3 | 1 |
| current, an existing deliverable could be connected (`exact`) | **0** | **0** |
| current, deliverable exists but is the other team (`mismatch`) | 1 | 0 |
| current, no SyncView deliverable for that Linear issue (`none`) | 2 | 1 |

The one `mismatch` is a card whose video slot holds the Linear link of its own
thumbnail deliverable, which is already connected to that card as its
thumbnail. Connecting it as the video would be wrong, so it is not proposed.

Widening to every date (still not posted, not archived): 22 slots, 0 `exact`,
1 `mismatch`, 21 `none`. 13 slots are undated and are never proposed. The test
client has 5 Linear-only slots, all undated, so none is current.

## Proposal

**Connect nothing today.** There is no existing deliverable to connect any
current slot to. The script is the repair. It proposes a slot only when exactly
one deliverable for that Linear issue has the slot's client and team, origin
`calendar`, and is unconnected or already this card's. Ambiguity is judged over
all such candidates, free or taken, and a free one with another origin is
`unbound` (it needs the full binding contract, not a card_id write). For each
proposal it writes, to its `--out` file only, one locked `do` block per slot
inside a single transaction. The block matches the card on its full key
(client and id), re-checks both rows, and raises, rolling the whole plan back,
unless both are still eligible, so a one-sided crosswalk cannot be produced.

The 3 current `none` slots have no work item behind them. Their path is the
card's "add the missing video/thumbnail" button, which now shows when the
other component of the card has a deliverable; otherwise Create Post.

## To apply (Lighthouse)

1. `node scripts/linear-only-slot-repair.js --client=<test client> --out=<file outside the repo>`
2. Review the plan; run its SQL only if it is non-empty and still correct.
3. Repeat without `--client`.
