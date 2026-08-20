'use strict';
/*
 * Samples native create, layer 5: the Samples tab uses the SAME create dialog.
 *
 * Owner 2026-08-19: "the samples tab behaves exactly like the calendar tab...
 * we create a post, we get the same menu from before, it creates the same
 * things as the calendar card." So there is one dialog with a `surface`
 * parameter, not two dialogs. A copy would drift within a week, which is how
 * the two tabs came to differ in the first place.
 *
 * The assertions that matter most here are the SEPARATION ones. A picker that
 * offered calendar batches on the samples tab (or vice versa) would let
 * someone append a sample to a client's real content calendar -- so the filter
 * is applied in the query, and every in-flight guard reads the surface's own
 * view rather than assuming the calendar is the one on screen.
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

// --- purpose mapping, executed -------------------------------------------
const purpose = new Function(extract('_nativePostPurpose') + ' return _nativePostPurpose;')();
ok(purpose('sxr') === 'samples', 'the samples surface asks for samples batches');
ok(purpose('calendar') === 'calendar' && purpose('') === 'calendar' && purpose(undefined) === 'calendar',
'every other surface asks for calendar batches, including an absent one');

// --- the picker filter is in the QUERY, not applied afterwards ------------
const batches = extract('_calLatestNativeBatches');
ok(/purpose=eq\.' \+ encodeURIComponent\(_nativePostPurpose\(surface\)\)/.test(batches),
'the batch read filters by purpose server-side, so the wrong tab\'s batches never arrive');
ok(/status,purpose,/.test(batches),
'purpose is selected back, so a row can be checked rather than trusted');
ok(/_calLatestNativeBatches\(clientSlug, surface\)/.test(source),
'the dialog passes its surface to the batch read');

// --- which view is authoritative, executed --------------------------------
function viewSlug(surface, cal, sxr) {
  const fn = new Function('calState', 'sxrState', 'calClientSlug', 'sxrClientSlug',
    extract('_nativePostViewSlug') + ' return _nativePostViewSlug;')(
    { client: cal }, { client: sxr }, c => 'cal:' + c, c => 'sxr:' + c);
  return fn(surface);
}
ok(viewSlug('sxr', 'A', 'B') === 'sxr:B',
'the samples surface reads the SAMPLES view\'s client');
ok(viewSlug('calendar', 'A', 'B') === 'cal:A',
'the calendar surface reads the calendar\'s client');
ok(viewSlug('', 'A', 'B') === 'cal:A',
'an unknown surface falls back to the calendar, never to samples');

// --- no calendar-only guard survives in the shared dialog -----------------
// A leftover calClientSlug(calState.client) check would close the samples
// dialog the moment the two tabs sat on different clients.
for (const fn of ['_calOpenNativePost', '_calSubmitNativePost']) {
  ok(!/calClientSlug\(calState\.client\)/.test(extract(fn)),
  fn + ' guards on the surface\'s own view, not on the calendar unconditionally');
}

// --- the surface reaches every layer that needs it ------------------------
const submit = extract('_calSubmitNativePost');
ok(/const surface = state\.surface === 'sxr' \? 'sxr' : 'calendar';/.test(submit),
'submit re-derives the surface from dialog state and normalises it');
// post_count joined the signature 2026-08-20 (multi-post Create Post); assert
// the surface AND the count, so neither can be dropped without a red test.
ok(/surface, choice, mode, post_count: postCount, client_slug: state\.clientSlug/.test(submit),
'the idempotency signature carries the surface and the post count -- a samples job, a calendar job, and a 12-post job are all different work');
ok(/operation: 'intake_create', surface, client_slug/.test(submit),
'the gateway payload carries the surface, which is what stamps purpose and origin');
ok(/materialization_source: surface === 'sxr' \? 'samples-native' : 'calendar-native'/.test(submit),
'the materialization source distinguishes the two, so the card lands in the right table');
ok(/surface === 'sxr' \? 'samples-create-post' : 'calendar-create-post'/.test(submit),
'the resume reason distinguishes them, so a recovered job resumes onto its own tab');

// --- the plus button routes like the calendar's ---------------------------
const add = extract('addSxrBlankCard');
ok(/_calOpenNativePost\(clientName, clientSlug, 'sxr'\)/.test(add),
'an enrolled client gets the native dialog from the samples "+"');
ok(/_sxrInsertLocalBlankCard\(\)/.test(add),
'an UNENROLLED client still gets a local blank card -- the "+" is never dead');
ok(/sxrClientSlug\(sxrState\.client\) !== clientSlug/.test(add),
'a client switch while the rollout flag loads abandons the click');
ok(/if \(_isClientLink\) return;/.test(add),
'a client link still cannot create samples');
ok(/catch \(error\) \{ useGateway = false; \}/.test(add),
'a failed flag read falls back to the local card rather than throwing away the click');

// --- the local-blank path still exists independently ----------------------
ok(/function _sxrInsertLocalBlankCard\(\)/.test(source),
'the original blank-card behaviour is preserved as its own function, not inlined away');

if (failures) process.exit(1);
console.log('\nSamples native dialog checks passed');
