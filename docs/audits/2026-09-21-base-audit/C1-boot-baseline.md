# C1 boot baseline before Linear-era browser deletions

**Measured:** 2026-09-21 UTC  
**Source:** `origin/main` at `6aadd5c2e8887a0271bf362d9664b85dc47ce1fc`  
**Scope:** measurement only; no application code or live data changed.

## Committed page

```text
$ wc -c index.html
5776430 index.html

$ npm run check:index
check-index: assembled bytes — sha256=6b5f44936a5e5123cdeb343b778430be3d8680bb418b0a89a01046253bdf483d bytes=5776430
check-index: working-tree index.html — sha256=6b5f44936a5e5123cdeb343b778430be3d8680bb418b0a89a01046253bdf483d bytes=5776430
check-index: committed index.html (HEAD) — sha256=6b5f44936a5e5123cdeb343b778430be3d8680bb418b0a89a01046253bdf483d bytes=5776430
check-index: OK — assembled == working tree == committed (HEAD)
```

## Existing Production boot-budget command

Exact command:

```bash
node docs/syncview-design/tests/prod-boot-budget.js
```

The command emitted no numeric result line in this executor. Playwright first expected absent Chromium revision 1234; after routing it to the preinstalled revision 1194 through the executor's configured HTTPS proxy, the page mounted but the gate failed because two anonymous runtime-flag GETs ended `net::ERR_ABORTED`. A repeat produced the same two failures. Therefore there is no honest `ready` or `dcl` number to record from this command; treating a locally modified copy as the command's result would make the baseline non-reproducible. Re-run the exact command in CI or an executor whose configured Playwright revision and read transport are available before using its budget number in a before/after claim.

## Live anonymous browser measurement

Chromium revision 1194, Playwright, 1440×950 viewport. The target was only `https://syncview.synchrosocial.com/`; no login, query string, client URL, token, form interaction, or mutation was used. A route guard aborted every non-GET/HEAD request and every request to another host. This makes the run safe and repeatable here, but means the byte count covers successful public-origin transfers only; blocked fonts, CDN code and backend reads are not included. Each result was read after `load` plus a fixed 2,000 ms observation window.

- Cold: five fresh browser contexts with cache disabled.
- Warm: one unmeasured priming navigation, then five navigations in the same context with cache enabled.
- `bytes transferred`: Navigation/Resource Timing `transferSize` sum.
- `main HTML`: navigation `decodedBodySize`; independently equal to the response body length on all ten runs.
- Spread below is minimum–maximum, not a standard deviation.

| Run | State | Bytes transferred | First paint | DOMContentLoaded | Load | Main HTML |
|---:|---|---:|---:|---:|---:|---:|
| 1 | cold | 1,447,754 B | 10,704 ms | 10,949 ms | 10,972 ms | 5,776,430 B |
| 2 | cold | 1,447,754 B | 11,644 ms | 11,872 ms | 12,002 ms | 5,776,430 B |
| 3 | cold | 1,447,754 B | 10,604 ms | 10,851 ms | 10,971 ms | 5,776,430 B |
| 4 | cold | 1,447,754 B | 10,492 ms | 10,902 ms | 10,903 ms | 5,776,430 B |
| 5 | cold | 1,447,754 B | 10,956 ms | 11,212 ms | 11,278 ms | 5,776,430 B |
| 1 | warm | 1,447,754 B | 152 ms | 221 ms | 317 ms | 5,776,430 B |
| 2 | warm | 1,447,754 B | 296 ms | 433 ms | 549 ms | 5,776,430 B |
| 3 | warm | 1,447,754 B | 160 ms | 215 ms | 294 ms | 5,776,430 B |
| 4 | warm | 1,447,754 B | 136 ms | 306 ms | 339 ms | 5,776,430 B |
| 5 | warm | 1,447,754 B | 136 ms | 241 ms | 320 ms | 5,776,430 B |

| State | Bytes transferred median (spread) | First paint median (spread) | DOMContentLoaded median (spread) | Load median (spread) | Main HTML median (spread) |
|---|---:|---:|---:|---:|---:|
| cold | 1,447,754 B (1,447,754–1,447,754) | 10,704 ms (10,492–11,644) | 10,949 ms (10,851–11,872) | 10,972 ms (10,903–12,002) | 5,776,430 B (5,776,430–5,776,430) |
| warm | 1,447,754 B (1,447,754–1,447,754) | 152 ms (136–296) | 241 ms (215–433) | 320 ms (294–549) | 5,776,430 B (5,776,430–5,776,430) |

The warm response still reports the full 1,447,754 transfer bytes; cache enabled is a browser condition, not evidence that the live origin served the document from cache. Phase C should compare like with like and retain this fact rather than relabel these runs as zero-transfer cache hits.

## Exact live-run command and runner

The command was:

```bash
node /tmp/c1-live-measure.js
```

For the post-B rerun, use the same Playwright/Chromium revision and proxy configuration, and create `/tmp/c1-live-measure.js` from this source (the executable path may change only to the installed Chromium binary):

```js
'use strict';
const { chromium } = require('playwright');
const target = 'https://syncview.synchrosocial.com/';
const executablePath = '/root/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell';

async function measure(page, cold) {
  const session = await page.context().newCDPSession(page);
  await session.send('Network.enable');
  await session.send('Network.setCacheDisabled', { cacheDisabled: cold });
  const response = await page.goto(target, { waitUntil: 'load', timeout: 60000 });
  const responseBodyBytes = (await response.body()).length;
  await page.waitForTimeout(2000);
  const result = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const paints = Object.fromEntries(performance.getEntriesByType('paint').map(p => [p.name, p.startTime]));
    return {
      bytesTransferred: Math.round((nav.transferSize || 0) + resources.reduce((n, r) => n + (r.transferSize || 0), 0)),
      firstPaintMs: Math.round(paints['first-paint'] || 0),
      domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
      loadMs: Math.round(nav.loadEventEnd),
      mainHtmlBytes: Math.round(nav.decodedBodySize || 0),
    };
  });
  await session.detach();
  if (result.mainHtmlBytes !== responseBodyBytes) throw new Error('main HTML byte measures disagree');
  return result;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath, proxy: { server: process.env.HTTPS_PROXY } });
  const makeContext = async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, ignoreHTTPSErrors: true });
    await context.route('**/*', route => {
      const request = route.request();
      const allowed = ['GET', 'HEAD'].includes(request.method()) && new URL(request.url()).hostname === 'syncview.synchrosocial.com';
      return allowed ? route.continue() : route.abort('blockedbyclient');
    });
    return context;
  };
  const cold = [];
  for (let i = 0; i < 5; i++) {
    const context = await makeContext();
    cold.push(await measure(await context.newPage(), true));
    await context.close();
  }
  const context = await makeContext();
  const page = await context.newPage();
  await measure(page, false);
  const warm = [];
  for (let i = 0; i < 5; i++) warm.push(await measure(page, false));
  await context.close();
  await browser.close();
  console.log(JSON.stringify({ cold, warm }, null, 2));
})().catch(error => { console.error(error.stack || String(error)); process.exit(1); });
```
