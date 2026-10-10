'use strict';
/*
 * The per-client credentials dialog (Calendar "..." > Client credentials) shows
 * and edits only the client it is open for. Found 2026-10-10 (Digger, bug
 * archaeology, OPEN_REPAIRS 397), same shape as the wrong-client saves of
 * OPEN_REPAIRS 375: something decided after an await which client it belonged to.
 *
 *   1. Close the dialog while client A's list is still loading and open it for
 *      client B: the `loading` mark of A's read was never cleared, so B's read
 *      never started, and A's answer, when it came, filled B's dialog. B's
 *      dialog then listed A's logins and passwords under B's name, and Edit on
 *      one of them saved A's row with B's client, which the gateway accepts
 *      (it finds the row by id and replaces it), so A's login moved to B.
 *   2. Edit, Reveal and Copy password looked a row up in the Kasper store
 *      first. That copy stops refreshing when Kasper is left, so after someone
 *      changed a password, the dialog listed the new one while Copy password
 *      copied the old one and Edit filled in, and saved back, the old one.
 *      The 2026-08-22 fix (`_ccFindIn`) covered Mark reviewed only.
 *
 * Real page, every backend answer local; nothing reaches the live gateway.
 */
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const A = 'Fixture Client A', B = 'Fixture Client B';
const row = (id, client, slug, password) => ({ id, client_slug: slug, client_name: client, platform: 'instagram', label: '', handle: '@' + id, password, status: 'active', notes: '', source: 'manual' });

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  let checks = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
  const lists = [];
  const upserts = [];
  const held = new Map();
  let slugs = null;
  let freshPasswordB = 'pw-b-old';
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
      const req = route.request(); const url = req.url();
      const reply = (body) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (/key-verify/.test(url)) return reply({ ok: true, role: 'admin', member: ADMIN });
      if (/\/rest\/v1\/team_members/.test(url)) return reply([{ ...ADMIN, active: true }]);
      if (/\/functions\/v1\/client-credentials$/.test(url)) {
        const body = JSON.parse(req.postData() || '{}');
        if (body.action === 'list') {
          lists.push(body.client_slug || '*');
          const all = [row('cred_a1', A, slugs.a, 'pw-a'), row('cred_b1', B, slugs.b, freshPasswordB)];
          const answer = { ok: true, credentials: body.client_slug ? all.filter(r => r.client_slug === body.client_slug) : all };
          if (held.has(body.client_slug)) { await held.get(body.client_slug).promise; }
          return reply(answer);
        }
        if (body.action === 'upsert') { upserts.push(body.credential); return reply({ ok: true, credential: body.credential }); }
        return reply({ ok: true });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
    });
    await seedStaffIdentity(context, ADMIN);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.svArea === 'function' || typeof window._ccOpenModalNow === 'function', null, { timeout: 30000 });
    await page.evaluate(() => (typeof window._ccOpenModalNow === 'function' ? null : window.svArea('kasper')));
    await page.waitForFunction(() => typeof window._ccOpenModalNow === 'function', null, { timeout: 30000 });
    slugs = await page.evaluate(([a, b]) => ({ a: calClientSlug(a), b: calClientSlug(b) }), [A, B]);
    ok(slugs.a && slugs.b && slugs.a !== slugs.b, 'two distinct fixture client slugs');
    const modalRows = () => page.evaluate(() => [...document.querySelectorAll('#ccModalBody [data-cc-id], #ccModalBody .cc-row')].map(el => el.getAttribute('data-cc-id') || el.textContent.replace(/\s+/g, ' ').trim()));
    const modalState = () => page.evaluate(() => ({ client: _ccState.modal.client, ids: (_ccState.modal.credentials || []).map(r => r.id), slugs: (_ccState.modal.credentials || []).map(r => r.client_slug), loading: !!_ccState.modal.loading }));

    // 1. Close while A's list is loading, open for B, then A's answer lands.
    let release; held.set(slugs.a, { promise: new Promise(r => { release = r; }) });
    await page.evaluate(a => { _ccOpenModalNow(a); }, A);
    await page.waitForFunction(() => document.getElementById('ccOverlay'));
    for (let i = 0; i < 100 && !lists.includes(slugs.a); i++) await page.waitForTimeout(20);
    ok(lists.includes(slugs.a), "A's list read started");
    await page.evaluate(() => _ccCloseModal());
    await page.evaluate(b => { _ccOpenModalNow(b); }, B);
    await page.waitForFunction(() => document.getElementById('ccOverlay'));
    for (let i = 0; i < 100 && !lists.includes(slugs.b); i++) await page.waitForTimeout(20);
    release(); held.delete(slugs.a);
    await page.waitForTimeout(400);
    const after = await modalState();
    ok(lists.includes(slugs.b), `B's dialog asked for B's list (reads: ${lists.join(', ')}; B's dialog holds ${after.ids.join(', ') || 'nothing'})`);
    ok(after.client === B, 'the dialog is open for B');
    ok(after.ids.length === 1 && after.ids[0] === 'cred_b1' && after.slugs.every(s => s === slugs.b), `B's dialog holds only B's logins, not A's (holds ${after.ids.join(', ') || 'nothing'})`);
    ok(!after.loading, 'the dialog is not left loading');
    const shownText = await page.evaluate(() => (document.getElementById('ccModalBody') || {}).textContent || '');
    ok(!shownText.includes('@cred_a1'), "A's login is not shown in B's dialog");
    ok(shownText.includes('@cred_b1'), "B's login is shown");

    // An Edit from that dialog saves B's row under B.
    await page.evaluate(() => _ccOpenEdit('cred_b1', 'modal'));
    await page.click('#ccEditSave');
    for (let i = 0; i < 100 && !upserts.length; i++) await page.waitForTimeout(20);
    ok(upserts.length === 1 && upserts[0].id === 'cred_b1' && upserts[0].client_slug === slugs.b, 'Edit saves B\'s row under B');
    await page.waitForTimeout(300);
    await page.evaluate(() => _ccCloseModal());

    // 2. The Kasper store holds an older copy of B's row; the dialog holds the fresh one.
    upserts.length = 0;
    await page.evaluate(([b, slug]) => {
      _ccState.kasper.credentials = [{ id: 'cred_b1', client_slug: slug, client_name: b, platform: 'instagram', label: '', handle: '@cred_b1', password: 'pw-b-old', status: 'active', notes: '', source: 'manual' }];
      _ccState.kasper.loaded = true;
    }, [B, slugs.b]);
    freshPasswordB = 'pw-b-new';
    await page.evaluate(b => { _ccOpenModalNow(b); }, B);
    await page.waitForFunction(() => (_ccState.modal.credentials || []).some(r => r.password === 'pw-b-new'), null, { timeout: 10000 });
    await page.evaluate(() => {
      window.__copied = [];
      const real = navigator.clipboard && navigator.clipboard.writeText;
      try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } }); } catch (e) {}
      document.execCommand = () => { const ta = document.querySelector('textarea[style*="-1000px"]'); if (ta) window.__copied.push(ta.value); return true; };
      void real;
    });
    await page.evaluate(() => _ccCopyPassword('cred_b1', 'modal'));
    await page.waitForTimeout(150);
    const copied = await page.evaluate(() => window.__copied.slice());
    ok(copied.length >= 1 && copied.every(t => t === 'pw-b-new'), `Copy password copies the password the dialog lists (copied ${JSON.stringify(copied.map(t => t === 'pw-b-new' ? 'new' : (t === 'pw-b-old' ? 'OLD' : '?')))})`);
    await page.evaluate(() => _ccOpenEdit('cred_b1', 'modal'));
    const prefilled = await page.inputValue('#ccEditPassword');
    ok(prefilled === 'pw-b-new', `Edit fills in the password the dialog lists (filled ${prefilled === 'pw-b-old' ? 'the OLD one' : prefilled})`);
    await page.click('#ccEditSave');
    for (let i = 0; i < 100 && !upserts.length; i++) await page.waitForTimeout(20);
    ok(upserts.length === 1 && upserts[0].password === 'pw-b-new', 'saving that Edit does not write the old password back');

    assert.deepEqual(errors, [], 'no page errors');
    console.log(`credentials-modal-client-switch-browser: ${checks} checks passed ✅`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
