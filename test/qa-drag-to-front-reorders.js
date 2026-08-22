'use strict';
/*
 * The samples nightly was red because of ONE assertion, and that assertion was
 * a harness defect rather than a product defect.
 *
 * `smm.dragToFront` returned 'already-first' the moment the card it was asked
 * to move happened to be at the head of the strip, and the scenario supplied
 * nothing to move it against -- it inherited whatever a previous run had left
 * behind. On any night the TEST client started clean, the newly created card
 * was the ONLY card, so the step failed and the run went red with 86/87
 * assertions passing. Measured on main: samples nightly failed 2026-08-16
 * through 2026-08-21 on exactly this assertion, while unit, parity, realtime
 * and tree were green every night.
 *
 * Two things are pinned here, and both are EXECUTED against the real helper
 * extracted from qa/scenario_engine.js rather than asserted about its text:
 *
 *   1. a card that is already first is round-tripped -- sent to the back,
 *      dropped, brought to the front, dropped again -- so a real reorder is
 *      persisted either way, and the second drop lands while the first is in
 *      flight, which is the coalescing branch the scenario title claims to
 *      cover ("drag to front mid-save");
 *   2. a strip holding a single card reports that it had nothing to reorder
 *      instead of passing vacuously -- so if the seed ever stops arriving the
 *      suite says so rather than going quietly green.
 *
 * The DOM here is a stand-in, not a browser. What it faithfully models is the
 * only thing the helper depends on: strip child order, name lookup, and the
 * fact that the real drop handler persists WITHOUT re-rendering, so node
 * references stay valid across the intermediate drop.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const ENGINE = process.env.QA_ENGINE_SRC || path.join(ROOT, 'qa', 'scenario_engine.js');
const SCENARIOS = process.env.QA_SCENARIOS_SRC || path.join(ROOT, 'qa', 'scenarios.js');
const engineSrc = fs.readFileSync(ENGINE, 'utf8');
const scenarioSrc = fs.readFileSync(SCENARIOS, 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function extractFn(source, name) {
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

const sandbox = { Event: function Event(type) { this.type = type; }, Promise, Error, Array, Object, String, Number, Boolean };
vm.createContext(sandbox);
vm.runInContext(extractFn(engineSrc, 'smmDragToFront') + '\nthis.dragToFront = smmDragToFront;', sandbox);
const dragToFront = sandbox.dragToFront;
ok(typeof dragToFront === 'function', 'the real drag helper extracts and runs (harness is not vacuous)');

/* A strip that behaves the way the product one does under a drop: the handler
   reorders state and persists, and does NOT re-render. */
function makeStrip(names) {
  const drops = [];
  const cards = names.map(n => ({ name: n, querySelector: sel => (sel === '.cal-fld-name' ? { value: n } : null) }));
  const strip = {
    children: cards.slice(),
    querySelectorAll: () => strip.children.slice(),
    dispatchEvent: (e) => { drops.push({ type: e.type, order: strip.children.map(c => c.name) }); return true; },
    insertBefore: (node, ref) => {
      const from = strip.children.indexOf(node);
      if (from >= 0) strip.children.splice(from, 1);
      const at = ref === null ? strip.children.length : strip.children.indexOf(ref);
      strip.children.splice(at < 0 ? strip.children.length : at, 0, node);
      return node;
    },
  };
  // nextSibling has to reflect the LIVE order, which is what the round trip uses.
  cards.forEach(c => Object.defineProperty(c, 'nextSibling', {
    get() { const i = strip.children.indexOf(c); return i >= 0 && i + 1 < strip.children.length ? strip.children[i + 1] : null; },
  }));
  const page = { evaluate: async (fn, arg) => vm.runInContext('(' + fn.toString() + ')', sandbox)(arg) };
  sandbox.document = { getElementById: id => (id === 'sxrStrip' ? strip : null) };
  return { page, strip, drops, order: () => strip.children.map(c => c.name) };
}

(async () => {
  // 1. The ordinary case is untouched: a card behind others moves to the head
  //    on a single drop.
  let w = makeStrip(['Anchor A', 'Anchor B', 'UI Drag Newborn']);
  let res = await dragToFront(w.page, 'UI Drag Newborn');
  ok(res === 'ok', 'an ordinary drag still reports ok (got ' + res + ')');
  ok(w.order()[0] === 'UI Drag Newborn', 'and the card ends up first');
  ok(w.drops.length === 1, 'one drop is fired, exactly as a human drag fires one');

  // 2. THE DEFECT. Already first is a real reorder now, not a dead end.
  w = makeStrip(['UI Drag Newborn', 'Anchor A']);
  res = await dragToFront(w.page, 'UI Drag Newborn');
  ok(res === 'ok', 'a card that is already first no longer fails the step (got ' + res + ')');
  ok(w.order()[0] === 'UI Drag Newborn', 'it still ends first, which is what the scenario asserts next');
  ok(w.drops.length === 2, 'two drops: the round trip persists a genuine move rather than a no-op');
  ok(w.drops[0].order[w.drops[0].order.length - 1] === 'UI Drag Newborn',
    'the first drop really sent it to the back -- the intermediate order is not skipped');
  ok(w.drops[1].order[0] === 'UI Drag Newborn', 'and the second drop brought it to the front');

  // 3. Nothing to reorder must not pass quietly.
  w = makeStrip(['UI Drag Newborn']);
  res = await dragToFront(w.page, 'UI Drag Newborn');
  ok(/^nothing-to-reorder/.test(res), 'a lone card reports that there was nothing to reorder (got ' + res + ')');
  ok(w.drops.length === 0, 'and fires no drop, so nothing false is persisted');

  // 4. A card that is not there is still an honest miss.
  w = makeStrip(['Anchor A', 'Anchor B']);
  res = await dragToFront(w.page, 'UI Drag Newborn');
  ok(res === 'no-card', 'a missing card is still reported as missing (got ' + res + ')');

  // 5. The scenario supplies its own second card, so case 3 can only mean a
  //    real failure. Pinned on the step list, which is the contract.
  const scenario = scenarioSrc.slice(scenarioSrc.indexOf("key: 'create_drag_reorder_persist'"));
  const steps = scenario.slice(0, scenario.indexOf('] });'));
  const seedAt = steps.indexOf("'api.seedRow'");
  const mergeAt = steps.indexOf("'smm.bgReload'");
  const provedAt = steps.indexOf("'XSESSION Drag Anchor'", mergeAt + 1);
  const dragAt = steps.indexOf("'smm.dragToFront'");
  ok(seedAt > -1, 'the scenario seeds a row of its own');
  ok(mergeAt > seedAt, 'followed by the merge a seeded row needs in order to appear at all');
  ok(provedAt > mergeAt && provedAt < dragAt,
    'and PROVES the seeded row reached the strip before dragging -- a silent seed failure is its own assertion');

  if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
  console.log('\nall green');
})().catch(e => { console.error('FAIL  harness: ' + (e && e.stack || e)); process.exit(1); });
