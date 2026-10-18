'use strict';
/*
 * THE NEW REVIEW PAGE AS ONE SYSTEM (owner feedback 2026-10-17, session Curtain Five).
 * Real browser, fully offline, the shared mocked backend of review-stage-browser.js (fictional client, cards, people).
 *
 * With the switches on (the client in review_stage_client_pages, the staff member in review_stage_kasper_staff):
 *   1. The Kasper tab has ONE header: the title, the section tabs and More sit at exactly the same place, with the
 *      same items, on Review Session, Messages and Filming Plans. Messages opens inside the tab (no Messages page,
 *      no Close button), and its inbox fits the window.
 *   2. No page scroll on the review stage (Kasper, the SMM's Review tab, the client link) at 1440x900 and
 *      1920x1080: the stage fits the window and no empty band sits under it.
 *   3. One colour system: the stage draws no background of its own (the page's shows), the stage card and the notes
 *      panel are the app's one surface colour with the app's one border, radius and shadow, and the three surfaces
 *      compute the same colours, in light and in dark.
 * With the switch off for the person (someone else signed in) or unreadable, the Kasper tab keeps today's header,
 * Messages still opens its own page with Close, and the page keeps its bottom padding.
 * ONE_SYSTEM_SHOTS=<dir> also writes the screenshots used in the PR.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { CLIENT, SLUG, STAFF, OTHER, open, openClient, waitNew, sleep } = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.ONE_SYSTEM_SHOTS || '';
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
async function shot(t, name) { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await sleep(600); await t.page.screenshot({ path: path.join(SHOTS, name + '.png') }); }

const INBOX = [1, 2, 3].map(i => ({
  post_id: 'rs' + i, client_slug: SLUG, client_name: CLIENT, title: 'Fixture conversation ' + i, thumbnail_url: '', asset_url: '',
  last_at: '2026-10-1' + i + 'T10:00:00.000Z', last_author: 'Team Member', last_author_member_id: 'qa_other', last_role: 'smm',
  last_body: 'A short fixture note.', unread: i === 1 ? 1 : 0,
}));

async function openKasper(browser, origin, o) {
  const t = await open(browser, origin, Object.assign({ stage: 'kasper', inbox: INBOX }, o));
  await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} try { wlMergeClientsFromSheet([name]); } catch (e) {} navTo('kasper'); }, CLIENT);
  if (o.expectNew) await waitNew(t); else { await t.page.locator('#kasperReviewBody').waitFor({ timeout: 30000 }); }
  await sleep(1500);
  return t;
}
async function openSmm(browser, origin, o) {
  const t = await open(browser, origin, Object.assign({ stage: 'smm', staff: STAFF }, o));
  await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
  await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
  await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
  await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
  await t.page.evaluate(() => onCalViewChange('smmreview'));
  await waitNew(t);
  await sleep(1500);
  return t;
}
async function kTab(t, key) {
  // (Today's page sends Messages to its own page: come back to the Kasper tab first, so a run on the old page
  // still measures each section.)
  await t.page.evaluate(k => { if (document.getElementById('msgPage')) _msgClose(); if (currentNav !== 'kasper') navTo('kasper'); _kasperGotoTab(k); }, key);
  await sleep(1500);
}

// The Kasper tab's header, wherever the page is now.
function kHead(page) {
  return page.evaluate(() => {
    const vis = el => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
    const box = el => { if (!vis(el)) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(','); };
    const se = document.scrollingElement;
    const main = document.getElementById('mainWrap');
    return {
      nav: typeof currentNav === 'string' ? currentNav : '',
      tab: typeof _kasperState === 'object' ? _kasperState.tab : '',
      head: box(document.querySelector('.kasper-head')),
      title: box(document.querySelector('.kasper-title')),
      subtabs: box(document.querySelector('.kasper-subtabs')),
      more: box(document.querySelector('.kasper-more-trigger')),
      sub: vis(document.querySelector('.kasper-sub')),
      items: Array.from(document.querySelectorAll('.kasper-subtabs .kasper-primary-tab .kasper-tab-label-full, .kasper-subtabs [data-kasper-more-label]')).filter(vis).map(e => e.textContent.trim()).join('|'),
      itemBoxes: Array.from(document.querySelectorAll('.kasper-subtabs .kasper-primary-tab, .kasper-subtabs .kasper-more-trigger')).map(box).join(';'),
      // The section tabs and More's right edge (More names the More section open in it, so its width follows the name).
      primary: Array.from(document.querySelectorAll('.kasper-subtabs .kasper-primary-tab .kasper-tab-label-full')).filter(vis).map(e => e.textContent.trim()).join('|'),
      primaryBoxes: Array.from(document.querySelectorAll('.kasper-subtabs .kasper-primary-tab')).map(box).join(';'),
      moreRight: (() => { const m = document.querySelector('.kasper-more-trigger'); return vis(m) ? Math.round(m.getBoundingClientRect().right) + ',' + Math.round(m.getBoundingClientRect().top) : null; })(),
      msgPage: !!document.getElementById('msgPage'),
      close: Array.from(document.querySelectorAll('.msg-close')).some(vis),
      embed: !!document.querySelector('#kasperContent [data-msg-embed] .msg-inbox'),
      convs: document.querySelectorAll('#kasperContent [data-msg-embed] .msg-conv').length,
      mainPb: main ? getComputedStyle(main).paddingBottom : '',
      sh: se.scrollHeight, ch: se.clientHeight,
    };
  });
}

// The colours the page and the stage compute: the app's own tokens (read through a probe element on the page)
// against the stage's background, card and notes panel.
function colours(page) {
  return page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-9999px;width:10px;height:10px;background:var(--surface-raised);border:1px solid var(--border);color:var(--bg)';
    document.body.appendChild(probe);
    const pc = getComputedStyle(probe);
    const app = { surface: pc.backgroundColor, border: pc.borderTopColor, bg: pc.color };
    probe.remove();
    const r = document.getElementById('svReviewStage').shadowRoot;
    const cs = sel => { const e = r.querySelector(sel); return e ? getComputedStyle(e) : null; };
    const card = cs('.card'), chat = cs('.chat'), rs = cs('.rs');
    return {
      app,
      body: getComputedStyle(document.body).backgroundColor,
      rs: rs ? rs.backgroundColor : '',
      card: card ? [card.backgroundColor, card.borderTopColor, card.borderTopWidth, card.borderTopLeftRadius, card.boxShadow].join(' / ') : '',
      chat: chat ? [chat.backgroundColor, chat.borderTopColor, chat.borderTopWidth, chat.borderTopLeftRadius, chat.boxShadow].join(' / ') : '',
      cardBg: card ? card.backgroundColor : '', chatBg: chat ? chat.backgroundColor : '',
      cardLine: card ? card.borderTopColor : '', chatLine: chat ? chat.borderTopColor : '',
      theme: document.getElementById('svReviewStage').getAttribute('data-theme'),
    };
  });
}
function scrollOf(page) { return page.evaluate(() => ({ sh: document.scrollingElement.scrollHeight, ch: document.scrollingElement.clientHeight })); }

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // ---------- 1. the Kasper tab's one header ----------
    for (const [w, h] of [[1440, 900], [1920, 1080]]) {
      console.log('--- Kasper tab, switch on for the signed-in staff member, ' + w + 'x' + h + ' ---');
      const t = await openKasper(browser, origin, { flags: 'on', staff: STAFF, width: w, height: h, expectNew: true });
      const seen = {};
      for (const key of ['review', 'replies', 'filming']) {
        if (key !== 'review') await kTab(t, key);
        const K = await kHead(t.page);
        seen[key] = K;
        expect(K.nav === 'kasper' && K.tab === key, key + ' ' + w + ': stays inside the Kasper tab (page ' + K.nav + ', section ' + K.tab + ')');
        expect(!!K.subtabs && !K.sub, key + ' ' + w + ': the one header shows (tabs ' + K.subtabs + ', old subtitle ' + K.sub + ')');
        await shot(t, 'after-kasper-' + key + '-' + w + '-light');
      }
      const R = seen.review;
      for (const key of ['replies', 'filming']) {
        const K = seen[key];
        expect(K.head === R.head && K.title === R.title, key + ' ' + w + ': the title sits where it does on Review Session (' + K.head + ' vs ' + R.head + ')');
        expect(K.subtabs === R.subtabs, key + ' ' + w + ': the section tabs sit where they do on Review Session (' + K.subtabs + ' vs ' + R.subtabs + ')');
        // Filming Plans lives in More (session Curtain Seven): on it, More carries its name, so More's right edge is
        // what stays put.
        expect(K.moreRight === R.moreRight, key + ' ' + w + ': More sits where it does on Review Session (' + K.moreRight + ' vs ' + R.moreRight + ')');
        expect(K.primary === R.primary, key + ' ' + w + ': the same tabs in the header (' + K.primary + ' vs ' + R.primary + ')');
        expect(K.primaryBoxes === R.primaryBoxes, key + ' ' + w + ': every tab at the same place (' + K.primaryBoxes + ' vs ' + R.primaryBoxes + ')');
      }
      const M = seen.replies;
      expect(!M.msgPage && !M.close && M.embed, 'Messages ' + w + ': shown inside the tab, no Messages page, no Close button (page ' + M.msgPage + ', close ' + M.close + ', embedded ' + M.embed + ')');
      expect(M.convs === INBOX.length, 'Messages ' + w + ': the inbox lists the conversations (' + M.convs + ')');
      expect(M.sh <= M.ch, 'Messages ' + w + ': the inbox fits the window, no page scroll (page ' + M.sh + 'px, window ' + M.ch + 'px)');
      expect(R.sh <= R.ch, 'Kasper Review Session ' + w + ': the page does not scroll (page ' + R.sh + 'px, window ' + R.ch + 'px)');
      // Back to Review Session: the stage comes back under the same header.
      await kTab(t, 'review');
      await waitNew(t).catch(() => null);
      const B = await kHead(t.page);
      expect(B.subtabs === R.subtabs && B.sh <= B.ch, 'Kasper ' + w + ': back on Review Session, same header and still no scroll (' + B.subtabs + ', ' + B.sh + '/' + B.ch + ')');
      expect(t.errors.length === 0, 'Kasper ' + w + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- 2 and 3. no page scroll, one colour system, on all three surfaces ----------
    const opens = {
      kasper: (o) => openKasper(browser, origin, Object.assign({ flags: 'on', staff: STAFF, expectNew: true }, o)),
      smm: (o) => openSmm(browser, origin, Object.assign({ flags: 'on' }, o)),
      client: async (o) => { const t = await openClient(browser, origin, Object.assign({ flags: 'on', tab: 'review' }, o)); await waitNew(t); await sleep(1500); return t; },
    };
    for (const dark of [false, true]) {
      const theme = dark ? 'dark' : 'light';
      const C = {};
      for (const [w, h] of [[1440, 900], [1920, 1080]]) {
        for (const s of ['kasper', 'smm', 'client']) {
          const t = await opens[s]({ width: w, height: h, dark });
          const sc = await scrollOf(t.page);
          expect(sc.sh <= sc.ch, s + ' ' + w + 'x' + h + ' ' + theme + ': the review stage fits, no page scroll (page ' + sc.sh + 'px, window ' + sc.ch + 'px)');
          const c = await colours(t.page);
          if (w === 1440) C[s] = c;
          expect(c.theme === theme, s + ' ' + theme + ': the stage follows the page theme (' + c.theme + ')');
          expect(c.rs === 'rgba(0, 0, 0, 0)' && c.body === c.app.bg, s + ' ' + w + ' ' + theme + ': one page background, the page\'s (stage ' + c.rs + ', page ' + c.body + ', token ' + c.app.bg + ')');
          expect(c.cardBg === c.app.surface && c.chatBg === c.app.surface, s + ' ' + w + ' ' + theme + ': the stage card and the notes panel are the app\'s surface colour (' + c.cardBg + ', ' + c.chatBg + ' vs ' + c.app.surface + ')');
          expect(c.cardLine === c.app.border && c.chatLine === c.app.border, s + ' ' + w + ' ' + theme + ': both use the app\'s border (' + c.cardLine + ', ' + c.chatLine + ' vs ' + c.app.border + ')');
          expect(c.card === c.chat, s + ' ' + w + ' ' + theme + ': the card and the notes panel share surface, border, radius and shadow (' + c.card + ' | ' + c.chat + ')');
          if (s !== 'kasper') await shot(t, 'after-' + s + '-' + w + '-' + theme);
          else if (dark) { await shot(t, 'after-kasper-review-' + w + '-dark'); for (const k of ['replies', 'filming']) { await kTab(t, k); await shot(t, 'after-kasper-' + k + '-' + w + '-dark'); } }
          expect(t.errors.length === 0, s + ' ' + w + ' ' + theme + ': no page errors (' + t.errors.join(' | ') + ')');
          await t.ctx.close();
        }
      }
      const sig = c => [c.app.bg, c.app.surface, c.app.border, c.card, c.chat, c.rs].join(' # ');
      expect(sig(C.kasper) === sig(C.smm) && sig(C.smm) === sig(C.client), theme + ': the three surfaces compute the same colours (kasper ' + sig(C.kasper) + ' | smm ' + sig(C.smm) + ' | client ' + sig(C.client) + ')');
    }

    // ---------- a phone keeps the Messages page and its phone layout (embedding is desktop only) ----------
    {
      console.log('--- Kasper tab, switch on, phone 390x844 ---');
      const t = await openKasper(browser, origin, { flags: 'on', staff: STAFF, width: 390, height: 844, expectNew: true });
      await kTab(t, 'replies');
      const M = await kHead(t.page);
      expect(M.msgPage && !M.embed, 'phone: Messages opens its own page with its phone layout, not embedded (page ' + M.msgPage + ', embedded ' + M.embed + ')');
      const sw = await t.page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, cw: document.scrollingElement.clientWidth }));
      expect(sw.sw <= sw.cw, 'phone: no sideways scroll (' + sw.sw + ' > ' + sw.cw + ')');
      expect(t.errors.length === 0, 'phone: no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }

    // ---------- the switch off for this person, or unreadable: today's Kasper tab ----------
    for (const [label, o] of [['someone else signed in', { flags: 'on', staff: OTHER }], ['switch unreadable', { flags: 'unreadable', staff: STAFF }]]) {
      console.log('--- Kasper tab, ' + label + ' ---');
      const t = await openKasper(browser, origin, Object.assign({ width: 1440, height: 900 }, o));
      const R = await kHead(t.page);
      expect(R.sub && R.mainPb === '80px', label + ': today\'s header and page padding on Review Session (subtitle ' + R.sub + ', padding ' + R.mainPb + ')');
      expect(!(await t.page.evaluate(() => document.documentElement.classList.contains('sv-rs-khead'))), label + ': the one-header switch class is not set');
      await kTab(t, 'replies');
      const M = await kHead(t.page);
      expect(M.msgPage && M.close && !M.embed, label + ': Messages still opens its own page with Close (page ' + M.msgPage + ', close ' + M.close + ')');
      await t.page.evaluate(() => { if (document.getElementById('msgPage')) _msgClose(); });
      await sleep(800);
      await t.page.evaluate(() => _kasperGotoTab('filming'));
      await sleep(1500);
      const F = await kHead(t.page);
      expect(F.sub, label + ': Filming Plans keeps today\'s header (subtitle ' + F.sub + ')');
      expect(t.errors.length === 0, label + ': no page errors (' + t.errors.join(' | ') + ')');
      await t.ctx.close();
    }
    for (const flags of ['off', 'unreadable']) {
      const t = await open(browser, origin, { stage: 'smm', flags, staff: STAFF });
      await t.page.goto(origin + '/index.html?v=calendar', { waitUntil: 'domcontentloaded' });
      await t.page.waitForFunction(() => typeof _calSavePins === 'function' && typeof navTo === 'function', null, { timeout: 30000 });
      await t.page.evaluate(name => { try { _syncviewStaffIdentityVerified = true; } catch (e) {} _calSavePins([name]); calState.client = name; navTo('calendar'); }, CLIENT);
      await t.page.waitForFunction(() => typeof calState === 'object' && !calState.loading && (calState.posts || []).length > 0, null, { timeout: 30000 });
      await t.page.evaluate(() => onCalViewChange('smmreview'));
      await t.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 });
      await sleep(1000);
      const pb = await t.page.evaluate(() => getComputedStyle(document.getElementById('mainWrap')).paddingBottom);
      const stage = await t.page.evaluate(() => { const h = document.getElementById('svReviewStage'); return !!h && !h.hidden; });
      expect(!stage && pb === '80px', 'SMM Review, switch ' + flags + ': the old page with its padding (stage ' + stage + ', padding ' + pb + ')');
      await t.ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\nreview-stage-one-system-browser: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nreview-stage-one-system-browser: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
