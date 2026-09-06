'use strict';
/*
 * Samples native create, layer 4: the finished card lands in sample_reviews.
 *
 * Owner 2026-08-19: "the samples tab behaves exactly like the calendar tab...
 * I don't think there's any difference." So samples run the SAME materializer
 * the calendar does, branching only where they genuinely must: which table the
 * card lands in and which view re-renders. A parallel copy would drift the
 * moment either side changed.
 *
 * This EXECUTES the extracted function against stubs rather than grepping it,
 * so it fails on behaviour: which endpoint was called, with what body, and
 * what ended up in which view's state.
 *
 * The linkage assertions are the point. sample_reviews already carries
 * video_deliverable_id / graphic_deliverable_id / linear_issue_id /
 * graphic_linear_issue_id, and a samples card is only equivalent to a calendar
 * card if all four are populated -- that is what ties it to the Linear parent
 * with its video and thumbnail sub-issues.
 */

const fs = require('fs');
const path = require('path');

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

const VIDEO = { row: { id: 'dlv_vid_1', linear_issue_url: 'https://linear.app/x/issue/VID-1', title: 'Reel 1', video_number: 1 }, request: { team: 'video', card_id: 'card_1', videoNumber: 1 } };
const GRAPHIC = { row: { id: 'dlv_gra_1', linear_issue_url: 'https://linear.app/x/issue/GRA-1', title: 'Reel 1', video_number: 1 }, request: { team: 'graphics', card_id: 'card_1', videoNumber: 1 } };

async function run(surface) {
  const calls = [];
  const state = {
    calState: { client: 'Doug Cartwright', posts: [], focusPid: null },
    sxrState: { client: 'Doug Cartwright', posts: [] },
  };
  const scope = {
    _linearIntakeRequireActor: () => {},
    _linearIntakeValidateResult: () => ({ cards: [{ cardId: 'card_1', number: 1, video: VIDEO, graphic: GRAPHIC }] }),
    _linearIntakeCheckpointOrSuspend: () => {},
    _calCacheRead: () => null,
    _sxrCacheRead: () => null,
    _calCacheWrite: () => {},
    _sxrCacheWrite: () => {},
    _calRenderBody: () => {},
    _sxrRenderBody: () => {},
    calClientSlug: () => 'dougcartwright',
    sxrClientSlug: () => 'dougcartwright',
    calState: state.calState,
    sxrState: state.sxrState,
    _calUpsertFetch: (slug, body, src) => {
      calls.push({ endpoint: 'calendar', slug, body, src });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    },
    _sxrUpsertFetch: (slug, body, src) => {
      calls.push({ endpoint: 'samples', slug, body, src });
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    },
  };
  const names = Object.keys(scope);
  const fn = new Function(...names, extract('_nativeAcceptedCardTransport') + '\n'
    + extract('_nativeAcceptedCurrentCard') + '\n' + extract('_writeNativeSubmissionCardsToCalendar')
    + ' return _writeNativeSubmissionCardsToCalendar;')(...names.map(n => scope[n]));
  await fn({ payload: { surface, client_slug: 'dougcartwright' }, result: {}, completed_card_ids: [] });
  return { calls, state };
}

(async () => {
  // --- calendar is untouched ------------------------------------------------
  const cal = await run('calendar');
  ok(cal.calls.length === 1 && cal.calls[0].endpoint === 'calendar',
  'a calendar intake still writes through the calendar upsert, exactly once');
  ok(!!cal.calls[0].body.post && !cal.calls[0].body.sample,
  'the calendar body still carries `post`');
  ok(cal.state.calState.posts.length === 1 && cal.state.sxrState.posts.length === 0,
  'the calendar view gained the card and the samples view did not');
  ok(cal.state.calState.focusPid === 'card_1',
  'the calendar still focuses the new card');

  // --- samples land in sample_reviews --------------------------------------
  const sxr = await run('sxr');
  ok(sxr.calls.length === 1 && sxr.calls[0].endpoint === 'samples',
  'a samples intake writes through the SAMPLES upsert, not the calendar one');
  ok(!!sxr.calls[0].body.sample && !sxr.calls[0].body.post,
  'the samples body carries `sample`, the shape that endpoint accepts');
  ok(sxr.calls[0].body.comments_base_at === '',
  'it sends the comments_base_at the samples upsert expects');
  ok(sxr.state.sxrState.posts.length === 1 && sxr.state.calState.posts.length === 0,
  'the samples view gained the card and the CALENDAR did not -- no cross-contamination');

  // --- the linkage that makes a samples card equivalent --------------------
  const sample = sxr.calls[0].body.sample;
  ok(sample.linear_issue_id === 'https://linear.app/x/issue/VID-1',
  'the sample carries the VIDEO Linear sub-issue url');
  ok(sample.graphic_linear_issue_id === 'https://linear.app/x/issue/GRA-1',
  'the sample carries the THUMBNAIL Linear sub-issue url');
  ok(sample.video_deliverable_id === 'dlv_vid_1',
  'the sample carries the native video deliverable id');
  ok(sample.graphic_deliverable_id === 'dlv_gra_1',
  'the sample carries the native graphics deliverable id');
  ok(sample.id === 'card_1' && sample.name === 'Reel 1',
  'the sample takes the card id and the returned title');
  ok(sample.video_status === 'In Progress' && sample.graphic_status === 'In Progress'
    && sample.status === 'In Progress',
  'both lanes and the card open In Progress, same as a calendar card');
  ok('creative_direction' in sample,
  'the sample carries creative_direction, the field its own tab renders');
  ok(!('scheduled_date' in sample) && !('caption' in sample) && !('cta' in sample),
  'and NOT the calendar-only scheduling/caption fields, which sample_reviews has no columns for');

  // --- the two paths report distinct failures ------------------------------
  const body = extract('_writeNativeSubmissionCardsToCalendar');
  ok(/sample_card_write_failed/.test(body) && /calendar_card_write_failed/.test(body),
  'a failed samples write is distinguishable from a failed calendar write');

  if (failures) process.exit(1);
  console.log('\nSamples native materialization checks passed');
})().catch(error => { console.error('threw: ' + error.message); process.exit(1); });
