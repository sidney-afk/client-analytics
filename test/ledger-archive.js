'use strict';
/*
 * Guard for scripts/ledger-archive.js: old ledger entries move to a monthly
 * archive word for word, the main file keeps one linked line per moved entry,
 * and nothing is lost. Offline; the fixture runs in a temp folder.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../scripts/ledger-archive.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ok  ' + m); };

// ---- fixture: a ledger with a fence, a repeated heading, an undated heading ----
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
const original = [
  'Preamble line.', '',
  '## 1. [2026-07-05] old thing', 'body one', '```', '## not a heading', '```', '',
  '## 2. [2026-09-20] recent thing', 'body two', '',
  '## 3. [repair] no date here', 'body three', '',
  '## 4. [2026-07-20] repeated title', 'a', '',
  '## 4. [2026-07-20] repeated title', 'b', '',
  '## 5. [2026-08-03] just inside the window', 'body five', '',
].join('\n');
fs.mkdirSync(path.join(root, 'docs/ops'), { recursive: true });
const file = path.join(root, lib.LEDGERS.repairs.file);
fs.writeFileSync(file, original);

const r = lib.archive('repairs', { root, cutoff: '2026-08-02', apply: true });
ok(r.moved === 3, 'three entries older than the cutoff moved (the undated one and the recent ones stayed)');
const main = fs.readFileSync(file, 'utf8');
ok(!/body one|body 3/.test(main) && /body two/.test(main) && /body three/.test(main) && /body five/.test(main), 'old bodies left the main file; recent and undated bodies stayed');
ok(main.split('\n').filter(l => l.startsWith(lib.MARK)).length === 3, 'one summary line per moved entry');
ok(/\[read it\]\(repairs-archive\/2026-07\.md#4-2026-07-20-repeated-title-1\)/.test(main), 'a repeated heading gets the second anchor, as GitHub does');
ok(lib.rebuild('repairs', root) === original, 'rebuilding gives back the original file byte for byte');
ok(lib.archive('repairs', { root, cutoff: '2026-08-02', apply: true }).moved === 0, 'a second run moves nothing');
// A later run with a newer cutoff appends to the month file and still rebuilds exactly.
lib.archive('repairs', { root, cutoff: '2026-09-30', apply: true });
ok(lib.rebuild('repairs', root) === original, 'a later, wider run still rebuilds the original byte for byte');
const arch = fs.readFileSync(path.join(root, lib.LEDGERS.repairs.dir, '2026-07.md'), 'utf8');
ok(arch.includes('## 1. [2026-07-05] old thing\nbody one\n```\n## not a heading\n```\n'), 'a code fence inside an entry travels with it');
// --keep leaves a named entry where it is.
fs.writeFileSync(file, original);
fs.rmSync(path.join(root, lib.LEDGERS.repairs.dir), { recursive: true });
ok(lib.archive('repairs', { root, cutoff: '2026-08-02', keep: ['1. [2026-07-05] old thing'], apply: true }).moved === 2 && /body one/.test(fs.readFileSync(file, 'utf8')), 'a kept entry stays in the main file');
ok(lib.rebuild('repairs', root) === original, 'a run with a kept entry still rebuilds the original byte for byte');
fs.writeFileSync(file, original); fs.rmSync(path.join(root, lib.LEDGERS.repairs.dir), { recursive: true });
lib.archive('repairs', { root, cutoff: '2026-08-02', apply: true });
// An archived entry edited after the move must fail the check.
const archPath = path.join(root, lib.LEDGERS.repairs.dir, '2026-07.md');
const archText = fs.readFileSync(archPath, 'utf8');
fs.writeFileSync(archPath, archText.replace('body one', 'body 1'));
assert.throws(() => lib.rebuild('repairs', root), /fingerprint/); n++; console.log('  ok  an archived entry edited after the move fails the check');
fs.writeFileSync(archPath, archText);
// A broken link must be loud.
const main2 = fs.readFileSync(file, 'utf8');
fs.writeFileSync(file, main2.replace('#4-2026-07-20-repeated-title-1', '#nope'));
assert.throws(() => lib.rebuild('repairs', root), /not found/); n++; console.log('  ok  a summary line whose anchor does not resolve fails the check');

// ---- the real ledgers ----
for (const kind of ['log', 'repairs']) {
  const cfg = lib.LEDGERS[kind];
  lib.rebuild(kind); // throws on any dead link, anchor or edited heading
  const dir = path.join(path.resolve(__dirname, '..'), cfg.dir);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^\d{4}-\d\d\.md$/.test(f)) : [];
  const inArchives = files.reduce((s, f) => s + lib.parse(fs.readFileSync(path.join(dir, f), 'utf8')).entries.length, 0);
  const lines = fs.readFileSync(path.join(path.resolve(__dirname, '..'), cfg.file), 'utf8').split('\n').filter(l => l.startsWith(lib.MARK)).length;
  ok(lines === inArchives, kind + ': ' + lines + ' summary lines match ' + inArchives + ' archived entries, none orphaned');
  for (const f of files) ok(/^\d{4}-\d\d$/.test(f.slice(0, 7)) && lib.parse(fs.readFileSync(path.join(dir, f), 'utf8')).entries.every(e => (lib.dateOf(e.heading) || '').startsWith(f.slice(0, 7))), kind + ': ' + f + ' holds only entries dated in that month');
}
console.log('\nledger-archive: ' + n + ' checks passed');
