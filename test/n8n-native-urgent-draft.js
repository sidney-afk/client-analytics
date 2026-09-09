'use strict';
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {SOURCE_BASE,hash,verifyEnvelope,chooseRecipient,prepare}=require('../scripts/n8n-native-urgent-draft');
let groups=0;function pass(name,fn){fn();groups++;console.log('ok '+name);}
const now=1800000000,id='10000000-0000-4000-8000-000000000001';
const body={contract:'native_urgent_video_v1',audience:'syncview:n8n:native-urgent-video:v1',dispatch_id:id,issued_at:now,expires_at:now+60,context:{deliverable_id:'native-video',client_slug:'fixture',client_name:'Fixture',card_id:'card',surface:'calendar',team:'video',video_status_at:'2026-09-07T00:00:00.000Z',assignee_id:'member',assignee_email:'editor@example.invalid',assignee_name:'Editor',title:'Post',actor_member_id:'actor'}};
function packageBody(b=body){const raw=Buffer.from(JSON.stringify(b)),claims={purpose:'native-urgent-handoff-v1',aud:b.audience,jti:b.dispatch_id,iat:b.issued_at,exp:b.expires_at,body_sha256:hash(raw)};return{raw,claims};}
const original=packageBody();
pass('exact signed-body claims accepted',()=>assert.deepEqual(verifyEnvelope(original.raw,original.claims,now,hash),body));
for(const [name,change] of [['purpose',c=>c.purpose='other'],['audience',c=>c.aud='other'],['dispatch',c=>c.jti='bad'],['expiry',c=>c.exp=now-1],['future',c=>{c.iat=now+6;c.exp=c.iat+60;}],['ttl',c=>c.exp++],['digest',c=>c.body_sha256='0'.repeat(64)],['extra claim',c=>c.editor='spoof']]){
 pass('reject '+name,()=>{const claims=structuredClone(original.claims);change(claims);assert.throws(()=>verifyEnvelope(original.raw,claims,now,hash));});
}
pass('missing authenticated jwtPayload refused',()=>assert.throws(()=>verifyEnvelope(original.raw,undefined,now,hash)));
pass('exact expiry boundary refused',()=>assert.throws(()=>verifyEnvelope(original.raw,original.claims,now+60,hash)));
pass('exact bytes bound including whitespace',()=>assert.throws(()=>verifyEnvelope(Buffer.concat([original.raw,Buffer.from(' ')]),original.claims,now,hash)));
pass('invalid UTF8 refused',()=>assert.throws(()=>verifyEnvelope(Buffer.from([0xff]),original.claims,now,hash)));
for(const [name,change]of [['caller Slack authority',b=>b.context.slack_user_id='U00000000'],['cross team',b=>b.context.team='graphics'],['missing editor',b=>b.context.assignee_id=''],['wrong email',b=>b.context.assignee_email='UPPER@example.invalid'],['noncanonical round',b=>b.context.video_status_at='2026-09-07'],['extra body',b=>b.ok=true]]){
 pass('reject '+name,()=>{const b=structuredClone(body);change(b);const p=packageBody(b);assert.throws(()=>verifyEnvelope(p.raw,p.claims,now,hash));});
}
pass('exact existing email map selected',()=>assert.equal(chooseRecipient(body.context,[{email:'editor@example.invalid',slack_user_id:'U00000001'}],{}),'U00000001'));
pass('unknown and conflicting roster mapping refused',()=>{assert.throws(()=>chooseRecipient(body.context,[],{}));assert.throws(()=>chooseRecipient(body.context,[{email:body.context.assignee_email,slack_user_id:'U00000001'},{email:body.context.assignee_email,slack_user_id:'U00000002'}],{}));});
pass('existing fallback only used without current mapping',()=>{assert.equal(chooseRecipient(body.context,[],{[body.context.assignee_email]:'U00000003'}),'U00000003');assert.equal(chooseRecipient(body.context,[{email:body.context.assignee_email,slack_user_id:'U00000001'}],{[body.context.assignee_email]:'U00000003'}),'U00000001');});
const nodes=Array.from({length:9},(_,i)=>({id:'old-'+i,name:'Old '+i,type:'n8n-nodes-base.code',typeVersion:2,position:[i*100,0],parameters:{}}));
nodes[0]={...nodes[0],type:'n8n-nodes-base.webhook',typeVersion:2.1,parameters:{path:'legacy-fixture',httpMethod:'POST',responseMode:'responseNode',options:{}}};
nodes[3]={...nodes[3],type:'n8n-nodes-base.httpRequest',parameters:{url:'https://api.linear.app/graphql'}};
nodes[4]={...nodes[4],type:'n8n-nodes-base.googleSheets',credentials:{googleSheetsOAuth2Api:{id:'fixture-roster',name:'Fixture'}}};
nodes[5].parameters.jsCode="const FALLBACK = { 'editor@example.invalid': 'U00000000' };\nreturn [{json:{channelId: 'C00000000'}}];";
nodes[6]={...nodes[6],type:'n8n-nodes-base.slack',credentials:{slackApi:{id:'fixture-bot',name:'Fixture'}},parameters:{channelId:'={{ $json.channelId }}',text:'={{ $json.text }}'}};
const connections=Object.fromEntries(nodes.slice(0,8).map((n,i)=>[n.name,{main:[[{node:nodes[i+1].name,type:'main',index:0}]]}]));
const workflow={id:'fixture-workflow',active:true,versionId:'fixture-version',activeVersionId:'fixture-version',nodes,connections,activeVersion:{workflowId:'fixture-workflow',versionId:'fixture-version',nodes:structuredClone(nodes),connections:structuredClone(connections)}};
const raw=Buffer.from(JSON.stringify(workflow)),binding={sourceBase:SOURCE_BASE,captureSha256:hash(raw),activeVersionId:'fixture-version',mappingCodeSha256:hash(nodes[5].parameters.jsCode),nativeUrl:'https://fixture.invalid/webhook/native-urgent-video',appOrigin:'https://fixture.invalid'};
let result;
pass('all original nodes edges metadata preserved by exact inverse',()=>{result=prepare(raw,binding);assert.deepEqual(result.workflow.nodes.slice(0,9),nodes);for(const [k,v]of Object.entries(connections))assert.deepEqual(result.workflow.connections[k],v);assert(result.receipt.inverseVerified);});
pass('new native root requires credential-store JWT and raw body',()=>{const n=result.workflow.nodes[9];assert.equal(n.parameters.authentication,'jwtAuth');assert.equal(n.parameters.options.rawBody,true);assert.equal(n.credentials,undefined);assert(result.receipt.activationHeld);assert.equal(result.receipt.jwtCredentialBound,false);});
pass('no native edge reaches any old node',()=>{for(const [name,types]of Object.entries(result.workflow.connections).filter(([n])=>n.startsWith('Native Urgent')))for(const lists of Object.values(types))for(const list of lists)for(const e of list)assert(e.node.startsWith('Native Urgent'));});
pass('roster and Slack credential references preserved exactly',()=>{assert.deepEqual(result.workflow.nodes[12].credentials,nodes[4].credentials);assert.deepEqual(result.workflow.nodes[15].credentials,nodes[6].credentials);});
pass('Slack retries explicitly disabled and old-node expressions refused',()=>{assert.equal(result.workflow.nodes[15].retryOnFail,false);assert.equal(result.workflow.nodes[15].maxTries,1);const changed=structuredClone(workflow);changed.nodes[4].parameters.documentId="={{ $('Old 1').first().json.id }}";changed.activeVersion.nodes=structuredClone(changed.nodes);const bytes=Buffer.from(JSON.stringify(changed));assert.throws(()=>prepare(bytes,{...binding,captureSha256:hash(bytes)}));});
pass('capture or mapping source drift refused',()=>{assert.throws(()=>prepare(Buffer.from('{}'),binding));assert.throws(()=>prepare(raw,{...binding,mappingCodeSha256:'0'.repeat(64)}));});
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor,clock=class extends Date{static now(){return now*1000;}};
async function invokeVerify(overrides={}){const item={json:{headers:{'content-type':'application/json'},jwtPayload:original.claims,...overrides}};return new AsyncFunction('$input','require','Buffer','Date',result.workflow.nodes[10].parameters.jsCode).call({helpers:{getBinaryDataBuffer:async()=>original.raw}},{first:()=>item},require,Buffer,clock);}
(async()=>{
 assert.equal((await invokeVerify())[0].json.ready,true);groups++;console.log('ok actual generated verifier accepts authenticated raw body');
 for(const headers of [{'content-type':'text/plain'},{'content-type':'application/json; x=multipart/form-data'},{'content-type':'application/json','content-encoding':'gzip'}])assert.equal((await invokeVerify({headers}))[0].json.ready,false);
 assert.equal((await invokeVerify({jwtPayload:undefined,body:{jwtPayload:original.claims}}))[0].json.ready,false);groups++;console.log('ok actual generated verifier refuses MIME encoding and body-spoofed auth');
 const ack=result.workflow.nodes[16].parameters.jsCode,invoke=value=>new Function('$input','$',ack)({first:()=>({json:value})},()=>({first:()=>({json:{dispatch_id:id}})}));
 assert.equal(invoke({ok:true,ts:'1800000000.123456'})[0].json.response.body.dispatch_id,id);assert.equal(invoke({ok:false,ts:'1800000000.123456'})[0].json.response.status,502);assert.equal(invoke({ok:true,ts:'123.456'})[0].json.response.status,502);assert.equal(invoke({ok:true})[0].json.response.status,502);groups++;console.log('ok ack requires actual successful Slack result and binds dispatch');
 console.log(groups+' focused offline groups passed; no n8n execution or credential provisioning');
})().catch(e=>{console.error(e);process.exitCode=1;});
