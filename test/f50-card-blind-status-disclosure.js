'use strict';
/*
 * F50, the half that never shipped: SAY that the card will not move.
 *
 * Owner ruling 2026-08-10, in two parts. Statuses with no card equivalent leave
 * the card exactly as it is — that half shipped as `_calMapNativeStatusStrict`
 * and is pinned exhaustively in test/f50-native-status-map.js — "and the UI
 * states plainly that the change is not reflected on the calendar". That second
 * half existed only as a code comment. OPEN_REPAIRS recorded it as prospective
 * because no card-linked graphics row was in an unmapped status at the time;
 * graphics flipped on 2026-08-16, so it is prospective no longer.
 *
 * The reasoning behind the ruling governs the shape of the fix: the card
 * vocabulary is deliberately small so the team is not confused by it. The answer
 * is never to add the missing word to the calendar, only to say it is missing.
 *
 * What is pinned here:
 *   1. the sentence is DERIVED from the same mapper that governs the
 *      projection, so the two can never disagree — including the
 *      surface-specific case, where Scheduled and Posted are ordinary calendar
 *      words but have no equivalent on a samples sheet;
 *   2. it appears only where there is something to be out of step with — a
 *      deliverable with no card gets no note;
 *   3. a multi-select says how many of the selected cards are affected rather
 *      than implying all of them;
 *   4. the picker actually USES it, in the visible label and in the guidance,
 *      because a helper nothing calls is not a disclosure.
 *
 * Points 1-3 are EXECUTED against the real functions. Point 4 is a wiring check
 * on the picker source, stated plainly as such: the picker branch pulls in the
 * whole production module and cannot be run in isolation here, so the mutation
 * proof for it removes each use and requires this suite to fail.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.env.F50_DISCLOSURE_SRC || path.join(ROOT, 'index.html');
const source = fs.readFileSync(SRC, 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function extractFn(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') { depth--; if (seen && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function extractConst(name) {
  const start = source.indexOf('const ' + name + ' = {');
  if (start < 0) throw new Error('missing const: ' + name);
  const end = source.indexOf('};', start);
  if (end < 0) throw new Error('unbalanced const: ' + name);
  return source.slice(start, end + 2);
}

const sandbox = { String, Set, Number, Boolean, Object, Array };
vm.createContext(sandbox);
vm.runInContext(
  extractConst('PROD_STATUS_FROM_ARTIFACT') + '\n'
  + extractFn('_calMapNativeStatusStrict') + '\n'
  + extractFn('_prodCardSurfaceFor') + '\n'
  + extractFn('_prodStatusCardBlindNote') + '\n'
  + 'this.note = _prodStatusCardBlindNote; this.surfaceOf = _prodCardSurfaceFor;'
  + 'this.map = _calMapNativeStatusStrict; this.fromArtifact = PROD_STATUS_FROM_ARTIFACT;',
  sandbox,
);
const { note, surfaceOf, map, fromArtifact } = sandbox;
ok(typeof note === 'function' && typeof map === 'function',
  'the real disclosure and the real mapper both extract and run (harness is not vacuous)');

const calendarCard = { card_id: 'p_1', origin: 'calendar' };
const samplesCard = { card_id: 'p_2', origin: 'samples' };
const noCard = { card_id: '', origin: 'manual' };

ok(surfaceOf(samplesCard) === 'samples' && surfaceOf(calendarCard) === 'calendar',
  'a samples deliverable is judged against the samples vocabulary');
ok(surfaceOf({ origin: 'manual' }) === 'calendar' && surfaceOf(null) === 'calendar',
  'anything else falls back to the calendar vocabulary rather than going silent');

// 1. The three the ruling named. Each is unmapped on BOTH surfaces.
for (const key of ['triage', 'canceled', 'duplicate']) {
  const text = note(key, [calendarCard]);
  ok(/not shown on the calendar/i.test(text), key + ' is disclosed as not shown on the calendar');
  ok(/keeps the status it has now/i.test(text), key + ' says what happens instead — the card does not move');
}

// 2. The words the calendar DOES have must stay silent, or the notice becomes
//    wallpaper and stops being read.
for (const key of ['prog', 'smm', 'kasper', 'client', 'tweak', 'approved', 'scheduled', 'posted', 'todo', 'backlog']) {
  ok(note(key, [calendarCard]) === '', key + ' is a calendar word, so nothing is said');
}

// 3. Surface-specific: Scheduled and Posted are real calendar words with no
//    samples equivalent. Derived from the mapper, so this comes for free.
ok(/not shown on the samples sheet/i.test(note('scheduled', [samplesCard])),
  'Scheduled is disclosed on a SAMPLES card, where the vocabulary has no such word');
ok(/not shown on the samples sheet/i.test(note('posted', [samplesCard])),
  'Posted is disclosed on a samples card too');
ok(note('approved', [samplesCard]) === '', 'but Approved is a samples word and stays silent');

// 4. Nothing to be out of step with — no card, no notice.
ok(note('canceled', [noCard]) === '', 'a deliverable with no card gets no notice');
ok(note('canceled', []) === '' && note('canceled', null) === '',
  'an empty or missing selection says nothing rather than throwing');
ok(note('', [calendarCard]) === '' && note('not_a_status', [calendarCard]) === '',
  'an unrecognised picker key says nothing rather than guessing');

// 5. Multi-select must be truthful about HOW MANY cards it speaks for.
const mixed = note('scheduled', [samplesCard, calendarCard]);
ok(/^1 of these are not shown on the samples sheet/.test(mixed),
  'a mixed selection names the count instead of implying all of them (got ' + JSON.stringify(mixed) + ')');
ok(/those cards keep the status they have now/i.test(mixed), 'and still says what happens to them');
const allBlind = note('canceled', [calendarCard, { card_id: 'p_3', origin: 'calendar' }]);
ok(/those cards keep the status they have now/i.test(allBlind) && !/^\d+ of these/.test(allBlind),
  'when every selected card is affected it speaks plainly, without a count');
const bothSurfaces = note('canceled', [calendarCard, samplesCard]);
ok(/the calendar or the samples sheet/.test(bothSurfaces),
  'a selection spanning both surfaces names both rather than picking one');

// 6. Unlinked rows in the selection are ignored entirely — they are not part of
//    the count and cannot suppress a notice for the linked ones.
const withUnlinked = note('canceled', [calendarCard, noCard]);
ok(/keeps the status it has now/i.test(withUnlinked) && !/^\d+ of these/.test(withUnlinked),
  'an unlinked row in the selection neither adds to the count nor mutes the notice');

// 7. Derived, not hand-listed: whatever the mapper refuses is what gets
//    disclosed. Proven by agreeing with the mapper across the whole vocabulary.
const ARTIFACT_KEYS = ['triage', 'backlog', 'todo', 'prog', 'smm', 'kasper', 'client', 'tweak',
  'approved', 'scheduled', 'posted', 'canceled', 'duplicate'];
for (const surface of ['calendar', 'samples']) {
  const card = surface === 'samples' ? samplesCard : calendarCard;
  const disagreements = ARTIFACT_KEYS.filter(key => {
    const native = fromArtifact[key];
    return (!map(native, surface)) !== (note(key, [card]) !== '');
  });
  ok(disagreements.length === 0,
    'on the ' + surface + ' surface the notice agrees with the mapper for all 13 statuses'
    + (disagreements.length ? ' (disagreed on ' + disagreements.join(', ') + ')' : ''));
}

/* 8. WIRING. Source-level on purpose — see the header. The picker branch is the
      only place a person picks a status, so the note has to reach both the
      visible row and the guidance line. */
const pickerAt = source.indexOf("hd: 'Change status...'");
ok(pickerAt > -1, 'the status picker branch was found');
const branch = source.slice(pickerAt, pickerAt + 2500);
ok(/const blindNote = _prodStatusCardBlindNote\(k, targets\)/.test(branch),
  'the picker computes the note for every offered status, against every selected row');
ok(/guidance: k === 'smm' && smmGate \? smmGate\.guidance : blindNote/.test(branch),
  'the note becomes the guidance line when no stronger gate speaks');
ok(/blindNote \? '<small>' \+ _calEsc\(blindNote\)/.test(branch),
  'and is rendered under the status name, escaped');

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nall green');
