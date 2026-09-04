#!/usr/bin/env node
'use strict';
/**
 * The bridge that made the heavy lane runnable off-CI — and the four properties
 * that stop it becoming a way to fake a pass.
 *
 * A transport that stands between a test and the backend is exactly the kind of
 * thing that quietly turns a real check into a mock. These assertions exist so
 * that cannot happen without someone editing them on purpose.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'docs', 'syncview-design', 'tests', 'prod-backend-bridge.js'), 'utf8');
const LANE = fs.readFileSync(path.join(ROOT, 'docs', 'syncview-design', 'tests', 'behav-wired.js'), 'utf8');
const { shouldBridge, BRIDGED } = require('../docs/syncview-design/tests/prod-backend-bridge');

/* Two views of the same file, and which one an assertion reads is not a detail.
   CODE is what actually runs: block comments and whole-line `//` comments
   removed. Every "it does NOT do X" assertion must read CODE, because this file
   explains at length that it deliberately does not disable TLS verification —
   asserting against the prose fails on the explanation, which is how this test
   first went red.
   SRC is the whole file, and every "it SAYS why" assertion must read SRC, or
   the strip removes the very sentence being asserted and the check passes
   vacuously (the mistake that hid a date assertion in
   test/repo-identity-exposure.js for weeks). */
// Stripping comments with a regex is what a reader reaches for first and it is
// wrong here. The handler routes the glob star-star-slash-star, and that
// STRING contains both a block-comment close and a block-comment open, so the
// obvious lazy-block regex opens a comment inside the glob and eats the rest of
// the file. Measured: 1729 of 6048 characters survived, and every "does NOT"
// assertion below was passing against the gutted remainder. So walk the source
// instead, tracking string state.
//
// (This very explanation is written with line comments for the same reason: as
// a block comment it would contain the closing delimiter and terminate itself.
// Regex literals are treated as ordinary text, which is fine for this file --
// its only regex is a hostname pattern with no quote or delimiter inside.
// Revisit if that changes.)
function stripComments(src) {
  let out = '', i = 0, quote = null;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (quote) {
      if (c === '\\') { out += c + (d || ''); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); out += ' '; i = e < 0 ? src.length : e + 2; continue; }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); out += ' '; i = e < 0 ? src.length : e; continue; }
    out += c; i++;
  }
  return out;
}
const CODE = stripComments(SRC);

let failures = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
  if (!cond) failures++;
}

/* ---- 1. It must never be a TLS bypass ---------------------------------- */

ok(!/ignore-certificate-errors/.test(CODE),
  'it does not use --ignore-certificate-errors, in any form — the sandbox README says never to disable TLS verification, and the whole point is that Node verifies instead');
ok(!/rejectUnauthorized/.test(CODE) && !/NODE_TLS_REJECT_UNAUTHORIZED/.test(CODE),
  'and it does not switch verification off on the Node side either');
ok(/ignore-certificate-errors/.test(SRC),
  'and it says so where a reader will look — the next person to hit ERR_CONNECTION_RESET needs to know the flag was considered and refused, not overlooked');

/* The strip above is load-bearing: if it ever removed everything, every
   "does NOT" assertion would pass on an empty string. */
ok(CODE.length < SRC.length && /page\.route\('\*\*\/\*'/.test(CODE) && /await fetch\(url/.test(CODE),
  'the code/prose split is honest — the strip removed comments and left the routing and the fetch, so the assertions above ran against something');

/* ---- 2. It must be a transport, not a fixture -------------------------- */

ok(!/readFileSync|recorded|fixture|replay/i.test(CODE),
  'it reads no recorded response — a check that passes under it passed against the live backend, which is the only reason the heavy lane is worth running');
ok(/route\.fulfill\(\{ status: res\.status/.test(CODE),
  'it returns the real status the backend returned, rather than synthesising one');
ok(/return route\.abort\('failed'\)/.test(CODE) && !/status: 500/.test(CODE),
  'and a transport failure ABORTS rather than fulfilling a fake error — a test must see a failed request as a failed request, not as a backend defect');

/* ---- 2b. It must not be able to write to production -------------------- */

ok(/if \(!\['GET', 'HEAD'\]\.includes\(req\.method\(\)\)\)/.test(CODE),
  'it refuses every non-GET/HEAD method');
ok(CODE.indexOf("includes(req.method())") < CODE.indexOf('await fetch(url'),
  'and refuses BEFORE the fetch — a mutation that reaches the fetch has already changed production, so a check that reports it afterwards is not a guard');
ok(/blockedWrites/.test(CODE) && /blockedWrites: \(\) => stats\.blockedWrites\.slice\(\)/.test(CODE),
  'a refused mutation is recorded and readable, so an application regression that tries to write during a read-only run is visible rather than silent');
ok(!/allowWrites|allowMutations|opts\.write/.test(CODE),
  'and there is no opt-in that turns writing back on — a bridge that can be talked into writing is one someone will talk into writing');

/* ---- 3. It must not become a general-purpose internet hole ------------- */

ok(Array.isArray(BRIDGED) && BRIDGED.length >= 1,
  'the bridged hosts are an allowlist (' + BRIDGED.length + ' pattern(s))');
ok(shouldBridge('https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/clients'),
  'the backend is bridged');
for (const off of ['https://example.com/x', 'https://docs.google.com/a', 'https://cdn.jsdelivr.net/npm/x',
  'http://uzltbbrjidmjwwfakwve.supabase.co/x', 'https://evil.supabase.co.attacker.test/x']) {
  ok(!shouldBridge(off), 'and ' + new URL(off).host + ' over ' + new URL(off).protocol.replace(':', '') + ' is not');
}

/* ---- 4. It must not be able to hide an empty run ----------------------- */

ok(/assertCarried\(minimum\)/.test(CODE) && /the page reached no backend, so any check that "passed" proved nothing/.test(SRC),
  'it can assert it actually carried traffic — a bridge that silently carried nothing would let every check "pass" on an empty page');
ok(/'content-encoding', 'content-length'/.test(CODE),
  'and it strips the encoding headers that describe the body Node already decoded, or Chromium decodes twice and reports a truncated body as a backend error');

/* ---- 5. CI behaviour must be unchanged unless asked -------------------- */

ok(/process\.env\.PROD_BACKEND_BRIDGE === '1'/.test(LANE),
  'the heavy lane installs it only when PROD_BACKEND_BRIDGE=1, so CI runs byte-identically without it');
ok(LANE.indexOf("PROD_BACKEND_BRIDGE") < LANE.indexOf('installReadConsoleAudit(page)'),
  'and installs it before the console audit, so bridged traffic is audited like any other');
ok(/backendBridge\.assertCarried\(1\)/.test(LANE),
  'and the lane USES the handle rather than merely holding it — an opt-in that installs a transport and never checks it carried anything is how a run against an empty page reports a tidy pass count');

if (failures) { console.log('\n' + failures + ' check(s) failed.'); process.exit(1); }
console.log('\nprod backend bridge checks passed');
