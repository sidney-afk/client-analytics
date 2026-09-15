'use strict';
// Explicit local preparation supplement, separate from the published inventory.
// No application seed rows are extracted or executed from the two older owners.
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const {splitSqlStatements}=require('./track-b-recovery-package');
const {scalar}=require('./linear-exit-composition/harness');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const SOURCES=[
 {file:'samples-supabase-migration.sql',sha256:'d7bb6e9cb13921dbc82f741d980ba556f21aced9c4ea32c54a2c64f4050f6ec3',stop:'\ninsert into public.content_samples'},
 {file:'2026-07-09-filming-plans-source.sql',sha256:'8774622f09dff13b1eb4453c5698eadf07ef56a6e8cb6a99d6683b5723e11dcd',stop:'\ninsert into public.filming_plans'},
 {file:'2026-07-09-thumbnail-media-revisions.sql',sha256:'657f8a8f00c88b3ca617ada913553aad42cf3bff38f95f228fdee806e1e3e885'},
 {file:'2026-07-14-thumbnail-revision-v2.sql',sha256:'c8ec21f9dc490212e147d7e0da2e008fb4c8ba602adf43a3de007f8c43919227'},
];
function plan(){return SOURCES.map(item=>{
 const bytes=fs.readFileSync(path.join(__dirname,'../migrations',item.file));if(sha(bytes)!==item.sha256)throw Error('PRIORITY_SUPPLEMENT_SOURCE_HASH');
 let sql=bytes.toString('utf8');
 if(item.stop){const at=sql.indexOf(item.stop);if(at<0)throw Error('PRIORITY_SUPPLEMENT_SEED_BOUNDARY');sql=sql.slice(0,at);
  if(splitSqlStatements(sql).some(s=>s.kind==='statement'&&/^(insert|update|delete|copy|merge)\b/i.test(s.text)))throw Error('PRIORITY_SUPPLEMENT_APPLICATION_DML');
 }
 return {path:'migrations/'+item.file,source_sha256:item.sha256,executed_sha256:sha(sql),schema_excerpt:!!item.stop,sql};
});}
function apply(cluster){
 const entries=plan();
 // Same explicit external-platform scaffold as the ordered baseline; no
 // Storage objects, policies, bucket custody or hosted configuration inferred.
 const platform=scalar(cluster,"select to_regclass('storage.buckets') is not null and exists(select from pg_publication where pubname='supabase_realtime')");
 if(platform!=='t')throw Error('PRIORITY_SUPPLEMENT_PLATFORM_REQUIRED');
 for(const entry of entries)cluster.exec(entry.sql);
 return {separate_from_published_inventory:true,entries:entries.map(({sql,...entry})=>entry),application_seed_rows_executed:false,external_platform_scaffold:'existing ordered storage.buckets and supabase_realtime',storage_objects_custody_proven:false,full_application_baseline_proven:false};
}
module.exports={plan,apply};
