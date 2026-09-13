'use strict';
// Authenticated observations of actual bytes, not an assertion supplied by a caller.
// Evidence contains URL hashes only; keep even this artifact in private custody.
const crypto=require('node:crypto');
const {canonicalJson:canon,parseHmacKey}=require('./track-b-backup');
const objects=require('./linear-exit-object-export');
const FORMAT='asset-original-rescue-equality-v1',MAX=16*1024*1024;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=()=>{throw Error('ASSET_EQUALITY_REFUSED');};
function key(k){if(typeof k!=='string')fail();return parseHmacKey(k);}
function url(value){if(typeof value!=='string'||value.length>16384)fail();const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port)fail();return value;}
function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||canon(Object.keys(v).sort())!==canon(keys.sort()))fail();}
function stat(v){exact(v,['version','size']);if(typeof v.version!=='string'||!v.version||v.version.length>4096||!Number.isSafeInteger(v.size)||v.size<0)fail();return {version:v.version,size:v.size};}
async function digest(adapter,reference,maxBytes){
 if(typeof adapter?.stat!=='function'||typeof adapter?.open!=='function')fail();
 const before=stat(await adapter.stat(reference));if(before.size>maxBytes)fail();
 const stream=await adapter.open(reference,before);if(!stream||typeof stream[Symbol.asyncIterator]!=='function')fail();
 let size=0;const hash=crypto.createHash('sha256');
 for await(const value of stream){if(!(value instanceof Uint8Array)||!value.length)fail();size+=value.length;if(size>before.size||size>maxBytes)fail();hash.update(value);}
 if(size!==before.size||canon(stat(await adapter.stat(reference)))!==canon(before))fail();
 return {size,sha256:hash.digest('hex'),version_sha256:sha(before.version)};
}
async function observe({inventoryBytes,hmacInput,references,originalAdapter,rescuedAdapter,maxObjectBytes=64*1024*1024*1024}){
 try{
  const inventory=objects.readInventory(inventoryBytes,hmacInput);if(!Array.isArray(references)||references.length>10000||!Number.isSafeInteger(maxObjectBytes)||maxObjectBytes<1)fail();
  const seen=new Set(),entries=[];
  for(const ref of references){
   exact(ref,['original_url','rescued_url','bucket','path']);url(ref.original_url);url(ref.rescued_url);
   if(ref.original_url===ref.rescued_url)fail();
   const original=sha(ref.original_url),rescued=sha(ref.rescued_url),identity=canon([original,rescued]);if(seen.has(identity))fail();seen.add(identity);
   const item=inventory.objects.find(o=>o.bucket===ref.bucket&&o.path===ref.path);if(!item)fail();
   const a=await digest(originalAdapter,ref.original_url,maxObjectBytes),b=await digest(rescuedAdapter,ref.rescued_url,maxObjectBytes);
   if(a.size!==b.size||a.sha256!==b.sha256||b.size!==item.size||b.sha256!==item.sha256)fail();
   entries.push({original_url_sha256:original,rescued_url_sha256:rescued,object_sha256:sha(canon(item)),original_version_sha256:a.version_sha256,rescued_version_sha256:b.version_sha256,size:a.size,sha256:a.sha256});
  }
  const p={format:FORMAT,inventory_sha256:sha(inventoryBytes),observed_at:new Date().toISOString(),entries,transport_authenticity_proven:false,atomic_snapshot_proven:false};
  const body=Buffer.from(canon(p));if(body.length>MAX-32)fail();return Buffer.concat([crypto.createHmac('sha256',key(hmacInput)).update(body).digest(),body]);
 }catch{fail();}
}
function read(bytes,inventoryBytes,hmacInput){
 try{
  objects.readInventory(inventoryBytes,hmacInput);if(!Buffer.isBuffer(bytes)||bytes.length<34||bytes.length>MAX)fail();const body=bytes.subarray(32);
  if(!crypto.timingSafeEqual(bytes.subarray(0,32),crypto.createHmac('sha256',key(hmacInput)).update(body).digest()))fail();
  const p=JSON.parse(body.toString('utf8'));exact(p,['format','inventory_sha256','observed_at','entries','transport_authenticity_proven','atomic_snapshot_proven']);
  if(canon(p)!==body.toString('utf8')||p.format!==FORMAT||p.inventory_sha256!==sha(inventoryBytes)||p.transport_authenticity_proven!==false||p.atomic_snapshot_proven!==false||!Number.isFinite(Date.parse(p.observed_at))||!Array.isArray(p.entries)||p.entries.length>10000)fail();
  const seen=new Set();for(const e of p.entries){exact(e,['original_url_sha256','rescued_url_sha256','object_sha256','original_version_sha256','rescued_version_sha256','size','sha256']);if(Object.entries(e).some(([k,v])=>k==='size'?!Number.isSafeInteger(v)||v<0:typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v)))fail();const id=canon([e.original_url_sha256,e.rescued_url_sha256]);if(seen.has(id))fail();seen.add(id);}
  return p;
 }catch{fail();}
}
function matches(evidence,original,rescued,item){return evidence.entries.some(e=>e.original_url_sha256===sha(original)&&e.rescued_url_sha256===sha(rescued)&&e.object_sha256===sha(canon(item))&&e.sha256===item.sha256&&e.size===item.size);}
// Optional transport: exact HTTPS hosts, HEAD+GET only, no redirects or retries.
// ETag is an observed change detector, not proof that a provider version is immutable.
function httpsAdapter({hosts,headers={},timeoutMs=300000,fetchImpl=globalThis.fetch}){
 if(!Array.isArray(hosts)||!hosts.length||hosts.some(h=>typeof h!=='string'||!/^[a-z0-9.-]+$/.test(h))||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>1800000)fail();
 function checked(value){url(value);const u=new URL(value);if(!hosts.includes(u.hostname))fail();return value;}
 function metadata(r){const length=r.headers.get('content-length'),version=r.headers.get('etag');if(r.redirected||!r.ok||r.status!==200||r.headers.get('content-encoding')&&!['identity'].includes(r.headers.get('content-encoding'))||!/^\d+$/.test(length||''))fail();return stat({version,size:Number(length)});}
 return {async stat(reference){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const r=await fetchImpl(checked(reference),{method:'HEAD',headers,redirect:'error',signal:controller.signal});return metadata(r);}catch{fail();}finally{clearTimeout(timer);}},async *open(reference,expected){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);try{const r=await fetchImpl(checked(reference),{method:'GET',headers,redirect:'error',signal:controller.signal});if(canon(metadata(r))!==canon(expected)||!r.body)fail();for await(const chunk of r.body)yield chunk;}catch{fail();}finally{controller.abort();clearTimeout(timer);}}};
}
module.exports={observe,read,matches,httpsAdapter};
