'use strict';
// Offline format/coverage checks. Actual database proof is an explicit separate lane.
const assert=require('assert/strict');
const fs=require('fs');const os=require('os');const path=require('path');const crypto=require('crypto');
const backup=require('../scripts/track-b-backup');const restore=require('../scripts/track-b-restore-rehearsal');
const {fixtureDump}=require('./track-b-backup-corpus');
async function run(){
  const checks=[];const check=(name,fn)=>{fn();checks.push(name);};
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'history-v5-unit-'));
  const hmac=crypto.randomBytes(32).toString('base64');const generated=new Date(Date.now()-60000).toISOString();
  const url=`postgresql://synthetic:synthetic@db.${backup.PRODUCTION_REF}.supabase.co:5432/postgres`;
  const packages={};
  try{
    check('v3 and v4 counts/meaning remain unchanged; v5 exact33 is explicit',()=>{
      assert.equal(backup.TABLES.length,14);assert.equal(backup.HISTORY_TABLES.length,21);assert.equal(backup.CLOSED_HISTORY_TABLES.length,33);
      assert.equal(new Set(backup.CLOSED_HISTORY_TABLES.map(t=>t.name)).size,33);
      assert.equal(backup.resolveCorpus().version,3);assert.equal(backup.resolveCorpus('history-v5').version,5);
    });
    for(const corpus of ['legacy-v3','history-v4','history-v5']){
      const file=path.join(dir,corpus+'.sql'),pack=path.join(dir,corpus+'.snapshot');fs.writeFileSync(file,fixtureDump(corpus));
      backup.packSnapshot(file,pack,generated,url,hmac,corpus);packages[corpus]=fs.readFileSync(pack);
      check(corpus+' preserved authenticated read/restore identity',()=>{
        const snapshot=backup.readSnapshotBytes(packages[corpus],hmac);assert.equal(snapshot.corpus,corpus);
        assert.equal(snapshot.manifest.table_count,backup.resolveCorpus(corpus).tables.length);
        const sql=restore.restoreSql(snapshot.dumpBytes,corpus);assert.doesNotMatch(sql,/\bcascade\b/i);
        assert.match(sql,/omitted incoming foreign key/);assert.match(sql,/omitted referenced relation/);
        assert.ok(sql.indexOf('omitted incoming foreign key')<sql.indexOf('(false)'));
        if(corpus==='history-v5')assert.match(sql,/track_b_restore_set_history_v5_user_triggers\(false\)/);
        if(corpus==='history-v5'){
          const parent=sql.indexOf('COPY public."track_b_team_rollbacks" '),child=sql.indexOf('COPY public."mirror_outbox" ');
          assert.ok(parent>=0&&child>parent);
        }
      });
    }
    for(const t of backup.CLOSED_HISTORY_TABLES)check('v5 rejects omitted COPY '+t.name,()=>{
      const dump=fixtureDump('history-v5').toString();const start=dump.indexOf('COPY public.'+t.name+' ');const end=dump.indexOf('\\.\n',start)+3;
      assert.throws(()=>backup.parseStrictPgDump(dump.slice(0,start)+dump.slice(end),'history-v5'),/missing/);
    });
    check('v4 cannot satisfy v5 freshness and altered magic/corpus fails authentication',()=>{
      const candidate={file:{id:'synthetic',name:backup.snapshotName(generated)},bytes:packages['history-v4']};
      assert.equal(backup.selectAuthenticatedCandidates([candidate],hmac,Date.now(),'history-v5').latest,null);
      const bytes=Buffer.from(packages['history-v5']);bytes[bytes.length-1]^=1;assert.throws(()=>backup.readSnapshotBytes(bytes,hmac),/authentication/);
      const original=packages['history-v5'],magic=backup.CORPORA['history-v5'].magic,start=magic.length+8,length=Number(original.readBigUInt64BE(magic.length));
      const manifest=JSON.parse(original.subarray(start,start+length));manifest.corpus='history-v4';
      const payload=Buffer.from(backup.canonicalJson(manifest)),size=Buffer.alloc(8);size.writeBigUInt64BE(BigInt(payload.length));
      const unsigned=Buffer.concat([magic,size,payload,original.subarray(start+length,-backup.HMAC_BYTES)]);
      const signed=Buffer.concat([unsigned,crypto.createHmac('sha256',Buffer.from(hmac,'base64')).update(unsigned).digest()]);
      assert.throws(()=>backup.readSnapshotBytes(signed,hmac));
    });
    check('empty but present33 COPY sections are valid and key order is mandatory',()=>{
      const empty=fixtureDump('history-v5').toString().replace(/(FROM stdin;\n)[^\n]+\n/g,'$1');
      assert.equal(Object.keys(backup.inspectPlainDump(empty,'history-v5')).length,33);
      assert.throws(()=>backup.parseStrictPgDump(fixtureDump('history-v5').toString().replace('source_surface, card_id, component, native_comment_id','source_surface, card_id, component'),'history-v5'),/primary-key/);
    });
    check('all33 read privileges required and v5 source preflight validates FK boundary',()=>{
      const rows=backup.CLOSED_HISTORY_TABLES.map(t=>`${t.name}|t|f|f|f|f|t`);
      assert.equal(backup.verifyReadOnlyPrivilegeOutput(rows.join('\n'),'history-v5'),true);
      assert.throws(()=>backup.verifyReadOnlyPrivilegeOutput(rows.slice(0,-1).join('\n'),'history-v5'));
      assert.match(backup.readOnlyPrivilegeSql('history-v5'),/pg_catalog.pg_constraint/);
      assert.doesNotMatch(backup.readOnlyPrivilegeSql('legacy-v3'),/pg_catalog.pg_constraint/);
      assert.equal(backup.pgDumpArgs(path.join(dir,'dump.sql'),'history-v5').filter(a=>a.startsWith('--table=')).length,33);
    });
    check('manual v5 grant/helper artifact lists all33 exact keys and restricted private roles',()=>{
      const sql=fs.readFileSync(path.join(__dirname,'../scripts/track-b-history-v5-backup-prerequisites.sql'),'utf8');
      for(const t of backup.CLOSED_HISTORY_TABLES)assert.ok(sql.includes("'"+t.name+"'"));
      assert.match(sql,/from anon, authenticated, service_role/);assert.match(sql,/primary key mismatch/);
      assert.match(sql,/foreign-key boundary is incomplete/);assert.doesNotMatch(sql,/\btruncate\s+table\b/i);
      assert.match(sql,/RELEASE BLOCKER/);
    });
    console.log(JSON.stringify({status:'PASS',passed:checks.length,checks,proof:'offline_only'}));
  }finally{
    for(const corpus of ['legacy-v3','history-v4','history-v5'])for(const ext of ['.sql','.snapshot']){const p=path.join(dir,corpus+ext);if(fs.existsSync(p))fs.unlinkSync(p);}fs.rmdirSync(dir);
  }
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run};
