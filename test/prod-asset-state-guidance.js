'use strict';
/*
 * A refused deliverable link has to tell the designer what to DO.
 *
 * Reported 2026-08-19: a graphic designer pasted a finished thumbnail and got
 * "The asset could not be verified. Retry the access check or attach a
 * different link." -- true, and useless. The gateway's guidance is deliberately
 * public-safe and provider-neutral (it must never leak a URL or a client), so
 * the actionable wording belongs on the browser side, where the state code
 * already arrives as error.assetState.
 *
 * The load-bearing case is `expired`. Google returns the SAME 404 for a Drive
 * file that was deleted and for one that exists but was never shared. The
 * gateway calls that "expired" and its copy says "replace the expired asset",
 * which sends someone hunting for a new file when the real fix is usually a
 * sharing toggle. Both causes must be named, cheapest check first.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && source[i + 1] === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') { line = true; i++; continue; }
    if (ch === '/' && source[i + 1] === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

const text = new Function(extract('_prodAssetStateText') + ' return _prodAssetStateText;')();

const GATEWAY_FALLBACK = 'The asset could not be verified. Retry the access check or attach a different link.';

// --- the three refusals a designer can actually fix ------------------------
for (const state of ['permission_denied', 'expired', 'unavailable']) {
  const out = text(state, GATEWAY_FALLBACK);
  ok(out !== GATEWAY_FALLBACK,
  state + ' no longer passes the gateway\'s generic wording straight through');
  ok(/anyone with the link/i.test(out),
  state + ' names the concrete sharing setting to change');
  ok(/refresh access/i.test(out),
  state + ' points at the Refresh access control that is already on screen');
}

// --- the ambiguity that made the original message misleading ---------------
const expired = text('expired', GATEWAY_FALLBACK);
ok(/deleted/i.test(expired) && /shared/i.test(expired),
'the expired copy names BOTH causes of a Drive 404, not just deletion');
ok(expired.search(/shared/i) < expired.search(/removed|deleted the file|really was removed/i)
  || /check sharing first/i.test(expired),
'it puts the cheap check (sharing) before the expensive one (re-upload)');

// --- states whose gateway copy is already specific are left alone ----------
const missingCopy = 'This card has no deliverable link. Add the finished work first.';
ok(text('missing', missingCopy) === missingCopy,
'`missing` keeps the gateway copy, which is already actionable');
const invalidCopy = "That link isn't supported. Use a Google Drive file or folder.";
ok(text('invalid', invalidCopy) === invalidCopy,
'`invalid` keeps the gateway copy, which already lists the supported providers');

// --- unknown / absent states still say something --------------------------
ok(text('some_future_state', GATEWAY_FALLBACK) === GATEWAY_FALLBACK,
'an unrecognised state falls back to whatever the gateway said');
ok(text('', '') && text('', '').length > 20,
'a refusal with no state and no guidance still produces real copy, never empty');
ok(text(undefined, undefined).length > 20,
'undefined inputs do not throw or render "undefined"');
ok(!/undefined/.test(text(undefined, undefined)),
'the no-input path never leaks the word undefined into the UI');

// --- it is actually wired to the refusal ----------------------------------
const writeErr = extract('_prodWriteErrorText');
ok(/artifact_not_resolvable[\s\S]{0,200}_prodAssetStateText/.test(writeErr),
'the artifact_not_resolvable branch routes through the translator');
ok(!/artifact_not_resolvable[\s\S]{0,200}error\.guidance \|\|/.test(writeErr),
'that branch no longer returns the raw gateway guidance directly');

if (failures) process.exit(1);
console.log('\nAsset refusal guidance checks passed');
