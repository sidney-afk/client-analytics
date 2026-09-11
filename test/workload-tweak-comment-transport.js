'use strict';
/*
 * TWEAK-COMMENT TRANSPORT — the popover asks for the right rows, and paints
 * the answer back under the right rows.
 *
 * Codex P1 on #1344. Lane A gives every NATIVE Workload row a `del_…` `id` and
 * keeps the Linear uuid beside it in `linearId`. `wlFetchTweakComments` POSTs to
 * a webhook that looks issues up BY LINEAR ID, so a popover that sends `s.id`
 * asks for identifiers that endpoint has never seen. It does not error: it
 * answers an empty list, which renders as an empty box, which reads as "no
 * tweak comment on this sub-issue". The review feedback that sent the work back
 * — the one thing an editor opens this popover to read — vanishes silently.
 *
 * Not reachable today: no row is native-with-a-`del_`-id on the live board yet.
 * That is precisely why it needs a test. It becomes reachable on the outbound
 * flip, when attention is elsewhere (OPEN_REPAIRS 177 is what that looks like).
 *
 * The real block is SLICED OUT of index.html and EXECUTED. A regex could be
 * satisfied by a neighbouring expression; running it cannot. Every check below
 * was confirmed to go RED against the pre-fix index.html before being kept.
 *
 * `wlRenderTweakComments` is STUBBED rather than compiled, deliberately: lane D
 * (#1347) owns that function exclusively and rewrites it to read native
 * comments, so binding this suite to its current body would collide on merge.
 * The stub keeps the only property that matters here — an empty or absent
 * comment list renders as nothing, which is what makes the defect invisible.
 *
 * Synthetic ids throughout. No live client, colleague or issue identifier
 * appears here (public-repo rule, CLAUDE.md).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---- slice the real fill block ---------------------------------------------
const START = 'if (tweakSubs.length) {';
const END = '// Position: anchored below the clicked rollup';
const start = source.indexOf(START);
const end = source.indexOf(END);
if (start < 0 || end < 0 || end <= start) {
  console.error('FAIL  could not slice the tweak-comment fill block from index.html');
  process.exit(1);
}
const block = source.slice(start, end);

ok(/wlFetchTweakComments\(/.test(block) && /_wlTweakCommentsToken/.test(block),
  'the fill block extracts and holds the fetch (harness is not vacuous)');

const runFill = new Function(
  'tweakSubs', 'pop', 'window', 'wlFetchTweakComments',
  'wlRenderTweakComments', 'wlMarkClampedComments', '_wlTweakCommentsToken',
  block);

// ---- a popover just big enough to be painted into ---------------------------
function fakePop(rowIds) {
  const boxes = new Map();
  for (const id of rowIds) boxes.set(String(id), { innerHTML: '' });
  return {
    boxes,
    classList: { contains: () => true },
    querySelector(sel) {
      const m = /\[data-wl-comments-for="([^"]*)"\]/.exec(sel);
      return m ? (boxes.get(m[1]) || null) : null;
    },
    // The pre-fix catch branch reached for this; keeping it means the old code
    // RUNS here instead of throwing, so the red proof is about behaviour.
    querySelectorAll() { return Array.from(boxes.values()); },
  };
}

const renderStub = comments => (comments && comments.length)
  ? '<c>' + comments.map(c => c.body).join('|') + '</c>'
  : '';

async function fill(rows, respond) {
  const pop = fakePop(rows.map(r => r.id));
  const sent = [];
  const fetchStub = ids => { sent.push(ids.slice()); return respond(ids); };
  runFill(rows, pop, {}, fetchStub, renderStub, () => {}, 0);
  // Let the promise chain settle.
  await new Promise(resolve => setTimeout(resolve, 0));
  return { pop, sent };
}

const NATIVE_ID = 'del_0000000000000000000000000001';
const NATIVE_LINEAR = '00000000-0000-4000-8000-000000000001';
const POSTFLIP_ID = 'del_0000000000000000000000000002';
const LEGACY_ID = '00000000-0000-4000-8000-00000000000f';

// ---- 1. the wire carries LINEAR ids for native rows -------------------------
(async () => {
  const nativeRow = { id: NATIVE_ID, linearId: NATIVE_LINEAR, workloadSource: 'native' };
  const one = await fill([nativeRow], ids => Promise.resolve({
    [ids[0]]: ids[0] === NATIVE_LINEAR ? [{ author: 'A Reviewer', body: 'Recut the open.' }] : [],
  }));

  ok(one.sent.length === 1, 'a native tweak row still triggers exactly one batched fetch');
  ok(one.sent[0].includes(NATIVE_LINEAR),
    'the LINEAR uuid is what goes over the wire for a native row');
  ok(!one.sent[0].includes(NATIVE_ID),
    'the del_ row id is NOT sent — the webhook looks up Linear ids and would match nothing (the reported defect)');

  // ---- 2. the answer is painted back under the NATIVE row key ---------------
  ok(one.pop.boxes.get(NATIVE_ID).innerHTML === '<c>Recut the open.</c>',
    'the comment lands in the box keyed by the native del_ id, which is how the row was rendered');
  ok(one.pop.boxes.get(NATIVE_ID).innerHTML !== '',
    'the popover does NOT silently show an empty box for a native Tweak Needed row');

  // ---- 3. a row with NO Linear issue says so, and is never sent -------------
  /* A deliverable created after outbound stops has neither `linear_identifier`
     nor a Linear uuid. Asking the Linear webhook about it is pointless; the
     honest answer is that this popover cannot show its comments yet. A blank
     box would assert the opposite — that there is no feedback. */
  const postFlip = { id: POSTFLIP_ID, linearId: '', workloadSource: 'native' };
  const two = await fill([nativeRow, postFlip], ids => Promise.resolve(
    Object.fromEntries(ids.map(id => [id, [{ author: 'A Reviewer', body: 'Recut the open.' }]]))));

  ok(!two.sent.flat().includes(POSTFLIP_ID) && !two.sent.flat().includes(''),
    'a row with no linearId is not sent, and no empty id is smuggled into the batch');
  ok(two.sent.flat().includes(NATIVE_LINEAR),
    'its presence does not stop the rows that DO have a Linear id from being fetched');
  const postBox = two.pop.boxes.get(POSTFLIP_ID).innerHTML;
  ok(postBox !== '', 'a row with no Linear issue gets an explicit state, not a silent blank');
  ok(/wl-tweak-comments-status/.test(postBox),
    'and it uses the popover status row the other unavailable states already use');
  ok(/no Linear sub-issue/i.test(postBox),
    'the state says WHY there is nothing to show, rather than implying there is no feedback');
  ok(!/open the sub-issue in Linear/i.test(postBox),
    'it does not tell the editor to open a Linear issue that does not exist');
  ok(two.pop.boxes.get(NATIVE_ID).innerHTML === '<c>Recut the open.</c>',
    'the sibling native row is still filled in the same pass');

  // ---- 4. a LEGACY row is untouched by any of this --------------------------
  /* On the Linear-derived path a row's own `id` IS the Linear uuid and no
     `linearId` is set (`_wlV2MapRow` does not mint one). It must keep going
     over the wire exactly as before — this fix is additive, not a swap. */
  const legacyRow = { id: LEGACY_ID, title: 'A legacy row' };
  const three = await fill([legacyRow], ids => Promise.resolve({
    [ids[0]]: [{ author: 'A Reviewer', body: 'Legacy note.' }],
  }));
  ok(three.sent[0].includes(LEGACY_ID),
    'a legacy row is still looked up by its own id, which is the Linear uuid');
  ok(three.pop.boxes.get(LEGACY_ID).innerHTML === '<c>Legacy note.</c>',
    'and it still paints — the native fix does not regress the path in use today');

  // ---- 5. a failed fetch tells each row the truth about ITS row -------------
  const four = await fill([nativeRow, postFlip], () => Promise.reject(new Error('HTTP 500')));
  ok(/open the sub-issue in Linear/i.test(four.pop.boxes.get(NATIVE_ID).innerHTML),
    'a row that HAS a Linear issue is told to read the comments there when the fetch fails');
  ok(/no Linear sub-issue/i.test(four.pop.boxes.get(POSTFLIP_ID).innerHTML),
    'a row with NO Linear issue keeps its own true message — the failure branch does not overwrite it with advice it cannot follow');

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\nWorkload tweak-comment transport checks passed.');
})().catch(error => {
  console.error('FAIL  the transport harness threw: ' + (error && error.stack || error));
  process.exit(1);
});
