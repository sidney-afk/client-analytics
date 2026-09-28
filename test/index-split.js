'use strict';
/* index-split.js -- the split build (scripts/index-split.js) serves the same
 * code, and the switch-off build is the plain concatenation.
 * Plan: docs/plans/2026-09-28-load-per-tab-plan.md, step 2. */
const fs = require('fs');
const path = require('path');
const { readModuleList, servedBytes } = require('../scripts/index-modules');
const { buildOutputs, readSplitConfig } = require('../scripts/index-split');

const SRC = path.join(__dirname, '..', 'src', 'index');
let failed = 0;
const t = (ok, msg) => { console.log((ok ? '  ok  ' : '  ❌  ') + msg); if (!ok) failed++; };

const entries = fs.readFileSync(path.join(SRC, 'manifest.txt'), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
const bufs = entries.map(e => fs.readFileSync(path.join(SRC, e)));
const modules = readModuleList(SRC);
const served = entries.map((e, i) => servedBytes(e, bufs[i], modules));
const concat = Buffer.concat(served);
const jsIdx = entries.map((e, i) => (e.endsWith('.js.part') ? i : -1)).filter(i => i >= 0);
const script = Buffer.concat(jsIdx.map(i => served[i]));
const markerOf = name => Buffer.from(`\n;(self.__svParts || (self.__svParts = [])).push(${JSON.stringify(name)});\n`);
const strip = (name, buf) => {
  const m = markerOf(name);
  return buf.subarray(buf.length - m.length).equals(m) ? buf.subarray(0, buf.length - m.length) : null;
};

const cfg = readSplitConfig(SRC);
t(typeof cfg.enabled === 'boolean', 'split.json has an on/off "enabled"');
if (!cfg.enabled) {
  const off = buildOutputs(SRC, entries, bufs, modules, null);
  t(off.size === 1 && off.get('index.html').equals(concat), 'switch off: index.html is exactly the fragments concatenated, nothing else written');
}

for (const force of ['split', 'parts']) {
  const out = buildOutputs(SRC, entries, bufs, modules, force);
  const html = out.get('index.html').toString('utf8');
  const files = [...out.keys()].filter(k => k !== 'index.html');
  const full = files.find(f => /^js\/sv-full-[0-9a-f]{12}\.js$/.test(f));
  const parts = files.filter(f => /^js\/sv-\d\d-[a-z-]+-[0-9a-f]{12}\.js$/.test(f)).sort();
  t(!!full && strip(full, out.get(full)) && strip(full, out.get(full)).equals(script), `${force}: the full file is the inline script, byte for byte, plus its ran-marker`);
  t(Buffer.concat(parts.map(p => strip(p, out.get(p)))).equals(script), `${force}: the parts, in order, are the same script, byte for byte`);
  t(files.length === parts.length + 1, `${force}: nothing else is written to js/`);
  const htmlBuf = out.get('index.html');
  const head = Buffer.concat(served.slice(0, jsIdx[0]));
  t(htmlBuf.subarray(0, head.length).equals(head) && htmlBuf.indexOf('    /* SyncView loader.') === head.length,
    `${force}: every byte before the main script is unchanged, and the loader sits where the script began`);
  t(html.endsWith(Buffer.concat(served.slice(jsIdx[jsIdx.length - 1] + 1)).toString('utf8')), `${force}: every byte after the main script is unchanged`);
  t(parts.every(p => html.includes(JSON.stringify(p))) && html.includes(JSON.stringify(full)), `${force}: the loader names every file`);
  t(/var FORCE = (null|"parts");/.test(html) && (force === 'parts') === html.includes('var FORCE = "parts";'), `${force}: only --force-split=parts sends everyone the parts`);
}

if (failed) { console.error(`index-split: ${failed} check(s) failed`); process.exit(1); }
console.log('index-split: all checks passed');
