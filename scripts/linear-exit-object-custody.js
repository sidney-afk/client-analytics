'use strict';
// Offline supplied-object custody only. HMAC authenticates; it does not encrypt.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {canonicalJson,parseHmacKey}=require('./track-b-backup');
const MAGIC=Buffer.from('SYNCVIEW-OBJECT-CUSTODY-V1\n');
const MAX=32*1024*1024;
const fail=code=>{throw Error('OBJECT_CUSTODY_'+code);};
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const exact=(o,k)=>{if(!o||Array.isArray(o)||typeof o!=='object'||canonicalJson(Object.keys(o).sort())!==canonicalJson(k.sort()))fail('SHAPE');};
function safeName(s){
 if(typeof s!=='string'||!s||s.length>240||s.split('/').some(x=>!x||x==='.'||x==='..'||/[\\:<>"|?*\x00-\x1f]/.test(x)||/[ .]$/.test(x)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x)))fail('PATH');
 return s;
}
function validate(p){
 exact(p,['format','capture_provenance_proven','export_completeness_proven','buckets','objects']);
 if(p.format!=='object-custody-v1'||p.capture_provenance_proven!==false||p.export_completeness_proven!==false||!Array.isArray(p.buckets)||!Array.isArray(p.objects))fail('CONTRACT');
 const buckets=new Set(),objects=new Set();
 for(const b of p.buckets){exact(b,['id','public','file_size_limit','allowed_mime_types']);safeName(b.id);if(b.id.includes('/')||buckets.has(b.id.toLowerCase())||typeof b.public!=='boolean'||(b.file_size_limit!==null&&(!Number.isSafeInteger(b.file_size_limit)||b.file_size_limit<0))||(b.allowed_mime_types!==null&&(!Array.isArray(b.allowed_mime_types)||b.allowed_mime_types.some(x=>typeof x!=='string'))))fail('BUCKET');buckets.add(b.id.toLowerCase());}
 for(const o of p.objects){exact(o,['bucket','path','size','sha256','bytes']);safeName(o.bucket);safeName(o.path);const name=o.bucket+'/'+o.path;if(!p.buckets.some(b=>b.id===o.bucket)||objects.has(name.toLowerCase()))fail('IDENTITY');objects.add(name.toLowerCase());if(!Number.isSafeInteger(o.size)||o.size<0||o.size>MAX||typeof o.bytes!=='string'||! /^[a-f0-9]{64}$/.test(o.sha256))fail('SIZE');const bytes=Buffer.from(o.bytes,'base64');if(bytes.toString('base64')!==o.bytes||bytes.length!==o.size||hash(bytes)!==o.sha256)fail('BYTES');}
 return p;
}
function encode({buckets,objects,hmacInput}){
 if(typeof hmacInput!=='string')fail('KEY');
 if(!Array.isArray(objects)||objects.reduce((n,o)=>n+(Buffer.isBuffer(o.bytes)?o.bytes.length:MAX+1),0)>MAX)fail('SIZE');
 const payload=validate({format:'object-custody-v1',capture_provenance_proven:false,export_completeness_proven:false,buckets,objects:objects.map(o=>{if(!Buffer.isBuffer(o.bytes))fail('BYTES');return {bucket:o.bucket,path:o.path,size:o.bytes.length,sha256:hash(o.bytes),bytes:o.bytes.toString('base64')};})});
 const body=Buffer.concat([MAGIC,Buffer.from(canonicalJson(payload))]);if(body.length>MAX)fail('SIZE');
 return Buffer.concat([body,crypto.createHmac('sha256',parseHmacKey(hmacInput)).update(body).digest()]);
}
function decode(bytes,hmacInput){
 if(typeof hmacInput!=='string')fail('KEY');if(!Buffer.isBuffer(bytes)||bytes.length<MAGIC.length+34||bytes.length>MAX+32||!bytes.subarray(0,MAGIC.length).equals(MAGIC))fail('FRAME');
 const body=bytes.subarray(0,-32),mac=crypto.createHmac('sha256',parseHmacKey(hmacInput)).update(body).digest();if(!crypto.timingSafeEqual(mac,bytes.subarray(-32)))fail('AUTH');
 const raw=body.subarray(MAGIC.length);let p;try{p=JSON.parse(raw);}catch(_){fail('JSON');}if(!Buffer.from(canonicalJson(p)).equals(raw))fail('CANONICAL');return validate(p);
}
function restore({bytes,hmacInput,target}){
 const p=decode(bytes,hmacInput);const root=path.resolve(target);const parent=fs.realpathSync(path.dirname(root));if(path.dirname(root)!==parent)fail('TARGET_PARENT');
 // Caller owns a private parent directory: hostile concurrent filesystem edits
 // and platform ACL custody are not covered. Existing targets always refuse.
 fs.mkdirSync(root,{mode:0o700});
 try{for(const o of p.objects){const dest=path.join(root,o.bucket,...o.path.split('/'));if(!dest.startsWith(root+path.sep))fail('PATH');fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.writeFileSync(dest,Buffer.from(o.bytes,'base64'),{flag:'wx',mode:0o600});}
  verifyDirectory(p,root);
  return {objects:p.objects.length,buckets:p.buckets,bytes_verified:true,capture_provenance_proven:false,export_completeness_proven:false,hosted_accessibility_proven:false,off_device_custody_proven:false,encryption_proven:false};
 }catch(e){fs.rmSync(root,{recursive:true,force:true});throw e;}
}
function verifyDirectory(p,root){
 validate(p);const found=[];function walk(dir,prefix=''){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const name=prefix+d.name,full=path.join(dir,d.name);if(d.isSymbolicLink())fail('SYMLINK');if(d.isDirectory())walk(full,name+'/');else if(d.isFile())found.push(name);else fail('FILE');}}walk(root);
 const expected=p.objects.map(o=>o.bucket+'/'+o.path).sort();if(canonicalJson(found.sort())!==canonicalJson(expected))fail('FILE_SET');for(const o of p.objects){const b=fs.readFileSync(path.join(root,o.bucket,...o.path.split('/')));if(b.length!==o.size||hash(b)!==o.sha256)fail('BYTES');}return true;
}
function verify({bytes,hmacInput,target}){return verifyDirectory(decode(bytes,hmacInput),path.resolve(target));}
module.exports={encode,decode,restore,verify};

// File-backed v2: fixed chunks bound memory, not total object bytes. The
// authenticated metadata alone has a 64 MiB parsing limit. Private filesystem
// custody is required; no hostile concurrent directory writer is supported.
const CHUNK=1024*1024, MANIFEST_MAX=64*1024*1024;
function newRoot(target){const root=path.resolve(target);if(fs.realpathSync(path.dirname(root))!==path.dirname(root))fail('TARGET_PARENT');fs.mkdirSync(root,{mode:0o700});return root;}
function keyBytes(value){if(typeof value!=='string')fail('KEY');return parseHmacKey(value);}
function plainFile(file){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink())fail('FILE');return st;}
function chunkName(i){return String(i).padStart(12,'0')+'.chunk';}
function boundedRead(file,max){const named=plainFile(file);if(named.size>max)fail('SIZE');const fd=fs.openSync(file,'r');try{const st=fs.fstatSync(fd);if(!st.isFile()||st.ino!==named.ino||st.size!==named.size)fail('FILE_CHANGED');const b=Buffer.alloc(st.size);let n=0;while(n<b.length){const got=fs.readSync(fd,b,n,b.length-n,null);if(!got)fail('FILE_CHANGED');n+=got;}if(fs.readSync(fd,Buffer.alloc(1),0,1,null)!==0)fail('FILE_CHANGED');return b;}finally{fs.closeSync(fd);}}
function readManifest(root,hmacInput){
 const file=path.join(root,'manifest.json');if(plainFile(file).size>MANIFEST_MAX)fail('MANIFEST_SIZE');
 const raw=boundedRead(file,MANIFEST_MAX),macFile=path.join(root,'manifest.mac');if(plainFile(macFile).size!==32)fail('AUTH');
 const mac=crypto.createHmac('sha256',keyBytes(hmacInput)).update(raw).digest();if(!crypto.timingSafeEqual(mac,boundedRead(macFile,32)))fail('AUTH');
 let p;try{p=JSON.parse(raw.toString('utf8'));}catch(_){fail('JSON');}if(!Buffer.from(canonicalJson(p)).equals(raw))fail('CANONICAL');
 exact(p,['format','capture_provenance_proven','export_completeness_proven','buckets','objects']);if(p.format!=='object-custody-files-v2'||p.capture_provenance_proven!==false||p.export_completeness_proven!==false||!Array.isArray(p.objects))fail('CONTRACT');
 // Reuse portable name and bucket validation without allocating object bytes.
 validate({format:'object-custody-v1',capture_provenance_proven:false,export_completeness_proven:false,buckets:p.buckets,objects:[]});
 const identities=new Set();let next=0;for(const o of p.objects){exact(o,['bucket','path','size','sha256','chunks']);safeName(o.bucket);safeName(o.path);const id=(o.bucket+'/'+o.path).toLowerCase();if(identities.has(id)||!p.buckets.some(b=>b.id===o.bucket))fail('IDENTITY');identities.add(id);if(!Number.isSafeInteger(o.size)||o.size<0||! /^[a-f0-9]{64}$/.test(o.sha256)||!Array.isArray(o.chunks))fail('SIZE');let size=0;for(let i=0;i<o.chunks.length;i++){const c=o.chunks[i];exact(c,['file','size','sha256']);if(c.file!==chunkName(next++)||!Number.isSafeInteger(c.size)||c.size<1||c.size>CHUNK||(i<o.chunks.length-1&&c.size!==CHUNK)||! /^[a-f0-9]{64}$/.test(c.sha256))fail('CHUNK');size+=c.size;}if(size!==o.size)fail('SIZE');}
 const expected=['manifest.json','manifest.mac',...p.objects.flatMap(o=>o.chunks.map(c=>c.file))].sort();if(canonicalJson(fs.readdirSync(root).sort())!==canonicalJson(expected))fail('FILE_SET');return p;
}
function visitChunks(root,p,onChunk=()=>{}){for(const o of p.objects){const digest=crypto.createHash('sha256');for(const c of o.chunks){const file=path.join(root,c.file);if(plainFile(file).size!==c.size)fail('BYTES');const b=boundedRead(file,CHUNK);if(b.length!==c.size||hash(b)!==c.sha256)fail('BYTES');digest.update(b);onChunk(o,b);}if(digest.digest('hex')!==o.sha256)fail('BYTES');}}
function verifyFiles({packageDirectory,hmacInput}){const root=path.resolve(packageDirectory);const p=readManifest(root,hmacInput);visitChunks(root,p);return p;}
function packFiles({buckets,objects,hmacInput,target}){
 const key=keyBytes(hmacInput);validate({format:'object-custody-v1',capture_provenance_proven:false,export_completeness_proven:false,buckets,objects:[]});
 const root=newRoot(target);try{const p={format:'object-custody-files-v2',capture_provenance_proven:false,export_completeness_proven:false,buckets,objects:[]};let next=0;
 for(const input of objects){safeName(input.bucket);safeName(input.path);const before=plainFile(input.source);const fd=fs.openSync(input.source,'r');const digest=crypto.createHash('sha256'),chunks=[];let size=0;try{const opened=fs.fstatSync(fd);if(opened.ino!==before.ino||opened.size!==before.size||opened.mtimeMs!==before.mtimeMs)fail('SOURCE_CHANGED');const buffer=Buffer.alloc(CHUNK);for(;;){let n=0;while(n<CHUNK){const got=fs.readSync(fd,buffer,n,CHUNK-n,null);if(!got)break;n+=got;}if(!n)break;const b=buffer.subarray(0,n),file=chunkName(next++);digest.update(b);size+=n;chunks.push({file,size:n,sha256:hash(b)});fs.writeFileSync(path.join(root,file),b,{flag:'wx',mode:0o600});}const after=fs.fstatSync(fd),named=plainFile(input.source);if(size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||named.ino!==before.ino||named.size!==before.size||named.mtimeMs!==before.mtimeMs)fail('SOURCE_CHANGED');}finally{fs.closeSync(fd);}p.objects.push({bucket:input.bucket,path:input.path,size,sha256:digest.digest('hex'),chunks});}
 const raw=Buffer.from(canonicalJson(p));if(raw.length>MANIFEST_MAX)fail('MANIFEST_SIZE');fs.writeFileSync(path.join(root,'manifest.json'),raw,{flag:'wx',mode:0o600});fs.writeFileSync(path.join(root,'manifest.mac'),crypto.createHmac('sha256',key).update(raw).digest(),{flag:'wx',mode:0o600});verifyFiles({packageDirectory:root,hmacInput});return {objects:p.objects.length,capture_provenance_proven:false,export_completeness_proven:false};
 }catch(e){fs.rmSync(root,{recursive:true,force:true});throw e;}
}
function restoreFiles({packageDirectory,hmacInput,target}){
 const source=path.resolve(packageDirectory),p=readManifest(source,hmacInput);const root=newRoot(target);let fd;
 try{for(const o of p.objects){const dest=path.join(root,o.bucket,...o.path.split('/'));fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fd=fs.openSync(dest,'wx',0o600);try{visitChunks(source,{objects:[o]},(_,b)=>{let offset=0;while(offset<b.length)offset+=fs.writeSync(fd,b,offset,b.length-offset);});}finally{fs.closeSync(fd);fd=undefined;}}
 return {objects:p.objects.length,buckets:p.buckets,bytes_verified:true,capture_provenance_proven:false,export_completeness_proven:false,hosted_accessibility_proven:false,off_device_custody_proven:false,encryption_proven:false};
 }catch(e){if(fd!==undefined)fs.closeSync(fd);fs.rmSync(root,{recursive:true,force:true});throw e;}
}
Object.assign(module.exports,{packFiles,verifyFiles,restoreFiles});
