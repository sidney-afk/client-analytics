'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawnSync,spawn}=require('node:child_process');
if(process.env.G8_TEST_CONFIRM!=='LOCAL_DISPOSABLE_ONLY'){
 if(process.env.G8_TEST_REQUIRE==='1')throw Error('Required G8 lane needs explicit disposable confirmation');
 console.log('SKIP G8 PostgreSQL lane: explicit disposable instance required (UNPROVEN)');process.exit(0);
}
const psql=process.env.G8_TEST_PSQL,port=process.env.G8_TEST_PORT;
if(!psql||!path.isAbsolute(psql)||!/^[0-9]{4,5}$/.test(port||''))throw Error('Explicit psql and disposable loopback port required');
const db='g8_'+crypto.randomBytes(8).toString('hex');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^PG/i.test(k)));
if(process.env.G8_TEST_PASSWORD!==undefined)env.PGPASSWORD=process.env.G8_TEST_PASSWORD;
const args=d=>['-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',port,'-U','postgres','-d',d];
function run(text,d=db,refuse=false){const r=spawnSync(psql,args(d),{input:text,encoding:'utf8',env,timeout:30000,maxBuffer:8e6});if(refuse){assert.notEqual(r.status,0,'negative must refuse');return r.stderr;}if(r.status)throw Error(r.stderr);return r.stdout.trim();}
const migration=fs.readFileSync(path.join(__dirname,'..','migrations/2026-09-06-linear-outbound-cutoff.sql'),'utf8');
let checks=0,passed=false;const ok=(v,m)=>{assert.ok(v,m);checks++;};
(async()=>{run(`create database ${db}`,'postgres');try{
 run(`do $$begin create role anon;exception when duplicate_object then null;end$$;do $$begin create role authenticated;exception when duplicate_object then null;end$$;do $$begin create role service_role;exception when duplicate_object then null;end$$;
 create table mirror_outbox(id bigserial primary key,dedup_key text unique,status text not null default 'pending',lock_token uuid,locked_at timestamptz,updated_at timestamptz default now());
 create table deliverables(id text primary key,body text);create table production_comments(id text primary key,body text);`);
 run(migration);ok(JSON.parse(run(`select row_to_json(c) from linear_outbound_cutoff_control c`)).cutoff_enabled===false,'default inactive');
 run(`insert into mirror_outbox(dedup_key)values('normal'),('raced'),('claimed-only')`);
 const child=spawn(psql,args(db),{env,stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);
 child.stdin.end(`begin;select linear_outbound_claim_v1(2,'pending',600);select pg_sleep(1);commit;`);
 await new Promise(r=>setTimeout(r,200));
 ok(run(`select linear_outbound_claim_v1(2,'pending',600)`) === '', 'concurrent second worker cannot steal claim');
 await new Promise((res,rej)=>child.on('close',c=>c?rej(Error(err)):res()));
 const claimed=JSON.parse(out.split('\n').find(x=>x.trim().startsWith('{')));ok(claimed.id===2,'first concurrent worker owns lease');
 const normal=JSON.parse(run(`select linear_outbound_claim_v1(1,'pending',600)`));
 const auth=JSON.parse(run(`select linear_outbound_authorize_dispatch_v1(1,'${normal.lock_token}',0)`));ok(auth.authorized===true,'normal dispatch authorized');
 run(`update mirror_outbox set status='written',lock_token=null where id=1 and lock_token='${normal.lock_token}'`);
 ok(run(`select linear_outbound_claim_v1(1,'pending',600)`) === '', 'lost response replay cannot redispatch terminal receipt');
 const claimedOnly=JSON.parse(run(`select linear_outbound_claim_v1(3,'pending',600)`));ok(claimedOnly.id===3,'pre-cutoff un-dispatched claim exists');
 const racedAuth=JSON.parse(run(`select linear_outbound_authorize_dispatch_v1(2,'${claimed.lock_token}',0)`));ok(racedAuth.authorized===true,'pre-cutoff dispatch accounted');
 const cutoff=JSON.parse(run(`select linear_outbound_cutoff_activate_v1(0,'fictional-operator')`));ok(cutoff.generation===1&&cutoff.high_water_id===3,'atomic generation/high-water cutoff');
 run(`update mirror_outbox set status='written' where id=2 and lock_token='${claimed.lock_token}'`,db,true);checks++;
 run(`insert into mirror_outbox(dedup_key)values('after-cutoff');insert into deliverables values('native-write','accepted');insert into production_comments values('feedback-receipt','accepted')`);
 ok(run(`select cutoff_disposition from mirror_outbox where dedup_key='after-cutoff'`)==='accepted_after_cutoff','new provider debt held/classified');
 ok(run(`select linear_outbound_claim_v1(4,'pending',600)`) === '','cutoff stops new claim');
 const conservation=JSON.parse(run(`select json_build_object('total',(select count(*) from mirror_outbox),'written',(select count(*) from mirror_outbox where status='written'),'pending_classified',(select count(*) from mirror_outbox where status='pending' and cutoff_disposition is not null),'native',(select count(*) from deliverables),'feedback',(select count(*) from production_comments))`));
 ok(conservation.total===4&&conservation.written===1&&conservation.pending_classified===3,'accepted receipts and classified debt conserved exactly');
 ok(conservation.native===1&&conservation.feedback===1,'native write and feedback receipt survive cutoff');
 run(`delete from linear_outbound_cutoff_control`);run(`select linear_outbound_claim_v1(4,'pending',600)`,db,true);checks++;
 passed=true;console.log(JSON.stringify({classification:'DISPOSABLE_POSTGRES',checks,workers:2,accepted_receipts:4,classified_pending_debt:3,external_calls:0,limits:['mirror_outbox claim/mutation dispatch only','no serving/install/live proof','inbound/reconcile/browser/n8n/F27/provider controls uncovered']}));
 }finally{if(passed)run(`drop database ${db}`,'postgres');else console.error('Failed disposable database preserved: '+db)}})().catch(e=>{console.error(e);process.exitCode=1});
