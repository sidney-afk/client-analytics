// debug_create_dup.js — instrument the create-via-UI flow: wrap fetch, log a
// stack for every sample-review-upsert POST, create ONE card, wait, dump.
const L = require('../sxr_courier_lib.js');

(async () => {
  const browser = await L.launch();
  const page = await L.smm(browser);
  page.on('console', m => { const t = m.text(); if (t.startsWith('[DBG]')) console.log(t); });

  // Wrap fetch BEFORE creating anything.
  await page.evaluate(() => {
    const orig = window.fetch;
    window.fetch = function (url, opts) {
      try {
        if (String(url).includes('sample-review-upsert')) {
          const body = opts && opts.body ? JSON.parse(opts.body) : {};
          const sid = body.sample && body.sample.id;
          const nm = body.sample && body.sample.name;
          const stack = new Error().stack.split('\n').slice(2, 7).join(' <- ').replace(/https?:\/\/[^)\s]+/g, m => m.split('/').pop());
          console.log('[DBG] UPSERT id=' + sid + ' name=' + JSON.stringify(nm) + ' at=' + new Date().toISOString().slice(11, 23) + ' stack=' + stack);
        }
      } catch (e) { console.log('[DBG] wrap err ' + e.message); }
      return orig.apply(this, arguments);
    };
  });

  // Make sure we're on the organizer (Sheet) view with a fresh load.
  await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); if (typeof loadSxrCards === 'function') loadSxrCards({ skipCache: true }); });
  await page.waitForFunction(() => !!document.querySelector('#sxrStrip .cal-card-add'), { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Create one card exactly like the scenario verb does.
  const r = await page.evaluate(() => {
    const add = document.querySelector('#sxrStrip .cal-card-add');
    if (!add) return 'no-add-btn';
    add.click();
    return 'ok';
  });
  console.log('add click:', r);
  await page.waitForTimeout(500);
  const r2 = await page.evaluate(() => {
    const blanks = [...document.querySelectorAll('#sxrStrip .cal-card[data-pid^="__sxrblank__"]')];
    const card = blanks[blanks.length - 1];
    if (!card) return 'no-blank-card';
    const inp = card.querySelector('.cal-fld-name');
    if (!inp) return 'no-name-field';
    inp.focus(); inp.value = 'DBG Dup Probe';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.blur();
    return 'ok';
  });
  console.log('type+blur:', r2);

  // Watch state for 150s (the dup mints ~90s in), print DOM snapshot every 10s.
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(10000);
    const dom = await page.evaluate(() => [...document.querySelectorAll('#sxrStrip .cal-card[data-pid]')].map(c => { const i = c.querySelector('.cal-fld-name'); return (i && i.value || '').includes('DBG Dup') ? c.getAttribute('data-pid') : null; }).filter(Boolean));
    console.log(`t+${(i + 1) * 10}s dom=${JSON.stringify(dom)}`);
    if (dom.length > 1) break;   // dup reproduced — stacks already logged
  }

  // Cleanup: archive whatever this probe minted.
  const ids = await page.evaluate(() => (window.sxrState && sxrState.posts || []).filter(p => (p.name || '').includes('DBG Dup')).map(p => p.id));
  await browser.close();
  for (const id of ids) { if (!String(id).startsWith('__sxrblank__')) { try { L.archiveSafe(id); console.log('archived', id); } catch {} } }
})().catch(e => { console.error('ERR', e); process.exit(1); });
