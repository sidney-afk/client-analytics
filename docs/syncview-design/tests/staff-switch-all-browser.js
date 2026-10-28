'use strict';

/*
 * EVERY STAFF SWITCH TAKES { "all": true } (session Allstaff, 2026-10-27).
 *
 * The owner turned five staff features on for everybody; their switches only took a list of staff ids, so a person
 * who joined later was left out. Every { "staff": [...] } switch read in src/index/188-review-stage-switch.js.part now
 * also takes { "all": true }, through one helper (_rsStaffSwitch / _rsStaffOn), the form workload_calm_staff has had
 * since 2026-10-20.
 *
 * Part 1 runs 188's own parsing and decision code (cut out of the fragment) against stubs, for each of the nine staff
 * switches: all:true is on for a staff member in no list, off on the client link and off before the server has said
 * who is signed in; the list form behaves as before (id or full name, an unlisted person off, never the client link);
 * a missing or malformed row is off; and the Kasper fast-boot hint carries "all" for staff only.
 * Part 2 boots the real page (offline harness, fictional data): with every switch at { "all": true } and nobody
 * listed, each reader answers yes on a staff page and no on a client link; a list naming someone else, and malformed
 * rows, answer no; a list naming the signed-in member answers yes.
 *
 * Fails on the code before this change (none of the five took "all", and the helper did not exist).
 *
 *   npm run build:index && node docs/syncview-design/tests/staff-switch-all-browser.js
 */

const fs = require('fs');
const path = require('path');

let checks = 0;
function expect(ok, message) {
  if (!ok) throw new Error('STAFF_SWITCH_ALL ' + message);
  checks++;
}

// Each staff switch and the 188 reader that answers it.
const SWITCHES = [
  ['review_stage_kasper_staff', 'svRsKasperOn'],
  ['review_stage_kasper_layout2', 'svRsKasperLayout2On'],
  ['kasper_fast_boot', 'svRsKasperFast'],
  ['workload_calm_staff', 'svWorkloadCalmOn'],
  ['unread_badges_v2', 'svUnreadBadgesOn'],
  ['caption_history_staff', 'svCaptionHistoryOn'],
  ['thumbnail_title_buttons_staff', 'svThumbTitleButtonsOn'],
  ['phone_polish_staff', 'svPhonePolishOn'],
  ['frame_comments_in_notes_staff', 'svFrameCommentsInNotesOn'],
];
// Kasper's second layout only ever changes a page his Review Session already shows: its row needs that one too.
const NEEDS = { review_stage_kasper_layout2: 'review_stage_kasper_staff' };
const MALFORMED = [{ all: 'true' }, { all: 1 }, { all: [true] }, { all: false }, { staff: 'x1' }, { staff: ['*'] }, { staff: [1, null] }, ['x1'], 'all', true, null, {}];

/* ── Part 1: the decision code ─────────────────────────────────────────────── */
function between(src, from, to) {
  const a = src.indexOf(from), b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error('STAFF_SWITCH_ALL cannot find ' + from + ' .. ' + to + ' in 188');
  return src.slice(a, b);
}
function mem() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; }

function unitPart() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'index', '188-review-stage-switch.js.part'), 'utf8');
  const code = between(src, 'function _rsFlagsOff()', 'let _rsFlagPromise')
    + between(src, 'function _rsParse(rows)', 'async function _rsFetch()')
    + between(src, 'function svRsKasperOn()', '/* FAST BOOT FOR KASPER')
    + between(src, 'const RS_KASPER_FAST_KEY', '// Called once at boot')
    + between(src, 'function svThumbTitleButtonsOn()', 'function svRsHelpUrl()');
  const make = (ctx) => new Function('ctx', `
    const _calRuntimeFlagRawMembers = () => []; const _calRuntimeFlagSlug = x => x;
    const _syncviewStaffIdentityForHeaders = () => ctx.who;
    const localStorage = ctx.storage;
    const document = { documentElement: { classList: { toggle() {} } } };
    const setTimeout = () => 0;
    const _rsPrime = () => {};
    let _rsFlagPromise = {}, _rsFlagFailed = false;
    const _isClientLink = ctx.client;
    ${code}
    let _rsFlags = _rsFlagsOff();
    return { parse: _rsParse, set: f => { _rsFlags = f; }, flags: () => _rsFlags, saveFast: _rsKasperFastHintSave, readers: {
      ${SWITCHES.map(([, fn]) => fn + ': ' + fn).join(', ')} } };
  `)(ctx);

  const STAFF = { member: { id: 'x1', name: 'Some Person' } };
  const answer = (key, value, o) => {
    const ctx = { who: o.who === undefined ? STAFF : o.who, client: !!o.client, storage: o.storage || mem() };
    const api = make(ctx);
    const rows = value === undefined ? [] : [{ key, value }];
    if (NEEDS[key]) rows.push({ key: NEEDS[key], value: { all: true } });
    api.set(api.parse(rows));
    const fn = SWITCHES.find(s => s[0] === key)[1];
    return api.readers[fn]();
  };

  for (const [key] of SWITCHES) {
    expect(answer(key, { all: true }, {}) === true, key + ': all:true is on for a staff member in no list');
    expect(answer(key, { all: true, staff: ['someone-else'] }, {}) === true, key + ': all:true with a list is on for someone the list leaves out');
    expect(answer(key, { all: true }, { client: true }) === false, key + ': all:true is off on the client link');
    expect(answer(key, { all: true }, { who: null }) === false, key + ': all:true is off until the server has said who is signed in');
    expect(answer(key, { all: true }, { who: { member: null } }) === false, key + ': all:true is off for someone who is not staff');
    expect(answer(key, { staff: ['x1'] }, {}) === true, key + ': the list still names a member by id');
    expect(answer(key, { staff: ['  Some Person '] }, {}) === true, key + ': the list still names a member by full name');
    expect(answer(key, { staff: ['someone-else'] }, {}) === false, key + ': the list still leaves an unlisted member off');
    expect(answer(key, { staff: ['x1'] }, { client: true }) === false, key + ': the list still never reaches the client link');
    expect(answer(key, undefined, {}) === false, key + ': a missing row is off');
    for (const bad of MALFORMED) expect(answer(key, bad, {}) === false, key + ': the malformed row ' + JSON.stringify(bad) + ' is off');
  }

  // Before the switches are read, nothing is on (the shape every reader starts from).
  {
    const api = make({ who: STAFF, client: false, storage: mem() });
    for (const [key, fn] of SWITCHES) expect(api.readers[fn]() === false, key + ': off before the switches are read');
  }

  // The Kasper fast-boot hint: "all" is remembered, for staff only; the list form is kept as before.
  const hintFor = (fastValue, stageValue) => {
    const storage = mem();
    const api = make({ who: STAFF, client: false, storage });
    api.saveFast(api.parse([{ key: 'kasper_fast_boot', value: fastValue }, { key: 'review_stage_kasper_staff', value: stageValue }]));
    return storage;
  };
  const before = (storage, o) => make({ who: o.who === undefined ? { member: { id: 'newcomer', name: 'New Person' } } : o.who, client: !!o.client, storage }).readers.svRsKasperFast();
  let st = hintFor({ all: true }, { all: true });
  const h = JSON.parse(st.getItem('sv-kasper-fast'));
  expect(h && h.fastAll === true && h.stageAll === true, 'an all:true fast-boot answer is kept as a hint with its all marks');
  expect(before(st, {}) === true, 'that hint gives the fast boot to a staff member it never named, before the read comes in');
  expect(before(st, { client: true }) === false, 'that hint never turns anything on for a client link');
  expect(before(st, { who: null }) === false, 'that hint waits for the server to say who is signed in');
  st = hintFor({ staff: ['x1'] }, { staff: ['x1'] });
  expect(JSON.parse(st.getItem('sv-kasper-fast')).fastAll === false, 'a list answer is kept without an all mark');
  expect(before(st, {}) === false, 'a list hint still leaves an unlisted member off');
  expect(before(st, { who: STAFF }) === true, 'a list hint still names a listed member');
  st = hintFor({ all: 'true' }, { all: true });
  expect(st.getItem('sv-kasper-fast') === null, 'a malformed fast-boot row clears the hint');
  // A hint written by the code before this change (no all marks) reads exactly as it did.
  st = mem(); st.setItem('sv-kasper-fast', JSON.stringify({ fast: ['x1'], stage: ['x1'] }));
  expect(before(st, { who: STAFF }) === true && before(st, {}) === false, 'an older hint without all marks reads as before');
  st = mem(); st.setItem('sv-kasper-fast', JSON.stringify({ fast: ['*'], stage: [] }));
  expect(before(st, {}) === false, 'a "*" in a hint is not a wildcard');
  console.log('  ok  part 1: ' + checks + ' decision checks');
}

/* ── Part 2: the real page ─────────────────────────────────────────────────── */
async function browserPart() {
  const { staffEnv, clientPage, sleep, FLAGS } = require('../phone-audit/harness');
  const saved = {};
  for (const [key] of SWITCHES) saved[key] = FLAGS[key];
  const setAll = (fn) => { for (const [key] of SWITCHES) { const v = fn(key); if (v === undefined) delete FLAGS[key]; else FLAGS[key] = v; } };
  const readAll = page => page.evaluate((fns) => {
    const out = {};
    for (const fn of fns) { try { out[fn] = typeof window[fn] === 'function' ? window[fn]() : 'missing'; } catch (e) { out[fn] = 'threw ' + e.message; } }
    out.phoneClass = document.documentElement.classList.contains('sv-phone-polish');
    return out;
  }, SWITCHES.map(s => s[1]));

  async function staffAnswers(label) {
    const S = await staffEnv({});
    try {
      const page = await S.newPage();
      await S.openCalendar(page);
      await page.waitForFunction(() => typeof svRsFlagsLoaded === 'function' && svRsFlagsLoaded() && (() => { try { const w = _syncviewStaffIdentityForHeaders(); return !!(w && w.member); } catch (e) { return false; } })(), null, { timeout: 30000 });
      await sleep(400);
      return await readAll(page);
    } catch (e) { throw new Error('STAFF_SWITCH_ALL ' + label + ': ' + e.message); } finally { await S.close(); }
  }

  try {
    // Every staff switch at { "all": true }, nobody listed: every reader says yes for the harness's staff member.
    setAll(() => ({ all: true }));
    let r = await staffAnswers('all:true');
    for (const [key, fn] of SWITCHES) expect(r[fn] === true, 'page, ' + key + ' { all: true }: on for a staff member in no list (got ' + r[fn] + ')');
    expect(r.phoneClass === true, 'page, phone_polish_staff { all: true }: the page carries its class');

    // The same rows on the client link: every reader says no.
    {
      const S = await staffEnv({});
      try {
        const { ctx, page } = await clientPage(S.browser, S.origin, { width: 390, height: 844, theme: 'light' });
        await page.waitForFunction(() => typeof svRsFlagsLoaded === 'function' && svRsFlagsLoaded(), null, { timeout: 30000 });
        await sleep(600);
        // A browser that once saw an all:true answer as staff: its hints must not turn anything on here either.
        await page.evaluate(() => { localStorage.setItem('sv-kasper-fast', JSON.stringify({ fast: [], stage: [], fastAll: true, stageAll: true })); localStorage.setItem('sv-wl-calm-staff', '["*"]'); });
        const c = await readAll(page);
        for (const [key, fn] of SWITCHES) expect(c[fn] === false, 'client link, ' + key + ' { all: true }: off (got ' + c[fn] + ')');
        expect(c.phoneClass === false, 'client link: no phone-polish class');
        expect(await page.evaluate(() => svRsKasperPending() === false && svWorkloadCalmPending() === false), 'client link: an all hint holds no loader');
        await ctx.close();
      } finally { await S.close(); }
    }

    // A list naming someone else: off, exactly as before.
    setAll(() => ({ staff: ['someone-else'] }));
    r = await staffAnswers('list, someone else');
    for (const [key, fn] of SWITCHES) expect(r[fn] === false, 'page, ' + key + ' listing someone else: off (got ' + r[fn] + ')');

    // A list naming the signed-in member (by id): on, exactly as before.
    setAll(() => ({ staff: ['m1'] }));
    r = await staffAnswers('list, m1');
    for (const [key, fn] of SWITCHES) expect(r[fn] === true, 'page, ' + key + ' listing the member: on (got ' + r[fn] + ')');

    // Malformed rows: off.
    setAll(key => (key === 'review_stage_kasper_staff' ? { all: true } : { all: 'true', staff: ['*'] }));
    r = await staffAnswers('malformed');
    for (const [key, fn] of SWITCHES) if (key !== 'review_stage_kasper_staff') expect(r[fn] === false, 'page, ' + key + ' malformed: off (got ' + r[fn] + ')');
    setAll(key => (key === 'review_stage_kasper_layout2' ? { all: true } : ['m1']));
    r = await staffAnswers('malformed list');
    for (const [key, fn] of SWITCHES) expect(r[fn] === false, 'page, ' + key + ' as a bare array: off (got ' + r[fn] + ')');
  } finally {
    for (const [key] of SWITCHES) { if (saved[key] === undefined) delete FLAGS[key]; else FLAGS[key] = saved[key]; }
  }
  console.log('  ok  part 2: the real page');
}

(async () => {
  unitPart();
  await browserPart();
  console.log('staff-switch-all-browser: all ' + checks + ' checks passed');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
