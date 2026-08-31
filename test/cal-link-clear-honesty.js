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

function runSamples(post, component) {
  const seen = {};
  const fn = new Function('deps', `
    const { _isClientLink, sxrState, _writeUiNativeId, showConfirm, _sxrLinearCommit } = deps;
    ${grabFunc('_sxrLinearClear')}
    return _sxrLinearClear;
  `)({
    _isClientLink: false,
    sxrState: { posts: post ? [post] : [] },
    _writeUiNativeId: (p, c) => String((c === 'video' ? p.video_deliverable_id : p.graphic_deliverable_id) || ''),
    showConfirm: (title, body, onOk, okLabel) => { seen.title = title; seen.body = body; seen.okLabel = okLabel; seen.onOk = onOk; },
    _sxrLinearCommit: (el, pid, which) => { seen.committed = { value: el.value, pid, which }; },
  });
  fn(post ? post.id : 'p_x', component);
  return seen;
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
  ok(/come back on the next load/.test(seen.body) && /if that deliverable still holds the link/.test(seen.body),
    'a card with a native deliverable is told the link may come back, AND what decides it');
  /* The retired sentence said "will be restored automatically on the next
     load". Codex flagged it 2026-08-31 and was right: a stored deliverable id
     proves the field is non-empty and nothing else, while the adopter also
     needs the row to read back, to carry a linear_issue_url, to still be bound
     to THIS card, and to save. A dangling id, a deliverable whose Linear issue
     has not been minted, and one bound elsewhere all skip it deterministically.
     Replacing an over-promise with a smaller over-promise is the sweep's own
     failure class, so the unconditional wording is pinned OUT. */
  ok(!/restored automatically/.test(seen.body),
    '...and is not promised a restore the adopter can deterministically skip');
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
  ok(!/come back on the next load/.test(seen.body),
    'and is not told a deliverable will restore a link it does not have');
}
/* 3. The thumbnail slot reads in its own vocabulary. */
{
  const seen = run({ id: 'p3', graphic_deliverable_id: 'del_g' }, 'graphic');
  ok(/thumbnail/.test(seen.body) && /come back on the next load/.test(seen.body),
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

/* ---- THE SAMPLES TWIN ---------------------------------------------------
 * Found unfixed by the unknowable-assertion sweep on 2026-08-31, hours after
 * the calendar half was corrected. _sxrAdoptDeliverableLinks refills any EMPTY
 * link column from the sample native deliverable on the next load and again on
 * the after-create timers, and clearing never touches the deliverable id -- so
 * on a native sample the clear is undone exactly as it was on a card.
 *
 * The BEHAVIOUR stays. The adopter exists because a native sample is
 * materialized before the Linear mirror drains, and the live case it was built
 * for was a graphics URL that arrived late. Suppressing it for cleared rows
 * would trade an honest sentence for a real gap.
 *
 * The trap this section exists to catch: copying _calLinearClear verbatim
 * brings calState with it, which is empty on the samples surface and would
 * silently take the non-native branch for EVERY sample -- the exact wrong
 * promise, restored, with the fix apparently applied.
 */
{
  const seen = runSamples({ id: 's1', video_deliverable_id: 'del_s1', linear_issue_id: 'https://linear.app/x/issue/VID-9/a' }, 'video');
  ok(/come back on the next load/.test(seen.body) && /if that deliverable still holds the link/.test(seen.body),
    'SAMPLES: a native sample is told the link may come back, AND what decides it');
  ok(!/restored automatically/.test(seen.body),
    '...with the same conditional wording as its calendar twin -- the twins drifting apart is what created this finding');
  ok(!/nothing else about the sample changes/.test(seen.body),
    '...and is not told the promise the adopter then breaks');
  ok(/sample/.test(seen.body) && !/card/.test(seen.body),
    'and it speaks about a SAMPLE, which is how a calState copy-paste would show itself');
}
{
  const seen = runSamples({ id: 's2', linear_issue_id: 'https://linear.app/x/issue/VID-8/b' }, 'video');
  ok(/nothing else about the sample changes/.test(seen.body),
    'SAMPLES: a half-linked sample keeps the original promise, which is true for it');
  ok(!/come back on the next load/.test(seen.body),
    '...and is not told about a restore that cannot happen without a deliverable');
}
{
  const seen = runSamples({ id: 's3', graphic_deliverable_id: 'del_s3' }, 'graphic');
  ok(/thumbnail/.test(seen.body) && /come back on the next load/.test(seen.body),
    'SAMPLES: the graphic component is named, and resolves its own native id');
  seen.onOk();
  ok(seen.committed && seen.committed.value === '' && seen.committed.which === 'graphic',
    'and the clear still runs -- the sentence changed, the escape hatch did not');
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\ncalendar link-clear honesty checks passed');
