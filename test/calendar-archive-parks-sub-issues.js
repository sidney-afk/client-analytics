'use strict';
/*
 * Archiving a post parks its sub-issues — and when it cannot, it SAYS SO.
 *
 * Owner ruling 2026-08-17: archiving a card moves its video and thumbnail
 * issues to Backlog, because otherwise they stay live in everyone's queues —
 * assigned, dated, awaiting approvals for a post that no longer exists.
 * Measured that day: of 37 archived cards carrying deliverables, 33 of their
 * 50 sub-issues were still open.
 *
 * OPEN_REPAIRS 23 then found the feature had fired ONCE in three days: 11 card
 * archives, 0 parks. The register was explicit that the cause was a hypothesis
 * and must not be fixed from the armchair — so this suite EXECUTES the real
 * path rather than reasoning about it, and what it proves is narrow and
 * honest:
 *
 *   - the park target used to be read AFTER the archive write and AFTER two
 *     awaits, from `calState.posts` — a list a refresh, a client switch or a
 *     filtered rerender can drop the row from; and
 *   - a falsy post was answered with {parked:0, failed:0}, which the caller
 *     ignored, and `failed` only counts pushes that THREW, so the silent path
 *     also skipped the "a sub-issue is still open" notice.
 *
 * That is a provable silent-loss window. It is NOT a proof that it caused the
 * 11 — the video leg pushes through the legacy lane and leaves no outbox row
 * either way, so only a live reproduction on the TEST client can close that,
 * and the register keeps that task open.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.env.ARCHIVE_PARK_SRC || path.join(ROOT, 'index.html');
const source = fs.readFileSync(SRC, 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function extractFn(name) {
  let start = source.indexOf('async function ' + name + '(');
  if (start < 0) start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') { depth--; if (seen && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const CARD = {
  id: 'p_card_1',
  linear_issue_id: 'https://linear.app/synchro-social/issue/VID-1/video-1',
  graphic_linear_issue_id: 'https://linear.app/synchro-social/issue/GRA-1/thumbnail-1',
  updated_at: '2026-08-22T00:00:00.000Z',
};

/* Build a world around the REAL _calArchiveOne + _calArchiveParkSubIssues.
   `postsAtParkTime` models the list AFTER the awaits — the whole point of the
   defect is that it can differ from the list at call time. */
function world(opts) {
  const o = opts || {};
  const pushes = [];
  const notices = [];
  const posts = o.postsAtCallTime === undefined ? [CARD] : o.postsAtCallTime;
  const calState = { client: 'ClientX', posts: posts.slice() };
  const sandbox = {
    calState,
    _calPendingEdits: {},
    _calFailedNewCards: new Set(),
    _calSaveInFlight: {},
    calClientSlug: () => 'clientx',
    _writeUiNativeId: (post, component) => (o.noNativeIds ? '' : (component === 'video' ? 'del_v' : 'del_g')),
    _calPushStatusToLinear: async (url, status, ctx) => {
      if (o.throwOn && o.throwOn === ctx.component) throw new Error('push failed');
      pushes.push({ url, status, component: ctx.component, slug: ctx.slug });
    },
    _calUpsertFetch: async () => {
      // The awaited write is exactly where the list could change underneath.
      if (o.dropFromPostsDuringWrite) calState.posts = [];
      return { json: async () => ({ ok: true, post: o.echoPost || undefined }) };
    },
    _calCacheWrite: () => {},
    showNotify: (title, body) => notices.push(title + ' :: ' + body),
    console: { warn: () => {}, log: () => {} },
    Promise, Error, Set, Object, String, Boolean, Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    extractFn('_calArchiveParkSubIssues') + '\n' + extractFn('_calArchiveOne')
    + '\nthis.archiveOne = _calArchiveOne; this.park = _calArchiveParkSubIssues;',
    sandbox,
  );
  return { archiveOne: sandbox.archiveOne, park: sandbox.park, pushes, notices, calState };
}

(async () => {
  // 1. The ordinary archive still parks BOTH sub-issues to Backlog.
  let w = world();
  ok(typeof w.archiveOne === 'function', 'the real archive path extracts and executes (harness is not vacuous)');
  await w.archiveOne('p_card_1', 'clientx');
  ok(w.pushes.length === 2, 'an archive parks both sub-issues (got ' + w.pushes.length + ')');
  ok(w.pushes.every(p => p.status === 'Backlog'),
    'they are parked to Backlog, not cancelled — the owner chose recoverable');
  ok(w.pushes.some(p => p.component === 'video') && w.pushes.some(p => p.component === 'graphic'),
    'both the video and the thumbnail leg are pushed');
  ok(w.notices.length === 0, 'a clean archive says nothing alarming');

  // 2. THE DEFECT. The row vanishes from calState.posts during the awaited
  //    write. Before the fix the park target was read after that point and the
  //    helper returned silently; now the row is captured beforehand.
  w = world({ dropFromPostsDuringWrite: true });
  await w.archiveOne('p_card_1', 'clientx');
  ok(w.pushes.length === 2,
    'a card dropped from the visible list DURING the write is still parked — the silent-loss window is closed');
  ok(w.notices.length === 0, 'and that recovery is silent, because nothing went wrong');

  // 3. Genuinely unresolvable: never in the list, and the server echoed
  //    nothing. Parking is impossible — but it must be SAID, not swallowed.
  w = world({ postsAtCallTime: [] });
  const res = await w.archiveOne('p_card_1', 'clientx');
  ok(w.pushes.length === 0, 'with no row anywhere there is nothing to push');
  ok(w.notices.length === 1 && /not parked/i.test(w.notices[0]),
    'the person is TOLD the sub-issues were not parked — this is the silence that hid the bug for three days');
  ok(/Linear/.test(w.notices[0]), 'and told where to look');

  // 4. The server echo is a real fallback: if the list never had the row but
  //    the write echoed it back, that is enough to park.
  w = world({ postsAtCallTime: [], echoPost: CARD });
  await w.archiveOne('p_card_1', 'clientx');
  ok(w.pushes.length === 2, 'the echoed row is used when the list cannot supply one');
  ok(w.notices.length === 0, 'and no false alarm is raised when the echo saved it');

  // An echo for a DIFFERENT card must never be mistaken for this one.
  w = world({ postsAtCallTime: [], echoPost: Object.assign({}, CARD, { id: 'p_other' }) });
  await w.archiveOne('p_card_1', 'clientx');
  ok(w.pushes.length === 0 && w.notices.length === 1,
    'an echo whose id does not match is rejected rather than parking the wrong card');

  // 5. A push that THROWS still reports, and never fails the archive itself.
  w = world({ throwOn: 'graphic' });
  let threw = null;
  try { await w.archiveOne('p_card_1', 'clientx'); } catch (e) { threw = e; }
  ok(!threw, 'a failed park never turns a successful archive into a failed one');
  ok(w.pushes.length === 1 && w.notices.length === 1 && /still open/i.test(w.notices[0]),
    'the leg that failed is reported while the leg that worked stays parked');

  // 6. A card with no Linear links has nothing to park and stays quiet.
  w = world({ noNativeIds: true });
  const bare = await w.park({ id: 'p_card_1' }, 'clientx', 'p_card_1');
  ok(bare.parked === 0 && bare.failed === 0 && !bare.unresolved,
    'a card with no links is a no-op, NOT an unresolved-card alarm');

  if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
  console.log('\nall green');
})().catch(e => { console.error('FAIL  harness: ' + (e && e.message)); process.exit(1); });
