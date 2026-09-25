// Shared, dependency-free logic for the Sheets -> Supabase mirror
// (docs/plans/2026-09-24-sheets-to-supabase.md, Phase 1). Used by the
// analytics-read and analytics-write Edge Functions and by
// scripts/sheets-mirror-backfill.js, and unit-tested in Node
// (test/sheets-mirror-policy.js). No Deno or Node APIs beyond Web Crypto.

export const TOP_VIDEOS_DAYS = 90; // owner, 2026-09-25: older rows stay stored, never sent
export const MAX_ROWS_PER_CALL = 5000;
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

// Column lists are the Sheet headers, in Sheet order (read 2026-09-25).
export const DATASETS = Object.freeze({
  client_profiles: {
    table: 'client_profiles',
    sheet: 'Clients Info',
    columns: ['client_name', 'email', 'competitors', 'keywords', 'specific_keywords', 'content_description',
      'instagram_handle', 'tiktok_handle', 'youtube_channel_id', 'slack_channel_id', 'creative_channel_id',
      'roam_channel_id', 'upload_post_profile', 'postforme_account_id'],
    key: 'slug',
  },
  metrics: {
    table: 'analytics_metrics',
    sheet: 'Metrics',
    columns: ['date', 'client_name', 'ig_followers', 'ig_avg_views', 'ig_avg_likes', 'tiktok_followers',
      'tiktok_avg_plays', 'yt_subscribers', 'yt_total_views', 'ig_views_gained_today', 'tiktok_plays_gained_today',
      'ig_views_this_month', 'tiktok_plays_this_month', 'yt_views_gained_today', 'yt_shorts_views', 'yt_longs_views',
      'analytics_receipt'],
    dateColumn: 'date',
    key: 'hash',
  },
  top_videos: {
    table: 'analytics_top_videos',
    sheet: 'TopVideos',
    columns: ['scraped_date', 'client_name', 'platform', 'period', 'rank', 'caption', 'video_url', 'views', 'likes',
      'comments', 'shares'],
    dateColumn: 'scraped_date',
    key: 'hash',
  },
  market_research_briefs: {
    table: 'analytics_market_research_briefs',
    sheet: 'Market Research Briefs',
    columns: ['id', 'client_name', 'date', 'raw_json', 'raw_json_2', 'raw_json_3'],
    key: 'id',
  },
  content_summaries: {
    table: 'analytics_content_summaries',
    sheet: 'ContentSummaries',
    columns: ['date', 'client_name', 'bullets'],
    key: 'hash',
  },
});

// Profile fields a client's own link may see. Staff see every column.
// content_description is the "About this client" text the client's own page
// already shows them from the Sheet.
export const CLIENT_LINK_PROFILE_FIELDS = Object.freeze(['slug', 'display_name', 'instagram_handle',
  'tiktok_handle', 'youtube_channel_id', 'content_description']);

export const WRITE_SOURCES = Object.freeze(['n8n', 'sheet-copy', 'sheet-backfill']);

function clean(v) {
  return String(v == null ? '' : v).trim();
}

// Same rule as client-token-verify and the page's wlNormalizeClient.
export function clientSlug(name) {
  let t = clean(name).toLowerCase();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_e) { /* keep as is */ }
  t = t.replace(/^dr\.?\s+/, '');
  t = t.replace(/\s+(?:and|&)\s+/g, '&');
  return t.replace(/[^a-z0-9&]+/g, '');
}

export function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function topVideosCutoff(now = new Date(), days = TOP_VIDEOS_DAYS) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// The fingerprint of a row: its dataset plus every known column's trimmed
// value, in Sheet order. Unknown columns do not change a row's identity.
export function rowHash(dataset, row) {
  const spec = DATASETS[dataset];
  if (!spec) throw new Error('unknown_dataset');
  return sha256Hex(JSON.stringify([dataset, ...spec.columns.map(c => clean(row[c]))]));
}

// Turn caller rows into database records. Returns { records, rejected }.
// row_occurrence = identical rows already stored by OTHER calls
// (priorCounts: row_hash -> count, from rows whose (run_id, run_part) differs
// from this call's) + the row's place among identical rows in this call. So a
// real repeat arriving in a later n8n run is kept, and a retry of the same
// call lands on the same keys. The backfill instead passes its own sheet-wide
// `_occurrence`, which matches what n8n assigned for the same Sheet rows.
/**
 * @param {string} dataset
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ source: string, runId: string, runPart?: number, priorCounts?: Map<string, number> | null }} opts
 */
export async function prepareRows(dataset, rows, { source, runId, runPart = 0, priorCounts = null }) {
  const spec = DATASETS[dataset];
  if (!spec) throw new Error('unknown_dataset');
  const records = [];
  const rejected = [];
  const seen = new Map();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] && typeof rows[i] === 'object' ? rows[i] : {};
    const name = clean(row.client_name);
    const slug = clientSlug(name);
    if (!slug) { rejected.push({ index: i, reason: 'missing_client' }); continue; }
    if (spec.dateColumn && !isIsoDate(clean(row[spec.dateColumn]))) {
      rejected.push({ index: i, reason: 'bad_date' });
      continue;
    }
    const extra = {};
    for (const [k, v] of Object.entries(row)) {
      if (k && !k.startsWith('_') && !spec.columns.includes(k) && clean(v) !== '') extra[k] = String(v);
    }
    const hash = await rowHash(dataset, row);
    if (spec.key === 'slug') {
      const rec = { slug, display_name: name, extra, row_hash: hash };
      for (const c of spec.columns) if (c !== 'client_name') rec[c] = clean(row[c]) || null;
      records.push(rec);
      continue;
    }
    const rec = { client_slug: slug, client_name: name, extra, row_hash: hash, source, run_id: runId };
    if (spec.key === 'hash') rec.run_part = runPart;
    for (const c of spec.columns) if (c !== 'client_name') rec[c] = clean(row[c]) || null;
    if (spec.key === 'id') {
      if (!clean(row.id)) { rejected.push({ index: i, reason: 'missing_id' }); continue; }
      rec.id = clean(row.id);
    } else {
      const n = (seen.get(hash) || 0) + 1;
      seen.set(hash, n);
      const given = Number(row._occurrence);
      const prior = priorCounts && priorCounts.get(hash) || 0;
      rec.row_occurrence = source === 'sheet-backfill' && Number.isInteger(given) && given >= 1 ? given : prior + n;
    }
    records.push(rec);
  }
  return { records, rejected };
}

// Parse RFC 4180 CSV (quoted fields, doubled quotes, newlines inside quotes)
// into objects keyed by header. Empty header cells are dropped.
export function parseCsv(text) {
  const out = [];
  let row = [];
  let field = '';
  let q = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      out.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); out.push(row); }
  const header = (out.shift() || []).map(h => h.trim());
  return out
    .filter(r => r.some(v => v !== ''))
    .map(r => {
      const o = {};
      header.forEach((h, idx) => { if (h) o[h] = r[idx] == null ? '' : r[idx]; });
      return o;
    });
}

// Give each row its sheet-wide occurrence, so identical rows sent across
// several backfill calls keep distinct keys.
export async function annotateSheetOccurrences(dataset, rows) {
  const seen = new Map();
  const outRows = [];
  for (const row of rows) {
    const hash = await rowHash(dataset, row);
    const n = (seen.get(hash) || 0) + 1;
    seen.set(hash, n);
    outRows.push({ ...row, _occurrence: n });
  }
  return outRows;
}

// The hashes whose earlier copies the writer must count before calling
// prepareRows (hash-keyed datasets only).
export async function rowHashes(dataset, rows) {
  const out = new Set();
  for (const row of rows) out.add(await rowHash(dataset, row && typeof row === 'object' ? row : {}));
  return [...out];
}

export function profileForClientLink(profile) {
  if (!profile) return null;
  const out = {};
  for (const k of CLIENT_LINK_PROFILE_FIELDS) out[k] = profile[k] == null ? null : profile[k];
  return out;
}
