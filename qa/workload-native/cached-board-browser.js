'use strict';
// The Workload warm-start board in real Chromium, with the real built page:
// every successful live load replaces the cached board, a cached board older
// than WL_CACHED_BOARD_MAX_AGE_MS is never painted, a cached board that IS
// painted always says so, the retired 4.9M-character v1 key is removed, and a
// write that fails leaves no stale board behind. Only network, storage and time
// are fixtures (Loom, 2026-09-23: the owner saw 112 overdue / 59 tweaks from a
// days-old cache, against 18 / 13 live).
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {startStreamServer,openCase}=require('../boot/client-entry-sequence');
const root=path.resolve(__dirname,'../..');
const shots=process.env.WL_CACHE_SHOTS||'';
const member={id:'synthetic-staff-1',name:'Synthetic Test Operator',role:'smm',team:'test'};
const slug='bootfixtureclient',client='Boot Fixture Client';
const NOW=new Date('2026-09-07T12:00:00Z').getTime(),HOUR=3600e3;
const V2='syncview_workloadBoardCache_v2',V1='syncview_linearIssuesCache_v1';
function row(id,{title,due,status='Todo',statusType='unstarted',assignee='Synthetic Native Editor'}){return {id,linear_id:null,source:'native',is_sub_issue:true,active:true,
 parent_id:'bat_cache_fixture',title,client_slug:slug,client_name:client,team_key:'VID',team_name:'Video',status,status_type:statusType,
 due_date:due,assignee_id:'synthetic-editor',assignee_name:assignee,native_client_active:true,native_assignee_eligible:true,
 native_metadata:{id,client_slug:slug,team:'video',due_date:due,updated_at:'2026-09-01T00:00:00Z',workload_labels_complete:true,workload_labels:[]}};}
function snapshot(withGhost){const rows=[{id:'bat_cache_fixture',source:'native',is_sub_issue:false,active:true,title:'Synthetic cache batch'},
 row('del_live_work',{title:'Synthetic live work',due:'2026-09-10'}),
 row('del_done_work',{title:'Synthetic finished work',due:'2026-08-01',status:'Done',statusType:'completed'})];
 if(withGhost)rows.push(row('del_stale_ghost',{title:'Synthetic ghost work',due:'2026-08-15',assignee:'Old Display Name'}));
 return {ok:true,contract:'workload-native-snapshot-v1',complete:true,count:rows.length,authority:{video:'syncview',graphics:'syncview'},legacy_teams:[],rows,plans:[],
  roster:[{id:'synthetic-editor',native_id:'synthetic-editor',name:'Synthetic Native Editor',team:'video'},
   {id:'synthetic-free',native_id:'synthetic-free',name:'Zero Work Editor',team:'video'}]};}
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;console.log('  ok  '+m);};

async function visit(browser,server,{local={},holdLive=false,ghost=false,failV2Write=false}){
 const run=await openCase(browser,server,{storage:{local:{syncview_auth_v1:'ok',syncview_nav:'workload',
  syncview_staff_identity_v1:JSON.stringify({key:'synthetic-role-key',role:'smm',member}),...local},
  session:{syncview_staff_identity_prompted_v1:'1'}}});
 await run.context.routeWebSocket('**/*',socket=>socket.close());
 if(failV2Write)await run.page.addInitScript(key=>{const set=Storage.prototype.setItem;
  Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('quota','QuotaExceededError');return set.call(this,k,v);};},V2);
 const reply=(route,value,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(value)});
 await run.context.route('**/functions/v1/key-verify',route=>reply(route,{ok:true,role:'smm',member}));
 await run.context.route('**/rest/v1/production_deliverables_browser_v1?*',route=>reply(route,[]));
 await run.context.route('**/rest/v1/workload_issues?*',route=>reply(route,[]));
 let release=null;const held=new Promise(r=>{release=r;});
 await run.context.route('**/functions/v1/workload-plan*',async route=>{const body=route.request().postDataJSON();
  if(body.action==='native_snapshot_v2')return reply(route,{ok:false,error:'snapshot_cache_unavailable'},501);
  if(body.action==='warm_snapshot')return reply(route,{ok:false,error:'snapshot_cache_unavailable'},501);
  assert.equal(body.action,'native_snapshot');if(holdLive)await held;return reply(route,snapshot(ghost));});
 await run.page.clock.setFixedTime(new Date(NOW));
 const navigation=run.page.goto(server.origin+'/index.html#workload',{waitUntil:'load',timeout:20000});
 const chunk=await server.nextChunk();chunk.release();await navigation;
 await run.page.waitForFunction(()=>typeof wlState!=='undefined'&&!!document.getElementById('wlPlanStatus'),{},{timeout:12000});
 const state=()=>run.page.evaluate(()=>({ghost:wlState.allActiveSubs.some(s=>s.id==='del_stale_ghost'),live:wlState.allActiveSubs.some(s=>s.id==='del_live_work'),
  names:wlState.allActiveSubs.map(s=>s.assigneeName),cachedBoardAt:wlState.cachedBoardAt,planStatus:wlState.planStatus,
  notice:(document.getElementById('wlPlanStatus')||{}).innerText||'',skeleton:!!document.querySelector('#wlBody .sv-skeleton, #wlBody [class*="skeleton"]'),
  ghostInDom:!!document.querySelector('[data-wl-issue-id="del_stale_ghost"]'),
  panel:[...document.querySelectorAll('#wlOverviewRows .workload-overview-row:not(.is-skeleton)')].map(e=>(e.querySelector('.workload-overview-editor-copy')||e).innerText.split('\n')[0].trim()).filter(Boolean)}));
 const ready=()=>run.page.waitForFunction(()=>!wlState.loading&&wlState.planStatus==='ready',{},{timeout:12000});
 const storage=()=>run.page.evaluate(([v2,v1])=>({v2:localStorage.getItem(v2),v1:localStorage.getItem(v1)}),[V2,V1]);
 return {run,release,state,ready,storage,shot:async name=>{if(shots)await run.page.screenshot({path:path.join(shots,name),fullPage:false});}};
}

(async()=>{const server=await startStreamServer();let browser;
 try{browser=await chromium.launch({headless:true,channel:'chromium',args:['--no-sandbox','--disable-gpu','--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1, EXCLUDE localhost']});
  if(process.env.WL_CACHE_CONTROL==='before-fix'){
   // Negative control against a page built before this fix (v1 key, no age
   // limit): the same 7-hour-old board IS painted. Proves the case bites.
   let c=await visit(browser,server,{ghost:true});await c.ready();
   const old=JSON.parse((await c.storage()).v1);await c.run.context.close();
   c=await visit(browser,server,{local:{[V1]:JSON.stringify({...old,fetchedAt:NOW-7*HOUR})},holdLive:true});
   await c.run.page.waitForTimeout(1500);const cs=await c.state();
   ok(cs.ghost&&cs.names.includes('Old Display Name'),'BEFORE THE FIX: a 7-hour-old cached board with a stale card and old name is painted');
   await c.shot('before-fix-7h-painted.png');c.release();await c.run.context.close();
   console.log(JSON.stringify({classification:'ISOLATED_CHROMIUM',suite:'workload-cached-board',control:'before-fix',checks,result:'BUG_REPRODUCED'}));return;}
  if(process.env.WL_CACHE_CONTROL==='roster-before-fix'){
   // Negative control against a page built before the roster was cached: the
   // zero-work editor is missing from the cached paint and pops in with live.
   let c=await visit(browser,server,{ghost:true});await c.ready();
   const cached=JSON.parse((await c.storage()).v2);await c.run.context.close();
   c=await visit(browser,server,{local:{[V2]:JSON.stringify({...cached,fetchedAt:NOW-HOUR})},holdLive:true});
   await c.run.page.waitForFunction(()=>wlState.cachedBoardAt!=null&&wlState.allActiveSubs.length>0,{},{timeout:12000});
   const before=await c.state();c.release();await c.ready();const after=await c.state();
   ok(!before.panel.includes('Zero Work Editor')&&after.panel.includes('Zero Work Editor'),
    'BEFORE THE FIX: the zero-work editor is missing on the cached paint ('+before.panel.join(', ')+') and pops in with live ('+after.panel.join(', ')+')');
   await c.run.context.close();
   console.log(JSON.stringify({classification:'ISOLATED_CHROMIUM',suite:'workload-cached-board',control:'roster-before-fix',checks,result:'BUG_REPRODUCED'}));return;}
  // 1. A live load writes the cache (with the ghost) in the page's own shape.
  let v=await visit(browser,server,{ghost:true});await v.ready();
  let stored=JSON.parse((await v.storage()).v2);
  ok(stored&&stored.fetchedAt===NOW&&stored.issues.some(i=>i.id==='del_stale_ghost'),'a live load writes the v2 warm-start board');
  ok(Array.isArray(stored.roster)&&stored.roster.length===2&&stored.roster.every(m=>Object.keys(m).sort().join()==='id,name,native_id,team'),
   'the cache carries the roster: 2 editors, 4 short fields each');
  ok(!stored.issues.some(i=>i.id==='del_done_work')&&stored.issues.some(i=>i.id==='bat_cache_fixture'),
   'it keeps only what the board draws: finished work dropped, parents kept');
  await v.run.context.close();
  const staleCache=at=>JSON.stringify({...stored,fetchedAt:at});

  // 2. Cache 1 h old: painted at once, with the notice; the live board replaces it and the cache.
  v=await visit(browser,server,{local:{[V2]:staleCache(NOW-HOUR)},holdLive:true});
  await v.run.page.waitForFunction(()=>wlState.cachedBoardAt!=null&&wlState.allActiveSubs.length>0,{},{timeout:12000});
  let s=await v.state();
  ok(s.ghost&&s.names.includes('Old Display Name'),'a 1-hour-old cached board is painted immediately (stale card and old name visible)');
  ok(/Showing the board from \d\d:\d\d while it updates/.test(s.notice),'and it says so: "'+s.notice.split('\n')[0]+'"');
  ok(s.panel.includes('Zero Work Editor'),'the zero-work ("Free") editor is in the Team workload panel on the cached first paint: '+s.panel.join(', '));
  const cachedPanel=s.panel;
  await v.shot('cached-1h-while-updating.png');
  v.release();await v.ready();s=await v.state();
  ok(!s.ghost&&s.live&&s.cachedBoardAt===null&&!/Showing the board from/.test(s.notice),'the live board replaces it and the notice goes');
  ok(s.panel.includes('Zero Work Editor')&&s.panel.length===cachedPanel.length&&s.panel.every(n=>cachedPanel.includes(n)),
   'the live board has the same editor rows, so nothing pops in: '+s.panel.join(', '));
  stored=JSON.parse((await v.storage()).v2);
  ok(stored.fetchedAt===NOW&&!stored.issues.some(i=>i.id==='del_stale_ghost'),'and the successful live load REPLACES the cached board');
  await v.shot('cached-1h-after-live.png');
  await v.run.context.close();

  // 3. Cache 7 h old: never painted; the normal loading state until the live board.
  v=await visit(browser,server,{local:{[V2]:staleCache(NOW-7*HOUR)},holdLive:true});
  await v.run.page.waitForTimeout(1500);s=await v.state();
  ok(!s.ghost&&!s.ghostInDom&&s.cachedBoardAt===null,'a 7-hour-old cached board is never painted');
  ok(s.skeleton&&!/Showing the board from/.test(s.notice),'the normal loading state is shown instead');
  await v.shot('cached-7h-loading-state.png');
  v.release();await v.ready();s=await v.state();ok(s.live&&!s.ghost,'then the live board');
  await v.run.context.close();

  // 4. The retired v1 key (the one that no longer fit) is removed by the first live load.
  const legacy=JSON.stringify({fetchedAt:NOW-HOUR,issues:[],pad:'x'.repeat(4_800_000)});
  v=await visit(browser,server,{local:{[V1]:legacy}});await v.ready();
  let st=await v.storage();ok(st.v1===null&&JSON.parse(st.v2).fetchedAt===NOW,'the 4.8M-character v1 key is deleted and v2 is written in the space it held');
  await v.run.context.close();

  // 5. A write that fails drops the old board instead of leaving it to be painted.
  v=await visit(browser,server,{local:{[V2]:staleCache(NOW-HOUR)},failV2Write:true});await v.ready();
  st=await v.storage();ok(st.v2===null,'a failed cache write removes the previous board rather than keeping a stale one');
  await v.run.context.close();
  console.log(JSON.stringify({classification:'ISOLATED_CHROMIUM',suite:'workload-cached-board',checks,result:'PASS'}));
 }finally{if(browser)await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
