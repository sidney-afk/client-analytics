'use strict';
// Offline-only graph preparation. Private binding/captures/output stay outside Git.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..');
const SOURCE_BASE='cfb042aca6394edc0f6f9c4ebab928b1e223f806';
const HELPER_SHA='7f3185bba428d18d4f773a9014dffd3bdff49873354b55391f8d72f27a98de74';
const N8N_VERSION='2.37.7';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const SURFACES={calendar:{endpoint:'calendar-upsert',webhook:'calendar-upsert-post',card:'post'},samples:{endpoint:'sample-review-upsert',webhook:'sample-review-upsert',card:'sample'}};
const marker="={{ ['submission-native', 'calendar-native', 'samples-native'].includes($json.headers?.['x-syncview-source']) }}";
const guard=`const item = $input.first();
const refuse = (reason, status = 400) => [{ json: { _nativeReady: false, _nativeResponse: { status, body: { ok: false, outcome: 'refused', reason, conserved: false, error: 'Card creation was not forwarded. Keep the original request for recovery.' } } } }];
const encoding = item.json.headers?.['content-encoding'];
if (encoding && encoding !== 'identity') return refuse('encoding_unsupported');
const contentParts = String(item.json.headers?.['content-type'] || '').split(';').map(value => value.trim());
const contentType = contentParts.shift().toLowerCase();
// n8n's form request converter can re-encode Buffer input. Native creation is JSON.
if (contentType !== 'application/json') return refuse('content_type_unsupported');
if (contentParts.length > 1 || contentParts.some(value =>
    !/^charset\\s*=\\s*(?:"utf-?8"|utf-?8)$/i.test(value))) return refuse('content_type_unsupported');
try {
  const raw = await this.helpers.getBinaryDataBuffer(0, 'data');
  if (!Buffer.isBuffer(raw) || !raw.length) return refuse('raw_body_unavailable');
  if (raw.length > 1048576) return refuse('body_too_large', 413);
  return [{ ...item, json: { ...item.json, _nativeReady: true } }];
} catch (_) { return refuse('raw_body_unavailable'); }`;
function responseCode(surface){
 const shared=fs.readFileSync(path.join(ROOT,'supabase/functions/_shared/native-card-materialization.mjs'),'utf8');
 assert.equal(hash(shared),HELPER_SHA,'native_helper_drift');
 const fields=shared.slice(shared.indexOf('const COMMON_FIELDS'),shared.indexOf('export function nativeCardSource'));
 const checker=shared.slice(shared.indexOf('function completeCurrentRow'),shared.indexOf('export async function materializeNativeCard'));
 assert.ok(fields.includes('const SURFACE_FIELDS')&&checker.includes('return true;'));
 return `const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
${fields}
${checker}
const unknown = () => [{ json: { _nativeResponse: { status: 503, body: { ok: false, outcome: 'unknown', conserved: null, error: 'Card creation could not be confirmed. Keep the original request for recovery.' } } } }];
const response = $input.first().json;
let body;
try { body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body; } catch (_) { return unknown(); }
if (!object(body)) return unknown();
const status = response.statusCode;
if (status === 200) {
  const original = $('Native Card Preflight').first().json.body;
  if (!object(original) || !object(original['${SURFACES[surface].card}']) || body.ok !== true || body.conserved !== true || !['created','replayed'].includes(body.outcome) ||
      !completeCurrentRow(body['${SURFACES[surface].card}'], '${surface}', original.client, original['${SURFACES[surface].card}']?.id, original['${SURFACES[surface].card}'])) return unknown();
  return [{ json: { _nativeResponse: { status, body: { ok: true, conserved: true, outcome: body.outcome, '${SURFACES[surface].card}': body['${SURFACES[surface].card}'] } } } }];
}
const expected = {400:['refused',false],408:['refused',false],413:['refused',false],409:['held',true],503:['unknown',null]}[status];
if (!expected || body.ok !== false || body.outcome !== expected[0] || body.conserved !== expected[1]) return unknown();
// Preserve typed refusal status/conservation, never private/raw error content.
return [{ json: { _nativeResponse: { status, body: { ok: false, outcome: body.outcome, conserved: body.conserved,
  error: body.conserved === true ? 'Card creation is held for operator recovery.' : 'Card creation could not be confirmed. Keep the original request for recovery.' } } } }];`;
}
const edge=(node,index=0)=>({node,type:'main',index});
function ifNode(name,leftValue,id){return {id,name,type:'n8n-nodes-base.if',typeVersion:2.3,position:[224,-300],parameters:{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:id+'-condition',leftValue,rightValue:'',operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}}};}
function prepare(surface,raw,binding){
 validateBinding(binding);
 const pin=binding.workflows[surface],spec=SURFACES[surface];assert.ok(spec,'unsupported_surface');assert.equal(hash(raw),pin.captureSha256,'capture_hash_mismatch');
 const original=JSON.parse(raw),w=structuredClone(original);
 assert.equal(w.activeVersionId,pin.expectedActiveVersion);assert.equal(w.versionId,pin.expectedActiveVersion);assert.equal(w.active,true);assert.equal(w.nodes.length,17);
 assert.deepEqual(w.nodes,w.activeVersion.nodes);assert.deepEqual(w.connections,w.activeVersion.connections);
 const receive=w.nodes.find(n=>n.type==='n8n-nodes-base.webhook');assert.equal(receive.name,'Receive POST');assert.equal(receive.typeVersion,2.1);assert.equal(receive.parameters.responseMode,'responseNode');assert.equal(receive.parameters.httpMethod,'POST');assert.equal(receive.parameters.path,spec.webhook);assert.ok(!receive.parameters.authentication||receive.parameters.authentication==='none','webhook_auth_drift');
 assert.deepEqual(w.connections[receive.name],{main:[[edge('Build Row From Patch')]]});assert.equal(receive.parameters.options.rawBody,undefined);
 receive.parameters.options.rawBody=true;
 const url=new URL('/functions/v1/'+spec.endpoint,binding.destinationOrigin).href;
 const nodes=[
  ifNode('Native Card Marker?',marker,'native-card-marker-v1'),
  {id:'native-card-preflight-v1',name:'Native Card Preflight',type:'n8n-nodes-base.code',typeVersion:2,position:[448,-300],parameters:{jsCode:guard}},
  ifNode('Native Card Ready?','={{ $json._nativeReady === true }}','native-card-ready-v1'),
  {id:'native-card-forward-v1',name:'Forward Native Card',type:'n8n-nodes-base.httpRequest',typeVersion:4.4,position:[896,-300],retryOnFail:false,onError:'continueRegularOutput',parameters:{method:'POST',url,authentication:'none',sendHeaders:true,headerParameters:{parameters:[{name:'X-Syncview-Source',value:"={{ $json.headers['x-syncview-source'] }}"}]},sendBody:true,contentType:'binaryData',inputDataFieldName:'data',options:{redirect:{redirect:{followRedirects:false,maxRedirects:0}},response:{response:{fullResponse:true,neverError:true,responseFormat:'text',outputPropertyName:'body'}},timeout:15000}}},
  {id:'native-card-response-v1',name:'Check Native Response',type:'n8n-nodes-base.code',typeVersion:2,position:[1120,-300],parameters:{jsCode:responseCode(surface)}},
  {id:'native-card-terminal-v1',name:'Respond Native Card',type:'n8n-nodes-base.respondToWebhook',typeVersion:1.5,position:[1344,-300],parameters:{respondWith:'json',responseBody:'={{ $json._nativeResponse.body }}',options:{responseCode:'={{ $json._nativeResponse.status }}',responseHeaders:{entries:[{name:'Access-Control-Allow-Origin',value:'*'},{name:'Cache-Control',value:'no-store'}]}}}}
 ];
 for(const n of nodes)assert.ok(!w.nodes.some(old=>old.id===n.id||old.name===n.name));w.nodes.push(...nodes);
 Object.assign(w.connections,{'Receive POST':{main:[[edge('Native Card Marker?')]]},'Native Card Marker?':{main:[[edge('Native Card Preflight')],[edge('Build Row From Patch')]]},'Native Card Preflight':{main:[[edge('Native Card Ready?')]]},'Native Card Ready?':{main:[[edge('Forward Native Card')],[edge('Respond Native Card')]]},'Forward Native Card':{main:[[edge('Check Native Response')]]},'Check Native Response':{main:[[edge('Respond Native Card')]]}});
 for(const n of original.nodes){const actual=w.nodes.find(x=>x.id===n.id);if(n.id===receive.id){const inverse=structuredClone(actual);delete inverse.parameters.options.rawBody;assert.deepEqual(inverse,n);}else assert.deepEqual(actual,n);}
 for(const [name,connections]of Object.entries(original.connections))if(name!=='Receive POST')assert.deepEqual(w.connections[name],connections);
 return {classification:'PRIVATE_OFFLINE_DRAFT_NOT_APPLIED',workflowId:w.id,expectedActiveVersion:pin.expectedActiveVersion,captureSha256:pin.captureSha256,verifiedN8nVersion:N8N_VERSION,update:{name:w.name,nodes:w.nodes,connections:w.connections,settings:w.settings},activationAllowed:false};
}

// Trusted private binding is explicit; no request contents can select a destination.
function validateBinding(binding){
 assert.ok(binding&&typeof binding==='object','binding_required');
 assert.equal(binding.sourceBase,SOURCE_BASE,'source_base_mismatch');
 assert.equal(binding.helperSha256,HELPER_SHA,'helper_binding_mismatch');
 assert.equal(binding.verifiedN8nVersion,N8N_VERSION,'n8n_version_mismatch');
 const origin=new URL(binding.destinationOrigin);
 assert.equal(origin.protocol,'https:','https_required');
 assert.equal(origin.origin,binding.destinationOrigin,'exact_origin_required');
 assert.equal(origin.username,'');assert.equal(origin.password,'');
 assert.deepEqual(Object.keys(binding.workflows).sort(),Object.keys(SURFACES).sort(),'two_surfaces_required');
 for(const pin of Object.values(binding.workflows)){
  assert.match(pin.captureSha256,/^[a-f0-9]{64}$/,'capture_hash_required');
  assert.match(pin.expectedActiveVersion,/^[a-f0-9-]{36}$/i,'active_version_required');
 }
}
function outsideRepo(candidate,root=ROOT){
 assert.ok(typeof candidate==='string'&&path.isAbsolute(candidate),'absolute_private_path_required');
 const actual=fs.realpathSync(candidate),base=fs.realpathSync(root);
 const relative=path.relative(base,actual);
 assert.ok(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'private_path_inside_repo');
 let ancestor=fs.statSync(actual).isDirectory()?actual:path.dirname(actual);
 for(;;){assert.equal(fs.existsSync(path.join(ancestor,'.git')),false,'private_path_inside_git');const parent=path.dirname(ancestor);if(parent===ancestor)break;ancestor=parent;}
 return actual;
}
function prepareFiles({bindingPath,outputPath}){
 const bound=outsideRepo(bindingPath),binding=JSON.parse(fs.readFileSync(bound,'utf8'));validateBinding(binding);
 assert.ok(path.isAbsolute(outputPath),'absolute_output_required');
 assert.equal(fs.existsSync(outputPath),false,'new_output_required');
 const parent=outsideRepo(path.dirname(outputPath));
 const output=path.join(parent,path.basename(outputPath));
 const drafts=Object.fromEntries(Object.keys(SURFACES).map(surface=>{
  const capture=outsideRepo(binding.workflows[surface].capturePath);
  return [surface,prepare(surface,fs.readFileSync(capture),binding)];
 }));
 // Validate both captures and all generated bytes before creating output.
 fs.mkdirSync(output,{mode:0o700});
 const files=[];
 for(const [surface,draft]of Object.entries(drafts)){
  const file=surface+'.draft.json',bytes=JSON.stringify(draft,null,2)+'\n';
  fs.writeFileSync(path.join(output,file),bytes,{flag:'wx',mode:0o600});files.push({file,sha256:hash(bytes)});
 }
 const receipt={classification:'PRIVATE_OFFLINE_DRAFT_NOT_APPLIED',sourceBase:SOURCE_BASE,helperSha256:HELPER_SHA,n8nVersion:N8N_VERSION,bindingSha256:hash(fs.readFileSync(bound)),files,workflowEdits:0,workflowExecutions:0};
 fs.writeFileSync(path.join(output,'DRAFT-RECEIPT.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
 return receipt;
}
module.exports={prepare,prepareFiles,validateBinding,outsideRepo,guard,responseCode,marker,SURFACES,SOURCE_BASE,HELPER_SHA,N8N_VERSION};
if(require.main===module){try{prepareFiles({bindingPath:process.env.N8N_CARD_ADAPTER_BINDING,outputPath:process.env.N8N_CARD_ADAPTER_OUTPUT});console.log('Prepared two private offline drafts; no network or activation.');}catch(_error){console.error('Private CARD adapter preparation refused. Check the reviewed binding, captures, source pins and new private output directory.');process.exitCode=1;}}
