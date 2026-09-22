'use strict';
/* WR-101 browser beacon.

   WHAT THIS PROVES, as of the 2026-09-22 release rewrite: that the beacon
   SHIPPED IN `index.html` -- the real build output, read off disk, not a
   composed string -- reports a refused write once, never retries, stops at its
   per-page budget, sends no prose/name/token, sends the real status, and leaves
   the reply draft and the localStorage ring exactly as they were.

   WHAT IT DOES NOT PROVE: a whole-SPA journey against a hosted gateway. The
   helpers are lifted into an isolated page, every network route is intercepted,
   and the endpoint answers 503 so the no-retry assertion is meaningful. Hosted
   acceptance stays an installation-window requirement.

   It no longer asserts a sha256 of `index.html`. That pin went stale on every
   merge touching any `src/index/` fragment and told us nothing about the
   beacon; reading the built page is both stricter (it fails if the build was
   not run) and stable. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const endpoint = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/write-diagnostics';

function func(text, name) {
  const start = text.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing function in built page: ' + name);
  let depth = 0;
  for (let i = text.indexOf('{', start); i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}' && !(depth -= 1)) return text.slice(start, i + 1);
  }
  throw new Error('missing body: ' + name);
}

function constant(name) {
  const match = new RegExp('const ' + name + ' = [^;]+;').exec(source);
  assert(match, 'missing constant in built page: ' + name);
  return match[0];
}

// The build must have been run: the fragment's beacon has to be in the page.
assert(source.includes('function _writeRefusalBeacon('), 'index.html is stale - run npm run build:index');
assert(source.includes("/functions/v1/write-diagnostics"), 'built page does not carry the diagnostics endpoint');
// The hardcoded 409 of the September 12 preparation must not come back.
assert(!/status:\s*409\b/.test(func(source, '_writeRefusalBeacon')), 'beacon must send the real status, never a hardcoded one');

const names = ['_writeUiDiagnosticIds', '_writeRefusalBeacon', '_writeUiQueueDiagnostic', '_calReplyDraftsLoad', '_calReplyDraftsPersist'];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const requests = [];
  let escapes = 0;
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url === 'http://127.0.0.1/wr101') {
        await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>WR101 isolated</title>' });
        return;
      }
      if (url === endpoint) {
        if (route.request().method() === 'OPTIONS') {
          await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' } });
          return;
        }
        requests.push(JSON.parse(route.request().postData()));
        await route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: '{"ok":false}' });
        return;
      }
      escapes += 1;
      await route.abort();
    });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1/wr101');
    await page.addScriptTag({
      content: "const WRITE_UI_QUEUE_DIAG_KEY='synthetic-diagnostics';const CAL_SUPABASE_URL='https://uzltbbrjidmjwwfakwve.supabase.co';const _calReplyDrafts=Object.create(null);"
        + constant('WRITE_UI_DIAG_IDS')
        + constant('WRITE_UI_DIAG_PAYLOAD_IDS')
        + constant('WRITE_REFUSAL_BEACON_URL')
        + constant('WRITE_REFUSAL_BEACON_IDS')
        + constant('WRITE_REFUSAL_BEACON_MAX')
        + 'let _writeRefusalBeaconBudget = WRITE_REFUSAL_BEACON_MAX;'
        + constant('CAL_REPLY_DRAFTS_PREFIX')
        + constant('CAL_REPLY_DRAFT_MAX')
        + names.map((name) => func(source, name)).join('\n'),
    });

    const result = await page.evaluate(() => {
      _calReplyDrafts['synthetic-parent'] = 'PRIVATE_DRAFT';
      _calReplyDraftsPersist('synthetic-card');
      _writeUiQueueDiagnostic('calendar', 'ui_write_failure', {
        kind: 'comment', id: 'synthetic-card', body: 'PRIVATE_PROSE',
        author_name: 'PRIVATE_NAME', token: 'PRIVATE_TOKEN',
      }, { code: 'write_conflict', status: 409 });
      delete _calReplyDrafts['synthetic-parent'];
      Object.assign(_calReplyDrafts, _calReplyDraftsLoad('synthetic-card'));
      return { draft: _calReplyDrafts['synthetic-parent'], ring: JSON.parse(localStorage.getItem('synthetic-diagnostics')) };
    });

    // The beacon changes nothing the person or the existing ring depends on.
    assert.equal(result.draft, 'PRIVATE_DRAFT', 'reply draft must survive');
    assert.equal(result.ring.length, 1, 'the localStorage ring still records the refusal');
    for (let i = 0; i < 40 && requests.length === 0; i += 1) await page.waitForTimeout(25);
    assert.equal(requests.length, 1);
    assert(!JSON.stringify(requests).includes('PRIVATE_'), 'no prose, name or token leaves the page');
    assert.equal(requests[0].status, 409, 'the real refusal status is sent');
    assert.equal(requests[0].code, 'write_conflict');
    assert.deepEqual(Object.keys(requests[0].identifiers), ['id']);

    // A refusal carrying no usable status sends none rather than inventing one.
    await page.evaluate(() => _writeUiQueueDiagnostic('calendar', 'ui_write_failure',
      { kind: 'comment', id: 'synthetic-card' }, { code: 'canonical_comment_read_required' }));
    for (let i = 0; i < 40 && requests.length < 2; i += 1) await page.waitForTimeout(25);
    assert.equal(requests.length, 2);
    assert.equal('status' in requests[1], false, 'an absent status must not become a hardcoded one');

    // Bounded per page, and a non-failure outcome never reports.
    await page.evaluate(() => {
      for (let i = 0; i < 25; i += 1) {
        _writeUiQueueDiagnostic('calendar', 'ui_write_failure', { kind: 'comment', id: 'synthetic-card' }, { code: 'write_conflict' });
      }
      _writeUiQueueDiagnostic('calendar', 'drained', { kind: 'comment' }, {});
    });
    for (let i = 0; i < 40 && requests.length < 20; i += 1) await page.waitForTimeout(25);
    assert.equal(requests.length, 20, 'budget caps the page at 20 reports');
    await page.waitForTimeout(150);
    assert.equal(requests.length, 20, 'no retry after a 503');
    assert.equal(escapes, 0, 'no request left the harness');

    console.log(JSON.stringify({
      marker: 'LINEAR_EXIT_WRITE_DIAGNOSTICS_BROWSER_OK',
      classification: 'ISOLATED_BROWSER_HELPER_HARNESS_FROM_BUILT_PAGE',
      source_of_truth: 'index.html built from src/index/',
      reports: 20,
      retry_count: 0,
      draft_preserved: true,
      real_status_sent: true,
      hardcoded_status: false,
      raw_prose_names_tokens_excluded: true,
      external_escapes: escapes,
      full_app_journey_proven: false,
    }));
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
