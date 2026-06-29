// scenario_engine.js — data-driven end-to-end scenarios across SMM / Kasper / Client.
// Each scenario is a list of STEPS; each step drives the real UI for one actor and
// is verified against the LIVE sample_reviews row. Actors map to browser tabs.
// Verbs (comp = 'video' | 'graphic'):
//   smm.status(comp, status)            — set a status via the Sheet pill
//   smm.approve(comp, route)            — Review tab approve ('primary'|'alt')
//   smm.request(comp, text)             — Review tab "Request change"
//   smm.note(comp, text, audience)      — Notes modal note ('internal'|'client')
//   smm.markDone(comp)                  — Notes modal "Mark done" on a change-request
//   kasper.approve(comp)                — Kasper approve → Client
//   kasper.request(comp, text)          — Kasper "Request change" → Tweaks Needed
//   kasper.aat(comp, text)              — Kasper "Approve after tweaks" → For SMM
//   client.approve(comp)                — Client approve
//   client.request(comp, text)         — Client "Request change"
//   expect(field, value)               — assert a live-DB column equals value
//   expectComment(comp, {role,is_tweak})— assert last comment on a component thread
const L = require('./sxr_courier_lib.js');
const { smm, kasper, client, up, supa, poll } = L;

const LABEL = { video: 'video', graphic: 'graphic' };
const sleep = (p, ms) => p.waitForTimeout(ms);

// ---------- live-DB helpers ----------
function row(id, cols) { try { const r = supa('id=eq.' + id + '&select=' + (cols || '*')); return (Array.isArray(r) && r[0]) || null; } catch (e) { return null; } }
async function waitCol(id, col, val, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const r = row(id, col); if (r && String(r[col]) === String(val)) return true; await new Promise(s => setTimeout(s, 400)); }
  return false;
}
function lastComment(id, comp) { const r = row(id, comp + '_tweaks'); try { const a = JSON.parse((r && r[comp + '_tweaks']) || '[]'); return a[a.length - 1] || null; } catch { return null; } }

// ---------- tab manager ----------
class Actors {
  constructor(browser) { this.browser = browser; this._smm = null; this._kasper = null; this._client = null; }
  async smm() { if (!this._smm) this._smm = await smm(this.browser); return this._smm; }
  async kasper() { if (!this._kasper) this._kasper = await kasper(this.browser); return this._kasper; }
  async client() { if (!this._client) this._client = await client(this.browser); return this._client; }
  async closeAll() { for (const p of [this._smm, this._kasper, this._client]) { if (p) { try { await p.context().close(); } catch {} } } this._smm = this._kasper = this._client = null; }
}

// ---------- card finders (review/kasper/client key by NAME) ----------
const findReview = (name) => `[...document.querySelectorAll('.cal-review-card')].find(c=>(c.querySelector('.kcard-title')||{}).textContent===${JSON.stringify(name)})`;
const findKasper = (name) => `[...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(c=>(c.querySelector('.kcard-title')||{}).textContent===${JSON.stringify(name)})`;

// Idempotently ENSURE a card is expanded (showing its panels). Clicking the strip
// toggles, so a blind click on an already-open card collapses it and hides the
// panels — the cause of "no-panel"/"disabled" on a 2nd action in the same tab.
async function ensureExpanded(page, scope, name) {
  for (let i = 0; i < 5; i++) {
    const state = await page.evaluate((args) => {
      const [scope, n] = args;
      const c = [...document.querySelectorAll(scope + ' .cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
      if (!c) return 'no-card';
      return c.querySelector('.cal-review-panel') ? 'panel' : 'collapsed';
    }, [scope, name]);
    if (state === 'panel') return true;
    if (state === 'no-card') { await sleep(page, 500); continue; }
    await page.evaluate((args) => { const [scope, n] = args; const c = [...document.querySelectorAll(scope + ' .cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n); if (c) (c.querySelector('.kcard-strip') || c).click(); }, [scope, name]);
    await sleep(page, 450);
  }
  return false;
}
async function expandReview(page, name) { return ensureExpanded(page, '', name); }
async function expandKasper(page, name) { return ensureExpanded(page, '#kasperContent', name); }

// ---------- the verbs ----------
async function smmStatus(page, id, comp, status) {
  // ensure Sheet view + a FRESH load: the SMM tab can be stale after another actor
  // changed status elsewhere; without this, _sxrStatusPick's "already that status"
  // guard can no-op against a stale in-memory value (e.g. a client bounce the SMM
  // tab hasn't seen because the realtime WS isn't tunneled in the harness).
  await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); if (typeof loadSxrCards === 'function') loadSxrCards({ skipCache: true }); });
  await sleep(page, 1700);
  await page.waitForFunction((cid) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${cid}"]`), id, { timeout: 8000 }).catch(() => {});
  const res = await page.evaluate((args) => {
    const [cid, comp, status] = args;
    const wrap = document.querySelector(`[data-substatus-pid="${cid}"][data-substatus-comp="${comp}"]`);
    const trig = wrap && wrap.querySelector('.cal-fld-substatus-trigger'); if (!trig) return 'no-trigger';
    trig.click();
    const item = [...document.querySelectorAll('.cal-fld-status-menu .cal-fld-status-item')].find(i => new RegExp('^\\s*' + status + '\\s*$', 'i').test(i.textContent));
    if (!item) return 'no-item'; item.click(); return 'ok';
  }, [id, comp, status]);
  return res;
}
async function smmApprove(page, name, comp, route) {
  await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="smmreview"]'); if (b) b.click(); });
  await sleep(page, 1400);   // let any prior action's save+re-render settle before we expand
  await page.waitForFunction((n) => [...document.querySelectorAll('.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), name, { timeout: 8000 }).catch(() => {});
  await expandReview(page, name);
  return page.evaluate((args) => {
    const [n, comp, route] = args;
    const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
    const p = card && card.querySelector(`.cal-review-panel[data-comp="${comp}"]`); if (!p) return 'no-panel';
    const b = route === 'alt' ? p.querySelector('.cal-review-approve-alt') : p.querySelector('.cal-review-approve-main, .cal-review-approve-btn');
    if (!b || b.disabled) return 'disabled'; b.click(); return 'ok';
  }, [name, comp, route || 'primary']);
}
async function reviewTypeAndClick(page, name, comp, text, btnSel, finder) {
  await expandReview(page, name);
  await page.evaluate((args) => {
    const [n, comp, text] = args;
    const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
    const p = card && card.querySelector(`.cal-review-panel[data-comp="${comp}"]`); const ta = p && p.querySelector('.cal-review-textarea');
    if (ta) { const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, text); ta.dispatchEvent(new Event('input', { bubbles: true })); }
  }, [name, comp, text]);
  await sleep(page, 200);
  return page.evaluate((args) => {
    const [n, comp, btnSel] = args;
    const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
    const p = card && card.querySelector(`.cal-review-panel[data-comp="${comp}"]`); const b = p && p.querySelector(btnSel);
    if (!b || b.disabled) return 'disabled'; b.click(); return 'ok';
  }, [name, comp, btnSel]);
}
async function smmRequest(page, name, comp, text) {
  await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="smmreview"]'); if (b) b.click(); });
  await sleep(page, 1400);
  await page.waitForFunction((n) => [...document.querySelectorAll('.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), name, { timeout: 8000 }).catch(() => {});
  return reviewTypeAndClick(page, name, comp, text, '.cal-review-tweak-btn');
}
async function smmNote(page, id, comp, text, audience) {
  // Sheet → open notes on the card
  await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); });
  await page.waitForFunction((cid) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${cid}"]`), id, { timeout: 8000 }).catch(() => {});
  await page.evaluate((cid) => { const card = document.querySelector(`#sxrStrip .cal-card[data-pid="${cid}"]`); const b = card && card.querySelector('.cal-comments-btn, .cal-card-notes'); if (b) b.click(); }, id);
  await page.waitForFunction(() => { const o = document.getElementById('sxrCommentsOverlay'); return o && o.classList.contains('open'); }, { timeout: 6000 }).catch(() => {});
  return page.evaluate((args) => {
    const [comp, text, audience] = args;
    const compLabel = comp === 'graphic' ? 'Thumbnail' : 'Video';
    const cb = [...document.querySelectorAll('[data-cm-toggle="comp"] .cal-cm-aud-btn')].find(b => new RegExp(compLabel, 'i').test(b.textContent)); if (cb) cb.click();
    const audRe = audience === 'client' ? /Client/i : /Kasper|team|internal/i;
    const ab = [...document.querySelectorAll('[data-cm-toggle="audience"] .cal-cm-aud-btn')].find(b => audRe.test(b.textContent)); if (ab) ab.click();
    const ta = document.getElementById('sxrCommentComposer'); if (!ta) return 'no-ta';
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, text); ta.dispatchEvent(new Event('input', { bubbles: true }));
    const send = document.querySelector('#sxrCommentsOverlay .cal-cm-send') || document.querySelector('.cal-cm-send');
    if (!send || send.disabled) return 'disabled'; send.click(); return 'ok';
  }, [comp, text, audience || 'internal']);
}
async function smmMarkDone(page, id, comp) {
  await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); });
  await page.waitForFunction((cid) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${cid}"]`), id, { timeout: 8000 }).catch(() => {});
  await page.evaluate((cid) => { const card = document.querySelector(`#sxrStrip .cal-card[data-pid="${cid}"]`); const b = card && card.querySelector('.cal-comments-btn, .cal-card-notes'); if (b) b.click(); }, id);
  await page.waitForFunction(() => { const o = document.getElementById('sxrCommentsOverlay'); return o && o.classList.contains('open'); }, { timeout: 6000 }).catch(() => {});
  return page.evaluate(() => { const b = [...document.querySelectorAll('#sxrCommentsFeed .cal-cm-action')].find(x => /Mark done/i.test(x.textContent)); if (b) { b.click(); return 'ok'; } return 'no-markdone'; });
}
async function kasperAct(page, name, comp, kind, text) {
  // ensure on samples sub-tab + fresh queue
  await page.evaluate(() => { const b = document.querySelector('.kasper-subtab[data-kasper-tab="samples"]'); if (b) b.click(); if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(true); });
  await page.waitForFunction((n) => [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), name, { timeout: 12000 }).catch(() => {});
  await expandKasper(page, name);
  if (kind !== 'approve') {
    await page.evaluate((args) => { const [n, comp, text] = args; const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n); const p = card && card.querySelector(`.cal-review-panel[data-sxr-kasper-comp="${comp}"]`); const ta = p && p.querySelector('.cal-review-textarea'); if (ta) { const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, text); ta.dispatchEvent(new Event('input', { bubbles: true })); } }, [name, comp, text]);
    await sleep(page, 200);
  }
  const sel = kind === 'approve' ? '.cal-review-approve-main' : (kind === 'aat' ? '.cal-review-aat-btn' : '.cal-review-tweak-btn');
  return page.evaluate((args) => { const [n, comp, sel] = args; const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n); const p = card && card.querySelector(`.cal-review-panel[data-sxr-kasper-comp="${comp}"]`); const b = p && p.querySelector(sel); if (!b || b.disabled) return 'disabled'; b.click(); return 'ok'; }, [name, comp, sel]);
}
async function clientAct(page, name, comp, kind, text) {
  const sel = kind === 'request' ? '.cal-review-tweak-btn' : '.cal-review-approve-btn';
  // The client tab can be stale after another actor changed status in a different
  // tab; force a fresh load and retry so the card is reviewable before we act.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate(() => { if (typeof loadSxrCards === 'function') loadSxrCards({ skipCache: true }); });
    await sleep(page, 1700);
    await page.waitForFunction((n) => [...document.querySelectorAll('.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), name, { timeout: 12000 }).catch(() => {});
    await expandReview(page, name);
    if (kind === 'request') {
      await page.evaluate((args) => { const [n, comp, text] = args; const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n); const p = card && card.querySelector(`.cal-review-panel[data-comp="${comp}"]`); const ta = p && p.querySelector('.cal-review-textarea'); if (ta) { const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, text); ta.dispatchEvent(new Event('input', { bubbles: true })); } }, [name, comp, text]);
      await sleep(page, 200);
    }
    const res = await page.evaluate((args) => { const [n, comp, sel] = args; const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n); const p = card && card.querySelector(`.cal-review-panel[data-comp="${comp}"]`); const b = p && p.querySelector(sel); if (!b) return 'no-panel'; if (b.disabled) return 'disabled'; b.click(); return 'ok'; }, [name, comp, sel]);
    if (res === 'ok') return 'ok';
  }
  return 'disabled';
}

// ---------- the runner ----------
async function runScenario(browser, scn, shotDir, doShots) {
  const fs = require('fs');
  const id = scn.id, name = scn.name;
  const log = []; let nstep = 0; let okCount = 0, failCount = 0;
  const actors = new Actors(browser);
  const note = (pass, msg, extra) => { log.push({ pass, msg, extra }); if (pass) okCount++; else failCount++; };
  const shot = async (page, label) => { if (!doShots) return; try { fs.mkdirSync(shotDir, { recursive: true }); await page.screenshot({ path: `${shotDir}/${scn.key}-${String(++nstep).padStart(2, '0')}-${label}.png` }); } catch {} };

  // seed
  up(Object.assign({ id, name, order_index: 1, asset_url: 'https://frame.io/x/' + id, thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' }, scn.seed));
  await poll(() => { const r = supa('id=eq.' + id + '&select=id'); return r[0] || null; }, 12000, 600);

  try {
    for (const step of scn.steps) {
      const [verb, ...args] = step;
      let res = 'ok';
      if (verb === 'smm.status') { const p = await actors.smm(); res = await smmStatus(p, id, args[0], args[1]); await shot(p, 'smm-status'); }
      else if (verb === 'smm.approve') { const p = await actors.smm(); res = await smmApprove(p, name, args[0], args[1]); await shot(p, 'smm-approve'); }
      else if (verb === 'smm.request') { const p = await actors.smm(); res = await smmRequest(p, name, args[0], args[1]); await shot(p, 'smm-request'); }
      else if (verb === 'smm.note') { const p = await actors.smm(); res = await smmNote(p, id, args[0], args[1], args[2]); await shot(p, 'smm-note'); }
      else if (verb === 'smm.markDone') { const p = await actors.smm(); res = await smmMarkDone(p, id, args[0]); await shot(p, 'smm-markdone'); }
      else if (verb === 'kasper.approve') { const p = await actors.kasper(); res = await kasperAct(p, name, args[0], 'approve'); await shot(p, 'kasper-approve'); }
      else if (verb === 'kasper.request') { const p = await actors.kasper(); res = await kasperAct(p, name, args[0], 'request', args[1]); await shot(p, 'kasper-request'); }
      else if (verb === 'kasper.aat') { const p = await actors.kasper(); res = await kasperAct(p, name, args[0], 'aat', args[1]); await shot(p, 'kasper-aat'); }
      else if (verb === 'client.approve') { const p = await actors.client(); res = await clientAct(p, name, args[0], 'approve'); await shot(p, 'client-approve'); }
      else if (verb === 'client.request') { const p = await actors.client(); res = await clientAct(p, name, args[0], 'request', args[1]); await shot(p, 'client-request'); }
      else if (verb === 'expect') { const okk = await waitCol(id, args[0], args[1]); note(okk, `expect ${args[0]}=${args[1]}`, okk ? '' : 'got ' + (row(id, args[0]) || {})[args[0]]); continue; }
      else if (verb === 'expectComment') { const c = lastComment(id, args[0]); const want = args[1] || {}; const okk = !!c && (!want.role || c.role === want.role) && (want.is_tweak === undefined || c.is_tweak === want.is_tweak); note(okk, `expectComment ${args[0]} ${JSON.stringify(want)}`, c ? `role=${c.role} tweak=${c.is_tweak}` : 'none'); continue; }
      else { note(false, 'unknown verb ' + verb); continue; }
      if (res !== 'ok') note(false, `${verb}(${args.join(',')}) → ${res}`); else note(true, `${verb}(${args.join(',')})`);
    }
  } catch (e) { note(false, 'EXCEPTION: ' + (e.message || e)); }
  finally { await actors.closeAll(); try { L.archiveSafe(id); } catch {} }
  return { key: scn.key, name: scn.title || scn.name, ok: okCount, fail: failCount, log };
}

module.exports = { runScenario };
