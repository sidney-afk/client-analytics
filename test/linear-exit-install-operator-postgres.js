'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),cp=require('child_process');
const ROOT=path.resolve(__dirname,'..'),E=process.env.OBSERVED_INPUT_DIRECTORY,out=process.env.PROOF_OUTPUT_ROOT;
assert(E&&path.isAbsolute(E)&&out&&path.isAbsolute(out));assert.equal(process.env.F63_REQUIRE_POSTGRES,'1');for(const k of ['PGHOSTADDR','PGSERVICE','PGSERVICEFILE','PGOPTIONS'])assert(!process.env[k]);assert(!Object.keys(process.env).some(k=>/^SUPABASE/i.test(k)));
const {Cluster}=require('../scripts/f42-apply-rehearsal'),j=require('../scripts/linear-exit-install-journal'),catalog=require('../scripts/linear-exit-source-baseline-catalog');const c=new Cluster();assert.equal(c.host,'127.0.0.1');
const files=['scripts/linear-exit-install-operator.js','scripts/linear-exit-install-profiles.js','test/linear-exit-install-operator-postgres.js','test/helpers/install-operator-worker.mjs'];const pins=()=>files.map(file=>({file,sha256:j.sha(fs.readFileSync(path.join(ROOT,file)))})),before=pins();
try{c.start();require('../scripts/linear-exit-observed-schema').applyObservedSchema(c,{inputDirectory:E,outputDirectory:out});c.exec('alter table storage.buckets alter column name set not null; alter table storage.buckets add column public boolean, add column file_size_limit bigint, add column allowed_mime_types text[];');
 const prerequisite=cp.execFileSync('git',['show','73d5fdc361:migrations/2026-09-14-team-members-auto-assign-opt-out.sql'],{cwd:ROOT});assert.equal(j.sha(prerequisite),'fbd5ae8ecbef6e28cce913878791cb5f2a2a7fc70a7c930d3c0d3b508966fbaa');const prerequisiteFile=path.join(out,'autoassign-prerequisite.private.sql');fs.writeFileSync(prerequisiteFile,prerequisite,{flag:'wx'});
 const profile=process.env.INSTALL_OPERATOR_PROFILE||'observed67';assert(['observed67','observed67_optout','settled68'].includes(profile));
 // What each profile ADDS on top of the observed schema. A table rather than a
 // chain of ifs, for the reason the guard counts stopped being literals: the
 // next profile should be a row, not a branch. settled68 is not a separate
 // construction -- it is the opt-out world plus the hiring migration, which is
 // on main at 1abdd1fa. Recipe proven by scripts/linear-exit-b9-catalog-derive.js,
 // which built the settled catalog the owner byte-confirmed on 2026-09-16.
 const SETUP={observed67:{optout:false,hiring:false},observed67_optout:{optout:true,hiring:false},settled68:{optout:true,hiring:true}};
 const setup=SETUP[profile];assert(setup,'no setup row for profile');
 if(setup.optout){c.exec(prerequisite.toString('utf8'));c.exec("insert into public.team_members(id,name,role,auto_assign_opt_out) values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','ISOLATED OPERATOR FIXTURE','editor',true)");}
 if(setup.hiring){c.exec(fs.readFileSync(path.join(ROOT,'migrations/2026-09-15-hiring-video-editor-role.sql')).toString('utf8'));}
 const initial=c.scalarJson(catalog.query()),built=require('../scripts/linear-exit-install-profiles').build(initial,profile),plan=path.join(out,'operator-plan.private.json');fs.writeFileSync(plan,built.planBytes,{flag:'wx'});
 const target=profile==='observed67'?path.join(E,'linear-exit-observed-full-install-332df4aeaf7b48218006e705b9128ff7/full-target.private.json'):process.env.INSTALL_OPERATOR_TARGET;
 if(process.env.INSTALL_OPERATOR_CALIBRATE!=='1')assert.equal(j.sha(fs.readFileSync(target)),require('../scripts/linear-exit-install-profiles').get(profile).target);
 const env={...process.env,JOURNAL_DATABASE:c.db,JOURNAL_PLAN:plan,JOURNAL_IDENTITY:JSON.stringify(c.scalarJson(j.IDENTITY_SQL)),INSTALL_OPERATOR_TARGET:target,INSTALL_OPERATOR_PREREQUISITE:prerequisiteFile};
 const r=cp.spawnSync('deno',['run','--unstable-detect-cjs','--no-config','--lock=qa/linear-exit-rehearsal/followup-deno.lock','--frozen','--cached-only','--allow-read','--allow-write='+out,'--allow-env','--allow-net=127.0.0.1','test/helpers/install-operator-worker.mjs'],{cwd:ROOT,env,encoding:'utf8',windowsHide:true,timeout:600000,maxBuffer:4*1024*1024});fs.writeFileSync(path.join(out,'operator-worker.private.json'),JSON.stringify({status:r.status,stdout:r.stdout,stderr:r.stderr,error:r.error?.message}));assert.equal(r.status,0);assert.deepEqual(pins(),before);fs.writeFileSync(path.join(out,'operator-source-pins.private.json'),JSON.stringify(before));console.log('LINEAR_EXIT_INSTALL_OPERATOR_OK');
}catch(e){fs.writeFileSync(path.join(out,'operator-error.private.log'),String(e.stack));console.error('INSTALL_OPERATOR_PROOF_FAILED');process.exitCode=1;}finally{c.stop();}
