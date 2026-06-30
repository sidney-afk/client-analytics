// ============================================================================
// twin_live_lib.js — the LIVE half of the master tester.
//
// Drives the SAME scenario journey on BOTH the original calendar (source of
// truth, no ?sxr=1) and the samples rebuild (?sxr=1) against the LIVE backend,
// and after every step captures a NORMALIZED OBSERVABLE SNAPSHOT of the acting
// card on each surface (visible/enabled action labels, status + component-state
// labels, preview object-fit) PLUS the live DB row, then diffs samples-vs-cal.
//
// Where twin_render.js renders one component in isolation, this drives the
// whole multi-actor flow through the real UI, so it catches divergences that
// only appear MID-JOURNEY (e.g. what the Kasper card shows AFTER a request-
// change) and feature-level gaps (a card the calendar keeps in the Kasper queue
// that samples silently drops).
//
// Surface descriptors below capture every place the two surfaces differ
// (container ids, loader, notes overlay, Kasper sub-tab + card/panel attrs);
// the verbs and snapshot are otherwise generic because samples REUSES the
// calendar's .cal-*/.kcard-* classes for the shared surfaces.
// ============================================================================
const L = require('./sxr_courier_lib.js');

const COMP_LABEL = { video: 'Video', graphic: 'Thumbnail' };

// A surface descriptor carries Node-side functions (openSmm/seed/…) that CANNOT
// cross into page.evaluate (Playwright can't serialize functions). ser() returns
// the string-only subset the in-page callbacks actually read.
function ser(S) {
  return { key: S.key, strip: S.strip, view: S.view, loader: S.loader, notesOverlay: S.notesOverlay,
    kasperTab: S.kasperTab, kasperLoad: S.kasperLoad, kasperPidAttr: S.kasperPidAttr, kasperPanelComp: S.kasperPanelComp,
    statusFn: S.statusFn, realtimeFn: S.realtimeFn };
}

// ---- surface descriptors ----------------------------------------------------
const SXR = {
  key: 'sxr', label: 'samples',
  strip: 'sxrStrip', view: 'sxrView', loader: 'loadSxrCards',
  notesOverlay: 'sxrCommentsOverlay',
  kasperTab: 'samples', kasperLoad: '_sxrKasperLoadQueue',
  kasperPidAttr: 'data-sxr-kasper-pid', kasperPanelComp: 'data-sxr-kasper-comp',
  realtimeFn: '_sxrV2OnRealtimeChange', statusFn: 'sxrV2Status',
  openSmm: (b) => L.smm(b, 'sidneylaruel'),
  openKasper: (b) => L.kasper(b),
  openClient: (b) => L.client(b, 'Sidney Laruel'),
  seed: (s, base) => L.up(s, base),
  readRow: (id, cols) => { const r = L.supa('id=eq.' + id + '&select=' + (cols || '*')); return (Array.isArray(r) && r[0]) || null; },
  archive: (id) => L.archiveSafe(id),
};
const CAL = {
  key: 'cal', label: 'calendar',
  strip: 'calStrip', view: 'calView', loader: 'loadCalendarPosts',
  notesOverlay: 'calCommentsOverlay',
  kasperTab: 'review', kasperLoad: '_kasperLoadReview',
  kasperPidAttr: 'data-kasper-pid', kasperPanelComp: 'data-comp',
  realtimeFn: '_calV2OnRealtimeChange', statusFn: 'calV2Status',
  openSmm: (b) => L.smmCal(b, 'sidneylaruel'),
  openKasper: (b) => L.kasperCal(b),
  openClient: (b) => L.clientCal(b, 'Sidney Laruel'),
  seed: (s, base) => L.upCal(s, base),
  readRow: (id, cols) => { const r = L.supaCal('id=eq.' + id + '&select=' + (cols || '*')); return (Array.isArray(r) && r[0]) || null; },
  archive: (id) => L.archiveCalSafe(id),
};

// ---- intentional (by-design) registry — NOT bugs ----------------------------
// Standard is exact-clone; this list is deliberately small. Anything missing on
// samples that is NOT here is a real divergence.
const INTENTIONAL = [
  'Alt caption', 'Generate', 'Show more', 'Show less', 'Caption', 'Caption In Progress',
  'Caption Approval', 'For SMM Approval (Caption)',           // no caption/title component
  'Toggle client visibility', 'Toggle visibility',            // samples-only creative-direction eye
  'Scheduled', 'Posted', 'Schedule', 'Mark posted', 'Mark as posted', 'Add to calendar',
  'Month', 'Week',                                            // samples has no month/week grid
];
function isIntentional(label) {
  if (!label) return true;
  return INTENTIONAL.some(i => label === i || label.includes(i));
}

const sleep = (p, ms) => p.waitForTimeout(ms);

// ---- live-DB helpers --------------------------------------------------------
async function waitCol(surface, id, col, val, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const r = surface.readRow(id, col);
    if (r && String(r[col]) === String(val)) return true;
    await new Promise(s => setTimeout(s, 400));
  }
  return false;
}
function lastComment(surface, id, comp) {
  const r = surface.readRow(id, comp + '_tweaks');
  try { const a = JSON.parse((r && r[comp + '_tweaks']) || '[]'); return a[a.length - 1] || null; } catch { return null; }
}
function dbState(surface, id) {
  const r = surface.readRow(id, 'status,video_status,graphic_status,kasper_approved_after_tweaks');
  return r ? { status: r.status, video: r.video_status, graphic: r.graphic_status, aat: r.kasper_approved_after_tweaks || '' } : null;
}

// ---- the in-page normalized observable snapshot -----------------------------
// Locates the acting card on the live surface and returns its affordance/state
// snapshot. Returned shape is identical across surfaces so they can be diffed.
function _snapInPage(spec) {
  function pick(el) {
    let t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t) t = (el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    return t;
  }
  let root = null;
  if (spec.mode === 'sheet') {
    root = document.querySelector('#' + spec.strip + ' .cal-card[data-pid="' + spec.id + '"]');
  } else if (spec.mode === 'review') {
    root = [...document.querySelectorAll('.cal-review-card')].find(c => (((c.querySelector('.kcard-title') || {}).textContent) || '').trim() === spec.name);
  } else if (spec.mode === 'kasper') {
    root = [...document.querySelectorAll('#kasperContent [' + spec.kasperPidAttr + ']')].find(c => (((c.querySelector('.kcard-title') || {}).textContent) || '').trim() === spec.name);
  }
  if (!root) return { found: false };
  const actionEls = [...root.querySelectorAll('button, a[class*="btn"], a[class*="tile"], [role="button"]')];
  const actions = [...new Set(actionEls.map(pick).filter(t => t && t.length <= 44))];
  const disabled = [...new Set([...root.querySelectorAll('button[disabled]')].map(pick).filter(Boolean))];
  const stateSel = '.cal-review-panel-status,.cal-fld-substatus-label,.cal-review-mini-label,.kcard-pending,.cal-review-panel-title,.cal-ap-route,.kcard-comp-pill,.cal-review-resolved-pill,.kcard-newreply-chip,.kcard-done-btn';
  const stateLabels = [...new Set([...root.querySelectorAll(stateSel)].map(el => (el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
  const img = root.querySelector('img');
  const imgFit = img ? getComputedStyle(img).objectFit : null;
  return { found: true, actions, disabled, stateLabels, imgFit };
}
async function snap(page, spec) {
  try { return await page.evaluate(_snapInPage, spec); } catch (e) { return { found: false, err: String(e && e.message || e) }; }
}

// ---- diff two snapshots -----------------------------------------------------
// cal = source of truth, sxr = clone. Returns null if equivalent, else the diff.
function diffSnap(cal, sxr, mode) {
  if (!cal || !sxr) return null;
  if (cal.found !== sxr.found) {
    return { kind: 'presence', detail: (cal.found && !sxr.found)
      ? (mode === 'kasper' ? 'samples DROPPED the card from the Kasper queue; calendar KEEPS it' : 'card present on calendar, absent on samples')
      : 'card present on samples, absent on calendar' };
  }
  if (!cal.found) return null;   // both absent → equivalent
  const missing = cal.actions.filter(a => !sxr.actions.includes(a)).filter(a => !isIntentional(a));
  const extra = sxr.actions.filter(a => !cal.actions.includes(a)).filter(a => !isIntentional(a));
  const stMissing = cal.stateLabels.filter(s => !sxr.stateLabels.includes(s)).filter(s => !isIntentional(s));
  const stExtra = sxr.stateLabels.filter(s => !cal.stateLabels.includes(s)).filter(s => !isIntentional(s));
  const imgDiff = (cal.imgFit && sxr.imgFit && cal.imgFit !== sxr.imgFit) ? (cal.imgFit + ' vs ' + sxr.imgFit) : null;
  if (!missing.length && !extra.length && !stMissing.length && !stExtra.length && !imgDiff) return null;
  return { kind: 'snapshot', missing, extra, stMissing, stExtra, imgDiff, calActions: cal.actions, sxrActions: sxr.actions, calStates: cal.stateLabels, sxrStates: sxr.stateLabels };
}
function diffDb(cal, sxr) {
  if (!cal || !sxr) return null;
  const keys = ['status', 'video', 'graphic', 'aat'];
  const d = {};
  let any = false;
  for (const k of keys) { if (String(cal[k] || '') !== String(sxr[k] || '')) { d[k] = { cal: cal[k], sxr: sxr[k] }; any = true; } }
  return any ? d : null;
}

// ============================================================================
// VERBS — each takes (page, surface, ctx) where ctx carries id+name. They drive
// the real UI for one actor on one surface. Generic across cal/sxr.
// ============================================================================
async function vSmmStatus(page, S, id, comp, status) {
  await page.evaluate((s) => { const b = document.querySelector('#' + s.view + ' .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); if (typeof window[s.loader] === 'function') window[s.loader]({ skipCache: true }); }, ser(S));
  await sleep(page, 1700);
  await page.waitForFunction((a) => !!document.querySelector('#' + a.strip + ' .cal-card[data-pid="' + a.id + '"]'), { strip: S.strip, id }, { timeout: 9000 }).catch(() => {});
  return page.evaluate((a) => {
    const wrap = document.querySelector('[data-substatus-pid="' + a.id + '"][data-substatus-comp="' + a.comp + '"]');
    const trig = wrap && wrap.querySelector('.cal-fld-substatus-trigger'); if (!trig) return 'no-trigger';
    trig.click();
    const item = [...document.querySelectorAll('.cal-fld-status-menu .cal-fld-status-item')].find(i => new RegExp('^\\s*' + a.status.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i').test(i.textContent));
    if (!item) return 'no-item'; item.click(); return 'ok';
  }, { id, comp, status });
}
async function _ensureReviewExpanded(page, name) {
  for (let i = 0; i < 5; i++) {
    const st = await page.evaluate((n) => {
      const c = [...document.querySelectorAll('.cal-review-card')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === n);
      if (!c) return 'no-card';
      return c.querySelector('.cal-review-panel') ? 'panel' : 'collapsed';
    }, name);
    if (st === 'panel') return true;
    if (st === 'no-card') { await sleep(page, 500); continue; }
    await page.evaluate((n) => { const c = [...document.querySelectorAll('.cal-review-card')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === n); if (c) (c.querySelector('.kcard-strip') || c).click(); }, name);
    await sleep(page, 450);
  }
  return false;
}
async function vSmmApprove(page, S, name, comp, route) {
  await page.evaluate((s) => { const b = document.querySelector('#' + s.view + ' .cal-view-btn[data-cal-view="smmreview"]'); if (b) b.click(); }, ser(S));
  await sleep(page, 1400);
  await page.waitForFunction((n) => [...document.querySelectorAll('.cal-review-card')].some(c => (((c.querySelector('.kcard-title') || {}).textContent) || '').trim() === n), name, { timeout: 9000 }).catch(() => {});
  await _ensureReviewExpanded(page, name);
  return page.evaluate((a) => {
    const card = [...document.querySelectorAll('.cal-review-card')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === a.name);
    const p = card && card.querySelector('.cal-review-panel[data-comp="' + a.comp + '"]'); if (!p) return 'no-panel';
    const b = a.route === 'alt' ? p.querySelector('.cal-review-approve-alt') : p.querySelector('.cal-review-approve-main, .cal-review-approve-btn');
    if (!b || b.disabled) return 'disabled'; b.click(); return 'ok';
  }, { name, comp, route: route || 'primary' });
}
async function vSmmRequest(page, S, name, comp, text) {
  await page.evaluate((s) => { const b = document.querySelector('#' + s.view + ' .cal-view-btn[data-cal-view="smmreview"]'); if (b) b.click(); }, ser(S));
  await sleep(page, 1400);
  await page.waitForFunction((n) => [...document.querySelectorAll('.cal-review-card')].some(c => (((c.querySelector('.kcard-title') || {}).textContent) || '').trim() === n), name, { timeout: 9000 }).catch(() => {});
  await _ensureReviewExpanded(page, name);
  await page.evaluate((a) => {
    const card = [...document.querySelectorAll('.cal-review-card')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === a.name);
    const p = card && card.querySelector('.cal-review-panel[data-comp="' + a.comp + '"]'); const ta = p && p.querySelector('.cal-review-textarea');
    if (ta) { const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, a.text); ta.dispatchEvent(new Event('input', { bubbles: true })); }
  }, { name, comp, text });
  await sleep(page, 200);
  return page.evaluate((a) => {
    const card = [...document.querySelectorAll('.cal-review-card')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === a.name);
    const p = card && card.querySelector('.cal-review-panel[data-comp="' + a.comp + '"]'); const b = p && p.querySelector('.cal-review-tweak-btn');
    if (!b || b.disabled) return 'disabled'; b.click(); return 'ok';
  }, { name, comp });
}
async function _openNotes(page, S, id) {
  await page.evaluate((s) => { const b = document.querySelector('#' + s.view + ' .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); }, ser(S));
  await page.waitForFunction((a) => !!document.querySelector('#' + a.strip + ' .cal-card[data-pid="' + a.id + '"]'), { strip: S.strip, id }, { timeout: 9000 }).catch(() => {});
  await page.evaluate((a) => { const card = document.querySelector('#' + a.strip + ' .cal-card[data-pid="' + a.id + '"]'); const b = card && card.querySelector('.cal-comments-btn, .cal-card-notes'); if (b) b.click(); }, { strip: S.strip, id });
  await page.waitForFunction((ov) => { const o = document.getElementById(ov); return o && o.classList.contains('open'); }, S.notesOverlay, { timeout: 6000 }).catch(() => {});
}
async function vSmmNote(page, S, id, comp, text, audience) {
  await _openNotes(page, S, id);
  return page.evaluate((a) => {
    const compLabel = a.comp === 'graphic' ? 'Thumbnail' : 'Video';
    const cb = [...document.querySelectorAll('[data-cm-toggle="comp"] .cal-cm-aud-btn')].find(b => new RegExp(compLabel, 'i').test(b.textContent)); if (cb) cb.click();
    const audRe = a.audience === 'client' ? /Client/i : /Kasper|team|internal/i;
    const ab = [...document.querySelectorAll('[data-cm-toggle="audience"] .cal-cm-aud-btn')].find(b => audRe.test(b.textContent)); if (ab) ab.click();
    const ov = document.getElementById(a.overlay);
    const ta = ov && (ov.querySelector('textarea#sxrCommentComposer, textarea#calCommentComposer') || ov.querySelector('.cal-cm-composer textarea'));
    if (!ta) return 'no-ta';
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, a.text); ta.dispatchEvent(new Event('input', { bubbles: true }));
    const send = ov.querySelector('.cal-cm-send'); if (!send || send.disabled) return 'disabled'; send.click(); return 'ok';
  }, { comp, text, audience: audience || 'internal', overlay: S.notesOverlay });
}
async function vSmmMarkDone(page, S, id, comp) {
  await _openNotes(page, S, id);
  return page.evaluate((ov) => { const o = document.getElementById(ov); const b = [...(o ? o.querySelectorAll('.cal-cm-action') : [])].find(x => /Mark done/i.test(x.textContent)); if (b) { b.click(); return 'ok'; } return 'no-markdone'; }, S.notesOverlay);
}
async function _kasperGoto(page, S, name) {
  await page.evaluate((s) => { const b = document.querySelector('.kasper-subtab[data-kasper-tab="' + s.kasperTab + '"]'); if (b) b.click(); if (typeof window[s.kasperLoad] === 'function') window[s.kasperLoad](true); }, ser(S));
  await page.waitForFunction((a) => [...document.querySelectorAll('#kasperContent [' + a.pidAttr + ']')].some(c => (((c.querySelector('.kcard-title') || {}).textContent) || '').trim() === a.name), { pidAttr: S.kasperPidAttr, name }, { timeout: 14000 }).catch(() => {});
}
async function _ensureKasperExpanded(page, S, name) {
  for (let i = 0; i < 5; i++) {
    const st = await page.evaluate((a) => {
      const c = [...document.querySelectorAll('#kasperContent [' + a.pidAttr + ']')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === a.name);
      if (!c) return 'no-card';
      return c.querySelector('.cal-review-panel') ? 'panel' : 'collapsed';
    }, { pidAttr: S.kasperPidAttr, name });
    if (st === 'panel') return true;
    if (st === 'no-card') { await sleep(page, 500); continue; }
    await page.evaluate((a) => { const c = [...document.querySelectorAll('#kasperContent [' + a.pidAttr + ']')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === a.name); if (c) (c.querySelector('.kcard-strip') || c).click(); }, { pidAttr: S.kasperPidAttr, name });
    await sleep(page, 500);
  }
  return false;
}
async function vKasper(page, S, name, comp, kind, text) {
  await _kasperGoto(page, S, name);
  await _ensureKasperExpanded(page, S, name);
  if (kind !== 'approve') {
    await page.evaluate((a) => {
      const card = [...document.querySelectorAll('#kasperContent [' + a.pidAttr + ']')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === a.name);
      const p = card && card.querySelector('.cal-review-panel[' + a.panelComp + '="' + a.comp + '"]'); const ta = p && p.querySelector('.cal-review-textarea');
      if (ta) { const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, a.text); ta.dispatchEvent(new Event('input', { bubbles: true })); }
    }, { name, comp, text, pidAttr: S.kasperPidAttr, panelComp: S.kasperPanelComp });
    await sleep(page, 250);
  }
  const sel = kind === 'approve' ? '.cal-review-approve-main' : (kind === 'aat' ? '.cal-review-aat-btn' : '.cal-review-tweak-btn');
  return page.evaluate((a) => {
    const card = [...document.querySelectorAll('#kasperContent [' + a.pidAttr + ']')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === a.name);
    const p = card && card.querySelector('.cal-review-panel[' + a.panelComp + '="' + a.comp + '"]'); const b = p && p.querySelector(a.sel);
    if (!b || b.disabled) return 'disabled'; b.click(); return 'ok';
  }, { name, comp, sel, pidAttr: S.kasperPidAttr, panelComp: S.kasperPanelComp });
}
async function vClient(page, S, name, comp, kind, text) {
  const sel = kind === 'request' ? '.cal-review-tweak-btn' : '.cal-review-approve-btn';
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate((s) => { if (typeof window[s.loader] === 'function') window[s.loader]({ skipCache: true }); }, ser(S));
    await sleep(page, 1700);
    await page.waitForFunction((n) => [...document.querySelectorAll('.cal-review-card')].some(c => (((c.querySelector('.kcard-title') || {}).textContent) || '').trim() === n), name, { timeout: 12000 }).catch(() => {});
    await _ensureReviewExpanded(page, name);
    if (kind === 'request') {
      await page.evaluate((a) => {
        const card = [...document.querySelectorAll('.cal-review-card')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === a.name);
        const p = card && card.querySelector('.cal-review-panel[data-comp="' + a.comp + '"]'); const ta = p && p.querySelector('.cal-review-textarea');
        if (ta) { const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, a.text); ta.dispatchEvent(new Event('input', { bubbles: true })); }
      }, { name, comp, text });
      await sleep(page, 200);
    }
    const res = await page.evaluate((a) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(x => (((x.querySelector('.kcard-title') || {}).textContent) || '').trim() === a.name);
      const p = card && card.querySelector('.cal-review-panel[data-comp="' + a.comp + '"]'); const b = p && p.querySelector(a.sel);
      if (!b) return 'no-panel'; if (b.disabled) return 'disabled'; b.click(); return 'ok';
    }, { name, comp, sel });
    if (res === 'ok') return 'ok';
  }
  return 'disabled';
}

// snapshot specs for the current acting actor's region
function specFor(actor, S, id, name) {
  if (actor === 'kasper') return { mode: 'kasper', kasperPidAttr: S.kasperPidAttr, name };
  // smm.note/markDone & smm.status act on the Sheet; smm.approve/request & client act on review cards.
  // We snapshot BOTH the sheet card and the review card so we never miss a region.
  return null;
}

module.exports = {
  SXR, CAL, COMP_LABEL, INTENTIONAL, isIntentional, ser,
  waitCol, lastComment, dbState, snap, diffSnap, diffDb, _snapInPage,
  vSmmStatus, vSmmApprove, vSmmRequest, vSmmNote, vSmmMarkDone, vKasper, vClient,
  _ensureReviewExpanded, _ensureKasperExpanded, _kasperGoto, sleep,
};
