'use strict';
/*
 * Samples v2 (M3a) — per-component comment audience gating + view filter.
 *
 * Run:  node test/samples-comment-audience.js   (exit 0 = all good)
 *
 * Extracts the REAL _sxrComment* helpers from ../index.html by name
 * (brace-balanced) so we exercise the ACTUAL shipping code — the same belt-and-
 * braces approach the calendar uses for p08/p23/p63. Proves the security-
 * critical contract that the live client-link probe can't reach in this sandbox
 * (the client share link is token-gated and the harness can't read the token):
 *
 *   · _sxrMsgAudience: SMM-authored defaults to internal; client to client; an
 *     untagged message defaults to internal (an SMM note NEVER leaks).
 *   · _sxrCommentsForView on the CLIENT surface hides internal roots AND their
 *     replies (root-audience inheritance), hard-hides any role==='kasper'
 *     message, and drops tombstones; the SMM surface sees all (minus tombstones).
 *   · _sxrStringifyComments round-trips through _sxrParseComments.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

const HARNESS = `
const SXR_COMPONENTS = ['video', 'graphic'];
`;
const REAL = [
  grabFunc('_sxrParseComments'),
  grabFunc('_sxrStringifyComments'),
  grabFunc('_sxrCommentsFor'),
  grabFunc('_sxrSetCommentsFor'),
  grabFunc('_sxrMsgAudience'),
  grabFunc('_sxrCommentsForView'),
].join('\n');

const api = new Function(HARNESS + REAL + `
  return { _sxrParseComments, _sxrStringifyComments, _sxrCommentsFor, _sxrSetCommentsFor, _sxrMsgAudience, _sxrCommentsForView };
`)();

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('✓  ' + msg); }
  else { fail++; console.log('✗  ' + msg + '  (got ' + g + ', want ' + w + ')'); }
};

// ── _sxrMsgAudience defaults ──
eq(api._sxrMsgAudience({ role: 'smm' }), 'internal', 'SMM-authored defaults to internal');
eq(api._sxrMsgAudience({ role: 'client' }), 'client', 'client-authored defaults to client');
eq(api._sxrMsgAudience({}), 'internal', 'untagged message defaults to internal (SMM note never leaks)');
eq(api._sxrMsgAudience({ role: 'smm', audience: 'client' }), 'client', 'explicit audience:client wins over the smm default');
eq(api._sxrMsgAudience({ role: 'client', audience: 'internal' }), 'internal', 'explicit audience:internal honoured (read side)');
eq(api._sxrMsgAudience({ role: 'kasper' }), 'internal', 'kasper-authored defaults to internal');

// Build a row with a mix of threads on video.
const now = '2026-06-25T10:00:00.000Z';
const sample = { id: 's1' };
const list = [
  { id: 'r_int', parent_id: null, role: 'smm', audience: 'internal', body: 'internal root', created_at: now, updated_at: now },
  { id: 'r_int_reply', parent_id: 'r_int', role: 'smm', body: 'reply to internal', created_at: now, updated_at: now },
  { id: 'r_cli', parent_id: null, role: 'smm', audience: 'client', body: 'client root', created_at: now, updated_at: now },
  { id: 'r_cli_reply', parent_id: 'r_cli', role: 'client', body: 'client reply', created_at: now, updated_at: now },
  { id: 'r_kasper', parent_id: null, role: 'kasper', audience: 'client', body: 'kasper says hi', created_at: now, updated_at: now },
  { id: 'r_untag', parent_id: null, role: 'smm', body: 'untagged smm root', created_at: now, updated_at: now },
  { id: 'r_tomb', parent_id: null, role: 'client', audience: 'client', body: 'deleted root', created_at: now, updated_at: now, deleted: true },
];
api._sxrSetCommentsFor(sample, 'video', list);

// ── SMM surface (isClient=false) sees everything except tombstones ──
const smmView = api._sxrCommentsForView(sample, 'video', false).map(c => c.id).sort();
eq(smmView, ['r_cli', 'r_cli_reply', 'r_int', 'r_int_reply', 'r_kasper', 'r_untag'], 'SMM surface sees all roots+replies, drops tombstone');

// ── CLIENT surface (isClient=true) ──
const cliView = api._sxrCommentsForView(sample, 'video', true).map(c => c.id).sort();
eq(cliView, ['r_cli', 'r_cli_reply'], 'CLIENT sees only the client-audience root + its reply');
eq(cliView.includes('r_int'), false, 'CLIENT does NOT see the internal root');
eq(cliView.includes('r_int_reply'), false, "CLIENT does NOT see the internal root's reply (inheritance)");
eq(cliView.includes('r_kasper'), false, 'CLIENT does NOT see a kasper-authored message (hard-hide) even at audience client');
eq(cliView.includes('r_untag'), false, 'CLIENT does NOT see an untagged SMM root (defaults internal)');
eq(cliView.includes('r_tomb'), false, 'CLIENT does NOT see a tombstone');

// ── stringify / parse round-trip ──
const wire = api._sxrStringifyComments(list);
eq(api._sxrParseComments(wire).length, list.length, 'stringify -> parse round-trips the whole array');
eq(api._sxrStringifyComments([]), '', 'an empty array stringifies to "" (not "[]")');
eq(api._sxrParseComments('not json'), [], 'a non-JSON cell parses to []');
eq(api._sxrParseComments('').length, 0, 'an empty cell parses to []');
// _sxrCommentsFor falls back to parsing the *_tweaks column when the parsed cache is absent.
const fresh = { id: 's2', video_tweaks: wire };
eq(api._sxrCommentsFor(fresh, 'video').length, list.length, '_sxrCommentsFor re-parses from video_tweaks when no parsed cache');
eq(api._sxrCommentsFor(fresh, 'graphic').length, 0, '_sxrCommentsFor(graphic) on a video-only row is empty (no cross-leak)');

console.log(`\nsamples-comment-audience: ${pass} passed, ${fail} failed  ` + (fail ? '❌' : '✅'));
process.exit(fail ? 1 : 0);
