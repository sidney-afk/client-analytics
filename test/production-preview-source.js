'use strict';
/*
 * Track B B2 source guard.
 *
 * B2 is a read-only, query-flagged preview. This test pins the safety invariants
 * that are easy to regress in a single-file app:
 *   - the Production nav stays hidden unless ?prod=1
 *   - navTo cannot enter the tab without _prodEnabled()
 *   - the preview block has only read paths and no runtime-flag/n8n/Linear writes
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

let failures = 0;
function check(name, ok) {
  if (!ok) {
    failures++;
    console.error('FAIL  ' + name);
  } else {
    console.log('ok  ' + name);
  }
}

const prodStart = index.indexOf('PRODUCTION PREVIEW (Track B B2)');
const prodEnd = index.indexOf('async function init()', prodStart);
const prodBlock = prodStart >= 0 && prodEnd > prodStart ? index.slice(prodStart, prodEnd) : '';

check('Production preview block exists before init()', !!prodBlock);
check('nav item is hidden by default', /id="navProd"[^>]+style="display:none;"/.test(index));
check('Production nav click still routes through navTo()', /id="navProd"[\s\S]{0,180}navTo\('production'\)/.test(index));
check('_prodEnabled is query-flagged on ?prod=1', /function _prodEnabled\(\) \{\s*try \{ return new URLSearchParams\(location\.search\)\.get\('prod'\) === '1'; \}/.test(index));
check('navTo hard-falls back when ?prod=1 is absent', /if \(page === 'production' && !_prodEnabled\(\)\) page = 'home';/.test(index));
check('navTo toggles Production nav visibility from _prodEnabled()', /navProd\.style\.display = _prodEnabled\(\) \? '' : 'none';/.test(index));
check('init fast-mounts Production only when _prodEnabled()', /else if \(_prodEnabled\(\)\) _setBootLoadingText\('Loading Production preview\.\.\.'\);[\s\S]{0,220}if \(_prodEnabled\(\)\) \{[\s\S]{0,220}navTo\('production', false\)/.test(index));
check('Production preview suppresses queued calendar-card writers', /setTimeout\(\(\) => \{\s*if \(_prodEnabled\(\)\) return;[\s\S]{0,120}_resumePendingCalCardJobs\(\)/.test(index));
check('Production preview starts essentials for clean nav-out', /if \(_prodEnabled\(\)\) \{[\s\S]{0,260}fetchEssentials\(\)\.then/.test(index));
check('FAST_TABS does not include production', /const FAST_TABS = \[[^\]]+\]/.test(index) && !/const FAST_TABS = \[[^\]]*production/.test(index));

check('preview reads B1 dormant tables', /_prodRestRows\('clients'/.test(prodBlock) && /_prodRestRows\('batches'/.test(prodBlock) && /_prodRestRows\('deliverables'/.test(prodBlock));
check('preview does not expose service-role-only archive table', !/linear_archive/.test(prodBlock));
check('preview does not read or write runtime flags', !/syncview_runtime_flags/.test(prodBlock));
check('preview fetches linear_raw for archive/delete surfacing', /_prodRestRows\('deliverables'[\s\S]{0,260}linear_raw/.test(prodBlock));
check('preview filters Linear webhook delete/archive markers out of live issues', /function _prodDeliverableLive\(d\)/.test(prodBlock)
  && /webhook_delete/.test(prodBlock)
  && /raw\.issue && \(raw\.issue\.archivedAt \|\| raw\.issue\.canceledAt\)/.test(prodBlock)
  && /deliverables = \(raw\.deliverables \|\| \[\]\)\.filter\(_prodDeliverableLive\)/.test(prodBlock));
check('preview fetch helper uses default GET', /fetch\(url, \{ headers: _prodHeaders\(\) \}\)/.test(prodBlock));
check('preview read helper takes explicit page size and max page cap', /async function _prodRestRows\(table, select, params, pageSize, maxPages\)/.test(prodBlock) && /page < cap/.test(prodBlock) && /read exceeded pagination cap/.test(prodBlock));
check('preview read helper strips duplicate limit and offset params', prodBlock.includes('!/^limit=|^offset=/.test(p)'));
check('preview callers pass page sizes explicitly', /_prodRestRows\('deliverables'[\s\S]{0,360}, 1000, 50\)/.test(prodBlock) && /_prodRestRows\('deliverable_events'[\s\S]{0,220}, 30, 2\)/.test(prodBlock));
check('preview block has no explicit browser write methods', !/['"`](POST|PUT|PATCH|DELETE)['"`]/.test(prodBlock));
check('preview block has no Supabase write helpers', !/\.(insert|update|upsert|rpc)\s*\(/.test(prodBlock));
check('topbar excludes non-artifact New issue and Refresh chrome', !/New issue/.test(prodBlock) && !/<button class="prod-tab" type="button" onclick="_prodRefresh\(\)">Refresh<\/button>/.test(prodBlock));
check('visible write affordances are tagged disabled', /data-prod-disabled="detail-controls" disabled/.test(prodBlock) && /data-prod-disabled="composer"/.test(prodBlock));
check('deep links include deliverable, batch, team, and client filters', /q\.get\('d'\)/.test(prodBlock) && /q\.get\('batch'\)/.test(prodBlock) && /q\.get\('team'\)/.test(prodBlock) && /q\.get\('client'\)/.test(prodBlock));

if (failures) {
  console.error('\nproduction-preview-source: ' + failures + ' check(s) failed');
  process.exit(1);
}
console.log('production-preview-source: hidden, read-only, and deep-link source checks passed');
