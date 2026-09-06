'use strict';
// Offline registration. Actual PostgreSQL is a separately explicit fixture run;
// this file never loads process-env database configuration or connects to one.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const c=require('../qa/workload-consistency/native-capture');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'workload-capture-test-'));
let checks=0;const check=(name,fn)=>{fn();checks++;};
const cfg={confirmation:'LOCAL_DISPOSABLE_ONLY',host:'127.0.0.1',port:'55567',database:'card_history_synthetic',user:'postgres',password:'synthetic-fixture-password',psql:process.execPath};
try{
 check('explicit fixture config',()=>assert.equal(c.config(cfg),cfg));
 for(const [field,value] of [['confirmation',''],['host','db.example.invalid'],['host','localhost'],['host','127.0.0.1?host=remote'],['port','5432;'],['port',0],['port',65536],['database','postgres'],['database','card_history_x;'],['user','service_role'],['password',''],['psql','psql']])
  check('reject '+field,()=>assert.throws(()=>c.config({...cfg,[field]:value})));
 check('psql is noninteractive and explicitly bound',()=>{const a=c.args(cfg);assert.ok(a.includes('-w'));for(const key of ['-h','-p','-U','-d'])assert.ok(a.includes(key));assert.ok(a.includes('ON_ERROR_STOP=1'));});
 const overrides={PGHOSTADDR:'remote',PgService:'remote',PGSERVICEFILE:'remote',PGOPTIONS:'remote',PGPASSWORD:'remote',GIT_DIR:'fake',GIT_OBJECT_DIRECTORY:'fake'};
 const old=Object.fromEntries(Object.keys(overrides).map(k=>[k,process.env[k]]));Object.assign(process.env,overrides);
 try{
  check('all libpq ambient settings including Windows mixed case removed',()=>{const e=c.safeEnv(cfg.password);assert.deepEqual(Object.keys(e).filter(k=>/^PG/i.test(k)).sort(),['PGCLIENTENCODING','PGPASSWORD']);assert.equal(e.PGPASSWORD,cfg.password);});
  check('Git routing overrides removed and acquisition disabled',()=>{const e=c.gitEnv();assert.equal(e.GIT_DIR,undefined);assert.equal(e.GIT_OBJECT_DIRECTORY,undefined);assert.equal(e.GIT_NO_LAZY_FETCH,'1');assert.equal(e.GIT_TERMINAL_PROMPT,'0');});
 }finally{for(const [key,value] of Object.entries(old))if(value===undefined)delete process.env[key];else process.env[key]=value;}
 check('private absolute output required',()=>assert.throws(()=>c.privatePath('relative.json'),/private_absolute_path_required/));
 check('existing private output resolves',()=>{fs.writeFileSync(path.join(root,'private.json'),'{}');assert.equal(c.privatePath(path.join(root,'private.json'),true),fs.realpathSync(path.join(root,'private.json')));});
 const repo=path.join(root,'repository');fs.mkdirSync(repo);
 const git=argv=>{const r=spawnSync('git',argv,{cwd:repo,encoding:'utf8',timeout:10000,env:c.gitEnv()});assert.equal(r.status,0);return r.stdout.trim();};
 git(['init','--quiet']);git(['config','user.name','Synthetic Fixture']);git(['config','user.email','fixture@example.invalid']);
 for(const file of c.SOURCE_FILES){fs.mkdirSync(path.dirname(path.join(repo,file)),{recursive:true});fs.writeFileSync(path.join(repo,file),'original '+file+'\n');}
 git(['add','.']);git(['commit','--quiet','-m','synthetic source']);const head=git(['rev-parse','HEAD']);
 check('actual Git source bytes bind reviewed commit',()=>assert.equal(c.sourceBinding(head,repo).observed_commit,head));
 check('receipt cannot be stored in repository',()=>assert.throws(()=>c.privatePath(path.join(repo,'private.json')),/private_path_inside_git/));
 const original=git(['rev-parse',head+':index.html']);fs.writeFileSync(path.join(repo,'index.html'),'replacement body\n');const replaced=git(['hash-object','-w','index.html']);git(['replace',original,replaced]);
 check('ordinary Git replacement would change observed bytes',()=>assert.equal(git(['show',head+':index.html']),'replacement body'));
 check('source binder rejects replacement-backed working bytes',()=>assert.throws(()=>c.sourceBinding(head,repo),/source_working_file_drift/));
 fs.writeFileSync(path.join(repo,'index.html'),'original index.html\n');
 check('no-replace binder accepts real committed bytes despite replacement ref',()=>assert.equal(c.sourceBinding(head,repo).observed_commit,head));
 const marker=path.join(root,'unexpected-network-marker'),hook=path.join(root,'git-deny-fetch.sh');
 fs.writeFileSync(hook,'#!/bin/sh\necho attempted > "'+marker.replaceAll('\\','/')+'"\nexit 1\n');
 git(['config','remote.origin.url','ssh://example.invalid/synthetic']);git(['config','remote.origin.promisor','true']);
 git(['config','core.sshCommand','sh "'+hook.replaceAll('\\','/')+'"']);
 const objectPath=path.join(repo,'.git','objects',original.slice(0,2),original.slice(2));fs.renameSync(objectPath,objectPath+'.held');
 const oldSsh=process.env.GIT_SSH_COMMAND;process.env.GIT_SSH_COMMAND='sh "'+hook+'"';
 try{check('missing object refuses without lazy fetch',()=>{assert.throws(()=>c.sourceBinding(head,repo),/source_git_unavailable/);assert.ok(!fs.existsSync(marker));});
  check('unguarded missing-object negative control reaches only the local transport trap',()=>{
    const r=spawnSync('git',['--no-replace-objects','show',head+':index.html'],{cwd:repo,encoding:'utf8',timeout:10000,env:{...c.gitEnv(),GIT_NO_LAZY_FETCH:'0'}});
    assert.notEqual(r.status,0);assert.ok(fs.existsSync(marker));
  });}
 finally{if(oldSsh===undefined)delete process.env.GIT_SSH_COMMAND;else process.env.GIT_SSH_COMMAND=oldSsh;}
 check('section coverage is exact existing seven inputs plus two observations',()=>assert.equal(Object.keys(c.SECTIONS).length,9));
 check('precision negative control preserves exact bytes',()=>{const a='{"value":9007199254740993}',b='{"value":9007199254740992}';assert.equal(c.stable(JSON.parse(a)),c.stable(JSON.parse(b)));assert.notEqual(c.seal({raw:a},'a'.repeat(64)).hmac_sha256,c.seal({raw:b},'a'.repeat(64)).hmac_sha256);});
 const badCfg=path.join(root,'refused.json'),out=path.join(root,'unused.json');fs.writeFileSync(badCfg,JSON.stringify({connection:{...cfg,host:'remote.invalid'},reviewed_catalog:{}}));
 const cli=spawnSync(process.execPath,[path.join(c.ROOT,'qa/workload-consistency/native-capture.js'),badCfg,out],{encoding:'utf8',timeout:10000});
 check('actual CLI refuses nonlocal connection with only a safe code',()=>{assert.equal(cli.status,1);assert.deepEqual(JSON.parse(cli.stdout),{capture_valid:false,populationVerdict:'UNPROVEN',code:'explicit_loopback_port_required'});assert.equal(cli.stderr,'');assert.ok(!fs.existsSync(out));});
 console.log('PASS '+checks+' offline native capture guards; PostgreSQL and native population verdict UNPROVEN in this lane');
}finally{
 const resolved=fs.realpathSync(root),temp=fs.realpathSync(os.tmpdir());
 assert.ok(resolved.startsWith(temp+path.sep)&&path.basename(resolved).startsWith('workload-capture-test-'));
 fs.rmSync(resolved,{recursive:true,force:true});
}
