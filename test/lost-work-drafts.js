'use strict';
/*
 * OPEN_REPAIRS 314, item 3: unsaved text outlives the tab.
 *
 * Runs the REAL shared draft helper (src/index/131-core-html.js.part) in a
 * sandbox against a fake storage, then checks that every surface is wired to it.
 * The browser behaviour is proven by docs/syncview-design/tests/lost-work-drafts-browser.js.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripComments } = require('./helpers/strip-comments');
const ROOT = path.resolve(__dirname, '..');
const frag = n => fs.readFileSync(path.join(ROOT, 'src/index', n), 'utf8');
let failures = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures++; };

const html = frag('131-core-html.js.part');
const start = html.indexOf('const SV_DRAFT_PREFIX');
const end = html.indexOf('export {');
ok(start > 0 && end > start, 'the shared helper is in 131-core-html');
const helper = html.slice(start, end);

function fakeStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key(i) { return Array.from(m.keys())[i] || null; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    _m: m,
  };
}
function load(opts) {
  opts = opts || {};
  const clock = { now: 1790000000000 };
  const store = opts.storage || fakeStorage();
  const win = {};
  if (opts.windowThrows) Object.defineProperty(win, 'localStorage', { get() { throw new Error('blocked'); } });
  else win.localStorage = store;
  const sandbox = {
    window: win, console, JSON, Date: { now: () => clock.now }, encodeURIComponent, String, Number, Array, Object, Math,
    _isClientLink: !!opts.client,
    _calEsc: s => String(s).replace(/</g, '&lt;'),
  };
  vm.createContext(sandbox);
  vm.runInContext(helper + '\nthis.api = { _svDraftSave, _svDraftRead, _svDraftClear, _svDraftClearIf, _svDraftNoteHtml, _svDraftKey, SV_DRAFT_TTL_MS, SV_DRAFT_MAX_CHARS, SV_DRAFT_MAX_ENTRIES };', sandbox);
  return { api: sandbox.api, clock, store };
}

{
  const { api, store } = load();
  ok(api._svDraftSave('cal', 'c1', 'p1', 'caption', 'hello', { base: 'old' }) === true, 'a draft is saved');
  const d = api._svDraftRead('cal', 'c1', 'p1', 'caption');
  ok(d && d.text === 'hello' && d.meta.base === 'old', 'and read back with its meta');
  ok(api._svDraftRead('cal', 'c1', 'p1', 'note') === null && api._svDraftRead('cal', 'c2', 'p1', 'caption') === null
    && api._svDraftRead('prod', 'c1', 'p1', 'caption') === null && api._svDraftRead('cal', 'c1', 'p2', 'caption') === null,
    'one draft per surface + client + card + field: no other key sees it');
  api._svDraftSave('cal', 'a|b', 'c', 'd', 'x'); api._svDraftSave('cal', 'a', 'b|c', 'd', 'y');
  ok(api._svDraftRead('cal', 'a|b', 'c', 'd').text === 'x' && api._svDraftRead('cal', 'a', 'b|c', 'd').text === 'y', 'a separator character inside an id cannot make two keys collide');
  api._svDraftClearIf('cal', 'c1', 'p1', 'caption', 'something typed later');
  ok(!!api._svDraftRead('cal', 'c1', 'p1', 'caption'), 'a save of OTHER text does not clear the draft (newer typing is still unsaved)');
  api._svDraftClearIf('cal', 'c1', 'p1', 'caption', '  hello \r\n');
  ok(api._svDraftRead('cal', 'c1', 'p1', 'caption') === null, 'a confirmed save of the same text clears it');
  api._svDraftSave('cal', 'c1', 'p1', 'caption', 'again');
  api._svDraftSave('cal', 'c1', 'p1', 'caption', '   ');
  ok(api._svDraftRead('cal', 'c1', 'p1', 'caption') === null, 'deleting all the text leaves nothing to restore');
  api._svDraftSave('cal', 'c1', 'p1', 'caption', 'x'); api._svDraftClear('cal', 'c1', 'p1', 'caption');
  ok(api._svDraftRead('cal', 'c1', 'p1', 'caption') === null, 'clear removes it');
  ok(!/sendBeacon|fetch\(|XMLHttpRequest/.test(helper), 'the helper never sends anything');
}
{
  const { api, clock, store } = load();
  api._svDraftSave('cal', 'c', 'p', 'caption', 'old text');
  clock.now += api.SV_DRAFT_TTL_MS - 1000;
  ok(!!api._svDraftRead('cal', 'c', 'p', 'caption'), 'a draft just under 7 days old is kept');
  clock.now += 2000;
  ok(api._svDraftRead('cal', 'c', 'p', 'caption') === null && store._m.size === 0, 'a draft over 7 days old is gone, and removed from storage');
}
{
  const { api, store } = load();
  ok(api._svDraftSave('cal', 'c', 'p', 'caption', 'x'.repeat(api.SV_DRAFT_MAX_CHARS + 1)) === false && store._m.size === 0, 'a draft over the size cap is not stored (never a cut copy)');
  ok(api._svDraftSave('cal', 'c', 'p', 'caption', 'x'.repeat(api.SV_DRAFT_MAX_CHARS)) === true, 'one exactly at the cap is stored');
}
{
  const { api, clock, store } = load();
  for (let i = 0; i < api.SV_DRAFT_MAX_ENTRIES + 15; i++) { clock.now += 10; api._svDraftSave('cal', 'c', 'p' + i, 'caption', 'text ' + i); }
  const keys = Array.from(store._m.keys());
  ok(keys.length === api.SV_DRAFT_MAX_ENTRIES, 'no more than ' + api.SV_DRAFT_MAX_ENTRIES + ' drafts are held (' + keys.length + ')');
  ok(api._svDraftRead('cal', 'c', 'p0', 'caption') === null && !!api._svDraftRead('cal', 'c', 'p' + (api.SV_DRAFT_MAX_ENTRIES + 14), 'caption'), 'the oldest go first, the newest stay');
}
{
  const thrower = { get length() { throw new Error('blocked'); }, key() { throw new Error('blocked'); }, getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } };
  const { api } = load({ storage: thrower });
  let threw = false, r;
  try {
    r = [api._svDraftSave('cal', 'c', 'p', 'caption', 'x'), api._svDraftRead('cal', 'c', 'p', 'caption')];
    api._svDraftClear('cal', 'c', 'p', 'caption'); api._svDraftClearIf('cal', 'c', 'p', 'caption', 'x');
  } catch (e) { threw = true; }
  ok(!threw && r[0] === false && r[1] === null, 'storage that throws on every call: nothing throws, save says false, read says nothing');
  const w = load({ windowThrows: true }).api;
  threw = false;
  try { w._svDraftSave('cal', 'c', 'p', 'caption', 'x'); w._svDraftRead('cal', 'c', 'p', 'caption'); w._svDraftClear('cal', 'c', 'p', 'caption'); } catch (e) { threw = true; }
  ok(!threw, 'window.localStorage itself throwing: nothing throws');
  const { api: a2, store } = load();
  store.setItem(a2._svDraftKey('cal', 'c', 'p', 'caption'), '{not json');
  ok(a2._svDraftRead('cal', 'c', 'p', 'caption') === null, 'a corrupt entry reads as nothing');
  store.setItem(a2._svDraftKey('cal', 'c', 'p', 'caption'), JSON.stringify({ v: 2, t: 'x', at: Date.now() }));
  ok(a2._svDraftRead('cal', 'c', 'p', 'caption') === null, 'an entry from an unknown version reads as nothing');
}
{
  const { api, store } = load({ client: true });
  ok(api._svDraftSave('cal', 'c', 'p', 'caption', 'x') === false && store._m.size === 0 && api._svDraftRead('cal', 'c', 'p', 'caption') === null, 'a client link stores and reads nothing');
}
{
  const { api } = load();
  const note = api._svDraftNoteHtml('onclick="fn(1)"');
  ok(/Restored your unsaved text/.test(note) && /Discard/.test(note) && /onclick="fn\(1\)"/.test(note) && !/overlay|modal|dialog/i.test(note), 'the restored line says so, offers Discard and is not a dialog');
}

// ---- every surface is wired ----
const cal = stripComments(frag('170-calendar-links-status.js.part'));
const notes = stripComments(frag('190-calendar-approval-comments.js.part'));
const prodC = stripComments(frag('230-production-create-comments.js.part'));
const prodD = stripComments(frag('240-production-description.js.part'));
const post = stripComments(frag('180-calendar-native-post-media.js.part'));
ok(/_calCaptionDraftWrite\(pid, val\)/.test(cal) && /_svDraftClearIf\('cal', _saveSlug, realId, 'caption', edits\.caption\)/.test(cal), 'Calendar caption: kept on every change, dropped only when a save of that text lands');
ok(/_calCaptionDraftView\(p\)/.test(cal) && /meta\.base != null && _svDraftNorm\(d\.meta\.base\) !== _svDraftNorm\(p\.caption\)/.test(cal), 'Calendar caption: a restore over a caption that changed elsewhere goes to the two-choice notice, never straight over it');
ok(/_calNoteDraftSet\(pid, body, \{ sending: Date\.now\(\) \}\)/.test(notes) && /_calNoteDraftClearIfSent\(pid, body\)/.test(notes) && /d\.meta\.sending && _calNoteInThread\(post, d\.text\)/.test(notes), 'Calendar note: marked while on its way, dropped on acknowledgement, not restored when the thread already holds it');
ok(!/sessionStorage\.setItem\('sv_noteDraft_' \+ _calOpenCommentsPid/.test(notes), 'Calendar note: staff no longer rely on tab-only storage');
ok(/_svDraftSave\('prod', _prodCommentDraftClient\(id\), String\(id\), 'comment'/.test(prodC) && /_svDraftClearIf\('prod', _prodCommentDraftClient\(id\), String\(id\), 'comment', comment\.body\)/.test(prodC) && /_svDraftRead\('prod', _prodCommentDraftClient\(id\), id, 'comment'\)/.test(prodC), 'Production comment and reply composer: kept, restored, dropped on acknowledgement');
ok(/_prodCommentBegin[\s\S]*?draft\.restored = false/.test(prodC) && /action !== 'add'\) return;/.test(prodC), 'Production: an edit of an existing comment is never stored');
ok(/_svDraftSave\('prod', _prodDescDraftClient\(id\), String\(id\), 'description'/.test(prodD) && /_svDraftClear\('prod', _prodDescDraftClient\(id\), String\(id\), 'description'\);   \/\/ acknowledged/.test(prodD) && /_prodDescDraftRestore\(id, state, next\)/.test(prodD), 'Production description: kept, restored into the editor, dropped on acknowledgement');
ok(/_calNativeDraftKeep\(state\);/.test(cal) && /_calNativeDraftRestore\(_calNativePostState\)/.test(post) && /_calNativeDraftClear\(state\);/.test(post), 'Create Post names: kept, restored, dropped when the post is created');

if (failures) { console.error('\nlost-work-drafts: ' + failures + ' FAILED'); process.exit(1); }
console.log('\nlost-work-drafts: all checks passed');
