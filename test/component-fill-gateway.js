'use strict';
/*
 * The gateway half of "add the missing component": operation `component_fill`.
 *
 * The RPC behind it is proven by execution (test/component-fill-rpc.js). What
 * can go wrong UP HERE is different in kind -- it is about which surfaces may
 * ask, which lane the write takes, and whether a refusal survives the trip
 * back to the browser as something a reader can act on. Those are wiring
 * properties, and they are what this file pins.
 *
 * THE TITLE RULE IS EXECUTED, not pinned by regex, because it is the one piece
 * of judgement in the whole path and it has two branches that disagree with
 * each other on purpose.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FN = path.join(ROOT, 'supabase', 'functions', 'production-write');
const INDEX = fs.readFileSync(path.join(FN, 'index.ts'), 'utf8');
const POLICY = fs.readFileSync(path.join(FN, 'policy.mjs'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* ---- 1. THE OWNER'S RULING IS ENFORCED BY THE SURFACE GATE -------------- */
/* 2026-08-31: "any creation of sub issues should be done from the content
   calendar... I don't want people to add a sub-issue from the sync linear that
   wouldn't appear on the calendar." A fill offered from `production` could
   create a component with no card, which is the exact shape being outlawed. */

const gateAt = INDEX.indexOf('function assertSurfaceOperation(');
const gate = INDEX.slice(gateAt, INDEX.indexOf('\n}', INDEX.indexOf('if (surface === "submission")', gateAt)));
ok(/operation === "component_fill"[\s\S]{0,1400}surface !== "calendar" && surface !== "sxr"[\s\S]{0,120}invalid_surface_operation/.test(gate),
  'component_fill is allowed only from the two CARD surfaces, calendar and sxr');
ok(!/component_fill[\s\S]{0,400}surface === "production"/.test(gate),
  'and never from production — a component created there could be born without a card');

/* ---- 2. It is a create, and the event says so -------------------------- */
/* The RPC requires `action = 'create'`; a `component_fill_change` event would
   describe a mutation of a row that did not exist a moment ago. */

ok(/operation === "create" \|\| operation === "intake_create" \|\| operation === "component_fill"\s*\n?\s*\?\s*"create"/.test(INDEX),
  'eventFor emits action "create" for a fill, which is what the RPC requires');

/* ---- 3. Native-born: no parity lane ------------------------------------- */
/* Intake mirrors a parity copy into a Linear-authoritative team because that
   team's history lives there. A fill has no history to stay in step with. */

const handlerAt = INDEX.indexOf('async function handleComponentFill(');
ok(handlerAt > 0, 'the handler exists');
const HANDLER = INDEX.slice(handlerAt, INDEX.indexOf('async function handleIntakeCreate(', handlerAt));
ok(/authority !== "syncview"[\s\S]{0,120}team_is_linear_authoritative/.test(HANDLER),
  'refuses a Linear-authoritative team rather than quietly taking the parity path');
ok(/legacy_parity: false/.test(HANDLER) && !/legacyParityAllowed/.test(HANDLER),
  'and the outbound row is never a parity copy');
ok(!/legacyParityAllowed\([^)]*component_fill/.test(POLICY),
  'policy does not widen legacyParityAllowed to this operation either');

/* ---- 4. Everything it inherits, it inherits ---------------------------- */

ok(/sort_key: sibling\.sort_key == null \? null : Number\(sibling\.sort_key\)/.test(HANDLER),
  'sort_key comes from the sibling, null included — the RPC refuses anything else');
ok(/due_date: clean\(sibling\.due_date\)/.test(HANDLER),
  'due date comes from the sibling: two halves of one post are due together');
ok(/componentFillTitle\(sibling\.title, team, purpose\)/.test(HANDLER),
  'the title is composed from the sibling, never from a batch ordinal');
ok(!/planAppendIntakeItems/.test(HANDLER),
  'and the append planner is not involved at all — a fill allocates nothing');

/* ---- 5. Idempotence is keyed on the CARD ------------------------------- */
/* A card can only ever gain one component of a given team, so there is nothing
   else for the id to distinguish; a retry from any tab is the same write. */

ok(/deterministicNativeId\("del", requestId, `\$\{team\}:fill:\$\{cardId\}`\)/.test(HANDLER),
  'the deliverable id is deterministic in (request, team, card)');
ok(/assertDedupIntent\(/.test(HANDLER) && /if \(!replay\)/.test(HANDLER),
  'an exact retry short-circuits before the RPC instead of racing it');

/* ---- 6. Refusals reach the browser as themselves ------------------------ */
/* Every one of these is a different thing for a reader to do. Flattened to
   `native_write_failed` they would all read as "try again", which is the
   defect PR #1192 existed to remove. */

/* EXECUTED, not grepped. The first draft of this block searched index.ts for
   each code as a literal and reported three false passes: the mapping is one
   grouped alternation, so only the fallback code appears literally and the
   other three never appear at all. A test that cannot fail for the right
   reason is not a test. So the real regexes are lifted out of the source and
   run against each code. */
function liftRegex(label) {
  const at = INDEX.indexOf(label);
  if (at < 0) return null;
  const line = INDEX.slice(INDEX.lastIndexOf('/', at - 1), INDEX.indexOf('/i.test', at) + 2);
  const body = line.slice(1, line.lastIndexOf('/i'));
  try { return new RegExp(body, 'i'); } catch (e) { return null; }
}

const conflictRe = liftRegex('component_fill_(sibling_missing|card_mismatch|team_occupied|sort_mismatch)');
ok(!!conflictRe, 'rpc() carries a mapping for the fill\'s conflict-class refusals');
for (const code of ['component_fill_sibling_missing', 'component_fill_card_mismatch',
  'component_fill_team_occupied', 'component_fill_sort_mismatch']) {
  /* Matched against the shape PostgreSQL actually returns, which is the raise
     text inside a longer message, not the bare code. */
  const raised = 'ERROR:  ' + code + '\nCONTEXT:  PL/pgSQL function production_component_fill(...)';
  ok(!!conflictRe && conflictRe.test(raised),
    'rpc() maps ' + code + ' to its own 409 rather than flattening it to a 500');
}
ok(!!conflictRe && !conflictRe.test('ERROR:  component_fill_something_else'),
  'and the mapping is not a catch-all — an unknown component_fill_* code still surfaces as itself');

const payloadRe = liftRegex('invalid_component_fill_(payload|route)');
ok(!!payloadRe && payloadRe.test('ERROR:  invalid_component_fill_payload')
  && payloadRe.test('ERROR:  invalid_component_fill_route'),
  'and the two 400-class payload refusals keep their own codes too');

/* ---- 7. Executed: the title rule, both branches ------------------------ */
/* Measured 2026-08-31: of the 126 readable siblings behind the 127 cards
   missing one component, 65 are numbered and 61 are human-titled. A rule that
   only handled one of those shapes would serve about half the population. */

(async () => {
  const { componentFillTitle } = await import(
    'file://' + path.join(FN, 'policy.mjs'));

  const cases = [
    // Numbered: the counterpart at the SAME number, never the next free one.
    ['Video 9', 'graphics', 'calendar', 'Thumbnail 9'],
    ['Thumbnail 9', 'video', 'calendar', 'Video 9'],
    ['Video 10', 'graphics', 'calendar', 'Thumbnail 10'],
    // Human-titled: MIRRORED. This is the pre-flip convention, not a fallback —
    // VID-13226 and GRA-7058 are both 'video-9'.
    ['Video 6 - Before Coming To Us', 'graphics', 'calendar', 'Video 6 - Before Coming To Us'],
    ['Doug Cartwright | Jun. 29 - Jul. 5 | Reel 4', 'graphics', 'calendar',
      'Doug Cartwright | Jun. 29 - Jul. 5 | Reel 4'],
    // A zero-padded number is NOT this estate's numbering vocabulary: the
    // append RPC's own regex is [1-9][0-9]*, so 'Video 02' mirrors.
    ['Video 02', 'graphics', 'calendar', 'Video 02'],
    // The 'Sample ' prefix comes from the BATCH's purpose, never the sibling's
    // spelling — the first samples batch predates the ruling and reads 'Video 1'.
    ['Video 3', 'graphics', 'samples', 'Sample Thumbnail 3'],
    ['Sample Video 3', 'graphics', 'samples', 'Sample Thumbnail 3'],
    ['Video 3', 'graphics', 'calendar', 'Thumbnail 3'],
    // Refusals.
    ['', 'graphics', 'calendar', ''],
    ['Video 9', 'marketing', 'calendar', ''],
  ];
  for (const [title, team, purpose, want] of cases) {
    const got = componentFillTitle(title, team, purpose);
    ok(got === want,
      JSON.stringify(title) + ' + ' + team + '/' + purpose + ' -> ' + JSON.stringify(got)
        + (got === want ? '' : '  (expected ' + JSON.stringify(want) + ')'));
  }

  console.log(failures === 0
    ? '\ncomponent_fill gateway checks passed'
    : '\n' + failures + ' component_fill gateway check(s) failed');
  process.exit(failures === 0 ? 0 : 1);
})();
