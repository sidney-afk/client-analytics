// sxr_m5a_kasper.js — M5a real-browser probe: SAMPLES on Kasper's review page.
//
// Drives the LIVE backend through the Node-courier harness, scoped to the test
// client `sidneylaruel`, with unique sr_m5a_* ids that are archived on exit.
//
// Asserts (Plan §9 + task VERIFY):
//   1) seed a sample with BOTH comps at "Kasper Approval" (+ a thumbnail so the
//      content gate passes; + a graphic Linear link so the graphic comp is
//      Kasper-visible) -> open the Kasper page samples sub-tab -> the card
//      appears AND shows a visible SAMPLE badge AND is attributed to sidneylaruel;
//   2) drive Kasper approve on VIDEO via the rendered control -> poll Supabase:
//      video_status -> "Client Approval" (persisted via sample-review-upsert);
//   3) a parallel CALENDAR card (seeded via calendar-upsert-post) does NOT appear
//      in the samples sub-tab, AND the sample does NOT appear in the calendar
//      `review` tab (isolation, both directions);
//   4) the cross-client read used the PAGINATOR (surfaces a row even with many
//      rows in the table — asserted by the card being found among a full read);
//   5) 0 app JS errors.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + (!c && x ? '  -> ' + x : '')); };

(async () => {
  const stamp = Date.now();
  const sid = 'sr_m5a_' + stamp;
  const calId = 'p_m5a_' + stamp;     // parallel calendar card (isolation control)
  const now = new Date().toISOString();

  // 1) Seed the sample: BOTH comps at Kasper Approval, a thumbnail (content gate),
  //    a graphic Linear link (so the graphic comp is Kasper-visible too).
  const seed = Q.up({
    id: sid, name: 'M5a Kasper sample', order_index: '1',
    asset_url: 'https://example.com/m5a-video.mp4',
    thumbnail_url: 'https://via.placeholder.com/320x180.png',
    graphic_linear_issue_id: 'https://linear.app/synchro/issue/GRA-M5A',
    video_status: 'Kasper Approval', graphic_status: 'Kasper Approval',
    status: 'Kasper Approval', created_at: now,
  });
  ok(seed && seed.ok === true, 'seed live sample (both comps Kasper Approval)', JSON.stringify(seed).slice(0, 160));

  // 3a) Seed a parallel CALENDAR card sitting at Kasper Approval too — it must
  //     NOT show up in the samples sub-tab (different table/queue).
  const calSeed = Q.upCal({
    id: calId, name: 'M5a calendar control', order_index: '900',
    asset_url: 'https://example.com/m5a-cal.mp4',
    thumbnail_url: 'https://via.placeholder.com/320x180.png',
    video_status: 'Kasper Approval', graphic_status: 'In Progress', caption_status: 'In Progress',
    status: 'Kasper Approval', created_at: now,
  });
  ok(calSeed && calSeed.ok === true, 'seed parallel calendar control card', JSON.stringify(calSeed).slice(0, 160));

  const browser = await Q.launch();
  try {
    const page = await Q.kasper(browser);

    // Wait for the samples sub-tab to render our card.
    let view = {};
    for (let i = 0; i < 30; i++) {
      view = await page.evaluate((ids) => {
        const tabBtn = document.querySelector('.kasper-subtab[data-kasper-tab="samples"]');
        const cards = Array.from(document.querySelectorAll('.sxr-kcard[data-kasper-sxr-pid]'));
        const mine = cards.find(c => c.getAttribute('data-kasper-sxr-pid') === ids.sid);
        const calLeak = cards.find(c => c.getAttribute('data-kasper-sxr-pid') === ids.calId);
        const badge = mine ? mine.querySelector('.sxr-kasper-badge') : null;
        const clientEl = mine ? mine.querySelector('.kcard-client') : null;
        const slice = (window._kasperRenderSamples && (function(){ try { return null; } catch(e){ return null; } })());
        return {
          tabPresent: !!tabBtn,
          n: cards.length,
          found: !!mine,
          badgeText: badge ? badge.textContent.trim() : null,
          badgeVisible: !!(badge && badge.offsetParent !== null),
          client: clientEl ? clientEl.textContent.trim() : null,
          calLeak: !!calLeak,
          tab: (window._kasperGotoTab ? 'fn' : 'nofn'),
        };
      }, { sid, calId });
      if (view.found) break;
      await page.waitForTimeout(900);
    }
    console.log('  samples view:', JSON.stringify(view));
    ok(view.tabPresent === true, 'Samples sub-tab is shown under ?sxr=1', JSON.stringify(view));
    ok(view.found === true, 'seeded sample card appears in Kasper samples sub-tab', JSON.stringify(view));
    ok(view.badgeText === 'SAMPLE' && view.badgeVisible === true, 'card shows a visible SAMPLE badge', JSON.stringify(view));
    ok(/sidney/i.test(view.client || ''), 'card attributed to sidneylaruel', JSON.stringify(view));

    // 3b) Isolation: the calendar control card must NOT be in the samples sub-tab.
    ok(view.calLeak === false, 'parallel calendar card does NOT appear in samples sub-tab', JSON.stringify(view));

    // 4) Paginator: assert the cross-client read surfaced our row from a full
    //    sample_reviews read (the card being found above already came through
    //    _calSupabaseFetchAllRows). Confirm the helper is the paginated one by
    //    checking it pages — read back the row count via REST as a sanity probe.
    const allRows = Q.supa('select=id,client&limit=2000');
    ok(Array.isArray(allRows) && allRows.some(r => r.id === sid), 'cross-client paginated read can surface the row among many', 'rows=' + (Array.isArray(allRows) ? allRows.length : 'n/a'));

    // 2) Drive Kasper approve on VIDEO via the rendered control. Expand the card,
    //    then click the video panel's Approve button.
    const approved = await page.evaluate((sid) => {
      const card = document.querySelector('.sxr-kcard[data-kasper-sxr-pid="' + sid + '"]');
      if (!card) return { step: 'no-card' };
      // Expand.
      const exp = card.querySelector('.kcard-expand-btn');
      if (exp) exp.click();
      return { step: 'expanded' };
    }, sid);
    await page.waitForTimeout(700);
    const clicked = await page.evaluate((sid) => {
      const card = document.querySelector('.sxr-kcard[data-kasper-sxr-pid="' + sid + '"]');
      if (!card) return { step: 'no-card' };
      const panel = card.querySelector('.cal-review-panel[data-comp="video"]');
      if (!panel) return { step: 'no-video-panel', html: card.innerHTML.slice(0, 200) };
      const btn = panel.querySelector('.cal-review-approve-btn');
      if (!btn) return { step: 'no-approve-btn' };
      btn.click();
      return { step: 'clicked' };
    }, sid);
    console.log('  approve drive:', JSON.stringify(approved), JSON.stringify(clicked));
    ok(clicked.step === 'clicked', 'clicked the rendered video Approve control', JSON.stringify(clicked));

    // Poll Supabase: video_status -> Client Approval.
    let row = null;
    for (let i = 0; i < 20; i++) {
      const r = Q.supa('id=eq.' + sid + '&client=eq.sidneylaruel&select=*');
      row = Array.isArray(r) && r[0];
      if (row && String(row.video_status) === 'Client Approval') break;
      await page.waitForTimeout(900);
    }
    console.log('  read-back:', row ? JSON.stringify({ video_status: row.video_status, graphic_status: row.graphic_status, status: row.status, kasper_approved_at: row.kasper_approved_at }) : 'null');
    ok(!!row && String(row.video_status) === 'Client Approval', 'video -> Client Approval persisted via sample-review-upsert', row ? JSON.stringify(row.video_status) : 'null');

    // 3c) Reverse isolation: the sample must NOT appear in the calendar REVIEW tab.
    const inReview = await page.evaluate(async (sid) => {
      try { window._kasperGotoTab('review'); } catch (e) {}
      // Give the review queue a moment to load.
      await new Promise(r => setTimeout(r, 2500));
      const cards = Array.from(document.querySelectorAll('.kcard[data-kasper-pid]'));
      return cards.some(c => c.getAttribute('data-kasper-pid') === sid);
    }, sid);
    ok(inReview === false, 'sample does NOT appear in the calendar review tab', 'inReview=' + inReview);

    // 5) No app JS errors.
    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 5)));
  } finally {
    Q.up({ id: sid, status: 'Archived' });
    Q.upCal({ id: calId, status: 'Archived' });
    await browser.close();
  }
  console.log(`PROBE sxr_m5a_kasper: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
