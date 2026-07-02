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
  if (want.round !== undefined && Number(c.round) !== want.round) return false;
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
// CREATE VIA THE REAL UI — clicks the Sheet "+" button, types into the blank
// card's name field, and blurs (the exact human flow). This is the path the
// GA day-1 ghost-card bug lived on (addSxrBlankCard's optimistic state push +
// _sxrFlushCardSave's findIndex(realId) miss = the same card painted twice in
// the creating window). No seeded-id shortcut can cover it: the blank→promote
// funnel only runs when the card is born in the DOM.
async function smmCreateCard(page, cardName) {
  await page.evaluate(() => { const b = document.querySelector('#sxrView .cal-view-btn[data-cal-view="organizer"]'); if (b) b.click(); if (typeof loadSxrCards === 'function') loadSxrCards({ skipCache: true }); });
  await sleep(page, 1700);
  const clicked = await page.evaluate(() => {
    const add = document.querySelector('#sxrStrip .cal-card-add');
    if (!add) return 'no-add-btn';
    add.click(); return 'ok';
  });
  if (clicked !== 'ok') return clicked;
  await sleep(page, 500);
  return page.evaluate((nm) => {
    const blanks = [...document.querySelectorAll('#sxrStrip .cal-card[data-pid^="__sxrblank__"]')];
    const card = blanks[blanks.length - 1];
    if (!card) return 'no-blank-card';
    const inp = card.querySelector('.cal-fld-name');
    if (!inp) return 'no-name-field';
    inp.focus();
    inp.value = nm;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.blur();                       // fires the inline onblur → _sxrFlushCardSave (blank→promote→save)
    return 'ok';
  }, cardName);
}

// Rename a card by its CURRENT visible name — used right after smm.createCard
// to race a second edit against the first save (the blank→real promote window).
async function smmRenameCard(page, fromName, toName) {
  return page.evaluate((args) => {
    const [from, to] = args;
    const strip = document.getElementById('sxrStrip');
    if (!strip) return 'no-strip';
    const card = [...strip.querySelectorAll('.cal-card[data-pid]')].find(c => { const i = c.querySelector('.cal-fld-name'); return i && i.value === from; });
    if (!card) return 'no-card';
    const inp = card.querySelector('.cal-fld-name');
    inp.focus();
    inp.value = to;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.blur();
    return 'ok';
  }, [fromName, toName]);
}

// Archive a card by its visible NAME through the real UI (X button → confirm
// dialog). Used immediately after smm.createCard to race the archive against
// the in-flight create save — _sxrArchiveOne must await the save, and neither
// a local twin nor an orphaned live DB row may survive.
async function smmArchiveCard(page, cardName) {
  const clicked = await page.evaluate((nm) => {
    const strip = document.getElementById('sxrStrip');
    if (!strip) return 'no-strip';
    const card = [...strip.querySelectorAll('.cal-card[data-pid]')].find(c => { const i = c.querySelector('.cal-fld-name'); return i && i.value === nm; });
    if (!card) return 'no-card';
    const del = card.querySelector('.cal-card-del');
    if (!del) return 'no-del-btn';
    del.click(); return 'ok';
  }, cardName);
  if (clicked !== 'ok') return clicked;
  const confirmed = await page.waitForFunction(() => { const ov = document.getElementById('confirmOverlay'); return ov && ov.classList.contains('active'); }, { timeout: 6000 }).then(() => true).catch(() => false);
  if (!confirmed) return 'no-confirm';
  return page.evaluate(() => {
    const b = document.querySelector('#confirmOverlay .brief-action-btn.primary');
    if (!b) return 'no-confirm-btn'; b.click(); return 'ok';
  });
}

// Move a card (by name) to the FRONT of the strip and fire the strip's real
// drop handler — the exact persistence funnel a human drag lands in
// (_sxrWireStrip's drop → slot recycling → _sxrPersistReorder). HTML5
// drag events can't be fully synthesized headless, but the drop handler only
// reads the resulting DOM order, so a DOM move + drop dispatch exercises the
// entire optimistic-reorder + persist + guard path.
async function smmDragToFront(page, cardName) {
  return page.evaluate((nm) => {
    const strip = document.getElementById('sxrStrip');
    if (!strip) return 'no-strip';
    const cards = [...strip.querySelectorAll('.cal-card[draggable="true"]')];
    const card = cards.find(c => { const i = c.querySelector('.cal-fld-name'); return i && i.value === nm; });
    if (!card) return 'no-card';
    const first = cards[0];
    if (!first || first === card) return 'already-first';
    strip.insertBefore(card, first);
    strip.dispatchEvent(new Event('drop'));
    return 'ok';
  }, cardName);
}

// Full page reload (the "does it survive a refresh" gate) — everything
// optimistic is gone; only server truth + cache remain.
async function smmReloadPage(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('#sxrStrip .cal-card-add'), { timeout: 20000 }).catch(() => {});
  await page.evaluate(() => { if (typeof loadSxrCards === 'function') loadSxrCards({ skipCache: true }); });
  await sleep(page, 2000);
  return 'ok';
}

// Trigger a BACKGROUND server reload in the SMM tab — the _sxrMergeServerRows
// path (the local-only-card keep branch at ~28039). Paired with an api-seeded
// row this simulates "a realtime update from another session lands while my
// create is in flight" without a tunneled WebSocket.
async function smmBgReload(page) {
  await page.evaluate(() => { if (typeof loadSxrCards === 'function') loadSxrCards({ background: true, skipCache: true }); });
  await sleep(page, 2500);
  return 'ok';
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
// Always start from a CLOSED overlay: a prior verb (e.g. resolveVia's chooser)
// can leave the modal open with a stale feed; a fresh open re-renders from
// current state.
async function openNotesModal(page, id, comp) {
  await page.evaluate(() => {
    const o = document.getElementById('sxrCommentsOverlay');
    if (o && o.classList.contains('open') && typeof closeSxrComments === 'function') closeSxrComments();
  });
  await sleep(page, 400);
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
  // Resolved threads live behind the "Show resolved" history toggle — switch
  // to the Resolved view before looking for the Reopen action.
  const hist = await page.evaluate(() => {
    const b = document.querySelector('#sxrCommentsOverlay .cal-comments-hist');
    if (!b) return 'no-hist-btn';
    if (!b.classList.contains('is-active')) b.click();
    return 'ok';
  });
  if (hist !== 'ok') return hist;
  await sleep(page, 400);
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
// The Kasper queue is a CROSS-CLIENT fetch whose background reload can lag several
// seconds under the courier; when a `want` is given, poll (reloading each round)
// until the queue settles on it before returning — otherwise a single early read
// flakes present/absent right after a status change or a note.
async function kasperCardState(page, name, want) {
  const readOnce = async () => {
    await page.evaluate(() => { const b = document.querySelector('.kasper-subtab[data-kasper-tab="samples"]'); if (b) b.click(); if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(true); });
    await sleep(page, 2500);
    return page.evaluate((n) => {
      const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === n);
      if (!card) return 'absent';
      const done = card.querySelector('.kcard-done-btn');
      if (done && done.disabled && /Sent to SMM/i.test(done.textContent)) return 'finished';
      return 'present';
    }, name);
  };
  let state = await readOnce();
  if (want === undefined) return state;
  for (let i = 0; i < 12 && state !== want; i++) state = await readOnce();
  return state;
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

// ---------- THE GENERIC STATE-vs-DB DIVERGENCE GATE ----------
// The ghost-card bug class, generalized: OPTIMISTIC LOCAL STATE diverging from
// SERVER truth during real UI interaction. After a scenario finishes, every
// actor tab with the SXR surface loaded must agree with the live sample_reviews
// rows on (a) the id SET, (b) each row's NAME, (c) the relative ORDER — once
// all saves have settled. Wired into the runner's teardown so EVERY scenario
// gets it for free: any future bug in this class trips the suite no matter
// which scenario exposes it (the ghost card would have tripped it as
// 'local has 2 entries, DB has 1'). Opt out per scenario with noDivergenceGate.
// Rows the app is HONESTLY flagging as failed ('Save failed · Retry') are
// excluded — that divergence is by design and visible to the user (free-text
// edits are intentionally kept locally on a failed save).
async function divergenceGate(who, page, note) {
  let st = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {                       // wait for saves to settle
    st = await page.evaluate(() => {
      if (typeof sxrState === 'undefined' || !sxrState || !Array.isArray(sxrState.posts)) return null;
      const pend = (typeof _sxrPendingEdits !== 'undefined') ? Object.keys(_sxrPendingEdits).length : 0;
      const inflight = (typeof _sxrSaveInFlight !== 'undefined') ? Object.keys(_sxrSaveInFlight).length : 0;
      const reordering = (typeof _sxrReorderInFlight !== 'undefined' && _sxrReorderInFlight)
                      || (typeof _sxrReorderPending !== 'undefined' && !!_sxrReorderPending);
      const posts = sxrState.posts
        .filter(p => p && !(typeof _sxrIsBlankId === 'function' && _sxrIsBlankId(p.id)))
        .map(p => ({ id: p.id, name: String(p.name || ''), order: Number(p.order_index || 0),
                     failed: !!p._saveError || (typeof _sxrFailedNewCards !== 'undefined' && _sxrFailedNewCards.has(p.id)) }));
      // A stale optimistic blank STILL holding content after all saves settled is
      // the exact ghost-card shape (the pre-#649 bug left the __sxrblank__ twin
      // in state forever). An EMPTY blank is fine — that's just an untouched "+".
      const staleBlanks = sxrState.posts
        .filter(p => p && typeof _sxrIsBlankId === 'function' && _sxrIsBlankId(p.id))
        .filter(p => ['name', 'creative_direction', 'asset_url', 'thumbnail_url'].some(k => String(p[k] || '').trim() !== ''))
        .map(p => p.id + '"' + String(p.name || '') + '"');
      return { settled: pend === 0 && inflight === 0 && !reordering,
               posts, staleBlanks, slug: (typeof sxrClientSlug === 'function') ? sxrClientSlug(sxrState.client) : '' };
    }).catch(() => null);
    if (!st || st.settled) break;
    await new Promise(s => setTimeout(s, 700));
  }
  if (!st) return;                                        // SXR surface not mounted in this tab — nothing to gate
  if (st.slug !== 'sidneylaruel') return;                 // safety: only ever judge the test client
  if (!st.settled) { note(false, `divergenceGate(${who})`, 'saves never settled within 25s'); return; }
  let rows = null;
  try { rows = supa('client=eq.sidneylaruel&or=(status.neq.Archived,status.is.null)&select=id,name,order_index'); } catch {}
  if (!Array.isArray(rows)) { note(false, `divergenceGate(${who})`, 'DB read failed'); return; }
  const local = st.posts.filter(p => !p.failed);
  const failedNote = st.posts.length !== local.length ? ` (${st.posts.length - local.length} save-failed row(s) excluded)` : '';
  const dbById = new Map(rows.map(r => [r.id, r]));
  const locById = new Map(local.map(p => [p.id, p]));
  const extraLocal = local.filter(p => !dbById.has(p.id)).map(p => `${p.id}"${p.name}"`);
  const extraDb = rows.filter(r => !locById.has(r.id)).map(r => `${r.id}"${r.name}"`);
  const dupLocal = local.length !== locById.size;         // same id twice in state = the ghost shape
  const nameMismatch = [];
  for (const p of local) { const r = dbById.get(p.id); if (r && String(r.name || '') !== p.name) nameMismatch.push(`${p.id} local="${p.name}" db="${r.name || ''}"`); }
  const shared = local.filter(p => dbById.has(p.id));
  const seq = (arr, ord) => arr.slice().sort((a, b) => (ord(a) - ord(b)) || String(a.id).localeCompare(String(b.id))).map(x => x.id).join(',');
  const localSeq = seq(shared, p => p.order);
  const dbSeq = seq(shared.map(p => dbById.get(p.id)), r => Number(r.order_index || 0));
  const orderMismatch = localSeq !== dbSeq;
  const staleBlanks = st.staleBlanks || [];
  const ok = !extraLocal.length && !extraDb.length && !dupLocal && !nameMismatch.length && !orderMismatch && !staleBlanks.length;
  note(ok, `divergenceGate(${who}) — local state ≡ DB (${local.length} rows)${failedNote}`,
    ok ? '' : [
      dupLocal ? 'DUPLICATE id in local state' : '',
      staleBlanks.length ? 'STALE BLANK with content (ghost shape): ' + staleBlanks.join(' ') : '',
      extraLocal.length ? 'local-only: ' + extraLocal.join(' ') : '',
      extraDb.length ? 'db-only: ' + extraDb.join(' ') : '',
      nameMismatch.length ? 'name: ' + nameMismatch.join(' ') : '',
      orderMismatch ? `order: local=[${localSeq}] db=[${dbSeq}]` : '',
    ].filter(Boolean).join(' · ').slice(0, 400));
}

// ---------- the runner ----------
async function runScenario(browser, scn, shotDir, doShots) {
  const fs = require('fs');
  const id = scn.id, name = scn.name;
  const log = []; let nstep = 0; let okCount = 0, failCount = 0;
  const actors = new Actors(browser);
  const extraIds = new Set();   // rows minted BY THE UI during this scenario (no seeded id) — archived in finally
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
  // A `noSeed: true` scenario skips seeding entirely — used by the create-via-UI
  // scenarios, whose whole point is that the row is born in the browser.
  if (!scn.noSeed) {
    up(Object.assign({ id, name, order_index: 1, asset_url: 'https://frame.io/x/' + id, thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', linear_issue_id: 'https://linear.app/x/VID-' + id.slice(-8), graphic_linear_issue_id: 'https://linear.app/x/GRA-' + id.slice(-8) }, scn.seed));
    await poll(() => { const r = supa('id=eq.' + id + '&select=id'); return r[0] || null; }, 12000, 600);
  }

  try {
    for (const step of scn.steps) {
      const [verb, ...args] = step;
      let res = 'ok';
      if (verb === 'smm.status') { const p = await actors.smm(); res = await smmStatus(p, id, args[0], args[1]); await shot(p, 'smm-status'); }
      else if (verb === 'smm.createCard') { const p = await actors.smm(); res = await smmCreateCard(p, args[0]); await shot(p, 'smm-create'); }
      else if (verb === 'smm.renameCard') { const p = await actors.smm(); res = await smmRenameCard(p, args[0], args[1]); await shot(p, 'smm-rename'); }
      else if (verb === 'smm.archiveCard') { const p = await actors.smm(); res = await smmArchiveCard(p, args[0]); await shot(p, 'smm-archive'); }
      else if (verb === 'smm.dragToFront') { const p = await actors.smm(); res = await smmDragToFront(p, args[0]); await shot(p, 'smm-drag'); }
      else if (verb === 'smm.reload') { const p = await actors.smm(); res = await smmReloadPage(p); await shot(p, 'smm-reload'); }
      else if (verb === 'smm.bgReload') { const p = await actors.smm(); res = await smmBgReload(p); await shot(p, 'smm-bgreload'); }
      else if (verb === 'api.seedRow') {
        // Seed an EXTRA row via the API mid-scenario — "another session created
        // a row while I was working". A following smm.bgReload merges it in
        // through _sxrMergeServerRows. Registered for teardown archive.
        const xid = 'sr_scn_x_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        extraIds.add(xid);
        // Carry an explicit status: a bare row would land with status NULL, which
        // PostgREST's `status=neq.Archived` silently EXCLUDES (null != comparison)
        // while the app's GET still loads it — a harness-side blind spot found
        // when this verb was first run.
        try { up({ id: xid, name: args[0] || ('XSESSION ' + xid), order_index: 999, video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' }); res = 'ok'; }
        catch (e) { res = 'seed-failed: ' + (e.message || e); }
        await poll(() => { const r = supa('id=eq.' + xid + '&select=id'); return r[0] || null; }, 12000, 600);
      }
      else if (verb === 'wait') { const p = await actors.smm(); await sleep(p, Number(args[0]) || 1000); }
      else if (verb === 'expectCardGone') {
        // Inverse of expectCardOnce: ZERO cards with this name in the DOM
        // (including blanks) and ZERO live DB rows. The archive-during-create
        // race must not leave either a local twin or an orphaned server row.
        const wantName = args[0];
        const p = await actors.smm();
        let dom = null, rows = [];
        const t0 = Date.now();
        while (Date.now() - t0 < 20000) {
          dom = await p.evaluate((nm) => {
            const strip = document.getElementById('sxrStrip');
            if (!strip) return { cards: -1 };
            const named = [...strip.querySelectorAll('.cal-card[data-pid]')].filter(c => { const i = c.querySelector('.cal-fld-name'); return i && i.value === nm; });
            return { cards: named.length, pids: named.map(c => c.getAttribute('data-pid')) };
          }, wantName);
          try { rows = supa('client=eq.sidneylaruel&name=eq.' + encodeURIComponent(wantName) + '&or=(status.neq.Archived,status.is.null)&select=id,name') || []; } catch { rows = []; }
          (Array.isArray(rows) ? rows : []).forEach(r => extraIds.add(r.id));   // register strays for cleanup even on fail
          if (dom.cards === 0 && Array.isArray(rows) && rows.length === 0) break;
          await new Promise(s => setTimeout(s, 700));
        }
        const okk = dom && dom.cards === 0 && Array.isArray(rows) && rows.length === 0;
        note(okk, `expectCardGone "${wantName}"`, okk ? '' : `DOM cards=${dom && dom.cards} pids=${JSON.stringify(dom && dom.pids)} · DB rows=${Array.isArray(rows) ? rows.length : 'err'}`);
        await shot(p, 'card-gone');
        continue;
      }
      else if (verb === 'expectFirstCard') {
        // Assert the FIRST draggable card in the strip is this name AND the DB
        // order agrees (this row holds the smallest live order_index) — the
        // reorder-persistence gate after smm.dragToFront (+ optional reload).
        const wantName = args[0];
        const p = await actors.smm();
        let okDom = false, first = '', okDb = false, dbFirst = '';
        const t0 = Date.now();
        while (Date.now() - t0 < 20000) {
          first = await p.evaluate(() => {
            const c = document.querySelector('#sxrStrip .cal-card[draggable="true"]');
            const i = c && c.querySelector('.cal-fld-name');
            return i ? i.value : '(none)';
          });
          okDom = first === wantName;
          let rows = [];
          try { rows = supa('client=eq.sidneylaruel&or=(status.neq.Archived,status.is.null)&select=id,name,order_index&order=order_index.asc&limit=1') || []; } catch {}
          dbFirst = rows[0] ? rows[0].name : '(none)';
          okDb = rows.length > 0 && dbFirst === wantName;
          if (okDom && okDb) break;
          await new Promise(s => setTimeout(s, 700));
        }
        note(okDom && okDb, `expectFirstCard "${wantName}"`, (okDom && okDb) ? '' : `DOM first="${first}" · DB first="${dbFirst}"`);
        await shot(p, 'first-card');
        continue;
      }
      else if (verb === 'expectCardOnce') {
        // The ghost-card gate. Waits for the save to settle, then asserts:
        //   DOM  — exactly ONE .cal-card whose name field carries this name,
        //          and ZERO leftover __sxrblank__ cards holding it;
        //   DB   — exactly ONE live sample_reviews row with this name.
        // Registers the minted row for cleanup. Fails loud on 0 or 2+.
        const wantName = args[0];
        const p = await actors.smm();
        let dom = null;
        const t0 = Date.now();
        while (Date.now() - t0 < 15000) {
          dom = await p.evaluate((nm) => {
            const strip = document.getElementById('sxrStrip');
            if (!strip) return { cards: -1, blanks: -1, saving: 0 };
            const all = [...strip.querySelectorAll('.cal-card[data-pid]')];
            const named = all.filter(c => { const i = c.querySelector('.cal-fld-name'); return i && i.value === nm; });
            return {
              cards: named.length,
              blanks: named.filter(c => (c.getAttribute('data-pid') || '').startsWith('__sxrblank__')).length,
              saving: named.filter(c => c.classList.contains('is-saving')).length,
              pids: named.map(c => c.getAttribute('data-pid')),
            };
          }, wantName);
          if (dom.cards >= 1 && dom.saving === 0) break;
          await new Promise(s => setTimeout(s, 600));
        }
        let rows = [];
        try { rows = supa('client=eq.sidneylaruel&name=eq.' + encodeURIComponent(wantName) + '&or=(status.neq.Archived,status.is.null)&select=id,name') || []; } catch {}
        (Array.isArray(rows) ? rows : []).forEach(r => extraIds.add(r.id));
        (dom && dom.pids || []).filter(x => x && !x.startsWith('__sxrblank__')).forEach(x => extraIds.add(x));
        const okDom = dom && dom.cards === 1 && dom.blanks === 0;
        const okDb = Array.isArray(rows) && rows.length === 1;
        note(okDom && okDb, `expectCardOnce "${wantName}"`,
          (okDom && okDb) ? '' : `DOM cards=${dom && dom.cards} blanks=${dom && dom.blanks} pids=${JSON.stringify(dom && dom.pids)} · DB rows=${Array.isArray(rows) ? rows.length : 'err'}`);
        await shot(p, 'card-once');
        continue;
      }
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
          // give any wrong push a beat to land before asserting absence;
          // an `includes` filter narrows the ban to matching payloads only
          await new Promise(s => setTimeout(s, 4000));
          const hits = linearCalls().filter(c => c.path === args[0])
            .filter(c => { const s = JSON.stringify(c.payload || {}); return (want.includes || []).every(x => s.includes(x)); });
          note(hits.length === 0, `expectNoLinear ${args[0]} ${JSON.stringify(want)}`, hits.length ? `got ${hits.length}: ${JSON.stringify(hits.map(c => c.payload)).slice(0, 200)}` : '');
        }
        continue;
      }
      else if (verb === 'expectClientThread') {
        const p = await actors.client();
        const txt = await clientThreadText(p, name, args[0]);
        const want = args[1] || {};
        // {absent:true} pins "the client sees NO panel for this component"
        // (e.g. Tweaks Needed is gated off client links); {present:true} just
        // requires the panel to render.
        if (want.absent || want.present) {
          const isAbsent = txt === '(no panel)';
          const okk = want.absent ? isAbsent : !isAbsent;
          note(okk, `expectClientThread ${args[0]} ${JSON.stringify(want)}`, okk ? '' : `panel ${isAbsent ? 'absent' : 'present'} [thread="${txt.slice(0, 80)}"]`);
          await shot(p, 'client-thread');
          continue;
        }
        const missing = (want.contains || []).filter(s => !txt.includes(s));
        const leaked = (want.notContains || []).filter(s => txt.includes(s));
        note(missing.length === 0 && leaked.length === 0, `expectClientThread ${args[0]} ${JSON.stringify(want)}`,
          (missing.length ? 'missing: ' + missing.join(' | ') + ' ' : '') + (leaked.length ? 'LEAKED: ' + leaked.join(' | ') : '') + (missing.length || leaked.length ? ` [thread="${txt.slice(0, 120)}"]` : ''));
        await shot(p, 'client-thread');
        continue;
      }
      else if (verb === 'expectKasperCard') {
        const p = await actors.kasper();
        const state = await kasperCardState(p, name, args[0]);   // polls until it settles on the expected state
        note(state === args[0], `expectKasperCard ${args[0]}`, state === args[0] ? '' : 'got ' + state);
        await shot(p, 'kasper-queue');
        continue;
      }
      else { note(false, 'unknown verb ' + verb); continue; }
      if (res !== 'ok') note(false, `${verb}(${args.join(',')}) → ${res}`); else note(true, `${verb}(${args.join(',')})`);
    }
  } catch (e) { note(false, 'EXCEPTION: ' + (e.message || e)); }
  finally {
    // THE GENERIC DIVERGENCE GATE — every scenario, every open tab, for free.
    // (client tab is skipped when the SMM archived mid-scenario rows the client
    // tab can't learn about — realtime isn't tunneled in the harness; scenarios
    // that need that opt out via noDivergenceGate.)
    if (!scn.noDivergenceGate) {
      for (const [who, p] of [['smm', actors._smm], ['client', actors._client]]) {
        if (!p) continue;
        try { await divergenceGate(who, p, note); } catch (e) { note(false, `divergenceGate(${who})`, String(e.message || e).slice(0, 200)); }
      }
    }
    // 0-JS-errors gate: any real app error on any actor tab fails the scenario
    // (appErrs already filters the expected courier/WebSocket noise).
    for (const [who, p] of [['smm', actors._smm], ['kasper', actors._kasper], ['client', actors._client]]) {
      if (!p) continue;
      try { const errs = appErrs(p) || []; if (errs.length) note(false, `appErrs(${who})`, errs.slice(0, 3).join(' | ').slice(0, 300)); } catch {}
    }
    await actors.closeAll(); try { L.archiveSafe(id); } catch {}
    // Rows born IN the UI (create-via-UI scenarios) carry minted ids the seed
    // cleanup doesn't know about — archive them too so no test card survives.
    for (const xid of extraIds) { if (xid && xid !== id) { try { L.archiveSafe(xid); } catch {} } }
  }
  return { key: scn.key, name: scn.title || scn.name, ok: okCount, fail: failCount, log };
}

module.exports = { runScenario };
