'use strict';

// Offline contract and small behavior harness for Kasper's priority + More
// navigation. The app is a single-file SPA, so this exercises the real renderer
// and menu state helpers without touching live data or any backend.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

function constExpression(name) {
  const marker = `const ${name} =`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing const ${name}`);
  const valueStart = start + marker.length;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = valueStart; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '[' || ch === '{' || ch === '(') depth++;
    else if (ch === ']' || ch === '}' || ch === ')') depth--;
    else if (ch === ';' && depth === 0) return source.slice(valueStart, i).trim();
  }
  throw new Error(`unterminated const ${name}`);
}

const primaryKeys = vm.runInNewContext(`(${constExpression('KASPER_PRIMARY_SUBTAB_KEYS')})`);
const moreGroups = vm.runInNewContext(`(${constExpression('KASPER_MORE_GROUPS')})`);
const expectedPrimary = ['review', 'samples', 'replies', 'filming'];
const expectedGroups = [
  { label: 'Team', keys: ['editors', 'time-off'] },
  { label: 'Pipeline & Admin', keys: ['sales-intake', 'onboarding', 'client-credentials'] },
];

ok(JSON.stringify(primaryKeys) === JSON.stringify(expectedPrimary),
  'priority row is Review Session, Samples, Messages, then Filming Plans');
ok(JSON.stringify(moreGroups) === JSON.stringify(expectedGroups),
  'More keeps the approved Team and Pipeline & Admin groups in order');
ok(new Set([...primaryKeys, ...moreGroups.flatMap(group => group.keys)]).size === 9,
  'all nine Kasper destinations appear exactly once across priority and More');

const tabs = [
  ['review', 'Review Session', true],
  ['samples', 'Samples', true],
  ['replies', 'Messages', true],
  ['editors', 'Editors', false],
  ['filming', 'Filming Plans', true],
  ['time-off', 'Time Off', true, true],
  ['sales-intake', 'Sales Intake', false],
  ['onboarding', 'Onboarding', true, true],
  ['client-credentials', 'Client Credentials', false],
].map(([key, label, showCount, hideZero]) => ({
  key,
  label,
  showCount,
  hideZero,
  icon: `<svg data-test-icon="${key}"></svg>`,
}));

function makeRenderer(state, options = {}) {
  return new Function('deps', `
    const _kasperState = deps.state;
    const KASPER_SUBTABS = deps.tabs;
    const KASPER_PRIMARY_SUBTAB_KEYS = deps.primary;
    const KASPER_PRIMARY_SHORT_LABELS = deps.shortLabels;
    const KASPER_MORE_GROUPS = deps.groups;
    const KASPER_MORE_ICON = '<svg data-test-icon="more"></svg>';
    const KASPER_MORE_CHEVRON = '<svg data-test-icon="chevron"></svg>';
    const _ptoEnabled = () => deps.ptoEnabled;
    const _syncviewStaffCan = capability => deps.capabilities[capability] !== false;
    const _calEsc = value => String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    ${functionSource('renderKasperView')}
    return renderKasperView;
  `)({
    state,
    tabs: options.tabs || tabs,
    primary: primaryKeys,
    shortLabels: { review: 'Review', samples: 'Samples', replies: 'Messages', filming: 'Filming' },
    groups: moreGroups,
    ptoEnabled: options.ptoEnabled !== false,
    capabilities: options.capabilities || {},
  });
}

function navMarkup(html) {
  const start = html.indexOf('<nav class="kasper-subtabs"');
  return html.slice(start, html.indexOf('</nav>', start) + 6);
}

function triggerMarkup(html) {
  const marker = html.indexOf('data-kasper-more-trigger');
  const start = html.lastIndexOf('<button', marker);
  return html.slice(start, html.indexOf('</button>', marker) + 9);
}

const defaultHtml = makeRenderer({ tab: 'review' })();
const defaultNav = navMarkup(defaultHtml);
const moreStart = defaultNav.indexOf('<div class="kasper-more"');
const primaryMarkup = defaultNav.slice(0, moreStart);
const overflowMarkup = defaultNav.slice(moreStart);

ok(expectedPrimary.every(key => primaryMarkup.includes(`data-kasper-tab="${key}"`))
  && expectedGroups.flatMap(group => group.keys).every(key => !primaryMarkup.includes(`data-kasper-tab="${key}"`)),
  'only priority destinations render in the always-visible row');
ok(expectedGroups.flatMap(group => group.keys).every(key => overflowMarkup.includes(`data-kasper-tab="${key}"`)),
  'every lower-frequency destination renders inside More');
ok((defaultNav.match(/data-kasper-tab="/g) || []).length === 9,
  'the full navigation renders without missing or duplicate destinations');
ok(/aria-haspopup="menu" aria-expanded="false" aria-controls="kasperMoreMenu"/.test(defaultNav)
  && /id="kasperMoreMenu" role="menu"[^>]+hidden/.test(defaultNav),
  'More exposes button/menu semantics and starts closed');
ok(triggerMarkup(defaultHtml).includes('data-test-icon="more"')
  && triggerMarkup(defaultHtml).includes('>More<')
  && triggerMarkup(defaultHtml).includes('data-test-icon="chevron"'),
  'default trigger shows the More icon, label, and chevron');

const editorsHtml = makeRenderer({ tab: 'editors' })();
const editorsTrigger = triggerMarkup(editorsHtml);
ok(/kasper-more-trigger active/.test(editorsTrigger)
  && editorsTrigger.includes('data-test-icon="editors"')
  && editorsTrigger.includes('>Editors<')
  && editorsTrigger.includes('aria-current="page"'),
  'an active overflow destination replaces More with its exact icon and label');
ok(/data-kasper-tab="editors"[^>]+aria-current="page"/.test(editorsHtml),
  'the active item inside More remains marked as the current section');

const deniedHtml = makeRenderer({ tab: 'review' }, {
  capabilities: { 'pto-admin': false, onboarding: false, credentials: false },
})();
ok(/data-kasper-tab="time-off"[^>]+data-staff-capability="pto-admin" hidden/.test(deniedHtml)
  && /data-kasper-tab="onboarding"[^>]+data-staff-capability="onboarding" hidden/.test(deniedHtml)
  && /data-kasper-tab="client-credentials"[^>]+data-staff-capability="credentials" hidden/.test(deniedHtml),
  'sensitive More destinations retain their existing capability gates');
ok(!makeRenderer({ tab: 'review' }, { ptoEnabled: false })().includes('data-kasper-tab="time-off"'),
  'Time Off remains absent while its feature flag is disabled');
ok((navMarkup(makeRenderer({ tab: 'review' }, { tabs: tabs.filter(tab => tab.key !== 'samples') })())
  .match(/data-kasper-tab="/g) || []).length === 8,
  'the priority row remains complete and duplicate-free when Samples is disabled');
ok(/data-kasper-tab="time-off"[\s\S]*?data-kasper-count="time-off"[\s\S]*?data-kasper-hide-zero/.test(defaultHtml),
  'the Time Off count stays wired inside More and is configured to hide zero');
ok(/data-kasper-tab="onboarding"[\s\S]*?data-kasper-count="onboarding"[\s\S]*?data-kasper-hide-zero/.test(defaultHtml)
  && /data-kasper-more-count[^>]+hidden/.test(defaultHtml),
  'Onboarding has an unread badge and More has a hidden aggregate notification badge');

function classListHarness() {
  const names = new Set();
  return {
    toggle(name, force) { if (force) names.add(name); else names.delete(name); },
    has(name) { return names.has(name); },
  };
}

const wrap = { classList: classListHarness(), contains: () => false };
const trigger = {
  attrs: { 'aria-expanded': 'false' },
  setAttribute(name, value) { this.attrs[name] = value; },
  focus() { this.focused = true; },
};
const menu = { hidden: true };
const items = [
  { tabIndex: -1, getAttribute: () => null, focus() { this.focused = true; } },
  { tabIndex: -1, getAttribute: name => name === 'aria-current' ? 'page' : null, focus() { this.focused = true; } },
];
const fakeDocument = {
  querySelector(selector) {
    if (selector === '.kasper-more') return wrap;
    if (selector === '[data-kasper-more-trigger]') return trigger;
    return null;
  },
  querySelectorAll() { return items; },
  getElementById(id) { return id === 'kasperMoreMenu' ? menu : null; },
};
const setMoreOpen = new Function('document', `
  ${functionSource('_kasperVisibleMoreItems')}
  ${functionSource('_kasperSetMoreOpen')}
  return _kasperSetMoreOpen;
`)(fakeDocument);

setMoreOpen(true, true, false);
ok(wrap.classList.has('open') && trigger.attrs['aria-expanded'] === 'true' && menu.hidden === false,
  'opening More keeps the visual, ARIA, and hidden states in sync');
ok(items[1].focused === true && items[1].tabIndex === 0 && items[0].tabIndex === -1,
  'a focus-menu open request targets the current visible More item');
setMoreOpen(false, false, true);
ok(!wrap.classList.has('open') && trigger.attrs['aria-expanded'] === 'false' && menu.hidden === true
  && trigger.focused === true && items.every(item => item.tabIndex === -1),
  'closing More hides it, resets roving focus, and can restore trigger focus');

const countEls = [
  { textContent: '', hidden: false, hasAttribute: () => false },
  { textContent: '', hidden: false, hasAttribute: name => name === 'data-kasper-hide-zero' },
];
const setTabCount = new Function('document', `
  const _kasperSyncMoreNotificationCount = () => {};
  ${functionSource('_kasperSetTabCount')}
  return _kasperSetTabCount;
`)({ querySelectorAll: () => countEls });
setTabCount('time-off', 0);
ok(countEls.every(el => el.textContent === '0') && countEls[0].hidden === false && countEls[1].hidden === true,
  'count updates reach every matching badge and hide only opted-in zero values');
setTabCount('time-off', 2);
ok(countEls[1].hidden === false && countEls[1].textContent === '2',
  'a new pending Time Off count makes its badge visible again');

const notificationKeys = vm.runInNewContext(`(${constExpression('KASPER_MORE_NOTIFICATION_KEYS')})`);
ok(JSON.stringify(notificationKeys) === JSON.stringify(['time-off', 'onboarding']),
  'More aggregates the two actionable overflow notification sources');
const unreadSource = functionSource('_kasperOnboardingUnreadCount');
const seenSource = functionSource('_kasperMarkOnboardingSeen');
ok(/KASPER_ONBOARDING_SEEN_KEY/.test(unreadSource)
  && /_obvSubs\.filter/.test(unreadSource)
  && /localStorage\.setItem\(KASPER_ONBOARDING_SEEN_KEY, newest\)/.test(seenSource)
  && /_kasperSetTabCount\('onboarding', 0\)/.test(seenSource),
  'Onboarding counts submissions newer than the saved cursor and clears only when opened');

const keyboard = functionSource('_kasperOnMoreKeydown');
const goto = functionSource('_kasperGotoTab');
const wire = functionSource('_kasperWireMoreNav');
const unwire = functionSource('_kasperUnwireMoreNav');
const teardown = functionSource('_kasperTeardown');
ok(['Enter', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Escape', 'Tab'].every(key => keyboard.includes(`'${key}'`))
  && /key === ' '/.test(keyboard)
  && /key === 'Enter'[\s\S]{0,180}_kasperSetMoreOpen\(true, true, false\)/.test(keyboard)
  && /:not\(\[hidden\]\)/.test(functionSource('_kasperVisibleMoreItems')),
  'More supports Enter/Space, boundary, arrow, escape, and tab keys while skipping hidden items');
ok(/_kasperSetMoreOpen\(false/.test(goto)
  && /localStorage\.setItem\(KASPER_SUBTAB_KEY, tab\)/.test(goto)
  && /#kasper/.test(goto)
  && /_kasperSyncTabNav\(\)/.test(goto)
  && /_kasperRenderTab\(\)/.test(goto),
  'More selection keeps the existing saved state, hash, and renderer path');
ok(/addEventListener\('pointerdown', _kasperDismissMore, true\)/.test(wire)
  && /addEventListener\('keydown', _kasperMoreDocumentKeydown\)/.test(wire)
  && /removeEventListener\('pointerdown', _kasperDismissMore, true\)/.test(unwire)
  && /removeEventListener\('keydown', _kasperMoreDocumentKeydown\)/.test(unwire)
  && /_kasperUnwireMoreNav\(\)/.test(teardown),
  'outside/Escape listeners are attached once and removed when leaving Kasper');

const subtabsCss = source.slice(source.indexOf('.kasper-subtabs {'), source.indexOf('.kasper-subtab {'));
ok(/width: 100%/.test(subtabsCss) && /box-sizing: border-box/.test(subtabsCss)
  && !/width: max-content|overflow-x: auto/.test(subtabsCss),
  'the priority row is viewport-contained instead of horizontally scrollable');
ok(/@media \(max-width: 420px\)[\s\S]{0,700}\.kasper-primary-tab/.test(source)
  && /\.kasper-subtab:focus-visible/.test(source)
  && /max-width: calc\(100vw - 32px\)/.test(source),
  'narrow screens, visible focus, and popover viewport containment are styled');

console.log(failures
  ? `\nkasper-priority-more-nav: ${failures} failed`
  : '\nKasper priority + More navigation checks passed');
process.exit(failures ? 1 : 0);
