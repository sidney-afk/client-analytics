// Full production-write HTTP handler with an explicit in-process Supabase seam.
// RPC-shaped persistence records the ACTUAL add arguments/receipt/outbox; it
// never manufactures a reconcile outcome. PostgreSQL/serving are not claimed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = 'ce63c74d0333138f862cef5637bb7532fe059b74';
const EDGE = 'supabase/functions/production-write/index.ts';
const POLICY = 'supabase/functions/production-write/policy.mjs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-fingerprint-'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const git = file => execFileSync('git', ['show', BASE + ':' + file], { cwd: ROOT, encoding: 'utf8', maxBuffer: 4*1024*1024 });
const secret = { SUPABASE_URL: 'https://supabase.synthetic.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', ROLE_KEY_ADMIN: 'synthetic-admin' };
let handler, activeStore, externalRequests = 0;
globalThis.Deno = { env: { get: name => secret[name] }, serve: fn => { handler = fn; } };
globalThis.EdgeRuntime = { waitUntil: () => { throw Error('unexpected_background_work'); } };
globalThis.fetch = async () => { externalRequests++; throw Error('external_fetch_refused'); };
globalThis.__commentFixtureClient = () => activeStore;

function rewriteOnce(source, needle, value) {
  assert.equal(source.split(needle).length, 2, 'test seam must match exactly once');
  return source.replace(needle, value);
}
async function load(version) {
  let text = version === 'baseline' ? git(EDGE) : fs.readFileSync(path.join(ROOT,EDGE),'utf8');
  const originalHash = sha(text);
  const policyText = version === 'baseline' ? git(POLICY) : fs.readFileSync(path.join(ROOT,POLICY),'utf8');
  const policyFile = path.join(tmp,version+'.policy.mjs'); fs.writeFileSync(policyFile,policyText);
  const shim = 'data:text/javascript,' + encodeURIComponent('export class SupabaseClient {} export function createClient(){return globalThis.__commentFixtureClient();}');
  text = rewriteOnce(text,'import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.49.8";',`import { createClient, SupabaseClient } from "${shim}";`);
  for (const relative of ['../_shared/staff-role-auth.ts','./selected-label-pages.mjs','../_shared/linear-create-id.mjs']) {
    text = rewriteOnce(text,`from "${relative}";`,`from "${pathToFileURL(path.resolve(ROOT,'supabase/functions/production-write',relative)).href}";`);
  }
  text = rewriteOnce(text,'from "./policy.mjs";',`from "${pathToFileURL(policyFile).href}";`);
  const file = path.join(tmp,version+'.ts');fs.writeFileSync(file,text);
  await import(pathToFileURL(file).href);
  assert.equal(typeof handler,'function');
  return { handler, source_sha256: originalHash, policy_sha256: sha(policyText) };
}

// No generic success stub: only the exact read builder and two named RPCs used
// by these cases exist. An unsupported operation fails, including table writes.
class Query {
  constructor(store, table){assert.ok(table in store.tables, 'unexpected table');this.store=store;this.table=table;this.filters=[];this.maximum=Infinity;}
  select(){return this;}
  eq(key,value){this.filters.push(row=>row[key]===value);return this;}
  neq(key,value){this.filters.push(row=>row[key]!==value);return this;}
  in(key,values){this.filters.push(row=>values.includes(row[key]));return this;}
  order(){return this;}
  limit(n){this.maximum=n;return this;}
  result(){return clone(this.store.tables[this.table].filter(row=>this.filters.every(fn=>fn(row))).slice(0,this.maximum));}
  async maybeSingle(){const rows=this.result();return rows.length>1?{data:null,error:{message:'multiple_rows'}}:{data:rows[0]||null,error:null};}
  then(resolve,reject){return Promise.resolve({data:this.result(),error:null}).then(resolve,reject);}
}
class Store {
  constructor(surface,component){
    const row={id:'synthetic-target',client_slug:'synthetic-client',team:component==='graphic'?'graphics':'video',kind:component==='graphic'?'thumbnail':'video',
      origin:surface==='sxr'?'samples':'calendar',card_id:'synthetic-card',status:'client_approval',updated_at:'2026-09-05T10:00:00Z'};
    this.calls=[];this.tables={clients:[{slug:'synthetic-client',display_name:'Synthetic client',active:true,kind:'client'},
      {slug:'synthetic-other-client',display_name:'Synthetic other client',active:true,kind:'client'}],
      client_access:[{slug:'synthetic-client',review_token:'synthetic-token'},
        {slug:'synthetic-other-client',review_token:'synthetic-other-token'}],
      team_members:[{id:'synthetic-member',name:'Synthetic reviewer',role:'admin',active:true}],
      deliverables:[row,{...row,id:'synthetic-other-target'}],batches:[{...row,id:'synthetic-batch'}],
      syncview_runtime_flags:[{key:'prod_authority',value:{video:'syncview',graphics:'syncview'}},{key:'linear_outbound_enabled',value:{mode:'off'}}],
      production_comments:[],production_comment_mutation_receipts:[],mirror_outbox:[],deliverable_events:[]};
  }
  from(table){return new Query(this,table);}
  async rpc(name,args){
    this.calls.push({name,args:clone(args)});
    if(name==='track_b_f27_write_authorization')return{data:{ok:true,type:'f27_write_authorization',team:args.p_team,authority:'syncview',generation:7},error:null};
    assert.equal(name,'production_comment_write','unexpected mutation RPC');
    const c=clone(args.p_comment),e=clone(args.p_event),out=e.outbound;
    assert.equal(c.operation,'add');assert.equal(out.operation,'comment');assert.ok(out.payload._intent_fingerprint);
    const receipt=this.tables.production_comment_mutation_receipts.find(r=>r.dedup_key===out.dedup_key);
    if(receipt){
      if(receipt.comment_id!==c.id||receipt.intent_fingerprint!==out.payload._intent_fingerprint)return{data:null,error:{message:'idempotency_conflict'}};
      return{data:clone(this.tables.production_comments.find(r=>r.id===c.id)),error:null};
    }
    const target=this.tables[c.deliverable_id?'deliverables':'batches'].find(r=>r.id===(c.deliverable_id||c.batch_id));assert.ok(target);
    assert.equal(c.team,target.team);
    const committed={...c,client_slug:target.client_slug,version:1,created_at:c.source_created_at,updated_at:c.source_updated_at,
      edited_at:null,deleted_at:null,resolved_at:null};
    // One modeled transaction, derived only from the actual gateway RPC args.
    this.tables.production_comments.push(committed);
    this.tables.production_comment_mutation_receipts.push({dedup_key:out.dedup_key,comment_id:c.id,action:'add',intent_fingerprint:out.payload._intent_fingerprint,result_version:1});
    this.tables.deliverable_events.push(e);
    this.tables.mirror_outbox.push({...clone(out),id:this.tables.mirror_outbox.length+1,client_slug:target.client_slug,team:target.team,
      actor:c.author_name,role:c.role,status:'pending',attempts:0,comment_id:c.id});
    return{data:clone(committed),error:null};
  }
}
function body(surface,component,isTweak,withNative=true){
  return{operation:'comment',entity:'deliverable',id:'synthetic-target',card_id:'synthetic-card',surface,request_id:'synthetic-request',source_edited_at:'2026-09-05T12:00:00Z',
    comment:{body:'  Synthetic exact feedback  ',audience:'client',component,is_tweak:isTweak,round:isTweak?1:null,
      ...(withNative?{native_comment_id:'synthetic-note'}:{})}};
}
async function call(fn,payload,actor='client'){
  const headers={'content-type':'application/json',...(actor==='other-client'?{'x-syncview-client-token':'synthetic-other-token'}:
    actor==='client'?{'x-syncview-client-token':'synthetic-token'}:{'x-syncview-key':'synthetic-admin','x-syncview-actor':'Synthetic reviewer'})};
  const response=await fn(new Request('https://gateway.synthetic.invalid',{method:'POST',headers,body:JSON.stringify(payload)}));
  return{status:response.status,body:await response.json()};
}

const cases=[];let checks=0;
try{
  const versions={baseline:await load('baseline'),candidate:await load('candidate')};
  const variants=[];
  for(const surface of ['calendar','sxr'])for(const component of ['video','graphic'])for(const isTweak of [false,true])variants.push({surface,component,isTweak,withNative:true,actor:'client'});
  variants.push({surface:'calendar',component:'video',isTweak:false,withNative:false,actor:'staff'},
    {surface:'production',component:'video',isTweak:false,withNative:false,actor:'staff'});
  for(const variant of variants){
    const {surface,component,isTweak,withNative,actor}=variant,payload=body(surface,component,isTweak,withNative);
    const captured={};
    for(const version of ['baseline','candidate']){
      activeStore=new Store(surface,component);
      const added=await call(versions[version].handler,payload,actor);
      assert.equal(added.status,200,JSON.stringify({version,...variant,result:added}));assert.equal(added.body.native_committed,true);
      const stored=activeStore.tables.production_comment_mutation_receipts[0];assert.ok(stored);captured[version]=stored.intent_fingerprint;
      const committed=JSON.stringify(activeStore.tables);
      const replay=await call(versions[version].handler,payload,actor);
      assert.equal(replay.status,200);assert.equal(replay.body.comment.id,added.body.comment.id);
      assert.equal(JSON.stringify(activeStore.tables),committed);checks++;
      const before=JSON.stringify(activeStore.tables),calls=activeStore.calls.length;
      const read=await call(versions[version].handler,{...payload,reconcile_only:true},actor);
      assert.equal(read.status,version==='baseline'?409:200,JSON.stringify({version,...variant,result:read}));
      assert.equal(read.body.outcome,version==='baseline'?'conflict':'committed_exact');
      assert.equal(JSON.stringify(activeStore.tables),before);assert.equal(activeStore.calls.length,calls);checks++;
      for(const action of ['edit','delete','resolve','unresolve']){
        const lifecycle={...payload,reconcile_only:true,comment:{...payload.comment,action,expected_version:1,expected_updated_at:'2026-09-05T12:00:00Z'}};
        const refused=await call(versions[version].handler,lifecycle,actor);
        assert.equal(refused.status,version==='baseline'?409:400,JSON.stringify({version,action,...variant,result:refused}));
        assert.equal(refused.body.error,version==='baseline'?'intent_conflict':'reconcile_operation_unsupported');
        assert.notEqual(refused.body.outcome,'committed_exact');assert.ok(!refused.body.comment);
        assert.equal(JSON.stringify(activeStore.tables),before);assert.equal(activeStore.calls.length,calls);checks++;
      }
      if(version==='baseline'){
        // Adopt the actual baseline acceptance without regenerating its receipt.
        const upgraded=await call(versions.candidate.handler,{...payload,reconcile_only:true},actor);
        assert.equal(upgraded.status,200);assert.equal(upgraded.body.outcome,'committed_exact');
        assert.equal(upgraded.body.comment.id,added.body.comment.id);
        assert.equal(JSON.stringify(activeStore.tables),before);assert.equal(activeStore.calls.length,calls);checks++;
      }
      if(version==='candidate'){
        assert.equal(read.body.comment.id,added.body.comment.id);
        assert.equal(read.body.comment.body,payload.comment.body.trim());
        const explicit=await call(versions[version].handler,{...payload,reconcile_only:true,comment:{...payload.comment,action:'add'}},actor);
        assert.equal(explicit.status,200);assert.equal(explicit.body.outcome,'committed_exact');
        assert.equal(JSON.stringify(activeStore.tables),before);assert.equal(activeStore.calls.length,calls);checks++;
        if(actor==='client'){
          const other=await call(versions[version].handler,{...payload,reconcile_only:true},'other-client');
          assert.equal(other.status,403);assert.notEqual(other.body.outcome,'committed_exact');assert.ok(!other.body.comment);
          assert.equal(JSON.stringify(activeStore.tables),before);assert.equal(activeStore.calls.length,calls);checks++;
        }
        for(const field of ['body','component','round','is_tweak','target','actor','source_clock']){
          const changed=clone(payload);let changedActor=actor;
          if(field==='body')changed.comment.body='Different feedback';
          if(field==='component')changed.comment.component=component==='video'?'graphic':'video';
          if(field==='round')changed.comment.round=isTweak?2:0;
          if(field==='is_tweak')changed.comment.is_tweak=!isTweak;
          if(field==='target')changed.id='synthetic-other-target';
          if(field==='actor')changedActor=actor==='client'?'staff':'client';
          if(field==='source_clock')changed.source_edited_at='2026-09-05T12:00:01Z';
          const refused=await call(versions[version].handler,{...changed,reconcile_only:true},changedActor);
          // Without a native ID, a new target derives a distinct receipt identity.
          const distinctIdentity=field==='target'&&!withNative;
          assert.equal(refused.status,distinctIdentity?200:409,JSON.stringify({field,...variant,result:refused}));
          assert.equal(refused.body.outcome,distinctIdentity?'absent':'conflict');assert.equal(refused.body.comment,null);
          assert.notEqual(refused.body.outcome,'committed_exact');
          assert.equal(JSON.stringify(activeStore.tables),before);assert.equal(activeStore.calls.length,calls);checks++;
        }
        // No new outbox-less acceptance logic is smuggled into this hash fix.
        activeStore.tables.mirror_outbox=[];
        const absent=await call(versions[version].handler,{...payload,reconcile_only:true},actor);
        assert.equal(absent.status,409);assert.equal(absent.body.outcome,'conflict');checks++;
      }
    }
    assert.equal(captured.candidate,captured.baseline,'accepted fingerprint bytes changed');checks++;
    cases.push({...variant,baseline_identical_read:'conflict',candidate_identical_read:'committed_exact',accepted_fingerprint_unchanged:true,fingerprint:captured.candidate});
  }
  assert.equal(externalRequests,0);
  const report={status:'PASS',checks,cases,baseline_commit:BASE,versions:Object.fromEntries(Object.entries(versions).map(([k,v])=>[k,{source_sha256:v.source_sha256,policy_sha256:v.policy_sha256}])),
    external_requests:externalRequests,proof:'full actual HTTP handler/auth/add/reconcile + strict RPC-shaped in-process persistence; no PostgreSQL/serving/source-copy completion claim'};
  if(process.env.COMMENT_FINGERPRINT_REPORT)fs.writeFileSync(process.env.COMMENT_FINGERPRINT_REPORT,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{
  // Only our exact temporary files, after validating their immediate directory.
  assert.equal(path.dirname(path.resolve(tmp)),path.resolve(os.tmpdir()));
  for(const version of ['baseline','candidate'])for(const suffix of ['.policy.mjs','.ts']){
    const file=path.join(tmp,version+suffix);if(fs.existsSync(file))fs.unlinkSync(file);
  }
  fs.rmdirSync(tmp);
}
