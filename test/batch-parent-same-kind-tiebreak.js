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
ok(winner([{ id: 'b1_b_a', subs: 4, descLen: 10 }, { id: 'b1_b_b', subs: 4, descLen: 900 }]) === 'b1_b_b',
  'DESCRIPTION: with the counts tied, the row somebody actually wrote in wins — the owner\'s rule');
ok(winner([{ id: 'b1_b_a', subs: 2, descLen: 50 }, { id: 'b1_b_b', subs: 2, descLen: 50 }]) === 'b1_b_a',
  'LOWER ID: with both real signals tied, the lower id decides');
ok(winner([{ id: 'b1_b_a', subs: 1, descLen: 900 }, { id: 'b1_b_b', subs: 9, descLen: 10 }]) === 'b1_b_b',
  'and COUNT OUTRANKS DESCRIPTION — a long note on an empty duplicate does not outweigh nine real sub-issues');

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

/* Measured from live data 2026-09-02. Titles omitted (public repo); `sameName`
   is the measurement that justifies choosing a winner at all. */
const REAL = [
  {
    "client": "artoflove",
    "claimants": [
      {
        "id": "b1_b_2f611d66726801df41fe0e54fa0e",
        "status": "active",
        "subs": 0,
        "descLen": 482,
        "nameIdentical": true
      },
      {
        "id": "b1_b_59c9b32d005dfecccb8898f3ac73",
        "status": "active",
        "subs": 1,
        "descLen": 482,
        "nameIdentical": true
      }
    ],
    "sameName": true
  },
  {
    "client": "bayavoce",
    "claimants": [
      {
        "id": "b1_b_e171d93fcfa0953800f6b5908f46",
        "status": "active",
        "subs": 4,
        "descLen": 942,
        "nameIdentical": true
      },
      {
        "id": "b1_b_f4dbc161f8cef2c4279ae20a7df3",
        "status": "active",
        "subs": 1,
        "descLen": 942,
        "nameIdentical": true
      }
    ],
    "sameName": false
  },
  {
    "client": "dougcartwright",
    "claimants": [
      {
        "id": "b1_b_35d9297d760269256b66ce0fa375",
        "status": "active",
        "subs": 8,
        "descLen": 2532,
        "nameIdentical": true
      },
      {
        "id": "b1_b_e9507c778c7b04a2d0cfbda4d602",
        "status": "active",
        "subs": 2,
        "descLen": 2002,
        "nameIdentical": true
      }
    ],
    "sameName": true
  },
  {
    "client": "dougcartwright",
    "claimants": [
      {
        "id": "b1_b_814fee58a32acda864c1ad63aff6",
        "status": "active",
        "subs": 2,
        "descLen": 1070,
        "nameIdentical": true
      },
      {
        "id": "b1_b_9ae8220f87fa84708d554f67fc6c",
        "status": "active",
        "subs": 2,
        "descLen": 1266,
        "nameIdentical": true
      }
    ],
    "sameName": true
  },
  {
    "client": "dougcartwright",
    "claimants": [
      {
        "id": "bat_83a9deb4-b1c7-4740-878b-1c85563aa339",
        "status": "active",
        "subs": 1,
        "descLen": 98,
        "nameIdentical": true
      },
      {
        "id": "bat_b899303c-48de-4535-8b27-2d6dea01032f",
        "status": "active",
        "subs": 8,
        "descLen": 98,
        "nameIdentical": true
      }
    ],
    "sameName": true
  },
  {
    "client": "jennaphillipsballard",
    "claimants": [
      {
        "id": "b1_b_25681d5693e37037040a0f488ad2",
        "status": "active",
        "subs": 2,
        "descLen": 480,
        "nameIdentical": true
      },
      {
        "id": "b1_b_3cb27cacc4e510ddef6c512288a8",
        "status": "active",
        "subs": 2,
        "descLen": 972,
        "nameIdentical": true
      },
      {
        "id": "b1_b_c3491fcbadbb2a08a6550e1745d0",
        "status": "active",
        "subs": 5,
        "descLen": 719,
        "nameIdentical": true
      }
    ],
    "sameName": true
  },
  {
    "client": "jennaphillipsballard",
    "claimants": [
      {
        "id": "b1_b_547a0e8523fc8a9dd7400c1ee9d5",
        "status": "active",
        "subs": 19,
        "descLen": 3967,
        "nameIdentical": true
      },
      {
        "id": "b1_b_7a3b20c5c573c4a7940ae7163cfb",
        "status": "active",
        "subs": 2,
        "descLen": 2983,
        "nameIdentical": true
      }
    ],
    "sameName": true
  },
  {
    "client": "jennaphillipsballard",
    "claimants": [
      {
        "id": "b1_b_8e671ea41667daed2f958d24f185",
        "status": "active",
        "subs": 4,
        "descLen": 828,
        "nameIdentical": true
      },
      {
        "id": "b1_b_d064ecbe2dd1d80b16b35edb7011",
        "status": "active",
        "subs": 1,
        "descLen": 458,
        "nameIdentical": true
      },
      {
        "id": "b1_b_d8a1d414e893f2ff5e83a5eadb00",
        "status": "active",
        "subs": 4,
        "descLen": 644,
        "nameIdentical": true
      }
    ],
    "sameName": true
  },
  {
    "client": "lilybaker",
    "claimants": [
      {
        "id": "b1_b_88024d6dca25995790d33ccc2fe8",
        "status": "active",
        "subs": 1,
        "descLen": 610,
        "nameIdentical": true
      },
      {
        "id": "b1_b_9837af64b456777977ee7f9a2411",
        "status": "active",
        "subs": 20,
        "descLen": 1228,
        "nameIdentical": true
      }
    ],
    "sameName": true
  },
  {
    "client": "terrinammar",
    "claimants": [
      {
        "id": "b1_b_55985c652f05266bb98d00ec6bcf",
        "status": "active",
        "subs": 4,
        "descLen": 1762,
        "nameIdentical": true
      },
      {
        "id": "b1_b_d2146c7c9b4cccbfc69e84bd025a",
        "status": "active",
        "subs": 7,
        "descLen": 1762,
        "nameIdentical": true
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
  const best = group.claimants.reduce((a, b) =>
    (b.subs !== a.subs ? (b.subs > a.subs ? b : a)
      : b.descLen !== a.descLen ? (b.descLen > a.descLen ? b : a)
      : (b.id < a.id ? b : a)));
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
