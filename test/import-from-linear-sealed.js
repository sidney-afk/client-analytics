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

/* ---- 1. The import function now checks the same seal its sibling uses --- */

const importFn = grabFunc('_calRunLinearImport');
ok(/_writeUiLinkSlotSealedLive\('video'\)/.test(importFn),
  '_calRunLinearImport reads live video authority before minting any cards');
ok(/importSeal\.sealed/.test(importFn) && /_writeUiLinkSlotSealedNotice\('video', importSeal\.reason\)/.test(importFn),
  'and refuses with the honest, shared seal notice when video is syncview-authoritative');

/* ---- 2. THE TRAP: the seal check runs BEFORE the archive-ledger mutation - */
/* A version that checked the seal after calling _calArchivedRemove would
   refuse to import, but would already have unarchived the Linear URLs the
   user picked -- so the next visit shows nothing, silently, instead of the
   card the refusal explained was never written. */

const sealAt = importFn.indexOf('importSeal.sealed');
const archiveRemoveAt = importFn.indexOf('_calArchivedRemove(');
ok(sealAt > 0 && archiveRemoveAt > 0 && sealAt < archiveRemoveAt,
  'the seal check runs before _calArchivedRemove, so a refused import leaves the archive ledger untouched');

/* ---- 3. The refusal actually stops the import: no upsert call reachable -- */
/* Static shape only (no live DOM here) but the seal branch's own `return`
   keeps everything below it, including the _calBulkUpsertPosts call, out of
   reach on that path. */

ok(/if \(importSeal\.sealed\) \{[\s\S]*?return;\s*\}/.test(importFn),
  'the sealed branch returns, so the same call never falls through to _calBulkUpsertPosts');

/* ---- 4. The three in-app recommendations no longer point at a tool that -- */
/* ---- mints broken cards; they point at the one that still works ---------- */

ok(!/"Import from Linear"/.test(INDEX),
  'no in-app message still quotes "Import from Linear" as a recommended recovery action');
ok(/or open the calendar and use Create Post to add them now\./.test(INDEX),
  'the post-submit background-write-failure notice now points at Create Post');
ok(/or use Create Post on the calendar to add the rest now\./.test(INDEX),
  'the partial-write-count notice now points at Create Post');
ok(/Open the calendar and use Create Post to add them\./.test(INDEX),
  'the resumed-job retry-cap notice now points at Create Post');

console.log(failures === 0
  ? '\nImport-from-Linear seal checks passed'
  : '\n' + failures + ' import-from-Linear seal check(s) failed');
process.exit(failures === 0 ? 0 : 1);
