'use strict';
/*
 * Batch asset writes had TWO blockers on one call stack, and the first hid the
 * second.
 *
 * `select count(*) from deliverable_events where action = 'batch_asset_change'`
 * was 0 on 2026-08-31 -- and still 0 after the missing client_slug was fixed
 * and applied (#1194). Three people had reported it over two days. The first
 * blocker raised 23502 inside batch_write's upsert; fixing it moved the
 * failure a few statements further down the same stack, to the audit row.
 *
 * THE SECOND BLOCKER. A batch folder link has no Linear counterpart --
 * ROLLBACK.md has said so since it shipped: "no outbox leg and no Linear
 * mirror, so there is no queue to drain and nothing in-flight to reconcile."
 * But the event was built WITH an `outbound` object, purely to carry the
 * descriptive slot and team fields. That object is not a description:
 *
 *     track_b_enqueue_outbound_intent fires on EVERY deliverable_events insert
 *     and skips only when `source <> 'ui' OR outbound is not an object`.
 *
 * So every batch asset write enqueued a mirror intent for an operation that
 * has no mirror. With no `payload` inside it, mirror_outbox_enqueue read no
 * `_f27_authority_generation` and stored coalesce(null, -1);
 * track_b_f27_hold_guard compared -1 to the live team fence and raised
 * f27_authority_generation_stale. A raw PL/pgSQL exception is not a
 * GatewayError, so the outer catch answered 500 write_failed -- a `wait`-class
 * code that told three people to try again in a moment. It never would.
 *
 * WHAT THIS PINS is the rule, not the one call site: the `outbound` key is the
 * enqueue signal, so an operation with nothing to mirror must not carry one.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const EDGE = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');
const MIGRATIONS = path.join(ROOT, 'migrations');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(name) {
  const start = EDGE.indexOf(name);
  if (start < 0) throw new Error('not found: ' + name);
  let i = EDGE.indexOf('{', start);
  let depth = 0, inS = '', inC = '';
  for (let j = i; j < EDGE.length; j++) {
    const c = EDGE[j], n = EDGE[j + 1];
    if (inC === 'line') { if (c === '\n') inC = ''; continue; }
    if (inC === 'block') { if (c === '*' && n === '/') { inC = ''; j++; } continue; }
    if (inS) { if (c === '\\') { j++; continue; } if (c === inS) inS = ''; continue; }
    if (c === '/' && n === '/') { inC = 'line'; j++; continue; }
    if (c === '/' && n === '*') { inC = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return EDGE.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

/* ---- 1. The trigger's rule, read from the migration that defines it ----- */
/* Restating this rule here instead of reading it would let the two drift, and
   the drift IS the bug: the gateway believed outbound was descriptive. */

const trigger = fs.readFileSync(
  path.join(MIGRATIONS, '2026-07-12-write-ui-outbox-parity.sql'), 'utf8');
const skip = /if new\.source <> 'ui'\s*\n\s*or jsonb_typeof\(new\.payload->'outbound'\) is distinct from 'object' then\s*\n\s*return new;/;
ok(skip.test(trigger),
  'the enqueue trigger skips only when source is not ui OR there is no outbound object — so an outbound object IS a request to enqueue');

/* ---- 2. Executed: the same rule, against both event shapes ------------- */

function enqueues(event) {
  return event.source === 'ui'
    && event.outbound !== null
    && typeof event.outbound === 'object'
    && !Array.isArray(event.outbound);
}
ok(enqueues({ source: 'ui', outbound: { entity: 'batch', operation: 'batch_asset' } }),
  'the shape that shipped enqueued a mirror intent — reproduced');
ok(!enqueues({ source: 'ui', slot: 'delivery_folder', team: 'video' }),
  'and an event with no outbound key does not, which is the fix');
ok(!enqueues({ source: 'ui', outbound: undefined }),
  'an absent outbound is absent however it is spelled');

/* ---- 3. eventFor omits the key rather than emitting an empty one -------- */
/* An empty object is still an object to jsonb_typeof, so `outbound: {}` would
   enqueue exactly as the bug did. The key has to be GONE. */

const eventForSrc = grabFunc('function eventFor(');
ok(/\.\.\.\(outbound \? \{ outbound \} : \{\}\)/.test(eventForSrc),
  'eventFor omits the outbound key entirely when there is no mirror leg, rather than emitting an empty object');
ok(/outbound: JsonMap \| null/.test(EDGE),
  'and its type says so, so a no-mirror caller is a compile-time notion rather than a convention');

/* ---- 4. The batch asset write carries none -------------------------- */

/* By DECLARATION, not by bare name. The first draft searched for
   'handleBatchAssetWrite' and landed on a comment at line 8 that mentions it,
   then reported four failures against comment prose. A matcher that can find
   the wrong thing will. */
const handler = grabFunc('async function handleBatchAssetWrite(');
ok(/eventFor\("batch_asset", principal, sourceEditedAt, surface, null\)/.test(handler),
  'handleBatchAssetWrite passes null, so its event carries no enqueue signal');
ok(!/entity: "batch"/.test(handler) && !/operation: "batch_asset",/.test(handler),
  'and drops the outbox-addressing fields with it — they addressed a row that must not exist');

/* THE AUDIT ROW IS NOT LOST, which is the reason this is safe. batch_write
   writes the whole event into deliverable_events.payload. */
for (const field of ['slot,', 'team: eventTeam,', 'teams: scopeTeams,']) {
  ok(handler.includes(field),
    'the event still records ' + field.replace(/[:,].*$/, '') + ' for the audit row');
}

/* ---- 5. Every OTHER operation keeps its mirror leg ---------------------- */
/* The fix must be surgical. Removing outbound anywhere else would silently
   stop a real Linear mirror, which is a far worse defect than the one fixed. */

/* Each call's FIFTH argument is the outbound. Parsed by walking the argument
   list rather than by a regex over a 240-character window, because the calls
   span several lines and carry nested calls of their own. */
function fifthArg(call) {
  const open = call.indexOf('(');
  let depth = 0, arg = 0, start = open + 1;
  for (let i = open; i < call.length; i++) {
    const c = call[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (!depth) return arg === 4 ? call.slice(start, i).trim() : '';
    } else if (c === ',' && depth === 1) {
      if (arg === 4) return call.slice(start, i).trim();
      arg++; start = i + 1;
    }
  }
  return '';
}
/* Call sites are found by INDEX and walked to their matching close paren. A
   windowed regex found only 4 of the 8, because these calls span lines and
   nest calls of their own -- and "4 of 8 checked" reported as a pass is how a
   guard quietly stops guarding half of what it names. */
const calls = [];
for (let at = EDGE.indexOf('eventFor('); at >= 0; at = EDGE.indexOf('eventFor(', at + 1)) {
  // Skip the declaration itself and any mention inside a comment.
  if (/function\s+$/.test(EDGE.slice(Math.max(0, at - 12), at))) continue;
  const open = EDGE.indexOf('(', at);
  let depth = 0;
  for (let i = open; i < EDGE.length; i++) {
    const c = EDGE[i];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (!depth) { calls.push(EDGE.slice(at, i + 1)); break; } }
  }
}
const others = calls.filter(call => !call.includes('"batch_asset"'));
ok(calls.length >= 8, 'found every eventFor call site (' + calls.length + ')');
ok(others.length === calls.length - 1,
  'exactly one of them is the batch asset write');
const nulled = others.filter(call => fifthArg(call) === 'null');
ok(nulled.length === 0,
  'and none of the others passes null — every operation with a Linear mirror still enqueues it'
  + (nulled.length ? ' (found ' + nulled.length + ')' : ''));
ok(fifthArg(calls.find(call => call.includes('"batch_asset"')) || '') === 'null',
  'while the batch asset write, the one operation with nothing to mirror, does');

console.log(failures === 0
  ? '\nbatch asset no-mirror-leg checks passed'
  : '\n' + failures + ' batch asset no-mirror-leg check(s) failed');
process.exit(failures === 0 ? 0 : 1);
