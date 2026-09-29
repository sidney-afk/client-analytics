'use strict';
/*
 * split-switch.js -- the one-step switch for the load-per-tab split.
 * Plan: docs/plans/2026-09-28-load-per-tab-plan.md, step 4.
 *
 *   node scripts/split-switch.js status   # print the current state
 *   node scripts/split-switch.js off      # THE WAY BACK: everyone gets the single file again
 *   node scripts/split-switch.js on       # staff get the split parts (clients keep the single file)
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
function render(cfg, enabled) {
  const lazy = Array.isArray(cfg.lazy) ? `,\n  "lazy": ${JSON.stringify(cfg.lazy).replace(/","/g, '", "')}` : '';
  return `{\n  "enabled": ${enabled}${lazy}\n}\n`;
}
function setEnabled(enabled) { fs.writeFileSync(CONFIG, render(read(), enabled)); }

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'status') {
    const cfg = read();
    console.log(`split: ${cfg.enabled ? 'ON (staff get parts, everyone else the single file)' : 'OFF (everyone gets the single file)'}; on demand: ${(cfg.lazy || []).join(', ') || 'none'}`);
  } else if (cmd === 'on' || cmd === 'off') {
    setEnabled(cmd === 'on');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-index.js')], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status || 1);
    console.log(`split-switch: ${cmd.toUpperCase()}. Commit src/index/split.json, index.html, src/index/INDEX.md${cmd === 'on' ? ' and js/' : ''} and push to main.`);
  } else {
    console.error('Usage: node scripts/split-switch.js status|on|off');
    process.exit(2);
  }
}

module.exports = { read, render, setEnabled };
