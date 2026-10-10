#!/usr/bin/env node
'use strict';
/*
 * calendar-upsert: the ONE-LINE live delta for the auto-posted timer (OPEN_REPAIRS 394).
 *
 * calendar-upsert is frozen: the repo's index.ts is NOT what runs (it re-applies the client-link
 * gate, see its header). A change ships as "the exact live source plus the delta". This script is
 * that delta, applied mechanically so nobody edits the live source by hand:
 *
 *   live:   const source = rawSource === "linear" || rawSource === "reconcile" ? rawSource : "ui";
 *   after:  ... || rawSource === "reconcile" || rawSource === "auto-posted" ? rawSource : "ui";
 *
 * so the calendar history rows the calendar-auto-posted timer causes say "auto-posted" instead of
 * "ui". Nothing else changes: same guards, same client-link behaviour, same response.
 *
 * Usage:
 *   1. Save the live function as JSON (Supabase MCP get_edge_function, slug calendar-upsert),
 *      the object with a `files` array of { name, content }.
 *   2. node scripts/calendar-upsert-live-delta.js <live.json> <out-dir>
 *      Refuses unless the anchor line occurs exactly once (a newer live source is never guessed at)
 *      and is idempotent on an already-patched source. Writes every live file under <out-dir> with
 *      its live name, prints the sha256 of index.ts before and after.
 *   3. Deploy those files as calendar-upsert, verify_jwt false (MCP deploy_edge_function with the
 *      same file names and entrypoint, or `supabase functions deploy calendar-upsert --no-verify-jwt`
 *      from a folder laid out the same way).
 * Rollback: redeploy the saved live JSON unchanged.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ANCHOR = '  const source = rawSource === "linear" || rawSource === "reconcile" ? rawSource : "ui";';
const PATCHED = '  const source = rawSource === "linear" || rawSource === "reconcile" || rawSource === "auto-posted" ? rawSource : "ui";';
const NOTE = '  // "auto-posted": the calendar-auto-posted timer (OPEN_REPAIRS 394). Live delta, scripts/calendar-upsert-live-delta.js.';

function applyDelta(source) {
  const text = String(source);
  const count = (needle) => text.split(needle).length - 1;
  if (count(PATCHED) === 1 && count(ANCHOR) === 0) return { text, changed: false };
  if (count(ANCHOR) !== 1) throw new Error(`anchor line found ${count(ANCHOR)} times (expected 1); the live source changed, re-derive the delta by hand`);
  return { text: text.replace(ANCHOR, NOTE + '\n' + PATCHED), changed: true };
}

function sha(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function main(argv) {
  const [input, outDir] = argv;
  if (!input || !outDir) {
    console.error('usage: node scripts/calendar-upsert-live-delta.js <live.json> <out-dir>');
    return 2;
  }
  const live = JSON.parse(fs.readFileSync(input, 'utf8'));
  const files = Array.isArray(live.files) ? live.files : [];
  const entry = files.find(f => /(^|\/)calendar-upsert\/index\.ts$/.test(String(f.name || '')));
  if (!entry) throw new Error('no calendar-upsert/index.ts in the live JSON');
  const { text, changed } = applyDelta(entry.content);
  for (const f of files) {
    const name = String(f.name || '');
    if (!name || name.includes('..') || path.isAbsolute(name)) throw new Error('refusing file name ' + JSON.stringify(name));
    const target = path.join(outDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f === entry ? text : String(f.content));
  }
  console.log(`live version ${live.version || '?'}; index.ts sha256 before ${sha(entry.content)}`);
  console.log(`index.ts sha256 after  ${sha(text)}${changed ? '' : ' (already patched, unchanged)'}`);
  console.log(`wrote ${files.length} file(s) under ${outDir}`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error('refused: ' + e.message); process.exitCode = 1; }
}

module.exports = { ANCHOR, PATCHED, applyDelta };
