'use strict';
// Local, opt-in reconstruction of observed CURRENT catalog. This is not a
// historical migration, deployment plan, data capture or dependency closure.
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const {scalar}=require('./linear-exit-composition/harness');
const {canonicalJson}=require('./track-b-backup');
const ARTIFACT='docs/independence/LINEAR_EXIT_BACKUP_TABLE_BASELINE_20260911.json';
const ARTIFACT_SHA='49a591e45484ff69e6034cca1e441743ea939924bb3fe18e6d4d31e724b1f0a6';
const QUERY_SHA='d0829d57ad258b127a5cf8cca39d96d5bf6ea52d807d6cc6d8fe434617f45dfb';
function pinned(file,hash){const b=fs.readFileSync(path.join(__dirname,'..',file));if(crypto.createHash('sha256').update(b).digest('hex')!==hash)throw Error('OBSERVED_BASELINE_SOURCE_HASH');return b.toString('utf8');}
function normalize(m){const copy=JSON.parse(JSON.stringify(m));delete copy.observed_at;delete copy.server_version_num;copy.grants.sort((a,b)=>(a.role+'|'+a.privilege).localeCompare(b.role+'|'+b.privilege));return copy;}
function apply(cluster){
 const artifact=JSON.parse(pinned(ARTIFACT,ARTIFACT_SHA));const query=pinned('scripts/linear-exit-backup-catalog.sql',QUERY_SHA);
 if(Math.floor(Number(scalar(cluster,"select current_setting('server_version_num')"))/10000)!==17)throw Error('OBSERVED_BASELINE_REQUIRES_PG17');
 if(scalar(cluster,"select current_user='postgres' and to_regclass('public.batches_parent_claim_backup_20260824') is null")!=='t')throw Error('OBSERVED_BASELINE_ABSENT_POSTGRES_OWNER_REQUIRED');
 // Fixed DDL, derived from the pinned no-default/no-key observation. The exact
 // catalog verification below runs in this same transaction before commit.
 const ddl=`create table public.batches_parent_claim_backup_20260824 (id text,linear_parent_ids jsonb,backed_up_at timestamp with time zone) using heap;
 revoke all on public.batches_parent_claim_backup_20260824 from public,postgres,anon,authenticated,service_role;
 grant select,insert,update,delete,truncate,references,trigger,maintain on public.batches_parent_claim_backup_20260824 to postgres,anon,authenticated,service_role;`;
 const expected=normalize(artifact.metadata);
 // Compare normalized metadata inside SQL, sorting the complete ACL objects;
 // only observation time and server PATCH/MINOR number are disregarded.
 const expectedHex=Buffer.from(canonicalJson(expected)).toString('hex');
 const select=query.trim().replace(/;$/,'');
 const guard=`do $observed$ declare m jsonb;begin select metadata into m from (${select}) q;m=m-'observed_at'-'server_version_num';m=jsonb_set(m,'{grants}',(select jsonb_agg(x order by x->>'role',x->>'privilege') from jsonb_array_elements(m->'grants') x));if m<>convert_from(decode('${expectedHex}','hex'),'UTF8')::jsonb then raise exception 'OBSERVED_BASELINE_CATALOG_MISMATCH';end if;end $observed$;`;
 cluster.exec(ddl+'\n'+guard);
 const actual=JSON.parse(scalar(cluster,query));
 if(canonicalJson(normalize(actual))!==canonicalJson(expected))throw Error('OBSERVED_BASELINE_FRESH_CATALOG_MISMATCH');
 return {artifact:ARTIFACT,artifact_sha256:ARTIFACT_SHA,query_sha256:QUERY_SHA,selected_catalog_exact:true,postgres_version_num:actual.server_version_num,acl_grants_checked:actual.grants.length,current_observed_baseline:true,historical_provenance_proven:false,application_rows_read:false,full_dependency_closure_proven:false};
}
module.exports={apply};
