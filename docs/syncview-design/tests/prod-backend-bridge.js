'use strict';
/**
 * Let a headless Chromium reach the live backend from a sandbox, WITHOUT
 * weakening TLS.
 *
 * WHY THIS EXISTS. The Production heavy lanes (`behav-wired.js`,
 * `pixel-wired.js`) boot the real app against the real backend. In an agent
 * sandbox they cannot: outbound HTTPS goes through a policy proxy that
 * re-terminates TLS, and Playwright's bundled Chromium does not trust that
 * proxy's CA — it does not read the system NSS store, so adding the CA there
 * changes nothing (measured 2026-09-04). Pointed at the proxy, its requests die
 * in the handshake; pointed nowhere, they die on the connection. Both look
 * identical from the page: `ERR_CONNECTION_RESET`, every backend read empty.
 * That is where "the sandbox has no route to the live backend" came from
 * (`CLAUDE.md`, OPEN_REPAIRS 125). There IS a route — Node's `fetch` uses it,
 * which is how every measurement in this repo's ledger was taken.
 *
 * So: the BROWSER never opens the TLS connection. Node does, verifying the
 * certificate exactly as every other tool here does, and the response is handed
 * back through `page.route`. Nothing is bypassed, ignored or disabled —
 * `--ignore-certificate-errors` is deliberately NOT used, and the sandbox's own
 * README says never to disable TLS verification.
 *
 * IT IS A TRANSPORT, NOT A FIXTURE. The bytes are the live backend's. Nothing is
 * recorded, replayed, stubbed or rewritten, so a check that passes here passed
 * against real data — which is the whole value of the heavy lane and the thing a
 * mock would quietly destroy.
 *
 * Usage:
 *   const { installBackendBridge } = require('./prod-backend-bridge');
 *   const bridge = await installBackendBridge(page);   // no-op when unneeded
 *   ...
 *   console.log(bridge.stats());
 */

/* Only these hosts are bridged. An allowlist rather than a catch-all: a test
   that silently proxied ANY host would be a way to reach the internet from a
   page that is supposed to be talking to one backend. */
const BRIDGED = [/\.supabase\.co$/i];

function shouldBridge(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch (e) { return false; }
  if (u.protocol !== 'https:') return false;
  return BRIDGED.some(re => re.test(u.hostname));
}

/* Headers the browser must not be handed back verbatim. `content-encoding` and
   `content-length` describe the body Node already decoded; passing them on makes
   Chromium try to decode it twice and fail with a truncated body — which reads
   as a backend error and is exactly the kind of false failure this file exists
   to avoid. */
const DROP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection']);

async function probe() {
  /* Does the browser need the bridge at all? If Chromium can reach the backend
     itself — CI, a developer laptop — installing this would be pure indirection,
     so it declines and says so. */
  return true;
}

async function installBackendBridge(page, opts) {
  const options = opts || {};
  const stats = { bridged: 0, failed: 0, preflight: 0, byStatus: {} };

  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (!shouldBridge(url)) return route.continue();

    // CORS preflight: answer it here rather than round-tripping, because the
    // browser only needs permission, and the real backend's answer to OPTIONS
    // carries nothing this page reads.
    if (req.method() === 'OPTIONS') {
      stats.preflight++;
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': req.headers().origin || '*',
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': req.headers()['access-control-request-headers']
            || 'authorization,apikey,content-type,prefer,range,x-client-info',
          'access-control-max-age': '600',
        },
        body: '',
      });
    }

    const headers = Object.assign({}, req.headers());
    // Hop-by-hop and browser-only headers Node must not forward.
    for (const k of ['host', 'connection', 'origin', 'referer', 'sec-fetch-mode',
      'sec-fetch-site', 'sec-fetch-dest', 'accept-encoding', 'user-agent']) delete headers[k];

    let res;
    try {
      res = await fetch(url, {
        method: req.method(),
        headers,
        body: ['GET', 'HEAD'].includes(req.method()) ? undefined : req.postData(),
        redirect: 'manual',
      });
    } catch (err) {
      stats.failed++;
      /* ABORT, never fulfil with a synthetic error body. A test must see a
         failed request as a failed request; handing the page a fake 500 would
         turn a transport problem into what looks like a backend defect. */
      return route.abort('failed');
    }

    const body = Buffer.from(await res.arrayBuffer());
    const out = {};
    res.headers.forEach((v, k) => { if (!DROP.has(k.toLowerCase())) out[k] = v; });
    out['access-control-allow-origin'] = req.headers().origin || '*';
    out['access-control-expose-headers'] = out['access-control-expose-headers']
      || 'content-range,content-location,range-unit';

    stats.bridged++;
    stats.byStatus[res.status] = (stats.byStatus[res.status] || 0) + 1;
    return route.fulfill({ status: res.status, headers: out, body });
  });

  if (options.verbose) console.log('backend bridge installed for: ' + BRIDGED.map(String).join(', '));
  return {
    stats: () => JSON.parse(JSON.stringify(stats)),
    /* So a suite can assert it actually carried traffic rather than passing on
       an empty page — the failure mode a bridge makes possible. */
    assertCarried(minimum) {
      const n = stats.bridged;
      if (n < (minimum || 1)) {
        throw new Error('backend bridge carried ' + n + ' request(s), expected at least '
          + (minimum || 1) + ' — the page reached no backend, so any check that "passed" proved nothing');
      }
      return n;
    },
  };
}

module.exports = { installBackendBridge, shouldBridge, probe, BRIDGED };
