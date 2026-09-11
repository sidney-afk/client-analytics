'use strict';
// Local opt-in storage. Atomic hardlink publication, never overwrite/rename
// fallback. No Windows ACL, directory durability or off-device custody claim.
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const {verifyTriple}=require('./linear-exit-credential-companion');
const MAGIC=Buffer.from('SYNCVIEW-CREDENTIAL-TRIPLE-V1\n');
const MAX_COMPONENT_BYTES=128*1024*1024;
const HEADER=MAGIC.length+24;
const fail=code=>{throw Error('CREDENTIAL_TRIPLE_STORAGE_'+code);};
function encode({parentBytes,priorityBytes,credentialBytes,hmacInput}){
 const parts=[parentBytes,priorityBytes,credentialBytes];
 if(parts.some(b=>!Buffer.isBuffer(b)||!b.length||b.length>MAX_COMPONENT_BYTES))fail('SIZE');
 verifyTriple({parentBytes,priorityBytes,credentialBytes,hmacInput});
 const header=Buffer.alloc(HEADER);MAGIC.copy(header);
 parts.forEach((b,i)=>header.writeBigUInt64BE(BigInt(b.length),MAGIC.length+i*8));
 return Buffer.concat([header,...parts]);
}
function decode(bytes,hmacInput){
 if(!Buffer.isBuffer(bytes)||bytes.length<HEADER||bytes.length>HEADER+3*MAX_COMPONENT_BYTES||!bytes.subarray(0,MAGIC.length).equals(MAGIC))fail('FRAME');
 const sizes=[0,1,2].map(i=>bytes.readBigUInt64BE(MAGIC.length+i*8));
 if(sizes.some(n=>n<1n||n>BigInt(MAX_COMPONENT_BYTES))||BigInt(bytes.length)!==BigInt(HEADER)+sizes.reduce((a,b)=>a+b,0n))fail('LENGTH');
 let offset=HEADER;const parts=sizes.map(n=>{const b=bytes.subarray(offset,offset+Number(n));offset+=Number(n);return b;});
 const [parentBytes,priorityBytes,credentialBytes]=parts;
 const verified=verifyTriple({parentBytes,priorityBytes,credentialBytes,hmacInput});
 return {parentBytes,priorityBytes,credentialBytes,identity:{...verified.identity,credential_companion_sha256:crypto.createHash('sha256').update(credentialBytes).digest('hex'),priority_companion_sha256:crypto.createHash('sha256').update(priorityBytes).digest('hex')},same_snapshot_proven:false,encryption_proven:false};
}
function readTriple(file,key){
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>HEADER+3*MAX_COMPONENT_BYTES)fail('FILE');
 const fd=fs.openSync(file,'r');
 try{
  // Windows lstat may report dev=0 while fstat reports the volume ID; zero is
  // unavailable, not a different device. Inode equality still checks the open.
  const opened=fs.fstatSync(fd);if(!opened.isFile()||(opened.dev&&stat.dev&&opened.dev!==stat.dev)||opened.ino!==stat.ino||opened.size>HEADER+3*MAX_COMPONENT_BYTES)fail('FILE');
  const bytes=Buffer.alloc(opened.size);let offset=0;
  while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)fail('TRUNCATED');offset+=n;}
  if(fs.readSync(fd,Buffer.alloc(1),0,1,null)!==0)fail('LENGTH');
  return decode(bytes,key);
 }finally{fs.closeSync(fd);}
}
function writeTriple({directory,name,parentBytes,priorityBytes,credentialBytes,hmacInput}){
 const bytes=encode({parentBytes,priorityBytes,credentialBytes,hmacInput});
 if(typeof name!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(name))fail('NAME');
 const dir=fs.realpathSync(directory);if(!fs.statSync(dir).isDirectory())fail('DIRECTORY');
 const final=path.join(dir,name);const temporary=path.join(dir,'.credential-triple-'+crypto.randomBytes(16).toString('hex')+'.tmp');
 let fd;let linked=false;let failure;let created=false;
 try{
  fd=fs.openSync(temporary,'wx',0o600);created=true;fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  readTriple(temporary,hmacInput);
  // Hardlink creation atomically refuses any existing destination. On filesystems
  // without hardlinks this fails closed; no weaker publication path is used.
  fs.linkSync(temporary,final);
  linked=true;
  const verified=readTriple(final,hmacInput);
  return {path:final,identity:verified.identity,container_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,atomic_no_overwrite:true,encryption_proven:false,windows_acl_proven:false,power_loss_durability_proven:false,off_device_custody_proven:false};
 }catch(e){failure=e;e.publicationMayExist=linked;throw e;}
 finally{try{if(fd!==undefined)fs.closeSync(fd);if(created)fs.unlinkSync(temporary);}catch(e){if(e.code!=='ENOENT'){if(failure)failure.cleanupFailed=true;else{e.publicationMayExist=linked;throw e;}}}}
}
module.exports={MAX_COMPONENT_BYTES,encode,decode,readTriple,writeTriple};
