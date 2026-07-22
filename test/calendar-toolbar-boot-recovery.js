'use strict';

/*
 * Calendar fast-boot toolbar recovery.
 *
 * The Calendar mounts before analytics on a direct/restored #calendar visit.
 * A sheet-only saved client is not known until fetchEssentials() merges the
 * Clients Info roster. More options, multi-select, and zoom must be restored at
 * that point; fetchExtras() is unrelated and may still be pending or may fail.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let i = INDEX.indexOf('{', at); i < INDEX.length; i++) {
    if (INDEX[i] === '{') depth++;
    else if (INDEX[i] === '}') {
      depth--;
      if (depth === 0) return INDEX.slice(at, i + 1);
    }
  }
  throw new Error('unbalanced function: ' + name);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let pass = 0;
let fail = 0;
function ok(condition, label) {
  if (condition) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label); }
}

(async () => {
  const fetchAllSource = grabFunc('fetchAll');
  const applyChromeSource = grabFunc('_applyAllDataDependentChrome');
  const recoverSource = grabFunc('_calResolveClientAfterDataReady');
  const openClientSource = grabFunc('_calOpenClientTab');
  const pendingDeepLinkSource = grabFunc('_calResolvePendingDeepLink');
  const renderShellSource = grabFunc('_calRenderShell');
  const viewChangeSource = grabFunc('onCalViewChange');

  ok(/const dataLoad = fetchAll\(_isClientLink\?clientEntryRun:null\);[\s\S]{0,220}dataLoad\.essentials\.then\(\(\) => \{[\s\S]{0,120}if\(_clientEntryStillCurrent\(\)\)_applyAllDataDependentChrome\(\);/.test(INDEX),
    'normal boot attaches lease-guarded Calendar chrome recovery to essentials');
  ok(!/dataPromise\.then\(_applyAllDataDependentChrome/.test(INDEX),
    'normal boot does not defer a duplicate recovery until analytics extras finish');
  ok(/dataLoad\.essentials\.then\(_calResolvePendingDeepLink, _calResolvePendingDeepLink\)/.test(INDEX),
    'sheet-only Calendar deep links also resolve from essentials');
  ok(applyChromeSource.includes('_calResolveClientAfterDataReady()'),
    'the essentials-ready hook includes Calendar client recovery');
  ok(recoverSource.indexOf('calState.client = next') < recoverSource.indexOf('_calRenderShell()'),
    'Calendar restores the active client before repainting the toolbar shell');
  ok(/shellNeedsClientChrome = !calState\.client[\s\S]*calState\.client = name[\s\S]*if \(shellNeedsClientChrome\) _calRenderShell\(\)/.test(openClientSource),
    'deferred no-client activation repaints the shell after assigning the client');
  ok(/if \(pins\.length\) _calOpenClientTab\(pins\[0\]\)/.test(pendingDeepLinkSource),
    'unresolved deep links use the same complete toolbar activation path');
  ok(/const selectBtnHtml = \(calState\.client && !_isClientLink\)[\s\S]*data-select-action="archive"/.test(renderShellSource)
      && /const bulkCapBtnHtml = \(calState\.client && !_isClientLink\)[\s\S]*data-select-action="caption"/.test(renderShellSource),
    'both Sheet actions stay mounted when a client shell starts in another view');
  ok(/querySelectorAll\('\.cal-toolbar \.cal-select-btn'\)[\s\S]*selBtn\.style\.display = v === 'organizer'/.test(viewChangeSource),
    'view changes reveal or hide both Sheet action buttons together');

  const essential = deferred();
  const extras = deferred();
  const events = [];
  const fetchAll = new Function('fetchEssentials', 'fetchExtras',
    fetchAllSource + '; return fetchAll;')(
      () => { events.push('essentials-start'); return essential.promise; },
      () => { events.push('extras-start'); return extras.promise; }
    );

  const load = fetchAll();
  let completeSettled = false;
  load.complete.then(() => { completeSettled = true; }, () => { completeSettled = true; });
  load.essentials.then(() => events.push('toolbar-recovered'));
  load.essentials.then(() => events.push('deep-link-resolved'));
  await Promise.resolve();

  ok(events[0] === 'essentials-start' && events[1] === 'extras-start',
    'essentials and analytics extras still start in parallel');
  ok(load.essentials === essential.promise && load.complete instanceof Promise,
    'fetchAll exposes separate essentials and complete stages');

  essential.resolve();
  await Promise.resolve();
  await Promise.resolve();

  ok(events.includes('toolbar-recovered'),
    'toolbar recovery runs as soon as the client roster is ready');
  ok(events.includes('deep-link-resolved'),
    'deferred Calendar deep links resolve at the same roster-ready boundary');
  ok(!completeSettled,
    'toolbar recovery does not wait for analytics extras to settle');

  extras.reject(new Error('unrelated analytics request failed'));
  await load.complete.catch(() => {});
  ok(events.filter(e => e === 'toolbar-recovered').length === 1
      && events.filter(e => e === 'deep-link-resolved').length === 1,
    'an analytics extras failure cannot suppress or duplicate either recovery');

  const essential2 = deferred();
  const extras2 = deferred();
  const fetchAllWithRejectedEssentials = new Function('fetchEssentials', 'fetchExtras',
    fetchAllSource + '; return fetchAll;')(
      () => essential2.promise,
      () => extras2.promise
    );
  const load2 = fetchAllWithRejectedEssentials();
  let gracefulFallback = false;
  load2.essentials.then(() => {}, () => { gracefulFallback = true; });
  essential2.reject(new Error('client roster failed'));
  extras2.resolve();
  await load2.complete.catch(() => {});
  ok(gracefulFallback,
    'a failed essentials load still reaches the deep-link fallback path');

  console.log('\n' + (fail === 0 ? 'OVERALL: PASS' : `OVERALL: FAIL (${fail} failed)`));
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
