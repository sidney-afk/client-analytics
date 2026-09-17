'use strict';
// Finite observed baselines only. Never accepts an operator-provided target hash.
const assert=require('node:assert/strict'),j=require('./linear-exit-install-journal'),full=require('./linear-exit-observed-full-install-plan');
const OLD='809c5dc72a629d1c240631ca34e1050ac3ad559091b8c0127b8d5fab8cbf7edd',NEW='f5ed8a38a4454e62905192c49de9a6a790c1bb48e247884efed12562b1161c25';
// The 2026-09-16 settled state: the reviewed opt-out picture plus the owner's
// hiring migration exactly as merged on main at 1abdd1fa. Derived offline
// against an isolated PostgreSQL 17 and equal to that day's live read.
const SETTLED='ddfa4c4f0d97eefd5fbe4686756714e33ce6b4d977707d7ee8e9fb92f1bedd8c';
const RETIRED='RETIRED_D18_20260916_CANNOT_INSTALL_AFTER_B10';
const PENDING='PENDING_REMEASURE_ON_CURRENT_CHAIN';
const profiles={
 // PLANS re-measured 2026-09-16 after B10 moved them; TARGETS retired, see RETIRED above.
 // The old targets f3db4b7c... and 79710a7f... described the pre-B10 plans and are gone
 // rather than kept as numbers nothing can ever reproduce.
 observed67:{plan:'7043637f90378244f445d588680709d67f16cee7ee43170b2254f0edb78b3f1f',target:RETIRED,retired_reason:'D18 2026-09-16: refuses at install with application_admission_missing_owner:hiring_practical_test_jobs'},
 observed67_optout:{plan:'92a4737ffd13b3634aad76ed8ceded28966a66a4de0b09fb503fdd4a4c5d4021',target:RETIRED,retired_reason:'D18 2026-09-16: same refusal as observed67'},

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
 //
 // UPDATED 2026-09-17. Both values above this line were superseded by B10 and
 // are replaced, not adjusted.
 //
 // PLAN 508e6369... is measured twice, independently: the storage session's
 // calibration at ff9b379f read it from operator-plan.private.json, and this
 // session reproduced the same value offline from the repository's own files.
 // The offline reproduction is trustworthy because the same harness reproduces
 // every previously pinned plan hash exactly.
 //
 // TARGET 24c833c0... PINNED 2026-09-17, and the way it got here is the point.
 // It was first measured at ff9b379f. Nine files in the target-producing chain
 // then moved, two of them reachable from the calibration itself, so it was
 // deliberately NOT transcribed: a target is a measurement of a chain, and one
 // measured on a different chain is not this profile's target. The storage
 // session re-measured it on the current head and got the SAME value, compared
 // from disk rather than from a console. So it is pinned as a re-measurement,
 // not as a transcription that happened to be lucky.
 settled68:{plan:'508e63699a0f7d8fde2a4a3abf3f13c84780ced95d4b5c2702da4a54cc06f2bd',target:'24c833c01743cf9d6229e052819ff1d67006b29a962790d750abf84394c22187',contract:'settled68',stage_id:'OBSERVED_PUBLIC_20260916_SETTLED_FULL_PREPARATION_V1'}};
function has(name){return Object.hasOwn(profiles,name);}
/* A dead target is stated, never left as a plausible hash or a bare null.
 *
 * RETIRED (D18, 2026-09-16): observed67 and observed67_optout cannot install
 * after B10 -- the admission guard names hiring_practical_test_jobs, which only
 * the settled world has, so both refuse with
 * application_admission_missing_owner. The owner ruled that is not a regression
 * and must not be "fixed". A target for them would be a number describing a run
 * that will never happen, so each carries the marker and the reason instead.
 * Their PLANS stay: both are measured, both still build, and plan building is
 * still wanted.
 *
 * PENDING: a target that has to be measured, or re-measured, before it can be
 * pinned. Refusing by name beats a stale hash, which fails later and blames the
 * wrong thing. */
function get(name='observed67'){
 assert(has(name),'unknown installation profile');
 const profile=profiles[name];
 assert(profile.target!==RETIRED,'installation profile '+name+' is RETIRED (journal D18, 2026-09-16): it cannot install after B10, because the admission guard names a table only the settled world has. Its plan is still valid for building and comparison. Do not re-derive a target for it and do not relax the guard; install settled68 instead.');
 assert(profile.target!==PENDING,'installation profile '+name+' has no pinned target: it is awaiting re-measurement on the current chain. Derive it with a calibration run against the private inputs, review the numbers, then pin. Never write a hash here that was not read from a run.');
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
 // Building a PLAN must not require a TARGET. get() is the install-time gate and
 // asserts both; calling it here made a retired or not-yet-measured profile
 // unbuildable, which is wrong: a plan is exactly what such a profile still has.
 if(name==='observed67'){assert.equal(j.sha(j.canonical(catalog)),OLD);return full.build(catalog);}
 assert.equal(j.sha(j.canonical(catalog)),NEW,'exact opt-out observed baseline required');
 const old=structuredClone(catalog),t=old.tables.find(t=>t.name==='team_members');
 t.columns=t.columns.filter(c=>c.name!=='auto_assign_opt_out').map(c=>({...c,acl:null}));
 t.acl=t.acl.replace('anon=awdDxtm/','anon=arwdDxtm/').replace('authenticated=awdDxtm/','authenticated=arwdDxtm/');
 assert.equal(j.sha(j.canonical(old)),OLD,'only exact known source migration delta may be reversed for source planning');
 const prior=full.build(old),plan=JSON.parse(prior.planBytes);plan.initial_catalog_sha256=NEW;plan.stage_id='OBSERVED_PUBLIC_20260914_OPTOUT_FULL_PREPARATION_V1';
 const planBytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');return {...prior,planBytes,planSha256:j.sha(planBytes)};
}
module.exports={get,build,has};
