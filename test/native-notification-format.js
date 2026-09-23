'use strict';
// Rich creative-channel layout: the pure formatter, then the real notify
// handler with NOTIFY_FORMAT on (merge of status + comment) and the owner-only
// preview. Injected database and Slack; no network calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url'),{spawnSync}=require('node:child_process');
if(!process.execArgv.includes('--experimental-strip-types')){const r=spawnSync(process.execPath,['--experimental-strip-types','--no-warnings',__filename],{stdio:'inherit'});process.exit(r.status??1);}
const root=path.resolve(__dirname,'..'),fn=path.join(root,'supabase/functions/notify'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'notify-format-'));
const href=f=>JSON.stringify(pathToFileURL(f).href);
(async()=>{const originalDeno=globalThis.Deno,originalFetch=globalThis.fetch;let external=0;
try{
 globalThis.fetch=async()=>{external++;throw Error('external transport refused');};
 const fmt=await import(pathToFileURL(path.join(fn,'format.ts')).href);
 const base={title:'Synthetic Title',clientName:'Synthetic Client',deliverableId:'del_synthetic-1',clientSlug:'synthetic-slug',cardId:'p_synthetic_1'};
 const all=m=>JSON.stringify(m.blocks);
 const texts=m=>{const out=[];JSON.stringify(m.blocks,(k,v)=>{if(v&&typeof v==='object'&&v.type==='mrkdwn')out.push(v);return v;});return out;};

 // Links: SyncLinear sub-issue and the calendar card deep link.
 for(const v of fmt.NOTIFY_VARIANTS){
  const m=fmt.formatNotification({...base,status:'status_tweak'},v);
  assert(all(m).includes('https://syncview.synchrosocial.com/?prod=1&d=del_synthetic-1#production'),v+' production link');
  assert(all(m).includes('https://syncview.synchrosocial.com/#calendar/synthetic-slug/p_synthetic_1'),v+' calendar link');
  assert(all(m).includes('Needs tweaks'),v+' status label');
  assert(!/<@|<!|<#/.test(all(m)),v+' no mention syntax');
  for(const t of texts(m))assert.equal(t.verbatim,true,v+' every mrkdwn object is verbatim');
  assert.equal(m.text,'Needs tweaks: Synthetic Title (Synthetic Client)');
 }
 // No card id (non-calendar origin): no calendar link, still one production link.
 const noCal=fmt.formatNotification({...base,cardId:null,status:'status_smm_approval'},'compact');
 assert(!all(noCal).includes('#calendar'));assert(all(noCal).includes('Ready for SMM approval'));
 assert.equal(fmt.calendarUrl('a b','p/1'),'https://syncview.synchrosocial.com/#calendar/a%20b/p%2F1');

 // Special characters: markup, mentions and links cannot be injected.
 const evil={...base,title:'*Bold* <@U12345678> & <!channel> <https://evil.example|x> _v2_ "quote" émoji 🎬',status:'status_tweak',
  comment:{author:'<!here> Name',body:'Please fix <@U87654321> & see <https://evil.example|here>\n@channel line two'}};
 for(const v of fmt.NOTIFY_VARIANTS){
  const m=fmt.formatNotification(evil,v),s=all(m)+m.text;
  assert(!s.includes('<@')&&!s.includes('<!')&&!s.includes('<https://evil'),v+' escaped');
  assert(s.includes('‹@U12345678›')&&s.includes('＆'),v+' lookalikes keep the text readable');
  assert(!m.text.includes('\n'),v+' fallback is one line');
 }
 assert(texts(fmt.formatNotification(evil,'compact'))[0].text.startsWith('*∗Bold∗'),'asterisks in the title cannot break the bold span');

 // Very long comment and title stay inside Slack limits.
 const long={...base,title:'T'.repeat(500),status:'status_tweak',comment:{author:'A',body:('word '.repeat(4000)).trim()}};
 for(const v of fmt.NOTIFY_VARIANTS){
  const m=fmt.formatNotification(long,v);
  for(const t of texts(m))assert(t.text.length<=3000,v+' mrkdwn under 3000');
  if(v==='card')assert(m.blocks[0].text.text.length<=150,'header under 150');
  assert(m.text.length<=400,v+' fallback short: '+m.text.length);
  assert(all(m).includes('…'),v+' truncation marked');
 }
 // Control characters are dropped; empty title still readable.
 assert.equal(fmt.fallbackText({...base,title:'\u0000\u0007',comment:{author:'',body:'x'}}),'New comment: Untitled (Synthetic Client) · Someone: x');

 // Card colours: one coloured attachment wrapping the card blocks; merged posts take the status colour.
 const colorOf=input=>{const m=fmt.formatNotification(input,'card');assert.equal(m.attachments.length,1);assert.deepEqual(m.attachments[0].blocks,m.blocks,'attachment wraps the card blocks');return m.attachments[0].color;};
 assert.equal(colorOf({...base,status:'status_tweak'}),'#F2994A','needs tweaks is orange');
 assert.equal(colorOf({...base,status:'status_smm_approval'}),'#B45CD6','SMM approval is pink-purple');
 assert.equal(colorOf({...base,comment:{author:'A',body:'x'}}),'#9AA0A6','comment is grey');
 assert.equal(colorOf({...base,status:'status_tweak',comment:{author:'A',body:'x'}}),'#F2994A','merged tweak takes the status colour');
 assert.equal(colorOf({...base,status:'status_smm_approval',comment:{author:'A',body:'x'}}),'#B45CD6','merged approval takes the status colour');
 for(const v of ['compact','line'])assert.equal(fmt.formatNotification({...base,status:'status_tweak'},v).attachments,undefined,v+' stays uncoloured');
 {const m=fmt.formatNotification(evil,'card'),s2=JSON.stringify(m.attachments);assert(!s2.includes('<@')&&!s2.includes('<!'),'coloured card keeps the no-mention rule');assert.equal(m.text,fmt.fallbackText(evil),'coloured card keeps the plain fallback');assert.equal(m.attachments[0].fallback,m.text,'the attachment carries the plain line for notifications');}

 // Real handler, NOTIFY_FORMAT on: a status and its comment become ONE post.
 let handler,posts=[],receipts=[],env={NOTIFY_RUNNER_KEY:'k',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_SERVICE_ROLE_KEY:'s',SLACK_BOT_TOKEN:'t',NOTIFY_FORMAT:'compact'};
 globalThis.Deno={env:{get:k=>env[k]},serve:f=>{handler=f;}};
 const ch='C1234567890',t0='2026-09-20T10:00:00Z',t1='2026-09-20T10:00:30Z';
 const I=(id,kind,extra)=>({id,kind,destination_kind:'client_creative_channel',destination_channel_id:ch,client_slug:'synthetic-slug',deliverable_id:'del_synthetic-1',source_comment_id:null,actor_member_id:'m1',created_at:t0,...extra});
 let intents=[],claims=[];
 const table={production_notification_intents:()=>intents,deliverables:()=>[{id:'del_synthetic-1',title:'Synthetic Title',client_slug:'synthetic-slug',origin:'calendar',card_id:'p_synthetic_1',updated_at:t0}],clients:()=>[{slug:'synthetic-slug',display_name:'Synthetic Client'}],production_comments:()=>[{id:'c1',author_name:'Synthetic Staff',body:'Trim the intro',client_slug:'synthetic-slug',deleted_at:null}]};
 const q=rows=>{const o={in:()=>o,eq:()=>o,not:()=>o,is:()=>o,order:()=>o,limit:()=>o,maybeSingle:async()=>({data:rows[0]||null,error:null}),then:(r,j)=>Promise.resolve({data:rows,error:null}).then(r,j)};return o;};
 globalThis.__db={rpc:async(name,args)=>{if(name==='production_notification_claim')return{data:claims,error:null};receipts.push(args);return{error:null};},from:n=>({select:()=>q(table[n]())})};
 globalThis.__post=async(...a)=>{posts.push(a);return{kind:'sent',messageId:'1788800000.00000'+posts.length};};
 globalThis.__dm=async(...a)=>{posts.push(a);return{kind:'sent',messageId:'1788800000.000009'};};
 let src=fs.readFileSync(path.join(fn,'index.ts'),'utf8');
 src=src.replace('import { createClient } from "npm:@supabase/supabase-js@2.49.8";','const createClient = () => globalThis.__db;')
  .replace('"../_shared/staff-role-auth.ts"',href(path.join(root,'supabase/functions/_shared/staff-role-auth.ts')))
  .replace('"./urgent-link.ts"',href(path.join(fn,'urgent-link.ts'))).replace('"./format.ts"',href(path.join(fn,'format.ts')))
  .replace('import { postSlackChannelMessage } from "./slack-api.ts";','const postSlackChannelMessage=(...a)=>globalThis.__post(...a);').replace('import { postSlackDirectPreview } from "./slack-api.ts";','const postSlackDirectPreview=(...a)=>globalThis.__dm(...a);');
 const file=path.join(tmp,'notify.ts');fs.writeFileSync(file,src,{flag:'wx'});await import(pathToFileURL(file));
 const call=b=>handler(new Request('http://127.0.0.1/notify',{method:'POST',headers:{'content-type':'application/json','x-notify-runner-key':'k'},body:JSON.stringify(b)})).then(r=>r.json());
 const cl=(id,text)=>({intent_id:id,attempt:1,destination_channel_id:ch,text,client_msg_id:id,allow_mentions:false});
 intents=[I('s1','status_tweak'),I('c1','comment',{source_comment_id:'c1',created_at:t1})];
 claims=[cl('s1','Status update: Synthetic Title needs tweaks.'),cl('c1','x commented')];
 let r=await call({});
 assert.equal(r.sent,2);assert.equal(posts.length,1,'merged into one post');
 assert(JSON.stringify(posts[0][6]).includes('Trim the intro')&&JSON.stringify(posts[0][6]).includes('Needs tweaks'));
 assert.equal(posts[0][4],false,'no mentions');
 // An unknown merged post is mirrored to its partner, never re-posted.
 {const keep=globalThis.__post;posts=[];receipts=[];globalThis.__post=async(...a)=>{posts.push(a);return{kind:'unknown',code:'slack_response_unconfirmed'};};
  const u=await call({});assert.equal(posts.length,1,'no second post after unknown');assert.equal(u.unknown,2);
  assert.deepEqual(receipts.map(x=>x.p_outcome),['unknown','unknown']);globalThis.__post=keep;posts=[{},...[]];posts=[];receipts=[];await call({});}assert.equal(receipts[0].p_provider_message_id,receipts[1].p_provider_message_id,'both intents record the one post');
 // Card variant on the real handler: the merged post goes out as one orange attachment, no top-level blocks.
 {env.NOTIFY_FORMAT='card';posts=[];receipts=[];intents=[I('s1','status_tweak'),I('c1','comment',{source_comment_id:'c1',created_at:t1})];
  await call({});assert.equal(posts.length,1);assert.equal(posts[0][7][0].color,'#F2994A');assert(JSON.stringify(posts[0][7]).includes('Trim the intro'));
  assert.equal(posts[0][2],'Needs tweaks: Synthetic Title (Synthetic Client) · Synthetic Staff: Trim the intro','plain fallback line');env.NOTIFY_FORMAT='compact';}
 // Different person, or far apart: two separate posts.
 posts=[];receipts=[];intents=[I('s1','status_tweak'),I('c1','comment',{source_comment_id:'c1',actor_member_id:'m2'})];r=await call({});assert.equal(posts.length,2);
 posts=[];intents=[I('s1','status_tweak'),I('c1','comment',{source_comment_id:'c1',created_at:'2026-09-20T11:00:00Z'})];r=await call({});assert.equal(posts.length,2);
 // A lookup failure falls back to the plain SQL text; delivery still happens.
 posts=[];const saved=globalThis.__db.from;globalThis.__db.from=()=>({select:()=>({in:async()=>({data:null,error:{}})})});r=await call({});
 assert.equal(posts.length,2);assert.equal(posts[0][2],'Status update: Synthetic Title needs tweaks.');assert.equal(posts[0][6],undefined);globalThis.__db.from=saved;
 // Format unset: exactly today's plain post, no lookups.
 env.NOTIFY_FORMAT=undefined;posts=[];r=await call({});assert.equal(posts.length,2);assert.equal(posts[0].length,5,'legacy call shape unchanged');
 // Preview: DM only, from the secret; refuses a channel id and a missing slug.
 posts=[];env.NOTIFY_PREVIEW_SLACK_USER_ID='U0SYNTHETIC1';r=await call({action:'preview',client_slug:'synthetic-slug',slack_user_id:'C1234567890'});
 assert.equal(r.ok,true);assert.equal(posts.length,12,'3 variants x (intro + 3 samples)');assert(posts.every(p=>p[1]==='U0SYNTHETIC1'),'secret wins over call-time id');
 env.NOTIFY_PREVIEW_SLACK_USER_ID=undefined;posts=[];
 assert.equal((await call({action:'preview',client_slug:'synthetic-slug',slack_user_id:'U0SYNTHETIC1'})).error,'preview_target','no call-time recipient without the secret');
 env.NOTIFY_PREVIEW_SLACK_USER_ID='U0SYNTHETIC1';
 assert.equal((await call({action:'preview',slack_user_id:'U0SYNTHETIC1'})).error,'client_slug');
 assert.equal((await call({action:'preview',client_slug:'synthetic-slug',variant:'card'})).sent,4);
 assert.equal(posts.length,4);
 assert.equal(receipts.filter(x=>x.p_intent_id==null).length,0);
 // The DM adapter refuses a non-user target and a non-DM reply.
 const api=await import(pathToFileURL(path.join(fn,'slack-api.ts')).href);
 assert.equal((await api.postSlackDirectPreview('t','C1234567890','x',[],async()=>{throw Error('no');})).code,'preview_target_not_a_user');
 assert.equal((await api.postSlackDirectPreview('t','U0SYNTHETIC1','x',[],async()=>new Response(JSON.stringify({ok:true,channel:'C1234567890',ts:'1788800000.123456'})))).kind,'blocked');
 assert.equal((await api.postSlackDirectPreview('t','U0SYNTHETIC1','x',[],async()=>new Response(JSON.stringify({ok:true,channel:'D1234567890',ts:'1788800000.123456'})))).kind,'sent');
 assert.equal(external,0);
 console.log('NATIVE_NOTIFICATION_FORMAT_OK: 3 variants, links, escaping, long text, merge, fallback, preview DM-only; external calls 0');
}finally{globalThis.Deno=originalDeno;globalThis.fetch=originalFetch;delete globalThis.__db;delete globalThis.__post;delete globalThis.__dm;fs.rmSync(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
