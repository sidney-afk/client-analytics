// ot07_kasper_actions.js — Kasper request-change + approve-after-tweaks (live).
// Two seeds, both video @ Kasper Approval with a linked video issue:
//  (A) type a change → "Request change" → Tweaks Needed + kasper is_tweak comment
//      + mocked Linear set-status(Tweaks Needed) + add-comment.
//  (B) type a change → "Approve after tweaks" → For SMM Approval +
//      kasper_approved_after_tweaks includes 'video' + kasper comment.
const L = require('../sxr_courier_lib.js');
const { launch, kasper, up, supa, poll, appErrs, archiveSafe, linearCalls, resetLinearCalls } = L;

const A = 'sr_ot7a_' + Date.now(), B = 'sr_ot7b_' + Date.now();
const NA = 'OT kasper req ' + Date.now(), NB = 'OT kasper aat ' + Date.now();
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }
function seed(id, nm) { up({ id, name: nm, order_index: 1, asset_url: 'https://frame.io/x/' + id, thumbnail_url: '', linear_issue_id: 'https://linear.app/syncsocial/issue/' + id, video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval' }); }
async function typeAndClick(page, nm, btnSel, msg) {
  return await page.evaluate((args) => {
    const [nm, btnSel, msg] = args;
    const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm);
    const p = card && card.querySelector('.cal-review-panel[data-sxr-kasper-comp="video"]');
    if (!p) return 'no-panel';
    const ta = p.querySelector('.cal-review-textarea');
    if (!ta) return 'no-textarea';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, msg); ta.dispatchEvent(new Event('input', { bubbles: true }));
    const b = p.querySelector(btnSel);
    if (!b || b.disabled) return 'btn-disabled';
    b.click(); return 'clicked';
  }, [nm, btnSel, msg]);
}

(async () => {
  resetLinearCalls();
  seed(A, NA); seed(B, NB);
  await poll(() => { const r = supa('id=in.(' + A + ',' + B + ')&select=id'); return (Array.isArray(r) && r.length >= 2) ? r : null; }, 12000, 800);

  const browser = await launch();
  try {
    const page = await kasper(browser);
    await page.waitForFunction((ids) => ids.every(id => !!document.querySelector('#kasperContent .kcard.cal-review-card')), [A], { timeout: 12000 }).catch(() => {});
    // expand both cards
    await page.evaluate((names) => {
      names.forEach(nm => { const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(c => (c.querySelector('.kcard-title') || {}).textContent === nm); if (card) (card.querySelector('.kcard-strip') || card).click(); });
    }, [NA, NB]);
    await page.waitForTimeout(600);

    // (A) request change
    const rA = await typeAndClick(page, NA, '.cal-review-tweak-btn', 'Kasper: please trim the intro');
    ok(rA === 'clicked', 'A: typed + clicked Request change', rA);
    const rowA = await poll(() => { const r = supa('id=eq.' + A + '&select=video_status,video_tweaks'); return (r[0] && r[0].video_status === 'Tweaks Needed') ? r[0] : null; }, 14000, 1000);
    ok(!!rowA, 'A: video → Tweaks Needed (live)');
    if (rowA) { let c = null; try { const arr = JSON.parse(rowA.video_tweaks || '[]'); c = arr[arr.length - 1]; } catch {} ok(c && c.role === 'kasper' && c.is_tweak, 'A: kasper is_tweak comment persisted', c ? ('role=' + c.role) : 'none'); }

    // (B) approve after tweaks
    const rB = await typeAndClick(page, NB, '.cal-review-aat-btn', 'Kasper: fix audio then send to SMM');
    ok(rB === 'clicked', 'B: typed + clicked Approve after tweaks', rB);
    const rowB = await poll(() => { const r = supa('id=eq.' + B + '&select=video_status,kasper_approved_after_tweaks'); return (r[0] && r[0].video_status === 'For SMM Approval') ? r[0] : null; }, 14000, 1000);
    ok(!!rowB, 'B: video → For SMM Approval (live)');
    if (rowB) ok(String(rowB.kasper_approved_after_tweaks || '').split(',').map(s => s.trim()).includes('video'), 'B: kasper_approved_after_tweaks includes video', JSON.stringify(rowB.kasper_approved_after_tweaks));

    // Linear (mocked) — A pushed Tweaks Needed + a comment
    await page.waitForTimeout(500);
    const lc = linearCalls();
    const aStatus = lc.find(c => c.path === 'linear-set-status' && /Tweaks Needed/.test(JSON.stringify(c.payload)) && new RegExp(A).test(JSON.stringify(c.payload)));
    ok(!!aStatus, 'A: mocked Linear set-status(Tweaks Needed) captured');
    const aComment = lc.find(c => c.path === 'linear-add-comment' && new RegExp(A).test(JSON.stringify(c.payload)));
    ok(!!aComment, 'A: mocked Linear add-comment captured');

    const errs = appErrs(page);
    ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(A) && archiveSafe(B), 'cleanup: both seeds archived');
    const stray = supa('id=in.(' + A + ',' + B + ')&status=neq.Archived&select=id');
    ok(Array.isArray(stray) && stray.length === 0, 'safety sweep: no stray active rows', 'stray=' + (Array.isArray(stray) ? stray.length : '?'));
  }

  console.log('\nRESULT ot07_kasper_actions: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
