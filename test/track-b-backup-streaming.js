'use strict';
// The Track-B dump is checked line by line (never decoded as one string) and
// row-counting paths keep no rows. This suite proves the line-by-line parser
// gives the SAME verdict as the whole-string parser it replaced, on fixed
// fault cases and on a seeded fuzz of mutated dumps, and that the freshness
// scan skips older-corpus snapshots on their header alone. The >2 GB run is
// scripts/track-b-large-dump-proof.js (too slow for the unit lane).
const assert = require('assert/strict');
const backup = require('../scripts/track-b-backup');
const { fixtureDump } = require('./track-b-backup-corpus');
const { resolveCorpus, allowedDumpControlLine, parseDumpIdentifier } = backup;
let passed = 0;
const check = (label, fn) => { fn(); passed++; console.log('  ok  ' + label); };

// Verbatim copy of the whole-string parser this change replaced (reference only).
function referenceParse(value, corpusName = 'legacy-v3') {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'utf8');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_) {
    throw new Error('Track-B PostgreSQL dump is not valid UTF-8');
  }
  if (text.includes('\0')) throw new Error('Track-B PostgreSQL dump contains a NUL byte');
  if (/\r(?!\n)/.test(text)) throw new Error('Track-B PostgreSQL dump contains an invalid carriage return');
  const corpus = resolveCorpus(corpusName);
  const allowlist = new Set(corpus.tables.map(config => config.name));
  const tables = {};
  let active = null;
  let sawHeader = false;
  for (const line of text.split(/\r?\n/)) {
    if (line === '-- PostgreSQL database dump') sawHeader = true;
    if (active) {
      if (line === '\\.') {
        tables[active.name] = active;
        active = null;
      } else {
        active.rows.push(line);
      }
      continue;
    }
    const copy = line.match(/^COPY public\.([a-z_][a-z0-9_]*) \((.+)\) FROM stdin;$/);
    if (copy) {
      const name = copy[1];
      if (!allowlist.has(name)) throw new Error('Unexpected table in Track-B dump');
      if (tables[name]) throw new Error(`Duplicate COPY section for public.${name}`);
      const columns = copy[2].split(',').map(parseDumpIdentifier);
      if (!columns.length || new Set(columns).size !== columns.length) {
        throw new Error(`Invalid COPY column list for public.${name}`);
      }
      active = { name, columns, rows: [] };
      continue;
    }
    if (!allowedDumpControlLine(line, corpusName)) {
      throw new Error('Disallowed PostgreSQL dump statement');
    }
  }
  if (!sawHeader) throw new Error('Track-B package does not contain a PostgreSQL dump');
  if (active) throw new Error(`Unterminated COPY section for public.${active.name}`);
  for (const config of corpus.tables) {
    if (!tables[config.name]) throw new Error(`Track-B dump is missing public.${config.name}`);
    const keys = Array.isArray(config.pk) ? config.pk : [config.pk];
    if (!keys.every(key => tables[config.name].columns.includes(key))) {
      throw new Error(`Track-B dump is missing primary-key columns for public.${config.name}`);
    }
  }
  return { tables };
}

function verdict(fn, bytes, corpus) {
  try {
    const out = fn(bytes, corpus);
    return 'ok:' + JSON.stringify(Object.fromEntries(Object.entries(out.tables).map(([k, v]) => [k, [v.columns, v.rows.length, v.rows.join('\n')]])));
  } catch (e) { return 'err:' + e.message; }
}
const CORPUS = 'history-v12';
const base = fixtureDump(CORPUS);
const same = (bytes, label) => check(label, () => assert.equal(verdict(backup.parseStrictPgDump, bytes, CORPUS), verdict(referenceParse, bytes, CORPUS)));

same(base, 'a clean dump gives the same result');
same(Buffer.concat([base, Buffer.from('\n')]), 'a trailing newline gives the same result');
same(Buffer.from(base.toString().replace(/\n/g, '\r\n')), 'CRLF line endings give the same result');
same(Buffer.concat([base, Buffer.from('\r')]), 'a trailing lone CR is refused the same way');
same(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), base]), 'a leading byte-order mark is handled the same way');
same(Buffer.from(base.toString().replace('\nCOPY', '\n\ufeffCOPY')), 'a byte-order mark on a later line is handled the same way');
same(Buffer.concat([base, Buffer.from([0xc3])]), 'a truncated multi-byte character at the end is refused as UTF-8');
same(Buffer.concat([Buffer.from('DROP TABLE x;\n'), base, Buffer.from([0xff])]), 'a bad byte late in the dump outranks an earlier bad statement');
same(Buffer.concat([base, Buffer.from([0x00, 0x0a, 0xff])]), 'invalid UTF-8 outranks a NUL, as before');
same(Buffer.concat([base, Buffer.from('a\rb\n'), Buffer.from([0x00])]), 'a NUL outranks a lone CR, as before');
same(Buffer.from(base.toString().replace(/\\\.\n/, 'caf\u00e9 \u2603 \ud83d\ude00\n\\.\n')), 'multi-byte UTF-8 in rows is kept byte for byte');

check('seeded fuzz: 3000 mutated dumps give the same verdict as the old parser', () => {
  let seed = 20260926;
  const rand = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const pool = [0x00, 0x0a, 0x0d, 0x5c, 0x2e, 0x09, 0xc3, 0xa9, 0xe2, 0x98, 0x83, 0xff, 0xef, 0xbb, 0xbf, 0x80, 0x41];
  for (let i = 0; i < 3000; i++) {
    const bytes = Buffer.from(base);
    const edits = 1 + rand(3);
    let out = bytes;
    for (let e = 0; e < edits; e++) {
      const at = rand(out.length + 1);
      const b = Buffer.from([pool[rand(pool.length)]]);
      out = rand(2) ? Buffer.concat([out.subarray(0, at), b, out.subarray(at)]) : Buffer.concat([out.subarray(0, at), b, out.subarray(Math.min(out.length, at + 1))]);
    }
    const a = verdict(backup.parseStrictPgDump, out, CORPUS), r = verdict(referenceParse, out, CORPUS);
    assert.equal(a, r, 'mutation ' + i);
  }
});

check('the counting path keeps no rows but counts them exactly', () => {
  const counted = backup.parseStrictPgDump(base, CORPUS, { keepRows: false });
  const kept = backup.parseStrictPgDump(base, CORPUS);
  for (const [name, t] of Object.entries(kept.tables)) {
    assert.equal(counted.tables[name].rows, undefined);
    assert.equal(counted.tables[name].rowCount, t.rows.length);
  }
  const inspected = backup.inspectPlainDump(base, CORPUS);
  for (const t of resolveCorpus(CORPUS).tables) assert.equal(inspected[t.name].rows, 1);
});

check('an older-corpus header is recognised; the same or a newer one, or garbage, is not', () => {
  const magic = name => resolveCorpus(name).magic;
  assert.equal(backup.headerIsOlderCorpus(magic('legacy-v3'), CORPUS), true);
  assert.equal(backup.headerIsOlderCorpus(magic('history-v10'), CORPUS), true);
  assert.equal(backup.headerIsOlderCorpus(magic('history-v11'), CORPUS), true);
  assert.equal(backup.headerIsOlderCorpus(magic(CORPUS), CORPUS), false);
  assert.equal(backup.headerIsOlderCorpus(Buffer.from('not a snapshot'), CORPUS), false);
  assert.equal(backup.headerIsOlderCorpus(null, CORPUS), false);
});

(async () => {
  const calls = [];
  const files = [{ id: 'old', name: 'x' }, { id: 'unknown', name: 'y' }, { id: 'peekfail', name: 'z' }];
  const headers = { old: resolveCorpus('history-v10').magic, unknown: Buffer.from('????') };
  const result = await backup.selectLatestAuthenticatedFromDrive('t', files, {
    hmacInput: Buffer.alloc(32, 7).toString('base64'),
    requiredCorpus: CORPUS,
    peek: async (_t, id) => { if (id === 'peekfail') throw new Error('x'); return headers[id]; },
    download: async (_t, id) => { calls.push(id); return Buffer.from('not a package'); },
  });
  check('the freshness scan skips an older-corpus snapshot without downloading it', () => {
    assert.deepEqual(calls, ['unknown', 'peekfail']);
    assert.equal(result.invalidCount, 3);
    assert.equal(result.validCount, 0);
    assert.equal(result.newestCandidateValid, false);
  });
  const plain = [];
  await backup.selectLatestAuthenticatedFromDrive('t', files, {
    hmacInput: Buffer.alloc(32, 7).toString('base64'), requiredCorpus: CORPUS,
    download: async (_t, id) => { plain.push(id); return Buffer.from('x'); },
  });
  check('an injected download with no peek still judges every file in full', () => assert.equal(plain.length, 3));
  console.log(`track-b-backup-streaming: ${passed} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
