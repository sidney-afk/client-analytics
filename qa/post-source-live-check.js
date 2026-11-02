'use strict';
/*
 * The live check for post-source (plan row F4, OPEN_REPAIRS 649), run by hand from
 * .github/workflows/post-source-live-check.yml. One call copies one test-client card's video from Frame.io into
 * Post for Me storage: storage only, no post is ever created (D6). It then opens the returned storage address once
 * (a one-byte range read) and prints only the measured numbers: which Frame file went, its size, shape and length,
 * how long the copy took, and whether the address answers. Never an address, a file name or a key: the repository
 * and its CI logs are public. An unattached upload is deleted by Post for Me after 24 hours.
 *
 * Env: SYNCVIEW_STAFF_KEY (a staff role key), POST_SOURCE_CARD (the card id), POST_SOURCE_LETTER (optional, B..G),
 *      POST_SOURCE_SIDE (optional, instagram or tiktok).
 */
const SUPA = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const TEST_CLIENT = 'sidneylaruel';

// The only fields that may reach the log.
const SAFE = ['ok', 'error', 'rendition', 'fell_back_from_original', 'bytes', 'width', 'height', 'duration_seconds', 'took_ms'];
function safeSummary(answer) {
  const a = answer && typeof answer === 'object' ? answer : {};
  const out = {};
  for (const k of SAFE) if (k in a) out[k] = a[k];
  return out;
}

async function main() {
  const key = String(process.env.SYNCVIEW_STAFF_KEY || '').trim();
  const card = String(process.env.POST_SOURCE_CARD || '').trim();
  if (!key || !card) { console.error('Set SYNCVIEW_STAFF_KEY and POST_SOURCE_CARD.'); process.exit(2); }
  const body = { client: TEST_CLIENT, post_id: card, letter: String(process.env.POST_SOURCE_LETTER || '').trim(), side: String(process.env.POST_SOURCE_SIDE || 'instagram').trim() };
  const started = Date.now();
  const resp = await fetch(SUPA + '/functions/v1/post-source', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Syncview-Key': key }, body: JSON.stringify(body),
  });
  const answer = await resp.json().catch(() => ({}));
  const summary = { http_status: resp.status, ...safeSummary(answer), wall_ms: Date.now() - started };
  if (answer && answer.ok && answer.media_url) {
    const check = await fetch(answer.media_url, { headers: { Range: 'bytes=0-0' } }).catch(() => null);
    summary.storage_status = check ? check.status : 0;
    summary.storage_type = check ? String(check.headers.get('content-type') || '') : '';
    const range = check ? String(check.headers.get('content-range') || '') : '';
    summary.storage_bytes = Number(range.split('/')[1]) || null;
    summary.storage_matches_size = summary.storage_bytes === answer.bytes;
  }
  console.log('post-source live check: ' + JSON.stringify(summary));
  const good = !!(answer && answer.ok) && [200, 206].includes(summary.storage_status) && summary.storage_matches_size;
  process.exit(good ? 0 : 1);
}

if (require.main === module) main().catch((e) => { console.error('post-source live check failed:', e && e.name); process.exit(1); });
module.exports = { safeSummary, SAFE };
