'use strict';

// The two upload forms (owner feedback 2026-10-18): the public upload link
// (?intake=1, used by clients and videographers) and the team's Submit tab.
//
// Proves, fully offline (the gateway is answered here, nothing reaches a
// server):
//   1. Byte-for-byte: for the same choice, each form sends exactly the request
//      body it sent before the redesign. The "before" bodies were captured from
//      the old form by running this file with --capture (it drives the old
//      buttons when it finds them) and are committed in
//      fixtures/upload-form-request-bodies.json. Only the random request id, the
//      timestamp and today's date are masked.
//   2. The video count control: plus, minus, a typed number, the cap of 24, a
//      number below 1, and lowering it when boxes hold links (empty boxes go
//      first; filled ones only with an Undo).
//   3. The "Make a thumbnail too" switch is on view right above the Create
//      button (no Advanced panel: owner, 2026-10-18 03:45 UTC), on by default,
//      and explains itself like the other labels.
//   4. On the upload link the Title is hidden but still sent, and the page
//      reads "Upload your content" with the Synchro Social logo.
//   5. The field labels explain themselves (the house explainable label:
//      hover, keyboard focus, Escape, tap to toggle on a phone).
//   6. The thumbnail choice survives a reload and a "Restore it" of a saved
//      video-only submission.
//
// --shots=<dir> also writes the proof screenshots (1440 and 390, light and
// dark, both forms, the bottom of the form with the thumbnail switch, one
// explanation showing).
//
// Demo names only; this repo is public.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('./prod-test-utils');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');

const SLUG = 'demo-upload-fixture', NAME = 'Alex Morgan';
const FIXTURE = path.join(__dirname, 'fixtures', 'upload-form-request-bodies.json');
const CAPTURE = process.argv.includes('--capture');
const shotsArg = process.argv.find(a => a.startsWith('--shots='));
const SHOTS = shotsArg ? path.resolve(shotsArg.slice('--shots='.length)) : '';

const failures = [];
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures.push(msg); }

async function harness(browser, port, { staff, width = 1280, height = 1000, theme, touch } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme === 'dark' ? 'dark' : 'light', ...(touch ? { hasTouch: true, isMobile: true } : {}) });
  const net = { intake: [], drop: false };
  if (staff) await seedStaffGate(context);
  if (theme) await context.addInitScript(t => { try { localStorage.setItem('syncview_theme', t); } catch (e) {} }, theme);
  await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()), async route => {
    const url = new URL(route.request().url());
    if (/functions\/v1\/key-verify/.test(url.pathname)) return route.fallback();
    if (/functions\/v1\/production-write/.test(url.pathname)) {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.operation === 'intake_create') {
        net.intake.push(route.request().postData() || '');
        if (net.drop) return route.abort('failed');
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({
          ok: true, native_committed: true, mirror_pending: false, batch: { id: 'batch-' + body.request_id },
          items: body.items.map((item, item_index) => ({ item_index, id: 'd-' + item_index + '-' + body.request_id, team: item.team, card_id: item.card_id })),
        }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    if (/functions\/v1\//.test(url.pathname) || /calendar-upsert/.test(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    if (/\/rest\/v1\/(deliverables|batches)$/.test(url.pathname) && /(^|&)select=id(&|$)/.test(url.search.slice(1))) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (url.pathname.endsWith('/clients')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ slug: SLUG, display_name: NAME, kind: 'client', active: true }]) });
    if (url.pathname.endsWith('/syncview_runtime_flags')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ key: 'write_ui_reroute_clients', value: { clients: [SLUG] } }]) });
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.host)) return route.abort();
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  return { context, page, net, errors };
}

async function open(page, port, surface) {
  if (surface === 'link') await page.goto(`http://127.0.0.1:${port}/?intake=1`);
  else {
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => typeof navTo === 'function');
    await page.evaluate(() => navTo('linear'));
  }
  await page.waitForSelector('#linearClientSearch');
  await page.waitForTimeout(300);
}

const isNewForm = page => page.evaluate(() => !!document.getElementById('linearVideoCount'));

async function setCount(page, n) {
  if (await isNewForm(page)) {
    await page.locator('#linearVideoCount').fill(String(n));
    await page.locator('#linearVideoCount').press('Enter');
    return;
  }
  // The old form: trim the boxes the way the older suites do.
  await page.evaluate(count => {
    const cards = Array.from(document.querySelectorAll('[id^="videoCard_"]'));
    cards.slice(count).forEach(card => card.remove());
    for (let i = cards.length; i < count; i++) addLinearVideo();
    renumberVideoCards(); saveLinearForm();
  }, n);
}

const FILL = {
  '#linearGeneralDrive': 'https://drive.invalid/folder/shoot',
  '#linearNotes': 'Shot outside in the morning.',
  '#vid_main_1': 'https://drive.invalid/v1/main',
  '#vid_notes_1': 'Use the second take.',
  '#vid_main_2': 'https://drive.invalid/v2/main',
  '#vid_side_2': 'https://drive.invalid/v2/side',
  '#vid_audio_2': 'https://drive.invalid/v2/audio',
  '#vid_main_3': 'https://drive.invalid/v3/main',
  '#vid_notes_3': 'Thumbnail idea: the laugh at the end.',
};

async function fillForm(page) {
  await page.evaluate(([n, s]) => selectLinearProject(n, s), [NAME, SLUG]);
  await setCount(page, 3);
  for (const [sel, value] of Object.entries(FILL)) await page.locator(sel).fill(value);
}

async function submitAs(page, mode) {
  if (await isNewForm(page)) {
    if (mode === 'video') {
      await page.locator('label[for="linearMakeThumbnail"] .uf-switch-track').click();
      if (await page.locator('#linearMakeThumbnail').isChecked()) throw new Error('the thumbnail toggle did not turn off');
    }
    await page.locator('#linearSubmitBtn').click();
  } else {
    await page.locator(mode === 'video' ? '#linearSubmitBtnVideo' : '#linearSubmitBtnBoth').click();
  }
}

// Mask what differs on every run: the random request id (and the card ids made
// from it), the edit timestamp and today's date.
function normalise(raw) {
  const body = JSON.parse(raw);
  const rid = String(body.request_id || '');
  const safe = rid.replace(/[^a-z0-9]+/gi, '').toLowerCase().slice(-28);
  let text = raw.split(rid).join('<REQUEST_ID>');
  if (safe) text = text.split(safe).join('<REQ>');
  text = text.replace(/"source_edited_at":"[^"]*"/g, '"source_edited_at":"<TS>"');
  text = text.replace(/\d{4}-\d{2}-\d{2}/g, '<DATE>');
  text = text.replace(/\b\d{1,2} [A-Z][a-z]{2} \d{4}\b/g, '<DAY>');
  return text;
}

async function captureBodies(browser, port) {
  const out = {};
  for (const surface of ['link', 'staff']) {
    for (const mode of ['both', 'video']) {
      const { context, page, net, errors } = await harness(browser, port, { staff: surface === 'staff' });
      await open(page, port, surface);
      await fillForm(page);
      await submitAs(page, mode);
      for (let i = 0; i < 150 && !net.intake.length; i++) await page.waitForTimeout(40);
      out[surface + ':' + mode] = net.intake.length === 1 ? normalise(net.intake[0]) : 'MISSING(' + net.intake.length + ')';
      check(!errors.length, `${surface} ${mode}: no page errors ${errors.join(' | ')}`);
      await context.close();
    }
  }
  return out;
}

async function cardCount(page) { return page.evaluate(() => document.querySelectorAll('[id^="videoCard_"]').length); }
async function countValue(page) { return page.evaluate(() => document.getElementById('linearVideoCount').value); }
async function note(page) { return page.evaluate(() => (document.getElementById('linearCountNote') || {}).textContent || ''); }

async function behaviour(browser, port) {
  // The upload link.
  {
    const { context, page, net, errors } = await harness(browser, port);
    await open(page, port, 'link');
    check(await page.locator('.linear-form-title').innerText() === 'Upload your content', 'the link is titled "Upload your content"');
    check(await page.locator('img.uf-logo[alt="Synchro Social"]').isVisible(), 'the link shows the Synchro Social logo');
    check(!(await page.locator('#linearTitleField').isVisible()), 'the link hides the Title field');
    const body = await page.evaluate(() => document.body.innerText);
    check(!/Video issue only|Thumbnail issue only|Video \+ graphic issue|General Drive|becomes the Linear description|Add Video/.test(body),
      'none of the retired words are on the page');
    check(/Main folder/.test(body), '"General Drive" now reads "Main folder"');
    check(await page.locator('#linearSubmitBtn').innerText() === 'Create deliverables', 'the button reads "Create deliverables" alone');

    // Count control.
    check(await cardCount(page) === 12 && await countValue(page) === '12', 'the form starts at 12 videos, as before');
    await page.locator('#linearCountPlus').click();
    check(await cardCount(page) === 13 && await countValue(page) === '13', 'plus adds a video');
    await page.locator('#linearCountMinus').click();
    check(await cardCount(page) === 12, 'minus removes an empty video');
    await page.locator('#linearVideoCount').fill('20');
    await page.locator('#linearVideoCount').press('Enter');
    check(await cardCount(page) === 20, 'typing 20 makes 20 videos');
    await page.locator('#linearVideoCount').fill('99');
    await page.locator('#linearVideoCount').press('Enter');
    check(await cardCount(page) === 24 && await countValue(page) === '24' && /24/.test(await note(page)), 'typing 99 stops at 24 and says why');
    await page.evaluate(() => stepLinearVideoCount(1));
    check(await cardCount(page) === 24 && await page.locator('#linearCountPlus').isDisabled(), 'plus is off at 24 and a step past it does nothing');
    await page.locator('#linearVideoCount').fill('0');
    await page.locator('#linearVideoCount').press('Enter');
    check(await cardCount(page) === 1 && await countValue(page) === '1' && /at least one/i.test(await note(page)), 'typing 0 gives 1 video and says why');
    check(await page.locator('#linearCountMinus').isDisabled(), 'minus does nothing at 1');
    await page.locator('#linearVideoCount').fill('');
    await page.locator('#linearVideoCount').blur();
    check(await countValue(page) === '1' && await cardCount(page) === 1, 'clearing the box and leaving it puts the number back');

    // Lowering with links in the boxes: empty boxes go first.
    await page.locator('#linearVideoCount').fill('12');
    await page.locator('#linearVideoCount').press('Enter');
    await page.locator('#vid_main_1').fill('https://drive.invalid/a');
    await page.locator('#vid_main_5').fill('https://drive.invalid/b');
    await page.locator('#vid_notes_9').fill('a note only');
    await page.locator('#linearVideoCount').fill('3');
    await page.locator('#linearVideoCount').press('Enter');
    const kept = await page.evaluate(() => [1, 2, 3].map(n => (document.getElementById('vid_main_' + n) || {}).value || (document.getElementById('vid_notes_' + n) || {}).value || ''));
    check(await cardCount(page) === 3 && kept.join('|') === 'https://drive.invalid/a|https://drive.invalid/b|a note only',
      'lowering 12 to 3 removes empty boxes first and keeps every filled one, in order');
    check(!/Undo/.test(await note(page)), 'no Undo is offered when nothing filled was removed');

    // Filled ones only go with an Undo.
    await page.locator('#linearCountMinus').click();
    check(await cardCount(page) === 2 && /Undo/.test(await note(page)), 'minus on a filled last video removes it and offers Undo');
    await page.locator('#linearCountUndo').click();
    check(await cardCount(page) === 3 && await page.locator('#vid_notes_3').inputValue() === 'a note only', 'Undo puts the video and its note back');
    await page.locator('#linearVideoCount').fill('1');
    await page.locator('#linearVideoCount').press('Enter');
    check(await cardCount(page) === 1 && /2 videos/.test(await note(page)), 'lowering to 1 with three filled says two filled videos were removed');
    await page.locator('#linearCountUndo').click();
    check(await cardCount(page) === 3 && await page.locator('#vid_main_2').inputValue() === 'https://drive.invalid/b', 'Undo restores all of them');
    // Undo keeps what was typed after the removal, and two lowerings in a row
    // can both be undone.
    const vals = () => page.evaluate(() => Array.from(document.querySelectorAll('[id^="videoCard_"]')).map((c, i) => ['main', 'side', 'notes'].map(k => (document.getElementById('vid_' + k + '_' + (i + 1)) || {}).value || '').join('/')));
    await page.locator('#linearCountMinus').click();
    await page.locator('#vid_side_1').fill('typed after');
    await page.locator('#linearCountUndo').click();
    check((await vals()).join('|') === 'https://drive.invalid/a/typed after/|https://drive.invalid/b//|//a note only',
      'Undo puts the removed video back and keeps what was typed into the others since');
    await page.locator('#linearCountMinus').click();
    await page.locator('#linearCountMinus').click();
    check(await cardCount(page) === 1 && /videos 2 and 3/.test(await note(page)), 'a second lowering names both removed videos');
    await page.locator('#linearCountUndo').click();
    check((await vals()).join('|') === 'https://drive.invalid/a/typed after/|https://drive.invalid/b//|//a note only', 'one Undo restores both, in place');
    await page.locator('#linearCountMinus').click();
    await page.locator('#linearCountPlus').click();
    check(await cardCount(page) === 3 && /Undo/.test(await note(page)), 'raising after a removal keeps the Undo on offer');
    await page.locator('#linearCountUndo').click();
    check((await vals()).join('|') === 'https://drive.invalid/a/typed after/|https://drive.invalid/b//|//a note only|//', 'Undo after raising puts the removed video back and keeps the new box');
    await page.locator('#linearVideoCount').fill('3');
    await page.locator('#linearVideoCount').press('Enter');
    await page.locator('#vid_side_1').fill('');
    const savedCount = await page.evaluate(() => JSON.parse(localStorage.getItem('syncview_linear_form')).videos.length);
    check(savedCount === 3, 'the saved draft follows the count');

    // The thumbnail switch: on view above the button, no Advanced panel.
    const thumbTrack = page.locator('label[for="linearMakeThumbnail"] .uf-switch-track');
    check(!(await page.locator('#linearAdvancedToggle, #linearAdvancedPanel, #linearAdvancedState').count())
      && !/Advanced/.test(await page.locator('.uf-actions').innerText()), 'there is no Advanced panel');
    check(await thumbTrack.isVisible() && await page.locator('#linearMakeThumbnail').isChecked(),
      '"Make a thumbnail too" is on view without opening anything, and on by default');
    const place = await page.evaluate(() => {
      const sw = document.querySelector('label[for="linearMakeThumbnail"]');
      const btn = document.getElementById('linearSubmitBtn');
      const a = sw.getBoundingClientRect(), b = btn.getBoundingClientRect();
      return { inActions: !!sw.closest('.uf-actions') && !!btn.closest('.uf-actions'),
        before: !!(sw.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING),
        gap: b.top - a.bottom, oneLine: a.height <= 30, sameLeft: Math.abs(a.left - b.left) <= 1 };
    });
    check(place.inActions && place.before && place.gap >= 0 && place.gap <= 24 && place.sameLeft,
      'the switch sits directly above the Create button, aligned with it ' + JSON.stringify(place));
    check(place.oneLine, 'the switch is one line');
    await thumbTrack.click();
    check(!(await page.locator('#linearMakeThumbnail').isChecked()), 'a click turns the thumbnail off');
    await page.reload();
    await page.waitForSelector('#linearMakeThumbnail', { state: 'attached' });
    await page.waitForTimeout(500);
    check(!(await page.locator('#linearMakeThumbnail').isChecked()), 'the thumbnail choice survives a reload');
    await thumbTrack.click();
    check(await page.locator('#linearMakeThumbnail').isChecked(), 'a second click turns it back on');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);

    // Explanations: the house explainable label (shared tooltip).
    const tipText = () => page.evaluate(() => { const t = document.getElementById('globalTooltip'); return t && t.isConnected ? t.textContent : ''; });
    const folderLabel = page.locator('label[for="linearGeneralDrive"] [data-sv-explain]');
    check(!(await tipText()), 'no explanation shows at rest');
    await folderLabel.hover();
    await page.waitForTimeout(300);
    check(/Google Drive folder/.test(await tipText()), 'hovering the Main folder label explains it');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    check(!(await tipText()), 'moving away hides it');
    await page.locator('label[for="vid_audio_1"] [data-sv-explain]').focus();
    await page.waitForTimeout(200);
    check(/main camera already has good audio/.test(await tipText()), 'keyboard focus on the Audio label explains it');
    // A label hovered while the field above it has focus never covers that field.
    await page.keyboard.press('Escape');
    await page.locator('#vid_main_1').click();
    await page.locator('label[for="vid_side_1"] [data-sv-explain]').hover();
    await page.waitForTimeout(300);
    check(await page.evaluate(() => { const t = document.getElementById('globalTooltip'); if (!t || !t.isConnected) return false; const a = t.getBoundingClientRect(), b = document.getElementById('vid_main_1').getBoundingClientRect(); return !(a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right); }),
      'an explanation never covers the field being typed into');
    await page.mouse.move(5, 5);
    await page.locator('label[for="vid_audio_1"] [data-sv-explain]').focus();
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    check(!(await tipText()), 'Escape dismisses the explanation');
    const thumbHelp = page.locator('label[for="linearMakeThumbnail"] [data-sv-explain]');
    await thumbHelp.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    await thumbHelp.hover();
    await page.waitForTimeout(300);
    check(/also makes a thumbnail/.test(await tipText()) && /only the video/.test(await tipText()), 'hovering "Make a thumbnail too" explains it');
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    const optional = await page.evaluate(() => ['vid_side_1', 'vid_audio_1', 'vid_notes_1', 'linearNotes']
      .every(id => /optional/.test(document.querySelector('label[for="' + id + '"]').textContent)));
    check(optional, 'side camera, audio and both notes boxes say "optional"');
    check(await page.locator('label[for="vid_notes_1"]').innerText().then(t => /^Notes for this video/.test(t)), 'the per-video notes read "Notes for this video"');
    check(!errors.length, 'link: no page errors ' + errors.join(' | '));
    check(!net.intake.length, 'link: nothing was submitted by these checks');
    await context.close();
  }
  // The staff Submit tab keeps the Title on view and the same controls.
  {
    const { context, page, errors } = await harness(browser, port, { staff: true });
    await open(page, port, 'staff');
    check(await page.locator('#linearTitleField').isVisible(), 'the Submit tab still shows the Title');
    check(await page.locator('#linearVideoCount').isVisible() && await page.locator('label[for="linearMakeThumbnail"] .uf-switch-track').isVisible()
      && !(await page.locator('#linearAdvancedToggle').count()), 'the Submit tab has the count control and the thumbnail switch, and no Advanced');
    check(!(await page.locator('img.uf-logo').count()), 'the Submit tab is not branded as the client upload page');
    check(!errors.length, 'staff: no page errors ' + errors.join(' | '));
    await context.close();
  }
  // A saved video-only submission comes back as video only after "Restore it".
  {
    const { context, page, net, errors } = await harness(browser, port, { staff: true });
    await open(page, port, 'staff');
    await page.evaluate(([n, s]) => selectLinearProject(n, s), [NAME, SLUG]);
    await setCount(page, 1);
    await page.locator('#vid_main_1').fill('https://drive.invalid/first');
    net.drop = true;
    await submitAs(page, 'video');
    for (let i = 0; i < 150 && !net.intake.length; i++) await page.waitForTimeout(40);
    await page.waitForTimeout(500);
    check(await page.evaluate(() => { const j = _linearIntakeRead(); return !!j && j.context && j.context.mode === 'video'; }), 'the dropped video-only submission is saved in this browser');
    await page.evaluate(() => { localStorage.removeItem('syncview_linear_make_thumbnail'); navTo('linear'); });
    await page.waitForSelector('#linearSavedBox');
    await page.click('#linearSavedBox >> text=Restore it');
    await page.waitForTimeout(500);
    check(!(await page.locator('#linearMakeThumbnail').isChecked()) && await page.locator('label[for="linearMakeThumbnail"] .uf-switch-track').isVisible(),
      'Restore it brings the thumbnail switch back off, on view');
    net.drop = false;
    await page.locator('#linearSubmitBtn').click();
    for (let i = 0; i < 150 && net.intake.length < 2; i++) await page.waitForTimeout(40);
    const resent = net.intake[1] ? JSON.parse(net.intake[1]) : null;
    check(!!resent && resent.items.every(item => item.team === 'video'), 'the restored submission is sent as video only (no graphics deliverable)');
    check(!errors.length, 'restore: no page errors ' + errors.join(' | '));
    await context.close();
  }
  // On a phone, tapping a label toggles its explanation and does not open the field.
  {
    const { context, page } = await harness(browser, port, { width: 390, height: 844, touch: true });
    await open(page, port, 'link');
    const label = page.locator('label[for="linearGeneralDrive"] [data-sv-explain]');
    const tipText = () => page.evaluate(() => { const t = document.getElementById('globalTooltip'); return t && t.isConnected ? t.textContent : ''; });
    await label.tap();
    await page.waitForTimeout(200);
    check(/Google Drive folder/.test(await tipText()) && await page.evaluate(() => document.activeElement.id !== 'linearGeneralDrive'),
      'phone: a tap on the label shows its explanation without opening the field');
    await label.tap();
    await page.waitForTimeout(200);
    check(!(await tipText()), 'phone: a second tap hides it');
    const thumbLabel = page.locator('label[for="linearMakeThumbnail"] [data-sv-explain]');
    await thumbLabel.scrollIntoViewIfNeeded();
    await thumbLabel.tap();
    await page.waitForTimeout(200);
    check(/also makes a thumbnail/.test(await tipText()) && await page.locator('#linearMakeThumbnail').isChecked(),
      'phone: a tap on "Make a thumbnail too" explains it without flipping the switch');
    await thumbLabel.tap();
    await page.waitForTimeout(200);
    await page.locator('label[for="linearMakeThumbnail"] .uf-switch-track').tap();
    check(!(await page.locator('#linearMakeThumbnail').isChecked()), 'phone: a tap on the switch turns it off');
    await context.close();
  }
}

async function shots(browser, port) {
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const surface of ['link', 'staff']) {
    for (const width of [1440, 390]) {
      for (const theme of ['light', 'dark']) {
        const { context, page } = await harness(browser, port, { staff: surface === 'staff', width, height: width > 500 ? 1000 : 844, theme, touch: width < 500 });
        await open(page, port, surface);
        await page.evaluate(([n, s]) => selectLinearProject(n, s), [NAME, SLUG]);
        if (width > 500) await setCount(page, 3);
        await page.locator('#linearGeneralDrive').fill('https://drive.invalid/folder/shoot');
        await page.locator('#vid_main_1').fill('https://drive.invalid/v1/main');
        await page.mouse.move(1, 1);
        await page.evaluate(() => document.activeElement && document.activeElement.blur());
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(SHOTS, `${surface}-${width}-${theme}.png`), fullPage: true });
        if (surface === 'link' && theme === 'light') {
          // The bottom of the form: the switch above the button (off at 1440).
          if (width > 500) await page.locator('label[for="linearMakeThumbnail"] .uf-switch-track').click();
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await page.mouse.move(1, 1);
          await page.evaluate(() => document.activeElement && document.activeElement.blur());
          await page.waitForTimeout(400);
          await page.screenshot({ path: path.join(SHOTS, `${surface}-${width}-thumbnail-switch.png`) });
          await page.evaluate(() => { window.scrollTo(0, 0); if (document.activeElement) document.activeElement.blur(); });
          await page.mouse.move(1, 1);
          await page.waitForTimeout(400);
          const lbl = page.locator('label[for="linearGeneralDrive"] [data-sv-explain]');
          if (width > 500) { await lbl.hover(); await page.waitForTimeout(200); await lbl.hover({ position: { x: 6, y: 4 } }); } else await lbl.tap();
          await page.waitForTimeout(800);
          await page.screenshot({ path: path.join(SHOTS, `${surface}-${width}-explanation.png`) });
        }
        await context.close();
      }
    }
  }
  console.log('screenshots written to ' + SHOTS);
}

(async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    const bodies = await captureBodies(browser, port);
    if (CAPTURE) {
      fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
      fs.writeFileSync(FIXTURE, JSON.stringify(bodies, null, 2) + '\n');
      console.log('captured ' + Object.keys(bodies).length + ' request bodies into ' + path.relative(process.cwd(), FIXTURE));
    } else {
      const before = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
      for (const key of Object.keys(before)) {
        check(bodies[key] === before[key], `${key}: the request body is byte-for-byte what the old form sent`);
        if (bodies[key] !== before[key]) console.log('  before: ' + before[key] + '\n  after:  ' + bodies[key]);
      }
      await behaviour(browser, port);
      if (SHOTS) await shots(browser, port);
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error(`\n${failures.length} failure(s)`); process.exit(1); }
  console.log('\nupload form checks passed');
})().catch(error => { console.error(error); process.exit(1); });
