// Focused actual gateway/browser/SQL proof; fixture transport is synthetic only.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {gw,accepted,call,sql,rows} from './fixture.mjs';
import {ROOT} from '../native-intake-reconcile/load-gateway.mjs';
import {runSql,hooks,resetHooks} from '../native-intake-manifest/supabase-shim.mjs';
import {additional} from './overlap.mjs';
const checks=[],q=v=>"'"+String(v).replace(/'/g,"''")+"'";
const sha=v=>crypto.createHash('sha256').update(v,'utf8').digest('hex');
const check=(name,pass)=>{checks.push({name,pass:!!pass});if(!pass)throw new Error('check_failed:'+name);};
const names=['batches','deliverables','mirror_outbox','calendar_posts','sample_reviews','production_card_provenance','card_change_journal','production_card_materialization_receipts'];
async function facts(){return await sql('select jsonb_object_agg(name,images)::text from ('+names.map(t=>`select '${t}' name,(select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from public.${t} t) images`).join(' union all ')+') t;');}
async function snapshot(c){return (await rows(`select * from public.${c.surface==='samples'?'sample_reviews':'calendar_posts'} where client=${q(c.body.client)} and id=${q(c.body[c.surface==='samples'?'sample':'post'].id)}`))[0];}
async function activate(){await sql("update public.syncview_runtime_flags set value=value||'{\"mode\":\"native\",\"epoch\":\"synthetic-coverage-v1\"}'::jsonb where key='native_card_materialization';");}
try{
  const held=await accepted();const before=await facts(),h=await call(held.body);
  check('default hold conserves exact received body without card/receipt mutation',!h.ok&&h.conserved&&h.reason==='admission_held'&&before===await facts());
  const heldIngress=(await rows('select raw_body,raw_sha256 from public.production_card_materialization_ingress where id='+q(h.ingress_id)))[0];
  check('ingress stores supplied raw text and SHA256',heldIngress.raw_body===JSON.stringify(held.body)&&heldIngress.raw_sha256===sha(JSON.stringify(held.body)));
  await activate();
  // No retained production payload fixture is invented: all six envelopes are
  // emitted by the actual browser function after actual gateway acceptance.
  const cases=[];
  for(const surface of ['calendar','samples'])for(const mode of ['video','thumbnail','both']){
    const c=await accepted(mode,surface);const a=await call(c.body,c.surface,c.source);const current=await snapshot(c);
    if(!a.ok)fs.writeFileSync(path.join(process.env.NATIVE_CARD_TEST_OUTPUT,'creation-failure.private.json'),JSON.stringify({response:a,body:c.body},null,2));
    check(surface+' '+mode+' exact creation owns full current row',a.ok&&a.outcome==='created'&&a[surface==='samples'?'sample':'post']?.id===current?.id&&current?.name===c.body[surface==='samples'?'sample':'post'].name);
    cases.push(c);
  }
  const c=cases[2],card=c.body.post;
  await sql(`update public.calendar_posts set name='Human title',caption='Human caption',status='Approved',order_index='901' where client=${q(c.body.client)} and id=${q(card.id)};`);
  const human=await facts();const replay=JSON.parse(JSON.stringify(c.body));replay.post.order_index+=72;
  const rr=await call(replay);
  check('lost response replay returns full later human content without mutation',rr.ok&&rr.outcome==='replayed'&&rr.post.name==='Human title'&&rr.post.caption==='Human caption'&&rr.post.order_index==='901'&&human===await facts());
  for(const [name,edit] of [['body',p=>p.post.caption='New caller text'],['client',p=>p.client='different-client'],['children',p=>p.post.video_deliverable_id='other-child'],['extra field',p=>p.post.actor='claimed-admin']]){
    const p=JSON.parse(JSON.stringify(c.body));edit(p);const f=await facts(),r=await call(p);
    check('changed '+name+' retains refusal and cannot adopt receipt',!r.ok&&r.conserved&&f===await facts());
  }
  const raw=' { "client" : "unknown-fictional", "post" : {"id":"unknown","order_index":1} }\n';
  const u=await call(null,'calendar','submission-native',raw);
  const unknown=(await rows('select raw_body,raw_sha256 from public.production_card_materialization_ingress where id='+q(u.ingress_id)))[0];
  check('unknown raw text survives returned refusal byte for byte',!u.ok&&u.conserved&&unknown.raw_body===raw&&unknown.raw_sha256===sha(raw));
  const bad=await call(null,'calendar','submission-native','{unparseable');
  const malformed=(await rows('select raw_sha256 from public.production_card_materialization_ingress where id='+q(bad.ingress_id)))[0];
  check('malformed JSON retained with typed non-success',!bad.ok&&bad.conserved&&malformed.raw_sha256===sha('{unparseable'));
  const outside=await call(c.body,'calendar','ui');check('ordinary ui remains outside native adapter',!outside.ok&&outside.reason==='source_outside_adapter');
  const noMarker=await call(c.body,'calendar','');check('blank marker cannot authorize creation',!noMarker.ok);
  await sql(`update public.calendar_posts set status='Archived' where client=${q(c.body.client)} and id=${q(card.id)};`);
  check('archived replay remains held',!(await call(c.body)).ok);
  await sql(`update public.calendar_posts set status='Approved' where client=${q(c.body.client)} and id=${q(card.id)};`);
  check('human reopen returns current row without inferred original state',(await call(c.body)).post?.status==='Approved');
  const deleted=cases[0];await sql(`delete from public.calendar_posts where client=${q(deleted.body.client)} and id=${q(deleted.body.post.id)};`);
  const tomb=await facts();check('deleted accepted card never resurrects',!(await call(deleted.body)).ok&&tomb===await facts());
  await sql(`insert into public.calendar_posts(client,id,name,status) values(${q(deleted.body.client)},${q(deleted.body.post.id)},'Replacement incarnation','In Progress');`);
  check('reused card ID cannot adopt old accepted receipt',!(await call(deleted.body)).ok);
  const missing=cases[1];await sql(`delete from public.production_card_provenance where surface='calendar' and client=${q(missing.body.client)} and card_id=${q(missing.body.post.id)};`);
  check('missing provenance is held',!(await call(missing.body)).ok);
  for(const table of ['production_card_materialization_receipts','production_card_materialization_ingress']){
    for(const operation of ['update '+table+' set id=id','delete from '+table,'truncate '+table]){
      const r=await runSql(operation);check('retention '+table+' '+operation.split(' ')[0],r.status!==0&&r.stderr.includes('card_materialization_evidence_retained'));
    }
    const r=await runSql('set role anon;select * from public.'+table);check('anonymous cannot read '+table,r.status!==0);
    check('authenticated cannot read '+table,(await runSql('set role authenticated;select * from public.'+table)).status!==0);
    check('service cannot directly insert '+table,(await runSql('set role service_role;insert into public.'+table+' default values;')).stderr.includes('permission denied'));
  }
  check('anonymous cannot execute service adapter',(await runSql("set role anon;select public.production_card_materialize('calendar','submission-native','{}');")).status!==0);
  check('authenticated cannot execute service adapter',(await runSql("set role authenticated;select public.production_card_materialize('calendar','submission-native','{}');")).status!==0);
  // Real storage failures after acceptance must conserve all earlier owners.
  for(const target of ['card_change_journal','production_card_provenance','production_card_materialization_receipts']){
    const f=await accepted('video');const b=await facts();
    await sql('alter table public.'+target+' add constraint synthetic_late_fault check(false) not valid;');
    const r=await call(f.body);await sql('alter table public.'+target+' drop constraint synthetic_late_fault;');
    check(target+' failure rolls back card/provenance/journal/receipt but retains refusal',!r.ok&&r.conserved&&b===await facts());
  }
  const ingressFailure=await accepted('video'),ib=await facts();
  await sql('alter table public.production_card_materialization_ingress add constraint synthetic_ingress_fault check(false) not valid;');
  const ir=await runSql(`select public.production_card_materialize('calendar','submission-native',${q(JSON.stringify(ingressFailure.body))});`);
  await sql('alter table public.production_card_materialization_ingress drop constraint synthetic_ingress_fault;');
  check('ingress failure cannot acknowledge acceptance or leave untracked card',ir.status!==0&&ib===await facts());
  await additional(check,facts);
  check('provider and drainer requests remain absent in this lane',!gw.net.requests.some(r=>/api\.linear\.app|linear-outbound/.test(r.url)));
}catch(error){fs.writeFileSync(path.join(process.env.NATIVE_CARD_TEST_OUTPUT,'failure.private.log'),String(error.stack));if(!checks.some(c=>!c.pass))checks.push({name:'fixture_execution_completed',pass:false});}
const report={classification:'ACTUAL_GATEWAY_SQL_EXTRACTED_BROWSER_SYNTHETIC',passed:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass).length,checks,
  migration_sha256:sha(fs.readFileSync(path.join(ROOT,'migrations/2026-09-06-native-card-materialization-boundary.sql'))),
  source_sha256:Object.fromEntries(['supabase/functions/production-write/index.ts','index.html','scripts/native-card-materialization/fixture.mjs','scripts/native-card-materialization/overlap.mjs','scripts/native-card-materialization/lane.mjs','test/native-card-materialization.js'].map(p=>[p,sha(fs.readFileSync(path.join(ROOT,p)))]))};
fs.writeFileSync(path.join(process.env.NATIVE_CARD_TEST_OUTPUT,'receipt.json'),JSON.stringify(report,null,2)+'\n');
console.log('NATIVE_CARD_RESULT '+JSON.stringify(report));process.exitCode=report.failed?1:0;
