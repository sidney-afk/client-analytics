'use strict';
// Source preparation only. Never executes SQL. Keep name-capable admission
// atomic with the first native-only schema installation, after main append-v8.
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {splitSqlStatements}=require('./track-b-recovery-package');
const ROOT=path.resolve(__dirname,'..'),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
function boundaries(text){
  const s=splitSqlStatements(text);assert.ok(s.every(x=>x.kind==='statement'),'source meta commands forbidden');
  const tx=s.filter(x=>/^(begin|start\s+transaction|commit|end|rollback|abort|savepoint|release|prepare\s+transaction)\b/i.test(x.text));
  assert.equal(tx.length,2,'exactly one outer transaction required');assert.match(s[0].text,/^begin\s*$/i);assert.match(s.at(-1).text,/^commit\s*$/i);
  return s;
}
function compose(native,hybrid){
  const a=boundaries(native),b=boundaries(hybrid),commit=a.at(-1).text+';',begin=b[0].text+';';
  const end=native.lastIndexOf(commit),start=hybrid.indexOf(begin);
  assert.equal(native.slice(end+commit.length).trim(),'');assert.equal(splitSqlStatements(hybrid.slice(0,start)).length,0);
  const sql='\\set ON_ERROR_STOP on\n'+native.slice(0,end)+native.slice(end+commit.length)+'\n'+hybrid.slice(0,start)+hybrid.slice(start+begin.length);
  const result=splitSqlStatements(sql),tx=result.filter(x=>/^(begin|commit|rollback)\s*$/i.test(x.text));
  assert.equal(result[0].text,'\\set ON_ERROR_STOP on');assert.equal(tx.length,2);assert.match(tx[0].text,/^begin\s*$/i);assert.match(tx[1].text,/^commit\s*$/i);
  return {sql,manifest:{contract:'native-intake-named-atomic-v1',native_sha256:sha(native),hybrid_sha256:sha(hybrid),composed_sha256:sha(sql),outer_transactions:1,executed:false}};
}
function fromRepository(){return compose(fs.readFileSync(path.join(ROOT,'migrations/2026-09-05-native-only-intake.sql'),'utf8'),fs.readFileSync(path.join(ROOT,'migrations/2026-09-07-native-intake-named-append.sql'),'utf8'));}
module.exports={compose,fromRepository};
