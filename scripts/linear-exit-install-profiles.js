'use strict';
// Finite observed baselines only. Never accepts an operator-provided target hash.
const assert=require('node:assert/strict'),j=require('./linear-exit-install-journal'),full=require('./linear-exit-observed-full-install-plan');
const OLD='809c5dc72a629d1c240631ca34e1050ac3ad559091b8c0127b8d5fab8cbf7edd',NEW='f5ed8a38a4454e62905192c49de9a6a790c1bb48e247884efed12562b1161c25';
const profiles={observed67:{plan:'3c000b76db5cf6dc31a90b61ad7dc7751d6ce02c74b6d40939dbbcccbe6acbfb',target:'f3db4b7cd0649800e4811d1c4b32cf3f37e5c2bf951d4b12d22009faf08aa28f'},observed67_optout:{plan:'0c88914972800f8268a9a5857535ca8cb624f6b25460b19b34091ea4b58ced57',target:'79710a7f96855c6f3975ab88558e9c6f3b51ffc01a7b7d56a2508982955456f0'}};
function get(name='observed67'){assert(Object.hasOwn(profiles,name),'unknown installation profile');return profiles[name];}
function build(catalog,name='observed67'){
 get(name);if(name==='observed67'){assert.equal(j.sha(j.canonical(catalog)),OLD);return full.build(catalog);}
 assert.equal(j.sha(j.canonical(catalog)),NEW,'exact opt-out observed baseline required');
 const old=structuredClone(catalog),t=old.tables.find(t=>t.name==='team_members');
 t.columns=t.columns.filter(c=>c.name!=='auto_assign_opt_out').map(c=>({...c,acl:null}));
 t.acl=t.acl.replace('anon=awdDxtm/','anon=arwdDxtm/').replace('authenticated=awdDxtm/','authenticated=arwdDxtm/');
 assert.equal(j.sha(j.canonical(old)),OLD,'only exact known source migration delta may be reversed for source planning');
 const prior=full.build(old),plan=JSON.parse(prior.planBytes);plan.initial_catalog_sha256=NEW;plan.stage_id='OBSERVED_PUBLIC_20260914_OPTOUT_FULL_PREPARATION_V1';
 const planBytes=Buffer.from(JSON.stringify(plan,null,2)+'\n');return {...prior,planBytes,planSha256:j.sha(planBytes)};
}
module.exports={get,build};
