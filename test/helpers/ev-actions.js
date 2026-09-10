'use strict';
// The event actions a writer source can emit -- and, more importantly, a
// refusal to guess.
//
// WHY THIS IS NOT A REGEX. The first version of this gate was
// /ev\(\s*"([a-z_]+)"/g, which has two failure modes and both are silent,
// which is the worst property a guard can have:
//
//   1. It reported ev("approve_" + comp) as the action `approve_`. No such
//      action exists; production holds approve_caption / approve_graphic /
//      approve_title / approve_video, all composed from that one call. So the
//      register recorded a fiction.
//   2. Anything that was not a bare double-quoted literal was INVISIBLE.
//      ev('x'), a template literal, or `const a = "kasper_urgent_ping"; ev(a)`
//      would all have slipped a re-introduced branch past the very gate built
//      to stop it.
//
// So this reads each `ev(` call site, takes its first argument, and sorts it
// into exactly one of three buckets. The third is the point: an argument this
// cannot resolve is reported as UNRESOLVED and fails the gate by name, rather
// than being dropped. Widening the accepted forms is a deliberate edit here;
// narrowing one by accident is not available. (Codex P2 on PR 1383.)
//
// Comment removal is delegated to test/helpers/strip-comments.js rather than
// hand-rolled. A first draft of this file carried its own stateful scanner --
// exactly the approach that helper's header rejects with measurements, because
// a JS scanner drifts on an apostrophe in prose and on regex literals holding
// quotes. Trailing line comments survive that stripper by design, so a stray
// `// ev("x")` becomes a loud failure here rather than a silent omission,
// which is the safe direction.

const { stripComments } = require('./strip-comments.js');

// The raw text of the first argument of a call whose `(` is at openIdx.
// String-aware so a comma or paren inside a literal does not end the argument.
function firstArg(src, openIdx) {
  let i = openIdx + 1;
  let depth = 0;
  const start = i;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) break;
        i++;
      }
      i++;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') { depth++; i++; continue; }
    if (c === ')' && depth === 0) return src.slice(start, i).trim();
    if (c === ')' || c === ']' || c === '}') { depth--; i++; continue; }
    if (c === ',' && depth === 0) return src.slice(start, i).trim();
    i++;
  }
  return src.slice(start).trim();
}

const LITERAL = /^(['"`])([A-Za-z0-9_]+)\1$/;
const PREFIXED = /^(['"`])([A-Za-z0-9_]+)\1\s*\+/;

// -> { actions: string[], unresolved: string[] }
// A composed action such as ev("approve_" + comp) is reported as the PREFIX
// form `approve_*`, which is the honest description of what the source can
// emit; the exact set depends on a runtime value this cannot see.
function evActions(source) {
  const src = stripComments(source);
  const actions = new Set();
  const unresolved = new Set();
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== 'e' || src[i + 1] !== 'v') continue;
    let j = i + 2;
    while (j < src.length && /\s/.test(src[j])) j++;
    if (src[j] !== '(') continue;
    const before = i > 0 ? src[i - 1] : '';
    if (/[A-Za-z0-9_$.]/.test(before)) continue;   // not a bare `ev(` call
    const arg = firstArg(src, j);
    let m;
    if ((m = arg.match(LITERAL))) actions.add(m[2]);
    else if ((m = arg.match(PREFIXED))) actions.add(m[2] + '*');
    else unresolved.add(arg.replace(/\s+/g, ' ').slice(0, 60));
  }
  return { actions: [...actions].sort(), unresolved: [...unresolved].sort() };
}

// Is `action` proven by a verified-live list? A literal is covered by a prefix
// it falls under; a prefix is covered only by the identical prefix, since it
// can emit more than any one literal proves.
function coveredBy(action, liveList) {
  if (liveList.includes(action)) return true;
  if (action.endsWith('*')) return false;
  return liveList.some(l => l.endsWith('*') && action.startsWith(l.slice(0, -1)));
}

module.exports = { evActions, coveredBy };
