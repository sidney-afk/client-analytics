'use strict';
/*
 * Extract the event actions a writer source can emit — and, more importantly,
 * refuse to guess.
 *
 * WHY THIS IS NOT A REGEX. The first version of this was
 * /ev\(\s*"([a-z_]+)"/g, which has two failure modes and both of them are
 * silent, which is the worst property a guard can have:
 *
 *   1. It reported `ev("approve_" + comp)` as the action `approve_`. No such
 *      action exists; production holds approve_caption / approve_graphic /
 *      approve_title / approve_video. So the register recorded a fiction.
 *   2. Anything not a bare double-quoted literal was INVISIBLE. Single quotes,
 *      a template literal, or `const a = "kasper_urgent_ping"; ev(a)` would all
 *      have slipped a re-introduced branch past the very gate built to stop it.
 *
 * So this reads each `ev(` call site, takes its first argument, and classifies
 * it into exactly one of three buckets. The third bucket is the point: an
 * argument this cannot resolve is reported as UNRESOLVED and fails the gate by
 * name, rather than being dropped. Widening the accepted forms is a deliberate
 * edit here; obscuring one is not possible by accident. (Codex P2 on PR 1383.)
 */

/* Strip comments without being fooled by strings, template literals or regex
 * literals — a naive strip eats the // in an https:// URL and corrupts
 * everything after it. */
function stripComments(src) {
  let out = '';
  let i = 0;
  let prevSignificant = '';
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      prevSignificant = quote;
      continue;
    }
    // A `/` here is a regex literal only where a value may begin.
    if (c === '/' && /[(,=:[!&|?{};+\-*%~^]/.test(prevSignificant)) {
      out += c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] || ''); i += 2; continue; }
        if (src[i] === '[') { while (i < src.length && src[i] !== ']') { out += src[i]; i++; } }
        out += src[i];
        if (src[i] === '/') { i++; break; }
        i++;
      }
      prevSignificant = '/';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return out;
}

/* The raw text of the first argument of a call whose `(` is at openIdx. */
function firstArg(src, openIdx) {
  let i = openIdx + 1;
  let depth = 0;
  let start = i;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c; i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) break;
        i++;
      }
      i++; continue;
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

/* -> { actions: string[], unresolved: string[] }
 * A composed action such as ev("approve_" + comp) is reported as the PREFIX
 * form `approve_*`, because that is the honest description of what the source
 * can emit; the exact set depends on a runtime value this cannot see. */
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
    if (/[A-Za-z0-9_$.]/.test(before)) continue;    // not a bare `ev(` call
    const arg = firstArg(src, j);
    let m;
    if ((m = arg.match(LITERAL))) actions.add(m[2]);
    else if ((m = arg.match(PREFIXED))) actions.add(m[2] + '*');
    else unresolved.add(arg.replace(/\s+/g, ' ').slice(0, 60));
  }
  return { actions: [...actions].sort(), unresolved: [...unresolved].sort() };
}

/* A repo action is covered by the verified-live list if the list names it
 * outright, or names a prefix form it falls under. A prefix form is covered
 * only by the identical prefix — `approve_*` is not proven by `approve_video`,
 * because the source can emit more than that one. */
function coveredBy(action, liveList) {
  if (liveList.includes(action)) return true;
  if (action.endsWith('*')) return false;
  return liveList.some(l => l.endsWith('*') && action.startsWith(l.slice(0, -1)));
}

module.exports = { evActions, coveredBy, stripComments };
