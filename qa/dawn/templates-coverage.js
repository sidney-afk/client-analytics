// templates-coverage.js — does every current client have a Templates page?
//
// Why (owner, 2026-09-28): a row in `templates` is created only by the first
// save of a client's Templates page (supabase/functions/templates-save upserts),
// and no onboarding step makes one. Several current clients were found with no
// row, so staff had no thumbnail Canva link to work from. The page itself copes
// with a missing row (docs/syncview-design/tests/templates-no-row-browser.js);
// this check makes the gap visible every weekday morning so it is never missed.
//
// "Current clients" is the same list the site uses: every client_name row in the
// SYNCVIEW "Clients Info" sheet, minus accounts whose `clients.kind` is 'test'
// or 'internal' (our own accounts are not clients and need no Templates page).
// A client is matched to its row by the client's slug in the `clients` table
// (found by its display name), falling back to the name run through the same
// normalizer templates-save uses to name a row (normalizeWriteClient). A row
// "has a thumbnail link" the way the Templates page shows one: any http(s)
// entry in the link list, else in the single field.
//
// Read-only. Returns COUNTS only: the dawn report is public (dawn-report.js), so
// no client name ever leaves this module.
'use strict';

const SHEET_ID = '10QQnWOQY73Aj44R8AumYJzFpxMd_bZZiCMXkZ6QqAU8';
const CLIENTS_INFO_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Clients%20Info`;

// Fallback name key, used only when the writer's own normalizer is not passed
// in. readCoverage always passes normalizeWriteClient (the exact rule
// templates-save uses to name a row), so live counts never depend on this.
const plainKey = (v) => String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]/g, '');
const READ_TIMEOUT_MS = 20000;
// clients.kind values that are not real clients (the column allows client, internal, test).
const SKIP_KINDS = new Set(['test', 'internal']);

// What the Templates page shows: the `_list` JSON first, else the single
// field; a slot counts only when it is an http(s) link (060 _tplGetLinks and
// its render). A blank first slot with a link after it is still a link.
function hasThumbnailLink(data) {
  const d = data && typeof data === 'object' ? data : {};
  let links = [];
  const raw = d.thumbnails_canva_link_list;
  if (raw && typeof raw === 'string') {
    try { const arr = JSON.parse(raw); if (Array.isArray(arr) && arr.length) links = arr.map(v => String(v == null ? '' : v)); } catch (e) {}
  }
  if (!links.length && d.thumbnails_canva_link) links = [String(d.thumbnails_canva_link)];
  return links.some(v => /^https?:\/\//i.test(v.trim()));
}

// Minimal RFC-4180 reader: quoted fields, doubled quotes, commas and newlines inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

function clientNamesFromCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const col = rows[0].map(h => h.trim().toLowerCase()).indexOf('client_name');
  if (col < 0) return [];
  return rows.slice(1).map(r => String(r[col] || '').trim()).filter(Boolean);
}

// clientNames: Clients Info client_name values. clients: rows { slug, display_name, kind }.
// templates: rows { client_slug, data }. Returns { current, noRow, noLink }.
function coverage({ clientNames, clients, templates, normalize }) {
  const key = typeof normalize === 'function' ? (v) => normalize(v) : plainKey;
  const test = new Set();
  const slugOf = new Map();
  for (const c of clients || []) {
    const dk = key(c && c.display_name), sk = key(c && c.slug);
    if (dk && sk && !slugOf.has(dk)) slugOf.set(dk, sk);
    if (sk && !slugOf.has(sk)) slugOf.set(sk, sk);
  }
  for (const c of clients || []) {
    if (!SKIP_KINDS.has(String(c && c.kind || '').toLowerCase())) continue;
    for (const v of [c.display_name, c.slug]) { const k = key(v); if (k) test.add(k); }
  }
  const byKey = new Map();
  for (const t of templates || []) { const k = key(t && t.client_slug); if (k) byKey.set(k, t); }
  const current = new Set();
  for (const n of clientNames || []) {
    const nk = key(n);
    const k = slugOf.get(nk) || nk;
    if (k && !test.has(k) && !test.has(nk)) current.add(k);
  }
  let noRow = 0, noLink = 0;
  for (const k of current) {
    const t = byKey.get(k);
    if (!t) { noRow++; continue; }
    if (!hasThumbnailLink(t.data)) noLink++;
  }
  return { current: current.size, noRow, noLink };
}

// Live read (public sheet + the browser publishable key). Throws on any read failure.
async function readCoverage({ supa, key: apiKey, fetchImpl = fetch, timeoutMs = READ_TIMEOUT_MS }) {
  const h = { apikey: apiKey, authorization: 'Bearer ' + apiKey };
  const { normalizeWriteClient } = await import('../../supabase/functions/_shared/browser-write-auth-policy.mjs');
  // Every read has a deadline, so a stalled response degrades to "not
  // measured" and never holds up the dawn check's cleanup.
  const sig = () => (AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined);
  const [csv, clients, templates] = await Promise.all([
    fetchImpl(CLIENTS_INFO_URL, { signal: sig() }).then(r => { if (!r.ok) throw new Error('clients-info'); return r.text(); }),
    fetchImpl(`${supa}/rest/v1/clients?select=slug,display_name,kind`, { headers: h, signal: sig() }).then(r => { if (!r.ok) throw new Error('clients'); return r.json(); }),
    fetchImpl(`${supa}/rest/v1/templates?select=client_slug,data`, { headers: h, signal: sig() }).then(r => { if (!r.ok) throw new Error('templates'); return r.json(); }),
  ]);
  const clientNames = clientNamesFromCsv(csv);
  if (!clientNames.length) throw new Error('clients-info-empty');
  return coverage({ clientNames, clients, templates, normalize: normalizeWriteClient });
}

module.exports = { coverage, hasThumbnailLink, clientNamesFromCsv, parseCsv, readCoverage, CLIENTS_INFO_URL };
