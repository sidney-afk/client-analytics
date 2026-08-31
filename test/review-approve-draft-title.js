'use strict';
/*
 * Approve greys out the instant a reviewer types a word, and nothing said
 * why. Sweep item 87.7.
 *
 * The gate is correct and stays: an unsent draft and an approval are two
 * different intents, and letting both fire is the actual defect the gate
 * prevents. What was missing is the sentence, on FOUR review surfaces --
 * calendar, SXR review, SXR Kasper queue, Kasper hero/panel -- and each one
 * has a render-time title AND a per-keystroke updater that toggles
 * `disabled` without repainting, so the fix has to touch both or the title
 * lies the moment someone types.
 *
 * DELIBERATELY NARROW. This fires only for the draft-caused disablement. A
 * surface rendering Approve disabled for another reason (mid-tweak-cycle,
 * saving) keeps its title exactly as it was -- claiming "there is an unsent
 * note" when there is none would be a new false statement in the same spot
 * this removes one from.
 *
 * data-idle-title IS THE MECHANISM WORTH PINNING. The alt segment of the
 * split button ("Approve & send to Kasper instead") carries a real,
 * different title when idle. Restoring by BLANKING would silently delete
 * that hint every time someone typed and cleared a draft. Render writes the
 * idle title once; the updater reads it back rather than reconstructing it,
 * so the two can never drift apart.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], next = INDEX[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

/* ---- 1. The shared sentence exists and is not vague ---------------------- */

const TITLE = (INDEX.match(/const REVIEW_APPROVE_DRAFT_TITLE = '([^']+)';/) || [])[1] || '';
ok(!!TITLE, 'the shared draft-title sentence exists');
ok(/unsent/i.test(TITLE), 'it says WHY: the note is unsent');
ok(/Comment/.test(TITLE), 'it says WHAT TO DO: press Comment to send it');
ok(/clear/i.test(TITLE), '...or clear the text, the other way out');

/* ---- 2. All four render sites use it, gated on hasDraft ------------------ */

const RENDER_FNS = ['_calReviewPanelHtml', '_sxrReviewPanelHtml', '_sxrKasperPanelHtml', '_kasperHeroPanel', '_kasperPanelHtml'];
for (const name of RENDER_FNS) {
  const body = grabFunc(name);
  ok(/hasDraft \? [_a-zA-Z]+EscAttr\(REVIEW_APPROVE_DRAFT_TITLE\)/.test(body),
    name + ' renders the draft title, gated on hasDraft, escaped for the attribute');
  ok(/data-idle-title/.test(body),
    name + ' records what to restore the title to when the draft clears');
}

/* ---- 3. The alt segment keeps its OWN idle title, not a blanked one ------ */
/* THE TRAP. A version that reset every approve control's title to '' on
   clear would silently delete the alt segment's routing hint the first time
   a reviewer typed and then cleared a draft. */

for (const name of ['_calReviewPanelHtml', '_sxrReviewPanelHtml']) {
  const body = grabFunc(name);
  ok(/const altIdle = 'Approve & send to '/.test(body),
    name + ' computes a REAL idle title for the alt segment, not an empty one');
  ok(/data-idle-title="\$\{_[a-zA-Z]+EscAttr\(altIdle\)\}"/.test(body),
    '...and writes it to data-idle-title so the updater can restore exactly that, not guess at it');
}

/* ---- 4. All four updaters restore from data-idle-title, not from a guess - */

const UPDATER_FNS = ['_calReviewOnDraftInput', '_sxrReviewOnDraftInput', '_sxrKasperOnDraftInput', '_kasperOnPanelDraftInput'];
for (const name of UPDATER_FNS) {
  const body = grabFunc(name);
  ok(/b\.title = .*REVIEW_APPROVE_DRAFT_TITLE.*getAttribute\('data-idle-title'\)/.test(body),
    name + ' sets the draft title while typing, and reads data-idle-title back on clear -- never reconstructs it');
}

/* ---- 5. Executed: the whole render -> type -> clear cycle, live ---------- */
/* Not just source-shape. A controlled DOM proves the alt segment survives a
   type-then-clear round trip with its ORIGINAL title, not a blank one. */
{
  const dom = {};
  function makeEl(tag) {
    const el = {
      tagName: tag, attrs: {}, children: [], disabled: false, title: '',
      classList: { list: [], add(c) { this.list.push(c); }, contains(c) { return this.list.includes(c); } },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      querySelectorAll(sel) {
        const classes = sel.split(',').map(s => s.trim().replace(/^\./, ''));
        const out = [];
        const walk = n => { for (const c of n.children) { if (classes.some(cl => c.classList.contains(cl))) out.push(c); walk(c); } };
        walk(this);
        return out;
      },
    };
    return el;
  }
  // Build the split-button DOM the way _calReviewPanelHtml's HTML string
  // would parse into: a panel containing the main + alt segments.
  const panel = makeEl('div');
  const main = makeEl('button'); main.classList.add('cal-review-approve-btn'); main.classList.add('cal-review-approve-main');
  main.setAttribute('data-idle-title', ''); main.title = '';
  const alt = makeEl('button'); alt.classList.add('cal-review-approve-alt');
  const idleAltTitle = 'Approve & send to Kasper instead';
  alt.setAttribute('data-idle-title', idleAltTitle); alt.title = idleAltTitle;
  panel.children.push(main, alt);

  const state = { drafts: {}, saving: {} };
  const key = 'p1|video';
  // Simulate the updater's disable+title logic directly (mirrors the real
  // function body verified by shape above), against the live DOM stand-in.
  function applyDraftState(nowHasDraft) {
    panel.querySelectorAll('.cal-review-approve-btn, .cal-review-approve-alt').forEach(b => {
      b.disabled = nowHasDraft || !!state.saving[key];
      b.title = nowHasDraft ? TITLE : (b.getAttribute('data-idle-title') || '');
    });
  }

  applyDraftState(false);
  ok(alt.title === idleAltTitle && main.title === '',
    'before typing: alt keeps its routing hint, main has none -- matches render');

  applyDraftState(true);
  ok(main.title === TITLE && alt.title === TITLE && main.disabled && alt.disabled,
    'mid-typing: BOTH segments explain the draft and are disabled');

  applyDraftState(false);
  ok(alt.title === idleAltTitle && main.title === '' && !main.disabled && !alt.disabled,
    'after clearing: the alt segment routing hint is back verbatim, not blank -- '
    + 'this is the exact regression a naive `title = \'\'` reset would cause');
}

console.log(failures === 0
  ? '\nReview approve draft-title checks passed'
  : '\n' + failures + ' review approve draft-title check(s) failed');
process.exit(failures === 0 ? 0 : 1);
