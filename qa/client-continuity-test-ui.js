'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const H=require('./boot/client-entry-sequence');
const {driveAction,persisted}=require('../scripts/client-continuity-test-ui');
const SCOPE='bootfixtureclient';
async function run() {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'continuity-ui-fixture-')),file=path.join(temp,'rows.json');
  const original={id:'preexisting-synthetic',client:SCOPE,name:'Pre-existing synthetic row',status:'Draft'};
  fs.writeFileSync(file,JSON.stringify([original]));
  const read=()=>JSON.parse(fs.readFileSync(file,'utf8'));
  const authority=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(read()));});
  await new Promise(resolve=>authority.listen(0,'127.0.0.1',resolve));
  const authorityUrl='http://127.0.0.1:'+authority.address().port;
  const server=await H.startStreamServer(),browser=await chromium.launch({headless:true,
    args:['--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1, EXCLUDE localhost']});
  let writes=0,readbacks=0,scopes=0;
  const open=async(lane,id)=>{
    const run=await H.openCase(browser,server);
    run.persistedReads=[];
    await run.context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      if(url.pathname===`/rest/v1/${lane==='samples'?'sample_reviews':'calendar_posts'}`) {
        assert.equal(url.searchParams.get('client'),'eq.'+SCOPE);
        const rows=read().filter(r=>r.id===id);
        run.persistedReads.push(...structuredClone(rows));
        return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*','access-control-expose-headers':'content-range','content-range':rows.length?`0-${rows.length-1}/${rows.length}`:'*/0'},body:JSON.stringify(rows)});
      }
      if(req.method()==='POST'&&['/functions/v1/sample-review-upsert','/functions/v1/calendar-upsert','/webhook/sample-review-upsert','/webhook/calendar-upsert-post'].includes(url.pathname)) {
        const body=req.postDataJSON(),post=body.sample||body.post;scopes++;
        assert.equal(body.client,SCOPE);assert.equal(post.id,id);
        const rows=read(),at=rows.findIndex(r=>r.id===id);assert.ok(at>=0);
        rows[at]={...rows[at],...post,client:SCOPE,updated_at:new Date().toISOString()};
        fs.writeFileSync(file,JSON.stringify(rows));writes++;
        return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({ok:true,[lane==='samples'?'sample':'post']:rows[at]})});
      }
      if(!['GET','HEAD','OPTIONS'].includes(req.method())&&url.pathname!=='/functions/v1/client-token-verify')return route.abort();
      return route.fallback();
    });
    const query=new URLSearchParams({c:'Boot Fixture Client',v:lane==='samples'?'samples':'calendar',t:'synthetic-current-token'});
    await H.streamedNavigation(run.page,server,()=>run.page.goto(server.origin+'/index.html?'+query,{waitUntil:'load',timeout:15000}),'static:client-verify');
    return run;
  };
  try {
    for(const lane of ['calendar','samples']) {
      const id='continuity-test-'+lane;
      fs.writeFileSync(file,JSON.stringify([...read(),{id,client:SCOPE,name:'Synthetic action card',status:'Client Approval',
        video_status:'Client Approval',graphic_status:'Client Approval',caption_status:'Approved',scheduled_date:new Date().toISOString().slice(0,10),
        asset_url:'https://fixture.invalid/synthetic.mp4',thumbnail_url:'https://fixture.invalid/synthetic.png',graphic_tweaks:[],order_index:1}]));
      const acting=await open(lane,id);
      try {
        for(const action of ['comment','approve','request_changes']) {
          const text='Synthetic '+lane+' '+action;
          const expected={rowId:id,scope:SCOPE,action,text};
          const before=writes;await driveAction(acting.page,expected);
          let row;for(let attempt=0;attempt<50;attempt++) {
            const response=await fetch(authorityUrl,{redirect:'error',signal:AbortSignal.timeout(1000)});
            row=(await response.json()).find(r=>r.id===id);
            if(persisted(row,expected))break;
            await new Promise(resolve=>setTimeout(resolve,50));
          }
          assert.ok(persisted(row,expected),'independent persistence readback');assert.equal(writes,before+1);readbacks++;
          const fresh=await open(lane,id);
          try {
            for(let attempt=0;attempt<50&&!fresh.persistedReads.some(r=>persisted(r,expected));attempt++)await new Promise(resolve=>setTimeout(resolve,50));
            await fresh.page.waitForFunction(l=>{
              const state=l==='samples'?sxrState:calState;return !state.loading;
            },lane);
            assert.ok(fresh.persistedReads.some(r=>persisted(r,expected)),'fresh anonymous context fetched persisted action');
            assert.equal(fresh.pageErrors.length,0,'fresh context has no incidental exception');
            if(action==='comment') {
              const card=fresh.page.locator(`.cal-review-card[data-cal-review-pid="${id}"]`);await card.waitFor();
              await card.locator('.kcard-strip').click();await fresh.page.getByText(text,{exact:true}).first().waitFor();
            }
          }finally{await fresh.context.close();}
        }
        assert.equal(acting.pageErrors.length,0,'acting context has no incidental exception');
      }finally{await acting.context.close();}
      // Fixture cleanup only: no live delete/archive adapter exists. Preserve
      // unrelated rows exactly, then read persisted zero residue independently.
      fs.writeFileSync(file,JSON.stringify(read().filter(r=>r.id!==id)));
      assert.deepEqual(await (await fetch(authorityUrl)).json(),[original]);
    }
    assert.equal(writes,6);assert.equal(readbacks,6);assert.equal(scopes,6);
    return {version:1,ready:true,mode:'fixture',actions:6,persistedReadbacks:6,live:false};
  } finally {await browser.close();await server.close();await new Promise(resolve=>authority.close(resolve));fs.rmSync(temp,{recursive:true,force:true});}
}
module.exports={run};
