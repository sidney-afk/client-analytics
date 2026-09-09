'use strict';
/* SQL owns every mutation. This module validates the bounded RPC protocol,
 * pages it without a repeat cursor, and emits no identifiers by itself. */
const crypto = require('crypto');
const STAGE_KEYS = Object.freeze({ children: ['recovered','complete','conflict','unresolved','planned'], cards: ['materialized','complete','conflict','unresolved','planned'] });
const REASON_CODES = Object.freeze(new Set([
  'provider_epoch_child_missing','child_identity_conflict','child_receipt_without_row','child_terminal_receipt_missing',
  'batch_missing','batch_not_active','client_inactive','parent_receipt_missing','parent_receipt_provenance_mismatch','f27_hold','children_incomplete',
  'deliverable_card_cleared','deliverable_rebound','card_archived','card_slot_occupied','card_deleted_after_creation','card_provenance_unavailable',
  'card_creation_held','card_slot_cleared','card_missing_under_lock','reconcile_child_identity_changed','reconcile_readback_mismatch',
  'authority_unavailable','team_is_linear_authoritative','legacy_parity_gate_unavailable','legacy_parity_not_allowed','test_client_scope_required',
  'idempotency_conflict','write_conflict','idempotent_result_missing','project_mapping_missing','team_rollback_hold','f27_authority_generation_stale',
  'f27_drill_insert_forbidden','invalid_outbound_entity','invalid_outbound_operation','incomplete_outbound_intent','invalid_f27_authority_binder',
  'production_deliverable_id_required','production_write_dedup_and_intent_fingerprint_required',
]));
const OUTCOMES = Object.freeze(new Set(['recovered','materialized','complete','conflict','unresolved','planned','skipped']));
const OWNERS = Object.freeze(new Set(['operator','reconciler','gateway-retry']));
const SURFACES = Object.freeze(new Set(['calendar','samples']));
const SUMMARY_COUNT_KEYS = Object.freeze(['manifests','requests_complete','requests_owed','backlog_age_seconds']);
const OWED_COUNT_KEYS = Object.freeze(['children_native','children_provider','cards','identity_conflicts','missing_terminal_receipts']);
function protocolError(stage) { const e = new Error('reconcile_protocol_' + stage); e.publicCode = 'reconcile_protocol_' + stage; return e; }
function finiteCount(value) { return Number.isInteger(value) && value >= 0; }
function boundedString(value) { return typeof value === 'string' && value.length > 0 && value.length <= 512; }
function boundReason(reason) { const value = String(reason == null ? '' : reason); return REASON_CODES.has(value) || /^sql_error:[0-9A-Z]{5}$/.test(value) ? value : 'other'; }
function boundOutcome(outcome) { const value = String(outcome == null ? '' : outcome); return OUTCOMES.has(value) ? value : 'other'; }
function boundOwner(owner) { const value = String(owner == null ? '' : owner); return OWNERS.has(value) ? value : 'other'; }
function boundSurface(surface) { const value = String(surface == null ? '' : surface); return SURFACES.has(value) ? value : 'other'; }
function count(value) { return Number(value); }
function validateSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary) || !summary.owed || typeof summary.owed !== 'object' || Array.isArray(summary.owed)
      || !summary.latest_outcomes || typeof summary.latest_outcomes !== 'object' || Array.isArray(summary.latest_outcomes)) throw protocolError('summary');
  for (const key of SUMMARY_COUNT_KEYS) if (!finiteCount(summary[key])) throw protocolError('summary');
  for (const key of OWED_COUNT_KEYS) if (!finiteCount(summary.owed[key])) throw protocolError('summary');
  if (summary.requests_complete + summary.requests_owed !== summary.manifests
      || (summary.requests_owed === 0 && summary.backlog_age_seconds !== 0)) throw protocolError('summary');
  if (typeof summary.observed_at !== 'string' || !Number.isFinite(Date.parse(summary.observed_at))) throw protocolError('summary');
  for (const value of Object.values(summary.latest_outcomes)) if (!finiteCount(value)) throw protocolError('summary');
  return summary;
}
function validateBacklog(page) {
  if (!page || typeof page !== 'object' || Array.isArray(page) || !Array.isArray(page.items) || typeof page.exhausted !== 'boolean' || !finiteCount(page.examined)
      || !(page.next_after === null || typeof page.next_after === 'string')) throw protocolError('backlog');
  for (const item of page.items) if (!item || typeof item !== 'object' || !boundedString(item.request_id) || !SURFACES.has(item.surface)) throw protocolError('backlog');
  return page;
}
function validateStage(stage, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !OUTCOMES.has(result.outcome) || !boundedString(result.request_id)) throw protocolError(stage);
  return result;
}
function emptyCounts() { const out={}; for(const [stage,keys] of Object.entries(STAGE_KEYS)){out[stage]=Object.fromEntries(keys.map(key=>[key,0]));out[stage].calls=0;out[stage].skipped=0;} out.children.recovered_children=0;out.cards.created_cards=0;out.cards.bound_cards=0;return out; }
function tally(counts,stage,result) { counts[stage].calls++; const outcome=String(result.outcome||'');if(Object.prototype.hasOwnProperty.call(counts[stage],outcome))counts[stage][outcome]++;if(stage==='children')counts.children.recovered_children+=Array.isArray(result.recovered)?result.recovered.length:0;if(stage==='cards'){counts.cards.created_cards+=Array.isArray(result.created)?result.created.length:0;counts.cards.bound_cards+=Array.isArray(result.bound)?result.bound.length:0;} }
function cardsEligible(children) { return !!children && (children.outcome==='recovered'||children.outcome==='complete'); }
async function runReconcile(options) {
  if (typeof options.rpc !== 'function') throw new Error('rpc transport required');
  const actor=String(options.actor||'').trim();if(!actor)throw new Error('actor required');
  const apply=options.apply===true, limit=Math.max(1,Math.min(500,Number(options.limit)||25)),pageSize=Math.max(1,Math.min(500,Number(options.pageSize)||50));
  const only=Array.isArray(options.requestIds)&&options.requestIds.length?new Set(options.requestIds.map(String)):null,onEvent=typeof options.onEvent==='function'?options.onEvent:()=>{};
  const counts=emptyCounts(),processed=[],seenCursors=new Set();let after=null,examined=0,exhausted=false,pages=0,limited=false;
  while(!exhausted&&processed.length<limit){
    const page=validateBacklog(await options.rpc('production_intake_reconcile_backlog',{p_limit:pageSize,p_after:after})); pages++; examined+=page.examined;
    for(let index=0;index<page.items.length;index++){
      if(processed.length>=limit){limited=true;break;}
      const item=page.items[index],requestId=item.request_id;if(only&&!only.has(requestId))continue;
      const entry={request_id:requestId,client_slug:item.client_slug,surface:item.surface,owed:item.owed};
      entry.children=validateStage('children',await options.rpc('production_intake_reconcile_children',{p_request_id:requestId,p_actor:actor,p_apply:apply}));tally(counts,'children',entry.children);onEvent('children',entry);
      if(cardsEligible(entry.children)){entry.cards=validateStage('cards',await options.rpc('production_intake_reconcile_cards',{p_request_id:requestId,p_actor:actor,p_apply:apply}));tally(counts,'cards',entry.cards);}else{entry.cards={stage:'cards',request_id:requestId,applied:false,outcome:'skipped',reason:'children_incomplete'};counts.cards.skipped++;}onEvent('cards',entry);processed.push(entry);
    }
    if(limited) break;
    exhausted=page.exhausted;
    if(!exhausted){const next=page.next_after;if(!boundedString(next)||next===after||seenCursors.has(next))throw protocolError('backlog_cursor');seenCursors.add(next);after=next;}
  }
  const summary=validateSummary(await options.rpc('production_intake_reconcile_summary',{}));
  return {dry_run:!apply,actor,limit,pages,examined,exhausted,limited,processed,counts,summary,attention:{conflicted:counts.children.conflict+counts.cards.conflict,unresolved:counts.children.unresolved+counts.cards.unresolved,backlog_age_seconds:summary.backlog_age_seconds,missing_terminal_receipts:summary.owed.missing_terminal_receipts}};
}
function correlation(requestId,hashKey){return hashKey?crypto.createHmac('sha256',String(hashKey)).update(String(requestId)).digest('hex').slice(0,12):null;}
function reasonCodes(result){const codes=[];for(const list of [result&&result.unresolved,result&&result.conflicts])if(Array.isArray(list))for(const entry of list)codes.push({reason:boundReason(entry&&entry.reason),owner:boundOwner(entry&&entry.owner)});if(result&&result.outcome==='skipped')codes.push({reason:boundReason(result.reason),owner:'reconciler'});return codes;}
function publicSummary(summary){validateSummary(summary);const latest={};for(const [key,n] of Object.entries(summary.latest_outcomes)){const [stage,outcome]=String(key).split(':');const label=(stage==='children'||stage==='cards'?stage:'other')+':'+boundOutcome(outcome);latest[label]=(latest[label]||0)+n;}return {manifests:summary.manifests,requests_complete:summary.requests_complete,requests_owed:summary.requests_owed,owed:Object.fromEntries(OWED_COUNT_KEYS.map(key=>[key,summary.owed[key]])),backlog_age_seconds:summary.backlog_age_seconds,latest_outcomes:latest};}
function publicReport(report,options={}){if(!report||!Array.isArray(report.processed)||!report.counts)throw protocolError('report');const hashKey=options.hashKey?String(options.hashKey):'',reasons={children:{},cards:{}},requests=[];for(const entry of report.processed){const row={surface:boundSurface(entry.surface)};for(const stage of ['children','cards']){const result=entry[stage]||{};row[stage]=boundOutcome(result.outcome);const codes=reasonCodes(result);row[stage+'_reasons']=codes.map(c=>c.reason);for(const code of codes)reasons[stage][code.reason]=(reasons[stage][code.reason]||0)+1;}if(hashKey)requests.push({correlation:correlation(entry.request_id,hashKey),...row});}return {dry_run:report.dry_run===true,limit:finiteCount(report.limit)?report.limit:0,pages:finiteCount(report.pages)?report.pages:0,examined:finiteCount(report.examined)?report.examined:0,exhausted:report.exhausted===true,limited:report.limited===true,processed_count:report.processed.length,counts:report.counts,reasons,attention:report.attention,summary:publicSummary(report.summary),correlated:!!hashKey,...(hashKey?{requests}:{})};}
function assessSummary(summary,limits={}) { const s=publicSummary(summary), max=(name,fallback)=>limits[name]===undefined?fallback:limits[name]; const bad=[]; if(s.owed.missing_terminal_receipts>max('maxMissingTerminalReceipts',0))bad.push('missing_terminal_receipts');if(s.owed.identity_conflicts>max('maxIdentityConflicts',0))bad.push('identity_conflicts');if(Number.isFinite(max('maxBacklogAgeSeconds',Infinity))&&s.backlog_age_seconds>max('maxBacklogAgeSeconds',Infinity))bad.push('backlog_age');if(Number.isFinite(max('maxRequestsOwed',Infinity))&&s.requests_owed>max('maxRequestsOwed',Infinity))bad.push('requests_owed');return {ok:bad.length===0,failures:bad,summary:s}; }
module.exports={runReconcile,publicReport,publicSummary,assessSummary,validateSummary,validateBacklog,boundReason,boundOutcome,boundOwner,correlation,cardsEligible,emptyCounts,STAGE_KEYS,REASON_CODES};
