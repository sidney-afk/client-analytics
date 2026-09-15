'use strict';
// Local encrypted file custody, not a fresh capture or off-device proof.
const fs=require('fs'),path=require('path');
const complete=require('./linear-exit-complete-application-data');
const encrypted=require('./linear-exit-object-custody-encrypted');
const {canonicalJson}=require('./track-b-backup');
const BUCKET={id:'application',public:false,file_size_limit:null,allowed_mime_types:null};
const NAME='complete-application.bin';
function pack(o){const bytes=fs.readFileSync(o.sourceFile);complete.read(bytes,o.hmacInput);const parent=fs.realpathSync(path.dirname(path.resolve(o.target))),stage=fs.mkdtempSync(path.join(parent,'.application-custody-'));try{const source=path.join(stage,NAME);fs.writeFileSync(source,bytes,{flag:'wx',mode:0o600});return encrypted.packEncrypted({...o,buckets:[BUCKET],objects:[{bucket:BUCKET.id,path:NAME,source}]});}finally{fs.rmSync(stage,{recursive:true,force:true});}}
function restore(o){const target=path.resolve(o.target),parent=fs.realpathSync(path.dirname(target));if(path.dirname(target)!==parent)throw Error('APPLICATION_CUSTODY_PARENT');
 const stage=fs.mkdtempSync(path.join(parent,'.application-custody-'));let published=false;try{const root=path.join(stage,'restored'),result=encrypted.restoreEncrypted({...o,target:root});
 if(result.objects!==1||canonicalJson(result.buckets)!==canonicalJson([BUCKET]))throw Error('APPLICATION_CUSTODY_LAYOUT');
 if(JSON.stringify(fs.readdirSync(root))!==JSON.stringify([BUCKET.id])||JSON.stringify(fs.readdirSync(path.join(root,BUCKET.id)))!==JSON.stringify([NAME]))throw Error('APPLICATION_CUSTODY_LAYOUT');
 const file=path.join(root,BUCKET.id,NAME),bytes=fs.readFileSync(file);complete.read(bytes,o.hmacInput);
 fs.linkSync(file,target);published=true;
 return {complete_application_validated:true,encrypted_custody_reopened:true,off_device_custody_proven:false,hosted_recovery_proven:false};
 }catch(e){if(published)e.publicationMayExist=true;throw e;}finally{try{fs.rmSync(stage,{recursive:true,force:true});}catch(e){if(published)e.publicationMayExist=true;throw e;}}
}
module.exports={pack,restore};
