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
        + ' let _calV2RtLastReloadAt = 0;', ctx);
    let src = extractFunction(INDEX, '_calV2OnRealtimeChange');
    if (opts && opts.mutate) {
        // The mutant: the floor never applies, which is the code as it stood
        // when the owner reported the storm.
        src = src.replace('sinceReload < CAL_V2_RT_MIN_RELOAD_MS', 'false');
        if (!/false\)/.test(src)) throw new Error('mutation did not apply');
    }
    vm.runInContext(src, ctx);
    const fire = () => vm.runInContext('_calV2OnRealtimeChange', ctx)('aclient', {});
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
    h.advance(FLOOR + DEBOUNCE + 10);   // let everything settle
    return h.state.reloads.length;
}

ok(FLOOR > DEBOUNCE,
    'the floor is longer than the trailing debounce, or it would coalesce nothing (' + DEBOUNCE + 'ms debounce, ' + FLOOR + 'ms floor)');

{
    const rows = 15, gap = 700;
    const fixed = burst(harness(), rows, gap);
    const stormy = burst(harness({ mutate: true }), rows, gap);
    ok(stormy >= rows - 1,
        'MUTANT (no floor): ' + rows + ' row writes ' + gap + 'ms apart produce ' + stormy + ' full reloads — the reported storm');
    ok(fixed <= 2,
        'with the floor, the same burst produces ' + fixed + ' — the owner sees one refresh, not ' + stormy);
}

{
    /* A slow trickle over a minute must not become a reload per row either. */
    const rows = 20, gap = 3000;
    const fixed = burst(harness(), rows, gap);
    const stormy = burst(harness({ mutate: true }), rows, gap);
    ok(stormy >= rows - 1, 'MUTANT: a 60-second trickle is ' + stormy + ' reloads');
    ok(fixed <= Math.ceil((rows * gap) / FLOOR) + 1,
        'with the floor it is ' + fixed + ', bounded by the elapsed time over the floor rather than by the row count');
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
    ok(/_calV2RtLastReloadAt = Date\.now\(\)/.test(load),
        'every full read of a client stamps the floor, so a load started by a tab switch or a focus '
        + 'return throttles the next realtime event just as a realtime reload would');
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
    justLoaded.advance(FLOOR);
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

if (failures) {
    console.error('\nCalendar realtime burst checks FAILED');
    console.error('A burst of foreign row writes must cost one reload, not one per row.');
    process.exit(1);
}
console.log('\nCalendar realtime burst checks passed');
