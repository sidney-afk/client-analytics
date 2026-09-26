'use strict';
// Live dropped-connection check for the client review send queue (185).
// Test client only (the courier lib pins it); seeds p_crq_* cards and archives them.
// Run: SYNCVIEW_STAFF_KEY=... node qa/client-review-queue/offline.js
const { H, server } = require('./common.js');
const TS=Date.now(); const out={};
const log=(...a)=>console.log(new Date().toISOString().slice(11,19),...a);
const seeds=[];
function mk(tag){const s={id:'p_crq_'+tag+'_'+TS,name:'CRQ '+tag+' '+TS};seeds.push(s);return s;}
const seed=s=>H.upCal({id:s.id,name:s.name,platforms:'youtube',scheduled_date:new Date(Date.now()+86400e3).toISOString().slice(0,10),video_status:'Approved',graphic_status:'Approved',caption_status:'Client Approval',status:'Client Approval',caption:'Queue test caption',thumbnail_url:'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',asset_url:'https://example.com/q.mp4'});
const cs=id=>(H.rowCal(id,'caption_status,caption_tweaks')||{});
async function until(fn,ms){const t=Date.now();while(Date.now()-t<ms){try{if(await fn())return Date.now()-t;}catch{}await H.sleep(500);}return null;}
const toast=p=>p.evaluate(()=>{const t=document.querySelector('.sv-toast');return t?t.innerText:'';});
const notify=p=>p.evaluate(()=>{const o=document.getElementById('confirmOverlay');return o&&o.classList.contains('active')?document.getElementById('confirmTitle').textContent+' | '+document.getElementById('confirmMsg').textContent:'';});
const cardOn=(p,n)=>p.evaluate(n=>[...document.querySelectorAll('.cal-review-card')].some(c=>(c.querySelector('.kcard-title')||{}).textContent===n),n);
const queue=p=>p.evaluate(()=>localStorage.getItem('sv-client-review-queue-v1')||'{}');
async function page(b,ctx){const C=await H.clientCal(b,undefined,undefined,ctx?{context:ctx}:undefined);C._mode='';await C.route(/supabase\.co|n8n\.cloud/,r=>{const u=r.request().url();if(C._mode==='off')return r.abort('internetdisconnected');if(C._mode==='upsertdown'&&/calendar-upsert/.test(u))return r.abort('internetdisconnected');if(C._mode==='refuse'&&/calendar-upsert/.test(u)&&r.request().method()==='POST')return r.fulfill({status:403,contentType:'application/json',body:JSON.stringify({ok:false,code:'forbidden',error:'forbidden'})});return r.fallback();});await C.waitForFunction(()=>!!document.querySelector('.cal-review-card'),null,{timeout:40000});return C;}
(async()=>{
 const srv=server(); await H.sleep(1500);
 const A=mk('online'),B=mk('offapp'),R=mk('offreq'),L=mk('reload'),F=mk('refuse');
 for(const s of seeds)seed(s);
 for(const s of seeds)await H.pollRow(()=>H.rowCal(s.id,'id'),r=>!!r.id,35000);
 const b=await H.launch();
 try{
  const C=await page(b);
  // 1 online approve
  let t=Date.now(); out.online={click:await H.clientAct(C,A.name,'caption','approve')};
  await H.sleep(150); out.online.toastAtClick=await toast(C);
  out.online.dbMs=await until(()=>cs(A.id).caption_status==='Approved',30000);
  await H.sleep(800); out.online.toastAfter=await toast(C);
  // 2 offline approve
  await H.expandReview(C,B.name); C._mode='off'; await C.context().setOffline(true);
  out.offApprove={click:await H.clientAct(C,B.name,'caption','approve')};
  await H.sleep(5000);
  out.offApprove.toast=await toast(C); out.offApprove.cardShown=await cardOn(C,B.name); out.offApprove.notify=await notify(C);
  out.offApprove.dbOffline=cs(B.id).caption_status; out.offApprove.queued=(await queue(C)).includes(B.id);
  // 3 offline request (still offline)
  out.offReq={click:await H.clientAct(C,R.name,'caption','request','Queue test change '+TS)};
  await H.sleep(5000); out.offReq.toast=await toast(C); out.offReq.notify=await notify(C); out.offReq.dbOffline=cs(R.id).caption_status; out.offReq.queued=(await queue(C)).includes(R.id);
  // back online
  C._mode=''; await C.context().setOffline(false); t=Date.now();
  out.offApprove.landedMs=await until(()=>cs(B.id).caption_status==='Approved',60000);
  out.offReq.landedMs=await until(()=>{const r=cs(R.id);return r.caption_status==='Tweaks Needed'&&String(r.caption_tweaks||'').includes('Queue test change '+TS);},60000);
  const rt=cs(R.id).caption_tweaks||''; out.offReq.commentCopies=(rt.match(new RegExp('Queue test change '+TS,'g'))||[]).length;
  await H.sleep(1500); out.afterOnline={toast:await toast(C),queue:await queue(C),notify:await notify(C)};
  // 4 reload persistence: upsert down, approve, close page, reopen in same context
  await H.expandReview(C,L.name); C._mode='upsertdown';
  out.reload={click:await H.clientAct(C,L.name,'caption','approve')}; await H.sleep(4000);
  out.reload.queued=(await queue(C)).includes(L.id); out.reload.dbBefore=cs(L.id).caption_status;
  const ctx=C.context(); const url=C.url(); await C.close();
  const C2=await ctx.newPage(); await C2.goto(url);
  out.reload.landedMsAfterReopen=await until(()=>cs(L.id).caption_status==='Approved',90000);
  await H.sleep(1500); out.reload.queueAfter=await queue(C2);
  // 5 server refusal
  await C2.waitForFunction(()=>!!document.querySelector('.cal-review-card'),null,{timeout:30000});
  C2._mode='refuse'; await C2.route(/calendar-upsert/,r=>r.request().method()==='POST'?r.fulfill({status:403,contentType:'application/json',body:'{"ok":false,"code":"forbidden","error":"forbidden"}'}):r.fallback());
  out.refuse={click:await H.clientAct(C2,F.name,'caption','approve')}; await H.sleep(5000);
  out.refuse.notify=await notify(C2); out.refuse.cardBack=await cardOn(C2,F.name); out.refuse.db=cs(F.id).caption_status; out.refuse.queue=await queue(C2);
  out.appErrs=H.appErrs(C2).slice(0,5);
 }catch(e){out.err=String(e&&e.stack||e).slice(0,400);}
 finally{const bad=seeds.filter(s=>!H.archiveCalSafe(s.id)).map(s=>s.id);out.cleanup={seeds:seeds.length,notArchived:bad};console.log(JSON.stringify(out,null,1));await b.close();srv.kill();}
})();
