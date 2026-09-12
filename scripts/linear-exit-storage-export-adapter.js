'use strict';
// Read-only Supabase Storage transport. No module-load network calls or credentials.
// Repeated censuses detect drift; they do not create an atomic Storage snapshot.
const crypto=require('crypto');
const {canonicalJson}=require('./track-b-backup');
const {readInventory,signInventory}=require('./linear-exit-object-export');
const fail=code=>{throw Error('STORAGE_EXPORT_'+code);};
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const identity=o=>canonicalJson([o.bucket,o.path]);
function segment(s){if(typeof s!=='string'||!s||s==='.'||s==='..'||/[\\/\x00-\x1f\x7f]/.test(s))fail('PATH');return encodeURIComponent(s);}
function objectPath(bucket,name){if(typeof name!=='string')fail('PATH');return segment(bucket)+'/'+name.split('/').map(segment).join('/');}
function createReader({projectRef,serviceKey,fetch:transport=globalThis.fetch,timeoutMs=300000,maxObjects=100000,maxPages=100000}){
 if(typeof projectRef!=='string'||!/^[a-z]{20}$/.test(projectRef)||typeof serviceKey!=='string'||serviceKey.length<32||/[\r\n]/.test(serviceKey)||typeof transport!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>1800000||![maxObjects,maxPages].every(n=>Number.isSafeInteger(n)&&n>0))fail('CONFIG');
 const base='https://'+projectRef+'.supabase.co/storage/v1';
 async function request(route,body){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await transport(base+route,{method:body===undefined?'GET':'POST',redirect:'error',cache:'no-store',signal:controller.signal,headers:{Authorization:'Bearer '+serviceKey,apikey:serviceKey,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   if(!response||!response.ok||response.status!==200||response.redirected||!response.body||controller.signal.aborted)fail('HTTP');
   return {response,controller,close:()=>{clearTimeout(timer);controller.abort();}};
  }catch(_){clearTimeout(timer);controller.abort();fail('REQUEST');}
 }
 async function* chunks(open,max){let size=0;try{for await(const part of open.response.body){if(open.controller.signal.aborted)fail('TIMEOUT');const b=Buffer.from(part);size+=b.length;if(size>max)fail('BODY_LIMIT');for(let i=0;i<b.length;i+=1024*1024)yield b.subarray(i,i+1024*1024);}if(open.controller.signal.aborted)fail('TIMEOUT');}catch(e){if(e.message?.startsWith('STORAGE_EXPORT_'))throw e;fail('BODY');}finally{open.close();}}
 async function json(route,body){const open=await request(route,body),parts=[];for await(const b of chunks(open,2*1024*1024))parts.push(b);try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch(_){fail('JSON');}}
 async function buckets(){const result=await json('/bucket');if(!Array.isArray(result))fail('BUCKETS');const seen=new Set();return result.map(b=>{segment(b?.id);if(seen.has(b.id)||b.id==='export-evidence'||(b.type!==undefined&&b.type!=='STANDARD')||typeof b.public!=='boolean')fail('BUCKET');seen.add(b.id);const item={id:b.id,public:b.public,file_size_limit:b.file_size_limit??null,allowed_mime_types:b.allowed_mime_types??null};if(item.file_size_limit!==null&&(!Number.isSafeInteger(item.file_size_limit)||item.file_size_limit<0)||item.allowed_mime_types!==null&&(!Array.isArray(item.allowed_mime_types)||item.allowed_mime_types.some(x=>typeof x!=='string')))fail('BUCKET_METADATA');return item;}).sort((a,b)=>a.id.localeCompare(b.id));}
 async function info(item,withMetadata=false){const row=await json('/object/info/'+objectPath(item.bucket,item.path));if(!row||row.name!==item.path||row.bucket_id!==item.bucket||typeof row.id!=='string'||!row.id||typeof row.version!=='string'||!row.version||!Number.isSafeInteger(row.size)||row.size<0)fail('INFO');const basic={bucket:item.bucket,path:item.path,version:row.version,size:row.size};if(!withMetadata)return basic;if(!['content_type','cache_control','etag','metadata','last_modified','created_at'].every(k=>Object.hasOwn(row,k)))fail('METADATA_MISSING');const metadata=Object.fromEntries(['content_type','cache_control','etag','metadata','last_modified','created_at','archived_at','is_delete_marker','is_versioned'].map(k=>[k,row[k]??null]));return {...basic,object_metadata:metadata};}
 async function census(){const bucketRows=await buckets(),objects=[],seen=new Set();let pages=0;
  for(const bucket of bucketRows){const folders=[''],visited=new Set();while(folders.length){const prefix=folders.shift();if(visited.has(prefix))fail('FOLDER_DUPLICATE');visited.add(prefix);let offset=0;for(;;){if(++pages>maxPages)fail('PAGE_LIMIT');const rows=await json('/object/list/'+segment(bucket.id),{prefix,limit:100,offset,sortBy:{column:'name',order:'asc'}});if(!Array.isArray(rows)||rows.length>100)fail('LIST');for(const row of rows){segment(row?.name);const name=prefix?prefix+'/'+row.name:row.name,id=identity({bucket:bucket.id,path:name});if(seen.has(id))fail('DUPLICATE');seen.add(id);if(row.id===null&&row.metadata===null){folders.push(name);continue;}if(typeof row.id!=='string'||!row.id)fail('LIST_OBJECT');if(objects.length>=maxObjects)fail('OBJECT_LIMIT');objects.push(await info({bucket:bucket.id,path:name}));}if(rows.length<100)break;offset+=rows.length;}}
  }return {buckets:bucketRows,objects:objects.sort((a,b)=>identity(a).localeCompare(identity(b)))};
 }
 async function download(item){const before=await info(item);if(before.version!==item.version||before.size!==item.size)fail('VERSION');const open=await request('/object/authenticated/'+objectPath(item.bucket,item.path));return {version:before.version,body:chunks(open,item.size)};}
 return {buckets,info,census,download};
}
function metadataOnly(item){return {bucket:item.bucket,path:item.path,version:item.version,size:item.size};}
function same(a,b){return canonicalJson(a)===canonicalJson(b);}
function createStorageExportAdapter(options){
 const inventory=readInventory(options.inventoryBytes,options.hmacInput),expected=new Map(inventory.objects.map(o=>[identity(o),o])),reader=createReader(options);
 return {
  listBuckets:()=>reader.buckets(),
  async listObjectMetadata(){const rows=[];for(const item of inventory.objects){const found=await reader.info(item,true);if(!same(metadataOnly(found),metadataOnly(item)))fail('INVENTORY_DRIFT');rows.push({bucket:found.bucket,path:found.path,version:found.version,metadata:found.object_metadata});}return rows;},
  async listPage(cursor){if(cursor!==null)fail('CURSOR');const observed=await reader.census();return {objects:observed.objects.map(item=>{const want=expected.get(identity(item));if(!want||!same(metadataOnly(want),item))fail('INVENTORY_DRIFT');return {...item,sha256:want.sha256};}),nextCursor:null};},
  download:item=>reader.download(item),
  async stat(item){const found=await reader.info(item),want=expected.get(identity(item));if(!want||!same(metadataOnly(want),found))fail('INVENTORY_DRIFT');return {...found,sha256:want.sha256};}
 };
}
async function captureStorageInventory(options){
 const reader=createReader(options),before=await reader.census(),objects=[],object_metadata=[];
 for(const item of before.objects){const metadataBefore=await reader.info(item,true);const response=await reader.download(item),hash=crypto.createHash('sha256');let size=0;for await(const bytes of response.body){size+=bytes.length;hash.update(bytes);}if(size!==item.size||!same(await reader.info(item),item))fail('CAPTURE_CHANGED');if(!same(metadataBefore,await reader.info(item,true)))fail('METADATA_CHANGED');object_metadata.push({bucket:item.bucket,path:item.path,version:item.version,metadata:metadataBefore.object_metadata});objects.push({...item,sha256:hash.digest('hex')});}
 const after=await reader.census();if(!same(before,after))fail('CENSUS_CHANGED');for(const expected of object_metadata){const actual=await reader.info(expected,true);if(!same(expected.metadata,actual.object_metadata)||expected.version!==actual.version)fail('METADATA_CHANGED');}
 const inventoryBytes=signInventory({format:'reviewed-object-inventory-v1',buckets:before.buckets,objects,object_metadata},options.hmacInput);
 return {inventoryBytes,inventory_sha256:digest(inventoryBytes),objects:objects.length,atomic_source_snapshot_proven:false,off_device_custody_proven:false};
}
module.exports={createStorageExportAdapter,captureStorageInventory};
