'use strict';
// Entirely synthetic, offline bytes. No export/census/hosted restore claim.
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const api=require('../scripts/linear-exit-object-custody');
const {canonicalJson,parseHmacKey}=require('../scripts/track-b-backup');
const key=crypto.randomBytes(32).toString('base64');
const buckets=[{id:'synthetic-private',public:false,file_size_limit:null,allowed_mime_types:null}];
const objects=[{bucket:buckets[0].id,path:'nested/été.bin',bytes:Buffer.from([0,255,39,10,92])},{bucket:buckets[0].id,path:'empty.txt',bytes:Buffer.alloc(0)}];
const bytes=api.encode({buckets,objects,hmacInput:key});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'object-custody-'));
let count=0;function check(name,fn){fn();count++;process.stdout.write('PASS '+name+'\n');}
const restore=target=>api.restore({bytes,hmacInput:key,target});
const verify=target=>api.verify({bytes,hmacInput:key,target});
function reseal(change){const p=api.decode(bytes,key);change(p);const body=Buffer.concat([Buffer.from('SYNCVIEW-OBJECT-CUSTODY-V1\n'),Buffer.from(canonicalJson(p))]);return Buffer.concat([body,crypto.createHmac('sha256',parseHmacKey(key)).update(body).digest()]);}
try{
 check('authenticated bucket metadata and exact binary paths',()=>{const target=path.join(temp,'good');const result=restore(target);assert.deepStrictEqual(result.buckets,buckets);assert.strictEqual(result.capture_provenance_proven,false);assert.strictEqual(result.export_completeness_proven,false);assert.deepStrictEqual(fs.readFileSync(path.join(target,objects[0].bucket,objects[0].path)),objects[0].bytes);assert(verify(target));});
 check('existing target never overwritten',()=>{const target=path.join(temp,'good');assert.throws(()=>restore(target),/EEXIST/);assert(verify(target));});
 check('MAC corruption refused',()=>{const bad=Buffer.from(bytes);bad[bad.length-1]^=1;assert.throws(()=>api.decode(bad,key),/AUTH/);});
 check('wrong key refused',()=>assert.throws(()=>api.decode(bytes,crypto.randomBytes(32).toString('base64')),/AUTH/));
 check('authenticated corrupt object bytes refused',()=>assert.throws(()=>api.decode(reseal(p=>p.objects[0].bytes='YWJj'),key),/BYTES/));
 check('authenticated wrong size refused',()=>assert.throws(()=>api.decode(reseal(p=>p.objects[0].size++),key),/BYTES/));
 check('duplicate paths refused',()=>assert.throws(()=>api.decode(reseal(p=>p.objects.push(p.objects[0])),key),/IDENTITY/));
 check('case collision refused',()=>assert.throws(()=>api.decode(reseal(p=>p.objects.push({...p.objects[0],path:p.objects[0].path.toUpperCase()})),key),/IDENTITY/));
 check('traversal and platform unsafe names refused',()=>{for(const value of ['../outside','/absolute','C:/outside','a\\b','con.txt','a/../b','a//b'])assert.throws(()=>api.decode(reseal(p=>p.objects[0].path=value),key),/PATH/);});
 check('unknown bucket refused',()=>assert.throws(()=>api.decode(reseal(p=>p.objects[0].bucket='missing'),key),/IDENTITY/));
 check('false completeness cannot be promoted',()=>assert.throws(()=>api.decode(reseal(p=>p.export_completeness_proven=true),key),/CONTRACT/));
 check('missing restored file refused',()=>{const target=path.join(temp,'missing');restore(target);fs.unlinkSync(path.join(target,objects[0].bucket,objects[0].path));assert.throws(()=>verify(target),/FILE_SET/);});
 check('extra restored file refused',()=>{const target=path.join(temp,'extra');restore(target);fs.writeFileSync(path.join(target,'extra'),'synthetic');assert.throws(()=>verify(target),/FILE_SET/);});
 check('corrupt restored file refused',()=>{const target=path.join(temp,'corrupt');restore(target);fs.writeFileSync(path.join(target,objects[0].bucket,objects[0].path),'bad');assert.throws(()=>verify(target),/BYTES/);});
 check('file directory conflict fails with owned target cleanup',()=>{const target=path.join(temp,'conflict');const bad=api.encode({buckets,objects:[{...objects[0],path:'a'},{...objects[1],path:'a/b'}],hmacInput:key});assert.throws(()=>api.restore({bytes:bad,hmacInput:key,target}));assert(!fs.existsSync(target));});
 check('file-backed object exceeds old total cap with bounded chunks',()=>{
  const source=path.join(temp,'synthetic-video.bin'),fd=fs.openSync(source,'wx');const block=crypto.randomBytes(1024*1024);try{for(let i=0;i<35;i++)fs.writeSync(fd,block);fs.writeSync(fd,Buffer.from('tail'));}finally{fs.closeSync(fd);}
  const pkg=path.join(temp,'package'),target=path.join(temp,'stream-restored');api.packFiles({buckets,objects:[{bucket:buckets[0].id,path:'video/original.bin',source}],hmacInput:key,target:pkg});const manifest=api.verifyFiles({packageDirectory:pkg,hmacInput:key});assert.strictEqual(manifest.objects[0].chunks.length,36);assert.strictEqual(manifest.objects[0].size,35*1024*1024+4);api.restoreFiles({packageDirectory:pkg,hmacInput:key,target});const restored=path.join(target,buckets[0].id,'video/original.bin');assert.strictEqual(fs.statSync(restored).size,manifest.objects[0].size);const digest=crypto.createHash('sha256'),rfd=fs.openSync(restored,'r'),buffer=Buffer.alloc(1024*1024);try{let n;while((n=fs.readSync(rfd,buffer,0,buffer.length,null)))digest.update(buffer.subarray(0,n));}finally{fs.closeSync(rfd);}assert.strictEqual(digest.digest('hex'),manifest.objects[0].sha256);
  assert.throws(()=>api.restoreFiles({packageDirectory:pkg,hmacInput:key,target}),/EEXIST/);
  fs.writeFileSync(path.join(pkg,'unexpected'),'x');assert.throws(()=>api.verifyFiles({packageDirectory:pkg,hmacInput:key}),/FILE_SET/);fs.unlinkSync(path.join(pkg,'unexpected'));
  const last=path.join(pkg,manifest.objects[0].chunks[35].file),lastBytes=fs.readFileSync(last);fs.unlinkSync(last);assert.throws(()=>api.verifyFiles({packageDirectory:pkg,hmacInput:key}),/FILE_SET/);fs.writeFileSync(last,lastBytes);
  const macFile=path.join(pkg,'manifest.mac'),mac=fs.readFileSync(macFile),badMac=Buffer.from(mac);badMac[0]^=1;fs.writeFileSync(macFile,badMac);assert.throws(()=>api.verifyFiles({packageDirectory:pkg,hmacInput:key}),/AUTH/);fs.writeFileSync(macFile,mac);
  // Corrupt the final chunk: all 35 preceding chunks must be discarded too.
  fs.writeFileSync(last,Buffer.from('FAIL'));const failed=path.join(temp,'failed-stream');assert.throws(()=>api.restoreFiles({packageDirectory:pkg,hmacInput:key,target:failed}),/BYTES/);assert(!fs.existsSync(failed));
 });
 check('file-backed failed creation cleans only new package',()=>{const target=path.join(temp,'bad-package');assert.throws(()=>api.packFiles({buckets,objects:[{bucket:buckets[0].id,path:'x',source:path.join(temp,'absent')}],hmacInput:key,target}));assert(!fs.existsSync(target));});
 check('source mutation during packing refuses and cleans package',()=>{const source=path.join(temp,'changing.bin'),target=path.join(temp,'changing-package');fs.writeFileSync(source,Buffer.alloc(2*1024*1024));const original=fs.writeFileSync;let changed=false;try{fs.writeFileSync=function(file,...args){const result=original.call(fs,file,...args);if(!changed&&String(file).endsWith('.chunk')){changed=true;fs.appendFileSync(source,'changed');}return result;};assert.throws(()=>api.packFiles({buckets,objects:[{bucket:buckets[0].id,path:'changing.bin',source}],hmacInput:key,target}),/SOURCE_CHANGED/);}finally{fs.writeFileSync=original;}assert(changed);assert(!fs.existsSync(target));});
 process.stdout.write('OBJECT_CUSTODY_OFFLINE_PASS '+count+'; live export, completeness, encryption, off-device custody and hosted access UNPROVEN\n');
}finally{const resolved=path.resolve(temp);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('object-custody-'))throw Error('TEMP_BOUNDARY');fs.rmSync(resolved,{recursive:true,force:true});}
