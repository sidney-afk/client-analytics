'use strict';
/*
 * N/A is a REAL, hand-set status -- and the only one that never reaches Linear.
 *
 * History: an earlier revision derived a "No asset" LABEL whenever an
 * In Progress component had nothing attached. That inferred intent from an
 * empty field, and was withdrawn by owner ruling 2026-08-19. In Progress is
 * the default again; a lane that genuinely does not apply is now marked N/A
 * by hand from the status picker.
 *
 * Three things make N/A different from every other status, and each one is a
 * place this can silently break:
 *
 *   1. Linear has no N/A state. The legacy push would get ok:false back from
 *      linear-set-status and QUEUE THE WRITE FOR RETRY, burning the attempt
 *      budget on something that can never land. It must refuse to send.
 *   2. It carries no CAL_PRIORITY, so a not-applicable lane neither drags nor
 *      lifts the card's overall status -- except when every lane is N/A, where
 *      the reduce would otherwise fall through to its 'Posted' seed and report
 *      an untouched card as published.
 *   3. Its slug becomes a CSS class suffix, and "N/A" contains a slash. A
 *      naive slug emits `cal-fld-status-n/a`, which matches no rule and
 *      renders the chip unstyled.
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

function constant(name) {
  const re = new RegExp('const ' + name + '\\s*=\\s*([^;]+);');
  const m = re.exec(source);
  if (!m) throw new Error('missing const ' + name);
  return m[0];
}

// --- 1. it is selectable, and it leads the picker --------------------------
const statuses = new Function(constant('CAL_STATUSES') + ' return CAL_STATUSES;')();
ok(statuses.indexOf('N/A') === 0,
'N/A is the first entry in CAL_STATUSES, so it renders above In Progress');
ok(statuses.indexOf('In Progress') === 1,
'In Progress sits directly below it, unchanged');
ok(statuses.length === 9, 'the eight pipeline statuses are all still there');

// --- 2. it carries no priority --------------------------------------------
const priority = new Function(constant('CAL_PRIORITY') + ' return CAL_PRIORITY;')();
ok(priority['N/A'] === undefined,
'N/A has no CAL_PRIORITY -- adding one would break n8n lock-step and let it drag the card');

// --- 3. rollup behaviour ---------------------------------------------------
function buildOverall() {
  /* Deliberately minimal scope: computeOverallStatus
     is extracted and executed standalone by several other suites, so this
     builds it with the same minimal scope they do. If it ever grows a
     dependency beyond CAL_PRIORITY / CAL_COMPONENTS / _calNormStatus, this
     throws here instead of breaking those suites. */
  const body = constant('CAL_PRIORITY') + '\n'
    + constant('CAL_COMPONENTS') + '\n'
    + constant('CAL_STATUSES') + '\n'
    + extract('_calNormStatus') + '\n'
    + extract('computeOverallStatus') + '\n'
    + 'return computeOverallStatus;';
  return new Function(body)();
}
const overall = buildOverall();

ok(overall({ video_status: 'N/A', graphic_status: 'Approved', caption_status: 'Approved' }) === 'Approved',
'an N/A lane does not drag the card down');
ok(overall({ video_status: 'N/A', graphic_status: 'Tweaks Needed', caption_status: 'Approved' }) === 'Tweaks Needed',
'the remaining lanes still decide the card');
ok(overall({ video_status: 'N/A', graphic_status: 'N/A', caption_status: 'In Progress' }) === 'In Progress',
'two N/A lanes leave the third in charge');
ok(overall({ video_status: 'N/A', graphic_status: 'N/A', caption_status: 'N/A' }) === 'N/A',
'an all-N/A card reports N/A, NOT the Posted seed of the reduce');
ok(overall({ video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress' }) === 'In Progress',
'ordinary cards are unaffected');

// --- 4. In Progress is the default again ----------------------------------
const normStatus = new Function(constant('CAL_STATUSES') + '\n' + extract('_calNormStatus') + '\nreturn _calNormStatus;')();
ok(normStatus('') === 'In Progress', 'an empty status still defaults to In Progress');
ok(normStatus('N/A') === 'N/A', 'N/A round-trips through normalisation instead of being coerced away');

// --- 5. the slug is CSS-safe ----------------------------------------------
const slug = new Function(extract('_calStatusSlug') + ' return _calStatusSlug;')();
ok(slug('N/A') === 'n-a', 'N/A slugs to n-a, not n/a');
ok(!/[^a-z0-9-]/.test(slug('N/A')), 'the slug contains nothing illegal in a CSS class name');
ok(slug('In Progress') === 'in-progress' && slug('For SMM Approval') === 'for-smm-approval',
'existing statuses slug exactly as before');

// --- 6. every surface that colours a status has a gray N/A -----------------
for (const sel of [
  '.cal-status-n-a',
  '.cal-fld-status-item.cal-fld-status-n-a',
  '.cal-fld-substatus-trigger.cal-fld-status-n-a',
  '.cal-review-sub-pill.cal-fld-status-n-a',
]) {
  ok(source.indexOf(sel) >= 0, 'a rule exists for ' + sel);
}
// The palette must be defined in EVERY theme block, or N/A renders unstyled
// in whichever theme was missed.
const themeBlocks = (source.match(/--cal-status-archived-bg:/g) || []).length;
const naBlocks = (source.match(/--cal-status-n-a-bg:/g) || []).length;
ok(themeBlocks > 0 && naBlocks === themeBlocks,
'the N/A palette is defined in all ' + themeBlocks + ' theme blocks');

// --- 7. the old derived label is gone -------------------------------------
const compLabel = new Function(
  extract('_calStatusLabel') + '\n'
  + constant('CAL_STATUSES') + '\n'
  + extract('_calNormStatus') + '\n'
  + 'var _isClientLink = false;\n'
  + 'function _calClientFirstName() { return "Doug"; }\n'
  + extract('_calCompStatusLabel') + '\n'
  + 'return _calCompStatusLabel;')();
ok(compLabel({ video_status: 'In Progress', asset_url: '' }, 'video') === 'In Progress',
'an In Progress video with no file reads In Progress again, not "No asset"');
ok(compLabel({ graphic_status: 'In Progress', thumbnail_url: '' }, 'graphic') === 'In Progress',
'the same for an empty thumbnail');
ok(compLabel({ video_status: 'N/A' }, 'video') === 'N/A',
'a lane marked N/A shows N/A');
ok(!/CAL_COMP_ASSET_FIELD|_calCompMissingAsset/.test(source),
'the asset-sniffing helpers are gone entirely, not just unused');

// --- 8. N/A must never be pushed to Linear --------------------------------
/* REWRITTEN 2026-09-22 (OPEN_REPAIRS 239). This asserted that
   `_calLegacyPushStatusToLinear` returned early on N/A, before its fetch, so a
   status Linear has no equivalent of could not get ok:false back from
   linear-set-status and burn the retry budget. That function and its retry
   queue are retired, so the guard it pinned no longer exists -- and cannot,
   because there is no send to guard.

   The property the old assertion protected is now structural rather than
   conditional, so this pins the structure: no legacy sender, and no reference
   anywhere in the page to the webhook that would have refused N/A. Point 2
   below still carries the live half of N/A's behaviour. */
ok(!/function _calLegacyPushStatusToLinear\(|function _calLegacyPostLinearComment\(/.test(source),
'the legacy Linear senders are gone, so no status can queue a doomed retry');
ok(!/LINEAR_SET_STATUS_URL\s*=|LINEAR_ADD_COMMENT_URL\s*=/.test(source),
'the legacy status/comment endpoints are no longer defined in the page');

// The gateway path reaches the same conclusion by mapping N/A to no native
// status at all; if that ever started mapping, N/A would begin writing to
// Linear through the other lane.
const nativeStatus = new Function(extract('_writeUiNativeStatus') + ' return _writeUiNativeStatus;')();
ok(!nativeStatus('N/A'),
'the gateway maps N/A to no native status, so it skips rather than writes');
ok(nativeStatus('In Progress') === 'in_progress',
'ordinary statuses still map through the gateway');

if (failures) process.exit(1);
console.log('\nN/A status checks passed');
