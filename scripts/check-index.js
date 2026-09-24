'use strict';
/*
 * check-index.js — proves index.html is exactly the assembly of src/index/
 * fragments, without writing anything.
 *
 * Reads src/index/manifest.txt, reads each listed fragment as a raw Buffer,
 * concatenates them in memory with no separators (never decoding, trimming
 * or re-encoding), and requires that result to be byte-for-byte identical to
 * BOTH:
 *   - the working-tree index.html, and
 *   - the committed blob at `git show HEAD:index.html`.
 *
 * Fails (and prints why) on: a manifest entry naming a missing fragment, a
 * duplicate manifest entry, a `.part` file present in src/index/ but not
 * listed in the manifest, or a manifest entry that points outside
 * src/index/. manifest.txt and INDEX.md are metadata — never part of the
 * assembled output and never subject to fragment coverage checks.
 *
 * On success, prints the full SHA-256 and byte length of each of the three
 * compared values (assembled, working tree, committed) as evidence. These
 * hashes are diagnostic output only — never a frozen baseline and never an
 * additional constraint beyond the three-way equality above.
 *
 * Usage: node scripts/check-index.js
 */

const fs = require('fs');
const { readModuleList, servedBytes } = require('./index-modules');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'src', 'index');
const MANIFEST_PATH = path.join(SRC_DIR, 'manifest.txt');
const WORKING_TREE_PATH = path.join(ROOT, 'index.html');

let failed = false;
function fail(message) {
  console.error('check-index: FAIL — ' + message);
  failed = true;
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    fail('manifest not found at src/index/manifest.txt');
    return [];
  }
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  return raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

function validateManifest(entries) {
  const seen = new Set();
  const readable = new Set();
  for (const entry of entries) {
    const isOutOfFolder =
      entry.includes('/') || entry.includes('\\') || entry.includes('..') ||
      path.dirname(path.join(SRC_DIR, entry)) !== SRC_DIR;
    if (isOutOfFolder) {
      fail('out-of-folder fragment path in manifest: ' + entry);
      continue;
    }
    if (seen.has(entry)) {
      fail('duplicate fragment in manifest: ' + entry);
      continue;
    }
    seen.add(entry);
    if (!fs.existsSync(path.join(SRC_DIR, entry))) {
      fail('missing fragment listed in manifest: ' + entry);
      continue;
    }
    readable.add(entry);
  }

  let onDisk = [];
  try {
    onDisk = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.part'));
  } catch (e) {
    fail('could not read src/index/: ' + e.message);
  }
  for (const f of onDisk) {
    if (!seen.has(f)) fail('unlisted fragment present in src/index/ but not in manifest.txt: ' + f);
  }

  return readable;
}

function assembleFromManifest(entries, readable) {
  const bufs = [];
  // Module fragments (src/index/modules.txt) are served without their import
  // header and export footer, exactly as build-index.js assembles them.
  const modules = readModuleList(SRC_DIR);
  for (const m of modules) if (!entries.includes(m)) fail('modules.txt lists a fragment that is not in the manifest: ' + m);
  for (const entry of entries) {
    if (!readable.has(entry)) continue; // already failed for this entry above
    bufs.push(servedBytes(entry, fs.readFileSync(path.join(SRC_DIR, entry)), modules));
  }
  return Buffer.concat(bufs);
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function report(label, buf) {
  console.log(`check-index: ${label} — sha256=${sha256(buf)} bytes=${buf.length}`);
}

function main() {
  const entries = readManifest();
  const knownGood = validateManifest(entries);

  const assembled = assembleFromManifest(entries, knownGood);

  if (!fs.existsSync(WORKING_TREE_PATH)) {
    fail('working-tree index.html not found at repository root');
  }
  const workingTree = fs.existsSync(WORKING_TREE_PATH) ? fs.readFileSync(WORKING_TREE_PATH) : Buffer.alloc(0);

  let committed;
  try {
    committed = execFileSync('git', ['show', 'HEAD:index.html'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    fail('could not read committed index.html via `git show HEAD:index.html`: ' + e.message);
    committed = Buffer.alloc(0);
  }

  report('assembled bytes', assembled);
  report('working-tree index.html', workingTree);
  report('committed index.html (HEAD)', committed);

  if (!assembled.equals(workingTree)) {
    fail('assembled bytes do not equal working-tree index.html');
  }
  if (!assembled.equals(committed)) {
    fail('assembled bytes do not equal committed index.html (HEAD)');
  }
  if (!workingTree.equals(committed)) {
    fail('working-tree index.html does not equal committed index.html (HEAD)');
  }

  if (failed) {
    console.error('\ncheck-index: FAILED');
    process.exit(1);
  }
  console.log('\ncheck-index: OK — assembled == working tree == committed (HEAD)');
}

main();
