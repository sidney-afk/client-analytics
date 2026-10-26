'use strict';
require('../test/helpers/single-file-index');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),staff=require('../docs/syncview-design/tests/staff-phone-browser');
const {seedStaffGate}=require('./staff-gate-seed'),{conversations}=require('./staff-phone-messages');
const arg=n=>process.argv.find(a=>a.startsWith('--'+n+'='))?.slice(n.length+3);
const reference=path.resolve(arg('before-root')||''),out=arg('out');
assert(arg('before-root')&&out,'Provide a pristine reference build and evidence output');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
function assembled(root){
 const src=path.join(root,'src/index'),{readModuleList,servedBytes,stripWindowBlock}=require(path.join(root,'scripts/index-modules'));
 const modules=readModuleList(src);
 return Buffer.concat(fs.readFileSync(path.join(src,'manifest.txt'),'utf8').split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#')).map(n=>{
  const b=servedBytes(n,fs.readFileSync(path.join(src,n)),modules);return modules.has(n)?Buffer.from(stripWindowBlock(b.toString('utf8'))):b;
 }));
}
(async()=>{
 const server=await staff.serve(),origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch();fs.mkdirSync(out,{recursive:true});
 const builds={before:assembled(reference),after:assembled(path.resolve(__dirname,'..'))},report=[];
 try{for(const theme of ['light','dark'])for(const screen of ['inbox','thread']){
  let captures,attempt=0;
  const pair=await require('./client-phone/exact-replay').exactReplay(async()=>{attempt++;captures={};
  for(const build of ['before','after']){
   staff.resetScenario();const ctx=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
   await staff.installBackend(ctx);await seedStaffGate(ctx);await ctx.addInitScript(t=>localStorage.setItem('syncview_theme',t),theme);
   await ctx.route(origin+'/',r=>r.fulfill({contentType:'text/html',body:builds[build]}));
   await ctx.route('**/functions/v1/production-comments{,?*}',r=>{
    const b=r.request().method()==='GET'?{action:new URL(r.request().url()).searchParams.get('action')}:JSON.parse(r.request().postData()||'{}');assert(['inbox','inbox_mark'].includes(b.action),'Parity may only read and mark the intercepted inbox');
    return r.fulfill({json:b.action==='inbox'?{ok:true,scope:'all',conversations:conversations()}:{ok:true}});
   });
   const p=await ctx.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.clock.setFixedTime(new Date('2026-10-15T12:00:00Z'));
   try{
    await p.goto(origin+'/');await p.waitForFunction(()=>typeof navTo==='function');await p.evaluate(()=>navTo('messages'));await p.locator('.msg-inbox:not(.is-skeleton) .msg-conv').first().waitFor();
    if(screen==='thread')await p.locator('[data-msg-conv="message-fixture-0"]').click();
    await p.evaluate(()=>document.fonts.ready);await p.addStyleTag({content:'*{animation:none!important;transition:none!important;caret-color:transparent!important}'});await p.mouse.move(1439,899);await p.waitForTimeout(500);await p.evaluate(()=>document.activeElement?.blur());
    let png=await p.screenshot({fullPage:true}),streak=0;
    for(let i=0;i<10&&streak<2;i++){await p.waitForTimeout(150);const next=await p.screenshot({fullPage:true});streak=next.equals(png)?streak+1:0;png=next;}
    assert.equal(streak,2,'Desktop did not settle');
    const styles=await p.evaluate(()=>Array.from(document.querySelectorAll('body *')).map(n=>{const c=getComputedStyle(n),r=n.getBoundingClientRect();return [n.tagName,n.id,n.className,...Array.from(c).sort().map(k=>k+':'+c.getPropertyValue(k)),r.toJSON()];}));
    const top=await p.locator('.header').evaluate(n=>Math.ceil(n.getBoundingClientRect().bottom));
    const publicPng=await p.screenshot({clip:{x:0,y:top,width:1440,height:900-top}});
    fs.writeFileSync(path.join(out,'messages-'+screen+'-'+theme+'-'+build+'-attempt-'+attempt+'.png'),publicPng);captures[build]={png,styles:digest(JSON.stringify(styles)),publicPng};assert.deepEqual(errors,[]);
   }finally{await ctx.close();}
  }
  return {pixels:captures.before.png.equals(captures.after.png)&&captures.before.publicPng.equals(captures.after.publicPng),styles:captures.before.styles===captures.after.styles};
  });
  assert(pair.pixels,screen+' '+theme+': full desktop pixels changed');assert(pair.styles,screen+' '+theme+': desktop styles/bounds changed');
  for(const build of ['before','after'])fs.writeFileSync(path.join(out,'messages-'+screen+'-'+theme+'-'+build+'.png'),captures[build].publicPng);
  report.push({screen,theme,width:1440,pixels:true,styles:true,attempts:pair.attempts,sha256:digest(captures.after.publicPng)});
  console.log('ok Messages desktop '+screen+' '+theme+': full pixels, computed styles and bounds identical; attempts '+pair.attempts);
 }}finally{await browser.close();server.close();}
 fs.writeFileSync(path.join(out,'parity.json'),JSON.stringify(report,null,2)+'\n');console.log('MESSAGES_DESKTOP_PARITY: 4/4 populated desktop pairs exact; native inbox and thread; fictional intercepted transports');
})().catch(e=>{console.error(e);process.exitCode=1;});
