'use strict';
// Compare PostgreSQL-rendered repository views to one published observation
// digest. Never reads or executes private captured definitions.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {bootCluster,ROOT,scalar}=require('../scripts/linear-exit-composition/harness');
const {Cluster}=require('../scripts/f42-apply-rehearsal');
const {install}=require('../scripts/linear-exit-composition/recovery-ordered');
const OBSERVED='5ce654ae879eb0bfa17345be4066b80de3f75d249f530e9d457feef4c8a71b3b';
if(process.env.F63_REQUIRE_POSTGRES!=='1'){console.log('SKIP view provenance: owned disposable PostgreSQL required');process.exit(0);}
const host=process.env.F42_REHEARSAL_SOCKET||process.env.F42_REHEARSAL_PGHOST||process.env.PGHOST||'';
assert.ok(['127.0.0.1','localhost','::1'].includes(host));
let cluster;const results=[];
function compare(file){
 const source=fs.readFileSync(path.join(ROOT,'migrations',file));
 for(const pretty of [false,true]){
  // Hash inside PostgreSQL so client output trimming cannot alter definition.
  const digest=scalar(cluster,`select encode(sha256(convert_to(pg_get_viewdef('public.production_deliverables_browser_v1'::regclass,${pretty}),'UTF8')),'hex')`);
  assert.match(digest,/^[a-f0-9]{64}$/);
  const row={path:'migrations/'+file,source_sha256:crypto.createHash('sha256').update(source).digest('hex'),pg_get_viewdef_pretty:pretty,definition_sha256:digest,matches_observation:pretty&&digest===OBSERVED};results.push(row);console.log(JSON.stringify(row));
 }
}
try{
 cluster=bootCluster();
 compare('2026-07-23-f34-f53-production-attachments.sql');
 for(const file of ['2026-07-25-slice5-production-read-path.sql','2026-08-23-attribution-slug-guard-widening.sql']){cluster.runFile(path.join(ROOT,'migrations',file));compare(file);}
 cluster.stop();cluster=null;
 // A fresh ordered source is necessary: replacing the final wider view with
 // an older narrower view would require destructive column removal.
 cluster=new Cluster();const source={};install(source,()=>null);assert.equal(source.name,cluster.db);
 compare('2026-09-09-native-attribution-browser-projection.sql');
 const matches=results.filter(row=>row.matches_observation);
 assert.ok(matches.length>0,'no_repository_view_definition_matches_observation');
 console.log(JSON.stringify({marker:'LINEAR_EXIT_VIEW_PROVENANCE_OK',observed_definition_sha256:OBSERVED,matches,proof:'EXACT_OBSERVED_VIEW_DEFINITION_ONLY',hosted_refresh:false,acl_options_equivalence_proven:false,complete_baseline_proven:false}));
}catch(error){console.error(JSON.stringify({marker:'LINEAR_EXIT_VIEW_PROVENANCE_FAILED',code:error.message,matched:results.filter(row=>row.matches_observation).map(row=>row.path)}));process.exitCode=1;}
finally{if(cluster)cluster.stop();}
