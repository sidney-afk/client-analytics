'use strict';

/*
 * Locks the "Linear is dead" rehearsal harness.
 *
 * THE CORRECTION THIS FILE EXISTS TO MAKE PERMANENT.
 *
 * This repository has real Linear-mocked browser testing (qa/master.js,
 * qa/run-probes.js, qa/overnight_runner.sh, qa/scenario_engine.js). Its mock
 * had the WRONG POLARITY: qa/sxr_courier_lib.js always fulfilled 200 with
 * `{ok:true}`, i.e. it simulated Linear WORKING. Every "we tested with Linear
 * mocked" result was therefore evidence that the app survives a HEALTHY Linear,
 * which is not the question anyone is asking about 2026-09-15. Running it
 * unchanged answers the wrong question with a confident yes.
 *
 * It was also INCOMPLETE: the interception regex named four webhooks by hand
 * while the browser calls seven, so three of them (linear-issues,
 * linear-projects, linear-tweak-comments) reached the courier and, in an
 * open-egress environment, live n8n.
 *
 * WHY THIS TEST READS SOURCE INSTEAD OF REQUIRING THE MODULE.
 * qa/sxr_courier_lib.js requires `playwright` at load (`:35`). No test in the
 * offline suite requires it today, and pulling a browser dependency into
 * `npm test` to check four pure functions would be a poor trade. The pure
 * helpers are extracted and executed in a VM instead — the same technique the
 * watchdog suite uses to pin `readState`, and the closure suite uses to execute
 * real functions without their I/O.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function ok(condition, message) {
  if (!condition) {
    console.error('FAIL linear-dead-rehearsal:', message);
    failures++;
  }
}

const SOURCE_PATH = path.join(__dirname, '..', 'qa', 'sxr_courier_lib.js');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

/**
 * Pull one top-level declaration out of the real file and run it. If the
 * declaration is renamed or deleted this throws, which is the point: the test
 * cannot silently start checking nothing.
 */
function extract(names) {
  const lines = source.split('\n');
  const chunks = [];
  for (const name of names) {
    const startPattern = new RegExp(`^(?:const|function)\\s+${name}\\b`);
    const start = lines.findIndex(line => startPattern.test(line));
    assert.ok(start > -1, `declaration not found in qa/sxr_courier_lib.js: ${name}`);
    // Balanced scan: accumulate until every bracket the declaration opened is
    // closed again. A line-count or a lookahead cannot do this — the previous
    // attempt stopped at the first line beginning with `}`, which is the END of
    // a function body, not the end of the declaration after it.
    let depth = 0;
    let end = -1;
    for (let i = start; i < lines.length; i++) {
      for (const character of lines[i]) {
        if ('([{'.includes(character)) depth += 1;
        else if (')]}'.includes(character)) depth -= 1;
      }
      if (depth <= 0 && /[;}]\s*$/.test(lines[i])) { end = i; break; }
    }
    assert.ok(end > -1, `could not find the end of declaration: ${name}`);
    chunks.push(lines.slice(start, end + 1).join('\n'));
  }
  const context = { module: {}, exports: {}, process: { env: {} } };
  vm.createContext(context);
  vm.runInContext(`${chunks.join('\n')}\n;__out = { ${names.join(', ')} };`, context);
  return context.__out;
}

const {
  LINEAR_DEAD_SHAPES,
  LINEAR_HOOK,
  LINEAR_API_HOST,
  linearDeadShapeFor,
  linearDeadResponseFor,
} = extract([
  'LINEAR_DEAD_SHAPES',
  'LINEAR_HOOK',
  'LINEAR_API_HOST',
  'linearDeadShapeFor',
  'linearDeadResponseFor',
]);

// ---------------------------------------------------------------------------
// INTERCEPTION SURFACE. Every Linear webhook the browser calls, and nothing else.
// ---------------------------------------------------------------------------
{
  // Read the real list out of index.html rather than restating it here, so a
  // new Linear webhook added to the app fails this test instead of quietly
  // escaping the harness.
  const app = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const reached = [...new Set((app.match(/webhook\/linear-[a-z0-9-]+/g) || []))].sort();
  ok(reached.length >= 7,
    `expected the app to call at least seven linear-* webhooks, found ${reached.length}`);
  for (const hook of reached) {
    ok(LINEAR_HOOK.test(`https://example.invalid/${hook}`),
      `${hook} must be intercepted — an un-intercepted Linear webhook reaches live n8n from a probe`);
  }

  // The one that must NOT be caught. Despite the name, log-linear-submission is
  // not a Linear endpoint: it appends to a Google Sheet and touches no Linear
  // API. Blocking it re-opens the 2026-08-26 incident where the only copy of a
  // videographer's submitted work lived in his own browser.
  ok(!LINEAR_HOOK.test('https://example.invalid/webhook/log-linear-submission'),
    'log-linear-submission is NOT a Linear endpoint and must never be intercepted or blocked');

  // Linear's own API is refused in EVERY mode, healthy or dead. A probe that
  // reached it would be mutating a real editor's issue.
  ok(LINEAR_API_HOST.test('https://api.linear.app/graphql'), 'api.linear.app must be refused');
  ok(LINEAR_API_HOST.test('https://uploads.linear.app/anything.png'), 'uploads.linear.app must be refused');
  ok(!LINEAR_API_HOST.test('https://linear.app.example.invalid/'),
    'the host guard must not match a lookalike domain');
  ok(/if \(LINEAR_API_HOST\.test\(url\)\)[\s\S]{0,300}?route\.abort/.test(source),
    'the api.linear.app guard must abort, and must sit in the route handler');
  ok(source.indexOf('LINEAR_API_HOST.test(url)') < source.indexOf('const lh = url.match(LINEAR_HOOK)'),
    'the api.linear.app abort must run BEFORE the webhook branch, so nothing can fall past it');
}

// ---------------------------------------------------------------------------
// THE FAULTS ARE MIXED, AND ONE OF THEM IS A 200.
// ---------------------------------------------------------------------------
{
  ok(LINEAR_DEAD_SHAPES.length >= 4,
    'a single failure shape only proves the app handles that shape; real death is ragged');
  for (const shape of ['refused', 'gateway', 'timeout', 'ok_lie']) {
    ok(LINEAR_DEAD_SHAPES.includes(shape), `the rehearsal must inject the ${shape} shape`);
  }

  ok(linearDeadResponseFor('refused') === null,
    'refused must abort the request, not fulfil it — that is what a dead host does');

  const gateway = linearDeadResponseFor('gateway');
  ok(gateway.status === 502 && !/json/i.test(gateway.contentType),
    'the 502 must carry a NON-JSON body, so a caller that assumes JSON breaks visibly');
  let parsed = true;
  try { JSON.parse(gateway.body); } catch (_) { parsed = false; }
  ok(!parsed, 'the 502 body must genuinely fail JSON.parse — a tidy {error} object tests nothing');

  const timeout = linearDeadResponseFor('timeout');
  ok(timeout.status === 504 && !/json/i.test(timeout.contentType),
    'the 504 must also carry a non-JSON body');

  /*
   * THE MOST IMPORTANT ONE. A 200 that carries nothing.
   *
   * OPEN_REPAIRS 78 records twenty legacy webhook calls that were silent 409s
   * which n8n logged as `success`. A dead lane that still answers 200 is an
   * OBSERVED shape in this estate, and it is the only shape that cannot be
   * caught by checking `resp.ok`. A rehearsal without it proves the app handles
   * loud failure and says nothing about quiet failure — which is the failure
   * mode this whole exit is about.
   */
  const lie = linearDeadResponseFor('ok_lie');
  ok(lie.status === 200, 'the ok_lie shape must answer 200');
  const lieBody = JSON.parse(lie.body);
  ok(lieBody.ok === true, 'the ok_lie body must claim success');
  ok(Object.keys(lieBody).length === 1,
    'the ok_lie body must carry ONLY ok:true — no data, no meta, nothing the caller wanted');
}

// ---------------------------------------------------------------------------
// DETERMINISTIC ROTATION. A probe failure that cannot be reproduced is a rumour.
// ---------------------------------------------------------------------------
{
  const first = [0, 1, 2, 3, 4, 5, 6, 7].map(i => linearDeadShapeFor(i, ''));
  const again = [0, 1, 2, 3, 4, 5, 6, 7].map(i => linearDeadShapeFor(i, ''));
  ok(JSON.stringify(first) === JSON.stringify(again),
    'the rotation must be deterministic — the same call index always gets the same fault');
  ok(new Set(first).size === LINEAR_DEAD_SHAPES.length,
    'the rotation must reach every shape, not favour one');
  ok(first[0] !== first[1], 'consecutive calls must get different shapes');
  ok(first[0] === first[LINEAR_DEAD_SHAPES.length],
    'the rotation must cycle, so a long probe keeps mixing rather than settling');

  for (const shape of LINEAR_DEAD_SHAPES) {
    ok(linearDeadShapeFor(0, shape) === shape && linearDeadShapeFor(7, shape) === shape,
      `pinning to ${shape} must override the rotation, so one defect can be isolated`);
  }
  ok(linearDeadShapeFor(-3, '') === LINEAR_DEAD_SHAPES[3 % LINEAR_DEAD_SHAPES.length]
    || LINEAR_DEAD_SHAPES.includes(linearDeadShapeFor(-3, '')),
  'a negative or malformed index still yields a real shape rather than undefined');
  ok(LINEAR_DEAD_SHAPES.includes(linearDeadShapeFor('nonsense', '')),
    'a non-numeric index still yields a real shape');
}

// ---------------------------------------------------------------------------
// WIRING, AND THE DEFAULT.
// ---------------------------------------------------------------------------
{
  ok(/SYNCVIEW_QA_LINEAR_DEAD/.test(source), 'the mode must be reachable by environment variable');
  ok(/const LINEAR_DEAD = LINEAR_DEAD_RAW !== '' && LINEAR_DEAD_RAW !== '0' && LINEAR_DEAD_RAW !== 'false';/.test(source),
    'unset, "0" and "false" must all mean healthy — the dead mode is opt-in, never a surprise');
  ok(/if \(LINEAR_DEAD\) \{[\s\S]{0,600}?route\.abort\('connectionrefused'\)/.test(source),
    'the dead branch must be able to refuse the connection outright');
  ok(/dead: shape/.test(source),
    'every injected fault must be recorded next to the request, so an assertion can state '
    + 'which shape the app was given rather than guessing');

  // The healthy path must be untouched: this change adds a mode, it does not
  // alter what every existing probe already asserts.
  ok(/\(lh\[1\] === 'linear-subissues'\) \? _subissuesResp\(\)/.test(source),
    'the healthy mock must still return the configurable subissues response');
  ok(/\(lh\[1\] === 'linear-issue-statuses'\) \? \{ ok: true, meta: \{\} \}/.test(source),
    'the healthy mock must still return an empty meta for linear-issue-statuses (OPEN_REPAIRS 68 point 2)');
}

console.log(failures
  ? `linear-dead-rehearsal: ${failures} check(s) failed`
  : 'linear-dead-rehearsal checks passed');
process.exit(failures ? 1 : 0);
