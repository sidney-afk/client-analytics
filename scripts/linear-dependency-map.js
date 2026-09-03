#!/usr/bin/env node
/*
 * linear-dependency-map.js — which LIVE entry points still depend on Linear?
 *
 * WHY THIS EXISTS. On 2026-09-03 a hand-written audit of the Linear exit got
 * this question wrong twice in one session, in opposite directions:
 *
 *   1. It reported that native Create Post blocks on a live Linear read, citing
 *      `linearStateIdForCreate` inside `handleProductionCreate`. That function
 *      begins with an unconditional `throw new GatewayError(403,
 *      "production_create_closed")` (owner ruling 2026-08-23), so every Linear
 *      call it makes is UNREACHABLE. The claim was true of dead code.
 *   2. Correcting that, it then reported that the calendar's real create path
 *      (`handleIntakeCreate`) touches Linear nowhere -- because a grep for
 *      Linear calls INSIDE that function's line range finds none. It reaches
 *      `readLinearProject` INDIRECTLY, through `projectForIntake`.
 *
 * Both mistakes have the same root: reading for the PRESENCE of a Linear call
 * near a name, instead of computing REACHABILITY from a live entry point. A
 * person cannot hold a 7,000-line call graph in their head, and should not try.
 *
 * WHAT IT DOES. Builds the call graph of an Edge Function, marks code that
 * cannot execute, and reports for every entry point whether some path from it
 * reaches a Linear API call -- and if so, the shortest such path.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It is a static approximation, not a proof:
 *   - it resolves calls by NAME, so a function invoked only through a variable
 *     or a property is missed (none in this estate today, asserted by the test);
 *   - it treats a top-level `throw` as terminating that function, which is the
 *     shape the closures in this estate actually take;
 *   - it says nothing about whether the file is DEPLOYED. Several functions in
 *     docs/ops/EF_DEPLOY_MANIFEST.md carry NO CI DEPLOY PATH, so repo source is
 *     not live source and a clean report here does not make the live function
 *     clean. That check is the manifest's job and is printed alongside.
 * It exists to stop a confident wrong answer, not to replace reading the code.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* Two different things wear the word "Linear" and only one of them is a
 * dependency. `api.linear.app` is a live HTTP call: it fails when Linear is
 * down or gone. `LINEAR_VIDEO_TEAM_ID` is an environment string: it keeps
 * working forever. A first draft of this file counted both and reported
 * handleComponentFill as needing Linear because it reads a team id out of
 * `Deno.env` -- a false alarm that would have sent someone rewriting a function
 * that has no network dependency at all. */
const API_SINK = /api\.linear\.app/;
const CONFIG_SINK = /LINEAR_[A-Z_]*(?:TEAM_ID|PROJECT|KEY)/;
const FN_DECL = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*[(<]/;

/* A function's body ends at its OWN closing brace -- the next line that is
 * exactly `}` in column 0 -- not at the next declaration. The difference is not
 * academic: a first draft ended each function at the following one, which swept
 * every top-level `const` in between into the preceding function's body. That
 * put `const LINEAR_URL = "https://api.linear.app/graphql"` inside whatever
 * function happened to sit above it and reported a Linear dependency there.
 *
 * Within a body, a `throw` at body indentation ends the function: everything
 * below it is code the runtime can never reach, and counting it is mistake (1). */
function parseFunctions(source) {
  const lines = source.split('\n');
  const fns = [];
  let current = null;
  lines.forEach((line, i) => {
    if (current && /^\}/.test(line)) { current.end = i; fns.push(current); current = null; return; }
    if (current) {
      if (current.deadFrom === null && /^ {2}throw\s/.test(line)) current.deadFrom = i;
      return;
    }
    const m = FN_DECL.exec(line);
    if (m) current = { name: m[1], start: i, end: lines.length - 1, deadFrom: null };
  });
  if (current) fns.push(current);
  return { fns, lines };
}

/* The endpoint is usually reached through a top-level constant rather than a
 * literal: `const LINEAR_URL = "https://api.linear.app/graphql"` and then
 * `fetch(LINEAR_URL, ...)` somewhere else entirely. Matching only the literal
 * finds the declaration -- which belongs to no function -- and reports that
 * NOTHING in linear-outbound talks to Linear, a claim absurd on its face and
 * exactly the kind this tool exists to prevent. So every top-level constant
 * holding the endpoint becomes a sink name in its own right. */
function sinkAliases(source) {
  const names = new Set();
  const re = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*[`"'][^`"']*api\.linear\.app/gm;
  let m;
  while ((m = re.exec(source))) names.add(m[1]);
  return names;
}

function analyze(file) {
  const source = fs.readFileSync(file, 'utf8');
  const { fns, lines } = parseFunctions(source);
  const aliases = sinkAliases(source);
  const aliasRe = aliases.size
    ? new RegExp('\\b(?:' + [...aliases].map(n => n.replace(/\$/g, '\\$')).join('|') + ')\\b')
    : null;
  const byName = new Map(fns.map(f => [f.name, f]));
  const names = [...byName.keys()];

  for (const fn of fns) {
    const liveEnd = fn.deadFrom === null ? fn.end : fn.deadFrom;
    const live = lines.slice(fn.start, liveEnd + 1).join('\n');
    const dead = fn.deadFrom === null ? '' : lines.slice(fn.deadFrom + 1, fn.end + 1).join('\n');
    const hits = text => API_SINK.test(text) || (aliasRe ? aliasRe.test(text) : false);
    fn.sinkLive = hits(live);
    fn.sinkDead = !fn.sinkLive && hits(dead);
    fn.configOnly = !fn.sinkLive && CONFIG_SINK.test(live);
    fn.calls = new Set();
    fn.deadCalls = new Set();
    for (const n of names) {
      if (n === fn.name) continue;
      const re = new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\s*\\(');
      if (re.test(live)) fn.calls.add(n);
      else if (dead && re.test(dead)) fn.deadCalls.add(n);
    }
    fn.deadLines = fn.deadFrom === null ? 0 : fn.end - fn.deadFrom;
  }

  // Shortest path from each function to a live Linear sink, over live edges only.
  const pathTo = new Map();
  const queue = [];
  for (const fn of fns) if (fn.sinkLive) { pathTo.set(fn.name, [fn.name]); queue.push(fn.name); }
  while (queue.length) {
    const at = queue.shift();
    for (const fn of fns) {
      if (pathTo.has(fn.name) || !fn.calls.has(at)) continue;
      pathTo.set(fn.name, [fn.name, ...pathTo.get(at)]);
      queue.push(fn.name);
    }
  }
  return { fns, byName, pathTo, file };
}

function report(result, entryPattern) {
  const { fns, pathTo, file } = result;
  const out = [];
  out.push(`\n${path.basename(path.dirname(file))}/${path.basename(file)}`);
  const dead = fns.filter(f => f.deadLines > 0);
  if (dead.length) {
    out.push('  unreachable tails (code after a top-level throw):');
    for (const f of dead) {
      out.push(`    ${f.name}: ${f.deadLines} lines dead${f.sinkDead ? '  ← contains a Linear call that CANNOT run' : ''}`);
    }
  }
  const entries = fns.filter(f => entryPattern.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (entries.length) {
    out.push('  entry points:');
    for (const f of entries) {
      const p = pathTo.get(f.name);
      out.push(p
        ? `    NEEDS LINEAR  ${f.name}  via  ${p.join(' → ')}`
        : `    linear-free   ${f.name}`);
    }
    return out.join('\n');
  }
  /* No function matches the entry-point convention. Printing an empty section
   * here would read as "nothing in this file depends on Linear", which is the
   * silent-wrong this tool exists to prevent -- so say what was actually found
   * instead, and say that the entry points were not identified. */
  const reaching = fns.filter(f => pathTo.has(f.name)).map(f => f.name).sort();
  out.push(`  no function matches the entry-point convention (${entryPattern}) — reporting raw reachability:`);
  out.push(reaching.length
    ? `    ${reaching.length} function(s) reach the Linear API: ${reaching.join(', ')}`
    : '    no function in this file reaches the Linear API');
  return out.join('\n');
}

function main() {
  const targets = process.argv.slice(2);
  const files = targets.length ? targets : [
    'supabase/functions/production-write/index.ts',
    'supabase/functions/linear-outbound/index.ts',
    'supabase/functions/workload-linear/index.ts',
    'supabase/functions/deliverable-write/index.ts',
    'supabase/functions/batch-write/index.ts',
    'supabase/functions/production-comments/index.ts',
  ].filter(f => fs.existsSync(f));
  const entryPattern = /^handle[A-Z]/;
  console.log('Linear dependency map — reachability from live entry points.');
  console.log('A "linear-free" entry can commit with the Linear API unreachable.');
  console.log('"NEEDS LINEAR" means SOME path reaches the API — it may be one');
  console.log('branch of the handler, not every call. Read the named path before');
  console.log('concluding the whole entry point is blocked (handleEntityOperation');
  console.log('reaches it only on the assignee branch; status/due/description do not).');
  console.log('DEPLOYMENT IS A SEPARATE QUESTION: see docs/ops/EF_DEPLOY_MANIFEST.md.');
  for (const f of files) console.log(report(analyze(f), entryPattern));
  console.log('');
}

if (require.main === module) main();
module.exports = { analyze, parseFunctions };
