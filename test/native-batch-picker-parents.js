'use strict';
/*
 * The Create Post batch picker must not offer a batch that cannot parent the
 * chosen post shape — and must not lead with an empty duplicate.
 *
 * WHAT HAPPENED (2026-08-20). An SMM chose "Add to a previous batch" for a
 * client whose last batch was created 2026-08-10, picked Video + Thumbnail,
 * and got: "This client's Video and Graphics filing must be configured before
 * a post can be created." Three separate defects, all reproduced here:
 *
 *  1. WRONG BATCH OFFERED. Three same-name batches existed for that day,
 *     created within 80 seconds. The picker orders newest-first, and the
 *     newest held ZERO cards — the SMM's actual 17 items were in an older
 *     twin. Duplicate/empty twins are common: one client has seven same-name
 *     batches, five of them empty.
 *  2. INCOMPATIBLE BATCH OFFERED AS COMPATIBLE. _calNativeBatchCompatible read
 *     the batch's `team` COLUMN, and a null-team batch "accepts any post". But
 *     the gateway parents each child under the batch's parent FOR ITS OWN TEAM
 *     (parentRouteForAppend), and that batch predated ONE PARENT PER CARD
 *     (deploy #12, 2026-08-18) so it recorded a VIDEO parent only. The
 *     thumbnail leg had nowhere to go and the whole append was refused with
 *     409 batch_parent_mapping_missing. Live census the day of the fix: of 430
 *     active calendar batches, 255 carry a video-only parent map and 132 a
 *     graphics-only one; exactly ONE could still have succeeded via a
 *     batch-create outbox dependency the browser cannot see.
 *  3. THE MESSAGE BLAMED THE CLIENT. One catch-all mapped every code matching
 *     /project|mapping|parent/ to the client-filing sentence — so a batch
 *     problem read as a client misconfiguration that no client setup could
 *     ever clear. The client's filing was correct.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function extractFn(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') { depth--; if (seen && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced function: ' + name);
}
function extractConst(decl, endsWith) {
  const start = source.indexOf(decl);
  if (start < 0) throw new Error('missing const: ' + decl);
  const end = source.indexOf(endsWith, start);
  if (end < 0) throw new Error('unterminated const: ' + decl);
  return source.slice(start, end + endsWith.length);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext([
  extractConst('const CAL_NATIVE_MODE_TEAMS = {', '};'),
  extractFn('_calNativeBatchParentTeams'),
  // The owner-team lookup the compatibility rule calls (2026-08-26): the
  // sandbox composes real functions, so a new one has to be named here.
  extractFn('_calNativeBatchParentOwnerTeam'),
  extractFn('_calNativeBatchCompatible'),
  extractFn('_calNativeBatchHasLinearParents'),
  extractFn('_calNativeBatchLists'),
  extractFn('_calNativePostErrorText'),
  'this.compatible = _calNativeBatchCompatible;',
  'this.lists = _calNativeBatchLists;',
  'this.errorText = _calNativePostErrorText;',
  'this.parentTeams = _calNativeBatchParentTeams;',
  // Built INSIDE the sandbox: `counts instanceof Map` is realm-sensitive, and a
  // Node-side Map would fail that check for a reason the browser never has.
  'this.mkCounts = entries => new Map(entries);',
].join('\n'), sandbox);
const { compatible, lists, errorText, parentTeams, mkCounts } = sandbox;
ok(typeof compatible === 'function' && typeof lists === 'function' && typeof errorText === 'function',
  'the real picker predicates extract and execute (harness is not vacuous)');

const VID = { url: 'https://linear.app/x/issue/VID-1/a', uuid: 'v-uuid', identifier: 'VID-1' };
const GRA = { url: 'https://linear.app/x/issue/GRA-1/b', uuid: 'g-uuid', identifier: 'GRA-1' };
const bothParents = { id: 'b-both', team: null, linear_parent_ids: { video: VID, graphics: GRA } };
// The exact live shape that produced the incident: null team, video parent only.
const videoOnly = { id: 'b-video-only', team: null, linear_parent_ids: { video: VID } };
const graphicsOnly = { id: 'b-graphics-only', team: null, linear_parent_ids: { graphics: GRA } };

// 1. PARENT COVERAGE DECIDES, NOT THE TEAM COLUMN.
ok(compatible(videoOnly, 'both') === false,
  'the incident batch — null team, video parent only — is NOT offered for Video + Thumbnail');
ok(compatible(videoOnly, 'thumbnail') === false,
  'a video-only parent map cannot take a Thumbnail-only post either');
ok(compatible(videoOnly, 'video') === true,
  'it CAN still take a Video-only post — that leg has a parent, and the SMM keeps that option');
ok(compatible(graphicsOnly, 'thumbnail') === true && compatible(graphicsOnly, 'both') === false,
  'a graphics-only parent map takes Thumbnail-only and refuses Video + Thumbnail');
ok(compatible(bothParents, 'both') === true
  && compatible(bothParents, 'video') === true
  && compatible(bothParents, 'thumbnail') === true,
'a batch parented for both teams takes every post shape');

/* THE TEAM COLUMN NO LONGER CONSTRAINS ANYTHING (2026-08-26). It describes a
   batch's existing CHILDREN, not the teams it can file — the B1 import derives
   it that way and says so at b1-linear-backfill.js:848-865 — so using it here
   refused work whose parents resolve perfectly. This assertion previously
   pinned that refusal, which meant it pinned the defect: 143 of 397 active
   batches were hidden from a Video + Thumbnail post, and two SMMs reported it
   on one day. The parents decide now, in all three layers. */
ok(compatible({ id: 'g', team: 'graphics', linear_parent_ids: { video: VID, graphics: GRA } }, 'video') === true,
  'a stamped batch with a real video parent takes a Video-only post — the stamp is not evidence about parents');
ok(compatible({ id: 'g2', team: 'graphics', linear_parent_ids: { graphics: GRA } }, 'video') === false,
  'while a batch with no video parent still refuses one, which is the rule that was always doing the work');
/* And the shape the stamp used to hide by accident: a parent recorded for one
   team but OWNED by the other. The gateway validates it against the requesting
   team's project, so offering it would only move the refusal later. */
ok(compatible({ id: 'g3', team: null, linear_parent_ids: {
  video: { uuid: 'g-uuid', identifier: 'GRA-1', owner_team: 'graphics' }, graphics: GRA } }, 'video') === false,
  'a video slot owned by graphics is refused early rather than late');

// Key vocabulary matches the gateway's parentIdsForTeam.
ok(parentTeams({ linear_parent_ids: { vid: VID, gra: GRA } }).has('video')
  && parentTeams({ linear_parent_ids: { vid: VID, gra: GRA } }).has('graphics'),
'short team keys (vid/gra) are read the same way the gateway reads them');
ok(parentTeams({ linear_parent_ids: null }).size === 0
  && parentTeams({}).size === 0 && parentTeams(null).size === 0,
'a missing or malformed parent map yields no teams rather than throwing');

// 2. EMPTY TWINS RANK LAST.
const newestEmpty = { id: 'newest-empty', team: null, linear_parent_ids: { video: VID, graphics: GRA } };
const olderReal = { id: 'older-real', team: null, linear_parent_ids: { video: VID, graphics: GRA } };
const counts = mkCounts([['newest-empty', 0], ['older-real', 17]]);
const ranked = lists([newestEmpty, olderReal], 'both', counts);
ok(ranked.compatible[0] && ranked.compatible[0].id === 'older-real',
  'the populated batch outranks the newer EMPTY twin the picker used to lead with');
ok(ranked.compatible.length === 2 && ranked.compatible[1].id === 'newest-empty',
  'the empty batch is ranked down, not removed — it is still a legitimate target');
const noCounts = lists([newestEmpty, olderReal], 'both', null);
ok(noCounts.compatible[0].id === 'newest-empty',
  'with no counts map the order is untouched — ranking is best-effort, never a hard dependency');

// An orphan with no parents at all stays out of BOTH lists (pre-existing rule).
const orphan = { id: 'orphan', team: null, linear_parent_ids: {} };
const withOrphan = lists([orphan, bothParents], 'both', null);
ok(!withOrphan.compatible.some(b => b.id === 'orphan')
  && !withOrphan.incompatible.some(b => b.id === 'orphan'),
'a parentless orphan is still excluded from both lists');

// An incompatible-but-parented batch is VISIBLE with a reason, not silently dropped.
const shown = lists([videoOnly], 'both', null);
ok(shown.compatible.length === 0 && shown.incompatible.some(b => b.id === 'b-video-only'),
  'a batch that cannot take the chosen shape is shown as incompatible, not hidden');

// 3. THE MESSAGE NAMES THE BATCH, NOT THE CLIENT.
const batchMsg = errorText({ code: 'batch_parent_mapping_missing' });
ok(!/filing must be configured/.test(batchMsg),
  'a batch-parent failure no longer blames the client\'s filing');
ok(/batch/i.test(batchMsg) && /new batch|post shape/i.test(batchMsg),
  'it names the batch and tells the SMM what to do instead');
ok(errorText({ code: 'batch_parent_mapping_ambiguous' }) === batchMsg,
  'the ambiguous variant gets the same batch-shaped explanation');
// A genuine client-project failure keeps the original sentence.
ok(/filing must be configured/.test(errorText({ code: 'intake_project_missing' })),
  'a real client project/mapping failure still says the client filing needs configuring');

if (failures) {
  console.error(`\n${failures} native batch-picker check(s) failed.`);
  process.exit(1);
}
console.log('\nNative batch-picker parent checks passed.');
