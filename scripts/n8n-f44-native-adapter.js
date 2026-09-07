'use strict';
// Offline only. Replace exactly two Submit entry edges; no API or activation.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const card=require('./n8n-native-card-adapter');
const ROOT=path.resolve(__dirname,'..');
const SOURCE_BASE='2fdf2b8a188411d0fbfba776bba7156b496d102b';
const VALIDATORS_SHA='ccb973dfe1e8f4f30a39c3eda323e9a347ed97f92185b9ea96281e316119ffb4';
const ENDPOINT_SOURCE_SHA='c82489a8710a08d0df7a0fd79d904d31e8b3b803876b409241ca8219686a59ad';
const ENDPOINT_MIGRATION_SHA='1faf9a28114124ac5631db4d7561c514e19615ad60806afdd902ba335d484831';
const RAW_GUARD_SHA='e3b60634eb3e2f94308b84087c5472f14fd64fe642a359ddabe1e8ceee49a451';
const ENTRIES={video:{path:'video-form',previous:'F44 Normalize Video'},graphics:{path:'graphic-form',previous:'F44 Normalize Graphics'}};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const edge=node=>({node,type:'main',index:0});
const names=team=>Object.fromEntries(['Preflight','Ready','Forward','Check Response','Respond'].map(role=>[role,'F44 Native '+team+' '+role]));
function preflight(team){
 assert.ok(ENTRIES[team]);assert.equal(hash(card.guard),RAW_GUARD_SHA,'raw_transport_guard_drift');
 let code=card.guard.replaceAll('_nativeReady','_f44Ready').replaceAll('_nativeResponse','_f44Response')
  .replace("outcome: 'refused', reason, conserved: false, error: 'Card creation was not forwarded. Keep the original request for recovery.'","status: 'refused', durable_capture: false, error: reason, error_message: 'Submission was not forwarded. Keep the original request for recovery.'");
 const validation=`const body = item.json.body;
const fields = ['clientName','filmingPlans','notes','title','videos','team','payload_hash','receipt_key','idempotency_key'];
if (!body || typeof body !== 'object' || Array.isArray(body) || fields.some(key => !Object.prototype.hasOwnProperty.call(body,key)) ||
    Object.keys(body).some(key => !fields.includes(key) && key !== 'action') || (body.action !== undefined && body.action !== 'legacy_intake_receive') ||
    body.team !== '${team}' || typeof body.payload_hash !== 'string' || !/^[a-f0-9]{64}$/.test(body.payload_hash) ||
    body.receipt_key !== 'linear-intake-v1:' + body.team + ':' + body.payload_hash || body.idempotency_key !== body.receipt_key ||
    ['clientName','filmingPlans','notes','title'].some(key => typeof body[key] !== 'string') || !Array.isArray(body.videos) || !body.videos.length)
  return refuse('legacy_intake_original_identity_required');
`;
 assert.ok(code.includes('try {'));return code.replace('try {',validation+'try {');
}
function responseCode(team){
 const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
 const validators=html.slice(html.indexOf('    function _linearUuid('),html.indexOf('    function _linearSafeReceiptRef('));
 assert.equal(hash(validators),VALIDATORS_SHA,'browser_response_contract_drift');
 return `${validators}
const unknown = () => [{json:{_f44Response:{status:503,body:{ok:false,status:'unconfirmed',error:'legacy_intake_outcome_unknown',error_message:'Submission could not be confirmed. Keep the original request and receipt key for recovery.'}}}}];
const response = $input.first().json;
let body; try {body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;} catch (_) {return unknown();}
if (!body || typeof body !== 'object' || Array.isArray(body)) return unknown();
const status = response.statusCode;
if (Number.isInteger(status) && status >= 400 && status <= 599) return [{json:{_f44Response:{status,body}}}];
const original = $('${names(team).Preflight}').first().json.body;
if (!original || original.team !== '${team}') return unknown();
const receipt = {team:original.team,payload_hash:original.payload_hash,receipt_key:original.receipt_key,payload:original};
if (!((status === 200 && _linearConfirmedCreate(body,receipt)) || (status === 202 && _linearConfirmedReceived(body,receipt)))) return unknown();
return [{json:{_f44Response:{status,body}}}];`;
}
function validateBinding(binding){
 assert.equal(binding.sourceBase,SOURCE_BASE,'source_base_mismatch');assert.equal(binding.verifiedN8nVersion,card.N8N_VERSION,'n8n_version_mismatch');
 assert.match(binding.captureSha256,/^[a-f0-9]{64}$/);assert.match(binding.expectedActiveVersion,/^[a-f0-9-]{36}$/i);assert.equal(binding.endpointSourceSha256,ENDPOINT_SOURCE_SHA);assert.equal(binding.endpointMigrationSha256,ENDPOINT_MIGRATION_SHA);
 assert.equal(binding.endpointContract,'legacy_intake_receive-v1');assert.equal(binding.browserValidatorsSha256,VALIDATORS_SHA);
 const origin=new URL(binding.destinationOrigin);assert.equal(origin.protocol,'https:');assert.equal(origin.origin,binding.destinationOrigin);assert.equal(origin.username,'');assert.equal(origin.password,'');
 // Reuse the existing public anon transport only, never service-role/staff credentials.
 assert.equal(typeof binding.anonKey,'string');
 if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(binding.anonKey)) {
  const parts=binding.anonKey.split('.');assert.equal(parts.length,3);
  assert.equal(JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')).role,'anon','public_anon_binding_required');
 }
}
function prepare(raw,binding){
 validateBinding(binding);assert.equal(hash(raw),binding.captureSha256,'capture_hash_mismatch');
 const original=JSON.parse(raw),w=structuredClone(original);assert.equal(w.nodes.length,142);assert.equal(w.active,true);
 assert.equal(w.versionId,binding.expectedActiveVersion);assert.equal(w.activeVersionId,binding.expectedActiveVersion);
 assert.deepEqual(w.nodes,w.activeVersion.nodes);assert.deepEqual(w.connections,w.activeVersion.connections);
 const changed=new Set();
 for(const [team,entry]of Object.entries(ENTRIES)){
  const found=w.nodes.filter(n=>n.type==='n8n-nodes-base.webhook'&&n.parameters.path===entry.path);assert.equal(found.length,1);const receive=found[0];
  assert.equal(receive.typeVersion,2.1);assert.equal(receive.parameters.httpMethod,'POST');assert.equal(receive.parameters.responseMode,'responseNode');assert.ok(!receive.parameters.authentication||receive.parameters.authentication==='none');
  assert.equal(receive.parameters.options.rawBody,undefined);assert.deepEqual(w.connections[receive.name],{main:[[edge(entry.previous)]]});
  receive.parameters.options.rawBody=true;changed.add(receive.name);const n=names(team),prefix='f44-native-'+team;
  const additions=[
   {id:prefix+'-preflight-v1',name:n.Preflight,type:'n8n-nodes-base.code',typeVersion:2,position:[0,0],parameters:{jsCode:preflight(team)}},
   {id:prefix+'-ready-v1',name:n.Ready,type:'n8n-nodes-base.if',typeVersion:2.3,position:[224,0],parameters:{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:prefix+'-ready-condition',leftValue:'={{ $json._f44Ready === true }}',rightValue:'',operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}}},
   {id:prefix+'-forward-v1',name:n.Forward,type:'n8n-nodes-base.httpRequest',typeVersion:4.4,position:[448,0],retryOnFail:false,onError:'continueRegularOutput',parameters:{method:'POST',url:new URL('/functions/v1/production-write?action=legacy_intake_receive',binding.destinationOrigin).href,authentication:'none',sendHeaders:true,headerParameters:{parameters:[{name:'apikey',value:binding.anonKey},{name:'Authorization',value:'Bearer '+binding.anonKey}]},sendBody:true,contentType:'binaryData',inputDataFieldName:'data',options:{redirect:{redirect:{followRedirects:false,maxRedirects:0}},response:{response:{fullResponse:true,neverError:true,responseFormat:'text',outputPropertyName:'body'}},timeout:15000}}},
   {id:prefix+'-check-v1',name:n['Check Response'],type:'n8n-nodes-base.code',typeVersion:2,position:[672,0],parameters:{jsCode:responseCode(team)}},
   {id:prefix+'-respond-v1',name:n.Respond,type:'n8n-nodes-base.respondToWebhook',typeVersion:1.5,position:[896,0],parameters:{respondWith:'json',responseBody:'={{ $json._f44Response.body }}',options:{responseCode:'={{ $json._f44Response.status }}',responseHeaders:{entries:[{name:'Access-Control-Allow-Origin',value:'*'},{name:'Cache-Control',value:'no-store'}]}}}},
  ];
  for(const node of additions){assert.equal(w.nodes.some(old=>old.id===node.id||old.name===node.name),false);w.nodes.push(node);}
  Object.assign(w.connections,{[receive.name]:{main:[[edge(n.Preflight)]]},[n.Preflight]:{main:[[edge(n.Ready)]]},[n.Ready]:{main:[[edge(n.Forward)],[edge(n.Respond)]]},[n.Forward]:{main:[[edge(n['Check Response'])]]},[n['Check Response']]:{main:[[edge(n.Respond)]]}});
 }
 for(const old of original.nodes){const actual=structuredClone(w.nodes.find(n=>n.id===old.id));if(changed.has(old.name))delete actual.parameters.options.rawBody;assert.deepEqual(actual,old);}
 for(const [name,value]of Object.entries(original.connections))if(!changed.has(name))assert.deepEqual(w.connections[name],value);
 return {classification:'PRIVATE_OFFLINE_DRAFT_NOT_APPLIED',workflowId:w.id,expectedActiveVersion:binding.expectedActiveVersion,captureSha256:binding.captureSha256,verifiedN8nVersion:binding.verifiedN8nVersion,endpointContract:binding.endpointContract,endpointSourceSha256:binding.endpointSourceSha256,endpointMigrationSha256:binding.endpointMigrationSha256,update:{name:w.name,nodes:w.nodes,connections:w.connections,settings:w.settings},activationAllowed:false};
}
function prepareFiles({bindingPath,outputPath}){
 const bound=card.outsideRepo(bindingPath),binding=JSON.parse(fs.readFileSync(bound,'utf8'));validateBinding(binding);
 assert.ok(path.isAbsolute(outputPath));assert.equal(fs.existsSync(outputPath),false,'new_output_required');const parent=card.outsideRepo(path.dirname(outputPath));
 const raw=fs.readFileSync(card.outsideRepo(binding.capturePath)),draft=prepare(raw,binding),bytes=JSON.stringify(draft,null,2)+'\n';
 const output=path.join(parent,path.basename(outputPath));fs.mkdirSync(output,{mode:0o700});fs.writeFileSync(path.join(output,'f44.draft.json'),bytes,{flag:'wx',mode:0o600});
 const receipt={classification:'PRIVATE_OFFLINE_DRAFT_NOT_APPLIED',sourceBase:SOURCE_BASE,browserValidatorsSha256:VALIDATORS_SHA,endpointSourceSha256:binding.endpointSourceSha256,endpointMigrationSha256:binding.endpointMigrationSha256,bindingSha256:hash(fs.readFileSync(bound)),draftSha256:hash(bytes),workflowEdits:0,workflowExecutions:0};
 fs.writeFileSync(path.join(output,'DRAFT-RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return receipt;
}
module.exports={prepare,prepareFiles,preflight,responseCode,validateBinding,names,ENTRIES,SOURCE_BASE,VALIDATORS_SHA,ENDPOINT_SOURCE_SHA,ENDPOINT_MIGRATION_SHA};
if(require.main===module){try{prepareFiles({bindingPath:process.env.N8N_F44_ADAPTER_BINDING,outputPath:process.env.N8N_F44_ADAPTER_OUTPUT});console.log('Prepared private F44 forwarding draft; no network or activation.');}catch(_){console.error('F44 preparation refused. Check reviewed private captures, endpoint binding and new output directory.');process.exitCode=1;}}
