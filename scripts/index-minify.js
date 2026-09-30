'use strict';
/*
 * index-minify.js -- shrinks the served parts (js/sv-NN-*.js) when
 * src/index/split.json says "minify": true. Owner decision 2026-09-29:
 * compress first, real modules later.
 *
 * The parts are classic scripts that share ONE global scope (a function
 * declared in one is called by name from another, and inline handlers look
 * their function up by name), so this must never rename a top-level name.
 * esbuild's transform, given no output format, leaves top-level names alone
 * and renames only what is local to a function; scripts/check-modules.js
 * (rule 9) proves it on every build by parsing the minified output and
 * requiring every top-level name of the unminified script to still be
 * declared. What is not shrunk on purpose: `js/sv-full-*.js`, which is the
 * whole script, readable, for the forms, for `?split=0` (a per-browser way
 * back that is also the way to debug a problem in the readable code), and
 * for the way back for everyone (`node scripts/split-switch.js minify off`).
 *
 * The build needs esbuild at ONE pinned version, so the output is the same
 * on every machine and check-index can compare it byte for byte. package.json
 * is content-pinned, so esbuild is not a dependency: it is found on NODE_PATH
 * or in a cache folder, and installed there on first use (needs npm and a
 * network the first time only).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ESBUILD_VERSION = '0.25.10';
const CACHE = path.join(process.env.SYNCVIEW_BUILD_CACHE || path.join(os.homedir(), '.cache', 'syncview-build'));
// es2020: widely supported everywhere the app already runs; anything newer in
// the source is rewritten rather than left for an older browser to choke on.
const OPTIONS = { minify: true, target: 'es2020', legalComments: 'none', charset: 'utf8', logLevel: 'error' };

let cached = null;
function tryLoad() {
  const spots = [null, path.join(CACHE, 'node_modules', 'esbuild')];
  for (const spot of spots) {
    try {
      const e = spot ? require(spot) : require('esbuild');
      if (e.version === ESBUILD_VERSION) return e;
    } catch (err) { /* try the next place */ }
  }
  return null;
}

// install=false: return null instead of installing (tests and probes).
function loadEsbuild({ install = true } = {}) {
  if (cached) return cached;
  cached = tryLoad();
  if (!cached && install) {
    fs.mkdirSync(CACHE, { recursive: true });
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const r = spawnSync(npm, ['install', '--no-save', '--no-package-lock', '--no-audit', '--no-fund', '--prefix', CACHE, `esbuild@${ESBUILD_VERSION}`], { stdio: 'inherit', shell: process.platform === 'win32' });
    if (r.status === 0) cached = tryLoad();
  }
  if (!cached && install) {
    throw new Error(`index-minify: esbuild ${ESBUILD_VERSION} is not available and could not be installed into ${CACHE}. `
      + 'Install it (npm install --no-save --prefix <dir> esbuild@' + ESBUILD_VERSION + ' and put <dir>/node_modules on NODE_PATH), '
      + 'or set "minify": false in src/index/split.json (node scripts/split-switch.js minify off).');
  }
  return cached;
}

// Buffer in, Buffer out.
function minifyScript(buf) {
  const esbuild = loadEsbuild();
  return Buffer.from(esbuild.transformSync(buf.toString('utf8'), OPTIONS).code);
}

module.exports = { ESBUILD_VERSION, loadEsbuild, minifyScript };
