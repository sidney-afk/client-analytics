'use strict';
// Real cached-document traversal. No routing or synthetic pageshow dispatch.
// Only network transport and third-party library loading are replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { Store, panel, SOURCE, OUT, body, ui } = require('./run');
const { transportInit, hash } = require('./harness');
const { CLIENTS, MEMBERS } = require('./mock-backend');
const source=fs.readFileSync(path.join(SOURCE,'index.html'),'utf8');
const html=source.replace(/<script\b[^>]*\bsrc=["']https?:\/\/[^"']+["'][^>]*>\s*<\/script>/gi,'')
  .replace(/<link\b[^>]*\bhref=["']https?:\/\/[^"']+["'][^>]*>/gi,'');
const inline=value=>[...value.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>! /\bsrc=/.test(m[1])).map(m=>m[2]);
assert.deepEqual(inline(html),inline(source),'all actual application inline bytes unchanged');
const report={status:'INCOMPLETE',indexSha256:hash(source),servedSha256:hash(html),groups:[]};
async function main(){
  let backend,role,documentReads=0,origin;
  const server=http.createServer(async(req,res)=>{
    try {
      const url=new URL(req.url,origin);
      if(url.pathname==='/__fixture' && req.method==='POST'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const input=JSON.parse(Buffer.concat(chunks).toString());
        const request={url:()=>input.url,method:()=>input.method,postDataJSON:()=>input.body?JSON.parse(input.body):null,headers:()=>input.headers||{}};
        return await backend.handle({request:()=>request,
          fulfill:args=>{res.writeHead(args.status||200,{'content-type':args.contentType||'application/json',...args.headers});res.end(args.body||'');},
          abort:()=>{res.destroy();},continue:()=>{throw new Error('unexpected fixture continuation');}},role,origin);
      }
      if(url.pathname==='/away') {res.writeHead(200,{'content-type':'text/html','cache-control':'public,max-age=600'});return res.end('<!doctype html><title>Fixture away</title><p>Fixture navigation</p>');}
      if(url.pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
      if(url.pathname==='/fixture.svg') {res.writeHead(200,{'content-type':'image/svg+xml'});return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#345"/></svg>');}
      if(url.pathname==='/'||url.pathname==='/index.html') {documentReads++;res.writeHead(200,{'content-type':'text/html','cache-control':'public,max-age=600','content-security-policy':"connect-src 'self'; worker-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:"});return res.end(html);}
      const target=path.resolve(SOURCE,'.'+decodeURIComponent(url.pathname));
      assert.ok(target.startsWith(SOURCE+path.sep) && /\.(js|css|svg|png|ico|woff2?)$/.test(target));
      const bytes=fs.readFileSync(target);
      res.writeHead(200,{'content-type':target.endsWith('.js')?'application/javascript':target.endsWith('.css')?'text/css':'image/svg+xml'});res.end(bytes);
    }catch(error){report.serverError=error.message;if(!res.headersSent)res.writeHead(500);res.end('fixture_error');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,channel:'chromium',ignoreDefaultArgs:['--disable-back-forward-cache'],args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});report.browser=browser.version();
  try {
    for(const surface of ['calendar','samples','kasper']){
      backend=new Store(surface,'note','reject');role=surface==='kasper'?'admin':'client';
      backend.apiHost=new URL(source.match(/https:\/\/[a-z0-9-]+\.supabase\.co/)[0]).hostname;
      backend.webhookHost=new URL(source.match(/https:\/\/[a-z0-9.-]+\.n8n\.cloud/)[0]).hostname;
      backend.rows[0].asset_url=origin+'/fixture.svg';backend.rows[0].thumbnail_url=origin+'/fixture.svg';
      const context=await browser.newContext({serviceWorkers:'block'});
      await context.addInitScript(transportInit,{persona:MEMBERS.find(m=>m.role===role)||null});
      await context.addInitScript(({origin})=>{
        const nativeFetch=window.fetch.bind(window);
        window.fetch=async(input,init={})=>{
          const url=new URL(typeof input==='string'?input:input.url,location.href);
          if(url.origin===origin)return nativeFetch(input,init);
          const method=init.method || (typeof input==='object'&&input.method)||'GET';
          const response=await nativeFetch(origin+'/__fixture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:url.href,method,headers:Object.fromEntries(new Headers(init.headers||{})),body:init.body||null}),signal:init.signal});
          return response;
        };
        window.__fixturePageEvents=[];
        for(const type of ['pagehide','pageshow'])addEventListener(type,event=>window.__fixturePageEvents.push({type,persisted:event.persisted}),true);
      },{origin});
      const page=await context.newPage(),errors=[],escapes=[];
      const cdp=await context.newCDPSession(page);await cdp.send('Page.enable');
      cdp.on('Page.backForwardCacheNotUsed',event=>{report.notRestored=event.notRestoredExplanations;});
      page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
      page.on('request',r=>{if(new URL(r.url()).origin!==origin)escapes.push(new URL(r.url()).hostname);});
      const clientUrl=origin+'/?c='+encodeURIComponent(CLIENTS[0].display_name)+'&t=fictional-client-token&v='+(surface==='samples'?'sample-reviews&sxr=1':'calendar');
      await page.goto(surface==='kasper'?origin+'/#calendar/'+CLIENTS[0].slug:clientUrl,{waitUntil:'load'});
      if(surface==='kasper'){await ui.card(page).waitFor();await page.locator('#navKasper').click();}
      const session={page};
      const composer=await panel(session,surface).catch(async error=>{
        report.diagnostic={surface,blocked:backend.blocked,records:backend.records,serverError:report.serverError,
          page:await page.evaluate(()=>({text:document.body.innerText.slice(-2500),items:typeof _kasperState!=='undefined'?_kasperState.items:null}))};
        throw error;
      });
      await composer.locator('.cal-review-textarea').fill(body);
      await page.waitForLoadState('networkidle');
      const before=await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('syncview_review_draft_v1:')).map(k=>[k,localStorage.getItem(k)])));
      const reads=documentReads;
      await page.evaluate(url=>{ location.href=url; },origin+'/away');await page.waitForURL(origin+'/away');
      await page.evaluate(()=>history.back()).catch(error=>{if(!/Execution context was destroyed/.test(error.message))throw error;});
      await page.waitForFunction(()=>location.pathname!=='/away');
      await ui.until(()=>page.evaluate(()=>window.__fixturePageEvents?.some(e=>e.type==='pageshow'&&e.persisted)),'real BFCache persisted pageshow required');
      assert.equal(documentReads,reads,'Back restores the document without fetching another HTML');
      const events=await page.evaluate(()=>window.__fixturePageEvents);
      assert.ok(events.some(e=>e.type==='pagehide'&&e.persisted));
      assert.equal(await (await panel(session,surface)).locator('.cal-review-textarea').inputValue(),body);
      assert.deepEqual(await page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('syncview_review_draft_v1:')).map(k=>[k,localStorage.getItem(k)]))),before);
      assert.equal(backend.feedbackWrites.length,0,'BFCache restores typing without submission');
      assert.equal(backend.blocked.length,0);assert.deepEqual(errors,[]);assert.deepEqual(escapes,[]);assert.equal(report.serverError,undefined);
      report.groups.push({surface,persisted:true,noDocumentRefetch:true,visibleDraft:true,zeroWrites:true});console.log('PASS '+surface+': real BFCache preserves owned unsent draft');
      await context.close();
    }
    report.status='PASS';
  }finally{await browser.close();await new Promise(r=>server.close(r));fs.writeFileSync(path.join(OUT,'bfcache-private.json'),JSON.stringify(report,null,2)+'\n');}
}
main().catch(error=>{console.error(error.stack);console.error(JSON.stringify(report.notRestored));process.exitCode=1;});
