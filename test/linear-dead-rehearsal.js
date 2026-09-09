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
  LINEAR_BACKED_HOOK,
  LINEAR_API_HOST,
  linearDeadShapeFor,
  linearDeadResponseFor,
} = extract([
  'LINEAR_DEAD_SHAPES',
  'LINEAR_HOOK',
  'LINEAR_BACKED_HOOK',
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
// LINEAR-BACKED WEBHOOKS THAT DO NOT CARRY THE `linear-` PREFIX.
//
// OPEN_REPAIRS 181 (lane LX-N8N) named four webhooks that reach Linear through
// their n8n workflow rather than through a `linear-*` name. The prefix match
// cannot see them, so a dead-Linear rehearsal would have sent them to real n8n
// and a HEALTHY Linear -- reporting four Linear-dependent flows as surviving a
// dead Linear on the strength of them having used a live one.
// ---------------------------------------------------------------------------
{
  const backed = ['editors-week', 'send-urgent-slack', 'video-form', 'graphic-form'];
  const app = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const hook of backed) {
    ok(app.includes(`webhook/${hook}`),
      `${hook} must still be called by the app — if it is gone, drop it from LINEAR_BACKED_HOOK rather than leaving a dead pattern`);
    ok(LINEAR_BACKED_HOOK.test(`https://example.invalid/webhook/${hook}`),
      `${hook} reaches Linear through n8n and must be intercepted in dead mode`);
  }
  ok(LINEAR_BACKED_HOOK.test('https://example.invalid/webhook/video-form?client=x'),
    'a query string must not defeat the match');

  // The two that must NOT be caught, for the same reason as log-linear-submission.
  ok(!LINEAR_BACKED_HOOK.test('https://example.invalid/webhook/log-linear-submission'),
    'log-linear-submission appends a Google Sheet and must never be intercepted');
  ok(!LINEAR_BACKED_HOOK.test('https://example.invalid/webhook/kasper-queue'),
    'kasper-queue reads Sheets and survives Linear untouched');
  ok(!LINEAR_BACKED_HOOK.test('https://example.invalid/webhook/editors-week-archive'),
    'the match must be anchored at a path boundary, not a prefix');

  // DEAD MODE ONLY. Healthy-mode behaviour for these four must not change: this
  // library has never mocked them, and altering that would silently change every
  // existing probe rather than only the rehearsal.
  const backedBranch = source.match(/if \(LINEAR_DEAD\) \{\s*\n\s*const bh = url\.match\(LINEAR_BACKED_HOOK\)[\s\S]{0,1400}?\n    \}/);
  ok(backedBranch, 'the LINEAR_BACKED_HOOK branch must exist and must be guarded by LINEAR_DEAD');
  ok(/linearDeadShapeFor\(_linearDeadCallIndex\+\+\)/.test(backedBranch[0]),
    'the backed branch must draw from the same rotating fault sequence, not a fixed shape');
  ok(/route\.abort\('connectionrefused'\)/.test(backedBranch[0]),
    'the backed branch must honour the refused shape by aborting');
  ok(source.indexOf('const bh = url.match(LINEAR_BACKED_HOOK)') > source.indexOf('const lh = url.match(LINEAR_HOOK)'),
    'the backed branch must sit after the linear-* branch, which already owns those names');
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

/*
 * A PROBE THAT INTERCEPTS A LINEAR WEBHOOK MUST HONOUR THE MODE.
 *
 * `SYNCVIEW_QA_LINEAR_DEAD` reaches only what the centralized interceptor sees.
 * A probe that registers its OWN route for the same pattern wins — a
 * later-registered Playwright route takes precedence — so it answers however it
 * likes no matter what the environment says.
 *
 * Four probes (p28/p29/p30/p36) did exactly that, fulfilling `200 {"ok":true}`
 * unconditionally, which meant a full-manifest run with dead mode ON exercised a
 * HEALTHY Linear for precisely the status-and-comment write flows the rehearsal
 * exists to watch die. Found by Codex on PR #1350 (F1); fixed by routing all four
 * through `qa/probes/linear-hook-fulfil.js`, which they can share because they
 * still need to RECORD the calls they intercept and so cannot simply drop their
 * routes and inherit the library's.
 *
 * The property enforced here is the one that actually matters, and it is not a
 * list of names: EVERY probe that intercepts a Linear webhook must answer through
 * the shared helper. A new probe that hand-rolls `route.fulfill` fails this
 * immediately, which is the only version of this check that cannot rot — an
 * exclusion list would have to be maintained by whoever adds the probe, and that
 * is exactly the person who does not know it exists.
 */
{
  const probeDir = path.join(__dirname, '..', 'qa', 'probes');
  const HELPER = 'linear-hook-fulfil.js';

  /*
   * DETECTING THE INTERCEPTS. The first version of this matched a route pattern
   * that spelled a Linear webhook LITERALLY, and Codex found the hole: three more
   * probes build the pattern by concatenation —
   * `for (const wh of ['linear-set-status', …]) ctx.route('**​/webhook/' + wh, …)`
   * — so p47/p60/p68 sailed straight past a check that reported itself green.
   * That was the fourth time in this lane a guard passed while the thing it
   * guarded was broken, which is why the rule below keys on the WEBHOOK NAMES
   * near the registration rather than on the shape of the pattern string.
   *
   * The lookback is what makes concatenation visible: the loop header carrying
   * the names sits on a line above the `.route(` call.
   */
  const HOOK_NAMES = /linear-(set-status|add-comment|subissues|issue-statuses|issues|projects|tweak-comments)/;
  const LOOKBACK = 250;

  function linearRouteHandlers(source) {
    const handlers = [];
    const opener = /\.route\(/g;
    let match;
    while ((match = opener.exec(source)) !== null) {
      const open = source.indexOf('(', match.index);
      let depth = 0;
      for (let i = open; i < source.length; i++) {
        if (source[i] === '(') depth += 1;
        else if (source[i] === ')') {
          depth -= 1;
          if (depth === 0) {
            const body = source.slice(open, i + 1);
            /*
             * Judge the PATTERN, not the whole handler.
             *
             * Matching anywhere in the body swept in `ot4_t1_submit_intake_guards.js`,
             * whose `route('**​/*')` catch-all mentions two Linear paths inside a
             * fully sealed fixture that ABORTS everything it does not name. That
             * probe is not pretending Linear is healthy — its default is refusal —
             * and flagging it would have meant either a false alarm or, worse,
             * someone loosening this check to silence it.
             */
            const comma = body.indexOf(',');
            const pattern = comma === -1 ? body : body.slice(0, comma);
            const context = source.slice(Math.max(0, match.index - LOOKBACK), match.index);
            // Linear-targeted if the pattern names a webhook, or the loop header
            // immediately above supplies the names by concatenation.
            if (HOOK_NAMES.test(pattern) || HOOK_NAMES.test(context)) handlers.push(body);
            break;
          }
        }
      }
    }
    return handlers;
  }

  const intercepts = fs.readdirSync(probeDir)
    .filter(name => name.endsWith('.js') && name !== HELPER)
    .filter(name => linearRouteHandlers(fs.readFileSync(path.join(probeDir, name), 'utf8')).length > 0)
    .sort();

  ok(intercepts.length >= 7,
    `expected at least the seven known Linear-intercepting probes, found ${intercepts.length} `
    + `(${intercepts.join(', ') || 'none'}) — if this drops, the detector stopped matching and `
    + 'the check silently became a no-op');

  for (const probe of intercepts) {
    const source = fs.readFileSync(path.join(probeDir, probe), 'utf8');
    for (const [index, handler] of linearRouteHandlers(source).entries()) {
      ok(/fulfilLinearHook/.test(handler),
        `${probe} Linear route #${index + 1} does not answer through ${HELPER}, so it ignores `
        + 'SYNCVIEW_QA_LINEAR_DEAD and rehearses a HEALTHY Linear whatever the environment says');
      ok(!/\broute\.fulfill\(|\br\.fulfill\(/.test(handler),
        `${probe} Linear route #${index + 1} still fulfils directly — the whole point of the `
        + 'helper is that the answer depends on the mode');
    }
  }

  const helper = fs.readFileSync(path.join(probeDir, HELPER), 'utf8');

  // The helper must BRANCH on the mode. Asserting the token `LINEAR_DEAD` merely
  // appears is not enough — it also appears in the import and the exports, so
  // deleting the branch itself left the old assertion green.
  ok(/if\s*\(\s*!\s*LINEAR_DEAD\s*\)|if\s*\(\s*LINEAR_DEAD\s*\)/.test(helper),
    'the shared helper must branch on LINEAR_DEAD — without the branch every answer is the '
    + 'healthy 200 again and dead mode reaches nothing');
  ok(/linearDeadResponseFor\s*\(/.test(helper) && /linearDeadShapeFor\s*\(/.test(helper),
    'the shared helper must consult the dead-mode rotation, not just proxy a 200');
  ok(/route\.abort\(/.test(helper),
    'the helper must ABORT for the refused shape — fulfilling it as a response would turn '
    + '"connection refused" into "the server answered"');
  ok(/status: 200[\s\S]{0,120}ok["']?:?\s*true|\{"ok":true\}/.test(helper),
    'healthy mode must remain the historical 200 byte for byte, so a probe green before the '
    + 'helper existed stays green for the same reason');
}

console.log(failures
  ? `linear-dead-rehearsal: ${failures} check(s) failed`
  : 'linear-dead-rehearsal checks passed');
process.exit(failures ? 1 : 0);
