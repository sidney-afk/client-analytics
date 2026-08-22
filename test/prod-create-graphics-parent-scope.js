'use strict';
/*
 * Add-sub-issue under a GRAPHICS parent: the pin stays graphics, and the
 * locked control displays it.
 *
 * Two rulings meet here and must not be confused. The create dialog's team
 * PICKER offers Video only (owner ruling 2026-08-17): a graphics issue
 * created loose in this dialog has no Calendar/Samples card behind it and
 * becomes an orphan. But sub-issue creation UNDER an existing graphics parent
 * deliberately stays open with the team pinned to graphics -- graphics is
 * SyncView-authoritative so the gate admits it, and the locked scope pickers
 * keep the pin out of reach (prod-write-gateway-browser pins that contract
 * end to end).
 *
 * A 2026-08-19 "cosmetic" fix normalised the pinned team to video, which
 * handed the pre-flip gate a VIDEO create -- refused -- closing sub-issue
 * creation under every graphics parent. The polish gate caught it. The real
 * cosmetic fault was display-only: the pinned graphics value was not in the
 * Video-only list, so the locked select fell back to its "Choose team"
 * placeholder. The fix is to display the locked value, never to change it.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && source[i + 1] === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') { line = true; i++; continue; }
    if (ch === '/' && source[i + 1] === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

const openCreate = extract('_prodOpenCreate');
const createForm = extract('_prodCreateFormHTML');

// --- the pin: a graphics parent keeps team graphics ------------------------
ok(/_prodState\.createDraft\.team = _prodWriteTeam\(parent\.team\);/.test(openCreate),
'opening from a parent pins the parent team raw -- graphics stays graphics');
ok(!/parentTeam === 'graphics' \? 'video'/.test(openCreate),
'the 2026-08-19 video re-pointing is gone: it closed sub-issue creation under graphics parents');
ok(!/createDraft\.graphicsContext/.test(openCreate),
'the parent branch does not raise graphicsContext -- a pinned graphics sub-issue is a legitimate create, not a steered-away context');

// --- the display: the locked value is in the list --------------------------
// Executed, not grepped. The list used to be a literal inside the form
// builder; it is now `_prodCreateTeamItems`, which derives the open choice set
// from live authority so the Video door closes by itself when Video flips
// (FLIP_BUG_LEDGER §0-7). The two rules asserted here are unchanged: a Graphics
// entry appears ONLY for a draft already pinned to graphics, and the open set
// never widens.
const vm = require('vm');
function teamValues(authority, draft) {
  const context = { _writeUiAuthoritySnapshot: () => authority };
  vm.createContext(context);
  for (const name of ['_prodWriteTeam', '_prodCreateTeamPinned', '_prodCreateTeamItems']) {
    const extracted = source.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n {8}\\}'));
    if (!extracted) throw new Error('missing ' + name);
    vm.runInContext(extracted[0], context);
  }
  return context._prodCreateTeamItems(draft || {}).map(item => item.value);
}
const PRE_VIDEO_FLIP = { video: 'linear', graphics: 'syncview' };
// PINNED means a sub-issue draft with a parent -- the only state where the
// picker is disabled. A loose draft carries team:'video' by default, so
// "has a team" is NOT the same thing as "is pinned"; conflating them is what
// let the open choice set silently widen.
const PINNED_GRAPHICS = { mode: 'subissue', parentId: 'issue-1', team: 'graphics' };
const LOOSE_DEFAULT = { mode: 'parent', parentId: '', team: 'video' };

ok(JSON.stringify(teamValues(PRE_VIDEO_FLIP, PINNED_GRAPHICS)) === JSON.stringify(['video', 'graphics'])
  && JSON.stringify(teamValues(PRE_VIDEO_FLIP, LOOSE_DEFAULT)) === JSON.stringify(['video']),
'the create form appends a Graphics entry ONLY when the draft is already pinned to graphics, so the locked select displays it');
ok(JSON.stringify(teamValues(PRE_VIDEO_FLIP, LOOSE_DEFAULT)) === JSON.stringify(['video'])
  && JSON.stringify(teamValues(PRE_VIDEO_FLIP, { mode: 'parent', parentId: '', team: 'graphics' })) === JSON.stringify(['video']),
'the base team list stays Video-only -- an UNPINNED graphics draft cannot widen the open choice set');

// --- top-level graphics context still steers to Video via the defaults -----
const defaults = extract('_prodCreateDefaults');
ok(/const graphicsContext = team === 'graphics';\s*\n\s*if \(graphicsContext\) team = 'video';/.test(defaults),
'a top-level graphics CONTEXT still resolves to Video with the explanatory note (the orphan door stays shut)');

if (failures) process.exit(1);
console.log('\nCreate-dialog graphics parent scope checks passed');
