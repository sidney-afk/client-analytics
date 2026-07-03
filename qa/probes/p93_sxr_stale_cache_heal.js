// p93 — SAMPLES cache self-heal: a stale localStorage snapshot of an ARCHIVED
// card must not keep flashing on every refresh, even at localStorage quota.
//
// Regression probe for the "phantom card on refresh" bug: the samples cache
// stored EVERY row (thousands of archived QA leftovers, ~MBs), so under quota
// pressure _sxrCacheWrite's swallowed setItem failure left a stale pre-archive
// snapshot in place forever — an archived card appeared on each boot (cached
// paint) and vanished when the live fetch landed, refresh after refresh.
// The fix: cache only live rows, evict same-prefix keys + retry on quota, and
// DROP the key if the write still fails; reads expire after 7 days.
//
// Flow (live backend, sidneylaruel only, archives its seed):
//   create a card via the upsert webhook, archive it server-side (the browser
//   never learns → no local archive-ledger entry — same as the real incident,
//   where the overnight QA archived the card), seed a STALE cache snapshot of
//   it as 'In Progress', stuff localStorage near quota, then boot TWICE:
//   boot #1 may flash it once (pre-existing stale copy) but MUST heal the
//   cache; boot #2 must never render it at any point.
const lib = require('../sxr_courier_lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'sr_p93_' + TS;
const NAME = 'P93 phantom ' + TS;
const CACHE_KEY = 'syncview_sxr_cache_v1_sidneylaruel';

(async () => {
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };
  const browser = await lib.launch();
  try {
    // Seed + archive SERVER-SIDE (this browser must have no ledger entry).
    lib.up({ id: PID, name: NAME, video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
    await lib.poll(() => { const r = lib.supa(`id=eq.${PID}&select=id`); return r && r[0]; });
    lib.up({ id: PID, status: 'Archived' });
    await lib.poll(() => { const r = lib.supa(`id=eq.${PID}&select=status`); return r && r[0] && r[0].status === 'Archived'; });

    const smm = await lib.smm(browser);   // first boot also warms pins/prefs
    await smm.waitForTimeout(2000);
    await smm.evaluate((a) => {
      localStorage.setItem('syncview_calendar_pins', JSON.stringify(['Sidney Laruel']));
      localStorage.setItem('syncview_sxr_prefs_v1', JSON.stringify({ view: 'organizer', client: 'Sidney Laruel', zoom: 'm' }));
      // stale snapshot: the card as it looked BEFORE the server-side archive
      localStorage.setItem(a.key, JSON.stringify({
        posts: [{ id: a.pid, client: 'sidneylaruel', name: a.name, status: 'In Progress', video_status: 'In Progress', graphic_status: 'In Progress', order_index: '9000' }],
        at: Date.now() - 3600e3,
      }));
      // stuff the origin near quota so a bloated cache write would fail
      const chunk = 'x'.repeat(500 * 1024);
      try { for (let i = 0; i < 40; i++) localStorage.setItem('__p93_filler_' + i, chunk); } catch (e) {}
      try { localStorage.removeItem('__p93_filler_0'); localStorage.setItem('__p93_small', 'y'.repeat(100 * 1024)); } catch (e) {}
    }, { key: CACHE_KEY, pid: PID, name: NAME });

    // Boot-time DOM poller: records whether the phantom ever renders.
    await smm.addInitScript((name) => {
      window.__p93 = { sawPhantom: false, snaps: 0 };
      setInterval(() => {
        try {
          const names = Array.from(document.querySelectorAll('#sxrBody .cal-fld-name')).map(i => i.value);
          window.__p93.snaps++;
          if (names.some(n => n === name)) window.__p93.sawPhantom = true;
        } catch (e) {}
      }, 50);
    }, NAME);

    // ── boot #1: the stale copy may flash once, but the cache MUST heal ──
    await smm.goto('about:blank');
    await smm.goto(lib.ORIGIN + '/index.html?sxr=1#sample-reviews', { waitUntil: 'domcontentloaded' });
    await smm.waitForFunction(() => document.querySelector('#sxrBody .cal-card, #sxrBody .cal-filter-empty, #sxrBody .cal-card-add'), null, { timeout: 45000 }).catch(() => {});
    await smm.waitForTimeout(4000);
    const boot1 = await smm.evaluate((a) => {
      let cache = null; try { cache = JSON.parse(localStorage.getItem(a.key) || 'null'); } catch (e) {}
      const inCache = !!(cache && cache.posts && cache.posts.some(p => p.id === a.pid));
      const archivedInCache = !!(cache && cache.posts && cache.posts.some(p => p.id === a.pid && p.status === 'Archived'));
      const rendered = Array.from(document.querySelectorAll('#sxrBody .cal-fld-name')).some(i => i.value === a.name);
      return { healedOrDropped: !inCache || archivedInCache ? !inCache : false, inCache, cacheAt: cache && cache.at, rendered };
    }, { key: CACHE_KEY, pid: PID, name: NAME });
    ok(!boot1.rendered, 'boot #1: phantom is not on screen after the live load');
    ok(!boot1.inCache, 'boot #1: cache healed — the archived card is purged from the cached snapshot');

    // ── boot #2: the phantom must never render, not even for one frame ──
    await smm.goto('about:blank');
    await smm.goto(lib.ORIGIN + '/index.html?sxr=1#sample-reviews', { waitUntil: 'domcontentloaded' });
    await smm.waitForFunction(() => document.querySelector('#sxrBody .cal-card, #sxrBody .cal-filter-empty, #sxrBody .cal-card-add'), null, { timeout: 45000 }).catch(() => {});
    await smm.waitForTimeout(4000);
    const boot2 = await smm.evaluate(() => window.__p93 || { sawPhantom: 'no-probe' });
    ok(boot2.sawPhantom === false, `boot #2: phantom never rendered at any point (poller snaps=${boot2.snaps})`);
    ok(lib.appErrs(smm).length === 0, 'no app JS errors ' + JSON.stringify(lib.appErrs(smm)));
  } finally {
    try { await browser.close(); } catch (e) {}
    lib.archiveSafe(PID);
  }
  console.log(`\nP93 sxr stale-cache heal: pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('P93 FAILED', e); try { lib.archiveSafe(PID); } catch {} process.exit(1); });
