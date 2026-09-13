'use strict';
// Shared original assertions only; caller establishes activation and fixtures.
const assert=require('node:assert/strict');
module.exports=async function({cluster,env,highWater,deliverableWrite,event,assertReceipt,ok,scalar,count,setCapability,rejection,json,psqlAsync}){
// BEGIN ORIGINAL POST-CUTOFF ASSERTIONS
    deliverableWrite('nor-d2', { title: 'Retired native accepted' }, event({
      dedup: 'retired-native', id: 'nor-d2', operation: 'title',
    }));
    assertReceipt('retired-native', 'deliverable', 'title');
    ok('real retired admission admits a typed native receipt above its high-water',
      Number(scalar(cluster, "select id from public.mirror_outbox where dedup_key='retired-native'")) > highWater
      && scalar(cluster, "select (public.production_syncview_retirement_census()->>'ordinary_post_cutoff_total')::bigint") === '0');

    const retiredBefore = {
      title: scalar(cluster, "select title from public.deliverables where id='nor-d2'"),
      events: count(cluster, 'select * from public.deliverable_events'),
      outbox: count(cluster, 'select * from public.mirror_outbox'),
    };
    setCapability('provider');
    ok('real retired admission rolls back a fresh provider-shaped business write', rejection(
      `select public.production_deliverable_write(${json({
        id: 'nor-d2', client_slug: 'fixture-client', team: 'video', title: 'must not commit',
      })},${json(event({ dedup: 'retired-provider', id: 'nor-d2', operation: 'title' }))})`,
      /syncview_retirement_admission_closed:title/,
    ) && scalar(cluster, "select title from public.deliverables where id='nor-d2'") === retiredBefore.title
      && count(cluster, 'select * from public.deliverable_events') === retiredBefore.events
      && count(cluster, 'select * from public.mirror_outbox') === retiredBefore.outbox);

    setCapability('native', 'retired-proof');
    const boundaryEvent = event({ dedup: 'retired-lock-race', id: 'nor-d2', operation: 'priority' });
    const cutoffLock = psqlAsync(env, `begin; lock table public.mirror_outbox in share row exclusive mode;
        select pg_sleep(1);
        update public.syncview_retirement_admission set activated_reason='disposable lock race' where singleton;
        commit;`);
    const waitingWriter = psqlAsync(env,
      `begin; set local application_name='nir-retired-lock-writer'; select pg_sleep(0.1);
       select public.production_deliverable_write(${json({
        id: 'nor-d2', client_slug: 'fixture-client', team: 'video', priority: 4,
      })},${json(boundaryEvent)}); commit;`);
    let observedLockWait = false;
    for (let attempt = 0; attempt < 20 && !observedLockWait; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
      observedLockWait = scalar(cluster, `select exists(
        select 1 from pg_stat_activity
        where pid <> pg_backend_pid() and application_name='nir-retired-lock-writer'
          and state='active' and wait_event_type='Lock')`) === 't';
    }
    const boundaryRace = await Promise.all([cutoffLock, waitingWriter]);
    ok('future cutoff table lock makes the competing typed writer wait', observedLockWait);
    assert.deepEqual(boundaryRace.map(result => result.status), [0, 0], boundaryRace.map(result => result.stderr).join('\n'));
    assertReceipt('retired-lock-race', 'deliverable', 'priority');
    ok('future cutoff table lock releases the waiting typed writer through the real guard',
      Number(scalar(cluster, "select id from public.mirror_outbox where dedup_key='retired-lock-race'")) > highWater);

// END ORIGINAL POST-CUTOFF ASSERTIONS
};
