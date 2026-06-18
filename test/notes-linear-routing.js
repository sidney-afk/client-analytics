'use strict';
/*
 * Part B — Notes component picker + Linear routing regression.
 *
 * Run: node test/notes-linear-routing.js   (exit 0 = all good)
 *
 * Extracts the REAL _calLinearUrlFor from ../index.html and asserts the routing
 * contract, plus shipped-code assertions that tie the regression to index.html:
 *  - a NEW root note targets the picked component (_calComposeComp, default Video);
 *  - a note is posted to Linear ONLY for video/thumbnail (never caption/title),
 *    via _calLinearUrlFor, gated explicitly on comp === 'video' || 'graphic';
 *  - the composer renders the component picker over the card's active components;
 *  - the modal open resets the picker to Video;
 *  - reply->component resolution iterates the full CAL_REVIEW_COMPONENTS set.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let i = INDEX.indexOf('{', at), depth = 0;
  for (let j = i; j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

const mod = new Function(grabFunc('_calLinearUrlFor') + '\n;return { _calLinearUrlFor };')();
const { _calLinearUrlFor } = mod;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ❌ ' + m); } };

// ---- 1) _calLinearUrlFor resolves video/graphic ids; caption/title -> '' ----
const post = { linear_issue_id: 'https://linear.app/x/issue/VID-1', graphic_linear_issue_id: 'https://linear.app/x/issue/GRA-1' };
ok(_calLinearUrlFor(post, 'video') === 'https://linear.app/x/issue/VID-1', "video -> linear_issue_id");
ok(_calLinearUrlFor(post, 'graphic') === 'https://linear.app/x/issue/GRA-1', "graphic -> graphic_linear_issue_id");
ok(_calLinearUrlFor(post, 'caption') === '', "caption -> '' (no Linear)");
ok(_calLinearUrlFor(post, 'title') === '', "title -> '' (no Linear)");
// the helper historically falls through to the video id for an unknown comp —
// which is exactly why _calAppendComment gates explicitly on video/graphic.
ok(_calLinearUrlFor(post, 'something-else') === 'https://linear.app/x/issue/VID-1', "unknown comp falls through to video id (so the caller MUST gate)");

// ---- 2) routing gate mirrors the shipped _calAppendComment ----
function wouldPostTo(comp) { return (comp === 'video' || comp === 'graphic') ? _calLinearUrlFor(post, comp) : null; }
ok(wouldPostTo('video') === 'https://linear.app/x/issue/VID-1', "video note routes to Linear");
ok(wouldPostTo('graphic') === 'https://linear.app/x/issue/GRA-1', "thumbnail note routes to Linear");
ok(wouldPostTo('caption') === null, "caption note NEVER routes to Linear");
ok(wouldPostTo('title') === null, "title note NEVER routes to Linear");
ok(_calLinearUrlFor({}, 'video') === '', "unlinked video -> empty url (post no-ops, no error)");

// ---- 3) shipped-code assertions ----
const append = grabFunc('_calAppendComment');
ok(/_calComponentsFor\(post\)\.indexOf\(_calComposeComp\) >= 0 \? _calComposeComp : 'video'/.test(append),
   "root comp uses the picked _calComposeComp, validated against the card's components (default video)");
ok(/if \(comp === 'video' \|\| comp === 'graphic'\) \{[\s\S]*?_calPostLinearComment\(_calLinearUrlFor\(post, comp\), body, msg\.author\)/.test(append),
   "Linear routing is gated on video/graphic and goes through _calLinearUrlFor");
const composer = grabFunc('_calComposerHtml');
ok(/data-cm-toggle="comp"/.test(composer) && /_calSetComposeComp\(/.test(composer) && /_calComponentsFor\(post\)\.map/.test(composer),
   "composer renders the component picker over the card's active components");
const find = grabFunc('_calFindCompForCommentId');
ok(/for \(const c of CAL_REVIEW_COMPONENTS\)/.test(find),
   "reply->component resolution iterates the full CAL_REVIEW_COMPONENTS set");
ok(/_calComposeComp = 'video';\s*\/\/ Part B/.test(INDEX), "modal open resets the picker to Video");

console.log(`\nnotes-linear-routing: ${pass} passed, ${fail} failed  ${fail ? '❌' : '✅'}`);
process.exit(fail ? 1 : 0);
