'use strict';
/*
 * Track B B0 auth scaffold seeder.
 *
 * Dry run:
 *   node scripts/b0-seed-auth-scaffold.js
 *
 * Live run:
 *   SUPABASE_SERVICE_ROLE_KEY=... node scripts/b0-seed-auth-scaffold.js --apply
 *
 * Optional private token manifest for re-issuing client links:
 *   node scripts/b0-seed-auth-scaffold.js --apply --manifest C:\private\client-tokens.json
 *
 * The manifest must never be committed. The script never prints token values.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SUPA_URL = process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SHEET_ID = '10QQnWOQY73Aj44R8AumYJzFpxMd_bZZiCMXkZ6QqAU8';

const APPLY = process.argv.includes('--apply');
const ROTATE = process.argv.includes('--rotate');
const manifestIndex = process.argv.indexOf('--manifest');
const MANIFEST = manifestIndex >= 0 ? process.argv[manifestIndex + 1] : '';

function fail(msg) {
  console.error('B0 seed failed:', msg);
  process.exit(1);
}

function clean(v) {
  return String(v == null ? '' : v).trim();
}

function normalizeClient(s) {
  let t = clean(s).toLowerCase();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) {}
  t = t.replace(/^dr\.?\s+/, '');
  t = t.replace(/\s+(?:and|&)\s+/g, '&');
  return t.replace(/[^a-z0-9&]+/g, '');
}

function normPerson(s) {
  let t = clean(s).toLowerCase();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) {}
  return t.replace(/[^a-z0-9@.]+/g, '');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  row.push(cell);
  if (row.some(v => clean(v))) rows.push(row);
  return rows;
}

function csvObjects(text) {
  const rows = parseCsv(text);
  const headers = (rows.shift() || []).map(h => clean(h));
  return rows.map(r => {
    const o = {};
    headers.forEach((h, i) => { o[h] = clean(r[i]); });
    return o;
  });
}

async function fetchSheet(sheet) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}&_t=${Date.now()}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`sheet ${sheet} HTTP ${resp.status}`);
  return csvObjects(await resp.text());
}

function seedClientsFromIndex() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/const WL_CLIENT_NAMES = \[([\s\S]*?)\];/);
  if (!m) return [];
  return Array.from(m[1].matchAll(/'([^']+)'/g)).map(x => x[1]).filter(Boolean);
}

function uniqueBy(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key || map.has(key)) continue;
    map.set(key, row);
  }
  return Array.from(map.values());
}

function token() {
  return crypto.randomBytes(24).toString('base64url');
}

function headers() {
  if (!SERVICE_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required for --apply');
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function rest(pathname, opts = {}) {
  const resp = await fetch(`${SUPA_URL}/rest/v1/${pathname}`, Object.assign({
    headers: headers(),
  }, opts));
  const text = await resp.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { json = text; }
  if (!resp.ok) throw new Error(`${pathname} HTTP ${resp.status}: ${typeof json === 'string' ? json : JSON.stringify(json)}`);
  return json;
}

async function upsertRows(table, rows, conflict) {
  if (!rows.length) return [];
  return rest(`${table}?on_conflict=${encodeURIComponent(conflict)}`, {
    method: 'POST',
    headers: Object.assign(headers(), { Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(rows),
  });
}

async function existingRows(table) {
  return rest(`${table}?select=*`);
}

async function upsertTeamMembers(desired) {
  const existing = await existingRows('team_members');
  const byKey = new Map(existing.map(r => [`${normPerson(r.name)}|${r.role}|${r.team || ''}`, r]));
  let created = 0;
  let updated = 0;
  for (const row of desired) {
    const key = `${normPerson(row.name)}|${row.role}|${row.team || ''}`;
    const found = byKey.get(key);
    if (found) {
      await rest(`team_members?id=eq.${encodeURIComponent(found.id)}`, {
        method: 'PATCH',
        headers: Object.assign(headers(), { Prefer: 'return=minimal' }),
        body: JSON.stringify(Object.assign({}, row, { active: true })),
      });
      updated++;
    } else {
      await rest('team_members', {
        method: 'POST',
        headers: Object.assign(headers(), { Prefer: 'return=minimal' }),
        body: JSON.stringify([row]),
      });
      created++;
    }
  }
  return { created, updated };
}

async function seedAccess(clients) {
  const existing = await existingRows('client_access');
  const bySlug = new Map(existing.map(r => [r.slug, r]));
  const rows = [];
  const manifest = [];
  for (const client of clients) {
    if (client.kind === 'internal') continue;
    const old = bySlug.get(client.slug);
    if (old && !ROTATE) continue;
    const reviewToken = token();
    rows.push({
      slug: client.slug,
      review_token: reviewToken,
      token_rotated_at: new Date().toISOString(),
      notes: old && ROTATE ? 'Rotated by Track B B0 seeder' : 'Minted by Track B B0 seeder',
    });
    manifest.push({
      slug: client.slug,
      display_name: client.display_name,
      token: reviewToken,
      link: `${client.display_name} -> ?c=${encodeURIComponent(client.display_name)}&t=${encodeURIComponent(reviewToken)}`,
    });
  }
  if (rows.length) await upsertRows('client_access', rows, 'slug');
  return { mintedOrRotated: rows.length, existingKept: existing.length - (ROTATE ? 0 : 0), manifest };
}

async function main() {
  const [clientsInfo, videoEditors, smms] = await Promise.all([
    fetchSheet('Clients Info'),
    fetchSheet('Video Editors'),
    fetchSheet('Social Media Managers'),
  ]);

  const seedNames = seedClientsFromIndex();
  const clientRows = [];
  for (const name of seedNames) {
    const slug = normalizeClient(name);
    if (!slug) continue;
    clientRows.push({
      slug,
      display_name: name,
      active: true,
      kind: slug === 'sidneylaruel' ? 'test' : (slug === 'kasperhytonen' ? 'internal' : 'client'),
      source: 'seed',
    });
  }
  for (const r of clientsInfo) {
    const name = clean(r.client_name);
    const slug = normalizeClient(name);
    if (!slug) continue;
    clientRows.push({
      slug,
      display_name: name,
      active: true,
      kind: slug === 'sidneylaruel' ? 'test' : (slug === 'kasperhytonen' ? 'internal' : 'client'),
      source: 'sheet',
      slack_channel_id: clean(r.slack_channel_id) || null,
    });
  }
  const clients = uniqueBy(clientRows.reverse(), r => r.slug).reverse().map(r => ({
    slug: r.slug,
    display_name: r.display_name,
    active: r.active !== false,
    kind: r.kind || 'client',
    source: r.source || 'sheet',
    slack_channel_id: r.slack_channel_id || null,
    brand_kit: r.brand_kit || null,
    linear_project_ids: r.linear_project_ids || null,
    emoji: r.emoji || null,
    board_status: r.board_status || 'in_progress',
    lead_member_id: r.lead_member_id || null,
    target_date: r.target_date || null,
    board_desc: r.board_desc || null,
  }));

  const teamMembers = [
    { name: 'Sidney Laruel', role: 'admin', team: null, active: true, default_for_team: false },
    { name: 'Kasper Hytonen', role: 'admin', team: null, active: true, default_for_team: false },
    { name: 'Rocio Perez', role: 'designer', team: 'graphics', active: true, default_for_team: true },
  ];
  for (const r of videoEditors) {
    const name = clean(r.video_editor);
    if (!name) continue;
    teamMembers.push({ name, email: clean(r.email) || null, role: 'editor', team: 'video', active: true, default_for_team: false });
  }
  for (const r of smms) {
    const name = clean(r.social_media_manager);
    if (!name) continue;
    teamMembers.push({ name, role: 'smm', team: null, active: true, default_for_team: false });
  }
  const members = uniqueBy(teamMembers, r => `${normPerson(r.name)}|${r.role}|${r.team || ''}`);

  console.log(JSON.stringify({
    mode: APPLY ? 'apply' : 'dry-run',
    clients: clients.length,
    team_members: members.length,
    access_candidates: clients.filter(c => c.kind !== 'internal').length,
    rotate: ROTATE,
  }, null, 2));

  if (!APPLY) return;

  await upsertRows('clients', clients, 'slug');
  const memberResult = await upsertTeamMembers(members);
  const accessResult = await seedAccess(clients);

  if (MANIFEST) {
    if (!path.isAbsolute(MANIFEST)) fail('--manifest must be an absolute private path');
    fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
    fs.writeFileSync(MANIFEST, JSON.stringify({
      generated_at: new Date().toISOString(),
      rotate: ROTATE,
      tokens: accessResult.manifest,
    }, null, 2));
  }

  console.log(JSON.stringify({
    ok: true,
    clients_upserted: clients.length,
    team_members_created: memberResult.created,
    team_members_updated: memberResult.updated,
    tokens_minted_or_rotated: accessResult.mintedOrRotated,
    private_manifest_written: !!MANIFEST,
  }, null, 2));
}

main().catch(err => fail(err && err.message ? err.message : String(err)));
