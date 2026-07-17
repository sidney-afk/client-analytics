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
const apiMessage = functionSource('_ptoApiMessage');
const api = functionSource('_ptoApi');
const unknownWrite = functionSource('_ptoUnknownWrite');
const stateConflict = functionSource('_ptoStateConflict');
const blockWrites = functionSource('_ptoBlockWrites');
const refreshAfterConflict = functionSource('_ptoRefreshAfterConflict');
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
const cancelRequest = functionSource('_ptoCancelRequest');
const applyRequestDayBounds = functionSource('_ptoApplyRequestDayBounds');
const quoteRequest = functionSource('_ptoQuoteRequest');
const setQuotePending = functionSource('_ptoSetRequestQuotePending');
const selectHtml = functionSource('_svSelectHtml');
const selectKeydown = functionSource('_svSelectKeydown');
const selectPlace = functionSource('_svSelectPlace');
const dateHtml = functionSource('_svDateHtml');
const stepperHtml = functionSource('_svStepperHtml');
const stepNumber = functionSource('_svStepNumber');
const globalTooltip = source.slice(source.indexOf('(function setupGlobalTooltip'), source.indexOf('(function setupDatePicker'));
const datePicker = source.slice(source.indexOf('(function setupDatePicker'), source.indexOf('</script>', source.indexOf('(function setupDatePicker')));
const adminCancel = functionSource('_ptoAdminCancel');
const adminDecide = functionSource('_ptoAdminDecide');
const adminSetMember = functionSource('_ptoAdminSetMember');
const adminAdjust = functionSource('_ptoAdminAdjust');
const showValidation = functionSource('_ptoShowValidation');
const clearValidation = functionSource('_ptoClearValidation');
const STAFF_EXPLAIN_KEYS = [
  'wellness-available',
  'granted-this-leave-year',
  'approved-leave',
  'wellness-adjustments',
  'sick-days-remaining',
  'floating-holiday',
  'next-wellness-grant',
  'request-time-off',
  'request-type',
  'days-requested',
];
const KASPER_EXPLAIN_KEYS = [
  'pending-requests',
  'member-balances',
  'member-setup',
  'pto-enabled',
  'add-adjustment',
  'adjustment-days',
  'adjustment-effective-date',
];

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
ok(/_kasperFallbackToReview\(\)/.test(setFlag) && /navTo\('home'\)/.test(setFlag), 'flag disable retires open top-level and Kasper views');
ok(/KASPER_SUBTABS\.filter\(t => t\.key !== 'time-off' \|\| _ptoEnabled\(\)\)/.test(kasperView)
  && /tab === 'time-off' && !_ptoEnabled\(\)/.test(kasperGoto)
  && /_kasperState\.tab === 'time-off' && !_ptoEnabled\(\)/.test(kasperTab), 'Kasper Time Off tab is filtered and guarded while disabled');
ok(/t\.key === 'time-off' \? 'pto-admin'/.test(kasperView)
  && /tab === 'time-off' && !_syncviewStaffCan\('pto-admin'\)/.test(kasperGoto)
  && /_kasperState\.tab === 'time-off' && !_syncviewStaffCan\('pto-admin'\)/.test(kasperTab)
  && /\.kasper-subtab\[hidden\] \{ display: none; \}/.test(source),
  'Kasper Time Off is hidden and unrestorable without the admin capability');
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
ok(/const PTO_API_TIMEOUT_MS = 20000/.test(source)
  && /const mutating = method !== 'GET' && action !== 'quote'/.test(api)
  && /AbortController/.test(api) && /controller\.abort\(\)/.test(api) && /options\.signal = controller\.signal/.test(api)
  && /write_outcome_unknown/.test(api) && /ptoWriteOutcomeUnknown = mutating/.test(api),
  'PTO transport has a deadline and treats only unconfirmed mutations as unknown outcomes');
ok(/ptoWriteOutcomeUnknown/.test(unknownWrite)
  && /writeOutcomeUnknown/.test(blockWrites) && /Refresh Time Off to confirm/.test(blockWrites)
  && /_ptoState\.writeOutcomeUnknown = false/.test(loadOverview)
  && /_ptoAdminState\.writeOutcomeUnknown = false/.test(loadAdmin)
  && /_ptoUnknownWrite\(error\)/.test(submitRequest) && /Refresh to verify/.test(submitRequest)
  && /_ptoBlockWrites\('staff'\)/.test(submitRequest + cancelRequest)
  && /_ptoBlockWrites\('admin'\)/.test(adminDecide + adminCancel + adminSetMember + adminAdjust),
  'unknown write outcomes stay locked until a successful staff or admin overview reconciliation');
for (const code of ['request_not_pending', 'decision_conflict', 'cancel_not_allowed', 'request_not_found', 'pto_service_failed']) {
  ok(apiMessage.includes(code), `PTO maps ${code} to a plain-English lifecycle message`);
}
ok(/request_state_changed/.test(stateConflict) && /request_not_pending/.test(stateConflict)
  && /decision_conflict/.test(stateConflict) && /cancel_not_allowed/.test(stateConflict)
  && /_ptoInvalidateOverviewCaches\(\)/.test(refreshAfterConflict)
  && /_ptoLoadAdmin\(true\)/.test(refreshAfterConflict) && /_ptoLoadOverview\(true\)/.test(refreshAfterConflict)
  && /_ptoRefreshAfterConflict\('staff'/.test(submitRequest + cancelRequest)
  && /_ptoRefreshAfterConflict\('admin'/.test(adminDecide + adminCancel + adminSetMember),
  'known terminal and concurrency conflicts refresh stale staff and Kasper state');
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
ok(/id="ptoRequestForm"/.test(paint) && /_svSelectHtml\('ptoRequestType'/.test(paint)
  && /_svDateHtml\('ptoStartDate'/.test(paint) && /_svDateHtml\('ptoEndDate'/.test(paint)
  && /_svStepperHtml\('ptoDays'/.test(paint) && /id="ptoNotice"[^>]+hidden/.test(paint), 'staff request form uses branded type, date, half-day, and notice controls');
ok(/role="combobox"/.test(selectHtml) && /role="listbox"/.test(selectHtml) && /role="option"/.test(selectHtml)
  && /aria-disabled/.test(selectHtml), 'branded select exposes combobox/listbox semantics and disabled options');
ok(/ArrowDown/.test(selectKeydown) && /ArrowUp/.test(selectKeydown) && /Home/.test(selectKeydown)
  && /End/.test(selectKeydown) && /Enter/.test(selectKeydown) && /_svSelectTypeahead/.test(selectKeydown), 'branded select supports arrow, boundary, enter, and typeahead keyboard use');
ok(/window\.innerHeight/.test(selectPlace) && /open-up/.test(selectPlace) && /menu\.style\.maxHeight/.test(selectPlace)
  && /\.sv-select\.open-up \.sv-select-menu/.test(source), 'branded select flips and constrains itself to short viewports');
ok(/data-sv-date-trigger/.test(dateHtml) && /data-sv-today/.test(dateHtml) && /aria-haspopup="dialog"/.test(dateHtml)
  && /\.cal-date-chip, \[data-sv-date-trigger\]/.test(datePicker), 'branded dates reuse the in-app calendar and pin the server policy date');
ok(/minISO/.test(datePicker) && /maxISO/.test(datePicker) && /ArrowLeft/.test(datePicker)
  && /PageUp/.test(datePicker) && /e\.key === 'Tab'/.test(datePicker) && /button:not\(\[disabled\]\)/.test(datePicker)
  && /const dayTarget/.test(datePicker) && /close\(true\)/.test(datePicker), 'date picker enforces bounds, traps dialog focus, limits day keys, and restores focus');
ok(/viewportChange/.test(datePicker) && /requestAnimationFrame/.test(datePicker) && /position\(\)/.test(datePicker)
  && /MutationObserver/.test(datePicker) && /!document\.contains\(dpTriggerEl\)/.test(datePicker),
  'date picker stays anchored through scroll and closes when rerender removes its trigger');
ok(/max-height: calc\(100dvh - 16px\)/.test(source) && /@media \(max-height: 500px\)/.test(source)
  && /overscroll-behavior: contain/.test(source), 'date picker remains operable at short viewport heights and browser zoom');
ok(/sv-stepper-input/.test(stepperHtml) && /type="number"/.test(stepperHtml)
  && /Math\.min\(max, Math\.max\(min, next\)\)/.test(stepNumber), 'branded stepper preserves numeric input and clamps explicit minus/plus controls');
for (const key of STAFF_EXPLAIN_KEYS) {
  ok(paint.includes(key), `staff label-attached explainer retains stable marker ${key}`);
}
for (const key of KASPER_EXPLAIN_KEYS) {
  ok(admin.includes(key), `Kasper label-attached explainer retains stable marker ${key}`);
}
ok(/sv-explain-label/.test(source) && /data-sv-explain/.test(source) && /data-pto-explain/.test(source),
  'staff and Kasper attach plain-English explanations to the visible labels');
ok(!/\bsv-info\b|_svInfoTip/.test(paint + admin),
  'PTO markup contains no legacy info-icon badges or helper');
ok(/(?:mouseover|pointerover)/.test(globalTooltip) && /(?:mouseout|pointerout)/.test(globalTooltip)
  && /focusin/.test(globalTooltip) && /focusout/.test(globalTooltip),
  'label explanations work on pointer hover and keyboard focus');
ok(/(?:pointerdown|pointerup|touchstart|touchend|click)/.test(globalTooltip)
  && /pointerType/.test(globalTooltip) && /=== 'touch'/.test(globalTooltip)
  && /data-sv-explain/.test(globalTooltip),
  'label explanations expose a touch tap path with tap-away dismissal');
ok(/prefers-reduced-motion: reduce[\s\S]{0,260}\.sv-select-menu/.test(source)
  && /prefers-reduced-motion: reduce[\s\S]{0,260}\.dp-popup/.test(source)
  && /prefers-reduced-motion: reduce[\s\S]{0,260}\.pto-spinner/.test(source),
  'PTO menus, date popup, and loading spinner respect reduced-motion preferences');
ok(/isFloating[\s\S]*end\.value = start\.value/.test(syncRequest)
  && /type === 'floating_holiday' && \(start !== end \|\| allowedDays !== 1\)/.test(submitRequest), 'floating holidays stay on one business-date calendar cell');
ok(/const partialDayCount = Math\.max\(0\.5, allowedDays - 0\.5\)/.test(applyRequestDayBounds)
  && /days !== allowedDays && days !== partialDayCount/.test(submitRequest), 'request UI allows the full count or one half-day endpoint only');
ok(/holiday_date_min/.test(syncRequest) && /holiday_date_max/.test(syncRequest)
  && /_ptoApi\('quote', 'POST'/.test(quoteRequest) && /generation !== _ptoQuoteGeneration/.test(quoteRequest),
  'out-of-overview request ranges use a generation-safe server day-count quote');
ok(/button\.disabled = _ptoState\.writeOutcomeUnknown \|\| !!pending/.test(setQuotePending)
  && /daysInput\.disabled \|\| !String\(daysInput\.value/.test(submitRequest) && /!\(days > 0\)/.test(submitRequest),
  'pending, failed, and zero-day quotes cannot submit a request');
ok(/aria-invalid/.test(showValidation) && /aria-describedby/.test(showValidation) && /\.focus\(\)/.test(showValidation)
  && /removeAttribute\('aria-invalid'\)/.test(clearValidation) && /_ptoShowValidation\('ptoFormError'/.test(submitRequest),
  'staff validation marks, describes, focuses, and clears the visible branded controls');
ok(/end\.value && \(\(end\.min && end\.value < end\.min\) \|\| \(end\.max && end\.value > end\.max\)\)[\s\S]*end\.value = ''/.test(syncRequest),
  'request form clears an end date invalidated by a start-date or leave-type change');
ok(/_ptoState\.overview[\s\S]*as_of_date/.test(syncRequest) && /const asOf = String\(_ptoState\.overview[\s\S]*as_of_date/.test(submitRequest)
  && /overview && overview\.as_of_date/.test(calendar), 'PTO comparisons and calendar today use the server date');
ok(/My requests/.test(paint) && /decision_note/.test(paint) && /_ptoCancelRequest/.test(paint) && /Team snapshot/.test(paint) && /_ptoRenderCalendar\(overview\)/.test(paint), 'staff view renders decision notes, cancellation, team snapshot, and calendar');
ok(/pto-request-history-cards/.test(paint) && /pto-request-history-top/.test(paint)
  && /_ptoStatusHtml\(row\.status\)/.test(paint) && /Cancel request/.test(paint)
  && /\.pto-staff-history-table \{ display: none; \}/.test(source)
  && /\.pto-request-history-cards \{ display: grid;/.test(source),
  'staff mobile history uses complete readable cards with status and cancellation visible');
ok(/overview\.absences/.test(calendar) && /overview\.holidays/.test(calendar) && /getMonth\(\) - 3/.test(calendar) && /getMonth\(\) \+ 3/.test(calendar), 'calendar consumes server absences/holidays within the API window');

// Kasper approval queue, balance table, and admin maintenance controls.
ok(/\{ key: 'time-off', label: 'Time Off', showCount: true/.test(source) && /_ptoRenderAdmin\(\)/.test(kasperTab), 'Kasper registers and renders the Time Off subtab');
ok(/_syncviewStaffCan\('pto-admin'\)/.test(admin) && /Admin sign-in required/.test(admin), 'Kasper admin data is hidden without an admin identity');
ok(/Pending requests/.test(admin) && /_ptoAdminDecide/.test(admin) && />Approve<\/button>/.test(admin) && />Deny<\/button>/.test(admin), 'Kasper queue exposes approve and deny controls');
ok(/member_inactive/.test(adminDecide) && /approve\.disabled = true/.test(adminDecide)
  && /note\.disabled = false/.test(adminDecide) && /deny\.disabled = false/.test(adminDecide)
  && /Approval is unavailable; deny the request to close it/.test(adminDecide),
  'inactive approval remains visibly blocked while the denial cleanup path stays usable');
ok(/Member balances/.test(admin) && /<th>Granted<\/th>/.test(admin) && /<th>Approved<\/th>/.test(admin)
  && /<th>Adjustments<\/th>/.test(admin) && /pto-negative/.test(admin), 'Kasper balance table separates approved leave, adjustments, availability, and negative styling');
ok(/member\.sick_available\) < 0 \? 'pto-negative'/.test(admin), 'negative sick balances are styled red in Kasper');
ok(/_ptoAdminSetMember/.test(admin) && /_svSelectHtml\('ptoAdminMember'/.test(admin) && /_svDateHtml\('ptoAdminStart'/.test(admin) && /id="ptoAdminEnabled"/.test(admin)
  && /_ptoAdminAdjust/.test(admin) && /_svStepperHtml\('ptoAdjustDelta'/.test(admin) && /id="ptoAdjustReason"/.test(admin), 'Kasper uses branded member setup and signed adjustment controls');
ok(/_svDateHtml\('ptoAdminStart', '', \{ required: true, today: asOf, max: asOf \}\)/.test(admin),
  'Kasper member setup calendar blocks future dates before the server validates them');
ok(/Choose a team member/.test(adminSetMember) && /Choose a valid PTO start date/.test(adminSetMember)
  && /_ptoShowValidation\('ptoAdminMemberError'/.test(adminSetMember)
  && /Choose a team member/.test(adminAdjust) && /valid effective date/.test(adminAdjust)
  && /_ptoShowValidation\('ptoAdjustError',[\s\S]*'ptoAdjustDelta'/.test(adminAdjust),
  'custom admin controls have described, focusable validation including invalid signed amounts');
ok(/upcoming_approved_requests/.test(source) && /Recent decisions and cancellations/.test(admin) && /Upcoming approved leave/.test(admin) && /_ptoAdminCancel/.test(admin)
  && /_ptoApi\('cancel'/.test(adminCancel), 'Kasper exposes future approved leave, recent history, and the server-backed admin cancellation path');
ok(/const decisionNote = String\(row\.decision_note/.test(admin)
  && /pto-history-note/.test(admin) && /Decision note:/.test(admin),
  'Kasper Recent Decisions visibly preserves the decision note');
ok(/pto-table-scroll-cue/.test(admin) && /Swipe sideways to view all balance columns/.test(admin)
  && /tabindex="0"/.test(admin) && /scroll horizontally to view all columns/.test(admin)
  && /\.pto-table-scroll-cue \{ display: block; \}/.test(source),
  'Kasper mobile balance table exposes a visible and keyboard-accessible horizontal-scroll cue');
ok(/wasCancelled && row\.cancelled_by && row\.decided_by/.test(admin)
  && /Approved by /.test(admin) && /Cancelled by /.test(admin)
  && /Cancellation attribution unavailable/.test(admin), 'pre-migration approved cancellations never misattribute the original approver');
ok(/_kasperSetTabCount\('time-off', pending\.length\)/.test(admin), 'Kasper badge is driven by pending request count');

if (failures) {
  console.error(`\n${failures} PTO UI wiring check(s) failed`);
  process.exit(1);
}
console.log('\nPTO UI wiring checks passed');
