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
const store = {};
const fetched = [];
let identity = null;
const sandbox = {
  window: {}, document: { addEventListener() {} }, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  fetch: url => { fetched.push(String(url)); return Promise.resolve({ ok: true, json: async () => [] }); },
  CAL_SUPABASE_URL: 'https://fixture.example', CAL_SUPABASE_ANON_KEY: 'fixture-key', SMM_WEEKLY_REPORTS_URL: 'https://fixture.example/functions/v1/smm-weekly-reports',
  _syncviewStaffIdentityForHeaders: () => identity, svCurrentClients: () => new Map(), svClientKey: x => x, svScopeMode: () => 'all', svSmmCurrentClients: () => [], svRosterEntryFor: () => null,
  _calEsc: esc, _calEscAttr: esc, _calSmmMediaGap: p => (p.asset_url ? null : { video: true }), _svSkel: c => `<div class="sv-skeleton ${c || ''}"></div>`,
  _srpState: {}, console,
};
sandbox._cardReadFetch = sandbox.fetch; // transport scope is tested independently
vm.createContext(sandbox);
vm.runInContext(body + '\nthis.api = { _tdyJobs, _tdyEditorHtml, _tdySmmHtml, _tdySkeletonHtml, _tdyCacheRead, _tdyCacheWrite, _tdyLoad, _tdyIso, _tdyDays, tdyState, _tdyDropOldDay, _tdyTakeEarly };', sandbox);
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

// Dates to move counts only To Do work with a past due date.
const past = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
const late = (id, status) => ({ ...row(id, status), due_date: past });
const jobs = api._tdyJobs({ open: [late('t1', 'todo'), late('t2', 'in_progress'), late('t3', 'tweak'), late('t4', 'smm_approval'), row('t5', 'todo')], posts: [] });
const dates = jobs.find(j => j.key === 'dates').rows.map(x => x.r.id);
ok(dates.length === 1 && dates[0] === 't1', 'Dates to move lists only To Do items whose due date has passed (got ' + dates.join(',') + ')');

// A saved copy is only good on the day it was written.
const dayKey = d => api._tdyIso(d);
const yesterday = new Date(); yesterday.setHours(0, 0, 0, 0); yesterday.setTime(yesterday.getTime() - 3600e3);   // 23:00 yesterday, inside the 24 h limit
store.syncview_today_cache_v1 = JSON.stringify({ who: 'u|smm', at: yesterday.getTime(), day: dayKey(yesterday), data: { open: [], done: [], posts: [], names: {} } });
ok(api._tdyCacheRead('u|smm') === null, 'a saved copy from yesterday is not painted, even inside 24 hours');
store.syncview_today_cache_v1 = JSON.stringify({ who: 'u|smm', at: Date.now(), data: { open: [] } });
ok(api._tdyCacheRead('u|smm') === null, 'a saved copy with no day stamp (written by the old code) is not painted');
api._tdyCacheWrite('u|smm', { open: [], done: [], posts: [], names: {} });
ok(api._tdyCacheRead('u|smm') !== null, "today's saved copy is painted");
api.tdyState.data = { open: [] }; api.tdyState.who = 'u|smm'; api.tdyState.day = dayKey(yesterday);
api._tdyDropOldDay();
ok(api.tdyState.data === null, 'an answer held in memory past midnight is dropped, not shown as today');

// The <head> script's early reads must be the exact URLs the tab asks for,
// or the tab just misses them and reads for itself (correct, but not faster).
const headSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '005-head-boot.html.part'), 'utf8');
const at = headSrc.indexOf("if (target === 'today' && window.fetch) {");
let depth = 0, end = at;
for (let i = headSrc.indexOf('{', at); i < headSrc.length; i++) { if (headSrc[i] === '{') depth++; else if (headSrc[i] === '}' && --depth === 0) { end = i + 1; break; } }
ok(at > 0 && end > at, 'the head script has its Today early-read block');
function earlyUrls(role, team) {
  const id = { key: 'k', role, member: { id: 'm1', name: 'Casey', team } };
  const win = { fetch: url => { return Promise.resolve({ ok: true, json: async () => [] }); } };
  const st = { getItem: () => JSON.stringify(id) };
  vm.runInNewContext("var target='today'; " + headSrc.slice(at, end), { window: win, fetch: win.fetch, localStorage: st, JSON, Date, String, encodeURIComponent, Error });
  return Object.keys(win.__svEarlyToday.reads).map(u => u.replace('https://uzltbbrjidmjwwfakwve.supabase.co', 'https://fixture.example'));
}
async function moduleUrls(role, team) {
  fetched.length = 0;
  identity = { key: 'k', role, member: { id: 'm1', name: 'Casey', team } };
  api.tdyState.who = '';
  try { await api._tdyLoad({ id: 'm1', name: 'Casey', role, team, editor: role !== 'admin' && role !== 'smm' && (team === 'video' || team === 'graphics') }); } catch (e) {}
  return fetched.slice();
}
(async () => {
  for (const [label, role, team] of [['SMM and admin', 'smm', null], ['editor', 'editor', 'video']]) {
    const early = earlyUrls(role, team), asked = await moduleUrls(role, team);
    ok(!early.some(u => u.includes('/rest/v1/calendar_posts')), label + ': cards wait for the runtime flag and authorized transport');
    const missing = early.filter(u => !asked.includes(u));
    ok(early.length >= 3 && missing.length === 0, label + ': every early read is the exact URL the tab asks for (' + early.length + ' early, ' + missing.length + ' unmatched)');
  }
  if (failed) { console.log(`today-render: ${failed} failed`); process.exit(1); }
  console.log('today-render: all checks passed');
})();
