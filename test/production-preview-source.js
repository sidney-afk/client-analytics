'use strict';
/*
 * Track B B2 source guard.
 *
 * The promoted mirror is still a read-only, query-backed surface. This test pins
 * the safety invariants and the deliberate visible-label/internal-route split
 * that are easy to regress in a single-file app:
 *   - the visible Linear mirror precedes Submit and stays mounted in staff nav
 *   - navTo cannot enter the tab without _prodAccessAllowed()
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
const navMarkup = id => {
  const match = index.match(new RegExp(`<a[^>]+id="${id}"[\\s\\S]*?<\\/a>`));
  return match ? match[0] : '';
};
const navProd = navMarkup('navProd');
const navLinear = navMarkup('navLinear');
const prodRowRule = (index.match(/\.prod-row\s*\{([^}]*)\}/) || [])[1] || '';
const linearLogo = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 14L14 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M2 9L9 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M7 14L14 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const submitIcon = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>';

check('Production preview block exists before init()', !!prodBlock);
check('promoted Linear mirror nav is always mounted', !!navProd && !/display\s*:\s*none/.test(navProd) && !/navProd\.style\.display/.test(index));
check('staff-identity and Production mount code no longer hide the promoted nav', !/getElementById\('navProd'\)[\s\S]{0,140}\.style\.display/.test(index));
check('visible order is Analytics then Linear mirror then Submit', index.indexOf('id="navHome"') < index.indexOf('id="navProd"') && index.indexOf('id="navProd"') < index.indexOf('id="navLinear"'));
check('Linear mirror keeps production id, hash, and nav key', /href="#production"/.test(navProd) && /navTo\('production'\)/.test(navProd) && /<\/svg>\s*Linear\s*<\/a>$/.test(navProd));
check('Submit keeps linear id, hash, and nav key', /href="#linear"/.test(navLinear) && /navTo\('linear'\)/.test(navLinear) && /<\/svg>\s*Submit\s*<\/a>$/.test(navLinear));
check('Linear logo moved verbatim to the mirror tab', navProd.includes(linearLogo) && !navLinear.includes(linearLogo));
check('Submit uses the established neutral plus glyph', navLinear.includes(submitIcon));
check('Production pre-paint route lights the promoted mirror tab', index.includes('html[data-boot-nav="production"] #navProd'));
check('desktop header reserves a bounded middle column for nav', index.includes('grid-template-columns:auto minmax(0,1fr) auto'));
check('header nav scrolls without colliding with shell actions', /\.header-nav \{[^}]*width: max-content;[^}]*max-width: 100%;[^}]*overflow-x: auto;/.test(index));
check('header nav items remain intact inside the scroll strip', /\.header-nav-btn \{[^}]*flex: 0 0 auto;[^}]*white-space: nowrap;/.test(index));
check('navigation reveals the active tab inside the bounded strip', /activeHeaderNav\.scrollIntoView\(\{ block: 'nearest', inline: 'nearest' \}\)/.test(index));
check('Production keyboard shortcuts yield to focused app controls', prodBlock.includes('const activeControl = document.activeElement') && prodBlock.includes('if (activeControl) return;'));
check('Production issue rows skip off-screen rendering with a fixed 44px fallback',
  /content-visibility:\s*auto\s*;/.test(prodRowRule)
  && /contain-intrinsic-size:\s*0(?:px)?\s+44px\s*;/.test(prodRowRule)
  && /contain:\s*content\s*;/.test(prodRowRule));
check('_prodEnabled is query-flagged on ?prod=1', /function _prodEnabled\(\) \{\s*try \{ return new URLSearchParams\(location\.search\)\.get\('prod'\) === '1'; \}/.test(index));
check('navTo hard-falls back without direct preview or verified staff access', /if \(page === 'production' && !_prodAccessAllowed\(\)\) page = 'home';/.test(index));
check('Production staff access is direct preview OR verified identity', /function _prodAccessAllowed\(\) \{\s*return _prodEnabled\(\) \|\| _syncviewStaffIdentityValid\(\);\s*\}/.test(index));
check('submission-only linear key wiring remains unchanged', /if \(currentNav === 'linear'\) updateLinearFilmingPlan\(\);/.test(index));
check('production navigation still sets only the prod alias', /if \(page === 'production'\) query\.set\('prod', '1'\);\s*else query\.delete\('prod'\);/.test(index));
check('init fast-mounts Production only when _prodEnabled()', /else if \(_prodEnabled\(\)\) _setBootLoadingText\('Loading Production preview\.\.\.'\);[\s\S]{0,220}if \(_prodEnabled\(\)\) \{[\s\S]{0,220}navTo\('production', false\)/.test(index));
check('Production preview suppresses queued calendar-card writers', /setTimeout\(\(\) => \{\s*if \(_prodEnabled\(\)\) return;[\s\S]{0,120}_resumePendingCalCardJobs\(\)/.test(index));
check('Production preview starts essentials for clean nav-out', /if \(_prodEnabled\(\)\) \{[\s\S]{0,260}fetchEssentials\(\)\.then/.test(index));
check('FAST_TABS does not include production', /const FAST_TABS = \[[^\]]+\]/.test(index) && !/const FAST_TABS = \[[^\]]*production/.test(index));

check('preview reads B1 dormant tables', /_prodRestRows\('clients'/.test(prodBlock) && /_prodRestRows\('batches'/.test(prodBlock) && /_prodRestRows\('deliverables'/.test(prodBlock));
check('preview does not expose service-role-only archive table', !/linear_archive/.test(prodBlock));
check('preview does not read or write runtime flags', !/syncview_runtime_flags/.test(prodBlock));
check('preview fetches projected archive/delete markers instead of full linear_raw at boot',
  /_prodRestRows\('deliverables'[\s\S]{0,1200}raw_issue_archived_at:linear_raw->issue->>archivedAt/.test(prodBlock)
  && /raw_issue_canceled_at:linear_raw->issue->>canceledAt/.test(prodBlock)
  && /raw_webhook_delete:linear_raw->>webhook_delete/.test(prodBlock)
  && !/linear_issue_url,linear_raw'/.test(prodBlock)
  && !/title,brief,status/.test(prodBlock));
check('preview lazy-loads full linear_raw for a single detail row',
  /async function _prodLoadLinearRawFor\(id\)/.test(prodBlock)
  && /_prodRestRows\('deliverables', 'id,brief,linear_raw', 'id=eq\.'/.test(prodBlock)
  && /_prodLoadLinearRawFor\(id\)/.test(prodBlock)
  && /function _prodRender\(\)[\s\S]{0,900}_prodLoadLinearRawFor\(_prodState\.openId\)/.test(prodBlock));
check('preview background-loads brief text outside boot',
  /async function _prodLoadBriefs\(opts\)/.test(prodBlock)
  && /_prodRestRows\('deliverables', 'id,brief', 'order=id\.asc', 1000, 50\)/.test(prodBlock)
  && /setTimeout\(\(\) => _prodLoadBriefs\(\{ silent: true \}\), 6500\)/.test(prodBlock));
check('preview preserves hydrated descriptions across projected refresh rows',
  /function _prodPreserveProjectedFields\(incoming, previous, key, fields\)/.test(prodBlock)
  && /mergedClients = _prodPreserveProjectedFields\(clients, _prodState\.clients, 'slug', \['board_desc', 'desc'\]\)/.test(prodBlock)
  && /mergedBatches = _prodPreserveProjectedFields\(batches, _prodState\.batches, 'id', \['description', 'desc'\]\)/.test(prodBlock)
  && /mergedDeliverables = _prodPreserveProjectedFields\(deliverables, _prodState\.deliverables, 'id', \['brief', 'linear_raw', 'desc'\]\)/.test(prodBlock)
  && /_prodState\.adapter = _prodAdapter\(\{ clients: mergedClients, members, batches: mergedBatches, deliverables: mergedDeliverables \}\)/.test(prodBlock));
check('preview distinguishes pending descriptions from authoritative empty values',
  /function _prodDescriptionHTML\(value, loaded, emptyText, rich\)/.test(prodBlock)
  && /data-prod-desc-loading/.test(prodBlock)
  && /descLoaded: !!descField/.test(prodBlock)
  && /_prodState\.linearRaw\.has\(d\.id\)[\s\S]{0,90}_prodState\.linearRaw\.get\(d\.id\) !== null/.test(prodBlock));
check('preview maps project and batch descriptions through the shared loaded-state renderer',
  /descField = _prodHasOwn\(c, 'board_desc'\)/.test(prodBlock)
  && /_prodDescriptionHTML\(c\.desc, !!c\.descLoaded, 'No project description\.', false\)/.test(prodBlock)
  && /_prodDescriptionHTML\(desc, !!descField, 'No batch description\.', false\)/.test(prodBlock));
check('preview filters Linear webhook delete/archive markers out of live issues', /function _prodDeliverableLive\(d\)/.test(prodBlock)
  && /webhook_delete/.test(prodBlock)
  && /raw\.issue && \(raw\.issue\.archivedAt \|\| raw\.issue\.canceledAt\)/.test(prodBlock)
  && /hasProjectedMarkers = projectedMarkers\.some/.test(prodBlock)
  && /!hasProjectedMarkers && _prodRawHasAny/.test(prodBlock)
  && /raw_issue_archived_at/.test(prodBlock)
  && /deliverables = \(raw\.deliverables \|\| \[\]\)\.filter\(_prodDeliverableLive\)/.test(prodBlock));
check('preview fetch helper uses default GET with retry', /async function _prodRestPage\(url, table, page\)/.test(prodBlock) && /fetch\(url, \{ headers: _prodHeaders\(\) \}\)/.test(prodBlock) && /resp\.status === 429 \|\| resp\.status >= 500/.test(prodBlock));
check('preview read helper takes explicit page size and max page cap', /async function _prodRestRows\(table, select, params, pageSize, maxPages\)/.test(prodBlock) && /page < cap/.test(prodBlock) && /read exceeded pagination cap/.test(prodBlock));
check('preview read helper strips duplicate limit and offset params', prodBlock.includes('!/^limit=|^offset=/.test(p)'));
check('preview callers pass page sizes explicitly', /_prodRestRows\('deliverables'[\s\S]{0,1200}, 1000, 50\)/.test(prodBlock) && /_prodRestRows\('deliverable_events'[\s\S]{0,220}, 30, 2\)/.test(prodBlock));
const explicitMutationMethods = [...prodBlock.matchAll(/['"`](POST|PUT|PATCH|DELETE)['"`]/g)].map(match => match[1]);
check('preview block allows only the protected comment-read POST', explicitMutationMethods.length === 1
  && explicitMutationMethods[0] === 'POST'
  && /fetch\(PROD_COMMENTS_EF_URL,[\s\S]{0,180}method: 'POST'/.test(prodBlock)
  && /deliverable_id: id, limit: PROD_COMMENTS_PAGE_SIZE, before: cursor \|\| null/.test(prodBlock));
check('preview block has no Supabase write helpers', !/\.(insert|update|upsert|rpc)\s*\(/.test(prodBlock));
check('topbar excludes non-artifact New issue and Refresh chrome', !/New issue/.test(prodBlock) && !/<button class="prod-tab" type="button" onclick="_prodRefresh\(\)">Refresh<\/button>/.test(prodBlock));
check('visible write affordances are guarded without scaffold pills',
  /data-prod-disabled="composer"/.test(prodBlock)
  && /data-prod-disabled="add-subissue"/.test(prodBlock)
  && !/data-prod-disabled="detail-controls"/.test(prodBlock)
  && !/data-prod-disabled="project-controls"/.test(prodBlock)
  && !/Controls disabled|prod-disabled-pill/.test(prodBlock));
check('deep links include deliverable, batch, team, and client filters', /q\.get\('d'\)/.test(prodBlock) && /q\.get\('batch'\)/.test(prodBlock) && /q\.get\('team'\)/.test(prodBlock) && /q\.get\('client'\)/.test(prodBlock));

if (failures) {
  console.error('\nproduction-preview-source: ' + failures + ' check(s) failed');
  process.exit(1);
}
console.log('production-preview-source: promoted nav, read-only, and route-lock checks passed');
