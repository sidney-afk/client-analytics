// scenarios.js — the scenario library. Each base spec: { key, title, seed, steps }.
// The runner stamps a unique id/name. comp = 'video' | 'graphic' (Thumbnail).
// Statuses: In Progress, For SMM Approval, Kasper Approval, Client Approval, Approved, Tweaks Needed.
const FOR_SMM = { video_status: 'For SMM Approval', graphic_status: 'For SMM Approval', status: 'For SMM Approval' };

function base() {
  const S = [];
  // ---- MAIN FLOWS ----
  S.push({ key: 'clean_both', title: 'Clean path — both components SMM→Kasper→Client→Approved', shots: true,
    seed: { ...FOR_SMM },
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
      steps: [['kasper.aat', comp, 'Kasper: fix then send to SMM'], ['expect', comp + '_status', 'For SMM Approval'], ['expect', 'kasper_approved_after_tweaks', comp]] });

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

  S.push({ key: 'notes_markdone', title: 'Notes — mark a change-request done',
    seed: (() => { const now = new Date().toISOString(); return { video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress', video_tweaks: JSON.stringify([{ id: 'cm_seed', parent_id: null, author: 'Client', role: 'client', is_tweak: true, audience: 'client', round: 1, body: 'Open request', created_at: now, updated_at: now, done: false, done_at: '', done_by: '' }]) }; })(),
    steps: [['smm.markDone', 'video']] });

  const OTHER = (c) => (c === 'video' ? 'graphic' : 'video');

  // ---- TIER 3: combos, mixed-stage, mixed routing ----
  for (const comp of ['video', 'graphic']) {
    // approve-after-tweaks continuation: AAT → SMM approves → should route straight to Client (skip Kasper)
    S.push({ key: 'aat_continuation_' + comp, title: `Approve-after-tweaks continuation on ${comp} → SMM approve routes to Client`,
      seed: { [comp + '_status']: 'Kasper Approval', [OTHER(comp) + '_status']: 'Approved', status: 'Kasper Approval' },
      steps: [['kasper.aat', comp, 'Fix audio then send'], ['expect', comp + '_status', 'For SMM Approval'], ['smm.approve', comp, 'primary'], ['expect', comp + '_status', 'Client Approval']] });

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

    // two-round change request (round numbering)
    S.push({ key: 'two_round_request_' + comp, title: `Two rounds of SMM change requests on ${comp}`,
      seed: { ...FOR_SMM },
      steps: [['smm.request', comp, 'round one'], ['smm.status', comp, 'For SMM Approval'], ['smm.request', comp, 'round two'], ['expectComment', comp, { role: 'smm', is_tweak: true }]] });
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
      steps: [['kasper.aat', comp, 'fix and pre-clear'], ['smm.approve', comp, 'primary'], ['expect', comp + '_status', 'Client Approval'], ['client.approve', comp], ['expect', comp + '_status', 'Approved']] });

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
      ['expect', 'video_status', 'For SMM Approval'], ['expect', 'graphic_status', 'Client Approval'],
      ['smm.approve', 'video', 'primary'], ['expect', 'video_status', 'Client Approval'],
      ['client.approve', 'video'], ['client.approve', 'graphic'],
      ['expect', 'video_status', 'Approved'], ['expect', 'graphic_status', 'Approved'], ['expect', 'status', 'Approved'],
    ] });

  // kasper approve one, AAT the other
  S.push({ key: 'kasper_approve_v_aat_g', title: 'Kasper approves video, approve-after-tweaks on thumbnail',
    seed: { video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', status: 'Kasper Approval' },
    steps: [['kasper.approve', 'video'], ['kasper.aat', 'graphic', 'fix logo then SMM'], ['expect', 'video_status', 'Client Approval'], ['expect', 'graphic_status', 'For SMM Approval']] });

  return S;
}
module.exports = { base };
