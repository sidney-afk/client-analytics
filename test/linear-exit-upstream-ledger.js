'use strict';

// Optional isolated proof of exact upstream SQL; never integrates a branch or
// changes the frozen writers. Requires the pinned Git objects locally.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const COMMIT = 'fcebb856d3f5ea607cf5665ac391c258ad173abb';
const OWNERS = [
  ['2026-09-09-kasper-urgent-pings.sql', 'fdab0481ae24094831540efb294ae80d749c6f2aa0e5c4034c3346a96632b72b'],
  ['2026-09-10-kasper-urgent-ping-ledger.sql', '21c6e1b95b9a5fde8fc3e2d75b91a25d959d422f5eb8578648dc9b87611e45b7'],
];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function runPhase(cluster, ok, scalar, directory) {
  const files = OWNERS.map(([name, expected]) => {
    const file = path.join(directory, name);
    assert.equal(sha(fs.readFileSync(file)), expected, 'pinned upstream owner bytes required');
    return file;
  });
  console.log(JSON.stringify({classification:'ISOLATED_POSTGRES',upstream_commit:COMMIT,owners:OWNERS,restored_trigger_behavior:'UNPROVEN'}));
  cluster.runFile(files[0]);
  for (const [table, events, key] of [['calendar_posts','calendar_post_events','post_id'], ['sample_reviews','sample_review_events','sample_id']]) {
    cluster.exec(`insert into public.${table}(client,id,name,status,kasper_urgent_pinged_at,kasper_urgent_status_at,kasper_urgent_comp,kasper_urgent_by)
      values ('fixture-client','upstream-ledger-shared','Synthetic ledger','In Progress','2030-01-02Z','2030-01-01Z','video','Synthetic staff'),
      ('fixture-split','upstream-ledger-shared','Synthetic ledger','In Progress','2030-01-02Z','2030-01-01Z','video','Synthetic staff');
      insert into public.${events}(client,${key},ts,action,source,payload)
      values ('fixture-client','upstream-ledger-shared','2030-01-01Z','kasper_urgent_ping','db',jsonb_build_object('pinged_at',to_jsonb('2030-01-01Z'::timestamptz)));`);
  }
  cluster.runFile(files[1]);
  for (const [table, events, key] of [['calendar_posts','calendar_post_events','post_id'], ['sample_reviews','sample_review_events','sample_id']]) {
    const scope=`${key}='upstream-ledger-shared' and action='kasper_urgent_ping'`;
    ok(`${table} backfill retains old round and two tenant-specific new rounds`,scalar(cluster,`select count(*)=3 and count(distinct client)=2 and count(*) filter(where payload->>'via'='backfill')=2 from public.${events} where ${scope}`)==='t');
  }
  cluster.runFile(files[1]);
  for (const [table, events, key] of [['calendar_posts','calendar_post_events','post_id'], ['sample_reviews','sample_review_events','sample_id']]) {
    const scope=`${key}='upstream-ledger-shared' and action='kasper_urgent_ping'`;
    ok(`${table} exact migration replay creates no duplicate ledger rows`,scalar(cluster,`select count(*) from public.${events} where ${scope}`)==='3');
    cluster.exec(`update public.${table} set name='Ordinary synthetic save' where id='upstream-ledger-shared'`);
    ok(`${table} ordinary save succeeds without another ping event`,scalar(cluster,`select count(*) from public.${events} where ${scope}`)==='3');
    cluster.exec(`update public.${table} set kasper_urgent_pinged_at='2030-01-03Z' where client='fixture-client' and id='upstream-ledger-shared'`);
    ok(`${table} new round creates exactly one trigger-owned event`,scalar(cluster,`select count(*)=4 and count(*) filter(where payload->>'via'='trigger' and client='fixture-client' and actor='Synthetic staff' and source='db')=1 from public.${events} where ${scope}`)==='t');
    cluster.exec(`update public.${table} set kasper_urgent_pinged_at='2030-01-03Z' where client='fixture-client' and id='upstream-ledger-shared'`);
    ok(`${table} same marker retry does not duplicate event`,scalar(cluster,`select count(*) from public.${events} where ${scope}`)==='4');
    cluster.exec(`insert into public.${table}(client,id,status,kasper_urgent_pinged_at,kasper_urgent_comp,kasper_urgent_by) values ('fixture-client','upstream-ledger-insert','In Progress','2030-01-04Z','video','Synthetic staff')`);
    ok(`${table} inserted marker creates trigger-owned event`,scalar(cluster,`select count(*) from public.${events} where ${key}='upstream-ledger-insert' and action='kasper_urgent_ping' and payload->>'via'='trigger'`)==='1');
  }
  console.log('LINEAR_EXIT_UPSTREAM_LEDGER_OK 12 assertions; restored_trigger_behavior=UNPROVEN');
}

function main() {
  assert.equal(process.env.F63_REQUIRE_POSTGRES, '1', 'owned disposable PostgreSQL required');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'linear-exit-pinned-ledger-'));
  try {
    for (const [name, expected] of OWNERS) {
      const bytes = cp.execFileSync('git', ['show', `${COMMIT}:migrations/${name}`], {cwd:ROOT,maxBuffer:1024*1024});
      assert.equal(sha(bytes),expected,'upstream Git object hash mismatch');
      fs.writeFileSync(path.join(directory,name),bytes,{flag:'wx'});
    }
    const result=cp.spawnSync(process.execPath,[path.join(__dirname,'linear-exit-owner-composition.js')],{
      cwd:ROOT,env:{...process.env,LINEAR_EXIT_UPSTREAM_LEDGER_DIRECTORY:directory},stdio:'inherit',timeout:600000,
    });
    if(result.error) throw result.error;
    assert.equal(result.status,0,'upstream composition child failed');
  } finally {
    for(const [name] of OWNERS) { const file=path.join(directory,name); if(fs.existsSync(file)) fs.unlinkSync(file); }
    fs.rmdirSync(directory);
  }
}
module.exports={runPhase};
if(require.main===module) main();
