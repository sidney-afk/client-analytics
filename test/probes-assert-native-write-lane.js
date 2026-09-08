'use strict';
/*
 * THE NIGHTLY MUST ASSERT THE LANE PRODUCTION TAKES, NOT THE ONE IT LEFT.
 *
 * `test/qa-harness-routes-like-production.js` proved the harnesses ROUTE like
 * production. This proves the three probes that watch a write ASSERT like
 * production, and that the fixture standing behind them produces the shapes the
 * shipped code actually consumes.
 *
 * The defect it exists for: p28/p29/p30 waited for calls to `linear-set-status`
 * and `linear-add-comment` and passed when they arrived. Both teams have been
 * SyncView-authoritative since 2026-08-28 and all 43 active clients are
 * enrolled, so those webhooks are not a lane a real status change or comment
 * takes. Once the roster fixture put the TEST client on the production lane,
 * those three probes were left asserting retired traffic — a green nightly
 * describing a dead world, one layer below the one already repaired.
 *
 * WHY THIS SUITE EXISTS AT ALL, rather than "just run the probes": the probes
 * need a browser with a route to the live backend. This runs offline in
 * `npm test`, on every pull request, which is where a claim about what the
 * nightly asserts can be checked cheaply and often. It does not replace running
 * them.
 *
 * Everything below EXECUTES: the fixture's real route handlers are driven
 * through a stand-in for Playwright's routing API, and the predicates are
 * lifted out of `index.html` rather than restated.
 *
 * Only slugs and synthetic ids appear here. The repository is public.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const NW = require(path.join(ROOT, 'qa', 'native_work_item_fixture.js'));
// The house stripper, never a hand-rolled one (OPEN_REPAIRS 145).
const { stripComments } = require(path.join(ROOT, 'test', 'helpers', 'strip-comments.js'));

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Same brace-matching lift the sibling suites use. */
function grabFunc(name) {
  const at = INDEX.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
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
    else if (c === '}') { depth--; if (!depth) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced function: ' + name);
}

const PROBES = ['p28_linear_sync.js', 'p29_linear_kasper.js', 'p30_linear_client.js', 'p36_full_sync.js', 'p60_modal_smm.js'];
const PROBE_SRC = PROBES.map(name => [name, fs.readFileSync(path.join(ROOT, 'qa', 'probes', name), 'utf8')]);

/* Every probe the nightly actually gates on. The manifest is the list whose red stops the
   run, so it is the list this suite polices. */
const MANIFEST = fs.readFileSync(path.join(ROOT, 'qa', 'probes', 'nightly-manifest.txt'), 'utf8')
  .split('\n').map(l => l.replace(/#.*$/, '').trim()).filter(Boolean)
  .map(n => (n.endsWith('.js') ? n : n + '.js'))
  .filter(n => fs.existsSync(path.join(ROOT, 'qa', 'probes', n)));
const MANIFEST_SRC = MANIFEST.map(name => [name, fs.readFileSync(path.join(ROOT, 'qa', 'probes', name), 'utf8')]);

/* ---- 1. NO PROBE STILL WAITS FOR THE RETIRED WEBHOOKS -------------------- */
/* The captures may still EXIST — a probe that does not watch those URLs cannot
   prove nothing went to them — but nothing may be asserted PRESENT on them. */

for (const [name, src] of PROBE_SRC) {
  ok(/captureRetiredWebhooks/.test(src),
    name + ' still watches the retired webhooks, which is how it can prove nothing reached them');
  ok(/NW\.retiredCallCount\([^)]*\) === 0/.test(src),
    name + ' asserts ZERO traffic to linear-set-status and linear-add-comment');
  ok(/native_work_item_fixture/.test(src),
    name + ' seeds a native work item, so its cards are shaped like production cards');
  ok(/statusCalls\(|commentCalls\(/.test(src),
    name + ' asserts on native gateway intents');
}

/* ---- 1b. NO MANIFEST PROBE MAY HAND-ROLL THE RETIRED WEBHOOKS ------------ */
/* THE ROOT-CAUSE GUARD, and the reason this section exists at all.

   Fixing p28/p29/p30 was not enough: `p36_full_sync.js` and `p60_modal_smm.js` had been
   given the production roster by the same change and still waited for `linear-set-status` /
   `linear-add-comment`, so two more manifest-gated nightlies were left asserting a lane the
   product does not take. Caught by review, not by a test — twice on this PR, which is once
   too many for the same class.

   So the rule is structural rather than per-probe: ONE module owns those two URLs
   (`qa/native_work_item_fixture.js`), and the only thing it lets a probe do with them is
   COUNT them. A probe that wants to assert one received something has to hand-roll a route,
   and hand-rolled routes are what this checks for. Same shape as the house rule that a test
   may not hand-roll a comment stripper (OPEN_REPAIRS 145).

   Prose that NAMES the webhooks is fine and wanted — every migrated probe explains what it
   used to assert. What is forbidden is registering a route for one. */

const RETIRED_URLS = /linear-(?:set-status|add-comment)/;
for (const [name, src] of MANIFEST_SRC) {
  const routed = src.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /\broute\s*\(/.test(line) && RETIRED_URLS.test(line));
  ok(routed.length === 0,
    name + ' registers no route of its own for the retired webhooks'
    + (routed.length ? ' (line ' + routed.map(([i]) => i).join(', ') + ')' : ''));
}

/* And any manifest probe that watches them at all asserts the SAME zero, in the same shape,
   so this guard checks a contract rather than pattern-matching each probe's prose. */
for (const [name, src] of MANIFEST_SRC) {
  if (!/captureRetiredWebhooks/.test(src)) continue;
  ok(/NW\.retiredCallCount\([^)]*\) === 0/.test(src),
    name + ' asserts NW.retiredCallCount(...) === 0 — the one shape every probe on the '
    + 'production roster uses for "nothing reached the retired lane"');
}

/* The counter itself, executed: a guard that trusted a helper it never ran would be the
   same mistake one level up. */
ok(NW.retiredCallCount({ setStatus: [], addComment: [] }) === 0
  && NW.retiredCallCount({ setStatus: [{}], addComment: [] }) === 1
  && NW.retiredCallCount([{ setStatus: [{}], addComment: [{}] }, { setStatus: [{}], addComment: [] }]) === 3
  && NW.retiredCallCount([]) === 0,
  'NW.retiredCallCount counts one capture, an array of captures, and an empty list correctly');

/* ---- 1c. THE LANES OUTSIDE THE MANIFEST, NAMED RATHER THAN GUESSED ------- */
/* Section 1b polices the probes whose red stops the nightly. It is not the whole
   population: other harnesses reach the same production roster (through
   `qa/sxr_courier_lib.js` and `qa/golden_lib.js`) and still assert that a retired webhook
   RECEIVED something. Those are affected by the same change and are NOT migrated in this
   PR — several drive client surfaces that need a live review token, or the ef-writepath
   harness, neither of which this work could run or verify.

   Saying "94 probes are unaudited" was the honest answer before the audit and is the lazy
   one after it. This is the audited list, and the test fails if it changes in either
   direction: a new file joining it must be a deliberate act, and a file leaving it (because
   somebody migrated it) must delete its line here. That is what stops this from being
   forgotten, which is the actual risk — not that the list is long.

   Polarity is recorded per entry: `present` asserts a webhook was called (affected, owed),
   `zero` asserts none was (already correct under the native lane, and strengthened by it).
   Only `present` entries are work. Tracked in OPEN_REPAIRS 175. */

/* Each entry carries a WITNESS: an exact substring from that file which demonstrates the
   declared polarity. Codex finding on cfe251d — the first version stored the polarity and
   then reduced the map with `Object.keys`, so the values were never checked and a file that
   flipped from asserting a push to asserting zero (or back) would keep its stale label while
   this guard stayed green. That is the exact drift the tracked list exists to catch, so the
   label is now an assertion rather than a comment.

   Deliberately a pinned quotation and not a classifier: a regex that tried to decide polarity
   by itself would be a second thing to get wrong. If someone rewrites one of these
   assertions the witness disappears, the test fails, and the entry has to be re-read and
   re-classified by a human — which is the outcome worth having. */
const OUTSIDE_MANIFEST = {
  // present = asserts a retired webhook WAS called. Still owed a real migration to native
  // intents — AND, since d6e26c3, each must opt into the EXPLICIT legacy roster, because the
  // shared route now serves production by default and these lanes are not written for it.
  // Codex finding on d6e26c3: recording them as owed does not keep the harness honest in the
  // meantime. `legacyOptIn` names the token that proves the opt-in, checked below.
  'qa/scenarios.js': {
    polarity: 'present',
    witness: "['expectLinear', 'linear-set-status'",
    // No opt-in of its own: it is DATA, executed by qa/scenario_engine.js, which opts in.
    legacyOptIn: null
  },
  'qa/scenario_engine.js': {
    polarity: 'present',
    witness: "if (verb === 'expectLinear') {",
    // Per SCENARIO, not per file: only the 4 of 84 that assert on the retired lane.
    // Section 1d drives the selector over the real scenario data.
    legacyOptIn: 'scenarioLaneIsLegacy(scn)'
  },
  'qa/probes/ot4_t0_client_edge_conditions.js': {
    polarity: 'present',
    witness: 'matchingNotifications(issueUrl, submittedBody).length > 0',
    // NOT legacy-pinned. Codex on 638ff37: the Tier-0 P4 block is a production-behaviour
    // contract, so pinning it to legacy would let a native regression ship behind a green
    // probe. It stays on the production roster and is EXPECTED RED until migrated — loud
    // beats wrong. The marker below has to be present so the state is declared in the file.
    expectedRed: 'EXPECTED RED UNTIL MIGRATED'
  },
  'qa/probes/sxr_kasper_audit_holes.js': {
    polarity: 'present',
    witness: "pushed = linearCalls().some(c => c.path === 'linear-set-status'",
    // NOT legacy-pinned, same reason: its contract is approve/undo persistence, which is
    // production behaviour. EXPECTED RED until migrated.
    expectedRed: 'EXPECTED RED UNTIL MIGRATED'
  },
  'qa/probes/cal_linear_deep.js': {
    polarity: 'present',
    witness: "pushed = pushes('Client Approval').length > 0",
    legacyOptIn: "writeUiRerouteLegacy: true"
  },
  'qa/probes/sxr_linear_deep.js': {
    polarity: 'present',
    witness: "pushed = pushes('Client Approval').length > 0",
    legacyOptIn: "writeUiRerouteLegacy: true"
  },
  'qa/ef-writepath/10-status-linear.js': {
    polarity: 'present',
    witness: 's.ok(toExpect.length >= 1,',
    legacyOptIn: "EF_WRITEPATH_LEGACY_ROSTER = '1'"
  },
  'qa/ef-writepath/12-samples.js': {
    polarity: 'present',
    witness: 's.ok(toExpect.length >= 1,',
    legacyOptIn: "EF_WRITEPATH_LEGACY_ROSTER = '1'"
  },
  // zero = already asserts no push reached them; correct as it stands under the native lane.
  'qa/ef-writepath/13-settings.js': {
    polarity: 'zero',
    witness: 's.ok(pushes.length === 0,'
  },
  // plumbing = routes or records the webhooks but asserts nothing about them. Checked by
  // absence rather than by a witness: no assertion line in the file may mention them.
  'qa/ef-writepath/lib.js': { polarity: 'plumbing' },
  'qa/sxr_courier_lib.js': { polarity: 'plumbing' },
  // deliberate-legacy = records legacy queue writes ON PURPOSE. The fully synthetic boot
  // harness pins the legacy world because its subject is the resume lease and the BFCache
  // stale release, not routing, and the writes it records are the outbox drain's, which
  // OPEN_REPAIRS 175 pinned as NOT flipped. The second condition is what makes that claim
  // checkable: it must NOT serve the shared production roster fixture.
  'qa/boot/client-entry-sequence.js': {
    polarity: 'deliberate-legacy',
    witness: 'state.legacyQueueWrites.push('
  }
};

/* WALK THE WHOLE TREE, not a list of directories somebody remembered.
   The first version of this scan hard-coded `qa`, `qa/probes` and `qa/ef-writepath` and
   therefore missed `qa/boot/client-entry-sequence.js` entirely — a guard that only looks
   where its author looked, which is the same defect one level up from the one this file
   exists to prevent. */
function walkJs(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { walkJs(abs, out); continue; }
    if (entry.isFile() && entry.name.endsWith('.js')) out.push(abs);
  }
  return out;
}
const scanned = [];
for (const abs of walkJs(path.join(ROOT, 'qa'), [])) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  if (rel === 'qa/native_work_item_fixture.js' || rel === 'qa/write_ui_reroute_fixture.js') continue;
  if (rel.startsWith('qa/probes/') && MANIFEST.includes(path.basename(rel))) continue;
  const src = fs.readFileSync(abs, 'utf8');
  if (/linear-set-status|linear-add-comment|linearCalls\s*\(/.test(src)) scanned.push(rel);
}
const tracked = Object.keys(OUTSIDE_MANIFEST).sort();
const found = scanned.sort();
ok(JSON.stringify(found) === JSON.stringify(tracked),
  'the audited set of non-manifest lanes still touching the retired webhooks is exactly the '
  + 'tracked list — untracked: ' + JSON.stringify(found.filter(f => !tracked.includes(f)))
  + ', gone: ' + JSON.stringify(tracked.filter(f => !found.includes(f))));

/* And each entry's DECLARED POLARITY is checked against the file, not merely recorded. */

/* WHOLE ASSERTION CALLS, NOT SINGLE LINES.
   Codex finding on 279222a, and the FOURTH instance on this PR of one pattern: a guard that
   only looks where its author looked. The first version of the plumbing check required the
   assertion opener and the webhook reference to sit on the SAME physical line, and its
   `assert` alternative did not match `assert.equal(...)`. So

       s.ok(
         linearCalls().length === 0, 'no push');

   satisfied neither regex on any one line, and the file kept its assertion-free label — the
   exact drift the polarity guard exists to catch, reintroduced inside the guard itself.

   So: strip comments with the house stripper (never a hand-rolled one, OPEN_REPAIRS 145),
   find every assertion opener including receiver forms and `assert.<method>`, and take the
   BALANCED parenthesised argument span across line boundaries. A regex literal holding an
   unbalanced paren could mis-slice a span; that direction produces a false POSITIVE, which is
   loud and forces a human to look, rather than the silent pass this replaces. */
const ASSERT_OPENER = /(?:^|[^\w$.])(?:assert(?:\.[A-Za-z_$][\w$]*)?|expect|(?:[A-Za-z_$][\w$]*\.)?(?:ok|t|note))\s*\(/g;

/* A `/` starts a REGEX LITERAL only where a value may begin. Without this the paren matcher
   counts the parens inside `/\(/` and the span never closes — which the first version of this
   scanner then SKIPPED, silently. I claimed on the PR that a mis-sliced span "fails loud";
   it did not, it failed silent, and that was the fifth instance on this PR of the same
   pattern. Both halves are fixed: regex literals are inert here, and an unclosed span is
   REPORTED rather than dropped (see `assertionSpans`).

   The rule is deliberately conservative and, per the house lesson in
   `test/helpers/strip-comments.js`, it does not have to be perfect — it has to fail in the
   loud direction. Anything it gets wrong now surfaces as an unclosed span or an over-wide
   span, both of which a human sees. */
const VALUE_MAY_BEGIN = /[([{,;:=!&|?+\-*%~^<>]|\b(?:return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/;

function assertionSpans(src, onUnclosed) {
  const code = stripComments(src);
  const spans = [];
  ASSERT_OPENER.lastIndex = 0;
  let m;
  while ((m = ASSERT_OPENER.exec(code)) !== null) {
    const open = code.indexOf('(', m.index + (m[0].startsWith('(') ? 0 : m[0].length - 1));
    if (open < 0) continue;
    let depth = 0, quote = '', escaped = false, end = -1;
    for (let j = open; j < code.length; j++) {
      const c = code[j];
      if (quote) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '/') {
        // Regex literal, or a division? Look back at the last significant character.
        const before = code.slice(Math.max(0, j - 24), j).replace(/\s+$/, '');
        if (VALUE_MAY_BEGIN.test(before) || before === '') {
          let k = j + 1, esc = false, cls = false;
          for (; k < code.length; k++) {
            const r = code[k];
            if (esc) { esc = false; continue; }
            if (r === '\\') { esc = true; continue; }
            if (r === '[') { cls = true; continue; }
            if (r === ']') { cls = false; continue; }
            if (r === '\n') break;              // not a regex after all
            if (r === '/' && !cls) { j = k; break; }
          }
          continue;
        }
      }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (!depth) { end = j; break; } }
    }
    if (end < 0) {
      // NEVER a silent skip. An assertion this scanner cannot delimit is exactly the case it
      // would otherwise miss, so it is surfaced to the caller and counted as suspect.
      if (typeof onUnclosed === 'function') onUnclosed(code.slice(open, Math.min(code.length, open + 160)));
      spans.push(code.slice(open, Math.min(code.length, open + 400)));
      ASSERT_OPENER.lastIndex = open + 1;
      continue;
    }
    spans.push(code.slice(open, end + 1));
    ASSERT_OPENER.lastIndex = end;
  }
  return spans;
}

/* The page-open helpers every courier-backed lane uses. An enumeration again — so it is
   exercised below against the files it is applied to rather than assumed complete, and a
   lane that opens pages some other way simply has no sites to check rather than silently
   passing a check that looked at nothing. */
const PAGE_OPENER = /(?:^|[^\w$.])(?:smmCal|smm|kasperCal|kasper|clientCal|client)\s*\(\s*(?:browser|b)\b/g;

function openerSpans(src) {
  const code = stripComments(src);
  const out = [];
  PAGE_OPENER.lastIndex = 0;
  let m;
  while ((m = PAGE_OPENER.exec(code)) !== null) {
    const open = code.indexOf('(', m.index);
    if (open < 0) continue;
    let depth = 0, quote = '', escaped = false, end = -1;
    for (let j = open; j < code.length; j++) {
      const c = code[j];
      if (quote) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (!depth) { end = j; break; } }
    }
    if (end < 0) continue;
    out.push({ text: code.slice(m.index, end + 1) });
    PAGE_OPENER.lastIndex = end;
  }
  return out;
}

/* Driven before it is trusted, like the assertion scanner. */
ok(openerSpans("const p = await client(browser);").length === 1,
  'the opener scanner sees a bare client(browser) call — the shape that slipped through the '
  + 'token-exists check');
ok(openerSpans("const p = await client(browser, undefined, undefined, { writeUiRerouteLegacy: true });")
  .every(sp => /writeUiRerouteLegacy/.test(sp.text)),
  '  · and reads the options object of a wired one, across its whole balanced span');
ok(openerSpans("const p = await client(browser, undefined, undefined, {\n  viewport: { width: 390 },\n  writeUiRerouteLegacy: true\n});")
  .every(sp => /writeUiRerouteLegacy/.test(sp.text)),
  '  · including a multiline options object with nested braces');

const RETIRED_REF = /linear-set-status|linear-add-comment|linearCalls\s*\(/;

/* The scanner is proved on the two shapes the old one missed BEFORE it is trusted on a real
   file. A guard whose own detector is untested is what produced this finding. */
ok(assertionSpans("s.ok(\n  linearCalls().length === 0,\n  'no push');").some(x => RETIRED_REF.test(x)),
  'the plumbing scanner sees a MULTILINE assertion (the shape the line-based check missed)');
ok(assertionSpans('assert.equal(linearCalls().length, 0);').some(x => RETIRED_REF.test(x)),
  'and an assert.<method>() form (the other shape it missed)');
ok(!assertionSpans('const calls = linearCalls();\nok(calls.length >= 0, "unrelated");')
  .some(x => RETIRED_REF.test(x)),
  '  · CONTROL: a bare linearCalls() OUTSIDE any assertion is not flagged, so the scanner is '
  + 'not simply matching the whole file');
/* The fifth instance, pinned. A regex literal holding an unbalanced paren used to make the
   span never close, and the scanner then dropped it without a word — a silent miss in the
   very check written to end silent misses. */
ok(assertionSpans("ok(/\\(/.test(linearCalls()), 'x');").some(x => RETIRED_REF.test(x)),
  'a regex literal with an unbalanced OPEN paren inside an assertion is still seen');
ok(assertionSpans("ok(/\\)/.test(linearCalls()), 'x');").some(x => RETIRED_REF.test(x)),
  'and one with an unbalanced CLOSE paren');
/* Codex's own example from the d6e26c3 review, kept verbatim: the regex closing paren comes
   FIRST and the retired-lane reference AFTER it, so a scanner that ended the span at the
   regex would return only `(/)` and pass. It was already handled by 0124e8d; it is pinned
   here because the review asked for it and because the next edit to this matcher should have
   to keep it working. */
ok(assertionSpans("s.ok(/)/.test(value) && linearCalls().length === 0, 'no push')")
  .some(x => RETIRED_REF.test(x)),
  "Codex's example: a regex CLOSING paren before the reference does not truncate the span");
ok(assertionSpans("s.ok(\n  /)/.test(v) &&\n  linearCalls().length === 0,\n  'no push');")
  .some(x => RETIRED_REF.test(x)),
  '  · and the same shape spread across lines');
ok(assertionSpans("t.ok(linearCalls().length === 0, 'x');").some(x => RETIRED_REF.test(x))
  && assertionSpans('expect(linearCalls().length).to.equal(0);').some(x => RETIRED_REF.test(x)),
  'receiver-form and expect() assertions are seen too — the opener list is an enumeration, '
  + 'so it is exercised rather than assumed');
for (const [rel, entry] of Object.entries(OUTSIDE_MANIFEST).sort()) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) { ok(false, rel + ' is tracked but does not exist'); continue; }
  const src = fs.readFileSync(abs, 'utf8');
  if (entry.polarity === 'plumbing') {
    const unclosed = [];
    const asserts = assertionSpans(src, x => unclosed.push(x)).filter(span => RETIRED_REF.test(span));
    ok(unclosed.length === 0,
      rel + ' has no assertion this scanner cannot delimit — an undelimitable one is reported '
      + 'rather than skipped' + (unclosed.length ? ': ' + JSON.stringify(unclosed[0].slice(0, 100)) : ''));
    ok(asserts.length === 0,
      rel + ' is still plumbing: it routes or records the retired webhooks and asserts nothing '
      + 'about them' + (asserts.length ? ' — found ' + asserts.length + ', first: '
        + JSON.stringify(asserts[0].replace(/\s+/g, ' ').slice(0, 120)) : ''));
    continue;
  }
  ok(src.includes(entry.witness),
    rel + ' still matches its recorded polarity `' + entry.polarity + '` — witness `'
    + entry.witness + '` is present');
  if (entry.legacyOptIn) {
    ok(src.includes(entry.legacyOptIn),
      '  · and it OPTS IN to the explicit legacy roster (`' + entry.legacyOptIn + '`) — the '
      + 'shared route serves production by default, and a lane asserting a retired push is not '
      + 'written for that');
    /* EVERY page-open site, not just one somewhere in the file.
       The sixth instance of this PR's pattern, and I found it in my own wiring by applying
       the rule rather than trusting it: the check above only asked whether the token appears
       ANYWHERE, so `ot4_t0_client_edge_conditions.js` passed with four of its seven client
       openers wired and three left on the production roster. A token-exists check is exactly
       "a guard as wide as the place its author looked". Each opener's balanced call span must
       carry the option. */
    const openers = openerSpans(src).filter(sp => !/writeUiRerouteLegacy/.test(sp.text));
    ok(openers.length === 0,
      '  · and EVERY page-open site in it carries the option, not merely one'
      + (openers.length ? ' — ' + openers.length + ' without it, first: '
        + JSON.stringify(openers[0].text.replace(/\s+/g, ' ').slice(0, 90)) : ''));
  }
  if (entry.expectedRed) {
    ok(src.includes(entry.expectedRed),
      '  · and it DECLARES itself expected-red pending migration, in the file, so the next '
      + 'reader is not left to infer why a scheduled probe fails');
    ok(!/writeUiRerouteLegacy/.test(src),
      '  · and it is NOT pinned to the legacy roster — a production-behaviour contract pinned '
      + 'to legacy passes wrongly, which is worse than failing loudly');
  }
  if (entry.polarity === 'deliberate-legacy') {
    ok(!/write_ui_reroute_fixture/.test(src),
      '  · and it is legacy DELIBERATELY: it serves its own flag rows and never the shared '
      + 'production roster fixture, which is what keeps it out of the affected set');
  }
}

/* ---- 1d. THE SCENARIO DSL PICKS ITS LANE PER SCENARIO -------------------- */
/* Codex on 638ff37: the first version of the legacy wiring opened every scenario's actors
   on the legacy roster because the DSL HAS an `expectLinear` verb. Only 4 of the 84 base
   scenarios use it, so 80 ordinary approve/request/comment journeys — and every compiled
   tree path — stopped exercising the route production clients take. Green coverage that no
   longer covers the shipped lane is this PR's own defect, one level up.

   Driven against the REAL scenario data rather than asserted about: the selector is imported
   and run over `qa/scenarios.js`'s actual output, so a future scenario that starts asserting
   on the retired lane is counted, and one that stops is too. */
/* `qa/scenario_lane.js`, NOT `qa/scenario_engine.js`. The engine requires the courier
   harness, which resolves Playwright, shells out to curl and creates a temp directory at
   module load — every one of those a way for this offline suite to fail for a reason that has
   nothing to do with what it checks. The rule lives in a dependency-free module so this can
   test it directly; the engine re-exports it for its own callers. */
/* AND NO SUITE HERE MAY REQUIRE THE BROWSER HARNESS.
   This is why: the first version of section 1d required `qa/scenario_engine.js`, which pulls
   `qa/sxr_courier_lib.js`, whose Playwright resolution is
   `try { require('playwright') } catch { require('/opt/node22/lib/node_modules/playwright') }`.
   The `unit` CI job runs `node test/run-all.js` with NO `npm install`, so the first branch
   fails and the fallback names a path that exists only inside the agent container — it throws
   on a GitHub runner. The suite passed locally for exactly the reason it failed in CI: this
   sandbox is the one environment where that hardcoded path exists.
   A guard that only works where its author ran it. Same shape as the six before it, one layer
   further out — in the test harness rather than in a detector.
   Pinned so no future edit reintroduces it. */
const SELF = fs.readFileSync(__filename, 'utf8');
ok(!/require\([^)]*scenario_engine\.js|require\([^)]*sxr_courier_lib\.js|require\([^)]*golden_lib\.js|require\([^)]*probes[\/\\]lib\.js/.test(SELF),
  'this offline suite requires no browser-harness module — the `unit` job installs no '
  + 'dependencies, and those modules resolve Playwright through a container-only fallback path');

const ENGINE = require(path.join(ROOT, 'qa', 'scenario_lane.js'));
const SCENARIOS = require(path.join(ROOT, 'qa', 'scenarios.js'));

const allScenarios = SCENARIOS.base();
const legacyScenarios = allScenarios.filter(ENGINE.scenarioUsesLegacyLane);
ok(allScenarios.length > 50,
  'the scenario set loads and is the real one (' + allScenarios.length + ' base scenarios)');
ok(legacyScenarios.length > 0 && legacyScenarios.length < allScenarios.length / 4,
  'the RULE marks only the scenarios that actually assert on the retired lane — '
  + legacyScenarios.length + ' of ' + allScenarios.length + ', not all of them');

/* THE RULE IS NOT YET WHAT THE ENGINE ASKS FOR, and that gap is the point.
   Codex on a1b6d60: applying the rule put the other 80 scenarios on the production roster,
   but the scenario harness seeds only fake `linear_issue_id` values — no native work items,
   no gateway capture, no verified staff identity (grep `scenario_engine.js` for any of the
   three: zero). Every native action would refuse with `native_link_required` or
   `credentials_required` BEFORE the journey under test ran, turning the whole samples
   nightly red. Right rule, applied a step too early.
   So the engine asks `scenarioLaneIsLegacy`, which is the rule OR the harness limit, and the
   limit is a named constant rather than something baked into the predicate — a predicate
   that returned "legacy" for both reasons would quietly lie about which one applied. */
/* ASSERT THE PAIRING, NOT TODAY'S VALUE.
   The first version of this block pinned the current state — constant `false`, every scenario
   legacy, engine carrying no seeding — and I described it in the PR as "flipping the constant
   is the whole migration switch". That was FALSE: flipping it would have turned three of
   these red, so the migration would have had to rewrite the guard, and a guard that goes red
   on the change it exists to enable is one somebody deletes rather than fixes.

   Eighth instance of this PR's pattern, and a different flavour of it: not a guard too narrow
   in where it looked, but a guard asserting a STATE where the invariant was the thing worth
   holding. Found by driving it rather than trusting it, in the check I had just told the
   reviewer was the one most worth challenging.

   The invariant, in both directions: the constant may be `true` ONLY if the engine really has
   the three capabilities, and while it is `false` every scenario runs legacy. Now the flip is
   legal exactly when it is honest, and this block goes green on the migration instead of
   standing in front of it. */
const engineSrc = fs.readFileSync(path.join(ROOT, 'qa', 'scenario_engine.js'), 'utf8');
/* THE CAPABILITY GREP IS GONE, AND THAT IS THE POINT.
 *
 * It read `engineHasNativeSeeding` off three raw token matches in the engine source. Codex
 * named two holes (a token in a comment, an import, or dead code satisfies it; and the
 * implication ran only one way, so a migration that added the capability and forgot the flip
 * left every scenario silently on the retired lane). Both are correct, and the first one I had
 * already DEMONSTRATED without noticing: the "honest migration passes" proof I published for
 * this check added the three names in a COMMENT. I offered prose as evidence that the check
 * could not be satisfied by prose.
 *
 * This is the fifth finding in this file about a source-scanning guard, and sharpening the
 * scanner a fifth time is the wrong move — the class of claim is what is wrong. Whether the
 * scenario harness can drive the native lane is a property of RUNNING it: it depends on the
 * fixtures being installed on the right contexts, the gateway answering, and a staff identity
 * being verified at the moment of the write. No amount of reading the file decides that, and a
 * check that pretends otherwise is worse than none, because the next person trusts it.
 *
 * So the suite no longer claims to police the flip. What it still checks is what it can
 * DECIDE, and those checks are executed rather than scanned:
 *   · while the constant is false, every scenario really does route legacy;
 *   · once it is true, the rule really does govern, and exactly the scenarios asserting on the
 *     retired lane go there;
 *   · the rule and the limit stay separate predicates, so which one applied is never
 *     ambiguous.
 * The FLIP is gated by running the scenario lane and recording the result in OPEN_REPAIRS 175
 * — by evidence from an execution, which is the only thing that can establish it. */

ok(typeof ENGINE.SCENARIO_HARNESS_CAN_DRIVE_NATIVE === 'boolean',
  'the harness limit is a single named constant, so the migration switch is one edit');
ok(ENGINE.SCENARIO_HARNESS_CAN_DRIVE_NATIVE || allScenarios.every(scn => ENGINE.scenarioLaneIsLegacy(scn)),
  'while the limit stands, EVERY scenario routes legacy — decided by running the predicate '
  + 'over the real scenario set, not by reading the engine');
ok(!ENGINE.SCENARIO_HARNESS_CAN_DRIVE_NATIVE
  || allScenarios.filter(scn => ENGINE.scenarioLaneIsLegacy(scn)).length === legacyScenarios.length,
  '  · and once it is lifted the RULE governs, putting exactly the scenarios that assert on '
  + 'the retired lane there and no others');
/* Comment-stripped AND spelled in halves, because this line kept matching itself: first the
   paragraph above that names the deleted grep (a check fooled by its own prose is the very
   hole this deletion is about — it happened on the first run), and then its own regex literal,
   which contained the identifier it was searching for. Both were caught by running it. */
const DELETED_GREP = 'engineHas' + 'NativeSeeding';
ok(!stripComments(SELF).includes(DELETED_GREP),
  '  · and this suite makes NO claim about whether the harness can drive native — that is a '
  + 'property of running it, and the grep that pretended to decide it is deliberately gone');
ok(ENGINE.scenarioLaneIsLegacy !== ENGINE.scenarioUsesLegacyLane,
  '  · the RULE stays separate from the LIMIT, so which of the two put a scenario on the '
  + 'legacy lane is never ambiguous');
ok(/scenarioLaneIsLegacy\(scn\)/.test(engineSrc),
  '  · and the engine asks the combined question, not the rule alone');
/* Reported, not asserted: context for whoever reads a failure here. Only the constant is
   printed now — the capability half was a grep that could not tell code from prose. */
console.log('      (today: SCENARIO_HARNESS_CAN_DRIVE_NATIVE = '
  + ENGINE.SCENARIO_HARNESS_CAN_DRIVE_NATIVE + ')');
for (const scn of legacyScenarios) {
  ok(/expectLinear|expectNoLinear/.test(JSON.stringify(scn.steps || scn)),
    '  · every scenario it puts on the legacy lane really does carry a Linear assertion');
}
const nativeScenarios = allScenarios.filter(scn => !ENGINE.scenarioUsesLegacyLane(scn));
ok(nativeScenarios.every(scn => !/expectLinear|expectNoLinear/.test(JSON.stringify(scn.steps || scn))),
  '  · and every scenario left on the PRODUCTION lane carries none, so no Linear assertion is '
  + 'silently run against the native route');
/* THE COMPILED TREE IS A SECOND POPULATION, and pinning only the base scenarios would be
   the same narrowness this file keeps catching: `qa/scenario_tree.js` compiles to the same
   `{ key, title, seed, steps, shots }` shape `runScenario` takes, and Codex's finding named
   "every compiled tree path" explicitly. Driven over the real compiled output. */
const TREE = require(path.join(ROOT, 'qa', 'scenario_tree.js'));
/* `base()`, NOT `compile(samplesReviewTree())`. Codex on eab1eef: the `--tree` runner consumes
   `scenario_tree.base()`, which expands the video AND graphic trees into 24 real paths, while
   `compile(samplesReviewTree())` returns 12 synthetic ones with no component. I had printed
   "24" from `base()` earlier in this same work and then wrote the check against the other
   function — a guard driven over a population of its author's choosing rather than the one
   the runner uses, which is this PR's pattern with a different hat on. */
const treePaths = TREE.base();
const treeLegacy = treePaths.filter(ENGINE.scenarioUsesLegacyLane);
const treeWithVerb = treePaths.filter(p => /expectLinear|expectNoLinear/.test(JSON.stringify(p.steps || [])));
ok(treePaths.length > 0,
  'the compiled scenario tree is the population the --tree runner consumes ('
  + treePaths.length + ' paths, video and graphic)');
ok(treeLegacy.length === treeWithVerb.length,
  'the selector agrees with reality on every compiled TREE path too — ' + treeLegacy.length
  + ' selected, ' + treeWithVerb.length + ' actually carrying a Linear verb');
ok(treeLegacy.length < treePaths.length,
  '  · and not every path is forced onto the retired lane, which is what the blanket wiring '
  + 'did to all of them');

ok(/require\('\.\/scenario_lane\.js'\)/.test(fs.readFileSync(path.join(ROOT, 'qa', 'scenario_engine.js'), 'utf8')),
  'and the ENGINE takes the rule from that same module rather than keeping its own copy, so '
  + 'what this suite proves is what the engine runs');
ok(ENGINE.scenarioUsesLegacyLane({ steps: [] }) === false
  && ENGINE.scenarioUsesLegacyLane(undefined) === false,
  '  · CONTROL: a scenario with no steps, and no scenario at all, default to PRODUCTION — a '
  + 'lane that forgets to declare itself gets the one real clients take');

/* ---- 1e. A MODULE MUST EXPORT WHAT IT ACTUALLY HAS ----------------------- */
/* Codex P1 on eab1eef, and the ninth instance: fixing #7 created it. Moving the lane rule out
   of `qa/scenario_engine.js` left its `module.exports = { scenarioUsesLegacyLane, runScenario }`
   naming an identifier the file no longer had in scope, so requiring it threw
   `ReferenceError: scenarioUsesLegacyLane is not defined` — the scenario and tree nightly
   lanes could not start at all. This suite did not catch it because #7's fix was to stop
   requiring the engine, which removed it from the only module graph that would have noticed.
   One coupling traded for one blind spot.

   It cannot be caught by LOADING the engine here: that is exactly what turned CI red, since
   the `unit` job has no `node_modules` and the harness underneath resolves Playwright through
   a container-only path. So the contract is checked STATICALLY — every shorthand name in a
   `module.exports` object must be declared or destructured somewhere in that same file. That
   is weaker than a load, and it is what is available; it would have caught this exact bug. */
function exportedNamesAreDefined(rel) {
  const src = stripComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const m = src.match(/module\.exports\s*=\s*\{([\s\S]*?)\}/);
  if (!m) return { rel, missing: [], names: [] };
  const names = m[1].split(',')
    .map(part => part.split(':')[0].trim())
    .filter(n => /^[A-Za-z_$][\w$]*$/.test(n));
  const missing = names.filter(n => {
    const decl = new RegExp('(?:function|const|let|var|class)\\s+' + n + '\\b');
    const destructured = new RegExp('\\{[^}]*\\b' + n + '\\b[^}]*\\}\\s*=\\s*require');
    return !decl.test(src) && !destructured.test(src);
  });
  return { rel, missing, names };
}

for (const rel of ['qa/scenario_engine.js', 'qa/scenario_lane.js', 'qa/native_work_item_fixture.js',
  'qa/write_ui_reroute_fixture.js']) {
  const r = exportedNamesAreDefined(rel);
  ok(r.names.length > 0, rel + ' declares a module.exports this check can read');
  ok(r.missing.length === 0,
    rel + ' exports only names it actually has'
    + (r.missing.length ? ' — missing: ' + r.missing.join(', ') : ''));
}

/* Driven before trusted on the exact broken shape — AND on the shape it admits it misses, so
   the limit named above is demonstrated rather than claimed.
   The probe re-implements the predicate over a literal rather than calling
   `exportedNamesAreDefined`, which takes a repo path; keeping them in step is the point of
   running both against the real files just above. */
function probeMissingExports(src) {
  const m = src.match(/module\.exports\s*=\s*\{([\s\S]*?)\}/);
  if (!m) return [];
  return m[1].split(',').map(x => x.split(':')[0].trim())
    .filter(n => /^[A-Za-z_$][\w$]*$/.test(n))
    .filter(n => !new RegExp('(?:function|const|let|var|class)\\s+' + n + '\\b').test(src)
      && !new RegExp('\\{[^}]*\\b' + n + '\\b[^}]*\\}\\s*=\\s*require').test(src));
}
ok(probeMissingExports("const { a } = require('./x.js');\nmodule.exports = { a, b };").join() === 'b',
  '  · CAUGHT: a name exported but declared nowhere — the shape that broke the engine');
ok(probeMissingExports("function outer(){ function inner(){} }\nmodule.exports = { inner };").length === 0,
  '  · MISSED, and admitted in the comment above: a name declared only in an INNER scope '
  + 'passes while the real module would throw. Naming the limit beats a sixth source scanner');

/* ---- 1f. WOULD THESE MODULES LOAD AT ALL? -------------------------------- */
/* Answering my own question from the PR rather than leaving it open: what else did removing
   the engine `require` stop exercising? It stopped exercising LOADABILITY, and the export-name
   check above covers only one of the ways a load fails. The other two that can be checked
   without executing anything are a parse error and a relative `require` naming a file that is
   not there. Both are cheap, and both would take the scenario and tree lanes down exactly the
   way the ReferenceError did.

   WHAT THIS STILL DOES NOT COVER, said plainly so it is not read as equivalent to a load: a
   module that parses, resolves and exports honestly can still THROW while executing its top
   level. `qa/sxr_courier_lib.js` is the live example — its Playwright fallback names a path
   that exists only in the agent container — and that is precisely the class the `unit` job
   cannot test, because loading it is what turned CI red. A real load belongs in a job that
   installs dependencies; these three static checks are what is available here. */
/* Proven by injection on a file this suite only READS (`qa/probes/p68_linear_link_clear.js`):
   a syntax error reports "Unexpected end of input" and a dangling require names the missing
   path, both as clean failures. The first attempt at that proof injected into
   `qa/scenario_lane.js`, which this suite REQUIRES — so the process died at the require before
   the checks ran, and the run looked like it caught nothing. The checks were fine; the test of
   the test was wrong, and driving it a second time is the only reason that is known.
   For the few qa/ files this suite requires, a parse error still fails the run, just as a
   crash rather than as a named check. Loud either way. */
const qaFiles = walkJs(path.join(ROOT, 'qa'), []);
const parseFailures = [];
const danglingRequires = [];
for (const abs of qaFiles) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  const src = fs.readFileSync(abs, 'utf8');
  try { new vm.Script(src, { filename: abs }); }
  catch (e) { parseFailures.push(rel + ': ' + String(e.message).slice(0, 70)); }
  for (const m of src.matchAll(/require\(\s*'(\.[^']+)'\s*\)/g)) {
    const target = path.resolve(path.dirname(abs), m[1]);
    const found = fs.existsSync(target) || fs.existsSync(target + '.js')
      || fs.existsSync(path.join(target, 'index.js'));
    if (!found) danglingRequires.push(rel + ' -> ' + m[1]);
  }
}
ok(qaFiles.length > 100,
  'every qa/**/*.js is scanned for loadability (' + qaFiles.length + ' files)');
ok(parseFailures.length === 0,
  'none of them fails to PARSE — a syntax error takes its lane down the same way the '
  + 'ReferenceError did' + (parseFailures.length ? ': ' + parseFailures[0] : ''));
ok(danglingRequires.length === 0,
  'and no relative require names a file that is not there'
  + (danglingRequires.length ? ': ' + danglingRequires[0] : ''));

/* ---- 2. THE FIXTURE ACTUALLY STAMPS THE CARD ----------------------------- */
/* Executed, not read. A stand-in for the slice of Playwright's routing API the
   fixture uses, so a handler that stopped working would fail here. */

function makeRoutingContext(upstream) {
  const handlers = [];
  const ctx = { route: async (matcher, handler) => { handlers.push({ matcher, handler }); } };
  async function dispatch(urlText, init) {
    const url = new URL(urlText);
    const request = {
      url: () => urlText,
      method: () => (init && init.method) || 'GET',
      postData: () => (init && init.body) || null
    };
    // Playwright matches most-recently-registered first and `fallback()` defers
    // to the next one down; `FELL_THROUGH` is "left live".
    const ordered = handlers.slice().reverse();
    let index = 0;
    const step = async () => {
      if (index >= ordered.length) return { outcome: 'FELL_THROUGH' };
      const entry = ordered[index++];
      const matches = typeof entry.matcher === 'function'
        ? entry.matcher(url)
        : urlText.includes(String(entry.matcher).replace(/\*/g, ''));
      if (!matches) return step();
      let result = null;
      const route = {
        request: () => request,
        fallback: async () => { result = await step(); return result; },
        fetch: async () => {
          const served = await upstream(urlText, init);
          return { text: async () => served.body, headers: () => served.headers || {} };
        },
        fulfill: async (options) => { result = { outcome: 'FULFILLED', body: options.body }; return result; }
      };
      await entry.handler(route);
      return result || { outcome: 'FELL_THROUGH' };
    };
    return step();
  }
  return { ctx, dispatch };
}

(async () => {
  const CARD = 'p_probe_card_1';
  const OTHER = 'p_someone_elses_card';
  const VID = NW.nativeDeliverableId(CARD, 'video');
  const GID = NW.nativeDeliverableId(CARD, 'graphic');

  const upstreamRows = [
    { id: CARD, client: 'sidneylaruel', video_deliverable_id: null, graphic_deliverable_id: null, video_status: 'In Progress' },
    { id: OTHER, client: 'sidneylaruel', video_deliverable_id: null, graphic_deliverable_id: null, video_status: 'In Progress' }
  ];
  const { ctx, dispatch } = makeRoutingContext(async () => ({
    body: JSON.stringify(upstreamRows),
    headers: { 'content-range': '0-1/2' }
  }));
  await NW.stubNativeWorkItems(ctx, [{ id: CARD, components: ['video', 'graphic'] }]);

  const calendarRead = await dispatch('https://stub.invalid/rest/v1/calendar_posts?select=*&client=eq.sidneylaruel');
  ok(calendarRead.outcome === 'FULFILLED', 'the fixture answers the calendar read');
  const served = JSON.parse(calendarRead.body);
  const mine = served.find(r => r.id === CARD);
  const theirs = served.find(r => r.id === OTHER);
  ok(mine && mine.video_deliverable_id === VID && mine.graphic_deliverable_id === GID,
    "the probe's own card comes back carrying both native work items");
  ok(theirs && !theirs.video_deliverable_id && !theirs.graphic_deliverable_id,
    'and every other card in the same response is untouched — the fixture stamps its cards, not the table');
  ok(mine && mine.video_status === 'In Progress',
    'and the rest of the row is passed through as the backend sent it');

  const crosswalkRead = await dispatch('https://stub.invalid/rest/v1/deliverables?select=id,client_slug,team,origin,card_id&id=in.(%22' + VID + '%22)');
  ok(crosswalkRead.outcome === 'FULFILLED', 'the crosswalk read for a fixture id is answered');
  const crosswalkRows = JSON.parse(crosswalkRead.body);
  ok(crosswalkRows.length === 1 && crosswalkRows[0].id === VID, 'with exactly the row that was asked for');

  const liveRead = await dispatch('https://stub.invalid/rest/v1/deliverables?select=*&client_slug=eq.sidneylaruel');
  ok(liveRead.outcome === 'FELL_THROUGH',
    'a deliverables read naming none of the fixture ids is left LIVE — the fixture fakes the ids it '
    + 'minted and nothing else');

  /* ---- 3. THE STAMPED CARD SATISFIES THE SHIPPED PREDICATES -------------- */
  /* The point of the fixture is to reach the real native branch. These are the
     three gates between a card and a native write, lifted from index.html and
     run against the fixture's own output. */

  const sandbox = { console, String, Array, Boolean, Number };
  vm.createContext(sandbox);
  vm.runInContext([
    grabFunc('_writeUiComponentHasWorkItem'),
    grabFunc('_writeUiNativeId'),
    grabFunc('_writeUiNativeStatus'),
    grabFunc('_prodCrosswalkTeamForComponent'),
    grabFunc('_prodCrosswalkCardSlug'),
    grabFunc('_prodCrosswalkMismatchFields'),
    "const PROD_CROSSWALK_SURFACE_ORIGIN = { calendar: 'calendar', sxr: 'samples' };"
  ].join('\n'), sandbox);

  const post = Object.assign({ client_slug: 'sidneylaruel' }, mine);
  ok(sandbox._writeUiNativeId(post, 'video') === VID && sandbox._writeUiNativeId(post, 'graphic') === GID,
    'the SHIPPED _writeUiNativeId reads both stamped ids off the card — so makePayload gets an '
    + '`id` instead of throwing native_link_required, which is the refusal that stood in front of '
    + 'every one of these probes');
  ok(sandbox._writeUiNativeId(post, 'caption') === '',
    'and still answers nothing for caption, which owns no work item (OPEN_REPAIRS 127) — the '
    + 'probes assert caption transports nothing, and this is why');

  for (const component of ['video', 'graphic']) {
    const row = NW.crosswalkRowFor(CARD, component, 'sidneylaruel');
    const mismatch = sandbox._prodCrosswalkMismatchFields(row, 'calendar', post, component);
    ok(mismatch.length === 0,
      'the fixture crosswalk row for ' + component + ' matches the card on all four fields the '
      + 'shipped comparison checks, so the verdict is `valid` and the client front door can open');
  }
  const wrongCardRow = NW.crosswalkRowFor(OTHER, 'video', 'sidneylaruel');
  ok(sandbox._prodCrosswalkMismatchFields(wrongCardRow, 'calendar', post, 'video').includes('card_id'),
    '  · CONTROL: a row describing a DIFFERENT card is a mismatch, so the check above is not vacuous');

  /* The exact native status strings the three probes assert, produced by the
     shipped mapper from the labels they click. A probe asserting a status the
     mapper never emits would pass review and fail at 08:00. */
  const STATUS_CASES = [
    ['Tweaks Needed', 'tweak'],
    ['For SMM Approval', 'smm_approval'],
    ['Kasper Approval', 'kasper_approval'],
    ['Client Approval', 'client_approval'],
    ['Approved', 'approved']
  ];
  for (const [label, native] of STATUS_CASES) {
    ok(sandbox._writeUiNativeStatus(label) === native,
      'the shipped mapper turns "' + label + '" into `' + native + '`, which is what the probes assert');
  }

  /* ---- 4. THE REFUSAL THE FIXTURE EXISTS TO GET PAST --------------------- */
  /* Pinned on the source because `makePayload` is a closure inside
     `_writeUiGatewayPost` and cannot be lifted alone. If this rule ever
     changes, the fixture's reason for existing changes with it. */
  ok(/if \(!intent\.legacyOnly && !legacyParity && !intent\.nativeId\) \{\s*throw _writeUiGatewayError\(409, 'native_link_required'\);/.test(INDEX),
    'the gateway payload builder still refuses a native write with no work item — the reason a probe '
    + 'card needs one, stated where a future edit would have to change it');

  console.log(`\nprobes-assert-native-write-lane: ${failures ? failures + ' failed ❌' : 'all checks passed ✅'}`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FAIL  suite threw: ' + (e && e.stack || e)); process.exit(1); });
