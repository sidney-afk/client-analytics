'use strict';
/* The trial-reels rules (supabase/functions/trial-reels/logic.mjs), in Node, fully offline. Plan:
 * docs/features/TRIAL_REELS_PLAN.md. Also checks the migration's privileges and that the function never writes the
 * card's status or the card's one link. */
const fs = require('node:fs');
const path = require('node:path');
let passed = 0;
const failures = [];
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }

(async () => {
  const L = await import(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const NOW = '2026-10-27T10:00:00.000Z';
  const v = (letter, over) => Object.assign({ id: 'id-' + letter, letter, status: 'waiting', frame_url: 'https://f.io/fixture-' + letter.toLowerCase(), revision: 0, updated_at: '2026-10-27T09:00:00.000Z' }, over || {});
  const five = () => ['A', 'B', 'C', 'D', 'E'].map(l => v(l));
  const A_LINK = 'https://f.io/fixture-a';

  // The switch
  ok(L.flagAllows({ clients: ['fixtureclient'] }, 'fixtureclient') && L.flagAllows({ all: true }, 'x'), 'the switch: a listed client or all');
  ok(!L.flagAllows(null, 'x') && !L.flagAllows({ clients: 'x' }, 'x') && !L.flagAllows([], 'x') && !L.flagAllows({ clients: ['other'] }, 'fixtureclient'), 'the switch fails closed: missing, wrong shape, not listed');

  // Answers: SMM, Kasper, client
  let r = L.answerPatches(five(), { stage: 'smm', kind: 'approve', letter: 'B' }, NOW);
  ok(r.patches.length === 1 && r.patches[0].patch.smm_ok_at === NOW && !('status' in r.patches[0].patch), 'the SMM approving B stamps only smm_ok_at; the label stays waiting');
  r = L.answerPatches(five(), { stage: 'client', kind: 'approve', letter: 'B' }, NOW);
  ok(r.patches[0].patch.status === 'approved' && r.patches[0].patch.client_ok_at === NOW, 'the client approving B makes it approved');
  r = L.answerPatches(five(), { stage: 'client', kind: 'change', letter: 'C' }, NOW);
  ok(r.error === 'note_required', 'a change needs a note');
  r = L.answerPatches(five(), { stage: 'client', kind: 'change', letter: 'C', note: 'Bigger text' }, NOW);
  ok(r.patches[0].patch.status === 'change asked' && r.patches[0].patch.change_by === 'client', 'a change on C: change asked, by the client');
  const mixed = [v('A', { status: 'approved' }), v('B'), v('C', { status: 'change asked' }), v('D', { status: 'dropped' }), v('E')];
  r = L.answerPatches(mixed, { stage: 'client', kind: 'approve_all' }, NOW);
  ok(r.patches.map(p => p.letter).join('') === 'BE', 'Approve all approves only the versions still waiting (not dropped, not changed, not already approved)');
  ok(L.answerPatches(mixed, { stage: 'client', kind: 'approve', letter: 'D' }).error === 'version_dropped', 'a dropped version cannot be answered');
  ok(L.answerPatches(five(), { stage: 'boss', kind: 'approve', letter: 'A' }).error === 'stage_invalid', 'an unknown stage is refused');

  // Stages and the card
  const kasperHalf = five().map((x, i) => i < 4 ? Object.assign(x, { kasper_ok_at: NOW }) : x);
  ok(!L.stageDone(kasperHalf, 'kasper'), "Kasper's stage is not done while one version lacks his OK");
  kasperHalf[4].status = 'dropped';
  ok(L.stageDone(kasperHalf, 'kasper'), "a dropped version does not hold Kasper's stage");
  ok(!L.stageDone(five().map(x => Object.assign(x, { status: 'dropped' })), 'kasper'), 'every version dropped: no stage is ever done');
  ok(L.cardApprovable([v('A', { status: 'approved' }), v('B', { status: 'dropped' })]), 'the card is approvable: none waiting, at least one approved (owner, Q4)');
  ok(!L.cardApprovable([v('A', { status: 'approved' }), v('B', { status: 'change asked' })]), 'a change asked holds the card');
  ok(!L.cardApprovable([v('A', { status: 'dropped' })]), 'all dropped: the card stays where it is');

  // Links: one store, and the card's one link is never two
  ok(L.mainLetter(five()) === 'A' && L.mainLetter([v('A', { status: 'lost' }), v('C', { status: 'winner' })]) === 'C', 'the version on the card: A, then the winner');
  r = L.linkPatch(five(), 'A', 'https://f.io/new-a', A_LINK);
  ok(r.error === 'attach_first', "Video A's new link is refused until the card already carries it (today's attach first)");
  r = L.linkPatch(five(), 'A', 'https://f.io/new-a', 'https://f.io/new-a');
  ok(r.patch && r.patch.frame_url === 'https://f.io/new-a', "once the card carries it, Video A's copy follows");
  r = L.linkPatch(five(), 'B', 'https://f.io/new-b', A_LINK);
  ok(r.patch.frame_url === 'https://f.io/new-b' && !('status' in r.patch), "another version's link is just its own frame_url");
  ok(L.linkPatch(five(), 'B', 'http://f.io/x', A_LINK).error === 'link_not_https' && L.linkPatch(five(), 'B', 'https://' + 'x'.repeat(2050), A_LINK).error === 'link_too_long', 'an http or overlong link is refused');
  r = L.linkPatch([v('A'), v('C', { status: 'change asked', smm_ok_at: NOW, kasper_ok_at: NOW, change_note: 'x', revision: 2 })], 'C', 'https://f.io/new-c', A_LINK);
  ok(r.restarted && r.patch.status === 'waiting' && r.patch.revision === 3 && r.patch.smm_ok_at === null && r.patch.kasper_ok_at === null && r.patch.change_note === null,
    'a new cut of a changed version starts again: revision + 1, OKs cleared, waiting (the normal route, owner Q3)');
  ok(L.linkPatch(five(), 'B', 'https://f.io/fixture-b', A_LINK).patch === null, 'the same link again changes nothing');

  // Drop, trial, winner
  ok(L.dropPatch(five(), 'A').error === 'main_version', 'the version on the card cannot be dropped');
  ok(L.dropPatch(five(), 'D').patch.status === 'dropped' && L.dropPatch([v('D', { status: 'dropped' })], 'D', true).patch.status === 'waiting', 'drop and bring back');
  ok(L.dropPatch([v('C', { status: 'on trial' })], 'C').error === 'version_on_trial', 'a version on trial cannot be dropped');
  r = L.trialPatches([v('A', { status: 'approved' }), v('B', { status: 'approved' }), v('D', { status: 'dropped' })], Date.parse(NOW));
  ok(r.patches.length === 2 && r.patches[0].patch.trial_ends_at === '2026-10-28T10:00:00.000Z', 'on trial: the approved versions, with a 24 h timer');
  ok(L.trialPatches(five(), Date.parse(NOW)).error === 'nothing_approved', 'nothing approved: no trial');
  const trial = [v('A', { status: 'on trial' }), v('B', { status: 'on trial' }), v('C', { status: 'on trial' }), v('D', { status: 'dropped' })];
  ok(L.winnerPatches(trial, 'C', A_LINK).error === 'attach_first', "the winner is refused until the card's link is the winner's");
  r = L.winnerPatches(trial, 'C', 'https://f.io/fixture-c');
  ok(r.patches.map(p => p.letter + ':' + p.patch.status).join(' ') === 'A:lost B:lost C:winner', 'the winner, and the others lost');
  ok(L.winnerPatches(trial, 'D', 'https://f.io/fixture-d').error === 'version_not_on_trial', 'only a version on trial can win');
  ok(!JSON.stringify(r).includes('no clear winner'), 'SyncView never writes "no clear winner" (owner, Q10)');
  const decided = [v('A', { status: 'lost' }), v('B', { status: 'lost' }), v('C', { status: 'winner' }), v('D', { status: 'dropped' })];
  ok(L.undoWinnerPatches(decided, 'https://f.io/fixture-c').error === 'attach_first', "Undo is refused until the card's link is back on Video A's");
  r = L.undoWinnerPatches(decided, A_LINK);
  ok(r.patches.map(p => p.letter + ':' + p.patch.status).join(' ') === 'A:on trial B:on trial C:on trial', 'Undo puts every decided version back on trial (a dropped one stays dropped)');
  ok(L.undoWinnerPatches(trial, A_LINK).error === 'no_winner', 'Undo with no winner is refused');

  // What readers get
  const s1 = L.readShape(mixed, { client: true, mainLink: A_LINK, cardStatus: 'Client Approval' });
  ok(s1.versions.every(x => !('hook' in x) && !('change_note' in x)), 'a client link gets no hook and no team note');
  ok(s1.card_approvable === false && !('card_behind' in s1) && L.readShape([v('A', { status: 'approved' })], { client: true, mainLink: A_LINK }).card_approvable === true, 'a client link learns when the card can move to Approved, and nothing about the team\'s side');
  ok(!s1.versions.some(x => x.letter === 'D'), 'a client link does not see a dropped version');
  const won = [v('A', { status: 'lost' }), v('B', { status: 'lost' }), v('C', { status: 'winner' })];
  const s2 = L.readShape(won, { client: true, mainLink: 'https://f.io/fixture-c' });
  ok(s2.versions.length === 1 && s2.versions[0].letter === 'C', 'once a winner is picked, a client link sees only the winner (owner, Q8)');
  const s3 = L.readShape([v('A', { frame_url: 'https://f.io/old-a' }), v('B')], { client: false, mainLink: A_LINK, cardStatus: 'Client Approval' });
  ok(s3.versions[0].frame_url === A_LINK && s3.versions[0].on_card && s3.main_copy_behind, "for the version on the card the link shown is the card's own, and a lagging copy is flagged");
  const s4 = L.readShape([v('A', { status: 'approved' })], { client: false, mainLink: A_LINK, cardStatus: 'Client Approval' });
  ok(s4.card_behind === true, 'every version answered but the card not Approved: card_behind, so the page sends today\'s approve again');
  const rows = L.ledgerRows('fixtureclient', 'p1', [{ id: 'x', letter: 'C', from: 'waiting', patch: { status: 'change asked' } }], { actor: 'staff:smm', role: 'smm' }, NOW, 'change');
  ok(rows[0].action === 'trial_change' && rows[0].component === 'video' && rows[0].payload.label === 'Video C' && !/^approve_/.test(rows[0].action), 'one ledger row per version, never an approve_ action (OPEN_REPAIRS 504 counts those)');

  ok(L.likeExact('fixture_client') === 'fixture\\_client' && L.likeExact('a%b\\c') === 'a\\%b\\\\c' && L.likeExact('plain') === 'plain', 'a client slug is escaped before ILIKE, so `_` and `%` match only themselves');

  // A version link: only the providers today's Production attach takes for a Deliverable file
  ok(L.cleanLink('https://f.io/x').link === 'https://f.io/x' && L.cleanLink('https://drive.google.com/file/d/abc/view').link && L.cleanLink('https://www.dropbox.com/scl/fi/x/y.mp4?rlkey=k').link, 'Frame.io, Drive and Dropbox links are taken');
  ok(L.cleanLink('https://example.com/x').error === 'link_host_unsupported' && L.cleanLink('https://docs.google.com/document/d/x').error === 'link_host_unsupported'
    && L.cleanLink('https://u:p@f.io/x').error === 'link_host_unsupported' && L.cleanLink('https://f.io/').error === 'link_host_unsupported', 'any other host, a Google Doc, a credential in the address or a bare host is refused (a winner must be able to become the card\'s link)');

  // The sharing check: Production's own rule and words
  ok(L.probeUrl('https://drive.google.com/file/d/abc_1/view?usp=sharing') === 'https://drive.google.com/uc?export=download&id=abc_1'
    && /[?&]raw=1/.test(L.probeUrl('https://www.dropbox.com/scl/fi/x/y.mp4?rlkey=k&dl=0')) && !/dl=0/.test(L.probeUrl('https://www.dropbox.com/scl/fi/x/y.mp4?rlkey=k&dl=0')), 'a Drive file is checked at its download address and a Dropbox share at its raw one, as Production does');
  ok(L.probeHostAllowed('https://f.io/x') && L.probeHostAllowed('https://lh3.googleusercontent.com/x') && L.probeHostAllowed('https://dl.dropboxusercontent.com/x')
    && !L.probeHostAllowed('http://f.io/x') && !L.probeHostAllowed('https://accounts.frame.io/login') && !L.probeHostAllowed('https://127.0.0.1/x') && !L.probeHostAllowed('https://evil.example/f.io'), 'the check opens only the providers and their own file hosts, redirects included');
  const pv = (o) => L.probeVerdict(Object.assign({ status: 200, contentType: 'text/html', sample: '<html>Frame</html>' }, o));
  ok(pv({}) === 'available' && pv({ contentType: 'video/mp4', sample: '' }) === 'available' && pv({ contentType: 'text/plain' }) === 'unavailable', 'a live provider page or a media file is available; anything else is not');
  ok(pv({ status: 403 }) === 'permission_denied' && pv({ status: 404 }) === 'expired' && pv({ status: 500 }) === 'unavailable' && pv({ sample: '<form>Sign in to continue</form>' }) === 'permission_denied' && pv({ sample: '' }) === 'unavailable', 'a sign-in or request-access wall, a gone link and a server error each say so');

  // The copy of the card's one link, caught up after Production's own attach
  const healed = L.healMainPatch(five(), 'https://f.io/fixture-a2');
  ok(healed && healed.letter === 'A' && healed.patch.frame_url === 'https://f.io/fixture-a2', "a new Deliverable file saved in Production is copied to the main version's link");
  ok(L.healMainPatch(five(), A_LINK) === null && L.healMainPatch(five(), '') === null, 'nothing to copy when they agree or the card has no link');
  ok(L.healMainPatch(five(), 'https://f.io/fixture-c') === null, "never while the card's link is another version's (between today's attach and the winner pick or its Undo)");
  const heal2 = L.healMainPatch([v('A', { status: 'change asked', change_by: 'client', revision: 1 }), v('B')], 'https://f.io/fixture-a3');
  ok(heal2.patch.status === 'waiting' && heal2.patch.revision === 2 && heal2.patch.change_by === null, 'a change asked on the main version starts again when its new file lands through Production (Q3)');

  // The function and the migration, read as source
  const src = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'index.ts'), 'utf8');
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok(!/video_status\s*:/.test(code) && !/\.from\("calendar_posts"\)\s*\.(update|insert|upsert)/.test(code), 'the function never writes the card (no status, no link)');
  ok(!/\.from\("deliverables"\)\s*\.(update|insert|upsert)/.test(code) && !/production-write|production_artifact_write/.test(code), 'the function never writes the sub-issue or calls a Section 4 function');
  ok(/assertSwitchOn\(supabase, client\)/.test(code) && /CLIENT_ACTIONS\.includes\(action\)/.test(code), 'every request checks the switch; a client link may only read and answer');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261027090000_trial_reels.sql'), 'utf8');
  ok(/^-- ef-auto-deploy-applied-when: select to_regclass\('public\.trial_reel_cards'\) is not null/m.test(sql), 'the migration says how to tell it is applied, so the merge lane holds the function until then');
  ok(/revoke all on table public\.trial_reel_cards from public, anon, authenticated, service_role;/.test(sql), 'the new table: all four roles revoked');
  ok(/grant select, insert, update on table public\.trial_reel_cards to service_role;/.test(sql) && !/grant[^;]*to (anon|authenticated|public)/i.test(sql), 'only the service role gets SELECT, INSERT, UPDATE back; no browser role gets anything');
  ok(/to_regclass\('public\.studio_trial_versions'\) is null then\s*raise exception/.test(sql), "it stops with a plain error if the studio's table is not applied yet");
  for (const col of ['post_id', 'deliverable_id', 'frame_url', 'smm_ok_at', 'kasper_ok_at', 'client_ok_at', 'change_by', 'change_note', 'change_at', 'revision', 'trial_ends_at']) {
    ok(new RegExp('add column if not exists ' + col + ' ').test(sql), 'settled column ' + col);
  }
  const toml = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'config.toml'), 'utf8');
  ok(/\[functions\.trial-reels\]\nverify_jwt = false/.test(toml), 'config.toml: trial-reels is JWT-off and authenticates itself');

  console.log(`trial-reels-logic: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  if (failures.length) process.exit(1);
})();
