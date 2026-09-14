'use strict';
const crypto=require('node:crypto');
const backup=require('../../scripts/track-b-backup');
const recovery=require('../../scripts/track-b-recovery-package');
const {fixtureDump}=require('../track-b-backup-corpus');
const key=Buffer.alloc(32,11).toString('base64');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function parentPackage(corpusName='history-v11', fingerprint='a'.repeat(32), sourceCommit='1'.repeat(40)) {
  const corpus=backup.resolveCorpus(corpusName);
  const preData=Buffer.from(corpus.tables.map(t=>`CREATE TABLE public.${t.name} (${(Array.isArray(t.pk)?t.pk:[t.pk]).map(k=>`${k} text NOT NULL`).join(',')});`).join('\n'));
  const postData=Buffer.from(''); const data=fixtureDump(corpusName);
  const pre=recovery.validateSchemaSection(preData.toString());const post=recovery.validateSchemaSection('');
  const tables=backup.inspectPlainDump(data,corpusName);
  for(const [name,item] of Object.entries(tables))item.digest_sha256=sha(name);
  const manifest={format:recovery.RECOVERY_FORMAT,recovery_version:recovery.RECOVERY_VERSION,corpus:corpusName,corpus_version:corpus.version,
    generated_at:new Date(Date.now()-1000).toISOString(),completed_at:new Date().toISOString(),source_project_ref:backup.PRODUCTION_REF,
    snapshot_isolation:'synthetic',source_commit:sourceCommit,schema:{fingerprint,pre_data:{statements:pre.statements.length,skipped_platform_statements:pre.skipped},post_data:{statements:post.statements.length,skipped_platform_statements:post.skipped}},
    data:{table_count:corpus.tables.length,tables},sequences:[],callable_references:{},prerequisites:{roles:['anon','authenticated','service_role']}};
  return recovery.packRecoveryPackage({preData,postData,data,manifest},key).bytes;
}
module.exports={parentPackage,key};
