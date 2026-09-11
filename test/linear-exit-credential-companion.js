'use strict';
// Synthetic authenticated package/row framing only, no SQL execution.
const assert=require('assert/strict');const crypto=require('crypto');
const recovery=require('../scripts/track-b-recovery-package');const priority=require('../scripts/linear-exit-priority-companion');const credential=require('../scripts/linear-exit-credential-companion');
const {parentPackage,key}=require('./helpers/priority-recovery-package-fixture');
const parsed=recovery.readRecoveryPackage(parentPackage(),key);
const names=[...priority.schema().tables,...credential.schema().tables].map(t=>t.name);
function parent(marker=credential.requirement()) {const manifest={...parsed.manifest,omitted_data_tables:[...names,'synthetic_uncovered'],credential_companion_v1:marker};return recovery.packRecoveryPackage({preData:parsed.preData,postData:parsed.postData,data:parsed.data,manifest},key).bytes;}
const parentBytes=parent();const identity={package_sha256:crypto.createHash('sha256').update(parentBytes).digest('hex'),schema_fingerprint:parsed.manifest.schema.fingerprint};
const empty=contract=>Object.fromEntries(contract.tables.map(t=>[t.name,{columns:t.columns,primary_key:t.primary_key,rows:[]}]));
const priorityTables=empty(priority.schema());const priorityBytes=priority.encode(priorityTables,identity,key);
const tables=empty(credential.schema());
for(const t of credential.schema().tables)tables[t.name].rows=[t.columns.map(c=>c.not_null?'synthetic':null)];
const input={parentBytes,priorityBytes,hmacInput:key};const credentialBytes=credential.encode({...input,tables});
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
check('real parent reader and exact three component roundtrip',()=>assert.deepEqual(credential.verifyTriple({...input,credentialBytes}).credential.tables,tables));
check('missing and extra credential tables refused',()=>{const t={...tables};delete t.client_credential_events;assert.throws(()=>credential.encode({...input,tables:t}),/SHAPE/);assert.throws(()=>credential.encode({...input,tables:{...tables,extra:{}}}),/SHAPE/);});
check('schema type drift refused',()=>{const t=JSON.parse(JSON.stringify(tables));t.client_credentials.columns[0].type='integer';assert.throws(()=>credential.encode({...input,tables:t}),/TABLE_SCHEMA_MISMATCH/);});
check('sparse row and duplicate primary key refused',()=>{const t=JSON.parse(JSON.stringify(tables));delete t.client_credentials.rows[0][0];assert.throws(()=>credential.encode({...input,tables:t}),/ROW_SHAPE/);t.client_credentials.rows=tables.client_credentials.rows.concat(tables.client_credentials.rows);assert.throws(()=>credential.encode({...input,tables:t}),/PRIMARY_KEY_DUPLICATE/);});
check('tampered credential component refused',()=>{const b=Buffer.from(credentialBytes);b[b.length-1]^=1;assert.throws(()=>credential.verifyTriple({...input,credentialBytes:b}),/AUTHENTICATION/);});
check('different valid priority bytes with same parent refused',()=>{const t=JSON.parse(JSON.stringify(priorityTables));t.batches_parent_claim_backup_20260824.rows=[[null,null,null]];const other=priority.encode(t,identity,key);assert.throws(()=>credential.verifyTriple({...input,priorityBytes:other,credentialBytes}),/PARENT_MISMATCH/);});
check('different parent bytes refused',()=>assert.throws(()=>credential.verifyTriple({...input,parentBytes:parentPackage(),credentialBytes}),/PARENT_MISMATCH|REQUIREMENT/));
check('explicit key required',()=>assert.throws(()=>credential.verifyTriple({...input,hmacInput:undefined,credentialBytes}),/EXPLICIT_KEY/));
check('malformed authenticated requirement refused',()=>assert.throws(()=>recovery.readRecoveryPackage(parent({...credential.requirement(),required:false}),key),/REQUIREMENT/));
check('plain and both pair renderers refuse required third component',()=>{const p=recovery.readRecoveryPackage(parentBytes,key);assert.throws(()=>recovery.reconstructSql(p),/CREDENTIAL_TRIPLE_RENDERER_REQUIRED/);assert.throws(()=>recovery.reconstructPairSql(priorityBytes,parentBytes,key),/CREDENTIAL_TRIPLE_RENDERER_REQUIRED/);assert.throws(()=>recovery.reconstructPairSqlWithSequenceBounds(priorityBytes,parentBytes,key),/CREDENTIAL_TRIPLE_RENDERER_REQUIRED/);});
check('verified triple emits credential guards and retains other omitted guard',()=>{const sql=recovery.reconstructTripleSql({...input,credentialBytes});assert.ok(sql.includes('CREDENTIAL_RESTORE_MULTISET_MISMATCH'));assert.ok(sql.includes('public."synthetic_uncovered"'));assert.ok(sql.indexOf('insert into public."client_credentials"')<sql.indexOf('do $recovery_verify$'));});
check('unchanged default parent still renders without credential requirement',()=>assert.ok(recovery.reconstructSql(parsed).startsWith('begin;')));
console.log(JSON.stringify({marker:'LINEAR_EXIT_CREDENTIAL_COMPANION_OK',checks,credential_tables:3,credential_columns:35,offline_only:true,triple_storage_proven:false,encryption_proven:false,sql_restore_proven:false}));
