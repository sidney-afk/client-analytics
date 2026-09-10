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
// Exactly `"prefix" + identifier`, nothing more. `"a" + b + "c"` does not match
// and therefore lands in UNRESOLVED, which is the safe direction.
const COMPOSED = /^(['"`])([A-Za-z0-9_]+)\1\s*\+\s*([A-Za-z_$][A-Za-z0-9_$]*)$/;

// The values an identifier can take, when it is bound by an enclosing
// `for (const ident of ["a", "b"])` whose block contains the call. Returns null
// when there is no such loop, when the array holds anything that is not a plain
// string literal, or when the loop does not actually enclose the call site.
//
// WHY THIS MATTERS. Reporting ev("approve_" + comp) as the wildcard `approve_*`
// hides the operand's DOMAIN, and the domain is the part that drifts: add
// "audio" to that loop and the repo can emit approve_audio while the register
// still reads approve_* on both sides, so parity stays green over a real new
// capability. Resolving the domain turns that into a named failure. An
// unresolvable composition is UNRESOLVED rather than a wildcard, because a
// wildcard is precisely the silent answer this file exists to refuse.
// (Codex P2 on PR 1383.)
function resolveDomain(src, callIdx, ident) {
  const re = new RegExp('for\\s*\\(\\s*const\\s+' + ident + '\\s+of\\s*\\[([^\\]]*)\\]\\s*\\)\\s*\\{', 'g');
  let found = null;
  let m;
  while ((m = re.exec(src))) {
    if (m.index > callIdx) break;
    const openIdx = m.index + m[0].length - 1;         // the loop body's `{`
    let depth = 0;
    let closeIdx = -1;
    for (let i = openIdx; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) { closeIdx = i; break; } }
    }
    if (closeIdx > callIdx) found = m[1];               // this loop encloses it
  }
  if (found === null) return null;
  const items = [...found.matchAll(/(['"`])([A-Za-z0-9_]+)\1/g)].map(x => x[2]);
  // Refuse the whole domain if any element is not a plain string literal.
  const leftover = found.replace(/(['"`])[A-Za-z0-9_]+\1/g, '').replace(/[\s,]/g, '');
  if (leftover.length || !items.length) return null;
  return items;
}

// -> { actions: string[], unresolved: string[] }
// A composed action such as ev("approve_" + comp) is expanded to the concrete
// set its loop can produce -- approve_video, approve_graphic, approve_caption,
// approve_title -- so a change to that loop's domain is visible here. If the
// domain cannot be resolved statically, the call is UNRESOLVED, never a
// wildcard.
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
    if ((m = arg.match(LITERAL))) { actions.add(m[2]); continue; }
    if ((m = arg.match(COMPOSED))) {
      const domain = resolveDomain(src, i, m[3]);
      if (domain) { for (const v of domain) actions.add(m[2] + v); continue; }
    }
    unresolved.add(arg.replace(/\s+/g, ' ').slice(0, 60));
  }
  return { actions: [...actions].sort(), unresolved: [...unresolved].sort() };
}

// Every action is concrete now, so coverage is plain membership. There is no
// wildcard to be generous about, which is the point: `approve_*` on both sides
// would have matched even when the two sides could emit different sets.
function coveredBy(action, liveList) {
  return liveList.includes(action);
}

module.exports = { evActions, coveredBy };
