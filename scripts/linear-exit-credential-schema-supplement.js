'use strict';
// Explicit isolated source supplement; no live execution or application seeds.
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const SOURCE='migrations/client-credentials-migration.sql';
const SHA256='eb1c5ac2dc4fa2900225ca916b284367c0223d577e0b631fd74851ead7ad973c';
function apply(cluster){
 const bytes=fs.readFileSync(path.join(__dirname,'..',SOURCE));
 if(crypto.createHash('sha256').update(bytes).digest('hex')!==SHA256)throw Error('CREDENTIAL_SOURCE_HASH');
 cluster.exec(bytes.toString('utf8'));
 return {source:SOURCE,source_sha256:SHA256,separate_from_published_inventory:true,application_seed_rows_executed:false,hosted_schema_equivalence_proven:false};
}
module.exports={apply};
