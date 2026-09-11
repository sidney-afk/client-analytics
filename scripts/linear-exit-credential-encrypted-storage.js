 'use strict';
// Ciphertext-only local storage in a trusted private directory. No key custody,
// Windows ACL, power-loss durability or off-device custody assurance.
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const triple=require('./linear-exit-credential-triple-storage');
const {parseHmacKey}=require('./track-b-backup');
const MAGIC=Buffer.from('SYNCVIEW-CREDENTIAL-ENCRYPTED-V1\n');
const HEADER=MAGIC.length+32+8+12;const TAG_BYTES=16;
const MAX_PLAINTEXT=3*triple.MAX_COMPONENT_BYTES+Buffer.byteLength('SYNCVIEW-CREDENTIAL-TRIPLE-V1\n')+24;
const MAX_BYTES=HEADER+MAX_PLAINTEXT+TAG_BYTES;
const fail=code=>{throw Error('CREDENTIAL_ENCRYPTED_STORAGE_'+code);};
function keys({hmacInput,encryptionKey,keyId}){
 if(typeof hmacInput!=='string'||!hmacInput)fail('EXPLICIT_HMAC_KEY');
 const hmac=parseHmacKey(hmacInput);
 if(!Buffer.isBuffer(encryptionKey)||encryptionKey.length!==32)fail('ENCRYPTION_KEY');
 if(hmac.length===32&&crypto.timingSafeEqual(hmac,encryptionKey))fail('KEY_SEPARATION');
 if(typeof keyId!=='string'||!/^[a-f0-9]{32}$/.test(keyId))fail('KEY_ID');
}
function encode(options){
 keys(options);if(Object.hasOwn(options,'nonce'))fail('NONCE_OVERRIDE');
 const plaintext=triple.encode(options);
 try{
 const header=Buffer.alloc(HEADER);MAGIC.copy(header);header.write(options.keyId,MAGIC.length,32,'ascii');header.writeBigUInt64BE(BigInt(plaintext.length),MAGIC.length+32);
 const nonce=crypto.randomBytes(12);nonce.copy(header,MAGIC.length+40);
 const cipher=crypto.createCipheriv('aes-256-gcm',options.encryptionKey,nonce,{authTagLength:TAG_BYTES});cipher.setAAD(header);
 return Buffer.concat([header,cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);
 }finally{plaintext.fill(0);}
}
function decode(bytes,options){
 keys(options);
 if(!Buffer.isBuffer(bytes)||bytes.length<HEADER+TAG_BYTES||bytes.length>MAX_BYTES||!bytes.subarray(0,MAGIC.length).equals(MAGIC))fail('FRAME');
 const header=bytes.subarray(0,HEADER);const length=header.readBigUInt64BE(MAGIC.length+32);
 if(length<1n||length>BigInt(MAX_PLAINTEXT)||BigInt(bytes.length)!==BigInt(HEADER+TAG_BYTES)+length)fail('LENGTH');
 if(header.toString('ascii',MAGIC.length,MAGIC.length+32)!==options.keyId)fail('KEY_ID');
 const decipher=crypto.createDecipheriv('aes-256-gcm',options.encryptionKey,header.subarray(MAGIC.length+40),{authTagLength:TAG_BYTES});decipher.setAAD(header);decipher.setAuthTag(bytes.subarray(-TAG_BYTES));
 let pending;let plaintext;
 try{pending=decipher.update(bytes.subarray(HEADER,-TAG_BYTES));const final=decipher.final();plaintext=Buffer.concat([pending,final]);}catch(e){if(pending)pending.fill(0);fail('AUTHENTICATION');}
 pending.fill(0);
 try{const verified=triple.decode(plaintext,options.hmacInput);return {...verified,parentBytes:Buffer.from(verified.parentBytes),priorityBytes:Buffer.from(verified.priorityBytes),credentialBytes:Buffer.from(verified.credentialBytes),encryption_proven:true};}finally{plaintext.fill(0);}
}
function readEncryptedTriple(file,key){
 const stat=fs.lstatSync(file);if(!stat.isFile()||stat.size>MAX_BYTES)fail('FILE');
 const fd=fs.openSync(file,'r');
 try{
  // Windows lstat may report dev=0 while fstat reports the volume ID; zero is
  // unavailable, not a different device. Inode equality still checks the open.
  const opened=fs.fstatSync(fd);if(!opened.isFile()||(opened.dev&&stat.dev&&opened.dev!==stat.dev)||opened.ino!==stat.ino||opened.size>MAX_BYTES)fail('FILE');
  const bytes=Buffer.alloc(opened.size);let offset=0;
  while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)fail('TRUNCATED');offset+=n;}
  if(fs.readSync(fd,Buffer.alloc(1),0,1,null)!==0)fail('LENGTH');
  return decode(bytes,key);
 }finally{fs.closeSync(fd);}
}
function writeEncryptedTriple({directory,name,parentBytes,priorityBytes,credentialBytes,hmacInput,encryptionKey,keyId}){
 const bytes=encode({parentBytes,priorityBytes,credentialBytes,hmacInput,encryptionKey,keyId});
 if(typeof name!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(name))fail('NAME');
 const dir=fs.realpathSync(directory);if(!fs.statSync(dir).isDirectory())fail('DIRECTORY');
 const final=path.join(dir,name);const temporary=path.join(dir,'.credential-encrypted-'+crypto.randomBytes(16).toString('hex')+'.tmp');
 let fd;let linked=false;let failure;let created=false;
 try{
  fd=fs.openSync(temporary,'wx',0o600);created=true;fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
  readEncryptedTriple(temporary,{hmacInput,encryptionKey,keyId});
  // Hardlink creation atomically refuses any existing destination. On filesystems
  // without hardlinks this fails closed; no weaker publication path is used.
  fs.linkSync(temporary,final);
  linked=true;
  const verified=readEncryptedTriple(final,{hmacInput,encryptionKey,keyId});
  return {path:final,identity:verified.identity,container_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,atomic_no_overwrite:true,encryption_proven:true,windows_acl_proven:false,power_loss_durability_proven:false,off_device_custody_proven:false};
 }catch(e){failure=e;e.publicationMayExist=linked;throw e;}
 finally{try{if(fd!==undefined)fs.closeSync(fd);if(created)fs.unlinkSync(temporary);}catch(e){if(e.code!=='ENOENT'){if(failure)failure.cleanupFailed=true;else{e.publicationMayExist=linked;throw e;}}}}
}
module.exports={MAX_BYTES,MAX_PLAINTEXT,HEADER,encode,decode,readEncryptedTriple,writeEncryptedTriple};
