'use strict';
// Offline package negatives; populated source-owner proof is a separate PG lane.
const assert=require('node:assert/strict'),crypto=require('crypto');
const complete=require('../scripts/linear-exit-complete-application-data');
const recovery=require('../scripts/track-b-recovery-package'),backup=require('../scripts/track-b-backup');
const {fixtureDump}=require('./track-b-backup-corpus');
const key=crypto.randomBytes(32).toString('base64'),corpus='history-v11';
const names=complete.expectedNames(),config=backup.resolveCorpus(corpus),data=fixtureDump(corpus).toString();
const parsed=backup.parseStrictPgDump(data,corpus),parentNames=config.tables.map(t=>t.name);
const columns=Object.fromEntries(names.map(name=>[name,(parsed.tables[name]?.columns||['synthetic_value']).map(name=>({name,type:'text',not_null:false,identity:'',generated:''}))]));
const preData=names.map(name=>`CREATE TABLE public.${name} (${columns[name].map(c=>`${c.name} text`).join(', ')});`).join('\n');
const pre=recovery.validateSchemaSection(preData),post=recovery.validateSchemaSection('');
const tables=backup.inspectPlainDump(data,corpus);for(const t of Object.values(tables))t.digest_sha256='a'.repeat(64);
const manifest={format:recovery.RECOVERY_FORMAT,recovery_version:recovery.RECOVERY_VERSION,corpus,corpus_version:config.version,source_project_ref:backup.PRODUCTION_REF,generated_at:'2026-09-12T00:00:00.000Z',completed_at:'2026-09-12T00:01:00.000Z',schema:{fingerprint:'b'.repeat(32),pre_data:{statements:pre.statements.length,skipped_platform_statements:pre.skipped},post_data:{statements:0,skipped_platform_statements:post.skipped}},data:{table_count:52,tables},omitted_data_tables:names.filter(n=>!parentNames.includes(n)),sequences:[],callable_references:{},prerequisites:{roles:['anon','authenticated','service_role'],required_extensions:[]}};
const parent=recovery.packRecoveryPackage({preData,postData:'',data,manifest},key).bytes;
const rows=Object.fromEntries(names.map(name=>[name,{name,columns:columns[name],primary_key:[],rows:[columns[name].map(()=>null)]}]));
const duplicate=manifest.omitted_data_tables[0];rows[duplicate].rows=[['synthetic\tline\n\\N'],['synthetic\tline\n\\N']];
const bounds={version:1,consumer_closure_proven:false,sequences:[]};
const encode=r=>complete.encode(parent,r,key,bounds,[]);
const bytes=encode(rows),read=complete.read(bytes,key);
assert.equal(Object.keys(read.payload.tables).length,86);
assert.equal(read.payload.tables[duplicate].rows.length,2);
assert.throws(()=>recovery.readRecoveryPackage(bytes,key),/format|magic|header|recovery package/i);
assert.throws(()=>complete.read(bytes,crypto.randomBytes(32).toString('base64')),/AUTHENTICATION/);
const altered=Buffer.from(bytes);altered[60]^=1;assert.throws(()=>complete.read(altered,key),/AUTHENTICATION/);
for(const change of [r=>delete r[duplicate],r=>r.unclassified=r[duplicate],r=>r[duplicate].columns.push({...r[duplicate].columns[0]}),r=>r[duplicate].rows[0].pop(),r=>r[duplicate].columns[0].name='omitted_stored_column',r=>r[duplicate].primary_key=['synthetic_value']]){
 const changed=structuredClone(rows);change(changed);assert.throws(()=>encode(changed));
}
const sql=complete.reconstruct(bytes,key);
assert.ok(sql.includes('EXCEPT ALL')||sql.includes('except all'));
assert.ok(sql.includes('synthetic\\tline\\n\\\\N'));
assert.ok(sql.indexOf(`COPY public."${duplicate}"`)>sql.indexOf('COPY public.'));
assert.ok(sql.includes('COMPLETE_APPLICATION_CATALOG_MISMATCH'));
const sequence=require('../scripts/linear-exit-complete-sequence-bounds');
const state={name:'synthetic_complete_seq',last_value:'9',is_called:true,increment_by:'1',min_value:'1',max_value:'9223372036854775807',start_value:'1',data_type:'bigint'};
const proof={version:1,consumer_closure_proven:false,sequences:[{name:state.name,increment:'1',minimum:'1',maximum:state.max_value,start:'1',cache:'1',cycle:false,type:'bigint',consumers:[{schema:'public',table:'hiring_application_events',column:'id',type:'bigint',identity:'',default:"nextval('synthetic_complete_seq'::regclass)",edge_kinds:['default_dependency'],maximum_value:'9'}]}]};
sequence.validate(proof,[state]);
for(const change of [p=>p.sequences[0].consumers[0].maximum_value='10',p=>p.sequences[0].consumers[0].schema='external',p=>p.sequences[0].consumers[0].default+='+1',p=>p.sequences[0].cycle=true,p=>p.sequences[0].consumers=[],p=>p.sequences.push(p.sequences[0])]){const bad=structuredClone(proof);change(bad);assert.throws(()=>sequence.validate(bad,[state]));}
console.log('PASS complete-application-data-v1 offline authentication,86-table coverage,stored columns,duplicate multiset,COPY escaping,legacy refusal');
