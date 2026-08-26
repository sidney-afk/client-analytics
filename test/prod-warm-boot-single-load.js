'use strict';
/*
 * A WARM BOOT READS THE DATABASE ONCE, NOT TWICE.
 *
 * The first-paint snapshot exists to avoid a full read. Once it started
 * working, every warm load did the full read TWICE.
 *
 * The mechanism, measured against live data on 2026-08-26: mount hydrates from
 * the snapshot, which sets `_prodState.loaded` and starts a SILENT
 * revalidation. `pageshow` then fires -- it always does, right after mount --
 * and `_prodAutoRefreshOnReturn` asked only "is it loaded?" and "is it
 * loading?". Hydration had just made the first true, and the second stays false
 * for silent refreshes by design, so the listener concluded the user had
 * returned to an idle tab and kicked off a second complete read of clients,
 * members, batches and the whole paged deliverable projection. It opened 740ms
 * after the first one.
 *
 * Nothing surfaced it: both loads succeed, the second simply overwrites the
 * first, and the only symptom is double the reads on exactly the path the cache
 * was added to make cheap. It did show up in CI, as reads still in flight when
 * a suite finished -- which is a very indirect way to learn you are loading
 * everything twice.
 *
 * The guard is `refreshing`: true for the whole of any load, silent or not.
 * The property that keeps it safe is that it is cleared on BOTH exits -- a
 * failed refresh that left it set would wedge the tab out of ever refreshing on
 * return again, which is worse than the bug being fixed.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---- 1. the listener, EXECUTED --------------------------------------------
const fnStart = html.indexOf('function _prodAutoRefreshOnReturn()');
const fnEnd = html.indexOf('\n        }', fnStart) + '\n        }'.length;
ok(fnStart > -1 && fnEnd > fnStart, 'the return-refresh listener is findable');
const listenerSrc = html.slice(fnStart, fnEnd);

function buildListener(state, { hidden = false, now = 1_000_000 } = {}) {
  const calls = [];
  const scope = new Function(
    '_prodState', 'document', '_prodEnabled', '_prodRefreshPolicyDay', '_prodRefresh', 'nowRef',
    `let _prodLastAutoRefreshAt = 0;
     const Date = { now: () => nowRef.value };
     ${listenerSrc}
     return _prodAutoRefreshOnReturn;`,
  );
  const nowRef = { value: now };
  const fn = scope(
    state,
    { get hidden() { return hidden; } },
    () => true,
    () => {},
    opts => calls.push(opts || {}),
    nowRef,
  );
  return { fire: fn, calls, nowRef };
}

const warmBoot = buildListener({ loaded: true, loading: false, refreshing: true, cachePartial: true });
warmBoot.fire();
ok(warmBoot.calls.length === 0,
  'a warm boot does NOT start a second load while the cached paint is revalidating');

const idleReturn = buildListener({ loaded: true, loading: false, refreshing: false, cachePartial: false });
idleReturn.fire();
ok(idleReturn.calls.length === 1,
  'but a genuine return to an idle tab still refreshes — the feature is not disabled');
ok(idleReturn.calls[0].silent === true,
  'and it refreshes silently, so returning to the tab never flashes a spinner');

/* The wedge this must not become: a refresh that FAILED clears `refreshing`
   too, so the next return still works. If that clearing is ever dropped, the
   tab silently stops refreshing forever, which is worse than the double read. */
const afterFailedRefresh = buildListener({ loaded: true, loading: false, refreshing: false, cachePartial: true });
afterFailedRefresh.fire();
ok(afterFailedRefresh.calls.length === 1,
  'a cached paint whose revalidation failed can still refresh on the next return');

const stillLoading = buildListener({ loaded: true, loading: true, refreshing: true, cachePartial: false });
stillLoading.fire();
ok(stillLoading.calls.length === 0, 'a foreground load still blocks it, as before');

const notLoaded = buildListener({ loaded: false, loading: false, refreshing: false, cachePartial: false });
notLoaded.fire();
ok(notLoaded.calls.length === 0, 'and an unloaded tab still blocks it, as before');

const throttled = buildListener({ loaded: true, loading: false, refreshing: false, cachePartial: false });
throttled.fire();
throttled.nowRef.value += 5000;
throttled.fire();
ok(throttled.calls.length === 1, 'the 30s throttle survives the new guard');
throttled.nowRef.value += 31000;
throttled.fire();
ok(throttled.calls.length === 2, 'and releases once the throttle window passes');

const hidden = buildListener({ loaded: true, loading: false, refreshing: false, cachePartial: false }, { hidden: true });
hidden.fire();
ok(hidden.calls.length === 0, 'a hidden document still refreshes nothing');

// ---- 2. the flag is set once and cleared on BOTH exits --------------------
const loadStart = html.indexOf('async function _prodLoadData(opts)');
const loadEnd = html.indexOf('\n        async function _prodLoadEventsFor', loadStart);
ok(loadStart > -1 && loadEnd > loadStart, 'the loader is findable (harness is not vacuous)');
const loadSrc = html.slice(loadStart, loadEnd);
ok(/_prodState\.loading = !silent;\s*\n\s*_prodState\.refreshing = true;/.test(loadSrc),
  'every load marks itself as running, silent or not');
const setsFalse = (loadSrc.match(/_prodState\.refreshing = false;/g) || []).length;
ok(setsFalse === 2,
  'and clears it exactly twice — once on success, once in the catch (saw ' + setsFalse + ')');
const catchIndex = loadSrc.indexOf('} catch (e) {');
ok(catchIndex > -1
  && loadSrc.indexOf('_prodState.refreshing = false;') < catchIndex
  && loadSrc.indexOf('_prodState.refreshing = false;', catchIndex) > catchIndex,
  'one clearing sits on each side of the catch, so no exit leaves the flag set');

ok(/refreshing: false,/.test(html.slice(html.indexOf('const _prodState = {'), html.indexOf('const _prodState = {') + 1200)),
  'the flag is declared in the state literal rather than appearing from nowhere');

if (failures) {
  console.error(`\n${failures} warm-boot single-load check(s) failed`);
  process.exit(1);
}
console.log('\nwarm boot issues a single load');
