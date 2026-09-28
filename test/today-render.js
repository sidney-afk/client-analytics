'use strict';
/* Today paints every view without throwing (src/index/097-today.js.part).
 * A stray variable in one branch once left an editor's List view stuck on
 * the loading skeleton (Codex on #1794). Fixture data only; this repo is
 * public. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { splitModuleFragment } = require('../scripts/index-modules');
// 097 is an ES module source; strip its import header and export footer the way the build does.
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '097-today.js.part'), 'utf8');
const body = splitModuleFragment(Buffer.from(src, 'utf8')).body.toString('utf8');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const sandbox = {
  window: {}, document: { addEventListener() {} }, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  _calEsc: esc, _calEscAttr: esc, _calSmmMediaGap: p => (p.asset_url ? null : { video: true }), _svSkel: c => `<div class="sv-skeleton ${c || ''}"></div>`,
  _srpState: {}, console,
};
vm.createContext(sandbox);
vm.runInContext(body + '\nthis.api = { _tdyEditorHtml, _tdySmmHtml, _tdySkeletonHtml };', sandbox);
const api = sandbox.api;

let failed = 0;
function ok(cond, msg) { console.log((cond ? '  ok  ' : '  FAIL ') + msg); if (!cond) failed++; }
function paints(fn, msg) { let html = ''; try { html = fn(); } catch (e) { html = ''; msg += ' (threw ' + e.message + ')'; } ok(html.length > 0, msg); return html; }

const now = new Date().toISOString();
const soon = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
const me = { first: 'Casey', editor: true };
const row = (id, status) => ({ id, client_slug: 'fixture', title: 'Fixture ' + id, status, status_at: now, due_date: soon });
const ed = { names: { fixture: 'Fixture Client' }, open: [row('a', 'todo'), row('b', 'tweak')], done: [row('c', 'smm_approval')], urgent: ['a'] };
paints(() => api._tdyEditorHtml(me, ed, 'List'), 'editor List view paints with work queued');
paints(() => api._tdyEditorHtml(me, ed, 'Deck'), 'editor Deck view paints with work queued');
paints(() => api._tdyEditorHtml(me, { ...ed, open: [] }, 'List'), 'editor empty state paints');

const post = { id: 'p1', client: 'fixture', name: 'Post', scheduled_date: soon, status: 'Draft', caption: '' };
const smm = { names: { fixture: 'Fixture Client' }, notListed: false, open: [row('d', 'smm_approval')], done: [], posts: [post] };
paints(() => api._tdySmmHtml(me, smm, 'Rings'), 'SMM Rings view paints');
paints(() => api._tdySmmHtml(me, smm, 'Walk-through'), 'SMM Walk-through view paints');
const note = paints(() => api._tdySmmHtml(me, { ...smm, notListed: true, open: [], posts: [] }, 'Rings'), 'SMM with no listed clients paints');
ok(note.indexOf('tdy-note') >= 0 && note.indexOf('tdy-note') < note.indexOf('tdy-big'), 'the "no clients listed" note sits above the count');
ok(/role="status"/.test(api._tdySkeletonHtml()), 'the skeleton announces itself as loading');
ok(!/Loading your day/.test(src), 'the old text loader is gone');
ok(!/syncview_today_scope|_tdySetScope/.test(src), 'the My / All switch and its saved setting are gone');

if (failed) { console.log(`today-render: ${failed} failed`); process.exit(1); }
console.log('today-render: all checks passed');
