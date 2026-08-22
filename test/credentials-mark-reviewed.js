'use strict';
/*
 * A credential review queue must be CLEARABLE, and confirming a row must not
 * cost the row anything.
 *
 * Two defects found in live data on 2026-08-22, both in the same save path:
 *
 * 1. NOTHING COULD LEAVE `needs_review`. Every imported credential lands
 *    needs_review by design -- a wrong guess about a credential is worse than
 *    no guess -- but the edit dialog re-sent `status: row.status`, so a row a
 *    human had actually read stayed flagged for ever. 47 of 59 live rows were
 *    stuck in that state, which is why the owner reported that "most of them
 *    say need review". The deliberate landing state was missing its exit.
 *
 * 2. SAVING WIPED THE LABEL. The same payload sent `label: ''` unconditionally
 *    because the dialog has no label field. That is why every manually-touched
 *    row carries an empty label while imported rows keep theirs -- and it is
 *    what made the 2026-08-21 duplicate-protection lookup unable to key on
 *    label at all.
 *
 * The exit rides the existing `upsert`, which the gateway materializes as a
 * FULL row replace (materializeCredential builds every column from the request
 * and nullables what is absent). So the confirm has to send the row's own
 * password back verbatim, and an ABSENT password property must refuse rather
 * than send an empty one -- otherwise the day a list stops returning secrets,
 * this button becomes a password eraser.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.env.CC_REVIEW_SRC || path.join(ROOT, 'index.html');
const source = fs.readFileSync(SRC, 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function extractFn(name) {
  let start = source.indexOf('async function ' + name + '(');
  if (start < 0) start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') { depth--; if (seen && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

/* ---- execute the real _ccMarkReviewed against a recording gateway -------- */
function harness(row) {
  const calls = [];
  const toasts = [];
  const sandbox = {
    _ccFind: () => row,
    _ccApi: async (action, payload) => { calls.push({ action, payload }); },
    showToast: msg => toasts.push(String(msg)),
    _ccLoadModal: () => { calls.push({ action: 'reload:modal' }); },
    _ccLoadKasper: () => { calls.push({ action: 'reload:kasper' }); },
    _ccLastLocalWriteAt: 0,
    Date,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFn('_ccMarkReviewed') + '\nthis.markReviewed = _ccMarkReviewed;', sandbox);
  return { run: sandbox.markReviewed, calls, toasts };
}

const REVIEW_ROW = {
  id: 'cred-1',
  client_slug: 'clientx',
  client_name: 'Client X',
  platform: 'instagram',
  label: 'Instagram Username & Password',
  handle: 'clientx',
  password: 'S3cret-value!',
  notes: 'client wrote this in onboarding',
  status: 'needs_review',
  source: 'onboarding',
};

(async () => {
  // 1. The happy path: a reviewed row becomes active and loses nothing.
  let h = harness(REVIEW_ROW);
  ok(typeof h.run === 'function', 'the real confirm function extracts and executes (harness is not vacuous)');
  await h.run('cred-1', 'kasper');
  const upsert = h.calls.find(c => c.action === 'upsert');
  ok(!!upsert, 'confirming a needs_review row reaches the gateway');
  const sent = upsert ? upsert.payload.credential : {};
  ok(sent.status === 'active', 'it sets status active -- this is the exit the queue never had');
  ok(sent.password === 'S3cret-value!',
    'the password is sent back VERBATIM, because upsert replaces the whole row rather than patching it');
  ok(sent.label === 'Instagram Username & Password',
    'the label survives the confirm');
  ok(sent.handle === 'clientx' && sent.notes === 'client wrote this in onboarding'
    && sent.client_slug === 'clientx' && sent.platform === 'instagram' && sent.source === 'onboarding',
    'every other stored field survives the confirm unchanged');
  ok(h.calls.some(c => c.action === 'reload:kasper'), 'the list reloads so the row visibly leaves the queue');
  ok(h.toasts.join(' ').includes('Marked reviewed'), 'the person gets told it worked');

  // 2. It is a no-op on rows that are not in the queue -- confirming an active
  //    row must never rewrite it, and an archived row must stay archived.
  for (const status of ['active', 'archived']) {
    h = harness(Object.assign({}, REVIEW_ROW, { status }));
    await h.run('cred-1', 'kasper');
    ok(!h.calls.some(c => c.action === 'upsert'), 'a ' + status + ' row is never rewritten by the confirm');
  }
  h = harness(null);
  await h.run('missing', 'kasper');
  ok(!h.calls.some(c => c.action === 'upsert'), 'an unknown id writes nothing');

  // 3. THE GUARD. An absent password property must REFUSE, never send ''. If a
  //    future list stops returning secrets, this is what stops the button from
  //    quietly erasing every password it touches.
  const noPw = Object.assign({}, REVIEW_ROW);
  delete noPw.password;
  h = harness(noPw);
  await h.run('cred-1', 'kasper');
  ok(!h.calls.some(c => c.action === 'upsert'),
    'a row whose password is ABSENT refuses to write rather than blanking the secret');
  ok(h.toasts.join(' ').toLowerCase().includes('cannot confirm'), 'and it says so instead of failing silently');

  // A genuinely empty password is a real value and must still be confirmable.
  h = harness(Object.assign({}, REVIEW_ROW, { password: '' }));
  await h.run('cred-1', 'kasper');
  const emptyOk = h.calls.find(c => c.action === 'upsert');
  ok(!!emptyOk && emptyOk.payload.credential.password === '',
    'an empty password is a real value and still confirms');

  // 4. The modal scope reloads the modal, not the Kasper list.
  h = harness(REVIEW_ROW);
  await h.run('cred-1', 'modal');
  ok(h.calls.some(c => c.action === 'reload:modal') && !h.calls.some(c => c.action === 'reload:kasper'),
    'the SMM modal reloads its own scope');

  /* ---- the edit dialog stops wiping the label -------------------------- */
  const editFn = extractFn('_ccOpenEdit');
  ok(!/label: '',/.test(editFn),
    'the edit save no longer hardcodes an empty label');
  ok(/label: \(row && row\.label\) \|\| '',/.test(editFn),
    'it carries the stored label through instead');

  /* ---- the button is wired, and only where it belongs ------------------ */
  const rowFn = extractFn('_ccRowHtml');
  ok(/_ccMarkReviewed\(\$\{idArg\}, \$\{scopeArg\}\)/.test(rowFn),
    'the row renders the confirm control wired to the real function');
  ok(/r\.status === 'needs_review' \?[\s\S]{0,220}_ccMarkReviewed/.test(rowFn),
    'the control appears ONLY on rows that are actually in the queue');
  ok(!/<div/.test(rowFn.slice(rowFn.indexOf('cc-row-actions'), rowFn.indexOf('cc-row-actions') + 400)),
    'the action strip gained no nested <div> wrapper');

  if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
  console.log('\nall green');
})().catch(e => { console.error('FAIL  harness: ' + (e && e.message)); process.exit(1); });
