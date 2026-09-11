'use strict';
const crypto=require('crypto');const companion=require('../../scripts/linear-exit-priority-companion');const credential=require('../../scripts/linear-exit-credential-companion');const recovery=require('../../scripts/track-b-recovery-package');const {parentPackage,key}=require('./priority-recovery-package-fixture');
function fixture(){
 const parsed=recovery.readRecoveryPackage(parentPackage(),key);
 const empty=s=>Object.fromEntries(s.tables.map(t=>[t.name,{columns:t.columns,primary_key:t.primary_key,rows:[]}]));
 const manifest={...parsed.manifest,credential_companion_v1:credential.requirement(),omitted_data_tables:[...companion.schema().tables,...credential.schema().tables].map(t=>t.name)};
 const parentBytes=recovery.packRecoveryPackage({preData:parsed.preData,postData:parsed.postData,data:parsed.data,manifest},key).bytes;
 const identity={package_sha256:crypto.createHash('sha256').update(parentBytes).digest('hex'),schema_fingerprint:manifest.schema.fingerprint};
 const priorityBytes=companion.encode(empty(companion.schema()),identity,key);
 const credentialBytes=credential.encode({tables:empty(credential.schema()),parentBytes,priorityBytes,hmacInput:key});
 return {parentBytes,priorityBytes,credentialBytes};
}
module.exports={fixture,key};
