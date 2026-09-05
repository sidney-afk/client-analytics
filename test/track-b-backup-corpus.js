'use strict';

// Offline only: synthetic pg_dump text, packages and injected Drive responses.
const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backup = require('../scripts/track-b-backup');
const restore = require('../scripts/track-b-restore-rehearsal');

function fixtureDump(corpusName) {
  const sections = backup.resolveCorpus(corpusName).tables.map(table => {
    const keys = Array.isArray(table.pk) ? table.pk : [table.pk];
    return `COPY public.${table.name} (${keys.join(', ')}) FROM stdin;\n${keys.map(() => '1').join('\t')}\n\\.\n`;
  });
  return Buffer.from('-- PostgreSQL database dump\n' + sections.join('\n'));
}

async function run() {
  const checks = [];
  const check = (label, fn) => { fn(); checks.push(label); };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'track-b-corpus-'));
  const hmac = crypto.randomBytes(32).toString('base64');
  const generatedAt = new Date(Date.now() - 60000).toISOString();
  const url = `postgresql://fixture:fixture@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres`;
  const packages = {};
  try {
    check('default is exactly legacy14; history is exact21 including manifest', () => {
      assert.equal(backup.resolveCorpus().name, 'legacy-v3');
      assert.equal(backup.TABLES.length, 14); assert.equal(backup.HISTORY_TABLES.length, 21);
      assert.deepEqual(backup.HISTORY_TABLES.slice(14).map(t => t.name), [
        'calendar_posts','sample_reviews','calendar_post_events','sample_review_events',
        'workload_plan','card_change_journal','production_intake_manifests']);
      assert.throws(() => backup.resolveCorpus('history-v3'));
    });
    check('scheduled selection stays legacy until explicit valid configuration', () => {
      const saved = process.env.TRACK_B_BACKUP_CORPUS;
      try {
        delete process.env.TRACK_B_BACKUP_CORPUS;
        assert.equal(backup.configuredCorpus(),'legacy-v3');
        process.env.TRACK_B_BACKUP_CORPUS='history-v4';
        assert.equal(backup.configuredCorpus(),'history-v4');
        process.env.TRACK_B_BACKUP_CORPUS='invalid';
        assert.throws(() => backup.configuredCorpus());
      } finally {
        if (saved === undefined) delete process.env.TRACK_B_BACKUP_CORPUS;
        else process.env.TRACK_B_BACKUP_CORPUS=saved;
      }
    });
    for (const corpus of ['legacy-v3', 'history-v4']) {
      const dump = fixtureDump(corpus);
      const file = path.join(dir, corpus + '.sql');
      const pack = path.join(dir, corpus + '.snapshot');
      fs.writeFileSync(file, dump);
      backup.packSnapshot(file, pack, generatedAt, url, hmac, corpus);
      packages[corpus] = fs.readFileSync(pack);
      check(corpus + ' authenticated exact corpus roundtrip and safe restore generation', () => {
        const snapshot = backup.readSnapshotBytes(packages[corpus], hmac);
        assert.equal(snapshot.corpus, corpus);
        assert.equal(snapshot.manifest.table_count, backup.resolveCorpus(corpus).tables.length);
        assert.deepEqual(snapshot.dumpBytes, dump);
        const sql = restore.restoreSql(dump, snapshot.corpus);
        assert.doesNotMatch(sql, /\bcascade\b/i);
        assert.match(sql, /truncate table[^;]+ restrict;/);
        assert.ok(sql.indexOf('set constraints all immediate;') < sql.indexOf('select setval('));
        assert.match(sql, /coalesce\(s.last_value, s.start_value\)/);
        assert.match(sql, /greatest\(coalesce/);
        assert.equal((sql.match(/COPY public\./g) || []).length, snapshot.manifest.table_count);
        const observed = Object.fromEntries(backup.resolveCorpus(corpus).tables.map(t => [t.name, 1]));
        for (const key of Object.keys(restore.INTEGRITY_CHECKS)) observed[key] = 0;
        assert.equal(restore.verifyCounts(snapshot.manifest, observed), true);
        delete observed[backup.resolveCorpus(corpus).tables.at(-1).name];
        assert.throws(() => restore.verifyCounts(snapshot.manifest, observed));
      });
    }
    check('old v3 remains readable without invented history coverage', () => {
      const snapshot = backup.readSnapshotBytes(packages['legacy-v3'], hmac);
      assert.equal(snapshot.manifest.schema_version, 3);
      assert.equal(snapshot.manifest.corpus, undefined);
      assert.equal(snapshot.manifest.tables.card_change_journal, undefined);
      const sql = restore.restoreSql(snapshot.dumpBytes);
      for (const table of backup.HISTORY_TABLES.slice(14)) assert.ok(sql.includes(`to_regclass('public.${table.name}') is not null`));
      assert.ok(sql.indexOf('Legacy Track-B package') < sql.indexOf('track_b_restore_set_user_triggers(false)'));
    });
    check('history requires ordered composite key metadata and its own helper', () => {
      const snapshot = backup.readSnapshotBytes(packages['history-v4'], hmac);
      for (const name of ['calendar_posts','sample_reviews']) assert.deepEqual(snapshot.manifest.tables[name].primary_key, ['client','id']);
      assert.match(restore.restoreSql(snapshot.dumpBytes, snapshot.corpus), /track_b_restore_set_history_user_triggers\(false\)/);
      assert.equal((restore.verifySql('history-v4').match(/count\(\*\)::text from public\./g) || []).length, 33);
    });
    for (const table of backup.HISTORY_TABLES) {
      check('history refuses missing COPY ' + table.name, () => {
        const dump = fixtureDump('history-v4').toString().replace(new RegExp('COPY public\\.' + table.name + ' \\([^\\n]+\\) FROM stdin;\\n[^\\n]+\\n\\\\\\.\\n'), '');
        assert.throws(() => backup.parseStrictPgDump(dump, 'history-v4'), /missing/);
      });
    }
    check('history refuses one missing composite key column and unexpected data', () => {
      assert.throws(() => backup.parseStrictPgDump(fixtureDump('history-v4').toString().replace('calendar_posts (client, id)', 'calendar_posts (id)'), 'history-v4'), /primary-key/);
      assert.throws(() => backup.parseStrictPgDump(fixtureDump('history-v4')));
      assert.throws(() => backup.parseStrictPgDump(fixtureDump('history-v4') + '\nDROP TABLE public.clients;', 'history-v4'), /Disallowed/);
    });
    check('present empty COPY sections are valid across all21 tables', () => {
      const empty=fixtureDump('history-v4').toString().replace(/(FROM stdin;\n)[^\n]+\n/g,'$1');
      const inspected=backup.inspectPlainDump(empty,'history-v4');
      assert.equal(Object.keys(inspected).length,21);
      assert.ok(Object.values(inspected).every(table=>table.rows===0));
    });
    check('all21 privileges required; missing/duplicate/forbidden grants refuse', () => {
      const rows = backup.HISTORY_TABLES.map(t => `${t.name}|t|f|f|f|f|t`);
      assert.equal(backup.verifyReadOnlyPrivilegeOutput(rows.join('\n'), 'history-v4'), true);
      assert.throws(() => backup.verifyReadOnlyPrivilegeOutput(rows.slice(0, 20).join('\n'), 'history-v4'));
      assert.throws(() => backup.verifyReadOnlyPrivilegeOutput([...rows,rows[0]].join('\n'), 'history-v4'));
      assert.throws(() => backup.verifyReadOnlyPrivilegeOutput(rows.join('\n').replace('card_change_journal|t|f', 'card_change_journal|t|t'), 'history-v4'));
      assert.equal(backup.pgDumpArgs(path.join(dir,'dump.sql'), 'history-v4').filter(a => a.startsWith('--table=')).length,21);
    });
    check('tampering and a signed incorrect schema/corpus cannot be accepted', () => {
      const bad = Buffer.from(packages['history-v4']); bad[bad.length - 1] ^= 1;
      assert.throws(() => backup.readSnapshotBytes(bad,hmac), /authentication/);
      for (const mutate of [m => { m.corpus='legacy-v3'; }, m => { m.schema_version=3; }, m => { m.tables.calendar_posts.primary_key=['id','client']; }]) {
        const original=packages['history-v4']; const magic=backup.CORPORA['history-v4'].magic;
        const start=magic.length+8; const length=Number(original.readBigUInt64BE(magic.length));
        const manifest=JSON.parse(original.subarray(start,start+length)); mutate(manifest);
        const json=Buffer.from(backup.canonicalJson(manifest)); const size=Buffer.alloc(8); size.writeBigUInt64BE(BigInt(json.length));
        const unsigned=Buffer.concat([magic,size,json,original.subarray(start+length,-backup.HMAC_BYTES)]);
        const signed=Buffer.concat([unsigned,crypto.createHmac('sha256',Buffer.from(hmac,'base64')).update(unsigned).digest()]);
        assert.throws(() => backup.readSnapshotBytes(signed,hmac));
      }
    });
    const candidate = corpus => ({ file:{id:corpus,name:backup.snapshotName(generatedAt)},bytes:packages[corpus] });
    check('fresh signed v3 never satisfies the required history-v4 gate', () => {
      const selection=backup.selectAuthenticatedCandidates([candidate('legacy-v3')],hmac,Date.now(),'history-v4');
      assert.equal(selection.latest,null); assert.equal(selection.invalidCount,1);
      assert.equal(backup.selectAuthenticatedCandidates([candidate('history-v4')],hmac,Date.now(),'history-v4').validCount,1);
      assert.equal(backup.selectAuthenticatedCandidates([candidate('history-v4')],hmac,Date.now(),'legacy-v3').validCount,1);
    });
    const selection=await backup.selectLatestAuthenticatedFromDrive('synthetic', [candidate('legacy-v3').file,candidate('history-v4').file], {
      hmacInput:hmac, requiredCorpus:'history-v4', download:async (_token,id)=>packages[id],
    });
    check('newest wrong-coverage v3 stays red even with a fresh v4 older candidate', () => {
      assert.equal(selection.newestCandidateValid,false); assert.equal(selection.validCount,1);
      assert.equal(backup.classifyFreshness({fileCount:2,newestCandidateValid:selection.newestCandidateValid,
        latestGeneratedMs:selection.latest.generatedMs,nowMs:Date.now(),thresholdHours:7}).ok,false);
    });
    console.log(JSON.stringify({ok:true,groups:checks.length,coverage:'synthetic_packages_only',checks}));
  } finally {
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('track-b-corpus-')) throw new Error('temporary cleanup scope mismatch');
    fs.rmSync(resolved,{recursive:true,force:true});
  }
}
if (require.main===module) run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={fixtureDump,run};
