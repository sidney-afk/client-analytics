'use strict';

// Disposable client review smoke. Reuses the maintained click/readback/cleanup
// helpers. Reads the existing TEST token in memory with the operator's service
// credential; it does not mint or rotate a link and cannot prove issuance.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const H = require('./ot4_lib');
const { TEST_CLIENT, gotoTestClientEntry } = require('../test-client-entry');
const { serveStatic } = require('../../docs/syncview-design/tests/prod-test-utils');

async function existingToken() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(key, 'SUPABASE_SERVICE_ROLE_KEY is required; credentials stay in memory');
  const response = await fetch(`${H.SUPA}/rest/v1/client_access?slug=eq.${encodeURIComponent(TEST_CLIENT.slug)}&select=review_token`, {
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  assert.equal(response.status, 200, 'existing TEST link read');
  const rows = await response.json();
  assert(rows.length === 1 && rows[0].review_token, 'one existing TEST token');
  return rows[0].review_token;
}

async function actWhenReady(page, name, component, action, text) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await H.clientAct(page, name, component, action, text);
    if (result !== 'disabled') { console.log('Control readiness: ' + action + '=' + result); return result; }
    await H.sleep(1000);
  }
  console.log('Control readiness: ' + action + '=disabled');
  return 'disabled';
}

async function run() {
  const token = await existingToken();
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(k)));
  let browser;
  let activePage;
  let phase = 'preflight';
  const seeds = [];
  let checks = 0;
  const check = (condition, message) => { assert(condition, message); checks++; console.log('PASS ' + message); };
  try {
    browser = await H.PW.chromium.launch({ headless: true, env: safeEnv });
    const surfaces = process.env.ASSURANCE_SURFACE === 'sample-reviews' ? ['sample-reviews'] : ['calendar', 'sample-reviews'];
    for (const surface of surfaces) {
      phase = surface + ': seed';
      const id = 'sr_assurance_' + crypto.randomUUID();
      const name = 'Assurance disposable ' + crypto.randomUUID();
      const calendar = surface === 'calendar';
      const up = calendar ? H.upCal : H.up;
      const read = calendar ? H.rowCal : H.rowSxr;
      seeds.push({ id, calendar });
      up({ id, name, platforms: 'youtube', scheduled_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        video_status: calendar ? 'Approved' : 'Client Approval', graphic_status: calendar ? 'Approved' : 'Client Approval', caption_status: calendar ? 'Client Approval' : 'Approved', status: 'Client Approval',
        caption: 'Disposable assurance caption', thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' });
      const seeded = await H.pollRow(() => read(id, 'id,status'), r => r.status === 'Client Approval', 35000);
      check(seeded && seeded.status === 'Client Approval', surface + ': disposable seed persisted');
      const context = await browser.newContext({ timezoneId: 'America/Guatemala', viewport: { width: 1200, height: 900 } });
      const page = await context.newPage();
      activePage = page;
      const errors = [];
      const violations = [];
      page.on('pageerror', () => errors.push('pageerror'));
      await context.route('**/*', route => {
        const req = route.request();
        if (/\/functions\/v1\/write-diagnostics(?:\?|$)/.test(req.url())) {
          let body; try { body = req.postDataJSON(); } catch (_) { body = {}; }
          console.log('Captured diagnostic: ' + JSON.stringify({ code: body.code, surface: body.surface, operation: body.operation, status: body.status }));
          return route.fulfill({ status: 202, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true}' });
        }
        if (/api\.linear\.app|webhook\/linear-|send-urgent|slack/i.test(req.url())) {
          violations.push('forbidden external action');
          return route.abort();
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method())) {
          let body; try { body = JSON.parse(req.postData() || '{}'); } catch (_) { violations.push('unparseable mutation'); return route.abort(); }
          for (const field of ['client', 'client_slug', 'slug']) {
            if (body[field] && ![TEST_CLIENT.slug, TEST_CLIENT.name].includes(body[field])) {
              violations.push('other-client mutation'); return route.abort();
            }
          }
          if (/rest\/v1\//.test(req.url())) { violations.push('direct browser REST mutation'); return route.abort(); }
          if (!/\/functions\/v1\/(client-token-verify|analytics-read|thumbnail-revision-read|calendar-upsert|sample-review-upsert)(?:\?|$)/.test(req.url())) {
            violations.push('unexpected endpoint mutation: ' + new URL(req.url()).pathname.replace(/[^a-z0-9/_-]/gi, '')); return route.abort();
          }
        }
        return route.continue();
      });
      await gotoTestClientEntry(page, { origin, view: surface, token, gotoOptions: { waitUntil: 'domcontentloaded', timeout: 45000 } });
      phase = surface + ': review controls';
      await H.expandReview(page, name);
      const component = calendar ? 'caption' : 'graphic';
      const panel = await H.panelState(page, name, component);
      check(panel.panel && panel.approveEnabled, surface + ': strict client link loads review controls');
      const media = await page.waitForFunction(n => {
        const c = [...document.querySelectorAll('.cal-review-card')].find(c => c.querySelector('.kcard-title')?.textContent === n);
        return !!c && [...c.querySelectorAll('img')].some(i => /ytimg|youtube/.test(i.src) && i.complete && i.naturalWidth > 0);
      }, name, { timeout: 20000 }).then(() => true).catch(() => false);
      check(media, surface + ': client thumbnail renders real image bytes');
      phase = surface + ': save';
      const comment = 'Disposable assurance comment';
      check(await actWhenReady(page, name, component, 'comment', comment) === 'ok', surface + ': comment control clicked');
      const commented = await H.pollRow(() => read(id, component + '_tweaks,' + component + '_status'), r => JSON.stringify(r[component + '_tweaks']).includes(comment), 35000);
      check(commented && JSON.stringify(commented[component + '_tweaks']).includes(comment) && commented[component + '_status'] === 'Client Approval', surface + ': comment persisted without a status change');
      await H.sleep(4000);
      const readiness = await page.evaluate(([name, component, calendar]) => {
        const state = calendar ? _calReviewState : _sxrReviewState;
        const posts = calendar ? calState.posts : sxrState.posts;
        const post = posts.find(p => p.name === name);
        const key = post && post.id + '|' + component;
        const card = [...document.querySelectorAll('.cal-review-card')].find(c => c.querySelector('.kcard-title')?.textContent === name);
        const panel = card?.querySelector('[data-comp="' + component + '"]');
        return { saving: !!state.saving[key], draft: !!String(state.drafts[key] || '').trim(), approveDisabled: panel?.querySelector('.cal-review-approve-btn')?.disabled };
      }, [name, component, calendar]);
      console.log('Post-comment readiness: ' + JSON.stringify(readiness));
      check(!readiness.saving && !readiness.draft && readiness.approveDisabled === false, surface + ': settled comment releases visible approval controls');
      const action = calendar ? 'approve' : 'request';
      const expected = calendar ? 'Approved' : 'Tweaks Needed';
      const text = 'Disposable assurance request';
      check(await actWhenReady(page, name, component, action, text) === 'ok', surface + ': review control clicked');
      const cols = calendar ? 'caption_status,client_caption_approved_at' : 'graphic_status,graphic_tweaks';
      const approved = await H.pollRow(() => read(id, cols), r => r[component + '_status'] === expected, 35000);
      check(approved && approved[component + '_status'] === expected && (calendar ? approved.client_caption_approved_at : JSON.stringify(approved.graphic_tweaks).includes(text)), surface + ': review data persisted');
      await H.sleep(4000);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const held = await H.pollRow(() => read(id, component + '_status'), r => r[component + '_status'] === expected, 10000);
      check(held && held[component + '_status'] === expected, surface + ': review holds after reload');
      if (calendar) {
        up({ id, caption_status: 'Client Approval', status: 'Client Approval', client_caption_approved_at: null });
        const reset = await H.pollRow(() => read(id, 'caption_status'), r => r.caption_status === 'Client Approval', 35000);
        check(reset && reset.caption_status === 'Client Approval', 'calendar: disposable caption reset for request-change proof');
        await page.reload({ waitUntil: 'domcontentloaded' });
        check(await actWhenReady(page, name, 'caption', 'request', text) === 'ok', 'calendar: request-change control clicked');
        const requested = await H.pollRow(() => read(id, 'caption_status,caption_tweaks'), r => r.caption_status === 'Tweaks Needed' && JSON.stringify(r.caption_tweaks).includes(text), 35000);
        check(requested && requested.caption_status === 'Tweaks Needed' && JSON.stringify(requested.caption_tweaks).includes(text), 'calendar: request-change status and text persisted');
        await H.sleep(4000);
      }
      if (violations.length) console.error('Guard refusals: ' + violations.join('; '));
      check(errors.length === 0 && violations.length === 0, surface + ': zero page errors or prohibited actions');
      await context.close();
    }
  } catch (error) {
    console.error('FAILED phase: ' + phase);
    if (activePage && process.env.ASSURANCE_PRIVATE_SCREENSHOT) {
      await activePage.screenshot({ path: process.env.ASSURANCE_PRIVATE_SCREENSHOT }).catch(() => {});
    }
    throw new Error('Client review assurance phase failed');
  } finally {
    if (browser) await browser.close();
    for (const seed of seeds) {
      if (seed.calendar) H.archiveCalSafe(seed.id); else H.archiveSafe(seed.id);
      const row = (seed.calendar ? H.rowCal : H.rowSxr)(seed.id, 'status');
      check(row && row.status === 'Archived', 'disposable seed archived and read back');
    }
    await new Promise(resolve => server.close(resolve));
  }
  console.log(`Client review assurance: ${checks} checks passed; existing link only; issuance and native video/graphic saves remain separate.`);
}

if (require.main === module) run().catch(error => { console.error('Client review assurance FAILED: ' + (error instanceof assert.AssertionError ? 'preflight assertion' : error.message === 'fetch failed' ? 'preflight transport' : 'phase failure') + '; protected URLs and response bodies omitted.'); process.exitCode = 1; });
module.exports = { existingToken, run };
