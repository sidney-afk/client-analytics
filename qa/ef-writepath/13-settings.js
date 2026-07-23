// Phase 1 — settings / caption-template save (interaction 12) via the real UI.
// Drives the "Edit caption prompt" modal (_calOpenCaptionPromptModal → set textarea
// → #calPromptSaveBtn → _calSaveCaptionPrompt) and asserts the save routes to the
// caption-prompts-save EF (…/functions/v1/caption-prompts-save), NOT the n8n webhook.
// The test client's original prompt is recorded and RESTORED. (templates-save routes
// through the identical _settingsWriteUrlForClient router — unit-proven in Phase 3.)
'use strict';
const fs = require('fs');
const L = require('./lib.js');
const OUT = '/tmp/qa-efwp/results-settings.json';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const SLUG = 'sidneylaruel';
const PROMPT_RESTORE_URL = 'https://synchrosocial.app.n8n.cloud/webhook/caption-prompts-save';
const readPrompt = () => { const r = L.supaGet('caption_prompts', `client_slug=eq.${SLUG}&select=prompt`); return (Array.isArray(r) && r[0]) ? r[0].prompt : null; };

function restorePrompt(prompt) {
  const response = L.filelessHttpRequest(
    'POST',
    PROMPT_RESTORE_URL,
    { 'Content-Type': 'application/json' },
    JSON.stringify({ client: SLUG, prompt: prompt || '' }),
  );
  const out = response.body.toString('utf8');
  try { return JSON.parse(out); } catch { return { _raw: out }; }
}

async function run() {
  const { server } = await L.startServer();
  const browser = await L.launch();
  const s = L.makeOk('settings');
  const results = {};
  const orig = readPrompt();
  results.origLen = orig == null ? null : orig.length;
  console.log('original prompt length:', results.origLen);
  L.setLinearForwardAllow([]);
  try {
    const { page, rec } = await L.smmCal(browser);

    async function savePrompt(text) {
      const t0 = Date.now();
      const opened = await page.evaluate(() => { if (typeof _calOpenCaptionPromptModal === 'function') { _calOpenCaptionPromptModal(); return true; } return false; });
      await page.waitForSelector('#calPromptTA', { timeout: 5000 }).catch(() => {});
      await page.evaluate((v) => {
        const ta = document.getElementById('calPromptTA'); if (!ta) return;
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        set.call(ta, v); ta.dispatchEvent(new Event('input', { bubbles: true }));
      }, text);
      await page.evaluate(() => { const b = document.getElementById('calPromptSaveBtn'); if (b) b.click(); });
      await sleep(4000);
      return rec.writesSince(t0).map(w => w.kind);
    }

    // save a dummy prompt
    const dummy = 'efwp dummy caption prompt — test only';
    let kinds = await savePrompt(dummy);
    const after = readPrompt();
    results.dummySave = { kinds, backendLen: after == null ? null : after.length };
    console.log('dummy save kinds:', JSON.stringify(kinds), '| backend now:', JSON.stringify(after));
    s.ok(kinds.includes('settings-ef'), 'caption-template save routed to caption-prompts-save EF', JSON.stringify(kinds));
    s.ok(!kinds.includes('settings-n8n'), 'NO n8n caption-prompts-save');
    s.ok(after === dummy, 'dummy prompt persisted in Supabase', after);
    const pushes = rec.linear.filter(l => l.path === 'linear-set-status' || l.path === 'linear-add-comment');
    s.ok(pushes.length === 0, 'settings save fired no Linear status/comment push', 'count=' + pushes.length);

    // restore original (empty string means "use default" — the modal shows the
    // default text; saving the default verbatim stores empty, which round-trips)
    const restoreText = (orig && orig.length) ? orig : '';
    kinds = await savePrompt(restoreText);
    const restored = readPrompt();
    results.restore = { kinds, backendLen: restored == null ? null : restored.length };
    s.ok((restored || '') === (orig || ''), 'original caption prompt RESTORED', 'len=' + (restored == null ? 'null' : restored.length));

    const errs = L.appErrs(page);
    s.ok(errs.length === 0, 'zero app JS errors', errs.slice(0, 3).join(' | '));
  } catch (e) { console.error('EXCEPTION:', e && e.stack || e); s.fail++; }
  finally {
    // hard safety-restore of the original prompt if anything left it changed
    try {
      const now = readPrompt();
      if ((now || '') !== (orig || '')) {
        restorePrompt(orig || '');
        console.log('safety-restored original caption prompt');
      }
    } catch (e) { console.log('safety-restore failed:', e && e.message); }
    results.pass = s.pass; results.fail = s.fail;
    try { fs.writeFileSync(OUT, JSON.stringify(results, null, 2)); } catch (e) {}
    await browser.close(); server.close();
    console.log(`\nSETTINGS: ${s.pass} pass / ${s.fail} fail  → ${OUT}`);
    process.exit(s.fail ? 1 : 0);
  }
}

if (require.main === module) {
  run().catch(error => {
    console.error('SETTINGS FAILED:', error && error.stack || error);
    process.exit(1);
  });
}

module.exports = { restorePrompt, run };
