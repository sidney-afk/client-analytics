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
  const inbox = await import(path.join(root, 'supabase/functions/production-comments/inbox.mjs'));
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

  // The client never receives a staff name.
  const policy = await import(path.join(root, 'supabase/functions/production-comments/policy.mjs'));
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
  ok((cal.match(/author_member_id: _calCurrentAuthorId\(\)/g) || []).length === 2, 'new staff notes and replies on the Notes save path, and review comments, store the member id (the request-change path stays byte-identical to main)');
  ok(/if \(_isClientLink\) return '';\s*try \{\s*const identity = _syncviewStaffIdentityForHeaders\(\);\s*return String\(identity && identity\.member && identity\.member\.id/.test(cal), 'the stored value is the member id only, and never on the client link');
  ok(/if \(_isClientLink\) return role === 'client' \? String\(c\.author \|\| fallback \|\| 'Client'\) : 'Synchro team';/.test(cal), 'the client link shows every staff note as "Synchro team"');

  const edge = fs.readFileSync(path.join(root, 'supabase/functions/production-comments/index.ts'), 'utf8');
  ok(/inboxAction === "inbox" \|\| inboxAction === "inbox_mark"/.test(edge), 'the function routes the two inbox actions');
  ok(/resolved\.kind !== "staff" \|\| !resolved\.member\) return json\(\{ ok: false, error: "forbidden" \}, 403\)/.test(edge), 'a client token cannot open the inbox');
  ok(/if \(posts\.length !== 1\) return json\(\{ ok: false, error: "forbidden" \}, 403\)/.test(edge), 'a read mark on a post outside your scope is refused');
  ok(/\.eq\("reader_id", member\.id\)/.test(edge), 'read marks are read for the signed-in member only');
  ok(!/from\("message_reads"\)\.delete/.test(edge), 'the function never deletes read marks');
  ok(/from\("deliverables"\)[\s\S]{0,200}\.select\("id,client_slug,team,card_id"\)/.test(edge)
    && /clientKey\(d\.client_slug\) !== clientKey\(post\.client\)/.test(edge)
    && /normalizeTeam\(d\.team\) !== wantTeam/.test(edge)
    && /clean\(d\.card_id\) && clean\(d\.card_id\) !== clean\(post\.id\)/.test(edge),
    "a card's deliverable link only brings in notes when that deliverable is the card's own client, team and card");

  const staff = fs.readFileSync(path.join(root, 'src/index/100-onboarding-staff-controls.js.part'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'src/index/030-body-shell.html.part'), 'utf8');
  ok(/capability === 'messages-button'\) return role === 'smm';/.test(staff) && /id="navMessages"[^>]*data-staff-capability="messages-button"/.test(shell), 'the header Messages button shows for SMMs only');

  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261014090000_message_reads.sql'), 'utf8');
  ok(/revoke all on table public\.message_reads from public, anon, authenticated, service_role;/.test(migration), 'the migration revokes from all four roles by name');
  ok(/grant select, insert, update on table public\.message_reads to service_role;/.test(migration), 'only the service role gets back select, insert, update');
  ok(!/\bgrant\b[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i.test(migration.replace(/^\s*--.*$/gm, '').replace(/revoke[^;]*;/g, '')), 'no browser role is granted anything');
  ok(/enable row level security/.test(migration), 'row level security is on');

  if (failures) { console.error(`\nmessages-inbox-scope: ${failures} failed`); process.exit(1); }
  console.log('\nmessages-inbox-scope: all checks passed');
})();
