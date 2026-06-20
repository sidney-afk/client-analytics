// p03 — §4.10 BUG: saving an EMPTY platform set wipes the strip everywhere with no guard.
// After fix: emptying + Save shows a confirm (no silent wipe); proceeding writes []; cancel keeps the set.
// SCOPE: mutates Sidney's settings row enabled_platforms — reads original first and RESTORES at the end.
const Q = require('./lib.js');
const SETTINGS_PID = 'p_cal_settings'; // settings row id (confirmed in code)

const readEnabled = async () => {
  // settings row stores fields inside the `caption` JSON blob; read via the page instead for reliability
  return null;
};

(async () => {
  const S = Q.makeOk('P03 empty-platforms-guard');
  const browser = await Q.launch();
  let original = null;
  let smm;
  try {
    smm = await Q.smmPage(browser);
    // capture the original enabled set from in-memory settings (source of truth the UI uses)
    original = await smm.evaluate(() => {
      try { return (calState.settings && Array.isArray(calState.settings.enabled_platforms)) ? calState.settings.enabled_platforms.slice() : null; } catch (e) { return null; }
    });
    console.log('original enabled_platforms:', JSON.stringify(original));

    // Ensure there's at least one platform enabled to start (so "empty after save" is a real change).
    if (!original || !original.length) {
      await smm.evaluate(async () => { try { _calSetEnabledPlatforms(calClientSlug(calState.client), ['instagram','youtube']); _calSaveSettings({ enabled_platforms: ['instagram','youtube'] }); } catch(e){} await new Promise(x=>setTimeout(x,1500)); });
    }

    // 1) Open the editor, UNCHECK ALL, click the real Save handler.
    const step1 = await smm.evaluate(async () => {
      openCalPlatformsEditor();
      await new Promise(x => setTimeout(x, 300));
      const modal = document.getElementById('calImportModal');
      const boxes = modal ? [...modal.querySelectorAll('input[data-platform-edit]')] : [];
      boxes.forEach(cb => { cb.checked = false; });
      const before = (calState.settings && calState.settings.enabled_platforms) ? calState.settings.enabled_platforms.slice() : null;
      _calSavePlatformsSelection();             // empty selection
      await new Promise(x => setTimeout(x, 250));
      const confirmShown = !!document.querySelector('#confirmOverlay.active');
      const afterNoConfirm = (calState.settings && calState.settings.enabled_platforms) ? calState.settings.enabled_platforms.slice() : null;
      return { boxes: boxes.length, before, confirmShown, afterNoConfirm };
    });
    console.log('step1:', JSON.stringify(step1));
    S.ok(step1.boxes > 0, 'platforms editor rendered checkboxes');
    S.ok(step1.confirmShown, 'empty Save shows a confirm dialog (no silent wipe)');
    S.ok(JSON.stringify(step1.afterNoConfirm) === JSON.stringify(step1.before), 'settings NOT changed while confirm pending (no premature wipe)');

    // 2) Cancel the confirm → settings unchanged.
    const step2 = await smm.evaluate(async () => {
      try { dismissConfirm(); } catch (e) {}
      await new Promise(x => setTimeout(x, 200));
      return (calState.settings && calState.settings.enabled_platforms) ? calState.settings.enabled_platforms.slice() : null;
    });
    console.log('step2 after cancel:', JSON.stringify(step2));
    S.ok(step2 && step2.length > 0, 'after Cancel: platform set preserved (not emptied)');

    // 3) Proceed path: empty Save then click "Hide all" → settings becomes [].
    const step3 = await smm.evaluate(async () => {
      openCalPlatformsEditor();
      await new Promise(x => setTimeout(x, 250));
      const modal = document.getElementById('calImportModal');
      (modal ? [...modal.querySelectorAll('input[data-platform-edit]')] : []).forEach(cb => cb.checked = false);
      _calSavePlatformsSelection();
      await new Promise(x => setTimeout(x, 250));
      const yes = document.getElementById('confirmYes');
      if (yes) yes.click();
      await new Promise(x => setTimeout(x, 400));
      return (calState.settings && Array.isArray(calState.settings.enabled_platforms)) ? calState.settings.enabled_platforms.slice() : 'notarray';
    });
    console.log('step3 after Hide all:', JSON.stringify(step3));
    S.ok(Array.isArray(step3) && step3.length === 0, 'confirm "Hide all" path still works (writes empty set)');

    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0,4)) + ')');
  } finally {
    // RESTORE original (or a sane default) so Sidney is left as found.
    // IMPORTANT: poll-confirm the write LANDED before closing — _calSaveSettings goes
    // through an async serialized chain + n8n, and a premature browser.close() races it
    // (this exact race once left Sidney with enabled_platforms=[]).
    const restore = (original && original.length) ? original : ['instagram','youtube','linkedin'];
    try {
      await smm.evaluate(async (list) => { try { await _calSaveSettings({ enabled_platforms: list }); _calSetEnabledPlatforms(calClientSlug(calState.client), list); } catch(e){} await new Promise(x=>setTimeout(x,3000)); }, restore);
      let landed = false;
      for (let i = 0; i < 25; i++) {
        const row = await Q.rawRow('p_cal_settings', 'caption,client');
        // settings row id is shared across clients; the page write targets Sidney's row,
        // but the REST read by id alone is ambiguous — re-read via the page instead.
        const cur = await smm.evaluate(() => (calState.settings && calState.settings.enabled_platforms) || null);
        if (JSON.stringify(cur) === JSON.stringify(restore)) { landed = true; break; }
        await new Promise(x => setTimeout(x, 700));
      }
      console.log('restored enabled_platforms to', JSON.stringify(restore), landed ? '(confirmed)' : '(UNCONFIRMED)');
    } catch (e) { console.log('restore failed:', e.message); }
    await browser.close();
  }
  process.exit(S.done());
})();
