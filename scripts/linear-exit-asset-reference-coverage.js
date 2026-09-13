'use strict';
// Offline SQL-package to restored-object correlation. No network or live claim.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const complete=require('./linear-exit-complete-application-data');
const objects=require('./linear-exit-object-export');
const history=require('./linear-history-coverage/scan');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('ASSET_REFERENCE_INPUT_REFUSED');};
const id=o=>JSON.stringify([o.bucket,o.path]);
function rows(table){
 if(!table||!Array.isArray(table.columns)||!Array.isArray(table.rows))fail();
 return table.rows.map(row=>Object.fromEntries(table.columns.map((c,i)=>{
  const v=row[i];if(v===null)return [c.name,null];
  if(typeof v!=='string')fail();
  if(c.type==='json'||c.type==='jsonb'){try{return [c.name,JSON.parse(v)];}catch{fail();}}
  if(c.type==='boolean'){if(v!=='t'&&v!=='f')fail();return [c.name,v==='t'];}
  return [c.name,v];
 })));
}
function locator(value,projectRef){
 try{
  const u=new URL(value);
  if(u.protocol!=='https:'||u.hostname!==projectRef+'.supabase.co'||u.port||u.username||u.password)return null;
  if([...u.searchParams.keys()].some(k=>k!=='token'&&k!=='download'))return null;
  const m=u.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
  if(!m)return null;
  const parts=[m[1],...m[2].split('/')].map(decodeURIComponent);
  if(parts.some(p=>!p||p==='.'||p==='..'||/[\\/\x00-\x1f]/.test(p)))return null;
  return {bucket:parts[0],path:parts.slice(1).join('/')};
 }catch{return null;}
}
function readback(root,item){
 const parts=[item.bucket,...item.path.split('/')];
 if(parts.some(p=>!p||p==='.'||p==='..'||/[\\/:<>"|?*\x00-\x1f]/.test(p)||/[ .]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))fail();
 let current=root;
 for(let i=0;i<parts.length;i++){
  current=path.join(current,parts[i]);const st=fs.lstatSync(current);
  if(st.isSymbolicLink()||(i<parts.length-1?!st.isDirectory():!st.isFile()))fail();
 }
 const fd=fs.openSync(current,'r'),digest=crypto.createHash('sha256'),buf=Buffer.alloc(1024*1024);let total=0;
 try{for(;;){const n=fs.readSync(fd,buf,0,buf.length,null);if(!n)break;total+=n;digest.update(buf.subarray(0,n));}}finally{fs.closeSync(fd);}
 if(total!==item.size||digest.digest('hex')!==item.sha256)fail();
}
async function verify({applicationBytes,inventoryBytes,hmacInput,restoredDirectory,equalityEvidenceBytes}){
 try{
  const {parent,payload}=complete.read(applicationBytes,hmacInput),inventory=objects.readInventory(inventoryBytes,hmacInput);
  const equality=require('./linear-exit-asset-equality');
  const equalityEvidence=equalityEvidenceBytes===undefined?null:equality.read(equalityEvidenceBytes,inventoryBytes,hmacInput);
  const projectRef=parent.manifest.source_project_ref;if(!/^[a-z]{20}$/.test(projectRef))fail();
  if(!path.isAbsolute(restoredDirectory)||fs.realpathSync(restoredDirectory)!==path.resolve(restoredDirectory))fail();
  const root=path.resolve(restoredDirectory),found=new Map(),portableNames=new Set();
  for(const item of inventory.objects){const portable=id(item).toLowerCase();if(portableNames.has(portable))fail();portableNames.add(portable);readback(root,item);found.set(id(item),item);}
  const data={},tables={};
  for(const name of Object.keys(history.REQUIRED)){
   const t=payload.tables[name];data[name]=rows(t);
   tables[name]={fields:t.columns.map(c=>c.name),pagination:{complete:true,next_cursor:null,expected_rows:t.rows.length,returned_rows:t.rows.length}};
  }
  let references=[];
  const report=await history.scan({contract:history.CONTRACT,metadata:{source:{kind:'private_snapshot',description:'Authenticated complete application package',artifact_sha256:sha(applicationBytes)},captured_at:parent.manifest.completed_at,known_omissions:[],tables},data,mappings:[],observations:[]},{inspectReferences:r=>{references=r;}});
  const counts={direct_bytes_verified:0,mapped_copy_bytes_verified:0,mapped_original_bytes_verified:0,missing_object:0,unresolved:0,unsupported:0};
  for(const ref of references){
   if(ref.unsupported){counts.unsupported++;continue;}
   let target=ref.category==='thumbnail_storage'?{bucket:'syncview-thumbnail-revisions',path:ref.value}:locator(ref.value,projectRef),mapped=false,rescuedUrl;
   if(!target){
    const alternatives=data.linear_archive_asset_refs.filter(r=>r.original_url===ref.value&&typeof r.rescued_url==='string');
    if(alternatives.length===1){rescuedUrl=alternatives[0].rescued_url;target=locator(rescuedUrl,projectRef);mapped=true;}
   }
   if(!target){counts.unresolved++;continue;}
   if(!found.has(id(target))){counts.missing_object++;continue;}
   const matched=mapped&&equalityEvidence&&equality.matches(equalityEvidence,ref.value,rescuedUrl,found.get(id(target)));
   counts[mapped?(matched?'mapped_original_bytes_verified':'mapped_copy_bytes_verified'):'direct_bytes_verified']++;
  }
  // All other tables remain visible if they contain unclassified URL-bearing data.
  let otherReferenceCells=0;
  for(const [name,t] of Object.entries(payload.tables))if(!Object.hasOwn(history.REQUIRED,name))
   for(const row of t.rows)for(const cell of row)if(typeof cell==='string'&&/https?:\/\/|\b(?:data|blob|ftp):/i.test(cell))otherReferenceCells++;
  return {format:'linear-exit-asset-reference-coverage-v1',application_sha256:sha(applicationBytes),inventory_sha256:sha(inventoryBytes),authenticated_inputs:true,inventory_object_bytes_verified:inventory.objects.length,reference_counts:counts,unclassified_other_table_cells:otherReferenceCells,history_report:report,
   reference_byte_coverage_complete:report.status!=='incomplete'&&!otherReferenceCells&&!counts.missing_object&&!counts.unresolved&&!counts.unsupported&&!counts.mapped_copy_bytes_verified,
   source_snapshot_authenticity_proven:false,sql_storage_atomic_snapshot_proven:false,original_to_rescued_byte_equality_proven:report.status!=='incomplete'&&!otherReferenceCells&&counts.mapped_original_bytes_verified>0&&!counts.mapped_copy_bytes_verified&&!counts.unresolved&&!counts.unsupported&&!counts.missing_object,hosted_accessibility_proven:false,off_device_custody_proven:false};
 }catch{fail();}
}
module.exports={verify,locator};
