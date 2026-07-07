'use strict';
// Client-tab before/after screenshot harness. Seeds a few pinned clients (shared
// calendar+samples pins) and captures the Samples + Calendar tab strips, light +
// dark. HTML_FILE selects which build to render so the same script makes the
// "before" (origin/main) and "after" shots. Dummy client names only.
const http=require('http'),fs=require('fs'),path=require('path');const{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const HTML_FILE=process.env.HTML_FILE||'index.html';const LABEL=process.env.LABEL||'after';
const OUT=path.join(root,'qa','shots');fs.mkdirSync(OUT,{recursive:true});
const htmlPath=path.isAbsolute(HTML_FILE)?HTML_FILE:path.join(root,HTML_FILE);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript'};
const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1');if(u.pathname==='/'||u.pathname==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});fs.createReadStream(htmlPath).pipe(res);return;}let f=path.join(root,u.pathname.slice(1));if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end('nf');return;}res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);});
// Fictional demo clients only — never real client names in a committed repo.
const PINS=['Acme Demo','Nova Skin','Test Studio'];
const ACTIVE='Nova Skin';
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;const b=await chromium.launch({headless:true});
for(const theme of ['light','dark']){
  const ctx=await b.newContext({viewport:{width:900,height:400},deviceScaleFactor:2});const p=await ctx.newPage();
  await p.route('**/*',route=>{const u=route.request().url();if(u.includes('127.0.0.1')||u.startsWith('data:'))return route.continue();return route.abort();});
  await p.addInitScript((d)=>{localStorage.setItem('syncview_auth_v1','ok');if(d.theme==='dark')localStorage.setItem('syncview_theme','dark');localStorage.setItem('syncview_calendar_pins',JSON.stringify(d.pins));sessionStorage.setItem('syncview_kasper_unlocked','ok');},{theme,pins:PINS});
  await p.goto(`http://127.0.0.1:${port}/`,{waitUntil:'domcontentloaded'});
  await p.waitForTimeout(600);
  // Samples tab strip
  await p.evaluate(()=>{try{navTo('sample-reviews');}catch(e){}});
  await p.waitForSelector('#sxrTabs .cal-tab',{timeout:8000}).catch(()=>{});
  await p.evaluate((a)=>{try{sxrState.client=a;_sxrRenderTabs();}catch(e){}},ACTIVE);
  await p.waitForTimeout(250);
  const sxr=await p.$('#sxrTabs');
  if(sxr) { await sxr.screenshot({path:path.join(OUT,`tabs-${LABEL}-sxr-${theme}.png`)}); console.log('wrote',`tabs-${LABEL}-sxr-${theme}.png`); }
  // Calendar tab strip
  await p.evaluate(()=>{try{navTo('calendar');}catch(e){}});
  await p.waitForSelector('.cal-tabs .cal-tab',{timeout:8000}).catch(()=>{});
  await p.evaluate((a)=>{try{calState.client=a;_calRenderTabs();}catch(e){}},ACTIVE);
  await p.waitForTimeout(250);
  const cal=await p.$('.cal-tabs');
  if(cal){ await cal.screenshot({path:path.join(OUT,`tabs-${LABEL}-cal-${theme}.png`)}); console.log('wrote',`tabs-${LABEL}-cal-${theme}.png`); }
  await ctx.close();
}
await b.close();server.close();console.log('done',LABEL);
})().catch(e=>{console.log('ERR',e.message);server.close();process.exit(1);});
