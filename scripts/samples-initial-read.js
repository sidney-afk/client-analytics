'use strict';
const {captureDetails}=require('./client-continuity-view');
const {SAFETY_OUTCOMES,DENIAL_REASONS}=require('./client-continuity-transport');
const CONTRACT='samples_initial_card_list_v1';
const CODES=Object.freeze(['initial_read_verified','canary_required','safety_failed','auth_failed','browser_error',
  'read_failed','false_empty','scope_mismatch','render_failed','stale_content','inconclusive','integration_missing',
  'monitor_missing','terminal_missing','recovered','inactive']);
const LABELS=Object.freeze(['samples_rows','sample_flags','routing_flags','settings_flags','templates']);
function check(ok){if(!ok)throw Error('initial_read_contract_refused');}
function assess(detail) {
  const s=detail?.safety,p=detail?.proof,read=detail?.read,full=detail?.full;
  let code='integration_missing';
  if(s?.setupComplete!==true||s.teardownComplete!==true)code='safety_failed';
  else if(!Array.isArray(s.outcomes)||s.outcomes.some(c=>!SAFETY_OUTCOMES.includes(c)))code='safety_failed';
  else if(s.outcomes.includes('valid_link_auth'))code='auth_failed';
  else if(s.outcomes.includes('scope_mismatch'))code='scope_mismatch';
  else if(read?.code==='false_empty')code='false_empty';
  else if(s.outcomes.includes('browser_error'))code='browser_error';
  else if(s.outcomes.some(c=>c!=='mutation_blocked'))code=s.outcomes.includes('read_failed')?'read_failed':'safety_failed';
  else {
    const sub=s.subscriptions,reasons=detail.denialReasons;
    const attribution=sub&&['known','unknown','matched','unmatched','realtimeDenied','realmRealtimeEvents'].every(k=>Number.isSafeInteger(sub[k])&&sub[k]>=0)&&
      sub.known>0&&sub.unknown===0&&sub.matched>0&&sub.unmatched===0&&sub.matched===sub.realtimeDenied&&sub.matched===sub.realmRealtimeEvents&&
      Array.isArray(sub.labels)&&sub.labels.includes('samples_rows')&&sub.labels.every(l=>LABELS.includes(l));
    if(!s.outcomes.includes('mutation_blocked')||!attribution||!Array.isArray(reasons)||reasons.length!==1||reasons[0]!=='realtime_transport_blocked'||full?.code!=='mutation_blocked'||full.ok!==false)code='safety_failed';
    else if(p?.principalVerified!==true)code='auth_failed';
    else if(p.primaryComplete!==true)code='read_failed';
    else if(p.sdkMatched!==true)code='integration_missing';
    else if(p.stableDom!==true)code='inconclusive';
    else if(p.authoritativeEmpty===true||!Number.isSafeInteger(p.canaryCount)||p.canaryCount<1)code='canary_required';
    else if(read?.code!=='healthy')code=['scope_mismatch','render_failed','inconclusive'].includes(read?.code)?read.code:['stale_unwarned','stale_overdue'].includes(read?.code)?'stale_content':'read_failed';
    else code=Number.isSafeInteger(read.count)&&read.count>=p.canaryCount?'initial_read_verified':'render_failed';
  }
  return {version:1,contract:CONTRACT,lane:'samples_initial_read',code,ok:code==='initial_read_verified',count:code==='initial_read_verified'?read.count:0,
    fullContinuity:{code:full?.code||'read_failed',ok:full?.ok===true},
    authoritativeEmptyObserved:p?.authoritativeEmpty===true,safety:s,denialReasons:detail?.denialReasons||[],
    evidence:{proof:p,read:{code:read?.code||'read_failed',count:read?.count||0},full:{code:full?.code||'read_failed',ok:full?.ok===true}}};
}
async function captureInitialRead(browser,config,deps) {
  check(config?.lane==='samples'&&config.initialRead===true&&/^[a-f0-9]{64}$/.test(config.expectedPageSha256||'')&&/^[a-f0-9]{64}$/.test(config.expectedSdkSha256||''));
  // One initial read only. A fresh later run is separate evidence; no transient
  // retry or recovery can erase an earlier safety outcome within this run.
  return assess(await captureDetails(browser,config,deps));
}
function validateReceipt(value) {
  check(value?.version===1&&value.contract===CONTRACT&&value.lane==='samples_initial_read'&&CODES.includes(value.code)&&
    !['recovered','monitor_missing','terminal_missing','inactive'].includes(value.code)&&Number.isSafeInteger(value.count)&&value.count>=0);
  const s=value.safety,p=value.evidence?.proof;
  check(s?.version===1&&typeof s.setupComplete==='boolean'&&typeof s.teardownComplete==='boolean'&&
    Array.isArray(s.outcomes)&&s.outcomes.every(c=>SAFETY_OUTCOMES.includes(c))&&Object.keys(s).every(k=>['version','setupComplete','teardownComplete','outcomes','subscriptions'].includes(k)));
  if(s.subscriptions)check(Object.keys(s.subscriptions).every(k=>['known','unknown','matched','unmatched','realtimeDenied','realmRealtimeEvents','labels'].includes(k))&&
    ['known','unknown','matched','unmatched','realtimeDenied','realmRealtimeEvents'].every(k=>Number.isSafeInteger(s.subscriptions[k])&&s.subscriptions[k]>=0)&&
    Array.isArray(s.subscriptions.labels)&&s.subscriptions.labels.every(l=>LABELS.includes(l)));
  check(p&&Object.keys(p).every(k=>['stableDom','authoritativeEmpty','canaryCount','principalVerified','primaryComplete','sdkMatched'].includes(k))&&
    ['stableDom','authoritativeEmpty','principalVerified','primaryComplete','sdkMatched'].every(k=>typeof p[k]==='boolean')&&Number.isSafeInteger(p.canaryCount)&&p.canaryCount>=0);
  require('./client-continuity-monitor').report('samples',value.evidence?.read?.code,value.evidence?.read?.count);
  require('./client-continuity-monitor').report('samples',value.evidence?.full?.code);
  check(typeof value.evidence?.full?.ok==='boolean');
  check(Array.isArray(value.denialReasons)&&value.denialReasons.every(r=>DENIAL_REASONS.includes(r)));
  const safe=assess({proof:p,read:{code:value.evidence.read.code,count:value.evidence.read.count},full:{code:value.evidence.full.code,ok:value.evidence.full.ok===true},safety:s,denialReasons:value.denialReasons});
  check(value.code===safe.code&&value.ok===safe.ok&&value.count===safe.count&&
    value.fullContinuity?.code===safe.fullContinuity.code&&value.fullContinuity?.ok===safe.fullContinuity.ok);
  // A terminal is a closed aggregate attestation, never arbitrary caller text.
  check(JSON.stringify(value.safety)===JSON.stringify(safe.safety));
  return safe;
}
function alertResult(code,count=0) {
  check(CODES.includes(code)&&Number.isSafeInteger(count)&&count>=0);
  return {version:1,contract:CONTRACT,lane:'samples_initial_read',code,count,ok:['initial_read_verified','recovered'].includes(code)};
}
function alertPayload(value,id,drill=false) {
  const safe=alertResult(value.code,value.count);
  check(value.contract===CONTRACT&&value.lane===safe.lane&&value.ok===safe.ok);
  return require('./monitoring-alert-relay').relayPayload({type:drill?'samples_initial_card_list_DRILL':CONTRACT,
    summaryParts:[...(drill?['DRILL']:[]),'INITIAL_READ_ONLY',safe.code,'FULL_JOURNEY_UNPROVEN'],team:'client_surfaces',count:safe.count,runId:id});
}
module.exports={CONTRACT,CODES,LABELS,assess,captureInitialRead,validateReceipt,alertResult,alertPayload};
