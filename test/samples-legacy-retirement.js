'use strict';
/*
 * Phase-1 retirement guard for Samples Old.
 *
 * This is intentionally source-level and offline: it proves the legacy nav is
 * absent, executes the route resolver used by navTo(), and pins the dormant
 * legacy/SXR boundaries so a later cleanup cannot accidentally happen here.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function check(label, condition) {
  if (condition) console.log('  ok  ' + label);
  else { console.log('  FAIL  ' + label); failures++; }
}

const header = (INDEX.match(/<div class="header-nav" id="headerNav">([\s\S]*?)<\/div>\s*<div class="header-actions">/) || [])[1] || '';
check('Samples Old nav button is absent', !/id="navSamples"/.test(header) && !/>\s*Samples Old\s*</.test(header));
check('Samples nav keeps the SXR id and route', /id="navSxr"[^>]*href="#sample-reviews"/.test(header));
check('Samples nav uses the post-retirement visible label', />\s*Samples\s*</.test(header) && !/>\s*Samples New\s*</.test(header));

const resolverSource = (INDEX.match(/function _resolveRetiredSamplesRoute\(page\) \{[\s\S]*?\n    \}/) || [])[0];
check('legacy route resolver is present', !!resolverSource);
if (resolverSource) {
  const resolve = vm.runInNewContext('(' + resolverSource + ')');
  check('#samples route resolves to Samples New', resolve('samples') === 'sample-reviews');
  check('#samples subpaths resolve to Samples New', resolve('samples/client/card') === 'sample-reviews');
  for (const route of ['home', 'calendar', 'sample-reviews', 'templates', 'production']) {
    check(route + ' route is unaffected', resolve(route) === route);
  }
}
const navToSource = (INDEX.match(/function navTo\(page, push = true\) \{[\s\S]*?\n    \}/) || [])[0] || '';
check('navTo applies the retirement resolver before selecting currentNav',
  navToSource.indexOf('page = _resolveRetiredSamplesRoute(page);') >= 0
  && navToSource.indexOf('page = _resolveRetiredSamplesRoute(page);') < navToSource.indexOf('currentNav = page;'));
check('boot predictor sends old hashes to Samples New',
  (INDEX.match(/target = [^;]*samples[^;]*sample-reviews[^;]*;/g) || []).length >= 2);

check('legacy renderer remains dormant for Phase 1',
  /function renderSamplesView\(/.test(INDEX) && /function mountSamplesView\(/.test(INDEX));
check('legacy endpoints remain intact for Phase 1',
  /webhook\/samples-get/.test(INDEX) && /webhook\/samples-upsert/.test(INDEX) && /webhook\/samples-reorder/.test(INDEX));
check('Samples New renderer and route remain intact',
  /page === 'sample-reviews'/.test(INDEX) && /renderSxrView\(\)/.test(INDEX) && /mountSxrView\(\)/.test(INDEX));

// F117: legacy client `v=samples` links may migrate, but only after strict
// verification has bound one exact client. The migration must enter the
// client SXR shell directly; generic Samples preferences must never choose a
// residual client or expose the staff client switcher.
check('legacy client Samples view canonicalizes to sample-reviews',
  INDEX.includes("if (view === 'samples') view = 'sample-reviews';")
  && INDEX.includes("q.set('v', view)")
  && INDEX.includes("q.set('sxr', '1')"));
check('canonical client Samples history preserves the exact verified binding',
  INDEX.includes("clientSlug: entry.slug")
  && INDEX.includes("clientEntryView: view")
  && INDEX.includes("return Object.freeze({ client: entry.client, slug: entry.slug, view, verified: true })"));
const clientSxrBoot = (INDEX.match(
  /if \(_isClientLink && _syncviewClientEntryCapability && _syncviewClientEntryCapability\.view === 'sample-reviews'\) \{[\s\S]{0,1600}?\n            \}/
) || [])[0] || '';
check('client Samples boot uses the exact verified client and direct SXR mount',
  clientSxrBoot.includes('const _sxrLink = _syncviewClientEntryCapability.client')
  && clientSxrBoot.includes('await _syncviewVerifyClientLinkAccess(_sxrLink)')
  && clientSxrBoot.includes('mountSxrClientView(_sxrLink)')
  && !clientSxrBoot.includes("navTo('samples'"));
check('client Samples boot never seeds the retired generic client preference',
  (INDEX.match(/_smLinkClient\s*=/g) || []).length === 1);
const clientMount = (INDEX.match(/function mountSxrClientView\(clientName\) \{[\s\S]*?\n    \}/) || [])[0] || '';
check('client SXR mount rejects wrong-client or non-review capabilities',
  clientMount.includes("cap.view !== 'sample-reviews'")
  && clientMount.includes('_syncviewClientEntrySlug(clientName) !== cap.slug')
  && clientMount.includes('clientName = cap.client'));
const sxrEnabled = (INDEX.match(/function _sxrEnabled\(\) \{[\s\S]*?\n    \}/) || [])[0] || '';
check('verified client Review ignores staff sticky opt-out without mutating it',
  sxrEnabled.includes('if (_isClientLink)')
  && sxrEnabled.includes("cap.view === 'sample-reviews'")
  && sxrEnabled.indexOf('if (_isClientLink)') < sxrEnabled.indexOf('localStorage'));
check('async client Review mount installs freshness listeners after verification',
  clientMount.includes('_sxrEnsureFreshnessWiring()')
  && INDEX.includes('function _sxrEnsureFreshnessWiring()'));
check('client navigation cannot fall through to generic staff Samples',
  navToSource.includes("cap.view === 'sample-reviews'")
  && navToSource.includes('mountSxrClientView(cap.client)')
  && navToSource.includes('_syncviewInvalidClientLinkScreen()'));
const sxrAbortLoad = (INDEX.match(/function _sxrAbortActiveLoad\(\) \{[\s\S]*?\n    \}/) || [])[0] || '';
const sxrLoad = (INDEX.match(/async function loadSxrCards\(opts\) \{[\s\S]*?\n    \}/) || [])[0] || '';
const clientPurge = (INDEX.match(/function _syncviewPurgeClientEntrySurface\(\) \{[\s\S]*?\n    \}/) || [])[0] || '';
const clientSuspend = (INDEX.match(/function _syncviewSuspendClientEntry\(\) \{[\s\S]*?\n    \}/) || [])[0] || '';
const sxrTeardown = (INDEX.match(/function _sxrV2Teardown\(\) \{[\s\S]*?\n    \}/) || [])[0] || '';
check('Samples tracks and stale-invalidates the active transport before aborting it',
  INDEX.includes('let _sxrLoadController = null;')
  && sxrAbortLoad.includes('_sxrLoadController = null')
  && sxrAbortLoad.includes('++_sxrLoadSeq')
  && sxrAbortLoad.indexOf('++_sxrLoadSeq') < sxrAbortLoad.indexOf('controller.abort()'));
check('replacement Samples loads abort the prior transport and identity-clear only their controller',
  sxrLoad.includes('_sxrAbortActiveLoad();')
  && sxrLoad.includes('_sxrLoadController = ctrl;')
  && sxrLoad.includes('if (_sxrLoadController === ctrl) _sxrLoadController = null;'));
check('client suspend and purge abort Samples transport before capability/data teardown',
  clientSuspend.includes('_sxrAbortActiveLoad')
  && clientSuspend.indexOf('_sxrAbortActiveLoad') < clientSuspend.indexOf('_syncviewClientEntryCapability = null')
  && clientPurge.includes('_sxrAbortActiveLoad'));
check('Samples teardown aborts any active transport',
  sxrTeardown.includes('_sxrAbortActiveLoad();'));

console.log(failures ? `\nsamples-legacy-retirement: ${failures} check(s) failed` : '\nsamples-legacy-retirement: all checks passed');
process.exit(failures ? 1 : 0);
