'use strict';
/* no-sending-words.js -- round 7 (owner, 2026-10-24): a send never shows the words "Sending…" or "Saving…"; a small
 * spinner turns in their place (OPEN_REPAIRS 489, the staff sweep 492). Source scan; the browser half is unread-badges-v2-browser.js (I).
 *
 *   - the shared spinner exists: svSpinHtml / svBusyHtml / svBusyText in 040, the .sv-spin rule in 020 and its copy in the review
 *     stage's shadow-root CSS (195), and svSpinHtml draws no visible words
 *   - each staff send path swept this round takes the spinner when the switch is on, before its old words:
 *     the note outbox line (190 _noteOutboxStatusHtml: Notes and Messages, Calendar and Samples), the urgent ping
 *     (140), the review stage's conversation time for the team and Kasper (195), Kasper's Approve (330, 290)
 *   - 327 (the switch's own code) writes neither word
 *   - no file gains a visible "Sending…" / "Saving…" (a ratchet: the counts below may only go down; the client page's
 *     share is session Porch's)
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const src = f => fs.readFileSync(path.join(root, 'src/index', f), 'utf8');
let failures = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { failures++; console.error('FAIL  ' + m); } };

// The shared spinner.
const s040 = src('040-shared-briefs.js.part');
ok(/function svSpinHtml\(label\)/.test(s040) && /function svBusyHtml\(words, label\)/.test(s040) && /function svBusyText\(el, words, label\)/.test(s040), '040 has svSpinHtml, svBusyHtml and svBusyText');
const fnStart = s040.indexOf('function svSpinHtml(');
const fnSrc = s040.slice(fnStart, s040.indexOf('\n    }', fnStart) + 6);
const svSpinHtml = new Function(fnSrc + '\nreturn svSpinHtml;')();
const html = svSpinHtml('Sending');
ok(/^<span class="sv-spin" role="status" aria-label="Sending"><\/span>$/.test(html), 'svSpinHtml is an empty ring with its label for screen readers only: ' + html);
ok(!/[<>"]/.test(svSpinHtml('a"<b>').replace(/^<span class="sv-spin" role="status" aria-label="/, '').replace(/"><\/span>$/, '')), 'svSpinHtml escapes its label');
ok(/\.sv-spin \{[^}]*animation: sv-spin-turn/.test(src('020-styles-surfaces.css.part')), '020 has the .sv-spin rule');
const s195 = src('195-review-stage.js.part');
ok(/\n\.sv-spin\{[^}]*animation:sv-spin-turn/.test(s195), 'the review stage (shadow root) carries its own copy of the rule');

// The shared rule: 040 svBusyHtml / svBusyText. The spinner for the switch's staff, the words otherwise, and any other
// text passed through (escaped). Run here from its own source with the switch stubbed both ways.
const pick = name => { const i = s040.indexOf('function ' + name + '('); return s040.slice(i, s040.indexOf('\n    }', i) + 6); };
const busyRe = (s040.match(/const SV_BUSY_WORDS = (\/.*\/);/) || [])[1];
const make = on => new Function('svUnreadBadgesOn', 'const SV_BUSY_WORDS = ' + busyRe + ';\n' + fnSrc + pick('svBusyOn') + pick('svBusyHtml') + pick('svBusyText')
  + '\nreturn { svBusyHtml, svBusyText };')(() => on);
const on = make(true), off = make(false);
ok(on.svBusyHtml('Saving…') === '<span class="sv-busy"><span class="sv-busy-words" aria-hidden="true">Saving…</span><span class="sv-spin" role="status" aria-label="Saving"></span></span>'
  && /aria-label="Sending"/.test(on.svBusyHtml('Sending agreement...')),
  'switch on: "Saving…" / "Sending agreement..." become the spinner over the invisible words (same size), labelled for screen readers');
ok(/\.sv-busy-words \{ visibility: hidden; \}/.test(src('020-styles-surfaces.css.part')) && /\.sv-busy-words\{visibility:hidden\}/.test(s195),
  'the busy words never show: hidden in the page styles and in the review stage\'s copy');
ok(off.svBusyHtml('Saving...') === 'Saving...' && on.svBusyHtml('Saved <b>') === 'Saved &#60;b&#62;' && off.svBusyHtml('a "b"') === 'a &#34;b&#34;',
  'switch off: the words as before; any other text passes through, escaped');
const el = { tagName: 'SPAN', innerHTML: '', textContent: '' };
on.svBusyText(el, 'Sending…'); const spun = el.innerHTML;
off.svBusyText(el, 'Sending…');
ok(/sv-spin/.test(spun) && el.textContent === 'Sending…', 'svBusyText: the spinner with the switch on, the words with it off');
ok(/function svBusyOn\(\) \{\s*try \{ return typeof svUnreadBadgesOn === 'function' && !!svUnreadBadgesOn\(\); \}/.test(s040),
  'svBusyOn follows the switch (unread_badges_v2), which never names a client link');

// Each staff send or save path goes through it.
const PATHS = [
  ['050-market-briefs.js.part', "svBusyText(btn,'Sending...')", 'the weekly Slack update button'],
  ['060-templates-filming.js.part', "svBusyHtml('Saving…')", 'Templates: saving a spec'],
  ['060-templates-filming.js.part', "svBusyText(btn, 'Sending…')", 'Templates: sending a brain change'],
  ['060-templates-filming.js.part', 'svBusyHtml(_fpStatusMsg)', 'Filming plans: the status line'],
  ['072-workload-calm.js.part', "svBusyHtml('Saving…')", 'Workload: saving a due date'],
  ['090-workload-popovers.js.part', "svBusyHtml('Saving…')", 'Workload popover: saving a due date'],
  ['110-time-off.js.part', "svBusyText(button, 'Sending…')", 'Time off: sending a request'],
  ['140-calendar-legacy-outbox.js.part', "svBusyText(btn, 'Sending…')", 'the urgent ping button'],
  ['160-calendar-organize-ui.js.part', "svBusyHtml('Sending…')", 'Notify client: the send button'],
  ['180-calendar-native-post-media.js.part', "svBusyText(document.getElementById('calNativeSavedStatus'), text)", 'Post: the saved-post status line'],
  ['180-calendar-native-post-media.js.part', "svBusyText(btn, 'Saving…')", 'Post: saving calls to action and thumbnail prompts'],
  ['190-calendar-approval-comments.js.part', "if (c._outbox === 'sending' && svBusyOn()) return", 'Notes and Messages: a note on its way'],
  ['190-calendar-approval-comments.js.part', `<div class="pocket-staff-cal-saving" role="status">\${svBusyHtml('Saving…')}`, 'Calendar on a phone: a part being saved'],
  ['195-review-stage.js.part', "R.mode !== 'client' ? svBusyHtml('Saving…')", 'review page, team and Kasper: Finish reviewing'],
  ['195-review-stage.js.part', "R.mode !== 'client' ? svBusyHtml('Sending…')", 'review page, team and Kasper: a note on its way'],
  ['195-review-stage.js.part', "spin: !!c.sending && mode !== 'client' && svBusyOn()", 'review page, team and Kasper: the conversation time'],
  ['200-intake-data-startup.js.part', "svBusyText(document.getElementById('linearSavedStatus'), text)", 'Submit: the saved-job status line'],
  ['230-production-create-comments.js.part', "(pending ? svBusyHtml('Saving...')", 'Production: the comment button'],
  ['230-production-create-comments.js.part', "role=\"status\">' + svBusyHtml('Saving...')", 'Production: the comment status'],
  ['230-production-create-comments.js.part', `<span class="prod-write-state">' + svBusyHtml('Saving…')`, 'Production: saving labels'],
  ['240-production-description.js.part', "(state.saving ? svBusyHtml('Saving…') : 'Save')", 'Production: saving a description'],
  ['240-production-description.js.part', "(pending ? svBusyHtml('Saving…') : (batchWide", 'Production: saving assets'],
  ['280-samples-cards-notes.js.part', `<div class="pocket-staff-samples-saving" role="status">\${svBusyHtml('Saving…')}`, 'Samples on a phone: a part being saved'],
  ['290-samples-writes-review.js.part', "svBusyHtml('Saving…')", "Samples: Kasper's Approve"],
  ['310-sales-intake-hiring.js.part', 'svBusyHtml(_hpState.actionMessage)', 'Hiring: the action status'],
  ['310-sales-intake-hiring.js.part', "svBusyText(btn, 'Sending agreement...')", 'Sales intake: sending the agreement'],
  ['323-kasper-dashboard-tail.js.part', "${_caState.pickerBusy ? svBusyHtml('Saving…')", 'Clients: saving the manager'],
  ['323-kasper-dashboard-tail.js.part', "${ed.saving ? svBusyHtml('Saving…')", 'Clients: saving an edit'],
  ['324-client-onboarding-panel.js.part', "svBusyHtml('Saving…') : 'Mark done'", 'Onboarding: marking a step'],
  ['330-kasper-review-history.js.part', "svBusyHtml('Saving…')", "Kasper: Approve"],
];
for (const [f, needle, what] of PATHS) ok(src(f).includes(needle), f.slice(0, 3) + ': ' + what + ' shows the spinner, not the words');
const code = f => src(f).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
ok(!/(['"`>])\s*(Sending|Saving)(…|\.\.\.)/.test(code('327-core-unread-badges.js.part')), '327 writes neither word');

// The ratchet. A visible literal: quote or ">" then the word then "…" or "...", outside a comment line, that does not
// go through svBusyHtml / svBusyText, directly or through a status line that renders with them (the sinks below).
const SINKS = /(?:svBusy(?:Html|Text)\((?:[^()'"`]|'[^']*'|"[^"]*")*\)|(?:_fpSetStatus|_calNativeSavedSay|_linearSavedSay)\('[^']*'\)|_hpState\.actionMessage = '[^']*')/g;
ok(src('060-templates-filming.js.part').includes('svBusyHtml(_fpStatusMsg)') && src('310-sales-intake-hiring.js.part').includes('svBusyHtml(_hpState.actionMessage)')
  && /function _calNativeSavedSay\(text\) \{ svBusyText\(/.test(src('180-calendar-native-post-media.js.part')) && /function _linearSavedSay\(text\) \{ svBusyText\(/.test(src('200-intake-data-startup.js.part')),
  'every status line the ratchet treats as handled renders through svBusyHtml / svBusyText');
// What is left, each with its reason. The client review page's share is session Porch's.
const BASELINE = {
  '170-calendar-links-status.js.part': 1,        // a screen-reader label on the saving icon, never shown
  '185-client-review-queue.js.part': 2,          // the client review page (Porch)
  '190-calendar-approval-comments.js.part': 4,   // the client review panel and the note-outbox words for a client (Porch)
  '195-review-stage.js.part': 4,                 // the review page's client mode (Porch), and the bell's hover text
  '280-samples-cards-notes.js.part': 2,          // the client review panel on Samples (Porch)
};
const re = /(['"`>])\s*(Sending|Saving)(…|\.\.\.)/g;
const grew = [], counts = {};
for (const f of fs.readdirSync(path.join(root, 'src/index')).filter(f => /\.(js|html)\.part$/.test(f))) {
  let n = 0;
  // Block comments go first (their middle lines start with nothing a line test could see), then line comments.
  for (const line of src(f).replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).split('\n')) {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    n += (line.replace(SINKS, '').match(re) || []).length;
  }
  if (n) counts[f] = n;
  if (n > (BASELINE[f] || 0)) grew.push(`${f}: ${n} (was ${BASELINE[f] || 0})`);
}
ok(grew.length === 0, 'no file gains a visible "Sending…" / "Saving…"' + (grew.length ? ': ' + grew.join('; ') : ''));
const staffLeft = Object.keys(counts).filter(f => !(f in BASELINE));
ok(staffLeft.length === 0, 'every staff file is at zero; what is left is listed with its reason ' + JSON.stringify(counts));

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nno-sending-words: all checks passed');
