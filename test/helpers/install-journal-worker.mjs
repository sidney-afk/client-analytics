import fs from 'node:fs';
import postgres from 'npm:postgres@3.4.7';
import {createRequire} from 'node:module';
const journal=createRequire(import.meta.url)('../../scripts/linear-exit-install-journal.js');
if(Deno.env.get('F63_REQUIRE_POSTGRES')!=='1'||Deno.env.get('PGHOST')!=='127.0.0.1')throw Error('DISPOSABLE_REQUIRED');
const url=new URL('postgresql://127.0.0.1');url.port=Deno.env.get('PGPORT');url.username=Deno.env.get('PGUSER');url.password=Deno.env.get('PGPASSWORD');url.pathname='/'+Deno.env.get('JOURNAL_DATABASE');
const sql=postgres(url.href,{max:1,prepare:false,connect_timeout:5,ssl:false});const connection=await sql.reserve();
const mode=Deno.env.get('JOURNAL_FAULT')||'';
try{
 if(mode==='hold'){await connection.unsafe('select pg_advisory_lock(19370101,1)');fs.writeFileSync(Deno.env.get('JOURNAL_READY'),'ready',{flag:'wx'});await new Promise(r=>setTimeout(r,4000));}
 else{
 const bytes=fs.readFileSync(Deno.env.get('JOURNAL_PLAN'));const result=await journal.run({session:{query:async(text,params=[])=>{if(text==='commit'&&mode==='before_commit')Deno.exit(72);const rows=await connection.unsafe(text,params);if(text==='commit'&&mode==='after_commit')Deno.exit(73);return rows;}},planBytes:bytes,planSha256:Deno.env.get('JOURNAL_PLAN_SHA'),expectedStageId:Deno.env.get('JOURNAL_STAGE'),expectedDatabaseIdentity:JSON.parse(Deno.env.get('JOURNAL_IDENTITY'))});console.log(JSON.stringify(result));
 }
}catch(error){console.error(error.message);Deno.exitCode=1;}finally{connection.release();await sql.end({timeout:1});}
