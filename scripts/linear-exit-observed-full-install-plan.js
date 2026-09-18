'use strict';
// Explicit next preparation profile. The historical 35-source plan remains immutable.
// This builder never executes SQL and never authorizes installation.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const previous=require('./linear-exit-observed-install-plan'),journal=require('./linear-exit-install-journal');
const ROOT=path.resolve(__dirname,'..');
const OWNERS=[
 ['20260913034324_provider_send_admission_preparation.sql','a9e2783a504581a6005340fa98f727e36997dd7b2a28cb5631850bc592227e87'],
 ['20260913043506_provider_checkpoint_recovery_preparation.sql','b9193ac99bf6efa2f36667951247458f63fbe056488c81f005ddb9900483581c'],
 ['20260913044451_write_refusal_diagnostics_preparation.sql','4b3efa038c40b72b1c85dc22bad02527d115d13a80f2b8e96dd583a906dcf705'],
 ['20260913044939_provider_ack_receipt_recovery_preparation.sql','7371fa1e0e4e2d1a3123d77d3f4f59a61b4e1bdecf0136257e0e60e0dc781cf2'],
 ['20260913045704_provider_comment_recovery_preparation.sql','7b89ab00540e9cdf2cd4d0ce7bc1ac033f7b6510f8cf2b72619ff8a5e275da99'],
 ['20260913051511_provider_create_recovery_preparation.sql','196b6a2c92a5e9f20920960e52bc41471730b020a47ef7f703bebd6c7327446a'],
 ['20260913054339_provider_create_observation_recovery_preparation.sql','f2c9a80e6bc4871c81f01e8659d587d23aa16dfc90ffa3ef388069ebc5066ee5'],
 ['20260913055621_provider_recorded_create_linkage_recovery_preparation.sql','f9a5a1915c4adb96cc3c0ef90f8c4cfe769ce8b46ec989c9c1250a0bb532414e'],
 ['20260913062741_provider_terminal_history_preparation.sql','e06124eb54b7920cab8b1a14d6c7ce8bcb08b4f14a8393c5552191095ea43ea0'],
 ['20260913190840_provider_terminal_private_acl_preparation.sql','439db3390b299b519af1a110bb0678ee8680d4b88be5c5ceb96faf1aae108942'],
 ['20260913181213_provider_comment_observation_recovery_preparation.sql','b92fbbe60b3e64d4cc3da7f297d3c6f6900cb7aaf225f1f6e0151ef55ea3004b'],
 ['20260913183021_provider_issue_observation_recovery_preparation.sql','5c5e24aef2c2710975d769378f58c812a78a32ff2e5eeb2392e36c515e5d33a2'],
 ['20260913062149_retirement_switch_preparation.sql','5ce4fac33f723a4e6353386183772f0108d52894d20f772cfaa0cb9f5c4939f2']
].map(([file,sha256])=>Object.freeze({path:'supabase/migrations/'+file,sha256}));
Object.freeze(OWNERS);
// Journal statement parsing normalizes line endings. Encode CR-bearing routine bodies
// before parsing, preserving their actual PostgreSQL text without changing old plans.
function routineTransport(sql){return sql.replace(/(^create\s+(?:or\s+replace\s+)?function\s+[\s\S]*?\bas\s+)(\$[a-zA-Z_0-9]*\$)([\s\S]*?)\2/gim,(whole,head,delimiter,body)=>body.includes('\r')?head+"E'"+body.replace(/\\/g,'\\\\').replace(/'/g,"''").replace(/\r/g,'\\r').replace(/\n/g,'\\n')+"'":whole);}
function build(catalog,opts){
 const base=previous.build(catalog,opts),plan=JSON.parse(base.planBytes);
 assert.equal(plan.sources.length,35,'review historical profile changes explicitly');
 for(const owner of OWNERS){
  assert(!plan.sources.some(s=>s.id===owner.path),'duplicate owner');
  const bytes=fs.readFileSync(path.join(ROOT,owner.path));assert.equal(journal.sha(bytes),owner.sha256,'full preparation owner source drift');
  const sql=routineTransport(previous.sqlTransport(bytes.toString('utf8')));
  plan.sources.push({id:owner.path,sql,sha256:journal.sha(sql),original_sha256:owner.sha256,dependencies:[plan.sources.at(-1).id]});
 }
 plan.stage_id='OBSERVED_PUBLIC_20260912_FULL_PREPARATION_V1';
 const planBytes=Buffer.from(JSON.stringify(plan,null,2)+'\n'),planSha256=journal.sha(planBytes);
 journal.compile(planBytes,planSha256);
 return {...base,planBytes,planSha256,predecessor_plan_sha256:base.planSha256,
  scope:'ISOLATED_FULL_PREPARATION_SOURCE_PLAN',target_catalog_sha256:null,
  target_must_be_derived_and_reviewed:true,private_control_recovery_required:true};
}
module.exports={build,OWNERS,routineTransport};
