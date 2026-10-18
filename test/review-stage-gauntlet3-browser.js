'use strict';
// All requests use the existing offline review-stage fixture. No live reads or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, firefox, webkit } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils');
const { CLIENT, STAFF, open, openClient, inS, waitNew, sleep } = require('./fixtures/review-stage-fixture');
const engines = { chromium, firefox, webkit };
const cachedStage = process.env.G3_CACHE_REF ? '(function(){\n' + require('node:child_process').execFileSync('git', ['show', process.env.G3_CACHE_REF + ':src/index/195-review-stage.js.part'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).replace(/^import .*;\r?\n/gm, '') + '\n})();' : '';
const failures = [];
let passed = 0;
async function until(fn, message, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await fn()) return; await sleep(100); }
  throw new Error(message);
}
async function setup(browser, origin, role, width, state) {
  const opt = { stage: role, flags: 'on', width, state, finished: true, linkedParts: true, mergeComments: true, nativeReceipts: true, clock: true, youtube: !!process.env.G3_TITLE, stageSource: cachedStage, errorStacks: !!process.env.G3_DEBUG };
  const t = role === 'client' ? await openClient(browser, origin, opt) : await open(browser, origin, { ...opt, staff: STAFF });
  try {
  t.browser = browser; t.origin = origin;
  t.page.setDefaultTimeout(15000);
  t.page.setDefaultNavigationTimeout(30000);
  if (role === 'kasper') {
    await t.page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
    await t.page.waitForFunction(() => typeof navTo === 'function');
    await t.page.evaluate(name => { _syncviewStaffIdentityVerified = true; wlMergeClientsFromSheet([name]); navTo('kasper'); }, CLIENT);
  }
  await waitNew(t);
  await inS(t.page, '#ta').waitFor();
  return t;
  } catch (e) { await t.ctx.close(); throw e; }
}
async function step(t, part) {
  await inS(t.page, '[data-step="' + part + '"]').click();
  await until(async () => await inS(t.page, '.stp.on').getAttribute('data-step') === part, 'part did not switch');
  await sleep(350);
}
async function post(t, id) {
  await inS(t.page, '.chipp[data-id="' + id + '"]').click();
  await until(async () => !!await inS(t.page, '.chipp.cur[data-id="' + id + '"]').count(), 'post did not switch');
  await sleep(350);
}
async function saveError(t) {
  // Player errors also offer Try again; only a save's own alert establishes a refused write.
  return await inS(t.page, '[data-err]:visible, .bub .err[role="alert"]:visible').count() > 0;
}
async function enterWords(t, selector, text, long, outside = false) {
  const box = outside ? t.page.locator(selector) : inS(t.page, selector);
  if (!long) return box.fill(text);
  // Win WebKit's fill times out on this payload even in a bare textarea after inserting it. Use the browser's
  // native text insertion after real focus/selection, and still require byte-for-byte input and saved text.
  assert.ok(await box.isEditable());
  await box.click(); await box.press('ControlOrMeta+A');
  let timer;
  try { await Promise.race([t.page.keyboard.insertText(text), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Native text insertion did not finish')), 30000); })]); }
  finally { clearTimeout(timer); }
  assert.equal(await box.inputValue(), text, 'text entry changed the supplied words');
}
async function runCase(browser, origin, role, width, label, fn) {
  let t;
  try {
    t = await setup(browser, origin, role, width);
    await fn(t);
    assert.deepEqual(t.errors, [], 'page errors');
    if (process.env.G3_SHOTS && /refused|caption editor|Finish|Undo/.test(label)) {
      fs.mkdirSync(process.env.G3_SHOTS, { recursive: true });
      await t.page.screenshot({ path: path.join(process.env.G3_SHOTS, browser.browserType().name() + '-' + role + '-' + width + '-' + label.replace(/[^a-z0-9]+/gi, '-') + '.png') });
    }
    passed++;
    console.log('PASS ' + role + ' ' + width + ' ' + label);
  } catch (e) {
    const message = role + ' ' + width + ' ' + label + ': ' + String(e.message).split('\n')[0] + (t && t.errors.length ? ' ' + JSON.stringify(t.errors) : '');
    failures.push(message); console.error('FAIL ' + message);
    if (process.env.G3_DEBUG && t) console.error(JSON.stringify({ detail: e.message, errors: t.state.errorStacks, attempts: t.state.attempts, modal: await t.page.locator('#calCommentsOverlay').textContent().catch(() => ''), ui: await inS(t.page, '#rsApp').textContent().catch(() => ''), overlay: await t.page.locator('#confirmOverlay').textContent().catch(() => '') }));
  } finally { if (t) await t.ctx.close(); }
}
async function regressions(browser, origin, role, width) {
  if (role === 'client') await runCase(browser, origin, role, width, 'background repair waits for active approval', async t => {
    t.state.writeDelay = 1000;
    await inS(t.page, '[data-ok="video"]').click();
    await until(() => t.state.attempts.some(a => a.endpoint === 'production-write' && a.body.operation === 'status'), 'native approval did not start');
    const n = t.state.attempts.length;
    await t.page.evaluate(async () => {
      if (!_calSaveInFlight.rs1) throw Error('foreground save must still be active');
      await _writeUiResumeSourceRepairs();
    });
    assert.equal(t.state.attempts.length, n, 'background repair competed with the foreground native write');
    await until(() => t.state.cards[0].video_status === 'Approved', 'foreground approval did not finish');
    await sleep(700);
    assert.equal(t.state.upserts.filter(p => p.video_status === 'Approved').length, 1);
  });
  await runCase(browser, origin, role, width, 'unsent note survives post switch', async t => {
    await inS(t.page, '#ta').fill('Unsent 日本語 café 👩🏽‍💻');
    await post(t, 'rs2');
    assert.equal(await inS(t.page, '#ta').inputValue(), '');
    await post(t, 'rs1');
    assert.equal(await inS(t.page, '#ta').inputValue(), 'Unsent 日本語 café 👩🏽‍💻');
    assert.equal(t.state.upserts.length, 0);
  });
  if (role === 'client') await runCase(browser, origin, role, width, 'caption editor survives post switch', async t => {
    await step(t, 'caption'); await inS(t.page, '#editBtn').click();
    await inS(t.page, '#capTa').fill('Unsent caption العربية 👋');
    await post(t, 'rs2'); await post(t, 'rs1'); await step(t, 'caption');
    if (!await inS(t.page, '#capTa').count()) await inS(t.page, '#editBtn').click();
    assert.equal(await inS(t.page, '#capTa').inputValue(), 'Unsent caption العربية 👋');
    assert.equal(t.state.upserts.length, 0);
  });
  if (role === 'client') await runCase(browser, origin, role, width, 'refused caption keeps editable words', async t => {
    await step(t, 'caption'); await inS(t.page, '#editBtn').click();
    const text = 'Refused caption 日本語 👩🏽‍💻';
    await inS(t.page, '#capTa').fill(text); t.state.writeFail = 20;
    await inS(t.page, '#capSave').click();
    await until(async () => /did not save/.test(await inS(t.page, '#rsApp').textContent()), 'missing caption refusal');
    assert.ok(await inS(t.page, '[data-err="caption"]').isVisible(), 'caption failure must be visible');
    assert.equal(await inS(t.page, '#stepper .svd').count(), 0, 'refused caption claimed Saved');
    assert.equal(await inS(t.page, '#capTa').inputValue(), text);
    assert.equal(t.state.upserts.length, 0);
  });
  if (role === 'client') await runCase(browser, origin, role, width, 'caption draft survives reload', async t => {
    await step(t, 'caption'); await inS(t.page, '#editBtn').click();
    await inS(t.page, '#capTa').fill('Caption kept over reload 👋');
    await t.page.reload({ waitUntil: 'domcontentloaded' }); await waitNew(t);
    await step(t, 'caption'); await inS(t.page, '#editBtn').click();
    assert.equal(await inS(t.page, '#capTa').inputValue(), 'Caption kept over reload 👋');
  });
  if (role === 'client') await runCase(browser, origin, role, width, 'caption changed by team while editor open', async t => {
    await step(t, 'caption'); await inS(t.page, '#editBtn').click();
    await inS(t.page, '#capTa').fill('My unsent caption');
    t.state.cards[0].caption = 'The newer team caption'; t.state.cards[0].updated_at = new Date().toISOString();
    await t.page.evaluate(() => loadCalendarPosts({ background: true, quiet: true }));
    await sleep(700);
    await inS(t.page, '#capSave').click(); await sleep(1000);
    assert.equal(t.state.cards[0].caption, 'The newer team caption', 'silently overwrote newer caption');
    assert.equal(await inS(t.page, '#capTa').inputValue(), 'My unsent caption');
    assert.match(await t.page.locator('#confirmOverlay').textContent(), /caption.*changed|changed.*caption/i);
    await t.page.locator('#confirmOverlay button').filter({ hasText: 'Cancel' }).click();
    assert.equal(t.state.upserts.length, 0);
  });
  if (role === 'client') await runCase(browser, origin, role, width, 'caption approved by team while editor open', async t => {
    await step(t, 'caption'); await inS(t.page, '#editBtn').click();
    const before = t.state.cards[0].caption;
    await inS(t.page, '#capTa').fill('An edit after the team answered');
    t.state.cards[0].caption_status = 'Approved'; t.state.cards[0].updated_at = new Date().toISOString();
    await t.page.evaluate(() => loadCalendarPosts({ background: true, quiet: true })); await sleep(700);
    await inS(t.page, '#capSave').click(); await sleep(700);
    assert.equal(t.state.cards[0].caption, before, 'edited a caption after it was answered');
    assert.equal(t.state.upserts.length, 0);
    assert.equal(await inS(t.page, '#capTa').inputValue(), 'An edit after the team answered');
    assert.match(await t.page.locator('#confirmOverlay').textContent(), /already answered|no longer waiting/i);
  });
  await runCase(browser, origin, role, width, 'refused plain note is visible and recoverable', async t => {
    t.state.writeFail = 20;
    await inS(t.page, '#ta').fill('Plain note words');
    await inS(t.page, role === 'client' ? '#cmtBtn' : '#noteBtn').click();
    await sleep(2200);
    const text = await inS(t.page, role === 'client' ? '#chat' : '#rsApp').textContent();
    assert.match(text, /not (sent|saved)|try again/i);
    assert.ok(/Plain note words/.test(text) || (await inS(t.page, '#ta').inputValue()).includes('Plain note words'), 'words missing');
    if (role === 'client') {
      assert.ok(await inS(t.page, '[data-note-retry]').isVisible(), 'failed note must offer a visible retry');
      t.state.writeFail = 0; await inS(t.page, '[data-note-retry]').click();
      await until(() => JSON.parse(t.state.cards[0].video_tweaks || '[]').some(n => n.body === 'Plain note words'), 'note retry did not land');
      assert.equal(JSON.parse(t.state.cards[0].video_tweaks).filter(n => n.body === 'Plain note words').length, 1);
    }
  });
}
const actions = role => (process.env.G3_TITLE ? ['title'] : ['video', 'graphic', 'caption']).flatMap(part => [
  { kind: 'approve', part }, { kind: 'change', part }, { kind: 'note', part }
]).concat(process.env.G3_TITLE ? (role === 'client' ? [{ kind: 'title-edit', part: 'title' }] : [{ kind: 'after-tweaks', part: 'title' }]) : role === 'client' ? [{ kind: 'caption-edit', part: 'caption' }] : [{ kind: 'frame', part: 'video' }, ...['video', 'graphic', 'caption'].map(part => ({ kind: 'after-tweaks', part }))]);
const conditions = ['ordinary', 'slow-5s', 'refused', 'drop-before', 'drop-after', 'double-click', 'two-tabs', 'overnight', 'new-version', 'status-moved', 'long-unicode', 'no-video'];
async function exercise(t, role, action, condition) {
  const { kind, part } = action;
  const untouched = Object.fromEntries(['video', 'graphic', 'caption', 'title'].filter(k => k !== part).map(k => [k, t.state.cards[0][k + '_status']]));
  const text = condition === 'long-unicode' ? ('日本語 العربية café 👩🏽‍💻 <tag> & "quotes"\n').repeat(180) + 'End.' : 'Gauntlet words 日本語 👋';
  await step(t, part);
  if (condition === 'slow-5s') t.state.writeDelay = 5000;
  if (condition === 'refused') t.state.refusal = { code: 'operation_forbidden', status: 403 };
  if (condition === 'drop-before') t.state.dropBefore = 1;
  if (condition === 'drop-after') t.state.dropAfter = 1;
  if (condition === 'overnight') { t.state.clockOffset = 16 * 3600000; await t.page.clock.fastForward(t.state.clockOffset); }
  if (condition === 'no-video' || condition === 'new-version' || condition === 'status-moved') {
    const row = t.state.cards[0];
    if (condition === 'no-video') row.asset_url = '';
    if (condition === 'new-version') row.asset_url += '?version=2';
    if (condition === 'status-moved') row[part + '_status'] = role === 'client' ? 'Approved' : 'Client Approval';
    row.updated_at = new Date(Date.now() + 1000).toISOString();
    await t.page.evaluate(role => role === 'client' ? loadCalendarPosts({ background: true, quiet: true }) : _kasperLoadReview(true), role);
    await sleep(700);
    if (!await inS(t.page, '[data-step="' + part + '"]').count()) { assert.equal(t.state.upserts.length, 0); return; }
  }
  let button;
  if (kind === 'approve') button = inS(t.page, '[data-ok="' + part + '"]');
  else if (kind === 'frame') button = inS(t.page, '[data-frame="video"]');
  else if (kind === 'caption-edit' || kind === 'title-edit') {
    const edit = inS(t.page, '#editBtn');
    if (!await edit.count() && condition === 'status-moved') return;
    await edit.click(); await enterWords(t, '#capTa', text, condition === 'long-unicode'); button = inS(t.page, '#capSave');
  } else {
    if (kind === 'change' || kind === 'after-tweaks') {
      const change = inS(t.page, '[data-chg="' + part + '"]');
      if (kind === 'after-tweaks') {
        await inS(t.page, '[data-menu="' + part + '"]').click();
        await inS(t.page, '[data-alt="aat"][data-for="' + part + '"]').click();
      } else if (await change.count()) await change.click();
      else if (condition === 'status-moved' && await inS(t.page, '[data-again="' + part + '"]').count()) await inS(t.page, '[data-again="' + part + '"]').click();
      else if (condition !== 'status-moved') throw Error('missing change control');
    }
    await enterWords(t, '#ta', text, condition === 'long-unicode');
    button = inS(t.page, kind === 'note' || (condition === 'status-moved' && !await inS(t.page, '#sendBtn').count()) ? (role === 'client' ? '#cmtBtn' : '#noteBtn') : '#sendBtn');
    if (role === 'kasper' && kind === 'note') button = inS(t.page, '#noteBtn');
  }
  if (!await button.count() && condition === 'status-moved') { assert.equal(t.state.upserts.length, 0); return; }
  const n = t.state.attempts.length;
  let peer;
  if (condition === 'two-tabs') {
    peer = await setup(t.browser, t.origin, role, 1440, t.state);
    await step(peer, 'caption'); await inS(peer.page, '#ta').fill('Other tab words');
    await inS(peer.page, role === 'client' ? '#cmtBtn' : '#noteBtn').click();
  }
  try { if (condition === 'double-click') await button.evaluate(b => { b.click(); b.click(); }); else await button.click(); }
  finally { if (peer) { await until(() => JSON.parse(t.state.cards[0].caption_tweaks || '[]').some(n => n.body === 'Other tab words'), 'peer save did not land'); await peer.ctx.close(); } }
  if (condition === 'drop-before' || condition === 'drop-after') {
    await until(() => t.state.attempts.length > n, 'no interrupted save');
    await t.page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  }
  await until(async () => {
    const ui = await inS(t.page, '#rsApp').textContent();
    const row = t.state.cards[0];
    const landed = kind === 'approve' ? row[part + '_status'] === (role === 'client' ? 'Approved' : 'Client Approval')
      : kind === 'caption-edit' ? row.caption === text
      : JSON.parse(row[part + '_tweaks'] || '[]').some(n => n.body === (kind === 'frame' ? 'Tweaks are on Frame.' : kind === 'title-edit' ? 'Please use this title:\n\n' + text : text));
    return landed || await saveError(t);
  }, 'save neither landed nor showed a failure', 18000);
  await sleep(condition === 'drop-before' || condition === 'drop-after' ? 7000 : 700);
  const ui = await inS(t.page, '#rsApp').textContent();
  const row = t.state.cards[0];
  if (condition === 'refused') {
    assert.equal(t.state.upserts.length, 0, 'refused mutation committed');
    assert.match(ui, /not (saved|sent)|refused|try again/i, 'silent refusal');
    if (!['approve', 'frame'].includes(kind)) {
      const kept = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; return [...r.querySelectorAll('textarea')].map(x => x.value).join('\n') + r.textContent; });
      assert.ok(kept.includes(text), 'typed words lost after refusal');
    }
    return;
  }
  const ownLanded = kind === 'approve' ? row[part + '_status'] === (role === 'client' ? 'Approved' : 'Client Approval')
    : kind === 'caption-edit' ? row.caption === text
    : JSON.parse(row[part + '_tweaks'] || '[]').some(n => n.body === (kind === 'frame' ? 'Tweaks are on Frame.' : kind === 'title-edit' ? 'Please use this title:\n\n' + text : text));
  for (const [other, status] of Object.entries(untouched)) assert.equal(row[other + '_status'], status, 'changed another part status');
  if (condition === 'two-tabs') assert.equal(JSON.parse(row.caption_tweaks || '[]').filter(n => n.body === 'Other tab words').length, 1, 'peer note lost');
  if (!ownLanded) {
    assert.ok(await saveError(t), 'transport failure must have its own visible save alert');
    assert.match(ui, /not (saved|sent)|refused|try again/i, 'silent transport failure');
    if (!['approve', 'frame'].includes(kind)) {
      const kept = await t.page.evaluate(() => { const r = document.getElementById('svReviewStage').shadowRoot; return [...r.querySelectorAll('textarea')].map(x => x.value).join('\n') + r.textContent; });
      assert.ok(kept.includes(text), 'typed words lost after transport failure');
    }
    console.log('  Own save refused visibly; typed words and peer outcome checked');
    return;
  }
  if (kind === 'approve') assert.equal(row[part + '_status'], role === 'client' ? 'Approved' : 'Client Approval');
  else if (kind === 'caption-edit') { assert.equal(row.caption, text); assert.equal(row.caption_status, 'Client Approval', 'editing approved the caption'); }
  else {
    const notes = JSON.parse(row[part + '_tweaks'] || '[]');
    const matching = notes.filter(n => n.body === (kind === 'frame' ? 'Tweaks are on Frame.' : kind === 'title-edit' ? 'Please use this title:\n\n' + text : text));
    assert.equal(matching.length, 1, 'note must land once, with all words');
    assert.equal(matching[0].role, role === 'client' ? 'client' : 'kasper', 'wrong note author role');
    assert.equal(matching[0].audience, role === 'client' ? 'client' : 'internal', 'wrong note audience');
    const body = matching[0].body;
    for (const other of Object.keys(untouched)) assert.ok(!JSON.parse(row[other + '_tweaks'] || '[]').some(n => n.body === body), 'words landed on another part');
    if (kind === 'note') assert.equal(row[part + '_status'], condition === 'status-moved' ? (role === 'client' ? 'Approved' : 'Client Approval') : (role === 'client' ? 'Client Approval' : 'Kasper Approval'));
    else assert.equal(row[part + '_status'], condition === 'status-moved' ? (role === 'client' ? 'Approved' : 'Client Approval') : 'Tweaks Needed', 'request changed the wrong status');
    if (kind === 'after-tweaks') assert.ok(String(row.kasper_approved_after_tweaks || '').split(',').includes(part), 'missing pre-approval marker');
    if (kind === 'title-edit') assert.equal(row.name, 'Why the first second matters', 'client renamed a card');
  }
  if (condition === 'double-click') {
    const committed = t.state.gateway.map(body => JSON.parse(body)).filter(b => !b.reconcile_only && t.state.nativeReceipts[b.request_id]);
    for (const op of ['status', 'comment']) assert.ok(new Set(committed.filter(b => b.operation === op).map(b => b.request_id)).size <= 1, 'double click committed two native ' + op + ' intents');
    if (kind === 'approve') assert.equal(t.state.upserts.filter(p => Object.hasOwn(p, part + '_status')).length, 1, 'double click persisted approval twice');
  }
}
async function matrix(browser, origin, role, width) {
  const list = process.env.G3_CONDITIONS ? process.env.G3_CONDITIONS.split(',') : conditions;
  const jobs = Array.from({ length: Number(process.env.G3_REPEAT || 1) }, () => list.flatMap(condition => actions(role).filter(a => !process.env.G3_ACTION || a.kind === process.env.G3_ACTION).map(action => ({ condition, action })))).flat();
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (jobs.length) {
      const { condition, action } = jobs.shift();
      await runCase(browser, origin, role, width, condition + ' ' + action.kind + ' ' + action.part, t => exercise(t, role, action, condition));
    }
  }));
}
async function auxiliary(browser, origin, role, width) {
  if (role === 'kasper') await runCase(browser, origin, role, width, 'approval Undo stays reachable', async t => {
    await inS(t.page, '[data-ok="video"]').click();
    await until(() => t.state.cards[0].video_status === 'Client Approval', 'approval missing');
    await t.page.locator('.sv-toast-action').filter({ hasText: 'Undo' }).click();
    await until(() => t.state.cards[0].video_status === 'Kasper Approval', 'Undo did not restore the part');
    assert.equal(t.state.cards[0].caption_status, 'Kasper Approval');
    assert.equal(t.state.cards[0].graphic_status, 'Kasper Approval');
  });
  await runCase(browser, origin, role, width, 'two tabs approve versus change on the same part', async t => {
    const peer = await setup(browser, origin, role, width, t.state);
    try {
      await inS(peer.page, '[data-chg="video"]').click();
      await inS(peer.page, '#ta').fill('Change from the other tab');
      await Promise.all([inS(t.page, '[data-ok="video"]').click(), inS(peer.page, '#sendBtn').click()]);
      await until(() => JSON.parse(t.state.cards[0].video_tweaks || '[]').some(n => n.body === 'Change from the other tab'), 'concurrent change lost');
      await sleep(1000);
      assert.equal(JSON.parse(t.state.cards[0].video_tweaks).filter(n => n.body === 'Change from the other tab').length, 1);
      assert.ok(['Approved', 'Client Approval', 'Tweaks Needed'].includes(t.state.cards[0].video_status));
      assert.deepEqual(peer.errors, []);
    } finally { await peer.ctx.close(); }
  });
  await runCase(browser, origin, role, width, 'Finish waits for parts and moves once; part switching', async t => {
    assert.ok(await inS(t.page, '#finishBtn').isDisabled());
    for (const part of ['video', 'graphic', 'caption']) {
      await step(t, part); await inS(t.page, '[data-ok="' + part + '"]').click();
      await until(() => t.state.cards[0][part + '_status'] === (role === 'client' ? 'Approved' : 'Client Approval'), 'part approval missing');
    }
    // The last native acknowledgement can replace Finish with Next post between two locator reads.
    const next = inS(t.page, '#moveOn:visible, #finishBtn:visible:not(:disabled)').first();
    await next.waitFor({ state: 'visible' });
    if (role === 'kasper') {
      const toast = t.page.locator('.sv-toast.show');
      await toast.waitFor({ state: 'visible' });
      const geometry = await next.evaluate(el => {
        const a = el.getBoundingClientRect(), b = document.querySelector('.sv-toast.show').getBoundingClientRect();
        return { clear: a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left,
          reserve: getComputedStyle(document.getElementById('svReviewStage')).getPropertyValue('--rs-toast').trim(), button: a.toJSON(), toast: b.toJSON() };
      });
      assert.equal(geometry.reserve, '96px', 'toast space must exist before header chrome mounts');
      assert.ok(geometry.clear, 'approval toast covers Next post: ' + JSON.stringify(geometry));
    }
    await next.click();
    await until(async () => !await inS(t.page, '.chipp.cur[data-id="rs1"]').count(), 'Finish stayed on answered post');
    assert.equal(t.state.cards[1].video_status, role === 'client' ? 'Client Approval' : 'Kasper Approval', 'Finish answered another post');
  });
  if (role === 'client') await runCase(browser, origin, role, width, 'Sheet Notes dialog reply and delete', async t => {
    await t.page.evaluate(() => onCalViewChange('organizer'));
    const door = t.page.locator('[data-comments-btn]').filter({ visible: true }).first();
    const id = await door.getAttribute('data-comments-btn');
    await door.click();
    const row = t.state.cards.find(c => c.id === id);
    assert.ok(row, 'Notes door must name a loaded fixture card');
    const box = t.page.locator('#calCommentComposer');
    await box.waitFor({ state: 'visible' });
    await t.page.evaluate(() => _calSetComposeComp('caption'));
    await box.fill('A root note 日本語'); await box.press('Enter');
    await until(() => JSON.parse(row.caption_tweaks || '[]').some(n => n.body === 'A root note 日本語'), 'root note not saved');
    const root = t.page.locator('#calCommentsModal .cal-cm-row').filter({ hasText: 'A root note 日本語' }).first();
    await root.hover();
    await root.locator('.cal-cm-action').filter({ hasText: 'Reply' }).click();
    await box.fill('A reply العربية 👋'); await box.press('Enter');
    await until(() => JSON.parse(row.caption_tweaks || '[]').some(n => n.body === 'A reply العربية 👋'), 'reply not saved');
    const notes = JSON.parse(row.caption_tweaks), parent = notes.find(n => n.body === 'A root note 日本語');
    assert.equal(notes.find(n => n.body === 'A reply العربية 👋').parent_id, parent.id);
    const reply = t.page.locator('#calCommentsModal .cal-cm-row').filter({ hasText: 'A reply العربية 👋' }).first();
    await reply.hover();
    await reply.locator('.cal-cm-action').filter({ hasText: 'Delete' }).click();
    await t.page.locator('#confirmYes').click();
    await until(() => JSON.parse(row.caption_tweaks || '[]').some(n => n.body === 'A reply العربية 👋' && n.deleted), 'delete not saved');
    assert.ok(!JSON.parse(row.caption_tweaks).find(n => n.id === parent.id).deleted, 'deleting reply deleted root');
  });
}
async function dialogMatrix(browser, origin, role, width) {
  if (role !== 'client') return;
  for (const condition of process.env.G3_CONDITIONS ? process.env.G3_CONDITIONS.split(',') : conditions) for (const kind of ['reply', 'edit', 'delete']) {
    await runCase(browser, origin, role, width, 'Notes dialog ' + condition + ' ' + kind, async t => {
      await t.page.evaluate(() => onCalViewChange('organizer'));
      const door = t.page.locator('[data-comments-btn]').filter({ visible: true }).first();
      const id = await door.getAttribute('data-comments-btn'), row = t.state.cards.find(c => c.id === id);
      assert.ok(row);
      await door.click();
      const box = t.page.locator('#calCommentComposer');
      await box.waitFor({ state: 'visible' });
      await t.page.evaluate(() => _calSetComposeComp('caption'));
      await box.fill('Dialog root words'); await box.press('Enter');
      await until(() => JSON.parse(row.caption_tweaks || '[]').some(n => n.body === 'Dialog root words'), 'dialog root missing');
      await sleep(700);
      const rootId = JSON.parse(row.caption_tweaks).find(n => n.body === 'Dialog root words').id;
      const root = t.page.locator('#calCommentsModal .cal-cm-row').filter({ hasText: 'Dialog root words' }).first();
      const statuses = Object.fromEntries(['video', 'graphic', 'caption', 'title'].map(k => [k, row[k + '_status']]));
      if (condition === 'slow-5s') t.state.writeDelay = 5000;
      if (condition === 'refused') t.state.refusal = { code: 'operation_forbidden', status: 403 };
      if (condition === 'drop-before') t.state.dropBefore = 1;
      if (condition === 'drop-after') t.state.dropAfter = 1;
      if (condition === 'overnight') { t.state.clockOffset = 16 * 3600000; await t.page.clock.fastForward(t.state.clockOffset); }
      if (['new-version', 'status-moved', 'no-video'].includes(condition)) {
        if (condition === 'new-version') row.asset_url += '?version=2';
        if (condition === 'no-video') row.asset_url = '';
        if (condition === 'status-moved') { row.caption_status = 'Tweaks Needed'; statuses.caption = row.caption_status; }
        row.updated_at = new Date(Date.now() + 1000).toISOString();
        await t.page.evaluate(() => loadCalendarPosts({ background: true, quiet: true })); await sleep(700);
      }
      const text = condition === 'long-unicode' ? ('Dialog 日本語 العربية café 👩🏽‍💻 <tag>\n').repeat(180) + 'End.' : 'Dialog reply 日本語 👋';
      await root.hover();
      const n = t.state.attempts.length;
      if (kind === 'edit' && !await root.locator('.cal-cm-action').filter({ hasText: 'Edit' }).count()) {
        // Legacy threads offer Reply/Delete, while Edit requires a canonical can_edit capability.
        const linked = await t.page.evaluate(id => _prodCanonicalCommentGate(calState.posts.find(p => p.id === id), 'caption').linked, id);
        assert.equal(linked, false, 'a canonical thread unexpectedly omitted Edit');
        assert.equal(JSON.parse(row.caption_tweaks).find(n => n.id === rootId).body, 'Dialog root words');
        assert.equal(t.state.attempts.length, n, 'unavailable Edit must not write');
        console.log('  Edit is unavailable on this legacy thread; no edit-save coverage claimed');
        return;
      }
      if (kind !== 'delete') {
        await root.locator('.cal-cm-action').filter({ hasText: kind === 'reply' ? 'Reply' : 'Edit' }).click();
        await enterWords(t, '#calCommentComposer', text, condition === 'long-unicode', true);
        await box.press('Enter');
        if (condition === 'double-click') await box.press('Enter');
      } else {
        await root.locator('.cal-cm-action').filter({ hasText: 'Delete' }).click();
        const yes = t.page.locator('#confirmYes');
        if (condition === 'double-click') await yes.evaluate(b => { b.click(); b.click(); }); else await yes.click();
      }
      let peer;
      if (condition === 'two-tabs') {
        peer = await setup(browser, origin, role, width, t.state);
        await peer.page.evaluate(() => onCalViewChange('organizer'));
        await peer.page.locator('[data-comments-btn="' + id + '"]').filter({ visible: true }).click();
        await peer.page.locator('#calCommentComposer').waitFor({ state: 'visible' });
        await peer.page.evaluate(() => _calSetComposeComp('caption'));
        await peer.page.locator('#calCommentComposer').fill('Peer dialog words'); await peer.page.locator('#calCommentComposer').press('Enter');
      }
      const landed = () => {
        const notes = JSON.parse(row.caption_tweaks || '[]');
        return kind === 'delete' ? !!notes.find(n => n.id === rootId && n.deleted) : notes.some(n => n.body === text && (kind === 'reply' || n.id === rootId));
      };
      const errorVisible = async () => {
        const failed = await t.page.locator('#calCommentsModal .sv-note-outbox.is-failed:visible').count();
        const overlay = t.page.locator('#confirmOverlay.active');
        const notice = await overlay.count() ? await overlay.innerText() : '';
        return failed > 0 || /not (saved|sent)|could(n.t| not) (save|send)|try again|refused|failed/i.test(notice);
      };
      try {
        if (condition === 'drop-before' || condition === 'drop-after') {
          await until(() => t.state.attempts.length > n, 'dialog save was not attempted');
          await t.page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
        }
        await until(async () => landed() || await errorVisible(), 'dialog save neither landed nor showed an error', 18000);
        await sleep(['drop-before', 'drop-after'].includes(condition) ? 7000 : 700);
        if (condition === 'refused') {
          assert.ok(!landed(), 'refused dialog mutation committed');
          if (kind === 'delete') {
            const notice = await t.page.locator('#confirmOverlay').textContent();
            assert.ok(!/native note is safe|retry automatically/i.test(notice), 'refused delete claimed an acknowledged native write');
          }
        }
        if (!landed()) {
          assert.ok(await errorVisible(), 'silent dialog failure');
          if (kind !== 'delete') {
            const words = await t.page.locator('#calCommentsOverlay').textContent() + await box.inputValue();
            assert.ok(words.includes(text), 'dialog words lost');
          }
        } else if (kind !== 'delete') {
          const matches = JSON.parse(row.caption_tweaks).filter(n => n.body === text);
          assert.equal(matches.length, 1, 'duplicate dialog note'); assert.equal(matches[0].parent_id, kind === 'reply' ? rootId : null); assert.equal(matches[0].role, 'client');
        }
        for (const [k, status] of Object.entries(statuses)) assert.equal(row[k + '_status'], status, 'dialog changed a part status');
        if (peer) {
          await until(() => JSON.parse(row.caption_tweaks || '[]').some(n => n.body === 'Peer dialog words'), 'peer dialog note lost');
          assert.deepEqual(peer.errors, []);
        }
      } finally { if (peer) await peer.ctx.close(); }
    });
  }
}
// Enumerate from the owning tables rather than keeping a second list that can drift.
const refusalSource = fs.readFileSync(path.join(__dirname, '../src/index/120-calendar-flags-write-repair.js.part'), 'utf8');
const refusalTables = refusalSource.slice(refusalSource.indexOf('const WRITE_UI_FAILURE_CODE_CLASS'), refusalSource.indexOf('function _writeUiFailureText'));
const refusalTableCode = require('./helpers/strip-comments').stripComments(refusalTables, ' ');
const refusalCodes = [...new Set([
  ...[...refusalTableCode.matchAll(/'([a-z][a-z0-9]+(?:_[a-z0-9]+)+)'/g)].map(m => m[1]),
  ...[...refusalTableCode.matchAll(/^\s+([a-z][a-z0-9]+(?:_[a-z0-9]+)+):\s*\{/gm)].map(m => m[1])
])].sort();
async function refusals(browser, origin, role, width) {
  await runCase(browser, origin, role, width, 'every known refusal code renders and preserves typed text (' + refusalCodes.length + ')', async t => {
    await inS(t.page, '#ta').fill('Words kept through every refusal 👋');
    const results = await t.page.evaluate(async ({ codes, role }) => {
      const out = [];
      for (const code of codes) {
        const copy = _writeUiFailureText('comment', code, 409);
        const words = role === 'client' ? _calCrqClientWords(copy.text + ' (code: ' + code + ')').text : copy.text;
        showNotify('Not saved', words);
        const box = document.getElementById('confirmOverlay');
        out.push({ code, open: box.classList.contains('active'), text: box.textContent, draft: document.getElementById('svReviewStage').shadowRoot.getElementById('ta').value });
        dismissConfirm();
      }
      return out;
    }, { codes: refusalCodes, role });
    assert.equal(results.length, refusalCodes.length);
    for (const r of results) {
      assert.ok(r.open && r.text.trim().length > 30 && !/undefined/.test(r.text), 'bad refusal copy: ' + r.code);
      assert.equal(r.draft, 'Words kept through every refusal 👋', 'refusal discarded draft: ' + r.code);
      if (role === 'client') assert.ok(!r.text.includes(r.code), 'raw code exposed to client: ' + r.code);
    }
    assert.equal(t.state.attempts.length, 0, 'rendering a refusal must never write');
  });
}
(async () => {
  if (process.env.G3_MODE && !['matrix', 'regressions', 'auxiliary', 'refusals', 'dialogs'].includes(process.env.G3_MODE)) throw Error('Unknown G3_MODE');
  if (process.env.G3_CONDITIONS && process.env.G3_CONDITIONS.split(',').some(c => !conditions.includes(c))) throw Error('Unknown G3_CONDITIONS');
  if (process.env.G3_ROLES && process.env.G3_ROLES.split(',').some(r => !['client', 'kasper'].includes(r))) throw Error('Unknown G3_ROLES');
  if (process.env.G3_REPEAT && !/^(?:[1-9]|1[0-9]|20)$/.test(process.env.G3_REPEAT)) throw Error('G3_REPEAT must be 1 to 20');
  const server = await serveStatic(), origin = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const name of (process.env.G3_ENGINES || 'chromium,firefox,webkit').split(',')) {
      const browser = await engines[name].launch();
      try { for (const width of (process.env.G3_WIDTHS || '1024,1440,1920').split(',').map(Number)) for (const role of (process.env.G3_ROLES || 'client,kasper').split(',')) {
        if (!process.env.G3_MODE || process.env.G3_MODE === 'regressions') await regressions(browser, origin, role, width);
        if (!process.env.G3_MODE || process.env.G3_MODE === 'matrix') await matrix(browser, origin, role, width);
        if (!process.env.G3_MODE || process.env.G3_MODE === 'auxiliary') await auxiliary(browser, origin, role, width);
        if (!process.env.G3_MODE || process.env.G3_MODE === 'dialogs') await dialogMatrix(browser, origin, role, width);
        if (!process.env.G3_MODE || process.env.G3_MODE === 'refusals') await refusals(browser, origin, role, width);
      } }
      finally { await browser.close(); }
    }
  } finally { server.close(); }
  if (!passed && !failures.length) throw Error('No test cases selected');
  console.log(JSON.stringify({ passed, failed: failures.length, failures }));
  process.exitCode = failures.length ? 1 : 0;
})().catch(e => { console.error(String(e.message).split('\n')[0]); process.exitCode = 1; });
