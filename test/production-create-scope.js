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

// ---- the Production create dialog is Video-only, and closes itself ------
// Executed, not grepped: this used to assert on the literal array, which said
// nothing about what the dialog would do once Video flips. The door is open for
// a team only while LINEAR still owns it -- an issue created here has no card
// behind it, so on a SyncView-authoritative team it is an orphan nothing can
// repair afterwards (GRA-7109). Deriving it from authority means the Video door
// closes on flip day with no code change and nobody having to remember.
const vm = require('vm');
function createTeamContext(authority) {
  const context = { _writeUiAuthoritySnapshot: () => authority };
  vm.createContext(context);
  for (const name of ['_prodWriteTeam', '_prodCreateTeamPinned', '_prodCreateTeamItems', '_prodCreateTeamAllowed']) {
    const extracted = source.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n {8}\\}'));
    if (!extracted) throw new Error('missing ' + name);
    vm.runInContext(extracted[0], context);
  }
  return context;
}
function teamItemsWith(authority, draft) {
  return createTeamContext(authority)._prodCreateTeamItems(draft || {}).map(item => item.value);
}
function teamAllowed(authority, draft) {
  return createTeamContext(authority)._prodCreateTeamAllowed(draft || {});
}
// _prodCreateDefaults falls back to team:'video' for EVERY loose draft, so this
// is the shape the dialog actually opens with -- not the empty object the first
// version of this test used, which is why the leak below went unnoticed.
const LOOSE_DEFAULT = { mode: 'parent', parentId: '', team: 'video' };
const PINNED_GRAPHICS = { mode: 'subissue', parentId: 'issue-1', team: 'graphics' };
const PINNED_VIDEO = { mode: 'subissue', parentId: 'issue-1', team: 'video' };
const LINEAR_VIDEO = { video: 'linear', graphics: 'syncview' };
const BOTH_SYNCVIEW = { video: 'syncview', graphics: 'syncview' };

ok(JSON.stringify(teamItemsWith(LINEAR_VIDEO, LOOSE_DEFAULT)) === JSON.stringify(['video']),
  'the create dialog offers Video and no longer offers Graphics');
ok(JSON.stringify(teamItemsWith(BOTH_SYNCVIEW, LOOSE_DEFAULT)) === JSON.stringify([]),
  'the Video door closes by itself once Video is SyncView-authoritative — on the DEFAULT draft, which carries team:video');
ok(teamAllowed(BOTH_SYNCVIEW, LOOSE_DEFAULT) === false,
  'and the draft is REFUSED, not merely hidden — submit reads draft.team directly, so a picker showing "No options" would still have created the orphan');
ok(JSON.stringify(teamItemsWith(null, LOOSE_DEFAULT)) === JSON.stringify(['video'])
  && teamAllowed(null, LOOSE_DEFAULT) === true,
'an unreadable authority keeps the door exactly as it is today — fail OPEN, since the gate re-checks authority before any write');
ok(JSON.stringify(teamItemsWith(LINEAR_VIDEO, PINNED_GRAPHICS)) === JSON.stringify(['video', 'graphics'])
  && teamAllowed(LINEAR_VIDEO, PINNED_GRAPHICS) === true,
'a pinned graphics sub-issue still finds its own value in the list and is still allowed — the deliberate exception');
ok(JSON.stringify(teamItemsWith(BOTH_SYNCVIEW, PINNED_VIDEO)) === JSON.stringify(['video'])
  && teamAllowed(BOTH_SYNCVIEW, PINNED_VIDEO) === true,
'a pinned video sub-issue keeps its value after the door closes — a disabled select must never show a placeholder it cannot take');
ok(JSON.stringify(teamItemsWith(BOTH_SYNCVIEW, { mode: 'subissue', parentId: '', team: 'video' })) === JSON.stringify([]),
  'a sub-issue draft with no parent is not pinned — an unpinned draft cannot re-open the door');
ok(JSON.stringify(teamItemsWith(LINEAR_VIDEO, { mode: 'subissue', parentId: 'i', team: 'GRAPHICS' })) === JSON.stringify(['video', 'graphics']),
  'a pinned team is matched case-insensitively — the case that a plain === would silently drop');
ok(JSON.stringify(teamItemsWith(LINEAR_VIDEO, PINNED_VIDEO)) === JSON.stringify(['video']),
  'a pinned team already in the list is never duplicated');
ok(JSON.stringify(teamItemsWith(LINEAR_VIDEO, { mode: 'subissue', parentId: 'i', team: 'nonsense' })) === JSON.stringify(['video'])
  && teamAllowed(LINEAR_VIDEO, { mode: 'subissue', parentId: 'i', team: 'nonsense' }) === false,
'an unrecognised team adds nothing and is refused');
// This one is a source assertion, not an executed one -- _prodSubmitCreate
// pulls in the whole modal, catalog and roster surface. Stated plainly rather
// than dressed up: it pins the EXACT live guard clause, because a first version
// matched only the call text and survived a mutation that neutered the
// condition around it while leaving the call in place.
ok(/else if \(!draft\.ambiguous && !_prodCreateTeamAllowed\(draft\)\) \{/.test(source)
  && /errorText = 'That team is no longer created from this dialog/.test(source),
'the submit path gates on the team, in a live clause — a call inside a dead condition is not a gate');

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
