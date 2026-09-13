import fs from 'node:fs';
import postgres from 'npm:postgres@3.4.7';
import {createRequire} from 'node:module';
const api=createRequire(import.meta.url)('../../scripts/linear-exit-install-bootstrap.js');
if(Deno.env.get('F63_REQUIRE_POSTGRES')!=='1'||Deno.env.get('PGHOST')!=='127.0.0.1'||['PGHOSTADDR','PGSERVICE','PGSERVICEFILE'].some(k=>Deno.env.get(k)))throw Error('DISPOSABLE_REQUIRED');
const url=new URL('postgresql://127.0.0.1');url.port=Deno.env.get('PGPORT');url.username=Deno.env.get('PGUSER');url.password=Deno.env.get('PGPASSWORD');url.pathname='/'+Deno.env.get('JOURNAL_DATABASE');
const sql=postgres(url.href,{max:1,prepare:false,connect_timeout:5,ssl:false}),connection=await sql.reserve(),mode=Deno.env.get('JOURNAL_FAULT');let commits=0;
try{const result=await api.run({session:{query:async(text,params=[])=>{if(text==='commit'&&mode==='before_bootstrap_commit'&&commits===0)Deno.exit(72);const rows=await connection.unsafe(text,params);if(text==='commit'){commits++;if(mode==='after_bootstrap_commit'&&commits===1)Deno.exit(73);}return rows;}},planBytes:fs.readFileSync(Deno.env.get('JOURNAL_PLAN')),planSha256:Deno.env.get('JOURNAL_PLAN_SHA'),expectedStageId:Deno.env.get('JOURNAL_STAGE'),expectedDatabaseIdentity:JSON.parse(Deno.env.get('JOURNAL_IDENTITY'))});console.log(JSON.stringify(result));}catch(e){console.error(e.message);Deno.exitCode=1;}finally{connection.release();await sql.end({timeout:1});}
