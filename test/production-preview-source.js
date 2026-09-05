'use strict';
/*
 * Track B B2 source guard.
 *
 * The promoted mirror is query-backed, with only explicitly guarded gateway
 * writes. This test pins the safety invariants and the deliberate
 * visible-label/internal-route split
 * that are easy to regress in a single-file app:
 *   - the visible Linear mirror precedes Submit and stays mounted in staff nav
 *   - navTo cannot enter the tab without _prodAccessAllowed()
 *   - the preview block has only protected reads and guarded gateway writes,
 *     with no runtime-flag/n8n/direct Linear writes
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
const prodEnd = index.indexOf('async function init(', prodStart);
const prodBlock = prodStart >= 0 && prodEnd > prodStart ? index.slice(prodStart, prodEnd) : '';

/* Brace-matches _prodRender out of the block, skipping strings AND comments --
   index.html comments are prose full of apostrophes and braces, which a
   quote-only scanner misreads as code. */
function renderBody() {
  const start = prodBlock.indexOf('function _prodRender()');
  if (start < 0) return '';
  let depth = 0, quote = '', comment = '', escaped = false;
  for (let i = prodBlock.indexOf('{', start); i < prodBlock.length; i++) {
    const c = prodBlock[i], n = prodBlock[i + 1];
    if (comment === 'line') { if (c === '\n') comment = ''; continue; }
    if (comment === 'block') { if (c === '*' && n === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') { comment = 'line'; i++; continue; }
    if (c === '/' && n === '*') { comment = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return prodBlock.slice(start, i + 1);
  }
  return '';
}
const navMarkup = id => {
  const match = index.match(new RegExp(`<a[^>]+id="${id}"[\\s\\S]*?<\\/a>`));
  return match ? match[0] : '';
};
const navProd = navMarkup('navProd');
const navLinear = navMarkup('navLinear');
const prodRowRule = (index.match(/\.prod-row\s*\{([^}]*)\}/) || [])[1] || '';
/* 2026-08-21: the owner replaced the inline currentColor glyphs with the icon
   set he designed, and renamed the mirror tab's LABEL to SyncLinear. What these
   checks defend is unchanged and is the thing that has actually broken before:
   the two tabs must keep their own distinct identity — separate route, separate
   hash, separate icon — so the mirror can never be wired to the Submit form or
   vice versa. The icons are painted through a CSS mask so they still take
   their colour from currentColor exactly as the glyphs did; only the anchor
   moved from `</svg>` to the icon span's closing tag. */
const synclinearIcon = 'ico-synclinear';
const submitIcon = 'ico-submit';

check('Production preview block exists before init()', !!prodBlock);
check('promoted Linear mirror nav is always mounted', !!navProd && !/display\s*:\s*none/.test(navProd) && !/navProd\.style\.display/.test(index));
check('staff-identity and Production mount code no longer hide the promoted nav', !/getElementById\('navProd'\)[\s\S]{0,140}\.style\.display/.test(index));
check('visible order is Analytics then Linear mirror then Submit', index.indexOf('id="navHome"') < index.indexOf('id="navProd"') && index.indexOf('id="navProd"') < index.indexOf('id="navLinear"'));
check('Linear mirror keeps production id, hash, and nav key', /href="#production"/.test(navProd) && /navTo\('production'\)/.test(navProd) && />\s*SyncLinear\s*<\/a>$/.test(navProd));
check('Submit keeps linear id, hash, and nav key', /href="#linear"/.test(navLinear) && /navTo\('linear'\)/.test(navLinear) && />\s*Submit\s*<\/a>$/.test(navLinear));
check('the mirror tab carries its own icon and not the Submit one', navProd.includes(synclinearIcon) && !navProd.includes(submitIcon));
check('Submit carries its own icon and not the mirror one', navLinear.includes(submitIcon) && !navLinear.includes(synclinearIcon));
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
check('init fast-mounts Production only for a clean non-client ?prod=1 entry', /else if \(_prodEnabled\(\)\) _setBootLoadingText\('Loading Production preview\.\.\.'\);[\s\S]{0,260}if \(!_isClientLink && _prodEnabled\(\)\) \{[\s\S]{0,220}navTo\('production', false\)/.test(index));
check('client entries and Production preview both suppress queued calendar-card writers', /setTimeout\(\(\) => \{\s*if \(_isClientLink \|\| _prodEnabled\(\)\) return;[\s\S]{0,120}_resumePendingCalCardJobs\(\)/.test(index));
check('clean non-client Production preview starts essentials for nav-out', /if \(!_isClientLink && _prodEnabled\(\)\) \{[\s\S]{0,260}fetchEssentials\(\)\.then/.test(index));
check('FAST_TABS does not include production', /const FAST_TABS = \[[^\]]+\]/.test(index) && !/const FAST_TABS = \[[^\]]*production/.test(index));

check('preview reads B1 dormant tables through the safe deliverable projection',
  /_prodRestRows\('clients'/.test(prodBlock)
  && /_prodRestRows\('batches'/.test(prodBlock)
  && /_prodRestRows\(\s*'production_deliverables_browser_v1'/.test(prodBlock));
check('preview does not expose service-role-only archive table', !/linear_archive/.test(prodBlock));
check('preview reads only the authority flag needed to fail closed',
  /_prodRestRows\('syncview_runtime_flags', 'value', 'key=eq\.'/.test(prodBlock)
  && /PROD_AUTHORITY_FLAG_KEY = 'prod_authority'/.test(prodBlock)
  && !/syncview_runtime_flags[\s\S]{0,180}(POST|PATCH|PUT|DELETE)/.test(prodBlock));
check('preview fetches bounded projected archive/delete markers instead of full linear_raw at boot',
  /production_deliverables_browser_v1/.test(prodBlock)
  && /raw_issue_archived_at,raw_issue_canceled_at,raw_webhook_delete/.test(prodBlock)
  && /linear_issue_uuid/.test(prodBlock)
  && /raw_issue_parent_id,raw_project_id/.test(prodBlock)
  && /if \(!_prodBrowserProjectionMissing\(error\)\) throw error/.test(prodBlock)
  && !/_prodLoadData[\s\S]{0,1800}linear_issue_url,linear_raw'/.test(prodBlock)
  && !/_prodLoadData[\s\S]{0,1800}title,brief,status/.test(prodBlock));
check('preview hierarchy follows resolved Linear parent links, deliverable rows first, batch records second',
  /function _prodResolveParentLinks\(rows\)/.test(prodBlock)
  && /const parentLinks = _prodResolveParentLinks\(deliverables\)/.test(prodBlock)
  && /parent: parentLinks\.get\(String\(d\.id \|\| ''\)\) \|\| null/.test(prodBlock)
  && /function _prodResolveBatchParentNodes\(rows, batches, parentLinks\)/.test(prodBlock)
  && /deliverableUuids\.has\(uuid\)/.test(prodBlock)
  && !/batchTeamKey|_prodSameTitle|_prodIsBatchParent/.test(prodBlock));
check('preview never lazy-loads full linear_raw for a detail row',
  /async function _prodLoadLinearRawFor\(id\)/.test(prodBlock)
  && /_prodState\.linearRaw\.set\(id, \{\}\)/.test(prodBlock)
  && !/async function _prodLoadLinearRawFor\(id\)[\s\S]{0,900}_prodRestRows/.test(prodBlock)
  && /_prodLoadLinearRawFor\(id\)/.test(prodBlock)
  /* The pinned property is that RENDER ITSELF triggers the lazy load. That was
     expressed as a character-distance window, which is a proxy for "inside
     _prodRender" and a bad one: the window was widened 900 -> 1200 on
     2026-08-06 when render gained one guard line, and it broke again on
     2026-08-31 when the detail branch gained an explanatory comment — neither
     of which moved the property being asserted. It now brace-matches
     _prodRender's actual body, so prose and guard lines are free and only a
     real move of the call fails it. */
  && renderBody().includes('_prodLoadLinearRawFor(openRowId)'));
check('preview disables legacy bulk brief hydration outside boot',
  /async function _prodLoadBriefs\(opts\)/.test(prodBlock)
  && !/async function _prodLoadBriefs\(opts\)[\s\S]{0,700}_prodRestRows/.test(prodBlock)
  && /Descriptions are hydrated only on demand through the guarded/.test(prodBlock)
  && /setTimeout\(\(\) => _prodLoadBriefs\(\{ silent: true \}\), 6500\)/.test(prodBlock));
check('preview preserves safe project/batch descriptions while invalidating scoped deliverable bodies',
  /function _prodPreserveProjectedFields\(incoming, previous, key, fields\)/.test(prodBlock)
  && /mergedClients = _prodPreserveProjectedFields\(clients, _prodState\.clients, 'slug', \['board_desc', 'desc'\]\)/.test(prodBlock)
  && /mergedBatches = _prodPreserveProjectedFields\(batches, _prodState\.batches, 'id', \['description', 'desc'\]\)/.test(prodBlock)
  /* Deliverables are never field-preserved across a refresh (that is the
     property here); the only thing the fresh set gains is a deep-linked row
     the boot-time fast paint read a moment earlier, see _prodCarryDeepLinkRows. */
  && /const mergedDeliverables = _prodCarryDeepLinkRows\(deliverables\)/.test(prodBlock)
  && !/_prodPreserveProjectedFields\(deliverables/.test(prodBlock)
  && /_prodInvalidateScopedReads\(\)/.test(prodBlock)
  && /_prodState\.adapter = _prodAdapter\(\{ clients: mergedClients, members, batches: mergedBatches, deliverables: mergedDeliverables \}\)/.test(prodBlock));
check('preview distinguishes pending descriptions from authoritative empty values',
  /function _prodDescriptionHTML\(value, loaded, emptyText, rich\)/.test(prodBlock)
  && /data-prod-desc-loading/.test(prodBlock)
  && /action: 'description_read'/.test(prodBlock)
  && /projectionGeneration === _prodState\.projectionGeneration/.test(prodBlock)
  && /state\.status = 'error'/.test(prodBlock)
  && /state\.status = 'stale'/.test(prodBlock)
  && /_prodDescriptionHTML\(state\.value, state\.hasValue, 'No description\.', true\)/.test(prodBlock));
check('preview maps project and batch descriptions through the shared loaded-state renderer',
  /descField = _prodHasOwn\(c, 'board_desc'\)/.test(prodBlock)
  && /_prodDescriptionHTML\(c\.desc, !!c\.descLoaded, 'No project description\.', false\)/.test(prodBlock)
  && /_prodDescriptionHTML\(desc, !!descField, 'No batch description\.', false\)/.test(prodBlock));
check('preview filters Linear webhook delete/archive markers out of live issues but keeps canceled rows visible', /function _prodDeliverableLive\(d\)/.test(prodBlock)
  && /webhook_delete/.test(prodBlock)
  && /raw\.issue && raw\.issue\.archivedAt/.test(prodBlock)
  && !/raw\.issue\.canceledAt/.test(prodBlock)
  && !/_prodRawMarkerTruthy\(d && d\.raw_issue_canceled_at\)/.test(prodBlock)
  && /hasProjectedMarkers = projectedMarkers\.some/.test(prodBlock)
  && /!hasProjectedMarkers && _prodRawHasAny/.test(prodBlock)
  && /raw_issue_archived_at/.test(prodBlock)
  && /deliverables = \(raw\.deliverables \|\| \[\]\)\.filter\(_prodDeliverableLive\)/.test(prodBlock));
check('preview fetch helper uses default GET with retry', /async function _prodRestPage\(url, table, page\)/.test(prodBlock) && /fetch\(url, \{ headers: _prodHeaders\(\) \}\)/.test(prodBlock) && /resp\.status === 429 \|\| resp\.status >= 500/.test(prodBlock));
check('preview read helper takes explicit page size and max page cap', /async function _prodRestRows\(table, select, params, pageSize, maxPages, options\)/.test(prodBlock) && /page < cap/.test(prodBlock) && /read exceeded pagination cap/.test(prodBlock));
// F95 read path: the deliverable projection walks the primary key instead of
// OFFSET, so no page re-sorts the whole relation and no request burst runs.
check('deliverable projection paginates by primary-key keyset, not offset, and never bursts',
  /const keysetColumn = String\(options && options\.keysetColumn \|\| ''\)\.trim\(\)/.test(prodBlock)
  && /'&order=' \+ encodeURIComponent\(keysetColumn\) \+ '\.asc'/.test(prodBlock)
  && /'=gt\.' \+ encodeURIComponent\(cursor\)/.test(prodBlock)
  && /keyset read stalled/.test(prodBlock)
  // `params` (was a literal '') carries the live/terminal split of the boot
  // read. The keyset contract this check exists for is unchanged: same column,
  // same page size and cap, no offset, no burst — only the filter varies.
  && /_prodRestRows\(\s*'production_deliverables_browser_v1',\s*select,\s*params,\s*1000,\s*50,\s*\{ keysetColumn: 'id' \}/.test(prodBlock)
  && !/order=team\.asc,status\.asc,due_date\.asc/.test(prodBlock));
check('preview read helper strips duplicate limit and offset params', prodBlock.includes('!/^limit=|^offset=/.test(p)'));
check('preview callers pass page sizes explicitly', /_prodRestRows\(\s*'production_deliverables_browser_v1'[\s\S]{0,1200}1000,\s*50/.test(prodBlock) && /_prodRestRows\('deliverable_events'[\s\S]{0,220}, 30, 2\)/.test(prodBlock));
const explicitMutationMethods = [...prodBlock.matchAll(/['"`](POST|PUT|PATCH|DELETE)['"`]/g)].map(match => match[1]);
check('preview block limits POSTs to protected reads, guarded creation, and authority-gated native writes', explicitMutationMethods.length === 11
  && explicitMutationMethods.every(method => method === 'POST')
  && /async function _prodEnsureAssigneeOptions\(id, force\)[\s\S]*?fetch\(PROD_WRITE_EF_URL,[\s\S]{0,260}method: 'POST'[\s\S]{0,700}action: 'assignee_options',[\s\S]{0,120}surface: 'production'/.test(prodBlock)
  && /fetch\(PROD_COMMENTS_EF_URL,[\s\S]{0,180}method: 'POST'/.test(prodBlock)
  && /const requestBody = \{[\s\S]{0,220}deliverable_id: id,[\s\S]{0,160}limit: PROD_COMMENTS_PAGE_SIZE,[\s\S]{0,160}before: cursor \|\| null[\s\S]{0,100}if \(clientSurface\) Object\.assign\(requestBody, clientSurface\)/.test(prodBlock)
  && /fetch\(PROD_WRITE_EF_URL,[\s\S]{0,260}method: 'POST'[\s\S]{0,500}action: 'labels_read', surface: 'production', id/.test(prodBlock)
  && /async function _prodEnsureDescription\(id, force\)[\s\S]*?fetch\(PROD_WRITE_EF_URL,[\s\S]{0,260}method: 'POST'[\s\S]{0,700}action: 'description_read'/.test(prodBlock)
  && /async function _prodEnsureAssets\(id, force, opts\)[\s\S]*?fetch\(PROD_WRITE_EF_URL,[\s\S]{0,260}method: 'POST'[\s\S]{0,700}action: 'asset_access_read',[\s\S]{0,120}surface: 'production'/.test(prodBlock)
  /* The tenth POST, added 2026-08-31: the file links behind the sub-issue
     pills. A protected READ like the five above it -- the browser projection
     deliberately does not carry file_url, so the pill has nowhere else to get
     the link, and one request per batch replaces four outbound probes per
     child. */
  && /async function _prodEnsureBatchFiles\(batchId, clientSlug\)[\s\S]*?fetch\(PROD_WRITE_EF_URL,[\s\S]{0,260}method: 'POST'[\s\S]{0,700}action: 'batch_files_read',[\s\S]{0,120}surface: 'production'/.test(prodBlock)
  && /async function _prodArchiveRequest\(body\)[\s\S]*?fetch\(PROD_ARCHIVE_EF_URL,[\s\S]{0,180}method: 'POST'/.test(prodBlock)
  /* The eleventh POST, added 2026-09-05: an image pasted into a description.
     A staff-only WRITE to its own function, description-image-upload, which
     binds the object to one verified admin/SMM roster actor and checks the
     bytes before the bucket sees them; the browser ships raw bytes under the
     same staff headers as every other gateway call and never holds a storage
     key. Gated in the browser by the same _prodCanWrite the description save
     uses (see _prodDescriptionInsertImages). */
  && /async function _prodDescriptionPostImage\(issue, prepared\)[\s\S]*?const request = \{[\s\S]{0,80}method: 'POST'[\s\S]{0,900}fetch\(PROD_DESCRIPTION_IMAGE_EF_URL, request\)/.test(prodBlock)
  && /async function _prodLoadCreateOptions\(force\)[\s\S]*?fetch\(PROD_WRITE_EF_URL,[\s\S]{0,260}method: 'POST'[\s\S]{0,700}action: 'create_options',[\s\S]{0,120}surface: 'production'/.test(prodBlock)
  && /function _prodCreatePayload\(draft\)[\s\S]{0,160}operation: 'create',[\s\S]{0,100}surface: 'production'/.test(prodBlock)
  && /async function _prodPostCreatePayload\(payload\)[\s\S]*?fetch\(PROD_WRITE_EF_URL,[\s\S]{0,260}method: 'POST'/.test(prodBlock)
  && /async function _prodGatewayWrite\(issue, operation[\s\S]*?_prodCanWrite\(issue, operation\)[\s\S]*?fetch\(PROD_WRITE_EF_URL,[\s\S]{0,180}method: 'POST'/.test(prodBlock));
check('preview block has no Supabase write helpers', !/\.(insert|update|upsert|rpc)\s*\(/.test(prodBlock));
check('topbar exposes guarded New issue plus the F95 freshness control, and no scaffold Refresh pill',
  /function _prodCreateTopbarButton\(clientSlug, team\)[\s\S]*?data-prod-create-trigger="1"[\s\S]*?New issue/.test(prodBlock)
  && /_prodCreateGateText\(clientSlug, team\)/.test(prodBlock)
  && /function _prodFreshnessHTML\(\)[\s\S]{0,900}data-prod-refresh="1"/.test(prodBlock)
  && (prodBlock.match(/_prodFreshnessHTML\(\)/g) || []).length >= 4
  && !/<button class="prod-tab" type="button" onclick="_prodRefresh\(\)">Refresh<\/button>/.test(prodBlock));
check('visible write and creation affordances are guarded without scaffold pills',
  /data-prod-disabled="composer"/.test(prodBlock)
  && /function _prodAddSubIssueButtonHTML\(compact\)[\s\S]*?_prodCreateGateText\(parent\.project, parent\.team, parent\)[\s\S]*?data-prod-add-subissue=/.test(prodBlock)
  && /function _prodCreateTopbarButton\(clientSlug, team\)[\s\S]*?gate[\s\S]*?disabled title=/.test(prodBlock)
  && !/data-prod-disabled="detail-controls"/.test(prodBlock)
  && !/data-prod-disabled="project-controls"/.test(prodBlock)
  && !/Controls disabled|prod-disabled-pill/.test(prodBlock));
check('deep links include deliverable, batch, team, and client filters', /q\.get\('d'\)/.test(prodBlock) && /q\.get\('batch'\)/.test(prodBlock) && /q\.get\('team'\)/.test(prodBlock) && /q\.get\('client'\)/.test(prodBlock));

if (failures) {
  console.error('\nproduction-preview-source: ' + failures + ' check(s) failed');
  process.exit(1);
}
console.log('production-preview-source: promoted nav, read-only, and route-lock checks passed');
