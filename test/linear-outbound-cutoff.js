'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict'),cp=require('node:child_process');
const path=require('node:path'),os=require('node:os');
const sql=fs.readFileSync('migrations/2026-09-06-linear-outbound-cutoff.sql','utf8');
const ef=fs.readFileSync('supabase/functions/linear-outbound/index.ts','utf8');
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
ok(sql.includes("cutoff_enabled boolean not null default false"),'cutoff primitive is inactive by default');
ok(sql.includes("'accepted_after_cutoff'") && !/delete\s+from\s+public\.mirror_outbox/i.test(sql),'post-cutoff debt is classified, not deleted');
ok(!/status\s*=\s*'(?:written|skipped|stale)'/.test(sql),'cutoff never manufactures terminal queue success');
ok(sql.includes("for share")&&sql.includes("for update"),'enqueue/claim/authorize serialize with activation');
ok(!sql.includes('app.linear_cutoff_operator'),'activation leaves no transaction-local worker bypass');
ok(sql.includes('linear_outbound_cutoff_debt_v1'),'retained queue debt has a service-only derived census');
ok(sql.includes("outbound_generation is distinct from v_control.generation"),'stale worker apply fails closed');
ok(ef.includes('rpc("linear_outbound_claim_v1"'),'actual drainer claim uses server gate');
ok(ef.includes('await authorizeProviderDispatch(supabase, row);'),'actual provider mutation has immediate authorization');
ok(ef.indexOf('await authorizeProviderDispatch(supabase, row);') < ef.indexOf('const data = await linearGraphql(mutation.query'),'authorization precedes outbound mutation');
ok(ef.includes('throw new Error("outbound cutoff claim unavailable")'),'missing/failed claim read is not an empty success');
const base=cp.execFileSync('git',['show','8514a83ed1a65145a3a51ffe52e5fcbb2976be31:supabase/functions/linear-outbound/index.ts'],{encoding:'utf8'});
ok(!base.includes('linear_outbound_claim_v1')&&!base.includes('linear_outbound_authorize_dispatch_v1'),'pinned-base negative control lacks server cutoff');
console.log(`linear outbound cutoff source: ${checks} passed (SOURCE/OFFLINE; no serving proof)`);
if(process.env.CI||process.env.F63_REQUIRE_POSTGRES==='1'){
  assert.equal(process.env.F63_REQUIRE_POSTGRES,'1','explicit_disposable_binding_required');
  assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.PGHOST),'disposable_loopback_required');
  const psql=process.env.G8_TEST_PSQL||(fs.existsSync('/usr/bin/psql')?'/usr/bin/psql':'');
  assert.ok(psql&&path.isAbsolute(psql),'explicit_psql_required');
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'g8-disposable-proof-'));
  const result=cp.spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/linear-outbound-cutoff-rehearsal.js')],{
    encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:8e6,
    env:{...process.env,G8_TEST_CONFIRM:'LOCAL_DISPOSABLE_ONLY',G8_TEST_REQUIRE:'1',G8_TEST_PSQL:psql,
      G8_TEST_PORT:process.env.PGPORT,G8_TEST_PASSWORD:process.env.PGPASSWORD||'',G8_TEST_OUTPUT:output}});
  fs.writeFileSync(path.join(output,'wrapper.private.log'),(result.stdout||'')+(result.stderr||''));
  const summary=(result.stdout||'').match(/^G8_RESULT (.+)$/m);if(summary)console.log(summary[0]);
  assert.equal(result.status,0,'g8_actual_database_lane_failed_private_evidence_retained');
}
