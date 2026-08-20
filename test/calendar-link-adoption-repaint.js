'use strict';
/*
 * The CALENDAR adopter repaints after it adopts a link.
 *
 * Found while fixing the Samples twin (PR 1105). _calAdoptDeliverableLinks
 * finished its tail with a bare `_calSchedulePendingRender()` -- and that
 * function only ARMS an interval. Its first tick reads
 * _calPendingBackgroundRender and, finding it false, clears the interval and
 * returns. So on a foreground load the adopted url reached calState.posts, the
 * local cache and the database, while the card on screen kept showing "no
 * sub-issue" until some unrelated render happened to run. The write was real;
 * only the repaint was silently dropped.
 *
 * The other half is the reason the guard exists at all: adoption is a fetch
 * plus an upsert AFTER the load returned, so its repaint can land while the
 * user is mid-edit. A full _calRenderBody() then detaches the focused input and
 * eats the caret. Hence: repaint now when idle, defer when busy -- and when
 * deferring, SET the flag as well as arming the interval.
 *
 * This suite EXECUTES the real adopter, so both halves fail on behaviour. A
 * source-grep would have called the original tail correct: the scheduler WAS
 * being called, it just could not do anything.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && source[i + 1] === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') { line = true; i++; continue; }
    if (ch === '/' && source[i + 1] === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

const CARD = () => ({
  id: 'p_native_cal_1',
  linear_issue_id: 'https://linear.app/x/issue/VID-1',
  graphic_linear_issue_id: '',
  video_deliverable_id: 'del_vid',
  graphic_deliverable_id: 'del_gra',
});

function build(opts) {
  const calls = { upserts: 0, renders: 0, renderOptions: [], cacheWrites: 0, scheduled: 0 };
  const state = { posts: [CARD()] };
  /* A vm context, not new Function(...names): the adopter ASSIGNS
     _calPendingBackgroundRender, and an assignment to a function parameter is
     invisible from outside. As a context property it reads back, which is the
     whole difference between "armed the interval" and "armed it and set the
     flag so the tick survives". */
  const scope = {
    calState: state,
    _calLoadRunCurrent: () => opts.current !== false,
    _writeUiNativeId: (post, component) =>
      String((component === 'graphic' ? post.graphic_deliverable_id : post.video_deliverable_id) || '').trim(),
    _calFetchDeliverableLinkRows: async ids => {
      const map = new Map();
      for (const id of ids) if (opts.rows[id]) map.set(id, opts.rows[id]);
      return map;
    },
    _calUpsertFetch: () => {
      calls.upserts++;
      return Promise.resolve({ json: () => Promise.resolve({ ok: !opts.upsertFails }) });
    },
    _calCacheWrite: () => { calls.cacheWrites++; },
    _calRenderBody: (options) => { calls.renders++; calls.renderOptions.push(options || null); },
    _calIsCalBusy: () => Boolean(opts.busy),
    _calPendingBackgroundRender: false,
    _calSchedulePendingRender: () => { calls.scheduled++; },
    console: { warn: () => {} },
  };
  vm.createContext(scope);
  vm.runInContext(extract('_calAdoptDeliverableLinks') + '\nthis.fn = _calAdoptDeliverableLinks;', scope);
  return { fn: scope.fn, calls, state, scope };
}

const ADOPTABLE = { rows: { del_gra: { id: 'del_gra', card_id: 'p_native_cal_1', linear_issue_url: 'https://linear.app/x/issue/GRA-9' } } };

(async () => {
  const idle = build({ ...ADOPTABLE, busy: false });
  const adopted = await idle.fn({}, 'someclient');
  ok(adopted === 1 && idle.state.posts[0].graphic_linear_issue_id === 'https://linear.app/x/issue/GRA-9',
  'the calendar adopter still adopts the missing graphics url (harness is not vacuous)');
  ok(idle.calls.renders === 1,
  'an idle calendar REPAINTS after adopting -- the old bare schedule() call repainted nothing at all');
  ok(idle.calls.renderOptions[0] && idle.calls.renderOptions[0].preserveScroll === true,
  'that repaint preserves scroll -- the adopter lands after the load, on a calendar the user may have scrolled');
  ok(idle.calls.scheduled === 0 && idle.scope._calPendingBackgroundRender === false,
  'an immediate repaint arms no interval and leaves no pending flag behind');
  ok(idle.calls.cacheWrites === 1, 'the adopted link is cached exactly once');

  const busy = build({ ...ADOPTABLE, busy: true });
  await busy.fn({}, 'someclient');
  ok(busy.calls.renders === 0,
  'a mid-edit calendar is NOT rebuilt -- a focused field keeps its caret and its unsaved text');
  ok(busy.calls.scheduled === 1, 'the repaint is handed to the deferred-render scheduler instead');
  ok(busy.scope._calPendingBackgroundRender === true,
  'and the pending-render FLAG is set, or the scheduled tick cancels itself and the repaint is lost');
  ok(busy.calls.upserts === 1 && busy.state.posts[0].graphic_linear_issue_id !== '',
  'deferring the repaint never defers the adoption itself -- the link is still persisted');

  const nothing = build({ rows: {}, busy: false });
  await nothing.fn({}, 'someclient');
  ok(nothing.calls.renders === 0 && nothing.calls.scheduled === 0 && nothing.calls.cacheWrites === 0,
  'a load that adopts nothing repaints nothing -- no flash on every poll');

  const failed = build({ ...ADOPTABLE, busy: false, upsertFails: true });
  await failed.fn({}, 'someclient');
  ok(failed.calls.renders === 0 && failed.state.posts[0].graphic_linear_issue_id === '',
  'a rejected upsert neither updates the row nor repaints a link that was never saved');

  if (failures) {
    console.error(`\n${failures} calendar link-adoption repaint check(s) failed.`);
    process.exit(1);
  }
  console.log('\nCalendar link-adoption repaint checks passed.');
})();
