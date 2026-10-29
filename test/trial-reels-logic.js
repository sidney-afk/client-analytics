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
  const smmDone = () => five().map(x => Object.assign(x, { smm_ok_at: NOW }));
  r = L.answerPatches(smmDone(), { stage: 'client', kind: 'approve', letter: 'B' }, NOW);
  ok(r.patches[0].patch.status === 'approved' && r.patches[0].patch.client_ok_at === NOW, 'the client approving B makes it approved');
  r = L.answerPatches(five(), { stage: 'client', kind: 'change', letter: 'C' }, NOW);
  ok(r.error === 'note_required', 'a change needs a note');
  r = L.answerPatches(five(), { stage: 'client', kind: 'change', letter: 'C', note: 'Bigger text' }, NOW);
  ok(r.patches[0].patch.status === 'change asked' && r.patches[0].patch.change_by === 'client', 'a change on C: change asked, by the client');
  const mixed = [v('A', { status: 'approved', smm_ok_at: NOW }), v('B', { smm_ok_at: NOW }), v('C', { status: 'change asked', smm_ok_at: NOW }), v('D', { status: 'dropped' }), v('E', { smm_ok_at: NOW })];
  r = L.answerPatches(mixed, { stage: 'client', kind: 'approve_all' }, NOW);
  ok(r.patches.map(p => p.letter).join('') === 'BE', 'Approve all approves only the versions still waiting (not dropped, not changed, not already approved)');
  ok(L.answerPatches(mixed, { stage: 'client', kind: 'approve', letter: 'D' }).error === 'version_dropped', 'a dropped version cannot be answered');
  ok(L.answerPatches(five(), { stage: 'boss', kind: 'approve', letter: 'A' }).error === 'stage_invalid', 'an unknown stage is refused');
  // The server holds the rules, not only the page (Probe, batch 1)
  ok(L.answerPatches(mixed, { stage: 'client', kind: 'approve', letter: 'C' }, NOW).error === 'change_open', 'a version with a change asked cannot be approved: it waits for its new cut (Q3)');
  ok(L.answerPatches(five(), { stage: 'client', kind: 'approve', letter: 'B' }, NOW).error === 'stage_order' && L.answerPatches(five(), { stage: 'kasper', kind: 'approve', letter: 'B' }, NOW).error === 'stage_order',
    'Kasper and the client answer a version only after the SMM has');
  ok(L.answerPatches(five(), { stage: 'client', kind: 'approve_all' }, NOW).patches.length === 0, 'Approve all skips every version not yet through the SMM');
  // A card the team sent on today's way (today's Approve before the trial page, or the status menu) with no version the
  // SMM has looked at: each version counts as through the SMM for the stage the card was sent to (Sidney, 2026-10-27:
  // sent for approval, the client link must show the versions to answer). One unseen among seen ones stays with the team.
  ok(L.answerPatches(five(), { stage: 'client', kind: 'approve', letter: 'B', cardStatus: 'Client Approval' }, NOW).patches.map(p => p.letter).join() === 'B'
    && L.answerPatches(five(), { stage: 'client', kind: 'approve_all', cardStatus: 'Client Approval' }, NOW).patches.length === 5,
    'a card sent to the client with no version through the SMM: the client answers each version, and Approve all takes them all');
  ok(L.answerPatches(five(), { stage: 'kasper', kind: 'approve', letter: 'B', cardStatus: 'Kasper Approval' }, NOW).patches.length === 1
    && L.answerPatches(five(), { stage: 'client', kind: 'approve', letter: 'B', cardStatus: 'Kasper Approval' }, NOW).error === 'stage_order',
    'sent to Kasper: Kasper answers, the client still waits for its turn');
  ok(L.answerPatches(five(), { stage: 'client', kind: 'approve', letter: 'B', cardStatus: 'Tweaks Needed' }, NOW).error === 'stage_order',
    'a card the team has not sent on keeps the order');
  const someSeen = () => five().map(x => x.letter === 'A' ? Object.assign(x, { smm_ok_at: NOW }) : x);
  ok(L.answerPatches(someSeen(), { stage: 'client', kind: 'approve', letter: 'B', cardStatus: 'Client Approval' }, NOW).error === 'stage_order'
    && L.answerPatches(someSeen(), { stage: 'client', kind: 'approve_all', cardStatus: 'Client Approval' }, NOW).patches.map(p => p.letter).join() === 'A',
    'once the SMM has looked at one version, one it has not seen stays with the team (Probe rule-miss 13)');
  ok(L.readShape(five(), { client: true, mainLink: A_LINK, cardStatus: 'Client Approval' }).versions.every(x => x.ready === true)
    && L.readShape(someSeen(), { client: true, mainLink: A_LINK, cardStatus: 'Client Approval' }).versions.map(x => x.ready).join() === 'true,false,false,false,false',
    'the read says the same: ready on a card sent on whole, the SMM\'s own looks otherwise');
  const noLink = smmDone(); noLink[1].frame_url = null;
  ok(L.answerPatches(noLink, { stage: 'client', kind: 'approve', letter: 'B' }, NOW).error === 'version_has_no_link'
    && L.answerPatches(noLink, { stage: 'client', kind: 'approve_all' }, NOW).patches.every(p => p.letter !== 'B'), 'a version with no link is never approved: nothing to watch');
  ok(L.staffAllows('admin', 'winner_set') && L.staffAllows('smm', 'version_drop') && L.staffAllows('creative', 'version_link_set')
    && !L.staffAllows('creative', 'answer') && !L.staffAllows('creative', 'winner_set') && !L.staffAllows('automation', 'version_link_set') && L.staffAllows('automation', 'read'),
    'staff keys: admin and SMM everything, an editor only pastes a link (Q9), the automation key only reads');

  // Stages and the card
  // Every version through the SMM: E, lacking only Kasper's OK, waits for him (per-version routing, below).
  const kasperHalf = five().map((x, i) => Object.assign(x, { smm_ok_at: NOW }, i < 4 ? { kasper_ok_at: NOW } : {}));
  ok(!L.stageDone(kasperHalf, 'kasper'), "Kasper's stage is not done while one version lacks his OK");
  kasperHalf[4].status = 'dropped';
  ok(L.stageDone(kasperHalf, 'kasper'), "a dropped version does not hold Kasper's stage");
  ok(!L.stageDone(five().map(x => Object.assign(x, { status: 'dropped' })), 'kasper'), 'every version dropped: no stage is ever done');

  // Per-version routing (Sidney, 2026-10-29): a stage is done once nothing waits for that reviewer and one version has
  // passed it; a version waiting for its new cut, or still behind with an earlier reviewer, never holds the card.
  {
    const smmMixed = [v('A', { smm_ok_at: NOW }), v('B', { status: 'change asked', change_by: 'smm' }), v('C', { smm_ok_at: NOW })];
    ok(L.stageDone(smmMixed, 'smm'), 'A and C approved by the SMM, B changed: the SMM is done, so A and C go on to Kasper');
    ok(!L.stageDone([v('A', { smm_ok_at: NOW }), v('B', { status: 'change asked' }), v('C')], 'smm'), 'C still waits for the SMM: not done');
    ok(!L.stageDone([v('A', { status: 'change asked' }), v('B', { status: 'change asked' })], 'smm'), 'every version changed: not done (the card goes to Tweaks Needed)');
    const kMixed = [v('A', { smm_ok_at: NOW, kasper_ok_at: NOW }), v('B'), v('C', { smm_ok_at: NOW, kasper_ok_at: NOW })];
    ok(L.stageDone(kMixed, 'kasper', 'Kasper Approval'), "B's new cut is back with the SMM: Kasper is done with A and C, so they go to the client");
    ok(!L.stageDone([v('A', { smm_ok_at: NOW, kasper_ok_at: NOW }), v('B', { smm_ok_at: NOW })], 'kasper', 'Kasper Approval'), 'B through the SMM waits for Kasper: not done');
    ok(!L.stageDone([v('A', { smm_ok_at: NOW, kasper_ok_at: NOW, status: 'change asked' }), v('B')], 'kasper', 'Kasper Approval'), "a version Kasper asked to change doesn't count as passed");
    // Sent to Kasper the whole-card way (today's Approve or the status menu, no SMM OK on any version): every version is
    // with Kasper, so his OK on A alone does not finish his stage (Codex on PR 2452).
    const whole = [v('A', { kasper_ok_at: NOW }), v('B'), v('C')];
    ok(!L.stageDone(whole, 'kasper', 'Kasper Approval') && whole.map(x => L.placeOf(x, whole, 'Kasper Approval')).join() === 'client,kasper,kasper',
      "a card sent whole to Kasper: B and C still wait for him after A, so he is not done");
    const wholeAll = whole.map(x => Object.assign({}, x, { kasper_ok_at: NOW }));
    ok(L.stageDone(wholeAll, 'kasper', 'Kasper Approval'), 'and once he has answered all three, he is done');
    const wholeC = [v('A'), v('B')];
    ok(wholeC.map(x => L.placeOf(x, wholeC, 'Client Approval')).join() === 'client,client', 'a card sent whole to the client: every version is with the client');
    // Kasper on the route, and where each version is.
    ok(L.kasperOnRoute([v('A', { smm_ok_at: NOW })], 'Kasper Approval') && L.kasperOnRoute([v('A', { smm_ok_at: NOW, kasper_ok_at: NOW })], 'Client Approval')
      && !L.kasperOnRoute([v('A', { smm_ok_at: NOW })], 'Client Approval'), "Kasper is on the route unless the card reached the client with no version through him");
    const places = [v('A', { smm_ok_at: NOW, kasper_ok_at: NOW }), v('B', { smm_ok_at: NOW }), v('C'), v('D', { status: 'change asked' }), v('E', { status: 'approved', smm_ok_at: NOW, kasper_ok_at: NOW, client_ok_at: NOW })];
    ok(places.map(x => L.placeOf(x, places, 'Client Approval')).join() === 'client,kasper,smm,new_cut,approved',
      'each version says where it is: with the client, with Kasper, with the SMM, waiting for its new cut, approved');
    ok(L.placeOf(v('F', { smm_ok_at: NOW }), [v('F', { smm_ok_at: NOW })], 'Client Approval') === 'client' && L.placeOf(v('G', { client_pass_at: NOW }), [], 'Client Approval') === 'client_dropped'
      && L.placeOf(v('H', { status: 'dropped' }), [], 'Client Approval') === 'dropped', 'sent straight to the client: through the SMM is with the client; client dropped; dropped');
    // The client link sees only versions that have come through the team, and answers only those.
    const read = L.readShape(places, { client: true, mainLink: A_LINK, cardStatus: 'Client Approval' });
    ok(read.versions.filter(x => x.ready).map(x => x.letter).join() === 'A,E', 'the client read: only A (through Kasper) and E are ready; B is still with Kasper, C with the SMM');
    ok(L.answerPatches(places, { stage: 'client', kind: 'approve', letter: 'B', cardStatus: 'Client Approval' }, NOW).error === 'stage_order'
      && L.answerPatches(places, { stage: 'client', kind: 'approve_all', cardStatus: 'Client Approval' }, NOW).patches.map(p => p.letter).join() === 'A',
      'the server holds it too: the client cannot answer B while it is with Kasper');
    const staff = L.readShape(places, { client: false, mainLink: A_LINK, cardStatus: 'Client Approval' });
    ok(staff.versions.map(x => x.place).join() === 'client,kasper,smm,new_cut,approved' && staff.stages_done.kasper === false && staff.stages_done.smm === false,
      'the staff read carries each place; Kasper and the SMM each still have a version');
  }
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
  r = L.linkPatch([v('A'), v('B', { status: 'approved', smm_ok_at: NOW, kasper_ok_at: NOW, client_ok_at: NOW })], 'B', 'https://f.io/new-b2', A_LINK);
  ok(r.restarted && r.patch.status === 'waiting' && r.patch.client_ok_at === null, 'a link that replaces an approved version\'s link starts it again: no approval covers an unseen video');
  r = L.linkPatch([v('A'), v('B', { frame_url: null, smm_ok_at: NOW })], 'B', 'https://f.io/first-b', A_LINK);
  ok(!r.restarted && r.patch.frame_url === 'https://f.io/first-b', 'a first paste keeps what the version had');
  ok(L.linkPatch(five(), 'B', 'https://f.io/fixture-c', A_LINK).error === 'link_used_by_another_version', 'one link, one version');
  ok(L.linkPatch([v('A'), v('B', { status: 'on trial' })], 'B', 'https://f.io/new-b3', A_LINK).error === 'version_on_trial', 'a decided version keeps its link');

  // Default (b): "New cut ready" restarts a version asked to change, at the same link.
  r = L.newCutPatch([v('C', { status: 'change asked', smm_ok_at: NOW, kasper_ok_at: NOW, change_note: 'shorter', revision: 2 })], 'C');
  ok(r.patch.status === 'waiting' && r.patch.revision === 3 && r.patch.smm_ok_at === null && r.patch.kasper_ok_at === null && r.patch.change_note === null,
    'New cut ready: the version goes back to waiting, revision up, every OK and the change cleared (the SMM and Kasper review it again)');
  ok(L.newCutPatch([v('C', { status: 'approved' })], 'C').error === 'version_not_change_asked' && L.newCutPatch([v('C', { status: 'change asked', frame_url: null })], 'C').error === 'version_has_no_link',
    'New cut ready only on a version with a change asked and a link');
  ok(L.staffAllows('creative', 'version_new_cut') && !L.staffAllows('creative', 'version_drop'), 'an editor can say a new cut is ready, not drop');

  // Drop, trial, winner
  // Default (c), 2026-10-27: the version on the card can be dropped once today's attach moved the card to the next one.
  ok(L.dropPatch(five(), 'A', false, A_LINK).error === 'attach_first', 'the version on the card: today\'s attach first puts the next live version on the card');
  ok(L.mainLetter(five(), 'https://f.io/fixture-b') === 'B' && L.dropPatch(five(), 'A', false, 'https://f.io/fixture-b').patch.status === 'dropped',
    'once the card carries Video B, B is on the card and A drops like any other version');
  ok(L.mainLetter([v('A', { status: 'dropped' }), v('B'), v('C')], '') === 'B', 'with A dropped and no link on the card, the first live version is the one on the card');
  ok(L.dropPatch([v('A'), v('B', { status: 'dropped' })], 'A', false, A_LINK).error === 'last_live_version', 'the last live version cannot be dropped');
  ok(L.mainLetter([v('A'), v('B')], 'https://f.io/fixture-b') === 'B' && L.readShape([v('A'), v('B')], { client: false, mainLink: 'https://f.io/fixture-b' }).versions[1].on_card,
    'Video A brought back while the card carries B: B stays on the card');
  ok(L.undoWinnerPatches([v('A', { status: 'dropped' }), v('B', { status: 'winner' }), v('C', { status: 'lost' })], 'https://f.io/fixture-b').patches.length === 2
    && L.undoWinnerPatches([v('A', { status: 'dropped' }), v('B', { status: 'winner' }), v('C', { status: 'lost' })], A_LINK).error === 'attach_first',
    'Undo with Video A dropped puts the first live version (B) back on the card, never A');
  ok(L.dropPatch(five(), 'D').patch.status === 'dropped' && L.dropPatch([v('D', { status: 'dropped' })], 'D', true).patch.status === 'waiting', 'drop and bring back');
  ok(L.dropPatch([v('D', { status: 'dropped', smm_ok_at: NOW, client_ok_at: NOW })], 'D', true).patch.client_ok_at === null, 'a version brought back is reviewed again: no earlier OK stands');
  ok(L.dropPatch([v('C', { status: 'on trial' })], 'C').error === 'version_on_trial', 'a version on trial cannot be dropped');
  r = L.trialPatches([v('A', { status: 'approved' }), v('B', { status: 'approved' }), v('D', { status: 'dropped' })], Date.parse(NOW));
  ok(r.patches.length === 2 && r.patches[0].patch.trial_ends_at === '2026-10-28T10:00:00.000Z', 'on trial: the approved versions, with a 24 h timer');
  ok(L.trialPatches(five(), Date.parse(NOW)).error === 'nothing_approved', 'nothing approved: no trial');
  ok(L.trialPatches([v('A', { status: 'approved' }), v('B')], Date.parse(NOW)).error === 'not_all_approved', 'the trial never starts while a version still waits');
  const trial = [v('A', { status: 'on trial' }), v('B', { status: 'on trial' }), v('C', { status: 'on trial' }), v('D', { status: 'dropped' })];
  ok(L.winnerPatches(trial, 'C', A_LINK).error === 'attach_first', "the winner is refused until the card's link is the winner's");
  r = L.winnerPatches(trial, 'C', 'https://f.io/fixture-c');
  ok(r.patches.map(p => p.letter + ':' + p.patch.status).join(' ') === 'A:lost B:lost C:winner', 'the winner, and the others lost');
  ok(L.winnerPatches(trial, 'D', 'https://f.io/fixture-d').error === 'version_not_on_trial', 'only a version on trial can win');
  const early = trial.map(x => Object.assign({}, x, { trial_ends_at: '2026-10-28T10:00:00.000Z' }));
  ok(L.winnerPatches(early, 'C', 'https://f.io/fixture-c', { nowMs: Date.parse(NOW) }).error === 'trial_not_over', 'no winner before the 24 h are up');
  // The trial runs on a Posted card (owner, 2026-10-28), so the winner is picked there.
  ok((L.winnerPatches(trial, 'C', 'https://f.io/fixture-c', { cardStatus: 'Posted' }).patches || []).length === 3, 'the winner is picked on the Posted card');
  ok(!L.undoWinnerPatches([v('A', { status: 'lost' }), v('C', { status: 'winner' })], A_LINK, { cardStatus: 'Posted' }).error, 'and Undo works on the Posted card too');
  // Posted starts the trial: the approved versions, 24 h from the card's Posted time; the rest stay off it.
  {
    const ap = [v('A', { status: 'approved' }), v('B', { status: 'approved' }), v('C', { status: 'waiting' }), v('D', { status: 'approved', client_pass_at: NOW }), v('E', { status: 'dropped' })];
    ok(!L.autoTrialPatches(ap, { cardStatus: 'Approved', postedAt: NOW, nowMs: Date.parse(NOW) }).patches.length, 'not Posted: no trial');
    const at = L.autoTrialPatches(ap, { cardStatus: 'Posted', postedAt: '2026-10-28T12:00:00.000Z', nowMs: Date.parse(NOW) }).patches;
    ok(at.map(x => x.letter).join('') === 'AB' && at.every(x => x.patch.status === 'on trial' && x.patch.posted_at === '2026-10-28T12:00:00.000Z' && x.patch.trial_ends_at === '2026-10-29T12:00:00.000Z'),
      'Posted: the approved versions go on trial, 24 h from the Posted time; waiting, client-dropped and dropped stay off it');
    ok(L.autoTrialPatches(ap, { cardStatus: 'Posted', postedAt: '', nowMs: Date.parse(NOW) }).patches[0].patch.posted_at === NOW, 'with no Posted time, the 24 h count from now');
    ok(!L.autoTrialPatches([v('A'), v('B')], { cardStatus: 'Posted', postedAt: NOW, nowMs: Date.parse(NOW) }).patches.length, 'none approved: no trial');
    ok(!L.autoTrialPatches(ap.map(x => x.letter === 'A' ? Object.assign({}, x, { status: 'on trial' }) : x), { cardStatus: 'Posted', postedAt: NOW, nowMs: Date.parse(NOW) }).patches.length, 'started once: never again');
  }
  // One live version left (Trialeyes E16, Supervisor's call, 2026-10-29): Posted makes it the winner at once, no 24 h.
  {
    const one = [v('A', { status: 'approved' }), v('B', { status: 'dropped' }), v('C', { status: 'approved', client_pass_at: NOW })];
    const r1 = L.autoTrialPatches(one, { cardStatus: 'Posted', postedAt: NOW, nowMs: Date.parse(NOW), mainLink: one[0].frame_url });
    ok(r1.winner === 'A' && r1.patches.length === 1 && r1.patches[0].patch.status === 'winner' && !r1.patches[0].patch.trial_ends_at, 'one live version: Posted makes it the winner, with no trial');
    // A card left stuck by the old write order (Codex on #2444): its one live version reads on trial with no 24 h end
    // (a "winner" row, no card winner). The next read makes it the winner; a real trial (with its 24 h) is left alone.
    const stuck = [v('A', { status: 'on trial', posted_at: NOW, trial_ends_at: null }), v('B', { status: 'dropped' })];
    const r4 = L.autoTrialPatches(stuck, { cardStatus: 'Posted', postedAt: NOW, nowMs: Date.parse(NOW), mainLink: stuck[0].frame_url });
    ok(r4.winner === 'A' && r4.patches.length === 1 && r4.patches[0].patch.status === 'winner', 'a stuck one-version card (on trial, no 24 h end): the next read makes it the winner');
    const real = [v('A', { status: 'on trial', posted_at: NOW, trial_ends_at: '2026-10-29T12:00:00.000Z' }), v('B', { status: 'dropped' })];
    ok(!L.autoTrialPatches(real, { cardStatus: 'Posted', postedAt: NOW, nowMs: Date.parse(NOW), mainLink: real[0].frame_url }).patches.length, 'a real trial with its 24 h end is left alone');
    const two = [v('A', { status: 'approved' }), v('B', { status: 'approved' })];
    const r2 = L.autoTrialPatches(two, { cardStatus: 'Posted', postedAt: NOW, nowMs: Date.parse(NOW), mainLink: two[0].frame_url });
    ok(!r2.winner && r2.patches.every(x => x.patch.status === 'on trial'), 'two live versions: the 24 h trial as before');
    const r3 = L.autoTrialPatches(one, { cardStatus: 'Posted', postedAt: NOW, nowMs: Date.parse(NOW), mainLink: 'https://f.io/fixture-other' });
    ok(!r3.winner && r3.patches[0].patch.status === 'on trial', "one live version whose link is not the card's: the trial as before (the winner needs the card's link)");
  }
  ok(!JSON.stringify(r).includes('no clear winner'), 'SyncView never writes "no clear winner" (owner, Q10)');
  const decided = [v('A', { status: 'lost' }), v('B', { status: 'lost' }), v('C', { status: 'winner' }), v('D', { status: 'dropped' })];
  ok(L.undoWinnerPatches(decided, 'https://f.io/fixture-c').error === 'attach_first', "Undo is refused until the card's link is back on Video A's");
  r = L.undoWinnerPatches(decided, A_LINK);
  ok(r.patches.map(p => p.letter + ':' + p.patch.status).join(' ') === 'A:on trial B:on trial C:on trial', 'Undo puts every decided version back on trial (a dropped one stays dropped)');
  ok(L.undoWinnerPatches(trial, A_LINK).error === 'no_winner', 'Undo with no winner is refused');

  // What readers get
  const s1 = L.readShape(mixed, { client: true, mainLink: A_LINK, cardStatus: 'Client Approval' });
  ok(s1.versions.every(x => !('hook' in x) && !('change_note' in x)), 'a client link gets no hook and no team note');
  ok(L.readShape([v('A', { smm_ok_at: NOW }), v('B')], { client: true, mainLink: A_LINK }).versions.map(x => x.ready).join() === 'true,false'
    && !('smm_ok_at' in L.readShape([v('A', { smm_ok_at: NOW })], { client: true, mainLink: A_LINK }).versions[0]),
    "a client read says which versions the SMM has looked at (ready), as a yes or no, never the team's times");
  ok(s1.card_approvable === false && !('card_behind' in s1) && L.readShape([v('A', { status: 'approved' })], { client: true, mainLink: A_LINK }).card_approvable === true, 'a client link learns when the card can move to Approved, and nothing about the team\'s side');
  ok(!s1.versions.some(x => x.letter === 'D'), 'a client link does not see a dropped version');
  const won = [v('A', { status: 'lost' }), v('B', { status: 'lost' }), v('C', { status: 'winner' })];
  const s2 = L.readShape(won, { client: true, mainLink: 'https://f.io/fixture-c' });
  ok(s2.versions.length === 1 && s2.versions[0].letter === 'C', 'once a winner is picked, a client link sees only the winner (owner, Q8)');
  const s3 = L.readShape([v('A', { frame_url: 'https://f.io/old-a' }), v('B')], { client: false, mainLink: A_LINK, cardStatus: 'Client Approval' });
  ok(s3.versions[0].frame_url === A_LINK && s3.versions[0].on_card && s3.main_copy_behind, "for the version on the card the link shown is the card's own, and a lagging copy is flagged");
  ok(s3.main_url === 'https://f.io/old-a' && !('main_url' in s1), "staff also learn the main version's own stored link (what a refused pick puts the card back to); a client link does not");
  const s3w = L.readShape([v('A', { status: 'lost' }), v('C', { status: 'winner', frame_url: 'https://f.io/fixture-c' }), v('D', { status: 'lost', frame_url: 'https://f.io/fixture-d' })], { client: false, mainLink: 'https://f.io/fixture-d', cardStatus: '' });
  ok(s3w.main_url === 'https://f.io/fixture-c', "a card left on a refused pick's link still names the winner's own link to go back to (Probe bug 9)");
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

  // The winner is SyncView's alone (owner, 2026-10-27): only trial_reel_cards.winner_letter decides it.
  const studioWin = [v('A', { status: 'on trial' }), v('B', { status: 'winner' }), v('C', { status: 'lost' })];
  const none = L.settleWinner(studioWin, null);
  ok(none.every(x => x.status === 'on trial'), 'a "winner" or "lost" the studio wrote, with no winner letter on the card, reads as on trial');
  ok(!L.readShape(none, { client: true, mainLink: A_LINK, cardStatus: '' }).versions.some(x => x.status === 'winner') && L.readShape(none, { client: true, mainLink: A_LINK, cardStatus: '' }).versions.length === 3,
    "the client link is not cut down to a studio-written winner");
  const picked = L.settleWinner(studioWin, 'A');
  ok(picked.find(x => x.letter === 'A').status === 'winner' && picked.filter(x => x.letter !== 'A').every(x => x.status === 'lost'), "the card's letter makes Video A the winner, whatever the rows say");
  ok(L.mainLetter(picked, '') === 'A' && L.undoWinnerPatches(L.settleWinner(studioWin, null), A_LINK, {}).error === 'no_winner', 'the version on the card and Undo follow the card\'s letter only');
  ok(studioWin[1].status === 'winner', 'settleWinner leaves the rows as read (it returns copies)');

  // A version added from SyncView (found live, 2026-10-27: a card the AI editor had not logged had nowhere to paste).
  ok(L.ACTIONS.includes('version_add') && L.staffAllows('creative', 'version_add') && !L.staffAllows('automation', 'version_add'), 'version_add: admin, SMM and an editor; never the automation key');
  ok(L.addVersion([], 'https://f.io/x', 'https://f.io/x').letter === 'A' && L.addVersion([], 'https://f.io/x', '').error === 'attach_first', 'the first version is the one on the card, so the card must carry its link first');
  ok(L.addVersion([v('A'), v('B', { status: 'dropped' })], 'https://f.io/new', A_LINK).letter === 'C', 'the next free letter, dropped ones included');
  ok(L.addVersion([v('A')], A_LINK, A_LINK).error === 'link_used_by_another_version' && L.addVersion([v('A')], '', A_LINK).error === 'version_has_no_link' && L.addVersion([v('A')], 'http://f.io/x', A_LINK).error === 'link_not_https', 'a link another version has, no link, or not https: refused');
  ok(L.addVersion(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(l => v(l, { frame_url: 'https://f.io/' + l })), 'https://f.io/h', A_LINK).error === 'no_letter_left' && L.addVersion([v('A', { status: 'on trial' })], 'https://f.io/n', A_LINK).error === 'version_on_trial', 'seven at most, and none once the trial has started');

  const dupA = L.oneRowPerLetter([v('A', { id: 'studio-a', created_at: '2026-10-27T16:00:00Z' }), v('A', { id: 'card-a', created_at: '2026-10-27T15:13:12Z' }), v('B', { created_at: '2026-10-27T16:00:00Z' })]);
  ok(dupA.length === 2 && dupA.find(x => x.letter === 'A').id === 'card-a', 'two rows for one letter (SyncView seeded A, then the studio logged its own A): the earliest is the version, the other is never read (Codex on PR 2373)');

  ok(L.deliverableUuid('del_4676B09E-1111-4111-8111-111111111111') === '4676b09e-1111-4111-8111-111111111111' && L.deliverableUuid('4676b09e-1111-4111-8111-111111111111') === '4676b09e-1111-4111-8111-111111111111'
    && L.deliverableUuid('del_notauuid') === null && L.deliverableUuid('') === null && L.deliverableUuid(null) === null, "the card's del_<uuid> sub-issue becomes the uuid the studio's column takes; anything else is null");

  // The function and the migration, read as source
  const src = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'trial-reels', 'index.ts'), 'utf8');
  const code = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok(!/video_status\s*:/.test(code) && !/\.from\("calendar_posts"\)\s*\.(update|insert|upsert)/.test(code), 'the function never writes the card (no status, no link)');
  ok(!/\.from\("deliverables"\)\s*\.(update|insert|upsert)/.test(code) && !/production-write|production_artifact_write/.test(code), 'the function never writes the sub-issue or calls a Section 4 function');
  // Since OPEN_REPAIRS 554 the reads start together, so they are not all awaited where they are made: every one still
  // names a winner letter, and the rows read with the card are settled against the card's own.
  ok((code.match(/readVersions\(supabase, client, (postId|id),/g) || []).length >= 3 && !/readVersions\(supabase, client, (postId|id)\)/.test(code)
    && /return settleWinner\(/.test(code) && /settleWinner\(await rowsP!, sw\.winner_letter\)/.test(code),
    "every versions read passes the card's winner letter through settleWinner");
  ok(/assertSwitchOn\(supabase, client\)/.test(code) && /CLIENT_ACTIONS\.includes\(action\)/.test(code), 'every request checks the switch; a client link may only read and answer');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261027090000_trial_reels.sql'), 'utf8');
  ok(/^-- ef-auto-deploy-applied-when: select to_regclass\('public\.trial_reel_cards'\) is not null/m.test(sql), 'the migration says how to tell it is applied, so the merge lane holds the function until then');
  ok(/revoke all on table public\.trial_reel_cards from public, anon, authenticated, service_role;/.test(sql), 'the new table: all four roles revoked');
  ok(/grant select, insert, update on table public\.trial_reel_cards to service_role;/.test(sql) && !/grant[^;]*to (anon|authenticated|public)/i.test(sql), 'only the service role gets SELECT, INSERT, UPDATE back; no browser role gets anything');
  ok(/to_regclass\('public\.studio_trial_versions'\) is null then\s*raise exception/.test(sql), "it stops with a plain error if the studio's table is not applied yet");
  for (const col of ['post_id', 'deliverable_id', 'frame_url', 'smm_ok_at', 'kasper_ok_at', 'client_ok_at', 'change_by', 'change_note', 'change_at', 'revision', 'trial_ends_at']) {
    ok(new RegExp('add column if not exists ' + col + ' ').test(sql), 'settled column ' + col);
  }
  // The client's "Not this one" (owner, 2026-10-28): a pass on one version, stamped client_pass_at; the status stays
  // as it was, the team drops it. Never on the last version left, never by staff, never twice.
  {
    const three = () => ['A', 'B', 'C'].map(l => v(l, { smm_ok_at: NOW, kasper_ok_at: NOW, client_pass_at: null }));
    let p = L.answerPatches(three(), { stage: 'client', kind: 'pass', letter: 'B' }, NOW);
    ok(p.patches && p.patches.length === 1 && p.patches[0].patch.client_pass_at === NOW && !('status' in p.patches[0].patch), 'a client pass on B stamps client_pass_at and leaves the status');
    ok(L.answerPatches(three(), { stage: 'kasper', kind: 'pass', letter: 'B' }, NOW).error === 'pass_client_only' && L.answerPatches(three(), { stage: 'smm', kind: 'pass', letter: 'B' }, NOW).error === 'pass_client_only', 'only the client passes (the team drops)');
    const passedB = () => three().map(x => x.letter === 'B' ? Object.assign(x, { client_pass_at: NOW }) : x);
    ok(L.answerPatches(passedB(), { stage: 'client', kind: 'pass', letter: 'B' }, NOW).error === 'version_passed', 'a version passed already is not passed twice');
    const lastTwo = [v('A', { smm_ok_at: NOW, client_pass_at: NOW }), v('B', { smm_ok_at: NOW, client_pass_at: null }), v('C', { status: 'dropped', client_pass_at: null })];
    ok(L.answerPatches(lastTwo, { stage: 'client', kind: 'pass', letter: 'B' }, NOW).error === 'last_live_version', 'never the last version the client has not passed');
    ok(L.answerPatches(three().map(x => Object.assign(x, { smm_ok_at: null })), { stage: 'client', kind: 'pass', letter: 'B' }, NOW).error === 'stage_order', 'the same stage order as an approve: only after the SMM');
    ok((L.answerPatches(three(), { stage: 'client', kind: 'pass', letter: 'A' }, NOW).patches || []).length === 1, 'the version on the card may be passed too (the team moves the card when it drops it)');
    // Not waiting for the client any more: Approve all skips it, the client stage and the card count without it.
    r = L.answerPatches(passedB(), { stage: 'client', kind: 'approve_all' }, NOW);
    ok((r.patches || []).map(x => x.letter).join('') === 'AC', 'Approve all leaves a passed version alone');
    const rest = passedB().map(x => x.letter !== 'B' ? Object.assign(x, { status: 'approved' }) : x);
    ok(L.stageDone(rest, 'client') && L.cardApprovable(rest), 'A and C approved, B passed: the client is done and the card can move to Approved');
    ok(L.trialPatches(rest, Date.parse(NOW)).patches.map(x => x.letter).join('') === 'AC', 'the trial starts with the approved versions only');
    // The client changes their mind: an approve on a passed version takes back the pass.
    p = L.answerPatches(passedB(), { stage: 'client', kind: 'approve', letter: 'B' }, NOW);
    ok(p.patches[0].patch.status === 'approved' && p.patches[0].patch.client_pass_at === null, 'an approve on a passed version takes the pass back');
    // A new cut, a new link and Bring back clear it; with no pass on the row the column is never written (the
    // function runs before the migration is applied).
    const chg = passedB().map(x => x.letter === 'B' ? Object.assign(x, { status: 'change asked' }) : x);
    ok(L.newCutPatch(chg, 'B').patch.client_pass_at === null, 'a new cut clears the pass');
    ok(L.linkPatch(passedB().map(x => Object.assign(x, { status: x.letter === 'B' ? 'approved' : x.status })), 'B', 'https://f.io/fixture-b-new', A_LINK).patch.client_pass_at === null, 'a new link clears the pass');
    ok(L.dropPatch(passedB().map(x => x.letter === 'B' ? Object.assign(x, { status: 'dropped' }) : x), 'B', true, A_LINK).patch.client_pass_at === null, 'Bring back clears the pass');
    ok(!('client_pass_at' in L.newCutPatch(five().map(x => Object.assign(x, { status: 'change asked' })), 'B').patch) && !('client_pass_at' in L.dropPatch(five().map(x => Object.assign(x, { status: 'dropped' })), 'B', true, A_LINK).patch),
      'a row with no pass never names the column');
    // Codex on PR 2409: a card sent straight to the client (no SMM answer yet) lets the client pass a version with no
    // OK on it; a new link on that version must still clear the pass and start it again.
    const bare = [v('A'), v('B', { client_pass_at: NOW }), v('C')];
    const lp = L.linkPatch(bare, 'B', 'https://f.io/fixture-b-other', A_LINK).patch;
    ok(lp && lp.client_pass_at === null && lp.status === 'waiting' && lp.revision === 1, 'a new link on a version passed with no OK on it clears the pass and starts it again');
    const shp = L.readShape(passedB(), { client: true, mainLink: A_LINK });
    ok(shp.versions.find(x => x.letter === 'B').client_pass_at === NOW, 'the client read says which version the client passed on');
    ok(L.readShape(passedB(), { client: false, mainLink: A_LINK }).versions.find(x => x.letter === 'B').client_pass_at === NOW, 'and so does the staff read');
    ok(/kind === "pass"[\s\S]{0,200}pass_unavailable/.test(code), 'before the column exists, only a pass is refused (pass_unavailable); nothing else changes');
    const mig = fs.readdirSync(path.join(__dirname, '..', 'supabase', 'migrations')).filter(f => /trial_reels_client_pass/.test(f));
    const msql = mig.length === 1 ? fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', mig[0]), 'utf8') : '';
    ok(/^-- ef-auto-deploy: functions-cope-without-this/m.test(msql) && /add column if not exists client_pass_at timestamptz/.test(msql), 'the migration adds client_pass_at and says the function copes without it');
    ok(!/grant/i.test(msql.replace(/^--.*$/mg, '')), 'the migration grants nothing');
  }
  const toml = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'config.toml'), 'utf8');
  ok(/\[functions\.trial-reels\]\nverify_jwt = false/.test(toml), 'config.toml: trial-reels is JWT-off and authenticates itself');

  console.log(`trial-reels-logic: ${passed} checks passed` + (failures.length ? `, ${failures.length} FAILED` : ''));
  if (failures.length) process.exit(1);
})();
