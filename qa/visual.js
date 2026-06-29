'use strict';
/*
 * qa/visual.js — the "eyes" half of the master tester.
 *
 * The browser lanes already CAPTURE screenshots (the scenario engine shoots a
 * frame after each step). This module turns a directory of those shots into a
 * structured manifest + a human/Claude review checklist, so the VISION pass can
 * judge each frame on two axes:
 *   1. Does it LOOK right?  layout, overlap, alignment, broken/missing media.
 *   2. Did it DO the right thing?  the screen reflects what the action produced.
 *
 * Shots are named `${scenarioKey}-${NN}-${label}.png` by scenario_engine.js.
 * This module is intentionally pure fs/string work (no browser) so it is fast
 * and unit-testable; master.js calls it after the visual capture lane runs.
 */
const fs = require('fs');
const path = require('path');

// Scan a shot directory → [{ scenario, shots: [{step,label,file,path}] }]
function buildManifest(shotDir) {
  let files = [];
  try { files = fs.readdirSync(shotDir).filter(f => f.endsWith('.png')).sort(); } catch { return []; }
  const byScn = {};
  for (const f of files) {
    const m = f.match(/^(.*)-(\d+)-(.*)\.png$/);
    if (!m) continue;
    const [, key, step, label] = m;
    (byScn[key] = byScn[key] || []).push({ step: Number(step), label, file: f, path: path.join(shotDir, f) });
  }
  return Object.keys(byScn).sort().map(key => ({
    scenario: key,
    shots: byScn[key].sort((a, b) => a.step - b.step),
  }));
}

function renderReviewDoc(manifest, changeNote) {
  const L = [];
  L.push('# Visual review — master tester');
  L.push('');
  if (changeNote) { L.push(`> **What changed (focus the eyes here):** ${changeNote}`); L.push(''); }
  L.push('Screenshots captured by the `visual` lane. For each shot, the reviewer');
  L.push('(a human, or Claude via the `/master-test` skill) judges TWO things:');
  L.push('');
  L.push('1. **Does it LOOK right?** layout, overlap, alignment, broken/missing media, ugly states.');
  L.push('2. **Did it DO the right thing?** the screen reflects what the action should have produced.');
  L.push('');
  L.push('Mark each ✅ / ⚠️ / ❌ and note anything off (the shot path is given).');
  L.push('');
  for (const s of manifest) {
    L.push(`## ${s.scenario}`);
    for (const sh of s.shots) {
      L.push(`- [ ] step ${String(sh.step).padStart(2, '0')} · **${sh.label}** — \`${sh.path}\``);
    }
    L.push('');
  }
  return L.join('\n');
}

// Build the manifest from shotDir and persist manifest.json + VISUAL_REVIEW.md
// under outDir. Returns the manifest (and shot count via .length on shots).
function writeArtifacts(shotDir, outDir, changeNote) {
  const manifest = buildManifest(shotDir);
  try {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'manifest.json'),
      JSON.stringify({ shotDir, changeNote: changeNote || '', generatedFor: 'master visual lane', flows: manifest }, null, 2));
    fs.writeFileSync(path.join(outDir, 'VISUAL_REVIEW.md'), renderReviewDoc(manifest, changeNote));
  } catch {}
  return manifest;
}

function countShots(manifest) { return manifest.reduce((n, s) => n + s.shots.length, 0); }

module.exports = { buildManifest, renderReviewDoc, writeArtifacts, countShots };
