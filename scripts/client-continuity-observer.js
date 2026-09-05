'use strict';
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {report,assessLiveness}=require('./client-continuity-monitor');
const LANES=['calendar','samples'];
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function requireValue(ok){if(!ok)throw new Error('observer_input_refused');}
function receipts(directory,sha,now=Date.now()) {
  const result=[];
  for(const name of fs.readdirSync(directory)) {
    if(!/^(calendar|samples)-[a-f0-9-]+\.(start|terminal)\.json$/.test(name))continue;
    const file=path.join(directory,name);requireValue(fs.lstatSync(file).isFile()&&fs.statSync(file).size<16384);
    const value=JSON.parse(fs.readFileSync(file,'utf8'));
    requireValue(value.version===1&&value.releaseSha===sha&&UUID.test(value.runId)&&LANES.includes(value.lane)&&
      Number.isFinite(value.startedAt)&&value.startedAt<=now&&value.startedAt>0);
    const kind=name.endsWith('.terminal.json')?'terminal':'start';
    requireValue(name===`${value.lane}-${value.runId}.${kind}.json`);
    const clean={version:1,releaseSha:sha,lane:value.lane,runId:value.runId,startedAt:value.startedAt};
    if(['pageSourceSha','pageBlobSha','pageSha256'].some(key=>key in value)) {
      requireValue(/^[a-f0-9]{40}$/.test(value.pageSourceSha)&&/^[a-f0-9]{40}$/.test(value.pageBlobSha)&&/^[a-f0-9]{64}$/.test(value.pageSha256));
      Object.assign(clean,{pageSourceSha:value.pageSourceSha,pageBlobSha:value.pageBlobSha,pageSha256:value.pageSha256});
    }
    if(kind==='terminal') {
      requireValue(Number.isFinite(value.finishedAt)&&value.finishedAt>=value.startedAt&&value.finishedAt<=now);
      Object.assign(clean,report(value.lane,value.code,value.count),{finishedAt:value.finishedAt});
    }
    result.push(clean);
  }
  return result;
}
function evaluate(records,activatedAt,now=Date.now()) {
  requireValue(Number.isFinite(activatedAt)&&activatedAt>0&&activatedAt<=now);
  return LANES.map(lane=>{
    const items=records.filter(r=>r.lane===lane),starts=items.filter(r=>!('finishedAt' in r)),ends=items.filter(r=>'finishedAt' in r);
    const ids=new Set();for(const r of starts){requireValue(!ids.has(r.runId));ids.add(r.runId);}
    const endIds=new Set();for(const end of ends){requireValue(!endIds.has(end.runId)&&starts.some(s=>s.runId===end.runId&&s.startedAt===end.startedAt&&['pageSourceSha','pageBlobSha','pageSha256'].every(k=>s[k]===end[k])));endIds.add(end.runId);}
    const orphan=starts.find(s=>now-s.startedAt>=120000&&!ends.some(e=>e.runId===s.runId));
    if(orphan)return report(lane,'terminal_missing');
    const terminal=ends.sort((a,b)=>b.finishedAt-a.finishedAt)[0];
    return assessLiveness({lane,enabled:true,activatedAt,lastStartedAt:Math.max(0,...starts.map(s=>s.startedAt)),terminal},now);
  });
}
function validateState(value,sha) {
  requireValue(value?.version===1&&value.releaseSha===sha&&value.lanes&&typeof value.lanes==='object');
  const clean={version:1,releaseSha:sha,lanes:{}};
  for(const lane of LANES) {
    const item=value.lanes[lane];if(!item)continue;
    requireValue(['prepared','attempted','confirmed'].includes(item.status)&&UUID.test(item.id)&&Number.isFinite(item.openedAt));
    clean.lanes[lane]={id:item.id,status:item.status,openedAt:item.openedAt,result:report(lane,item.result.code,item.result.count)};
  }
  return clean;
}
async function observe(results,previous,{sha,persist,send,deliveryEnabled=false,now=Date.now()}) {
  const state=previous?validateState(previous,sha):{version:1,releaseSha:sha,lanes:{}};
  for(const result of results) {
    const safe=report(result.lane,result.code,result.count);requireValue(LANES.includes(safe.lane));
    let event=state.lanes[safe.lane];
    // A previously ambiguous POST gets read-only reconciliation, never blind
    // retry. Preserve it through a later recovery until delivery is resolved.
    if(event?.status==='attempted'&&deliveryEnabled) {
      const receipt=await send(event.result,event.id,{reconcileOnly:true});
      if(receipt.delivered)event.status='confirmed';
      await persist(state);
    }
    if(event?.status==='attempted')continue;
    const code=safe.ok?'recovered':safe.code;
    if(!event&&safe.ok)continue;
    if(event?.result.code===code&&event.status==='confirmed')continue;
    if(!event||event.result.code!==code) {
      event={id:randomUUID(),openedAt:now,status:'prepared',result:report(safe.lane,code,safe.count)};
      state.lanes[safe.lane]=event;await persist(state);
    }
    if(deliveryEnabled) {
      event.status='attempted';await persist(state); // durable intent before POST
      const receipt=await send(event.result,event.id,{reconcileOnly:false});
      if(receipt.delivered)event.status='confirmed';
      await persist(state);
    }
  }
  return {state,pendingDelivery:LANES.some(l=>state.lanes[l]?.status==='attempted')};
}
module.exports={receipts,evaluate,observe,validateState};
