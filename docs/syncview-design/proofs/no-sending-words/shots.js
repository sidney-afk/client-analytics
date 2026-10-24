'use strict';
/* "Sending…" / "Saving…" on the team's side, before and after (session Beacon, 2026-10-24).
 *   npm run build:index && node docs/syncview-design/proofs/no-sending-words/shots.js
 * The busy moments last a second each and sit on ten different screens, so this draws every control in its busy state
 * side by side on the real built page, with the page's own styles: "before" is the switch unread_badges_v2 not naming
 * the harness member (the words, as everyone sees them today), "after" is the switch naming it (the spinner). Each
 * control's busy content comes from the page's own svBusyHtml / svBusyText. Offline harness; nothing leaves the
 * machine. NODE_PATH must reach playwright. */
const path = require('path');
const ROOT = path.resolve(__dirname, '../../../..');
const { createEnv, sleep, SLUG } = require(path.join(ROOT, 'docs/syncview-design/tests/lost-work-lib'));
const CORS = { 'access-control-allow-origin': '*' };

// [where, the control's markup with BUSY where its busy content goes, the busy words]
const CONTROLS = [
  ['Production: comment', '<button class="prod-composer-submit" type="submit" disabled>BUSY</button>', 'Saving...'],
  ['Production: description', '<button class="prod-description-action prod-description-save" type="button" disabled>BUSY</button>', 'Saving…'],
  ['Notify client', '<div class="nc-actions"><button type="button" class="nc-send" disabled>BUSY</button></div>', 'Sending…'],
  ['Time off: request', '<button class="pto-submit" type="submit" disabled>BUSY</button>', 'Sending…'],
  ['Templates: brain', '<button type="button" class="tpl-brain-send" disabled>BUSY</button>', 'Sending…'],
  ['Weekly Slack update', '<button class="share-btn slack-update-btn" disabled>BUSY</button>', 'Sending...'],
  ['Clients: save', '<button type="button" class="cc-btn primary ca-save" disabled>BUSY</button>', 'Saving…'],
  ['Onboarding: step', '<button type="button" class="cc-btn primary cb-btn" disabled>BUSY</button>', 'Saving…'],
  ['Workload: due date', '<span class="wl-calm-saving" role="status">BUSY</span>', 'Saving…'],
  ['Submit: saved job', '<div class="linear-saved-status" role="status">BUSY</div>', 'Sending…'],
];

(async () => {
  const done = [];
  for (const [tag, flag] of [['before', { staff: ['someone-else'] }], ['after', { staff: ['m1'] }]]) {
    const S = await createEnv();
    await S.ctx.route('**/rest/v1/syncview_runtime_flags*', async route => {
      const raw = new URL(route.request().url()).searchParams.get('key') || '';
      const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
      const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({
        key: k, value: k === 'unread_badges_v2' ? flag : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: [SLUG] } : { enabled: false } }));
      return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
    });
    try {
      for (const theme of ['light', 'dark']) {
        const page = await S.newPage();
        await page.setViewportSize({ width: 900, height: 900 });
        await page.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
        await S.openCalendar(page);
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
        await sleep(800);
        await page.evaluate(controls => {
          const box = document.createElement('div');
          box.id = 'busyShots';
          box.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--bg);color:var(--text-primary);padding:24px;display:grid;grid-template-columns:200px 1fr;gap:14px 20px;align-content:start;font-size:14px';
          box.innerHTML = controls.map(([where, html, words]) => '<div style="color:var(--text-secondary);align-self:center">' + where + '</div><div>' + html.replace('BUSY', svBusyHtml(words)) + '</div>').join('');
          document.body.appendChild(box);
        }, CONTROLS);
        await sleep(300);
        const f = `${tag}-${theme}.png`;
        await page.locator('#busyShots').screenshot({ path: path.join(__dirname, f), animations: 'disabled' });
        done.push(f);
        await page.close();
      }
    } finally { await S.close(); }
  }
  console.log(done.length + ' screenshots: ' + done.join(', '));
})().catch(e => { console.error(e); process.exit(1); });
