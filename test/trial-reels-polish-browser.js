'use strict';
/*
 * TRIAL REELS ON THE STAFF CARD: THE OWNER'S POLISH ROUND (session Trialpolish, 2026-10-27), in a real browser, fully
 * offline. The owner, from the live test client card: every trial action felt slow; "dropped" must not be a pill; a
 * version's name opens its link; the trial switch must not look dimmed or sit in a box, and a hover changes only its own
 * shape; the same for the row buttons (open the folder, edit link) on every row; the versions list opens by itself when
 * the switch goes on.
 *
 * The trial-reels function and Production's attach answer only after TRL_DELAY_MS (1.5 s, slower than the live
 * function's ~0.5-0.9 s and the attach's 1-5 s), so every "at once" check below fails on a page that waits for the
 * server. Proves, at 1440 and 390, light and dark:
 *   - switch on: within 250 ms the row is on and its list is open with the paste row for the next version; then one
 *     card is read, not the whole client's list; a refused switch goes back off and says so;
 *   - pasting a version's link (and the version on the card's, which goes through today's attach first), adding a
 *     version, dropping one and bringing it back: each shows within 250 ms, before the server answers;
 *   - a refused drop and a refused paste put the row back and say "did not save" (never a silent success);
 *   - an answer landing while a link is being typed never wipes what is typed;
 *   - "dropped" is plain muted text (sv-dropped-note), never a pill, at 4.5:1 or more;
 *   - a version's name is a link to its video (new tab); the small icon stays;
 *   - the switch is at full opacity with no box (transparent, outside the link's own fill), and a hover changes only
 *     the switch itself;
 *   - the row buttons (Thumbnail's and Video's edit) have no box and no divider, a hover changes only the icon, and
 *     their click target is still 32 px wide and the row's full height.
 * TRIAL_POLISH_SHOTS=<dir> also writes screenshots (fictional data only).
 */
const path = require('path');
const fs = require('fs');
const { createEnv, sleep } = require('../docs/syncview-design/tests/lost-work-lib');

const failures = [];
let passed = 0;
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }
const CORS = { 'access-control-allow-origin': '*' };
const LINK = l => 'https://f.io/fixture-polish-' + l.toLowerCase();
const DELAY = Number(process.env.TRL_DELAY_MS || 1500);
const FAST = 250;
// The row buttons' height on main before this change (measured 2026-10-27): a target never gets smaller.
const TODAY_BTN = { desktop: { w: 32, h: 29 }, phone: { w: 44, h: 44 } };
const SHOTS = process.env.TRIAL_POLISH_SHOTS || '';

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const S = await createEnv();
  const card = S.card('p_t1');
  const vid = S.deliv.find(d => d.id === 'del_vid_1');
  const T = { enabled: false, calls: [], attaches: [], refuse: null };
  const fresh = () => ['A', 'B', 'C', 'D'].map((l, i) => ({ id: 'v' + l, letter: l, status: ['waiting', 'waiting', 'waiting', 'dropped'][i],
    frame_url: LINK(l), revision: 0, updated_at: '2026-10-27T09:00:00.000Z', post_id: 'p_t1' }));
  const mainLink = () => String(vid.file_url || card.asset_url || '');
  const reset = (enabled) => {
    T.enabled = enabled; T.versions = fresh(); T.calls = []; T.attaches = []; T.refuse = null;
    vid.file_url = LINK('A'); card.asset_url = LINK('A'); card.thumbnail_url = 'https://f.io/fixture-polish-thumb';
  };

  await S.ctx.route('**/rest/v1/syncview_runtime_flags*', route => {
    const u = new URL(route.request().url());
    const raw = u.searchParams.get('key') || '';
    const keys = /^in\.\(/.test(raw) ? raw.replace(/^in\.\(/, '').replace(/\)$/, '').split(',') : [raw.replace(/^eq\./, '')];
    const rows = keys.filter(k => k !== 'client_comment_gateway_enabled' && k !== 'calendar_card_write_clients').map(k => ({ key: k,
      value: k === 'trial_reels_pages' ? { clients: ['fixtureclient'] } : k === 'prod_authority' ? { ...S.authority } : /_clients$/.test(k) ? { clients: ['fixtureclient'] } : { enabled: false } }));
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
  });
  // The trial-reels function, by its own rules, answering every write after DELAY (reads at once).
  await S.ctx.route('**/functions/v1/trial-reels', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    const b = JSON.parse(r.postData() || '{}');
    T.calls.push(b);
    if (b.action !== 'list' && b.action !== 'read') await sleep(DELAY);
    const reply = (obj, status) => route.fulfill({ status: status || 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(obj) }).catch(() => {});
    if (T.refuse && b.action === T.refuse) { T.refuse = null; return reply({ ok: false, error: 'conflict' }, 409); }
    const shape = () => Object.assign({ enabled: true, winner_letter: (T.versions.find(v => v.status === 'winner') || {}).letter || null },
      L.readShape(T.versions, { client: false, mainLink: mainLink(), cardStatus: card.video_status }));
    const apply = changes => { for (const c of changes || []) Object.assign(T.versions.find(v => v.id === c.id), c.patch); };
    let res = null;
    if (b.action === 'list') return reply({ ok: true, cards: T.enabled ? { p_t1: shape() } : {} });
    if (b.action === 'read') return reply(Object.assign({ ok: true }, shape()));
    if (b.action === 'switch_set') { T.enabled = b.enabled === true; return reply({ ok: true, enabled: T.enabled }); }
    if (b.action === 'version_add') {
      res = L.addVersion(T.versions, b.link, mainLink());
      if (!res.error) T.versions.push({ id: 'v' + res.letter, letter: res.letter, status: 'waiting', frame_url: res.link, revision: 0, updated_at: new Date().toISOString(), post_id: 'p_t1' });
    } else if (b.action === 'version_link_set') {
      res = L.linkPatch(T.versions, b.letter, b.link, mainLink());
      if (!res.error && res.patch) apply([{ id: 'v' + b.letter, patch: res.patch }]);
    } else if (b.action === 'version_drop' || b.action === 'version_restore') {
      res = L.dropPatch(T.versions, b.letter, b.action === 'version_restore', mainLink());
      if (!res.error && res.patch) apply([{ id: 'v' + b.letter, patch: res.patch }]);
    }
    if (!res) return reply({ ok: false, error: 'unknown_action' }, 400);
    if (res.error) return reply({ ok: false, error: res.error }, res.error === 'attach_first' ? 409 : 400);
    return reply(Object.assign({ ok: true }, shape()));
  });
  await S.ctx.route('**/functions/v1/production-write{,?*}', async route => {
    const r = route.request();
    let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
    if (r.method() !== 'POST' || b.operation !== 'attachment') return route.fallback();
    T.attaches.push(b);
    await sleep(DELAY);
    vid.file_url = b.file_url; card.asset_url = b.file_url; vid.updated_at = new Date().toISOString();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, native_committed: true }) }).catch(() => {});
  });

  const shot = async (page, name) => {
    if (!SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    const c = await page.$('#calView .cal-card .cal-link-post');
    const box = c && await c.evaluate(n => { const k = n.closest('.cal-card') || n; const r = k.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    if (box && box.width) await page.screenshot({ path: path.join(SHOTS, name + '.png'), clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: Math.min(900, box.height + 16) } });
    else await page.screenshot({ path: path.join(SHOTS, name + '.png') });
  };
  const listText = page => page.evaluate(() => { const l = [...document.querySelectorAll('.trl-list')].find(n => n.offsetParent); return l ? l.innerText.replace(/\s+/g, ' ').trim() : ''; });
  // What the page said, and the notice closed again (it is a modal) so the next click lands.
  const notices = page => page.evaluate(() => {
    const ov = document.getElementById('confirmOverlay'); if (ov) ov.classList.remove('active');
    return (window.__seen || []).filter(s => s.kind === 'notify').map(s => s.a + ' ' + s.b).join(' | ');
  });
  // How long until `cond` holds in the page, from now; Infinity past `limit`.
  const until = async (page, cond, arg, limit) => {
    const t0 = Date.now();
    try { await page.waitForFunction(cond, arg, { timeout: limit || FAST, polling: 'raf' }); return Date.now() - t0; } catch (e) { return Infinity; }
  };
  const open = async (w, h, theme) => {
    const page = await S.newPage();
    await page.setViewportSize({ width: w, height: h });
    await page.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
    await S.openCalendar(page);
    await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
    if (w < 600) { await page.getByText(card.name).first().click(); await sleep(1000); }
    await sleep(1500);
    await page.evaluate(() => { window.__seen = window.__seen || []; });
    return page;
  };
  const rowOf = (page, letter) => page.evaluate(l => {
    const r = [...document.querySelectorAll('.trl-list .trl-v')].find(n => n.offsetParent && (n.querySelector('.trl-l') || {}).textContent === 'Video ' + l);
    return r ? r.innerText.replace(/\s+/g, ' ').trim() : '';
  }, letter);
  const looks = page => page.evaluate(() => {
    const rgba = c => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return [0, 0, 0, 0]; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
    const over = (t, u) => { const a = t[3] + u[3] * (1 - t[3]); return a ? [0, 1, 2].map(i => (t[i] * t[3] + u[i] * u[3] * (1 - t[3])) / a).concat(a) : [0, 0, 0, 0]; };
    const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const bgOf = el => { const layers = []; for (let n = el; n; n = n.parentElement) layers.push(rgba(getComputedStyle(n).backgroundColor)); return layers.reverse().reduce((acc, c) => over(c, acc), [255, 255, 255, 1]); };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const clear = c => rgba(c)[3] === 0;
    const vis = n => n && n.offsetParent;
    const sw = [...document.querySelectorAll('.cal-link-post .trl-sw-slot')].find(vis);
    let op = 1; for (let n = sw; n && n !== document.body; n = n.parentElement) op *= Number(getComputedStyle(n).opacity);
    const field = sw && sw.closest('.cal-link-field');
    const drop = [...document.querySelectorAll('.trl-v .sv-dropped-note')].find(vis);
    const dcs = drop && getComputedStyle(drop);
    const btns = [...document.querySelectorAll('#calView .cal-card .cal-link-field .cal-link-edit, #calView .cal-card .cal-link-field .cal-link-folder')].filter(vis).map(b => {
      const cs = getComputedStyle(b), r = b.getBoundingClientRect();
      return { bg: cs.backgroundColor, border: cs.borderLeftWidth, w: Math.round(r.width), h: Math.round(r.height), rowH: Math.round(b.parentElement.getBoundingClientRect().height) };
    });
    const name = [...document.querySelectorAll('.trl-v a.trl-name')].find(vis);
    return {
      sw: sw ? { op: Math.round(op * 100) / 100, bg: getComputedStyle(sw).backgroundColor, fieldBg: getComputedStyle(field).backgroundColor, clearSw: clear(getComputedStyle(sw).backgroundColor) } : null,
      drop: drop ? { pill: !!document.querySelector('.trl-v .trl-lab[data-l="dropped"]'), bg: dcs.backgroundColor, pad: dcs.paddingLeft, radius: dcs.borderTopLeftRadius, ratio: Math.round(ratio(over(rgba(dcs.color), bgOf(drop)), bgOf(drop)) * 10) / 10 } : null,
      btns, name: name ? { href: name.getAttribute('href'), target: name.getAttribute('target'), text: name.textContent } : null,
    };
  });
  // The phone card's media strip: which of the placeholder's words, the play button and the tool bar overlap.
  const thumbOverlap = page => page.evaluate(() => {
    const t = [...document.querySelectorAll('.cal-card-thumb')].find(n => n.offsetParent && n.querySelector('.sv-phone-card-tools'));
    if (!t) return null;
    const box = sel => { const n = t.querySelector(sel); if (!n || !n.offsetParent && getComputedStyle(n).position !== 'fixed') return null; const r = n.getBoundingClientRect(); return r.width && r.height ? r : null; };
    const parts = { cta: box('.cal-thumb-frame-cta'), host: box('.cal-thumb-frame-host'), badge: box('.cal-thumb-frame-badge'), play: box('.cal-thumb-play'), tools: box('.sv-phone-card-primary') };
    const names = Object.keys(parts).filter(k => parts[k]);
    const hits = [];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const a = parts[names[i]], b = parts[names[j]];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) hits.push(names[i] + '/' + names[j]);
    }
    const f = t.querySelector('.cal-thumb-frame');
    return { hits, parts: names, frameH: f ? Math.round(f.getBoundingClientRect().height) : 0 };
  });
  // A hover on `sel`: what changes on the element itself vs on the thing it draws (the switch, the icon).
  const hoverDiff = async (page, sel, inner) => {
    const read = () => page.evaluate(([s, i]) => {
      const el = [...document.querySelectorAll(s)].find(n => n.offsetParent);
      if (!el) return null;
      const ic = el.querySelector(i), a = getComputedStyle(el), b = getComputedStyle(ic);
      return { bg: a.backgroundColor, border: a.borderLeftWidth + ' ' + a.borderLeftStyle, shadow: a.boxShadow, inner: b.backgroundColor + '|' + b.transform + '|' + b.color };
    }, [sel, inner]);
    await page.mouse.move(1, 1);
    await sleep(250);
    const before = await read();
    await page.hover(sel);
    await sleep(250);
    const after = await read();
    await page.mouse.move(1, 1);
    return { before, after };
  };

  try {
    for (const [w, h, label] of [[1440, 900, 'desktop'], [390, 844, 'phone']].filter(x => !process.env.TRL_ONLY || x[2] === process.env.TRL_ONLY)) {
      for (const theme of ['light', 'dark']) {
        const tag = label + ' ' + theme;
        // ---- the switch, on: at once, the list open with its paste row ----
        reset(false);
        let page = await open(w, h, theme);
        if (label === 'phone') {
          // The thumbnail is a link here (a Frame.io page, not a picture): on the phone its placeholder's words, the
          // play button and the tool bar must not sit on each other (found while checking these screenshots).
          const overlap = await thumbOverlap(page);
          ok(overlap && !overlap.hits.length && overlap.frameH >= 150, `${tag}: a link thumbnail's placeholder has its own room above the tools, nothing overlaps: ${JSON.stringify(overlap)}`);
        }
        let L0 = await looks(page);
        ok(L0.sw && L0.sw.op >= 0.99, `${tag}: the off switch is not dimmed (opacity ${L0.sw && L0.sw.op})`);
        ok(L0.sw && L0.sw.clearSw, `${tag}: the off switch sits in no box (${L0.sw && L0.sw.bg})`);
        let hv = await hoverDiff(page, '.cal-link-post .trl-sw-slot', '.trl-sw');
        ok(hv.before && hv.before.bg === hv.after.bg && hv.before.border === hv.after.border && hv.before.inner !== hv.after.inner,
          `${tag}: a hover on the switch changes only the switch (${JSON.stringify(hv.before && [hv.before.bg, hv.after.bg])})`);
        const b0 = L0.btns;
        ok(b0.length >= 2 && b0.every(b => /rgba\(0, 0, 0, 0\)|transparent/.test(b.bg) && b.border === '0px'), `${tag}: the row buttons (Thumbnail, Video) have no box and no divider: ${JSON.stringify(b0.map(b => b.bg + ' ' + b.border))}`);
        ok(b0.every(b => b.w >= TODAY_BTN[label].w && b.h >= TODAY_BTN[label].h && b.h >= b.rowH - 1), `${tag}: and keep today's full-height target: ${JSON.stringify(b0.map(b => b.w + 'x' + b.h))}`);
        hv = await hoverDiff(page, '#calView .cal-card .cal-link-thumb .cal-link-edit', 'svg');
        ok(hv.before && hv.before.bg === hv.after.bg && hv.before.border === hv.after.border && hv.before.inner !== hv.after.inner,
          `${tag}: a hover on a row button changes only its icon (${JSON.stringify(hv.before && [hv.before.inner, hv.after.inner])})`);
        await shot(page, 'polish-off-' + label + '-' + theme);
        await page.click('.cal-link-post .trl-sw-slot');
        let ms = await until(page, () => { const f = document.querySelector('.cal-link-post.trl-main'); const l = document.querySelector('.trl-list'); return !!(f && l && l.querySelector('.trl-add .trl-paste')); });
        ok(ms <= FAST, `${tag}: switch on: the row is on and its list open, with the paste row for the next version, in ${ms} ms (server answers after ${DELAY} ms)`);
        ok(!T.calls.some(c => c.action === 'switch_set') || T.calls.filter(c => c.action === 'switch_set').length === 1, `${tag}: one switch_set`);
        await sleep(DELAY + 600);
        ok(T.enabled && /Video A/.test(await listText(page)) && /Video E/.test(await listText(page)), `${tag}: after the answer, the list shows the versions and offers Video E (${(await listText(page)).slice(0, 80)})`);
        const reads = T.calls.slice(T.calls.findIndex(c => c.action === 'switch_set') + 1);
        ok(reads.some(c => c.action === 'read' && c.post_id === 'p_t1') && !reads.some(c => c.action === 'list'), `${tag}: then this one card is read, not the whole client's list (${reads.map(c => c.action).join(',')})`);
        const L1 = await looks(page);
        ok(L1.sw && L1.sw.op >= 0.99 && L1.sw.clearSw, `${tag}: the on switch is full strength and unboxed`);
        ok(L1.drop && !L1.drop.pill && /rgba\(0, 0, 0, 0\)|transparent/.test(L1.drop.bg) && L1.drop.pad === '0px' && L1.drop.radius === '0px', `${tag}: "dropped" is plain text, not a pill: ${JSON.stringify(L1.drop)}`);
        ok(L1.drop && L1.drop.ratio >= 4.5, `${tag}: and reads at ${L1.drop && L1.drop.ratio}:1`);
        ok(L1.name && L1.name.href === LINK('A') && L1.name.target === '_blank' && L1.name.text === 'Video A' && !!(await page.$('.trl-v .trl-go')),
          `${tag}: "Video A" is a link to its video in a new tab, and the small icon stays (${JSON.stringify(L1.name)})`);
        await shot(page, 'polish-on-' + label + '-' + theme);

        // ---- paste a new version's link: at once ----
        await page.click('.trl-add .trl-paste');
        await page.fill('.trl-link-input', LINK('E'));
        await page.keyboard.press('Enter');
        ms = await until(page, () => [...document.querySelectorAll('.trl-v a.trl-name')].some(a => a.textContent === 'Video E'));
        ok(ms <= FAST, `${tag}: a pasted new version shows in ${ms} ms`);
        // Type the next one while that answer is still out: the answer landing must not wipe it.
        await page.click('.trl-add .trl-paste');
        await page.type('.trl-link-input', 'https://f.io/fixture-polish-typ', { delay: 5 });
        await sleep(DELAY + 400);
        const typed = await page.$eval('.trl-link-input', n => n.value).catch(() => '');
        ok(typed === 'https://f.io/fixture-polish-typ' && T.versions.some(v => v.letter === 'E'), `${tag}: an answer landing while the next link is typed keeps what is typed ("${typed}")`);
        // Cancelled (as Escape does; Escape itself would close the phone's card sheet).
        await page.$eval('.trl-link-input', n => { n.dataset.cancel = '1'; n.blur(); });
        await sleep(200);

        // ---- change a version's link: at once ----
        await page.hover('.trl-list .trl-v:nth-child(2)');
        await page.click('.trl-list .trl-v:nth-child(2) .trl-ico[aria-label^="Change the link"]');
        await page.fill('.trl-link-input', LINK('B2'));
        await page.keyboard.press('Enter');
        ms = await until(page, l => [...document.querySelectorAll('.trl-v a.trl-name')].some(a => a.getAttribute('href') === l), LINK('B2'));
        ok(ms <= FAST, `${tag}: a changed link shows in ${ms} ms`);
        await sleep(DELAY + 300);
        ok(T.versions[1].frame_url === LINK('B2'), `${tag}: and is saved`);

        // ---- the version on the card: through today's attach first, still at once ----
        await page.hover('.trl-list .trl-v:nth-child(1)');
        await page.click('.trl-list .trl-v:nth-child(1) .trl-ico[aria-label^="Change the link"]');
        await page.fill('.trl-link-input', LINK('A2'));
        await page.keyboard.press('Enter');
        ms = await until(page, l => [...document.querySelectorAll('.trl-v a.trl-name')].some(a => a.getAttribute('href') === l), LINK('A2'));
        ok(ms <= FAST, `${tag}: the card's own version (attach first, then the function) shows in ${ms} ms`);
        await sleep(2 * DELAY + 600);
        ok(vid.file_url === LINK('A2') && T.versions[0].frame_url === LINK('A2'), `${tag}: and the card and the version both carry it`);

        // ---- drop and bring back: at once ----
        await page.hover('.trl-list .trl-v:nth-child(3)');
        await page.click('.trl-list .trl-v:nth-child(3) .trl-ico[aria-label^="Drop"]');
        ms = await until(page, () => { const r = document.querySelectorAll('.trl-list .trl-v')[2]; return !!(r && r.classList.contains('trl-dropped') && r.querySelector('.sv-dropped-note')); });
        ok(ms <= FAST, `${tag}: a drop shows in ${ms} ms`);
        await sleep(DELAY + 300);
        ok(T.versions[2].status === 'dropped', `${tag}: and is saved`);
        await page.hover('.trl-list .trl-v:nth-child(3)');
        await page.click('.trl-list .trl-v:nth-child(3) .trl-ico[aria-label^="Bring back"]');
        ms = await until(page, () => { const r = document.querySelectorAll('.trl-list .trl-v')[2]; return !!(r && !r.classList.contains('trl-dropped')); });
        ok(ms <= FAST, `${tag}: bringing it back shows in ${ms} ms`);
        await sleep(DELAY + 300);

        // ---- a refusal puts the row back and says so ----
        T.refuse = 'version_drop';
        await page.hover('.trl-list .trl-v:nth-child(2)');
        await page.click('.trl-list .trl-v:nth-child(2) .trl-ico[aria-label^="Drop"]');
        await sleep(100);
        ok(/dropped/.test(await rowOf(page, 'B')), `${tag}: (a drop the server will refuse shows at once)`);
        await sleep(DELAY + 500);
        ok(!/dropped/.test(await rowOf(page, 'B')) && T.versions[1].status !== 'dropped', `${tag}: refused, Video B is back as it was (${await rowOf(page, 'B')})`);
        ok(/Video B did not save/.test(await notices(page)), `${tag}: and the page says it did not save (${(await notices(page)).slice(-90)})`);
        T.refuse = 'version_link_set';
        await page.hover('.trl-list .trl-v:nth-child(2)');
        await page.click('.trl-list .trl-v:nth-child(2) .trl-ico[aria-label^="Change the link"]');
        await page.fill('.trl-link-input', LINK('B3'));
        await page.keyboard.press('Enter');
        await sleep(DELAY + 500);
        const hrefB = await page.evaluate(() => { const a = [...document.querySelectorAll('.trl-v a.trl-name')].find(x => x.textContent === 'Video B'); return a ? a.getAttribute('href') : ''; });
        ok(hrefB === LINK('B2') && /Video B's link did not save/.test(await notices(page)), `${tag}: a refused link goes back to the saved one and says so (${hrefB})`);
        // A link the function never takes is refused before anything shows.
        await page.hover('.trl-list .trl-v:nth-child(2)');
        await page.click('.trl-list .trl-v:nth-child(2) .trl-ico[aria-label^="Change the link"]');
        const before = T.calls.length;
        await page.fill('.trl-link-input', 'https://example.com/not-a-video');
        await page.keyboard.press('Enter');
        await sleep(300);
        ok(T.calls.length === before && /Frame\.io, Google Drive or Dropbox/.test(await notices(page)), `${tag}: a link from another host is refused before anything is sent or shown`);
        // ---- switch off at once; a refused switch goes back ----
        T.refuse = 'switch_set';
        await page.click('.cal-link-post .trl-sw-slot.on');
        ms = await until(page, () => !document.querySelector('.cal-link-post.trl-main') && !!document.querySelector('.cal-link-post .trl-sw-slot[aria-checked="false"]'));
        ok(ms <= FAST, `${tag}: switch off shows in ${ms} ms`);
        await sleep(DELAY + 500);
        ok(!!(await page.$('.cal-link-post.trl-main .trl-sw-slot.on')) && T.enabled && /Trial reels did not save/.test(await notices(page)), `${tag}: a refused switch-off puts the trial row back and says so`);
        if (label === 'phone' && theme === 'light') {
          // The same for an image-folder link as the thumbnail (125 live cards).
          await page.close();
          reset(false); card.thumbnail_url = 'https://drive.google.com/drive/folders/fixture-polish-folder';
          page = await open(w, h, theme);
          const ov = await thumbOverlap(page);
          ok(ov && !ov.hits.length && ov.frameH >= 150, `${tag}: an image-folder thumbnail: nothing overlaps either: ${JSON.stringify(ov)}`);
          await shot(page, 'polish-folder-thumb-phone-light');
        }
        if (page.errors.length) console.log('page errors', tag, page.errors);
        ok(!page.errors.length, `${tag}: no page errors`);
        await page.close();
      }
    }
  } catch (e) {
    failures.push('threw: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await S.close();
  }
  console.log(`trial-reels-polish-browser: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  process.exit(failures.length ? 1 : 0);
})();

