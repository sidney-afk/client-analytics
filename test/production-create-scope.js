'use strict';

/*
 * Owner ruling 2026-08-17: graphics work is not created from the Production
 * create dialog, and the submission form's video/thumbnail/both choice is not
 * "advanced".
 *
 * Both rules come from the same day's damage. The create dialog writes ONLY the
 * Production issue hierarchy -- it says so in its own subtitle -- so a thumbnail
 * created there has no Calendar or Samples card behind it. Three were created
 * that way on 2026-08-17; all three duplicated cards that already existed, and
 * one was invisible to the designer who was supposed to make it. Meanwhile the
 * submit form defaulted to creating BOTH deliverables because the per-team
 * buttons sat behind an "Advanced" disclosure, which is how 60 cards ended up
 * carrying an empty "Video 1" graphics placeholder.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures += 1; console.error('FAIL  ' + label); }
}

// ---- the Production create dialog is Video-only -------------------------
const createTeamItems = /const teamItems = \[\s*\{ value: 'video', label: 'Video' \}\s*\];/.test(source);
ok(createTeamItems, 'the create dialog offers Video and no longer offers Graphics');

ok(/const graphicsContext = team === 'graphics';\s*\n\s*if \(graphicsContext\) team = 'video';/.test(source),
  'a graphics context resolves to Video instead of preselecting the closed door');

ok(!/const writableTeam = \['video', 'graphics'\]\.find\(value => _prodState\.authority\[value\] === 'syncview'\)/.test(source),
  'the default no longer steers toward whichever team is SyncView-native');

// The note is built by string concatenation, so match the pieces rather than a
// phrase that happens to span a '+' boundary.
ok(/data-prod-create-graphics-note="1"/.test(source)
  && /Graphics work is not created here/.test(source)
  && /no Calendar or Samples card behind/.test(source)
  && /tab instead/.test(source),
  'the dialog explains where graphics work is created instead of silently switching');

// ---- the submission scope choice is on the surface ----------------------
ok(/id="linearSubmitBtnVideo"/.test(source) && /id="linearSubmitBtnThumbnail"/.test(source)
  && /id="linearSubmitBtnBoth"/.test(source),
  'all three submission scopes still exist');

ok(!/linearAdvancedPanel/.test(source) && !/toggleLinearAdvanced/.test(source),
  'the per-team submission choice is no longer hidden behind an Advanced disclosure');

ok(/class="linear-submit-btns linear-submit-scope"/.test(source),
  'the video-only and thumbnail-only buttons render in a visible scope row');

if (failures) {
  console.error(`\nproduction create scope: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nproduction create scope checks passed');
