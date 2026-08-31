'use strict';
/*
 * A `let team` became a Set, and a bare `team` was left in the event payload.
 *
 * Caught by Codex on PR 1188, AFTER merge and before deploy. Undeclared in the
 * function, so it would have thrown on every `batch_asset` request — the exact
 * operation that change existed to unbreak — and taken the round-3 P0 fix with
 * it. Nothing in this repo's 339 unit suites noticed, because they all read the
 * source as text and never ask whether an identifier resolves.
 *
 * The edge function is TypeScript for Deno, so `node --check` cannot see it and
 * there is no typecheck step in the unit lane. This is the cheap substitute:
 * strip strings, template literals, comments and property accesses from a
 * handler body, then require that every remaining bare identifier is either
 * declared inside it, a parameter, or a name the module defines.
 *
 * It is deliberately NARROW — the handlers listed below, not the whole file —
 * because a whole-file version would need real scope analysis to avoid false
 * positives, and a check that cries wolf gets deleted. These are the handlers
 * that resolve a scope and then build an event from it, which is the shape that
 * produced the bug.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.resolve(__dirname, '..', 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Brace matcher that understands strings, templates and comments — the same
   shape used across this estate, because a naive one drifts through a regex or
   an apostrophe and reports nonsense. */
function grabFunc(name) {
  const marker = SRC.indexOf('async function ' + name + '(');
  const at = marker >= 0 ? marker : SRC.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('handler not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    const c = SRC[j], next = SRC[j + 1];
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
    else if (c === '}') { depth--; if (depth === 0) return SRC.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

/* TOP-LEVEL declarations only, anchored to column zero, plus everything the
   sibling modules export.

   The first draft collected EVERY `const X` in the file, which swept up
   function-local names from the other handlers -- `const team` appears in seven
   of them -- and made the check blind to the exact bug it exists for. Its own
   harness self-check caught that, which is the reason that check is here. */
const moduleNames = new Set();
for (const re of [
  /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
  /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
  /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
  /^(?:export\s+)?(?:type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm,
]) {
  let m;
  while ((m = re.exec(SRC))) moduleNames.add(m[1]);
}
/* Imports, including the multi-line `{ ... }` lists this file uses, and the
   named exports of every sibling module it pulls from. */
for (const m of SRC.matchAll(/\bimport\s+(?:type\s+)?\{([\s\S]*?)\}\s*from/g)) {
  for (const piece of m[1].split(',')) {
    const nm = piece.trim().split(/\s+as\s+/).pop().trim();
    if (/^[A-Za-z_$][\w$]*$/.test(nm)) moduleNames.add(nm);
  }
}
for (const m of SRC.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s+from/g)) moduleNames.add(m[1]);
for (const sibling of ['policy.mjs']) {
  const file = path.resolve(__dirname, '..', 'supabase', 'functions', 'production-write', sibling);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    moduleNames.add(m[1]);
  }
}

const GLOBALS = new Set([
  'true', 'false', 'null', 'undefined', 'this', 'void', 'typeof', 'instanceof', 'in', 'of',
  'new', 'return', 'throw', 'await', 'async', 'function', 'const', 'let', 'var', 'if', 'else',
  'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'try', 'catch',
  'finally', 'delete', 'as', 'is', 'keyof', 'readonly', 'extends', 'implements', 'satisfies',
  'string', 'number', 'boolean', 'any', 'unknown', 'never', 'object', 'symbol', 'bigint',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Math', 'JSON', 'Date', 'Set', 'Map',
  'Promise', 'Error', 'RegExp', 'Symbol', 'BigInt', 'Response', 'Request', 'Headers', 'URL',
  'URLSearchParams', 'TextEncoder', 'TextDecoder', 'crypto', 'console', 'globalThis', 'Deno',
  'AbortController', 'AbortSignal', 'Uint8Array', 'ArrayBuffer', 'Record', 'Partial', 'Pick',
  'Omit', 'Array', 'ReadonlyArray', 'Iterable', 'AsyncIterable', 'Function', 'isNaN', 'parseInt',
  'parseFloat', 'setTimeout', 'clearTimeout', 'structuredClone', 'fetch', 'Infinity', 'NaN',
]);

function undeclaredIn(body) {
  // Parameters, then every binding introduced inside.
  const local = new Set();
  const header = body.slice(0, body.indexOf('{') + 1);
  for (const m of header.matchAll(/([A-Za-z_$][\w$]*)\s*[:,)]/g)) local.add(m[1]);
  for (const m of body.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  // Destructuring, both shapes.
  for (const m of body.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}/g)) {
    for (const piece of m[1].split(',')) {
      const nm = piece.split(':').pop().trim().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) local.add(nm);
    }
  }
  for (const m of body.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]/g)) {
    for (const piece of m[1].split(',')) {
      const nm = piece.trim().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) local.add(nm);
    }
  }
  // for..of / for..in bindings, catch bindings, and arrow parameters.
  for (const m of body.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  for (const m of body.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  for (const m of body.matchAll(/\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/g)) local.add(m[1]);
  for (const m of body.matchAll(/\(([^)]*)\)\s*=>/g)) {
    for (const piece of m[1].split(',')) {
      const nm = piece.trim().split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) local.add(nm);
    }
  }

  /* Strip everything that is not a bare identifier reference: comments,
     strings, template literals, then property accesses and object KEYS.
     Shorthand (`team,`) survives on purpose — it is exactly the bug. */
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\.|[^`\\])*`/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, ' ')
    .replace(/\.\s*[A-Za-z_$][\w$]*/g, ' ')
    .replace(/([A-Za-z_$][\w$]*)\s*:/g, ' ');

  const missing = new Set();
  for (const m of stripped.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    const nm = m[1];
    if (local.has(nm) || moduleNames.has(nm) || GLOBALS.has(nm)) continue;
    missing.add(nm);
  }
  return [...missing];
}

/* ---- 1. The harness is not vacuous ------------------------------------- */
/* Proved by feeding it the ACTUAL bug: a body that reads `team` with only
   `teams` declared. If this stops failing, the check has gone blind and every
   assertion below is worthless. */
{
  const fake = `async function fakeHandler(a, b) {
    const teams = new Set();
    const event = build({ slot, team, });
    return event;
  }`;
  const found = undeclaredIn(fake);
  ok(found.includes('team'),
    'THE HARNESS CHECK: the shipped bug shape is detected (bare `team` with only `teams` declared)');
  ok(!found.includes('teams'),
    '...while the declared Set is not reported, so this is not just flagging everything');
}

/* ---- 2. The handlers that resolve a scope and build an event from it ---- */

const HANDLERS = [
  'handleBatchAssetWrite',
  'handleBatchFilesRead',
  'handleAssetAccessRead',
];

for (const name of HANDLERS) {
  let body;
  try { body = grabFunc(name); } catch (e) { ok(false, name + ': ' + e.message); continue; }
  const missing = undeclaredIn(body);
  ok(missing.length === 0,
    name + ' references no undeclared identifier'
    + (missing.length ? ' — SAW: ' + missing.join(', ') : ''));
}

/* ---- 3. The specific repair, pinned ------------------------------------ */

const batchAsset = grabFunc('handleBatchAssetWrite');
ok(/const scopeTeams = \[\.\.\.teams\]\.sort\(\);/.test(batchAsset),
  'the event gets a deterministic team list, sorted so two identical writes cannot disagree');
ok(/const eventTeam = ownTeam \|\| scopeTeams\[0\];/.test(batchAsset),
  '...and a scalar that prefers the batch OWN stamp, falling back to the derived set');
ok(/team: eventTeam,/.test(batchAsset) && /teams: scopeTeams,/.test(batchAsset),
  'the event carries both -- a scalar for readers that expect one, and the full set because on a '
  + 'mixed batch a single team misdescribes what the write touched');
ok(!/^\s*team,\s*$/m.test(batchAsset),
  'and the bare shorthand that caused this is gone');

console.log(failures === 0
  ? '\nGateway identifier checks passed'
  : '\n' + failures + ' identifier check(s) failed');
process.exit(failures === 0 ? 0 : 1);
