#!/usr/bin/env node
'use strict';
/* A reply must name its parent by an id the server knows. A client note the
   card shows from its own comment list can carry an id production_comments
   never saw (the same words were saved a second time under another id and
   timestamp), so a reply naming it was refused for good. The send path now
   names the canonical twin. Real data has the two copies differ in id AND
   created_at; earlier fixtures reused one id for both, so they never met it. */
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures++; };

const src = extractFunction(INDEX, '_prodServerParentRef');
let canon = [];
const _prodComments = { rows: () => canon };
const fn = new Function('_prodComments', src + '; return _prodServerParentRef;')(_prodComments);

const legacy = [
  { id: 'c_old_1', parent_id: null, role: 'client', body: 'Same q', created_at: '2026-10-19T19:08:37.424Z' },
  { id: 'c_sc_1', parent_id: null, role: 'admin', body: 'tweaks', created_at: '2026-10-15T21:46:50Z' }
];
canon = [
  { id: 'pc_a', native_comment_id: 'c_new_1', parent_id: null, role: 'client', body: 'Same q' },
  { id: 'pc_b', native_comment_id: 'c_sc_1', parent_id: null, role: 'admin', body: 'tweaks' }
];
ok(fn('del_1', 'c_old_1', legacy) === 'pc_a', 'unknown legacy client note id maps to its canonical twin');
ok(fn('del_1', 'c_sc_1', legacy) === 'c_sc_1', 'id the server knows by native id is left alone');
ok(fn('del_1', 'pc_a', legacy) === 'pc_a', 'canonical id is left alone');
ok(fn('del_1', 'c_zzz', legacy) === 'c_zzz', 'unknown id with no legacy row is sent unchanged');
canon = [];
ok(fn('del_1', 'c_old_1', legacy) === 'c_old_1', 'no canonical read yet: unchanged');
for (const f of ['140-calendar-legacy-outbox', '290-samples-writes-review']) {
  const s = fs.readFileSync(path.join(__dirname, '..', 'src/index', f + '.js.part'), 'utf8');
  ok(/_prodServerParentRef\(nativeId/.test(s), f + ' sends the server parent id');
}
process.exit(failures ? 1 : 0);
