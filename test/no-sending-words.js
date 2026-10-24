'use strict';
/* no-sending-words.js -- round 7 (owner, 2026-10-24): a send never shows the words "Sending…" or "Saving…"; a small
 * spinner turns in their place (OPEN_REPAIRS 489). Source scan; the browser half is unread-badges-v2-browser.js (I).
 *
 *   - the shared spinner exists: svSpinHtml / svSpinButton in 040, the .sv-spin rule in 020 and its copy in the review
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
ok(/function svSpinHtml\(label\)/.test(s040) && /function svSpinButton\(btn, on, label\)/.test(s040), '040 has svSpinHtml and svSpinButton');
const fnStart = s040.indexOf('function svSpinHtml(');
const fnSrc = s040.slice(fnStart, s040.indexOf('\n    }', fnStart) + 6);
const svSpinHtml = new Function(fnSrc + '\nreturn svSpinHtml;')();
const html = svSpinHtml('Sending');
ok(/^<span class="sv-spin" role="status" aria-label="Sending"><\/span>$/.test(html), 'svSpinHtml is an empty ring with its label for screen readers only: ' + html);
ok(!/[<>"]/.test(svSpinHtml('a"<b>').replace(/^<span class="sv-spin" role="status" aria-label="/, '').replace(/"><\/span>$/, '')), 'svSpinHtml escapes its label');
ok(/\.sv-spin \{[^}]*animation: sv-spin-turn/.test(src('020-styles-surfaces.css.part')), '020 has the .sv-spin rule');
const s195 = src('195-review-stage.js.part');
ok(/\n\.sv-spin\{[^}]*animation:sv-spin-turn/.test(s195), 'the review stage (shadow root) carries its own copy of the rule');

// Each swept path: the spinner under the switch, before the old words.
const before = (text, a, b, label) => { const i = text.indexOf(a), j = text.indexOf(b, i); ok(i >= 0 && j > i, label); };
const s190 = src('190-calendar-approval-comments.js.part');
before(s190, "if (c._outbox === 'sending' && typeof svuActive === 'function' && svuActive()) return `<div class=\"sv-note-outbox is-sending\">${svSpinHtml('Sending')}</div>`;",
  "if (c._outbox === 'sending') return `<div class=\"sv-note-outbox is-sending\" role=\"status\">", '190: the note outbox line takes the spinner when the switch is on');
before(src('140-calendar-legacy-outbox.js.part'), "if (btn && typeof svuActive === 'function' && svuActive()) svSpinButton(btn, true, 'Sending');",
  "else if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }", '140: the urgent ping button takes the spinner when the switch is on');
ok(/spin: !!c\.sending && mode !== 'client' && typeof svuActive === 'function' && svuActive\(\)/.test(s195) && /\(t\.spin \? svSpinHtml\('Sending'\) : _re\(t\.time\)\)/.test(s195),
  '195: the conversation time is the spinner for the team and Kasper when the switch is on');
for (const f of ['330-kasper-review-history.js.part', '290-samples-writes-review.js.part']) {
  const s = src(f);
  ok(!/\$\{saving \? 'Saving…' : 'Approve'\}/.test(s) && /svuSpinOr\('Saving…', 'Saving'\)/.test(s), f.slice(0, 3) + ': Kasper\'s Approve takes the spinner when the switch is on');
}
const s327 = src('327-core-unread-badges.js.part');
ok(/function svuSpinOr\(words, label\) \{\s*try \{ if \(svuActive\(\)\) return svSpinHtml\(label \|\| 'Sending'\); \} catch \(e\) \{\}\s*return _calEsc\(words\);/.test(s327), '327 svuSpinOr: the spinner with the switch on, the escaped words otherwise');
const code327 = s327.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
ok(!/(['"`>])\s*(Sending|Saving)(…|\.\.\.)/.test(code327), '327 writes neither word');

// The ratchet. A visible literal: quote or ">" then the word then "…" or "...", outside a comment line.
const BASELINE = {
  '050-market-briefs.js.part': 1, '060-templates-filming.js.part': 5, '072-workload-calm.js.part': 1, '090-workload-popovers.js.part': 1,
  '110-time-off.js.part': 1, '140-calendar-legacy-outbox.js.part': 1, '160-calendar-organize-ui.js.part': 1, '170-calendar-links-status.js.part': 1,
  '180-calendar-native-post-media.js.part': 3, '185-client-review-queue.js.part': 3, '190-calendar-approval-comments.js.part': 6,
  '195-review-stage.js.part': 4, '200-intake-data-startup.js.part': 1, '230-production-create-comments.js.part': 3,
  '240-production-description.js.part': 2, '280-samples-cards-notes.js.part': 3, '290-samples-writes-review.js.part': 2,
  '310-sales-intake-hiring.js.part': 2, '323-kasper-dashboard-tail.js.part': 3, '324-client-onboarding-panel.js.part': 2,
  '330-kasper-review-history.js.part': 4,
};
const re = /(['"`>])\s*(Sending|Saving)(…|\.\.\.)/g;
const grew = [];
for (const f of fs.readdirSync(path.join(root, 'src/index')).filter(f => /\.(js|html)\.part$/.test(f))) {
  let n = 0;
  for (const line of src(f).split('\n')) {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;
    n += (line.match(re) || []).length;
  }
  if (n > (BASELINE[f] || 0)) grew.push(`${f}: ${n} (was ${BASELINE[f] || 0})`);
}
ok(grew.length === 0, 'no file gains a visible "Sending…" / "Saving…"' + (grew.length ? ': ' + grew.join('; ') : ''));

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nno-sending-words: all checks passed');
