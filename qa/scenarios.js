// scenarios.js — the scenario library. Each base spec: { key, title, seed, steps }.
// The runner stamps a unique id/name. comp = 'video' | 'graphic' (Thumbnail).
// Statuses: In Progress, For SMM Approval, Kasper Approval, Client Approval, Approved, Tweaks Needed.
const FOR_SMM = { video_status: 'For SMM Approval', graphic_status: 'For SMM Approval', status: 'For SMM Approval' };

// A seeded OPEN client change-request (the shape the app writes to *_tweaks).
function openTweak(id, body, round) {
  const now = new Date().toISOString();
  return { id, parent_id: null, author: 'Client', role: 'client', is_tweak: true, audience: 'client', round: round || 1, body, created_at: now, updated_at: now, done: false, done_at: '', done_by: '' };
}

function base() {
  const S = [];
  // ---- CREATE VIA THE REAL UI (the GA day-1 ghost-card regression) ----
  // Born in the browser: "+" → type name → blur. No seeded row (noSeed).
  // expectCardOnce is the gate: exactly ONE card in the DOM (zero leftover
  // blanks) and exactly ONE live DB row for that name. Before the fix, the
  // creating window painted TWO copies of the card (stale __sxrblank__ post
  // still in sxrState.posts + the re-pushed real row) while other windows —
  // and the tests, which seeded by API — saw one. shots:true so the visual
  // lane photographs the strip right after creation.
  S.push({ key: 'create_via_ui', title: 'Create a card through the real UI — exactly one card, one row', shots: true, noSeed: true,
    steps: [
      ['smm.createCard', 'UI Create Once'],
      ['expectCardOnce', 'UI Create Once'],
    ] });
  // Same flow but with an immediate second edit racing the first save —
  // reproduces "create then rename fast" (the exact way the bug was found).
  S.push({ key: 'create_via_ui_rename', title: 'Create via UI then immediately rename — still exactly one card', shots: true, noSeed: true,
    steps: [
      ['smm.createCard', 'UI Create Racer'],
      ['smm.renameCard', 'UI Create Racer', 'UI Create Renamed'],
      ['expectCardOnce', 'UI Create Renamed'],
    ] });

  // ---- THE OPTIMISTIC-STATE DIVERGENCE CLASS (generalized from the ghost card) ----
  // Every scenario below drives a REAL UI mutation whose optimistic local state
  // could diverge from the server, and gates on both sides. On top of these,
  // the runner's teardown divergenceGate covers ALL scenarios for free.

  // Create then archive BEFORE the save settles. _sxrArchiveOne awaits the
  // in-flight save, so the Archived write must land strictly after the create —
  // no local twin, no orphaned live DB row.
  S.push({ key: 'create_then_archive_race', title: 'Create via UI then archive before the save settles — nothing survives', shots: true, noSeed: true,
    steps: [
      ['smm.createCard', 'UI Create Doomed'],
      ['smm.archiveCard', 'UI Create Doomed'],   // fires while the first upsert can still be in flight
      ['expectCardGone', 'UI Create Doomed'],
    ] });

  // Create then rename TWICE fast — a second edit lands while the first upsert
  // is still in flight (per-card serialization: the finally re-flush must carry
  // the newest value, and only ONE row may exist under the final name).
  S.push({ key: 'create_rename_rename_race', title: 'Create via UI + two rapid renames — last write wins, one card, one row', noSeed: true,
    steps: [
      ['smm.createCard', 'UI Rapid A'],
      ['smm.renameCard', 'UI Rapid A', 'UI Rapid B'],
      ['smm.renameCard', 'UI Rapid B', 'UI Rapid C'],
      ['expectCardOnce', 'UI Rapid C'],
      ['expectCardGone', 'UI Rapid A'],
      ['expectCardGone', 'UI Rapid B'],
    ] });

  // Create then drag to FRONT while the create save can still be in flight —
  // then reload and confirm the order PERSISTED (the reorder-optimistic guard
  // plus _sxrPersistReorder must survive a fresh fetch, and the freshly minted
  // id must be the one reordered, not the stale blank pid).
  S.push({ key: 'create_drag_reorder_persist', title: 'Create via UI, drag to front mid-save — order survives a reload', shots: true, noSeed: true,
    steps: [
      ['smm.createCard', 'UI Drag Newborn'],
      ['expectCardOnce', 'UI Drag Newborn'],     // wait for the save to settle so the card is draggable
      ['smm.dragToFront', 'UI Drag Newborn'],
      ['expectFirstCard', 'UI Drag Newborn'],
      ['smm.reload'],
      ['expectFirstCard', 'UI Drag Newborn'],
      ['expectCardOnce', 'UI Drag Newborn'],     // and the reload didn't resurrect a twin
    ] });

  // Create while ANOTHER SESSION's row arrives via a background server merge
  // (_sxrMergeServerRows ~28024). The local-only keep branch (~28039) must keep
  // the just-created card exactly once, adopt the foreign row exactly once, and
  // never resurrect the stale blank (its interaction with the ghost-card fix).
  S.push({ key: 'create_during_remote_merge', title: 'Create via UI while a remote row lands in a background merge — both exactly once', noSeed: true,
    steps: [
      ['smm.createCard', 'UI Merge Local'],
      ['api.seedRow', 'XSESSION Merge Remote'],  // "another session" writes a row
      ['smm.bgReload'],                          // background merge while the create may be settling
      ['expectCardOnce', 'UI Merge Local'],
      ['expectCardOnce', 'XSESSION Merge Remote'],
    ] });

  // Create → settle → full reload. The row must come back from the server
  // exactly once (no cache/reload twin, no loss).
  S.push({ key: 'create_survives_reload', title: 'Create via UI then hard reload — exactly one card from server truth', noSeed: true,
    steps: [
      ['smm.createCard', 'UI Reload Survivor'],
      ['expectCardOnce', 'UI Reload Survivor'],
      ['smm.reload'],
      ['expectCardOnce', 'UI Reload Survivor'],
    ] });


  // ---- MAIN FLOWS ----
  S.push({ key: 'clean_both', title: 'Clean path — both components SMM→Kasper→Client→Approved', shots: true,
    // BOTH components linked: an unlinked thumbnail is gated out of the Kasper
    // queue (the unlinked-thumbnail rule — same on calendar + samples), so a
    // "clean path" that takes the thumbnail through Kasper must link it.
    seed: { ...FOR_SMM, linear_issue_id: 'https://linear.app/x/VID-CLEAN', graphic_linear_issue_id: 'https://linear.app/x/GRA-CLEAN' },
    steps: [
      ['smm.approve', 'video', 'primary'], ['expect', 'video_status', 'Kasper Approval'],
      ['smm.approve', 'graphic', 'primary'], ['expect', 'graphic_status', 'Kasper Approval'],
      ['kasper.approve', 'video'], ['expect', 'video_status', 'Client Approval'],
      ['kasper.approve', 'graphic'], ['expect', 'graphic_status', 'Client Approval'],
      ['client.approve', 'video'], ['expect', 'video_status', 'Approved'],
      ['client.approve', 'graphic'], ['expect', 'graphic_status', 'Approved'],
      ['expect', 'status', 'Approved'],
    ] });

  S.push({ key: 'clean_video_only', title: 'Single component — video full path (thumbnail pre-approved)', shots: true,
    seed: { video_status: 'For SMM Approval', graphic_status: 'Approved', status: 'For SMM Approval' },
    steps: [
      ['smm.approve', 'video', 'primary'], ['expect', 'video_status', 'Kasper Approval'],
      ['kasper.approve', 'video'], ['expect', 'video_status', 'Client Approval'],
      ['client.approve', 'video'], ['expect', 'video_status', 'Approved'],
      ['expect', 'status', 'Approved'],
    ] });

  S.push({ key: 'smm_alt_to_client', title: 'SMM alt-route — approve video straight to Client',
    seed: { ...FOR_SMM }, steps: [['smm.approve', 'video', 'alt'], ['expect', 'video_status', 'Client Approval']] });

  // ---- REQUEST-CHANGE at each stage, each component ----
  for (const comp of ['video', 'graphic']) {
    S.push({ key: 'smm_request_' + comp, title: `SMM requests change on ${comp}`,
      seed: { ...FOR_SMM },
      steps: [['smm.request', comp, 'Please tighten this'], ['expect', comp + '_status', 'Tweaks Needed'], ['expectComment', comp, { role: 'smm', is_tweak: true }]] });

    S.push({ key: 'kasper_request_' + comp, title: `Kasper requests change on ${comp}`,
      seed: { [comp + '_status']: 'Kasper Approval', [(comp === 'video' ? 'graphic' : 'video') + '_status']: 'Approved', status: 'Kasper Approval' },
      steps: [['kasper.request', comp, 'Kasper: needs a tweak'], ['expect', comp + '_status', 'Tweaks Needed'], ['expectComment', comp, { role: 'kasper', is_tweak: true }]] });

    S.push({ key: 'kasper_aat_' + comp, title: `Kasper approve-after-tweaks on ${comp}`,
      seed: { [comp + '_status']: 'Kasper Approval', [(comp === 'video' ? 'graphic' : 'video') + '_status']: 'Approved', status: 'Kasper Approval' },
      // AAT routes the component to Tweaks Needed (editor applies the fix first),
      // pre-cleared via kasper_approved_after_tweaks — matches the calendar.
      steps: [['kasper.aat', comp, 'Kasper: fix then send to SMM'], ['expect', comp + '_status', 'Tweaks Needed'], ['expect', 'kasper_approved_after_tweaks', comp]] });

    S.push({ key: 'client_request_' + comp, title: `Client requests change on ${comp}`,
      seed: { [comp + '_status']: 'Client Approval', [(comp === 'video' ? 'graphic' : 'video') + '_status']: 'Approved', status: 'Client Approval' },
      steps: [['client.request', comp, 'Client: please adjust'], ['expect', comp + '_status', 'Tweaks Needed'], ['expectComment', comp, { role: 'client', is_tweak: true }]] });

    S.push({ key: 'client_approve_' + comp, title: `Client approves ${comp}`,
      seed: { [comp + '_status']: 'Client Approval', [(comp === 'video' ? 'graphic' : 'video') + '_status']: 'Approved', status: 'Client Approval' },
      steps: [['client.approve', comp], ['expect', comp + '_status', 'Approved']] });
  }

  // ---- MIXED / WORST-OF ----
  S.push({ key: 'worstof_inprogress', title: 'Worst-of — video at Kasper, thumbnail In Progress → overall In Progress',
    seed: { video_status: 'For SMM Approval', graphic_status: 'In Progress', status: 'In Progress' },
    steps: [['smm.approve', 'video', 'primary'], ['expect', 'video_status', 'Kasper Approval'], ['expect', 'status', 'In Progress']] });

  S.push({ key: 'worstof_smm', title: 'Worst-of — video Approved, thumbnail For SMM → overall For SMM Approval',
    seed: { video_status: 'Approved', graphic_status: 'For SMM Approval', status: 'For SMM Approval' },
    steps: [['expect', 'status', 'For SMM Approval'], ['smm.approve', 'graphic', 'primary'], ['expect', 'graphic_status', 'Kasper Approval'], ['expect', 'status', 'Kasper Approval']] });

  // ---- NOTES / COMMENTS / MARK-DONE ----
  S.push({ key: 'notes_audiences', title: 'Notes — internal note on video, client note on thumbnail', shots: true,
    seed: { video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' },
    steps: [
      ['smm.note', 'video', 'Internal: check the audio mix', 'internal'], ['expectComment', 'video', { role: 'smm', is_tweak: false }],
      ['smm.note', 'graphic', 'Client-facing: does this hook land?', 'client'], ['expectComment', 'graphic', { role: 'smm' }],
    ] });

  // Mark done with ANOTHER tweak still open → direct done (no chooser). Marking
  // the LAST open tweak done defers to the resolve-destination chooser instead —
  // that path is covered by the resolve_via_* scenarios below.
  S.push({ key: 'notes_markdone', title: 'Notes — mark a change-request done (another still open → no chooser)',
    seed: { video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress',
      video_tweaks: JSON.stringify([openTweak('cm_seed1', 'Open request one', 1), openTweak('cm_seed2', 'Open request two', 2)]) },
    steps: [['smm.markDone', 'video'], ['expectComment', 'video', { any: true, done: true }]] });

  const OTHER = (c) => (c === 'video' ? 'graphic' : 'video');

  // ---- TIER 3: combos, mixed-stage, mixed routing ----
  for (const comp of ['video', 'graphic']) {
    // approve-after-tweaks continuation: AAT → SMM approves → should route straight to Client (skip Kasper)
    S.push({ key: 'aat_continuation_' + comp, title: `Approve-after-tweaks continuation on ${comp} → SMM approve routes to Client`,
      seed: { [comp + '_status']: 'Kasper Approval', [OTHER(comp) + '_status']: 'Approved', status: 'Kasper Approval' },
      steps: [['kasper.aat', comp, 'Fix audio then send'], ['expect', comp + '_status', 'Tweaks Needed'], ['smm.status', comp, 'For SMM Approval'], ['smm.approve', comp, 'primary'], ['expect', comp + '_status', 'Client Approval']] });

    // request → editor fixes (status back) → re-approve, per actor
    S.push({ key: 'smm_request_fix_approve_' + comp, title: `SMM request→fix→approve loop on ${comp}`,
      seed: { ...FOR_SMM },
      steps: [['smm.request', comp, 'tighten'], ['expect', comp + '_status', 'Tweaks Needed'], ['smm.status', comp, 'For SMM Approval'], ['smm.approve', comp, 'primary'], ['expect', comp + '_status', 'Kasper Approval']] });

    // After Kasper has SEEN a component, an SMM re-approve routes straight to Client
    // (Kasper isn't re-bugged) — see OBS-S1 in the report. So request→fix→re-approve
    // lands at Client Approval, then the client approves it.
    S.push({ key: 'kasper_request_fix_approve_' + comp, title: `Kasper request→fix→re-approve loop on ${comp} (re-approve → Client, seen-by-Kasper)`,
      seed: { [comp + '_status']: 'Kasper Approval', [OTHER(comp) + '_status']: 'Approved', status: 'Kasper Approval' },
      steps: [['kasper.request', comp, 'trim'], ['expect', comp + '_status', 'Tweaks Needed'], ['smm.status', comp, 'For SMM Approval'], ['smm.approve', comp, 'primary'], ['expect', comp + '_status', 'Client Approval'], ['client.approve', comp], ['expect', comp + '_status', 'Approved']] });

    S.push({ key: 'client_request_fix_approve_' + comp, title: `Client request→fix→re-approve loop on ${comp}`,
      seed: { [comp + '_status']: 'Client Approval', [OTHER(comp) + '_status']: 'Approved', status: 'Client Approval' },
      steps: [['client.request', comp, 'adjust'], ['expect', comp + '_status', 'Tweaks Needed'], ['smm.status', comp, 'Client Approval'], ['client.approve', comp], ['expect', comp + '_status', 'Approved']] });

    // two-round change request (round numbering: Tweak #1 then Tweak #2)
    S.push({ key: 'two_round_request_' + comp, title: `Two rounds of SMM change requests on ${comp}`,
      seed: { ...FOR_SMM },
      steps: [['smm.request', comp, 'round one'], ['expectComment', comp, { is_tweak: true, round: 1 }],
        ['smm.status', comp, 'For SMM Approval'], ['smm.request', comp, 'round two'],
        ['expectComment', comp, { role: 'smm', is_tweak: true, round: 2 }],
        ['expectComment', comp, { any: true, is_tweak: true, round: 1 }]] });
  }

  // approve one component, request the other — per actor
  S.push({ key: 'kasper_approve_v_request_g', title: 'Kasper approves video, requests change on thumbnail',
    seed: { video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', status: 'Kasper Approval' },
    steps: [['kasper.approve', 'video'], ['expect', 'video_status', 'Client Approval'], ['kasper.request', 'graphic', 'fix logo'], ['expect', 'graphic_status', 'Tweaks Needed']] });
  S.push({ key: 'client_approve_v_request_g', title: 'Client approves video, requests change on thumbnail',
    seed: { video_status: 'Client Approval', graphic_status: 'Client Approval', status: 'Client Approval' },
    steps: [['client.approve', 'video'], ['expect', 'video_status', 'Approved'], ['client.request', 'graphic', 'brighten'], ['expect', 'graphic_status', 'Tweaks Needed']] });
  S.push({ key: 'smm_v_kasper_g_route', title: 'SMM video→Kasper (primary), thumbnail→Client (alt) in one sample',
    seed: { ...FOR_SMM },
    steps: [['smm.approve', 'video', 'primary'], ['expect', 'video_status', 'Kasper Approval'], ['smm.approve', 'graphic', 'alt'], ['expect', 'graphic_status', 'Client Approval']] });

  // mixed-stage: components at different stages, distinct actors act
  S.push({ key: 'mixed_stage_smm_kasper', title: 'Mixed stage — SMM approves video while thumbnail awaits Kasper',
    seed: { video_status: 'For SMM Approval', graphic_status: 'Kasper Approval', status: 'For SMM Approval' },
    steps: [['smm.approve', 'video', 'primary'], ['kasper.approve', 'graphic'], ['expect', 'video_status', 'Kasper Approval'], ['expect', 'graphic_status', 'Client Approval'], ['expect', 'status', 'Kasper Approval']] });

  // worst-of boundaries
  S.push({ key: 'worstof_client_boundary', title: 'Worst-of — video Approved, thumbnail Client Approval → overall Client Approval',
    seed: { video_status: 'Approved', graphic_status: 'Client Approval', status: 'Client Approval' },
    steps: [['expect', 'status', 'Client Approval'], ['client.approve', 'graphic'], ['expect', 'graphic_status', 'Approved'], ['expect', 'status', 'Approved']] });
  S.push({ key: 'worstof_kasper_vs_client', title: 'Worst-of — video Kasper, thumbnail Client → overall Kasper Approval',
    seed: { video_status: 'Kasper Approval', graphic_status: 'Client Approval', status: 'Kasper Approval' },
    steps: [['expect', 'status', 'Kasper Approval']] });

  // comment does NOT change status; plain note is not a tweak
  S.push({ key: 'comment_no_status', title: 'Plain note leaves status unchanged',
    seed: { video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' },
    steps: [['smm.note', 'video', 'just a heads up, no change needed', 'internal'], ['expectComment', 'video', { role: 'smm', is_tweak: false }], ['expect', 'video_status', 'In Progress']] });

  // notes audience matrix (2 comps × 2 audiences)
  for (const comp of ['video', 'graphic']) for (const aud of ['internal', 'client']) {
    S.push({ key: `note_${aud}_${comp}`, title: `Note (${aud}) on ${comp}`,
      seed: { video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' },
      steps: [['smm.note', comp, `${aud} note on ${comp}`, aud], ['expectComment', comp, { role: 'smm', is_tweak: false }]] });
  }

  // both components bounced then cleared
  S.push({ key: 'both_request_then_approve', title: 'Both components — SMM requests changes on both, fixes, approves both',
    seed: { ...FOR_SMM },
    steps: [
      ['smm.request', 'video', 'fix v'], ['smm.request', 'graphic', 'fix g'],
      ['expect', 'video_status', 'Tweaks Needed'], ['expect', 'graphic_status', 'Tweaks Needed'],
      ['smm.status', 'video', 'For SMM Approval'], ['smm.status', 'graphic', 'For SMM Approval'],
      ['smm.approve', 'video', 'primary'], ['smm.approve', 'graphic', 'primary'],
      ['expect', 'video_status', 'Kasper Approval'], ['expect', 'graphic_status', 'Kasper Approval'],
    ] });

  // ---- THE MESSY REAL-WORLD ROUND-TRIP ----
  S.push({ key: 'full_bounce', title: 'Messy round-trip — bounces on both components across all 3 actors', shots: true,
    seed: { ...FOR_SMM },
    steps: [
      ['smm.approve', 'video', 'primary'], ['expect', 'video_status', 'Kasper Approval'],
      ['smm.request', 'graphic', 'Fix the logo placement'], ['expect', 'graphic_status', 'Tweaks Needed'],
      ['smm.status', 'graphic', 'For SMM Approval'],   // editor fixed → back to SMM
      ['smm.approve', 'graphic', 'primary'], ['expect', 'graphic_status', 'Kasper Approval'],
      ['kasper.request', 'video', 'Trim the first 2s'], ['expect', 'video_status', 'Tweaks Needed'],
      ['smm.status', 'video', 'For SMM Approval'],
      ['smm.approve', 'video', 'primary'], ['expect', 'video_status', 'Client Approval'],   // seen by Kasper → straight to Client
      ['kasper.approve', 'graphic'], ['expect', 'graphic_status', 'Client Approval'],
      ['client.request', 'video', 'Colour feels off'], ['expect', 'video_status', 'Tweaks Needed'],
      ['smm.status', 'video', 'Client Approval'],   // re-offer after fix
      ['client.approve', 'video'], ['client.approve', 'graphic'],
      ['expect', 'video_status', 'Approved'], ['expect', 'graphic_status', 'Approved'], ['expect', 'status', 'Approved'],
    ] });

  // ---- TIER 4: deep paths ----
  for (const comp of ['video', 'graphic']) {
    // full approve-after-tweaks path: AAT → SMM approve→Client → client approve→Approved
    S.push({ key: 'aat_full_path_' + comp, title: `Full AAT path on ${comp} → Client → Approved`,
      seed: { [comp + '_status']: 'Kasper Approval', [OTHER(comp) + '_status']: 'Approved', status: 'Kasper Approval' },
      steps: [['kasper.aat', comp, 'fix and pre-clear'], ['expect', comp + '_status', 'Tweaks Needed'], ['smm.status', comp, 'For SMM Approval'], ['smm.approve', comp, 'primary'], ['expect', comp + '_status', 'Client Approval'], ['client.approve', comp], ['expect', comp + '_status', 'Approved']] });

    // two rounds of Kasper change requests
    S.push({ key: 'kasper_two_round_' + comp, title: `Two rounds of Kasper change requests on ${comp}`,
      seed: { [comp + '_status']: 'Kasper Approval', [OTHER(comp) + '_status']: 'Approved', status: 'Kasper Approval' },
      steps: [['kasper.request', comp, 'round one'], ['smm.status', comp, 'Kasper Approval'], ['kasper.request', comp, 'round two'], ['expectComment', comp, { role: 'kasper', is_tweak: true }]] });

    // two rounds of Client change requests
    S.push({ key: 'client_two_round_' + comp, title: `Two rounds of Client change requests on ${comp}`,
      seed: { [comp + '_status']: 'Client Approval', [OTHER(comp) + '_status']: 'Approved', status: 'Client Approval' },
      steps: [['client.request', comp, 'round one'], ['smm.status', comp, 'Client Approval'], ['client.request', comp, 'round two'], ['expectComment', comp, { role: 'client', is_tweak: true }]] });

    // note (no status change) THEN request change (status change) on same component
    S.push({ key: 'note_then_request_' + comp, title: `Note then change-request on ${comp}`,
      seed: { ...FOR_SMM },
      steps: [['smm.note', comp, 'fyi, watch the pacing', 'internal'], ['expect', comp + '_status', 'For SMM Approval'], ['smm.request', comp, 'now actually change it'], ['expect', comp + '_status', 'Tweaks Needed']] });
  }

  // client requests changes on BOTH, SMM fixes BOTH, client approves BOTH → Approved
  S.push({ key: 'client_request_both_roundtrip', title: 'Client rejects both components, SMM fixes, client approves both',
    seed: { video_status: 'Client Approval', graphic_status: 'Client Approval', status: 'Client Approval' },
    steps: [
      ['client.request', 'video', 'v change'], ['client.request', 'graphic', 'g change'],
      ['expect', 'video_status', 'Tweaks Needed'], ['expect', 'graphic_status', 'Tweaks Needed'],
      ['smm.status', 'video', 'Client Approval'], ['smm.status', 'graphic', 'Client Approval'],
      ['client.approve', 'video'], ['client.approve', 'graphic'],
      ['expect', 'video_status', 'Approved'], ['expect', 'graphic_status', 'Approved'], ['expect', 'status', 'Approved'],
    ] });

  // full lifecycle where Kasper uses AAT on video and normal approve on thumbnail
  S.push({ key: 'lifecycle_mixed_kasper', title: 'Lifecycle — Kasper AAT on video, normal approve on thumbnail',
    seed: { video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', status: 'Kasper Approval' },
    steps: [
      ['kasper.aat', 'video', 'fix audio'], ['kasper.approve', 'graphic'],
      ['expect', 'video_status', 'Tweaks Needed'], ['expect', 'graphic_status', 'Client Approval'],
      ['smm.status', 'video', 'For SMM Approval'],
      ['smm.approve', 'video', 'primary'], ['expect', 'video_status', 'Client Approval'],
      ['client.approve', 'video'], ['client.approve', 'graphic'],
      ['expect', 'video_status', 'Approved'], ['expect', 'graphic_status', 'Approved'], ['expect', 'status', 'Approved'],
    ] });

  // kasper approve one, AAT the other
  S.push({ key: 'kasper_approve_v_aat_g', title: 'Kasper approves video, approve-after-tweaks on thumbnail',
    seed: { video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', status: 'Kasper Approval' },
    steps: [['kasper.approve', 'video'], ['kasper.aat', 'graphic', 'fix logo then SMM'], ['expect', 'video_status', 'Client Approval'], ['expect', 'graphic_status', 'Tweaks Needed']] });

  // ---- TIER 5: comment threads, replies, resolve destinations, Kasper queue ops ----
  // (the interactions flagged as the buggiest: comments/tweak-answers across all
  //  three actors, the SMM resolve chooser, and the Kasper undo/finish/close set)

  // Plain comments per actor — never change status
  for (const comp of ['video', 'graphic']) {
    S.push({ key: 'client_comment_' + comp, title: `Client leaves a plain comment on ${comp} — no status change`,
      seed: { [comp + '_status']: 'Client Approval', [OTHER(comp) + '_status']: 'Approved', status: 'Client Approval' },
      steps: [['client.comment', comp, 'Client question: is the CTA final?'], ['expectComment', comp, { role: 'client', is_tweak: false }], ['expect', comp + '_status', 'Client Approval']] });
  }
  S.push({ key: 'smm_comment_video', title: 'SMM leaves a plain review-tab comment — no status change',
    seed: { ...FOR_SMM },
    steps: [['smm.comment', 'video', 'SMM: waiting on the b-roll'], ['expectComment', 'video', { role: 'smm', is_tweak: false }], ['expect', 'video_status', 'For SMM Approval']] });
  S.push({ key: 'client_comment_then_approve_video', title: 'Client comments then approves — comment must not block approval',
    seed: { video_status: 'Client Approval', graphic_status: 'Approved', status: 'Client Approval' },
    steps: [['client.comment', 'video', 'Looks good, just noting the hook is strong'], ['expect', 'video_status', 'Client Approval'], ['client.approve', 'video'], ['expect', 'video_status', 'Approved'], ['expect', 'status', 'Approved']] });

  // Kasper internal comment — stays internal, never reaches the client thread
  S.push({ key: 'kasper_comment_internal_video', title: 'Kasper internal comment — no status change, never visible to client',
    seed: { video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval' },
    steps: [
      ['kasper.comment', 'video', 'KASPER_INTERNAL_TOKEN check the licensing'],
      ['expectComment', 'video', { role: 'kasper', is_tweak: false }],
      ['expect', 'video_status', 'Kasper Approval'],
      ['kasper.approve', 'video'], ['expect', 'video_status', 'Client Approval'],
      ['expectClientThread', 'video', { notContains: ['KASPER_INTERNAL_TOKEN'] }],
    ] });

  // The user-flagged core loop: client asks → SMM answers → client sees the answer.
  // NB (verified live): at Tweaks Needed the card leaves the CLIENT's review queue
  // entirely (_sxrReviewComponentActive excludes Tweaks Needed for client links),
  // so the client only sees the reply once the SMM re-offers at Client Approval.
  S.push({ key: 'smm_reply_to_client_request_video', title: 'Client requests change → SMM replies → re-offer → client sees the reply', shots: true,
    seed: { video_status: 'Client Approval', graphic_status: 'Approved', status: 'Client Approval' },
    steps: [
      ['client.request', 'video', 'CLIENT_ASK_TOKEN colour feels off'],
      ['expect', 'video_status', 'Tweaks Needed'],
      ['expectComment', 'video', { role: 'client', is_tweak: true }],
      ['smm.reply', 'video', 'SMM_ANSWER_TOKEN on it — regrade coming today'],
      ['expectComment', 'video', { role: 'smm', reply: true }],
      ['smm.status', 'video', 'Client Approval'],   // re-offer after the fix
      ['expect', 'video_status', 'Client Approval'],
      ['expectClientThread', 'video', { contains: ['CLIENT_ASK_TOKEN', 'SMM_ANSWER_TOKEN'] }],
    ] });
  // Mixed case (pins render-gating — OBS-2): even when the OTHER component keeps
  // the card in the client queue, a Tweaks-Needed component renders NO panel for
  // client links (_sxrReviewCardBody filters by _sxrReviewComponentActive, which
  // excludes Tweaks Needed when _isClientLink — same on the calendar twin). The
  // client-facing tweaks-state composer at index.html:27137 is therefore
  // unreachable for real clients; thread visibility resumes on re-offer.
  S.push({ key: 'client_mixed_gating_video', title: 'Tweaks-Needed panel hidden from client even when card stays client-active (OBS-2 pin)',
    seed: { video_status: 'Client Approval', graphic_status: 'Client Approval', status: 'Client Approval' },
    steps: [
      ['client.request', 'video', 'CLIENT_MIX_ASK crop tighter'],
      ['expect', 'video_status', 'Tweaks Needed'],
      ['smm.reply', 'video', 'SMM_MIX_ANSWER cropping now'],
      ['expectComment', 'video', { role: 'smm', reply: true }],
      ['expectClientThread', 'video', { absent: true }],    // gated off
      ['expectClientThread', 'graphic', { present: true }], // other comp still reviewable
    ] });

  // Audience gating — internal note never leaks to the client surface
  S.push({ key: 'audience_leak_guard_video', title: 'Internal note hidden from client; client-audience note visible', shots: true,
    seed: { video_status: 'Client Approval', graphic_status: 'Approved', status: 'Client Approval' },
    steps: [
      ['smm.note', 'video', 'INTERNAL_TOKEN_77 do not show the client', 'internal'],
      ['smm.note', 'video', 'CLIENT_TOKEN_77 sneak peek of the regrade', 'client'],
      ['expectClientThread', 'video', { contains: ['CLIENT_TOKEN_77'], notContains: ['INTERNAL_TOKEN_77'] }],
    ] });

  // SMM resolve-destination chooser — all four routes (Mark done on the LAST open tweak)
  for (const [dest, wantStatus] of [['kasper', 'Kasper Approval'], ['client', 'Client Approval'], ['approved', 'Approved'], ['stay', 'Tweaks Needed']]) {
    S.push({ key: 'resolve_via_' + dest + '_video', title: `SMM resolves last tweak → chooser → ${dest}`,
      seed: { video_status: 'Tweaks Needed', graphic_status: 'Approved', status: 'Tweaks Needed',
        video_tweaks: JSON.stringify([openTweak('cm_rv_' + dest, 'please fix for ' + dest, 1)]) },
      steps: [
        ['smm.resolveVia', 'video', dest],
        ['expect', 'video_status', wantStatus],
        ['expectComment', 'video', { any: true, done: true }],
      ] });
  }
  // resolve chooser on the graphic component too (symmetry)
  S.push({ key: 'resolve_via_kasper_graphic', title: 'SMM resolves last tweak on thumbnail → chooser → Kasper',
    seed: { graphic_status: 'Tweaks Needed', video_status: 'Approved', status: 'Tweaks Needed',
      graphic_tweaks: JSON.stringify([openTweak('cm_rvg', 'fix the logo', 1)]) },
    steps: [['smm.resolveVia', 'graphic', 'kasper'], ['expect', 'graphic_status', 'Kasper Approval'], ['expectComment', 'graphic', { any: true, done: true }]] });

  // Reopen a resolved tweak
  S.push({ key: 'reopen_tweak_video', title: 'SMM resolves (stay) then reopens the tweak',
    seed: { video_status: 'Tweaks Needed', graphic_status: 'Approved', status: 'Tweaks Needed',
      video_tweaks: JSON.stringify([openTweak('cm_reopen', 'needs another pass', 1)]) },
    steps: [
      ['smm.resolveVia', 'video', 'stay'], ['expectComment', 'video', { any: true, done: true }],
      ['smm.reopen', 'video'], ['expectComment', 'video', { any: true, done: false }],
      ['expect', 'video_status', 'Tweaks Needed'],
    ] });

  // Delete a comment (soft-delete through the confirm dialog)
  S.push({ key: 'delete_comment_video', title: 'SMM deletes own note via confirm dialog',
    seed: { video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress' },
    steps: [
      ['smm.note', 'video', 'DELETEME_TOKEN scratch note', 'internal'],
      ['expectComment', 'video', { role: 'smm', body: 'DELETEME_TOKEN' }],
      ['smm.deleteComment', 'video'],
      ['expectComment', 'video', { any: true, deleted: true }],
    ] });

  // Kasper undo-approve — toast Undo restores the pre-approve status
  S.push({ key: 'kasper_undo_video', title: 'Kasper approves (card completes) then Undo restores Kasper Approval',
    seed: { video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval' },
    steps: [
      ['kasper.approve', 'video'], ['expect', 'video_status', 'Client Approval'],
      ['kasper.undo'],
      ['expect', 'video_status', 'Kasper Approval'],
      ['expectKasperCard', 'present'],
    ] });

  // Kasper Finish reviewing — decided card hands off to the SMM ("Sent to SMM")
  S.push({ key: 'kasper_finish_video', title: 'Kasper requests change then Finish reviewing → Sent to SMM',
    seed: { video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval' },
    steps: [
      ['kasper.request', 'video', 'tighten the intro'], ['expect', 'video_status', 'Tweaks Needed'],
      ['kasper.finish'],
      ['expectKasperCard', 'finished'],
    ] });

  // Kasper Close (X). Actual behaviour (both calendars, by design): a closed card
  // resurfaces when a NEW MESSAGE arrives, not on a bare status re-route. BUG-6
  // was the tooltip promising "until sent back to Kasper Approval"; fixed 2026-07-02
  // to describe the real message-based resurface. Deeper re-route-resurface is a
  // shared product question (needs queue-membership work on both calendars) —
  // left for product. This scenario asserts the intended message-resurface.
  S.push({ key: 'kasper_close_resurface_video', title: 'Kasper closes the card; a new message resurfaces it (re-route alone does not — intended, shared with calendar)',
    seed: { video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval' },
    steps: [
      ['kasper.close'], ['expectKasperCard', 'absent'],
      ['smm.status', 'video', 'For SMM Approval'], ['expect', 'video_status', 'For SMM Approval'],
      ['smm.status', 'video', 'Kasper Approval'], ['expect', 'video_status', 'Kasper Approval'],
      ['expectKasperCard', 'absent'],   // BUG-6: tooltip says it should be present
      ['smm.note', 'video', 'kasper please take another look', 'internal'],
      ['expectKasperCard', 'present'],  // a newer message DOES resurface it
    ] });

  // ---- Linear sync (ALWAYS mocked+captured by the harness) ----
  // Status change on a component pushes to THAT component's issue, never the other's.
  S.push({ key: 'linear_push_video_status', title: 'Linear — SMM approves video → status push to the VIDEO issue only',
    seed: { video_status: 'For SMM Approval', graphic_status: 'Approved', status: 'For SMM Approval' },
    steps: [
      ['smm.approve', 'video', 'primary'], ['expect', 'video_status', 'Kasper Approval'],
      ['expectLinear', 'linear-set-status', { includes: ['VID-', 'Kasper Approval'] }],
      ['expectNoLinear', 'linear-add-comment'],
    ] });
  S.push({ key: 'linear_push_graphic_isolated', title: 'Linear — graphic change never touches the video issue',
    seed: { graphic_status: 'For SMM Approval', video_status: 'Approved', status: 'For SMM Approval' },
    steps: [
      ['smm.approve', 'graphic', 'primary'], ['expect', 'graphic_status', 'Kasper Approval'],
      ['expectLinear', 'linear-set-status', { includes: ['GRA-'] }],
      ['expectNoLinear', 'linear-set-status', { includes: ['VID-'] }],
    ] });
  // A change-request posts the tweak as a Linear comment on the right issue.
  S.push({ key: 'linear_tweak_comment_video', title: 'Linear — Kasper request-change posts a tweak comment to the video issue',
    seed: { video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval' },
    steps: [
      ['kasper.request', 'video', 'LINEAR_TWEAK_TOKEN trim the intro'],
      ['expect', 'video_status', 'Tweaks Needed'],
      ['expectLinear', 'linear-add-comment', { includes: ['LINEAR_TWEAK_TOKEN'] }],
    ] });
  // A plain comment / note must NOT change status; pin whether it posts to Linear.
  S.push({ key: 'linear_no_push_on_note', title: 'Linear — a plain internal note pushes NO status change',
    seed: { video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval' },
    steps: [
      ['smm.note', 'video', 'internal note, no linear status expected', 'internal'],
      ['expect', 'video_status', 'Kasper Approval'],
      ['expectNoLinear', 'linear-set-status'],
    ] });

  // Audit trail — the clean path stamps a status_change event per transition
  S.push({ key: 'audit_trail_video', title: 'Audit — status_change events land for each clean-path transition',
    seed: { video_status: 'For SMM Approval', graphic_status: 'Approved', status: 'For SMM Approval' },
    steps: [
      ['smm.approve', 'video', 'primary'], ['expect', 'video_status', 'Kasper Approval'],
      ['expectEvent', 'status_change', { to_status: 'Kasper Approval' }],
      ['kasper.approve', 'video'], ['expect', 'video_status', 'Client Approval'],
      ['expectEvent', 'status_change', { to_status: 'Client Approval' }],
      ['client.approve', 'video'], ['expect', 'video_status', 'Approved'],
      ['expectEvent', 'status_change', { to_status: 'Approved' }],
    ] });

  return S;
}
module.exports = { base };
