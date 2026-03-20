# N8N Workflow Fixes — CLIENTS METRICS (Q4n1bagJYBkurEaI)

## Problem
ViewSync metrics for Instagram views are wrong:
- **Daily views** undercount because the first day a post is seen, its gains are set to 0
- **`ig_views_this_month`** is NOT monthly views — it's the sum of lifetime views on the latest ~30 posts from Apify
- **Weekly views** are wrong because the weekly delta subtracts two unreliable snapshot values

### Example (Baya)
- Baya had a 1M-view viral video, but it barely registered (~200-300K)
- Once the viral video scrolled out of the latest 30 posts, its views vanished entirely
- Weekly views showed ~590K instead of the real 1M+ total

## Root Cause
Two bugs in the CLIENTS METRICS N8N workflow:

### Bug 1: `Compute Diffs` node
```javascript
// BROKEN: uses sum of lifetime views on latest ~30 posts
const ig_views_this_month = mergedData.ig_total_post_views ?? 0;
```
This value changes when posts enter/leave the latest 30, making it useless for delta calculations.

### Bug 2: `Compute Post Gains` node
```javascript
// BROKEN: first-day views are always 0
const gained = isFirstDay ? 0 : Math.max(0, viewsToday - viewsYesterday);
```
New viral posts get their initial view burst zeroed out.

## Fix Instructions
Replace the JavaScript code in these two N8N nodes:

1. **`Compute Post Gains`** → Replace with `compute-post-gains-fixed.js`
2. **`Compute Diffs`** → Replace with `compute-diffs-fixed.js`

### What the fixes do:
- **Compute Post Gains**: For posts published within the last 48 hours that are seen for the first time, counts their current views as today's gain (since most views on a brand-new post are recent)
- **Compute Diffs**: Accumulates `ig_views_gained_today` into a proper running monthly total instead of using the unreliable snapshot. Resets at the start of each new month.

## After Applying
- The weekly views calculation in the dashboard (`today.ig_views_this_month - weekRow.ig_views_this_month`) will now work correctly since the underlying data is a true cumulative counter
- Daily views will properly capture initial viral post views
- Historical data in the sheet will still have old (incorrect) values; the fix is forward-looking
