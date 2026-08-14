// ot4_t1_submit_intake_guards.js -- TIER 1: the real client intake route.
//
// This is intentionally NOT built on ot4_lib.open(): that helper seeds a
// staff session for the Samples/Calendar probes.  A fresh context here proves
// the failing production route instead:
//   ?intake=1#linear, no staff identity, a non-rerouted client, and the live
//   write_ui_reroute_clients shape ({ clients: ['sidneylaruel'] }).
//
// Every remote request is intercepted.  The two F44 legacy writers return a
// strict durable-create response; the protected filming-plans function and
// native gateway are counted and fail closed if the browser ever reaches them.
'use strict';

const fs = require('fs');
const H = require('./ot4_lib.js');
const { launch, ORIGIN, PW } = H;

const C = H.counter();
const t = C.t;
const CLIENT = Object.freeze({ name: 'Lily Baker', slug: 'lilybaker' });
const CORS = Object.freeze({
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'cache-control': 'no-store',
});

function writerConfirmation(body) {
  const parent = body.team === 'video'
    ? '11111111-1111-4111-8111-111111111111'
    : '22222222-2222-4222-8222-222222222222';
  const prefix = body.team === 'video' ? '3' : '4';
  const children = (body.videos || []).map((_, index) =>
    `${prefix}${String(index + 1).padStart(7, '0')}-1111-4111-8111-111111111111`);
  return {
    ok: true,
    status: 'created',
    ledger_status: 'created',
    team: body.team,
    payload_hash: body.payload_hash,
    receipt_key: body.receipt_key,
    idempotency_key: body.idempotency_key,
    receipt_id: 'ot4-client-' + body.team,
    parent: { id: parent },
    child_issue_ids: children,
  };
}

async function json(route, value, status) {
  return route.fulfill({
    status: status || 200,
    contentType: 'application/json',
    headers: CORS,
    body: JSON.stringify(value),
  });
}

async function launchProbeBrowser() {
  try {
    return await launch();
  } catch (error) {
    // The Windows desktop image can have Playwright's package but not its
    // managed Chromium download.  Use a locally installed Chrome only for
    // this probe fallback; normal CI keeps the shared harness launch path.
    const executablePath = [
      process.env.SYNCVIEW_QA_BROWSER,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ].find(candidate => candidate && fs.existsSync(candidate));
    if (!executablePath) throw error;
    return PW.chromium.launch({
      headless: true,
      executablePath,
      args: ['--ignore-certificate-errors', '--disable-gpu'],
    });
  }
}

(async () => {
  const browser = await launchProbeBrowser();
  let context;
  try {
    // Do not use H.open(): it purposefully creates a staff-authenticated
    // context.  This context must have no localStorage or sessionStorage state.
    context = await browser.newContext({
      viewport: { width: 1440, height: 950 },
      ignoreHTTPSErrors: true,
    });

    const calls = {
      flag: 0,
      legacy: [],
      log: 0,
      filmingPlans: 0,
      nativeGateway: 0,
      unexpected: [],
    };

    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = request.url();
      const method = request.method();

      // Keep the actual SPA and its local assets real.
      if (url.startsWith(ORIGIN)) return route.continue();

      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });

      // The production flag is intentionally non-empty, but Lily is not in it.
      // Keyed row: the 2026-08-14 combined priming read selects rows by `key`,
      // so a key-less row would silently read as flag-dark. The
      // client_comment_gateway_enabled row is deliberately ABSENT — absent is
      // OFF, the faithful pre-rollout state.
      if (url.includes('/rest/v1/syncview_runtime_flags') && url.includes('write_ui_reroute_clients')) {
        calls.flag++;
        return json(route, [{ key: 'write_ui_reroute_clients', value: { clients: ['sidneylaruel'] } }]);
      }

      // fetchLinearProjects reads this when the reroute flag is populated.  It
      // contains Lily to prove a normal registry row does not make her native.
      if (url.includes('/rest/v1/clients?')) {
        return json(route, [
          { slug: CLIENT.slug, display_name: CLIENT.name, kind: 'client', active: true },
          { slug: 'sidneylaruel', display_name: 'Sidney Laruel', kind: 'test', active: true },
        ]);
      }

      if (url.includes('/functions/v1/filming-plans')) {
        calls.filmingPlans++;
        return json(route, { ok: false, error: 'probe: protected reader must not be called' }, 403);
      }
      if (url.includes('/functions/v1/production-write')) {
        calls.nativeGateway++;
        return json(route, { ok: false, error: 'probe: native gateway must not be called' }, 500);
      }

      if (/\/webhook\/linear-projects(?:[/?]|$)/.test(url)) {
        return json(route, { projects: [CLIENT.name] });
      }
      if (/\/webhook\/(?:video-form|graphic-form)(?:[/?]|$)/.test(url)) {
        let body = null;
        try { body = JSON.parse(request.postData() || 'null'); } catch {}
        calls.legacy.push({ url, body });
        return json(route, writerConfirmation(body || {}));
      }
      if (/\/webhook\/log-linear-submission(?:[/?]|$)/.test(url)) {
        calls.log++;
        return json(route, { ok: true });
      }

      // The linear fast route starts background reads unrelated to this form.
      // Fulfil them locally so the probe never sends live traffic.  The Chart.js
      // script is only needed by analytics, but returning a tiny valid script
      // avoids a spurious network error during the intake boot.
      if (url.includes('cdn.jsdelivr.net/npm/chart.js')) {
        return route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.Chart=window.Chart||function Chart(){};' });
      }
      if (url.includes('cdn.jsdelivr.net/npm/@supabase/supabase-js')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          body: 'window.supabase={createClient:function(){return {channel:function(){return {on:function(){return this},subscribe:function(){return this}}}}}};',
        });
      }
      if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
        return route.fulfill({ status: 200, contentType: url.includes('fonts.googleapis.com') ? 'text/css' : 'font/woff2', headers: CORS, body: '' });
      }
      if (url.includes('uzltbbrjidmjwwfakwve.supabase.co')) return json(route, []);
      if (url.includes('synchrosocial.app.n8n.cloud')) return json(route, { ok: true });
      if (url.includes('docs.google.com') || url.includes('drive.google.com')) {
        return route.fulfill({ status: 200, contentType: 'text/plain', headers: CORS, body: '' });
      }

      calls.unexpected.push(url);
      return route.abort('blockedbyclient');
    });

    const page = await context.newPage();
    const appErrors = [];
    page.on('console', message => {
      if (message.type() === 'error') appErrors.push(message.text());
    });
    page.on('pageerror', error => appErrors.push(error && error.message || String(error)));

    await page.goto(ORIGIN + '/index.html?intake=1#linear', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !!document.getElementById('linearClientSearch'), { timeout: 20000 });
    await page.waitForFunction(() => {
      const results = document.getElementById('linearSearchResults');
      return results && /Lily Baker/.test(results.textContent || '');
    }, { timeout: 10000 });

    const cleanClient = await page.evaluate(() => {
      const identityKeys = [
        'syncview_staff_identity_v1',
        'syncview_client_credentials_identity_v1',
        'syncview_filming_plans_identity_v1',
      ];
      return {
        intake: document.body.classList.contains('intake-mode'),
        identityKeys: identityKeys.filter(key => localStorage.getItem(key) || sessionStorage.getItem(key)),
        overlay: !!document.querySelector('#staffIdentityOverlay, .staff-auth-overlay'),
      };
    });
    t(cleanClient.intake, 'opened the exact client intake route (?intake=1#linear)');
    t(cleanClient.identityKeys.length === 0, 'fresh context has no staff identity in storage', cleanClient.identityKeys.join(','));
    t(!cleanClient.overlay, 'no staff sign-in dialog appears on intake boot');

    // Select through the rendered client picker rather than invoking a handler.
    const search = page.locator('#linearClientSearch');
    await search.fill('Lily');
    await page.locator('#linearSearchResults .linear-search-suggestion').filter({ hasText: CLIENT.name }).click();
    const selection = await page.evaluate(() => {
      const input = document.getElementById('linearClientSearch');
      const field = document.getElementById('linearFilmingPlansField');
      const display = document.getElementById('linearFilmingPlansDisplay');
      return {
        client: input && input.value,
        slug: input && input.dataset.clientSlug,
        planFieldHidden: !!field && getComputedStyle(field).display === 'none',
        planText: display && display.textContent,
      };
    });
    t(selection.client === CLIENT.name && selection.slug === CLIENT.slug, 'selected non-rerouted client Lily Baker', JSON.stringify(selection));
    t(selection.planFieldHidden, 'intake keeps the staff-only filming-plan field hidden');
    t(/resolved securely when submitted/i.test(selection.planText || ''), 'hidden plan uses server-resolution state, not an empty-map warning', selection.planText);

    await page.locator('#linearSubmitBtnBoth').click();
    await page.waitForFunction(() => !!document.getElementById('linearSuccessBanner'), { timeout: 15000 });

    const finalUi = await page.evaluate(() => ({
      overlay: !!document.querySelector('#staffIdentityOverlay, .staff-auth-overlay'),
      statusText: (document.getElementById('linearStatus') || {}).textContent || '',
      planRequests: performance.getEntriesByType('resource')
        .map(entry => entry.name)
        .filter(name => /functions\/v1\/filming-plans/.test(name)).length,
    }));
    const submittedBodies = calls.legacy.map(call => call.body || {});
    const expectedTeams = submittedBodies.map(body => body.team).sort().join(',');
    t(calls.flag > 0, 'reroute flag was read as {clients:[sidneylaruel]}');
    t(calls.legacy.length === 2 && expectedTeams === 'graphics,video', 'legacy video and graphics writers received the submission', expectedTeams);
    t(submittedBodies.length === 2 && submittedBodies.every(body => body.clientName === CLIENT.name && body.filmingPlans === ''),
      "client submission succeeds with filmingPlans:'' on both legacy writer payloads", JSON.stringify(submittedBodies.map(body => ({ team: body.team, filmingPlans: body.filmingPlans }))));
    t(calls.filmingPlans === 0 && finalUi.planRequests === 0, 'zero protected filming-plans Edge Function requests', calls.filmingPlans);
    t(calls.nativeGateway === 0, 'zero native gateway requests for non-rerouted client', calls.nativeGateway);
    t(!finalUi.overlay, 'no staff dialog appears during submit');
    t(!/Add or reload the filming plan|No create request was sent/i.test(finalUi.statusText), 'submit does not show the obsolete client-side plan refusal', finalUi.statusText);
    t(appErrors.length === 0, '0 browser errors across the clean client intake submit', appErrors[0]);
    t(calls.unexpected.length === 0, 'no unmocked remote request escaped the probe', calls.unexpected[0]);
  } catch (error) {
    t(false, 'EXCEPTION: ' + (error && error.message || error));
  } finally {
    try { if (context) await context.close(); } catch {}
    try { await browser.close(); } catch {}
  }
  console.log(`\npass=${C.ok} fail=${C.fail}`);
  process.exit(C.fail ? 1 : 0);
})();
