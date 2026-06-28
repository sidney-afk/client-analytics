// ot02_client_review.js — CLIENT share surface against the LIVE backend.
// The client surface has no "create"; the legitimate setup is to seed a
// client-ready sample, then drive the REAL client approve. Also asserts the
// share shell, read-only Sheet (no field/grip/status leaks), and that an
// internal hidden creative-direction never reaches the client.
const L = require('../sxr_courier_lib.js');
const { launch, client, up, supa, poll, appErrs, archiveSafe } = L;

const ID = 'sr_otc2_' + Date.now();
const NAME = 'OT client review ' + Date.now();
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

(async () => {
  // seed: video awaiting Client Approval, graphic Approved, with media + a HIDDEN internal brief
  up({ id: ID, name: NAME, order_index: 1, asset_url: 'https://frame.io/x/otc2', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
       creative_direction: 'INTERNAL ONLY — do not show client', hide_creative_direction: '1',
       video_status: 'Client Approval', graphic_status: 'Approved', status: 'Client Approval' });
  await poll(() => { const r = supa('id=eq.' + ID + '&select=id'); return (r[0]) ? r[0] : null; }, 12000, 800);

  const browser = await launch();
  try {
    const page = await client(browser);  // ?sxr=1&c=Sidney Laruel&v=sample-reviews

    // --- shell ---
    const shell = await page.evaluate(() => {
      const v = document.getElementById('sxrView');
      const et = document.querySelector('#sxrView .cal-embed-title');
      return { mounted: !!v, headerHidden: getComputedStyle(document.querySelector('header.header')).display === 'none',
        embedTitle: et ? et.textContent.replace(/\s+/g, ' ').trim() : null,
        tabs: [...document.querySelectorAll('#sxrView .cal-view-btn')].map(b => b.textContent.replace(/\s+/g, ' ').trim()),
        kebab: !!document.getElementById('sxrKebabMenu'), perClientTabs: !!document.getElementById('sxrTabs') };
    });
    ok(shell.mounted, 'client share mounted');
    ok(shell.headerHidden, 'admin header hidden on client share');
    ok(/Sample reviews/i.test(shell.embedTitle || ''), 'embed title shows "Sample reviews"', JSON.stringify(shell.embedTitle));
    ok(!shell.kebab, 'no kebab menu (client)');
    ok(!shell.perClientTabs, 'no per-client tab strip (client)');

    // --- find MY review card by name, expand it ---
    const expanded = await page.evaluate((nm) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      if (!card) return false;
      (card.querySelector('.kcard-strip') || card).click();
      return true;
    }, NAME);
    ok(expanded, 'seeded client-ready card present + expanded');
    await page.waitForTimeout(400);

    // --- video panel: single approve, no SMM split, no first-review badge ---
    const panel = await page.evaluate((nm) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      const p = card ? card.querySelector('.cal-review-panel[data-comp="video"]') : null;
      if (!p) return null;
      return { approve: (p.querySelector('.cal-review-approve-btn') || {}).textContent, split: !!p.querySelector('.cal-review-approve-split'),
        first: !!p.querySelector('.cal-review-firstpass'), request: !!p.querySelector('.cal-review-tweak-btn') };
    }, NAME);
    ok(!!panel, 'video review panel present on client card');
    if (panel) {
      ok(/Approve video/i.test((panel.approve || '').replace(/\s+/g, ' ')), 'single "Approve video" button', JSON.stringify((panel.approve || '').trim()));
      ok(!panel.split, 'no SMM approve-split on client');
      ok(!panel.first, 'no "First review" badge on client');
      ok(panel.request, 'request-change control present');
    }

    // --- click approve video → live DB video_status = Approved ---
    await page.evaluate((nm) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
      const b = card && card.querySelector('.cal-review-panel[data-comp="video"] .cal-review-approve-btn');
      if (b) b.click();
    }, NAME);
    const apRow = await poll(() => { const r = supa('id=eq.' + ID + '&select=video_status,status'); return (r[0] && r[0].video_status === 'Approved') ? r[0] : null; }, 14000, 1000);
    ok(!!apRow, 'client approve → video_status Approved in LIVE DB', apRow ? ('status=' + apRow.status) : '');

    // --- switch to Sheet → read-only, no leaks ---
    await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); });
    await page.waitForTimeout(500);
    const sheet = await page.evaluate((nm) => {
      const card = [...document.querySelectorAll('#sxrStrip .cal-card')].find(c => { const n = c.querySelector('.cal-fld-name'); return n && (n.value === nm || n.textContent === nm); });
      if (!card) return { found: false };
      return { found: true, ro: card.classList.contains('cal-card-ro'),
        archive: !!card.querySelector('.cal-card-del'), grip: !!card.querySelector('.cal-card-grip'),
        statusTrigger: !!card.querySelector('.cal-fld-substatus-trigger'),
        editableFields: card.querySelectorAll('input:not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled])').length,
        cdShown: /INTERNAL ONLY/.test(card.textContent) };
    }, NAME);
    ok(sheet.found, 'seeded card present in client Sheet');
    if (sheet.found) {
      ok(sheet.ro, 'client Sheet card is read-only (cal-card-ro)');
      ok(!sheet.archive, 'no archive button on client card');
      ok(!sheet.grip, 'no drag grip on client card');
      ok(!sheet.statusTrigger, 'no status trigger on client card');
      ok(!sheet.cdShown, 'hidden internal creative-direction NOT shown to client');
    }

    const errs = appErrs(page);
    ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(ID), 'cleanup: seed archived', 'id=' + ID);
    const stray = supa('id=eq.' + ID + '&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active row');
  }

  console.log('\nRESULT ot02_client_review: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
