// ot10_notes_modal.js — SMM notes/comments modal against the LIVE backend.
// Open the notes modal on a sample card; assert the comp picker (Video/Thumbnail)
// and audience toggle; send an INTERNAL note on video and a CLIENT note on
// thumbnail; confirm each persists to the right component thread with the right
// audience in the live row.
const L = require('../sxr_courier_lib.js');
const { launch, smm, up, supa, poll, appErrs, archiveSafe } = L;

const ID = 'sr_ot10_' + Date.now();
const NAME = 'OT notes ' + Date.now();
const MSG_INT = 'Internal: check the audio mix ' + Date.now();
const MSG_CLI = 'Client-facing: does this hook land? ' + Date.now();
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }

async function setComp(page, label) {
  return page.evaluate((lab) => { const b = [...document.querySelectorAll('[data-cm-toggle="comp"] .cal-cm-aud-btn')].find(x => new RegExp(lab, 'i').test(x.textContent)); if (b) { b.click(); return true; } return false; }, label);
}
async function setAud(page, label) {
  return page.evaluate((lab) => { const b = [...document.querySelectorAll('[data-cm-toggle="audience"] .cal-cm-aud-btn')].find(x => new RegExp(lab, 'i').test(x.textContent)); if (b) { b.click(); return true; } return false; }, label);
}
async function typeSend(page, msg) {
  await page.evaluate((m) => {
    const ta = document.getElementById('sxrCommentComposer') || document.querySelector('#sxrCommentsOverlay textarea');
    if (!ta) return; const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, m); ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, msg);
  await page.waitForTimeout(150);
  return page.evaluate(() => { const b = document.querySelector('#sxrCommentsOverlay .cal-cm-send') || document.querySelector('.cal-cm-send'); if (b && !b.disabled) { b.click(); return true; } return false; });
}
function lastComment(field) { const r = supa('id=eq.' + ID + '&select=' + field); try { const a = JSON.parse((r[0] && r[0][field]) || '[]'); return a[a.length - 1]; } catch { return null; } }

(async () => {
  up({ id: ID, name: NAME, order_index: 1, asset_url: 'https://frame.io/x/ot10', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
       video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' });
  await poll(() => { const r = supa('id=eq.' + ID + '&select=id'); return r[0] || null; }, 12000, 800);

  const browser = await launch();
  try {
    const page = await smm(browser);
    const cardSel = `#sxrStrip .cal-card[data-pid="${ID}"]`;
    await page.waitForFunction((s) => !!document.querySelector(s), cardSel, { timeout: 12000 }).catch(() => {});

    // open notes modal
    await page.click(`${cardSel} .cal-comments-btn, ${cardSel} .cal-card-notes`);
    const opened = await page.waitForFunction(() => { const o = document.getElementById('sxrCommentsOverlay'); return o && o.classList.contains('open'); }, { timeout: 6000 }).then(() => true).catch(() => false);
    ok(opened, 'notes modal opened');

    const toggles = await page.evaluate(() => ({
      comp: [...document.querySelectorAll('[data-cm-toggle="comp"] .cal-cm-aud-btn')].map(b => b.textContent.trim()),
      aud: [...document.querySelectorAll('[data-cm-toggle="audience"] .cal-cm-aud-btn')].map(b => b.textContent.trim())
    }));
    ok(toggles.comp.some(t => /Video/i.test(t)) && toggles.comp.some(t => /Thumbnail/i.test(t)), 'comp picker = Video + Thumbnail', JSON.stringify(toggles.comp));
    ok(toggles.aud.length >= 2, 'audience toggle present (internal + client)', JSON.stringify(toggles.aud));

    // 1) INTERNAL note on VIDEO
    await setComp(page, 'Video');
    await setAud(page, 'Kasper|team|internal');
    const s1 = await typeSend(page, MSG_INT);
    ok(s1, 'sent internal video note');
    const c1 = await poll(() => { const c = lastComment('video_tweaks'); return (c && String(c.body || '').includes('check the audio mix')) ? c : null; }, 12000, 900);
    ok(!!c1, 'internal video note persisted to video_tweaks (live)');
    if (c1) { ok(c1.audience === 'internal', 'note audience = internal', 'aud=' + c1.audience); ok(c1.is_tweak === false, 'plain note is_tweak=false'); }

    // 2) CLIENT note on THUMBNAIL
    await page.waitForTimeout(400);
    await setComp(page, 'Thumbnail');
    await setAud(page, 'Client');
    const s2 = await typeSend(page, MSG_CLI);
    ok(s2, 'sent client thumbnail note');
    const c2 = await poll(() => { const c = lastComment('graphic_tweaks'); return (c && String(c.body || '').includes('does this hook land')) ? c : null; }, 12000, 900);
    ok(!!c2, 'client thumbnail note persisted to graphic_tweaks (live)');
    if (c2) ok(c2.audience === 'client', 'note audience = client', 'aud=' + c2.audience);

    const errs = appErrs(page);
    ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(ID), 'cleanup: seed archived', 'id=' + ID);
    const stray = supa('id=eq.' + ID + '&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active row');
  }

  console.log('\nRESULT ot10_notes_modal: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
