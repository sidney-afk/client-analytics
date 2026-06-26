// sxr_reorder.js — drag-reorder persists order_index (C); and a FAILED reorder
// rolls the order back + repaints (Tier 2 rollback), not lingering wrong.
// Drives the real commit path: reorder the DOM then dispatch 'dragend' →
// _sxrCommitDragOrder. Scoped to sidneylaruel; archives what it creates.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + ((!c && x) ? '  -> ' + x : '')); };

const TS = Date.now();
const A = 'sr_ro_a_' + TS, B = 'sr_ro_b_' + TS, C = 'sr_ro_c_' + TS;
const REORDER_RE = /\/webhook\/sample-review-reorder\b/;
const orderOf = (id) => { const r = Q.supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=order_index'); const x = Array.isArray(r) && r[0]; return x ? Number(x.order_index) : null; };
// Move the last editable card to the front and commit via dragend.
const moveLastToFront = (page) => page.evaluate(() => {
  const grid = document.querySelector('#sxrBody .sxr-grid');
  const cards = Array.from(grid.querySelectorAll('.sxr-card.is-editable'));
  if (cards.length < 2) return null;
  const last = cards[cards.length - 1];
  const id = last.getAttribute('data-sxr-id');
  grid.insertBefore(last, cards[0]);
  last.dispatchEvent(new Event('dragend', { bubbles: true }));
  return id;
});

(async () => {
  Q.up({ id: A, name: 'RO A ' + TS, asset_url: 'https://example.com/a.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png', video_status: 'In Progress', graphic_status: 'In Progress', order_index: '1', created_at: new Date().toISOString() });
  Q.up({ id: B, name: 'RO B ' + TS, asset_url: 'https://example.com/b.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png', video_status: 'In Progress', graphic_status: 'In Progress', order_index: '2', created_at: new Date().toISOString() });
  Q.up({ id: C, name: 'RO C ' + TS, asset_url: 'https://example.com/c.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png', video_status: 'In Progress', graphic_status: 'In Progress', order_index: '3', created_at: new Date().toISOString() });

  const browser = await Q.launch();
  let page;
  try {
    page = await Q.smm(browser, 'sidneylaruel');
    await page.waitForFunction((ids) => ids.every(id => document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"]`)), [A, B, C], { timeout: 20000 }).catch(() => {});

    // ── 1) SUCCESS: move the last visible card to the front → order_index persists. ──
    const moved = await moveLastToFront(page);
    ok(!!moved, 'reorder commit fired (moved a card to the front)', String(moved));
    // After the move, the moved card should become order_index 1.
    const persisted = await Q.poll(() => orderOf(moved) === 1 ? true : false, 20000);
    ok(persisted, 'the reordered card persists as order_index 1', 'moved=' + moved + ' order=' + orderOf(moved));

    // ── 2) FAILURE: a failed reorder rolls the order back + repaints. ──
    await page.route(REORDER_RE, r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'forced reorder failure' }) }));
    // Capture current DOM order, move last→front, then confirm it snaps back.
    const beforeOrder = await page.evaluate(() => Array.from(document.querySelectorAll('#sxrBody .sxr-card.is-editable')).map(c => c.getAttribute('data-sxr-id')));
    const moved2 = await moveLastToFront(page);
    const snappedBack = await page.evaluate(async (before) => {
      for (let i = 0; i < 24; i++) {
        const now = Array.from(document.querySelectorAll('#sxrBody .sxr-card.is-editable')).map(c => c.getAttribute('data-sxr-id'));
        if (now.join(',') === before.join(',')) return true;
        await new Promise(r => setTimeout(r, 250));
      }
      return false;
    }, beforeOrder);
    ok(snappedBack, 'a FAILED reorder rolls the on-screen order back to its pre-drag position', 'moved=' + moved2);
    await page.unroute(REORDER_RE);

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 5)));
  } catch (e) {
    ok(false, 'probe ran without crashing', String(e && e.message));
  } finally {
    if (browser) await browser.close();
    Q.archiveSafe(A); Q.archiveSafe(B); Q.archiveSafe(C);
  }
  console.log(`PROBE sxr_reorder: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
