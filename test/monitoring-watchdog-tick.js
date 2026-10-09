'use strict';

/*
 * Locks the dead-man's switch's database-timer host (OPEN_REPAIRS 388).
 *
 * The GitHub hosts run `--check` only when GitHub delivers their crons, which
 * is every 3 to 7 hours, so the switch kept reporting ITS OWN lane stale. The
 * fix is a host on Supabase's own timer: the Edge Function
 * monitoring-watchdog-tick, called by pg_cron every 15 minutes.
 *
 * What must hold, and what this file checks:
 *   1. ONE lane table and ONE check. The script and the function run the same
 *      `runCheck` from the same file, so the two hosts cannot disagree about
 *      which lanes exist or how old is too old.
 *   2. The function is refused without the timer key, before the body is read.
 *   3. A tick does exactly what `--check` does: one read per watched lane, a
 *      page only for a newly stale lane, a latch, and the `monitoring_watchdog`
 *      beat written last, under the timer host's own actor and run handle.
 *   4. The page has the same shape the GitHub hosts send, and no secret leaves.
 *   5. The timer migration matches the function (URL, header, Vault name),
 *      refuses to install without a ready ping, and carries no secret.
 *   6. The function can be shipped through the existing one-function lane.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHARED = path.join(ROOT, 'supabase', 'functions', '_shared');
const core = require(path.join(SHARED, 'monitoring-watchdog-core.mjs'));
const relayCore = require(path.join(SHARED, 'monitoring-alert-relay-core.mjs'));
const tick = require(path.join(SHARED, 'monitoring-watchdog-tick.mjs'));
const script = require('../scripts/monitoring-watchdog');
const relayScript = require('../scripts/monitoring-alert-relay');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const NOW = Date.parse('2026-10-09T12:00:00.000Z');
const minutesAgo = minutes => new Date(NOW - minutes * 60000).toISOString();
const KEY = 'timer-key-0123456789-0123456789-0123456789';
const WEBHOOK = 'https://relay.example.test/webhook/fixture';
const BASE = 'https://project.example.test';
const CONFIG = { supabaseUrl: BASE, serviceKey: 'service-key-fixture', alertWebhook: WEBHOOK };
const WATCHED = core.activeLanes();

// ---------------------------------------------------------------------------
// 1. One source.
// ---------------------------------------------------------------------------
ok(script.LANES === core.LANES,
  'the script\'s lane table IS the shared core\'s table (same object), not a copy');
ok(script.watchdogDecision === core.watchdogDecision && script.activeLanes === core.activeLanes,
  'the script decides with the shared core\'s functions');
ok(relayScript.relayPayload === relayCore.relayPayload && relayScript.assertPublicSafe === relayCore.assertPublicSafe,
  'the script\'s relay payload and safety screen ARE the shared core\'s');
{
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'monitoring-watchdog.js'), 'utf8');
  ok(!/\bkey: '[a-z0-9_]+', label:/.test(source),
    'scripts/monitoring-watchdog.js declares no lane of its own');
  ok(/core\.runCheck\(githubIo\(\)\)/.test(source),
    'the GitHub host runs the shared runCheck');
  const tickSource = fs.readFileSync(path.join(SHARED, 'monitoring-watchdog-tick.mjs'), 'utf8');
  ok(/import \{ runCheck \} from '\.\/monitoring-watchdog-core\.mjs'/.test(tickSource)
    && /await runCheck\(timerIo\(/.test(tickSource),
  'the timer host runs the same shared runCheck');
  const coreSource = fs.readFileSync(path.join(SHARED, 'monitoring-watchdog-core.mjs'), 'utf8')
    + fs.readFileSync(path.join(SHARED, 'monitoring-alert-relay-core.mjs'), 'utf8');
  ok(!/process\.env|Deno\.env|require\(/.test(coreSource.replace(/^\s*(\/\/|\*).*$/gm, '')),
    'the shared cores read no environment and load nothing: every host difference comes in through io');
}

// ---------------------------------------------------------------------------
// A fake Supabase + relay, driven by URL.
// ---------------------------------------------------------------------------
function harness({ heartbeats = {}, latches = [], relayStatus = 200, relayThrows = null } = {}) {
  const log = { reads: [], inserts: [], pages: [], order: [] };
  async function fetchImpl(url, init = {}) {
    const href = String(url);
    const method = init.method || 'GET';
    if (href.startsWith(WEBHOOK)) {
      if (relayThrows) throw new Error(relayThrows);
      log.pages.push(JSON.parse(init.body));
      log.order.push('page');
      return new Response('{"message":"Workflow was started"}', { status: relayStatus });
    }
    if (!href.startsWith(`${BASE}/rest/v1/`)) throw new Error('unexpected url');
    if (init.headers.apikey !== CONFIG.serviceKey) throw new Error('service key not sent');
    if (method === 'GET') {
      log.reads.push(href);
      const lane = (/payload->>lane=eq\.([a-z0-9_]+)/.exec(href) || [])[1];
      if (lane) {
        const minutes = heartbeats[lane];
        const rows = minutes == null ? [] : [{ id: 1, ts: minutesAgo(minutes), payload: { lane, ok: true, at: minutesAgo(minutes), run_id: 'r' } }];
        return new Response(JSON.stringify(rows), { status: 200 });
      }
      return new Response(JSON.stringify(latches), { status: 200 });
    }
    const rows = JSON.parse(init.body);
    log.inserts.push(...rows);
    log.order.push(rows[0].action === core.HEARTBEAT_ACTION ? 'beat' : 'latch');
    return new Response('', { status: 201 });
  }
  const handle = tick.buildHandler({
    keyOk: req => req.headers.get(tick.KEY_HEADER) === KEY,
    config: () => CONFIG,
    fetchImpl,
    newId: () => '0123abcd-ffff-4fff-8fff-000000000000',
    now: () => NOW,
    sleepImpl: async () => {},
  });
  return { handle, log };
}

function request(body, headers = { [tick.KEY_HEADER]: KEY }, spy) {
  const r = new Request('https://example.test/functions/v1/monitoring-watchdog-tick', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  if (spy) { const read = r.text.bind(r); r.text = () => { spy.read = true; return read(); }; }
  return r;
}
const allFresh = Object.fromEntries(WATCHED.map(lane => [lane.key, 1]));

(async () => {
  // -------------------------------------------------------------------------
  // 2. The way in.
  // -------------------------------------------------------------------------
  {
    const { handle, log } = harness();
    const get = await handle(new Request('https://example.test/x', { method: 'GET' }));
    ok(get.status === 405, 'anything but POST is refused');
    const spy = {};
    const none = await handle(request({ action: 'tick' }, {}, spy));
    ok(none.status === 401 && !spy.read, 'no timer key: 401, and the body is never read');
    const spy2 = {};
    const wrong = await handle(request({ action: 'tick' }, { [tick.KEY_HEADER]: 'wrong' }, spy2));
    ok(wrong.status === 401 && !spy2.read, 'a wrong timer key: 401, and the body is never read');
    ok(log.reads.length === 0 && log.inserts.length === 0 && log.pages.length === 0,
      'a refused call touches neither the database nor the relay');
    const unknown = await handle(request({ action: 'selftest' }));
    ok(unknown.status === 400, 'an unknown action is refused');
  }
  {
    const { handle, log } = harness();
    const ping = await handle(request({ action: 'ping' }));
    const body = await ping.json();
    ok(ping.status === 200 && body.pong === 'monitoring-watchdog-tick' && body.ready === true && body.missing.length === 0,
      'ping answers ready:true when every secret is set');
    ok(log.reads.length === 0 && log.inserts.length === 0 && log.pages.length === 0,
      'ping reads nothing, writes nothing and pages nobody');
    const text = JSON.stringify(body);
    ok(!text.includes(KEY) && !text.includes(WEBHOOK) && !text.includes(CONFIG.serviceKey),
      'ping carries no secret');
  }
  {
    const handle = tick.buildHandler({
      keyOk: () => true, config: () => ({ supabaseUrl: BASE, serviceKey: '', alertWebhook: '' }),
      fetchImpl: async () => { throw new Error('must not be called'); }, newId: () => 'x', now: () => NOW,
    });
    const ping = await (await handle(request({ action: 'ping' }))).json();
    ok(ping.ready === false && ping.missing.join(',') === 'SUPABASE_SERVICE_ROLE_KEY,MONITORING_ALERT_WEBHOOK',
      'ping names (never shows) the secrets that are not set, so the schedule refuses to install');
    const t = await handle(request({ action: 'tick' }));
    ok(t.status === 500 && (await t.json()).error === 'server_not_configured',
      'a tick without its secrets fails loudly instead of reporting a green pass');
  }

  // -------------------------------------------------------------------------
  // 3. A tick is a --check.
  // -------------------------------------------------------------------------
  {
    const { handle, log } = harness({ heartbeats: allFresh });
    const response = await handle(request({ action: 'tick' }));
    const body = await response.json();
    ok(response.status === 200 && body.ok === true && body.mode === 'check' && body.host === 'pg_cron',
      'a healthy tick is a completed check');
    ok(log.pages.length === 0, 'all lanes fresh: nobody is paged');
    ok(log.reads.length === WATCHED.length + 1,
      `one read per watched lane plus one latch read (${log.reads.length})`);
    ok(log.inserts.length === 1, 'all lanes fresh: exactly one write, the beat');
    const beat = log.inserts[0];
    ok(beat.action === core.HEARTBEAT_ACTION && beat.payload.lane === 'monitoring_watchdog' && beat.payload.ok === true,
      'the tick writes the monitoring_watchdog heartbeat');
    ok(beat.actor === tick.ACTOR && beat.client_slug === '_system' && beat.source === 'system',
      'the beat says which host wrote it');
    ok(/^pgcron:[0-9a-f]{8}$/.test(beat.payload.run_id) && beat.payload.at === new Date(NOW).toISOString(),
      'the beat carries the timer\'s own run handle and clock');
    ok(JSON.stringify(body.watching) === JSON.stringify(WATCHED.map(lane => lane.key))
      && body.retired.length === core.retiredLanes().length,
      'every tick states the watched AND the retired lanes, like --check');
  }
  {
    const lane = WATCHED.find(entry => entry.key !== 'monitoring_watchdog');
    const { handle, log } = harness({ heartbeats: { ...allFresh, [lane.key]: lane.max_age_minutes + 1 } });
    const body = await (await handle(request({ action: 'tick' }))).json();
    ok(body.stale.length === 1 && body.stale[0].lane === lane.key && body.paged === true,
      `a lane past its max age (${lane.key}) is paged`);
    ok(log.pages.length === 1 && log.pages[0].type === 'monitoring_heartbeat_stale',
      'one stale page, through the relay');
    const expected = relayCore.relayPayload(core.stalePageSpec(body.stale, log.pages[0].details.run_id.replace(/:deadman$/, '')));
    ok(JSON.stringify(log.pages[0]) === JSON.stringify(expected),
      'the page is exactly the shape the GitHub hosts send for the same rows');
    ok(relayCore.assertPublicSafe(log.pages[0]), 'the page is public-safe');
    ok(log.order.join(',') === 'page,latch,beat',
      'page, then latch, then the beat last, so the beat proves a COMPLETED pass');
    ok(body.delivery_confirmed === false && body.delivery_reason === 'not_checked_by_timer_host',
      'the timer host says plainly that it did not confirm delivery through the n8n API');

    const again = harness({
      heartbeats: { ...allFresh, [lane.key]: lane.max_age_minutes + 30 },
      latches: [{ id: 9, payload: { lane: lane.key, incident_state: 'latched' } }],
    });
    await again.handle(request({ action: 'tick' }));
    ok(again.log.pages.length === 0, 'a latched lane is not paged again on the next tick');
  }
  {
    const { handle, log } = harness({ heartbeats: { ...allFresh, [WATCHED[1].key]: 99999 } });
    const body = await (await handle(request({ action: 'tick', dry_run: true }))).json();
    ok(body.dry_run === true && body.stale.length === 1 && log.inserts.length === 0 && log.pages.length === 0,
      'dry_run evaluates without paging, latching or beating');
  }
  {
    const { handle } = harness({ heartbeats: { ...allFresh, [WATCHED[1].key]: 99999 }, relayThrows: `error sending request for url (${WEBHOOK})` });
    const response = await handle(request({ action: 'tick' }));
    const body = await response.json();
    ok(response.status === 502 && body.error === 'check_failed', 'a relay that cannot be reached fails the pass');
    ok(!JSON.stringify(body).includes(WEBHOOK) && !/https?:\/\//.test(JSON.stringify(body)),
      'the relay URL never leaves in the error, even when the runtime names it');
  }

  // -------------------------------------------------------------------------
  // 5. The timer migration.
  // -------------------------------------------------------------------------
  {
    const read = name => fs.readFileSync(path.join(ROOT, 'migrations', name), 'utf8');
    const strip = sql => sql.replace(/--.*$/gm, '');
    const schedRaw = read('2026-10-09-monitoring-watchdog-tick-schedule.sql');
    const pingRaw = read('2026-10-09-monitoring-watchdog-tick-ping.sql');
    const sched = strip(schedRaw);
    const ping = strip(pingRaw);
    const url = "'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/monitoring-watchdog-tick'";
    ok(/^-- STATE: BUILT, NOT APPLIED/.test(schedRaw) && /^-- STATE: BUILT, NOT APPLIED/.test(pingRaw),
      'both files say they are not applied');
    ok(/select cron\.schedule\('monitoring-watchdog-tick', '\*\/15 \* \* \* \*', \$job\$/.test(sched),
      'one pg_cron job, every 15 minutes');
    ok(sched.includes(url) && ping.includes(url), 'both call the deployed function');
    ok(sched.includes(`'${tick.KEY_HEADER}', (select decrypted_secret from vault.decrypted_secrets where name = 'monitoring_watchdog_key' limit 1)`)
      && ping.includes(`'${tick.KEY_HEADER}', (select decrypted_secret from vault.decrypted_secrets where name = 'monitoring_watchdog_key' limit 1)`),
    'both sign with the Vault value under the header the function checks');
    ok(sched.includes(`'{"action":"tick"}'::jsonb`) && ping.includes(`'{"action":"ping"}'::jsonb`),
      'the timer ticks; the ping file only pings');
    ok(sched.includes('"pong":"monitoring-watchdog-tick","ready":true') && /raise exception 'no ready ping/.test(sched),
      'the schedule refuses to install without a fresh ready ping');
    ok(/perform cron\.unschedule\(jobid\) from cron\.job where jobname = 'monitoring-watchdog-tick'/.test(sched),
      're-running the file replaces the job instead of adding a second one');
    ok(/^begin;$/m.test(sched) && /^commit;$/m.test(sched) && /^begin;$/m.test(ping) && /^commit;$/m.test(ping),
      'each file is one transaction');
    for (const [name, raw] of [['schedule', schedRaw], ['ping', pingRaw]]) {
      ok(!/eyJ[A-Za-z0-9_-]{10,}|sb_secret_|vault\.create_secret\('(?!<paste)/.test(raw),
        `${name} file carries no key: the Vault value is only ever pasted by hand`);
    }
  }

  // -------------------------------------------------------------------------
  // The registry names the timer host, and it exists.
  // -------------------------------------------------------------------------
  {
    const lane = core.LANES.find(entry => entry.key === 'monitoring_watchdog');
    ok(Array.isArray(lane.timer_hosts) && lane.timer_hosts.includes('monitoring-watchdog-tick'),
      'the monitoring_watchdog lane names its database timer host');
    for (const slug of lane.timer_hosts || []) {
      ok(fs.existsSync(path.join(ROOT, 'supabase', 'functions', slug, 'index.ts')),
        `the timer host ${slug} exists as an Edge Function`);
    }
    ok((lane.hosts || []).length >= 2, 'the GitHub hosts are kept as the second observer');
  }

  // -------------------------------------------------------------------------
  // 6. Shippable through the one-function lane, and byte-clean.
  // -------------------------------------------------------------------------
  {
    const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-single-function.yml'), 'utf8');
    const options = ((wf.match(/options:\s*\[([^\]]*)\]/) || [])[1] || '').split(',').map(s => s.trim());
    const guard = ((wf.match(/case "\$DEPLOY_FUNCTION" in\s*\n\s*([^)]+)\)/) || [])[1] || '').split('|').map(s => s.trim());
    const loop = ((wf.match(/for fn in ([^;]+); do/) || [])[1] || '').trim().split(/\s+/);
    ok(options.includes('monitoring-watchdog-tick') && guard.includes('monitoring-watchdog-tick') && loop.includes('monitoring-watchdog-tick'),
      'monitoring-watchdog-tick is on the one-function lane\'s allowlist in all three places');
    for (const file of [
      'supabase/functions/monitoring-watchdog-tick/index.ts',
      'supabase/functions/_shared/monitoring-watchdog-tick.mjs',
      'supabase/functions/_shared/monitoring-watchdog-core.mjs',
      'supabase/functions/_shared/monitoring-alert-relay-core.mjs',
    ]) {
      const bytes = fs.readFileSync(path.join(ROOT, file));
      ok(!(bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF), `${file} has no byte-order mark`);
    }
  }

  console.log(failures ? `monitoring-watchdog-tick: ${failures} check(s) failed` : 'monitoring-watchdog-tick checks passed');
  process.exit(failures ? 1 : 0);
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
