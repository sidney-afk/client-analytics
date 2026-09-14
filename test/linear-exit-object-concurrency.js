'use strict';
const assert=require('node:assert/strict');const {limit,mapObjects}=require('../scripts/linear-exit-object-concurrency');
(async()=>{
 assert.equal(limit(),1);for(const bad of [0,9,-1,NaN,1.5,'4',null])assert.throws(()=>limit(bad));
 for(const n of [1,4,8]){let active=0,peak=0;const r=await mapObjects(Array.from({length:16},(_,i)=>i),n,async i=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,16-i));active--;return i;});assert.deepEqual(r,Array.from({length:16},(_,i)=>i));assert.equal(peak,n);assert.equal(active,0);}
 let active=0,started=0;await assert.rejects(mapObjects([0,1,2,3,4,5],4,async i=>{started++;active++;try{if(i===0)throw Error('first');await new Promise(r=>setTimeout(r,10));}finally{active--;}}),/first/);assert.equal(active,0);assert(started<=4);
 let threw=false;try{await mapObjects([0],1,async()=>{throw undefined;});}catch(e){threw=true;}assert(threw);
 console.log('OBJECT_CONCURRENCY_PASS serial/default4/8 bounds ordered results and failure drain');
})().catch(e=>{console.error(e);process.exitCode=1;});
