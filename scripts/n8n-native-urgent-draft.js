'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const SOURCE_BASE='5bcc03bd7d286f437ad51d4cc86a5ce80b7b63ea';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function verifyEnvelope(raw,claims,now,hashBytes){
 const fail=c=>{throw Error(c);},object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
 const exact=(x,keys)=>object(x)&&Object.keys(x).sort().join('|')===keys.slice().sort().join('|');
 const text=(x,max)=>typeof x==='string'&&x.length>0&&x.length<=max&&x.trim()===x&&!/[\u0000-\u001f\u007f]/.test(x);
 if(!Buffer.isBuffer(raw)||!raw.length||raw.length>16384)fail('body_size');
 const decoded=raw.toString('utf8');if(!Buffer.from(decoded,'utf8').equals(raw))fail('body_encoding');
 if(!exact(claims,['purpose','aud','jti','iat','exp','body_sha256']))fail('authenticated_claims_required');
 if(claims.purpose!=='native-urgent-handoff-v1'||claims.aud!=='syncview:n8n:native-urgent-video:v1')fail('purpose_audience');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(claims.jti))fail('dispatch_id');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||claims.exp-claims.iat!==60||claims.iat>now+5||claims.exp<=now)fail('expiry');
 if(!/^[0-9a-f]{64}$/.test(claims.body_sha256)||hashBytes(raw)!==claims.body_sha256)fail('body_digest');
 let body;try{body=JSON.parse(decoded);}catch{fail('body_json');}
 if(!exact(body,['contract','audience','dispatch_id','issued_at','expires_at','context']))fail('body_fields');
 if(body.contract!=='native_urgent_video_v1'||body.audience!==claims.aud||body.dispatch_id!==claims.jti||body.issued_at!==claims.iat||body.expires_at!==claims.exp)fail('body_binding');
 const c=body.context;
 if(!exact(c,['deliverable_id','client_slug','client_name','card_id','surface','team','video_status_at','assignee_id','assignee_email','assignee_name','title','actor_member_id']))fail('context_fields');
 for(const k of ['deliverable_id','client_slug','card_id','assignee_id','actor_member_id'])if(!text(c[k],160))fail('context_identity');
 for(const k of ['client_name','assignee_name','title'])if(!text(c[k],300))fail('context_text');
 if(!text(c.assignee_email,254)||c.assignee_email!==c.assignee_email.toLowerCase()||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.assignee_email))fail('editor_email');
 if(!['calendar','samples'].includes(c.surface)||c.team!=='video')fail('context_scope');
 if(typeof c.video_status_at!=='string'||!Number.isFinite(Date.parse(c.video_status_at))||new Date(c.video_status_at).toISOString()!==c.video_status_at)fail('context_round');
 return body;
}
function chooseRecipient(context,rows,fallback){
 const matches=rows.filter(r=>String(r.email||'').trim().toLowerCase()===context.assignee_email);
 const values=[...new Set(matches.map(r=>String(r.slack_user_id||'').trim()))];
 if(values.length>1||values.some(x=>!/^([UW])[A-Z0-9]{8,}$/.test(x)))throw Error('editor_mapping_ambiguous');
 const id=values.length?values[0]:fallback[context.assignee_email];
 if(typeof id!=='string'||!/^([UW])[A-Z0-9]{8,}$/.test(id))throw Error('editor_mapping_missing');
 return id;
}
function mappingFrom(code){
 const m=code.match(/const FALLBACK = (\{[^\n]+\});/),channel=code.match(/channelId: '([CG][A-Z0-9]{8,})'/);assert(m&&channel,'mapping_shape');
 const inner=m[1].slice(1,-1),regex=/'([^'\\]+)'\s*:\s*'([UW][A-Z0-9]{8,})'/g,pairs=[...inner.matchAll(regex)];
 assert(pairs.length&&inner.replace(regex,'').replace(/[\s,]/g,'')==='','mapping_unparsed');
 const fallback={};for(const p of pairs){assert(!Object.hasOwn(fallback,p[1]));fallback[p[1]]=p[2];}return{fallback,channel:channel[1]};
}
const edge=name=>({node:name,type:'main',index:0});
function prepare(raw,b){
 assert(b?.sourceBase===SOURCE_BASE);assert.equal(hash(raw),b.captureSha256,'capture_hash');
 const original=JSON.parse(raw),w=structuredClone(original);assert.equal(original.activeVersionId,b.activeVersionId);assert.equal(original.activeVersion?.workflowId,original.id);assert.equal(original.activeVersion?.versionId,b.activeVersionId);assert.equal(original.active,true);assert.equal(original.nodes.length,9);
 assert.deepEqual(original.nodes,original.activeVersion.nodes);assert.deepEqual(original.connections,original.activeVersion.connections);
 const [webhook,,,lookup,roster,mapping,slack]=original.nodes;
 assert.equal(webhook.type,'n8n-nodes-base.webhook');assert.equal(webhook.typeVersion,2.1);assert.equal(lookup.type,'n8n-nodes-base.httpRequest');assert.equal(new URL(lookup.parameters.url).hostname,'api.linear.app');assert.equal(roster.type,'n8n-nodes-base.googleSheets');assert.equal(mapping.type,'n8n-nodes-base.code');assert.equal(slack.type,'n8n-nodes-base.slack');
 assert.equal(hash(mapping.parameters.jsCode),b.mappingCodeSha256,'mapping_hash');
 for(const source of [roster,slack]){const parameters=JSON.stringify(source.parameters);assert(!/\$node|\$items|\$item\s*\(|\$\s*\(/.test(parameters),'retained_external_node_reference');for(const old of original.nodes)assert(!parameters.includes(old.name),'retained_old_node_reference');}
 const url=new URL(b.nativeUrl),app=new URL(b.appOrigin);assert(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/webhook/native-urgent-video');assert.equal(app.protocol,'https:');assert.equal(app.origin,b.appOrigin);
 const {fallback,channel}=mappingFrom(mapping.parameters.jsCode),names=['Native Urgent JWT','Native Urgent Verify','Native Urgent Authenticated','Native Urgent Roster','Native Urgent Recipient','Native Urgent Mapped','Native Urgent Slack','Native Urgent Acknowledge','Native Urgent Respond'],ids=names.map((_,i)=>'native-urgent-v1-'+i);
 for(let i=0;i<names.length;i++)assert(!original.nodes.some(n=>n.name===names[i]||n.id===ids[i]),'node_collision');
 const codeNode=(i,jsCode)=>({id:ids[i],name:names[i],type:'n8n-nodes-base.code',typeVersion:2,position:[i*200,-500],parameters:{mode:'runOnceForAllItems',language:'javaScript',jsCode}});
 const condition=(i,key)=>({id:ids[i],name:names[i],type:'n8n-nodes-base.if',typeVersion:2.3,position:[i*200,-500],parameters:{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:ids[i]+'-condition',leftValue:'={{ $json.'+key+' === true }}',rightValue:'',operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}}});
 const receive={id:ids[0],name:names[0],type:webhook.type,typeVersion:2.1,position:[0,-500],parameters:{httpMethod:'POST',path:'native-urgent-video',responseMode:'responseNode',authentication:'jwtAuth',options:{rawBody:true}}};
 if(b.jwtCredential){assert(typeof b.jwtCredential.id==='string'&&typeof b.jwtCredential.name==='string');receive.credentials={jwtAuth:structuredClone(b.jwtCredential)};}
 const verify=codeNode(1,[
 "const refuse=()=>[{json:{ready:false,response:{status:403,body:{ok:false,error:'native_urgent_refused'}}}}];",
 "try { const input=$input.first(),headers=input.json.headers||{};",
 "if(headers['content-encoding']&&headers['content-encoding']!=='identity')return refuse();",
 "const parts=String(headers['content-type']||'').split(';').map(x=>x.trim());",
 "if(parts.shift().toLowerCase()!=='application/json'||parts.length>1||parts.some(x=>!/^charset\\s*=\\s*(?:\"utf-?8\"|utf-?8)$/i.test(x)))return refuse();",
 "const raw=await this.helpers.getBinaryDataBuffer(0,'data');",
 "const body=("+verifyEnvelope.toString()+")(raw,input.json.jwtPayload,Math.floor(Date.now()/1000),bytes=>require('crypto').createHash('sha256').update(bytes).digest('hex'));",
 "return [{json:{ready:true,envelope:body}}]; }catch(_){return refuse();}"].join('\n'));
 const rosterCopy={...structuredClone(roster),id:ids[3],name:names[3],position:[600,-500]};
 const map=codeNode(4,[
 "try {const envelope=$('"+names[1]+"').first().json.envelope,context=envelope.context;",
 "if(envelope.expires_at<=Math.floor(Date.now()/1000))throw Error('expired');",
 "const slackUserId=("+chooseRecipient.toString()+")(context,$input.all().map(x=>x.json||{}),"+JSON.stringify(fallback)+");",
 "const clean=value=>String(value).replace(/[<>@]/g,'').replace(/[\\r\\n\\t]+/g,' ').trim();",
 "const syncUrl="+JSON.stringify(b.appOrigin)+"+'/?prod=1&d='+encodeURIComponent(context.deliverable_id)+'#production';",
 "const text='URGENT TWEAKS NEEDED\\nClient: '+clean(context.client_name)+'\\nBy when: ASAP\\nSyncView: '+syncUrl+'\\n<@'+slackUserId+'>';",
 "return [{json:{mapped:true,dispatch_id:envelope.dispatch_id,text,channelId:"+JSON.stringify(channel)+",slackUserId}}];",
 "}catch(_){return [{json:{mapped:false,response:{status:409,body:{ok:false,error:'native_editor_mapping_unavailable'}}}}];}"].join('\n'));
 const slackCopy={...structuredClone(slack),id:ids[6],name:names[6],position:[1200,-500],retryOnFail:false,maxTries:1};
 const ack=codeNode(7,[
 "const value=$input.first().json||{},dispatch=$('"+names[4]+"').first().json.dispatch_id;",
 "const ts=String(value.ts||value.message?.ts||'');",
 "return [{json:{response:value.ok===true&&/^[0-9]{10,}\\.[0-9]{6}$/.test(ts)?{status:200,body:{ok:true,contract:'native_urgent_video_v1',dispatch_id:dispatch,delivered:true,slack_ts:ts}}:{status:502,body:{ok:false,error:'native_delivery_unknown'}}}}];"].join('\n'));
 const respond={id:ids[8],name:names[8],type:'n8n-nodes-base.respondToWebhook',typeVersion:1.4,position:[1600,-500],parameters:{respondWith:'json',responseBody:'={{ $json.response.body }}',options:{responseCode:'={{ $json.response.status }}',responseHeaders:{entries:[{name:'Cache-Control',value:'no-store'}]}}}};
 const additions=[receive,verify,condition(2,'ready'),rosterCopy,map,condition(5,'mapped'),slackCopy,ack,respond];w.nodes.push(...additions);
 const connect=(i,j)=>{w.connections[names[i]]={main:[[edge(names[j])]]};};connect(0,1);connect(1,2);w.connections[names[2]]={main:[[edge(names[3])],[edge(names[8])]]};connect(3,4);connect(4,5);w.connections[names[5]]={main:[[edge(names[6])],[edge(names[8])]]};connect(6,7);connect(7,8);
 const inverse=structuredClone(w);inverse.nodes=inverse.nodes.filter(n=>!ids.includes(n.id));for(const name of names)delete inverse.connections[name];assert.deepEqual(inverse,original,'inverse_mismatch');
 for(const n of additions)for(const lists of Object.values(w.connections[n.name]||{}))for(const list of lists)for(const e of list)assert(names.includes(e.node),'native_to_legacy_edge');
 return{workflow:w,receipt:{classification:'REVIEW_ONLY_NATIVE_URGENT_DRAFT',sourceBase:SOURCE_BASE,captureSha256:hash(raw),activeVersionId:b.activeVersionId,originalNodes:9,addedNodes:9,inverseVerified:true,nativeHasNoLegacyEdges:true,jwtCredentialBound:!!b.jwtCredential,activationHeld:true,workflowSha256:hash(JSON.stringify(w,null,2)+'\n')}};
}
if(require.main===module){const [bindingPath,capturePath,output]=process.argv.slice(2);assert(bindingPath&&capturePath&&output,'usage_binding_capture_private_output');const repo=path.resolve(__dirname,'..'),out=path.resolve(output);assert(out!==repo&&!out.startsWith(repo+path.sep),'private_output_required');const r=prepare(fs.readFileSync(capturePath),JSON.parse(fs.readFileSync(bindingPath)));fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'native-urgent.review.json'),JSON.stringify(r.workflow,null,2)+'\n',{flag:'wx',mode:0o600});fs.writeFileSync(path.join(out,'RECEIPT.private.json'),JSON.stringify(r.receipt,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(r.receipt));}
module.exports={SOURCE_BASE,hash,verifyEnvelope,chooseRecipient,prepare};
