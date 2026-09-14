'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto'),Module=require('module');
const file=path.resolve(__dirname,'../scripts/linear-exit-control-source-phases.js');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const real=require(file),control=require('../scripts/linear-exit-control-companion');
const fence=[
 'create function linear_exit_provider.retirement_send_fence_v1()\nreturns trigger language plpgsql security definer set search_path=pg_catalog,public as $fence$\nbegin return new;end $fence$',
 'revoke all on function linear_exit_provider.retirement_send_fence_v1() from public,anon,authenticated,service_role',
 'create trigger retirement_send_fence_v1 before insert on linear_exit_provider.send_attempts_v1 for each row execute function linear_exit_provider.retirement_send_fence_v1()',
 'alter table linear_exit_provider.send_attempts_v1 enable always trigger retirement_send_fence_v1'
];
// Synthetic source tests exercise framing/selection only. They do not freeze or
// assert the still-preparing retirement owner's business behavior.
function fixture(parts){
 const bytes=Buffer.from('begin;\ncreate table public.synthetic_public(value text);\n'+parts.join(';\n')+';\ncommit;');
 const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
 m.require=id=>id==='fs'?{readFileSync:()=>bytes}:require(Module._resolveFilename(id,m));
 m._compile(fs.readFileSync(file,'utf8'),file);
 return {api:m.exports,owners:[[real.RETIREMENT_OWNER,hash(bytes)]]};
}
let checks=0;function check(fn){fn();checks++;}
// Established sourceSql bytes, independently compared to the published module
// before this phase extraction. No git checkout dependency during tests.
const originalSql={core:'2960b8c9dc488d4aef1d62cf3996d9519ebeaafa1e2bad8f140ceeee58867cb0','core+diagnostics':'b4aa4ac0d99ab32ab2d410a3ce4662e98d5f2bb4e6479dd4c602b8c2e4a81d7b'};
check(()=>{for(const name of Object.keys(originalSql)){const c=control.forProfile(name),p=real.sourcePhases(c.OWNERS);assert.equal(p.afterPrivateRows,'');assert.equal(p.beforePublic,c.sourceSql());assert.equal(hash(p.beforePublic),originalSql[name]);}});
check(()=>{const f=fixture(fence),p=f.api.sourcePhases(f.owners);assert.equal(p.beforePublic,'');assert.equal(p.afterPrivateRows,fence.map(s=>s+';').join('\n'));assert(!p.afterPrivateRows.includes('synthetic_public'));});
check(()=>{const f=fixture(fence.map(s=>s.replaceAll('\n','\r\n'))),p=f.api.sourcePhases(f.owners);assert(p.afterPrivateRows.includes("as E'\\r\\nbegin return new;end '"));assert(!p.afterPrivateRows.includes('$fence$'));});
check(()=>{const f=fixture(fence);assert.throws(()=>f.api.sourcePhases([[real.RETIREMENT_OWNER,'0'.repeat(64)]]),/SOURCE_DRIFT/);});
check(()=>{const f=fixture(fence);assert.throws(()=>f.api.sourcePhases([...f.owners,...f.owners]),/DUPLICATE_SOURCE/);});
for(const parts of [
 fence.slice(0,3),
 [fence[1],fence[0],...fence.slice(2)],
 [...fence,fence[2]],
 [...fence.slice(0,3),fence[3].replace('enable always','enable')],
 [...fence.slice(0,2),fence[2].replace('before insert','before update'),fence[3]],
 [fence[0],fence[1].replace(',service_role',''),...fence.slice(2)],
 [...fence,'create table linear_exit_provider.unclassified(value text)']
])check(()=>{const f=fixture(parts);assert.throws(()=>f.api.sourcePhases(f.owners),/RETIREMENT_PRIVATE_PHASE/);});
const gateName='card_write_admission_v1',parent={manifest:{omitted_data_tables:[gateName]}};
function admission(mode){return {format:'complete-application-data-v2',tables:{
 [gateName]:{name:gateName,columns:[['singleton','boolean'],['epoch','uuid'],['mode','text'],['closed_at','timestamp with time zone'],['sealed_at','timestamp with time zone'],['reason','text'],['control_history','jsonb']].map(([name,type])=>({name,type,generated:''})),rows:[['true','00000000-0000-4000-8000-000000000001',mode,null,mode==='sealed'?'2026-09-13 00:00:00+00':null,'synthetic archival reason','[{"action":"synthetic-history"}]']]},
 other:{name:'other',rows:[['synthetic unchanged']]}
}};}
for(const mode of ['open','closed','sealed'])check(()=>{
 const input=admission(mode),before=JSON.stringify(input),view=real.quarantineAdmission(input,parent);
 assert.equal(JSON.stringify(input),before,'authenticated input mutated');
 const expected=JSON.parse(before);expected.tables[gateName].rows[0][2]='closed';assert.deepEqual(view,expected);
 assert.equal(view.tables.other,input.tables.other,'unrelated data need not be copied');
});
for(const change of [
 x=>{x.tables[gateName].rows=[];},
 x=>{x.tables[gateName].rows.push(x.tables[gateName].rows[0].slice());},
 x=>{x.tables[gateName].rows[0][0]='false';},
 x=>{x.tables[gateName].rows[0][2]=null;},
 x=>{x.tables[gateName].rows[0][2]='unknown';},
 x=>{x.tables[gateName].columns[2].type='boolean';},
 x=>{x.tables[gateName].columns[2].generated='s';},
 x=>{x.tables[gateName].columns[3].name='mode';},
 x=>{x.tables[gateName].rows[0].pop();},
 x=>{x.format='complete-application-data-v1';}
])check(()=>{const input=admission('open');change(input);assert.throws(()=>real.quarantineAdmission(input,parent),/ADMISSION_QUARANTINE_SHAPE/);});
check(()=>assert.throws(()=>real.quarantineAdmission(admission('open'),{manifest:{omitted_data_tables:[]}}),/ADMISSION_QUARANTINE_SHAPE/));
console.log(JSON.stringify({marker:'LINEAR_EXIT_CONTROL_SOURCE_PHASES_OK',classification:'OFFLINE_TEST',checks,retirement_sql_behavior_proven:false}));
