'use strict';
/*
 * A finished card returns to Kasper's "Waiting" ONLY once his outstanding
 * change request has been answered.
 *
 * Owner ruling 2026-08-19: "when he clicks finish reviewing after putting
 * tweaks, it should never appear again."
 *
 * The forensic timelines this encodes are REAL, read from deliverable_events
 * on the two live specimens that prompted the ruling:
 *
 *   bayavoce "Hook videos Reel 01"  (b1_d_d73eafa2…)
 *     Aug 18 21:15  Kasper: kasper_approval -> tweak   (+ tweak comments)
 *     Aug 19 13:27  Linear: tweak -> smm_approval      (editor fixed it)
 *     Aug 19 13:47  Ludmila (smm): smm_approval -> kasper_approval
 *   dougcartwright "Carrusel"       (b1_d_058b336d…)
 *     Aug 19 18:05  Kasper: kasper_approval -> tweak
 *     Aug 19 18:14  Linear: tweak -> smm_approval
 *     Aug 19 18:19  Sebastián (smm): tweak -> kasper_approval
 *
 * In both, Kasper's writes all persisted — no data was lost. The SMM re-routed
 * the component to Kasper Approval WITHOUT marking his tweak done, so the card
 * re-entered "Waiting" looking identical to before his review: "the system
 * lost my tweak". Under the ruling, his own still-open ask never re-surfaces
 * the card; resolving the tweak thread and re-routing is a genuine round 2 and
 * still does.
 *
 * This suite EXECUTES the real predicates (both Kasper queues) over those
 * timelines.
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

// ---------- calendar queue --------------------------------------------------
function calFinished(post, { dismissedLocally = false } = {}) {
  const scope = {
    _kasperState: { dismissed: dismissedLocally ? { [post.id]: true } : {} },
    _calComponentsFor: () => ['video', 'graphic', 'caption'],
    _calCompLinked: (p, c) => !(p['_' + c + '_unlinked']),
    _calNormStatus: s => String(s || '').trim(),
    _calCommentsFor: (p, c) => { try { return JSON.parse(p[c + '_tweaks'] || '[]'); } catch (e) { return []; } },
    _calMsgIsTweak: m => !!(m && m.is_tweak),
  };
  const names = Object.keys(scope);
  const body = extract('_kasperFinishedAt') + '\n'
    + extract('_calCompHasUnresolvedKasperTweak') + '\n'
    + extract('_calPostHasUnresolvedKasperTweak') + '\n'
    + extract('_kasperUndecidedComps') + '\n'
    + extract('_kasperIsFinished') + '\n'
    + 'return _kasperIsFinished;';
  return new Function(...names, body)(...names.map(n => scope[n]))(post);
}

const kasperTweak = done => JSON.stringify([
  { role: 'kasper', is_tweak: true, round: 1, done, created_at: '2026-08-18T21:15:04Z', body: 'Tweaks' },
]);

// --- the Reel 01 / Carrusel shape: finished, then re-routed, tweak still open
const reel01 = {
  id: 'reel01',
  kasper_finished_at: '2026-08-18T21:17:00Z',
  video_status: 'Kasper Approval',        // Ludmila's 13:47 re-route
  graphic_status: 'Client Approval',
  caption_status: 'Client Approval',
  video_tweaks: kasperTweak(false),        // his ask, still unanswered
  graphic_tweaks: '[]', caption_tweaks: '[]',
};
ok(calFinished(reel01) === true,
'the live specimen stays FINISHED (Tweaks pending) -- an unanswered tweak never re-surfaces the card');

// --- the SMM answers the ask, then re-routes: genuine round 2 --------------
const round2 = Object.assign({}, reel01, { video_tweaks: kasperTweak(true) });
ok(calFinished(round2) === false,
'once the tweak is marked done and the component is re-sent, the card RETURNS to Waiting (round 2 preserved)');

// --- clean-approved card re-routed later: unchanged behaviour ---------------
const clean = {
  id: 'clean', kasper_finished_at: '2026-08-18T21:17:00Z',
  video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Approved',
  video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]',
};
ok(calFinished(clean) === false,
'a re-route with NO outstanding tweak still re-surfaces -- the ruling only shields his own open ask');

// --- a plain kasper COMMENT is not a tweak ---------------------------------
const comment = Object.assign({}, reel01, {
  video_tweaks: JSON.stringify([{ role: 'kasper', is_tweak: false, done: false, created_at: 'x', body: 'note' }]),
});
ok(calFinished(comment) === false,
'a non-tweak Kasper comment does not count as an open ask (is_tweak gate holds)');

// --- deleted / resolved edge forms -----------------------------------------
const deleted = Object.assign({}, reel01, {
  video_tweaks: JSON.stringify([{ role: 'kasper', is_tweak: true, done: false, deleted: true, created_at: 'x' }]),
});
ok(calFinished(deleted) === false,
'a deleted tweak does not count as an open ask');

// --- never finished: unchanged ---------------------------------------------
const unfinished = Object.assign({}, reel01, { kasper_finished_at: '' });
ok(calFinished(unfinished) === false,
'a card he never finished still sits in Waiting -- Finish remains the hand-off');
ok(calFinished(unfinished, { dismissedLocally: true }) === true,
'the same-device dismissed fallback still holds while the stamp write is in flight');

// --- unlinked graphic gate survives ----------------------------------------
const unlinked = {
  id: 'ug', kasper_finished_at: '2026-08-18T21:17:00Z',
  video_status: 'Approved', graphic_status: 'Kasper Approval', caption_status: 'Approved',
  _graphic_unlinked: true,
  video_tweaks: '[]', graphic_tweaks: '[]', caption_tweaks: '[]',
};
ok(calFinished(unlinked) === true,
'an unlinked graphic stuck at KA still cannot re-surface a finished card');

// ---------- samples queue mirrors the ruling --------------------------------
function sxrFinished(post) {
  const scope = {
    _sxrKasperState: { dismissed: {} },
    SXR_REVIEW_COMPONENTS: ['video', 'graphic'],
    _calCompLinked: () => true,
    _sxrNormStatus: s => String(s || '').trim(),
    _sxrCommentsFor: (p, c) => { try { return JSON.parse(p[c + '_tweaks'] || '[]'); } catch (e) { return []; } },
    _sxrMsgIsTweak: m => !!(m && m.is_tweak),
  };
  // _sxrCompHasUnresolvedKasperTweak reads comments via its own helper chain;
  // extract it and its dependencies.
  const names = Object.keys(scope);
  const body = extract('_sxrCompHasUnresolvedKasperTweak') + '\n'
    + extract('_sxrKasperUndecidedComps') + '\n'
    + extract('_sxrKasperPostHasUnresolvedKasperTweak') + '\n'
    + extract('_sxrKasperIsFinished') + '\n'
    + 'return _sxrKasperIsFinished;';
  return new Function(...names, body)(...names.map(n => scope[n]))(post);
}
const sxrOpen = {
  id: 's1', kasper_finished_at: '2026-08-18T21:17:00Z',
  video_status: 'Kasper Approval', graphic_status: 'Approved',
  video_tweaks: kasperTweak(false), graphic_tweaks: '[]',
};
ok(sxrFinished(sxrOpen) === true,
'SAMPLES: an unanswered tweak never re-surfaces a finished card');
ok(sxrFinished(Object.assign({}, sxrOpen, { video_tweaks: kasperTweak(true) })) === false,
'SAMPLES: answered + re-sent still returns to Waiting');

if (failures) process.exit(1);
console.log('\nKasper finished-stays-finished checks passed');
