#!/usr/bin/env node
/*
 * Regenerates supabase/functions/higgsfield-mcp/catalog.ts from Higgsfield's
 * public API docs (https://docs.higgsfield.ai/docs/llms-full.txt): one entry
 * per model endpoint with its name, a category, the usage notes and the input
 * JSON schema. The connector validates requests against these schemas.
 *
 *   node scripts/higgsfield-catalog.js            fetch the docs and rewrite
 *   node scripts/higgsfield-catalog.js <file>     use a saved copy instead
 *   node scripts/higgsfield-catalog.js --check    write nothing; exit 1 and list every
 *                                                 model or setting that differs from the
 *                                                 committed catalog (the daily watch)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'supabase', 'functions', 'higgsfield-mcp', 'catalog.ts');
const SOURCE = 'https://docs.higgsfield.ai/docs/llms-full.txt';

function category(id) {
  if (/genjutsu\/motion|motion-control/.test(id)) return 'motion-transfer';
  if (/object-swap/.test(id)) return 'object-swap';
  if (/video-extend/.test(id)) return 'video-extend';
  if (/video-edit/.test(id)) return 'video-edit';
  if (/first-last-frame/.test(id)) return 'first-last-frame-video';
  if (/reference-to-video|image-reference|video-reference/.test(id)) return 'reference-to-video';
  if (/image-to-video/.test(id)) return 'image-to-video';
  if (/text-to-video/.test(id)) return 'text-to-video';
  if (/cinema-studio/.test(id)) return 'cinematic-video';
  if (/marketing-studio/.test(id)) return 'marketing-image';
  if (/ads-studio/.test(id)) return 'marketing-image';
  if (/genjutsu\/restyle/.test(id)) return 'video-restyle';
  if (/qwen-image-3\/edit|grok-imagine-image/.test(id)) return 'image-edit';
  return 'text-to-image';
}

function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (k !== 'title') out[k] = strip(v);
    return out;
  }
  return value;
}

// Endpoints the connector cannot serve yet. Restyle needs a preset_id taken from
// a presets endpoint the connector has no tool for, so a teammate could never
// fill it in; leaving it out keeps it from being offered.
const SKIP = new Set(['higgsfield/genjutsu/restyle/v1.0']);

function parse(text) {
  const models = [];
  for (const sec of text.split(/\n(?=# )/)) {
    const id = (sec.match(/\*\*Endpoint ID:\*\* `([^`]+)`/) || [])[1];
    if (!id || SKIP.has(id)) continue;
    const name = sec.split('\n', 1)[0].slice(2).replace(/ API$/, '').trim();
    const notesBlock = (sec.match(/## Usage notes\n([\s\S]*?)\n## /) || [])[1] || '';
    const notes = notesBlock.split('\n').filter(l => l.startsWith('* ')).map(l => l.slice(2).replace(/\\/g, '').trim());
    // The docs now put the schema in a quoted block ("> " before every line);
    // older pages had it bare. Strip the quote marks, then read it as before.
    const bare = sec.replace(/^> ?/gm, '');
    const schemaText = (bare.match(/Complete JSON schema\*{0,2}\s*```json[^\n]*\n([\s\S]*?)```/) || bare.match(/Complete JSON schema">\s*```json[^\n]*\n([\s\S]*?)```/) || [])[1];
    if (!schemaText) continue;
    models.push({ id, name, category: category(id), notes, schema: strip(JSON.parse(schemaText)) });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

// Compare the freshly parsed models with the committed catalog and say what
// differs, one line each. Exit 1 on any difference so a scheduled run goes red.
function report(models) {
  const text = fs.readFileSync(OUT, 'utf8');
  const old = JSON.parse(text.slice(text.indexOf('= [') + 2, text.lastIndexOf('];') + 1));
  const before = new Map(old.map(m => [m.id, m]));
  const after = new Map(models.map(m => [m.id, m]));
  const lines = [];
  for (const [id, m] of after) {
    const o = before.get(id);
    if (!o) { lines.push('NEW model ' + id); continue; }
    if (JSON.stringify(o) === JSON.stringify(m)) continue;
    // Name the settings that moved; anything else (required fields, rules, name,
    // category, notes) is still a difference even when no setting changed.
    const pa = o.schema.properties || {}, pb = m.schema.properties || {};
    const moved = [...new Set([...Object.keys(pa), ...Object.keys(pb)])].filter(k => JSON.stringify(pa[k]) !== JSON.stringify(pb[k]));
    for (const k of moved) lines.push('CHANGED ' + id + ' setting ' + k + ': ' + JSON.stringify(pa[k] && (pa[k].enum || pa[k])) + ' -> ' + JSON.stringify(pb[k] && (pb[k].enum || pb[k])));
    if (!moved.length) lines.push('CHANGED ' + id + ' (rules, required fields, name, category or usage notes)');
  }
  for (const id of before.keys()) if (!after.has(id)) lines.push('GONE model ' + id);
  if (!lines.length) { console.log('Catalog matches Higgsfield\'s docs (' + models.length + ' models).'); return; }
  console.log(lines.join('\n'));
  console.log('\n' + lines.length + ' difference(s). Run: node scripts/higgsfield-catalog.js');
  process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const file = args.find(a => !a.startsWith('--'));
  const text = file ? fs.readFileSync(file, 'utf8') : await (await fetch(SOURCE)).text();
  const models = parse(text);
  if (models.length < 20) throw new Error('Parsed only ' + models.length + ' models; the docs format may have changed.');
  const body = '// Generated by scripts/higgsfield-catalog.js from ' + SOURCE + '. Do not hand-edit.\n\n'
    + 'export type CatalogModel = { id: string; name: string; category: string; notes: string[]; schema: Record<string, unknown> };\n\n'
    + 'export const CATALOG: CatalogModel[] = ' + JSON.stringify(models, null, 1) + ';\n';
  if (check) return report(models);
  fs.writeFileSync(OUT, body);
  console.log('Wrote ' + path.relative(process.cwd(), OUT) + ': ' + models.length + ' models.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
