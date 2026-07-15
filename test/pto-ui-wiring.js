'use strict';

// Offline source contract for the PTO browser surface. The app is intentionally
// a single-file SPA, so these checks pin every registration/gating seam that can
// otherwise drift without making a syntax error.
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function functionSource(name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  if (!match) throw new Error(`missing function ${name}`);
  const start = match.index;
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

const nav = functionSource('navTo');
const setFlag = functionSource('_ptoSetFlagValue');
const api = functionSource('_ptoApi');
const paint = functionSource('_ptoPaint');
const calendar = functionSource('_ptoRenderCalendar');
const kasperView = functionSource('renderKasperView');
const kasperGoto = functionSource('_kasperGotoTab');
const kasperTab = functionSource('_kasperRenderTab');
const admin = functionSource('_ptoRenderAdmin');
const refreshChrome = functionSource('_syncviewStaffRefreshChrome');
const purgeSensitive = functionSource('_syncviewStaffPurgeSensitiveState');
const invalidateCaches = functionSource('_ptoInvalidateOverviewCaches');
const fetchFlag = functionSource('_ptoFetchFlagOnce');
const loadOverview = functionSource('_ptoLoadOverview');
const loadAdmin = functionSource('_ptoLoadAdmin');
const syncRequest = functionSource('_ptoSyncRequestForm');
const submitRequest = functionSource('_ptoSubmitRequest');

// The six route/boot registration touchpoints from the binding handoff.
ok(/else if \(page === 'time-off'\) \{[\s\S]{0,220}renderTimeOffView\(\)[\s\S]{0,120}mountTimeOffView\(\)/.test(nav), 'route 1/6: nav dispatch renders and mounts Time Off');
ok(/getElementById\('navTimeOff'\)[\s\S]{0,120}page === 'time-off'/.test(nav) && !/id=["']navTimeOff["']/.test(source), 'route 2/6: active toggle is a menu-only no-op');
ok(/else if \(hashRaw === 'time-off'\) \{\s*navTo\('time-off', false\)/.test(source), 'route 3/6: fast hash router restores #time-off');
ok(/if\(hash==='time-off'\)\{navTo\('time-off',false\);return;\}/.test(source), 'route 4/6: full hash router restores #time-off');
ok(/var FAST = \[[^\]]*'time-off'[^\]]*\][\s\S]{0,180}var RESTORABLE_FAST = FAST\.filter/.test(source)
  && /const FAST_TABS = \[[^\]]*'time-off'[^\]]*\][\s\S]{0,180}const RESTORABLE_FAST_TABS = FAST_TABS\.filter/.test(source), 'route 5/6: both boot/app fast and restorable lists include Time Off');
ok(source.includes('html[data-boot-nav="time-off"] .boot-skeleton-analytics'), 'route 6/6: pre-paint generic skeleton maps #time-off');

// One top-right menu retains the existing identity/theme/palette hooks.
ok(/id="headerMenuButton"[^>]+aria-label="Open staff menu"[^>]+aria-haspopup="menu"[^>]+aria-expanded="false"/.test(source), 'header exposes one accessible staff menu button');
for (const id of ['staffAccountPopover', 'staffIdentitySignOut', 'headerTimeOffMenuItem', 'themeToggle', 'statusPaletteToggle']) {
  ok(source.includes(`id="${id}"`), `header menu retains ${id}`);
}
ok(/id="headerTimeOffMenuItem"[^>]+onclick="_ptoOpenFromMenu\(\)"[^>]+hidden/.test(source), 'Time Off header row ships hidden');
ok(!source.includes('id="staffIdentityButton"'), 'legacy standalone identity button is removed');

// Dark-by-default and fail-closed flag behavior across every entry point.
ok(/let _ptoFlagValue = \{ mode: 'off' \}/.test(source) && /const PTO_FLAG_KEY = 'pto_v1'/.test(source), 'pto_v1 defaults off');
ok(/if \(page === 'time-off' && !_ptoEnabled\(\)\) page = 'home'/.test(nav), 'direct navigation bounces home while disabled');
ok(/menuItem\.hidden = !enabled/.test(setFlag) && /_ptoInvalidateOverviewCaches\(\)/.test(setFlag), 'flag disable hides entry and purges cached PTO data');
ok(/_kasperState\.tab = 'review'/.test(setFlag) && /navTo\('home'\)/.test(setFlag), 'flag disable retires open top-level and Kasper views');
ok(/KASPER_SUBTABS\.filter\(t => t\.key !== 'time-off' \|\| _ptoEnabled\(\)\)/.test(kasperView)
  && /tab === 'time-off' && !_ptoEnabled\(\)/.test(kasperGoto)
  && /_kasperState\.tab === 'time-off' && !_ptoEnabled\(\)/.test(kasperTab), 'Kasper Time Off tab is filtered and guarded while disabled');
ok(/await _ptoFlagReady/.test(source) && /hashRaw === 'kasper\/time-off'/.test(source), 'boot awaits the flag before restoring PTO routes');
ok(/feature_disabled[\s\S]{0,140}_ptoSetFlagValue\(\{ mode: 'off' \}\)/.test(api), 'server feature_disabled response closes stale clients');
ok(/AbortController/.test(fetchFlag) && /setTimeout\(\(\) => controller\.abort\(\), 5000\)/.test(fetchFlag), 'runtime flag boot read times out and fails closed');
ok(/const generation = \+\+_ptoFlagGeneration/.test(fetchFlag) && /generation !== _ptoFlagGeneration/.test(setFlag)
  && /const generation = \+\+_ptoFlagGeneration;[\s\S]{0,140}_ptoSetFlagValue/.test(source), 'runtime flag reads and realtime events cannot apply out of order');
ok(/window\.addEventListener\('focus', _ptoRefreshFlagOnResume\)/.test(source)
  && /document\.addEventListener\('visibilitychange', _ptoRefreshFlagOnResume\)/.test(source), 'resume paths re-read the rollback flag after a disconnected tab');

// Staff-authenticated Edge Function contract and filming-plans-style 401 retry.
ok(/const PTO_EF_URL = CAL_SUPABASE_URL \+ '\/functions\/v1\/pto'/.test(source), 'PTO uses the first-party Supabase Edge Function');
ok(/_syncviewRequireStaffIdentity\(adminAction \? 'pto-admin' : undefined\)/.test(api), 'PTO calls require verified staff and admin actions require pto-admin');
ok(/_syncviewEfHeaders\([\s\S]{0,260}PTO_EF_URL\)/.test(api), 'PTO requests use the shared staff header injector');
ok(/response\.status === 401[\s\S]{0,500}_syncviewStaffIdentityClear\(\)[\s\S]{0,500}_syncviewOpenStaffIdentity\(\{ reason: 'expired' \}\)[\s\S]{0,260}_ptoApi\(action, method, payload, true\)/.test(api), '401 clears identity, re-prompts, and retries once');
ok(/actor_member_id = identity\.member\.id/.test(api) && /wire\.member_id = identity\.member\.id/.test(api), 'wire payload binds admin and requester actions to verified identities');
ok(!/n8n|webhook/i.test(api) && !/\/rest\/v1\/pto_(?:members|requests|adjustments)/.test(source), 'browser never calls n8n or PTO tables directly');
ok(/_ptoInvalidateOverviewCaches\(\)/.test(purgeSensitive)
  && /if \(!valid\)[\s\S]*_ptoPaint\(\)[\s\S]*_ptoRenderAdmin\(\)/.test(refreshChrome), 'sign-out and identity changes immediately replace mounted PTO data');
ok(/_ptoState\.overview = null/.test(invalidateCaches) && /_ptoAdminState\.overview = null/.test(invalidateCaches)
  && (source.match(/_ptoInvalidateOverviewCaches\(\);/g) || []).length >= 5, 'every PTO mutation invalidates both staff and admin overview caches');
ok(/\+\+_ptoOverviewGeneration/.test(loadOverview) && /generation !== _ptoOverviewGeneration/.test(loadOverview)
  && /\+\+_ptoAdminOverviewGeneration/.test(loadAdmin) && /generation !== _ptoAdminOverviewGeneration/.test(loadAdmin), 'stale overview responses cannot repopulate invalidated staff or admin caches');
ok(!/localStorage\.(?:setItem|getItem)\([^\n]*(?:_ptoState|_ptoAdminState|PTO_EF_URL)/.test(source), 'PTO and HR payloads remain memory-only, never localStorage data');

// Staff balance, request, history, team, and calendar surfaces.
ok(/pto-balance-card/.test(paint) && /Wellness available/.test(paint) && /sick days remaining/.test(paint) && /floating holiday/.test(paint), 'staff view renders complete balance detail');
ok(/id="ptoRequestForm"/.test(paint) && /id="ptoRequestType"/.test(paint) && /id="ptoDays"[^>]+step="0\.5"/.test(paint) && /id="ptoNotice"[^>]+hidden/.test(paint), 'staff request form supports types, half days, and notice warning');
ok(/isFloating[\s\S]*end\.value = start\.value/.test(syncRequest)
  && /type === 'floating_holiday' && \(start !== end \|\| fullDays !== 1\)/.test(submitRequest), 'floating holidays stay on one business-date calendar cell');
ok(/const partialDayCount = Math\.max\(0\.5, allowedDays - 0\.5\)/.test(syncRequest)
  && /days !== allowedDays && days !== partialDayCount/.test(submitRequest), 'request UI allows the full count or one half-day endpoint only');
ok(/_ptoState\.overview[\s\S]*as_of_date/.test(syncRequest) && /const asOf = String\(_ptoState\.overview[\s\S]*as_of_date/.test(submitRequest)
  && /overview && overview\.as_of_date/.test(calendar), 'PTO comparisons and calendar today use the server date');
ok(/My requests/.test(paint) && /_ptoCancelRequest/.test(paint) && /Team snapshot/.test(paint) && /_ptoRenderCalendar\(overview\)/.test(paint), 'staff view renders history, cancellation, team snapshot, and calendar');
ok(/overview\.absences/.test(calendar) && /overview\.holidays/.test(calendar) && /getMonth\(\) - 3/.test(calendar) && /getMonth\(\) \+ 3/.test(calendar), 'calendar consumes server absences/holidays within the API window');

// Kasper approval queue, balance table, and admin maintenance controls.
ok(/\{ key: 'time-off', label: 'Time Off', showCount: true/.test(source) && /_ptoRenderAdmin\(\)/.test(kasperTab), 'Kasper registers and renders the Time Off subtab');
ok(/_syncviewStaffCan\('pto-admin'\)/.test(admin) && /Admin sign-in required/.test(admin), 'Kasper admin data is hidden without an admin identity');
ok(/Pending requests/.test(admin) && /_ptoAdminDecide/.test(admin) && />Approve<\/button>/.test(admin) && />Deny<\/button>/.test(admin), 'Kasper queue exposes approve and deny controls');
ok(/Member balances/.test(admin) && /<th>Granted<\/th>/.test(admin) && /<th>Used<\/th>/.test(admin) && /pto-negative/.test(admin), 'Kasper balance table includes required fields and negative styling');
ok(/member\.sick_available\) < 0 \? 'pto-negative'/.test(admin), 'negative sick balances are styled red in Kasper');
ok(/_ptoAdminSetMember/.test(admin) && /id="ptoAdminStart"/.test(admin) && /id="ptoAdminEnabled"/.test(admin)
  && /_ptoAdminAdjust/.test(admin) && /id="ptoAdjustDelta"/.test(admin) && /id="ptoAdjustReason"/.test(admin), 'Kasper exposes member setup and adjustment controls');
ok(/_kasperSetTabCount\('time-off', pending\.length\)/.test(admin), 'Kasper badge is driven by pending request count');

if (failures) {
  console.error(`\n${failures} PTO UI wiring check(s) failed`);
  process.exit(1);
}
console.log('\nPTO UI wiring checks passed');
