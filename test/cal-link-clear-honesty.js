'use strict';
/*
 * The calendar card's remove-link cross, and what its confirm dialog promises.
 *
 * The owner asked whether the cross is needed at all. It is: clearing a link is
 * the seal's escape hatch. The seal forbids RE-POINTING a link (post-flip a
 * pasted URL mints a card that looks linked and then refuses every status
 * change, because the write needs a native id the paste never supplied), but
 * CLEARING only withdraws a claim and cannot produce that row -- which is why
 * the seal guard sits inside `if (val)` and an empty value falls through to the
 * clear sentinel. Remove the cross and a half-linked card has no in-app repair.
 *
 * But the dialog was making a promise the app then broke. On a card whose
 * component carries a native deliverable id -- post-flip, the normal shape --
 * _calAdoptDeliverableLinks refills any EMPTY link column from that deliverable
 * on the next load. So the clear was real for a moment and then silently
 * undone, while the dialog said "nothing else about the card changes".
 *
 * This suite executes the shipped confirm builder against both card shapes.
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
  throw new Error('unbalanced braces: ' + name);
}

function run(post, component) {
  const seen = {};
  const fn = new Function('deps', `
    const { _isClientLink, calState, _writeUiNativeId, showConfirm, _calLinearCommit } = deps;
    ${grabFunc('_calLinearClear')}
    return _calLinearClear;
  `)({
    _isClientLink: false,
    calState: { posts: post ? [post] : [] },
    _writeUiNativeId: (p, c) => String((c === 'video' ? p.video_deliverable_id : p.graphic_deliverable_id) || ''),
    showConfirm: (title, body, onOk, okLabel) => { seen.title = title; seen.body = body; seen.okLabel = okLabel; seen.onOk = onOk; },
    _calLinearCommit: (el, pid, which) => { seen.committed = { value: el.value, pid, which }; },
  });
  fn(post ? post.id : 'p_x', component);
  return seen;
}

/* 1. The post-flip normal shape: the link comes back, and the dialog says so. */
{
  const seen = run({ id: 'p1', video_deliverable_id: 'del_abc', linear_issue_id: 'https://linear.app/x/issue/VID-1/a' }, 'video');
  ok(/restored automatically/.test(seen.body),
    'a card with a native deliverable is told the link will come back');
  ok(!/nothing else about the card changes/.test(seen.body),
    'and is NOT told the old promise the app then breaks');
  ok(/video/.test(seen.body), 'the component is named');
}
/* 2. The half-linked card: the case the cross exists for. Here the clear DOES
 *    stick, because adoption only fills from a deliverable that exists. */
{
  const seen = run({ id: 'p2', linear_issue_id: 'https://linear.app/x/issue/VID-2/b' }, 'video');
  ok(/nothing else about the card changes/.test(seen.body),
    'a half-linked card keeps the original promise, which is true for it');
  ok(!/restored automatically/.test(seen.body),
    'and is not told a deliverable will restore a link it does not have');
}
/* 3. The thumbnail slot reads in its own vocabulary. */
{
  const seen = run({ id: 'p3', graphic_deliverable_id: 'del_g' }, 'graphic');
  ok(/thumbnail/.test(seen.body) && /restored automatically/.test(seen.body),
    'the graphic slot says thumbnail, and still tells the truth about adoption');
}
/* 4. Whatever the copy, the clear itself still runs -- the escape hatch stays. */
{
  const seen = run({ id: 'p4', video_deliverable_id: 'del_z' }, 'video');
  seen.onOk();
  ok(seen.committed && seen.committed.value === '' && seen.committed.which === 'video',
    'confirming still commits an empty value, which is the clear sentinel the seal deliberately exempts');
  ok(seen.okLabel === 'Remove it', 'and the action keeps its label');
}
/* 5. A client link can never reach any of this. */
{
  const fn = new Function('deps', `
    const { _isClientLink, calState, _writeUiNativeId, showConfirm, _calLinearCommit } = deps;
    ${grabFunc('_calLinearClear')}
    return _calLinearClear;
  `)({
    _isClientLink: true,
    calState: { posts: [] },
    _writeUiNativeId: () => '',
    showConfirm: () => { throw new Error('a client link must never be shown this dialog'); },
    _calLinearCommit: () => { throw new Error('a client link must never commit a link clear'); },
  });
  let threw = false;
  try { fn('p5', 'video'); } catch (e) { threw = true; }
  ok(!threw, 'the client-link guard returns before the dialog and before any write');
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\ncalendar link-clear honesty checks passed');
