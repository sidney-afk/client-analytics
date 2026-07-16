'use strict';

// Executable behavior checks for the neutral controls used by both PTO
// surfaces. Browser focus/visual behavior has a separate mocked Playwright lane;
// this fast suite keeps value propagation and business bounds in npm test.
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function functionSource(name) {
  const match = new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  if (!match) throw new Error('missing function ' + name);
  const start = match.index;
  const open = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
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
  throw new Error('unterminated function ' + name);
}

const sharedStart = source.indexOf('function _ptoEsc');
const sharedEndSource = functionSource('_svStepNumber');
const sharedEnd = source.indexOf(sharedEndSource, sharedStart) + sharedEndSource.length;
if (sharedStart < 0 || sharedEnd < sharedStart) throw new Error('missing shared control source block');

const api = new Function([
  'const _jsAttrArg = value => JSON.stringify(String(value));',
  functionSource('_ptoDate'),
  source.slice(sharedStart, sharedEnd),
  'return { _svSelectHtml, _svDateHtml, _svStepperHtml, _svSyncStepper, _svStepNumber };',
].join('\n'))();

const select = api._svSelectHtml('fixtureType', [
  { value: 'wellness', label: 'Wellness', tone: 'wellness' },
  { value: 'floating_holiday', label: 'Floating holiday (pending)', tone: 'floating', disabled: true },
], 'wellness', 'Choose type', { onchange: 'fixtureChanged()' });
ok(!/<select\b/i.test(select) && /role="combobox"/.test(select) && /role="listbox"/.test(select),
  'select renders branded combobox/listbox chrome instead of an OS select');
ok(/aria-disabled="true"/.test(select) && /type="hidden" id="fixtureType" value="wellness"/.test(select),
  'select retains its value sink and unavailable-option state');

const date = api._svDateHtml('fixtureDate', '', {
  required: true,
  today: '2026-07-15',
  min: '2026-07-16',
  max: '2026-12-31',
});
ok(/data-sv-date-trigger/.test(date) && /data-sv-today="2026-07-15"/.test(date)
  && /min="2026-07-16"/.test(date) && /max="2026-12-31"/.test(date),
  'date control carries server today and live picker bounds');
ok(/aria-describedby="fixtureDateRequired"/.test(date) && /id="fixtureDateRequired">Required field\.<\/span>/.test(date)
  && /data-required="true"/.test(date) && !/\srequired(?:\s|>)/.test(date),
  'hidden date storage avoids browser validation focus traps while describing required semantics');

const stepper = api._svStepperHtml('fixtureDays', '', { step: 0.5, min: 0.5, max: 2 });
ok(/class="sv-stepper/.test(stepper) && /type="number"/.test(stepper)
  && /fixtureDaysDown/.test(stepper) && /fixtureDaysUp/.test(stepper),
  'stepper keeps a real number input behind explicit minus and plus controls');

function fakeClassList() {
  const values = new Set();
  return { toggle(name, on) { if (on) values.add(name); else values.delete(name); }, has: name => values.has(name) };
}

const events = [];
const elements = {
  fixtureDays: {
    value: '2', min: '1.5', max: '2', step: '0.5', disabled: false,
    dispatchEvent(event) { events.push(event.type); },
  },
  fixtureDaysWrap: { classList: fakeClassList() },
  fixtureDaysDown: { disabled: false },
  fixtureDaysUp: { disabled: false },
};
global.document = { getElementById: id => elements[id] || null };

api._svStepNumber('fixtureDays', -0.5);
ok(elements.fixtureDays.value === '1.5' && elements.fixtureDaysDown.disabled === true,
  'bounded request stepper reaches and disables at its half-day minimum');
api._svStepNumber('fixtureDays', -0.5);
ok(elements.fixtureDays.value === '1.5', 'bounded request stepper cannot cross its live minimum');
api._svStepNumber('fixtureDays', 0.5);
ok(elements.fixtureDays.value === '2' && elements.fixtureDaysUp.disabled === true,
  'bounded request stepper returns to and disables at its full-day maximum');

elements.fixtureDays.value = '';
elements.fixtureDays.min = '';
elements.fixtureDays.max = '';
elements.fixtureDaysDown.disabled = false;
elements.fixtureDaysUp.disabled = false;
api._svStepNumber('fixtureDays', -0.5);
ok(elements.fixtureDays.value === '-0.5', 'signed admin stepper can create a negative half-day correction from blank');
ok(events.filter(type => type === 'input').length === 4 && events.filter(type => type === 'change').length === 4,
  'every accepted step dispatches input and change through the existing form plumbing');

delete global.document;

if (failures) {
  console.error(`\n${failures} PTO control behavior check(s) failed`);
  process.exit(1);
}
console.log('\nPTO control behavior checks passed');
