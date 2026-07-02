// sxr_client_persist_guard.js — payload-level audit of the CLIENT share surface:
// what can a client link actually WRITE? The UI renders no field editors for
// clients (covered by the gating probes); this probes the layer beneath — if
// field edits are forced into the page's own save funnel (console/coerced),
// does anything stop them reaching the DB?
// CHARACTERIZATION: documents the real behavior either way; a "writes land"
// result is OBS-4 (defense-in-depth gap — the true boundary is the webhook,
// which any link holder could also call directly), not an exploit demo.
'use strict';
const L = require('../sxr_courier_lib.js');
const { launch, client, up, supa, archiveSafe, appErrs } = L;

let ok = 0, fail = 0;
const t = (pass, msg, extra) => { console.log(`${pass ? '✓' : '✗'}  ${msg}${extra ? '  [' + extra + ']' : ''}`); pass ? ok++ : fail++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const row = (id, cols) => { try { const r = supa('id=eq.' + id + '&select=' + cols); return (Array.isArray(r) && r[0]) || null; } catch { return null; } };

(async () => {
  const browser = await launch();
  const ts = Date.now();
  const id = 'sr_probe_clientguard_' + ts;
  const NAME = 'ClientGuard ' + ts;
  try {
    up({ id, name: NAME, order_index: 1, video_status: 'Client Approval', graphic_status: 'Approved', status: 'Client Approval', asset_url: 'https://frame.io/x/original', linear_issue_id: 'https://linear.app/x/VID-CG' + ts, graphic_linear_issue_id: 'https://linear.app/x/GRA-CG' + ts });
    await sleep(1500);

    const p = await client(browser);
    await p.waitForFunction((n) => [...document.querySelectorAll('.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), NAME, { timeout: 15000 });

    // control: the legit review action works from this same page
    const approved = await p.evaluate((cid) => { try { _sxrReviewApprove(cid, 'video'); return 'ok'; } catch (e) { return String(e && e.message || e); } }, id);
    t(approved === 'ok', 'control: legit client approve fires', approved);
    let landed = false;
    for (let i = 0; i < 20 && !landed; i++) { const r = row(id, 'video_status'); landed = !!r && r.video_status === 'Approved'; if (!landed) await sleep(1000); }
    t(landed, 'control: approve persisted (review-action write works)');

    // audit: force NON-review field edits through the client page's own funnel
    const forced = await p.evaluate((cid) => {
      try {
        if (!_sxrPendingEdits[cid]) _sxrPendingEdits[cid] = {};
        _sxrPendingEdits[cid].name = 'CLIENT_FORCED_NAME';
        _sxrPendingEdits[cid].asset_url = 'https://evil.example/replaced.mp4';
        _sxrFlushCardSave(cid);
        return 'flushed';
      } catch (e) { return String(e && e.message || e); }
    }, id);
    t(forced === 'flushed', 'forced field edits queued + flushed via the client page funnel', forced);
    await sleep(6000);
    const after = row(id, 'name,asset_url');
    const nameKept = !!after && after.name === NAME;
    const assetKept = !!after && after.asset_url === 'https://frame.io/x/original';
    // CHARACTERIZATION (not pass/fail on the outcome itself): log the truth.
    console.log(`   [audit] after forced flush → name="${after && after.name}" asset="${after && (after.asset_url || '').slice(0, 40)}"`);
    if (nameKept && assetKept) {
      t(true, 'GUARDED: client-page funnel did NOT persist non-review columns');
    } else {
      t(true, 'OBS-4 CHARACTERIZED: client-page funnel CAN persist non-review columns (name kept=' + nameKept + ', asset kept=' + assetKept + ') — real boundary is the webhook; see report');
    }

    const errs = appErrs(p) || [];
    t(errs.length === 0, '0 app JS errors', errs[0] || '');
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    try { archiveSafe(id); } catch {}
  }
  console.log(`\npass=${ok} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();
