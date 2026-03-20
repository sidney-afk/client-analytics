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
// FIX: Accumulate ig_views_gained_today into a running
// monthly total. On the 1st of a new month, reset to just
// today's gains. This makes ig_views_this_month a true
// cumulative counter of views gained within the month.
// ============================================================

let allRows = [];
try { allRows = $('Get Previous Rows').all(); } catch(e) { allRows = []; }

const mergedData = $('Restore Gains').first().json;

const ig_views_gained_today = mergedData.ig_views_gained_today ?? 0;
const tiktok_plays_gained_today = mergedData.tiktok_plays_gained_today ?? 0;

// --- Accumulate monthly totals from previous row ---
const todayStr = new Date().toISOString().split('T')[0];
const thisMonth = todayStr.substring(0, 7); // "YYYY-MM"

let prevIgViewsThisMonth = 0;
let prevTiktokPlaysThisMonth = 0;

if (allRows.length > 0) {
  // Find the most recent row BEFORE today
  const prevRows = allRows
    .map(r => r.json)
    .filter(r => r.date && r.date < todayStr)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (prevRows.length > 0) {
    const prev = prevRows[0];
    // Only carry forward if same month; new month resets to 0
    if (prev.date.substring(0, 7) === thisMonth) {
      prevIgViewsThisMonth = Number(prev.ig_views_this_month ?? 0);
      prevTiktokPlaysThisMonth = Number(prev.tiktok_plays_this_month ?? 0);
    }
  }
}

const ig_views_this_month = prevIgViewsThisMonth + ig_views_gained_today;
const tiktok_plays_this_month = prevTiktokPlaysThisMonth + tiktok_plays_gained_today;

return [{
  json: {
    ...mergedData,
    ig_views_gained_today,
    tiktok_plays_gained_today,
    ig_views_this_month,
    tiktok_plays_this_month
  }
}];
