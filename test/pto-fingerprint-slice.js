'use strict';

// Guards the PTO evidence fingerprint slice (qa/pto-lifecycle/review.js
// ptoSourceSlice). The PTO public-evidence check hashes a fingerprint of the
// source tree; index.html is the whole SPA, so hashing all of it made the check
// go stale — and permanently red — on ANY edit anywhere (F141 reorder,
// analytics, workload), which made it meaningless. The slice fixes that by
// fingerprinting only the PTO-bearing lines. This test pins two properties:
//   1. COMPLETE — every known PTO anchor is captured, so a real PTO change still
//      trips the guard (no silent regression behind the fix).
//   2. NARROW — unrelated code is excluded, so unrelated edits no longer stale
//      the evidence, and "crypto"-style near-misses never match.
// If PTO code grows a new identifier shape, extend PTO_SOURCE_TOKEN in review.js
// AND regenerate the manifest; this test will fail loudly until the anchor is
// captured again.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ptoSourceSlice } = require('../qa/pto-lifecycle/review');

let failures = 0;
function ok(cond, msg) { if (!cond) { console.error('FAIL pto-fingerprint-slice:', msg); failures++; } }

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const slice = ptoSourceSlice(index);

// 1. COMPLETE — real PTO code is captured (each is a distinct token shape).
for (const anchor of ['_ptoLoadOverview', '_ptoAdminState', 'pto-wrap', 'ptoRoot', 'pto_v1', 'Time Off', "'pto-admin'"]) {
  ok(slice.includes(anchor), `PTO anchor must be in the slice so a real PTO change still trips the guard: ${anchor}`);
}
ok(slice.split('\n').filter(Boolean).length > 100, 'PTO slice should capture the substantial PTO surface, not a handful of lines');

// 2. NARROW — unrelated surfaces are excluded, so their edits don't stale PTO evidence.
for (const foreign of ['_sxrPersistReorder', '_analyticsReceipt', 'function scheduleAll', 'wlEffectiveWorkDate', 'crypto.createHash']) {
  ok(!slice.includes(foreign), `non-PTO code must be excluded from the slice: ${foreign}`);
}

// 3. Discrimination — the slice reacts to PTO lines and ignores everything else.
ok(ptoSourceSlice('const key = await crypto.subtle.digest(x);\n') === '', 'a crypto line must not be treated as PTO code');
ok(ptoSourceSlice('  const adaptor = makeAdaptor();\n') === '', 'an unrelated line must produce an empty slice');
ok(ptoSourceSlice('<div class="pto-wrap"><h1 class="pto-title">Time Off</h1></div>\n') !== '', 'a PTO line must be kept');
ok(ptoSourceSlice('editing a pto-field changes the fingerprint\n') !== ptoSourceSlice('editing a calendar field does not\n'),
  'a change on a PTO line must change the slice while a non-PTO line does not');

if (failures) { process.exit(1); }
console.log('PTO fingerprint slice checks passed');
