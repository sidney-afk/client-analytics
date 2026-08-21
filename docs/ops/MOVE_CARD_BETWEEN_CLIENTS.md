# Moving a calendar card between clients

**Created 2026-08-21**, when three DJ videos filed under Kasper Hytonen needed
to live on the Dj Kasper calendar. There is deliberately no button for this:
"Move to project" in the Production tab is read-only, and nothing else in the
app rewrites a card's client.

## Why it is four moves, not one

A card is four layers wearing one trench coat, and each one names the client:

| layer | column | who reads it |
|---|---|---|
| `calendar_posts` | `client` | the calendar itself |
| `deliverables` (×2) | `client_slug` | the Production tab, reconcilers, audits |
| `batches` | `client_slug` | Production grouping, Create Post "previous batch" |
| Linear issues | project | Linear, Workload, attribution audit |

Updating only the card moves it visually and leaves every other layer claiming
the old client. That disagreement is not cosmetic: it is the same shape as the
2026-08-20 `batch_parent_mapping` incident, and the attribution audit flags it.

## The procedure

1. **Dry run** (prints the full plan, writes nothing):

   ```
   node scripts/move-card-client.js --cards=<id,id,...> --to=<target-slug>
   ```

2. Read the plan. It refuses outright if the target has no `public.clients`
   row, if a deliverable already disagrees with its own card, or (on apply) if
   the target has no Linear project mapped for a needed team.

3. **Apply**: same command with `APPLY=true`. Cards, deliverables, and batches
   move atomically per card and are re-read for verification.

4. **Move the Linear issues** — the script prints exactly which issues go to
   which project id. Do this within minutes of the apply: until both sides
   agree, the shadow audit reports the disagreement. (Ask Claude, or drag them
   in Linear.)

## What the script deliberately does

- The moved deliverables land in a **new batch owned by the target**, with an
  **empty** `linear_parent_ids`. Copying the source batch's parents would make
  a later "add to previous batch" file new work under the SOURCE client's
  Linear project. Empty means the picker refuses appends with the batch-shaped
  message until someone starts a fresh batch — honest, and cheap.
- `deliverables` updates are audited automatically by the ledger trigger.
- It never touches Linear links, statuses, ordering, or n8n.

## What it does not do

- Sample cards (`sample_reviews`) — calendar cards only, extend when needed.
- Anything in Google Sheets, Drive folders, Slack, or Roam.
