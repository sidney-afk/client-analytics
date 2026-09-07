'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { extractFunction } = require('./extract-function');
const { setup, row, response } = require('../samples-authoritative-read');
const ROOT = path.resolve(__dirname, '../..');

async function sourceChecks() {
  let passed = 0;
  const eq = (a,b) => { assert.deepEqual(a,b); passed++; };
  // setup extracts the entire repaired load/cache/read section and its actual
  // merge/draft dependencies. No substitute _sxrFetchPosts or pager here.
  const { s, storage, effects, key } = setup();
  let calls = [];
  s.fetch = async (url, init) => {
    calls.push(url); assert.equal(init.headers.Prefer, 'count=exact');
    assert.equal(new URL(url).searchParams.get('client'), 'eq.fixture-a');
    return calls.length === 1 ? response([row('a'),row('b')],200,3) : response([row('c')]);
  };
  await s.loadSxrCards();
  eq(Array.from(s.sxrState.posts, p=>p.id), ['a','b','c']); eq(calls.length,2);
  assert.ok(JSON.parse(storage.get(key)).verifiedAt > 0); passed++;
  const saved = storage.get(key);
  s.fetch = async url => url.includes('/fallback') ? response({ok:true,posts:[row('partial')],partial:true}) : response({},500);
  const fallback = await s._sxrFetchPosts('fixture-a');
  eq(fallback.authoritative,false); eq(fallback.posts.length,1);
  await s.loadSxrCards({skipCache:true}); eq(storage.get(key),saved); eq(effects.stale,true);
  s.sxrState.posts=[]; storage.clear(); await s.loadSxrCards();
  eq(Array.from(s.sxrState.posts,p=>p.id),['partial']); eq(storage.size,0); eq(effects.stale,true);
  s.fetch = async ()=>response([]); await s.loadSxrCards({skipCache:true});
  eq(s.sxrState.posts.length,0); eq(effects.stale,false); eq(JSON.parse(storage.get(key)).posts.length,0);
  s.fetch = async ()=>response([row('recovered')]); await s.loadSxrCards({skipCache:true});
  eq(Array.from(s.sxrState.posts,p=>p.id),['recovered']); eq(s.sxrState.error,null);
  // Hold an actual primary request (not a stubbed reader) across a client change.
  let release;
  s.fetch = ()=>new Promise(resolve=>{release=resolve;});
  const pending=s.loadSxrCards({skipCache:true});
  s.sxrState.client='fixture-b'; s.sxrState.posts=[row('b','fixture-b')];
  const before=storage.get(key); release(response([row('late')])); await pending;
  eq(Array.from(s.sxrState.posts,p=>p.id),['b']); eq(storage.get(key),before);
  const bad = [[401,{},'samples_fallback_http'],[403,{},'samples_fallback_http'],
    [429,{},'samples_fallback_http'],[500,{},'samples_fallback_http'],
    [200,{ok:false},'samples_fallback_envelope'],[200,{ok:true},'samples_fallback_shape'],
    [200,{ok:true,posts:[]},'samples_fallback_incomplete']];
  for(const [status,body,code] of bad) {
    const test=setup(); let primaryCalls=0,fallbackCalls=0;
    test.s.fetch=async url=>{if(url.includes('/fallback')) {fallbackCalls++;return response(body,status);} primaryCalls++;return response({},500);};
    // Exact expected product error, plus both transport calls. ReferenceError,
    // TypeError, missing helper and unexpected route cannot count as rejection.
    await assert.rejects(test.s._sxrFetchPosts('fixture-a'),e=>e.name==='Error'&&e.message===code);
    eq(primaryCalls,1);eq(fallbackCalls,1);
  }
  const broken=setup(); vm.runInContext('_sxrValidateReadRows = undefined', broken.s);
  broken.s.fetch=async url=>url.includes('/fallback')?response({ok:true,posts:[row()]}):response([row()]);
  await assert.rejects(broken.s._sxrFetchPosts('fixture-a'),e=>e.name==='TypeError'); passed++;

  // Original defect is executed from the recorded original commit, not a
  // reconstructed mutant. Missing git history is an error (CI fetch-depth:0).
  const old=execFileSync('git',['show','13e187a7d0043ed110b486feb50502758a026229:index.html'],{cwd:ROOT,encoding:'utf8',maxBuffer:20*1024*1024});
  let originalDefectsDetected=0;
  for(const [status,body] of bad) {
    let failedRead=0,fallbackRead=0;
    const context=vm.createContext({CAL_SUPABASE_URL:'https://fixture.invalid',SXR_TABLE:'sample_reviews',SXR_GET_URL:'https://fixture.invalid/fallback',
      _sxrSupabaseFetchAllRows:async()=>{failedRead++;throw new Error('synthetic_primary_failure');},
      fetch:async()=>{fallbackRead++;return response(body,status);},console:{warn(){}},Date});
    vm.runInContext('async '+extractFunction(old,'_sxrFetchPosts'),context);
    const result=await context._sxrFetchPosts('fixture-a');
    eq(failedRead,1);eq(fallbackRead,1);eq(result.ok,true);eq(result.posts.length,0);originalDefectsDetected++;
  }
  // Calendar actual paginator + fallback, with all transport dependencies.
  const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
  const c=vm.createContext({CAL_SUPABASE_URL:'https://fixture.invalid',CAL_SUPABASE_ANON_KEY:'fixture',CAL_SUPABASE_PAGE:2,
    CALENDAR_GET_URL:'https://fixture.invalid/fallback',console:{warn(){}},Date});
  for(const name of ['_calSupabaseFetchAllRows','_calV2FetchPosts']) vm.runInContext('async '+extractFunction(html,name),c);
  c.fetch=async()=>response([]);eq((await c._calV2FetchPosts('fixture-a')).posts.length,0);
  let n=0;c.fetch=async()=>++n===1?response([row('a'),row('b')]):response([row('c')]);
  eq((await c._calV2FetchPosts('fixture-a')).posts.length,3);eq(n,2);
  return {passed,originalDefectsDetected};
}
module.exports={sourceChecks};
