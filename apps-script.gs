/**
 * SyncView Templates — Apps Script backend
 * ----------------------------------------
 * Single-file backend for the Templates tab in index.html.
 * Reads/writes a `Templates` sheet in the existing SyncView spreadsheet.
 *
 * SETUP (one-time, ~5 minutes):
 *   1. Open the SyncView Google Sheet (the one with Metrics, Clients Info, etc.).
 *   2. Add a new sheet tab called exactly:  Templates
 *   3. In row 1, paste these column headers (one per cell, A1 through L1):
 *        client_name | filming_plans_link | reels_subtitle_font |
 *        reels_subtitle_main_color | reels_subtitle_highlight_color |
 *        reels_reference_link | reels_preferences |
 *        thumbnails_title_font | thumbnails_title_color |
 *        thumbnails_highlight_color | thumbnails_photos_link | updated_at
 *   4. Extensions → Apps Script.
 *   5. Replace the default Code.gs contents with this entire file.
 *   6. Save (disk icon).
 *   7. Deploy → New deployment → ⚙︎ Web app
 *        Description: "SyncView Templates API"
 *        Execute as:  Me
 *        Who has access:  Anyone     ← required so the static dashboard can call it
 *      Click Deploy. Authorise when prompted (it'll warn "unverified" — choose
 *      Advanced → Go to (project name) → Allow).
 *   8. Copy the Web app URL (looks like https://script.google.com/macros/s/AKfycb…/exec).
 *   9. In index.html, set:    const TEMPLATES_ENDPOINT = '<paste the URL here>';
 *
 * That's it. Reads happen via GET, writes via POST. Each user's edit lands in
 * the sheet and shows up for everyone else on next page load (or refresh).
 */

const SHEET_NAME = 'Templates';

const COLUMNS = [
  'client_name',
  'filming_plans_link',
  'reels_subtitle_font',
  'reels_subtitle_main_color',
  'reels_subtitle_highlight_color',
  'reels_reference_link',
  'reels_preferences',
  'thumbnails_title_font',
  'thumbnails_title_color',
  'thumbnails_highlight_color',
  'thumbnails_photos_link',
  'updated_at',
];

function _sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(COLUMNS);
  }
  return sh;
}

function _readAll() {
  const sh = _sheet();
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return {};
  const headers = values[0].map(String);
  const out = {};
  for (let r = 1; r < values.length; r++) {
    const row = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = values[r][c] != null ? String(values[r][c]) : '';
    }
    if (row.client_name) out[row.client_name] = row;
  }
  return out;
}

function _findRowIndex(sh, clientName) {
  const values = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === clientName) return i + 2; // sheet rows are 1-indexed; +1 for header
  }
  return -1;
}

function _json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    return _json({ ok: true, templates: _readAll() });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

function doPost(e) {
  try {
    // Browser POSTs from the dashboard use text/plain to avoid CORS preflight.
    const body = JSON.parse(e.postData.contents || '{}');
    const clientName = String(body.clientName || '').trim();
    const patch = body.patch || {};
    if (!clientName) return _json({ ok: false, error: 'clientName required' });

    const sh = _sheet();
    // Make sure header row matches expected schema (helpful first-run insurance).
    const lastCol = sh.getLastColumn();
    if (lastCol < COLUMNS.length) {
      sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]);
    }

    let rowIdx = _findRowIndex(sh, clientName);
    let row;
    if (rowIdx === -1) {
      row = COLUMNS.map(() => '');
      row[0] = clientName;
      sh.appendRow(row);
      rowIdx = sh.getLastRow();
    } else {
      row = sh.getRange(rowIdx, 1, 1, COLUMNS.length).getValues()[0].map(v => v == null ? '' : String(v));
    }

    // Apply patch — only fields we know about, never blow away the whole row.
    for (let i = 0; i < COLUMNS.length; i++) {
      const key = COLUMNS[i];
      if (key === 'client_name' || key === 'updated_at') continue;
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        row[i] = patch[key] == null ? '' : String(patch[key]);
      }
    }
    row[COLUMNS.indexOf('updated_at')] = new Date().toISOString();
    sh.getRange(rowIdx, 1, 1, COLUMNS.length).setValues([row]);

    const result = {};
    COLUMNS.forEach((k, i) => { result[k] = row[i]; });
    return _json({ ok: true, template: result });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}
