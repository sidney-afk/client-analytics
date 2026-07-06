'use strict';
/*
 * Calendar: modern save indicator.
 *
 * The calendar card used to print the text "Saving…"/"Saved" on the Notes-button
 * row. It's replaced by a reusable icon-only indicator at the END of the title
 * row: a rotating ring while saving, a green ring + check that fades after ~2s
 * on success, and a red PERSISTENT ring with the save-error detail in its
 * tooltip on failure. The existing Save-failed·Retry affordance stays intact.
 *
 * Verifies the reusable component's state machine (by exercising the real
 * _svSaveIndApply / _svSaveIndHtml extracted from index.html) plus the calendar
 * wiring, reduced-motion support, and theme-variable colours.
 *
 * Run:  node test/calendar-save-indicator.js   (exit 0 = all good)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

let failures = 0;
function check(label, cond) {
  if (!cond) failures++;
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}`);
}

// A minimal fake DOM element covering the surface _svSaveIndApply touches.
function fakeEl() {
  const classes = new Set();
  const attrs = {};
  return {
    hidden: true,
    _svFadeTimer: null,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: (x) => classes.has(x),
      toggle: (x, on) => { if (on) classes.add(x); else classes.delete(x); },
    },
    setAttribute: (k, v) => { attrs[k] = String(v); },
    removeAttribute: (k) => { delete attrs[k]; },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    _classes: classes,
    _attrs: attrs,
  };
}

const _svSaveIndApply = new Function('return (' + grabFunc('_svSaveIndApply') + ')')();
const _svSaveIndHtml = new Function('_calEscAttr', 'return (' + grabFunc('_svSaveIndHtml') + ')')(s => String(s == null ? '' : s));

// ── State machine ────────────────────────────────────────────────────────────
{
  const el = fakeEl();
  _svSaveIndApply(el, 'saving');
  check('saving → visible with the spinning-ring class', el.hidden === false && el._classes.has('is-saving'));
  check('saving carries an aria-label', el._attrs['aria-label'] === 'Saving…');
  check('saving has no error affordance', !el._classes.has('is-error') && el._attrs['title'] === undefined);

  _svSaveIndApply(el, 'error', 'HTTP 500 upsert failed');
  check('error → red persistent class (not the saving class)', el._classes.has('is-error') && !el._classes.has('is-saving'));
  check('error PERSISTS (stays visible)', el.hidden === false);
  check('error tooltip carries the save-error detail', el._attrs['title'] === 'HTTP 500 upsert failed');
  check('error aria-label carries the detail', /HTTP 500 upsert failed/.test(el._attrs['aria-label'] || ''));

  _svSaveIndApply(el, 'saved');
  check('saved → green-check class, error class cleared', el._classes.has('is-saved') && !el._classes.has('is-error'));
  check('saved clears the stale error tooltip', el._attrs['title'] === undefined);
  check('saved schedules a fade-out timer (fades after ~2s)', !!el._svFadeTimer);

  _svSaveIndApply(el, 'idle');
  check('idle → hidden with no state classes',
    el.hidden === true && !el._classes.has('is-saved') && !el._classes.has('is-saving') && !el._classes.has('is-error'));
}
{
  // A new failure while a "saved" fade is pending must cancel that fade and stick red.
  const el = fakeEl();
  _svSaveIndApply(el, 'saved');
  check('saved set a pending fade timer', !!el._svFadeTimer);
  _svSaveIndApply(el, 'error', 'boom');
  check('saved→error cancels the pending fade and shows the error', el._svFadeTimer === null && el._classes.has('is-error'));
}
{
  let threw = false;
  try { _svSaveIndApply(null, 'saving'); } catch (e) { threw = true; }
  check('a missing element is a safe no-op', !threw);
}

// ── HTML shape ───────────────────────────────────────────────────────────────
{
  const h = _svSaveIndHtml('vid_abc123');
  check('indicator html is hidden by default', /class="sv-save-ind"[^>]*\shidden/.test(h));
  check('indicator html carries the per-card hook', /data-sv-save-ind="vid_abc123"/.test(h));
  check('indicator html has ring / check / bang layers',
    /sv-save-ind-arc/.test(h) && /sv-save-ind-check/.test(h) && /sv-save-ind-bang/.test(h));
  check('indicator is a polite status region for screen readers',
    /role="status"/.test(h) && /aria-live="polite"/.test(h));
}
{
  // Error persistence: with a save-error detail the indicator renders ALREADY in
  // its error state (not hidden), so it survives the re-render that follows a
  // failed save instead of resetting to a fresh hidden span.
  const h = _svSaveIndHtml('vid_abc123', null, 'HTTP 500 upsert failed');
  check('error-detail render is NOT hidden', !/class="sv-save-ind[^"]*"[^>]*\shidden/.test(h));
  check('error-detail render carries the is-error state', /class="sv-save-ind is-error"/.test(h));
  check('error-detail render puts the detail in the tooltip', /title="HTTP 500 upsert failed"/.test(h));
  check('error-detail render sets an aria-label with the detail', /aria-label="Save failed: HTTP 500 upsert failed"/.test(h));
}

// ── Calendar wiring + preserved affordances (source assertions) ──────────────
check('the calendar title row renders the reusable indicator at its end',
  INDEX.includes('${_svSaveIndHtml(pid, null, p && p._saveError'));
check('the title-row indicator persists its error state across the post-failure re-render (from p._saveError)',
  /_svSaveIndHtml\(pid, null, p && p\._saveError \? \(typeof p\._saveError === 'string' \? p\._saveError : 'Save failed'\)/.test(INDEX));
check('the title row wraps the name input for the fade + indicator',
  INDEX.includes('cal-title-name-wrap') && INDEX.includes('cal-title-fade'));
check('_calSetCardStatus drives the reusable indicator by card id',
  /_svSaveIndApply\(document\.querySelector\(`\[data-sv-save-ind=/.test(INDEX));
// Scope to the calendar's own status setter (Samples/Templates have their own
// suites in save-indicator-rollout.js).
const calSetStatus = grabFunc('_calSetCardStatus');
check('_calSetCardStatus no longer writes the transient Saving…/Saved TEXT into the card foot',
  !/textContent = 'Saving…'/.test(calSetStatus) && !/textContent = 'Saved'/.test(calSetStatus));
check('the Save-failed · Retry affordance (chip + retry) is preserved',
  INDEX.includes('Save failed · Retry') && INDEX.includes('_calRetrySave'));
check('the indicator honours prefers-reduced-motion (rotation dropped)',
  INDEX.includes('prefers-reduced-motion: reduce') &&
  /\.sv-save-ind\.is-saving \.sv-save-ind-svg \{ animation: none/.test(INDEX));
check('saved/error are SOLID colour discs with a white glyph, all from theme variables (light + dark)',
  /\.sv-save-ind\.is-saved \.sv-save-ind-track \{ fill: var\(--up\)/.test(INDEX) &&
  /\.sv-save-ind\.is-error \.sv-save-ind-track \{ fill: var\(--dn\)/.test(INDEX) &&
  /\.sv-save-ind-check \{ stroke: var\(--text-inverse\)/.test(INDEX) &&
  /\.sv-save-ind-bang \{ stroke: var\(--text-inverse\)/.test(INDEX) &&
  /\.sv-save-ind-track \{ stroke: var\(--border\)/.test(INDEX));

if (failures) { console.error(`\n${failures} check(s) failed ❌`); process.exit(1); }
console.log('\nAll calendar-save-indicator checks passed ✅');
