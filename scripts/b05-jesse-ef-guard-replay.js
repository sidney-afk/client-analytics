'use strict';

/*
 * B0.5 data-assumption sweep item 9.
 *
 * Validation-only replay of the current canary client's live rows through the
 * EF guard inputs. This reads Supabase and local EF source; it does not call any
 * write endpoint.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SUPA_URL = process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co';
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) args.set(a, process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : '1');
}

const CLIENT = args.get('--client') || 'jesseisrael';

function fail(message) {
  console.error('B0.5 EF guard replay failed:', message);
  process.exit(1);
}

function clean(v) {
  return String(v == null ? '' : v).trim();
}

function extractArray(source, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\](?:\\s+as\\s+const)?;`);
  const m = source.match(re);
  if (!m) throw new Error(`missing ${name}`);
  return Array.from(m[1].matchAll(/"([^"]+)"/g)).map(x => x[1]);
}

async function supabaseRows(table, select, params) {
  if (!SUPA_KEY) fail('SUPABASE_SERVICE_ROLE_KEY is required');
  const rows = [];
  let offset = 0;
  const limit = 1000;
  for (;;) {
    const url = `${SUPA_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=${limit}&offset=${offset}${params ? `&${params}` : ''}`;
    const resp = await fetch(url, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`Supabase ${table} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    const batch = await resp.json();
    rows.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return rows;
}

function linkKey(s) {
  return clean(s).toLowerCase();
}

function active(row) {
  return clean(row.status).toLowerCase() !== 'archived';
}

function replayRows(kind, rows, sourcePath) {
  const src = fs.readFileSync(path.join(ROOT, sourcePath), 'utf8');
  const allowed = new Set(extractArray(src, 'ALLOWED'));
  const contentFields = extractArray(src, 'CONTENT_FIELDS');
  const scalarFields = new Set(extractArray(src, 'SCALAR_FIELDS'));
  const systemFields = new Set([
    'id', 'client', 'created_at', 'updated_at',
    'video_status_at', 'graphic_status_at', 'caption_status_at', 'title_status_at',
  ]);
  const linkSeen = new Map();
  const failures = [];
  let passed = 0;
  for (const row of rows) {
    const nonEmptyRejected = Object.keys(row)
      .filter(k => !allowed.has(k) && !systemFields.has(k))
      .filter(k => clean(row[k]) !== '');
    const hasContent = contentFields.some(k => clean(row[k]) !== '');
    const scalarReplay = Array.from(scalarFields).filter(k => Object.prototype.hasOwnProperty.call(row, k));
    const baseAt = clean(row.updated_at);
    const issueLinks = ['linear_issue_id', 'graphic_linear_issue_id']
      .map(k => [k, linkKey(row[k])])
      .filter(([, v]) => v);
    const rowErrors = [];
    if (nonEmptyRejected.length) rowErrors.push(`non-empty fields not in EF ALLOWED: ${nonEmptyRejected.join(', ')}`);
    if (!hasContent) rowErrors.push('row has no EF CONTENT_FIELDS value; existing-row replay is safe, but create replay would hit phantom guard');
    if (!baseAt) rowErrors.push('missing updated_at/comments_base_at replay anchor');
    for (const [slot, value] of issueLinks) {
      const key = `${slot}|${value}`;
      if (!linkSeen.has(key)) linkSeen.set(key, []);
      linkSeen.get(key).push(row.id);
    }
    if (rowErrors.length) failures.push({ id: row.id, errors: rowErrors, scalarReplay });
    else passed++;
  }
  const duplicateLinks = Array.from(linkSeen.entries()).filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids }));
  for (const dup of duplicateLinks) {
    for (const id of dup.ids) failures.push({ id, errors: [`duplicate active ${kind} link replay: ${dup.key}`] });
  }
  return {
    kind,
    rows: rows.length,
    passed: passed - duplicateLinks.reduce((n, d) => n + d.ids.length, 0),
    failures,
    duplicate_links: duplicateLinks,
    allowed_count: allowed.size,
  };
}

function render(result) {
  const lines = [];
  lines.push('# B0.5 Jesse EF Guard Replay');
  lines.push('');
  lines.push(`Generated: ${result.generated_at}`);
  lines.push(`Client: ${result.client}`);
  lines.push('');
  for (const section of result.sections) {
    lines.push(`## ${section.kind}`);
    lines.push('');
    lines.push(`- Active rows replayed: ${section.rows}`);
    lines.push(`- Passed: ${section.passed}`);
    lines.push(`- Failures: ${section.failures.length}`);
    lines.push(`- Duplicate active links: ${section.duplicate_links.length}`);
    if (section.failures.length) {
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(section.failures.slice(0, 20), null, 2));
      lines.push('```');
    }
    lines.push('');
  }
  lines.push('Validation-only: no EF/n8n write endpoint was called.');
  return lines.join('\n');
}

async function main() {
  const [calendarRows, sampleRows] = await Promise.all([
    supabaseRows('calendar_posts', '*', `client=eq.${encodeURIComponent(CLIENT)}`),
    supabaseRows('sample_reviews', '*', `client=eq.${encodeURIComponent(CLIENT)}`),
  ]);
  const result = {
    generated_at: new Date().toISOString(),
    client: CLIENT,
    sections: [
      replayRows('calendar_posts', calendarRows.filter(active), 'supabase/functions/calendar-upsert/index.ts'),
      replayRows('sample_reviews', sampleRows.filter(active), 'supabase/functions/sample-review-upsert/index.ts'),
    ],
  };
  const out = args.get('--out');
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, render(result));
  }
  const jsonPath = args.get('--json-out');
  if (jsonPath) {
    fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
    fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  }
  console.log(render(result));
  const failures = result.sections.reduce((n, s) => n + s.failures.length, 0);
  if (failures) process.exit(1);
}

main().catch(err => fail(err && err.stack ? err.stack : String(err)));
