'use strict';
/*
 * No UTF-8 byte-order mark anywhere under supabase/functions.
 *
 * Those three bytes are invisible in an editor and fatal at release time. The
 * deploy tooling strips a leading mark when it uploads a function, while
 * scripts/ef-fingerprint.js hashes the committed bytes exactly as git stores
 * them (buildExpectedClosure keeps raw buffers; only the import scan sees the
 * BOM-stripped text). So the live source can never equal the expected source
 * for a marked file, and no amount of redeploying fixes it.
 *
 * Measured on 2026-09-17: the staff-sensitive release lane deployed all
 * thirteen functions from the merge commit and then failed its own attestation
 * on one slug, expected bfe3e13ef9d2 against live 090a6cac5d93, changed file
 * functions/notify/urgent-link.ts. The live code was byte-identical to the
 * intended code the whole time; only the pin disagreed.
 *
 * This belongs in the unit lane rather than in the release lane because the
 * release lane DEPLOYS BEFORE IT ATTESTS: by the time it goes red the code is
 * already live, so its check cannot hold anything back. This one runs before a
 * merge, which is the only place the mark can still be cheap to remove.
 *
 * Every file is checked, not just the import closure of some entrypoint. A mark
 * in a file nothing imports today (there was one, in an unimported provider
 * preparation module) breaks the attestation the moment an import is added.
 */
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), SCAN = path.join(ROOT, 'supabase', 'functions');
const MARK = Buffer.from([0xef, 0xbb, 0xbf]);

function scan(root) {
  const marked = [];
  let files = 0;
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.isFile()) continue;
      files += 1;
      const head = Buffer.alloc(3), handle = fs.openSync(full, 'r');
      try { fs.readSync(handle, head, 0, 3, 0); } finally { fs.closeSync(handle); }
      if (head.equals(MARK)) marked.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return { files, marked: marked.sort() };
}

// The check has to be SEEN to fire (journal D26/D27: an assertion that has never
// failed on a real positive is an assertion nobody has tested). A disposable
// tree carries a planted mark, a clean sibling, and a file whose mark is not at
// byte 0 — only the first is an offender.
const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-bom-control-'));
try {
  fs.mkdirSync(path.join(probe, 'planted'), { recursive: true });
  fs.writeFileSync(path.join(probe, 'planted', 'index.ts'), Buffer.concat([MARK, Buffer.from('export const planted = 1;\n', 'utf8')]));
  fs.writeFileSync(path.join(probe, 'clean.ts'), Buffer.from('export const clean = 2;\n', 'utf8'));
  fs.writeFileSync(path.join(probe, 'trailing.ts'), Buffer.concat([Buffer.from('export const trailing = 3;\n', 'utf8'), MARK]));
  fs.writeFileSync(path.join(probe, 'empty.ts'), Buffer.alloc(0));
  const planted = scan(probe);
  assert.equal(planted.files, 4, 'the control tree must be scanned whole');
  assert.deepEqual(planted.marked, ['planted/index.ts'], 'the guard must catch a planted mark, and only one at byte 0');
  fs.rmSync(path.join(probe, 'planted'), { recursive: true, force: true });
  assert.deepEqual(scan(probe).marked, [], 'the guard must stay silent once the planted mark is gone');
} finally {
  fs.rmSync(probe, { recursive: true, force: true });
}

const result = scan(SCAN);
assert(result.files > 0, 'the Edge Function tree must be present and non-empty');
assert.deepEqual(
  result.marked,
  [],
  'byte-order mark under supabase/functions: strip the three leading bytes, or the release lane will deploy and then fail its own attestation on these files',
);

console.log(JSON.stringify({
  marker: 'EDGE_FUNCTION_BYTE_ORDER_MARK_OK',
  scanned_root: 'supabase/functions',
  files_scanned: result.files,
  marked: result.marked.length,
  planted_control: 'DETECTED_THEN_CLEARED',
}));
