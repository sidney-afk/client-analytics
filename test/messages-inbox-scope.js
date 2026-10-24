'use strict';
/* messages-inbox-scope.js -- who sees what in the Messages inbox (Notes Step 2).
 *
 * Runs production-comments/inbox.mjs, the one place the inbox decides scope
 * and reads notes, against fictional rosters, and checks the wiring in
 * production-comments/index.ts and the read-state migration:
 *   - an SMM sees their own clients and never another SMM's client
 *   - an editor or designer gets nothing
 *   - an admin not on the roster sees every client; one on the roster sees own
 *   - "also sees" grants add clients for that member only
 *   - a posted or archived post is not a conversation
 *   - a reply keeps its first message's part and audience
 *   - unread counts skip your own messages; "unread" marks before the newest
 *     message someone else wrote
 *   - the inbox actions are staff-only, and the new table is readable by no
 *     browser role
 */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
let failures = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { failures++; console.error('FAIL  ' + m); } };

(async () => {
  const inbox = await import(require('node:url').pathToFileURL(path.join(root, 'supabase/functions/production-comments/inbox.mjs')).href);
  const clients = [
    { slug: 'alphafixture', display_name: 'Alpha Fixture', active: true },
    { slug: 'betafixture', display_name: 'Beta Fixture', active: true },
    { slug: 'gammafixture', display_name: 'Gamma Fixture', active: true },
  ];
  const managers = [
    { slug: 'mgr-one', name: 'First Manager', email: 'one@example.invalid', active: true, source_clients: ['Alpha Fixture'] },
    { slug: 'mgr-two', name: 'Second Manager', email: 'two@example.invalid', active: true, source_clients: ['Beta Fixture'] },
  ];
  const smmOne = { id: 'u1', name: 'First Manager', email: '', role: 'smm' };
  const smmTwo = { id: 'u2', name: 'Second Manager', email: '', role: 'smm' };
  const editor = { id: 'u3', name: 'Fixture Editor', role: 'editor' };
  const designer = { id: 'u4', name: 'Fixture Designer', role: 'designer' };
  const reviewer = { id: 'u5', name: 'Fixture Reviewer', role: 'admin' };
  const adminOnRoster = { id: 'u6', name: 'Second Manager', role: 'admin' };
  const set = s => s === 'all' ? 'all' : [...s].sort().join(',');

  ok(set(inbox.inboxScope(smmOne, managers, [], clients)) === 'alphafixture', 'an SMM sees only their own client');
  ok(!inbox.inboxScope(smmOne, managers, [], clients).has('betafixture'), "an SMM never receives another SMM's client");
  ok(set(inbox.inboxScope(smmTwo, managers, [], clients)) === 'betafixture', 'the other SMM sees only theirs');
  ok(set(inbox.inboxScope(editor, managers, [], clients)) === '', 'an editor gets nothing');
  ok(set(inbox.inboxScope(designer, managers, [], clients)) === '', 'a designer gets nothing');
  ok(inbox.inboxScope(reviewer, managers, [], clients) === 'all', 'an admin not on the roster sees every client');
  ok(set(inbox.inboxScope(adminOnRoster, managers, [], clients)) === 'betafixture', 'an admin on the roster sees their own clients');
  const also = [{ viewer_member_id: 'u1', client_name: 'Gamma Fixture' }, { viewer_member_id: 'u2', manager_slug: 'mgr-one' }];
  ok(set(inbox.inboxScope(smmOne, managers, also, clients)) === 'alphafixture,gammafixture', 'an "also sees" client is added for that member');
  ok(set(inbox.inboxScope(smmTwo, managers, also, clients)) === 'alphafixture,betafixture', 'an "also sees" manager grant adds that roster');
  ok(set(inbox.inboxScope({ id: 'u9', name: 'Nobody Listed', role: 'smm' }, managers, also, clients)) === '', 'an SMM with no roster entry and no grant sees nothing');
  ok(set(inbox.inboxScope(smmOne, managers, [], clients.map(c => ({ ...c, active: c.slug !== 'alphafixture' })))) === '', 'an inactive client drops out');

  ok(inbox.isClosedPost({ status: 'Posted' }) && inbox.isClosedPost({ status: 'Archived' }) && inbox.isClosedPost({ status: 'Scheduled', posted_at: '2026-10-01' }), 'posted or archived posts are closed');
  ok(!inbox.isClosedPost({ status: 'In Progress' }), 'an open post stays');

  const post = {
    id: 'p1', client: 'alphafixture', name: 'Fixture post',
    caption_tweaks: JSON.stringify([
      { id: 'r1', role: 'client', author: 'Client', audience: 'client', is_tweak: false, body: 'Question', created_at: '2026-10-10T10:00:00Z' },
      { id: 'r2', parent_id: 'r1', role: 'smm', author: 'First Manager', body: 'Answer', created_at: '2026-10-10T11:00:00Z' },
      { id: 'r3', role: 'smm', author: 'First Manager', audience: 'internal', is_tweak: true, body: 'Fix it', created_at: '2026-10-10T12:00:00Z', deleted: true },
    ]),
    video_tweaks: 'legacy plain text, not a list',
  };
  const canonical = [{ id: 'k1', native_comment_id: 'n1', team: 'video', role: 'kasper', author_name: 'Fixture Reviewer', body: 'Trim it', audience: 'internal', component: 'video', created_at: '2026-10-11T09:00:00Z' }];
  const msgs = inbox.collectMessages(post, canonical);
  ok(msgs.map(m => m.id).join(',') === 'r1,r2,n1', 'card notes and canonical rows merge, deleted notes and plain text are skipped');
  const reply = msgs.find(m => m.id === 'r2');
  ok(reply.component === 'caption' && reply.audience === 'client' && reply.root_id === 'r1', "a reply keeps its first message's part and audience");
  ok(msgs.find(m => m.id === 'n1').audience === 'internal', 'a team-only canonical note stays team only');
  const now = Date.parse('2026-10-12T00:00:00Z');
  ok(inbox.unreadCount(msgs, smmOne, '', now) === 2, 'unread counts every message but your own');
  ok(inbox.unreadCount(msgs, smmOne, '2026-10-10T23:00:00Z', now) === 1, 'a read mark hides what came before it');
  ok(inbox.unreadCount(msgs, smmOne, '', Date.parse('2026-12-01T00:00:00Z')) === 0, 'with no read mark, old messages count as read');
  ok(inbox.unreadMark(msgs, smmOne) === '2026-10-11T08:59:59.999Z', '"unread" marks just before the newest message someone else wrote');
  const conv = inbox.buildConversation(post, msgs, smmOne, '', now);
  ok(conv.post_id === 'p1' && conv.last_body === 'Trim it' && conv.unread === 2, 'a conversation carries its last message and unread count');

  // Who wrote it: a staff note carries the writer's member id.
  const shared = 'Synchro Social';
  const idPost = { id: 'p2', client: 'alphafixture', name: 'Fixture post two',
    caption_tweaks: JSON.stringify([
      { id: 'a1', role: 'smm', author: shared, author_member_id: 'u1', audience: 'internal', body: 'My own note', created_at: '2026-10-11T10:00:00Z' },
      { id: 'a2', role: 'smm', author: shared, author_member_id: 'u2', audience: 'internal', body: 'A colleague note', created_at: '2026-10-11T11:00:00Z' },
      { id: 'a3', role: 'smm', author: shared, audience: 'internal', body: 'An old note with no id', created_at: '2026-10-11T12:00:00Z' },
    ]) };
  const idMsgs = inbox.collectMessages(idPost, []);
  ok(idMsgs.find(m => m.id === 'a1').author_member_id === 'u1', 'the member id travels with the message');
  ok(inbox.isMine(idMsgs.find(m => m.id === 'a1'), smmOne), 'your own note (your member id) is yours');
  ok(!inbox.isMine(idMsgs.find(m => m.id === 'a2'), smmOne), "a colleague's note (their member id) is not yours, though both say " + shared);
  ok(!inbox.isMine(idMsgs.find(m => m.id === 'a3'), smmOne), 'an old note with no id falls back to the name match');
  ok(inbox.isMine({ author: 'First Manager' }, smmOne), 'the name match still works when there is no id');
  ok(!inbox.isMine({ author: 'First Manager', role: 'client' }, smmOne), "a client whose name equals yours is never you");
  ok(inbox.unreadCount([{ id: 'cc1', author: 'First Manager', role: 'client', created_at: '2026-10-11T10:00:00Z' }], smmOne, '', Date.parse('2026-10-12T00:00:00Z')) === 1, "that client's message counts as unread");
  ok(inbox.unreadCount(idMsgs, smmOne, '', Date.parse('2026-10-12T00:00:00Z')) === 2, 'your own note is never unread; the colleague note and the old note are');
  ok(inbox.unreadCount([idMsgs[0]], smmOne, '', Date.parse('2026-10-12T00:00:00Z')) === 0, 'a conversation with only your note has nothing unread');
  ok(inbox.unreadMark(idMsgs.slice(0, 2), smmOne) === '2026-10-11T10:59:59.999Z', '"unread" marks before the colleague note, never yours');
  const idConv = inbox.buildConversation(idPost, idMsgs.slice(0, 2), smmOne, '', Date.parse('2026-10-12T00:00:00Z'));
  ok(idConv.last_author_member_id === 'u2' && idConv.last_role === 'smm', 'a conversation names its last writer by id');
  const canonId = inbox.collectMessages({ id: 'p3' }, [{ id: 'k2', team: 'video', role: 'smm', author_name: 'Second Manager', author_member_id: 'u2', body: 'x', created_at: '2026-10-11T09:00:00Z' }]);
  ok(canonId[0].author_member_id === 'u2', 'canonical notes carry their member id too');

  // Which messages each view shows (owner, 2026-10-14), decided on the server.
  const viewPost = { id: 'p4', client: 'alphafixture', name: 'Fixture view post',
    caption_tweaks: JSON.stringify([
      { id: 'v1', role: 'client', author: 'Fixture Client', audience: 'client', is_tweak: false, body: 'Love it, one question', created_at: '2026-10-12T09:00:00Z' },
      { id: 'v2', role: 'client', author: 'Fixture Client', audience: 'client', is_tweak: true, body: 'Please change the hook', created_at: '2026-10-12T10:00:00Z' },
      { id: 'v3', parent_id: 'v2', role: 'client', author: 'Fixture Client', body: 'And the ending too', created_at: '2026-10-12T10:30:00Z' },
      { id: 'v4', role: 'smm', author: shared, author_member_id: 'u1', audience: 'internal', body: 'Team note from the SMM', created_at: '2026-10-12T11:00:00Z' },
      { id: 'v5', role: 'smm', author: shared, author_member_id: 'u7', audience: 'internal', body: 'Team note from an editor', created_at: '2026-10-12T12:00:00Z' },
      { id: 'v6', role: 'kasper', author: 'Kasper', audience: 'internal', body: 'Team note from the reviewer', created_at: '2026-10-12T13:00:00Z' },
    ]) };
  const viewAll = inbox.collectMessages(viewPost, []);
  const smmIds = new Set(['u1', 'u2']);
  const ids = list => list.map(m => m.id).join(',');
  ok(inbox.inboxView(inbox.inboxScope(smmOne, managers, [], clients)) === 'smm' && inbox.inboxView(inbox.inboxScope(adminOnRoster, managers, [], clients)) === 'smm', 'an SMM, and an admin on the roster, get the SMM view');
  ok(inbox.inboxView(inbox.inboxScope(reviewer, managers, [], clients)) === 'reviewer', 'an admin not on the roster gets the reviewer view');
  const smmView = inbox.visibleMessages(viewAll, 'smm', smmIds);
  ok(smmView.some(m => m.id === 'v1'), 'SMM view: a client plain comment is shown');
  ok(!smmView.some(m => m.id === 'v2'), 'SMM view: an unanswered client change request is hidden');
  ok(!smmView.some(m => m.id === 'v3'), 'SMM view: a reply under a client change request is hidden with it');
  ok(ids(smmView) === 'v1,v4,v5,v6', 'SMM view: team-only notes between staff are shown');
  const revView = inbox.visibleMessages(viewAll, 'reviewer', smmIds);
  ok(ids(revView) === 'v4', 'reviewer view: with no reviewer thread, only team-only notes written by an SMM');
  ok(!revView.some(m => m.role === 'client' || m.audience === 'client'), 'reviewer view: no client messages');
  ok(inbox.visibleMessages([{ id: 'o1', role: 'smm', author: 'Old', audience: 'internal', created_at: '2026-10-12T09:00:00Z', root_id: 'o1' }], 'reviewer', smmIds).length === 1, 'reviewer view: an old SMM note with no member id still counts as an SMM note');
  const onlyRequest = inbox.collectMessages({ id: 'p5', caption_tweaks: JSON.stringify([viewAll[1]].map(m => ({ ...m }))) }, []);
  ok(inbox.visibleMessages(onlyRequest, 'smm', smmIds).length === 0, 'SMM view: a conversation with only a change request has nothing to show (the server drops it)');
  ok(inbox.unreadCount(smmView, smmOne, '', Date.parse('2026-10-13T00:00:00Z')) === 3, 'SMM view: hidden messages never count as unread');
  ok(inbox.unreadCount(revView, reviewer, '', Date.parse('2026-10-13T00:00:00Z')) === 1, 'reviewer view: only the SMM team note counts as unread');

  // Reviewer view, threads the reviewer is in (owner, 2026-10-15): the reviewer
  // writes a team-only change request, an editor replies, the reviewer sees it.
  const kPost = { id: 'p6', client: 'alphafixture', name: 'Fixture reviewer thread',
    video_tweaks: JSON.stringify([
      { id: 'k1', role: 'kasper', author: 'Kasper', audience: 'internal', is_tweak: true, body: 'Cut the intro', created_at: '2026-10-14T09:00:00Z' },
      { id: 'k2', parent_id: 'k1', role: 'smm', author: shared, author_member_id: 'u7', body: 'The intro sets up the joke, so I kept two seconds', created_at: '2026-10-14T10:00:00Z' },
      { id: 'k3', role: 'smm', author: shared, author_member_id: 'u7', audience: 'internal', body: 'Unrelated editor note', created_at: '2026-10-14T11:00:00Z' },
      { id: 'k4', role: 'client', author: 'Fixture Client', audience: 'client', is_tweak: false, body: 'Client comment', created_at: '2026-10-14T12:00:00Z' },
      { id: 'k5', role: 'smm', author: shared, author_member_id: 'u5', audience: 'internal', body: 'Reviewer note from the inbox', created_at: '2026-10-14T13:00:00Z' },
      { id: 'k6', parent_id: 'k5', role: 'smm', author: shared, author_member_id: 'u7', body: 'Editor answer to the inbox note', created_at: '2026-10-14T14:00:00Z' },
    ]) };
  const kAll = inbox.collectMessages(kPost, []);
  const kView = inbox.visibleMessages(kAll, 'reviewer', smmIds, reviewer);
  ok(kView.some(m => m.id === 'k1'), "reviewer view: the reviewer's own team-only change request is shown");
  ok(kView.some(m => m.id === 'k2'), "reviewer view: an editor's reply in the reviewer's thread is shown");
  ok(kView.some(m => m.id === 'k5') && kView.some(m => m.id === 'k6'), "reviewer view: the reviewer's own note (by member id) and an editor reply to it are shown");
  ok(!kView.some(m => m.id === 'k3'), 'reviewer view: an editor note outside the reviewer threads stays hidden');
  ok(!kView.some(m => m.role === 'client' || m.audience === 'client'), 'reviewer view: still never a client message');
  ok(inbox.unreadCount(kView, reviewer, '', Date.parse('2026-10-15T00:00:00Z')) === 2, "reviewer view: the editor replies count as unread, the reviewer's own notes never do");
  ok(inbox.unreadCount(kView, reviewer, '2026-10-14T09:30:00Z', Date.parse('2026-10-15T00:00:00Z')) === 2 && inbox.unreadCount(kView, reviewer, '2026-10-14T10:30:00Z', Date.parse('2026-10-15T00:00:00Z')) === 1, 'reviewer view: the editor reply after the read mark is unread');
  ok(ids(inbox.visibleMessages(kAll, 'smm', smmIds, smmOne)) === ids(inbox.visibleMessages(kAll, 'smm', smmIds)), 'SMM view: unchanged by the reviewer rule');

  // A hidden client message comes back when staff answer it (owner, 2026-10-15).
  const aPost = { id: 'p7', client: 'alphafixture', name: 'Fixture answered post',
    caption_tweaks: JSON.stringify([
      { id: 'q1', role: 'client', author: 'Fixture Client', audience: 'client', is_tweak: true, body: 'Change the hook please', created_at: '2026-10-14T09:00:00Z' },
      { id: 'q2', parent_id: 'q1', role: 'smm', author: shared, author_member_id: 'u5', body: 'Done, new hook is up', created_at: '2026-10-14T10:00:00Z' },
      { id: 'q3', role: 'client', author: 'Fixture Client', audience: 'client', is_tweak: true, body: 'Swap the music', created_at: '2026-10-14T11:00:00Z' },
      { id: 'q4', role: 'client', author: 'Fixture Client', audience: 'client', is_tweak: false, body: 'Love the colours', created_at: '2026-10-14T12:00:00Z' },
      { id: 'q5', parent_id: 'q4', role: 'smm', author: shared, author_member_id: 'u1', body: 'Thank you', created_at: '2026-10-14T13:00:00Z' },
    ]) };
  const aAll = inbox.collectMessages(aPost, []);
  const aSmm = inbox.visibleMessages(aAll, 'smm', smmIds, smmOne);
  ok(aSmm.some(m => m.id === 'q1') && aSmm.some(m => m.id === 'q2'), 'SMM view: an answered change request is shown above the staff reply');
  ok(!aSmm.some(m => m.id === 'q3'), 'SMM view: an unanswered change request stays hidden');
  const aRev = inbox.visibleMessages(aAll, 'reviewer', smmIds, reviewer);
  ok(aRev.some(m => m.id === 'q1') && aRev.some(m => m.id === 'q2'), 'reviewer view: a client message the reviewer replied to is shown, with the reply');
  ok(!aRev.some(m => m.id === 'q3' || m.id === 'q4' || m.id === 'q5'), 'reviewer view: client messages the reviewer did not reply to stay hidden, even when someone else did');
  ok(inbox.unreadCount(aRev, reviewer, '', Date.parse('2026-10-15T00:00:00Z')) === 1, 'reviewer view: unread counts only visible messages (the client message, never the own reply)');
  ok(inbox.unreadCount(aSmm, smmOne, '', Date.parse('2026-10-15T00:00:00Z')) === 3, 'SMM view: unread counts only visible messages (the hidden request is not counted)');

  // Canonical rows: parent and root are database row ids, listed under native ids.
  const cAll = inbox.collectMessages({ id: 'p8', client: 'alphafixture' }, [
    { id: 'db1', native_comment_id: 'n_req', team: 'video', role: 'client', author_name: 'Fixture Client', audience: 'client', is_tweak: true, body: 'Change the intro', created_at: '2026-10-14T09:00:00Z' },
    { id: 'db2', native_comment_id: 'n_rep', parent_id: 'db1', thread_root_id: 'db1', team: 'video', role: 'smm', author_name: shared, author_member_id: 'u5', body: 'Changed it', created_at: '2026-10-14T10:00:00Z' },
  ]);
  ok(cAll.find(m => m.id === 'n_rep').parent_id === 'n_req' && cAll.find(m => m.id === 'n_rep').root_id === 'n_req', 'canonical replies point at the listed id of their parent');
  ok(ids(inbox.visibleMessages(cAll, 'smm', smmIds, smmOne)) === 'n_req,n_rep', 'SMM view: an answered canonical change request is shown with its reply');
  ok(ids(inbox.visibleMessages(cAll, 'reviewer', smmIds, reviewer)) === 'n_req,n_rep', 'reviewer view: a canonical client message the reviewer answered is shown with the reply');

  // The client never receives a staff name.
  const policy = await import(require('node:url').pathToFileURL(path.join(root, 'supabase/functions/production-comments/policy.mjs')).href);
  const staffRow = { id: 'c1', author_name: 'Second Manager', author_member_id: 'u2', role: 'smm', audience: 'client', body: 'Hello' };
  const clientRow = { id: 'c2', author_name: 'Fixture Client', role: 'client', audience: 'client', body: 'Hi' };
  const asClient = policy.publicComment(staffRow, 'client');
  ok(asClient && asClient.author_name === 'Synchro team', 'a client reading a staff note sees "Synchro team"');
  ok(asClient && !('author_member_id' in asClient), 'a client never receives the member id');
  ok(!JSON.stringify(asClient).includes('Second Manager'), 'no staff name in what the client receives');
  ok(policy.publicComment(clientRow, 'client').author_name === 'Fixture Client', "a client's own note keeps its name");
  const asStaff = policy.publicComment(staffRow, 'staff');
  ok(asStaff.author_name === 'Second Manager' && asStaff.author_member_id === 'u2', 'staff see the name and the id');

  const cal = fs.readFileSync(path.join(root, 'src/index/190-calendar-approval-comments.js.part'), 'utf8');
  // Since the note outbox (2026-10-15) the Notes Send and the review Comment
  // take the member id at the click (it rides the outbox entry into the note);
  // _calAppendComment keeps its own for any other caller. The request-change
  // path still adds none.
  const fnBody = name => { const i = cal.indexOf('function ' + name + '('); return i < 0 ? '' : cal.slice(i, cal.indexOf('\n    }\n', i)); };
  ok(/author_member_id: _calCurrentAuthorId\(\)/.test(fnBody('_calAppendComment'))
    && /author_member_id: _calCurrentAuthorId\(\) \|\| undefined/.test(fnBody('_calSubmitComposerNow'))
    && /author_member_id: _calCurrentAuthorId\(\) \|\| undefined/.test(fnBody('_calReviewComment'))
    && /author_member_id: entry\.author_member_id/.test(fnBody('_calReviewAddOutboxComment'))
    && !/_calCurrentAuthorId/.test(fnBody('_calReviewRequestTweak')), 'new staff notes and replies on the Notes save path, and review comments, store the member id (the request-change path adds none)');
  ok(/if \(_isClientLink\) return '';\s*try \{\s*const identity = _syncviewStaffIdentityForHeaders\(\);\s*return String\(identity && identity\.member && identity\.member\.id/.test(cal), 'the stored value is the member id only, and never on the client link');
  ok(/if \(_isClientLink\) return role === 'client' \? String\(c\.author \|\| fallback \|\| 'Client'\) : 'Synchro team';/.test(cal), 'the client link shows every staff note as "Synchro team"');

  const edge = fs.readFileSync(path.join(root, 'supabase/functions/production-comments/index.ts'), 'utf8');
  ok(/inboxAction === "inbox" \|\| inboxAction === "inbox_mark"/.test(edge), 'the function routes the two inbox actions');
  ok(/resolved\.kind !== "staff" \|\| !resolved\.member\) return json\(\{ ok: false, error: "forbidden" \}, 403\)/.test(edge), 'a client token cannot open the inbox');
  ok(/if \(posts\.length !== 1\) return json\(\{ ok: false, error: "forbidden" \}, 403\)/.test(edge), 'a read mark on a post outside your scope is refused');
  ok(/\.eq\("reader_id", member\.id\)/.test(edge), 'read marks are read for the signed-in member only');
  ok((edge.match(/visibleMessages\(collectMessages\([^;]*view, smmIds, member\)/g) || []).length === 2 && /const view = inboxView\(scope\);/.test(edge), 'the server filters both the list and the read mark by view');
  ok(/if \(!messages\.length\) return null;/.test(edge), 'a conversation with no visible message is dropped on the server');
  ok(!/from\("message_reads"\)\.delete/.test(edge), 'the function never deletes read marks');
  ok(/from\("deliverables"\)[\s\S]{0,200}\.select\("id,client_slug,team,card_id"\)/.test(edge)
    && /clientKey\(d\.client_slug\) !== clientKey\(post\.client\)/.test(edge)
    && /normalizeTeam\(d\.team\) !== wantTeam/.test(edge)
    && /clean\(d\.card_id\) && clean\(d\.card_id\) !== clean\(post\.id\)/.test(edge),
    "a card's deliverable link only brings in notes when that deliverable is the card's own client, team and card");

  // What counts as NEW (owner, 2026-10-18): only a person talking to you; automatic records never count.
  const capRecord = { id: 'n1', author: 'Fixture Client', role: 'client', body: 'Changed the caption to:\n\nNew words\n\nIt was:\n\nOld words', created_at: '2026-10-11T10:00:00Z' };
  const clientNote = { id: 'n2', author: 'Fixture Client', role: 'client', body: 'Can we add the hours?', created_at: '2026-10-11T11:00:00Z' };
  const staffNote = { id: 'n3', author: 'First Manager', author_member_id: 'u1', role: 'smm', body: 'Trim the intro.', created_at: '2026-10-11T12:00:00Z' };
  const ownNote = { id: 'n4', author: 'Fixture Reviewer', author_member_id: 'u5', role: 'kasper', body: 'On it.', created_at: '2026-10-11T13:00:00Z' };
  const sysNote = { id: 'n5', author: 'SyncView', role: 'system', body: 'Status moved to In Review.', created_at: '2026-10-11T14:00:00Z' };
  const nowMs = Date.parse('2026-10-12T00:00:00Z');
  ok(inbox.unreadCount([capRecord], smmOne, '', nowMs, 'smm') === 0, 'SMM view: the caption-change record is never new');
  ok(inbox.unreadCount([capRecord], reviewer, '', nowMs, 'reviewer') === 0, 'reviewer view: the caption-change record is never new');
  ok(inbox.unreadCount([sysNote], smmOne, '', nowMs, 'smm') === 0 && inbox.unreadCount([sysNote], reviewer, '', nowMs, 'reviewer') === 0, 'a system-written record is never new in either view');
  ok(inbox.unreadCount([clientNote], smmOne, '', nowMs, 'smm') === 1, "SMM view: a client's plain note still counts, as before");
  ok(inbox.unreadCount([clientNote], reviewer, '', nowMs, 'reviewer') === 0, "reviewer view: a client's note shows but never counts");
  ok(inbox.unreadCount([staffNote], reviewer, '', nowMs, 'reviewer') === 1, "reviewer view: a manager's message counts");
  ok(inbox.unreadCount([ownNote], reviewer, '', nowMs, 'reviewer') === 0, 'reviewer view: your own message never counts');
  ok(inbox.unreadCount([capRecord, clientNote, staffNote, ownNote, sysNote], reviewer, '', nowMs, 'reviewer') === 1, 'reviewer view: a mixed thread counts only the manager message');
  ok(inbox.unreadMark([capRecord, staffNote, sysNote], reviewer, 'reviewer') === '2026-10-11T11:59:59.999Z', '"unread" marks before the newest message that counts, not the later record');

  // "Automatic" is the record's whole shape, so a person who types those first words is still a person,
  // and the words the client page really writes (read from its source, never retyped here) still match.
  const typed = { id: 'n6', author: 'Fixture Client', role: 'client', body: 'Changed the caption to: the hours please, ok?', created_at: '2026-10-11T15:00:00Z' };
  ok(inbox.unreadCount([typed], smmOne, '', nowMs, 'smm') === 1, 'SMM view: a client who types the caption-change words as a real message still counts');
  const rsSrc = fs.readFileSync(path.join(root, 'src/index/195-review-stage.js.part'), 'utf8');
  const rsHead = (rsSrc.match(/const RS_EDIT_HEAD = '((?:[^'\\]|\\.)*)', RS_EDIT_WAS = '((?:[^'\\]|\\.)*)', RS_EDIT_EMPTY = '((?:[^'\\]|\\.)*)';/) || []).slice(1).map((t) => t && JSON.parse('"' + t.replace(/"/g, '\\"') + '"'));
  ok(rsHead.length === 3, 'the client page still defines the caption-change words this server recognises');
  if (rsHead.length === 3) {
    const real = (now, old) => ({ ...capRecord, body: rsHead[0] + now + (old ? rsHead[1] + old : rsHead[2]) });
    ok(inbox.isAutomaticRecord(real('New words', 'Old words')) && inbox.isAutomaticRecord(real('New words', '')), "what the client page writes (with and without an old caption) is recognised as an automatic record");
    ok(inbox.isAutomaticRecord({ ...real('New\nwords', 'Old'), body: real('New\nwords', 'Old').body.replace(/\n/g, '\r\n') }), 'a record whose line breaks became CRLF is still recognised');
  }
  // The phone's "New messages" line goes before the first message that counts, not before the last N incoming.
  const afterRecord = { id: 'n7', author: 'Fixture Client', role: 'client', body: capRecord.body, created_at: '2026-10-11T13:30:00Z' };
  ok(inbox.firstUnreadId([staffNote, afterRecord], reviewer, '', nowMs, 'reviewer') === 'n3', 'the first new message is named even when an automatic record follows it');
  ok(inbox.firstUnreadId([capRecord, sysNote], reviewer, '', nowMs, 'reviewer') === '', 'nothing new, no first new message');
  ok(inbox.buildConversation({ id: 'p9', client: 'x' }, [staffNote, afterRecord], reviewer, '', nowMs, 'reviewer').first_unread_id === 'n3', 'the conversation carries first_unread_id');

  const staff = fs.readFileSync(path.join(root, 'src/index/100-onboarding-staff-controls.js.part'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'src/index/030-body-shell.html.part'), 'utf8');
  ok(/capability === 'messages-button'\) return role === 'admin' \|\| role === 'smm';/.test(staff) && /id="navMessages"[^>]*data-staff-capability="messages-button"/.test(shell), 'the header Messages button shows for admins and SMMs, never editors or designers');

  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261014090000_message_reads.sql'), 'utf8');
  ok(/revoke all on table public\.message_reads from public, anon, authenticated, service_role;/.test(migration), 'the migration revokes from all four roles by name');
  ok(/grant select, insert, update on table public\.message_reads to service_role;/.test(migration), 'only the service role gets back select, insert, update');
  ok(!/\bgrant\b[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i.test(migration.replace(/^\s*--.*$/gm, '').replace(/revoke[^;]*;/g, '')), 'no browser role is granted anything');
  ok(/enable row level security/.test(migration), 'row level security is on');

  // Round 7: a message carries its attachments (safe links only), and a message without any carries none.
  const filed = inbox.collectMessages({ id: 'p10', video_tweaks: JSON.stringify([
    { id: 'f1', body: 'photos', role: 'client', created_at: '2026-10-20T10:00:00Z', attachments: [{ name: 'cover.jpg', url: 'https://example.invalid/cover.jpg' }, { name: 'bad', url: 'javascript:alert(1)' }] },
    { id: 'f2', body: 'plain', role: 'client', created_at: '2026-10-20T10:01:00Z' }]) },
    [{ id: 'k3', native_comment_id: 'f3', team: 'video', role: 'client', body: 'canonical photo', attachments: [{ name: 'shot.png', url: 'https://example.invalid/shot.png' }], created_at: '2026-10-20T10:02:00Z' }]);
  const files = id => (filed.find(m => m.id === id) || {}).attachments;
  ok(JSON.stringify(files('f1')) === JSON.stringify([{ url: 'https://example.invalid/cover.jpg', name: 'cover.jpg' }]), 'a message carries its attachments, without an unsafe link');
  ok(files('f2') === undefined && !('attachments' in filed.find(m => m.id === 'f2')), 'a message without attachments carries none');
  ok(files('f3') && files('f3')[0].name === 'shot.png', 'a canonical row carries its attachments too');

  if (failures) { console.error(`\nmessages-inbox-scope: ${failures} failed`); process.exit(1); }
  console.log('\nmessages-inbox-scope: all checks passed');
})();
