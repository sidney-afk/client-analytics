// p54 — two Kasper lifecycle edges:
//   A) UNDO APPROVE (toast): approve caption → Client Approval, then click the Undo toast →
//      caption reverts to its pre-approval state (Kasper Approval), persisted.
//   B) X-CLOSE + re-surface: close a card (no decision) → kasper_closed_at stamped, card hidden;
//      a NEW message created AFTER the close re-surfaces it (a fresh "look again").
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const A = 'p_undo_' + TS, B = 'p_xcl_' + TS;
const now = () => new Date().toISOString();

const kHas = (kas, pid) => kas.evaluate((pid) => (_kasperState.items || []).some(x => x.post.id === pid), pid);
const kReload = (kas) => kas.evaluate(async () => { try { await _kasperLoadReview(true); } catch (e) {} await new Promise(x => setTimeout(x, 1500)); });

(async () => {
  const S = Q.makeOk('P54 kasper undo-approve + X-close');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  try {
    // ---- A) undo approve ----
    await Q.up({ id: A, name: 'UNDO ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Kasper Approval', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4', caption_tweaks: '[]' });
    await Q.pollRaw(A, r => r.caption_status === 'Kasper Approval', 'caption_status');
    S.ok(await Q.kasperLoadHas(kas, A), 'undo card in Kasper queue');

    await kas.evaluate(async (pid) => { try { await _kasperApproveComp(pid, 'caption', 'client'); } catch (e) {} }, A);
    let r = await Q.pollRaw(A, x => x.caption_status === 'Client Approval', 'caption_status', 15000);
    S.ok(r.caption_status === 'Client Approval', 'approve → caption Client Approval (DB)');

    // wait past the 320ms anti-double-fire guard, then click the Undo toast
    await kas.waitForTimeout(700);
    const undoClicked = await kas.evaluate(() => { const b = document.querySelector('.sv-toast-action'); if (!b) return 'NO_TOAST'; b.click(); return 'clicked'; });
    S.ok(undoClicked === 'clicked', 'Undo toast present + clicked (' + undoClicked + ')');
    r = await Q.pollRaw(A, x => x.caption_status === 'Kasper Approval', 'caption_status', 15000);
    S.ok(r.caption_status === 'Kasper Approval', 'undo reverted caption → Kasper Approval (DB, persisted)');

    // ---- B) X-close + re-surface ----
    await Q.up({ id: B, name: 'XCLOSE ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Kasper Approval', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4', caption_tweaks: '[]' });
    await Q.pollRaw(B, r => r.caption_status === 'Kasper Approval', 'caption_status');
    S.ok(await Q.kasperLoadHas(kas, B), 'x-close card in Kasper queue');

    const closeRes = await kas.evaluate((pid) => { try { _kasperClose(pid); return 'ok'; } catch (e) { return 'ERR ' + e.message; } }, B);
    S.ok(closeRes === 'ok', 'x-close call ok (' + closeRes + ')');
    r = await Q.pollRaw(B, x => String(x.kasper_closed_at || '').trim() !== '', 'kasper_closed_at', 15000);
    S.ok(String(r.kasper_closed_at || '').trim() !== '', 'kasper_closed_at stamped + persisted');
    await kReload(kas);
    S.ok((await kHas(kas, B)) === false, 'closed card is HIDDEN from Kasper queue after reload');

    // a NEW message after the close re-surfaces it
    const closedAt = String(r.kasper_closed_at);
    const after = new Date(new Date(closedAt).getTime() + 5000).toISOString();
    const smmNote = { id: 'sn_' + TS, parent_id: null, author: 'Synchro Social', role: 'smm', is_tweak: false, audience: 'internal', body: 'SMM reply after close ' + TS, created_at: after, updated_at: after, done: false, done_at: '', done_by: '' };
    await Q.up({ id: B, caption_tweaks: JSON.stringify([smmNote]) });
    await Q.pollRaw(B, x => (x.caption_tweaks || '').includes('after close'), 'caption_tweaks');
    const resurfaced = await kas.evaluate(async (pid) => { for (let i = 0; i < 14; i++) { try { await _kasperLoadReview(true); } catch (e) {} await new Promise(x => setTimeout(x, 900)); if ((_kasperState.items || []).some(x => x.post.id === pid)) return true; } return false; }, B);
    S.ok(resurfaced, 'a NEW message after the close RE-SURFACES the card in Kasper queue');

    S.ok(kas._errs.length === 0, 'no JS errors (' + JSON.stringify(kas._errs.slice(0, 3)) + ')');
  } finally {
    for (const id of [A, B]) { try { const row = await Q.rawRow(id, 'caption_tweaks'); let a = []; try { a = JSON.parse(row.caption_tweaks || '[]'); } catch (e) {} const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: now() })); await Q.up({ id, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {} }
    await browser.close();
  }
  process.exit(S.done());
})();
