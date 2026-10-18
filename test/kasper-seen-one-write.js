'use strict';
/*
 * The Kasper-seen ledger is saved once per batch of marks, not once per mark.
 *
 * Speed sweep 2026-10-17: _calMarkKasperSeen rewrote the whole ledger to
 * localStorage on every new mark, and a load marks one post after another
 * (_calMigratePostShape seeds it from each post's kasper_seen column). A
 * browser meeting many posts at once (a fresh browser opening Kasper's queue)
 * spent ~0.6 s in setItem alone. Runs the shipped functions against a counting
 * localStorage.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed++; console.log('  ok  ' + m); };

function grab(re) {
  const at = INDEX.search(re);
  assert.ok(at >= 0, 'not found: ' + re);
  if (/^\s*(const|let)\s/.test(INDEX.slice(at, at + 12))) return INDEX.slice(at, INDEX.indexOf(';', at) + 1);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}' && --depth === 0) return INDEX.slice(at, j + 1);
  }
  throw new Error('unbalanced: ' + re);
}
const ledgerAt = INDEX.indexOf("const CAL_KASPER_SEEN_KEY = 'syncview_kasper_seen_v1';");
ok(ledgerAt > 0, 'the ledger key is unchanged, so saved ledgers still load');
const seenInit = INDEX.slice(ledgerAt, INDEX.indexOf('})();', ledgerAt) + 5);
const src = [
  seenInit,
  grab(/function _calKasperSeenKey\(/),
  grab(/let _calKasperSeenSaveQueued = false;/),
  grab(/function _calSaveKasperSeen\(/),
  grab(/function _calMarkKasperSeen\(/),
  grab(/function _calWasKasperSeen\(/),
  'this.mark = _calMarkKasperSeen; this.was = _calWasKasperSeen;',
].join('\n');

const store = { syncview_kasper_seen_v1: JSON.stringify(['old|video']) };
let writes = 0;
const ctx = {
  JSON, Set, String, Promise, queueMicrotask,
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { writes++; store[k] = String(v); },
  },
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

(async () => {
  ok(ctx.was('old', 'video'), 'a saved ledger is read back at load, as before');
  for (let i = 0; i < 300; i++) { ctx.mark('p' + i, 'video'); ctx.mark('p' + i, 'graphic'); }
  ok(ctx.was('p299', 'graphic'), 'a mark counts at once, before any save');
  ok(writes === 0, 'nothing is written while the batch of marks is still running');
  await Promise.resolve();
  ok(writes === 1, 'the whole batch of 600 marks is saved in ONE write (' + writes + ')');
  const saved = JSON.parse(store.syncview_kasper_seen_v1);
  ok(saved.length === 601 && saved.includes('old|video') && saved.includes('p0|video') && saved.includes('p299|graphic'),
    'and that write holds every mark, old and new');
  ctx.mark('p0', 'video');
  await Promise.resolve();
  ok(writes === 1, 'a mark already in the ledger writes nothing');
  ctx.mark('late', 'caption');
  await Promise.resolve();
  ok(writes === 2 && JSON.parse(store.syncview_kasper_seen_v1).includes('late|caption'), 'a later new mark is saved in its own single write');
  ctx.mark('', 'video');
  await Promise.resolve();
  ok(writes === 2, 'a mark with no post id is ignored, as before');
  console.log('\nkasper-seen-one-write: ' + passed + ' checks passed ✅');
})().catch(e => { console.error(e); process.exit(1); });
