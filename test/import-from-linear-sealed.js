'use strict';
/*
 * "Import from Linear" minted brand-new calendar cards from pasted Linear
 * URLs with zero authority checks, unlike its sibling _calBulkLinkApply
 * (which links a Linear id onto an EXISTING native card and IS sealed).
 * Sweep item 66.
 *
 * Every card this tool creates carries only linear_issue_id /
 * graphic_linear_issue_id -- never a video_deliverable_id -- so post-flip,
 * when video authority is syncview, each one is born already broken: the
 * pill locks (item 64) and the first status write 409s (item 67). There is
 * no partial-success shape here the way bulk-link has one for its graphic
 * half, so a sealed video authority now seals the whole import, checked
 * once up front via the same _writeUiLinkSlotSealedLive('video') the
 * sibling function already uses and already ships tests for.
 *
 * In-app copy also recommended this tool as the fix for a failed background
 * calendar-card write, in three places -- text made reachable by the flip,
 * pointing users at a tool that would just mint them more broken cards.
 * Those three now recommend Create Post instead, which works regardless of
 * authority state.
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

/* ---- 1-3. RETIRED (B2, 2026-09-23). The seal above is superseded: the
   tool itself is gone, along with Bulk Linear sync and the link-time status
   adoption, because all three read the n8n `linear-subissues` webhook and
   Linear is no longer a work surface. Assert the removal is complete, so no
   dialog, menu item or silent background call can come back unnoticed. ---- */

for (const name of ['openCalLinearImport', 'closeCalLinearImport', '_calLinearImportFetch',
  '_calRenderLinearSubPick', '_calRunLinearImport', 'openCalBulkLinearSync',
  '_calOpenBulkLinkOverlay', 'closeCalBulkLinkOverlay', '_calBulkLinkFetch', '_calBulkLinkApply',
  '_calSyncStatusFromLinear', '_sxrSyncStatusFromLinear']) {
  ok(INDEX.indexOf('function ' + name + '(') < 0, name + ' is no longer defined');
  ok(!new RegExp('[^A-Za-z0-9_`]' + name + '\\(').test(INDEX.replace(/typeof _sxrSyncStatusFromLinear === 'function' && _sxrSyncStatusFromLinear\(/g, '')
      .replace(/if \(value && post && typeof _sxrSyncStatusFromLinear === 'function'\) _sxrSyncStatusFromLinear\(/g, '')
      .replace(/if \(val && typeof _sxrSyncStatusFromLinear === 'function'\) _sxrSyncStatusFromLinear\(/g, '')),
    'and nothing calls ' + name + ' unguarded');
}
ok(!/LINEAR_SUBISSUES_URL\s*=/.test(INDEX), 'LINEAR_SUBISSUES_URL is no longer defined');
ok(!/fetch\(LINEAR_SUBISSUES_URL/.test(INDEX), 'nothing fetches the linear-subissues webhook');
ok(!/webhook\/linear-subissues/.test(INDEX), 'the linear-subissues webhook URL is gone from the app');
ok(!/>Import from Linear<\/button>/.test(INDEX), 'the kebab no longer offers Import from Linear');
ok(!/>Bulk Linear sync<\/button>/.test(INDEX), 'the kebab no longer offers Bulk Linear sync');
ok(!/id="calLinearImportOverlay"/.test(INDEX) && !/id="calBulkLinkOverlay"/.test(INDEX),
  'both Linear pull-in dialogs are gone from the page');
ok(!/>Match to Linear<\/button>/.test(INDEX), 'the multi-select bar no longer offers Match to Linear');
ok(/>Import from Excel<\/button>/.test(INDEX), 'the native Import from Excel entry point is still there');

/* ---- 4. The three in-app recommendations no longer point at a tool that -- */
/* ---- mints broken cards; they point at the one that still works ---------- */

ok(!/"Import from Linear"/.test(INDEX),
  'no in-app message still quotes "Import from Linear" as a recommended recovery action');
ok(!/The Linear issues were created, but adding the matching cards/.test(INDEX),
  'the retired post-submit background writer and its stale failure notice are absent');
/* The partial-write-count notice this used to pin (a per-card write loop
   that could land some cards and miss others) no longer exists: 2026-09-20
   (LINEAR_EXIT_STEP26_NATIVE_WORKLOAD.md) retired _writeLinearVideoCardsToCalendar's
   card-writing body outright in favor of a single all-or-nothing hold, since
   every active client is native-enrolled and reaches this function only
   through a stale pre-enrollment job or the retained rollback entry point. */
ok(/that connector was retired\. Add the ' \+ videos\.length/.test(INDEX) && /from the calendar with Create Post\.'\);/.test(INDEX),
  'the retired-path hold notice gives the real reason and points at Create Post instead of writing cards');
ok(/Open the calendar and use Create Post to add them\./.test(INDEX),
  'the resumed-job retry-cap notice now points at Create Post');

console.log(failures === 0
  ? '\nImport-from-Linear seal checks passed'
  : '\n' + failures + ' import-from-Linear seal check(s) failed');
process.exit(failures === 0 ? 0 : 1);
