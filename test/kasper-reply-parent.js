'use strict';
/*
 * KASPER'S REPLY ON A CARD NOTE (session Porch, review round 3). His Review Session's Reply saves a team-only card note
 * with parent_id = the thread's first message, through his card save (_kasperAddCommentComp -> _kasperPersistPost ->
 * calendar-card-write). This proves, on the code that runs:
 *
 *  1. calendar-card-write keeps the reply whatever its parent: the guards, the comment three-way merge, the
 *     comment-merge arguments and the ledger take it as they take any note (one comment_add row, the same shape as a
 *     plain note's), with no refusal, also when the parent is not in the same list;
 *  2. Messages (production-comments inbox) puts it under its parent, keeps it (on its own) when the parent is not there,
 *     and shows it in the reviewer's own view; staff Notes (190) threads a reply under a parent in the same list;
 *  3. the Review Session only ever offers a parent from the same card list: its conversation is built from the card's
 *     own comment lists (195 _rsThread -> _rsComments -> _calCommentsFor(item.post)), and the reply goes on the root's
 *     own part.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const failures = [];
function ok(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

const NOW = '2026-10-25T01:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const note = (id, extra) => Object.assign({ id, parent_id: null, author: 'Team Member', author_member_id: 'u1', role: 'smm', is_tweak: false, audience: 'internal', body: 'Kasper, is the new intro OK for you?', created_at: '2026-10-24T09:00:00.000Z', updated_at: '2026-10-24T09:00:00.000Z', done: false, done_at: '', done_by: '' }, extra || {});
const kasper = (id, parent) => note(id, { parent_id: parent, author: 'Kasper', author_member_id: undefined, role: 'kasper', body: 'Yes, it works.', created_at: '2026-10-25T00:59:00.000Z', updated_at: '2026-10-25T00:59:00.000Z' });

(async () => {
  const W = await import(path.join(ROOT, 'supabase/functions/calendar-card-write/logic.mjs'));
  const I = await import(path.join(ROOT, 'supabase/functions/production-comments/inbox.mjs'));
  const actor = { actor: 'Kasper', role: 'kasper', source: 'ui' };
  const existing = { id: 'p1', client: 'fixture', status: 'Kasper Approval', video_status: 'Kasper Approval', updated_at: '2026-10-24T09:00:00.000Z', video_tweaks: JSON.stringify([note('k1')]), graphic_tweaks: '[]', caption_tweaks: '[]', title_tweaks: '[]' };
  const norm = s => String(s || '').trim().toLowerCase();
  // What his card save sends: the id and the comment cells (scalars only when they changed; none here).
  const save = list => {
    const body = { client: 'fixture', post: { id: 'p1', video_tweaks: JSON.stringify(list), graphic_tweaks: '[]', caption_tweaks: '[]', title_tweaks: '[]', tweaks: JSON.stringify(list) }, comments_base_at: existing.updated_at };
    const inc = W.buildIncoming(body, NOW, norm).row;
    const row = W.applyGuards({ ...inc }, existing, [], false, NOW_MS);
    return { row, rpc: W.commentRpcArgs('fixture', row), events: W.buildEvents('fixture', row, inc, existing, actor, NOW) };
  };
  const ids = s => JSON.parse(s || '[]').map(c => c.id + (c.parent_id ? '>' + c.parent_id : ''));
  const shape = evs => JSON.stringify(evs.map(e => ({ action: e.action, component: e.component, role: e.role, n: (e.payload && e.payload.added || []).length })));

  console.log('--- 1. calendar-card-write takes the reply as it takes any note ---');
  {
    let reply, plain, orphan, err = '';
    try {
      reply = save([note('k1'), kasper('r1', 'k1')]);
      plain = save([note('k1'), kasper('n1', null)]);
      orphan = save([note('k1'), kasper('r2', 'canonical-only-id')]);
    } catch (e) { err = e.message; }
    ok(!err, 'no refusal for a reply, a plain note, or a reply whose parent is not in the list (' + err + ')');
    if (!err) {
      ok(ids(reply.row.video_tweaks).join(',') === 'k1,r1>k1', 'the merged cell keeps the reply under its parent id (' + ids(reply.row.video_tweaks) + ')');
      ok(ids(orphan.row.video_tweaks).join(',') === 'k1,r2>canonical-only-id', 'and keeps a reply whose parent is elsewhere, as written (' + ids(orphan.row.video_tweaks) + ')');
      ok(!!reply.rpc && reply.rpc.p_video === reply.row.video_tweaks, 'the comment-merge arguments carry the cell unchanged');
      ok(shape(reply.events) === shape(plain.events) && shape(orphan.events) === shape(plain.events), 'the ledger rows are the same as a plain note\'s (' + shape(reply.events) + ')');
      const added = reply.events.find(e => e.action === 'comment_add');
      ok(added && added.payload.added.join() === 'r1' && added.component === 'video', 'one comment_add row naming only the reply');
    }
  }

  console.log('--- 2. Messages and Notes show it ---');
  {
    const post = { id: 'p1', client: 'fixture', name: 'Fixture', video_tweaks: JSON.stringify([note('k1'), kasper('r1', 'k1'), kasper('r2', 'not-here')]) };
    const msgs = I.collectMessages(post, []);
    const r1 = msgs.find(m => m.id === 'r1'), r2 = msgs.find(m => m.id === 'r2');
    ok(r1 && r1.root_id === 'k1' && r1.audience === 'internal', 'Messages: the reply sits in its parent\'s thread, team-only');
    ok(r2 && r2.root_id === 'r2', 'Messages: a reply whose parent is not there is kept on its own, not lost');
    const canon = I.collectMessages({ id: 'p1', video_tweaks: JSON.stringify([kasper('r3', 'c1')]) }, [{ id: 'c1', team: 'video', role: 'smm', author_name: 'Team Member', author_member_id: 'u1', audience: 'internal', body: 'A canonical team note', created_at: '2026-10-24T09:00:00Z' }]);
    ok((canon.find(m => m.id === 'r3') || {}).root_id === 'c1', 'Messages: a reply to a canonical row sits under it too (the inbox reads both)');
    const view = I.visibleMessages(msgs, 'reviewer', new Set(['u1']), { id: 'kasper-id', name: 'Kasper' });
    ok(view.some(m => m.id === 'r1') && view.some(m => m.id === 'k1'), 'Messages, the reviewer\'s view: his reply and the SMM note it answers both show');
    // Staff Notes (190): roots are the notes with no parent, replies are matched by parent id within the same list.
    const src190 = fs.readFileSync(path.join(ROOT, 'src/index/190-calendar-approval-comments.js.part'), 'utf8');
    ok(/function _calCommentReplies\(arr, rootId\) \{\s*return arr\.filter\(c => c\.parent_id === rootId/.test(src190), 'Notes: a reply is drawn under the root of the same list whose id it names');
  }

  console.log('--- 3. The Review Session only offers a parent from the same card list ---');
  {
    const src = fs.readFileSync(path.join(ROOT, 'src/index/195-review-stage.js.part'), 'utf8');
    ok(/comps\.forEach\(comp => _rsComments\(post, comp, mode, item\)\.forEach/.test(src) && /else list = mode === 'client' \? _calCommentsForView\(post, comp\) : _calCommentsFor\(post, comp\);/.test(src),
      'his conversation is built from the card\'s own comment lists (_rsThread -> _rsComments -> _calCommentsFor)');
    ok(/const root = _rsRootOf\(t, new Map\(cur\.thread\.filter\(x => x\.id\)\.map\(x => \[x\.id, x\]\)\)\);/.test(src) && /S\.note\.re = \{ id: root\.id \|\| t\.id, who: _rsFirst\(t\), part: root\.part \|\| t\.part \|\| '' \};/.test(src),
      'the parent is a message of that conversation, and the reply goes on its root\'s part (the same list)');
    ok(/window\._kasperAddCommentComp\(m\.id, comp, parent\)/.test(src), 'and it goes through his own card save with that parent');
  }

  if (failures.length) { console.error('\nkasper-reply-parent: ' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nkasper-reply-parent: all checks passed');
})().catch(e => { console.error(e); process.exit(1); });
