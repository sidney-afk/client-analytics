'use strict';
/*
 * Content Calendar / Samples — open-client-tab persistence regression test.
 *
 * Run:  node test/calendar-tab-persistence.js   (exit 0 = all good)
 *
 * Bug (reported by Analia for client "Alayna Belquist"): a client's calendar
 * tab did not persist across close/reopen. Root cause: _calGetPins() filtered
 * the stored tab list against WL_CLIENT_NAMES, but that allowlist is now
 * SHEET-DRIVEN (wlMergeClientsFromSheet) and only fills in AFTER the analytics
 * essentials fetch resolves. On a refresh straight onto the calendar (the
 * skipAwait fast path) the allowlist still holds only the hardcoded seed list,
 * so a sheet-only client's pin was filtered out — the tab vanished — and any
 * add/remove/toggle in that window re-saved the filtered list and lost it for
 * good.
 *
 * This extracts the REAL _calGetPins / _calSavePins from ../index.html and runs
 * them with WL_CLIENT_NAMES seeded WITHOUT the sheet-only client, exactly as it
 * looks during the boot race. The fix: _calGetPins no longer consults the
 * allowlist, so the stored tab survives. (Pins are only ever written for real
 * clients, so the stored list is already trustworthy.)
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function grabConst(name) {
  const m = INDEX.match(new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm'));
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

const SANDBOX = `
const _store = Object.create(null);
const localStorage = {
  getItem(k){ return k in _store ? _store[k] : null; },
  setItem(k,v){ _store[k] = String(v); },
  removeItem(k){ delete _store[k]; }
};
// Seed allowlist as it looks DURING the boot race: the sheet-only client
// "Alayna Belquist" is NOT here yet (it only arrives via wlMergeClientsFromSheet
// once essentials load). If _calGetPins ever filters on this again, the
// sheet-only assertions below fail — which is the whole point.
const WL_CLIENT_NAMES = ['Baya Voce', 'Jessica Winterstern', 'Morgan Burton'];
${grabConst('CAL_PINS_KEY')}
${grabFunc('_calGetPins')}
${grabFunc('_calSavePins')}
return { _store, WL_CLIENT_NAMES, CAL_PINS_KEY, _calGetPins, _calSavePins };`;
const m = new Function(SANDBOX)();

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('  ✅ ' + label); } else { fail++; console.log('  ❌ ' + label); } };

console.log('— Sheet-only client tab survives an incomplete allowlist —');
// Analia had Alayna Belquist's tab open; it was saved to localStorage.
m._calSavePins(['Alayna Belquist']);
// Reopen on the fast path: allowlist still seed-only. The tab must come back.
let pins = m._calGetPins();
ok(pins.includes('Alayna Belquist'), 'sheet-only tab persists across reopen');
ok(pins.length === 1, 'no spurious extra tabs');

console.log('\n— A seed client tab still persists (no regression) —');
m._calSavePins(['Baya Voce']);
ok(m._calGetPins().includes('Baya Voce'), 'seed-list client tab persists');

console.log('\n— Mutating tabs during the race does not drop the unknown tab —');
// Mirror onCalTabRemove: remove a DIFFERENT tab, then save the result. The
// sheet-only tab must not be collateral damage of the filtered re-save.
m._calSavePins(['Alayna Belquist', 'Baya Voce']);
const afterRemove = m._calGetPins().filter(n => n !== 'Baya Voce');
m._calSavePins(afterRemove);
ok(m._calGetPins().includes('Alayna Belquist'), 'removing one tab keeps the sheet-only tab');
ok(!m._calGetPins().includes('Baya Voce'), 'the removed tab is actually gone');

// Mirror pickAndPin: add a new tab on top of an existing sheet-only tab.
m._calSavePins(['Alayna Belquist']);
const withAdded = m._calGetPins();
if (!withAdded.includes('Morgan Burton')) withAdded.unshift('Morgan Burton');
m._calSavePins(withAdded);
ok(m._calGetPins().includes('Alayna Belquist'), 'adding a tab keeps the sheet-only tab');
ok(m._calGetPins().includes('Morgan Burton'), 'the added tab is present');

console.log('\n— Stored list is still validated to non-empty strings —');
m._store[m.CAL_PINS_KEY] = JSON.stringify(['Alayna Belquist', '', '  ', null, 42, 'Baya Voce']);
pins = m._calGetPins();
ok(pins.length === 2 && pins[0] === 'Alayna Belquist' && pins[1] === 'Baya Voce',
   'empties / non-strings filtered, real names kept');

m._store[m.CAL_PINS_KEY] = '{not an array}';
ok(Array.isArray(m._calGetPins()) && m._calGetPins().length === 0, 'corrupt storage → empty array');

console.log('\n' + (fail === 0 ? 'OVERALL: PASS' : 'OVERALL: FAIL (' + fail + ' failed)'));
process.exit(fail === 0 ? 0 : 1);
