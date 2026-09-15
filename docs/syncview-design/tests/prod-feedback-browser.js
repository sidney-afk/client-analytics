'use strict';
// Actual renderer, normalizer, paging/cache and request loader from index.html.
// The surrounding app router and backend are finite fixtures. This is component
// browser proof, not a boot, live delivery, or retention/history claim.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
function between(a, b) {
  const start = source.indexOf(a); const end = source.indexOf(b, start + a.length);
  assert(start >= 0 && end > start, 'actual source boundary required');
  return source.slice(start, end);
}
const renderCode = between('function _prodLinkifyInline(', 'function _prodIssueClientCommentSurfaceKnown(');
const loaderCode = between('function _prodFeedbackState(', 'function _prodCanonicalCardComment(');
const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
const scope = { surface: 'calendar', card_id: 'fixture-card', component: 'video', deliverable_id: 'fixture-issue', client_slug: 'fixture-client' };
const row = (id, extra = {}) => ({ id, author_name: 'Fixture reviewer', body: 'Feedback ' + id, audience: 'internal', source_created_at: '2026-09-01T12:00:00.000Z', updated_at: '2026-09-01T12:00:00.000Z', version: 1, is_tweak: false, ...extra });
const sourceRow = (id, extra = {}) => row(id, { source_only: true, source_surface: 'calendar', component: 'video', can_edit: false, can_delete: false, can_resolve: false,
  ...(extra.covered_by ? { covered_version: 1, covered_updated_at: '2026-09-01T12:00:00.000Z' } : {}), ...extra });
let reply = {}, requests = [], hold = null, release = null, errors = [], escaped = 0, checks = 0;
async function check(label, fn) { await fn(); checks++; console.log('  ok  ' + label); }
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      if (route.request().url() !== 'https://fixture.invalid/production-comments') { escaped++; await route.abort(); return; }
      requests.push(JSON.parse(route.request().postData()));
      if (hold) { const pending = hold; hold = null; await pending; }
      await route.fulfill({ status: reply.http || 200, contentType: 'application/json', body: JSON.stringify(reply) });
    });
    await page.setContent('<!doctype html><html><head><style>' + styles + '</style></head><body><div id="productionView" class="prod-view" style="display:block"><div class="prod-app"><main class="prod-detail-inner" style="max-width:760px;margin:auto;padding:16px"><div class="prod-activity" id="feedback"></div></main></div></div></body></html>');
    await page.addScriptTag({ content: `
      const CAL_SUPABASE_ANON_KEY = 'fictional';
      const PROD_COMMENTS_EF_URL = 'https://fixture.invalid/production-comments';
      const PROD_COMMENTS_PAGE_SIZE = 50, PROD_COMMENTS_READ_TIMEOUT_MS = 15000;
      let _isClientLink = false, actor = { role: 'smm', member: { id: 'fixture-a' } };
      const _prodState = { openId: 'fixture-issue' };
      const _syncviewStaffIdentityForHeaders = () => actor;
      const _syncviewEfHeaders = headers => headers;
      const _syncviewClientWriteToken = () => 'fictional-client';
      const _syncviewOpenStaffIdentity = async () => {};
      const _prodIssue = id => ({ id, team: 'video', raw: { origin: 'calendar', card_id: 'fixture-card', client_slug: 'fixture-client' } });
      const _prodClientCommentSurfaceKey = value => value ? [value.source_surface, value.card_id, value.component].join('|') : '';
      const _prodAvatar = () => '<span class="prod-avatar empty" style="width:18px;height:18px"></span>';
      let mutationButtons = 0;
      const _prodCommentBegin = () => { mutationButtons++; };
      const _prodCommentLifecycle = () => { mutationButtons++; };
      ${['_calEsc', '_calEscAttr', '_jsAttrArg'].map(name => source.match(new RegExp('^\\s*function ' + name + '\\([^\\n]+', 'm'))[0]).join('\n')}
      ${between('function _prodHashText(', 'function _prodInitials(')}
      ${between('function _prodFileLinkLabel(', 'function _prodAssetsPanelHTML(')}
      ${renderCode}
      ${loaderCode}
      ${between('const PROD_FOCUS_VOLATILE_ATTR =', 'function _prodFocusDescriptionControl(')}
      function _prodRender() { const root = document.querySelector('#feedback'); const focus = _prodCaptureFocus(root);
        root.innerHTML = '<h2>Feedback &amp; tweaks</h2>' + _prodComments.render('fixture-issue'); _prodRestoreFocus(focus, root); }
      window.feedbackLoad = () => _prodComments.readCanonical('fixture-issue');
      window.feedbackRefresh = () => _prodComments.refresh('fixture-issue');
      window.feedbackReset = () => { _isClientLink = false; actor = { role: 'smm', member: { id: 'fixture-a' } }; _prodComments.clear(); _prodComments.ensure('fixture-issue'); };
    ` });
    const settled = () => page.waitForSelector('[data-prod-comments-state="ready"]', { state: 'attached' });
    const reset = async (response) => { reply = response; await page.evaluate(() => feedbackReset()); await settled(); };
    const feedback = (status, rows = [], extra = {}) => ({ version: 1, status, complete: status === 'complete', scope, rows, ...extra });
    await check('canonical and unmatched source notes remain visible with exact source labels', async () => {
      await reset({ comments: [row('canonical', { feedback_origin: 'linear' }), row('unknown')], has_more: false,
        feedback: feedback('complete', [sourceRow('plain'), sourceRow('tweak', { is_tweak: true, round: 2 })]) });
      assert.equal(await page.locator('[data-prod-comment-id]').count(), 4);
      assert.match(await page.locator('#feedback').innerText(), /Origin unverified/);
      assert.match(await page.locator('[data-prod-comment-id="tweak"]').innerText(), /Round 2/);
      assert.equal(await page.locator('.prod-feedback-source button').count(), 0);
      assert(requests.at(-1).include_feedback === true);
    });
    await check('only proven identity coverage hides a source copy; equal text remains', async () => {
      await reset({ comments: [row('canonical', { body: 'Equal body' })], has_more: false,
        feedback: feedback('complete', [sourceRow('covered', { covered_by: 'canonical', body: 'Equal body' }), sourceRow('distinct', { body: 'Equal body' })]) });
      assert.equal(await page.locator('[data-prod-comment-id="covered"]').count(), 0);
      assert.equal(await page.locator('[data-prod-comment-id="distinct"]').count(), 1);
    });
    await check('canonical pagination cannot hide a source twin before its canonical page loads', async () => {
      await reset({ comments: [row('new')], has_more: true, next_cursor: { id: 'new', created_at: '2026-09-01T12:00:00Z' },
        feedback: feedback('complete', [sourceRow('old-source', { covered_by: 'old' })]) });
      assert.equal(await page.locator('[data-prod-comment-id="old-source"]').count(), 1);
      reply = { comments: [row('old')], has_more: false, feedback: feedback('complete', [sourceRow('old-source', { covered_by: 'old' })]) };
      await page.locator('[data-prod-comments-more]').click();
      await page.waitForSelector('[data-prod-comment-id="old"]');
      assert.equal(await page.locator('[data-prod-comment-id="old-source"]').count(), 0);
      assert.equal(await page.locator('[data-prod-comment-id="new"]').count(), 1);
    });
    await check('canonical-only refresh and write adoption cannot reuse an earlier coverage revision', async () => {
      await reset({ comments: [row('revision')], has_more: false, feedback: feedback('complete', [sourceRow('original', { covered_by: 'revision' })]) });
      assert.equal(await page.locator('[data-prod-comment-id="original"]').count(), 0);
      reply = { comments: [row('revision', { body: 'Changed body', version: 2, resolved_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-02T00:00:00Z' })], has_more: false };
      await page.evaluate(() => feedbackLoad());
      assert.equal(await page.locator('[data-prod-comment-id="original"]').count(), 1);
      await reset({ comments: [row('revision')], has_more: false, feedback: feedback('complete', [sourceRow('original', { covered_by: 'revision' })]) });
      await page.evaluate(changed => _prodComments.adopt('fixture-issue', changed), row('revision', { version: 2, updated_at: '2026-09-02T00:00:00Z' }));
      assert.equal(await page.locator('[data-prod-comment-id="original"]').count(), 1);
    });
    await check('old responses and malformed pagination never claim source completeness or empty', async () => {
      await reset({ comments: [row('old-api')], has_more: true });
      assert.equal(await page.locator('[data-prod-feedback-state="incomplete"]').count(), 1);
      assert.equal(await page.locator('[data-prod-comment-id="old-api"]').count(), 1);
      await reset({ comments: [], has_more: false, feedback: feedback('source_unavailable') });
      assert.equal(await page.locator('[data-prod-comments-state="empty"]').count(), 0);
      assert.match(await page.locator('#feedback').innerText(), /could not load/);
    });
    await check('source read failure retains prior content as stale; link change clears it', async () => {
      await reset({ comments: [row('kept')], has_more: false, feedback: feedback('complete', [sourceRow('prior-source')]) });
      reply = { comments: [], has_more: false, feedback: feedback('source_unavailable') };
      await page.evaluate(() => feedbackRefresh()); await page.waitForFunction(() => document.querySelector('#feedback').textContent.includes('Previously loaded'));
      assert.equal(await page.locator('[data-prod-comment-id="prior-source"]').count(), 1);
      assert.equal(await page.locator('[data-prod-comment-id="kept"]').count(), 1);
      reply = { comments: [], has_more: false, feedback: feedback('link_changed') };
      await page.evaluate(() => feedbackRefresh()); await page.waitForFunction(() => document.querySelector('#feedback').textContent.includes('link has changed'));
      assert.equal(await page.locator('[data-prod-comment-id="prior-source"]').count(), 0);
    });
    await check('failed canonical refresh keeps both sets and exposes retry', async () => {
      await reset({ comments: [row('retained')], has_more: false, feedback: feedback('complete', [sourceRow('retained-source')]) });
      reply = { http: 500 }; await page.evaluate(() => feedbackRefresh());
      await page.waitForFunction(() => document.querySelector('#feedback').textContent.includes('could not refresh'));
      assert.equal(await page.locator('[data-prod-comment-id]').count(), 2);
      assert.equal(await page.locator('[data-prod-feedback-state="incomplete"]').count(), 1);
    });
    await check('partial or size-limited refresh retains scoped stale rows only with explicit permission', async () => {
      await reset({ comments: [], has_more: false, feedback: feedback('complete', [sourceRow('known')]) });
      for (const status of ['source_incomplete', 'source_limit']) {
        reply = { comments: [], has_more: false, feedback: feedback(status, [], { retain_previous: true }) };
        await page.evaluate(() => feedbackRefresh()); await page.waitForTimeout(80);
        assert.equal(await page.locator('[data-prod-comment-id="known"]').count(), 1);
        assert.match(await page.locator('#feedback').innerText(), /may be out of date/);
        assert.equal(await page.locator('[data-prod-feedback-state="incomplete"]').count(), 1);
      }
      reply = { comments: [], has_more: false, feedback: feedback('source_incomplete', [], { retain_previous: false }) };
      await page.evaluate(() => feedbackRefresh()); await page.waitForTimeout(80);
      assert.equal(await page.locator('[data-prod-comment-id="known"]').count(), 0);
    });
    await check('source replies and deleted parents retain structure without body or mutation leak', async () => {
      await reset({ comments: [], has_more: false, feedback: feedback('complete', [sourceRow('parent', { deleted: true, body: 'DELETE CANARY' }),
        sourceRow('reply', { parent_id: 'parent' }), sourceRow('orphan', { parent_id: 'absent', parent_unavailable: true }),
        sourceRow('unknown-tweak', { is_tweak: null, can_edit: true, can_delete: true, can_resolve: true })]) });
      assert.equal(await page.locator('.prod-feedback-source .is-reply').count(), 2);
      assert(!((await page.locator('#feedback').innerText()).includes('DELETE CANARY')));
      assert.equal(await page.locator('.prod-feedback-source button').count(), 0);
      assert(!((await page.locator('[data-prod-comment-id="unknown-tweak"]').innerText()).includes('Open')));
    });
    await check('late identity replacement cannot repaint prior-scope feedback', async () => {
      hold = new Promise(resolve => { release = resolve; }); reply = { comments: [row('STALE')], has_more: false, feedback: feedback('complete', [sourceRow('STALE-SOURCE')]) };
      const before = requests.length; await page.evaluate(() => feedbackRefresh());
      while (requests.length === before) await page.waitForTimeout(5);
      await page.evaluate(() => { actor = { role: 'smm', member: { id: 'fixture-b' } }; });
      release(); await page.waitForTimeout(100);
      assert.equal(await page.locator('[data-prod-comment-id]').count(), 0);
    });
    await check('client canonical adapter neither requests nor renders source projection', async () => {
      reply = { comments: [row('client', { audience: 'client' }), row('PRIVATE')], canonical_thread: true, audience_scope: 'client',
        feedback: feedback('complete', [sourceRow('PRIVATE-SOURCE')]) };
      await page.evaluate(async () => { _prodComments.clear(); _isClientLink = true;
        await _prodComments.readCanonical('fixture-issue', { clientSurface: { source_surface: 'sxr', card_id: 'fixture-card', component: 'video' } }); });
      assert.equal(requests.at(-1).include_feedback, undefined);
      assert.equal(await page.locator('[data-prod-comment-id="client"]').count(), 1);
      assert.equal(await page.locator('[data-prod-comment-id="PRIVATE"], [data-prod-comment-id="PRIVATE-SOURCE"]').count(), 0);
    });
    await check('keyboard retry and 360/768/desktop light/dark layouts preserve readable content', async () => {
      await reset({ comments: [row('layout')], has_more: false, feedback: feedback('source_incomplete', [sourceRow('mobile', { body: 'A long reviewer note '.repeat(24), is_tweak: true, round: 2 })]) });
      for (const width of [360, 768, 1280]) for (const dark of [false, true]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(isDark => { document.documentElement.classList.toggle('dark', isDark); document.body.classList.toggle('dark-mode', isDark); document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light'); }, dark);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        assert.equal(overflow, false, 'component overflow at ' + width);
        const button = page.getByRole('button', { name: 'Refresh feedback' }); await button.focus();
        assert(await button.evaluate(el => el === document.activeElement)); assert((await button.boundingBox()).height >= 44);
        if (process.env.FEEDBACK_SCREENSHOTS === '1') {
          const out = path.join(root, '.codex-tmp/feedback-review'); fs.mkdirSync(out, { recursive: true });
          await page.screenshot({ path: path.join(out, `feedback-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
        }
      }
      reply = { comments: [row('keyboard')], has_more: false, feedback: feedback('complete') };
      await page.keyboard.press('Enter'); await page.waitForSelector('[data-prod-comment-id="keyboard"]');
    });
    await check('existing focus restoration keeps the feedback retry across failed refresh', async () => {
      await reset({ comments: [row('focus')], has_more: false, feedback: feedback('source_unavailable') });
      await page.getByRole('button', { name: 'Refresh feedback' }).focus();
      await page.keyboard.press('Enter'); await page.waitForTimeout(100);
      assert(await page.getByRole('button', { name: 'Refresh feedback' }).evaluate(el => el === document.activeElement));
    });
    assert.deepEqual(errors, []); assert.equal(escaped, 0);
    console.log(`Production feedback browser: ${checks} PASS; actual component source, fictional transport, zero external requests.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
