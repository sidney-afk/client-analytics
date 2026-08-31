'use strict';
/*
 * "Delete issues" was styled as a live command. Its twin one menu away was
 * greyed out and explained.
 *
 * Found by the unknowable-assertion sweep, 2026-08-31 (item 87.9).
 *
 * Every row in the bulk Actions palette was built by the same `command(...)`
 * helper — a plain `.prod-mi` with nothing but a danger colour to set Delete
 * apart. No `.disabled`, no title, no tip. It was wired to
 * `_prodReadonlyGuard(); _prodClearLayer();`, so pressing it dismissed the menu
 * and toasted "Preview - read-only": the two things a command that HAD run
 * would also do. Meanwhile the single-row Delete in the context menu is built
 * by that menu's `disabled(...)` helper, with the class, the title and the tip.
 *
 * That asymmetry is what made it dangerous rather than merely untidy. Post-flip
 * the palette IS a live write surface — Assign, Change status and Change due
 * date all route through `_prodRunPickerWrite` and write for real — so a
 * reasonable person reads the palette as the place where bulk operations
 * happen, and Delete as one of them.
 *
 * TWO SENTENCES, NOT ONE. Project and Delete refuse for genuinely different
 * reasons: nothing writes client_slug anywhere, and nothing deletes anything
 * anywhere. Collapsing them into a shared "not supported" would lose the only
 * useful half — Delete can name archiving, Project cannot name anything.
 *
 * THE REFUSED ROWS KEEP data-prod-ctx, which reads as a mistake and is the
 * repair. `_prodWireBulkCommandMenu` builds its search index and its arrow-key
 * order from `[data-prod-ctx]`, so a disabled row built without it stays on
 * screen while a query hides every row around it, and shifts the highlight
 * index with nothing to explain why. (The first version of the Project row did
 * exactly that, and it silently broke two browser lanes that only run on the
 * heavy jobs.) So the row stays indexed and is refused at the two places that
 * act instead: `activate()` and `hi()`.
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

/* ---- 1. The sentences ---------------------------------------------------- */

const deleteReason = (INDEX.match(/const PROD_DELETE_UNSUPPORTED = '([^']+)';/) || [])[1] || '';
const moveReason = (INDEX.match(/const PROD_MOVE_UNSUPPORTED = '([^']+)';/) || [])[1] || '';

ok(/not available here, for anyone/.test(deleteReason),
  'the delete refusal says it applies to EVERYONE -- the preview sentence read as "not yet", '
  + 'which invites waiting for a permission that does not exist');
ok(/archive it on the content calendar/.test(deleteReason),
  '...and names a remedy that genuinely exists: archiveCalPost writes through for every staff seat');
ok(/take a post out of the schedule/i.test(deleteReason)
  && !/delete the issue/i.test(deleteReason),
  '...worded as taking the POST out of the schedule, because archiving does not delete the sub-issues');
ok(/cannot be moved between teams/.test(moveReason) && !/archive/i.test(moveReason),
  'and Move names NO remedy, because there genuinely is none -- an invented one would be the same defect again');
ok(deleteReason !== moveReason && deleteReason && moveReason,
  'the two refusals are distinct sentences: they are refused for different reasons and say which');

/* ---- 2. The context menu, which was already right about the shape -------- */

const context = grabFunc('_prodOpenContextMenu');
ok(/disabled\('Move', _prodIcon\('move'\), '', false, true, PROD_MOVE_UNSUPPORTED\)/.test(context),
  'the single-row Move carries its own reason instead of the preview default');
ok(/disabled\('Delete', _prodIcon\('trash'\), 'Ctrl ⌫', true, false, PROD_DELETE_UNSUPPORTED\)/.test(context),
  'and so does the single-row Delete');

/* ---- 3. The palette rows ------------------------------------------------- */

const open = grabFunc('_prodOpenBulkActions');
ok(/const refused = \(label, icon, act, kbd, reason, danger\)/.test(open),
  'the palette has a refused-row builder of its own');
ok(/data-prod-ctx="' \+ _calEscAttr\(act\)/.test(open.slice(open.indexOf('const refused'))),
  'THE LOAD-BEARING ODDITY: a refused row keeps data-prod-ctx, so the search box and the '
  + 'arrow keys still see it -- a row outside that index survives a query that hides its neighbours');
ok(/data-prod-disabled="bulk-' \+ _calEscAttr\(act\)/.test(open),
  '...and carries a marker derived from the action, so a label change cannot orphan a selector');
ok(/title="' \+ _calEscAttr\(reason\)[\s\S]{0,80}data-prod-tip="' \+ _calEscAttr\(reason\)/.test(open),
  '...and states its reason on hover, which is the whole point');
ok(/refused\('Move to project\.\.\.', _prodIcon\('project'\), 'proj', 'P', PROD_PROJECT_MOVE_UNSUPPORTED\)/.test(open),
  'Move to project is a refused row');
ok(/refused\(plural \? 'Delete issues' : 'Delete issue', _prodIcon\('trash'\), 'delete', '', PROD_DELETE_UNSUPPORTED, true\)/.test(open),
  'and so is Delete, which is what this finding was');
ok(!/command\(plural \? 'Delete issues'/.test(open),
  'Delete is no longer built by the live-command helper');
ok(!/_prodPreviewText\(\)/.test(open),
  'and the palette no longer answers anything with the preview sentence');

/* ---- 4. The wiring: indexed, and still refused --------------------------- */

const wire = grabFunc('_prodWireBulkCommandMenu');
ok(/const hasSub = \{ assign: 1, status: 1, due: 1 \};/.test(wire),
  "'proj' is out of the submenu table -- it used to open the searchable client list on hover and on Enter");
ok(/const refusedRow = el => !!\(el && el\.hasAttribute\('data-prod-disabled'\)\);/.test(wire),
  'the wiring recognises a refused row by its marker rather than by action name');
ok(/if \(refusedRow\(row\)\) \{[\s\S]{0,320}_prodReadonlyGuard\(row\.getAttribute\('data-prod-tip'\)\);\s*\n\s*return;/.test(wire),
  'activating one echoes the row OWN tip, so clicking cannot contradict hovering');
{
  const arm = wire.slice(wire.indexOf('if (refusedRow(row))'), wire.indexOf("const act = row.getAttribute"));
  ok(!/_prodClearLayer/.test(arm),
    '...and the menu stays OPEN: dismissing it is one of the two things a command that had RUN would do');
}
ok(!/if \(act === 'delete'\)/.test(wire),
  'the old delete arm -- guard, then dismiss -- is gone entirely');

/* ---- 5. Enter can never fire a refused row ------------------------------- */

ok(/let sel = -1;/.test(wire),
  'a "nothing highlighted" state exists, which it must: a search matching only refused rows has no target');
ok(/const nextEnabled = \(shown, from, step\)/.test(wire) && /if \(!refusedRow\(shown\[i\]\)\) return i;/.test(wire),
  'the highlight steps over refused rows in the direction of travel');
ok(/let ix = nextEnabled\(shown, start, step\);\s*\n\s*if \(ix < 0\) ix = nextEnabled\(shown, start, -step\);/.test(wire),
  '...and falls back the other way before giving up, so arrowing down at the end does not blank the menu');
ok(/if \(sel >= 0\) activate\(visible\(\)\[sel\]\);/.test(wire)
  && !/activate\(visible\(\)\[sel\] \|\| visible\(\)\[0\]\)/.test(wire),
  'THE REGRESSION THIS MUST NEVER BECOME: the `|| visible()[0]` fallback is gone. With nothing '
  + 'highlighted it fired whichever command sorted first, which is worse than the defect being fixed');
ok(/sel = refusedRow\(el\) \? -1 : ix;/.test(wire),
  'and hovering a refused row clears the highlight, so Enter never fires a command the cursor is not on');

/* ---- 6. The guard learned to carry a reason, and kept its default -------- */

const guard = grabFunc('_prodReadonlyGuard');
ok(/function _prodReadonlyGuard\(reason\)/.test(guard)
  && /_prodToast\(String\(reason \|\| ''\) \|\| _prodPreviewText\(\)\);/.test(guard),
  'the guard takes an optional reason and still defaults to the preview sentence, '
  + 'which is the right answer for a control genuinely still checking authority');
ok(/_prodReadonlyGuard\(PROD_DELETE_UNSUPPORTED\)/.test(INDEX),
  'and the Ctrl-Backspace shortcut over a selection gives the delete sentence too, not the preview one');
ok(/_prodReadonlyGuard\(el\.getAttribute\('data-prod-tip'\)\)/.test(grabFunc('_prodOpenContextMenu')),
  'as does clicking any disabled entry in the context menu, echoing that entry own tip');

/* ---- 7. What must NOT have changed --------------------------------------- */

ok(/_prodPreviewText\(\)/.test(INDEX),
  'the preview sentence still exists -- it is correct for a surface that has not resolved authority yet');
ok(/data-prod-ctx="' \+ _calEscAttr\(act\) \+ '" data-prod-bulk-label/.test(open),
  'the live command builder is untouched');
ok(/'copy-id'/.test(wire) && /_prodCopyIssueIds\(ids\)/.test(wire),
  'and Copy issue IDs still runs');

console.log(failures === 0
  ? '\nBulk-palette refusal checks passed'
  : '\n' + failures + ' bulk refusal check(s) failed');
process.exit(failures === 0 ? 0 : 1);
