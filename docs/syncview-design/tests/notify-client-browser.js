'use strict';
/*
 * "Notify client" button and its confirm box, driven in a real browser. Nothing here reaches a live
 * backend or Slack: the fixture transport answers every request and the client-review-alert Edge
 * Function is a mock that records exactly what the page sends.
 *
 * Proves, on desktop and on a 390px phone, for Calendar and Samples:
 *   - the accent button sits right after Organize (Calendar) / after the view switch (Samples), is
 *     44px tall on a phone, and nothing scrolls sideways;
 *   - it is absent for a signed-in creative (admin and SMM only);
 *   - opening it asks the server for { action, client, surface } and NOTHING else (no channel id,
 *     no address), then shows only the title, the message (bold line and a plain "Review now"
 *     link, no button), a last-sent line when one was really sent, Cancel and Send alert;
 *   - none of the old extra text (subtitle, "Goes to", "opens ... review page") and no preview button;
 *   - inside six hours the last-sent line is the warning, sending is still allowed and sends with
 *     confirm_recent;
 *   - a successful send closes the box and shows the toast "Alert sent"; "bot not in channel",
 *     no private channel, sending switched off, signed-out and offline stay open with a sentence;
 *   - the tag: a linked Slack person is shown first in the message and named in one line, a linked
 *     person outside the channel is warned about, and "nobody is tagged" is said when no one is
 *     linked or tagging is not switched on yet; the requests still carry only action, client,
 *     surface (and confirm_recent), never a person.
 *
 * Run:  node docs/syncview-design/tests/notify-client-browser.js
 * Pictures: set NOTIFY_CLIENT_SHOTS=<dir> to write PNGs.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const { serve, installFixture, BASE_ROW } = require('./client-phone-review-browser');
const { seedStaffGate, seedStaffIdentity } = require('../../../qa/staff-gate-seed');

const shots = process.env.NOTIFY_CLIENT_SHOTS;
let checks = 0;
const ok = (value, message) => { assert(value, message); checks++; };
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const CLIENT = 'Fixture Client';

const HEADLINE = { calendar: 'New content is ready for your review.', samples: 'New samples are ready for your review.' };
function statusBody(surface, over) {
  return Object.assign({
    ok: true, client: 'fixtureclient', surface, headline: HEADLINE[surface], link_label: 'Review now',
    has_channel: true, channel: { name: 'fixture-private', bot_member: true }, link_ready: true,
    last: null, recent: false, recent_hours: 6, log_available: true, sending_enabled: true, can_preview: true,
  }, over || {});
}

async function shot(page, name) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(shots, name + '.png'), animations: 'disabled' });
}

/* One mock for the whole run. `mock` decides the answer; `calls` is what the page sent. */
async function installAlertMock(ctx, mock, calls) {
  await ctx.route('**/functions/v1/client-review-alert', async route => {
    const r = route.request();
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
    calls.push({ body, key: r.headers()['x-syncview-key'] || '', url: r.url() });
    if (mock.offline) return route.abort();
    const answer = mock[body.action] || { status: 200, body: { ok: true } };
    const res = typeof answer === 'function' ? answer(body) : answer;
    return route.fulfill({ status: res.status, headers: CORS, contentType: 'application/json', body: JSON.stringify(res.body) });
  });
}

async function openCalendar(page, origin) {
  await page.goto(origin + '/index.html#calendar', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof navTo === 'function');
  await page.evaluate(() => navTo('calendar'));
  await page.locator('#calView').waitFor();
  await page.evaluate(() => {
    _calInvalidateActiveLoad();
    calState.loading = false; calState.error = '';
    calState.client = 'Fixture Client';
    calState.posts = [];
    calState.view = 'organizer';
    calState.monthFilter = 'all'; calState.statusFilter = 'all';
    _calSavePins(['Fixture Client']);
    _calRenderShell(); _calRenderBody();
  });
}
async function openSamples(page, origin) {
  await page.goto(origin + '/index.html?v=sample-reviews&sxr=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof navTo === 'function' && typeof _sxrSavePins === 'function');
  await page.evaluate(() => { _sxrSavePins(['Fixture Client']); sxrState.client = 'Fixture Client'; navTo('sample-reviews'); });
  await page.locator('#sxrView').waitFor();
  await page.waitForSelector('#sxrNotifyClientBtn', { state:'attached', timeout: 20000 });
}

async function scenario(browser, origin, label, viewport, phone, surface) {
  const ctx = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
  const mock = {}; const calls = [];
  await installFixture(ctx, origin, { ...BASE_ROW, id: 'p_nc_boot' }, [], surface === 'samples' ? 'samples' : 'calendar');
  await seedStaffGate(ctx);
  await installAlertMock(ctx, mock, calls);
  const errors = [];
  const L = label + ' ' + surface;
  const prefix = surface === 'samples' ? 'sxr' : 'cal';
  const btn = '#' + prefix + 'NotifyClientBtn';
  try {
    const page = await ctx.newPage();
    page.on('pageerror', error => errors.push(error.message));
    if (surface === 'samples') await openSamples(page, origin); else await openCalendar(page, origin);
    const exposeNotify = async () => { if(phone && !await page.locator(btn).isVisible()) await page.locator('#'+(surface==='samples'?'sxrView':'calView')+' [data-staff-menu=more]').click(); };
    const openNotify = async () => { await exposeNotify(); await page.locator(btn).click(); };
    await exposeNotify();
    await page.locator(btn).waitFor({ state: 'visible' });

    // ── The button: where it is, what it says, its colour, its size.
    eq((await page.locator(btn).innerText()).trim(), 'Notify client', L + ': button label');
    const geo = await page.evaluate(sel => {
      const b = document.querySelector(sel); const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
      const prev = b.previousElementSibling;
      return { h: Math.round(r.height), bg: cs.backgroundColor, fg: cs.color, prevId: prev ? prev.id : '', prevClass: prev ? prev.className : '',
        token: getComputedStyle(document.documentElement).getPropertyValue('--notify-bg').trim(), overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    }, btn);
    eq(geo.bg, 'rgb(108, 92, 231)', L + ': accent background is the notify token');
    eq(geo.fg, 'rgb(255, 255, 255)', L + ': white label on the accent');
    ok(geo.overflowX <= 0, L + ': nothing scrolls sideways (' + geo.overflowX + ')');
    if (phone) ok(geo.h >= 44, L + ': tap target is at least 44px (' + geo.h + ')');
    if (surface === 'calendar' && !phone) eq(geo.prevId, 'calOrganizeWrap', L + ': sits directly after Organize');
    if (surface === 'samples' && !phone) ok(/cal-view-toggle/.test(geo.prevClass), L + ': sits right after the Review / Sheet switch (' + geo.prevClass + ')');
    await shot(page, `${label}-${surface}-1-toolbar`);

    // ── Opening it: the server is asked for the client and surface and nothing else.
    mock.status = { status: 200, body: statusBody(surface) };
    await openNotify();
    await page.locator('#notifyClientDialog[open] .nc-msg').waitFor();
    eq(calls.length, 1, L + ': one request on open');
    eq(calls[0].body, { action: 'status', client: CLIENT, surface }, L + ': the page sends only action, client and surface');
    ok(calls[0].key.length > 0, L + ': the staff key header is attached');
    ok(/\/functions\/v1\/client-review-alert$/.test(calls[0].url), L + ': goes to the client-review-alert function');
    let text = await page.locator('#notifyClientDialog').innerText();
    ok(text.includes('Notify ' + CLIENT), L + ': title names the client');
    ok(text.includes(HEADLINE[surface]), L + ': the message preview has the bold line');
    eq((await page.locator('#notifyClientDialog .nc-msg-link').innerText()).trim(), 'Review now', L + ': and a plain Review now link on the next line');
    ok(await page.locator('#notifyClientDialog .nc-msg button, #notifyClientDialog .nc-msg-btn').count() === 0, L + ': the preview has no button');
    ok(await page.evaluate(() => { const l = document.querySelector('#notifyClientDialog .nc-msg-link'); const t = document.querySelector('#notifyClientDialog .nc-msg-line'); return l.getBoundingClientRect().top >= t.getBoundingClientRect().bottom - 1; }), L + ': the link sits on the line below the bold line');
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('#notifyClientDialog .nc-msg-line')).fontWeight >= 700), L + ': the first line is bold');
    for (const gone of ['one alert', 'Goes to', '#fixture-private', 'private channel', 'review page', 'Send preview', 'Last sent', 'No ']) ok(!text.includes(gone), L + ': no "' + gone + '" in the box');
    ok(!/C0[A-Z0-9]{6,}|https?:\/\//.test(text), L + ': no channel id and no address in the box');
    ok(await page.locator('#notifyClientDialog .nc-preview').count() === 0, L + ': no preview button, even though the server offers one');
    eq(await page.locator('#notifyClientDialog button').allInnerTexts(), ['Cancel', 'Send alert'], L + ': only Cancel and Send alert');
    ok(!(await page.locator('#notifyClientDialog .nc-send').isDisabled()), L + ': Send alert is ready');
    await shot(page, `${label}-${surface}-2-confirm`);

    // ── Send: once, with confirm_recent false; success closes the box and shows a short toast.
    mock.send = { status: 200, body: { ok: true, sent: true, receipt_saved: true } };
    await page.locator('#notifyClientDialog .nc-send').click();
    await page.waitForFunction(() => !document.querySelector('#notifyClientDialog[open]'));
    eq(calls.length, 2, L + ': exactly one send request');
    eq(calls[1].body, { action: 'send', client: CLIENT, surface, confirm_recent: false }, L + ': send body');
    await page.waitForFunction(() => /Alert sent/.test((document.getElementById('toast') || document.body).innerText));
    ok(await page.evaluate(() => (document.body.innerText.match(/Alert sent/g) || []).length === 1), L + ': the toast says Alert sent');
    await shot(page, `${label}-${surface}-3-sent-toast`);

    // ── Staggered rollout: the page ships on merge, the function later. An older function answers with
    //    `button` and no `link_label`; the link must still read Review now.
    mock.status = { status: 200, body: (() => { const b = statusBody(surface); delete b.link_label; b.button = 'Review now'; return b; })() };
    await openNotify();
    await page.locator('#notifyClientDialog .nc-msg-link').waitFor();
    eq((await page.locator('#notifyClientDialog .nc-msg-link').innerText()).trim(), 'Review now', L + ': an older status answer (button, no link_label) still shows Review now');
    await page.keyboard.press('Escape');

    // ── The tag: who the message at-mentions. The page shows it; it never sends a person.
    calls.length = 0;
    mock.status = { status: 200, body: statusBody(surface, { mention: { available: true, linked: true, name: 'Pat Fixture', in_channel: true } }) };
    await openNotify();
    await page.locator('#notifyClientDialog [data-nc-tag="linked"]').waitFor();
    eq((await page.locator('#notifyClientDialog .nc-msg-line').innerText()).trim(), '@Pat Fixture ' + HEADLINE[surface], L + ': the message preview starts with the mention, like the real one');
    eq((await page.locator('#notifyClientDialog [data-nc-tag="linked"]').innerText()).trim(), 'Tags Pat Fixture so they get a Slack notification.', L + ': one line says who is tagged');
    ok(await page.locator('#notifyClientDialog .nc-warn, #notifyClientDialog .nc-alert').count() === 0, L + ': a linked person in the channel needs no warning');
    ok(!(await page.locator('#notifyClientDialog .nc-send').isDisabled()), L + ': Send alert is ready with a tag');
    await shot(page, `${label}-${surface}-2b-tagged`);
    mock.send = { status: 200, body: { ok: true, sent: true, tagged: true, receipt_saved: true } };
    await page.locator('#notifyClientDialog .nc-send').click();
    await page.waitForFunction(() => !document.querySelector('#notifyClientDialog[open]'));
    eq(calls.map(c => c.body), [{ action: 'status', client: CLIENT, surface }, { action: 'send', client: CLIENT, surface, confirm_recent: false }], L + ': with a tag the page still sends only action, client and surface');
    ok(!/Pat Fixture|U0/.test(JSON.stringify(calls.map(c => c.body))), L + ': no person, name or member id ever leaves the page');
    for (const [over, sel, pattern] of [
      [{ mention: { available: true, linked: true, name: 'Pat Fixture', in_channel: false } }, '[data-nc-tag="not-in-channel"]', /Pat Fixture is not in this client's channel, so the tag will not reach them/],
      [{ mention: { available: true, linked: true, name: null, in_channel: null } }, '[data-nc-tag="linked"]', /^Tags their linked Slack person so they get a Slack notification\.$/],
      [{ mention: { available: true, linked: false, name: null, in_channel: null } }, '[data-nc-tag="none"]', /^Nobody is tagged: this client has no linked Slack person\. An admin can add one in Kasper, Clients, "Slack person to tag"\.$/],
      [{ mention: { available: false, linked: false, name: null, in_channel: null } }, '[data-nc-tag="unavailable"]', /^Nobody is tagged: tagging is not switched on yet\.$/],
    ]) {
      mock.status = { status: 200, body: statusBody(surface, over) };
      await openNotify();
      await page.locator('#notifyClientDialog ' + sel).waitFor();
      ok(pattern.test((await page.locator('#notifyClientDialog ' + sel).innerText()).trim()), L + ': ' + sel + ' reads right');
      ok(!(await page.locator('#notifyClientDialog .nc-send').isDisabled()), L + ': ' + sel + ': sending is never blocked by the tag');
      if (!over.mention.linked) eq((await page.locator('#notifyClientDialog .nc-msg-line').innerText()).trim(), HEADLINE[surface], L + ': ' + sel + ': the message preview has no mention');
      if (sel === '[data-nc-tag="none"]') await shot(page, `${label}-${surface}-2c-untagged`);
      await page.keyboard.press('Escape');
    }

    // ── A last alert older than six hours is one plain short line.
    calls.length = 0;
    mock.status = { status: 200, body: statusBody(surface, { last: { at: new Date(Date.now() - 7 * 3600000).toISOString(), by: 'Earlier SMM', status: 'sent' } }) };
    await openNotify();
    await page.locator('#notifyClientDialog .nc-last').waitFor();
    eq((await page.locator('#notifyClientDialog .nc-last').innerText()).trim(), 'Last sent 7h ago by Earlier SMM', L + ': the last-sent line is short');
    ok(await page.locator('#notifyClientDialog .nc-warn').count() === 0, L + ': and it is not a warning');
    await page.keyboard.press('Escape');

    // ── Inside six hours: the same single short line is the warning; sending is still allowed.
    calls.length = 0;
    mock.status = { status: 200, body: statusBody(surface, { recent: true, last: { at: new Date(Date.now() - 2 * 3600000).toISOString(), by: 'Earlier SMM', status: 'sent' } }) };
    await openNotify();
    await page.locator('#notifyClientDialog .nc-warn').waitFor();
    eq((await page.locator('#notifyClientDialog .nc-warn').innerText()).trim(), 'Last sent 2h ago by Earlier SMM', L + ': the warning is the one short line: when and who');
    ok(await page.locator('#notifyClientDialog .nc-last').count() === 0, L + ': there is only that one line');
    eq((await page.locator('#notifyClientDialog .nc-send').innerText()).trim(), 'Send anyway', L + ': button reads Send anyway');
    ok(!(await page.locator('#notifyClientDialog .nc-send').isDisabled()), L + ': Send anyway is enabled');
    await shot(page, `${label}-${surface}-4-recent`);
    await page.locator('#notifyClientDialog .nc-send').click();
    await page.waitForFunction(() => !document.querySelector('#notifyClientDialog[open]'));
    eq(calls[1].body.confirm_recent, true, L + ': the recent send carries confirm_recent');
    // An alert from a long time ago, or none, never shows a warning.
    mock.status = { status: 200, body: statusBody(surface) };
    await openNotify();
    await page.locator('#notifyClientDialog .nc-msg').waitFor();
    ok(await page.locator('#notifyClientDialog .nc-warn, #notifyClientDialog .nc-last').count() === 0, L + ': nothing sent before means no last-sent line at all');
    await page.keyboard.press('Escape');
    ok(!(await page.locator('#notifyClientDialog[open]').count()), L + ': Escape closes the box');

    // ── Errors, each a sentence in the box. Send stays available after a failed send.
    const failures = [
      ['bot_not_in_channel', 502, /Slack bot is not in this client's channel/],
      ['channel_archived', 502, /channel is archived/],
      ['slack_unconfirmed', 502, /did not confirm the message/],
      ['unauthorized', 401, /staff sign-in is no longer valid/],
      ['log_unavailable', 503, /Could not save a record/],
    ];
    for (const [code, status, pattern] of failures) {
      mock.status = { status: 200, body: statusBody(surface) };
      mock.send = { status, body: { ok: false, error: code } };
      await openNotify();
      await page.locator('#notifyClientDialog .nc-send:not([disabled])').waitFor();
      await page.locator('#notifyClientDialog .nc-send').click();
      await page.locator('#notifyClientDialog .nc-alert').waitFor();
      ok(pattern.test(await page.locator('#notifyClientDialog .nc-alert').innerText()), L + ': ' + code + ' is explained');
      ok(!(await page.locator('#notifyClientDialog .nc-send').isDisabled()), L + ': ' + code + ': Send can be tried again');
      ok(await page.locator('#notifyClientDialog[open]').count() === 1, L + ': ' + code + ' keeps the box open');
      if (code === 'bot_not_in_channel') await shot(page, `${label}-${surface}-5-bot-error`);
      await page.keyboard.press('Escape');
    }
    // The bot is already known to be missing: warned up front, still allowed to try.
    mock.status = { status: 200, body: statusBody(surface, { channel: { name: 'fixture-private', bot_member: false } }) };
    await openNotify();
    await page.locator('#notifyClientDialog .nc-alert').waitFor();
    ok(/Slack bot is not in this client's channel/.test(await page.locator('#notifyClientDialog').innerText()), L + ': known missing bot is warned about up front');
    ok(!(await page.locator('#notifyClientDialog .nc-send').isDisabled()), L + ': and Send stays available (the server decides)');
    await page.keyboard.press('Escape');
    // Things the server already knows make Send unavailable, with the reason.
    for (const [over, pattern] of [
      [{ has_channel: false, channel: { name: null, bot_member: null } }, /no private Slack channel on the roster/],
      [{ link_ready: false }, /no review link yet/],
      [{ sending_enabled: false }, /not switched on yet/],
    ]) {
      mock.status = { status: 200, body: statusBody(surface, over) };
      await openNotify();
      await page.locator('#notifyClientDialog .nc-alert').waitFor();
      ok(pattern.test(await page.locator('#notifyClientDialog .nc-alert').innerText()), L + ': ' + pattern + ' explained');
      ok(await page.locator('#notifyClientDialog .nc-send').isDisabled(), L + ': Send is disabled for ' + pattern);
      await page.keyboard.press('Escape');
    }
    // Signed out / offline while opening.
    mock.status = { status: 401, body: { ok: false, error: 'unauthorized' } };
    await openNotify();
    await page.locator('#notifyClientDialog .nc-alert').waitFor();
    ok(/staff sign-in is no longer valid/.test(await page.locator('#notifyClientDialog').innerText()) && await page.locator('#notifyClientDialog .nc-send').isDisabled(), L + ': a refused status read is explained and cannot send');
    await page.keyboard.press('Escape');
    mock.offline = true;
    await openNotify();
    await page.locator('#notifyClientDialog .nc-alert').waitFor();
    ok(/Could not reach the server/.test(await page.locator('#notifyClientDialog').innerText()), L + ': offline is explained');
    await page.keyboard.press('Escape');
    mock.offline = false;


    ok(errors.length === 0, L + ': no page errors: ' + errors.join(' | '));
  } finally { await ctx.close(); }
}

/* A signed-in creative sees no button on either surface. */
async function creativeSeesNothing(browser, origin) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const member = { id: 'qa_creative', name: 'QA Creative', role: 'creative', team: null };
  await installFixture(ctx, origin, { ...BASE_ROW, id: 'p_nc_boot' }, [], 'calendar');
  await seedStaffIdentity(ctx, member);
  await ctx.route('**/functions/v1/key-verify', route => route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, role: 'creative', member }) }));
  try {
    const page = await ctx.newPage();
    await openCalendar(page, origin);
    await page.waitForTimeout(500);
    ok(await page.locator('#calNotifyClientBtn:visible').count() === 0, 'creative: no Notify client button on Calendar');
    ok(await page.evaluate(() => _syncviewStaffCan('notify-client')) === false, 'creative: the capability is off');
  } finally { await ctx.close(); }
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const [label, viewport, phone] of [['desktop', { width: 1280, height: 900 }, false], ['phone', { width: 390, height: 844 }, true]]) {
      for (const surface of ['calendar', 'samples']) await scenario(browser, origin, label, viewport, phone, surface);
    }
    await creativeSeesNothing(browser, origin);
    console.log(`notify-client-browser: ${checks} checks passed`);
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exit(1); });
