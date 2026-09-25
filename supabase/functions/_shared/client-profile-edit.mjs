// Shared, dependency-free logic for editing one client's profile from the
// Kasper > Clients tab (docs/plans/2026-09-24-sheets-to-supabase.md, "Later: a
// Clients admin tab", step 2). Used by the client-profile-write Edge Function
// and unit-tested in Node (test/client-profile-edit.js).
//
// While client_profiles_authority is "sheet", the Clients Info Sheet stays the
// main copy and n8n still reads it, so an edit is written to the Sheet FIRST
// (only the changed cells, and only if that row still matches what the editor
// loaded), then to Supabase. This file decides which cells to write; it never
// talks to Google or Supabase itself.
import { clientSlug } from './sheets-mirror.mjs';

// The columns an admin may change. client_name is not editable here: it is
// the row key in the Sheet and the source of the slug every other table uses.
export const EDITABLE_FIELDS = Object.freeze([
  'email', 'instagram_handle', 'tiktok_handle', 'youtube_channel_id',
  'slack_channel_id', 'creative_channel_id', 'upload_post_profile', 'postforme_account_id',
  'content_description', 'keywords', 'specific_keywords', 'competitors',
]);
export const MAX_FIELD_CHARS = 20000;

function text(v) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim();
}

// A cell and a stored value "match" when their trimmed text is equal; an empty
// cell equals a null column.
export function sameValue(a, b) {
  return text(a) === text(b);
}

// Validates the page's { field: newValue } map. Unknown fields are refused,
// not dropped, so a typo can never look like a successful save.
export function normalizeChanges(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'bad_changes' };
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!EDITABLE_FIELDS.includes(k)) return { ok: false, error: 'field_not_editable', field: k };
    if (v != null && typeof v !== 'string') return { ok: false, error: 'bad_value', field: k };
    const t = text(v);
    if (t.length > MAX_FIELD_CHARS) return { ok: false, error: 'value_too_long', field: k };
    out[k] = t;
  }
  if (!Object.keys(out).length) return { ok: false, error: 'no_changes' };
  return { ok: true, changes: out };
}

// 0 -> A, 25 -> Z, 26 -> AA.
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

// A1 notation for a tab name with spaces or quotes.
export function sheetRange(tab, cell) {
  return "'" + String(tab).replace(/'/g, "''") + "'!" + cell;
}

// values: the tab as a 2-D array (row 0 = headers), as the Sheets API returns
// it. current: the Supabase row the editor loaded (and the server re-read).
// Returns the one Sheet row for this slug, the cells to write, and every
// editable field whose cell no longer matches what the editor loaded.
export function planSheetEdit(values, slug, current, changes, tab = 'Clients Info') {
  const rows = Array.isArray(values) ? values : [];
  const headers = (rows[0] || []).map(h => text(h));
  const nameCol = headers.indexOf('client_name');
  if (nameCol < 0) return { ok: false, error: 'sheet_header_missing', field: 'client_name' };
  const col = {};
  for (const f of EDITABLE_FIELDS) {
    const i = headers.indexOf(f);
    if (i >= 0) col[f] = i;
  }
  for (const f of Object.keys(changes)) {
    if (!(f in col)) return { ok: false, error: 'sheet_header_missing', field: f };
  }
  const matches = [];
  for (let r = 1; r < rows.length; r++) {
    if (clientSlug((rows[r] || [])[nameCol]) === slug) matches.push(r);
  }
  if (!matches.length) return { ok: false, error: 'sheet_row_missing' };
  if (matches.length > 1) return { ok: false, error: 'sheet_row_ambiguous', rows: matches.map(r => r + 1) };
  const r = matches[0];
  const row = rows[r] || [];
  const drift = [];
  for (const f of Object.keys(col)) {
    if (!sameValue(row[col[f]], current ? current[f] : null)) drift.push(f);
  }
  const sheetRowNumber = r + 1;
  const sheetValues = {};
  for (const f of Object.keys(col)) sheetValues[f] = text(row[col[f]]);
  if (drift.length) return { ok: false, error: 'sheet_changed', fields: drift, sheet_row: sheetRowNumber, sheet_values: sheetValues };
  const updates = [];
  for (const [f, v] of Object.entries(changes)) {
    if (sameValue(row[col[f]], v)) continue;
    updates.push({ field: f, range: sheetRange(tab, columnLetter(col[f]) + sheetRowNumber), value: v });
  }
  return { ok: true, sheet_row: sheetRowNumber, updates, sheet_values: sheetValues };
}
