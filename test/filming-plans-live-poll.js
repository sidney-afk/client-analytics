'use strict';
/*
 * FILMING PLANS GO LIVE WITHOUT EVER EATING AN EDIT.
 *
 * Finding 3 of docs/ops/2026-10-06-realtime-test-findings.md: the Filming
 * Plans page loaded once and again only on Refresh, so two people editing
 * plans never saw each other. `filming_plans` is closed to the browser key
 * (F88), so a realtime listener would receive nothing; the page already reads
 * through the staff-keyed filming-plans function, so it now re-reads that
 * every FP_LIVE_POLL_MS while the page is open and the tab visible.
 *
 * The hard rule is the second half: a plan someone is editing is never
 * overwritten. While an edit or the add form is open, a changed list is held
 * behind an "Updated by someone else" notice that is inserted WITHOUT a
 * re-render (a re-render would throw away the typed input), and applied on
 * Reload or when the edit closes.
 *
 * Drives the real functions from the built page in a VM with a mocked
 * network and DOM. Offline; contacts nothing.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('./helpers/extract-function.js');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('  ok  ' + msg); };

const pollMs = Number((/const FP_LIVE_POLL_MS = (\d+);/.exec(INDEX) || [])[1]);
ok(pollMs >= 3000 && pollMs <= 5000, 'the page polls about every 5 s while open, so an edit shows within about 5 s (' + pollMs + 'ms)');

const NAMES = [
  '_fpNormalizePlan', '_fpSetData', '_fpRows', '_fpLiveFingerprint', '_fpLiveDirty',
  '_fpLiveNoticeHtml', '_fpLiveSyncNotice', '_fpLiveAdopt', '_fpLiveRepaint', '_fpLiveReload',
  '_fpLiveApplyHeld', '_fpLiveTick', '_fpLiveStart', '_fpLiveStop', '_fpEdit', '_fpToggleAdd',
  '_fpUpsertLocal', '_fpDocId'
];

function harness() {
  const log = { renders: 0, fetches: 0, prompts: 0, inserted: [], removed: 0, saved: 0, intervals: [] };
  let noticeEl = null;
  const view = {
    querySelector(sel) {
      if (sel === '[data-fp-live-notice]') return noticeEl;
      if (sel === '.fp-toolbar') return {
        insertAdjacentHTML(where, html) {
          log.inserted.push(html);
          noticeEl = { remove() { log.removed++; noticeEl = null; } };
        }
      };
      return null;
    }
  };
  const env = { hidden: false, identity: { key: 'k', member: { id: 'm' }, role: 'admin' }, rows: [], view };
  const ctx = {
    console, JSON, Map, Object, String, Number, Promise, Error, Array,
    document: {
      get hidden() { return env.hidden; },
      querySelector: (sel) => (sel === '.fp-view' ? env.view : null),
      activeElement: null,
      getElementById: () => null,
    },
    localStorage: { removeItem() {} },
    setInterval(fn, ms) { log.intervals.push(ms); return log.intervals.length; },
    clearInterval() { log.cleared = (log.cleared || 0) + 1; },
    currentNav: 'filming-plans',
    KASPER_FILMING_CACHE_KEY: 'kfc',
    _fpSlug: (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, ''),
    _linearInvalidatePlanMap() {},
    _fpSavedWrite() { log.saved++; },
    _fpRenderPage() { log.renders++; },
    _syncviewStaffCan: () => true,
    _syncviewOfferStaffSignIn() { log.prompts++; },
    _syncviewOpenStaffIdentity() { log.prompts++; return null; },
    _syncviewStaffIdentityForHeaders: () => env.identity,
    async _fpLoadFromSupabase(retried, quiet) {
      log.fetches++;
      log.lastQuiet = quiet;
      if (env.fail) throw new Error('HTTP 500');
      return env.rows.map(r => Object.assign({}, r));
    },
  };
  vm.createContext(ctx);
  vm.runInContext(`
    let filmingPlansData = null; let filmingPlansLoadPromise = null;
    let _fpEditSlug = ''; let _fpAddOpen = false; let _fpSavingSlug = '';
    let _fpLiveTimer = null; let _fpLiveBusy = false; let _fpLivePending = null;
    const FP_LIVE_POLL_MS = ${pollMs};
  `, ctx);
  for (const name of NAMES) {
    let src = extractFunction(INDEX, name);
    if (!/^async /.test(src) && new RegExp('async function ' + name + '\\(').test(INDEX)) src = 'async ' + src;
    vm.runInContext(src, ctx);
  }
  const get = (expr) => vm.runInContext(expr, ctx);
  return { ctx, env, log, get, tick: () => get('_fpLiveTick')() };
}

const plan = (slug, url, notes, at) => ({ client_slug: slug, client_name: slug.toUpperCase(), doc_url: url, notes: notes || '', updated_at: at || 't0' });

(async () => {
  // 1. Nothing open: a changed list is applied at once and repainted.
  {
    const h = harness();
    h.get('_fpSetData')([plan('alpha', 'https://docs.google.com/document/d/A/edit')], 'edge-function');
    h.env.rows = [plan('alpha', 'https://docs.google.com/document/d/A2/edit', '', 't1')];
    await h.tick();
    ok(h.log.fetches === 1 && h.log.lastQuiet === true, 'a tick re-reads through the staff function, quietly');
    ok(h.get('_fpRows()')[0].docUrl.endsWith('/A2/edit') && h.log.renders === 1,
      'another person\'s change appears with no Refresh');
    await h.tick();
    ok(h.log.renders === 1, 'an unchanged list does not repaint');
  }

  // 2. An edit is open: never overwritten, held behind the notice, no re-render.
  {
    const h = harness();
    h.get('_fpSetData')([plan('alpha', 'https://x/A'), plan('beta', 'https://x/B')], 'edge-function');
    vm.runInContext("_fpEditSlug = 'alpha';", h.ctx);
    h.env.rows = [plan('alpha', 'https://x/A-theirs', '', 't2'), plan('beta', 'https://x/B')];
    await h.tick();
    ok(h.get('_fpRows()')[0].docUrl === 'https://x/A', 'the plan being edited is NOT overwritten');
    ok(h.log.renders === 0, 'and the page is not re-rendered (typed input lives only in the DOM)');
    ok(h.log.inserted.length === 1 && /Updated by someone else/.test(h.log.inserted[0]) && /_fpLiveReload\(\)/.test(h.log.inserted[0]),
      'an "Updated by someone else" notice with Reload is inserted beside the toolbar');
    await h.tick();
    ok(h.log.inserted.length === 1, 'the notice is not duplicated on the next tick');
    // Reload applies and closes the edit.
    h.get('_fpLiveReload')();
    ok(h.get('_fpRows()')[0].docUrl === 'https://x/A-theirs' && h.get('_fpEditSlug') === '' && h.get('_fpLivePending') === null,
      'Reload adopts the newer list and closes the edit');
  }

  // 3. Closing the edit (Cancel / Close) applies a held update.
  {
    const h = harness();
    h.get('_fpSetData')([plan('alpha', 'https://x/A')], 'edge-function');
    vm.runInContext("_fpEditSlug = 'alpha';", h.ctx);
    h.env.rows = [plan('alpha', 'https://x/A3', '', 't3')];
    await h.tick();
    ok(h.get('_fpRows()')[0].docUrl === 'https://x/A', 'held while editing');
    h.get('_fpEdit')('alpha');   // toggles the edit closed
    ok(h.get('_fpRows()')[0].docUrl === 'https://x/A3' && h.get('_fpLivePending') === null,
      'closing the edit applies the held update');
  }

  // 4. The add form and a save in flight count as editing too.
  {
    const h = harness();
    h.get('_fpSetData')([plan('alpha', 'https://x/A')], 'edge-function');
    vm.runInContext('_fpAddOpen = true;', h.ctx);
    h.env.rows = [plan('alpha', 'https://x/A4', '', 't4')];
    await h.tick();
    ok(h.get('_fpRows()')[0].docUrl === 'https://x/A' && h.log.renders === 0, 'an open add form is never re-rendered away');
    vm.runInContext("_fpAddOpen = false; _fpSavingSlug = 'alpha';", h.ctx);
    const before = h.log.fetches;
    await h.tick();
    ok(h.log.fetches === before, 'no read while a save is running');
    // Our own save makes the held list stale; it is dropped, not applied later.
    vm.runInContext("_fpSavingSlug = '';", h.ctx);
    h.get('_fpUpsertLocal')(h.get('_fpNormalizePlan')(plan('alpha', 'https://x/OURS', '', 't9')));
    ok(h.get('_fpLivePending') === null && h.get('_fpRows()')[0].docUrl === 'https://x/OURS',
      'a successful own save drops the held list, so it can never overwrite the save');
  }

  // 5. Hidden tab, no sign-in, another page, errors: no read, no prompt.
  {
    const h = harness();
    h.get('_fpSetData')([plan('alpha', 'https://x/A')], 'edge-function');
    h.env.hidden = true;
    await h.tick();
    ok(h.log.fetches === 0, 'a hidden tab does not poll');
    h.env.hidden = false;
    h.env.identity = null;
    await h.tick();
    ok(h.log.fetches === 0 && h.log.prompts === 0, 'signed out: no read and never a sign-in prompt from the poll');
    h.env.identity = { key: 'k', member: { id: 'm' }, role: 'admin' };
    h.env.fail = true;
    await h.tick();
    ok(h.log.renders === 0 && h.get('_fpRows()').length === 1, 'a failed read changes nothing on screen');
    h.env.fail = false;
    h.get('_fpLiveStart')();
    h.get('_fpLiveStart')();
    ok(h.log.intervals.length === 1 && h.log.intervals[0] === pollMs, 'the poll starts once, at ' + pollMs + 'ms');
    vm.runInContext("currentNav = 'calendar';", h.ctx);
    await h.tick();
    ok(h.log.cleared === 1 && h.log.fetches === 1, 'leaving the page stops the poll without reading');
  }

  // 6. Source wiring.
  const load = extractFunction(INDEX, '_fpLoadFromSupabase');
  ok(load.indexOf('if (quiet) throw') >= 0 && load.indexOf('if (quiet) throw') < load.indexOf('_syncviewStaffIdentityClear()'),
    'a quiet (poll) read never clears the sign-in or opens the dialog on a 401');
  ok(/function mountFilmingPlansView\(\) \{\s*_fpLiveStart\(\);/.test(INDEX), 'mounting the page starts the poll');
  ok(/\$\{_fpLiveNoticeHtml\(\)\}/.test(extractFunction(INDEX, 'renderFilmingPlansView')), 'a full render keeps the notice');
  ok(/window\._fpLiveReload = _fpLiveReload;/.test(INDEX), 'Reload is reachable from the notice button');

  console.log('filming-plans-live-poll: ' + n + ' checks passed (offline, mocked network and DOM)');
})().catch((e) => { console.error(e); process.exit(1); });
