'use strict';
// Real package parser, synthetic SQL text. No database or restore execution.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const backup = require('../scripts/track-b-backup');
const recovery = require('../scripts/track-b-recovery-package');
const companion = require('../scripts/linear-exit-priority-companion');
const {parentPackage,key}=require('./helpers/priority-recovery-package-fixture');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

const tables=Object.fromEntries(companion.schema().tables.map(t=>[t.name,{columns:t.columns,primary_key:t.primary_key,rows:[]} ]));
const parent=parentPackage();
const identity={package_sha256:sha(parent),schema_fingerprint:'a'.repeat(32)};
const bytes=companion.encode(tables,identity,key);
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS '+name);};
check('real history-v11 parser validates 52-table parent and exact companion',()=>{const pair=companion.verifyPair(bytes,parent,key);assert.equal(pair.parent.corpus,'history-v11');assert.equal(pair.parent.manifest.data.table_count,52);assert.deepEqual(pair.identity,identity);assert.deepEqual(pair.companion.tables,tables);assert.equal(pair.same_snapshot_proven,false);});
check('tampered parent refused by real parser before companion parsing',()=>{const changed=Buffer.from(parent);changed[changed.length-1]^=1;assert.throws(()=>companion.verifyPair(Buffer.from('invalid'),changed,key),/authentication failed/);});
check('valid different parent package refused',()=>{const other=parentPackage('history-v11','b'.repeat(32));recovery.readRecoveryPackage(other,key);assert.throws(()=>companion.verifyPair(bytes,other,key),/PARENT_MISMATCH/);});
check('different parent bytes with identical catalog fingerprint refused',()=>{const other=parentPackage('history-v11',identity.schema_fingerprint,'2'.repeat(40));assert.equal(recovery.readRecoveryPackage(other,key).manifest.schema.fingerprint,identity.schema_fingerprint);assert.notEqual(sha(other),identity.package_sha256);assert.throws(()=>companion.verifyPair(bytes,other,key),/PARENT_MISMATCH/);});
check('valid wrong corpus refused',()=>{const other=parentPackage('history-v7');assert.equal(recovery.readRecoveryPackage(other,key).corpus,'history-v7');assert.throws(()=>companion.verifyPair(bytes,other,key),/PARENT_CORPUS/);});
check('tampered companion refused after valid parent',()=>{const b=Buffer.from(bytes);b[b.length-1]^=1;assert.throws(()=>companion.verifyPair(b,parent,key),/AUTHENTICATION/);});
check('authenticated companion for wrong parent refused',()=>{const b=companion.encode(tables,{...identity,package_sha256:'c'.repeat(64)},key);assert.throws(()=>companion.verifyPair(b,parent,key),/PARENT_MISMATCH/);});
check('caller object cannot substitute for validated parent bytes',()=>assert.throws(()=>companion.verifyPair(bytes,identity,key),/PARENT_BYTES_REQUIRED/));
check('explicit authentication key required',()=>assert.throws(()=>companion.verifyPair(bytes,parent),/EXPLICIT_KEY_REQUIRED/));
console.log(JSON.stringify({marker:'LINEAR_EXIT_PRIORITY_COMPANION_PAIR_OK',checks,parent_package_validation_proven:true,synthetic_offline_only:true,same_snapshot_proven:false,postgres_restore_proven:false}));
