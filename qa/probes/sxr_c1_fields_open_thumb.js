// sxr_c1_fields_open_thumb.js — SMM field interactions NOT covered by m2:
//   • thumbnail DERIVATION from a YouTube URL → the card <img> src is the
//     img.youtube.com/vi/<id>/hqdefault.jpg URL (render path);
//   • the asset_url + thumbnail_url OPEN buttons launch the raw URL (window.open
//     intercepted) and appear/disappear in-place as the field gains/loses a value;
//   • Google-Drive derivation → drive.google.com/thumbnail?id=…&sz=w320&_r=<rev>
//     with a cache-bust token; direct-image derivation → url + ?_r=<rev>;
//   • thumb_rev bumps on each media-link change and the _r cache-bust token
//     changes with it;
//   • creative_direction textarea AUTOSIZES (height grows with content).
//
// Scoped to sidneylaruel; unique sr_c1_* id; archived on exit; 0 app JS errors.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + (!c && x !== undefined ? '  -> ' + JSON.stringify(x) : '')); };
const rowOf = (id) => { try { const r = Q.supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=*'); return Array.isArray(r) && r[0] ? r[0] : null; } catch { return null; } };
async function waitRow(id, pred, ms = 20000) { return Q.poll(() => { const r = rowOf(id); return (r && pred(r)) ? r : false; }, ms) || rowOf(id); }
async function cardReady(page, id, tries = 25) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate((id) => !!document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"]`), id)) return true;
    await page.waitForTimeout(900);
  }
  return false;
}
async function typeField(page, id, fld, v) {
  return page.evaluate(({ id, fld, v }) => {
    const el = document.querySelector(`.sxr-card.is-editable[data-sxr-id="${id}"] input[data-sxr-fld="${fld}"]`);
    if (!el) return false;
    el.focus(); el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }, { id, fld, v });
}

(async () => {
  const id = 'sr_c1_' + Date.now();
  const ts = new Date().toISOString();
  const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const YT_THUMB = 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
  const DRIVE = 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQ/view';
  const DIRECT = 'https://cdn.example.com/pic-' + Date.now() + '.png';

  // Seed: YouTube asset, NO thumbnail → derived thumb falls back to the YouTube id.
  const seed = Q.up({
    id, name: 'C1 fields', order_index: '1',
    asset_url: YT, thumbnail_url: '', video_status: 'In Progress', graphic_status: 'In Progress',
    status: 'In Progress', creative_direction: 'short', created_at: ts,
  });
  ok(seed && seed.ok === true, 'seed live sample (YouTube asset, no thumbnail)', JSON.stringify(seed).slice(0, 120));

  const browser = await Q.launch();
  try {
    const page = await Q.smm(browser, 'sidneylaruel');
    ok(await cardReady(page, id), 'SMM editable card rendered', String(true));

    // ── 1) YouTube derivation feeds the rendered thumbnail <img> ──
    const imgSrc = await page.evaluate((id) => {
      const img = document.querySelector(`.sxr-card[data-sxr-id="${id}"] .sxr-card-thumb img`);
      return img ? img.getAttribute('src') : null;
    }, id);
    ok(imgSrc === YT_THUMB, 'card thumbnail <img> derives the YouTube hqdefault URL', imgSrc);

    // ── 2) the asset_url open button launches the raw URL (window.open) ──
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    const assetOpen = await page.evaluate((id) => {
      const wrap = document.querySelector(`.sxr-card[data-sxr-id="${id}"] [data-sxr-fld-wrap="asset_url"]`);
      const btn = wrap ? wrap.querySelector('.cal-link-pill-open') : null;
      if (!btn) return { had: false };
      btn.click();
      return { had: true, opened: window.__opened.slice() };
    }, id);
    ok(assetOpen.had === true, 'asset_url field shows an open button (has a value)', assetOpen);
    ok(assetOpen.opened && assetOpen.opened[0] === YT, 'asset_url open button window.open(rawUrl)', assetOpen.opened);

    // thumbnail field has NO open button yet (empty).
    const thumbBtnBefore = await page.evaluate((id) => !!document.querySelector(`.sxr-card[data-sxr-id="${id}"] [data-sxr-fld-wrap="thumbnail_url"] .cal-link-pill-open`), id);
    ok(thumbBtnBefore === false, 'thumbnail_url field has NO open button while empty', thumbBtnBefore);

    // ── 3) type a Drive URL into thumbnail → open button appears IN-PLACE,
    //       opens the raw URL, persists, derives the Drive thumbnail + cachebust ──
    const prevRev = String((rowOf(id) || {}).thumb_rev || '');
    await typeField(page, id, 'thumbnail_url', DRIVE);
    const thumbBtnAfter = await page.evaluate((id) => {
      window.__opened = [];
      const wrap = document.querySelector(`.sxr-card[data-sxr-id="${id}"] [data-sxr-fld-wrap="thumbnail_url"]`);
      const btn = wrap ? wrap.querySelector('.cal-link-pill-open') : null;
      if (!btn) return { has: false };
      btn.click();
      return { has: true, opened: window.__opened.slice() };
    }, id);
    ok(thumbBtnAfter.has === true, 'thumbnail open button appears IN-PLACE after typing a URL', thumbBtnAfter);
    ok(thumbBtnAfter.opened && thumbBtnAfter.opened[0] === DRIVE, 'thumbnail open button window.open(rawUrl)', thumbBtnAfter.opened);
    const rDrive = await waitRow(id, x => x.thumbnail_url === DRIVE);
    ok(rDrive && rDrive.thumbnail_url === DRIVE, 'thumbnail_url (Drive) persisted', rDrive && rDrive.thumbnail_url);
    ok(rDrive && String(rDrive.thumb_rev || '') !== '' && String(rDrive.thumb_rev || '') !== prevRev, 'thumb_rev bumped on the media-link change', { prev: prevRev, now: rDrive && rDrive.thumb_rev });
    const driveDerived = await page.evaluate((row) => _sxrDeriveThumb(row), rDrive);
    ok(/^https:\/\/drive\.google\.com\/thumbnail\?id=1AbCdEfGhIjKlMnOpQ&sz=w320&_r=/.test(driveDerived), 'Drive URL derives the thumbnail endpoint + _r cachebust', driveDerived);

    // ── 4) change thumbnail to a DIRECT image → derived = url + ?_r=<rev>;
    //       thumb_rev bumps again and the _r cachebust token changes ──
    const driveRev = String(rDrive.thumb_rev || '');
    await typeField(page, id, 'thumbnail_url', DIRECT);
    const rDirect = await waitRow(id, x => x.thumbnail_url === DIRECT);
    ok(rDirect && rDirect.thumbnail_url === DIRECT, 'thumbnail_url (direct image) persisted', rDirect && rDirect.thumbnail_url);
    ok(rDirect && String(rDirect.thumb_rev || '') !== driveRev, 'thumb_rev bumped again on the second media-link change', { drive: driveRev, now: rDirect && rDirect.thumb_rev });
    const directDerived = await page.evaluate((row) => _sxrDeriveThumb(row), rDirect);
    ok(directDerived.indexOf(DIRECT) === 0 && /[?&]_r=/.test(directDerived), 'direct image derives url + ?_r cachebust', directDerived);
    const driveR = (driveDerived.match(/_r=([^&]+)/) || [])[1];
    const directR = (directDerived.match(/_r=([^&]+)/) || [])[1];
    ok(driveR && directR && driveR !== directR, 'the _r cachebust token changes when the thumbnail changes', { drive: driveR, direct: directR });

    // ── 5) creative_direction textarea AUTOSIZES (height grows with content) ──
    const grew = await page.evaluate((id) => {
      const ta = document.querySelector(`.sxr-card[data-sxr-id="${id}"] textarea[data-sxr-fld="creative_direction"]`);
      if (!ta) return { ok: false };
      ta.style.height = 'auto';
      const h0 = ta.getBoundingClientRect().height;
      ta.value = Array.from({ length: 12 }, (_, i) => 'Creative direction line ' + i + ' — a fairly long sentence to force wrapping and growth.').join('\n');
      ta.dispatchEvent(new Event('input', { bubbles: true }));   // → _sxrOnTextareaInput sets height
      const h1 = ta.getBoundingClientRect().height;
      return { ok: true, h0, h1 };
    }, id);
    ok(grew.ok && grew.h1 > grew.h0, 'creative_direction textarea autosized taller with content', grew);

    // ── 6) the collapsed link-pill disappears in-place when the URL field is
    //       cleared, and reappears when set again. The field's outerHTML is
    //       replaced on each blur (calendar collapse behaviour), so re-query. ──
    const toggle = await page.evaluate((id) => {
      const sel = () => document.querySelector(`.sxr-card[data-sxr-id="${id}"] input[data-sxr-fld="thumbnail_url"]`);
      const hasPill = () => { const f = document.querySelector(`.sxr-card[data-sxr-id="${id}"] [data-sxr-fld-wrap="thumbnail_url"]`); return f ? !!f.querySelector('.cal-link-pill-open') : false; };
      let el = sel();
      el.focus(); el.value = '';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      const afterClear = hasPill();
      el = sel();   // re-query — the field was re-rendered on blur
      el.focus(); el.value = 'https://example.com/again.png';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      const afterSet = hasPill();
      return { afterClear, afterSet };
    }, id);
    ok(toggle.afterClear === false, 'link-pill removed in-place when field cleared (+blur)', toggle);
    ok(toggle.afterSet === true, 'link-pill restored in-place when field set again (+blur)', toggle);

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 6)));
  } finally {
    Q.up({ id, status: 'Archived' });
    await browser.close();
  }
  console.log(`PROBE sxr_c1_fields_open_thumb: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
