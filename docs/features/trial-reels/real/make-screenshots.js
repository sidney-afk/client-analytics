'use strict';
/* Trial reels on the REAL page: the staff card and the Production sub-issue (session Trials, 2026-10-26, round 2).
 *   npm run build:index && node docs/features/trial-reels/real/make-screenshots.js
 * Serves the built page through the offline harness (docs/syncview-design/tests/lost-work-lib.js: every backend answer
 * mocked, nothing leaves the machine except the page's own web font), opens today's Calendar card and today's
 * Production sub-issue with the harness's fictional data, and loads preview.js, which adds only the trial-reels parts.
 * "card-today-*" is the same card without preview.js. The Notes view has its own script, make-notes-screenshots.js.
 * Output: card-<state>-<width>-<theme>.png and prod-<today|review|winner>-<width>-<theme>.png in this folder.
 * NODE_PATH must reach playwright (as for the other browser tests). */
const fs = require('fs');
const path = require('path');
const { createEnv, sleep } = require('../../../syncview-design/tests/lost-work-lib');

const OUT = __dirname;
const PREVIEW = fs.readFileSync(path.join(__dirname, 'preview.js'), 'utf8');
// The card keeps its normal status in every state; only the versions carry labels.
const STATUS = { today: 'Client Approval', off: 'Client Approval', review: 'Client Approval', 'review-open': 'Client Approval',
  trial: 'Approved', due: 'Approved', 'due-open': 'Approved', winner: 'Scheduled', 'winner-open': 'Scheduled', 'winner-undo': 'Scheduled' };
const CORS = { 'access-control-allow-origin': '*' };

(async () => {
  const S = await createEnv();
  await S.ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.continue());   // the page's own font, as it looks live
  const card = S.card('p_t1');
  card.name = 'Why the first second matters';
  card.caption = 'Most people decide in the first second. Here is how to earn the second one.';
  card.graphic_status = 'N/A';
  card.asset_url = 'https://f.io/fixture-version-a';
  const vid = S.deliv.find(d => d.id === 'del_vid_1');
  vid.file_url = 'https://f.io/fixture-version-a';
  S.deliv.splice(S.deliv.findIndex(d => d.id === 'del_gra_1'), 1);   // the video sub-issue only, so it opens first
  // The Assets read the Production page asks for (production-write asset_access_read), answered locally.
  await S.ctx.route('**/functions/v1/production-write{,?*}', async route => {
    const r = route.request();
    let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
    if (r.method() !== 'POST' || b.action !== 'asset_access_read') return route.fallback();
    const d = S.deliv.find(x => x.id === b.id) || vid;
    const now = new Date().toISOString();
    const a = (slot, url, state, type) => ({ slot, url, state, url_type: type, checked_at: now, guidance: '', source: 'deliverable' });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, complete: true, id: d.id, client_slug: d.client_slug, team: d.team,
      assets: [a('filming_plan', 'https://docs.google.com/document/d/fixture-plan', 'available', 'google_doc'), a('raw_footage', 'https://drive.google.com/drive/folders/fixture-raw', 'available', 'drive_folder'),
        a('delivery_folder', 'https://next.frame.io/project/00000000-0000-4000-8000-000000000002', 'available', 'frameio'), a('deliverable_file', d.file_url, 'available', 'frameio')], capabilities: [] }) });
  });
  const done = [];
  const heights = {};   // today's card height per width and theme; every collapsed state must match it
  const cardHeight = page => page.evaluate(() => { const c = [...document.querySelectorAll('.cal-card, .cal-link-field')].find(n => n.offsetParent && n.classList.contains('cal-card')); const v = [...document.querySelectorAll('.cal-link-field.cal-link-post')].find(n => n.offsetParent); const host = c || (v && v.closest('[class*=sheet], [class*=card]')) || document.body; return Math.round((c ? c.getBoundingClientRect().height : host.scrollHeight) * 10) / 10; });
  let mismatches = 0;
  // Every label the preview adds must be readable (4.5:1 or more), and every version's link must start at the
  // Deliverable file link's left edge.
  const check = async (page, name) => {
    const a = await page.evaluate(() => window.svTrialPreview ? svTrialPreview.audit() : { contrast: [], lefts: {} });
    for (const c of a.contrast) if (c.ratio < 4.5) { mismatches++; console.log('FAIL  contrast ' + name + ' "' + c.text + '": ' + c.ratio + ':1'); }
    const low = a.contrast.length ? Math.min(...a.contrast.map(c => c.ratio)) : null;
    if (low != null && low >= 4.5) console.log('  ok  contrast ' + name + ': ' + a.contrast.length + ' labels, lowest ' + low + ':1');
    for (const [col, xs] of Object.entries(a.lefts || {})) {
      const same = xs.every(x => Math.abs(x - xs[0]) < 1);
      if (!same) mismatches++;
      console.log((same ? '  ok  ' : 'FAIL  ') + col + ' column ' + name + ': ' + xs.join(', '));
    }
  };
  const save = async (page, name, clip) => { await page.screenshot(Object.assign({ path: path.join(OUT, name) }, clip ? { clip } : {})); done.push(name); };
  try {
    for (const theme of ['dark', 'light']) {
      for (const [w, h] of [[1440, 900], [390, 844]]) {
        // ---- the card ----
        for (const state of Object.keys(STATUS)) {
          for (const k of ['video_status', 'caption_status']) card[k] = STATUS[state];
          card.status = STATUS[state];
          card.asset_url = state.startsWith('winner') ? 'https://f.io/fixture-version-c' : 'https://f.io/fixture-version-a';
          const page = await S.newPage();
          await page.setViewportSize({ width: w, height: h });
          await page.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
          await S.openCalendar(page);
          await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
          if (w < 600) { await page.getByText(card.name).first().click(); await sleep(1200); }
          if (state !== 'today') {
            await page.addScriptTag({ content: PREVIEW });
            const base = state.split('-')[0];
            const open = /-open|-undo/.test(state);
            await page.evaluate(([s2, o]) => svTrialPreview.card(s2, o), [base, open]);
            // The moment after a trophy is pressed: Video C is the winner at once, with today's Undo toast.
            if (state === 'winner-undo') await page.evaluate(() => svTrialPreview.undoToast('C'));
          }
          await page.mouse.move(2, h - 2);
          await sleep(600);
          const ch = await cardHeight(page);
          const key = w + '-' + theme;
          if (state === 'today') heights[key] = ch;
          else if (!/-open|-undo/.test(state)) {
            const same = Math.abs(ch - heights[key]) < 0.5;
            if (!same) mismatches++;
            console.log((same ? '  ok  ' : 'FAIL  ') + 'card height ' + key + ' ' + state + ': ' + ch + ' (today ' + heights[key] + ')');
          }
          const name = 'card-' + state + '-' + w + '-' + theme + '.png';
          await check(page, name);
          if (state === 'winner-undo') {
            await sleep(400);
            await save(page, name);   // the whole screen, so the toast at the bottom shows
          } else if (w >= 600) {
            const box = await page.locator('#calView .cal-card').first().boundingBox();
            await page.screenshot({ path: path.join(OUT, name), fullPage: true, clip: { x: box.x - 16, y: box.y - 16, width: box.width + 32, height: box.height + 32 } }); done.push(name);
          } else {
            // The phone card scrolls inside its sheet: the shot starts at the date, so the Video row and the
            // statuses are on screen.
            await page.evaluate(() => { const d = [...document.querySelectorAll('.cal-link-field')].find(n => n.offsetParent); if (d) d.scrollIntoView({ block: 'center' }); });
            await sleep(300);
            await save(page, name);
          }
          if (page.errors.length) console.log('page errors', name, page.errors);
          await page.close();
        }
        // ---- the Production sub-issue ----
        for (const state of ['today', 'review', 'winner']) {
          vid.file_url = state.startsWith('winner') ? 'https://f.io/fixture-version-c' : 'https://f.io/fixture-version-a';
          const page = await S.newPage();
          await page.setViewportSize({ width: w, height: h });
          await page.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
          await S.openProduction(page);
          await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
          await page.locator('[data-prod-row]').first().click();
          await page.waitForSelector('.prod-asset-row[data-prod-asset-slot="deliverable_file"] .prod-asset-value a', { timeout: 8000 }).catch(() => {});
          await sleep(800);
          if (state !== 'today') {
            await page.addScriptTag({ content: PREVIEW });
            await page.evaluate(s2 => svTrialPreview.production(s2), state);
          }
          await page.evaluate(() => { const a = document.querySelector('.prod-assets'); if (a) a.scrollIntoView({ block: 'center' }); });
          await page.mouse.move(2, h - 2);
          await sleep(400);
          const name = 'prod-' + state + '-' + w + '-' + theme + '.png';
          await check(page, name);
          if (w >= 600) {
            const box = await page.locator('.prod-assets').first().boundingBox();
            await save(page, name, box ? { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 120), width: Math.min(w, box.width + 48), height: box.height + 200 } : undefined);
          } else {
            await save(page, name);
          }
          if (page.errors.length) console.log('page errors', name, page.errors);
          await page.close();
        }
      }
    }
    console.log(done.length + ' screenshots in ' + path.relative(process.cwd(), OUT) + (mismatches ? '; ' + mismatches + ' FAILED checks' : '; every collapsed card is today\'s height, every label 4.5:1 or more, every version row\'s columns aligned'));
    if (mismatches) process.exitCode = 1;
  } finally {
    await S.close();
  }
})();
