'use strict';
/*
 * KASPER'S REDO (OPEN_REPAIRS 694, owner's go 2026-11-03). Real browser, fully offline, the shared mocked backend of
 * the review-stage tests plus one fictional sample. On every part of his Review Session Kasper has a Redo: it sends the
 * part back with one fixed, team-only note when there is no one thing to fix. It cannot be unsent, so the first click
 * only arms it in place ("Send redo?") and sends nothing; a second click within four seconds sends the note exactly
 * once and the part goes to Tweaks Needed; left alone it disarms by itself. Checked on a Calendar post and on a sample
 * (the Samples twin of the save path), in his second layout at 1440 and on today's page at phone width, in Chromium and
 * WebKit (CI requires WebKit with KASPER_REDO_REQUIRE_WEBKIT=1). The client page and the SMM's never show it.
 */
const { chromium, webkit } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { SLUG, CLIENT, FRAME, STAFF, open, openClient, inS, sleep } = require('./fixtures/review-stage-fixture.js');

const NOTE = "Not there yet, and there's no one thing to fix. Take a fresh look, find what's holding it back, and bring back a stronger cut.";
const failures = [];
let engineName = '';
function expect(value, message) { message = '[' + engineName + '] ' + message; if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

function sample() {
  return { id: 'sx1', client: SLUG, name: 'Fixture sample one', status: 'Kasper Approval', order_index: 1, updated_at: '2026-10-10T12:00:00.000Z',
    video_status: 'Kasper Approval', graphic_status: 'N/A', asset_url: FRAME, thumbnail_url: '', video_deliverable_id: 'del_sx1',
    video_tweaks: '[]', graphic_tweaks: '[]', comments: [], graphic_comments: [] };
}
async function openKasper(type, origin, opt) {
  const browser = await type.launch();
  const t = await open(browser, origin, Object.assign({ stage: 'kasper', flags: 'on', staff: STAFF, layout2: true, samples: true, linkedParts: true, mergeComments: true, nativeReceipts: true }, opt.width ? { width: opt.width, height: 844 } : {}));
  t.browser = browser;
  const row = sample();
  t.sample = row; t.sampleSaves = [];
  t.state.nativeRows.del_sx1 = { id: 'del_sx1', card_id: 'sx1', client_slug: SLUG, team: 'video', status: 'kasper_approval', updated_at: row.updated_at, status_at: row.updated_at };
  await t.page.route('**/rest/v1/sample_reviews**', route => route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify(opt.withSample ? [row] : []) }));
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
  await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(r && r.querySelector('[data-redo]')); }, null, { timeout: 30000 });
  await sleep(1200);
  return t;
}
const R = (page, fn, arg) => page.evaluate(([src, a]) => { const r = document.getElementById('svReviewStage').shadowRoot; return (0, eval)('(' + src + ')')(r, a); }, [fn.toString(), arg]);
const redoOf = (page, part) => R(page, (r, k) => {
  const b = r.querySelector('[data-redo="' + k + '"]');
  if (!b) return null;
  const box = b.getBoundingClientRect();
  return { text: b.innerText.replace(/\s+/g, ' ').trim(), label: b.getAttribute('aria-label') || b.textContent.replace(/\s+/g, ' ').trim(), armed: b.classList.contains('armed'), disabled: b.disabled, x: box.left, right: box.right, w: box.width, h: box.height, vw: innerWidth };
}, part);
// Every place a change could be written: the card's own tweaks, the sample's, and any write request at all.
function notesOn(t, which, part) {
  const row = which === 'sample' ? t.sample : t.state.cards.find(c => c.id === 'rs1');
  return JSON.parse(row[part + '_tweaks'] || '[]').filter(n => String(n.body || '').includes(NOTE));
}
const writes = t => t.state.upserts.length + t.state.gateway.length + t.sampleSaves.length;
async function openOnStage(t, name) {
  await R(t.page, (r, nm) => { const el = [...r.querySelectorAll('[data-id], [data-pid], button, a')].find(e => (e.textContent || '').includes(nm)); if (el) el.click(); }, name);
  await sleep(1000);
}

async function sendRedo(t, which, part, label) {
  const before = writes(t);
  const b0 = await redoOf(t.page, part);
  expect(!!b0 && !b0.disabled && /^Redo$/.test(b0.label), label + ': the ' + part + ' shows an enabled Redo (' + JSON.stringify(b0 && b0.label) + ')');
  if (!b0) return;
  expect(b0.x >= 0 && b0.right <= b0.vw + 0.5 && b0.w >= 24 && b0.h >= 24, label + ': Redo sits inside the window and is big enough to press (' + Math.round(b0.x) + '-' + Math.round(b0.right) + ' of ' + b0.vw + ', ' + Math.round(b0.w) + 'x' + Math.round(b0.h) + ')');
  await inS(t.page, '[data-redo="' + part + '"]').first().click();
  await sleep(900);
  const armed = await redoOf(t.page, part);
  expect(armed && armed.armed && /Send redo\?/.test(armed.label), label + ': the first click arms it in place (' + JSON.stringify(armed && armed.label) + ')');
  expect(writes(t) === before && !notesOn(t, which, part).length, label + ': the first click sends nothing (' + (writes(t) - before) + ' writes)');
  await inS(t.page, '[data-redo="' + part + '"]').first().click();
  for (let i = 0; i < 80 && !notesOn(t, which, part).length; i++) await sleep(100);
  await sleep(1500);
  const sent = notesOn(t, which, part);
  expect(sent.length === 1, label + ': the second click sends the note exactly once (' + sent.length + ')');
  expect(sent.length === 1 && String(sent[0].body).trim() === NOTE && sent[0].is_tweak, label + ': the note is the fixed Redo words, as a change request');
  expect(sent.length === 1 && sent[0].audience !== 'client', label + ': the note is for the team only (' + (sent[0] && sent[0].audience) + ')');
  const st = which === 'sample' ? t.sample[part + '_status'] : t.state.cards.find(c => c.id === 'rs1')[part + '_status'];
  const nat = which === 'sample' ? t.state.nativeRows.del_sx1 : t.state.nativeRows[part === 'graphic' ? 'fixture_graphic_rs1' : 'del_rs1'];
  expect(st === 'Tweaks Needed' || (nat && nat.status === 'tweak'), label + ': the ' + part + ' is at Tweaks Needed (card ' + st + ', native ' + (nat && nat.status) + ')');
  // A third press (the button re-armed or a stale one) must never send a second note.
  await sleep(500);
  expect(notesOn(t, which, part).length === 1, label + ': still one note after the send settled');
}

async function runEngine(type, origin) {
  // 1. A Calendar post in his second layout at 1440: Redo on the video, then a Redo left alone on the thumbnail disarms.
  {
    const t = await openKasper(type, origin, {});
    try {
      const parts = await R(t.page, r => [...r.querySelectorAll('[data-redo]')].map(b => b.dataset.redo));
      expect(['video', 'graphic', 'caption'].every(k => parts.includes(k)), 'second layout: a Redo on every part (' + parts.join(', ') + ')');
      // One row per part (the second layout's rule): Redo sits on Approve's row and overlaps no other button.
      for (const w of [1440, 1920]) {
        await t.page.setViewportSize({ width: w, height: 900 }); await sleep(500);
        const rows = await R(t.page, r => [...r.querySelectorAll('.pn-d')].map(d => {
          const bs = [...d.querySelectorAll('.dec button:not([hidden])')].filter(b => b.offsetParent && !b.closest('.menu') && !b.classList.contains('sarr')).map(b => { const q = b.getBoundingClientRect(); return { k: b.dataset.redo ? 'redo' : b.dataset.ok ? 'ok' : b.dataset.chg ? 'ask' : b.dataset.frame ? 'frame' : b.className, x: q.left, r: q.right, y: q.top + q.height / 2, w: q.width }; });
          return { part: d.dataset.pd, bs, pr: d.getBoundingClientRect().right, px: d.getBoundingClientRect().left };
        }));
        for (const row of rows) {
          const redo = row.bs.find(b => b.k === 'redo'), ok = row.bs.find(b => b.k === 'ok');
          const sorted = row.bs.filter(b => b.w > 0).sort((a, b) => a.x - b.x);
          const overlap = sorted.some((b, i) => i && b.x < sorted[i - 1].r - 0.5);
          expect(redo && ok && Math.abs(redo.y - ok.y) < 4 && !overlap && redo.x >= row.px - 0.5 && redo.r <= row.pr + 0.5, w + ' second layout, ' + row.part + ': Redo is on Approve\'s row, inside the part, overlapping nothing (' + sorted.map(b => b.k + ' ' + Math.round(b.x) + '-' + Math.round(b.r)).join(', ') + ')');
        }
      }
      await t.page.setViewportSize({ width: 1440, height: 900 }); await sleep(500);
      const before = writes(t);
      await inS(t.page, '[data-redo="graphic"]').first().click();
      await sleep(600);
      expect((await redoOf(t.page, 'graphic')).armed, 'second layout: the thumbnail\'s Redo arms');
      await sleep(4300);
      const after = await redoOf(t.page, 'graphic');
      expect(after && !after.armed && /^Redo$/.test(after.label), 'second layout: left alone, it disarms by itself after four seconds');
      expect(writes(t) === before && !notesOn(t, 'card', 'graphic').length, 'second layout: a Redo that disarmed sent nothing');
      await sendRedo(t, 'card', 'video', 'second layout, post');
      expect(!t.errors.length, 'second layout: no page errors (' + t.errors.join(' | ') + ')');
    } finally { await t.browser.close(); }
  }
  // 2. A sample: the same press goes through the Samples twin of the save path.
  {
    const t = await openKasper(type, origin, { withSample: true });
    try {
      await openOnStage(t, 'Fixture sample one');
      await sendRedo(t, 'sample', 'video', 'sample');
      expect(!t.errors.length, 'sample: no page errors (' + t.errors.join(' | ') + ')');
    } finally { await t.browser.close(); }
  }
  // 3. Phone width: today's page, the caption's Redo.
  {
    const t = await openKasper(type, origin, { width: 390 });
    try {
      const parts = await R(t.page, r => [...r.querySelectorAll('[data-redo]')].map(b => b.dataset.redo));
      expect(parts.length >= 1, 'phone: Redo shows (' + parts.join(', ') + ')');
      const k = parts.includes('video') ? 'video' : parts[0];
      if (k) await sendRedo(t, 'card', k, 'phone');
      const wide = await t.page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(wide <= 1, 'phone: the page does not scroll sideways (' + wide + 'px)');
      expect(!t.errors.length, 'phone: no page errors (' + t.errors.join(' | ') + ')');
    } finally { await t.browser.close(); }
  }
  // 4. Only Kasper: the client's page and the SMM's never show Redo.
  {
    const browser = await type.launch();
    try {
      const c = await openClient(browser, origin, { flags: 'on' });
      await c.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return !!(h && h.shadowRoot && h.shadowRoot.querySelector('[data-ok]')); }, null, { timeout: 30000 }).catch(() => {});
      expect(await inS(c.page, '[data-ok]').count() > 0 && await inS(c.page, '[data-redo]').count() === 0, 'client page: no Redo');
      await c.ctx.close();
      const s = await open(browser, origin, { stage: 'smm', flags: 'on', staff: STAFF });
      await s.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
      await s.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
      await s.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
      await s.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
      await s.page.evaluate(() => onCalViewChange('smmreview'));
      await s.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return !!(h && h.shadowRoot && h.shadowRoot.querySelector('[data-ok]')); }, null, { timeout: 30000 }).catch(() => {});
      expect(await inS(s.page, '[data-ok]').count() > 0 && await inS(s.page, '[data-redo]').count() === 0, 'SMM Review tab: no Redo');
      await s.ctx.close();
    } finally { await browser.close(); }
  }
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const only = String(process.env.KASPER_REDO_ENGINES || '').split(',').filter(Boolean);
    for (const [name, type] of [['chromium', chromium], ['webkit', webkit]]) {
      if (only.length && !only.includes(name)) continue;
      engineName = name;
      let probe = null;
      try { probe = await type.launch(); } catch (e) { probe = null; }
      if (!probe) {
        if (name === 'webkit' && process.env.KASPER_REDO_REQUIRE_WEBKIT === '1') expect(false, 'WebKit is required in this run but could not start');
        else console.log('(' + name + ' is not installed here: skipped)');
        continue;
      }
      await probe.close();
      console.log('===== ' + name + ' =====');
      await runEngine(type, origin);
    }
  } finally { server.close(); }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nall passed');
})().catch(e => { console.error(e); process.exit(1); });
