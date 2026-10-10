#!/usr/bin/env node
'use strict';
/*
 * calendar-upsert: the ONE-LINE live delta for the auto-posted timer (OPEN_REPAIRS 402).
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
 * THE DEPLOY ROUTE is the manual GitHub Actions lane .github/workflows/calendar-upsert-live-delta.yml
 * (workflow_dispatch only, production environment, typed confirmation). It downloads the LIVE
 * function with `supabase functions download` into a folder outside the checkout, records every
 * file's sha256, refuses unless the live verify_jwt is false, runs --dir-apply below, deploys ONLY
 * that patched copy with --no-verify-jwt, downloads again and runs --dir-verify, and redeploys the
 * downloaded original if the deploy or the verification fails. If live already carries the delta it
 * says "already applied" and deploys nothing. Nothing hand-copies the source any more, and there is
 * no route that deploys the repo's supabase/functions/calendar-upsert (it re-gates client links and
 * brought back the 401 outage on every client review link, 2026-07-15, twice).
 *
 * Hashes (measured from live v83, 2026-10-10): before
 * 67511f6763a2e3b7edd951ce473e5b3fa878c53cbf4d25e2efd564d3f2e91185; after (with the OPEN_REPAIRS 402
 * note line) 7312f7fc5fbbd3cbcc805800f56a447bef6cd1ac009164b6d3d701f7b6dff843. They are the lane's
 * input defaults.
 *
 * Modes:
 *   Directory modes (used by the lane; hashes and paths only, never source text): --snapshot,
 *   --dir-state, --dir-apply, --dir-verify; documented beside dirMain below.
 *   JSON modes (a live JSON saved from Supabase MCP get_edge_function, for a read-only look):
 *     node scripts/calendar-upsert-live-delta.js <live.json> <out-dir> --expect-sha=<before-hash>
 *     node scripts/calendar-upsert-live-delta.js --check <live-after.json> --expect-sha=<after-hash>
 *   Every mode refuses a folder inside this repository and any input carrying authorizeBrowserWrite.
 * Rollback: the lane does it by itself; by hand, redeploy the downloaded original with --no-verify-jwt.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ANCHOR = '  const source = rawSource === "linear" || rawSource === "reconcile" ? rawSource : "ui";';
const PATCHED = '  const source = rawSource === "linear" || rawSource === "reconcile" || rawSource === "auto-posted" ? rawSource : "ui";';
const NOTE = '  // "auto-posted": the calendar-auto-posted timer (OPEN_REPAIRS 402). Live delta, scripts/calendar-upsert-live-delta.js.';

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

// ---------------------------------------------------------------------------
// Directory modes, used by .github/workflows/calendar-upsert-live-delta.yml on a
// LIVE copy downloaded with `supabase functions download` into a folder outside
// the checkout. They print hashes and paths only, never source text.
//
//   --snapshot <dir>                          JSON {files:{relative path: sha256}}
//   --dir-state <dir> --expect-sha=<before> --expect-after=<after>
//                                             prints "before" or "after", else refuses
//   --dir-apply <live-dir> <out-dir> --expect-sha=<before> --expect-after=<after>
//                                             copies the tree, applies the delta to the
//                                             one calendar-upsert/index.ts, refuses unless
//                                             it hashes to <after>
//   --dir-verify <dir> --snapshot=<file> --expect-after=<after>
//                                             index.ts is <after>, every other file is
//                                             byte-identical to the snapshot, no file
//                                             added or lost
// Every mode refuses a folder inside this repository and any tree that contains
// authorizeBrowserWrite (the repo's gated source).
const ENTRY = 'supabase/functions/calendar-upsert/index.ts';
const CONFIG_STUB = 'supabase/config.toml';

function fileSha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(dir) {
  const out = [];
  const visit = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const full = path.join(abs, entry.name);
      if (entry.isSymbolicLink()) throw new Error('refusing a symbolic link in the live tree: ' + path.relative(dir, full));
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        const rel = path.relative(dir, full).split(path.sep).join('/');
        // The CLI's project stub, written by the lane so download and deploy run; not function source.
        if (rel !== CONFIG_STUB) out.push(rel);
      }
    }
  };
  visit(dir);
  return out.sort();
}

function liveTree(dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('not a directory: ' + dir);
  if (insideRepo(dir)) throw new Error('the live tree must sit outside the repository');
  const files = walk(dir);
  const sources = files.filter(f => /\.(ts|tsx|js|mjs|json)$/.test(f));
  for (const f of sources) {
    if (fs.readFileSync(path.join(dir, f), 'utf8').includes(GATE)) throw new Error(GATE + ' found in ' + f + ': that is the repo\'s gated source, not the live function');
  }
  const entries = files.filter(f => /(^|\/)calendar-upsert\/index\.ts$/.test(f));
  if (entries.length !== 1 || entries[0] !== ENTRY) {
    throw new Error('expected exactly one entrypoint at ' + ENTRY + ', found ' + JSON.stringify(entries) + ' among ' + files.length + ' file(s)');
  }
  // Every relative import of the entrypoint must resolve inside the downloaded tree.
  const entryText = fs.readFileSync(path.join(dir, ENTRY), 'utf8');
  const rel = [...entryText.matchAll(/\bfrom\s*["'](\.[^"']+)["']/g)].map(m => m[1]);
  for (const spec of rel) {
    const target = path.relative(dir, path.resolve(path.dirname(path.join(dir, ENTRY)), spec)).split(path.sep).join('/');
    if (!files.includes(target)) throw new Error('the live entrypoint imports ' + spec + ', which is not in the downloaded tree');
  }
  return files;
}

function snapshot(dir) {
  const files = liveTree(dir);
  const out = {};
  for (const f of files) out[f] = fileSha(path.join(dir, f));
  return out;
}

function dirArgs(argv) {
  const out = { positional: [], expectSha: '', expectAfter: '', snapshot: '' };
  for (const a of argv) {
    if (a.startsWith('--expect-sha=')) out.expectSha = a.slice(13).trim().toLowerCase();
    else if (a.startsWith('--expect-after=')) out.expectAfter = a.slice(15).trim().toLowerCase();
    else if (a.startsWith('--snapshot=')) out.snapshot = a.slice(11);
    else out.positional.push(a);
  }
  return out;
}

const HEX64 = /^[0-9a-f]{64}$/;

function dirMain(mode, argv) {
  const a = dirArgs(argv);
  if (mode === '--snapshot') {
    console.log(JSON.stringify({ files: snapshot(a.positional[0]) }, null, 2));
    return 0;
  }
  if (mode === '--dir-state') {
    if (!HEX64.test(a.expectSha) || !HEX64.test(a.expectAfter)) throw new Error('--dir-state needs --expect-sha and --expect-after');
    liveTree(a.positional[0]);
    const got = fileSha(path.join(a.positional[0], ENTRY));
    if (got === a.expectAfter) { console.log('after'); return 0; }
    if (got === a.expectSha) { console.log('before'); return 0; }
    throw new Error(`live index.ts sha256 ${got} is neither the expected before-hash nor the after-hash; re-derive the delta by hand`);
  }
  if (mode === '--dir-apply') {
    const [liveDir, outDir] = a.positional;
    if (!HEX64.test(a.expectSha) || !HEX64.test(a.expectAfter)) throw new Error('--dir-apply needs --expect-sha and --expect-after');
    if (!outDir) throw new Error('--dir-apply needs <live-dir> <out-dir>');
    if (insideRepo(outDir)) throw new Error('out-dir is inside the repository');
    if (fs.existsSync(outDir) && walk(outDir).length) throw new Error('out-dir must be new or hold only the CLI project stub');
    const files = liveTree(liveDir);
    const before = fileSha(path.join(liveDir, ENTRY));
    if (before !== a.expectSha) throw new Error(`live index.ts sha256 ${before} is not the expected ${a.expectSha}`);
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(outDir, f)), { recursive: true });
      fs.copyFileSync(path.join(liveDir, f), path.join(outDir, f));
    }
    const { text, changed } = applyDelta(fs.readFileSync(path.join(liveDir, ENTRY), 'utf8'));
    if (!changed) throw new Error('the live source already carries the delta');
    fs.writeFileSync(path.join(outDir, ENTRY), text);
    const after = fileSha(path.join(outDir, ENTRY));
    console.log(`index.ts sha256 before ${before}`);
    console.log(`index.ts sha256 after  ${after}`);
    if (after !== a.expectAfter) throw new Error(`patched index.ts sha256 ${after} is not the expected after-hash ${a.expectAfter}`);
    liveTree(outDir);
    return 0;
  }
  if (mode === '--dir-verify') {
    if (!HEX64.test(a.expectAfter) || !a.snapshot) throw new Error('--dir-verify needs --snapshot=<file> and --expect-after');
    const before = JSON.parse(fs.readFileSync(a.snapshot, 'utf8')).files || {};
    const now = snapshot(a.positional[0]);
    const problems = [];
    if (now[ENTRY] !== a.expectAfter) problems.push(`index.ts is ${now[ENTRY]}, expected ${a.expectAfter}`);
    for (const f of new Set([...Object.keys(before), ...Object.keys(now)])) {
      if (f === ENTRY) continue;
      if (!(f in now)) problems.push('missing after deploy: ' + f);
      else if (!(f in before)) problems.push('new after deploy: ' + f);
      else if (now[f] !== before[f]) problems.push('changed after deploy: ' + f);
    }
    if (problems.length) throw new Error('live verification failed: ' + problems.join('; '));
    console.log(`VERIFY OK: index.ts ${now[ENTRY]}; ${Object.keys(now).length - 1} other file(s) byte-identical to the pre-deploy download`);
    return 0;
  }
  throw new Error('unknown mode ' + mode);
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  try { process.exitCode = /^--(snapshot|dir-)/.test(argv[0] || '') ? dirMain(argv[0], argv.slice(1)) : main(argv); }
  catch (e) { console.error('refused: ' + e.message); process.exitCode = 1; }
}

module.exports = { ANCHOR, PATCHED, ENTRY, applyDelta, insideRepo, main, dirMain, snapshot };
