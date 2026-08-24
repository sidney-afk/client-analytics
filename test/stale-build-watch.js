'use strict';
/*
 * A tab left open runs the code it booted with, forever.
 *
 * WHAT THIS FIXES (2026-08-24, OPEN_REPAIRS item 35). This app is one static
 * index.html. On 2026-08-24 a videographer submitted 30 rows from a tab still
 * holding code from before the 2026-08-17 fix, and every row was created
 * already "In Progress". The server now refuses to store that specific mistake,
 * but old code acting on today's data is the general shape and only the tab can
 * notice it.
 *
 * Owner decision the same day: TELL them and reload only when clearly safe —
 * no hard block, because someone mid-submission must never be interrupted for
 * something they cannot see.
 *
 * This suite exists for one reason: the auto-reload can destroy work. Every
 * assertion below is a way it could take something a person cannot get back,
 * or a way the watch could cry wolf. The happy path is the least interesting
 * thing here.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Comment-aware extractor: the block below carries prose with apostrophes and
// backticks, and a bare quote scan would run past the function's end.
function extract(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (comment === 'line') { if (ch === '\n') comment = ''; continue; }
    if (comment === 'block') { if (ch === '*' && next === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { comment = 'line'; i++; continue; }
    if (ch === '/' && next === '*') { comment = 'block'; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

const IDLE = 5 * 60 * 1000;
function sandbox(overrides) {
  const context = Object.assign({
    linearSubmitInFlight: false,
    _APP_BUILD_IDLE_MS: IDLE,
    _appLastInteraction: 0,
    document: { hidden: false, activeElement: null, querySelector: () => null },
    console,
  }, overrides || {});
  vm.createContext(context);
  vm.runInContext(extract('_appBuildSafeToReload'), context);
  return context;
}
const safe = (overrides, now) => {
  const ctx = sandbox(overrides);
  return ctx._appBuildSafeToReload(now === undefined ? IDLE + 1 : now);
};

// ---- It reloads only when there is genuinely nothing to lose ---------------
ok(safe({}) === true,
  'an idle, visible tab with nothing focused and nothing in flight may reload');
ok(safe({ document: { hidden: true, activeElement: null, querySelector: () => null } }, 0) === true,
  'a HIDDEN tab may reload immediately — nobody is watching and nothing is focused');

// ---- Every way it could take someone's work --------------------------------
ok(safe({}, 0) === false,
  'a tab someone just touched is never reloaded, however stale it is');
ok(safe({ linearSubmitInFlight: true }) === false,
  'a submission in flight blocks the reload — this is the exact person the fix is for');
ok(safe({ document: { hidden: false, activeElement: { tagName: 'TEXTAREA' }, querySelector: () => null } }) === false,
  'a focused textarea blocks it: a brief someone is typing is not recoverable');
ok(safe({ document: { hidden: false, activeElement: { tagName: 'INPUT' }, querySelector: () => null } }) === false,
  'so does a focused input');
ok(safe({ document: { hidden: false, activeElement: { tagName: 'SELECT' }, querySelector: () => null } }) === false,
  'and a focused select, which holds an unsaved choice just as much');
ok(safe({ document: { hidden: false, activeElement: { tagName: 'DIV', isContentEditable: true }, querySelector: () => null } }) === false,
  'and a contenteditable, which no tag-name check would catch');
ok(safe({ document: { hidden: false, activeElement: null, querySelector: () => ({}) } }) === false,
  'an open dialog blocks it — a reload would discard whatever it was asking');
ok(safe({ document: { hidden: true, activeElement: { tagName: 'TEXTAREA' }, querySelector: () => null } }, 0) === false,
  'HIDDEN does not override a focused field: someone typing who switched tabs still loses text');
ok(safe({ document: null }) === false,
  'and anything unexpected fails to NOT reloading, because the cost is asymmetric');

// ---- It must not cry wolf --------------------------------------------------
const check = extract('_appBuildCheck');
ok(/if \(!tag\) return;/.test(check),
  'a failed or header-less probe is treated as "assume current" and says nothing');
ok(/if \(!_appBuildTag\) \{ _appBuildTag = tag; return; \}/.test(check),
  'the first probe only records the baseline — it can never report the boot build as stale');
ok(/if \(tag === _appBuildTag\) return;/.test(check),
  'an unchanged build is silent');
ok(/const firstNotice = !_appBuildStale;[\s\S]*if \(firstNotice\) _appBuildAnnounce\(\);/.test(check),
  'the person is told ONCE, not every poll — a bar that reappears every ten minutes gets ignored');

const fetchTag = extract('_appBuildFetchTag');
ok(/cache: 'no-store'/.test(fetchTag),
  'the probe bypasses the cache, or it would compare a cached copy against itself forever');
ok(/method: 'HEAD'/.test(fetchTag),
  'and asks for headers only — this runs every ten minutes in every open tab');
ok(/catch \(e\) \{ return ''; \}/.test(fetchTag),
  'an offline tab reports no tag rather than throwing inside the interval');

// ---- It is armed, including on the client link -----------------------------
ok(/setInterval\(_appBuildCheck, _APP_BUILD_POLL_MS\);/.test(source),
  'the watch is armed on a timer');
ok(/visibilitychange[\s\S]{0,120}_appBuildCheck\(\)/.test(source),
  'and re-checks when a tab returns to the foreground, which is when a long-open tab reveals itself');
const armIndex = source.indexOf('setInterval(_appBuildCheck');
const intakeGuard = source.slice(Math.max(0, armIndex - 4000), armIndex);
ok(!/_isIntake|_isClientLink|_isOnboarding/.test(intakeGuard),
  'and is NOT gated behind a staff check — the tab that caused this was a client-link tab');

if (failures) {
  console.error(`\n${failures} stale-build watch check(s) failed`);
  process.exit(1);
}
console.log('\nstale-build watch checks passed');
