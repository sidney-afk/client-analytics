'use strict';
/*
 * Why the calendar nightly went red, proven by running the rule it tripped on.
 *
 * p92 asserts that resolving the last change-request flips the sheet pill IN
 * PLACE. It seeded a row with NO Linear link on either component, and since the
 * 2026-08-20 display ruling an unlinked component does not show its stored
 * status at all: `_calPillDisplayStatus` substitutes 'N/A' for anything outside
 * Approved / Scheduled / Posted. So the probe demanded the label read
 * 'Kasper Approval' while the product was correctly rendering 'N/A'.
 *
 * That is exactly what the nightly printed on 2026-08-21:
 *
 *   ✓ pill data-val flips in place, NO reload (got Kasper Approval)
 *   ✗ pill label flips in place (got N/A)
 *   ✗ pill colour class flips in place
 *
 * data-val carries the STORED status and passed; the label and the colour class
 * carry the DISPLAYED status and did not. The reason it was intermittent rather
 * than constant -- green 08-16, 08-17, 08-18, 08-20 and red 08-19, 08-21 -- is
 * that `_calCompLinked` also accepts a `video_deliverable_id`, which the native
 * lane attaches to TEST-client rows asynchronously. The probe was racing it, and
 * three retries could not help because every attempt raced the same way.
 *
 * This suite EXECUTES the real `_calCompLinked` and `_calPillDisplayStatus`
 * extracted from index.html against the seed the probe actually writes, so the
 * diagnosis is demonstrated rather than argued, and a seed that loses its link
 * again fails here -- offline, in seconds -- instead of one night in three.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const APP = process.env.P92_APP_SRC || path.join(ROOT, 'index.html');
const PROBE = process.env.P92_PROBE_SRC || path.join(ROOT, 'qa', 'probes', 'p92_sxr_resolve_pill_inplace.js');
const appSrc = fs.readFileSync(APP, 'utf8');
const probeSrc = fs.readFileSync(PROBE, 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function extractFn(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') { depth--; if (seen && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const readyMatch = appSrc.match(/const _CAL_CLIENT_READY_STATES = new Set\(\[[^\]]*\]\);/);
if (!readyMatch) throw new Error('missing _CAL_CLIENT_READY_STATES');

const sandbox = { String, Boolean, Set, Object };
vm.createContext(sandbox);
vm.runInContext(
  readyMatch[0] + '\n' + extractFn(appSrc, '_calCompLinked') + '\n' + extractFn(appSrc, '_calPillDisplayStatus')
  + '\nthis.linked = _calCompLinked; this.shown = _calPillDisplayStatus;',
  sandbox,
);
const { linked, shown } = sandbox;
ok(typeof linked === 'function' && typeof shown === 'function',
  'the real link test and display rule extract and run (harness is not vacuous)');

/* The seed as the probe actually writes it — read from the probe, not retyped,
   so this cannot drift away from what runs at night. */
function seedValue(key) {
  const m = probeSrc.match(new RegExp("\\n\\s*" + key + ":\\s*([^\\n]*)"));
  if (!m) return null;
  return /^''|^""/.test(m[1].trim()) ? '' : m[1].trim().replace(/,\s*$/, '');
}
const videoLink = seedValue('linear_issue_id');
const graphicLink = seedValue('graphic_linear_issue_id');
ok(videoLink !== null && graphicLink !== null, 'both link fields are present in the probe seed');
ok(videoLink !== '' && graphicLink !== '',
  'the probe seeds a LINKED row on both components (video=' + JSON.stringify(videoLink) + ')');

/* Model the row the probe ends up asserting on: routed to Kasper Approval. */
const routed = { linear_issue_id: 'https://linear.app/x/VID-p92', graphic_linear_issue_id: 'https://linear.app/x/GRA-p92', video_status: 'Kasper Approval' };
ok(linked(routed, 'video') === true, 'a seeded link makes the video component linked');
ok(shown(routed, 'video', 'Kasper Approval') === 'Kasper Approval',
  'so the pill displays the routed status, which is what the probe asserts');

/* THE FAILURE, reproduced. The old seed, unlinked, with no deliverable id yet. */
const unlinked = { linear_issue_id: '', graphic_linear_issue_id: '', video_status: 'Kasper Approval' };
ok(linked(unlinked, 'video') === false, 'the old seed left the component unlinked');
ok(shown(unlinked, 'video', 'Kasper Approval') === 'N/A',
  'and an unlinked component displays N/A — exactly the label the nightly reported');

/* THE RACE, reproduced. Same row once the native lane attaches a deliverable
   id: linked after all, which is why some nights passed. */
const late = { linear_issue_id: '', graphic_linear_issue_id: '', video_deliverable_id: 'del_x', video_status: 'Kasper Approval' };
ok(linked(late, 'video') === true && shown(late, 'video', 'Kasper Approval') === 'Kasper Approval',
  'a deliverable id arriving late also counts as linked — the source of the intermittence');

/* The substitution is not blanket: a client-ready status shows through even
   unlinked, so the fix is about linkage, not about defeating the N/A rule. */
ok(shown({ linear_issue_id: '', video_status: 'Approved' }, 'video', 'Approved') === 'Approved',
  'a client-ready status still shows through on an unlinked component');

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nall green');
