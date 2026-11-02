'use strict';
/*
 * The live check for frameio-view's folder list (plan row F1, used by V2's Frame import), run by hand from
 * .github/workflows/frameio-list-live-check.yml. Read-only: nothing is written anywhere.
 *
 *   1. trial-reels read (a staff key) gives the test-client card's version link (the letter asked for, else the card's
 *      own version);
 *   2. frameio-view part "list" lists that share;
 *   3. frameio-view part "video" looks up the first listed video that is not processing, by its own link, and the
 *      answer must name that same file (F0: a file link plays that file, never the folder's first video).
 *
 * Prints only counts and true/false (summarize): never an address, an id, a name or a key. The repository and its CI
 * logs are public.
 *
 * Env: SYNCVIEW_STAFF_KEY (a staff role key), LIVE_CHECK_CARD (a test-client trial card id), LIVE_CHECK_LETTER
 *      (optional, A to G).
 */
const SUPA = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const TEST_CLIENT = 'sidneylaruel';

/** The only things that may reach the log: counts, true/false, HTTP statuses and a refusal code. */
function summarize(list, video) {
  const out = { list_http_status: list ? list.status : 0, list_ok: !!(list && list.json && list.json.ok === true) };
  if (!out.list_ok) {
    const code = list && list.json && typeof list.json.error === 'string' ? list.json.error.replace(/[^a-z_]/g, '').slice(0, 40) : 'request_failed';
    return Object.assign(out, { list_error: code });
  }
  const rows = Array.isArray(list.json.videos) ? list.json.videos : [];
  Object.assign(out, {
    rows: rows.length,
    rows_with_duration: rows.filter((r) => Number(r.duration_seconds) > 0).length,
    rows_with_thumbnail: rows.filter((r) => typeof r.thumbnail_url === 'string' && /^https:\/\//.test(r.thumbnail_url)).length,
    rows_processing: rows.filter((r) => r.processing === true).length,
    truncated: list.json.truncated === true,
  });
  const first = rows.find((r) => !r.processing);
  if (!first || !video) return Object.assign(out, { video_same_file: null });
  const got = video.json && video.json.video && video.json.video.file_id;
  return Object.assign(out, { video_http_status: video.status, video_same_file: !!got && got === first.file_id });
}

async function call(fn, key, body) {
  const resp = await fetch(SUPA + '/functions/v1/' + fn, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Syncview-Key': key }, body: JSON.stringify(body),
  });
  return { status: resp.status, json: await resp.json().catch(() => null) };
}

async function main() {
  const key = String(process.env.SYNCVIEW_STAFF_KEY || '').trim();
  const card = String(process.env.LIVE_CHECK_CARD || '').trim();
  const letter = String(process.env.LIVE_CHECK_LETTER || '').trim().toUpperCase();
  if (!key || !card) { console.error('Set SYNCVIEW_STAFF_KEY and LIVE_CHECK_CARD.'); process.exit(2); }
  const read = await call('trial-reels', key, { action: 'read', client: TEST_CLIENT, post_id: card });
  const versions = (read.json && Array.isArray(read.json.versions)) ? read.json.versions : [];
  const v = letter ? versions.find((x) => x.letter === letter) : (versions.find((x) => x.on_card) || versions[0]);
  if (!v || !v.frame_url) {
    console.log('frameio list live check: ' + JSON.stringify({ read_http_status: read.status, version_found: false }));
    process.exit(1);
  }
  const list = await call('frameio-view', key, { link: v.frame_url, part: 'list' });
  const rows = (list.json && Array.isArray(list.json.videos)) ? list.json.videos : [];
  const first = rows.find((r) => !r.processing);
  const video = first ? await call('frameio-view', key, { link: first.link, part: 'video' }) : null;
  const summary = summarize(list, video);
  console.log('frameio list live check: ' + JSON.stringify(summary));
  process.exit(summary.list_ok && summary.video_same_file === true ? 0 : 1);
}

if (require.main === module) main().catch((e) => { console.error('frameio list live check failed:', e && e.name); process.exit(1); });
module.exports = { summarize };
