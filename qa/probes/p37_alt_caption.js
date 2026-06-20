// p37 — alt-caption (per-platform second caption: caption_alt + caption_alt_platform).
//   - renders the alt tab on the SMM card
//   - SMM remove clears both fields (persists)
//   - client cannot remove (guarded, #543) — confirm via the alt-specific handler
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_alt_' + TS, PIDC = 'p_altc_' + TS;

(async () => {
  const S = Q.makeOk('P37 alt-caption');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'ALT ' + TS, platforms: 'instagram,youtube', scheduled_date: '2026-06-29', caption: 'MAIN CAPTION', caption_alt: 'IG-ALT-' + TS, caption_alt_platform: 'instagram', status: 'In Progress' });
    await Q.up({ id: PIDC, name: 'ALTC ' + TS, platforms: 'instagram,youtube', scheduled_date: '2026-06-29', caption: 'MAIN', caption_alt: 'IG-ALTC-' + TS, caption_alt_platform: 'instagram', status: 'In Progress' });
    await Q.pollRaw(PID, r => (r.caption_alt || '').includes('IG-ALT-' + TS), 'caption_alt', 14000);
    await Q.pollRaw(PIDC, r => (r.caption_alt || '').includes('IG-ALTC-' + TS), 'caption_alt', 14000);
    await Q.waitForPost(smm, PID);
    await Q.waitForPost(cli, PIDC);

    // 1) alt tab renders with the alt text
    const rendered = await smm.evaluate(async (a) => {
      calState.view = 'organizer'; _calRenderBody({ preserveScroll: false });
      await new Promise(x => setTimeout(x, 500));
      const card = document.querySelector('.cal-card[data-pid="' + a.pid + '"]');
      const altTab = card ? card.querySelector('[data-captab="alt"]') : null;
      const altTextarea = card ? card.querySelector('textarea[data-fld="caption_alt"][data-pid="' + a.pid + '"]') : null;
      return { hasAltTab: !!altTab, altValue: altTextarea ? altTextarea.value : null };
    }, { pid: PID });
    console.log('render:', JSON.stringify(rendered));
    S.ok(rendered.hasAltTab, 'alt-caption tab renders on the SMM card');

    // 2) SMM remove → clears caption_alt + caption_alt_platform (confirm dialog when there's text)
    await smm.evaluate(async (pid) => { try { _calAltCapRemove({ stopPropagation() {}, preventDefault() {} }, pid); } catch (e) {} await new Promise(x => setTimeout(x, 300)); const y = document.getElementById('confirmYes'); if (y) y.click(); }, PID);
    const r = await Q.pollRaw(PID, x => !String(x.caption_alt || '').trim(), 'caption_alt,caption_alt_platform', 14000);
    S.ok(!String(r.caption_alt || '').trim(), 'SMM remove clears caption_alt (got ' + JSON.stringify(r.caption_alt) + ')');
    S.ok(!String(r.caption_alt_platform || '').trim(), 'SMM remove clears caption_alt_platform');

    // 3) client cannot remove (guarded)
    await cli.evaluate((pid) => { try { _calAltCapRemove({ stopPropagation() {}, preventDefault() {} }, pid); } catch (e) {} }, PIDC);
    await cli.waitForTimeout(2500);
    const rc = await Q.rawRow(PIDC, 'caption_alt');
    S.ok((rc.caption_alt || '').includes('IG-ALTC-' + TS), 'client alt-caption remove is BLOCKED (alt preserved)');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally {
    for (const id of [PID, PIDC]) { try { await Q.up({ id, status: 'Archived' }); } catch (e) {} }
    await browser.close();
  }
  process.exit(S.done());
})();
