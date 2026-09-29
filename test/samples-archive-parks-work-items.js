'use strict';
/*
 * Archiving a SAMPLE parks its work items in Backlog, like the Calendar
 * (owner ruling 2026-08-17 for posts, extended to samples 2026-09-28).
 *
 * Executes the real _sxrArchiveOne + _sxrArchiveParkWorkItems from index.html
 * in a sandbox and proves:
 *   - the Archived card write happens first, then each linked component goes
 *     to Backlog through the guarded status writer (_sxrPushStatusToLinear),
 *     never a direct table write;
 *   - card and work item stay in step: the status write carries the card as
 *     it now is (Archived; Backlog is a work-item state, not a card state),
 *     so the card-side repair can never write the pre-archive status back;
 *   - a component with no work item is skipped;
 *   - a sample dropped from the list before the call is still parked
 *     (captured before any await, OPEN_REPAIRS 23);
 *   - a failed park never fails the archive and says so; an unresolved sample
 *     says so;
 *   - a failed archive parks nothing.
 * Fixture names only; this repo is public.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
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

const SAMPLE = {
  id: 'sx_fixture_1', status: 'In Progress',
  video_status: 'In Progress', graphic_status: 'SMM Approval',
  video_deliverable_id: 'del_fixture_v', graphic_deliverable_id: 'del_fixture_g',
  linear_issue_id: '', graphic_linear_issue_id: '',
  updated_at: '2026-09-01T00:00:00.000Z',
};

function world(opts) {
  const o = opts || {};
  const order = [];
  const pushes = [];
  const notices = [];
  const sxrState = { posts: o.posts === undefined ? [SAMPLE] : o.posts };
  const sandbox = {
    sxrState,
    _sxrPendingEdits: {},
    _sxrSaveInFlight: {},
    _writeUiNativeId: (post, component) => String((component === 'graphic' ? post.graphic_deliverable_id : post.video_deliverable_id) || ''),
    _sxrPushStatusToLinear: async (url, status, meta) => {
      order.push('park:' + meta.component);
      if (o.throwOn === meta.component) throw new Error('push failed');
      pushes.push({ status, component: meta.component, post: meta.post, slug: meta.slug, sourceEditedAt: meta.sourceEditedAt });
    },
    _sxrUpsertFetch: async (slug, body) => {
      order.push('archive:' + body.sample.status);
      return { ok: o.archiveFails ? false : true, status: o.archiveFails ? 500 : 200 };
    },
    showNotify: (title, body) => notices.push(title + ' :: ' + body),
    console: { warn: () => {}, log: () => {} },
    Promise, Error, Object, String, Date,
  };
  Object.assign(sandbox, require('./helpers/write-log-stand-ins')); vm.createContext(sandbox);
  vm.runInContext(extractFn('_sxrArchiveParkWorkItems') + '\n' + extractFn('_sxrArchiveOne')
    + '\nthis.archiveOne = _sxrArchiveOne;', sandbox);
  return { archiveOne: sandbox.archiveOne, order, pushes, notices };
}

(async () => {
  // 1. Archive, then both work items to Backlog through the guarded writer.
  let w = world();
  await w.archiveOne('sx_fixture_1', 'fixture');
  ok(w.order[0] === 'archive:Archived', 'the Archived card write happens first');
  ok(w.pushes.length === 2 && w.pushes.every(p => p.status === 'Backlog'), 'both work items are parked in Backlog');
  ok(w.pushes.some(p => p.component === 'video') && w.pushes.some(p => p.component === 'graphic'), 'the video and the thumbnail are both parked');
  ok(w.notices.length === 0, 'a clean archive says nothing alarming');

  // 2. Card and work item stay in step.
  const video = w.pushes.find(p => p.component === 'video');
  const graphic = w.pushes.find(p => p.component === 'graphic');
  ok(video.post.status === 'Archived' && graphic.post.status === 'Archived',
    'each status write carries the card as Archived, so its repair cannot un-archive it');
  ok(video.post.video_status === 'In Progress' && graphic.post.graphic_status === 'SMM Approval',
    'the card keeps its own component statuses (Backlog is not a card state)');
  ok(SAMPLE.video_status === 'In Progress' && SAMPLE.status === 'In Progress', 'the caller\'s row is not mutated');
  ok(!!video.sourceEditedAt && video.sourceEditedAt > SAMPLE.updated_at, 'the park is stamped at archive time, after the sample\'s last edit');

  // 3. A component with no work item is skipped.
  w = world({ posts: [Object.assign({}, SAMPLE, { graphic_deliverable_id: '' })] });
  await w.archiveOne('sx_fixture_1', 'fixture');
  ok(w.pushes.length === 1 && w.pushes[0].component === 'video', 'a component with no work item is not pushed');

  // 4. Dropped from the list before the call (the bulk/single callers remove it
  //    optimistically): the pre-captured row is still parked.
  w = world({ posts: [] });
  await w.archiveOne('sx_fixture_1', 'fixture', SAMPLE);
  ok(w.pushes.length === 2, 'a sample already removed from the list is still parked from the captured row');

  // 5. Unresolved sample: archive stands, and it says so.
  w = world({ posts: [] });
  await w.archiveOne('sx_fixture_1', 'fixture');
  ok(w.pushes.length === 0 && w.notices.some(n => /not parked/.test(n)), 'an unresolved sample is reported, not silently skipped');

  // 6. A failed park never fails the archive.
  w = world({ throwOn: 'graphic' });
  let threw = false;
  try { await w.archiveOne('sx_fixture_1', 'fixture'); } catch (e) { threw = true; }
  ok(!threw && w.pushes.length === 1 && w.notices.some(n => /still open/.test(n)), 'a failed park keeps the archive and says a work item is still open');

  // 7. A failed archive parks nothing.
  w = world({ archiveFails: true });
  threw = false;
  try { await w.archiveOne('sx_fixture_1', 'fixture'); } catch (e) { threw = true; }
  ok(threw && w.pushes.length === 0, 'a failed archive throws and parks nothing');

  // 8. Both archive callers hand over the row captured before their own
  //    optimistic removal.
  ok(/_sxrArchiveOne\(pid, slug, post \|\| null\)/.test(source), 'the single archive passes its captured row');
  ok(/_sxrArchiveOne\(id, slug, postById\.get\(id\) \|\| null\)/.test(source), 'the bulk archive passes each captured row');
  // 9. Un-archive forces nothing back: no restore path pushes a status.
  ok(!/_sxrRestore\w*[\s\S]{0,400}_sxrPushStatusToLinear/.test(source), 'no restore path pushes a status back');

  if (failures) { console.error(`samples-archive-parks-work-items: ${failures} failed`); process.exit(1); }
  console.log('samples-archive-parks-work-items: PASS');
})().catch(e => { console.error(e); process.exit(1); });
