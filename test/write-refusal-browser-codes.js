'use strict';
/*
 * Browser refusal receipts keep the page's own reason code.
 *
 * Run:  node test/write-refusal-browser-codes.js   (exit 0 = all good)
 *
 * Measured 2026-09-23: 41 calendar status and 19 calendar comment browser
 * claims were all stored as `browser_refusal`, because write-diagnostics
 * admitted only three browser codes and receipts_v1_code_check only gateway
 * codes. This proves three things: every code the page can raise is on the
 * browser list, makeRefusalReceipt keeps it (for browser claims only), and the
 * widening migration admits exactly gateway + browser codes, dropping none.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures += 1; console.error('FAIL  ' + message); }
}

(async () => {
  const codes = await import(path.join(ROOT, 'supabase/functions/_shared/write-refusal-codes.mjs'));
  const diag = await import(path.join(ROOT, 'supabase/functions/_shared/write-refusal-diagnostics.mjs'));
  const { REFUSAL_CODES, BROWSER_REFUSAL_CODES } = codes;

  // Every literal code the page raises.
  const pageCodes = new Set();
  const dir = path.join(ROOT, 'src/index');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.part'))) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of s.matchAll(/_writeUiGatewayError\(\s*[^,]+?,\s*(?:[^'\n]*?\|\|\s*)?'([a-z0-9_]+)'/g)) pageCodes.add(m[1]);
    for (const m of s.matchAll(/\.code\s*=\s*'([a-z0-9_]+)'/g)) pageCodes.add(m[1]);
    for (const m of s.matchAll(/new Error\([^)]*\),\s*\{[^}]*?\bcode:\s*'([a-z0-9_]+)'/g)) pageCodes.add(m[1]);
  }
  const missing = [...pageCodes].filter(c => !REFUSAL_CODES.includes(c) && !BROWSER_REFUSAL_CODES.includes(c));
  ok(pageCodes.size > 30 && missing.length === 0,
    `every code the page raises is recordable (${pageCodes.size} found${missing.length ? '; missing: ' + missing.join(',') : ''})`);
  ok(BROWSER_REFUSAL_CODES.every(c => /^[a-z][a-z0-9_]{2,63}$/.test(c))
    && BROWSER_REFUSAL_CODES.every(c => !REFUSAL_CODES.includes(c)),
    'browser codes are short snake_case and never duplicate a gateway code');

  const receipt = (code, origin) => diag.makeRefusalReceipt(
    { surface: 'calendar', operation: 'status', identifiers: { id: 'b1_d_test' } }, code, 409, origin);
  ok((await receipt('status_reapply_required', 'browser_claim')).code === 'status_reapply_required',
    'a browser-only code is kept as itself (was browser_refusal)');
  ok((await receipt('operation_forbidden', 'browser_claim')).code === 'operation_forbidden',
    'a gateway code the browser saw is kept as itself');
  ok((await receipt('Some free text from a message', 'browser_claim')).code === 'browser_refusal',
    'anything off the lists still collapses to browser_refusal');
  ok((await receipt('status_reapply_required', 'gateway')).code === 'write_refused',
    'a gateway receipt can never carry a browser-only code');

  // The migration: exactly gateway + browser codes, a superset of what is live.
  const sql = fs.readFileSync(path.join(ROOT, 'migrations/2026-09-24-refusal-receipt-browser-codes.sql'), 'utf8');
  const listed = [...sql.match(/check \(code in \(([\s\S]+?)\)\);/)[1].matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]).sort();
  const want = [...new Set([...REFUSAL_CODES, ...BROWSER_REFUSAL_CODES])].sort();
  ok(JSON.stringify(listed) === JSON.stringify(want), 'the migration admits exactly gateway + browser codes');
  const original = fs.readFileSync(path.join(ROOT,
    'supabase/migrations/20260913044451_write_refusal_diagnostics_preparation.sql'), 'utf8');
  const before = [...original.match(/code = any\(array\[([^\]]+)\]/)[1].matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]);
  ok(before.every(c => listed.includes(c)), 'the new check drops no code the live check admits');
  ok(!/\b(grant|revoke)\b/i.test(sql.replace(/^--.*$/gm, '')), 'the migration changes no grants');

  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nwrite refusal browser-code checks passed');
})().catch(e => { console.error(e); process.exit(1); });
