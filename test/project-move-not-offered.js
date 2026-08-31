'use strict';
/*
 * A control that opens a complete, searchable, ticked picker and can never act.
 *
 * Found by the unknowable-assertion sweep (2026-08-31) and confirmed against
 * the live flag: with `prod_authority` = {"video":"syncview","graphics":"syncview"}
 * the sidebar chip reads "Native writes", and three inches away the Project row
 * of every deliverable built a searchable list of every client, ticked the
 * current one, and answered the pick with "Preview - read-only".
 *
 * It was the only row in that side card with no write-gate attributes, sitting
 * directly below Status, Assignee, Due and Labels, all of which carry them and
 * all of which write for real. So it did not read as disabled; it read as the
 * one control that still worked.
 *
 * There is no gateway operation that writes `client_slug` -- not on any
 * surface, not for any role -- so no authority flip and no permission makes
 * this picker act. That makes it a different thing from a write awaiting
 * authority, and it must not borrow that sentence: `Preview - read-only` is the
 * correct answer for a surface still checking authority, and the parity and
 * pixel lanes assert it verbatim.
 *
 * The refusal lives at the picker door rather than at each caller because there
 * were four callers -- the side card, the context menu, the bulk palette and
 * Shift+P -- and gating three would leave the fourth opening a picker that
 * still cannot act.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], next = INDEX[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

/* ---- 1. The picker never opens ----------------------------------------- */

const picker = grabFunc('_prodOpenPicker');
ok(/if \(kind === 'proj'\) \{[\s\S]{0,140}_prodToast\(PROD_PROJECT_MOVE_UNSUPPORTED\);[\s\S]{0,60}return false;/.test(picker),
  'the picker refuses `proj` at the door, so no list of clients is ever built');
const refusalAt = picker.indexOf("kind === 'proj'");
const buildAt = picker.indexOf('_prodPickerModel');
ok(refusalAt > 0 && (buildAt < 0 || refusalAt < buildAt),
  '...before anything is assembled, not after the reader has chosen from it');
ok(!/if \(kind !== 'proj'\) \{\s*\n\s*const operation/.test(picker),
  'and the old shape -- skip the write gate for proj, then build it anyway -- is gone');

/* ---- 2. The reason is its own sentence, not the preview one ------------- */

ok(/const PROD_PROJECT_MOVE_UNSUPPORTED = /.test(INDEX),
  'the reason is written once and shared');
const reason = (INDEX.match(/const PROD_PROJECT_MOVE_UNSUPPORTED = '([^']+)'/) || [])[1] || '';
ok(reason && !/preview/i.test(reason) && !/read-only/i.test(reason),
  'it does not borrow the preview wording, which describes a surface awaiting authority rather than an unsupported write');
ok(/cannot be moved between clients/i.test(reason),
  'it says what cannot happen');
ok(/batch/i.test(reason),
  'and where the project actually comes from, so the sentence is actionable rather than merely final');

/* ---- 3. Every control that offered it now says so BEFORE the press ------ */

const control = grabFunc('_prodAttributionProjectControlHTML');
ok(!/_prodOpenProjectMenu/.test(control),
  'the side-card row no longer opens the mover');
ok(/aria-disabled="true"/.test(control) && /PROD_PROJECT_MOVE_UNSUPPORTED/.test(control),
  '...and carries the reason where its neighbours carry their write gates');
ok((control.match(/<button/g) || []).length === 0,
  'it is not a button at all: rendering it like the four writing controls beside it is what made it look live');

const context = grabFunc('_prodOpenContextMenu');
ok(/disabled\('Project', _prodIcon\('project'\), '⇧P', false, false, PROD_PROJECT_MOVE_UNSUPPORTED\)/.test(context),
  'the context menu entry is disabled and carries the specific reason');
ok(/const hasSub = \{ status: 1, assign: 1, due: 1 \};/.test(context),
  'and it lost its submenu chevron -- an arrow promising a picker is the same promise the picker made');
ok(/const disabled = \(label, icon, kbd, danger, chev, reason\)/.test(context),
  'the disabled builder takes a reason, so entries that cannot act for DIFFERENT reasons can say which');
ok(/const why = String\(reason \|\| preview\);/.test(context),
  '...while an entry that passes no reason still falls back to the preview sentence');

ok(/refused\('Move to project\.\.\.', _prodIcon\('project'\), 'proj', 'P', PROD_PROJECT_MOVE_UNSUPPORTED\)/.test(INDEX)
  && !/command\('Move to project\.\.\./.test(INDEX),
  'the bulk palette entry is disabled with the same reason rather than styled as a live command');
/* It KEEPS data-prod-ctx. Dropping it took the row out of the palette's search
   and highlight index, so typing a query hid every row around it and left the
   refused one on screen unexplained. See test/bulk-refusals-honest.js. */
ok(/data-prod-disabled="bulk-' \+ _calEscAttr\(act\)/.test(INDEX),
  '...and its refusal marker is derived from the action, so it survives a label change');

/* ---- 4. What must NOT have changed ------------------------------------- */

ok(/_prodPreviewText\(\)/.test(INDEX),
  'the preview sentence still exists -- it is the right answer for a surface still checking authority');
const props = grabFunc('_prodProps');
ok(/_prodWriteGateAttrs\(d, 'status'/.test(props)
  && /_prodWriteGateAttrs\(d, 'assignee'/.test(props)
  && /_prodWriteGateAttrs\(d, 'due'/.test(props),
  'and the four rows that DO write still carry their write gates, untouched');

console.log(failures === 0
  ? '\nProject-move refusal checks passed'
  : '\n' + failures + ' project-move check(s) failed');
process.exit(failures === 0 ? 0 : 1);
