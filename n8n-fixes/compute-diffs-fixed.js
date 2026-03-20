// ============================================================
// FIXED: Compute Diffs node (CLIENTS METRICS workflow)
// ============================================================
// BUG: ig_views_this_month was set to ig_total_post_views,
// which is the sum of LIFETIME view counts on the latest ~30
// posts returned by Apify. This is NOT monthly views.
//
// When a viral video scrolls out of the latest 30 posts,
// its views vanish from the total. The weekly calculation
// (today - 7_days_ago) was subtracting two meaningless
// snapshots, producing incorrect weekly view numbers.
//
// FIX: Accumulate ig_views_gained_today into a cumulative
// running total that never resets. The dashboard computes
// rolling 30-day and 7-day deltas by subtracting the
// cumulative value from N days ago.
// ============================================================

let allRows = [];
try { allRows = $('Get Previous Rows').all(); } catch(e) { allRows = []; }

const mergedData = $('Restore Gains').first().json;

const ig_views_gained_today = mergedData.ig_views_gained_today ?? 0;
const tiktok_plays_gained_today = mergedData.tiktok_plays_gained_today ?? 0;

// --- Accumulate into a cumulative running total (never resets) ---
const todayStr = new Date().toISOString().split('T')[0];

let prevIgViews = 0;
let prevTiktokPlays = 0;

if (allRows.length > 0) {
  // Find the most recent row BEFORE today
  const prevRows = allRows
    .map(r => r.json)
    .filter(r => r.date && r.date < todayStr)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (prevRows.length > 0) {
    prevIgViews = Number(prevRows[0].ig_views_this_month ?? 0);
    prevTiktokPlays = Number(prevRows[0].tiktok_plays_this_month ?? 0);
  }
}

// Cumulative: previous total + today's gain
const ig_views_this_month = prevIgViews + ig_views_gained_today;
const tiktok_plays_this_month = prevTiktokPlays + tiktok_plays_gained_today;

return [{
  json: {
    ...mergedData,
    ig_views_gained_today,
    tiktok_plays_gained_today,
    ig_views_this_month,
    tiktok_plays_this_month
  }
}];
