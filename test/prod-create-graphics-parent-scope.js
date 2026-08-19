'use strict';
/*
 * Add-sub-issue under a GRAPHICS parent must resolve like every other entry
 * into the create dialog.
 *
 * The dialog is Video-only by owner ruling: it writes the Production issue
 * hierarchy and nothing else, so a thumbnail created here would have no
 * Calendar or Samples card behind it and the designer would never see it.
 * _prodCreateDefaults encodes that -- a graphics context resolves the team to
 * Video and raises graphicsContext, which renders the note explaining why.
 *
 * Opening the dialog from a parent row skipped all of it and assigned the
 * parent team raw. Under a graphics parent that selected "graphics" in a list
 * containing only Video, so the locked Team control fell back to its "Choose
 * team" placeholder -- a disabled control asking for a choice it cannot take
 * -- and the note that would have explained the situation never rendered.
 * Two reported cosmetic faults, one missing normalisation.
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

// --- the parent branch must normalise, not assign raw ---------------------
ok(!/_prodState\.createDraft\.team = _prodWriteTeam\(parent\.team\);/.test(openCreate),
'the parent branch no longer assigns the parent team raw');
ok(/graphicsContext = parentTeam === 'graphics'/.test(openCreate),
'opening from a graphics parent raises graphicsContext, so the explanatory note renders');
ok(/parentTeam === 'graphics' \? 'video' :/.test(openCreate),
'a graphics parent resolves the team to Video, the only team the list offers');
ok(/\(parentTeam \|\| 'video'\)/.test(openCreate),
'an unrecognised parent team still resolves to a real selectable value, never empty');

// --- the resolution behaves the same as the defaults path -----------------
function resolve(parentTeam) {
  const writeTeam = new Function('return ' + extract('_prodWriteTeam').replace(/^function [^(]+/, 'function'))();
  const t = writeTeam(parentTeam);
  return { graphicsContext: t === 'graphics', team: t === 'graphics' ? 'video' : (t || 'video') };
}
ok(resolve('graphics').team === 'video' && resolve('graphics').graphicsContext === true,
'a graphics parent -> Video selected, note shown');
ok(resolve('gra').team === 'video' && resolve('gra').graphicsContext === true,
'the short "gra" spelling resolves the same way');
ok(resolve('video').team === 'video' && resolve('video').graphicsContext === false,
'a video parent -> Video selected, no note');
ok(resolve('').team === 'video' && resolve('').graphicsContext === false,
'a missing parent team still yields a selectable value');

// --- the list really is Video-only, which is what makes the above matter --
// Scoped to the create form: a second, unrelated teamItems in the archive
// repair view legitimately offers both teams, and matching that one instead
// would assert the opposite of the rule under test.
const createForm = extract('_prodCreateFormHTML');
const teamItems = /const teamItems = \[[\s\S]{0,200}?\];/.exec(createForm);
ok(!!teamItems, 'the create form declares its own team list');
ok(!!teamItems && !/graphics/.test(teamItems[0]),
'the create form team list offers Video only, so any graphics value would show a placeholder');

if (failures) process.exit(1);
console.log('\nCreate-dialog graphics parent scope checks passed');
