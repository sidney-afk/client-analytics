'use strict';
/*
 * A CARD DEEP LINK THAT FAILS MUST NOT LOOK LIKE A CARD DEEP LINK THAT WORKED.
 *
 * OWNER REPORT 2026-08-26: an SMM sent a `#calendar/<slug>/<cardId>` link for
 * one card; opening it "focused on another card". The month and content filters
 * were both at All, so the card was not filtered out, and the card is in the
 * data — the lookup resolves it.
 *
 * What was left were two SILENT failures, and silence is what made this read as
 * "it opened the wrong one" instead of "it did nothing":
 *
 *   1. The DOM was queried on exactly one frame and, if the element was not
 *      there yet, the function returned without a word. The reader was then
 *      looking at the calendar's ordinary state — in which a DIFFERENT card
 *      carries `.cal-card-current`. Nothing had been focused; something else
 *      already was.
 *   2. The scroll was `behavior: 'smooth'`. A smooth scroll computes its target
 *      offset once and animates toward it; thumbnails decode mid-animation,
 *      every card ahead of the target changes width, and it finishes on a
 *      NEIGHBOUR. The outline sits on the right card, off screen.
 *
 * This suite executes the shipped function against a fake DOM and drives the
 * frames by hand, so each property is checked rather than pattern-matched.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const start = html.indexOf('function _calApplyFocusRequest()');
const end = html.indexOf('/* ── The Organize menu', start);
const src = start >= 0 && end > start ? html.slice(start, end) : '';
ok(!!src, 'the focus handler is findable (harness is not vacuous)');
ok(/CAL_FOCUS_MAX_FRAMES/.test(src), 'and it is the retrying version, not the single-frame one');

/* ---- a fake DOM, driven a frame at a time -------------------------------- */
function harness(options) {
  const opts = options || {};
  const log = [];
  const frames = [];
  const timers = [];
  const card = {
    detached: false,
    classList: { add: c => log.push('class+' + c), remove: c => log.push('class-' + c) },
    scrollIntoView: init => log.push('scroll:' + init.behavior + ':' + init.inline + ':' + init.block),
    getBoundingClientRect: () => opts.rect || { left: 100, right: 300 },
  };
  let appearsAtFrame = opts.appearsAtFrame === undefined ? 0 : opts.appearsAtFrame;
  let frameNo = 0;
  const doc = {
    querySelector: () => (appearsAtFrame !== null && frameNo >= appearsAtFrame ? card : null),
    body: { contains: () => !card.detached },
    addEventListener: () => log.push('outside-listener'),
  };
  const notified = [];
  const fn = new Function(
    '_calFocusRequest', 'calState', 'wlNormalizeClient', 'showNotify',
    'requestAnimationFrame', 'document', 'window', 'setTimeout',
    '_calClearFocusHighlight', '_calFocusOutsideHandler',
    src + '\nreturn _calApplyFocusRequest;',
  )(
    { client: 'Client', cardId: 'p_target' },
    { client: 'Client', posts: [{ id: 'p_other', name: 'Other' }, { id: 'p_target', name: 'April 8th - Reel 14' }] },
    v => String(v || '').toLowerCase(),
    (title, body) => notified.push(title + '|' + body),
    cb => frames.push(cb),
    doc,
    { innerWidth: 1400 },
    (cb, ms) => timers.push({ cb, ms }),
    () => log.push('clear-highlight'),
    () => {},
  );
  fn();
  return {
    log, notified, card, timers,
    runFrames(n) { for (let i = 0; i < n; i++) { frameNo++; const queued = frames.splice(0); queued.forEach(cb => cb()); } },
    runTimers() { timers.splice(0).forEach(t => t.cb()); },
    pendingFrames: () => frames.length,
  };
}

/* ---- 1. the element is already there ------------------------------------ */
{
  const h = harness();
  h.runFrames(1);
  ok(h.log.includes('class+cal-card-focused'), 'a card that is already painted gets the persistent outline');
  ok(h.notified.length === 0, 'and nothing is announced, because nothing went wrong');
  ok(h.log.indexOf('class+cal-card-focused') < h.log.findIndex(e => e.startsWith('scroll:')),
    'the outline goes on BEFORE anything scrolls — if the scroll misbehaves the reader can still see which card was meant');
  ok(h.log.some(e => e.startsWith('scroll:auto:')),
    'the scroll is INSTANT: a smooth scroll fixes its target offset up front and late-decoding thumbnails land it on a neighbour');
  ok(!h.log.some(e => e.startsWith('scroll:smooth')), 'and is never smooth');
  ok(h.log.some(e => e === 'scroll:auto:center:nearest'),
    'centred horizontally, nearest vertically — block:center used to yank the whole page down');
}

/* ---- 2. the element paints a few frames late ---------------------------- */
{
  const h = harness({ appearsAtFrame: 6 });
  h.runFrames(1);
  ok(!h.log.length, 'a card that has not painted yet is not given up on after one frame — this is the bug that read as "it opened the wrong card"');
  ok(h.pendingFrames() === 1, 'the search is still queued for the next frame');
  h.runFrames(8);
  ok(h.log.includes('class+cal-card-focused'), 'and when the render lands, the right card is focused after all');
  ok(h.notified.length === 0, 'with nothing announced, because it worked');
}

/* ---- 3. the element never paints ---------------------------------------- */
{
  const h = harness({ appearsAtFrame: null });
  h.runFrames(60);
  ok(h.notified.length === 1, 'a card that never renders is announced exactly once, not retried forever and not dropped in silence');
  ok(/Card not shown/.test(h.notified[0]), 'and the notice says the card was not SHOWN, which is the true fault — it is on the calendar');
  ok(/April 8th - Reel 14/.test(h.notified[0]), 'it names the card, so the reader knows the link resolved to the right thing');
  ok(/Organize/.test(h.notified[0]), 'and points at the filters, which is the one thing the reader can act on');
  ok(h.pendingFrames() === 0, 'and the frame loop stops rather than spinning for the life of the tab');
}

/* ---- 4. the correction after the layout settles ------------------------- */
{
  const offscreen = harness({ rect: { left: 2000, right: 2300 } });
  offscreen.runFrames(1);
  const before = offscreen.log.filter(e => e.startsWith('scroll:')).length;
  offscreen.runTimers();
  ok(offscreen.log.filter(e => e.startsWith('scroll:')).length === before + 1,
    'a card pushed off screen by a late layout shift is scrolled back once');
}
{
  const onscreen = harness({ rect: { left: 100, right: 400 } });
  onscreen.runFrames(1);
  const before = onscreen.log.filter(e => e.startsWith('scroll:')).length;
  onscreen.runTimers();
  ok(onscreen.log.filter(e => e.startsWith('scroll:')).length === before,
    'and a card that is still visible is left alone rather than re-scrolled under the reader');
}
{
  const gone = harness({ rect: { left: 2000, right: 2300 } });
  gone.runFrames(1);
  gone.card.detached = true;
  const before = gone.log.filter(e => e.startsWith('scroll:')).length;
  gone.runTimers();
  ok(gone.log.filter(e => e.startsWith('scroll:')).length === before,
    'a repaint that replaced the card cannot make the correction scroll to a detached node');
}

if (failures) {
  console.error(`\n${failures} calendar deep-link focus check(s) failed`);
  process.exit(1);
}
console.log('\ncalendar deep-link focus checks passed');
