'use strict';
/*
 * A post claimed twice by the SAME KIND of batch row now resolves instead of
 * vanishing.
 *
 * WHERE THIS CAME FROM. Liveness (archived loses) and provenance (native beats
 * mirror) already settle 13 of the 23 parent-uuid collisions in the estate. The
 * other 10 are two mirrors, or two natives — indistinguishable to both rules —
 * and were marked ambiguous and DROPPED, which deletes the post from Scene View
 * entirely. That is the failure a video editor reported on 2026-09-01.
 *
 * THE REASONING THAT WAS OVERTURNED, and it was written down in good faith:
 * "inventing a winner would show one batch's description under another's
 * parent". Measured across all 1,660 live batches, that is not the case being
 * run. In 8 of the 10 the two rows carry a BYTE-IDENTICAL name; the other 2
 * differ only by a typo of one post. They are one post imported twice, not two
 * posts competing. Dropping both costs the whole post and protects nobody.
 *
 * OWNER, 2026-09-02, asked what should separate them: "shouldn't you just look
 * at them and see what's the difference, like in the description, for example
 * ... whichever has the most description or most text wins?" Measured over the
 * 10, his instinct is half the answer and the better half of the two singles:
 * across all 23 collisions description length picks a unique winner 19 times
 * against 9 for sub-issue count. Over the 10 that actually reach this branch it
 * inverts — count decides 8, description decides 6 — so the rule uses both,
 * count first, and neither alone would do.
 *
 * THE CASCADE, in order, each rung only reached when the one above ties:
 *   1. liveness      — an archived claimant loses to a live one
 *   2. provenance    — `bat_` (the row SyncView writes to) beats `b1_b_`
 *   3. sub-issues    — the row the work actually hangs off
 *   4. description   — the row somebody actually wrote in
 *   5. lower id      — arbitrary ON PURPOSE, and deterministic: the projection
 *                      runs on every render, so a coin-flip would move a post's
 *                      title between reloads
 *
 * The 10 real collisions are replayed below as fixtures. Their post titles are
 * deliberately not included — this repository is public and the shape is what
 * proves the rule. `sameName` records the measurement that justified choosing
 * at all.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(source, name) {
  const at = source.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = source.indexOf('{', at); j < source.length; j++) {
    const c = source[j], next = source[j + 1];
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
    else if (c === '}') { depth--; if (depth === 0) return source.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

/* Both lifted from the page. Nothing below re-implements either. */
const resolve = new Function(
  grabFunc(INDEX, '_prodBatchClaimWins') + '\n'
  + grabFunc(INDEX, '_prodResolveBatchParentNodes')
  + '\nreturn _prodResolveBatchParentNodes;')();

const UUID = 'shared-parent-uuid';
const IDENT = 'VID-00000';

/* Builds the projection inputs for one collision: N batch rows all claiming the
   one parent, plus the deliverable rows that give each its sub-issue count. */
function build(claimants) {
  const batches = claimants.map(c => ({
    id: c.id,
    client_slug: 'acme',
    name: 'Post',
    status: c.status || 'active',
    description: 'x'.repeat(c.descLen || 0),
    linear_parent_ids: { video: { uuid: UUID, identifier: IDENT, url: 'https://linear.app/x/' + IDENT } },
  }));
  const rows = [];
  claimants.forEach(c => {
    for (let i = 0; i < (c.subs || 0); i++) {
      rows.push({ id: 'del_' + c.id + '_' + i, batch_id: c.id, raw_issue_parent_id: UUID,
        linear_issue_uuid: 'kid_' + c.id + '_' + i });
    }
  });
  return { batches, rows };
}
function winner(claimants, order) {
  const { batches, rows } = build(claimants);
  const ordered = order ? order.map(i => batches[i]) : batches;
  const out = resolve(rows, ordered, new Map());
  const nodes = [...out.nodes.values()].filter(n => n.identifier === IDENT);
  return nodes.length === 1 ? nodes[0].batchId : (nodes.length ? '<multiple>' : null);
}

/* ---- 1. Each rung of the cascade, in isolation -------------------------- */

ok(winner([{ id: 'b1_b_a', subs: 1 }, { id: 'b1_b_b', subs: 9 }]) === 'b1_b_b',
  'SUB-ISSUES: the row the work hangs off wins, 9 over 1');
ok(winner([{ id: 'b1_b_a', subs: 2, descLen: 50 }, { id: 'b1_b_b', subs: 2, descLen: 50 }]) === 'b1_b_a',
  'LOWER ID: with the counts tied, the lower id decides');
/* DESCRIPTION LENGTH IS DELIBERATELY NOT A RUNG, and this asserts its absence
   rather than trusting the comment. `_prodCacheBatchColumns` drops `description`
   from the first-paint snapshot, so a rule that read it would pick one winner on
   the cached render and another after hydration — and the winner IS the
   synthetic node's id, so a live `?d=` deep link would resolve to nothing.
   Raised by review on #1217. */
ok(winner([{ id: 'b1_b_a', subs: 4, descLen: 900 }, { id: 'b1_b_b', subs: 4, descLen: 10 }]) === 'b1_b_a',
  'DESCRIPTION IS IGNORED: the longer description does NOT win — it is absent from the cached projection, so using it would move the node id between the cached and the live render');
ok(winner([{ id: 'b1_b_a', subs: 4 }, { id: 'b1_b_b', subs: 4 }]) === 'b1_b_a'
  && winner([{ id: 'b1_b_a', subs: 4, descLen: 900 }, { id: 'b1_b_b', subs: 4, descLen: 10 }]) === 'b1_b_a',
  'and the answer is IDENTICAL with descriptions absent and present — which is exactly the cached-vs-live equivalence the rung was removed to guarantee');

/* ---- 2. It cannot leak past the rungs above it -------------------------- */

ok(winner([{ id: 'bat_a', subs: 0, descLen: 0 }, { id: 'b1_b_b', subs: 99, descLen: 9999 }]) === 'bat_a',
  'PROVENANCE STILL OUTRANKS IT: an empty NATIVE row still beats a mirror carrying 99 sub-issues — the native is the row SyncView writes to');
ok(winner([{ id: 'b1_b_a', subs: 99, descLen: 9999, status: 'archived' }, { id: 'b1_b_b', subs: 0, descLen: 0 }]) === 'b1_b_b',
  'LIVENESS STILL OUTRANKS IT: an archived row loses to a live one however much work it carries');

/* ---- 3. Deterministic under every arrival order ------------------------- */

{
  const c = [{ id: 'b1_b_a', subs: 2, descLen: 50 }, { id: 'b1_b_b', subs: 2, descLen: 50 },
             { id: 'b1_b_c', subs: 2, descLen: 50 }];
  const orders = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  const answers = new Set(orders.map(o => winner(c, o)));
  ok(answers.size === 1 && answers.has('b1_b_a'),
    'ALL SIX arrival orders of a three-way tie give the same winner — the projection reruns on every render, and a title that moves between reloads is its own bug');
}

/* ---- 4. The ten real collisions, replayed ------------------------------- */

/* The SHAPES of the ten real collisions, measured from live data 2026-09-02.
   ANONYMISED: this repository is public, so client slugs and production batch
   primary keys are replaced with synthetic labels — raised by review on #1217,
   and right. What is preserved is everything the rule reads: the number of
   claimants, each one's kind prefix (`bat_` vs `b1_b_`, which provenance
   reads), their WITHIN-GROUP ID ORDER (which the lower-id rung reads), their
   sub-issue counts and description lengths. `sameName` records the measurement
   that justifies choosing a winner at all: 8 of the 10 carry a byte-identical
   name across their claimants. `descLen` is retained as a fixture field even
   though the rule no longer reads it — it is what makes the two cache-unstable
   groups visible, and those are the reason the rung came out. */
const REAL = [
  {
    "client": "client-A",
    "claimants": [
      {
        "id": "b1_b_a0",
        "status": "active",
        "subs": 0,
        "descLen": 482
      },
      {
        "id": "b1_b_a1",
        "status": "active",
        "subs": 1,
        "descLen": 482
      }
    ],
    "sameName": true
  },
  {
    "client": "client-B",
    "claimants": [
      {
        "id": "b1_b_b0",
        "status": "active",
        "subs": 4,
        "descLen": 942
      },
      {
        "id": "b1_b_b1",
        "status": "active",
        "subs": 1,
        "descLen": 942
      }
    ],
    "sameName": false
  },
  {
    "client": "client-C",
    "claimants": [
      {
        "id": "b1_b_c0",
        "status": "active",
        "subs": 8,
        "descLen": 2532
      },
      {
        "id": "b1_b_c1",
        "status": "active",
        "subs": 2,
        "descLen": 2002
      }
    ],
    "sameName": true
  },
  {
    "client": "client-D",
    "claimants": [
      {
        "id": "b1_b_d0",
        "status": "active",
        "subs": 2,
        "descLen": 1070
      },
      {
        "id": "b1_b_d1",
        "status": "active",
        "subs": 2,
        "descLen": 1266
      }
    ],
    "sameName": true
  },
  {
    "client": "client-E",
    "claimants": [
      {
        "id": "bat_e0",
        "status": "active",
        "subs": 1,
        "descLen": 98
      },
      {
        "id": "bat_e1",
        "status": "active",
        "subs": 8,
        "descLen": 98
      }
    ],
    "sameName": true
  },
  {
    "client": "client-F",
    "claimants": [
      {
        "id": "b1_b_f0",
        "status": "active",
        "subs": 2,
        "descLen": 480
      },
      {
        "id": "b1_b_f1",
        "status": "active",
        "subs": 2,
        "descLen": 972
      },
      {
        "id": "b1_b_f2",
        "status": "active",
        "subs": 5,
        "descLen": 719
      }
    ],
    "sameName": true
  },
  {
    "client": "client-G",
    "claimants": [
      {
        "id": "b1_b_g0",
        "status": "active",
        "subs": 19,
        "descLen": 3967
      },
      {
        "id": "b1_b_g1",
        "status": "active",
        "subs": 2,
        "descLen": 2983
      }
    ],
    "sameName": true
  },
  {
    "client": "client-H",
    "claimants": [
      {
        "id": "b1_b_h0",
        "status": "active",
        "subs": 4,
        "descLen": 828
      },
      {
        "id": "b1_b_h1",
        "status": "active",
        "subs": 1,
        "descLen": 458
      },
      {
        "id": "b1_b_h2",
        "status": "active",
        "subs": 4,
        "descLen": 644
      }
    ],
    "sameName": true
  },
  {
    "client": "client-I",
    "claimants": [
      {
        "id": "b1_b_i0",
        "status": "active",
        "subs": 1,
        "descLen": 610
      },
      {
        "id": "b1_b_i1",
        "status": "active",
        "subs": 20,
        "descLen": 1228
      }
    ],
    "sameName": true
  },
  {
    "client": "client-J",
    "claimants": [
      {
        "id": "b1_b_j0",
        "status": "active",
        "subs": 4,
        "descLen": 1762
      },
      {
        "id": "b1_b_j1",
        "status": "active",
        "subs": 7,
        "descLen": 1762
      }
    ],
    "sameName": false
  }
];

let resolved = 0, identical = 0;
REAL.forEach(group => {
  const w = winner(group.claimants);
  if (w) resolved++;
  if (group.sameName) identical++;
  // Mirrors the shipped rule exactly: count, then the lower id. Description is
  // deliberately NOT consulted — see the cache-stability note in index.html.
  const best = group.claimants.reduce((a, b) =>
    (b.subs !== a.subs ? (b.subs > a.subs ? b : a) : (b.id < a.id ? b : a)));
  ok(w === best.id,
    group.client + ': resolves to ' + (w || 'NOTHING')
      + ' [' + group.claimants.map(c => c.subs + 'subs/' + c.descLen + 'ch').join(' vs ') + ']');
});
ok(resolved === REAL.length,
  'ALL ' + REAL.length + ' real collisions now mint a parent — before this change every one of them deleted its post from Scene View');
ok(identical >= 8,
  identical + ' of the ' + REAL.length + ' carry a byte-identical name across their duplicates, which is why choosing is safe: they are one post imported twice, not two posts competing');

console.log(failures === 0
  ? '\nsame-kind batch parent tie-break checks passed'
  : '\n' + failures + ' same-kind batch parent tie-break check(s) failed');
process.exit(failures === 0 ? 0 : 1);
