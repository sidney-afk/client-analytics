'use strict';
const assert=require('node:assert/strict'),api=require('../scripts/linear-exit-install-operator'),j=require('../scripts/linear-exit-install-journal');
(async()=>{
 const identity={database:'postgres',session_user:'postgres',database_oid:'5',system_identifier:'123'},catalog={tables:[]};
 const prepared={plan:{stage_id:'test',catalog_sql:'select catalog',initial_catalog_sha256:j.sha(j.canonical(catalog))},planBytes:Buffer.from('{}'),expectedPostInstallTables:require('../scripts/linear-exit-observed-public-catalog').INSTALL_CREATED_PUBLIC_TABLES};
 function fake(over={}){const calls=[];return {calls,query:async s=>{calls.push(s);if(s===j.IDENTITY_SQL)return [{identity:over.identity||identity}];if(s.includes('pg_stat_ssl'))return [{ssl:over.ssl??true}];if(s==='select catalog')return [{catalog:over.catalog||catalog}];if(s.includes('to_regnamespace'))return [{maintenance:false,journal:false}];return [];}};}
 const good=fake();assert.equal((await api.execute({expectedDatabaseIdentity:identity},prepared,good)).status,'READ_ONLY_OBSERVATION');assert.equal(good.calls.at(-1),'rollback');assert(!good.calls.some(s=>/^(insert|update|delete|create|alter|drop|commit)/i.test(s)));
 for(const over of [{identity:{...identity,database_oid:'7'}},{ssl:false},{catalog:{tables:['drift']}}]){const session=fake(over);await assert.rejects(api.execute({expectedDatabaseIdentity:identity},prepared,session));assert.equal(session.calls.at(-1),'rollback');assert(!session.calls.some(s=>s.includes('pg_try_advisory_lock')));}
 const denied=fake();await assert.rejects(api.execute({expectedDatabaseIdentity:identity},prepared,denied,'APPLY'),/EXECUTION_REFUSED/);assert(!denied.calls.some(s=>s.includes('pg_try_advisory_lock')));
 for(const c of [{},{projectRef:'a'.repeat(20),host:'127.0.0.1'},{projectRef:'a'.repeat(20),host:'db.'+'a'.repeat(20)+'.supabase.co',port:6543}])assert.throws(()=>api.load(c),/CONNECTION/);
 const c={expectedDatabaseIdentity:identity,ownerWindowEvidenceSha256:'a'.repeat(64)};assert.notEqual(api.consent(c),api.consent({...c,ownerWindowEvidenceSha256:'b'.repeat(64)}));assert.notEqual(api.consent(c),api.consent({...c,expectedDatabaseIdentity:{...identity,database_oid:'6'}}));
 console.log('INSTALL_OPERATOR_OFFLINE_PASS read-only, TLS/identity/catalog and consent refusals; actual apply unproven');
})().catch(e=>{console.error(e);process.exitCode=1;});
