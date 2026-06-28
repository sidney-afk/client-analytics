// ot03_client_request.js — CLIENT request-change against the LIVE backend.
// Seed a client-ready sample, type a change request into the real composer, click
// "Request change", and confirm the LIVE row flips to Tweaks Needed with a client
// comment persisted on the component thread.
const L = require('../sxr_courier_lib.js');
const { launch, client, up, supa, poll, appErrs, archiveSafe } = L;

const ID = 'sr_otc3_' + Date.now();
const NAME = 'OT client request ' + Date.now();
const MSG = 'Please tighten the first 2 seconds ' + Date.now();
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

(async () => {
  up({ id: ID, name: NAME, order_index: 1, asset_url: 'https://frame.io/x/otc3', thumbnail_url: '',
       video_status: 'Client Approval', graphic_status: 'Approved', status: 'Client Approval' });
  await poll(() => { const r = supa('id=eq.' + ID + '&select=id'); return r[0] || null; }, 12000, 800);

  const browser = await launch();
  try {
    const page = await client(browser);
    const expanded = await page.evaluate((nm) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      if (!card) return false; (card.querySelector('.kcard-strip') || card).click(); return true;
    }, NAME);
    ok(expanded, 'seeded client card expanded');
    await page.waitForTimeout(400);

    // type into the video panel composer, then click Request change
    const typed = await page.evaluate((args) => {
      const [nm, msg] = args;
      const card = [...document.querySelectorAll('.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      const p = card && card.querySelector('.cal-review-panel[data-comp="video"]');
      const ta = p && p.querySelector('.cal-review-textarea');
      if (!ta) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, msg); ta.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, [NAME, MSG]);
    ok(typed, 'typed change request into composer');
    await page.waitForTimeout(250);

    const clicked = await page.evaluate((nm) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      const b = card && card.querySelector('.cal-review-panel[data-comp="video"] .cal-review-tweak-btn');
      if (!b || b.disabled) return false; b.click(); return true;
    }, NAME);
    ok(clicked, 'clicked "Request change" (enabled with draft)');

    const row = await poll(() => {
      const r = supa('id=eq.' + ID + '&select=video_status,status,video_tweaks');
      return (r[0] && r[0].video_status === 'Tweaks Needed') ? r[0] : null;
    }, 14000, 1000);
    ok(!!row, 'request-change → video_status Tweaks Needed in LIVE DB', row ? ('status=' + row.status) : '');
    if (row) {
      let comment = null;
      try { const arr = JSON.parse(row.video_tweaks || '[]'); comment = arr[arr.length - 1]; } catch {}
      ok(comment && comment.role === 'client', 'client comment persisted on video thread', comment ? ('role=' + comment.role) : 'none');
      ok(comment && String(comment.body || '').includes('tighten the first 2 seconds'), 'comment body persisted', comment ? JSON.stringify(comment.body) : '');
      ok(comment && comment.is_tweak === true, 'comment flagged is_tweak');
    }

    const errs = appErrs(page);
    ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(ID), 'cleanup: seed archived', 'id=' + ID);
    const stray = supa('id=eq.' + ID + '&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active row');
  }

  console.log('\nRESULT ot03_client_request: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
