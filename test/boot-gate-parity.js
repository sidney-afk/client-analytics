'use strict';
/*
 * Pre-paint boot gate — parity harness.
 *
 * Run:  node test/boot-gate-parity.js   (exit 0 = all good)
 *
 * What it guards: the <head> boot gate must re-derive the boot mode BEFORE the
 * app script parses, so it necessarily duplicates a handful of the app's
 * detection expressions (mode params, storage keys, the fast-tab list, the sxr
 * flag). Those copies live ~25k lines apart and would drift silently — this
 * suite pins each gate copy to its canonical app-side counterpart so a change
 * to one without the other fails CI. It also pins the lift points: transient
 * route tags must hand control back to real routing, while boot-client stays
 * for the lifetime of a client-owned document so staff chrome cannot appear.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

// ── extract the gate script (the IIFE between the favicon <link> and the
//    style block; it is the only <script> before </head>).
const headEnd = INDEX.indexOf('</head>');
const HEAD = INDEX.slice(0, headEnd);
const gateAt = HEAD.indexOf('<script>');
const gateEnd = HEAD.indexOf('</script>', gateAt);
if (gateAt < 0 || gateEnd < 0) { console.log('FAIL  head boot-gate <script> not found'); process.exit(1); }
const GATE = HEAD.slice(gateAt, gateEnd);
const APP = INDEX.slice(gateEnd);

let failures = 0;
function check(label, cond) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('  FAIL  ' + label); failures++; }
}
const count = (hay, needle) => hay.split(needle).length - 1;
function extractFunction(body, name) {
  const marker = 'function ' + name + '(';
  const start = body.indexOf(marker);
  if (start < 0) return '';
  const brace = body.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < body.length; i++) {
    const ch = body[i];
    const next = body[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return body.slice(start, i + 1);
  }
  return '';
}
const NAV_TO = extractFunction(APP, 'navTo');
const RENDER = extractFunction(APP, 'render');

// 1. Mode detection expressions exist in BOTH the gate and the entry router.
for (const expr of [
  "/\\/ai_onboarding_form\\/?$/i.test(location.pathname)",
  "/\\/onboarding_form\\/?$/i.test(location.pathname)",
]) {
  check('onboarding path regex mirrored (gate + entry router): ' + expr.slice(0, 40) + '…',
    GATE.includes(expr) && APP.includes(expr));
}
check("intake trigger mirrored (?intake=1)",
  GATE.includes("q.get('intake') === '1'") && APP.includes("get('intake')==='1'"));
check("client-link ownership trigger mirrored (?c key, including empty c)",
  GATE.includes("q.has('c')") && APP.includes("_clientEntryParams.has('c')"));

// 2. Storage keys/values the gate reads must match the app's constants.
check("auth key: gate reads 'syncview_auth_v1'==='ok', app defines _AUTH_KEY",
  GATE.includes("localStorage.getItem('syncview_auth_v1') === 'ok'")
  && APP.includes("_AUTH_KEY='syncview_auth_v1'"));
check("nav key: gate reads 'syncview_nav', app defines NAV_KEY",
  GATE.includes("localStorage.getItem('syncview_nav')")
  && APP.includes("const NAV_KEY = 'syncview_nav'"));
check("kasper session key mirrored",
  GATE.includes("'syncview_kasper_unlocked'")
  && APP.includes("KASPER_UNLOCK_KEY = 'syncview_kasper_unlocked'"));
check("kasper subtab key mirrored",
  GATE.includes("localStorage.getItem('syncview_kasper_subtab_v1')")
  && APP.includes("KASPER_SUBTAB_KEY = 'syncview_kasper_subtab_v1'"));
check("tiktok-pilot session key mirrored",
  GATE.includes("'syncview_ttpilot_unlocked'")
  && APP.includes("TTP_UNLOCK_KEY = 'syncview_ttpilot_unlocked'"));

// 3. The gate's FAST list must equal init()'s FAST_TABS, element for element.
const gateFast = (GATE.match(/var FAST = \[([^\]]*)\]/) || [])[1];
const appFast = (APP.match(/const FAST_TABS = \[([^\]]*)\]/) || [])[1];
check('FAST list extracted from both copies', !!gateFast && !!appFast);
if (gateFast && appFast) {
  const norm = (s) => s.replace(/['"\s]/g, '');
  check('gate FAST === init FAST_TABS (' + norm(appFast) + ')', norm(gateFast) === norm(appFast));
}

// 4. The sxr boot flag: the gate's copy must match the app's inline boot-path
//    copies token-for-token (two app-side copies: the #sample-reviews deep link
//    and the ?c= sxr portal), and ALL copies must carry _sxrEnabled()'s GA
//    default-ON semantics. F73: the old strict default-OFF copies (which also
//    required the legacy 'syncview_sxr_on' key) broke fresh-browser deep links
//    and reloads while _sxrEnabled() was already default-on — a copy that reads
//    'syncview_sxr_on' is the regression this section exists to catch.
const SXR_EXPR = "(sv === '1' || sv === 'true') || (sv !== '0' && sv !== 'false' && localStorage.getItem('syncview_sxr_off') !== '1')";
const SXR_EXPR_INLINE = SXR_EXPR.replace(/\bsv\b/g, '_q');
check('gate carries the GA default-on sxr boot flag', GATE.includes(SXR_EXPR));
check('app keeps the inline GA default-on sxr check for staff deep links',
  count(APP, SXR_EXPR_INLINE) >= 1);
check('client SXR boot is capability-owned instead of preference-owned',
  APP.includes("cap.view === 'sample-reviews'")
  && APP.includes("_syncviewClientEntryCapability.view === 'sample-reviews'"));
check('no boot copy reads the legacy syncview_sxr_on key (stale default-OFF gate)',
  !GATE.includes("localStorage.getItem('syncview_sxr_on')")
  && count(APP, "localStorage.getItem('syncview_sxr_on')") === 0);
check('gate sxr copy defaults ON when storage throws (catch returns true, like _sxrEnabled)',
  /var sxrOn = function \(\) \{[\s\S]{0,400}catch \(e\) \{ return true; \}/.test(GATE));

// 4b. Semantic cases for the shared expression — the routes F73 broke.
function evalSxr(sv, offVal) {
  const storage = { getItem: (k) => (k === 'syncview_sxr_off' ? offVal : null) };
  return Function('sv', 'localStorage', 'return ' + SXR_EXPR)(sv, storage);
}
check('semantic: fresh browser (no ?sxr, empty storage) boots samples ON', evalSxr(null, null) === true);
check('semantic: ?sxr=0 opts out', evalSxr('0', null) === false);
check('semantic: sticky opt-out (syncview_sxr_off=1) honored', evalSxr(null, '1') === false);
check('semantic: ?sxr=1 overrides the sticky opt-out', evalSxr('1', '1') === true);

// 5. Lift points: every removable tag the gate sets must have its app-side lift.
check('gate can set data-boot-nav', GATE.includes("de.setAttribute('data-boot-nav'"));
check('gate can set data-boot-subtab', GATE.includes("de.setAttribute('data-boot-subtab'"));
check('navTo() lifts data-boot-nav',
  NAV_TO.includes("document.documentElement.removeAttribute('data-boot-nav')"));
check('navTo() lifts data-boot-subtab',
  NAV_TO.includes("document.documentElement.removeAttribute('data-boot-subtab')"));
check('render() lifts data-boot-nav (belt-and-braces)',
  RENDER.includes("document.documentElement.removeAttribute('data-boot-nav')"));
check('render() lifts data-boot-subtab (belt-and-braces)',
  RENDER.includes("document.documentElement.removeAttribute('data-boot-subtab')"));
check("init()'s catch lifts data-boot-nav",
  count(APP, "documentElement.removeAttribute('data-boot-nav')") >= 3);
check("init()'s catch lifts data-boot-subtab",
  count(APP, "documentElement.removeAttribute('data-boot-subtab')") >= 3);
check('submitPassword() lifts boot-password',
  /function submitPassword\(\)\{[\s\S]{0,900}documentElement\.classList\.remove\('boot-password'\)/.test(APP));
check('?c client ownership remains locked for the whole document',
  !APP.includes("classList.remove('boot-client')")
  && APP.includes('_syncviewStartClientEntry(false)')
  && APP.includes("if(_isClientLink){"));

// 6. The CSS gate rules the tags rely on must exist in the static style block.
for (const rule of [
  'html.boot-onboarding, html.boot-onboarding body { background: var(--sv-bg-101216); }',
  'html.boot-onboarding .header { display: none !important; }',
  'html.boot-intake .header { display: none !important; }',
  'html.boot-client .header { display: none !important; }',
  'html.boot-password #passwordOverlay { display: flex !important; }',
  'html[data-boot-nav] #pageTop { display: none; }',
  'html[data-boot-nav="filming-plans"] .boot-skeleton-filming',
  'html[data-boot-nav="kasper"][data-boot-subtab="sales-intake"] .boot-skeleton-sales-intake { display: block; }',
]) check('CSS gate rule present: ' + rule.slice(0, 52) + '…', INDEX.includes(rule));

// 7. Static first-paint skeletons must include the route-specific placeholder
//    for Kasper's Sales Intake subtab. This prevents a refresh on
//    #kasper/sales-intake from briefly painting the Analytics table skeleton.
check('static boot skeleton has a default analytics variant',
  INDEX.includes('boot-skeleton-variant boot-skeleton-analytics'));
check('static boot skeleton has a Kasper sales-intake variant',
  INDEX.includes('boot-skeleton-variant boot-skeleton-sales-intake')
  && INDEX.includes('si-wrap si-skeleton'));
check('static boot skeleton has a filming-plans variant',
  INDEX.includes('boot-skeleton-variant boot-skeleton-filming')
  && INDEX.includes('fp-loading'));
check('static boot skeleton has a Calendar Sheet card-strip variant',
  INDEX.includes('boot-skeleton-variant boot-skeleton-calendar')
  && INDEX.includes('cal-skeleton-sheet')
  && INDEX.includes('cal-skeleton-card-body')
  && !/boot-skeleton-variant boot-skeleton-calendar[\s\S]{0,7000}<div class="cal-month-wrap">/.test(INDEX));
check('static boot skeleton has a neutral client verification variant',
  INDEX.includes('boot-skeleton-variant boot-skeleton-client-verify')
  && INDEX.includes('data-boot-surface="client-verify"'));
check('static boot skeleton has client analytics and Brief variants',
  INDEX.includes('boot-skeleton-variant boot-skeleton-client-profile')
  && INDEX.includes('data-boot-surface="client-analytics"')
  && INDEX.includes('boot-skeleton-variant boot-skeleton-client-brief')
  && INDEX.includes('data-boot-surface="client-brief"'));
check('client Calendar/Brief history state is predicted before paint',
  GATE.includes("de.setAttribute('data-boot-nav', 'client')")
  && GATE.includes("st.clientTab === 'calendar' || st.clientTab === 'brief'"));

// 8. The gate must never log or throw: whole body wrapped in try/catch and
//    no console.* calls inside (headless probes fail on any console error).
check('gate has no console.* calls', !/console\./.test(GATE));
check('gate body is wrapped in try/catch',
  /\(function \(\) \{\s*try \{/.test(GATE) && /\} catch \(e\) \{\}\s*\}\)\(\);/.test(GATE));

console.log(failures ? `\nboot-gate-parity: ${failures} check(s) failed ❌`
  : '\nboot-gate-parity: all checks passed ✅');
process.exit(failures ? 1 : 0);
