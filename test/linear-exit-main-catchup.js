'use strict';
const assert=require('assert');const {resolve,replaceOne,assertResolutionState,assertFreshConflict}=require('../scripts/linear-exit-main-catchup');
const conflict=(a,b,c)=>'<<<<<<< ours\n'+a+'||||||| base\n'+b+'=======\n'+c+'>>>>>>> theirs\n';
const workflow='.github/workflows/deploy-f27-section4-closures.yml';
assert.match(resolve(conflict(' # native\n PRODUCTION_WRITE_SOURCE_SHA256: abc\n',' PRODUCTION_WRITE_SOURCE_SHA256: def\n',' # newer main\n PRODUCTION_WRITE_SOURCE_SHA256: fed\n'),workflow),/newer main[\s\S]*native/);
assert.throws(()=>resolve(conflict(' run: deploy\n','',' # note\n'),workflow),/NON_PIN/);
assert.throws(()=>resolve(conflict('## ours\n','old text\n','## theirs\n'),'EXECUTION_LOG.md'),/INDEPENDENT/);
assert.strictEqual(resolve(conflict('## ours\n','','## theirs\n'),'EXECUTION_LOG.md'),'## ours\n\n## theirs\n');
assert.throws(()=>resolve('<<<<<<< truncated',workflow),/UNRESOLVED/);
assert.throws(()=>replaceOne('x x',/x/g,'y'),/PIN_SHAPE/);
assert.throws(()=>replaceOne('z',/x/g,'y'),/PIN_SHAPE/);
assert.strictEqual(replaceOne('x',/x/g,'y'),'y');
const known=[workflow,'EXECUTION_LOG.md','test/f27-section4-deploy-lane.js'];
const tests=['test/f27-section4-deploy-lane.js','test/workload-capacity-placement.js','test/workload-plan-source.js','test/workload-tweak-exclusive-bucket.js','identity-exposure'].map(test=>({test,status:0}));
const receipt={source_branch_merged:false,source_head:'a'.repeat(40),main:'b'.repeat(40),base:'c'.repeat(40),snapshot:'d'.repeat(40),tree:'e'.repeat(40),conflicts:known,tests,resolved_files:Object.fromEntries(known.map(f=>[f,'f'.repeat(64)]))};
const state={head:receipt.source_head,merge:receipt.main,conflicts:known};
assert.doesNotThrow(()=>assertResolutionState(receipt,state));
for(const change of [{tests:[]},{conflicts:[workflow]},{tests:[...tests.slice(1),tests[1]]},{source_head:'short'},{resolved_files:{}},{tests:tests.map((t,i)=>({...t,status:i?0:1}))}])assert.throws(()=>assertResolutionState({...receipt,...change},state),/STATE/);
assert.throws(()=>assertResolutionState(receipt,{...state,head:'changed'}),/STATE/);
const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'catchup-stage-test-'));
const git=(args,input)=>cp.execFileSync('git',args,{cwd:root,input,encoding:'utf8',windowsHide:true});
try{
 git(['init','--quiet']);git(['config','user.name','Synthetic']);git(['config','user.email','synthetic@example.invalid']);
 const file='conflict.txt',contents=['base\n','ours\n','theirs\n'],commits=[],blobs=[];
 for(const text of contents){const blob=git(['hash-object','-w','--stdin'],text).trim();blobs.push(blob);const tree=git(['mktree'],'100644 blob '+blob+'\t'+file+'\n').trim();commits.push(git(['commit-tree',tree,'-m','synthetic']).trim());}
 git(['read-tree','--empty']);git(['update-index','--index-info'],blobs.map((b,i)=>'100644 '+b+' '+(i+1)+'\t'+file+'\n').join(''));
 fs.writeFileSync(path.join(root,file),'<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\n');
 const r={base:commits[0],source_head:commits[1],main:commits[2]};
 assert.doesNotThrow(()=>assertFreshConflict(root,file,r));
 fs.appendFileSync(path.join(root,file),'manual edit\n');assert.throws(()=>assertFreshConflict(root,file,r),/WORKFILE_CHANGED/);
 assert.throws(()=>assertFreshConflict(root,file,{...r,main:commits[0]}),/INDEX_STAGE_CHANGED/);
}finally{if(!root.startsWith(path.join(os.tmpdir(),'catchup-stage-test-')))throw Error('TEMP_PATH');fs.rmSync(root,{recursive:true});}
console.log('main-catchup: conflict shape, exact receipt and isolated index/workfile refusal controls PASS');
