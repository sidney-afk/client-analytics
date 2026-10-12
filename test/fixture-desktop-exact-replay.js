'use strict';
const assert=require('node:assert/strict');
const {exactReplay}=require('../qa/client-phone/exact-replay');
(async()=>{
 let calls=0;
 const exact=await exactReplay(async()=>{calls++;return{pixels:true,styles:true};});
 assert.equal(calls,1);assert.equal(exact.attempts,1);
 calls=0;
 const noisy=await exactReplay(async()=>{calls++;return{pixels:calls===3,styles:true};});
 assert.equal(calls,3);assert.equal(noisy.attempts,3);
 for(const mismatch of [{pixels:false,styles:true},{pixels:true,styles:false},{pixels:false,styles:false}]) {
  calls=0;const failed=await exactReplay(async()=>{calls++;return mismatch;});
  assert.equal(calls,4);assert.equal(failed.attempts,4);
  assert.equal(failed.pixels&&failed.styles,false,'A persistent change must remain a failure');
 }
 console.log('fixture-desktop-exact-replay: exact pairs stop immediately; raster noise retries; persistent pixel/style changes fail after four attempts');
})().catch(e=>{console.error(e);process.exitCode=1;});
