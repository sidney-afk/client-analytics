// ============================================================
// FIXED: Compute Post Gains node (CLIENTS METRICS workflow)
// ============================================================
// BUG: First-day posts had gained = 0, meaning the initial
// burst of views on a new/viral post was never counted.
//
// FIX: For first-seen posts that were published within the last
// 48 hours, use their current view count as today's gain
// (since they're brand new, most views are recent).
// For older first-seen posts, still use 0 (we can't know
// the daily gain for a post discovered late).
// ============================================================

let newPosts = [];
try { newPosts = $('Update Post Tracking').all().map(i => i.json); } catch(e) {}

let existingPosts = [];
try { existingPosts = $('Read Post Tracking').all().map(i => i.json); } catch(e) {}

const existingMap = {};
existingPosts.forEach(p => {
  existingMap[String(p.post_id).trim()] = p;
});

let ig_views_gained_today = 0;
let tiktok_plays_gained_today = 0;

const now = new Date();

const updatedRows = newPosts.map(p => {
  const existing = existingMap[String(p.post_id).trim()];
  const viewsYesterday = existing ? Number(existing.views_today ?? 0) : 0;
  const viewsToday = Number(p.views_today ?? 0);
  const isFirstDay = !existing;

  let gained;
  if (isFirstDay) {
    // For brand-new posts (published within last 48h), count current views
    // as today's gain since most of those views are recent.
    // For older posts we're seeing for the first time, use 0.
    const firstSeen = new Date(p.first_seen_date);
    const ageHours = (now - firstSeen) / (1000 * 60 * 60);
    gained = ageHours <= 48 ? viewsToday : 0;
  } else {
    gained = Math.max(0, viewsToday - viewsYesterday);
  }

  if (p.platform === 'instagram') ig_views_gained_today += gained;
  if (p.platform === 'tiktok') tiktok_plays_gained_today += gained;

  return {
    post_id: String(p.post_id).trim(),
    client_name: p.client_name,
    platform: p.platform,
    first_seen_date: existing ? existing.first_seen_date : p.first_seen_date,
    views_yesterday: viewsYesterday,
    views_today: viewsToday,
    views_gained_today: gained
  };
});

return [{
  json: {
    updatedRows,
    ig_views_gained_today,
    tiktok_plays_gained_today
  }
}];
