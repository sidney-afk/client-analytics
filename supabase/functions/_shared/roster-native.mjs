// Shared, dependency-free logic for the roster doors (roster-read, roster-write)
// and the read-only Sheet copy (docs/plans/2026-10-02-roster-native.md). Pure
// functions only: nothing here talks to Google or Supabase, so test/roster-native.js
// can run every rule in Node. Same module style as sheets-mirror.mjs.
import { clientSlug } from './sheets-mirror.mjs';

export { clientSlug };

// The Clients Info Sheet header, in the live order (read 2026-10-01). The
// column that is not a real client_profiles column lives in extra.
export const CLIENT_HEADERS = Object.freeze([
  'client_name', 'email', 'competitors', 'keywords', 'specific_keywords', 'content_description',
  'instagram_handle', 'tiktok_handle', 'youtube_channel_id', 'slack_channel_id', 'creative_channel_id',
  'roam_channel_id', 'upload_post_profile', 'postforme_account_id', 'postforme_instagram_account_id',
]);
export const PROFILE_COLUMNS = Object.freeze([
  'email', 'competitors', 'keywords', 'specific_keywords', 'content_description',
  'instagram_handle', 'tiktok_handle', 'youtube_channel_id', 'slack_channel_id', 'creative_channel_id',
  'roam_channel_id', 'upload_post_profile', 'postforme_account_id',
]);
export const EXTRA_FIELDS = Object.freeze(['postforme_instagram_account_id']);
export const WRITABLE_FIELDS = Object.freeze([...PROFILE_COLUMNS, ...EXTRA_FIELDS]);

// The Social Media Managers tab: one row per client. linear_api_key is gone
// on purpose (Linear is cancelled); nothing here ever reads or writes it.
export const SMM_HEADERS = Object.freeze(['client_name', 'social_media_manager', 'slack_profile_url']);

export const MAX_FIELD_CHARS = 20000;
export const MIN_KEY_CHARS = 32;

function text(v) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim();
}

// Validates { field: value } from a caller. Unknown fields are refused, not
// dropped, so a typo can never look like a successful save. Splits the result
// into real columns and extra fields. A blank string means "clear".
export function normalizeFields(raw, { allowEmpty = false } = {}) {
  if (raw == null && allowEmpty) return { ok: true, columns: {}, extra: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'bad_fields' };
  const columns = {};
  const extra = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!WRITABLE_FIELDS.includes(k)) return { ok: false, error: 'field_not_writable', field: k };
    if (v != null && typeof v !== 'string' && typeof v !== 'number') return { ok: false, error: 'bad_value', field: k };
    const t = text(v);
    if (t.length > MAX_FIELD_CHARS) return { ok: false, error: 'value_too_long', field: k };
    (EXTRA_FIELDS.includes(k) ? extra : columns)[k] = t;
  }
  if (!allowEmpty && !Object.keys(columns).length && !Object.keys(extra).length) return { ok: false, error: 'no_fields' };
  return { ok: true, columns, extra };
}

// The caller names a client by slug or by the name the Sheet uses.
export function resolveClient(body) {
  const b = body || {};
  const name = text(b.client_name);
  const slug = clientSlug(b.slug || name);
  if (!slug) return { ok: false, error: 'missing_client' };
  return { ok: true, slug, name };
}

// One client_profiles row as a Sheet row: every header, in text.
export function profileToSheetObject(row) {
  const r = row || {};
  const extra = r.extra && typeof r.extra === 'object' ? r.extra : {};
  const out = { client_name: text(r.display_name) };
  for (const h of PROFILE_COLUMNS) out[h] = text(r[h]);
  for (const h of EXTRA_FIELDS) out[h] = text(extra[h]);
  return out;
}

// Per-client manager rows from the managers table. A client appears once per
// manager list it is on (the database keeps it to one). Inactive managers are
// skipped.
export function managerRows(managers) {
  const rows = [];
  for (const m of Array.isArray(managers) ? managers : []) {
    if (!m || m.active === false) continue;
    const list = Array.isArray(m.source_clients) ? m.source_clients : [];
    for (const c of list) {
      const name = text(c);
      if (!name) continue;
      rows.push({
        client_name: name,
        social_media_manager: text(m.name),
        slack_profile_url: text(m.slack_profile_url),
        email: text(m.email),
      });
    }
  }
  rows.sort((a, b) => a.client_name.localeCompare(b.client_name) || a.social_media_manager.localeCompare(b.social_media_manager));
  return rows;
}

// gviz-style CSV: every field quoted, quotes doubled, "\n" row ends. Readers
// that parse the Sheet's CSV today can parse this unchanged.
export function csvText(headers, rows) {
  const q = v => '"' + text(v).replace(/"/g, '""') + '"';
  const lines = [headers.map(q).join(',')];
  for (const r of rows) lines.push(headers.map(h => q(r[h])).join(','));
  return lines.join('\n') + '\n';
}

// ---- The read-only Sheet copy ----
// values: the tab as a 2-D array (row 0 = headers) as the Sheets API returns it.
// wanted: { header: value } for the one client. Returns what to write: the
// changed cells of the client's row, or a whole new row, or a refusal. Headers
// the Sheet does not have are skipped (never added), and no cell outside the
// wanted headers is touched, so a manual column like linear_api_key stays as is.
export function planSheetCopy(values, tab, slug, wanted, columnLetter, sheetRange) {
  const rows = Array.isArray(values) ? values : [];
  const headers = (rows[0] || []).map(h => text(h));
  const nameCol = headers.indexOf('client_name');
  if (nameCol < 0) return { ok: false, error: 'sheet_header_missing', field: 'client_name' };
  const matches = [];
  for (let r = 1; r < rows.length; r++) {
    if (clientSlug((rows[r] || [])[nameCol]) === slug) matches.push(r);
  }
  if (matches.length > 1) return { ok: false, error: 'sheet_row_ambiguous', rows: matches.map(r => r + 1) };
  const present = Object.keys(wanted).filter(h => headers.includes(h));
  if (!matches.length) {
    const row = headers.map(h => (present.includes(h) ? text(wanted[h]) : ''));
    return { ok: true, op: 'append', row, range: sheetRange(tab, 'A1') };
  }
  const r = matches[0];
  const have = rows[r] || [];
  const updates = [];
  for (const h of present) {
    const i = headers.indexOf(h);
    if (text(have[i]) === text(wanted[h])) continue;
    updates.push({ field: h, range: sheetRange(tab, columnLetter(i) + (r + 1)), value: text(wanted[h]) });
  }
  return { ok: true, op: 'update', sheet_row: r + 1, updates };
}

export function columnLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function sheetRange(tab, cell) {
  return "'" + String(tab).replace(/'/g, "''") + "'!" + cell;
}

// Outbox rows pending for the same (tab, client) collapse into one copy.
export function collapseOutbox(rows) {
  const seen = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const k = r.tab + '\u0000' + r.client_slug;
    if (!seen.has(k)) seen.set(k, { tab: r.tab, client_slug: r.client_slug, client_name: r.client_name, ids: [] });
    seen.get(k).ids.push(r.id);
  }
  return [...seen.values()];
}
