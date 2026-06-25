// sxr_m1_render.js — M1 smoke: the Samples (Review) tab loads + renders a live
// sample in a REAL browser against the LIVE backend (via the courier harness).
// Scoped to sidneylaruel; archives what it creates.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + (!c && x ? '  -> ' + x : '')); };

(async () => {
  const id = 'sr_m1_' + Date.now();
  const seed = Q.up({ id, name: 'M1 render', asset_url: 'https://example.com/v.mp4',
    thumbnail_url: 'https://via.placeholder.com/320x180.png', video_status: 'Kasper Approval', graphic_status: 'In Progress', order_index: '1', created_at: new Date().toISOString() });
  ok(seed && seed.ok === true, 'seed live sample', JSON.stringify(seed).slice(0, 120));

  const browser = await Q.launch();
  try {
    const page = await Q.smm(browser, 'sidneylaruel');
    let info = {};
    for (let i = 0; i < 25; i++) {
      info = await page.evaluate((pid) => {
        const st = (window.sxrV2Status && window.sxrV2Status()) || {};
        const cards = Array.from(document.querySelectorAll('[data-sxr-id], .sxr-card'));
        const mine = cards.find(c => c.getAttribute('data-sxr-id') === pid || c.textContent.includes('M1 render'));
        return { ready: st.ready, flag: st.flag, n: cards.length, text: mine ? mine.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) : null };
      }, id);
      if (info.text) break;
      await page.waitForTimeout(900);
    }
    console.log('  render:', JSON.stringify(info));
    ok(info.flag === true && info.ready === true, 'flag + ready true under ?sxr=1', JSON.stringify(info));
    ok(!!info.text, 'seeded sample renders in real browser from live backend', JSON.stringify(info));
    ok(/Kasper Approval/.test(info.text || '') && /In Progress/.test(info.text || ''), 'both component statuses render', info.text);
    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 4)));
  } finally {
    Q.up({ id, status: 'Archived' });
    await browser.close();
  }
  console.log(`PROBE sxr_m1_render: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
