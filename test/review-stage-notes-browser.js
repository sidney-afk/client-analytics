'use strict';
/*
 * NO OLD NOTES DIALOG FIRST ON A SWITCHED-ON CLIENT LINK (owner feedback 2026-10-17 23:40, session Curtain Nine).
 *
 * "On the client page's Sheet tab, clicking Notes on a card shows the old Notes dialog for a moment before the new
 * view." Cause: on a client link nothing on the Sheet asked for the player's switch (frame_viewer_clients), so the
 * first Notes click did; the dialog painted without the player (the old shape) and became the player view when the
 * answer came (live, that read took 1.5 to 3.7 s). Also, the player took its portrait shape one frame late.
 *
 * In a real browser, fully offline (the review-stage fixture, the switch answered slowly), this records every frame
 * after a Notes click on the Sheet tab and asserts:
 *   - no frame shows the Notes dialog without the player;
 *   - from its first frame the view has its final shape (portrait for a portrait card, the same width throughout);
 *   - it does open, with the player.
 * Fails on main.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { openClient, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      console.log('--- client link, Sheet, ' + w + ' wide ---');
      const t = await openClient(browser, origin, { flags: 'on', tab: 'review', finished: true, frameDelay: 3200, width: w, height: h });
      await waitNew(t);
      await t.page.evaluate(() => onCalViewChange('organizer'));
      await t.page.waitForFunction(() => Array.from(document.querySelectorAll('[data-comments-btn]')).some(b => b.offsetParent), null, { timeout: 15000 });
      await t.page.evaluate(() => {
        window.__nf = [];
        const tick = () => {
          const o = document.querySelector('.cal-comments-overlay.open') || (document.getElementById('calCommentsOverlay') && document.getElementById('calCommentsOverlay').classList.contains('open') ? document.getElementById('calCommentsOverlay') : null);
          const sh = document.getElementById('calNotesShell'), st = document.getElementById('calNotesStage');
          const r = sh ? sh.getBoundingClientRect() : null;
          window.__nf.push({ open: !!o, video: !!(sh && sh.hasAttribute('data-video')), orient: st ? st.getAttribute('data-orient') || '' : '', w: r ? Math.round(r.width) : 0 });
          if (window.__nf.length < 400) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      await t.page.locator('[data-comments-btn]').filter({ visible: true }).first().click();
      await t.page.waitForFunction(() => { const sh = document.getElementById('calNotesShell'); return sh && sh.hasAttribute('data-video'); }, null, { timeout: 8000 }).catch(() => {});
      await sleep(700);
      const f = (await t.page.evaluate(() => window.__nf)).filter(x => x.open);
      expect(f.length > 5, w + ': the Notes view opened (' + f.length + ' frames)');
      const old = f.filter(x => !x.video).length;
      expect(!old, w + ': no frame shows the old dialog without the player (' + old + ' frames did)');
      const vid = f.filter(x => x.video);
      const orients = [...new Set(vid.map(x => x.orient))], widths = [...new Set(vid.map(x => x.w))];
      expect(orients.length === 1 && orients[0] === 'portrait', w + ': the player is portrait from its first frame (' + orients.join(' then ') + ')');
      expect(widths.length === 1, w + ': the view keeps one width from its first frame (' + widths.join(' then ') + ')');
      expect(t.errors.length === 0, w + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview stage Notes, no old dialog first: all passed');
})().catch(e => { console.error(e); process.exit(1); });
