'use strict';
/*
 * split-switch.js -- the one-step switch for the load-per-tab split.
 * Plan: docs/plans/2026-09-28-load-per-tab-plan.md, step 4.
 *
 *   node scripts/split-switch.js status   # print the current state
 *   node scripts/split-switch.js off      # THE WAY BACK: everyone gets the single file again
 *   node scripts/split-switch.js on       # staff (and client links, when clients is on) get the split parts
 *   node scripts/split-switch.js clients on|off   # client share links get the parts / the single file (step 5)
 *   node scripts/split-switch.js minify on|off    # the parts are shrunk / served readable (owner decision 2026-09-29)
 *
 * It sets "enabled" in src/index/split.json (nothing else in that file changes)
 * and rebuilds, so index.html, src/index/INDEX.md and, when on, js/ come out
 * exactly as `npm run build:index` writes them. Then commit those and push to
 * main; GitHub Pages serves the result within a few minutes.
 *
 * Turning it off leaves the js/ files where they are on purpose: a browser
 * holding the previous index.html may still ask for them (see
 * scripts/prune-split-js.js for cleaning them out later). Off makes index.html
 * the plain concatenation of the fragments again, byte for byte.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'src', 'index', 'split.json');

function read() { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); }
// The file's text for a config: enabled, then the on-demand list, one line each.
function render(cfg, enabled, clients = cfg.clients, minify = cfg.minify) {
  const lazy = Array.isArray(cfg.lazy) ? `,\n  "lazy": ${JSON.stringify(cfg.lazy).replace(/","/g, '", "')}` : '';
  const cl = typeof clients === 'boolean' ? `,\n  "clients": ${clients}` : '';
  const mn = typeof minify === 'boolean' ? `,\n  "minify": ${minify}` : '';
  return `{\n  "enabled": ${enabled}${lazy}${cl}${mn}\n}\n`;
}
function setEnabled(enabled) { fs.writeFileSync(CONFIG, render(read(), enabled)); }
function setClients(clients) { const cfg = read(); fs.writeFileSync(CONFIG, render(cfg, cfg.enabled, clients)); }
function setMinify(minify) { const cfg = read(); fs.writeFileSync(CONFIG, render(cfg, cfg.enabled, cfg.clients, minify)); }

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'status') {
    const cfg = read();
    console.log(`split: ${cfg.enabled ? `ON (staff get parts, client links ${cfg.clients ? 'get parts' : 'keep the single file'}, forms and signed-out visitors the single file)` : 'OFF (everyone gets the single file)'}; on demand: ${(cfg.lazy || []).join(', ') || 'none'}; parts ${cfg.minify ? 'MINIFIED (sv-full and ?split=0 stay readable)' : 'readable'}`);
  } else if (cmd === 'clients' && (process.argv[3] === 'on' || process.argv[3] === 'off')) {
    setClients(process.argv[3] === 'on');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-index.js')], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
    console.log(`split-switch: client links ${process.argv[3].toUpperCase()}. Commit src/index/split.json, index.html, src/index/INDEX.md and js/ and push to main.`);
  } else if (cmd === 'minify' && (process.argv[3] === 'on' || process.argv[3] === 'off')) {
    setMinify(process.argv[3] === 'on');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-index.js')], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
    console.log(`split-switch: minify ${process.argv[3].toUpperCase()}. Commit src/index/split.json, index.html, src/index/INDEX.md and js/ and push to main.`);
  } else if (cmd === 'on' || cmd === 'off') {
    setEnabled(cmd === 'on');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-index.js')], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
    console.log(`split-switch: ${cmd.toUpperCase()}. Commit src/index/split.json, index.html, src/index/INDEX.md${cmd === 'on' ? ' and js/' : ''} and push to main.`);
  } else {
    console.error('Usage: node scripts/split-switch.js status|on|off|clients on|clients off|minify on|minify off');
    process.exit(2);
  }
}

module.exports = { read, render, setEnabled, setClients, setMinify };
