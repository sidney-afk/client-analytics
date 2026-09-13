'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const coverage=require('../scripts/linear-exit-asset-reference-coverage'),history=require('../scripts/linear-history-coverage/scan');
const complete=require('../scripts/linear-exit-complete-application-data'),recovery=require('../scripts/track-b-recovery-package'),backup=require('../scripts/track-b-backup');
const exportsApi=require('../scripts/linear-exit-object-export');
const key=crypto.randomBytes(32).toString('base64'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'asset-coverage-'));
function packageBytes(extra=false,mapped=false){
 const corpus='history-v11',config=backup.resolveCorpus(corpus),names=complete.expectedNames();
 const parsed=backup.parseStrictPgDump(require('./track-b-backup-corpus').fixtureDump(corpus).toString(),corpus);
 const columns=Object.fromEntries(names.map(n=>[n,[...new Set([...(parsed.tables[n]?.columns||[]),...(history.REQUIRED[n]||['synthetic_value'])])]]));
 const values=Object.fromEntries(names.map(n=>[n,[]]));
 const url='https://'+backup.PRODUCTION_REF+'.supabase.co/storage/v1/object/public/assets/a.png';
 const original='https://uploads.linear.app/synthetic-image';
 values.calendar_posts=[columns.calendar_posts.map(c=>({client:'synthetic',id:'card',asset_url:mapped?original:url,status:'active'}[c]??null))];
 if(mapped)values.linear_archive_asset_refs=[columns.linear_archive_asset_refs.map(c=>({ref_id:'synthetic-ref',original_url:original,rescued_url:url,state:'rescued'}[c]??null))];
 if(extra){const n=names.find(n=>!history.REQUIRED[n]);values[n]=[columns[n].map(()=> 'https://unknown.invalid/asset')];}
 const preData=names.map(n=>`CREATE TABLE public.${n} (${columns[n].map(c=>c+' text').join(',')});`).join('\n');
 const data='-- PostgreSQL database dump\n'+config.tables.map(({name:n})=>`COPY public.${n} (${columns[n].join(', ')}) FROM stdin;\n${values[n].map(r=>r.map(v=>v===null?'\\N':v).join('\t')+'\n').join('')}\\.\n`).join('\n');
 const pre=recovery.validateSchemaSection(preData),post=recovery.validateSchemaSection(''),tables=backup.inspectPlainDump(data,corpus);
 for(const t of Object.values(tables))t.digest_sha256='a'.repeat(64);
 const manifest={format:recovery.RECOVERY_FORMAT,recovery_version:recovery.RECOVERY_VERSION,corpus,corpus_version:config.version,source_project_ref:backup.PRODUCTION_REF,generated_at:'2026-09-12T00:00:00.000Z',completed_at:'2026-09-12T00:01:00.000Z',schema:{fingerprint:'b'.repeat(32),pre_data:{statements:pre.statements.length,skipped_platform_statements:pre.skipped},post_data:{statements:0,skipped_platform_statements:post.skipped}},data:{table_count:config.tables.length,tables},omitted_data_tables:names.filter(n=>!parsed.tables[n]),sequences:[],callable_references:{},prerequisites:{roles:['anon','authenticated','service_role'],required_extensions:[]}};
 const parent=recovery.packRecoveryPackage({preData,postData:'',data,manifest},key).bytes;
 const payload=Object.fromEntries(names.map(n=>[n,{name:n,columns:columns[n].map(name=>({name,type:'text',not_null:false,identity:'',generated:''})),primary_key:[],rows:values[n]}]));
 return complete.encode(parent,payload,key,{version:1,consumer_closure_proven:false,sequences:[]},[]);
}
(async()=>{try{
 const bytes=Buffer.from('synthetic-image'),item={bucket:'assets',path:'a.png',version:'synthetic-v1',size:bytes.length,sha256:sha(bytes)};
 fs.mkdirSync(path.join(root,'assets'));fs.writeFileSync(path.join(root,'assets/a.png'),bytes);
 const inventoryBytes=exportsApi.signInventory({format:'reviewed-object-inventory-v1',buckets:[{id:'assets',public:true,file_size_limit:null,allowed_mime_types:null}],objects:[item]},key);
 const applicationBytes=packageBytes(),options={applicationBytes,inventoryBytes,hmacInput:key,restoredDirectory:root};
 const result=await coverage.verify(options);assert.equal(result.reference_counts.direct_bytes_verified,1);assert.equal(result.inventory_object_bytes_verified,1);assert.equal(result.hosted_accessibility_proven,false);assert.equal(result.sql_storage_atomic_snapshot_proven,false);
 assert.equal(result.reference_byte_coverage_complete,true);
 const rescued=await coverage.verify({...options,applicationBytes:packageBytes(false,true)});assert.equal(rescued.reference_counts.mapped_copy_bytes_verified,1);assert.equal(rescued.reference_byte_coverage_complete,false);assert.equal(rescued.original_to_rescued_byte_equality_proven,false);
 const equality=require('../scripts/linear-exit-asset-equality'),adapter={stat:async()=>({version:'synthetic-v1',size:bytes.length}),async *open(){yield bytes;}};
 const original='https://uploads.linear.app/synthetic-image',rescuedUrl='https://'+backup.PRODUCTION_REF+'.supabase.co/storage/v1/object/public/assets/a.png';
 const equalityEvidenceBytes=await equality.observe({inventoryBytes,hmacInput:key,references:[{original_url:original,rescued_url:rescuedUrl,bucket:item.bucket,path:item.path}],originalAdapter:adapter,rescuedAdapter:adapter});
 const compared=await coverage.verify({...options,applicationBytes:packageBytes(false,true),equalityEvidenceBytes});assert.equal(compared.reference_counts.mapped_original_bytes_verified,1);assert.equal(compared.reference_counts.mapped_copy_bytes_verified,0);assert.equal(compared.original_to_rescued_byte_equality_proven,true);assert.equal(compared.sql_storage_atomic_snapshot_proven,false);
 const mixed=await coverage.verify({...options,applicationBytes:packageBytes(true,true),equalityEvidenceBytes});assert.equal(mixed.reference_counts.mapped_original_bytes_verified,1);assert(mixed.unclassified_other_table_cells>0);assert.equal(mixed.original_to_rescued_byte_equality_proven,false);assert.equal(mixed.reference_byte_coverage_complete,false);
 const substituted=await equality.observe({inventoryBytes,hmacInput:key,references:[{original_url:original+'-other',rescued_url:rescuedUrl,bucket:item.bucket,path:item.path}],originalAdapter:adapter,rescuedAdapter:adapter});
 const unmatched=await coverage.verify({...options,applicationBytes:packageBytes(false,true),equalityEvidenceBytes:substituted});assert.equal(unmatched.reference_counts.mapped_copy_bytes_verified,1);assert.equal(unmatched.original_to_rescued_byte_equality_proven,false);assert.equal(unmatched.reference_byte_coverage_complete,false);
 const unknown=await coverage.verify({...options,applicationBytes:packageBytes(true)});assert(unknown.unclassified_other_table_cells>0);assert.equal(unknown.reference_byte_coverage_complete,false);
 const missing=await coverage.verify({...options,inventoryBytes:exportsApi.signInventory({format:'reviewed-object-inventory-v1',buckets:[],objects:[]},key)});assert.equal(missing.reference_counts.missing_object,1);assert.equal(missing.reference_byte_coverage_complete,false);
 const tampered=Buffer.from(applicationBytes);tampered[100]^=1;await assert.rejects(coverage.verify({...options,applicationBytes:tampered}),/ASSET_REFERENCE_INPUT_REFUSED/);
 const badInventory=Buffer.from(inventoryBytes);badInventory[50]^=1;await assert.rejects(coverage.verify({...options,inventoryBytes:badInventory}),/ASSET_REFERENCE_INPUT_REFUSED/);
 const collision=exportsApi.signInventory({format:'reviewed-object-inventory-v1',buckets:[{id:'assets',public:true,file_size_limit:null,allowed_mime_types:null}],objects:[item,{...item,path:'A.png'}]},key);await assert.rejects(coverage.verify({...options,inventoryBytes:collision}),/ASSET_REFERENCE_INPUT_REFUSED/);
 fs.writeFileSync(path.join(root,'assets/a.png'),'wrong');await assert.rejects(coverage.verify(options),/ASSET_REFERENCE_INPUT_REFUSED/);
 for(const url of ['https://evil.invalid/storage/v1/object/public/assets/a.png','https://'+backup.PRODUCTION_REF+'.supabase.co/storage/v1/object/public/assets/%2fescape','https://'+backup.PRODUCTION_REF+'.supabase.co/storage/v1/object/public/assets/%5cescape','https://'+backup.PRODUCTION_REF+'.supabase.co/storage/v1/object/public/assets/a.png?versionId=old'])assert.equal(coverage.locator(url,backup.PRODUCTION_REF),null);
 const text=JSON.stringify(result);assert(!text.includes('synthetic-image'));assert(!text.includes('a.png'));assert(!text.includes('https://'));
 console.log('ASSET_REFERENCE_COVERAGE_OK authenticated package/object correlation, missing/tampered/unclassified refusals, opaque output');
 }finally{assert(path.dirname(root)===fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
