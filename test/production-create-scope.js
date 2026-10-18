/*
 * SUPERSEDED BY, NOT REPLACED BY, THE 2026-08-23 CLOSURE.
 *
 * The Production create dialog no longer creates anything at all — neither a
 * parent issue nor a sub-issue (test/prod-create-closed.js pins that). The
 * assertions below still pass and are deliberately kept: they describe the
 * shape the dialog must return to if the closure is ever lifted, and the
 * submission-scope half of this suite is about the Submit tab, which is not
 * affected by the closure.
 */
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

// ---- the submission scope choice (owner feedback 2026-10-18) ------------
// Owner ruling 2026-10-18 03:45 UTC, which keeps the 2026-08-17 rule above:
// the choice is one small switch, "Make a thumbnail too", on view right above
// the Create deliverables button, on by default. It is never hidden behind
// Advanced (hiding it in August made every submission create a thumbnail
// card, 60 empty placeholders, and 8 of the last 22 uploads were video only).
// On sends the old video + graphics request, off the old video-only request.
// "Thumbnail only" left the form: the Submit form sent none in the 60 days
// before 2026-10-18 (read-only count).
ok(/id="linearSubmitBtn"/.test(source) && !/id="linearSubmitBtnVideo"/.test(source)
  && !/id="linearSubmitBtnThumbnail"/.test(source),
  'one Create deliverables button replaces the three scope buttons');

ok(!/linearAdvanced|linear-advanced|toggleLinearAdvanced/.test(source),
  'there is no Advanced panel on the Submit form');

{
  const actions = source.indexOf('<div class="uf-actions">');
  const sw = source.indexOf('id="linearMakeThumbnail"', actions);
  const btn = source.indexOf('id="linearSubmitBtn"', actions);
  const end = source.indexOf('<div class="linear-status" id="linearStatus">', actions);
  ok(actions > -1 && sw > actions && btn > sw && end > btn,
    'the thumbnail switch sits in the action row and precedes the Create deliverables button');
}

ok(/id="linearMakeThumbnail"\$\{makeThumbnail \? ' checked' : ''\}/.test(source)
  && /return localStorage\.getItem\(LINEAR_THUMB_KEY\) !== '0';/.test(source)
  && /catch \(e\) \{ return true; \}/.test(source),
  'the switch is on by default (on unless this browser remembers it off)');

ok(/return box && !box\.checked \? 'video' : 'both';/.test(source),
  'toggle on maps to the old "both" request and off to the old "video" request');

if (failures) {
  console.error(`\nproduction create scope: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nproduction create scope checks passed');
