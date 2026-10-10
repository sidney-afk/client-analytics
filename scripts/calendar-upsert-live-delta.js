#!/usr/bin/env node
'use strict';
/*
 * calendar-upsert: the ONE-LINE live delta for the auto-posted timer (OPEN_REPAIRS 395).
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
 * Usage (the ONLY deploy route; there is deliberately no `supabase functions deploy` route):
 *   1. Save the live function as JSON (Supabase MCP get_edge_function, slug calendar-upsert): the
 *      object with a `files` array of { name, content }. Keep that file: it is the rollback.
 *   2. node scripts/calendar-upsert-live-delta.js <live.json> <out-dir> --expect-sha=<before-hash>
 *      <before-hash> is the sha256 of the live index.ts the delta was written against. Measured on
 *      live v83 (2026-10-10): 67511f6763a2e3b7edd951ce473e5b3fa878c53cbf4d25e2efd564d3f2e91185.
 *      Refuses when: the hash differs (live moved on; re-derive the delta), any input file contains
 *      authorizeBrowserWrite (that is the repo's gated source, which 401s every client link), the
 *      anchor line is not there exactly once, or <out-dir> is inside this repository (the output
 *      must never sit where it could be committed or deployed as repo source). Prints the after-hash.
 *      For v83 the after-hash is 959a4fb3ce44082496976f839cd1b0614f8fd04e96fe7a3e582ac6be07672fad.
 *   3. Deploy exactly those files with Supabase MCP deploy_edge_function: name calendar-upsert, the
 *      same file names and entrypoint as the live JSON, and verify_jwt: false (EXPLICITLY false; the
 *      live function has always run with JWT checking off, and turning it on refuses client links).
 *      Never deploy the repo's supabase/functions/calendar-upsert: it re-applies the client-link gate
 *      and brings back the 401 outage on every client review link (2026-07-15, twice).
 *   4. Post-deploy check: save the live function JSON again and run
 *        node scripts/calendar-upsert-live-delta.js --check <live-after.json> --expect-sha=<after-hash>
 *      It passes only if the live index.ts hashes to the after-hash from step 2, carries the delta
 *      line and no authorizeBrowserWrite. Also confirm the live verify_jwt is false in that JSON.
 * Rollback: redeploy the files saved in step 1, unchanged, with verify_jwt: false.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ANCHOR = '  const source = rawSource === "linear" || rawSource === "reconcile" ? rawSource : "ui";';
const PATCHED = '  const source = rawSource === "linear" || rawSource === "reconcile" || rawSource === "auto-posted" ? rawSource : "ui";';
const NOTE = '  // "auto-posted": the calendar-auto-posted timer (OPEN_REPAIRS 395). Live delta, scripts/calendar-upsert-live-delta.js.';

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

const REPO_ROOT = path.resolve(__dirname, '..');
const GATE = 'authorizeBrowserWrite';

function insideRepo(dir) {
  const real = (p) => { try { return fs.realpathSync(p); } catch (_e) { return path.resolve(p); } };
  const target = path.resolve(dir);
  let probe = target;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const resolved = path.join(real(probe), path.relative(probe, target));
  const rel = path.relative(real(REPO_ROOT), resolved);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function parseArgs(argv) {
  const out = { positional: [], check: false, expectSha: '' };
  for (const a of argv) {
    if (a === '--check') out.check = true;
    else if (a.startsWith('--expect-sha=')) out.expectSha = a.slice('--expect-sha='.length).trim().toLowerCase();
    else out.positional.push(a);
  }
  return out;
}

function liveFiles(input) {
  const live = JSON.parse(fs.readFileSync(input, 'utf8'));
  const files = Array.isArray(live.files) ? live.files : [];
  const entry = files.find(f => /(^|\/)calendar-upsert\/index\.ts$/.test(String(f.name || '')));
  if (!entry) throw new Error('no calendar-upsert/index.ts in the live JSON');
  if (files.some(f => String(f.content || '').includes(GATE))) {
    throw new Error(GATE + ' found in the input: that is the repo\'s gated source, not the live function');
  }
  return { live, files, entry };
}

function main(argv) {
  const args = parseArgs(argv);
  if (!/^[0-9a-f]{64}$/.test(args.expectSha)) {
    console.error('usage: node scripts/calendar-upsert-live-delta.js <live.json> <out-dir> --expect-sha=<before-hash>');
    console.error('       node scripts/calendar-upsert-live-delta.js --check <live-after.json> --expect-sha=<after-hash>');
    return 2;
  }
  if (args.check) {
    const [input] = args.positional;
    if (!input) { console.error('--check needs the re-read live JSON'); return 2; }
    const { live, entry } = liveFiles(input);
    const got = sha(String(entry.content));
    if (got !== args.expectSha) throw new Error(`live index.ts sha256 ${got} is not the expected after-hash ${args.expectSha}`);
    if (!String(entry.content).includes(PATCHED)) throw new Error('live index.ts does not carry the auto-posted line');
    if (live.verify_jwt !== false) throw new Error('live verify_jwt is ' + JSON.stringify(live.verify_jwt) + ', it must be false');
    console.log(`CHECK OK: live version ${live.version || '?'} index.ts sha256 ${got} equals the after-hash; verify_jwt false`);
    return 0;
  }
  const [input, outDir] = args.positional;
  if (!input || !outDir) { console.error('need <live.json> and <out-dir>'); return 2; }
  if (insideRepo(outDir)) throw new Error('out-dir is inside the repository; write it outside (for example a scratch folder)');
  const { live, files, entry } = liveFiles(input);
  const before = sha(String(entry.content));
  if (before !== args.expectSha) throw new Error(`live index.ts sha256 ${before} is not the expected ${args.expectSha}; the live source changed, re-derive the delta by hand`);
  const { text, changed } = applyDelta(entry.content);
  if (!changed) throw new Error('the input already carries the delta; nothing to deploy');
  for (const f of files) {
    const name = String(f.name || '');
    if (!name || name.includes('..') || path.isAbsolute(name)) throw new Error('refusing file name ' + JSON.stringify(name));
    const target = path.join(outDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, f === entry ? text : String(f.content));
  }
  console.log(`live version ${live.version || '?'}; index.ts sha256 before ${before} (matches --expect-sha)`);
  console.log(`index.ts sha256 after  ${sha(text)}`);
  console.log(`wrote ${files.length} file(s) under ${outDir}; deploy them with deploy_edge_function, verify_jwt: false`);
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (e) { console.error('refused: ' + e.message); process.exitCode = 1; }
}

module.exports = { ANCHOR, PATCHED, applyDelta, insideRepo, main };
