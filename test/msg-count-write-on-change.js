'use strict';
/* msg-count-write-on-change.js -- the header Messages count is rewritten only when its value changes (OPEN_REPAIRS 487).
 *
 * 326 `_msgPaintCounts` and 327 `svuPaintCounts` run on every inbox read and live refresh. They used to set the
 * count's text, `hidden` (and, in 327, `className`) every time, even to the same values. Each write is a DOM
 * mutation, and the phone bar (099) answers any mutation outside the caption with a page-wide popup scan, so
 * qa/staff-phone-responsiveness.js failed at random with "Caption tap scanned unrelated popups" whenever a refresh
 * landed during the caption tap (2 of 8 runs on main, 2026-10-24).
 *   - each painter, run twice with the same counts, writes nothing the second time
 *   - a changed count is still written (the guard does not freeze the badge)
 *   - the old unconditional writes fail the first check (what this test guards)
 * The functions are taken from the fragments' source and run on stand-in elements that count writes.
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
let failures = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { failures++; console.error('FAIL  ' + m); } };

function extract(file, name) {
  const src = fs.readFileSync(path.join(root, 'src/index', file), 'utf8');
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(name + ' not found in ' + file);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

// An element that counts every write that would be a DOM mutation.
function element(text, hidden, cls) {
  const el = { writes: 0, _text: text, _hidden: hidden, _cls: cls, _classes: new Set() };
  Object.defineProperty(el, 'textContent', { get() { return this._text; }, set(v) { this.writes++; this._text = String(v); } });
  Object.defineProperty(el, 'hidden', { get() { return this._hidden; }, set(v) { this.writes++; this._hidden = !!v; } });
  Object.defineProperty(el, 'className', { get() { return this._cls; }, set(v) { this.writes++; this._cls = String(v); } });
  // DOMTokenList.toggle with a force that matches the current state changes nothing.
  el.classList = { toggle(c, force) { const has = el._classes.has(c); if (has !== force) { el.writes++; force ? el._classes.add(c) : el._classes.delete(c); } return force; } };
  return el;
}

function run(fnSrc, name, env) {
  const els = { msg: element('0', true, 'msg-unread'), kasper: element('0', false, '') };
  const document = { querySelectorAll: q => q.includes('data-msg-count') ? [els.msg] : q.includes('data-kasper-count') ? [els.kasper] : [] };
  const paint = new Function('document', ...Object.keys(env), fnSrc + '\nreturn ' + name + ';')(document, ...Object.values(env));
  return { els, paint };
}

function check(label, fnSrc, name, env, setCount) {
  setCount(3);
  const { els, paint } = run(fnSrc, name, env);
  paint();
  const first = els.msg.writes + els.kasper.writes;
  els.msg.writes = els.kasper.writes = 0;
  paint();
  ok(els.msg.writes + els.kasper.writes === 0, `${label}: the same counts painted again write nothing (first paint wrote ${first})`);
  setCount(0);
  paint();
  ok(els.msg.textContent === '0' && els.msg.hidden === true, `${label}: a changed count is still written`);
  return fnSrc;
}

// 326: the plain count.
let convs = [];
const env326 = {
  _msgState: { unavailable: false, get conversations() { return convs; } },
  _msgCanUse: () => true,
  svuActive: () => false,
  svuPaintCounts: () => {},
  _msgUnreadConversations: () => convs.filter(c => Number(c.unread) > 0).length,
};
const set326 = n => { convs = Array.from({ length: n }, (_, i) => ({ post_id: 'p' + i, unread: 1 })); };
const src326 = check('326 _msgPaintCounts', extract('326-core-messages-inbox.js.part', '_msgPaintCounts'), '_msgPaintCounts', env326, set326);

// 327: the round-5 count (switch unread_badges_v2), which also sets the badge's colour class.
const env327 = {
  _msgState: { get conversations() { return convs; } },
  _svuConvState: c => ({ newTotal: c.unread, waitingIds: new Set(), comment: c.unread, staff: 0, kasper: 0 }),
  _svuCounts: null,
};
const src327 = check('327 svuPaintCounts', extract('327-core-unread-badges.js.part', 'svuPaintCounts'), 'svuPaintCounts', env327, set326);

// The old code: unconditional writes. This test must fail on it.
const old326 = src326.replace(/if \(el\.textContent !== String\(n\)\) /g, '').replace(/if \(el\.hidden !== \(n === 0\)\) /g, '');
set326(3);
const o = run(old326, '_msgPaintCounts', env326);
o.paint(); o.els.msg.writes = o.els.kasper.writes = 0; o.paint();
ok(old326 !== src326 && o.els.msg.writes > 0, `the old unconditional writes rewrite an unchanged count (${o.els.msg.writes} writes; what this test guards)`);
ok(/svu-count-/.test(src327), '327 painter still sets the colour class');

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nmsg-count-write-on-change: all checks passed');
