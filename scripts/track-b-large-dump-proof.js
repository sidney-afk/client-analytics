'use strict';
// Offline proof that a Track-B history dump larger than 2 GiB packs, seals and
// verifies end to end. Synthetic data only: no database, no Drive, no secret.
//
//   node scripts/track-b-large-dump-proof.js [--gib=2.2] [--dir=<scratch dir>]
//
// It writes a synthetic history-v11 dump whose journal-shaped table carries
// multi-byte UTF-8 rows until the file passes the requested size, runs the
// real packSnapshot -> readSnapshotFile path with a random HMAC key, checks
// the sealed manifest's row counts, and shows that the whole-string decode the
// parser used before 2026-09-26 cannot even decode this dump. It then proves a
// single dump line past V8's string limit is refused as "too long", not as
// "not valid UTF-8". Needs about 3x the dump size in free memory and 2x on disk.
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backup = require('./track-b-backup');

const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
const GIB = Number(arg('gib') || '2.2');
const dir = fs.mkdtempSync(path.join(arg('dir') || os.tmpdir(), 'track-b-large-'));
const CORPUS = 'history-v11';
const BIG = 'card_change_journal';
const url = `postgresql://synthetic:synthetic@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres`;
const t0 = Date.now();
const log = msg => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${msg}`);

function writeDump(file, targetBytes, bigLineBytes = 0) {
  const fd = fs.openSync(file, 'w', 0o600);
  let written = 0, bigRows = 0;
  const put = s => { const b = Buffer.isBuffer(s) ? s : Buffer.from(s, 'utf8'); fs.writeSync(fd, b); written += b.length; };
  put('-- PostgreSQL database dump\n\nSET client_encoding = \'UTF8\';\n');
  // A journal-like payload with multi-byte characters, about 16 KB per row.
  const payload = JSON.stringify({ note: 'caf\u00e9 \u2603 \ud83d\ude00 '.repeat(40), pad: 'x'.repeat(15000) }).replace(/\\/g, '\\\\');
  for (const table of backup.resolveCorpus(CORPUS).tables) {
    const keys = Array.isArray(table.pk) ? table.pk : [table.pk];
    if (table.name !== BIG) {
      put(`COPY public.${table.name} (${keys.join(', ')}) FROM stdin;\n${keys.map(() => '1').join('\t')}\n\\.\n\n`);
      continue;
    }
    put(`COPY public.${table.name} (${keys.join(', ')}, row_after) FROM stdin;\n`);
    if (bigLineBytes) {
      put(`1\t`); put(Buffer.alloc(bigLineBytes, 0x61)); put('\n'); bigRows = 1;
    } else {
      const chunk = [];
      let id = 1;
      while (written < targetBytes) {
        chunk.length = 0;
        for (let i = 0; i < 256; i++) chunk.push(`${id++}\t${payload}`);
        put(chunk.join('\n') + '\n');
        bigRows += 256;
      }
    }
    put('\\.\n\n');
  }
  fs.closeSync(fd);
  return { bytes: written, bigRows };
}

(async () => {
  const key = crypto.randomBytes(32).toString('base64');
  const dump = path.join(dir, 'dump.sql');
  const pack = path.join(dir, 'dump.snapshot');
  try {
    const target = Math.ceil(GIB * 2 ** 30);
    const made = writeDump(dump, target);
    log(`wrote synthetic dump: ${made.bytes} bytes (${(made.bytes / 2 ** 30).toFixed(2)} GiB), ${made.bigRows} journal rows`);
    assert.ok(made.bytes > 2 ** 31, 'the proof dump must be larger than 2 GiB');

    assert.throws(() => fs.readFileSync(dump), /ERR_FS_FILE_TOO_LARGE|greater than 2 GiB/i);
    log('fs.readFileSync refuses it (why the reader is chunked)');
    const bytes = backup.readLargeFile(dump);
    assert.equal(bytes.length, made.bytes);
    // The old whole-string decode is shown on the first bytes just past V8's
    // string limit: there it throws ERR_STRING_TOO_LONG, which the old catch
    // reported as "not valid UTF-8". (On the whole >2 GiB buffer Node 22 does
    // not throw at all; it aborts the process, so it is not called here.)
    const pastLimit = bytes.subarray(0, require('buffer').constants.MAX_STRING_LENGTH + 16);
    assert.throws(() => new TextDecoder('utf-8', { fatal: true }).decode(pastLimit), e => e.code === 'ERR_STRING_TOO_LONG');
    log('the old whole-string decode fails on this dump (ERR_STRING_TOO_LONG, reported as "not valid UTF-8")');

    const inspected = backup.inspectPlainDump(bytes, CORPUS);
    assert.equal(inspected[BIG].rows, made.bigRows);
    log(`line-by-line check passes; ${BIG} rows counted: ${inspected[BIG].rows}`);

    const manifest = backup.packSnapshot(dump, pack, new Date(Date.now() - 1000).toISOString(), url, key, CORPUS);
    assert.equal(manifest.snapshot.bytes, made.bytes);
    assert.equal(manifest.tables[BIG].rows, made.bigRows);
    log(`packed and sealed: package ${fs.statSync(pack).size} bytes`);

    const snapshot = backup.readSnapshotFile(pack, key);
    assert.equal(snapshot.manifest.tables[BIG].rows, made.bigRows);
    assert.equal(snapshot.dumpBytes.length, made.bytes);
    // Independent digest, fed in 64 MiB slices (Hash#update refuses >2 GiB).
    const h = crypto.createHash('sha256');
    for (let o = 0; o < snapshot.dumpBytes.length; o += 64 * 2 ** 20) h.update(snapshot.dumpBytes.subarray(o, o + 64 * 2 ** 20));
    assert.equal(h.digest('hex'), manifest.snapshot.sha256);
    log('authenticated, decompressed and re-verified: HMAC, both checksums and every table count match');

    const tampered = backup.readLargeFile(pack);
    tampered[tampered.length - 40] ^= 0x01;
    assert.throws(() => backup.readSnapshotBytes(tampered, key), /authentication failed/);
    log('a one-bit change to the sealed package is still refused');

    fs.rmSync(dump); fs.rmSync(pack);
    const longLine = require('buffer').constants.MAX_STRING_LENGTH;
    writeDump(dump, 0, longLine + 1024);
    assert.throws(() => backup.inspectPlainDump(backup.readLargeFile(dump), CORPUS), /dump line is too long/);
    log('a single dump line past the string limit is refused as "too long", not as "not valid UTF-8"');
    console.log(JSON.stringify({ status: 'PASS', dump_bytes: made.bytes, journal_rows: made.bigRows, seconds: Math.round((Date.now() - t0) / 1000) }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error(e && e.stack || e); console.log(JSON.stringify({ status: 'FAIL' })); process.exit(1); });
