/**
 * The pixel lane can finally say WHAT failed (ledger item 185, 2026-09-09).
 *
 * `production-polish-heavy` has been red on `main` continuously since
 * 2026-08-30, and every one of those runs reported the same public line:
 *
 *     Production heavy gate failed at: Production pixel parity [error_generic]
 *
 * `pixel-wired.js` throws `N pixel parity gap(s) found` and prints the gaps to
 * stderr. Those gap MESSAGES are live-derived — computed CSS, element counts,
 * console text — so they stay on the ephemeral runner by design, and nothing
 * in the thrown message matched a classifier signature. So the lane named
 * nothing for ten days, and nobody could look at what nobody could see. This
 * is the same blackout OPEN_REPAIRS 125 records for the behaviour lane, which
 * was fixed by publishing the failing CHECK NAMES only.
 *
 * A gap's `state` is not live content: every one is a string literal at its
 * call site in a public file. Its `message` is. This suite pins that boundary
 * in both directions — the labels get out, and anything that is not a known
 * label does not.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const GATE = path.join(ROOT, 'docs', 'syncview-design', 'tests', 'prod-polish-gate.js');
const PIXEL = path.join(ROOT, 'docs', 'syncview-design', 'tests', 'pixel-wired.js');
const gateSrc = fs.readFileSync(GATE, 'utf8');
const pixelSrc = fs.readFileSync(PIXEL, 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function grab(startMarker, endMarker) {
  const start = gateSrc.indexOf(startMarker);
  if (start < 0) throw new Error('not found: ' + startMarker);
  const end = gateSrc.indexOf(endMarker, start);
  if (end < 0) throw new Error('no end for: ' + startMarker);
  return gateSrc.slice(start, end + endMarker.length);
}

/* ---- the suite emits the marker, and emits only labels ------------------ */

const emitAt = pixelSrc.indexOf("console.error('PIXEL_WIRED_FAILED_STATES ");
ok(emitAt > 0, 'pixel-wired emits a machine-readable marker line for its failing states');
ok(emitAt < pixelSrc.indexOf('pixel parity gap(s) found'),
  'and emits it BEFORE it throws, so a caller reading the output sees it');

const emitBlock = pixelSrc.slice(pixelSrc.indexOf('const failedStates'), emitAt + 200);
ok(/gaps\.map\(g => String\(g\.state \|\| ''\)\)/.test(emitBlock),
  'the marker is built from `state` only');
ok(!/g\.message|\$\{g\./.test(emitBlock),
  'and never from `message`, which is the half that carries live-derived values');

/* ---- the gate's allowlist and matcher, executed ------------------------- */

const sandbox = { require, path, root: ROOT, console };
vm.createContext(sandbox);
vm.runInContext(
  grab('const PIXEL_WIRED_STATES = (() => {', '})();') + '\n'
  + grab('const PIXEL_WIRED_NAME_CAP =', ';') + '\n'
  + grab('function pixelWiredFailedStates(text) {', '\n}') + '\n',
  sandbox);

const states = vm.runInContext('PIXEL_WIRED_STATES', sandbox);
const cap = vm.runInContext('PIXEL_WIRED_NAME_CAP', sandbox);
const name = (text) => vm.runInContext('pixelWiredFailedStates', sandbox)(text);

ok(states.size > 20, 'the allowlist harvests a real number of labels from pixel-wired.js (' + states.size + ')');
for (const label of ['topbar', 'icons', 'browser history', 'write silence', 'console silence',
                     'dark palette', 'light palette', 'selection actionbar']) {
  ok(states.has(label), 'allowlist covers the literal label "' + label + '"');
}

const marker = (line) => 'some earlier output\nPIXEL_WIRED_FAILED_STATES ' + line + '\nError: 3 pixel parity gap(s) found';

ok(name(marker('icons|topbar')) === 'pixel_wired:icons+topbar',
  'two known labels are published, joined, in the order emitted');
ok(name(marker('dark palette')) === 'pixel_wired:dark palette',
  'a label containing a space survives the pipe-separated encoding');
ok(name('no marker here at all') === '',
  'no marker means no name, so the ordinary classifier still runs');

/* The public-safety direction, which is the whole reason the messages stayed
   on the runner in the first place. */
ok(name(marker('Some Client Name|a row body that leaked')) === '',
  'a label that is NOT a literal in pixel-wired.js is dropped entirely');
ok(name(marker('topbar|Some Client Name')) === 'pixel_wired:topbar',
  'and a known label beside an unknown one publishes only the known one');

const many = Array.from(states).slice(0, cap + 3);
const capped = name(marker(many.join('|')));
ok(capped.endsWith('+3more') && capped.split('+').length === cap + 1,
  'a breakage wider than the cap is summarised rather than dumped (' + cap + ' names then a count)');

/* ---- and it is actually wired into the reason line ---------------------- */

const reason = grab('function failureReason(text) {', '\n}');
ok(/const pixel = pixelWiredFailedStates\(text\);/.test(reason)
   && reason.indexOf('pixelWiredFailedStates') < reason.indexOf('classifyFailure'),
  'failureReason prefers a named pixel state over the generic classifier');
ok(reason.indexOf('behavWiredFailedChecks') < reason.indexOf('pixelWiredFailedStates'),
  'and still lets the behaviour lane name itself first');

console.log(failures ? '\npixel-parity-failure-is-nameable: ' + failures + ' FAILED'
                     : '\npixel-parity-failure-is-nameable: all checks passed');
process.exit(failures ? 1 : 0);
