'use strict';
// Real device descriptors, real browser engines, real page; every remote answer is the shared fictional fixture.
// PHONE_ONLY='iPhone SE' PHONE_MODE=layout PHONE_SHOTS=<dir> narrows a reproduction without changing assertions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit, devices } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils');
const { CLIENT, TOKEN, STAFF, open, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture');
const profiles = ['iPhone SE', 'iPhone SE landscape', 'iPhone 15', 'iPhone 15 landscape', 'iPhone 15 Pro Max', 'iPhone 15 Pro Max landscape', 'Pixel 7', 'Pixel 7 landscape'];
const failures = [];
let checks = 0;
let cases = 0;
function check(ok, text) { checks++; if (!ok) { failures.push(text); console.error('FAIL ' + text); } }
const remoteErrors = e => String(e.message || e).split('\n').filter((s, i) => i === 0 || /waiting for locator/.test(s)).join(' ');
async function tap(locator) {
  // Verify the actual hit target, then send one touch. Locator.tap can retry a touch when its click handler replaces
  // the button immediately in WebKit, repeating an action that already ran (these views redraw on a click).
  let point, prior;
  await until(async () => {
    try {
      await locator.scrollIntoViewIfNeeded({ timeout: 750 });
      if (!await locator.isEnabled()) return false;
      const p = await locator.evaluate(el => {
        const b = el.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2;
        const hit = el.getRootNode().elementFromPoint(x, y);
        return { x, y, hit: hit === el || el.contains(hit) };
      });
      const stable = prior && Math.abs(p.x - prior.x) < 1 && Math.abs(p.y - prior.y) < 1;
      prior = p;
      if (!p.hit || !stable) return false;
      point = p; return true;
    } catch (e) {
      // Pre-input only: a save/part redraw may replace the node while it is being scrolled into view.
      if (!/attached|detached|Timeout|visible/i.test(e.message)) throw e;
      prior = null; return false;
    }
  }, 'touch target never became stable, enabled and uncovered: ' + locator);
  await locator.page().touchscreen.tap(point.x, point.y);
}
async function shot(t, name, sel) {
  if (!process.env.PHONE_SHOTS) return;
  fs.mkdirSync(process.env.PHONE_SHOTS, { recursive: true });
  if (sel) await inS(t.page, sel).scrollIntoViewIfNeeded();
  await t.page.screenshot({ path: path.join(process.env.PHONE_SHOTS, name + '.png'), animations: 'disabled' });
}
async function boot(t, origin, role) {
  if (role === 'client') await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, t: TOKEN, v: 'calendar' }), { waitUntil: 'domcontentloaded' });
  else {
    await t.page.goto(origin + '/index.html?v=kasper', { waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => typeof navTo === 'function');
    await t.page.evaluate(name => { _syncviewStaffIdentityVerified = true; wlMergeClientsFromSheet([name]); navTo('kasper'); }, CLIENT);
  }
  if (role === 'client') {
    await t.page.waitForFunction(() => document.getElementById('svReviewStage')?.shadowRoot?.querySelector('.app.skel'));
    await t.page.evaluate(() => document.fonts.ready);
    t.loading = await positions(t);
  }
  await waitNew(t);
  await t.page.evaluate(() => document.fonts.ready);
  await sleep(700);
}
async function positions(t) {
  return t.page.evaluate(() => {
    const r = document.getElementById('svReviewStage').shadowRoot;
    return ['#side h2', '#stepper', '#view', '#chat'].map(s => { const b = r.querySelector(s).getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; });
  });
}
async function layout(t, label) {
  const m = await t.page.evaluate(() => {
    const r = document.getElementById('svReviewStage').shadowRoot;
    const visible = e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]'); };
    const targets = [...r.querySelectorAll('button,a,input[type=range],summary')].filter(visible).map(e => {
      const b = e.getBoundingClientRect(); return { id: e.id || e.className, w: Math.round(b.width), h: Math.round(b.height) };
    });
    return { width: innerWidth, overflow: document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth,
      small: targets.filter(b => b.w < 44 || b.h < 44),
      fonts: [...r.querySelectorAll('textarea,input:not([type=range])')].filter(visible).map(e => [e.id, parseFloat(getComputedStyle(e).fontSize)]),
      titleFits: (() => { const h = r.querySelector('#side h2'); return h.scrollWidth <= h.clientWidth + 1 && getComputedStyle(h).textOverflow !== 'ellipsis'; })(),
      playerFits: (() => {
        const p = r.querySelector('.fv-player'); if (!p || r.querySelector('.stp.on')?.dataset.step !== 'video') return true;
        const box = p.getBoundingClientRect();
        const bs = [...r.querySelectorAll('.fv-rate,.fv-back,.fv-play,.fv-fwd,.fv-mute,.fv-full')].filter(visible).map(e => e.getBoundingClientRect());
        return bs.every(b => b.left >= box.left - 1 && b.right <= box.right + 1)
          && !bs.some((a,i) => bs.some((b,j) => j > i && Math.min(a.right,b.right) - Math.max(a.left,b.left) > 1 && Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top) > 1));
      })(),
      player: r.querySelector('.fv-player')?.getAttribute('data-state'),
      rate: r.querySelector('.stp.on')?.dataset.step !== 'video' || visible(r.querySelector('.fv-rate')),
      theme: document.getElementById('svReviewStage').getAttribute('data-theme') };
  });
  check(m.overflow <= 1, label + ': no sideways page scroll (' + m.overflow + ')');
  check(m.small.length === 0, label + ': 44px controls ' + JSON.stringify(m.small));
  check(m.fonts.every(x => x[1] >= 16), label + ': 16px fields ' + JSON.stringify(m.fonts));
  check(m.titleFits, label + ': full post title fits');
  check(m.playerFits, label + ': player controls fit without overlap');
  check(m.rate, label + ': speed control is reachable');
  return m;
}
async function until(fn, message, ms = 10000) {
  const start = Date.now();
  while (Date.now() - start < ms) { if (await fn()) return; await sleep(80); }
  assert.fail(message);
}
const notes = (row, part) => JSON.parse(row[part + '_tweaks'] || '[]');
async function step(t, part) {
  await tap(inS(t.page, `[data-step="${part}"]`));
  await until(async () => await inS(t.page, '.stp.on').getAttribute('data-step') === part, 'part did not open');
  await sleep(220);
}
async function sent(t, action, test, message) {
  const n = t.state.upserts.length;
  await action();
  await until(() => t.state.upserts.slice(n).some(test), message, 20000);
  check(true, message);
  console.log('  ok ' + message);
  await sleep(600);
}
async function disconnectDuring(t, action) {
  const n = t.state.writeAttempts;
  t.state.writeDelay = 900;
  t.state.networkDelay = 900;
  await action();
  await until(() => t.state.writeAttempts > n, 'save never started');
  t.state.writeOffline = true;
  await t.ctx.setOffline(true);
}
async function reconnect(t) { t.state.writeDelay = 0; t.state.networkDelay = 0; t.state.writeOffline = false; await t.ctx.setOffline(false); }
async function media(t, label) {
  await step(t, 'video');
  await t.page.waitForFunction(() => { const v = document.getElementById('svReviewStage').shadowRoot.querySelector('video'); return v && v.readyState >= 2 && v.videoWidth > 0; });
  const v = inS(t.page, 'video');
  check(await v.evaluate(v => v.paused && !v.autoplay && v.playsInline), label + ': paused on open, inline, no autoplay');
  check(await v.evaluate(v => getComputedStyle(v).objectFit === 'contain'), label + ': video picture is contained');
  await tap(inS(t.page, '.fv-play'));
  await until(() => v.evaluate(v => !v.paused && v.currentTime > 0.1), 'video never played');
  await sleep(2800);
  check(await v.evaluate(v => !v.paused && v.currentTime > 2 && v.videoWidth > 0), label + ': playback keeps its picture beyond the format watchdog');
  check(await v.evaluate(v => !v.webkitDisplayingFullscreen && !document.fullscreenElement), label + ': Play stays inline');
  await tap(inS(t.page, '.fv-play'));
  await until(() => v.evaluate(v => v.paused), 'video never paused');
  const range = inS(t.page, '.fv-scrub');
  const b = await range.boundingBox();
  await t.page.touchscreen.tap(b.x + b.width * 0.65, b.y + b.height / 2);
  await until(() => v.evaluate(v => v.paused && Math.abs(v.currentTime - v.duration * 0.65) < 0.75), 'touch scrub did not seek to the chosen position');
  await tap(inS(t.page, '.fv-rate'));
  await until(() => v.evaluate(v => v.playbackRate !== 1), 'speed never changed');
  check(true, label + ': play, pause, scrub and speed work by touch');
}
async function keyboard(t, profile, label, field = '#ta') {
  const size = devices[profile].viewport;
  // A reduced visual area is a keyboard stand-in. Playwright cannot launch the real iOS keyboard or Safari bars.
  await t.page.setViewportSize({ width: size.width, height: Math.max(160, size.height - 300) });
  await tap(inS(t.page, field)); await sleep(500);
  const b = await inS(t.page, field).boundingBox();
  const v = await t.page.evaluate(() => ({ top: visualViewport.offsetTop, bottom: visualViewport.offsetTop + visualViewport.height, scale: visualViewport.scale }));
  check(b.y >= v.top && b.y + b.height <= v.bottom + 1, label + ': typing box visible in reduced viewport');
  check(v.scale === 1, label + ': focus keeps viewport scale');
  await t.page.setViewportSize(size);
  await inS(t.page, field).blur();
}
async function clientJourney(t, origin, label, profile) {
  // A fresh second post can exercise changes without taking away the four approvals on the first.
  const first = t.state.cards[0];
  check(await inS(t.page, '#skList .chipp').count() === 7, label + ': cards loaded');
  if (process.env.PHONE_MODE !== 'recovery') await media(t, label);
  for (const part of ['video', 'caption']) {
    await step(t, part);
    await tap(inS(t.page, `[data-pc="${part}"]`));
    await inS(t.page, '#ta').fill('A fictional note about the ' + part);
    await sent(t, () => tap(inS(t.page, '#cmtBtn')), u => notes(u, part).some(n => n.body === 'A fictional note about the ' + part && !n.is_tweak), label + ': note saved on ' + part);
  }
  const own = inS(t.page, '.bub.you').filter({ hasText: 'A fictional note about the video' });
  await tap(own.getByRole('button', { name: 'Delete note', exact: true }));
  await tap(t.page.locator('#confirmYes'));
  await until(() => notes(first, 'video').some(n => n.body === 'A fictional note about the video' && n.deleted), 'delete did not persist a tombstone');
  await until(async () => await own.count() === 0, 'deleted note stayed visible');
  check(true, label + ': own note deleted without changing its part status');
  check(first.video_status === 'Client Approval', label + ': delete leaves approval waiting');
  await step(t, 'caption');
  await tap(inS(t.page, '#editBtn'));
  await inS(t.page, '#capTa').fill('A caption draft kept across a reload.');
  await keyboard(t, profile, label + '/caption editor', '#capTa');
  await t.page.reload({ waitUntil: 'domcontentloaded' }); await waitNew(t); await sleep(700);
  check(await inS(t.page, '#capTa').inputValue().catch(() => '') === 'A caption draft kept across a reload.', label + ': caption draft survives reload');
  // Continue to the save even on the unfixed baseline, so its failure screenshot is still useful.
  if (!await inS(t.page, '#capTa').count()) { await step(t, 'caption'); await tap(inS(t.page, '#editBtn')); await inS(t.page, '#capTa').fill('A caption draft kept across a reload.'); }
  await layout(t, label + '/caption editor');
  await disconnectDuring(t, () => tap(inS(t.page, '#capSave')));
  await until(async () => /did not save|not saved|connection|try again/i.test(await inS(t.page, '#drow, #flash, #tcard').allTextContents().then(x => x.join(' '))), 'no caption failure message');
  check(await inS(t.page, '#capTa').inputValue().catch(() => '') === 'A caption draft kept across a reload.', label + ': failed caption save keeps editable words');
  await shot(t, label.replaceAll('/', '-') + '-offline-caption', '#tcard');
  await reconnect(t);
  if (!await inS(t.page, '#capTa').count()) { await tap(inS(t.page, '#editBtn')); await inS(t.page, '#capTa').fill('A caption draft kept across a reload.'); }
  await sent(t, () => tap(inS(t.page, '#capSave')), u => u.caption === 'A caption draft kept across a reload.', label + ': caption retry saves');
  await step(t, 'video');
  await tap(inS(t.page, '[data-chg="video"]'));
  await inS(t.page, '#ta').fill('Keep these change request words after a reload.');
  await t.page.reload({ waitUntil: 'domcontentloaded' }); await waitNew(t); await sleep(600);
  check(await inS(t.page, '#ta').inputValue() === 'Keep these change request words after a reload.', label + ': change draft and part return');
  check(await inS(t.page, '[data-pc="video"]').getAttribute('aria-pressed') === 'true', label + ': draft belongs to video');
  await disconnectDuring(t, () => tap(inS(t.page, '#sendBtn')));
  await until(async () => /waiting for your connection/i.test(await t.page.locator('body').innerText()), 'offline change did not explain automatic recovery');
  check(!t.state.upserts.some(u => u.video_status === 'Tweaks Needed'), label + ': offline change has no server receipt');
  await shot(t, label.replaceAll('/', '-') + '-offline-change', '#drow');
  await sent(t, () => reconnect(t), u => notes(u, 'video').some(n => n.body === 'Keep these change request words after a reload.' && n.is_tweak), label + ': offline change automatically retries with exact words');
  if (await t.page.locator('#confirmOverlay.active').count()) {
    console.log('NOTICE ' + await t.page.locator('#confirmMsg').textContent());
    check(!/Linear|authority|code:/i.test(await t.page.locator('#confirmMsg').textContent()), label + ': recovery notice uses plain words');
    await tap(t.page.locator('#confirmYes'));
  }
  // Reopen a different waiting post; all four parts have independent approval receipts.
  await tap(inS(t.page, '.chipp[data-id="rs2"]')); await sleep(450);
  for (const part of ['video', 'graphic', 'title', 'caption']) {
    await step(t, part);
    await layout(t, label + '/' + part);
    await sent(t, () => tap(inS(t.page, `[data-ok="${part}"]`)), u => u.id === 'rs2' && u[part + '_status'] === 'Approved', label + ': approve ' + part);
  }
  check(await inS(t.page, '#finishBtn').isEnabled(), label + ': Finish enabled after receipts');
  await tap(inS(t.page, '#finishBtn')); await sleep(450);
  check(await inS(t.page, '.chipp.cur').getAttribute('data-id') !== 'rs2', label + ': Finish opens next post');
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: CLIENT, t: TOKEN, v: 'calendar' }), { waitUntil: 'domcontentloaded' });
  await waitNew(t); await sleep(500);
  check(await t.page.evaluate(() => { const p = calState.posts.find(c => c.id === 'rs2'); return !!p && ['video','graphic','title','caption'].every(k => p[k + '_status'] === 'Approved'); }), label + ': later visit reads all four saved approvals');
  check(await inS(t.page, '.chipp[data-id="rs2"]').count() === 0, label + ': later visit does not ask for those approvals again');
}
async function kasperJourney(t, label) {
  await media(t, label);
  t.state.writeDelay = 1200;
  await sent(t, async () => {
    await tap(inS(t.page, '[data-ok="video"]'));
    check(await inS(t.page, '#closeBtn').isDisabled(), label + ': Close waits for the approval receipt');
  }, u => u.id === 'rs1' && u.video_status === 'Client Approval', label + ': staff approves video');
  t.state.writeDelay = 0;
  await step(t, 'caption');
  await tap(inS(t.page, '[data-chg="caption"]'));
  await inS(t.page, '#ta').fill('Please shorten the fictional opening line.');
  await sent(t, () => tap(inS(t.page, '#sendBtn')), u => notes(u, 'caption').some(n => n.body === 'Please shorten the fictional opening line.' && n.is_tweak), label + ': staff sends caption back');
  console.log('PARTS ' + await inS(t.page, '#stepper').textContent());
  if (process.env.PHONE_DEBUG) console.log(await t.page.evaluate(() => JSON.stringify({items:_kasperState.items.map(i=>({id:i.post.id,v:i.post.video_status,c:i.post.caption_status,e:i._errors})),steps:[...document.getElementById('svReviewStage').shadowRoot.querySelectorAll('.stp')].map(e=>({cls:e.className,part:e.dataset.step})),title:document.getElementById('svReviewStage').shadowRoot.querySelector('#side').textContent})));
  check(await inS(t.page, '#finishBtn').isEnabled(), label + ': staff Finish enabled');
  await shot(t, label.replaceAll('/', '-') + '-answered', '#drow');
  await sent(t, () => tap(inS(t.page, '#finishBtn')), u => u.id === 'rs1' && !!u.kasper_finished_at, label + ': staff finishes');
  const id = await inS(t.page, '.chipp.cur').getAttribute('data-id');
  await sent(t, () => tap(inS(t.page, '#closeBtn')), u => u.id === id && !!u.kasper_closed_at, label + ': staff closes next card');
  if (process.env.PHONE_DEBUG) console.log(await t.page.evaluate(() => JSON.stringify({ids:_kasperState.items.map(i=>i.post.id),closed:_kasperState.closed,cur:document.getElementById('svReviewStage').shadowRoot.querySelector('.chipp.cur')?.dataset.id})));
  check(await inS(t.page, '.chipp.cur').getAttribute('data-id') !== id, label + ': closed card leaves stage');
}
(async () => {
  const server = await serveStatic(), origin = 'http://127.0.0.1:' + server.address().port;
  const browsers = {};
  try {
    for (const profile of profiles.filter(p => !process.env.PHONE_ONLY || p === process.env.PHONE_ONLY)) {
      const engine = profile.startsWith('iPhone') ? 'webkit' : 'chromium';
      if (process.env.PHONE_ENGINE && engine !== process.env.PHONE_ENGINE) continue;
      const browser = browsers[engine] ||= await ({ webkit, chromium })[engine].launch();
      for (const role of ['client', 'kasper'].filter(r => !process.env.PHONE_ROLE || r === process.env.PHONE_ROLE)) for (const theme of ['light', 'dark'].filter(c => !process.env.PHONE_THEME || c === process.env.PHONE_THEME)) {
        const label = `${engine}/${profile}/${role}/${theme}`;
        console.log('RUN ' + label);
        const t = await open(browser, origin, { phone: true, flags: 'on', stage: role, staff: role === 'kasper' ? STAFF : null, dark: theme === 'dark', phoneMedia: engine === 'webkit', context: { ...devices[profile], colorScheme: theme } });
        t.page.setDefaultTimeout(10000);
        try {
          if (role === 'client') t.state.postsDelay = 1800;
          await boot(t, origin, role);
          t.state.postsDelay = 0;
          if (t.loading) {
            const now = await positions(t);
            // A title's placeholder has arbitrary text width; its position and line height must stay put.
            check(now.every((b, i) => b.every((v, j) => (i === 0 && j === 2) || Math.abs(v - t.loading[i][j]) <= 6)), label + ': loading reserves the final layout ' + JSON.stringify({ before: t.loading, after: now }));
          }
          // Title is engaged just as on a YouTube card; preserve default fixtures for the older suites.
          if (role === 'client') {
            Object.assign(t.state.cards[1], { platforms: 'youtube', title_status: 'Client Approval', graphic_status: 'Client Approval', video_deliverable_id: 'del_rs2', graphic_deliverable_id: 'gra_rs2' });
            await t.page.evaluate(() => loadCalendarPosts({ background: true, quiet: true }));
          }
          await t.page.waitForFunction(() => document.getElementById('svReviewStage').shadowRoot.querySelector('.fv-player')?.dataset.state === 'ready', null, { timeout: 15000 });
          await shot(t, label.replaceAll('/', '-'));
          console.log(JSON.stringify(await layout(t, label)));
          await shot(t, label.replaceAll('/', '-') + '-player', '#fvHost');
          await shot(t, label.replaceAll('/', '-') + '-composer', '#ta');
          await keyboard(t, profile, label);
          if (process.env.PHONE_MODE !== 'layout') {
            if (role === 'client') await clientJourney(t, origin, label, profile); else await kasperJourney(t, label);
          }
          check(t.errors.length === 0, label + ': no page errors ' + t.errors.join('|'));
          cases++;
        } catch (e) {
          check(false, label + ': ' + remoteErrors(e));
          await shot(t, label.replaceAll('/', '-') + '-failure');
          console.log('STATE ' + await inS(t.page, '#drow, #compose').allTextContents().then(x => x.join(' | ')));
        }
        finally { await t.ctx.close(); }
      }
    }
  } finally { for (const b of Object.values(browsers)) await b.close(); server.close(); }
  console.log(`review-stage-phone-browser: ${cases} completed cases, ${checks} checks, ${failures.length} failures; fictional data, no live writes`);
  if (failures.length) process.exitCode = 1;
})().catch(e => { console.error(remoteErrors(e)); process.exitCode = 1; });
