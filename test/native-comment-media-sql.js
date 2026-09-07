'use strict';
// Actual SQL only on an explicitly bound owned disposable loopback cluster.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {localConfig,LocalDatabase}=require('../scripts/card-change-journal-rehearsal');
if(process.env.CARD_HISTORY_TEST_CONFIRM!=='LOCAL_DISPOSABLE_ONLY'){
 console.log('SKIP comment media SQL: explicit owned disposable binding required');process.exit(0);
}
const config=localConfig(),made=[],quote=s=>"'"+String(s).replaceAll("'","''")+"'";
function bootstrap(){const db=new LocalDatabase(config);db.create();made.push(db);db.query(`create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table public.syncview_runtime_flags(key text primary key,value jsonb,updated_by text);
 do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
 end $$;`);
 for(const name of ['2026-09-07-native-brief-media.sql','2026-09-07-native-comment-media.sql'])db.query(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'));
 return db;
}
try{
 const db=bootstrap(),hash='a'.repeat(64),id='11111111-1111-4111-8111-111111111111',stamp='2026-09-01T00:00:00Z';
 const row={id,deliverable_id:'d',source_kind:'native_comment',source_entity_id:'comment',client_slug:'fixture',team:'video',
 source_audience:'internal',source_version:1,source_updated_at:stamp,source_sha256:hash,source_offset:0,source_length:20,
 original_url_sha256:hash,audience:'staff',state:'verified',content_sha256:hash,readback_sha256:hash,storage_path:hash+'/'+id,
 byte_length:104857600,mime_type:'video/quicktime',verified_at:stamp,source_receipt_sha256:hash,created_at:stamp};
 const insert=r=>'insert into native_brief_media_occurrences select * from jsonb_populate_record(null::native_brief_media_occurrences,'+quote(JSON.stringify(r))+'::jsonb)';
 assert.equal(db.query("select public=false and file_size_limit=104857600 and allowed_mime_types=array['image/png','image/jpeg','image/webp','image/gif','application/octet-stream'] from storage.buckets"),'t');
 assert.equal(db.query("select count(*) from syncview_runtime_flags where value->>'mode'='off'"),'2');
 let refusals=0;
 for(const delta of [{source_audience:null},{source_audience:'public'},{source_version:null},{source_version:0},{source_kind:'archive'},
 {byte_length:104857601},{mime_type:'image/png'},{mime_type:'font/otf'},{mime_type:'text/html'},{audience:'client'},{readback_sha256:null},
 {source_kind:'native_brief',source_entity_id:'d',source_audience:null,source_version:null}]){
  assert.throws(()=>db.query(insert({...row,...delta})));refusals++;
 }
 db.query('set role service_role;'+insert(row));
 const second='22222222-2222-4222-8222-222222222222';
 db.query(insert({...row,id:second,storage_path:hash+'/'+second,source_offset:25,mime_type:'font/otf',byte_length:1024}));
 const brief='33333333-3333-4333-8333-333333333333';
 db.query(insert({...row,id:brief,storage_path:hash+'/'+brief,source_kind:'native_brief',source_entity_id:'d',source_audience:null,source_version:null,mime_type:'image/png',byte_length:52428800}));
 for(const role of ['anon','authenticated'])assert.throws(()=>db.query('set role '+role+';select * from native_brief_media_occurrences'));
 for(const sql of ['delete from native_brief_media_occurrences',"update native_brief_media_occurrences set state='held'"])assert.throws(()=>db.query('set role service_role;'+sql));
 assert.throws(()=>db.query(insert({...row,id:second,storage_path:hash+'/'+second})));
 const rows=db.rows('select * from native_brief_media_occurrences order by id'),restored=bootstrap();for(const r of rows)restored.query(insert(r));
 assert.deepEqual(restored.rows('select * from native_brief_media_occurrences order by id'),rows);
 assert.equal(restored.query("select relrowsecurity from pg_class where oid='native_brief_media_occurrences'::regclass"),'t');
 console.log(JSON.stringify({classification:'ACTUAL_DISPOSABLE_COMMENT_MEDIA_SQL',refusals,acl_refusals:4,restored_rows:3,private_bucket:true,default_off:true,live_writes:0}));
}finally{for(const db of made.reverse())db.drop();}
