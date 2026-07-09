#!/usr/bin/env node

/*
 * Backfill stored Google Drive parent-folder URLs for existing thumbnails.
 *
 * Run after:
 *   1. the thumbnail parent-folder columns migration is applied
 *   2. the thumbnail-folder-resolve Edge Function is deployed
 *   3. GOOGLE_DRIVE_API_KEY is set as an Edge Function secret
 *      For parent folders that Google hides from API-key responses, also set
 *      GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY.
 *
 * Dry run:
 *   node scripts/backfill-thumbnail-parent-folders.js
 *
 * Apply:
 *   node scripts/backfill-thumbnail-parent-folders.js --apply
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';
const RESOLVE_URL = process.env.THUMBNAIL_FOLDER_RESOLVE_URL || `${SUPABASE_URL}/functions/v1/thumbnail-folder-resolve`;

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const SURFACE_ARG = valueArg('--surface');
const LIMIT = Number(valueArg('--limit') || 0);
const CONCURRENCY = Math.max(1, Number(valueArg('--concurrency') || 4));

const SURFACES = [
  { surface: 'calendar', table: 'calendar_posts' },
  { surface: 'samples', table: 'sample_reviews' },
].filter(x => !SURFACE_ARG || x.surface === SURFACE_ARG);

function valueArg(name) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find(x => x.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

function addScheme(url) {
  const s = String(url || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function isDriveFolderLink(url) {
  const u = String(url || '').trim();
  return /drive\.google\.com\/(?:drive\/)?(?:u\/\d+\/)?folders\//i.test(u)
    || /drive\.google\.com\/folderview\?/i.test(u);
}

function extractDriveFileId(input) {
  const raw = String(input || '').trim();
  if (!raw || isDriveFolderLink(raw)) return '';
  if (/^[A-Za-z0-9_-]{20,}$/.test(raw) && !raw.includes('/')) return raw;

  let url;
  try { url = new URL(addScheme(raw)); }
  catch (_e) { return ''; }

  if (!/(^|\.)drive\.google\.com$/i.test(url.hostname) && !/(^|\.)docs\.google\.com$/i.test(url.hostname)) return '';
  let m = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  m = url.pathname.match(/\/(?:document|spreadsheets|presentation|drawings|forms)\/d\/([A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  const id = url.searchParams.get('id');
  return id && /^[A-Za-z0-9_-]{20,}$/.test(id) ? id : '';
}

async function fetchRows(table, basicOnly = false) {
  const select = basicOnly
    ? 'client,id,thumbnail_url'
    : 'client,id,thumbnail_url,thumbnail_file_id,thumbnail_folder_url';
  const out = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 1000000; offset += pageSize) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=client.asc,id.asc&offset=${offset}&limit=${pageSize}`;
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
    });
    if (!resp.ok) {
      if (!basicOnly && resp.status === 400) return fetchRows(table, true);
      throw new Error(`${table} read failed: HTTP ${resp.status}`);
    }
    const rows = await resp.json();
    if (!Array.isArray(rows)) throw new Error(`${table} read failed: unexpected payload`);
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

function needsBackfill(row) {
  const url = String(row.thumbnail_url || '').trim();
  const fileId = extractDriveFileId(url);
  if (!fileId) return false;
  if (String(row.thumbnail_file_id || '') !== fileId) return true;
  return !String(row.thumbnail_folder_url || '').trim();
}

async function resolveOne(surface, row) {
  const resp = await fetch(RESOLVE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Syncview-Source': 'backfill' },
    body: JSON.stringify({
      surface,
      client: row.client,
      id: row.id,
      thumbnail_url: row.thumbnail_url,
    }),
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json.ok) throw new Error((json && json.error) || `HTTP ${resp.status}`);
  return json;
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  const results = [];
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

(async () => {
  if (!SURFACES.length) throw new Error(`Unknown --surface value: ${SURFACE_ARG}`);

  const candidates = [];
  for (const cfg of SURFACES) {
    const rows = await fetchRows(cfg.table);
    rows.filter(needsBackfill).forEach(row => candidates.push({ ...cfg, row }));
  }

  const limited = LIMIT > 0 ? candidates.slice(0, LIMIT) : candidates;
  console.log(`${APPLY ? 'Applying' : 'Dry run'} thumbnail-folder backfill`);
  console.log(`Candidates: ${candidates.length}${LIMIT > 0 ? `, limited to ${limited.length}` : ''}`);

  if (!APPLY) {
    limited.slice(0, 20).forEach(x => {
      console.log(`${x.surface}\t${x.row.client}\t${x.row.id}\t${extractDriveFileId(x.row.thumbnail_url)}`);
    });
    if (limited.length > 20) console.log(`...and ${limited.length - 20} more`);
    console.log('Run with --apply to write folder metadata.');
    return;
  }

  let resolved = 0;
  let noParent = 0;
  let failed = 0;
  const results = await mapLimit(limited, CONCURRENCY, async (item) => {
    const json = await resolveOne(item.surface, item.row);
    return { item, json };
  });

  results.forEach((result, i) => {
    const item = limited[i];
    if (result && result.ok) {
      const fields = result.value.json.fields || {};
      const folder = String(fields.thumbnail_folder_url || '').trim();
      if (folder) {
        resolved++;
        console.log(`resolved\t${item.surface}\t${item.row.client}\t${item.row.id}\t${folder}`);
      } else {
        noParent++;
        console.log(`no-parent\t${item.surface}\t${item.row.client}\t${item.row.id}`);
      }
    } else {
      failed++;
      console.log(`fail\t${item.surface}\t${item.row.client}\t${item.row.id}\t${result.error.message}`);
    }
  });

  console.log(`Done. resolved=${resolved} no_parent=${noParent} failed=${failed}`);
  if (failed) process.exitCode = 1;
})().catch(err => {
  console.error(err && err.stack || err);
  process.exit(1);
});
