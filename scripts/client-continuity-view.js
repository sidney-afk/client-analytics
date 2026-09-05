'use strict';
const { createHash } = require('node:crypto');
const { report } = require('./client-continuity-monitor');
const { openGuardedContext } = require('./client-continuity-transport');
const TABLES = { calendar: 'calendar_posts', samples: 'sample_reviews' };
function fail(code) { throw new Error(code); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
// Rows/IDs/digests remain in process memory, never in public reports.
function snapshot(rows, scope) {
  const ids = new Set();
  if (!Array.isArray(rows)) fail('census_shape');
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id || row.client !== scope || ids.has(row.id) || row.status === 'Archived') fail('census_scope');
    ids.add(row.id);
  }
  return { count: rows.length, ids: [...ids], titles: Object.fromEntries(rows.map(r=>[r.id,typeof r.name==='string'?r.name:null])), digest: createHash('sha256').update(JSON.stringify(
    [...rows].sort((a,b)=>a.id.localeCompare(b.id)).map(canonical))).digest('hex') };
}
function validateConfig(config) {
  if (!config || !TABLES[config.lane] || config.enabled !== true || config.activation !== 'OWNER_APPROVED_VIEW_CHECKS') fail('view_activation_required');
  if (!/^[a-z0-9&_-]+$/.test(config.scope || '') || typeof config.censusKey !== 'string' || !config.censusKey) fail('private_view_config_required');
  try {
    const link = new URL(config.shareLink), backend = new URL(config.backendOrigin), fallback = new URL(config.fallbackOrigin);
    const local = config.fixture === true && link.hostname === '127.0.0.1';
    if ((!local && link.protocol !== 'https:') || backend.protocol !== 'https:' || fallback.protocol !== 'https:' ||
        backend.href !== backend.origin + '/' || fallback.href !== fallback.origin + '/' ||
        !link.searchParams.get('t') || !link.searchParams.get('c') ||
        !Array.isArray(config.requiredVisibleIds) || config.requiredVisibleIds.some(id=>typeof id!=='string'||!id)) fail('private_view_config_required');
    return { link, backend, fallback };
  } catch { fail('private_view_config_required'); }
}
async function readCensus(config, fetchImpl = fetch) {
  const { backend } = validateConfig(config);
  const rows = []; let cursor, expected;
  for (let page=0; page<20; page++) {
    const url = new URL(`/rest/v1/${TABLES[config.lane]}`,backend);
    url.searchParams.set('select','*'); url.searchParams.set('client',`eq.${config.scope}`);
    url.searchParams.set('or','(status.is.null,status.neq.Archived)');
    url.searchParams.set('order','id.asc'); url.searchParams.set('limit','1000');
    if (cursor !== undefined) url.searchParams.set('id',`gt.${cursor}`);
    const response=await fetchImpl(url.href,{method:'GET',redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{apikey:config.censusKey,Authorization:`Bearer ${config.censusKey}`,Accept:'application/json',Prefer:'count=exact'}});
    if (!response.ok) fail('census_unavailable');
    const batch=await response.json(); snapshot(batch,config.scope);
    const range=response.headers.get('content-range')||'';
    if (!/^(?:\d+-\d+|\*)\/\d+$/.test(range)) fail('census_incomplete');
    const remaining=Number(range.split('/')[1]);
    if (!Number.isSafeInteger(remaining) || batch.length!==Math.min(remaining,1000) ||
        range.split('/')[0] !== (batch.length ? `0-${batch.length-1}` : '*')) fail('census_incomplete');
    if (expected===undefined) expected=remaining;
    if(rows.length+remaining!==expected) fail('census_changed');
    rows.push(...batch); snapshot(rows,config.scope);
    if(rows.length===expected) return snapshot(rows,config.scope);
    cursor=batch[batch.length-1].id;
  }
  fail('census_limit');
}
// Existing visible DOM only; no injected product health globals/functions.
function visibleState(lane) {
  const visible=node=>!!node && node.getClientRects().length>0 && getComputedStyle(node).visibility!=='hidden';
  const root=document.getElementById(lane==='samples'?'sxrBody':'calBody');
  if(!visible(root)) return {settled:false};
  const all=selector=>[...root.querySelectorAll(selector)].filter(visible);
  const cards=all('.cal-review-card[data-cal-review-pid], .cal-card[data-pid]');
  const ids=[...new Set(cards.map(el=>el.getAttribute('data-cal-review-pid')||el.getAttribute('data-pid')))];
  const titles=Object.fromEntries(cards.map(el=>{
    const title=el.querySelector('.kcard-title, .cal-fld-name');
    return [el.getAttribute('data-cal-review-pid')||el.getAttribute('data-pid'),visible(title)?String(title.value ?? title.textContent).trim():null];
  }));
  const error=all('.cal-error').length>0;
  const empty=!error && ids.length===0 && all('.cal-empty').length>0;
  const warning=visible(document.getElementById(lane==='samples'?'sxrStaleNotice':'calStaleNotice'));
  return {settled:all('.cal-skeleton-loader, .cal-loading').length===0 && (error||empty||ids.length>0),
    ids,titles,display:error?'error':empty?'empty':'content',warningVisible:warning,
    retryVisible:warning || all('.cal-error button').length>0};
}
function observeRequests(page,config) {
  const backend=new URL(config.backendOrigin).origin, fallback=new URL(config.fallbackOrigin).origin;
  const state={epoch:0,pending:0,rows:[],primary:false,failed:false,auth:false,scopeMismatch:false,errors:0,lastAt:Date.now()};
  const epochs=new WeakMap();
  const kind=request=>{
    const u=new URL(request.url());
    if(request.resourceType()==='document' && u.origin===new URL(config.shareLink).origin)return 'document';
    if(u.origin===backend && u.pathname===`/rest/v1/${TABLES[config.lane]}`) return 'primary';
    if(u.origin===fallback && u.pathname===`/webhook/${config.lane==='samples'?'sample-review-get':'calendar-get'}`) return 'fallback';
    if(u.origin===backend && u.pathname==='/functions/v1/client-token-verify') return 'verify';
    return '';
  };
  page.on('request',request=>{
    const k=kind(request); if(!k) return;
    if(k==='primary') {
      const u=new URL(request.url());
      if(u.searchParams.get('client')!==`eq.${config.scope}`) state.scopeMismatch=true;
      const continuation=u.searchParams.has('id') || u.searchParams.getAll('or').some(v=>v.includes('id.gt.'));
      if(!continuation) {state.epoch++;state.rows=[];state.primary=false;state.failed=false;}
    }
    epochs.set(request,state.epoch);state.pending++;state.lastAt=Date.now();
  });
  page.on('response',async response=>{
    const request=response.request(),k=kind(request);if(!k)return;
    try {
      if([401,403].includes(response.status())) state.auth=true;
      if(k==='document') {state.pageDigest=createHash('sha256').update(await response.body()).digest('hex');return;}
      if(k==='verify') return;
      const epoch=epochs.get(request);
      if(!response.ok()) {if(epoch===state.epoch)state.failed=true;return;}
      if(k==='primary') {
        const rows=await response.json();snapshot(rows,config.scope);
        if(epoch===state.epoch){state.rows.push(...rows);state.primary=true;}
      }
      // A legacy fallback never certifies completeness/freshness.
    } catch {state.failed=true;}
    finally {state.pending--;state.lastAt=Date.now();}
  });
  page.on('requestfailed',request=>{if(kind(request)){state.pending--;state.failed=true;state.lastAt=Date.now();}});
  page.on('pageerror',()=>state.errors++);
  return state;
}
async function captureView(browser,config,deps={}) {
  const endpoints=validateConfig(config), census=()=>readCensus(config,deps.fetchImpl);
  let context,guard,reads;
  const observe=async()=>{
  try {
    let before;try{before=await census();}catch{}
    ({context,guard}=await openGuardedContext(browser,config,deps));
    const page=await context.newPage();page.setDefaultTimeout(10000);
    reads=observeRequests(page,config);
    await guard.prepare(page);
    if(deps.navigate) await deps.navigate(page,endpoints.link.href);
    else await page.goto(endpoints.link.href,{waitUntil:'domcontentloaded',timeout:25000});
    let dom;const deadline=Date.now()+15000;
    do {
      if(reads.auth)return report(config.lane,'valid_link_auth');
      dom=await page.evaluate(visibleState,config.lane);
      if(dom.settled && reads.pending===0 && Date.now()-reads.lastAt>=250)break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }while(Date.now()<deadline);
    if(reads.auth)return report(config.lane,'valid_link_auth');
    if(config.expectedPageSha256 && reads.pageDigest!==config.expectedPageSha256)return report(config.lane,'release_mismatch');
    if(guard.code())return report(config.lane,guard.code());
    if(reads.errors)return report(config.lane,'browser_error');
    if(reads.scopeMismatch)return report(config.lane,'scope_mismatch');
    if(!dom.settled || reads.pending!==0)return report(config.lane,'read_failed');
    if(reads.failed || !reads.primary) {
      if(dom.display==='empty')return report(config.lane,'false_empty');
      if(dom.display==='content'&&!dom.warningVisible)return report(config.lane,'stale_unwarned');
      return report(config.lane,'read_failed');
    }
    const epoch=reads.epoch;
    let after,received;try{after=await census();received=snapshot(reads.rows,config.scope);}catch{return report(config.lane,'inconclusive');}
    if(!before || epoch!==reads.epoch || reads.pending || before.digest!==after.digest || received.digest!==after.digest)return report(config.lane,'inconclusive');
    if(new URL(page.url()).searchParams.get('c')!==endpoints.link.searchParams.get('c'))return report(config.lane,'scope_mismatch');
    dom=await page.evaluate(visibleState,config.lane);
    if(epoch!==reads.epoch || reads.pending || reads.failed)return report(config.lane,'inconclusive');
    if(!dom.settled)return report(config.lane,'inconclusive');
    if(dom.display==='error')return report(config.lane,'render_failed');
    // Census covers all unarchived rows; rendering is filtered. Explicit private
    // stable visible canaries avoid inventing render eligibility from row count.
    if(after.count>0 && !config.requiredVisibleIds.length)return report(config.lane,'inconclusive');
    if(config.requiredVisibleIds.some(id=>!after.ids.includes(id)))return report(config.lane,'inconclusive');
    if(config.requiredVisibleIds.some(id=>!after.titles[id]))return report(config.lane,'inconclusive');
    if(dom.ids.some(id=>!after.ids.includes(id)))return report(config.lane,'inconclusive');
    if(config.requiredVisibleIds.some(id=>!dom.ids.includes(id)) || (after.count===0 && dom.display!=='empty'))return report(config.lane,'render_failed');
    if(config.requiredVisibleIds.some(id=>dom.titles[id]!==after.titles[id].trim()))return report(config.lane,'render_failed');
    if(dom.warningVisible)return report(config.lane,'stale_overdue');
    return report(config.lane,'healthy',dom.ids.length);
  }catch{return report(config.lane,'read_failed');}
  };
  const result=await observe();
  if(guard)await guard.close();
  else if(context) {
    let timer;
    await Promise.race([context.close().catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,3000);})]);
    clearTimeout(timer);
  }
  // The result is constructed only after all final reads and bounded teardown.
  // A late denial outranks an earlier apparent success, including blank popups.
  return {...(guard?.code()?report(config.lane,guard.code()):result),denialReasons:guard?guard.denialReasons():[]};
}
async function viewingJourney(browser,config,deps) {
  let result;
  for(let attempt=0;attempt<2;attempt++) {
    result=await captureView(browser,config,deps);
    result.attempts=attempt+1;
    if(!['inconclusive','read_failed'].includes(result.code))break;
  }
  return result;
}
module.exports={readCensus,snapshot,visibleState,observeRequests,captureView,viewingJourney,validateConfig};
