#!/usr/bin/env node
'use strict';
// Offline Git-object rehearsal. Never merges, fetches, pushes or moves a branch.
const fs=require('fs'),path=require('path'),cp=require('child_process'),crypto=require('crypto');
const KNOWN=['.github/workflows/deploy-f27-section4-closures.yml','EXECUTION_LOG.md','test/f27-section4-deploy-lane.js'];
const REQUIRED_TESTS=['test/f27-section4-deploy-lane.js','test/workload-capacity-placement.js','test/workload-plan-source.js','test/workload-tweak-exclusive-bucket.js','identity-exposure'];
function run(cwd,args,input){return cp.execFileSync('git',args,{cwd,input,encoding:'utf8',maxBuffer:16*1024*1024,windowsHide:true});}
function resolve(text,file){
 let count=0;
 const out=text.replace(/^<<<<<<<[^\n]*\n([\s\S]*?)^\|\|\|\|\|\|\|[^\n]*\n([\s\S]*?)^=======\r?\n([\s\S]*?)^>>>>>>>[^\n]*(?:\n|$)/gm,(_,ours,base,theirs)=>{
  count++;
  if(file==='EXECUTION_LOG.md'){
   if(base.trim()||!ours.trimStart().startsWith('## ')||!theirs.trimStart().startsWith('## '))throw Error('STOP_LOG_NOT_INDEPENDENT_ADDITIONS');
   return ours+'\n'+theirs;
  }
  const allowed=file.endsWith('.yml')?/^(?:\s*#.*|\s*PRODUCTION_WRITE_(?:SOURCE_SHA256|ENTRYPOINT_SHA256|FILE_COUNT):\s*['"]?[a-f0-9]+['"]?\s*|\s*)$/:/^(?:\s*\/\/.*|\s*(?:source|entrypoint|files):\s*(?:'[a-f0-9]+'|\d+),\s*|\s*)$/;
  for(const section of [ours,base,theirs])if(!section.split(/\r?\n/).every(line=>allowed.test(line)))throw Error('STOP_NON_PIN_CONFLICT');
  // Keep all provenance comments; values are recalculated from the combined code below.
  const comments=theirs.split(/\r?\n/).filter(line=>/^\s*(?:#|\/\/)/.test(line)).join('\n');
  return comments+'\n'+ours;
 });
 if(!count||/^(?:<<<<<<<|=======|>>>>>>>|\|\|\|\|\|\|\|)/m.test(out))throw Error('STOP_UNRESOLVED_CONFLICT');
 return out;
}
function replaceOne(text,regex,value){let n=0;const result=text.replace(regex,()=>{n++;return value;});if(n!==1)throw Error('STOP_PIN_SHAPE');return result;}
function repin(work,revision){
 const report=JSON.parse(cp.execFileSync(process.execPath,['scripts/ef-fingerprint.js',revision,'--slugs=production-write','--expected-only','--format=json'],{cwd:work,encoding:'utf8',windowsHide:true}));
 const row=report.results[0];if(report.results.length!==1||row.slug!=='production-write'||!/^[a-f0-9]{64}$/.test(row.expected_fingerprint)||!Number.isInteger(row.expected_files))throw Error('STOP_FINGERPRINT_SHAPE');
 const entry=crypto.createHash('sha256').update(row.expected_entrypoint).digest('hex');
 let file=path.join(work,KNOWN[0]),text=fs.readFileSync(file,'utf8');
 for(const [key,value] of [['SOURCE_SHA256',row.expected_fingerprint],['ENTRYPOINT_SHA256',entry],['FILE_COUNT',"'"+row.expected_files+"'"]])text=replaceOne(text,new RegExp('^      PRODUCTION_WRITE_'+key+':[^\\n]*','gm'),'      PRODUCTION_WRITE_'+key+': '+value);
 fs.writeFileSync(file,text);
 file=path.join(work,KNOWN[2]);text=fs.readFileSync(file,'utf8');
 let changed=0;text=text.replace(/(\['production-write', \{)([\s\S]*?)(\n\s*\}\],)/g,(_,a,b,c)=>{changed++;b=replaceOne(b,/^    source: '[a-f0-9]+',/gm,"    source: '"+row.expected_fingerprint+"',");b=replaceOne(b,/^    entrypoint: '[a-f0-9]+',/gm,"    entrypoint: '"+entry+"',");b=replaceOne(b,/^    files: \d+,/gm,'    files: '+row.expected_files+',');return a+b+c;});
 if(changed!==1)throw Error('STOP_TEST_SHAPE');fs.writeFileSync(file,text);
 return {source_sha256:row.expected_fingerprint,entrypoint_sha256:entry,files:row.expected_files};
}
function snapshot(work){const tree=run(work,['write-tree']).trim();return run(work,['commit-tree',tree,'-p',run(work,['rev-parse','HEAD']).trim(),'-m','Unpublished catch-up rehearsal snapshot']).trim();}
function assertResolutionState(receipt,state){
 const sameSet=(a,b)=>Array.isArray(a)&&a.length===b.length&&JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
 if(!receipt||!state||!['source_head','main','base','snapshot','tree'].every(k=>/^[a-f0-9]{40}$/.test(receipt[k]||''))||receipt.source_branch_merged!==false||!Array.isArray(receipt.tests)||!sameSet(receipt.tests.map(x=>x?.test),REQUIRED_TESTS)||receipt.tests.some(x=>x.status!==0)||!sameSet(receipt.conflicts,KNOWN)||!sameSet(state.conflicts,KNOWN)||state.head!==receipt.source_head||state.merge!==receipt.main||!receipt.resolved_files||!KNOWN.every(f=>/^[a-f0-9]{64}$/.test(receipt.resolved_files[f]||'')))throw Error('STOP_RESOLUTION_STATE');
}
function conflictText(text){return text.replace(/\r\n/g,'\n').replace(/^(<<<<<<<|\|\|\|\|\|\|\||>>>>>>>)[^\n]*$/gm,'$1');}
function assertFreshConflict(root,file,receipt){
 const temp=fs.mkdtempSync(path.join(require('os').tmpdir(),'linear-exit-conflict-'));
 try{
  const revisions=[receipt.source_head,receipt.base,receipt.main];
  const stages=[2,1,3],names=[];
  for(let i=0;i<3;i++){
   const staged=run(root,['show',':'+stages[i]+':'+file]),expected=run(root,['show',revisions[i]+':'+file]);
   if(staged!==expected)throw Error('STOP_INDEX_STAGE_CHANGED');
   const name=path.join(temp,String(i));fs.writeFileSync(name,staged);names.push(name);
  }
  const current=conflictText(fs.readFileSync(path.join(root,file),'utf8'));
  const matches=[[],['--diff3']].some(flags=>{const r=cp.spawnSync('git',['merge-file','-p',...flags,...names],{encoding:'utf8',maxBuffer:16*1024*1024,windowsHide:true});return Number.isInteger(r.status)&&r.status>0&&r.status<128&&conflictText(r.stdout)===current;});
  if(!matches)throw Error('STOP_CONFLICT_WORKFILE_CHANGED');
 }finally{for(const name of fs.readdirSync(temp))fs.unlinkSync(path.join(temp,name));fs.rmdirSync(temp);}
}
function stageResolution(receiptPath){
 const receipt=JSON.parse(fs.readFileSync(receiptPath,'utf8')),root=run(process.cwd(),['rev-parse','--show-toplevel']).trim();
 if(run(root,['branch','--show-current']).trim()!=='prep/linear-exit-review-fixes-20260913')throw Error('STOP_WRONG_BRANCH');
 assertResolutionState(receipt,{head:run(root,['rev-parse','HEAD']).trim(),merge:run(root,['rev-parse','MERGE_HEAD']).trim(),conflicts:run(root,['diff','--name-only','--diff-filter=U']).trim().split(/\r?\n/).filter(Boolean)});
 const work=path.join(path.dirname(path.resolve(receiptPath)),'checkout');
 if(run(work,['rev-parse','HEAD']).trim()!==receipt.snapshot||run(work,['status','--porcelain']).trim())throw Error('STOP_REHEARSAL_CHANGED');
 if(run(work,['rev-parse','HEAD^{tree}']).trim()!==receipt.tree)throw Error('STOP_REHEARSAL_TREE_CHANGED');
 for(const file of KNOWN){const bytes=fs.readFileSync(path.join(work,file));if(crypto.createHash('sha256').update(bytes).digest('hex')!==receipt.resolved_files[file])throw Error('STOP_RESOLUTION_BYTES');}
 for(const file of KNOWN)assertFreshConflict(root,file,receipt);
 for(const file of KNOWN)fs.copyFileSync(path.join(work,file),path.join(root,file));
 run(root,['add','--',...KNOWN]);console.log('Known resolution staged only. Review, commit, recheck fingerprint/test/privacy, push and wait for exact-head CI.');
}
function main(){
 const args=Object.fromEntries(process.argv.slice(2).map(x=>{const at=x.indexOf('=');if(!x.startsWith('--')||at<0)throw Error('EXPECTED_NAMED_ARGUMENT');return [x.slice(2,at),x.slice(at+1)];}));
 if(args['stage-resolution']){if(Object.keys(args).length!==1||!path.isAbsolute(args['stage-resolution']))throw Error('STOP_RESOLUTION_ARGUMENTS');return stageResolution(args['stage-resolution']);}
 if(Object.keys(args).some(k=>!['main','output'].includes(k))||!/^[a-f0-9]{40}$/.test(args.main||'')||!path.isAbsolute(args.output||''))throw Error('USAGE: --main=<frozen40SHA> --output=<new-absolute-private-directory>');
 const root=run(process.cwd(),['rev-parse','--show-toplevel']).trim(),out=path.resolve(args.output),head=run(root,['rev-parse','HEAD']).trim();
 if(out===root||out.startsWith(root+path.sep)||fs.existsSync(out))throw Error('OUTPUT_MUST_BE_NEW_AND_OUTSIDE_CHECKOUT');
 run(root,['cat-file','-e',args.main+'^{commit}']);fs.mkdirSync(out,{recursive:true});
 const merge=cp.spawnSync('git',['merge-tree','--write-tree',head,args.main],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024,windowsHide:true});
 if(![0,1].includes(merge.status))throw Error('STOP_MERGE_TREE');fs.writeFileSync(path.join(out,'merge-tree.txt'),merge.stdout);
 const tree=merge.stdout.split(/\r?\n/)[0];if(!/^[a-f0-9]{40}$/.test(tree))throw Error('STOP_TREE');
 const conflicts=[...new Set([...merge.stdout.matchAll(/^\d+ [a-f0-9]+ [123]\t(.+)$/gm)].map(x=>x[1].trim()))];
 if(conflicts.some(x=>!KNOWN.includes(x)))throw Error('STOP_UNEXPECTED_CONFLICT: '+conflicts.join(','));
 const commit=run(root,['commit-tree',tree,'-p',head,'-m','Unpublished catch-up rehearsal input']).trim();
 const work=path.join(out,'checkout');run(root,['clone','--quiet','--shared','--no-checkout',root,work]);run(work,['checkout','--quiet','--detach',commit]);
 const base=run(root,['merge-base',head,args.main]).trim();
 for(const file of conflicts){
  const names=['ours','base','theirs'].map((n,i)=>{const p=path.join(out,n+'.tmp');fs.writeFileSync(p,run(root,['show',[head,base,args.main][i]+':'+file]));return p;});
  const m=cp.spawnSync('git',['merge-file','--diff3','-p',...names],{encoding:'utf8',maxBuffer:16*1024*1024,windowsHide:true});if(m.status!==1)throw Error('STOP_CONFLICT_SHAPE');
  fs.writeFileSync(path.join(work,file),resolve(m.stdout,file));
 }
 run(work,['add','--',...KNOWN]);const combined=snapshot(work),pins=repin(work,combined);run(work,['add','--',...KNOWN]);const final=snapshot(work);run(work,['checkout','--quiet','--detach',final]);
 // These tests read Git HEAD; point the isolated checkout at the exact final snapshot first.
 const tests=['test/f27-section4-deploy-lane.js','test/workload-capacity-placement.js','test/workload-plan-source.js','test/workload-tweak-exclusive-bucket.js'];
 const results=[];for(const test of tests){const r=cp.spawnSync(process.execPath,[test],{cwd:work,encoding:'utf8',maxBuffer:16*1024*1024,windowsHide:true});fs.writeFileSync(path.join(out,path.basename(test)+'.log'),(r.stdout||'')+(r.stderr||''));results.push({test,status:r.status});}
 const privacy=cp.spawnSync(process.execPath,['scripts/repo-identity-exposure-check.js','--diff='+head,'--json'],{cwd:work,encoding:'utf8',maxBuffer:16*1024*1024,windowsHide:true});fs.writeFileSync(path.join(out,'identity-exposure.json'),(privacy.stdout||'')+(privacy.stderr||''));results.push({test:'identity-exposure',status:privacy.status});
 if(run(root,['rev-parse','HEAD']).trim()!==head)throw Error('SOURCE_HEAD_CHANGED');
 const resolved_files=Object.fromEntries(KNOWN.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(work,file))).digest('hex')]));
 const receipt={classification:'ISOLATED_GIT_REHEARSAL_WITH_READ_ONLY_ROSTER_CHECK',source_head:head,main:args.main,base,snapshot:final,tree:run(work,['rev-parse','HEAD^{tree}']).trim(),conflicts,pins,tests:results,resolved_files,source_branch_merged:false,github_ci_proven:false,full_installation_evidence_revalidated:false};
 fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));if(results.some(r=>r.status!==0))process.exitCode=1;
}
if(require.main===module){try{main();}catch(e){console.error(e.message);process.exitCode=1;}}else module.exports={resolve,replaceOne,assertResolutionState,assertFreshConflict};
