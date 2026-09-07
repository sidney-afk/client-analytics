'use strict';
// Normal offline suite reports SKIP honestly; CI opts into its owned PG service.
const path=require('node:path'),{spawnSync}=require('node:child_process');
if(process.env.CARD_HISTORY_TEST_CONFIRM!=='LOCAL_DISPOSABLE_ONLY'){
  console.log('SKIP combined Workload history/restore: explicit disposable PostgreSQL required');
}else{
  const r=spawnSync(process.execPath,['--experimental-strip-types',path.join(__dirname,'../scripts/card-history-workload-rehearsal.js')],
    {stdio:'inherit',env:process.env,windowsHide:true,timeout:240000});
  if(r.status!==0)process.exitCode=1;
}
