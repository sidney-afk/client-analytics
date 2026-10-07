'use strict';
/*
 * A BURST OF FOREIGN ROW WRITES IS ONE REFRESH, NOT ONE REFRESH PER ROW.
 *
 * Owner report, 2026-09-03: "when I go to the calendar it refreshes like 10
 * times in a row, like 15 times -- I see the refresh pill and every card
 * refreshing a ton of times". Measured the same day: `calendar_posts` took 200
 * row writes in an hour, 171 in the last 15 minutes, across 9 clients, 56 on
 * the busiest. Those are backend jobs (the reconcilers that still apply
 * Linear -> card, OPEN_REPAIRS 76) landing as individual row updates spread
 * over seconds.
 *
 * The tab subscribes filtered to the client on screen and reloads the WHOLE
 * client on each event, on a 350 ms trailing debounce. The 4-second coalescing
 * window beside it keys off `_calLastLocalWriteAt`, so it only ever applied to
 * writes THIS TAB made. Foreign writes had nothing, so every 350 ms window
 * containing one row write became its own full reload -- one refresh per row.
 *
 * This drives the REAL handler with a virtual clock and counts reloads. The
 * mutant run at the end removes the floor and asserts the storm comes back, so
 * the numbers below are measuring the repair rather than the weather.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractFunction } = require('./helpers/extract-function.js');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(cond, msg) {
    console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
    if (!cond) failures++;
}

function constant(name) {
    const m = new RegExp('const ' + name + ' = (\\d+);').exec(INDEX);
    if (!m) throw new Error('missing constant ' + name);
    return Number(m[1]);
}
const DEBOUNCE = constant('CAL_V2_RT_DEBOUNCE_MS');
const SELF_ECHO = constant('CAL_RT_SELF_ECHO_MS');
const FLOOR = constant('CAL_V2_RT_MIN_RELOAD_MS');
const STORM_FLOOR = constant('CAL_V2_RT_STORM_RELOAD_MS');
const STORM_WINDOW = constant('CAL_V2_RT_STORM_WINDOW_MS');
const STORM_EVENTS = constant('CAL_V2_RT_STORM_EVENTS');

/* A virtual clock, so the test measures the handler's arithmetic rather than
   the machine's scheduler. */
function harness(opts) {
    const state = { t: 0, timers: [], nextId: 1, reloads: [], seq: 0 };
    const ctx = {
        console: { log() {}, warn() {} },
        Date: { now: () => state.t },
        setTimeout(fn, ms) {
            const id = state.nextId++;
            state.timers.push({ id, at: state.t + Number(ms || 0), fn, seq: state.seq++ });
            return id;
        },
        clearTimeout(id) {
            const i = state.timers.findIndex(x => x.id === id);
            if (i >= 0) state.timers.splice(i, 1);
        },
        CAL_V2_RT_DEBOUNCE_MS: DEBOUNCE,
        CAL_RT_SELF_ECHO_MS: SELF_ECHO,
        CAL_V2_RT_MIN_RELOAD_MS: FLOOR,
        CAL_V2_RT_STORM_RELOAD_MS: STORM_FLOOR,
        CAL_V2_RT_STORM_WINDOW_MS: STORM_WINDOW,
        CAL_V2_RT_STORM_EVENTS: STORM_EVENTS,
        calState: { client: 'A Client', loading: false },
        calClientSlug: () => 'aclient',
        _calV2LeaseCurrent: () => true,
        _calV2Log() {},
        _calBgLoadInFlight: false,
        loadCalendarPosts(o) { state.reloads.push({ at: state.t, background: !!(o && o.background) }); },
    };
    vm.createContext(ctx);
    vm.runInContext('let _calV2RtTimer = null; let _calV2RtPending = false;'
        + ' let _calLastLocalWriteAt = ' + (opts && opts.lastLocalWriteAt != null ? opts.lastLocalWriteAt : -1e9) + ';'
        + ' let _calV2RtLastReloadAt = 0; let _calV2RtRecent = []; let _calV2RtAnonSerial = 0;', ctx);
    let src = extractFunction(INDEX, '_calV2OnRealtimeChange');
    let floorSrc = extractFunction(INDEX, '_calV2RtFloorMs');
    if (opts && opts.mutate) {
        // The mutant: the floor never applies, which is the code as it stood
        // when the owner reported the storm.
        src = src.replace('sinceReload < floor', 'false');
        if (!/false\)/.test(src)) throw new Error('mutation did not apply');
    }
    if (opts && opts.oneFloor) {
        // The mutant for finding 1 (2026-10-06): the single 8 s floor.
        floorSrc = floorSrc.replace(/return [^;]+;/, 'return CAL_V2_RT_STORM_RELOAD_MS;');
    }
    vm.runInContext(floorSrc, ctx);
    vm.runInContext(extractFunction(INDEX, '_calV2RtEventKey'), ctx);
    vm.runInContext(src, ctx);
    const fire = payload => vm.runInContext('_calV2OnRealtimeChange', ctx)('aclient', {}, payload);
    const advance = ms => {
        const target = state.t + ms;
        for (;;) {
            const due = state.timers.filter(x => x.at <= target).sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
            if (!due) break;
            state.timers.splice(state.timers.indexOf(due), 1);
            state.t = due.at;
            due.fn();
        }
        state.t = target;
    };
    return { state, ctx, fire, advance };
}

/* A reconciler burst: rows land one at a time, further apart than the trailing
   debounce, which is precisely the shape 350 ms could not coalesce. */
function burst(h, rows, gapMs) {
    for (let i = 0; i < rows; i++) { h.fire(); h.advance(gapMs); }
    h.advance(STORM_FLOOR + DEBOUNCE + 10);   // let everything settle
    return h.state.reloads.length;
}

ok(FLOOR > DEBOUNCE,
    'the floor is longer than the trailing debounce, or it would coalesce nothing (' + DEBOUNCE + 'ms debounce, ' + FLOOR + 'ms floor)');
ok(FLOOR <= 2000,
    'the normal floor is about 2 s at most (' + FLOOR + 'ms), so a second change lands within about 2 s (2026-10-06 finding 1)');
ok(STORM_FLOOR >= 8000 && STORM_FLOOR > FLOOR,
    'a storm still gets the old 8 s floor (' + STORM_FLOOR + 'ms)');

{
    const rows = 15, gap = 700;
    const fixed = burst(harness(), rows, gap);
    const stormy = burst(harness({ mutate: true }), rows, gap);
    ok(stormy >= rows - 1,
        'MUTANT (no floor): ' + rows + ' row writes ' + gap + 'ms apart produce ' + stormy + ' full reloads — the reported storm');
    ok(fixed <= 3,
        'with the floors, the same burst produces ' + fixed + ' — a couple of refreshes, not ' + stormy);
}

{
    /* A slow trickle over a minute must not become a reload per row either. */
    const rows = 20, gap = 3000;
    const fixed = burst(harness(), rows, gap);
    const stormy = burst(harness({ mutate: true }), rows, gap);
    ok(stormy >= rows - 1, 'MUTANT: a 60-second trickle is ' + stormy + ' reloads');
    ok(fixed <= Math.ceil((rows * gap) / STORM_FLOOR) + STORM_EVENTS,
        'with the floors it is ' + fixed + ', bounded by the elapsed time over the storm floor rather than by the row count');
}

{
    /* The case that has to stay fast: one change, after a quiet period. */
    const h = harness();
    h.advance(FLOOR * 2);
    h.fire();
    h.advance(DEBOUNCE + 1);
    ok(h.state.reloads.length === 1,
        'a single change after a quiet period still reloads on the ' + DEBOUNCE + 'ms debounce — the floor never delays a first event');
}

{
    /* And the self-echo window is untouched: our own write still defers. */
    const h = harness({ lastLocalWriteAt: 0 });
    h.fire();
    h.advance(DEBOUNCE + 1);
    ok(h.state.reloads.length === 0,
        'the echo of our own write is still deferred rather than reloaded');
    h.advance(SELF_ECHO + FLOOR + DEBOUNCE + 10);
    ok(h.state.reloads.length === 1,
        '...and lands exactly once when the window closes, which is the pre-existing behaviour');
}

{
    /* THE FLOOR MEASURES WHEN THE CLIENT WAS LAST RE-READ, NOT WHEN REALTIME
       LAST FIRED. Stamping only in the realtime path left the clock stale after
       any other kind of load, so the first backend write arriving just after a
       tab switch was not throttled and cost a second complete reload half a
       second later — the double-refresh the floor was supposed to remove.
       Found by review on PR 1246 after the floor shipped. */
    const load = extractFunction(INDEX, 'loadCalendarPosts');
    /* Not just "the line exists" — a stamp inside a branch would satisfy that and
       still leave the tab-switch path unstamped. It has to sit on the
       unconditional path, so pin it ADJACENT to `_calLastNetworkLoadAt`, the
       function's own already-unconditional "a network read is starting" marker.
       The two move together or this assertion fails. */
    ok(/_calSetLastNetworkLoadAt\(Date\.now\(\)\);[\s\S]{0,900}?_calV2RtLastReloadAt = Date\.now\(\);/.test(load),
        'every full read of a client stamps the floor, on the same unconditional path as '
        + '_calLastNetworkLoadAt — so a load started by a tab switch or a focus return throttles the '
        + 'next realtime event just as a realtime reload would');
    const stampCount = (load.match(/_calV2RtLastReloadAt = /g) || []).length;
    ok(stampCount === 1,
        'and it is stamped exactly once in the load, not scattered through its branches (' + stampCount + ')');
    const teardown = extractFunction(INDEX, '_calV2Teardown');
    ok(/_calV2RtLastReloadAt = 0/.test(teardown),
        'and client teardown clears it, so a new client never inherits the outgoing one\'s throttle');

    /* Both halves, executed: a clock someone ELSE stamped is respected, and a
       cleared clock lets the next event through at once. */
    const justLoaded = harness();
    justLoaded.state.t = 100000;
    vm.runInContext('_calV2RtLastReloadAt = 100000;', justLoaded.ctx);
    justLoaded.fire();
    justLoaded.advance(600);
    ok(justLoaded.state.reloads.length === 0,
        'a foreign write 600ms after a load does NOT reload — the load already re-read the client');
    justLoaded.advance(STORM_FLOOR);
    ok(justLoaded.state.reloads.length === 1,
        '...it lands once the floor is up, so the change is never dropped, only deferred');

    const afterSwitch = harness();
    afterSwitch.state.t = 100000;
    vm.runInContext('_calV2RtLastReloadAt = 0;', afterSwitch.ctx);
    afterSwitch.fire();
    afterSwitch.advance(DEBOUNCE + 1);
    ok(afterSwitch.state.reloads.length === 1,
        'and after a teardown cleared the clock, the new client\'s first live update is immediate');
}

{
    /* FINDING 1 (2026-10-06): a teammate's SECOND change, landing soon after
       another, used to wait out the whole 8 s floor (measured 5.4 to 13.7 s on
       screen while the push itself arrived in under 2.1 s). Each of these
       changes must now show within about 2 s of its push arriving. */
    for (const mutant of [false, true]) {
        const h = harness({ oneFloor: mutant });
        h.advance(60000);
        const arrivals = [0, 1000, 3000];      // status, another status, a caption
        const shownAfter = [];
        let t0 = h.state.t;
        for (let i = 0; i < arrivals.length; i++) {
            h.advance(t0 + arrivals[i] - h.state.t);
            const before = h.state.reloads.length;
            const at = h.state.t;
            h.fire();
            // the next reload that starts after this push is the one that shows it
            let waited = 0;
            while (h.state.reloads.length === before && waited < 20000) { h.advance(50); waited += 50; }
            shownAfter.push(h.state.reloads.length > before ? h.state.reloads[h.state.reloads.length - 1].at - at : Infinity);
        }
        const worst = Math.max.apply(null, shownAfter);
        if (!mutant) {
            ok(worst <= FLOOR + DEBOUNCE + 50,
                'three changes 0 s, 1 s and 3 s apart each show within ' + worst + 'ms of arriving (about 2 s), not 5 to 14 s');
        } else {
            ok(worst > 4000,
                'MUTANT (one 8 s floor): the same changes take up to ' + worst + 'ms — the reported 5 to 14 s');
        }
    }
}

{
    /* The storm switch: five foreign events inside the window go back to the
       8 s floor, so a reconciler run still costs a handful of reloads. */
    const h = harness();
    h.advance(60000);
    for (let i = 0; i < STORM_EVENTS; i++) { h.fire(); h.advance(200); }
    const ctxFloor = vm.runInContext('_calV2RtFloorMs', h.ctx)(h.state.t);
    ok(ctxFloor === STORM_FLOOR, STORM_EVENTS + ' foreign events in ' + STORM_WINDOW + 'ms switch to the storm floor (' + ctxFloor + 'ms)');
    h.advance(STORM_WINDOW + 10);
    const calm = vm.runInContext('_calV2RtFloorMs', h.ctx)(h.state.t);
    ok(calm === FLOOR, 'and once the window has passed with no events, the normal floor is back (' + calm + 'ms)');

    /* A storm is many CARDS (2026-10-07 re-test, finding A): one person
       stepping one card through statuses writes that card two or three times
       per step, and must keep the normal floor however many writes land. */
    const one = harness();
    one.advance(60000);
    for (let i = 0; i < STORM_EVENTS * 3; i++) { one.fire({ new: { id: 'p_same' } }); one.advance(300); }
    const oneFloor = vm.runInContext('_calV2RtFloorMs', one.ctx)(one.state.t);
    ok(oneFloor === FLOOR, (STORM_EVENTS * 3) + ' writes to ONE card keep the normal floor (' + oneFloor + 'ms)');
    const many = harness();
    many.advance(60000);
    for (let i = 0; i < STORM_EVENTS; i++) { many.fire({ new: { id: 'p_' + i } }); many.advance(200); }
    const manyFloor = vm.runInContext('_calV2RtFloorMs', many.ctx)(many.state.t);
    ok(manyFloor === STORM_FLOOR, STORM_EVENTS + ' different cards inside the window still switch to the storm floor (' + manyFloor + 'ms)');
    const del = harness();
    del.advance(60000);
    for (let i = 0; i < STORM_EVENTS; i++) { del.fire({ new: {}, old: { id: 'p_d' + i } }); del.advance(200); }
    ok(vm.runInContext('_calV2RtFloorMs', del.ctx)(del.state.t) === STORM_FLOOR, 'deletes are counted by the card they removed');

    /* The echo of our own save never counts towards a storm. */
    const own = harness({ lastLocalWriteAt: 0 });
    for (let i = 0; i < STORM_EVENTS + 2; i++) { own.fire(); own.advance(100); }
    ok(vm.runInContext('_calV2RtRecent.length', own.ctx) === 0,
        'events inside the self-echo window are not counted as foreign');
}

{
    /* A fresher pushed row must never clobber this tab's own just-saved edit.
       The reload merge keeps the local copy while a save is in flight, inside
       the recent-save window, and whenever its updated_at is newer or equal. */
    const load = extractFunction(INDEX, 'loadCalendarPosts');
    ok(/if \(_calSaveInFlight\[fp\.id\]\) return lp;/.test(load),
        'a save in flight keeps the local row over any fetched row');
    ok(/if \(isFinite\(lT\) && isFinite\(fT\) && lT >= fT\) return lp;/.test(load),
        'an older or equal server updated_at never replaces the local row');
    ok(/const stillRecent = _calLocalRecentSaves\.has\(fp\.id\);/.test(load),
        'and the recent-save window still protects a just-made edit');
}

{
    /* RE-SUBSCRIBE (finding 5): an errored channel is replaced, with backoff. */
    const open = extractFunction(INDEX, '_calV2OpenChannel');
    ok(/status !== 'CLOSED'\) _calV2ScheduleResubscribe\(slug, lease, false\)/.test(open),
        'CHANNEL_ERROR and TIMED_OUT schedule a new channel');
    ok(/_calV2RetryAttempt = 0;/.test(open), 'SUBSCRIBED resets the backoff');
    const delay = vm.runInContext('(' + extractFunction(INDEX, '_calV2RetryDelay') + ')', vm.createContext({
        CAL_V2_RT_RETRY_BASE_MS: constant('CAL_V2_RT_RETRY_BASE_MS'), CAL_V2_RT_RETRY_MAX_MS: constant('CAL_V2_RT_RETRY_MAX_MS'), Math }));
    ok(delay(0) === 1000 && delay(1) === 2000 && delay(2) === 4000 && delay(3) === 5000 && delay(10) === 5000,
        'backoff is 1 s, 2 s, 4 s, then capped at 5 s (2026-10-07 re-test, finding D)');
    const drop = extractFunction(INDEX, '_calV2DropChannel');
    ok(/_calV2RetryTimer\) \{ clearTimeout\(_calV2RetryTimer\)/.test(drop)
        && drop.indexOf('_calV2Channel = null') < drop.indexOf('removeChannel(dropping)'),
        'teardown cancels a pending retry and clears the channel before removing it, so its CLOSED is ignored');
    ok(/window\.addEventListener\('online', _calV2OnBrowserOnline\)/.test(INDEX),
        'coming back online re-subscribes at once');
}

if (failures) {
    console.error('\nCalendar realtime burst checks FAILED');
    console.error('A burst of foreign row writes must cost one reload, not one per row.');
    process.exit(1);
}
console.log('\nCalendar realtime burst checks passed');
