'use strict';
/*
 * Linear is retired (2026-09-24): a Calendar/Samples component is linked only
 * by its SyncView deliverable id (_calCompLinked). The live nightly probes seed
 * test-client cards with Linear URLs to make components linked; without a
 * deliverable id beside each URL those components now read N/A and the probes
 * go red for the wrong reason (p92 did exactly this, see
 * test/p92-probe-seeds-a-linked-component.js). This checks, offline, that every
 * non-empty Linear URL a probe seeds carries the matching deliverable id.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PROBES = [
  'qa/probes/ot_temporal_client_combo.js', 'qa/probes/ot_temporal_kasper.js', 'qa/probes/p34_set_all.js',
  'qa/probes/p60_modal_smm.js', 'qa/probes/p88_realtime_handler.js', 'qa/probes/parity_logic.js',
  'qa/probes/sxr_client_persist_guard.js', 'qa/probes/sxr_concurrency.js', 'qa/probes/sxr_gating_flags.js',
  'qa/probes/sxr_kasper_audit_holes.js', 'qa/probes/sxr_realtime_twin.js', 'qa/scenario_engine.js', 'qa/scenarios.js',
];
// isArchivedRef cases in parity_logic deliberately match by the Linear URL alone.
const EXEMPT = /_calIsArchivedRef\(/;
let failures = 0;
for (const rel of PROBES) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const lines = src.split('\n');
  let seeds = 0;
  lines.forEach((line, i) => {
    if (EXEMPT.test(line)) return;
    for (const [urlKey, idKey] of [['graphic_linear_issue_id', 'graphic_deliverable_id'], ['linear_issue_id', 'video_deliverable_id']]) {
      const re = new RegExp('(?<![A-Za-z_.])' + urlKey + ":\\s*['\"`]https?://", 'g');
      if (!re.test(line)) continue;
      seeds++;
      const near = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
      if (!new RegExp('\\b' + idKey + '\\s*:').test(near)) {
        failures++;
        console.error('FAIL  ' + rel + ':' + (i + 1) + ' seeds ' + urlKey + ' with no ' + idKey);
      }
    }
  });
  console.log('  ok  ' + rel + ' (' + seeds + ' linked seed' + (seeds === 1 ? '' : 's') + ')');
  if (!seeds) { failures++; console.error('FAIL  ' + rel + ' has no linked seed: is this list stale?'); }
}
if (failures) { console.error(failures + ' failure(s)'); process.exit(1); }
console.log('probes-seed-deliverable-ids: ok');
