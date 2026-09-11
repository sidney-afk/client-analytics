'use strict';
// LIVE_READ: live document in Chromium, intercepted outbound policy, no mocks.
// All output files (including config, screenshots, DOM and request ledger) PRIVATE.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { classify, validateConfig, outsideRepo, browserEnv, installTransportGuards, forwardRead, assessReport } = require('./policy.cjs');
const repo = path.resolve(__dirname, '../..');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
function observeDom() {
  const visible = el => !!(el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const text = document.body.innerText;
  const cards = [...document.querySelectorAll('.cal-card,.cal-review-card,.sxr-card,.prod-row,.kasper-review-card')].filter(visible);
  const images = [...document.images].filter(visible);
  return { text, title: document.title,
    overflowElements: [...document.querySelectorAll('body *')].filter(visible).map(el => ({
      tag: el.tagName, cls: typeof el.className === 'string' ? el.className : '', right: el.getBoundingClientRect().right,
    })).filter(x => x.right > innerWidth + 1).slice(0, 30),
    checks: {
      bodyVisible: visible(document.body), passwordPrompt: [...document.querySelectorAll('input[type=password]')].some(visible),
      verifyFailure: /couldn.t verify|unable to verify|try again|updated link|fresh link/i.test(text),
      loadingCopy: /loading|checking your link/i.test(text), emptyCopy: /no posts|nothing to review|no samples|no content/i.test(text),
      visibleCards: cards.length, visibleImages: images.length, decodedImages: images.filter(x => x.complete && x.naturalWidth > 0).length,
      viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      approveActions: [...document.querySelectorAll('button')].filter(x => visible(x) && /approve/i.test(x.textContent)).length,
      changeRequestActions: [...document.querySelectorAll('button')].filter(x => visible(x) && /request change/i.test(x.textContent)).length,
    } };
}
async function run(configFile, outputDir) {
  const config = validateConfig(JSON.parse(fs.readFileSync(outsideRepo(configFile, repo), 'utf8').replace(/^\uFEFF/, '')));
  const output = outsideRepo(outputDir, repo);
  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const site = 'https://' + fs.readFileSync(path.join(repo, 'CNAME'), 'utf8').trim();
  const backend = html.match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0];
  const staticPaths = new Set(['/', '/index.html', ...git(['ls-files']).split('\n')
    .filter(f => /\.(png|ico|svg|css|woff2?|jpg|jpeg|webp)$/i.test(f)).map(f => '/' + f)]);
  const policy = { site, backend, staticPaths, sheet: html.match(/const SHEET_ID\s*=\s*'([^']+)'/)[1], test: config.test };
  for (const item of config.surfaces) {
    if (new URL(item.url).origin !== site) throw Error('entry_origin_refused');
    if (item.storageState) outsideRepo(item.storageState, repo);
  }
  const source = { head: git(['rev-parse', 'HEAD']), indexSha256: sha256(Buffer.from(html)),
    dirty: !!git(['status', '--porcelain']), runnerSha256: sha256(fs.readFileSync(__filename)),
    policySha256: sha256(fs.readFileSync(path.join(__dirname, 'policy.cjs'))) };
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, env: browserEnv(process.env) });
  const report = { evidence: 'LIVE_READ', startedAt: new Date().toISOString(), source,
    browser: browser.version(), businessWritesPermitted: false, accessAuditPermitted: true, rows: [] };
  try {
    for (const item of config.surfaces) for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const label = item.surface + '-' + viewport.width;
      const privateRow = { url: item.url, requests: [], errors: [], documents: [] };
      const row = { surface: item.surface, viewport, at: new Date().toISOString(),
        persona: item.surface.startsWith('client-') ? 'existing-test-link' : item.storageState ? 'existing-authorized-state' : 'unauthenticated',
        outcomes: {}, servedDocuments: [], limitations: ['no_business_writes', 'no_websocket_freshness', 'no_persistence_proof'] };
      const count = key => { row.outcomes[key] = (row.outcomes[key] || 0) + 1; };
      const pending = [];
      const context = await browser.newContext({ viewport, serviceWorkers: 'block', acceptDownloads: false,
        timezoneId: 'America/Guatemala', ...(item.storageState ? { storageState: item.storageState } : {}) });
      await context.addInitScript(installTransportGuards);
      await context.routeWebSocket('**/*', socket => { count('blocked_websocket'); socket.close(); });
      await context.route('**/*', async route => {
        const req = route.request();
        const decision = classify({ url: req.url(), method: req.method(), body: req.postData() }, policy);
        privateRow.requests.push({ at: new Date().toISOString(), url: req.url(), method: req.method(), decision });
        count(decision);
        if (decision.startsWith('read_')) await forwardRead(route, count);
        else await route.abort('blockedbyclient');
      });
      const page = await context.newPage();
      page.on('dialog', dialog => dialog.dismiss());
      page.on('console', msg => {
        const guard = /^__baseline_blocked_(beacon|keepalive|unsupported_transport)__$/.exec(msg.text());
        if (guard) count('blocked_' + guard[1]);
        if (msg.type() === 'error') { count('console_error'); privateRow.errors.push(msg.text()); }
      });
      page.on('pageerror', error => { count('javascript_error'); privateRow.errors.push(error.message); });
      page.on('requestfailed', req => { count('request_failed'); privateRow.requests.push({ url: req.url(), failure: req.failure() }); });
      page.on('response', response => {
        count('http_' + response.status());
        const primary = /^\/rest\/v1\/(calendar_posts|sample_reviews)$/.exec(new URL(response.url()).pathname);
        if (primary && new URL(response.url()).origin === backend) pending.push((async () => {
          try {
            const bytes = await response.body();
            const data = JSON.parse(bytes);
            const proof = { relation: primary[1], status: response.status(), rows: Array.isArray(data) ? data.length : null,
              sha256: sha256(bytes), contentRange: response.headers()['content-range'] || null };
            (row.primaryReads ||= []).push(proof);
            (privateRow.primaryReads ||= []).push({ url: response.url(), proof, data });
          } catch { count('primary_read_unproven'); }
        })());
        if (response.request().resourceType() === 'document') pending.push((async () => {
          try {
            const bytes = await response.body();
            const proof = { status: response.status(), sha256: sha256(bytes), at: new Date().toISOString(),
              matchesSource: sha256(bytes) === source.indexSha256, etag: response.headers().etag || null };
            row.servedDocuments.push(proof);
            fs.writeFileSync(path.join(output, label + '.html'), bytes);
          } catch { count('document_hash_unavailable'); }
        })());
      });
      try {
        await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(8000);
        const dom = await page.evaluate(observeDom);
        privateRow.dom = dom;
        row.display = dom.checks;
        row.coverage = dom.checks.passwordPrompt ? 'BLOCKED_AUTH' : dom.checks.verifyFailure ? 'BLOCKED_OR_ERROR' : 'OBSERVED_PARTIAL';
        await page.screenshot({ path: path.join(output, label + '.png'), fullPage: true, timeout: 15000 });
        // Source-reviewed view toggles: onCalViewChange/onSxrViewChange save
        // local preferences and render. No card edit, focus/blur save, or submit.
        if (item.surface.startsWith('client-') && !dom.checks.verifyFailure) {
          const sheet = page.locator('[data-cal-view="organizer"]:visible');
          if (await sheet.count() === 1) {
            await sheet.click();
            await page.waitForTimeout(2500);
            privateRow.sheetDom = await page.evaluate(observeDom);
            row.sheetDisplay = privateRow.sheetDom.checks;
            await page.screenshot({ path: path.join(output, label + '-sheet.png'), fullPage: true, timeout: 15000 });
          } else row.limitations.push('sheet_control_unavailable');
        }
      } catch { row.coverage = 'UNPROVEN'; count('navigation_or_capture_failed'); }
      finally {
        await context.close();
        await Promise.allSettled(pending);
        row.finishedAt = new Date().toISOString();
        fs.writeFileSync(path.join(output, label + '.private.json'), JSON.stringify(privateRow, null, 2));
        report.rows.push(row);
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(row));
      }
    }
  } finally { await browser.close(); }
  report.finishedAt = new Date().toISOString();
  report.contracts = assessReport(report);
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  return report;
}
if (require.main === module) (async () => {
  const assessment = process.argv[2] === '--assess'
    ? assessReport(JSON.parse(fs.readFileSync(outsideRepo(process.argv[3], repo), 'utf8')))
    : (await run(process.argv[2], process.argv[3])).contracts;
  console.log(JSON.stringify(assessment));
  process.exitCode = assessment.failures.length ? 1 : 2;
})().catch(() => {
  console.error('baseline_runner_failed_private_details_suppressed'); process.exitCode = 1;
});
module.exports = { run };
