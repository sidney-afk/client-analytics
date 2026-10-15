'use strict';
/* messages-inbox-timing.js -- how long the Messages page takes, click to list.
 *
 * A MEASURING script, not a gate: it prints numbers and fails only on a page
 * error or a list that never shows. Fully mocked (lost-work-lib.js): the inbox
 * answer is made up and takes INBOX_MS to arrive (default 1900, the median of
 * the live production-comments function), so what it measures is everything
 * the PAGE adds or hides around that wait. Nothing reaches a live backend.
 *
 *   node docs/syncview-design/tests/messages-inbox-timing.js
 *   INBOX_MS=1000 RUNS=5 node ...      (other server time / more runs, median shown)
 *
 * Rows, all "click on Messages -> list visible" in ms:
 *   cold, click at once     fresh browser, click the moment the button shows
 *   cold, click after 1.5 s / 6 s   fresh browser, someone who looked around first
 *   reload, same tab        the tab was used before (short-lived cache exists)
 *   second visit            leave Messages and come back inside the same page
 * Also printed: the first grey placeholder ("skeleton") paint, when the inbox
 * call started relative to the click (negative = before it) and how long it took.
 */
const path = require('path');
const { createEnv, sleep } = require('./lost-work-lib');

const INBOX_MS = Number(process.env.INBOX_MS || 1900);
const RUNS = Number(process.env.RUNS || 3);
const CONVS = Number(process.env.CONVS || 60);
const failures = [];
const median = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function makeConversations() {
  const out = [];
  for (let i = 0; i < CONVS; i++) {
    const messages = [0, 1, 2].map(k => ({
      id: `m${i}_${k}`, parent_id: k ? `m${i}_0` : null, root_id: `m${i}_0`, author: k % 2 ? 'Fixture SMM' : 'Client', author_member_id: '',
      role: k % 2 ? 'smm' : 'client', audience: 'client', is_tweak: false, component: 'caption',
      body: `Fixture message ${k} on post ${i}, long enough to need the preview line to cut it short.`,
      created_at: new Date(Date.UTC(2026, 9, 14, 12, 0, 0) - i * 3600e3 + k * 60e3).toISOString(),
    }));
    const last = messages[2];
    out.push({ post_id: `p_t${i}`, client_slug: 'fixtureclient', client_name: 'fixtureclient', title: `Fixture post ${i}`, thumbnail_url: '', asset_url: '', status: 'In Progress', messages, last_at: last.created_at, last_author: last.author, last_author_member_id: '', last_role: last.role, last_body: last.body, unread: i % 3 === 0 ? 1 : 0 });
  }
  return out;
}

async function openHome(S, page) {
  await page.addInitScript(() => {
    window.__inboxCalls = [];
    const f = window.fetch;
    window.fetch = function (url, init) {
      const isInbox = /production-comments/.test(String(url)) && init && /"action":"inbox"/.test(String(init.body || ''));
      if (!isInbox) return f.apply(this, arguments);
      const rec = { start: performance.now(), end: 0 };
      window.__inboxCalls.push(rec);
      return f.apply(this, arguments).then(r => { rec.end = performance.now(); return r; });
    };
  });
  await page.goto(S.origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await ready(page);
}
async function ready(page) {
  await page.waitForFunction(() => typeof _syncviewStaffCan === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
  await page.evaluate(() => { _syncviewStaffIdentityVerified = true; try { _syncviewStaffRefreshChrome(); } catch (e) {} });
  await page.waitForFunction(() => { const b = document.getElementById('navMessages'); return b && !b.hidden && b.offsetParent !== null; }, null, { timeout: 30000 });
}

/* Click the real button (a real mouse move, press and release) and watch the page. */
async function clickAndTime(page) {
  await page.evaluate(() => {
    window.__tm = { click: 0, skeleton: 0, list: 0 };
    document.addEventListener('click', e => { if (e.target.closest && e.target.closest('#navMessages')) window.__tm.click = performance.now(); }, true);
    const tick = () => {
      const now = performance.now();
      if (window.__tm.click) {
        if (!window.__tm.skeleton && document.querySelector('#msgPage [role="status"], #msgPage .is-skeleton, #msgPage .sv-skeleton')) window.__tm.skeleton = now;
        if (!window.__tm.list && document.querySelector('#msgPage .msg-conv[data-msg-conv]')) { window.__tm.list = now; return; }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.click('#navMessages');
  await page.waitForFunction(() => window.__tm && window.__tm.list, null, { timeout: 30000 });
  return page.evaluate(() => {
    const t = window.__tm; const c = (window.__inboxCalls || [])[0] || null;
    return {
      list: Math.round(t.list - t.click),
      skeleton: t.skeleton ? Math.round(t.skeleton - t.click) : null,
      callStart: c ? Math.round(c.start - t.click) : null,
      callTook: c && c.end ? Math.round(c.end - c.start) : null,
      calls: (window.__inboxCalls || []).length,
    };
  });
}

(async () => {
  const S = await createEnv();
  const conversations = makeConversations();
  let served = 0;
  await S.ctx.route('**/rest/v1/team_members**', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify([{ id: 'm1', name: 'Browser Staff', role: 'admin', team: null, active: true }]) }));
  await S.ctx.route('**/functions/v1/production-comments', async route => {
    let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
    if (route.request().method() === 'OPTIONS' || (body.action !== 'inbox' && body.action !== 'inbox_mark')) return route.fallback();
    if (body.action === 'inbox') { served++; await sleep(INBOX_MS); }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body.action === 'inbox' ? { ok: true, scope: 'all', conversations } : { ok: true, post_id: body.post_id, last_read_at: null }) });
  });
  const rows = { 'cold, click at once': [], 'cold, click after 1.5 s': [], 'cold, click after 6 s': [], 'reload, same tab': [], 'second visit': [] };
  const extra = { 'cold, click at once': [], 'cold, click after 1.5 s': [], 'cold, click after 6 s': [], 'reload, same tab': [], 'second visit': [] };
  const loads = [];
  const note = (k, r) => { rows[k].push(r.list); extra[k].push(r); };
  try {
    for (let run = 0; run < RUNS; run++) {
      // A new page has empty tab storage, so every run starts cold.
      for (const [label, wait] of [['cold, click at once', 0], ['cold, click after 1.5 s', 1500], ['cold, click after 6 s', 6000]]) {
        const page = await S.newPage();
        await openHome(S, page);
        if (label === 'cold, click at once') {
          loads.push(await page.evaluate(() => {
            const n = performance.getEntriesByType('navigation')[0];
            return { dcl: Math.round(n.domContentLoadedEventEnd), loaded: Math.round(n.loadEventEnd), buttonReady: Math.round(performance.now()), scripts: performance.getEntriesByType('resource').filter(r => /\/js\/sv-/.test(r.name)).length };
          }));
        }
        if (wait) await sleep(wait);
        note(label, await clickAndTime(page));
        if (label === 'cold, click at once') {
          // second visit: leave and come back without reloading
          await page.evaluate(() => navTo('home'));
          await sleep(300);
          await page.evaluate(() => { window.__inboxCalls = []; });
          note('second visit', await clickAndTime(page));
          // reload, same tab: the tab keeps its short-lived storage
          // (the page moved to /messages; the static test server only knows index.html)
          await page.goto(S.origin + '/index.html', { waitUntil: 'domcontentloaded' });
          await ready(page);
          note('reload, same tab', await clickAndTime(page));
        }
        if (page.errors.length) failures.push('page errors: ' + page.errors.join(' | '));
        await page.close();
      }
    }
  } catch (e) {
    failures.push(String(e && e.stack || e));
  }
  console.log(`messages-inbox-timing: inbox answer ${INBOX_MS} ms, ${CONVS} conversations, median of ${RUNS} run(s), ms from click to list visible`);
  for (const k of Object.keys(rows)) {
    if (!rows[k].length) continue;
    const e = extra[k];
    const sk = e.map(x => x.skeleton).filter(x => x != null);
    console.log(`  ${k.padEnd(24)} list ${String(median(rows[k])).padStart(5)}   first grey placeholder ${sk.length ? String(median(sk)).padStart(4) : '  --'}   inbox call started ${String(median(e.map(x => x.callStart == null ? 0 : x.callStart))).padStart(6)} (took ${median(e.map(x => x.callTook == null ? 0 : x.callTook))})   calls ${median(e.map(x => x.calls))}`);
  }
  if (loads.length) console.log(`  page load (before any click): DOMContentLoaded ${median(loads.map(x => x.dcl))} ms, Messages button usable ${median(loads.map(x => x.buttonReady))} ms after navigation start, ${loads[0].scripts} script files`);
  await S.close();
  if (failures.length) { console.log('FAIL ' + failures.join('\n')); process.exit(1); }
})();
