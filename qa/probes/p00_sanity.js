// p00 — sanity: load all 3 surfaces, assert 0 JS errors, confirm key globals reachable.
const Q = require('./lib.js');
(async () => {
  const S = Q.makeOk('P00 sanity');
  const browser = await Q.launch();
  try {
    const smm = await Q.smmPage(browser);
    const probe = await smm.evaluate(() => ({
      hasCalState: typeof calState !== 'undefined',
      isClientLink: (typeof _isClientLink !== 'undefined') ? _isClientLink : 'undef',
      fns: ['_calStatusPick','_calSetAllStatus','_calResolveLastTweak','_calApplyAutoStatus',
            'computeOverallStatus','_calReviewApprove','_calReviewRequestTweak','loadCalendarPosts',
            '_calIsCollabOn','_calSaveSettings','_calEnabledPlatforms','_calSetEnabledPlatforms',
            'addCalBlankCard','archiveCalPost','_calNormStatus','_calCommentsForView']
        .reduce((o,n)=>{ try { o[n] = (typeof eval(n) === 'function'); } catch(e){ o[n]=false; } return o; }, {}),
      consts: (()=>{ const o={}; try{o.CAL_COMPONENTS=JSON.stringify(CAL_COMPONENTS);}catch(e){o.CAL_COMPONENTS='err';}
        try{o.CAL_PRIORITY=JSON.stringify(CAL_PRIORITY);}catch(e){o.CAL_PRIORITY='err';}
        try{o.CAL_STATUSES=JSON.stringify(CAL_STATUSES);}catch(e){o.CAL_STATUSES='err';} return o; })(),
      postsLoaded: (calState.posts||[]).length,
    }));
    console.log('SMM globals:', JSON.stringify(probe, null, 1));
    S.ok(probe.hasCalState, 'SMM: calState defined');
    S.ok(probe.isClientLink === false, 'SMM: _isClientLink === false');
    S.ok(Object.values(probe.fns).every(Boolean), 'SMM: all key handler fns reachable (' + Object.entries(probe.fns).filter(([k,v])=>!v).map(([k])=>k).join(',') + ')');
    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0,4)) + ')');

    const cli = await Q.clientPage(browser);
    const cprobe = await cli.evaluate(() => ({ isClientLink: _isClientLink, collab: (typeof _calIsCollabOn==='function'?_calIsCollabOn():'?'), posts: (calState.posts||[]).length }));
    console.log('CLIENT:', JSON.stringify(cprobe));
    S.ok(cprobe.isClientLink === true, 'CLIENT: _isClientLink === true');
    S.ok(cli._errs.length === 0, 'CLIENT: 0 JS errors (' + JSON.stringify(cli._errs.slice(0,4)) + ')');

    const kas = await Q.kasperPage(browser);
    const kprobe = await kas.evaluate(() => ({ hasState: typeof _kasperState!=='undefined', items: (typeof _kasperState!=='undefined'?(_kasperState.items||[]).length:'?'), tab: (typeof _kasperState!=='undefined'?_kasperState.tab:'?') }));
    console.log('KASPER:', JSON.stringify(kprobe));
    S.ok(kprobe.hasState, 'KASPER: _kasperState defined');
    S.ok(kas._errs.length === 0, 'KASPER: 0 JS errors (' + JSON.stringify(kas._errs.slice(0,4)) + ')');
  } finally { await browser.close(); }
  process.exit(S.done());
})();
