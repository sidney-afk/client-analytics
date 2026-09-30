'use strict';
/*
 * single-file-index.js -- a preload (node --require) that keeps every test and
 * script that reads the app's code out of index.html working while the split
 * switch is on.
 *
 * Plan: docs/plans/2026-09-28-load-per-tab-plan.md, step 4. With
 * src/index/split.json on, the committed index.html is a small page plus a
 * loader, and the code is served from js/. Several hundred suites (and a few
 * QA scripts) extract functions, and one fingerprints the leave-page lines,
 * by reading the WHOLE app from index.html. This preload answers a read of the
 * repository's index.html with the plain concatenation of the fragments, the
 * exact bytes index.html held before the switch existed (less the generated
 * window export blocks the modules end with, which change no behaviour and
 * would only stale fingerprints and break sandboxed evals), so those checks see
 * the same source as ever. It touches nothing else: a browser test that SERVES
 * index.html from disk gets the real loader page and the real js/ files, which
 * is the point of testing them.
 *
 * With the switch off it does nothing (index.html already is that file).
 * Enabled by test/run-all.js for every suite it spawns; a suite run by hand
 * or a CI step that reads index.html should use:
 *   node --require ./test/helpers/single-file-index.js <file>
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'index.html');
const SRC = path.join(ROOT, 'src', 'index');

let cached = null;
function singleFile() {
  if (cached) return cached;
  const orig = fs.readFileSync;
  const { readModuleList, servedBytes, stripWindowBlock } = require(path.join(ROOT, 'scripts', 'index-modules'));
  const entries = orig(path.join(SRC, 'manifest.txt'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  const modules = readModuleList(SRC);
  cached = Buffer.concat(entries.map(e => {
    const bytes = servedBytes(e, orig(path.join(SRC, e)), modules);
    return modules.has(e) ? Buffer.from(stripWindowBlock(bytes.toString('utf8'))) : bytes;
  }));
  return cached;
}
function splitOn() {
  try { return JSON.parse(fs.readFileSync(path.join(SRC, 'split.json'), 'utf8')).enabled === true; } catch (e) { return false; }
}
const isIndex = p => {
  if (typeof p !== 'string' && !(p instanceof URL) && !Buffer.isBuffer(p)) return false;
  try { return path.resolve(String(p instanceof URL ? p.pathname : p)) === INDEX; } catch (e) { return false; }
};
const encode = (buf, opt) => {
  const enc = typeof opt === 'string' ? opt : opt && opt.encoding;
  return enc ? buf.toString(enc) : Buffer.from(buf);
};

if (splitOn()) {
  const readFileSync = fs.readFileSync;
  fs.readFileSync = function (p, opt) { return isIndex(p) ? encode(singleFile(), opt) : readFileSync.apply(this, arguments); };
  const readFile = fs.readFile;
  fs.readFile = function (p, opt, cb) {
    if (isIndex(p)) { const done = typeof opt === 'function' ? opt : cb; setImmediate(() => done(null, encode(singleFile(), typeof opt === 'function' ? undefined : opt))); return; }
    return readFile.apply(this, arguments);
  };
  const pr = fs.promises.readFile;
  fs.promises.readFile = function (p, opt) { return isIndex(p) ? Promise.resolve(encode(singleFile(), opt)) : pr.apply(this, arguments); };
}
