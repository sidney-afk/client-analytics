'use strict';
/*
 * V1 (plan combined.md, D1): a trial version's status is set with the card's own status picker. Offline, Node.
 *
 * The list is the card's video-part list (CAL_STATUSES, read from the page itself) up to and including Approved, with
 * N/A left out (Drop covers it) and Scheduled and Posted left card-only (Posted starts the trial). In Progress and
 * For SMM Approval write the same state; which one shows is derived from the link. Roles: admin and SMM only (Sidney:
 * "the SMM should be able to"), narrower than the card for creatives; a client link never. Logged as trial_status.
 */
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
let passed = 0;
const failures = [];
function ok(c, m) { if (!c) { failures.push(m); console.error('FAIL  ' + m); } else { passed++; console.log('  ok  ' + m); } }

(async () => {
  const L = await import(path.join(ROOT, 'supabase', 'functions', 'trial-reels', 'logic.mjs'));
  const NOW = '2026-11-02T10:00:00.000Z';
  const EARLY = '2026-11-02T08:00:00.000Z';
  const v = (letter, over) => Object.assign({ id: 'id-' + letter, letter, status: 'waiting', frame_url: 'https://f.io/fixture-' + letter.toLowerCase(), revision: 0, updated_at: '2026-11-02T09:00:00.000Z' }, over || {});
  const three = () => ['A', 'B', 'C'].map((l) => v(l));
  const apply = (vs, r) => vs.map((x) => { const p = (r.patches || []).find((c) => c.id === x.id); return p ? Object.assign({}, x, p.patch) : x; });
  const set = (vs, letter, status, cardStatus) => L.versionStatusPatches(vs, { letter, status, cardStatus }, NOW);
  const word = (vs, letter, cardStatus) => L.versionCardStatus(vs.find((x) => x.letter === letter), vs, cardStatus);

  // The list: the card's own, read from the page, not a copy typed here.
  const page = fs.readFileSync(path.join(ROOT, 'src/index/120-calendar-flags-write-repair.js.part'), 'utf8');
  const CAL = JSON.parse(page.match(/const CAL_STATUSES\s*=\s*(\[[^\]]*\]);/)[1].replace(/'/g, '"'));
  const expected = CAL.slice(0, CAL.indexOf('Approved') + 1).filter((s) => s !== 'N/A');
  ok(JSON.stringify(L.VERSION_STATUSES) === JSON.stringify(expected), 'the version list is the card list up to Approved, in its order, without N/A: ' + expected.join(', '));
  for (const s of ['N/A', 'Scheduled', 'Posted', 'approved', 'Draft', '']) {
    ok(set(three(), 'B', s).error === 'status_invalid', 'refused as a version status: ' + JSON.stringify(s));
  }

  // Roles: admin and SMM; never a creative; never a client link.
  ok(L.ACTIONS.includes('version_status_set'), 'version_status_set is an action');
  ok(L.staffAllows('admin', 'version_status_set') && L.staffAllows('smm', 'version_status_set'), 'admin and SMM may set a version status');
  ok(!L.staffAllows('creative', 'version_status_set') && !L.staffAllows('automation', 'version_status_set') && !L.staffAllows('', 'version_status_set'),
    'a creative, the automation key and no role may not');
  ok(!L.CLIENT_ACTIONS.includes('version_status_set'), 'a client link may not (the card picker is SMM-side only)');

  // Every pick reads back as the picked word (In Progress on a version with a link reads For SMM Approval, below).
  for (const s of L.VERSION_STATUSES) {
    const start = s === 'Approved' ? { status: 'change asked', change_by: 'client', change_note: 'x', change_at: EARLY }
      : { status: 'approved', smm_ok_at: EARLY, kasper_ok_at: EARLY, client_ok_at: EARLY };
    const vs = [v('A'), v('B', start), v('C')];
    const r = set(vs, 'B', s, 'For SMM Approval');
    ok(!r.error && r.patches.length === 1 && r.patches[0].letter === 'B', s + ': one patch, on B only');
    const want = s === 'In Progress' ? 'For SMM Approval' : s;
    ok(word(apply(vs, r), 'B', 'For SMM Approval') === want, s + ': B then reads ' + want);
  }
  {
    const vs = [v('A'), v('B', { frame_url: null, status: 'change asked', change_by: 'smm', change_at: EARLY })];
    ok(word(apply(vs, set(vs, 'B', 'In Progress')), 'B') === 'In Progress', 'In Progress on a version with no link reads In Progress');
  }

  // In Progress and For SMM Approval are one state; the link decides which shows.
  const ip = set([v('A'), v('B', { smm_ok_at: EARLY, kasper_ok_at: EARLY })], 'B', 'In Progress').patches[0].patch;
  const fs_ = set([v('A'), v('B', { smm_ok_at: EARLY, kasper_ok_at: EARLY })], 'B', 'For SMM Approval').patches[0].patch;
  ok(JSON.stringify(ip) === JSON.stringify(fs_) && ip.status === 'waiting' && ip.smm_ok_at === null && ip.kasper_ok_at === null && ip.client_ok_at === null,
    'In Progress and For SMM Approval write the same state: waiting, no OK');
  ok(word([v('A'), v('B', { frame_url: null })], 'B') === 'In Progress' && word(three(), 'B') === 'For SMM Approval', 'no link reads In Progress; a link reads For SMM Approval');

  // Approved straight from the SMM stamps all three OKs (D1), keeping any earlier one.
  let r = set([v('A'), v('B', { smm_ok_at: EARLY })], 'B', 'Approved');
  let p = r.patches[0].patch;
  ok(p.status === 'approved' && p.smm_ok_at === EARLY && p.kasper_ok_at === NOW && p.client_ok_at === NOW, 'Approved: status approved, all three OKs (an earlier OK kept)');
  r = set([v('A'), v('B', { status: 'change asked', change_by: 'client', change_note: 'x', change_at: EARLY })], 'B', 'Approved');
  p = r.patches[0].patch;
  ok(p.status === 'approved' && p.change_by === null && p.change_note === null && p.change_at === null, 'Approved clears an open change');

  // Kasper Approval and Client Approval.
  p = set(three(), 'B', 'Kasper Approval', 'For SMM Approval').patches[0].patch;
  ok(p.status === 'waiting' && p.smm_ok_at === NOW && p.kasper_ok_at === null && p.client_ok_at === null, 'Kasper Approval: the SMM OK only');
  p = set([v('A'), v('B', { status: 'approved', smm_ok_at: EARLY, kasper_ok_at: EARLY, client_ok_at: EARLY })], 'B', 'Client Approval').patches[0].patch;
  ok(p.status === 'waiting' && p.smm_ok_at === EARLY && p.kasper_ok_at === EARLY && p.client_ok_at === null, 'Client Approval from Approved: back to waiting, the client OK cleared');

  // Tweaks Needed: no note needed (as on a card), OKs kept, the change is the SMM's.
  p = set(three(), 'B', 'Tweaks Needed').patches[0].patch;
  ok(p.status === 'change asked' && p.change_by === 'smm' && p.change_note === null && p.change_at === NOW, 'Tweaks Needed: change asked by the SMM, no note required');

  // The content gate: nothing to review with no link (the card refuses its review statuses on an empty part).
  const noLink = () => [v('A'), v('B', { frame_url: null })];
  for (const s of ['For SMM Approval', 'Kasper Approval', 'Client Approval', 'Approved']) ok(set(noLink(), 'B', s).error === 'version_has_no_link', s + ' refused on a version with no link');
  ok(!set(noLink(), 'B', 'In Progress').error && !set(noLink(), 'B', 'Tweaks Needed').error, 'In Progress and Tweaks Needed are allowed with no link');

  // Never on a dropped, on-trial or decided version; never an unknown letter.
  ok(set([v('A'), v('B', { status: 'dropped' })], 'B', 'Approved').error === 'version_dropped', 'a dropped version: Bring back first');
  for (const s of ['on trial', 'winner', 'lost']) ok(set([v('A'), v('B', { status: s })], 'B', 'Approved').error === 'version_on_trial', 'a version ' + s + ' is refused');
  ok(set(three(), 'F', 'Approved').error === 'version_not_found', 'an unknown letter is refused');

  // A pick that changes nothing writes nothing (no ledger noise).
  r = set([v('A'), v('B', { status: 'approved', smm_ok_at: EARLY, kasper_ok_at: EARLY, client_ok_at: EARLY })], 'B', 'Approved');
  ok(!r.error && r.patches.length === 0, 'the same status again: no patch');

  // The SMM placing a version the client passed clears the pass, as Bring back and a new cut do.
  p = set([v('A'), v('B', { client_pass_at: EARLY })], 'B', 'Client Approval').patches[0].patch;
  ok(p.client_pass_at === null, 'a pick clears the client\'s "Not this one"');
  p = set([v('A'), v('B')], 'B', 'Client Approval').patches[0].patch;
  ok(!('client_pass_at' in p), 'a row with no pass never names client_pass_at');

  // A pick the card's own state would read differently is refused, not silently shown as something else.
  r = set(three(), 'B', 'For SMM Approval', 'Client Approval');
  ok(r.error === 'status_follows_card', 'a card sent on whole to the client: For SMM Approval on one version is refused (it would read as Client Approval)');

  // The card reaches Approved only through today's approve: the rule only says it can.
  let vs = three();
  for (const l of ['A', 'B', 'C']) vs = apply(vs, set(vs, l, 'Approved'));
  ok(L.cardApprovable(vs) === true, 'every live version Approved: card_approvable (the page then calls today\'s approve)');
  const code = fs.readFileSync(path.join(ROOT, 'supabase/functions/trial-reels/logic.mjs'), 'utf8')
    + fs.readFileSync(path.join(ROOT, 'supabase/functions/trial-reels/index.ts'), 'utf8');
  ok(!/video_status\s*:/.test(code) && !/\.from\("calendar_posts"\)\s*\.(update|insert|upsert)/.test(code), 'trial-reels still never writes the card');

  // The ledger: the card's status_change shape, under its own action, in the card's words.
  const rows = L.statusLedgerRows('fixtureclient', 'p1', [{ letter: 'B', from_word: 'For SMM Approval', to_word: 'Approved' }], { actor: 'fixture-smm', role: 'smm' }, NOW);
  ok(rows.length === 1 && JSON.stringify(rows[0]) === JSON.stringify({
    client: 'fixtureclient', post_id: 'p1', ts: NOW, actor: 'fixture-smm', role: 'smm', action: 'trial_status', component: 'video',
    from_status: 'For SMM Approval', to_status: 'Approved', source: 'trial-reels', payload: { letter: 'B', label: 'Video B' },
  }), 'one trial_status row: component video, from and to in the card\'s words, payload letter and label');
  r = set(three(), 'B', 'Approved', 'For SMM Approval');
  ok(r.patches[0].from_word === 'For SMM Approval' && r.patches[0].to_word === 'Approved', 'a patch carries its from and to in the card\'s words');

  // The staff read says each version's word; a client read does not.
  const staff = L.readShape(three(), { client: false, mainLink: 'https://f.io/fixture-a', cardStatus: 'For SMM Approval' });
  ok(staff.versions.every((x) => x.card_status === 'For SMM Approval'), 'a staff read carries card_status per version');
  const cli = L.readShape(three(), { client: true, mainLink: 'https://f.io/fixture-a', cardStatus: 'Client Approval' });
  ok(cli.versions.every((x) => !('card_status' in x)), 'a client read carries no card_status');
  ok(L.versionCardStatus(v('B', { status: 'dropped' }), three()) === null && L.versionCardStatus(v('B', { status: 'on trial' }), three()) === null,
    'a dropped or on-trial version has no picker word');

  console.log(`\ntrial-version-status-logic: ${passed} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
