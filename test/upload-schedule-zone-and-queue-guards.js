'use strict';
/*
 * TikTok and Instagram upload: four things found by reading the page as its
 * user (site assurance, 2026-10-08).
 *
 * 1. The schedule time is a wall clock in the PICKED timezone, but the "is it
 *    in the past" check read it in the browser's own zone. A time already gone
 *    in the picked zone passed the check (the whole video then uploaded before
 *    anything refused it), or a good time was blocked, by the gap between the
 *    two zones. Both zones used here are far from every real one, so the check
 *    means the same thing on any machine.
 * 2. Retry on a failed row had no in-flight guard: a double click sent two.
 * 3. The dismissed-rows list kept its OLDEST 200 ids, so once it was full the
 *    row just dismissed came straight back.
 * 4. With no Post For Me account the page told staff to type the id into the
 *    Clients Info sheet. Since 2026-10-02 the database is the main copy and the
 *    sheet is copied FROM it, so an id typed there never reaches the database.
 *
 * The real functions are lifted out of the app and run against stand-ins.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const lift = name => extractFunction(INDEX, name);
const liftAsync = name => 'async ' + lift(name);

// "YYYY-MM-DDTHH:MM" as a clock on the wall in `tz` reads at instant `ms`.
function wallClockIn(tz, ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
const ZONES = ['Pacific/Kiritimati', 'Pacific/Pago_Pago']; // UTC+14 and UTC-11
const HALF_HOUR = 30 * 60000;

// --- 1. TikTok -------------------------------------------------------------------
{
  const tkState = { client: 'Fixture client', profile: 'spc_x', mediaType: 'video', file: {}, photos: [], title: 'caption',
    schedule: { postNow: false, at: '', tz: '' } };
  const validate = new Function('tkState', `
    ${lift('_tkWallClockToUTC')}
    ${lift('_tkValidate')}
    return _tkValidate;
  `)(tkState);
  for (const tz of ZONES) {
    tkState.schedule.tz = tz;
    tkState.schedule.at = wallClockIn(tz, Date.now() - HALF_HOUR);
    ok(validate() === 'The schedule time is in the past.', `TikTok: half an hour ago in ${tz} is refused as past`);
    tkState.schedule.at = wallClockIn(tz, Date.now() + HALF_HOUR);
    ok(validate() === null, `TikTok: half an hour from now in ${tz} is accepted`);
  }
  tkState.schedule.at = 'nonsense';
  ok(validate() === 'That schedule time is not valid.', 'TikTok: a time that cannot be read is still refused');
  tkState.schedule = { postNow: true, at: '', tz: 'America/New_York' };
  ok(validate() === null, 'TikTok: "Post immediately" needs no time');

  // 4. the missing-account sentence
  tkState.profile = null;
  const missing = String(validate());
  ok(/Clients/.test(missing) && /Post for Me/i.test(missing) && !/Clients Info sheet/.test(missing),
    'TikTok: a missing account points at the Clients tab, not at the sheet');
}

// --- 1. Instagram ----------------------------------------------------------------
{
  const igState = { client: 'Fixture client', file: { size: 1 }, title: 'caption',
    schedule: { postNow: false, date: '', hour: '', minute: '', ampm: 'AM', tz: '' } };
  const validate = new Function('igState', `
    ${lift('_tkWallClockToUTC')}
    const IG_ACCOUNT_RE = /^spc_/;
    const IG_ACCOUNT_COLUMN = 'postforme_instagram_account_id';
    const IG_MAX_CAPTION = 2200;
    const _igResolveAccount = () => 'spc_x';
    const _igDeps = { maxBytes: 10, formatBytes: String, wallClockToUTC: _tkWallClockToUTC };
    ${lift('_igAt')}
    ${lift('_igValidate')}
    return _igValidate;
  `)(igState);
  const setWall = (tz, ms) => {
    const wall = wallClockIn(tz, ms);
    const h24 = +wall.slice(11, 13);
    Object.assign(igState.schedule, {
      tz, date: wall.slice(0, 10), minute: wall.slice(14, 16),
      hour: String(h24 % 12 === 0 ? 12 : h24 % 12), ampm: h24 >= 12 ? 'PM' : 'AM',
    });
  };
  for (const tz of ZONES) {
    setWall(tz, Date.now() - HALF_HOUR);
    ok(validate() === 'The schedule time is in the past.', `Instagram: half an hour ago in ${tz} is refused as past`);
    setWall(tz, Date.now() + HALF_HOUR);
    ok(validate() === null, `Instagram: half an hour from now in ${tz} is accepted`);
  }
}

// A run that stops before its last line (a promise nobody answers) must not read as a pass.
let finished = false;
process.on('exit', code => { if (!finished && code === 0) { console.log('FAIL  the suite stopped before its last check'); process.exitCode = 1; } });

// --- 2. Retry is sent once per row at a time -----------------------------------
(async () => {
  const env = { sent: [], waiting: [], notified: [] };
  env.release = () => { env.waiting.splice(0).forEach(answer => answer()); };
  const retry = new Function('env', `
    const _tkRetrying = new Set();
    const tkState = { uploads: [] };
    const TIKTOK_UPLOAD_STATUS_URL = 'https://example.invalid/status';
    const TIKTOK_UPLOAD_FN_URL = 'https://example.invalid/fn';
    const _tkSource = async () => 'n8n';
    const _syncviewEfHeaders = h => h;
    const _writeUiTrackSave = (surface, op, meta, send) => send();
    const fetch = url => { env.sent.push(url); return new Promise(resolve => { env.waiting.push(() => resolve({ ok: true, status: 200 })); }); };
    const _tkFetchQueue = () => {};
    const _tkScheduleNextPoll = () => {};
    const showNotify = (title, msg) => env.notified.push(title);
    ${liftAsync('_tkRetryRow')}
    return _tkRetryRow;
  `)(env);
  const first = retry('row-1');
  const second = retry('row-1');
  await new Promise(r => setImmediate(r));
  ok(env.sent.length === 1, 'two quick clicks on Retry send one retry');
  env.release();
  await Promise.all([first, second]);
  const third = retry('row-1');
  await new Promise(r => setImmediate(r));
  ok(env.sent.length === 2, 'once it has answered, Retry works again');
  env.release();
  await third;
  ok(env.notified.length === 0, 'and none of that reads as a failure');

  // --- 3. the dismissed list keeps the newest ids ---------------------------------
  const store = {};
  const saveHidden = new Function('store', `
    const TIKTOK_HIDDEN_KEY = 'hidden';
    const localStorage = { setItem: (k, v) => { store[k] = v; } };
    ${lift('_tkSaveHidden')}
    return _tkSaveHidden;
  `)(store);
  const ids = new Set(Array.from({ length: 205 }, (_, i) => 'row-' + i));
  saveHidden(ids);
  const kept = JSON.parse(store.hidden);
  ok(kept.length === 200, 'the dismissed list is still capped at 200');
  ok(kept.includes('row-204'), 'and the row just dismissed is in it');
  ok(!kept.includes('row-0'), 'the oldest are the ones let go');

  if (failures) { console.log('\n' + failures + ' check(s) failed'); process.exit(1); }
  finished = true;
  console.log('\nupload-schedule-zone-and-queue-guards: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
