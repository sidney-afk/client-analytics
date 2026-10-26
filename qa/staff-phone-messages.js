'use strict';
require('../test/helpers/single-file-index');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),staff=require('../docs/syncview-design/tests/staff-phone-browser');
const {seedStaffGate}=require('./staff-gate-seed'),captures=require('./client-phone/native-captures'),rules=require('./staff-phone-rule-checks');
const arg=(name,fallback)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)||fallback;
const widths=arg('widths','390,430').split(',').map(Number),out=arg('out',''),receipts=[];
// --inbox-delay=MS holds each inbox answer back, so the loading placeholder is on screen when the list is first read (OPEN_REPAIRS 499).
const inboxDelay=Number(arg('inbox-delay','0'))||0;
const conversations=()=>Array.from({length:12},(_,i)=>({post_id:'message-fixture-'+i,client_slug:'sample-one',client_name:'Sample Client One',title:i?'Small step '+i:'A calmer start',thumbnail_url:'',asset_url:'',last_at:'2026-10-14T12:00:00Z',last_author:'Client',last_role:'client',last_body:'Could we show the opening hours?',unread:i%2===0?4:0,messages:Array.from({length:18},(_,j)=>({id:'note-'+i+'-'+j,root_id:'note-'+i+'-0',parent_id:j?'note-'+i+'-0':null,author:'Client',role:'client',audience:'client',component:'caption',body:j===17?'Could we show the opening hours?':'A fictional note about the next edit. '+j,created_at:'2026-10-14T10:'+String(j).padStart(2,'0')+':00Z'}))}));
async function shot(page,name,width,theme){
 await captures.anonymizePlaceholders(page);await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(120);
 if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,name+'-'+theme+'-'+width+'.png'),animations:'disabled'});}
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+': sideways overflow');
 const g=await rules.inspect(page,await rules.activeSurface(page));assert.deepEqual(g.overlaps,[],name+': control overlap');
 receipts.push({name,width,theme});
}
async function main(){
 const server=await staff.serve(),browser=await chromium.launch();
 try{for(const width of widths)for(const theme of ['light','dark']){
  staff.resetScenario();const context=await browser.newContext({viewport:{width,height:844},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  await staff.installBackend(context);await seedStaffGate(context);await context.addInitScript(t=>localStorage.setItem('syncview_theme',t),theme);
  const rows=conversations(),calls=[];
  await context.route('**/functions/v1/production-comments{,?*}',async route=>{
   const body=route.request().method()==='GET'?{action:new URL(route.request().url()).searchParams.get('action')}:JSON.parse(route.request().postData()||'{}');calls.push(body);
   if(body.action==='inbox_mark'){const c=rows.find(c=>c.post_id===body.post_id);if(c)c.unread=body.state==='unread'?1:0;return route.fulfill({json:{ok:true}});}
   if(body.action==='inbox'){if(inboxDelay)await new Promise(r=>setTimeout(r,inboxDelay));return route.fulfill({json:{ok:true,conversations:JSON.parse(JSON.stringify(rows)),scope:'all'}});}
   return route.fulfill({json:{ok:false,error:'Fictional refusal'},status:409});
  });
  const p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(8000);captures.prepareCaptures(p);
  try{
   await p.goto('http://127.0.0.1:'+server.address().port);await p.waitForFunction(()=>typeof navTo==='function');await p.evaluate(()=>navTo('messages'));
   // The loading placeholder draws 12 grey .msg-conv rows (is-skeleton) under a New pill; count only once the inbox answer is on screen (OPEN_REPAIRS 499).
   const early=await p.locator('.msg-conv').first().waitFor().then(()=>p.evaluate(()=>({rows:document.querySelectorAll('.msg-conv').length,skeleton:document.querySelectorAll('.msg-conv.is-skeleton').length,newPill:document.querySelector('.msg-filters .is-active')?.textContent.trim()||''})));
   assert(early.skeleton===0||(early.skeleton===early.rows&&/^New/.test(early.newPill)),'Before the answer only the placeholder shows, under New: '+JSON.stringify(early));
   await p.locator('.msg-inbox:not(.is-skeleton) .msg-conv').first().waitFor();assert.equal(await p.locator('.msg-conv').count(),6,'The inbox opens on New: only the conversations with something new');
   await shot(p,'messages-unread',width,theme);await p.getByRole('button',{name:'All',exact:true}).tap();assert.equal(await p.locator('.msg-conv').count(),12);
   await shot(p,'messages-inbox',width,theme);
   const tabs=p.locator('.pocket-staff-tabs-btn').filter({visible:true});await tabs.tap();
   const tile=p.locator('dialog[open] [data-nav=navMessages]');assert(await tile.getByText('Messages',{exact:true}).isVisible(),'Messages has its stable label');
   assert(await tile.locator('svg').isVisible(),'Messages has its native icon');await shot(p,'messages-tabs',width,theme);await p.keyboard.press('Escape');
   const search=p.getByRole('searchbox',{name:'Search conversations'});await search.fill('A calmer start');assert.equal(await p.locator('.msg-conv').count(),1);await shot(p,'messages-search',width,theme);await search.fill('');
   await p.getByRole('button',{name:/^New/}).tap();assert.equal(await p.locator('.msg-conv').count(),6);await p.getByRole('button',{name:'All',exact:true}).tap();assert.equal(await p.locator('.msg-conv').count(),12);
   await p.locator('[data-msg-conv="message-fixture-0"]').tap();await p.getByRole('button',{name:'Back to conversations'}).waitFor();
   const title=await p.locator('.msg-chat-titles').boundingBox();assert(title.width>=150&&title.height<=80,'Thread title has readable width without wrapping one letter per line');
   assert(await p.getByText('New messages',{exact:true}).isVisible(),'Thread opens at the unread boundary');
   assert(calls.some(c=>c.action==='inbox_mark'&&c.post_id==='message-fixture-0'&&c.state==='read'),'Native read mark contract retained');
   await shot(p,'messages-thread',width,theme);
   const box=p.locator('#msgReplyBox');await box.fill('A retained fictional reply.');await box.press('Enter');assert.equal(await box.inputValue(),'A retained fictional reply.\n','Phone Return inserts a newline');await box.fill('A retained fictional reply.');await shot(p,'messages-composer',width,theme);
   await p.setViewportSize({width,height:420});await p.waitForTimeout(200);const bounds=await p.locator('.msg-reply').boundingBox();assert(bounds.y+bounds.height<=421,'Composer must fit above the simulated keyboard');await shot(p,'messages-keyboard',width,theme);await p.setViewportSize({width,height:844});
   await p.setViewportSize({width:1440,height:900});await p.waitForTimeout(150);
   assert.equal(await p.locator('.thumb-msg-options').count(),0,'Desktop restores its native actions');
   assert(await p.locator('.msg-act[title="Mark as unread"]').isVisible(),'Desktop mark action is unchanged');
   assert.equal(await box.inputValue(),'A retained fictional reply.','Resize keeps the draft');
   await p.setViewportSize({width,height:844});await p.waitForTimeout(150);assert(await p.getByRole('button',{name:'More conversation actions'}).isVisible());
   await p.getByRole('button',{name:'Back to conversations'}).tap();await p.waitForTimeout(120);assert(await p.locator('[data-msg-conv="message-fixture-0"]').evaluate(n=>n===document.activeElement),'Back restores conversation focus: '+await p.evaluate(()=>JSON.stringify({active:document.activeElement?.outerHTML.slice(0,200),id:_msgState.openId,returning:_msgPhone.returning,focus:_msgPhone.focusId,history:history.state,list:document.querySelector('.msg-convs')?.scrollTop})));
   await p.locator('[data-msg-conv="message-fixture-0"]').tap();assert.equal(await box.inputValue(),'A retained fictional reply.');await p.goBack();await p.waitForTimeout(120);assert(await search.isVisible(),'Browser Back restores inbox');
   await p.locator('[data-msg-conv="message-fixture-0"]').tap();
   await p.evaluate(()=>navTo('today'));await p.goBack();await p.getByRole('button',{name:'Back to conversations'}).waitFor();
   assert.equal(await box.inputValue(),'A retained fictional reply.','Returning from another page keeps the thread draft');
   await p.goBack();await search.waitFor();await p.goForward();await p.getByRole('button',{name:'Back to conversations'}).waitFor();
   assert.equal(await box.inputValue(),'A retained fictional reply.','Forward after a cross-page return restores the thread and draft');
   const more=p.getByRole('button',{name:'More conversation actions'});await more.tap();
   await shot(p,'messages-more',width,theme);await rules.scrollLock(p,'.thumb-msg-more');await p.keyboard.press('Escape');assert(await more.evaluate(n=>n===document.activeElement),'More returns focus');
   // Since the note outbox (2026-10-15) a refused reply stays in the chat as "Not sent" with Tap to retry, its words kept; the box is free.
   await p.getByRole('button',{name:'Send reply',exact:true}).tap();const refused=p.locator('.msg-b.is-outbox-failed').filter({hasText:'A retained fictional reply.'});await refused.locator('.sv-note-outbox-retry').waitFor({timeout:30000});assert.equal(await box.inputValue(),'');await shot(p,'messages-refused',width,theme);
   assert(await refused.locator('.sv-note-outbox-retry').isEnabled(),'A refused reply can be retried');
   await p.locator('.sv-toast').waitFor({state:'hidden',timeout:10000});
   await p.evaluate(()=>{_msgState.openId='';_msgState.conversations=[];_msgState.loaded=true;_msgState.loading=false;_msgState.error='';_msgPaint();});await shot(p,'messages-empty',width,theme);
   await p.evaluate(()=>{_msgState.loaded=false;_msgState.loading=true;_msgPaint();});await shot(p,'messages-loading',width,theme);
   await p.evaluate(()=>{_msgState.loading=false;_msgState.error='Messages could not load. Try again in a moment.';_msgPaint();});await shot(p,'messages-error',width,theme);
   assert(await p.getByRole('button',{name:'Try again',exact:true}).isVisible());assert.deepEqual(errors,[],'No page errors');
   assert(calls.every(c=>['inbox','inbox_mark'].includes(c.action)),'Only native inbox reads and marks may be requested by this fixture');
   console.log('ok Messages '+width+' '+theme+': list, thread, unread boundary, draft, Back, composer, sheets, refusal, empty/loading/error');
  }finally{await context.close();}
 }}finally{await browser.close();server.close();}
 if(out)fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(receipts,null,2)+'\n');
 console.log('STAFF_PHONE_MESSAGES: '+receipts.length+' screen/theme/width captures; all assertions passed; fictional intercepted transports; no live writes');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={conversations};
