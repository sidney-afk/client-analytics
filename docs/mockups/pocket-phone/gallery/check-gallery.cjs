// Design-preview checks only. The product's phone/desktop gates are separate.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const dir = __dirname;
const output = process.argv[2];
if (!output) throw new Error('Supply a local report directory; existing evidence is not overwritten.');
fs.mkdirSync(output, { recursive: true });
const sizes = [[360, 800], [375, 812], [390, 844], [430, 932], [667, 375], [740, 360]];
let browser;
const audit = () => {
  const visible = e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && e.checkVisibility({ checkVisibilityCSS: true }) &&
      getComputedStyle(e).pointerEvents !== 'none';
  };
  const controls = [...document.querySelectorAll('button,input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio]),textarea,select,summary,a[role=button]')]
    .filter(e => !e.disabled && visible(e));
  const targets = controls.filter(e => {
    const r = e.getBoundingClientRect();
    return r.width < 43.5 || r.height < 43.5;
  }).map(e => ({ tag: e.tagName, cls: String(e.className), width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height }));
  const fields = controls.filter(e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) && parseFloat(getComputedStyle(e).fontSize) < 16)
    .map(e => ({ id: e.id, size: getComputedStyle(e).fontSize }));
  return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    overflow: document.documentElement.scrollWidth > innerWidth + 1, targets, fields };
};
(async () => {
  browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const context = await browser.newContext({ viewport: { width: 1360, height: 1400 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [], requests = [], mounts = [], cases = [], interactions = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { if (/^https?:/.test(r.url())) requests.push('Unexpected external request'); });
  await page.goto(pathToFileURL(path.join(dir, 'gallery.html')).href);
  await page.bringToFront();
  for (const side of ['a', 'b']) {
    const frame = page.frameLocator('#' + side);
    await frame.locator('.pm-heading h1').waitFor({ timeout: 5000 });
    await frame.locator('body').evaluate(() => Promise.all([400, 500, 600, 700, 800].map(weight => document.fonts.load(`${weight} 16px "Plus Jakarta Sans"`))));
  }
  const states = JSON.parse(fs.readFileSync(path.join(dir, 'states.json'), 'utf8'));
  for (const [key] of states) for (const appearance of ['light', 'dark']) {
    await page.evaluate(({ key, appearance }) => {
      theme = appearance;
      document.querySelectorAll('.toolbar button').forEach(b => b.classList.toggle('active', b.id === appearance));
      group = groups.find(g => g[2].some(d => d[0] === key))[0];
      show(key);
    }, { key, appearance });
    for (const side of ['a', 'b']) {
      const frame = page.frameLocator('#' + side);
      await frame.locator('.pm-heading h1').waitFor({ timeout: 5000 });
      mounts.push({ key, appearance, side, title: await frame.locator('.pm-heading h1').innerText() });
      for (const [width, height] of sizes) {
        await page.locator('#' + side).evaluate((e, size) => {
          e.style.width = size[0] + 'px'; e.style.height = size[1] + 'px';
        }, [width, height]);
        // Geometry reads below synchronously flush layout. Font loading is
        // completed above; animation frames in occluded headed iframes can
        // otherwise be throttled for seconds without adding measurement proof.
        const result = await frame.locator('body').evaluate(audit);
        cases.push({ key, appearance, side, height, ...result });
      }
      await page.locator('#' + side).evaluate(e => { e.style.width = '390px'; e.style.height = '844px'; });
    }
    if (process.env.POCKET_CAPTURE === '1') {
      await page.bringToFront();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(output, `${key}-${appearance}.png`), fullPage: true });
    }
    console.log(`GALLERY_PROGRESS: ${mounts.length}/180 phone mounts checked.`);
    fs.writeFileSync(path.join(output, 'gallery-checks.json'), JSON.stringify({ status: 'In progress', mounts, cases, errors, externalRequests: requests.length }, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(output, 'gallery-checks.json'), JSON.stringify({ status: 'Layouts complete; interactions pending', mounts, cases, errors, externalRequests: requests.length }, null, 2) + '\n');
  const frame = page.frameLocator('#a');
  const render = key => frame.locator('body').evaluate((_, key) => window.pmRender(key), key);
  const check = (name, ok) => interactions.push({ name, ok: Boolean(ok) });
  await render('calendarSheet');
  await frame.locator('#pmTabs').click();
  check('Tabs opens the full staff tab chooser', await frame.locator('.pm-overlay.open .pm-menu-row').count() === 11);
  await frame.locator('.pm-close').click();
  await frame.locator('#pmMore').click();
  check('More contains Organize', await frame.locator('.pm-modal').innerText().then(t => /Organize/.test(t)));
  await frame.locator('.pm-close').click();
  await frame.locator('.cal-comments-btn').first().click();
  await frame.locator('#calCommentComposer').fill('Example draft');
  check('A note draft enables its local send control', await frame.locator('.cal-cm-send').isEnabled());
  await frame.locator('.pm-close').click();
  for (const [key, components] of [['previewState1', 3], ['clientSampleExample', 2]]) {
    await render(key);
    check(key + ' preserves separate review components', await frame.locator('.cal-review-panel').count() === components);
    const panel = frame.locator('.cal-review-panel').first();
    await panel.locator('textarea').fill('Example change request');
    check(key + ' disables approval with a note draft', await panel.locator('.cal-review-approve-btn').isDisabled());
    check(key + ' enables comment with a note draft', await panel.locator('.cal-review-comment-btn').isEnabled());
    await panel.locator('textarea').fill('');
    check(key + ' clears draft and restores approval', await panel.locator('.cal-review-approve-btn').isEnabled());
  }
  await render('tiktok');
  await frame.locator('label.tk-radio:has(input[name=tkMediaType][value=photo])').click();
  check('TikTok photo mode displays its captured carousel controls', await frame.locator('input[name=tkMediaType][value=photo]').isChecked());
  await render('instagram');
  await frame.locator('label.tk-radio:has(input[name=igCoverMode][value=frame])').click();
  check('Instagram frame mode retains its native selected value', await frame.locator('input[name=igCoverMode][value=frame]').isChecked());
  check('Instagram has no photo-carousel mode', await frame.locator('#igFormCol input[name=tkMediaType]').count() === 0);
  const failures = cases.filter(c => c.overflow || c.targets.length || c.fields.length);
  const report = { mounts, cases, interactions, failures, errors, externalRequests: requests.length };
  fs.writeFileSync(path.join(output, 'gallery-checks.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`EXPORTED_GALLERY: ${mounts.length} mounts; ${cases.length} layout cases; ${failures.length} layout failures; ${errors.length} browser errors; ${requests.length} external requests.`);
  console.log(`EXPORTED_INTERACTIONS: ${interactions.length} checks; ${interactions.filter(c => !c.ok).length} failures.`);
  await browser.close();
  process.exitCode = failures.length || errors.length || requests.length || interactions.some(c => !c.ok) ? 1 : 0;
})().catch(async error => { console.error(error.message); if (browser) await browser.close(); process.exitCode = 1; });
