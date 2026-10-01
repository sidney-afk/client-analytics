'use strict';
/*
 * The Notes dialog shows a loading skeleton, not "All clear", until the card's
 * comments have arrived. Measured live 2026-10-01: the dialog painted at once
 * and said "All clear" / "No notes yet" for about 1.3 s while the crosswalk
 * lookup and the two comment reads were still on their way, which reads as a
 * statement about the card rather than as "not here yet".
 * Fails on the code before this change: the helpers do not exist.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok  ' + m); };

function grab(name) {
  const at = INDEX.search(new RegExp('function\\s+' + name + '\\s*\\('));
  assert.ok(at >= 0, 'function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}' && --depth === 0) return INDEX.slice(at, j + 1);
  }
  throw new Error('unbalanced ' + name);
}
const ctx = { Object, String, SXR_COMPONENTS: ['video', 'thumbnail'], _calComponentsFor: () => ['video', 'thumbnail', 'caption'], _writeUiNativeId: (post, c) => (post.ids || {})[c] || '' };
vm.createContext(ctx);
vm.runInContext(grab('_prodCardCommentsPending') + '\n' + grab('_prodCommentsSkeletonHtml') + '\nthis.p = _prodCardCommentsPending; this.h = _prodCommentsSkeletonHtml;', ctx);

ok(ctx.p(null) === false, 'no card, nothing pending');
ok(ctx.p({}) === false, 'a card with no lookup and no read is not pending (its notes are what is held: legacy or none)');
ok(ctx.p({ _canonicalCrosswalkInFlight: 1 }) === true, 'pending while the crosswalk lookup runs');
ok(ctx.p({ ids: { video: 'd1' }, _canonicalCommentReads: { d1: { status: 'loading' } } }, 'calendar') === true, 'pending while a bound component read is loading');
ok(ctx.p({ ids: { video: 'd1', thumbnail: 'd2' }, _canonicalCommentReads: { d1: { status: 'ready' }, d2: { status: 'loading' } } }, 'calendar') === true, 'pending while any bound component read is still loading');
ok(ctx.p({ ids: { video: 'd1' }, _canonicalCrosswalkInFlight: 0, _canonicalCommentReads: { d1: { status: 'ready' }, d2: { status: 'error' } } }, 'calendar') === false, 'settled once every read answered, ready or failed (a failure is not a skeleton forever)');
ok(ctx.p({ ids: { video: 'd-new' }, _canonicalCommentReads: { 'd-old': { status: 'loading' }, 'd-new': { status: 'ready' } } }, 'calendar') === false,
  'an abandoned read of a deliverable the card no longer points at (a projection aborted by a re-point) never holds the skeleton');
ok(ctx.p({ ids: { caption: 'd9' }, _canonicalCommentReads: { d9: { status: 'loading' } } }, 'sxr') === false, 'Samples counts only its own components');
const html = ctx.h();
ok(/aria-busy="true"/.test(html) && /role="status"/.test(html) && /cal-cm-skel-row/.test(html), 'the skeleton is announced as busy and has note-shaped rows');
ok(!/All clear|No notes yet/.test(html), 'and says nothing about the card');
ok((INDEX.match(/\(_prodCardCommentsPending\(post, '(?:calendar|sxr)'\) \? _prodCommentsSkeletonHtml\(\) : emptyMsg\)/g) || []).length === 2,
  'both the Calendar and the Samples Notes dialogs show it in place of the empty message');
ok(/const feedHtml = roots\.length \? roots\.map\(renderThread\)\.join\(''\) : \(_prodCardCommentsPending\(post, 'calendar'\)/.test(INDEX),
  'rows already held are still shown at once; only the empty state waits');
ok(/\.cal-cm-skel \{[^}]*sv-shimmer/.test(INDEX) && /prefers-reduced-motion: reduce\) \{ \.cal-cm-skel \{ animation: none/.test(INDEX), 'the shimmer is styled and respects reduced motion');
console.log('\nnotes-loading-skeleton: ' + passed + ' checks passed');
