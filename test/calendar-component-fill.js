'use strict';
/*
 * The card half of "add the missing component".
 *
 * The button is the ONLY place in the product where a deliverable can be
 * created, now that Production creation is closed. So what this file guards is
 * not that the button looks right -- it is that the button cannot appear where
 * pressing it would create work nobody can see, and cannot leave a component
 * that no card points at.
 *
 * The gate function is extracted and EXECUTED against real card shapes rather
 * than pattern-matched, because "when does this button appear" is a question
 * with eight interesting answers and a regex can only assert that some words
 * are present.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// Comment- and quote-aware brace matcher, the same one the other source suites
// carry: a naive brace count walks straight off the end of any function whose
// comments contain braces or apostrophes.
function grabFunc(name) {
  const start = INDEX.indexOf(name);
  if (start < 0) throw new Error('not found: ' + name);
  let i = INDEX.indexOf('{', start);
  if (i < 0) throw new Error('no body: ' + name);
  let depth = 0, inS = '', inC = '';
  for (let j = i; j < INDEX.length; j++) {
    const c = INDEX[j], n = INDEX[j + 1], prev = INDEX[j - 1];
    if (inC === 'line') { if (c === '\n') inC = ''; continue; }
    if (inC === 'block') { if (c === '*' && n === '/') { inC = ''; j++; } continue; }
    if (inS) {
      if (c === '\\') { j++; continue; }
      if (c === inS) inS = '';
      continue;
    }
    if (c === '/' && n === '/') { inC = 'line'; j++; continue; }
    if (c === '/' && n === '*') { inC = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return INDEX.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

/* ---- 1. Executed: when does the button appear ------------------------- */

const gateSrc = grabFunc('function _calFillSiblingId(');
const gate = new Function(
  '_isClientLink', '_calIsBlankId', '_writeUiLinkSlotSealed',
  gateSrc + '; return _calFillSiblingId;',
);

const sealedAll = () => true;
const blankId = id => /^blank/.test(String(id || ''));
const fill = (post, which, opts = {}) => gate(
  opts.clientView === true, blankId, opts.sealed || sealedAll)(post, which);

const halfCard = { id: 'p_1', video_deliverable_id: 'del_v', status: 'In Progress' };

ok(fill(halfCard, 'graphic') === 'del_v',
  'a card with a video and no thumbnail offers to add the thumbnail, and names the video as the sibling to inherit from');
ok(fill(halfCard, 'video') === '',
  'and does not offer to add a second video');
ok(fill({ id: 'p_2', graphic_deliverable_id: 'del_g' }, 'video') === 'del_g',
  'the mirror case works too: a graphic-only card offers to add the video');

/* THE 102. Measured 2026-08-31: 102 live cards carry neither component, and
   most are drafts an SMM added seconds ago. A permanent "add a video" prompt
   on every blank row would be noise on the majority of them -- and there is no
   sibling to inherit a batch, a parent route or a title from, so the write
   could not be built even if someone pressed it. */
ok(fill({ id: 'p_3' }, 'video') === '' && fill({ id: 'p_3' }, 'graphic') === '',
  'a card with NEITHER component offers nothing — there is nothing to inherit from, and Create Post is the path for that');

/* A card already carrying a Linear url for the slot is a legacy half-link, not
   a missing component. Filling it would leave the card naming two issues. */
ok(fill({ id: 'p_4', video_deliverable_id: 'del_v', graphic_linear_issue_id: 'https://linear.app/x' }, 'graphic') === '',
  'a slot holding a Linear url is left alone — that is a half-link to repair, not a gap to fill');

ok(fill({ id: 'blank_1', video_deliverable_id: 'del_v' }, 'graphic') === '',
  'a blank placeholder row offers nothing');
ok(fill(Object.assign({}, halfCard, { status: 'Archived' }), 'graphic') === '',
  'an archived card offers nothing');
ok(fill(halfCard, 'graphic', { clientView: true }) === '',
  'and the client never sees it — this is staff-only, like every other pile control');

/* THE ROLLBACK CASE. Under a per-team rollback the native create is refused at
   the database, so offering the button would be offering a dead one. */
ok(fill(halfCard, 'graphic', { sealed: team => team !== 'graphic' }) === '',
  'a team rolled back to Linear offers nothing, because the write would be refused anyway');
ok(fill(halfCard, 'graphic', { sealed: sealedAll }) === 'del_v',
  'and is offered again once that team is SyncView-authoritative');

/* ---- 2. The retry story is the deterministic request id ---------------- */
/* The gateway derives the deliverable id from the request id. A random one per
   press would try to create a SECOND component and be refused as occupied --
   correct, but it would strand any card whose link write failed, refusing
   forever. Deterministic, every press is the same write: create, then replay. */

const idSrc = grabFunc('function _calFillRequestId(');
const requestId = new Function(idSrc + '; return _calFillRequestId;')();
ok(requestId('p_lin_vid13633', 'graphics') === requestId('p_lin_vid13633', 'graphics'),
  'the request id is stable across presses, so a retry replays instead of creating a second component');
ok(requestId('p_lin_vid13633', 'graphics') !== requestId('p_lin_vid13633', 'video'),
  'and differs per team, so the two halves of a card never collide');
ok(/^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,199}$/.test(requestId('p_lin_vid13633', 'graphics')),
  'and satisfies the gateway validRequestId contract');
ok(/^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,199}$/.test(requestId('p_mr2829s9_9dyhl', 'video')),
  'for a generated card id too');

/* ---- 3. The card write is PARTIAL ------------------------------------- */
/* calendar-upsert copies only the keys a payload carries. A fill must send the
   two link columns and nothing else: these cards have real scheduled dates,
   captions and tweaks on them, and the other component is somebody's work. */

const writeSrc = grabFunc('async function _calFillWriteCardLink(');
const keys = [...writeSrc.matchAll(/^\s*\?\s*\{ id: pid, (.*?) \}$|^\s*: \{ id: pid, (.*?) \};$/gm)]
  .map(m => (m[1] || m[2] || '')).join(' ');
ok(/graphic_deliverable_id/.test(keys) && /graphic_linear_issue_id/.test(keys)
  && /video_deliverable_id/.test(keys) && /linear_issue_id/.test(keys),
  'the card write carries the two link columns for the filled team');
for (const forbidden of ['scheduled_date', 'caption', 'name', 'status', 'tweaks', 'asset_url', 'thumbnail_url']) {
  ok(!new RegExp('\\b' + forbidden + '\\b').test(writeSrc),
    'and never sends ' + forbidden + ' — a fill must not disturb work already on the card');
}

/* ---- 4. It cannot create a card, only complete one --------------------- */

const submitSrc = grabFunc('async function _calFillComponentSubmit(');
ok(/operation: 'component_fill'/.test(submitSrc) && /surface: 'calendar'/.test(submitSrc),
  'it asks for component_fill on the calendar surface');
ok(/card_id: pid/.test(submitSrc) && /sibling_id: siblingId/.test(submitSrc),
  'and always names the card and the sibling, which the gateway and RPC both re-check');
ok(!/_calOpenNativePost|intake_create/.test(submitSrc),
  'and never falls back to creating a post — a fill completes a card, it does not make one');

/* THE REPAIR ARM. Both codes mean the component exists and the card is the
   stale half. Leaving it unlinked would be the exact state this ends. */
ok(/component_fill_team_occupied[\s\S]{0,80}idempotency_conflict/.test(submitSrc),
  'an already-filled component repairs the card link instead of just reporting the refusal');
ok(/_calFillLookupExisting/.test(submitSrc),
  'by looking up the component the card should have been pointing at');

/* ---- 5. Live authority, not the render-time guess ---------------------- */

const handlerSrc = grabFunc('async function _calFillComponent(');
ok(/_writeUiLinkSlotSealedLive\(target\)/.test(handlerSrc),
  'the authority flag is re-read live before the write, not trusted from when the button was drawn');
ok(/_calFillSiblingId\(post, target\)/.test(handlerSrc),
  'and the whole gate is re-evaluated against current state, so a stale tab sends nothing');
ok(/showConfirm\(/.test(handlerSrc),
  'and it confirms first — this creates real work in Production and Linear');

console.log(failures === 0
  ? '\ncalendar component fill checks passed'
  : '\n' + failures + ' calendar component fill check(s) failed');
process.exit(failures === 0 ? 0 : 1);
