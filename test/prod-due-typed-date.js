'use strict';
/*
 * SyncLinear due picker, "Custom…" view: a typed date is the date that saves.
 *
 * The calendar view's box says "Type a date, e.g. Jul 20 2027", but Enter
 * there saved the highlighted day (the current due date, or today) and never
 * read the box. The page then toasted "Due date updated" for a date nobody
 * picked. The real _prodBuildDue is lifted out of the app and driven through a
 * small stand-in popover: open Custom, type, press Enter.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const lift = name => extractFunction(INDEX, name);

function open(cur) {
  const env = { writes: [], toasts: [], handlers: {}, input: null, html: '' };
  const fakeEl = attr => ({
    getAttribute: () => attr,
    addEventListener: (type, fn) => { env.handlers[attr] = fn; },
  });
  const pop = {
    style: {},
    set innerHTML(v) { env.html = String(v); },
    get innerHTML() { return env.html; },
    getBoundingClientRect: () => ({ width: 240, height: 300 }),
    querySelectorAll: sel => (sel === '[data-prod-set]' && /data-prod-set="__custom__"/.test(env.html)
      ? [fakeEl('__custom__')] : []),
    querySelector: sel => {
      if (sel !== '[data-prod-search]') return null;
      env.input = { value: '', focus() {}, addEventListener: (type, fn) => { env.keydown = fn; } };
      return env.input;
    },
  };
  new Function('env', 'pop', 'cur', `
    const innerWidth = 1440, innerHeight = 900;
    const setTimeout = () => 0;
    const PROD_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const PROD_MON_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const PROD_WK = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const _calEsc = s => String(s);
    const _calEscAttr = s => String(s);
    const _prodIcon = () => '';
    const _prodPolicyTodayISO = () => '2026-10-08';
    const _prodClearLayer = () => {};
    const _prodToast = text => env.toasts.push(String(text));
    const _prodRunPickerWrite = (kind, ids, value) => env.writes.push([kind, ids, value]);
    ${['_prodIsoParts', '_prodIsoFromParts', '_prodIsoFromDate', '_prodDateFromIso', '_prodToday', '_prodAddDays',
      '_prodFmtWk', '_prodParseDue', '_prodDueIso', '_prodBuildDue'].map(lift).join('\n')}
    _prodBuildDue(pop, cur, ['d1'], { x: 10, y: 10 });
  `)(env, pop, cur);
  env.key = key => env.keydown({ key, stopPropagation() {}, preventDefault() {} });
  env.custom = () => env.handlers.__custom__({ stopPropagation() {} });
  return env;
}

// --- Custom view: the typed date is what saves ---------------------------------
{
  const env = open({ dueRaw: '2026-10-12', due: 'Oct 12' });
  env.custom();
  ok(/Type a date/.test(env.html), 'the Custom view asks for a typed date');
  env.input.value = 'Jul 20 2027';
  env.key('Enter');
  ok(env.writes.length === 1 && env.writes[0][0] === 'due' && env.writes[0][2] === '2027-07-20',
    'typing "Jul 20 2027" and pressing Enter saves 2027-07-20, not the highlighted day');
}

// --- Custom view: text that is not a date saves nothing and says so -----------
{
  const env = open({ dueRaw: '2026-10-12', due: 'Oct 12' });
  env.custom();
  env.input.value = 'not a date';
  env.key('Enter');
  ok(env.writes.length === 0, 'text that is not a date saves nothing');
  ok(env.toasts.length === 1, 'and the reader is told it was not understood');
}

// --- Custom view: an empty box still takes the highlighted day ----------------
{
  const env = open({ dueRaw: '2026-10-12', due: 'Oct 12' });
  env.custom();
  env.key('ArrowRight');
  env.key('Enter');
  ok(env.writes.length === 1 && env.writes[0][2] === '2026-10-13',
    'arrow keys then Enter with an empty box still saves the highlighted day');
}

// --- quick view is unchanged ---------------------------------------------------
{
  const env = open(null);
  env.input.value = '2027-02-09';
  env.key('Enter');
  ok(env.writes.length === 1 && env.writes[0][2] === '2027-02-09', 'the first view still saves a typed date');
}

if (failures) { console.log('\n' + failures + ' check(s) failed'); process.exit(1); }
console.log('\nprod-due-typed-date: all checks passed');
