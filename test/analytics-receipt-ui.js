'use strict';

/*
 * Analytics provider failures are explicit receipt states, never guesses made
 * from a low metric. A failed Instagram scrape keeps its UI surfaces visible,
 * suppresses deltas, and identifies last-known data. Successful/genuinely-empty
 * zeroes remain real values and can still produce real declines.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}') {
      depth--;
      if (depth === 0) return INDEX.slice(at, j + 1);
    }
  }
  throw new Error('unbalanced braces: ' + name);
}

const receiptStart = INDEX.indexOf("const ANALYTICS_RECEIPT_SCHEMA='syncview.analytics.receipt.v1';");
const receiptEnd = INDEX.indexOf('    function fmtIsoDate(', receiptStart);
if (receiptStart < 0 || receiptEnd < 0) throw new Error('analytics receipt helpers not found');

const sandbox = {
  gainPeriod: 'day',
  sortCol: 'ig_followers',
  sortDir: 'desc',
  _safeWeekViewDelta: () => 0,
  prevPerClient: () => ({}),
  weekPrevPerClient: () => ({}),
  monthPrevPerClient: () => ({}),
  clientHistory: () => [],
};
vm.createContext(sandbox);
vm.runInContext([
  grabFunc('n'),
  grabFunc('fmt'),
  INDEX.slice(receiptStart, receiptEnd),
  grabFunc('deltaBadge'),
  grabFunc('mBlock'),
  grabFunc('mBlockNoD'),
  grabFunc('mBlockViews30d'),
  grabFunc('gainsBar'),
  grabFunc('gainCell'),
  grabFunc('sortedRows'),
  'this.api={_analyticsReceipt,_analyticsPlatformReceipt,_analyticsProviderFailed,_analyticsMetricNumber,_analyticsHasTrustedMetrics,_analyticsTrustedReference,_analyticsPlatformVisible,_analyticsMetricFmt,_analyticsStateBadge,mBlock,mBlockViews30d,gainsBar,gainCell,sortedRows};',
].join('\n'), sandbox);

const api = sandbox.api;
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

function receipt(state, extra = {}, meta = {}) {
  const clientName = meta.client_name || 'Receipt Test';
  const rowNumber = Object.prototype.hasOwnProperty.call(meta, 'row_number') ? meta.row_number : 2;
  const clientKey = meta.client_key || (rowNumber === null ? 'name:' + clientName.toLowerCase() : 'row:' + rowNumber);
  const configured = state !== 'not_configured';
  const platformReceipt = Object.assign({
    expected: configured,
    attempted: configured,
    state,
    item_count: state === 'success' ? 1 : 0,
    fetched_at: configured ? '2026-07-18T12:00:00.000Z' : null,
    used_last_good: false,
    source_date: state === 'success' || state === 'genuinely_empty' ? '2026-07-18' : null,
    error_class: state === 'provider_failed' ? 'apify_provider_error' : null,
  }, extra);
  const notConfiguredReceipt = {
    expected: false,
    attempted: false,
    state: 'not_configured',
    item_count: 0,
    fetched_at: null,
    source_date: null,
    used_last_good: false,
    error_class: null,
  };
  return JSON.stringify({
    schema: 'syncview.analytics.receipt.v1',
    client_key: clientKey,
    row_number: rowNumber,
    client_name: clientName,
    run_date: meta.run_date || '2026-07-18',
    terminal: true,
    metrics_written: true,
    result: state === 'provider_failed' ? 'degraded' : 'success',
    completed_at: '2026-07-18T12:00:01.000Z',
    platforms: {
      instagram: platformReceipt,
      tiktok: { ...notConfiguredReceipt },
      youtube: { ...notConfiguredReceipt },
    },
  });
}

const prior = {
  client_name: 'Receipt Test',
  date: '2026-07-17',
  ig_followers: '30658',
  ig_views_this_month: '2741',
  ig_views_gained_today: '197',
};
const failedWithLastGood = {
  client_name: 'Receipt Test',
  date: '2026-07-18',
  analytics_receipt: receipt('provider_failed', {
    used_last_good: true,
    source_date: '2026-07-17',
    error_class: 'apify_no_items',
  }),
  ig_followers: '30658',
  ig_views_this_month: '2741',
  ig_views_gained_today: '0',
};
const failedWithoutLastGood = {
  client_name: 'Receipt Test',
  date: '2026-07-18',
  analytics_receipt: receipt('provider_failed'),
  ig_followers: '0',
  ig_views_this_month: '0',
  ig_views_gained_today: '0',
};
const successfulZero = {
  client_name: 'Receipt Test',
  date: '2026-07-18',
  analytics_receipt: receipt('success'),
  ig_followers: '0',
  ig_views_this_month: '0',
  ig_views_gained_today: '0',
};
const genuinelyEmpty = {
  ...successfulZero,
  analytics_receipt: receipt('genuinely_empty'),
};
const legacyZero = {
  client_name: 'Receipt Test',
  date: '2026-07-18',
  ig_followers: '0',
  ig_views_this_month: '0',
  ig_views_gained_today: '0',
};
const notConfigured = {
  client_name: 'Receipt Test',
  date: '2026-07-18',
  analytics_receipt: receipt('not_configured', {
    expected: false,
    attempted: false,
    fetched_at: null,
    source_date: null,
    error_class: null,
  }),
  ig_followers: '999',
  ig_views_this_month: '999',
  ig_views_gained_today: '999',
};
const recoveredZero = {
  ...successfulZero,
  date: '2026-07-19',
  analytics_receipt: receipt('success', {}, { run_date: '2026-07-19' }),
};

ok(api._analyticsReceipt(successfulZero)?.schema === 'syncview.analytics.receipt.v1',
  'the exact terminal receipt schema is accepted');
ok(api._analyticsReceipt({ ...successfulZero, analytics_receipt: receipt('success').replace('syncview.analytics.receipt.v1', 'wrong') }) === null,
  'unknown receipt schemas are ignored');
ok(api._analyticsReceipt({ ...successfulZero, client_name: 'Another Client' }) === null,
  'a receipt cannot affect a different client');
ok(api._analyticsReceipt({ ...successfulZero, date: '2026-07-19' }) === null,
  'a receipt cannot affect a different run date');
ok(api._analyticsReceipt({ ...successfulZero, analytics_receipt: receipt('success').replace('"client_name":"Receipt Test",', '') }) === null,
  'a receipt without a client identity is ignored');
ok(api._analyticsReceipt({ ...successfulZero, analytics_receipt: receipt('success').replace('"run_date":"2026-07-18",', '') }) === null,
  'a receipt without a run date is ignored');
ok(api._analyticsReceipt({ ...successfulZero, analytics_receipt: receipt('success').replace('"client_key":"row:2",', '') }) === null,
  'a receipt without a stable client key is ignored');
ok(api._analyticsReceipt({
  client_name: 'Name Fallback',
  date: '2026-07-18',
  analytics_receipt: receipt('success', {}, { client_name: 'Name Fallback', row_number: null }),
})?.client_key === 'name:name fallback',
  'the workflow name-key fallback remains valid when row_number is null');
ok(api._analyticsReceipt({ ...successfulZero, analytics_receipt: '{not-json' }) === null,
  'malformed receipt JSON safely falls back to legacy behavior');
const incompletePlatformReceipt = JSON.parse(receipt('provider_failed'));
incompletePlatformReceipt.platforms.instagram = { state: 'provider_failed' };
ok(api._analyticsPlatformReceipt({ ...failedWithoutLastGood, analytics_receipt: JSON.stringify(incompletePlatformReceipt) }, 'instagram') === null,
  'an incomplete platform receipt cannot affect the row');
const impossibleSuccessReceipt = JSON.parse(receipt('success'));
impossibleSuccessReceipt.platforms.instagram.item_count = 0;
ok(api._analyticsPlatformReceipt({ ...successfulZero, analytics_receipt: JSON.stringify(impossibleSuccessReceipt) }, 'instagram') === null,
  'success with an empty provider result is rejected as impossible');

ok(api._analyticsPlatformVisible(failedWithoutLastGood, 'instagram', false) === true,
  'provider_failed keeps Instagram visible even when every metric is zero');
ok(api._analyticsStateBadge(failedWithLastGood, 'instagram').includes('Degraded · last-known'),
  'provider failure with fallback is explicitly labeled last-known');
ok(api._analyticsStateBadge(failedWithoutLastGood, 'instagram').includes('Degraded · no fresh data'),
  'provider failure without fallback does not pretend zero is last-known');
const staleReceipt = JSON.parse(failedWithLastGood.analytics_receipt);
staleReceipt.platforms.instagram.error_class = 'stale_post_metrics';
const staleInstagram = { ...failedWithLastGood, analytics_receipt: JSON.stringify(staleReceipt) };
ok(api._analyticsStateBadge(staleInstagram, 'instagram').includes('Delayed · last-known'),
  'a detected stale Instagram post feed is visibly labeled as delayed rather than reported as fresh');
ok(api._analyticsMetricFmt(failedWithoutLastGood, 'instagram', 'ig_followers') === null,
  'untrusted numeric zero is not displayed as provider data');
ok(api._analyticsMetricFmt(successfulZero, 'instagram', 'ig_followers') === '0'
  && api._analyticsMetricFmt(genuinelyEmpty, 'instagram', 'ig_followers') === '0',
  'success and genuinely_empty preserve a real numeric zero');
ok(api._analyticsMetricNumber(notConfigured, 'instagram', 'ig_followers') === null
  && api._analyticsMetricFmt(notConfigured, 'instagram', 'ig_followers') === null,
  'not_configured never promotes a stale raw value into trusted data');
ok(api._analyticsPlatformVisible(legacyZero, 'instagram', false) === false
  && api._analyticsStateBadge(legacyZero, 'instagram') === '',
  'receipt-absent zero keeps legacy visibility and is never labeled provider failure');

const failedGains = api.gainsBar(failedWithoutLastGood, prior, null, null, null, 'day', 'Receipt Test');
ok(failedGains.includes('Instagram') && failedGains.includes('Degraded · no fresh data'),
  'failed-provider gains card stays present and labeled');
ok(!failedGains.includes('-30.7K') && !failedGains.includes('-30658'),
  'failed-provider gains never render the false 30k follower loss');

const successfulZeroGains = api.gainsBar(successfulZero, prior, null, null, null, 'day', 'Receipt Test');
ok(successfulZeroGains.includes('Instagram') && successfulZeroGains.includes('-30,658'),
  'a successful zero still renders its genuine follower decline');
ok(successfulZeroGains.includes('±0') && !successfulZeroGains.includes('Degraded'),
  'a successful zero remains numeric and is not marked degraded');

const genuinelyEmptyGains = api.gainsBar(genuinelyEmpty, prior, null, null, null, 'day', 'Receipt Test');
ok(genuinelyEmptyGains.includes('-30,658') && !genuinelyEmptyGains.includes('Degraded'),
  'genuinely_empty is distinct from provider_failed and does not freeze a real drop');
const recoveredGains = api.gainsBar(recoveredZero, failedWithLastGood, null, null, null, 'day', 'Receipt Test');
ok(recoveredGains.includes('-30,658') && !recoveredGains.includes('Degraded'),
  'a successful zero after a failed scrape still shows the genuine decline');

const failedMetric = api.mBlock('Total Followers', failedWithoutLastGood, prior, 'ig_followers', 'instagram');
const zeroMetric = api.mBlock('Total Followers', successfulZero, prior, 'ig_followers', 'instagram');
ok(failedMetric.includes('>—</div>') && !failedMetric.includes('-30.7K'),
  'detail metric hides untrusted failed-provider zero and suppresses its delta');
ok(zeroMetric.includes('>0</div>') && zeroMetric.includes('-30.7K'),
  'detail metric shows successful zero and its real decline');
const recoveredMetric = api.mBlock('Total Followers', recoveredZero, failedWithLastGood, 'ig_followers', 'instagram');
const recoveredCell = api.gainCell(recoveredZero, failedWithLastGood, 'ig_followers', 'col-ig', 'instagram');
ok(recoveredMetric.includes('-30.7K') && recoveredCell.includes('-30.7K'),
  'detail and overview deltas resume against trusted last-good values');

const sortMissing = { ...legacyZero, client_name: 'Missing Legacy' };
const sortZero = {
  ...successfulZero,
  client_name: 'Typed Zero',
  analytics_receipt: receipt('success', {}, { client_name: 'Typed Zero', client_key: 'row:3', row_number: 3 }),
};
ok(api.sortedRows([sortMissing, sortZero])[0].client_name === 'Typed Zero',
  'sorting treats a typed successful zero as data, not as unavailable');

const gainsSource = grabFunc('gainsBar');
const detailSource = grabFunc('renderClient');
const cardsSource = grabFunc('renderCardView');
const overviewSource = grabFunc('renderOverview');
const chartSource = grabFunc('renderChart');
for (const name of ['renderClient', 'renderCardView', 'renderOverview', 'renderChart', 'renderViewsChart']) {
  let compiles = true;
  try { new Function('return (' + grabFunc(name) + ');'); } catch (_) { compiles = false; }
  ok(compiles, name + ' compiles after receipt-aware wiring');
}
ok(gainsSource.includes("_analyticsPlatformVisible(today,'instagram'")
  && gainsSource.includes("_analyticsProviderFailed(today,'instagram'"),
  'gains availability and suppression are receipt-driven');
ok(detailSource.includes("_analyticsPlatformVisible(today,'instagram'")
  && detailSource.includes("_analyticsStateBadge(today,'instagram')")
  && detailSource.includes("'instagram')"),
  'client detail keeps and labels the receipt-aware Instagram section');
ok(cardsSource.includes("_analyticsPlatformVisible(r,'instagram'")
  && cardsSource.includes("_analyticsStateBadge(r,'instagram')"),
  'overview cards keep and label failed Instagram state');
ok(overviewSource.includes("gainCell(r,dp,'ig_followers','col-ig','instagram')")
  && overviewSource.includes("_analyticsProviderFailed(r,'instagram')"),
  'overview table suppresses receipt-shaped provider failures');
ok(chartSource.includes('_analyticsProviderFailed(r,receiptPlatform)')
  && chartSource.includes('while(prior>=0&&_analyticsMetricNumber'),
  'charts omit failed points and compare recovery against the last trusted point');
ok(chartSource.includes('return _analyticsMetricNumber(r,receiptPlatform,pc.key)'),
  'charts never turn not_configured or malformed receipts into zero points');

if (failures) {
  console.error(`\n${failures} analytics receipt UI check(s) failed`);
  process.exit(1);
}
console.log('\nAnalytics receipt UI checks passed');
