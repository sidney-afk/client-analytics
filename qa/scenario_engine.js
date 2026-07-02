// scenario_engine.js — data-driven end-to-end scenarios across SMM / Kasper / Client.
// Each scenario is a list of STEPS; each step drives the real UI for one actor and
// is verified against the LIVE sample_reviews row. Actors map to browser tabs.
// Verbs (comp = 'video' | 'graphic'):
//   smm.status(comp, status)            — set a status via the Sheet pill
//   smm.approve(comp, route)            — Review tab approve ('primary'|'alt')
//   smm.request(comp, text)             — Review tab "Request change"
//   smm.note(comp, text, audience)      — Notes modal note ('internal'|'client')
//   smm.markDone(comp)                  — Notes modal "Mark done" on a change-request
//   smm.comment(comp, text)             — Review tab "Comment" (no status change)
//   smm.reply(comp, text)               — Notes modal: reply to the last root comment
//   smm.reopen(comp)                    — Notes modal: "Reopen" a done change-request
//   smm.deleteComment(comp)             — Notes modal: delete the last deletable comment (confirm)
//   smm.resolveVia(comp, dest)          — Notes modal: Mark done on the LAST open tweak →
//                                         resolve-destination chooser → dest
//                                         ('kasper'|'client'|'approved'|'stay')
//   kasper.approve(comp)                — Kasper approve → Client
//   kasper.request(comp, text)          — Kasper "Request change" → Tweaks Needed
//   kasper.aat(comp, text)              — Kasper "Approve after tweaks" → For SMM
//   kasper.comment(comp, text)          — Kasper "Comment" (internal-only, no status change)
//   kasper.undo()                       — click the post-approve toast's Undo action
//   kasper.finish()                     — card-level "Finish reviewing" (kcard-done-btn)
//   kasper.close()                      — card-level X close (kcard-close-btn)
//   client.approve(comp)                — Client approve
//   client.request(comp, text)         — Client "Request change"
//   client.comment(comp, text)         — Client "Comment" (no status change)
//   expect(field, value)               — assert a live-DB column equals value
//   expectComment(comp, {role,is_tweak,body,done,reply,deleted,audience,any})
//                                      — assert the last (or with any:true, some)
//                                        comment on a component thread
//   expectEvent(action, {component,to_status,from_status,role})
//                                      — assert a sample_review_events audit row exists
//   expectLinear(path, {includes:[],count}) — assert the MOCKED Linear capture recorded
//                                      a matching call this scenario (path e.g.
//                                      'linear-set-status'; includes matched against
//                                      the JSON payload; count = exact call count
//                                      for that path when given)
//   expectNoLinear(path)               — assert NO call for that path this scenario
//   expectClientThread(comp, {contains:[],notContains:[]})
//                                      — DOM assert on the CLIENT surface thread text
//   expectKasperCard(state)            — DOM assert on the Kasper queue:
//                                        'present'|'absent'|'finished'
const L = require('./sxr_courier_lib.js');
const { smm, kasper, client, up, supa, poll, appErrs, linearCalls, resetLinearCalls } = L;

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
function allComments(id, comp) { const r = row(id, comp + '_tweaks'); try { return JSON.parse((r && r[comp + '_tweaks']) || '[]') || []; } catch { return []; } }
// Match one comment against an expectComment matcher object.
function commentMatches(c, want) {
  if (!c) return false;
  if (want.role !== undefined && c.role !== want.role) return false;
  if (want.is_tweak !== undefined && c.is_tweak !== want.is_tweak) return false;
  if (want.body !== undefined && !String(c.body || '').includes(want.body)) return false;
  if (want.done !== undefined && !!c.done !== want.done) return false;
  if (want.reply !== undefined && !!c.parent_id !== want.reply) return false;
  if (want.deleted !== undefined && !!c.deleted !== want.deleted) return false;
  if (want.audience !== undefined && c.audience !== want.audience) return false;
  return true;
}
// Poll the audit trail for an event row matching {action, component, to_status, from_status, role}.
async function eventMatch(id, action, want, ms = 15000) {
  const w = want || {};
  const t = Date.now();
  while (Date.now() - t < ms) {
    let evs = [];
    try { evs = L.supaEvents('sample_id=eq.' + encodeURIComponent(id) + '&order=ts.desc&limit=50') || []; } catch {}
    const hit = (Array.isArray(evs) ? evs : []).find(e => e && e.action === action
      && (w.component === undefined || e.component === w.component)
      && (w.to_status === undefined || e.to_status === w.to_status)
      && (w.from_status === undefined || e.from_status === w.from_status)
      && (w.role === undefined || e.role === w.role));
    if (hit) return hit;
    await new Promise(s => setTimeout(s, 700));
  }
  return null;
}

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
    // Match by the RAW status in the onclick (`_sxrStatusPick('pid','<status>','comp')`)
    // first, because the menu LABEL can be personalised (e.g. "Client Approval" renders
    // as "<FirstName> Approval"); fall back to the visible text for older menus.
    const items = [...document.querySelectorAll('.cal-fld-status-menu .cal-fld-status-item')];
    const item = items.find(i => ((i.getAttribute('onclick') || '').includes("'" + status + "'")))
              || items.find(i => new RegExp('^\\s*' + status + '\\s*$', 'i').test(i.textContent));
    if (!item) return 'no-item'; item.click(); return 'ok';
  }, [id, comp, status]);
  return res;
}
async function smmApprove(page, name, comp, route) {
  await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="smmreview"]'); if (b) b.click(); });
  await sleep(page, 1400);   // let any prior action's save+re-render settle before we expand
  await page.waitForFunction((n) => [...document.querySelectorAll('.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), name, { timeout: 8000 }).catch(() => {});
  await expandReview(page, name);
  const res = await page.evaluate((args) => {
    const [n, comp, route] = args;
    const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
    const p = card && card.querySelector(`.cal-review-panel[data-comp="${comp}"]`); if (!p) return 'no-panel';
    const b = route === 'alt' ? p.querySelector('.cal-review-approve-alt') : p.querySelector('.cal-review-approve-main, .cal-review-approve-btn');
    if (!b || b.disabled) return 'disabled'; b.click(); return 'ok';
  }, [name, comp, route || 'primary']);
  if (res !== 'ok') return res;
  // Approving a component that still has an OPEN change-request opens the
  // resolve-destination chooser ("Tweaks resolved — where to next?"). Click
  // through it: route 'primary' → the recommended (filled .primary) destination,
  // which the chooser pre-selects to the smart default (fresh→Kasper, seen→Client);
  // route 'alt' → the other stage. If no chooser opened, the approve already went.
  await sleep(page, 500);
  await page.evaluate((route) => {
    const ov = document.getElementById('resolveDestOverlay');
    if (!ov || !ov.classList.contains('active')) return;
    const btns = [...ov.querySelectorAll('.resolve-dest-actions .brief-action-btn')];
    if (!btns.length) return;
    let target = btns.find(b => b.classList.contains('primary')) || btns[0];
    if (route === 'alt') { const other = btns.find(b => b !== target); if (other) target = other; }
    target.click();
  }, route || 'primary');
  return 'ok';
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
async function smmComment(page, name, comp, text) {
  await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="smmreview"]'); if (b) b.click(); });
  await sleep(page, 1400);
  await page.waitForFunction((n) => [...document.querySelectorAll('.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), name, { timeout: 8000 }).catch(() => {});
  return reviewTypeAndClick(page, name, comp, text, '.cal-review-comment-btn');
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
// Open the Notes modal for a card (Sheet view), optionally selecting the comp tab.
async function openNotesModal(page, id, comp) {
  await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); if (typeof loadSxrCards === 'function') loadSxrCards({ skipCache: true }); });
  await sleep(page, 1700);
  await page.waitForFunction((cid) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${cid}"]`), id, { timeout: 8000 }).catch(() => {});
  await page.evaluate((cid) => { const card = document.querySelector(`#sxrStrip .cal-card[data-pid="${cid}"]`); const b = card && card.querySelector('.cal-comments-btn, .cal-card-notes'); if (b) b.click(); }, id);
  const open = await page.waitForFunction(() => { const o = document.getElementById('sxrCommentsOverlay'); return o && o.classList.contains('open'); }, { timeout: 6000 }).then(() => true).catch(() => false);
  if (!open) return 'no-overlay';
  if (comp) {
    await page.evaluate((compLabel) => {
      const cb = [...document.querySelectorAll('[data-cm-toggle="comp"] .cal-cm-aud-btn')].find(b => new RegExp(compLabel, 'i').test(b.textContent)); if (cb) cb.click();
    }, comp === 'graphic' ? 'Thumbnail' : 'Video');
    await sleep(page, 400);
  }
  return 'ok';
}
async function smmMarkDone(page, id, comp) {
  const o = await openNotesModal(page, id, comp); if (o !== 'ok') return o;
  return page.evaluate(() => { const b = [...document.querySelectorAll('#sxrCommentsFeed .cal-cm-action')].find(x => /Mark done/i.test(x.textContent)); if (b) { b.click(); return 'ok'; } return 'no-markdone'; });
}
// Mark done on the LAST open change-request → the resolve-destination chooser
// opens (mark-done on the last open tweak defers to it) → pick a destination.
async function smmResolveVia(page, id, comp, dest) {
  const o = await openNotesModal(page, id, comp); if (o !== 'ok') return o;
  const clicked = await page.evaluate(() => { const b = [...document.querySelectorAll('#sxrCommentsFeed .cal-cm-action')].find(x => /Mark done/i.test(x.textContent)); if (b) { b.click(); return 'ok'; } return 'no-markdone'; });
  if (clicked !== 'ok') return clicked;
  const chooser = await page.waitForFunction(() => { const ov = document.getElementById('resolveDestOverlay'); return ov && ov.classList.contains('active'); }, { timeout: 6000 }).then(() => true).catch(() => false);
  if (!chooser) return 'no-chooser';
  return page.evaluate((dest) => {
    const idFor = { kasper: 'resolveDestKasper', client: 'resolveDestClient', approved: 'resolveDestApprove', stay: 'resolveDestStay' };
    const b = document.getElementById(idFor[dest] || '');
    if (!b) return 'no-dest'; if (b.disabled) return 'dest-disabled'; b.click(); return 'ok';
  }, dest);
}
async function smmReopen(page, id, comp) {
  const o = await openNotesModal(page, id, comp); if (o !== 'ok') return o;
  return page.evaluate(() => { const b = [...document.querySelectorAll('#sxrCommentsFeed .cal-cm-action')].find(x => /Reopen/i.test(x.textContent)); if (b) { b.click(); return 'ok'; } return 'no-reopen'; });
}
async function smmReply(page, id, comp, text) {
  const o = await openNotesModal(page, id, comp); if (o !== 'ok') return o;
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#sxrCommentsFeed .cal-cm-action')].filter(b => /Reply/i.test(b.textContent));
    const b = btns[btns.length - 1]; if (!b) return 'no-reply-btn'; b.click(); return 'ok';
  });
  if (clicked !== 'ok') return clicked;
  await sleep(page, 400);
  return page.evaluate((text) => {
    const ta = document.getElementById('sxrCommentComposer'); if (!ta) return 'no-ta';
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, text); ta.dispatchEvent(new Event('input', { bubbles: true }));
    const send = document.querySelector('#sxrCommentsOverlay .cal-cm-send') || document.querySelector('.cal-cm-send');
    if (!send || send.disabled) return 'disabled'; send.click(); return 'ok';
  }, text);
}
async function smmDeleteComment(page, id, comp) {
  const o = await openNotesModal(page, id, comp); if (o !== 'ok') return o;
  const clicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('#sxrCommentsFeed .cal-cm-action.is-danger')];
    const b = btns[btns.length - 1]; if (!b) return 'no-delete-btn'; b.click(); return 'ok';
  });
  if (clicked !== 'ok') return clicked;
  // The delete goes through the shared confirm dialog — accept it.
  const confirmed = await page.waitForFunction(() => { const ov = document.getElementById('confirmOverlay'); return ov && ov.classList.contains('active'); }, { timeout: 6000 }).then(() => true).catch(() => false);
  if (!confirmed) return 'no-confirm';
  return page.evaluate(() => {
    const b = document.querySelector('#confirmOverlay .brief-action-btn.primary')
      || [...document.querySelectorAll('#confirmOverlay .brief-action-btn')].find(x => /delete/i.test(x.textContent));
    if (!b) return 'no-confirm-btn'; b.click(); return 'ok';
  });
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
  const sel = kind === 'approve' ? '.cal-review-approve-main' : (kind === 'aat' ? '.cal-review-aat-btn' : (kind === 'comment' ? '.cal-review-comment-btn' : '.cal-review-tweak-btn'));
  return page.evaluate((args) => { const [n, comp, sel] = args; const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n); const p = card && card.querySelector(`.cal-review-panel[data-sxr-kasper-comp="${comp}"]`); const b = p && p.querySelector(sel); if (!b || b.disabled) return 'disabled'; b.click(); return 'ok'; }, [name, comp, sel]);
}
// Click the Undo action on the post-approve toast (6s window after a completing
// approve removes the card from the queue).
async function kasperUndo(page) {
  const seen = await page.waitForFunction(() => !!document.querySelector('.sv-toast-action'), { timeout: 9000 }).then(() => true).catch(() => false);
  if (!seen) return 'no-toast';
  return page.evaluate(() => { const b = document.querySelector('.sv-toast-action'); if (!b) return 'no-toast'; b.click(); return 'ok'; });
}
// Card-level Kasper queue actions: 'finish' (kcard-done-btn) or 'close' (kcard-close-btn).
async function kasperCardAction(page, name, which) {
  await page.evaluate(() => { const b = document.querySelector('.kasper-subtab[data-kasper-tab="samples"]'); if (b) b.click(); if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(true); });
  await page.waitForFunction((n) => [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), name, { timeout: 12000 }).catch(() => {});
  return page.evaluate((args) => {
    const [n, which] = args;
    const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
    if (!card) return 'no-card';
    const b = card.querySelector(which === 'finish' ? '.kcard-done-btn' : '.kcard-close-btn');
    if (!b) return 'no-btn'; if (b.disabled) return 'disabled'; b.click(); return 'ok';
  }, [name, which]);
}
// DOM assert on the Kasper queue: is the card present / absent / finished ("Sent to SMM")?
async function kasperCardState(page, name) {
  await page.evaluate(() => { const b = document.querySelector('.kasper-subtab[data-kasper-tab="samples"]'); if (b) b.click(); if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(true); });
  await sleep(page, 2500);
  return page.evaluate((n) => {
    const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === n);
    if (!card) return 'absent';
    const done = card.querySelector('.kcard-done-btn');
    if (done && done.disabled && /Sent to SMM/i.test(done.textContent)) return 'finished';
    return 'present';
  }, name);
}
// DOM assert on the CLIENT surface: the visible thread text for a component panel.
async function clientThreadText(page, name, comp) {
  await page.evaluate(() => { if (typeof loadSxrCards === 'function') loadSxrCards({ skipCache: true }); });
  await sleep(page, 1700);
  await page.waitForFunction((n) => [...document.querySelectorAll('.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), name, { timeout: 12000 }).catch(() => {});
  await expandReview(page, name);
  return page.evaluate((args) => {
    const [n, comp] = args;
    const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
    const p = card && card.querySelector(`.cal-review-panel[data-comp="${comp}"]`);
    if (!p) return '(no panel)';
    const t = p.querySelector('.cal-review-thread');
    return t ? (t.textContent || '') : '(no thread)';
  }, [name, comp]);
}
async function clientAct(page, name, comp, kind, text) {
  const sel = kind === 'request' ? '.cal-review-tweak-btn' : (kind === 'comment' ? '.cal-review-comment-btn' : '.cal-review-approve-btn');
  // The client tab can be stale after another actor changed status in a different
  // tab; force a fresh load and retry so the card is reviewable before we act.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.evaluate(() => { if (typeof loadSxrCards === 'function') loadSxrCards({ skipCache: true }); });
    await sleep(page, 1700);
    await page.waitForFunction((n) => [...document.querySelectorAll('.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), name, { timeout: 12000 }).catch(() => {});
    await expandReview(page, name);
    if (kind === 'request' || kind === 'comment') {
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

  // Fresh Linear capture per scenario (the runner is serial, so the JSONL file
  // is exclusively this scenario's traffic until we finish).
  try { resetLinearCalls(); } catch {}

  // seed — link BOTH components by default. A real sample in the pipeline carries
  // Linear sub-issues; without them the status pills are locked and an unlinked
  // thumbnail is gated out of the Kasper queue (the unlinked-thumbnail rule, same
  // on calendar + samples), so any flow using smm.status or routing the thumbnail
  // through Kasper would stall. A scenario can still override with '' to test the
  // unlinked case. (Linear is always mocked by the courier, so this never hits live.)
  up(Object.assign({ id, name, order_index: 1, asset_url: 'https://frame.io/x/' + id, thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', linear_issue_id: 'https://linear.app/x/VID-' + id.slice(-8), graphic_linear_issue_id: 'https://linear.app/x/GRA-' + id.slice(-8) }, scn.seed));
  await poll(() => { const r = supa('id=eq.' + id + '&select=id'); return r[0] || null; }, 12000, 600);

  try {
    for (const step of scn.steps) {
      const [verb, ...args] = step;
      let res = 'ok';
      if (verb === 'smm.status') { const p = await actors.smm(); res = await smmStatus(p, id, args[0], args[1]); await shot(p, 'smm-status'); }
      else if (verb === 'smm.approve') { const p = await actors.smm(); res = await smmApprove(p, name, args[0], args[1]); await shot(p, 'smm-approve'); }
      else if (verb === 'smm.request') { const p = await actors.smm(); res = await smmRequest(p, name, args[0], args[1]); await shot(p, 'smm-request'); }
      else if (verb === 'smm.comment') { const p = await actors.smm(); res = await smmComment(p, name, args[0], args[1]); await shot(p, 'smm-comment'); }
      else if (verb === 'smm.note') { const p = await actors.smm(); res = await smmNote(p, id, args[0], args[1], args[2]); await shot(p, 'smm-note'); }
      else if (verb === 'smm.markDone') { const p = await actors.smm(); res = await smmMarkDone(p, id, args[0]); await shot(p, 'smm-markdone'); }
      else if (verb === 'smm.resolveVia') { const p = await actors.smm(); res = await smmResolveVia(p, id, args[0], args[1]); await shot(p, 'smm-resolvevia'); }
      else if (verb === 'smm.reopen') { const p = await actors.smm(); res = await smmReopen(p, id, args[0]); await shot(p, 'smm-reopen'); }
      else if (verb === 'smm.reply') { const p = await actors.smm(); res = await smmReply(p, id, args[0], args[1]); await shot(p, 'smm-reply'); }
      else if (verb === 'smm.deleteComment') { const p = await actors.smm(); res = await smmDeleteComment(p, id, args[0]); await shot(p, 'smm-delete'); }
      else if (verb === 'kasper.approve') { const p = await actors.kasper(); res = await kasperAct(p, name, args[0], 'approve'); await shot(p, 'kasper-approve'); }
      else if (verb === 'kasper.request') { const p = await actors.kasper(); res = await kasperAct(p, name, args[0], 'request', args[1]); await shot(p, 'kasper-request'); }
      else if (verb === 'kasper.aat') { const p = await actors.kasper(); res = await kasperAct(p, name, args[0], 'aat', args[1]); await shot(p, 'kasper-aat'); }
      else if (verb === 'kasper.comment') { const p = await actors.kasper(); res = await kasperAct(p, name, args[0], 'comment', args[1]); await shot(p, 'kasper-comment'); }
      else if (verb === 'kasper.undo') { const p = await actors.kasper(); res = await kasperUndo(p); await shot(p, 'kasper-undo'); }
      else if (verb === 'kasper.finish') { const p = await actors.kasper(); res = await kasperCardAction(p, name, 'finish'); await shot(p, 'kasper-finish'); }
      else if (verb === 'kasper.close') { const p = await actors.kasper(); res = await kasperCardAction(p, name, 'close'); await shot(p, 'kasper-close'); }
      else if (verb === 'client.approve') { const p = await actors.client(); res = await clientAct(p, name, args[0], 'approve'); await shot(p, 'client-approve'); }
      else if (verb === 'client.request') { const p = await actors.client(); res = await clientAct(p, name, args[0], 'request', args[1]); await shot(p, 'client-request'); }
      else if (verb === 'client.comment') { const p = await actors.client(); res = await clientAct(p, name, args[0], 'comment', args[1]); await shot(p, 'client-comment'); }
      else if (verb === 'expect') { const okk = await waitCol(id, args[0], args[1]); note(okk, `expect ${args[0]}=${args[1]}`, okk ? '' : 'got ' + (row(id, args[0]) || {})[args[0]]); continue; }
      else if (verb === 'expectComment') {
        const want = args[1] || {};
        // Poll briefly: the comment write is async (save funnel), so the row can lag the click.
        let okk = false, c = null, list = [];
        const t0 = Date.now();
        while (Date.now() - t0 < 12000 && !okk) {
          list = allComments(id, args[0]); c = list[list.length - 1] || null;
          okk = want.any ? list.some(x => commentMatches(x, want)) : commentMatches(c, want);
          if (!okk) await new Promise(s => setTimeout(s, 600));
        }
        note(okk, `expectComment ${args[0]} ${JSON.stringify(want)}`, okk ? '' : (c ? `last: role=${c.role} tweak=${c.is_tweak} done=${!!c.done} reply=${!!c.parent_id} body=${String(c.body || '').slice(0, 40)}` : 'none'));
        continue;
      }
      else if (verb === 'expectEvent') { const ev = await eventMatch(id, args[0], args[1]); note(!!ev, `expectEvent ${args[0]} ${JSON.stringify(args[1] || {})}`, ev ? '' : 'no matching audit row'); continue; }
      else if (verb === 'expectLinear' || verb === 'expectNoLinear') {
        const want = args[1] || {};
        // Poll briefly: the FE pushes to Linear after the save resolves.
        let calls = [];
        const t0 = Date.now();
        const match = () => {
          calls = linearCalls().filter(c => c.path === args[0]);
          const hits = calls.filter(c => { const s = JSON.stringify(c.payload || {}); return (want.includes || []).every(x => s.includes(x)); });
          return want.count !== undefined ? hits.length === want.count : hits.length > 0;
        };
        if (verb === 'expectLinear') {
          let okk = false;
          while (Date.now() - t0 < 12000 && !(okk = match())) await new Promise(s => setTimeout(s, 600));
          note(okk, `expectLinear ${args[0]} ${JSON.stringify(want)}`, okk ? '' : `calls: ${JSON.stringify(calls.map(c => c.payload)).slice(0, 200)}`);
        } else {
          // give any wrong push a beat to land before asserting absence
          await new Promise(s => setTimeout(s, 4000));
          const hits = linearCalls().filter(c => c.path === args[0]);
          note(hits.length === 0, `expectNoLinear ${args[0]}`, hits.length ? `got ${hits.length}: ${JSON.stringify(hits.map(c => c.payload)).slice(0, 200)}` : '');
        }
        continue;
      }
      else if (verb === 'expectClientThread') {
        const p = await actors.client();
        const txt = await clientThreadText(p, name, args[0]);
        const want = args[1] || {};
        const missing = (want.contains || []).filter(s => !txt.includes(s));
        const leaked = (want.notContains || []).filter(s => txt.includes(s));
        note(missing.length === 0 && leaked.length === 0, `expectClientThread ${args[0]} ${JSON.stringify(want)}`,
          (missing.length ? 'missing: ' + missing.join(' | ') + ' ' : '') + (leaked.length ? 'LEAKED: ' + leaked.join(' | ') : '') + (missing.length || leaked.length ? ` [thread="${txt.slice(0, 120)}"]` : ''));
        await shot(p, 'client-thread');
        continue;
      }
      else if (verb === 'expectKasperCard') {
        const p = await actors.kasper();
        const state = await kasperCardState(p, name);
        note(state === args[0], `expectKasperCard ${args[0]}`, state === args[0] ? '' : 'got ' + state);
        await shot(p, 'kasper-queue');
        continue;
      }
      else { note(false, 'unknown verb ' + verb); continue; }
      if (res !== 'ok') note(false, `${verb}(${args.join(',')}) → ${res}`); else note(true, `${verb}(${args.join(',')})`);
    }
  } catch (e) { note(false, 'EXCEPTION: ' + (e.message || e)); }
  finally {
    // 0-JS-errors gate: any real app error on any actor tab fails the scenario
    // (appErrs already filters the expected courier/WebSocket noise).
    for (const [who, p] of [['smm', actors._smm], ['kasper', actors._kasper], ['client', actors._client]]) {
      if (!p) continue;
      try { const errs = appErrs(p) || []; if (errs.length) note(false, `appErrs(${who})`, errs.slice(0, 3).join(' | ').slice(0, 300)); } catch {}
    }
    await actors.closeAll(); try { L.archiveSafe(id); } catch {}
  }
  return { key: scn.key, name: scn.title || scn.name, ok: okCount, fail: failCount, log };
}

module.exports = { runScenario };
