'use strict';
/*
 * Leads CRM import (docs/features/CRM_LEADS.md, "Importing people").
 *
 * Reads one or more CSV exports and upserts people into crm_people, deduped on
 * email, then phone, then Instagram handle (the same normalisers as the
 * database: supabase/functions/_shared/crm-leads-core.mjs). Run by a person,
 * never by CI. Dry run unless --apply. Prints counts only, never a row.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/crm-import.js --source="<batch name>" --lead-type=dream100 [--tag=bench] [--apply] a.csv [b.csv ...]
 *
 * Rows:
 *   - a row whose excluded / exclude / status column says yes or "excluded" is skipped;
 *   - "[NEAR-MISS: ...]" and any other [bracketed tag] is cut from the handle
 *     (a near-miss also gets the near-miss tag);
 *   - a bench column that says yes, or --tag=bench, adds the bench tag;
 *   - a row with no email, phone or handle is skipped.
 * An existing person only has blanks filled and tags added: stage, owner and
 * next step are never touched. Every new or changed person gets one
 * "imported" timeline row.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? '' : r[i]])));
}

function args(argv) {
  const out = { files: [], tags: [], apply: false, source: '', leadType: '' };
  for (const a of argv) {
    if (a === '--apply') out.apply = true;
    else if (a.startsWith('--source=')) out.source = a.slice(9).trim();
    else if (a.startsWith('--lead-type=')) out.leadType = a.slice(12).trim();
    else if (a.startsWith('--tag=')) out.tags.push(a.slice(6).trim());
    else if (a.startsWith('--')) throw new Error('unknown option ' + a.split('=')[0]);
    else out.files.push(a);
  }
  return out;
}

/** Plans the import against the people already stored. Pure: no I/O. */
function planImport(core, existing, csvRows, defaults) {
  const index = new Map();
  const people = existing.map((p) => Object.assign({}, p));
  for (const p of people) for (const k of core.dedupeKeys(p)) if (!index.has(k)) index.set(k, p);
  const counts = { rows: 0, excluded: 0, no_contact: 0, no_lead_type: 0, created: 0, updated: 0, unchanged: 0, duplicate_in_file: 0 };
  const creates = [], updates = new Map();
  for (const row of csvRows) {
    counts.rows++;
    const r = core.importRow(row, defaults);
    if (r.skip) { counts[r.skip]++; continue; }
    const keys = core.dedupeKeys(r.person);
    const hit = keys.map((k) => index.get(k)).find(Boolean);
    if (!hit) {
      const p = Object.assign({ _new: true }, r.person);
      creates.push(p); people.push(p);
      for (const k of keys) if (!index.has(k)) index.set(k, p);
      counts.created++;
      continue;
    }
    if (hit._new) {
      counts.duplicate_in_file++;
      const patch = core.mergeForImport(hit, r.person);
      Object.assign(hit, patch);
      for (const k of core.dedupeKeys(hit)) if (!index.has(k)) index.set(k, hit);
      continue;
    }
    const patch = core.mergeForImport(Object.assign({}, hit, updates.get(hit.id) || {}), r.person);
    if (!Object.keys(patch).length) { if (!updates.has(hit.id)) counts.unchanged++; continue; }
    if (!updates.has(hit.id)) counts.updated++;
    updates.set(hit.id, Object.assign(updates.get(hit.id) || {}, patch));
    Object.assign(hit, patch);
    for (const k of core.dedupeKeys(hit)) if (!index.has(k)) index.set(k, hit);
  }
  return { counts, creates: creates.map(({ _new, ...p }) => p), updates };
}

async function rest(url, key, method, pathAndQuery, body, prefer) {
  const res = await fetch(url + '/rest/v1/' + pathAndQuery, {
    method,
    headers: Object.assign({ apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, prefer ? { Prefer: prefer } : {}),
    body: body == null ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(method + ' ' + pathAndQuery.split('?')[0] + ' HTTP ' + res.status);
  return res.status === 204 ? null : res.json();
}

async function main() {
  const opt = args(process.argv.slice(2));
  if (!opt.files.length || !opt.source) {
    console.error('usage: node scripts/crm-import.js --source="<batch name>" [--lead-type=dream100|ad_lead|past_call|email] [--tag=bench] [--apply] file.csv ...');
    process.exit(2);
  }
  const core = await import(pathToFileURL(path.join(__dirname, '..', 'supabase/functions/_shared/crm-leads-core.mjs')).href);
  if (opt.leadType && !core.LEAD_TYPES.includes(opt.leadType)) throw new Error('lead type must be one of ' + core.LEAD_TYPES.join(', '));
  const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!url || !key) throw new Error('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');

  const rows = opt.files.flatMap((f) => parseCsv(fs.readFileSync(f, 'utf8')));
  const existing = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(url, key, 'GET', 'crm_people?select=id,display_name,email,phone,instagram_handle,niche,tags,state_version&order=id&offset=' + from + '&limit=1000');
    existing.push(...page);
    if (page.length < 1000) break;
  }
  const plan = planImport(core, existing, rows, { lead_type: opt.leadType, tags: opt.tags });
  console.log(JSON.stringify(Object.assign({ mode: opt.apply ? 'apply' : 'dry-run', files: opt.files.length, existing: existing.length }, plan.counts)));
  if (!opt.apply) { console.log('dry run: nothing written. Add --apply to write.'); return; }

  let source = (await rest(url, key, 'GET', 'crm_sources?select=id&name=eq.' + encodeURIComponent(opt.source)))[0];
  if (!source) source = (await rest(url, key, 'POST', 'crm_sources', { name: opt.source, kind: 'csv_import' }, 'return=representation'))[0];
  let created = 0, updated = 0, conflicts = 0;
  for (let i = 0; i < plan.creates.length; i += 200) {
    const chunk = plan.creates.slice(i, i + 200).map((p) => Object.assign({}, p, { source_id: source.id }));
    const made = await rest(url, key, 'POST', 'crm_people?select=id', chunk, 'return=representation');
    await rest(url, key, 'POST', 'crm_events', made.map((m) => ({ person_id: m.id, kind: 'imported', channel: 'system', actor: 'import', detail: { source_id: source.id } })), 'return=minimal');
    created += made.length;
  }
  const byId = new Map(existing.map((p) => [p.id, p]));
  for (const [id, patch] of plan.updates) {
    const v = byId.get(id).state_version;
    const done = await rest(url, key, 'PATCH', 'crm_people?select=id&id=eq.' + id + '&state_version=eq.' + v,
      Object.assign({}, patch, { state_version: v + 1, updated_at: new Date().toISOString() }), 'return=representation');
    if (!done.length) { conflicts++; continue; }
    await rest(url, key, 'POST', 'crm_events', { person_id: id, kind: 'imported', channel: 'system', actor: 'import', detail: { source_id: source.id, filled: Object.keys(patch) } }, 'return=minimal');
    updated++;
  }
  console.log(JSON.stringify({ written_created: created, written_updated: updated, skipped_changed_meanwhile: conflicts }));
}

module.exports = { parseCsv, planImport };
if (require.main === module) main().catch((e) => { console.error('crm-import: ' + (e && e.message || e)); process.exit(1); });
