'use strict';
/*
 * Calendar and Samples: Escape and Enter close a thumbnail or video link box.
 *
 * Owner report, 2026-09-26: "Escape does not close a Calendar card's thumbnail
 * or video edit box." Checked on the live site on 2026-10-08: still true. The
 * box had no key handler, so the only way out was to click somewhere else, and
 * that saved whatever was in the box.
 *
 *   Enter   keeps what was typed and closes (same as clicking away).
 *   Escape  puts back the link the box opened with, then closes. The box saves
 *           as you type, so the old link goes back through the same input path.
 *
 * The real handlers are lifted out of the app; Samples is the Calendar's twin
 * and gets the same checks.
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

for (const [surface, prefix] of [['Calendar', '_cal'], ['Samples', '_sxr']]) {
  const env = { inputs: [] };
  const onKey = new Function('env', `
    const ${prefix}OnLinkInput = input => env.inputs.push(input.value);
    ${extractFunction(INDEX, prefix + 'OnLinkKey')}
    return ${prefix}OnLinkKey;
  `)(env);
  const box = (opened, typed) => ({ defaultValue: opened, value: typed, blurred: 0, blur() { this.blurred++; } });
  const press = (key, input) => {
    const e = { key, prevented: 0, stopped: 0, preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; } };
    onKey(e, input);
    return e;
  };

  // Escape after typing: the old link is put back, saved through the input path, and the box closes.
  let input = box('https://example.invalid/old', 'https://example.invalid/half-typ');
  let e = press('Escape', input);
  ok(input.blurred === 1, surface + ': Escape closes the link box');
  ok(input.value === 'https://example.invalid/old', surface + ': Escape puts back the link the box opened with');
  ok(env.inputs.length === 1 && env.inputs[0] === 'https://example.invalid/old',
    surface + ': and sends the old link down the save path, so a half-typed one is not left behind');
  ok(e.stopped === 1 && e.prevented === 1, surface + ': Escape does not reach the page-level handlers (multi-select)');

  // Escape with nothing changed: just closes.
  env.inputs.length = 0;
  input = box('https://example.invalid/old', 'https://example.invalid/old');
  press('Escape', input);
  ok(input.blurred === 1 && env.inputs.length === 0, surface + ': Escape on an untouched box only closes it');

  // Enter keeps the typed link.
  input = box('https://example.invalid/old', 'https://example.invalid/new');
  press('Enter', input);
  ok(input.blurred === 1 && input.value === 'https://example.invalid/new' && env.inputs.length === 0,
    surface + ': Enter keeps what was typed and closes');

  // Any other key is left alone.
  input = box('a', 'ab');
  e = press('b', input);
  ok(input.blurred === 0 && e.stopped === 0 && e.prevented === 0, surface + ': ordinary typing is untouched');

  // And the box is actually wired to it.
  ok(new RegExp('onkeydown="' + prefix + 'OnLinkKey\\(event,this\\)"').test(extractFunction(INDEX, prefix + 'LinkFieldHtml')),
    surface + ': the link box calls the key handler');
}

if (failures) { console.log('\n' + failures + ' check(s) failed'); process.exit(1); }
console.log('\ncalendar-link-box-keys: all checks passed');
