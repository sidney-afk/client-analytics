'use strict';
const assert = require('assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { extractFunction } = require('./helpers/extract-function');
const root = path.resolve(__dirname, '..');
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('OK ' + name); }
(async () => {
  const { handleCardRead } = await import('../supabase/functions/_shared/card-read.mjs');
  let reads = [];
  const deps = {
    staffAuthorized: k => k === 'synthetic-staff-key',
    clientAuthorized: async (slug, token) => slug === 'fixturea' && token === 'synthetic-client-token',
    read: async (table, q) => { reads.push({ table, q: [...q] }); return Response.json([{ id: 'same-id', client: q.get('client')?.slice(3) || 'fixtureb' }]); },
  };
  const req = (query, headers, method = 'GET') => new Request('https://example.invalid/card-read?' + query, { method, headers });
  const client = { 'x-syncview-client-token': 'synthetic-client-token' }, staff = { 'x-syncview-key': 'synthetic-staff-key' };
  const base = 'table=calendar_posts&select=*&client=eq.fixturea';
  await check('browser preflight allows every existing staff and client credential header', async () => {
    const response = await handleCardRead(req(base, {}, 'OPTIONS'), deps);
    assert.equal(response.status, 204);
    for (const header of ['apikey', 'authorization', 'x-syncview-key', 'x-syncview-client-token', 'x-syncview-actor', 'x-syncview-role']) assert(response.headers.get('access-control-allow-headers').split(', ').includes(header));
  });
  await check('missing, forged, ambiguous and wrong-client credentials never reach cards', async () => {
    for (const [h, q] of [[{},base],[{'x-syncview-key':'bad'},base],[{...client,...staff},base],[client,base.replace('fixturea','fixtureb')],[client,'table=calendar_posts&select=*'],[client,base+'&client=eq.fixtureb']]) {
      const before = reads.length; assert([401,403].includes((await handleCardRead(req(q,h),deps)).status)); assert.equal(reads.length,before);
    }
  });
  await check('every staff role uses authorization, cross-client staff reads work', async () => {
    assert.equal((await handleCardRead(req('table=sample_reviews&select=id,client',staff),deps)).status,200);
  });
  await check('client equality stays outside repeated OR pagination filters', async () => {
    const q = base + '&or=(status.is.null,status.neq.Archived)&or=(id.gt.x,and(id.eq.x,client.gt.fixtureb))&order=id.asc,client.asc&limit=1000';
    assert.equal((await handleCardRead(req(q,client),deps)).status,200);
    const sent = new URLSearchParams(reads.at(-1).q); assert.equal(sent.get('client'),'eq.fixturea'); assert.equal(sent.getAll('or').length,2);
  });
  await check('joins, other tables, excess pages and write methods are refused', async () => {
    for (const q of ['table=clients', base+'&select=*,clients(*)', base+'&limit=1001', base+'&offset=100001',base+'&evil=1']) {
      const before=reads.length; assert.equal((await handleCardRead(req(q,staff),deps)).status,400); assert.equal(reads.length,before);
    }
    assert.equal((await handleCardRead(req(base,staff,'POST'),deps)).status,405);
  });
  await check('inactive, revoked, duplicate and unavailable token lookups fail closed', async () => {
    for (const auth of [async()=>false,async()=>{throw Error('lookup unavailable');}]) {
      const before=reads.length; assert([401,503].includes((await handleCardRead(req(base,client),{...deps,clientAuthorized:auth})).status)); assert.equal(reads.length,before);
    }
    const source=fs.readFileSync(path.join(root,'supabase/functions/card-read/index.ts'),'utf8');
    assert(source.includes('.maybeSingle()')); assert(source.includes('client?.active === true')); assert(source.includes('timingSafeEqual'));
  });
  await check('upstream error and malformed rows never become successful empty cards', async()=>{
    for (const response of [new Response('',{status:403}),Response.json({})]) assert.equal((await handleCardRead(req(base,client),{...deps,read:async()=>response})).status,502);
  });
  const source=fs.readFileSync(path.join(root,'src/index/120-calendar-flags-write-repair.js.part'),'utf8');
  function browser(mode, flagError=false) {
    const calls=[];
    const ctx=vm.createContext({ URL, URLSearchParams, AbortSignal, DOMException, Date, CAL_SUPABASE_URL:'https://example.invalid', CAL_SUPABASE_ANON_KEY:'synthetic-publishable', CARD_READ_FLAG_KEY:'card_reads_source',
      _syncviewEfHeaders:h=>({...h,'X-Syncview-Key':'synthetic-staff-key'}), fetch:async(url,options)=>{
        calls.push({url,options}); if (url.includes('syncview_runtime_flags')) { if(flagError) throw Error('offline'); return Response.json(mode ? [{value:{mode}}] : []); }
        return new Response('[]',{status:url.includes('/functions/') ? 401 : 200});
      }});
    vm.runInContext("let _cardReadFlag={at:0,mode:'public'},_cardReadFlagPromise=null;async "+extractFunction(source,'_cardReadFunctionMode')+'\nasync '+extractFunction(source,'_cardReadFetch'),ctx);
    return {ctx,calls};
  }
  await check('absent, public or failed first flag read retains the exact old GET',async()=>{
    for (const [mode,failed] of [[null,false],['public',false],[null,true]]) {
      const {ctx,calls}=browser(mode,failed); const url='https://example.invalid/rest/v1/calendar_posts?select=*';
      const opts={headers:{Accept:'application/json'},cache:'no-store'};
      assert.equal((await ctx._cardReadFetch(url,opts)).status,200); assert.equal(calls.at(-1).url,url); assert.strictEqual(calls.at(-1).options,opts);
    }
  });
  await check('function refusal never triggers a publishable-key fallback; abort passes through',async()=>{
    const {ctx,calls}=browser('function'),ctrl=new AbortController();
    assert.equal((await ctx._cardReadFetch('https://example.invalid/rest/v1/sample_reviews?select=*&client=eq.fixturea',{signal:ctrl.signal})).status,401);
    assert.equal(calls.length,2); assert(calls.at(-1).url.includes('/functions/v1/card-read?')); assert.strictEqual(calls.at(-1).options.signal,ctrl.signal);
    ctrl.abort(); await assert.rejects(()=>ctx._cardReadFetch('https://example.invalid/rest/v1/sample_reviews',{signal:ctrl.signal}),/Abort/);
  });
  await check('unrelated standing read exception keeps the original transport',async()=>{
    const {ctx,calls}=browser('function'); const url='https://example.invalid/rest/v1/workload_issues?select=*';
    await ctx._cardReadFetch(url,{}); assert.equal(calls.length,1); assert.equal(calls[0].url,url);
  });
  await check('all 20 loading, saved-copy, render and held-queue functions retain baseline bytes',()=>{
    const fixture=JSON.parse(fs.readFileSync(path.join(root,'test/fixtures/card-read-display.sha256.json'),'utf8'));
    assert.equal(Object.keys(fixture.functions).length,20);
    for(const [name,entry] of Object.entries(fixture.functions)){
      const text=fs.readFileSync(path.join(root,'src/index',entry.file),'utf8');
      const actual=require('crypto').createHash('sha256').update(extractFunction(text,name).replace(/\r\n/g,'\n')).digest('hex');
      assert.equal(actual,entry.sha256,name+' changed the loading or saved-copy contract');
    }
  });
  console.log(`card-read-boundary: ${passed} checks passed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
