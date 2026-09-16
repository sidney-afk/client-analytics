'use strict';
// Finite observed baselines only. Never accepts an operator-provided target hash.
const assert=require('node:assert/strict'),j=require('./linear-exit-install-journal'),full=require('./linear-exit-observed-full-install-plan');
const OLD='809c5dc72a629d1c240631ca34e1050ac3ad559091b8c0127b8d5fab8cbf7edd',NEW='f5ed8a38a4454e62905192c49de9a6a790c1bb48e247884efed12562b1161c25';
// The 2026-09-16 settled state: the reviewed opt-out picture plus the owner's
// hiring migration exactly as merged on main at 1abdd1fa. Derived offline
// against an isolated PostgreSQL 17 and equal to that day's live read.
const SETTLED='ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c';
const profiles={observed67:{plan:'3c000b76db5cf6dc31a90b61ad7dc7751d6ce02c74b6d40939dbbcccbe6acbfb',target:'f3db4b7cd0649800e4811d1c4b32cf3f37e5c2bf951d4b12d22009faf08aa28f'},observed67_optout:{plan:'0c88914972800f8268a9a5857535ca8cb624f6b25460b19b34091ea4b58ced57',target:'79710a7f96855c6f3975ab88558e9c6f3b51ffc01a7b7d56a2508982955456f0'},
 // FULLY PINNED as of 2026-09-16. Both values are MEASURED, never chosen, and a
 // hash in either slot is only ever one read whole from a run.
 //
 // PLAN. Read whole from one --plan-from run against the real settled catalog,
 // which also reported initial_catalog_sha256 equal to the settled catalog hash,
 // proving the plan was built against the settled picture and not a stale
 // contract.
 //
 // TARGET. Derived by the settled68 calibration at cd6f1808 on a fresh
 // PostgreSQL 17: file settled68-target.private.json, 1,613,093 bytes, built
 // under plan e3dae746... from starting catalog ddfa4c4f..., installed public
 // catalog 0d4eb7dc..., private fccae16a.... Post-install public table count
 // 91, which is the number derived once from the settled contract before the
 // run and confirmed by two independent measurements inside it -- the worker's
 // guard count and the target builder's table count -- neither of which was
 // given the number. The derivation stands; this is the target it produced.
 //
 // TRANSCRIPTION STATUS, recorded because the hash rule says a hash is read
 // from a command's output and this one was not read by this session: the file
 // is private and only the storage session can read it, so the value arrived
 // through chat. The storage session re-reads its own file and confirms the
 // committed value. Until that confirmation lands, treat this pin as committed
 // but not closed. A plausible-looking hash in either slot would be exactly the
 // silencing D8 forbids, and a transcription error is the way one gets here now
 // that both values are real.
 settled68:{plan:'e3dae746b148fe18839209445e8b2142372335b18127430ba2d827f13cd27d54',target:'625430979c5508f2a87b18bfa9d7135806273c909c3f5baf9f5a5fe835f97356',contract:'settled68',stage_id:'OBSERVED_PUBLIC_20260916_SETTLED_FULL_PREPARATION_V1'}};
function has(name){return Object.hasOwn(profiles,name);}
function get(name='observed67'){
 assert(has(name),'unknown installation profile');
 const profile=profiles[name];
 assert(profile.plan&&profile.target,'installation profile '+name+' is not pinned yet: derive its plan and target, review them, then pin. Never write a hash here that was not read from a run.');
 return profile;
}
function build(catalog,name='observed67'){
 assert(has(name),'unknown installation profile');
 if(name==='settled68'){
  // Route B, the reviewed decision of 2026-09-16: no delta is reversed. The
  // plan builds DIRECTLY from the settled catalog, because the contract it is
  // compared against is the settled one. The hiring delta spans six object
  // classes and would not reverse the way the single-column opt-out delta did.
  assert.equal(j.sha(j.canonical(catalog)),SETTLED,'exact settled observed baseline required');
  const prior=full.build(catalog,{contract:profiles.settled68.contract}),plan=JSON.parse(prior.planBytes);
  assert.equal(plan.initial_catalog_sha256,SETTLED,'settled plan must declare the settled starting catalog');
  plan.stage_id=profiles.settled68.stage_id;
  const planBytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');return {...prior,planBytes,planSha256:j.sha(planBytes)};
 }
 get(name);if(name==='observed67'){assert.equal(j.sha(j.canonical(catalog)),OLD);return full.build(catalog);}
 assert.equal(j.sha(j.canonical(catalog)),NEW,'exact opt-out observed baseline required');
 const old=structuredClone(catalog),t=old.tables.find(t=>t.name==='team_members');
 t.columns=t.columns.filter(c=>c.name!=='auto_assign_opt_out').map(c=>({...c,acl:null}));
 t.acl=t.acl.replace('anon=awdDxtm/','anon=arwdDxtm/').replace('authenticated=awdDxtm/','authenticated=arwdDxtm/');
 assert.equal(j.sha(j.canonical(old)),OLD,'only exact known source migration delta may be reversed for source planning');
 const prior=full.build(old),plan=JSON.parse(prior.planBytes);plan.initial_catalog_sha256=NEW;plan.stage_id='OBSERVED_PUBLIC_20260914_OPTOUT_FULL_PREPARATION_V1';
 const planBytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');return {...prior,planBytes,planSha256:j.sha(planBytes)};
}
module.exports={get,build,has};
