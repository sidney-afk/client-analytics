'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const m=require('../scripts/linear-exit-install-manifest');
const manifest=m.build();
assert.equal(manifest.executable,false);assert.equal(manifest.installation_complete,false);assert.equal(manifest.dependency_closure_complete,false);
assert.equal(m.verify(manifest),true);
const atomic=manifest.entries.find(e=>e.id==='atomic-native-intake');
assert.equal(atomic.transaction.classification,'single_explicit_transaction');assert.equal(atomic.inputs.length,2);
assert.ok(!manifest.entries.some(e=>/native-only-intake.sql|native-intake-named-append.sql/.test(e.path||'')));
assert.throws(()=>m.validate([{id:'a',dependencies:['missing']}]),/missing_dependency/);
assert.throws(()=>m.validate([{id:'a',dependencies:['b']},{id:'b',dependencies:['a']}]),/dependency_cycle/);
assert.throws(()=>m.validate([{id:'a',dependencies:[]},{id:'a',dependencies:[]}]),/duplicate_owner/);
assert.throws(()=>m.validate([{id:'a',path:'same',dependencies:[]},{id:'b',path:'same',dependencies:[]}]),/duplicate_source/);
assert.throws(()=>m.transactions('begin;select 1;'),/unclosed_transaction/);
assert.equal(m.transactions("begin;do $$ begin perform 'commit;'; end $$;commit;").explicit_commits,1);
assert.equal(m.transactions('create table a(id int);').classification,'autocommit_statements');
assert.throws(()=>m.transactions('begin; rollback to savepoint missing; commit;'),/unknown_savepoint/);
assert.equal(m.transactions('begin; savepoint probe; rollback to savepoint probe; release savepoint probe; commit;').explicit_commits,1);
for(const sql of [
 'begin;savepoint s;commit;begin;rollback to s;commit;',
 'begin;savepoint s;release s;rollback to s;commit;',
 'begin;savepoint a;savepoint b;release a;rollback to b;commit;',
 'begin;savepoint a;savepoint b;rollback to a;release b;commit;',
])assert.throws(()=>m.transactions(sql),/unknown_savepoint/);
assert.equal(m.transactions('begin;savepoint s;savepoint s;release s;rollback to s;commit;').explicit_commits,1);
assert.equal(manifest.entries.find(e=>e.id==='2026-07-20-f27-team-rollback.sql').transaction.classification,'single_explicit_transaction');
assert.throws(()=>m.verify(manifest,{read:file=>{const b=fs.readFileSync(path.join(__dirname,'..',file));return file.endsWith('kasper-urgent-ping-ledger.sql')?Buffer.concat([b,Buffer.from('\n-- changed bytes')]):b;}}),/manifest_source_or_contract_drift/);
const order=manifest.dependency_order;
assert.ok(order.indexOf('2026-09-05-artifact-card-binding-first.sql')<order.indexOf('2026-07-20-f27-team-rollback.sql'));
assert.ok(order.indexOf('2026-09-09-workload-native-roster.sql')<order.indexOf('2026-09-09-native-attribution-browser-projection.sql'));
assert.ok(order.indexOf('2026-09-11-native-ordinary-receipt-repair.sql')<order.indexOf('2026-09-12-native-ordinary-envelope-repair.sql'));
assert.ok(order.indexOf('2026-09-09-syncview-retirement-admission.sql')<order.indexOf('2026-09-10-syncview-retirement-native-ordinary-recognizer.sql'));


// Reversing inventory order ensures these are graph constraints, not array luck.
const reversed=m.validate([...manifest.entries].reverse());
for(const [before,after] of [
 ['2026-07-20-f27-team-rollback.sql','atomic-native-intake'],
 ['2026-07-20-f27-team-rollback.sql','2026-09-06-native-existing-assignment.sql'],
 ['2026-07-20-f27-team-rollback.sql','2026-09-06-native-label-writes.sql'],
 ['2026-09-08-native-intake-receipt-retention.sql','2026-09-09-syncview-retirement-admission.sql'],
 ['2026-09-06-native-existing-assignment.sql','2026-09-09-syncview-retirement-admission.sql'],
 ['2026-09-06-native-label-writes.sql','2026-09-09-syncview-retirement-admission.sql'],
 ['2026-07-12-production-comments.sql','2026-09-09-native-notification-outbox.sql'],
 ['2026-07-03-a1-calendar-upsert.sql','2026-09-10-kasper-urgent-ping-ledger.sql'],
])assert.ok(reversed.indexOf(before)<reversed.indexOf(after),before+' must precede '+after);

console.log('PASS source installation inventory: hash drift, atomicity, graph refusal and explicit incomplete gates');
