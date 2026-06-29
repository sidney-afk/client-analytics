// ot_temporal_flicker.js — TEMPORAL behavior: speed, flicker, and revert.
// Instruments #sxrStrip with a MutationObserver that timestamps EVERY change to
// our cards' order, then drags C→front and DELIBERATELY fires the flicker
// triggers (multiple background reloads + a realtime echo) inside the optimistic
// guard window. Proves whether the order ever reverts, and measures latencies.
// Also records a real video of the whole thing.
const L = require('../sxr_courier_lib.js');
const { launch, smm, up, supa, poll, appErrs, archiveSafe } = L;
const fs = require('fs');
const VID_DIR = '/tmp/qa/video'; fs.mkdirSync(VID_DIR, { recursive: true });

const t = Date.now();
const A = 'sr_tf_a_' + t, B = 'sr_tf_b_' + t, C = 'sr_tf_c_' + t;
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

(async () => {
  up({ id: A, name: 'TF-A ' + t, order_index: 1, video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  up({ id: B, name: 'TF-B ' + t, order_index: 2, video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  up({ id: C, name: 'TF-C ' + t, order_index: 3, video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  await poll(() => { const r = supa('id=in.(' + A + ',' + B + ',' + C + ')&select=id'); return (Array.isArray(r) && r.length >= 3) ? r : null; }, 12000, 800);

  const browser = await launch();
  let videoPath = null;
  try {
    const page = await smm(browser, 'sidneylaruel', { recordVideo: { dir: VID_DIR, size: { width: 1440, height: 900 } } });
    await page.waitForFunction((id) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${id}"]`), A, { timeout: 12000 }).catch(() => {});

    // install a MutationObserver that records our trio's order on every change
    await page.evaluate((ids) => {
      const set = new Set(ids);
      window.__log = [];
      const snap = () => Array.from(document.querySelectorAll('#sxrStrip .cal-card[draggable="true"]'))
        .map(c => c.dataset.pid).filter(p => set.has(p)).map(p => p.slice(-1)).join('');   // last char: a/b/c suffix differs → use index
      const trio = () => Array.from(document.querySelectorAll('#sxrStrip .cal-card[draggable="true"]'))
        .map(c => c.dataset.pid).filter(p => set.has(p)).map(p => ({ [ids[0]]: 'A', [ids[1]]: 'B', [ids[2]]: 'C' }[p])).join('');
      window.__trio = trio;
      let last = trio();
      window.__log.push({ t: performance.now(), order: last });
      const obs = new MutationObserver(() => { const cur = trio(); if (cur !== last && cur.length === 3) { last = cur; window.__log.push({ t: performance.now(), order: cur }); } });
      obs.observe(document.getElementById('sxrStrip'), { childList: true, subtree: true });
    }, [A, B, C]);

    const order0 = await page.evaluate(() => window.__trio());
    ok(order0 === 'ABC', 'starts ABC', order0);

    // --- DRAG C → front, and stamp the drop time ---
    const dropMark = await page.evaluate((ids) => {
      const [a, , c] = ids;
      const strip = document.getElementById('sxrStrip');
      const drag = strip.querySelector(`.cal-card[data-pid="${c}"]`);
      const over = strip.querySelector(`.cal-card[data-pid="${a}"]`);
      const dt = new DataTransfer();
      const fire = (el, type, extra) => el.dispatchEvent(new DragEvent(type, Object.assign({ bubbles: true, cancelable: true, dataTransfer: dt }, extra || {})));
      fire(drag, 'dragstart');
      const r = over.getBoundingClientRect();
      const tStart = performance.now();
      fire(over, 'dragover', { clientX: r.left + 4, clientY: r.top + r.height / 2 });
      const tDom = performance.now();
      fire(strip, 'drop'); fire(drag, 'dragend');
      return { tStart, tDom };
    }, [A, B, C]);

    // measure DB-persist latency
    const tPersistStart = Date.now();
    const persisted = await poll(() => { const r = supa('id=eq.' + C + '&select=order_index'); const oa = supa('id=eq.' + A + '&select=order_index'); return (r[0] && oa[0] && Number(r[0].order_index) < Number(oa[0].order_index)) ? r[0] : null; }, 14000, 400);
    const persistMs = Date.now() - tPersistStart;
    ok(!!persisted, 'reorder persisted to live DB', 'in ~' + persistMs + 'ms');

    // --- FLICKER TRIGGERS: hammer background reloads + a realtime echo inside the 12s guard ---
    for (const delay of [300, 1500, 3500, 6500, 9500]) {
      await page.waitForTimeout(delay - (await page.evaluate(() => 0)));   // simple spacing
      await page.evaluate(() => { if (typeof loadSxrCards === 'function') loadSxrCards({ background: true }); });
      if (delay === 1500) await page.evaluate((slug) => { if (typeof _sxrV2OnRealtimeChange === 'function') _sxrV2OnRealtimeChange(slug); }, 'sidneylaruel');
    }
    await page.waitForTimeout(1500);

    // --- analyse the timeline ---
    const log = await page.evaluate(() => window.__log);
    const transitions = log.map(e => e.order);
    console.log('  order timeline:', JSON.stringify(transitions));
    const domReorderMs = (dropMark.tDom - dropMark.tStart).toFixed(1);
    console.log('  perceived DOM reorder latency: ' + domReorderMs + 'ms (synchronous on drag)');
    // first time C leads
    const firstCLead = log.find(e => e.order[0] === 'C');
    ok(!!firstCLead, 'order moved to C-first');
    // after C leads, it must NEVER go back to A-first (that would be a revert/flicker)
    const afterCLead = firstCLead ? log.slice(log.indexOf(firstCLead)) : [];
    const reverted = afterCLead.some(e => e.order[0] !== 'C');
    ok(!reverted, 'NO revert/flicker: C stays first through 5 background reloads + a realtime echo', 'distinct states after drop: ' + JSON.stringify([...new Set(afterCLead.map(e => e.order))]));
    // count flips (a flicker shows up as many flips between states)
    let flips = 0; for (let i = 1; i < transitions.length; i++) if (transitions[i] !== transitions[i - 1]) flips++;
    ok(flips <= 1, 'order changed exactly once (no oscillation)', 'flips=' + flips);

    ok((await appErrs(page)).length === 0, 'zero app JS errors', (await appErrs(page)).slice(0, 3).join(' | '));

    try { videoPath = await page.video().path(); } catch (e) {}
    await page.context().close();   // finalize the video
  } finally {
    await browser.close();
    [A, B, C].forEach(id => archiveSafe(id));
    if (videoPath) { const dst = VID_DIR + '/reorder_flicker_test.webm'; try { fs.renameSync(videoPath, dst); console.log('VIDEO:', dst); } catch (e) { console.log('VIDEO:', videoPath); } }
  }
  console.log('\nRESULT ot_temporal_flicker: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
