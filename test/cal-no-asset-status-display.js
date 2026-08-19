'use strict';
/*
 * "No asset" is a LABEL, never a status.
 *
 * A component sitting at the default In Progress with nothing uploaded reads
 * as "someone is working on this", so a board full of empty slots looks busy.
 * The pill now says "No asset" instead -- but only as display text.
 *
 * The stored status is deliberately untouched, because it is load-bearing in
 * both directions: it syncs with Linear, and every queue predicate, filter
 * and count reads it. This suite pins the display rule AND pins that the
 * status pickers still list the real statuses, since a picker that offered
 * "No asset" as a choice would turn a cosmetic label into a writable status.
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

const fieldMap = /const CAL_COMP_ASSET_FIELD = \{[^}]*\}/.exec(source);
ok(!!fieldMap, 'the per-component asset field map is declared');

function build(isClientLink) {
  const scope = {
    _calNormStatus: s => String(s || '').trim(),
    _isClientLink: isClientLink,
    _calClientFirstName: () => 'Doug',
  };
  const names = Object.keys(scope);
  const body = fieldMap[0] + ';\n'
    + extract('_calCompMissingAsset') + '\n'
    + extract('_calStatusLabel') + '\n'
    + extract('_calCompStatusLabel') + '\n'
    + 'return _calCompStatusLabel;';
  return new Function(...names, body)(...names.map(n => scope[n]));
}

const label = build(false);

// --- the empty slot each component can be in ------------------------------
ok(label({ video_status: 'In Progress', asset_url: '' }, 'video') === 'No asset',
'a video with no file reads "No asset"');
ok(label({ graphic_status: 'In Progress', thumbnail_url: '' }, 'graphic') === 'No asset',
'a thumbnail with no image reads "No asset"');
ok(label({ caption_status: 'In Progress', caption: '' }, 'caption') === 'No asset',
'an empty caption reads "No asset"');
ok(label({ video_status: 'In Progress', asset_url: '   ' }, 'video') === 'No asset',
'whitespace does not count as an asset');

// --- once something is attached the real status comes back ----------------
ok(label({ video_status: 'In Progress', asset_url: 'https://drive/x' }, 'video') === 'In Progress',
'a video WITH a file keeps its real status');

// --- scoped to In Progress -------------------------------------------------
// Any later status means somebody acted on the component; "No asset" there
// would be a claim about the work rather than a description of an empty slot.
for (const st of ['Kasper Approval', 'Tweaks Needed', 'Client Approval', 'Approved', 'Scheduled', 'Posted']) {
  ok(label({ video_status: st, asset_url: '' }, 'video') !== 'No asset',
  'a video at ' + st + ' is never relabelled, file or no file');
}

// --- client links keep their own vocabulary --------------------------------
const clientLabel = build(true);
ok(clientLabel({ video_status: 'In Progress', asset_url: '' }, 'video') !== 'No asset',
'a client link is not shown internal empty-slot wording');
ok(clientLabel({ video_status: 'Kasper Approval' }, 'video') === 'In team review',
'the existing client vocabulary still applies through the new helper');

// --- it is a label, not a status ------------------------------------------
ok(!/CAL_STATUSES\s*=\s*\[[^\]]*No asset/.test(source),
'"No asset" is not in the selectable status list');

const pickerLines = source.split('\n').filter(l => /cal-fld-status-item/.test(l));
ok(pickerLines.length > 0 && pickerLines.every(l => !/_calCompStatusLabel/.test(l)),
'the status pickers still render real statuses, not the display label');

// Nothing may write it, and no predicate may branch on it. Comments are
// stripped first so the rationale prose above the helper does not read as
// code, and the helper itself is removed so its own return is not a hit.
function stripComments(text) {
  let out = '', quote = '', escaped = false, line = false, block = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (line) { if (ch === '\n') { line = false; out += ch; } continue; }
    if (block) { if (ch === '*' && text[i + 1] === '/') { block = false; i++; } continue; }
    if (quote) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') { line = true; i++; continue; }
    if (ch === '/' && text[i + 1] === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    out += ch;
  }
  return out;
}
const codeOnly = stripComments(source).split(extract('_calCompStatusLabel')).join('');
ok(!/'No asset'|"No asset"/.test(codeOnly),
'"No asset" appears nowhere in code except the display helper -- never assigned, never compared');

if (failures) process.exit(1);
console.log('\nNo-asset status display checks passed');
