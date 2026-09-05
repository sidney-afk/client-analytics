'use strict';
const {formatAlert}=require('./client-continuity-monitor');
const {postAlert,confirmRelayDelivery,relayPayload}=require('./monitoring-alert-relay');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function requireValue(ok){if(!ok)throw new Error('delivery_config_refused');}
function reference(env,key){requireValue(typeof key==='string'&&/^[A-Z][A-Z0-9_]+$/.test(key)&&!!env[key]);return env[key];}
function payloadFor(result,id,drill=false,contract){
  if(contract!==undefined){const initial=require('./samples-initial-read');requireValue(contract===initial.CONTRACT);return initial.alertPayload(result,id,drill);}
  formatAlert(result,id);return relayPayload({type:drill?'client_continuity_DRILL':'client_continuity',summaryParts:[...(drill?['DRILL']:[]),result.lane,result.code],team:'client_surfaces',count:result.count,runId:id});
}
function textFor(result,id,drill=false,contract){const p=payloadFor(result,id,drill,contract);return `[SyncView] ${p.issue_identifier} count=${p.count} run_id=${id}`;}
async function slack(method,params,token,fetchImpl) {
  const write=method==='chat.postMessage',url=new URL('https://slack.com/api/'+method);
  if(!write)for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
  const response=await fetchImpl(url.href,{method:write?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(5000),
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(write?{body:JSON.stringify(params)}:{})});
  requireValue(response.ok);const value=await response.json();requireValue(value.ok===true);return value;
}
async function botRoute(result,id,config,env,fetchImpl,{reconcileOnly=false,drill=false,contract}={}) {
  const token=reference(env,config.tokenEnv),channel=reference(env,config.dmEnv);
  const bot=reference(env,config.botUserEnv),owner=reference(env,config.ownerUserEnv),team=reference(env,config.teamEnv);
  // Verify the existing bot/account and exact existing owner DM; never open a
  // conversation, guess a user, rename a bot, or accept a workspace channel.
  const auth=await slack('auth.test',{},token,fetchImpl);
  requireValue(auth.user_id===bot && auth.team_id===team);
  const info=await slack('conversations.info',{channel},token,fetchImpl);
  requireValue(info.channel?.id===channel && info.channel.is_im===true && info.channel.user===owner);
  const text=textFor(result,id,drill,contract);
  let ts;
  if(!reconcileOnly) {
    const receipt=await slack('chat.postMessage',{channel,text,mrkdwn:false,unfurl_links:false,unfurl_media:false},token,fetchImpl);
    requireValue(receipt.channel===channel && typeof receipt.ts==='string');ts=receipt.ts;
  }
  const history=await slack('conversations.history',{channel,limit:15,...(ts?{latest:ts,inclusive:true}:{})},token,fetchImpl);
  // Missing scopes, rate limits and absent readback stay unknown. No POST retry.
  return Array.isArray(history.messages) && history.messages.some(m=>m.user===bot && m.text===text && (!ts || m.ts===ts));
}
async function relayRoute(result,id,config,env,fetchImpl,{reconcileOnly=false,drill=false,contract,sleepImpl=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  const webhook=reference(env,config.webhookEnv),baseUrl=reference(env,config.baseUrlEnv),apiKey=reference(env,config.apiKeyEnv);
  requireValue(new URL(webhook).protocol==='https:' && new URL(baseUrl).protocol==='https:');
  const payload=payloadFor(result,id,drill,contract),deadline=Date.now()+25000;
  const timed=(url,init)=>{requireValue(Date.now()<deadline);return fetchImpl(url,{...init,redirect:'error',signal:AbortSignal.timeout(Math.min(5000,deadline-Date.now()))});};
  if(!reconcileOnly)await postAlert(payload,{webhook,fetchImpl:timed,attempts:1});
  const receipt=await confirmRelayDelivery({runId:id,type:payload.type,apiKey,baseUrl,fetchImpl:timed,attempts:20,
    sleepImpl:ms=>sleepImpl(Math.min(ms,Math.max(0,deadline-Date.now())))});
  return receipt.confirmed===true;
}
async function deliver(result,id,config,env=process.env,fetchImpl=fetch,options={}) {
  requireValue(config?.enabled===true && config.activation==='OWNER_APPROVED_CONTINUITY_DELIVERY' &&
    config.recipientConfirmed===true && UUID.test(id));
  payloadFor(result,id,options.drill,options.contract); // reject unknown/free-text fields before any I/O
  let primaryDelivered=false,fallbackDelivered=false;
  const send=route=>{
    requireValue(route && ['relay','syncviewbot'].includes(route.kind));
    return (route.kind==='relay'?relayRoute:botRoute)(result,id,route,env,fetchImpl,options);
  };
  try{primaryDelivered=await send(config.primary);}catch{}
  if(!primaryDelivered && config.fallback)try{fallbackDelivered=await send(config.fallback);}catch{}
  return {version:1,runId:id,primaryDelivered,fallbackDelivered,delivered:primaryDelivered||fallbackDelivered,
    primaryEvidence:primaryDelivered?(config.primary.kind==='relay'?'relay_terminal_success':'slack_message_readback'):'unconfirmed',
    fallbackEvidence:fallbackDelivered?(config.fallback.kind==='relay'?'relay_terminal_success':'slack_message_readback'):'unconfirmed',
    recipientReadbackProven:(primaryDelivered&&config.primary.kind==='syncviewbot')||(fallbackDelivered&&config.fallback?.kind==='syncviewbot')||false,
    acknowledged:false,fallbackConfigured:!!config.fallback,
    independentFallbackProven:false,readiness:'delivery_only'};
}
module.exports={deliver,reference,textFor,payloadFor};
