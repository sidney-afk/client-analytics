'use strict';
/*
 * KASPER PRESSES "TWEAKS ARE ON FRAME" ON A SAMPLE (session Frametweak, 2026-10-27). Real browser, fully offline, the
 * shared mocked backend of the review-stage tests plus one fictional sample, in his second layout (every part at once),
 * with the Review Session polish, which is on for every signed-in staff member since 2026-10-29 (session Permafive):
 * each case runs with the old unread_badges_v2 row present and absent, and the polish must be on either way. The stage wrote his words into
 * window._sxrKasperState, which the Samples module never puts on window, so every change from the stage on a sample
 * (Tweaks are on Frame, a typed Ask for a change) threw before any save (OPEN_REPAIRS 539). A typed change rides along.
 */
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { SLUG, CLIENT, FRAME, STAFF, open, inS, sleep } = require('./fixtures/review-stage-fixture.js');

const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

function sample() {
  return { id: 'sx1', client: SLUG, name: 'Fixture sample one', status: 'Kasper Approval', order_index: 1, updated_at: '2026-10-10T12:00:00.000Z',
    video_status: 'Kasper Approval', graphic_status: 'N/A', asset_url: FRAME, thumbnail_url: '', video_deliverable_id: 'del_sx1',
    video_tweaks: '[]', graphic_tweaks: '[]', comments: [], graphic_comments: [] };
}
async function openKasper(browser, origin, polish) {
  const t = await open(browser, origin, { stage: 'kasper', flags: 'on', staff: STAFF, layout2: true, unread: polish, samples: true, linkedParts: true, mergeComments: true, nativeReceipts: true });
  const row = sample();
  t.sample = row; t.sampleSaves = [];
  if (t.state.nativeRows) t.state.nativeRows.del_sx1 = { id: 'del_sx1', card_id: 'sx1', client_slug: SLUG, team: 'video', status: 'kasper_approval', updated_at: row.updated_at, status_at: row.updated_at };
  await t.page.route('**/rest/v1/sample_reviews**', route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify([row]) }));
  await t.page.route('**/functions/v1/sample-review-upsert', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: '' });
    const b = JSON.parse(route.request().postData() || '{}');
    t.sampleSaves.push(b);
    Object.assign(row, b.sample || {}, { updated_at: new Date().toISOString() });
    return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify({ ok: true, sample: row }) });
  });
  await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
  await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(r && r.querySelectorAll('#l2g .pn').length); }, null, { timeout: 30000 });
  await sleep(1800);
  return t;
}
const R = (page, fn, arg) => page.evaluate(([src, a]) => { const r = document.getElementById('svReviewStage').shadowRoot; return (0, eval)('(' + src + ')')(r, a); }, [fn.toString(), arg]);

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const [kind, polish] of [['frame', false], ['frame', true], ['ask', false], ['ask', true]]) {
      const words = kind === 'frame' ? 'Tweaks are on Frame.' : 'Trim the last two seconds, please.';
      console.log('--- Kasper ' + (kind === 'frame' ? 'presses Tweaks are on Frame' : 'types Ask for a change') + ' on a sample, old switch row ' + (polish ? 'present' : 'absent') + ' ---');
      const t = await openKasper(browser, origin, polish);
      expect(await inS(t.page, '.rs.cp').count() === 1, 'the polish is on, old switch row ' + (polish ? 'present' : 'absent'));
      // Open the sample on stage.
      const opened = await R(t.page, (r) => {
        const rows = [...r.querySelectorAll('[data-id], [data-pid], button, a')].filter(e => /Fixture sample one/.test(e.textContent || ''));
        if (!rows.length) return 'no row: ' + r.textContent.slice(0, 300);
        rows[0].click(); return 'clicked ' + rows[0].tagName + ' ' + (rows[0].className || '');
      });
      console.log('     ' + opened);
      await sleep(1200);
      const fr = inS(t.page, '[data-frame="video"]');
      const st = await R(t.page, (r) => { const b = r.querySelector('[data-frame="video"]'); const h = r.querySelector('.sd-t h2, h2'); return { title: h ? h.textContent : '', frame: !!b, disabled: b ? b.disabled : null, cls: b ? b.className : '' }; });
      console.log('     ' + JSON.stringify(st));
      expect(st.frame && !st.disabled, 'the sample\'s video shows an enabled Tweaks are on Frame');
      if (st.frame) {
        if (kind === 'frame') await fr.first().click({ timeout: 3000 }).catch(e => console.log('     click: ' + String(e.message).split('\n')[0]));
        else {
          await inS(t.page, '[data-chg="video"]').first().click(); await sleep(300);
          await inS(t.page, '#ta').first().fill(words);
          await inS(t.page, '#ta').first().press('Enter');
        }
        for (let i = 0; i < 80 && !JSON.parse(t.sample.video_tweaks || '[]').some(n => n.body === words); i++) await sleep(100);
        await sleep(600);
        const tw = JSON.parse(t.sample.video_tweaks || '[]');
        console.log('     saves: ' + t.sampleSaves.length + ', status: ' + t.sample.video_status);
        expect(tw.some(n => n.body === words && n.is_tweak), 'the sample saved Kasper\'s change request "' + words + '"');
        expect(t.sample.video_status === 'Tweaks Needed', 'the sample\'s video is at Tweaks Needed (' + t.sample.video_status + ')');
        const after = await R(t.page, (r) => { const d = r.querySelector('.pn-d[data-pd="video"]'); return d ? d.innerText.replace(/\s+/g, ' ') : r.querySelector('#rsApp').innerText.slice(0, 300); });
        console.log('     after: ' + after.slice(0, 200));
      }
      expect(!t.errors.length, 'no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
