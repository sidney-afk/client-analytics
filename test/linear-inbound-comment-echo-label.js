'use strict';
/*
 * OPEN_REPAIRS item 85 — foreign_write_detected read ~80% self-noise.
 *
 * There is exactly one producer of the signal, recordDetectOnly, and the comment
 * lane reached it through a branch that could not see `echo` -- a live parameter
 * one line below the return that skipped it. So SyncView's own comment coming
 * home through the Linear webhook was recorded exactly like a human typing in
 * Linear: the row shape {detect_only, linear_comment_id} is written
 * unconditionally, so nothing in it told the two apart. Measured over the flip
 * window: 22 of 29 comment-shaped detections had a SyncView-originated write on
 * the SAME deliverable within five seconds; the issue lane, which still applies
 * its echo drop at the dispatch site, had 1 of 20.
 *
 * That matters because this signal is the flip's tripwire -- the thing an
 * operator would alert on. A tripwire that is mostly our own traffic gets
 * ignored, and then the one real detection is ignored too.
 *
 * The row is ENRICHED, not suppressed: deleting rows the tripwire emits would
 * make a matcher bug able to hide a genuine foreign write, which is the failure
 * direction that actually costs something. This suite EXECUTES the shipped
 * branch and pins that the discriminator reaches the row in both directions.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'linear-inbound', 'index.ts'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Slice the detect-only branch out of handleCommentEvent and de-type it. */
const marker = 'if (existing && await isDetectOnlyTeam(supabase, clean(existing.team))) {';
const start = source.indexOf(marker, source.indexOf('async function handleCommentEvent'));
ok(start >= 0, 'the comment lane detect-only branch exists');
let depth = 0, end = -1, quote = '', escaped = false, comment = '';
for (let i = source.indexOf('{', start); i < source.length; i++) {
  const c = source[i], next = source[i + 1];
  if (comment) {
    if (comment === 'line' && c === '\n') comment = '';
    else if (comment === 'block' && c === '*' && next === '/') { comment = ''; i++; }
    continue;
  }
  if (quote) {
    if (escaped) escaped = false;
    else if (c === '\\') escaped = true;
    else if (c === quote) quote = '';
    continue;
  }
  if (c === '/' && next === '/') { comment = 'line'; i++; continue; }
  if (c === '/' && next === '*') { comment = 'block'; i++; continue; }
  if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
  if (c === '{') depth++;
  else if (c === '}' && --depth === 0) { end = i + 1; break; }
}
ok(end > start, 'the branch closes');
const block = source.slice(start, end);

const run = new Function('deps', `
  const { supabase, existing, commentId, stored, echo, clean,
          isDetectOnlyTeam, recordDetectOnly } = deps;
  return (async () => {
    ${block}
    return null;   // not a detect-only team: the branch did not fire
  })();
`);

function deps(echo, detectOnly) {
  const recorded = [];
  return {
    supabase: {},
    existing: { id: 'del_x', team: 'video' },
    commentId: 'lc_1',
    stored: { id: 'pc_1' },
    echo,
    clean: v => String(v == null ? '' : v).trim(),
    isDetectOnlyTeam: async () => detectOnly !== false,
    recordDetectOnly: async (_s, _e, payload) => { recorded.push(payload); },
    recorded,
  };
}

(async () => {
  /* 1. Our own comment coming home — the 22-of-29 case. */
  {
    const d = deps({ id: 4242 }, true);
    const out = await run(d);
    ok(d.recorded.length === 1, 'a self-echo still records a row: the tripwire never loses an event');
    ok(d.recorded[0].echo_suppressed === true,
      'and the row now SAYS it was our own transport, which is the whole finding');
    ok(d.recorded[0].echo_outbox_id === 4242,
      'naming the outbox row it echoes, so the pair can be reconciled by hand');
    ok(out && out.echo_suppressed === true,
      'the handler result reports it too, matching the non-detect-only lane below');
  }
  /* 2. A human typing directly into Linear on a flipped team — the real thing. */
  {
    const d = deps(null, true);
    const out = await run(d);
    ok(d.recorded.length === 1 && d.recorded[0].echo_suppressed === false,
      'a genuine foreign comment is recorded with echo_suppressed FALSE — the alert predicate');
    ok(d.recorded[0].echo_outbox_id === null,
      'and carries no outbox id, because none exists');
    ok(d.recorded[0].detect_only === true && d.recorded[0].linear_comment_id === 'lc_1',
      'the pre-existing keys are unchanged, so existing consumers keep reading');
    ok(out && out.detect_only === true && out.stored === true,
      'the detect-only return shape is otherwise unchanged');
  }
  /* 3. A team that is NOT detect-only must not enter this branch at all — its
   *    echo drop lives below, and double-handling would double-count. */
  {
    const d = deps({ id: 7 }, false);
    const out = await run(d);
    ok(out === null && d.recorded.length === 0,
      'a Linear-authoritative team falls through to the echo-drop path below, untouched');
  }
  /* 4. An echo with no usable id degrades to null rather than 0 or NaN. */
  {
    const d = deps({ id: 'not-a-number' }, true);
    await run(d);
    ok(d.recorded[0].echo_suppressed === true && d.recorded[0].echo_outbox_id === null,
      'an unparseable outbox id is null, never 0, so a reconciler cannot chase row zero');
  }

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\nlinear-inbound comment echo-label checks passed');
})();
