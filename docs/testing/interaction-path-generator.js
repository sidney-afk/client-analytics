#!/usr/bin/env node
/* Interaction-path generator for one review component across SMM / Client / Kasper.
 *
 * WHY: the rich bugs live in multi-step, multi-actor sequences — "Kasper approves,
 * then client requests a change, then SMM resolves to client, then client
 * approves…". Hand-listing those is infinite. Instead we encode the app's real
 * status graph ONCE and let a depth-first walk enumerate every branch — exactly
 * the "go deep, backtrack, take the next path" process, but exhaustive.
 *
 * The transitions below mirror index.html:
 *   - SMM moves work forward / resolves the last tweak to Kasper or Client
 *     (_calApplyAutoStatus: 'smm_resolved_last' -> Kasper Approval | Client Approval)
 *   - Kasper approve -> Client Approval (_kasperApproveComp); request-change /
 *     approve-after-tweaks -> Tweaks Needed (_kasperRequestTweakComp); undo-approve
 *   - Client request-change -> Tweaks Needed (_calApplyAutoStatus 'client_added');
 *     client approve -> Approved
 *
 * Run: node docs/testing/interaction-path-generator.js [--cycles=2] [--max-depth=14] [--print=all|paths|pairs]
 */
const S = {
  IP: 'In Progress', SA: 'For SMM Approval', KA: 'Kasper Approval',
  TN: 'Tweaks Needed', CA: 'Client Approval', AP: 'Approved',
  PO: 'Posted', AR: 'Archived',
};
const START = S.IP;
const TERMINALS = new Set([S.PO, S.AR]);   // a path ends here

// Concrete edges: { actor, action, from, to }
const EDGES = [
  { actor: 'SMM',    action: 'submit for SMM approval',     from: S.IP, to: S.SA },
  { actor: 'SMM',    action: 'send to Kasper',              from: S.IP, to: S.KA },
  { actor: 'SMM',    action: 'send to Kasper',              from: S.SA, to: S.KA },
  { actor: 'Kasper', action: 'approve → client',            from: S.KA, to: S.CA },
  { actor: 'Kasper', action: 'request change',              from: S.KA, to: S.TN },
  { actor: 'Kasper', action: 'approve after tweaks',        from: S.KA, to: S.TN }, // preapproved-for-client
  { actor: 'SMM',    action: 'resolve last tweak → Kasper', from: S.TN, to: S.KA },
  { actor: 'SMM',    action: 'resolve last tweak → client', from: S.TN, to: S.CA },
  { actor: 'Client', action: 'request change',              from: S.CA, to: S.TN },
  { actor: 'Client', action: 'approve',                     from: S.CA, to: S.AP },
  { actor: 'Kasper', action: 'undo approve',                from: S.CA, to: S.KA },
  { actor: 'SMM',    action: 'mark posted',                 from: S.AP, to: S.PO },
];
// Archive is reachable from every non-terminal state (SMM). Kept as its own set so
// it doesn't blow up every path; the walker adds it as an optional branch.
const ARCHIVABLE = [S.IP, S.SA, S.KA, S.TN, S.CA, S.AP];

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)=(.*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));
const MAX_CYCLES = parseInt(args['cycles'] || '2', 10);   // max times a single state may repeat
const MAX_DEPTH  = parseInt(args['max-depth'] || '14', 10);
const PRINT = args['print'] || 'all';

function edgesFrom(state) {
  const out = EDGES.filter(e => e.from === state);
  if (ARCHIVABLE.includes(state)) out.push({ actor: 'SMM', action: 'archive', from: state, to: S.AR });
  return out;
}

// DFS enumerating paths. A state may be re-entered up to MAX_CYCLES times so tweak
// loops (request-change → resolve → request-change …) are covered without infinite
// recursion. Stops at a terminal or the depth cap.
const paths = [];
function walk(state, visitedCount, trail) {
  if (TERMINALS.has(state) || trail.length >= MAX_DEPTH) { paths.push(trail.slice()); return; }
  const next = edgesFrom(state);
  if (!next.length) { paths.push(trail.slice()); return; }
  let branched = false;
  for (const e of next) {
    const c = (visitedCount[e.to] || 0);
    if (c >= MAX_CYCLES) continue;                 // don't revisit a state too many times
    branched = true;
    walk(e.to, Object.assign({}, visitedCount, { [e.to]: c + 1 }), trail.concat(e));
  }
  if (!branched) paths.push(trail.slice());        // dead-end under the cycle cap
}
walk(START, { [START]: 1 }, []);

// Transition-PAIR coverage: every (incoming action → outgoing action) adjacency.
// This is the strongest cheap criterion for actor-handoff bugs.
const pairs = new Set();
for (const p of paths) for (let i = 0; i + 1 < p.length; i++) {
  pairs.add(`${p[i].actor}:${p[i].action}  ▶  ${p[i + 1].actor}:${p[i + 1].action}`);
}

function fmt(p) {
  return p.map(e => `${e.actor}[${e.action}]→${e.to}`).join('  ');
}

if (PRINT === 'all' || PRINT === 'paths') {
  console.log(`\n=== ${paths.length} interaction PATHS (start "${START}", cycles≤${MAX_CYCLES}, depth≤${MAX_DEPTH}) ===\n`);
  paths
    .sort((a, b) => a.length - b.length)
    .forEach((p, i) => console.log(`#${String(i + 1).padStart(3)} (${p.length} steps)  ${START}  ${fmt(p)}`));
}
if (PRINT === 'all' || PRINT === 'pairs') {
  console.log(`\n=== ${pairs.size} transition-PAIRS (actor hand-off adjacencies to cover) ===\n`);
  [...pairs].sort().forEach((p, i) => console.log(`${String(i + 1).padStart(3)}. ${p}`));
}
console.log(`\nSUMMARY: ${paths.length} paths, ${pairs.size} transition-pairs, ${EDGES.length + ARCHIVABLE.length} edges (incl. archive).`);
console.log('Each PATH = one end-to-end probe. Each PAIR = an adjacency every test set must include at least once.');
