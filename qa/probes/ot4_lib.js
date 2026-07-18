// ot4_lib.js — shared helpers for the RUN-4 overnight Tier-0/1 probes.
// Thin real-click drivers over the CLIENT share surfaces (samples + calendar),
// modeled on qa/scenario_engine.js but self-contained so each probe stays a
// small standalone script. Everything goes through REAL DOM clicks and typed
// text — no direct handler calls — because these probes certify the Tier-0
// client experience exactly as a client uses it.
'use strict';
const L = require('../sxr_courier_lib.js');

function counter() {
  const state = { ok: 0, fail: 0 };
  state.t = (pass, msg, extra) => {
    console.log(`${pass ? '✓' : '✗'}  ${msg}${extra ? '  [' + String(extra).slice(0, 160) + ']' : ''}`);
    pass ? state.ok++ : state.fail++;
  };
  return state;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---- DB read-back helpers ---------------------------------------------------
function rowSxr(id, cols) {
  try { const r = L.supa('id=eq.' + encodeURIComponent(id) + '&select=' + cols); return (Array.isArray(r) && r[0]) || null; } catch { return null; }
}
function rowCal(id, cols) {
  try { const r = L.supaCal('id=eq.' + encodeURIComponent(id) + '&select=' + cols); return (Array.isArray(r) && r[0]) || null; } catch { return null; }
}
async function pollRow(readFn, pred, ms = 20000, step = 900) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < ms) { last = readFn(); if (last && pred(last)) return last; await sleep(step); }
  return last;
}

// ---- real-click drivers (samples + calendar client share both render the
// shared .cal-review-card / .cal-review-panel markup) --------------------------
async function expandReview(page, name, scope) {
  const sc = scope || '';
  await page.waitForFunction((args) => {
    const [sc, n] = args;
    return [...document.querySelectorAll(sc + ' .cal-review-card, .cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n);
  }, [sc, name], { timeout: 15000 });
  const has = await page.evaluate((n) => {
    const c = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
    return !!(c && c.querySelector('.cal-review-panel'));
  }, name);
  if (!has) {
    await page.evaluate((n) => {
      const c = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
      if (c) (c.querySelector('.kcard-strip') || c).click();
    }, name);
    await sleep(500);
  }
}
// One client review action via REAL controls. kind: 'approve'|'request'|'comment'.
// Types `text` into the panel's textarea first for request/comment.
async function clientAct(page, name, comp, kind, text) {
  await expandReview(page, name);
  if (kind === 'request' || kind === 'comment') {
    const typed = await page.evaluate((args) => {
      const [n, comp, text] = args;
      const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
      const p = card && card.querySelector(`.cal-review-panel[data-comp="${comp}"]`);
      const ta = p && p.querySelector('.cal-review-textarea');
      if (!ta) return 'no-ta';
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      set.call(ta, text); ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    }, [name, comp, text || '']);
    if (typed !== 'ok') return typed;
    await sleep(250);
  }
  const sel = kind === 'request' ? '.cal-review-tweak-btn' : (kind === 'comment' ? '.cal-review-comment-btn' : '.cal-review-approve-btn');
  return page.evaluate((args) => {
    const [n, comp, sel] = args;
    const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
    const p = card && card.querySelector(`.cal-review-panel[data-comp="${comp}"]`);
    const b = p && p.querySelector(sel);
    if (!b) return 'no-btn';
    if (b.disabled) return 'disabled';
    b.click(); return 'ok';
  }, [name, comp, sel]);
}
// Snapshot of a panel's controls + thread, for gating/persistence asserts.
async function panelState(page, name, comp) {
  await expandReview(page, name);
  return page.evaluate((args) => {
    const [n, comp] = args;
    const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
    if (!card) return { card: false };
    const p = card.querySelector(`.cal-review-panel[data-comp="${comp}"]`);
    if (!p) return { card: true, panel: false, cardText: (card.textContent || '').slice(0, 400) };
    const q = (s) => p.querySelector(s);
    const en = (s) => { const b = q(s); return !!(b && !b.disabled); };
    return {
      card: true, panel: true,
      approve: !!q('.cal-review-approve-btn'), approveEnabled: en('.cal-review-approve-btn'),
      request: !!q('.cal-review-tweak-btn'), comment: !!q('.cal-review-comment-btn'),
      textarea: !!q('.cal-review-textarea'),
      thread: (q('.cal-review-thread') || { textContent: '' }).textContent,
      text: (p.textContent || '').slice(0, 500),
      error: (q('.cal-review-error') || { textContent: '' }).textContent
    };
  }, [name, comp]);
}

module.exports = Object.assign({ counter, sleep, rowSxr, rowCal, pollRow, expandReview, clientAct, panelState }, L);
