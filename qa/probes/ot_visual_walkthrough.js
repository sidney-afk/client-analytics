// ot_visual_walkthrough.js — VISUAL proof: drive the real browser through the new
// reorder/select flows + each surface and capture screenshots a human can eyeball.
// Seeds a small, good-looking set on the test client, shoots PNGs, then archives.
const L = require('../sxr_courier_lib.js');
const { launch, smm, client, kasper, up, supa, poll, archiveSafe } = L;
const OUT = process.env.SHOT_DIR || '/tmp/qa/shots';
require('fs').mkdirSync(OUT, { recursive: true });

const ts = Date.now();
const ids = ['sr_vw1_' + ts, 'sr_vw2_' + ts, 'sr_vw3_' + ts, 'sr_vw4_' + ts];
const seeds = [
  { id: ids[0], name: 'Hook test — gym morning routine', order_index: 1, asset_url: 'https://frame.io/x/1', thumbnail_url: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg', video_status: 'For SMM Approval', graphic_status: 'Approved', status: 'For SMM Approval' },
  { id: ids[1], name: 'Founder story cutdown', order_index: 2, asset_url: 'https://frame.io/x/2', thumbnail_url: 'https://i.ytimg.com/vi/ScMzIvxBSi4/hqdefault.jpg', video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', status: 'Kasper Approval' },
  { id: ids[2], name: 'Product demo — 30s vertical', order_index: 3, asset_url: 'https://frame.io/x/3', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', video_status: 'Client Approval', graphic_status: 'Approved', status: 'Client Approval' },
  { id: ids[3], name: 'Testimonial reel v2', order_index: 4, asset_url: 'https://frame.io/x/4', thumbnail_url: 'https://i.ytimg.com/vi/9bZkp7q19f0/hqdefault.jpg', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' }
];
const shot = async (page, name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot:', name); };

(async () => {
  seeds.forEach(s => up(s));
  await poll(() => { const r = supa('id=in.(' + ids.join(',') + ')&select=id'); return (Array.isArray(r) && r.length >= 4) ? r : null; }, 12000, 800);

  const browser = await launch();
  try {
    // ---- SMM Sheet ----
    const sm = await smm(browser);
    await sm.waitForFunction((id) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${id}"]`), ids[0], { timeout: 12000 }).catch(() => {});
    await sm.waitForTimeout(1500);   // let thumbnails load
    await shot(sm, '01-smm-sheet');

    // select mode + 2 selected
    await sm.click('#sxrView .cal-select-btn'); await sm.waitForTimeout(400);
    await sm.click(`#sxrStrip .cal-card[data-pid="${ids[0]}"] .cal-card-select-overlay`);
    await sm.click(`#sxrStrip .cal-card[data-pid="${ids[3]}"] .cal-card-select-overlay`);
    await sm.waitForTimeout(400);
    await shot(sm, '02-smm-select-mode');
    // leave select mode (don't archive — keep the set for later shots)
    await sm.click('#sxrView .cal-select-btn'); await sm.waitForTimeout(400);

    // reorder: drag the last card (Testimonial) to the front
    await sm.evaluate((arr) => {
      const [first, last] = arr;
      const strip = document.getElementById('sxrStrip');
      const drag = strip.querySelector(`.cal-card[data-pid="${last}"]`);
      const over = strip.querySelector(`.cal-card[data-pid="${first}"]`);
      const dt = new DataTransfer();
      const fire = (el, type, extra) => el.dispatchEvent(new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt }, extra || {})));
      fire(drag, 'dragstart');
      const r = over.getBoundingClientRect();
      fire(over, 'dragover', { clientX: r.left + 4, clientY: r.top + r.height / 2 });
      fire(strip, 'drop'); fire(drag, 'dragend');
    }, [ids[0], ids[3]]);
    await sm.waitForTimeout(1200);
    await shot(sm, '03-smm-reordered');

    // Review queue (SMM)
    await sm.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="smmreview"]'); if (b) b.click(); });
    await sm.waitForTimeout(800);
    await shot(sm, '04-smm-review');
    // expand the first review card to show the panels
    await sm.evaluate(() => { const s = document.querySelector('.cal-review-card .kcard-strip'); if (s) s.click(); });
    await sm.waitForTimeout(700);
    await shot(sm, '05-smm-review-expanded');
    await sm.context().close();

    // ---- Client portal ----
    const cl = await client(browser);
    await cl.waitForTimeout(1800);
    await shot(cl, '06-client-review');
    await cl.context().close();

    // ---- Kasper samples sub-tab ----
    const kp = await kasper(browser);
    await kp.waitForTimeout(1500);
    await shot(kp, '07-kasper-samples');

  } finally {
    await browser.close();
    ids.forEach(id => archiveSafe(id));
    const stray = supa('id=in.(' + ids.join(',') + ')&status=neq.Archived&select=id');
    console.log('cleanup stray active:', Array.isArray(stray) ? stray.length : '?');
  }
  console.log('\nScreenshots in', OUT);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
