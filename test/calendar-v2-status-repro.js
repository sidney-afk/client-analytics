'use strict';
/*
 * Calendar v2 status-revert bug — reproduction + fix regression harness.
 *
 * Run:  node test/calendar-v2-status-repro.js   (exit 0 = all good)
 *
 * It EXTRACTS the real functions from ../index.html (by NAME, brace-balanced —
 * robust to line shifts) so we test the ACTUAL shipping code, not a paraphrase,
 * for the core transformation (_calMigratePostShape, computeOverallStatus,
 * _calMergePostComments, _calPostsEqualForRender, …).
 *
 * It models the parts that live inside _calFlushCardSave / loadCalendarPosts
 * (echo-merge + LWW recent-save guard + dataChanged re-render suppression) as
 * faithful copies of those code blocks, with a BUGGY and a FIXED variant of
 * the echo-merge so we can A/B them, and asserts the shipped index.html carries
 * the FIXED form.
 *
 * The upsert webhook is SIMULATED but VALIDATED at startup against the real
 * echoes captured from the live n8n calendar-upsert-post webhook (partial,
 * field-level: { id, updated_at, <only the patched columns> }).
 *
 * THE BUG (v2, ?v2=1): a field-level patch echo carries only the columns it
 * wrote. Running _calMigratePostShape on that PARTIAL echo seeded the absent
 * sub-statuses to 'In Progress' (isLegacyOnly is false once any one sub is
 * present); the Object.assign that adopts the echo then overlaid those invented
 * values onto the correct local ones. The clobber stayed LATENT (the save
 * success path doesn't re-render; the realtime reload's recent-save guard keeps
 * the clobbered local copy; dataChanged was false so no repaint) until the next
 * status click repainted the card — "video flips to In Progress on its own".
 * FIX: overlay the echo onto the full local row FIRST, then migrate the MERGED
 * full row → every sub is present, nothing is invented, omitted fields keep
 * their correct local value.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

// Extract a top-level `function NAME(...) { ... }` by brace-balancing — robust
// to line shifts, so this stays valid as a regression test after edits.
function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let i = INDEX.indexOf('{', at), depth = 0;
  for (let j = i; j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
// Extract a single-line `const NAME = ...;` declaration.
function grabConst(name) {
  const re = new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm');
  const m = INDEX.match(re);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

// ---- Real code extracted verbatim from index.html (by name) ----
const REAL = [
  grabConst('CAL_STATUSES'), grabConst('CAL_PRIORITY'), grabConst('CAL_COMPONENTS'), grabConst('CAL_REVIEW_COMPONENTS'),
  grabFunc('_calIsYouTubeCard'), grabFunc('_calTitleEngaged'), grabFunc('_calComponentsFor'),
  grabFunc('_calNormStatus'), grabFunc('computeOverallStatus'), grabFunc('_calClearStaleApprovals'),
  grabFunc('_calLoadCommentsField'), grabFunc('_calMigratePostShape'), grabFunc('_calCommentsFor'),
  grabFunc('_calSetCommentsFor'), grabFunc('_calStringifyComments'), grabFunc('_calCommentStamp'),
  grabFunc('_calMergeCommentLists'), grabFunc('_calMergePostComments'), grabFunc('_calPostsEqualForRender'),
  grabFunc('_calMsgIsTweak'), grabFunc('_calReconcileHasGenuineTweak'), grabFunc('_calIsStaleLinearRegress'),
  grabFunc('_calRecentSaveReconcile'),
].join('\n\n');

// Stubs for globals the extracted code touches but we don't model.
const STUBS = `
let _isClientLink = false;
const _kasperSeen = Object.create(null);
function _calMarkKasperSeen(pid, comp){ _kasperSeen[pid+'|'+comp] = true; }
function _calPostPlatforms(){ return []; }   // test posts aren't YouTube → _calComponentsFor = base 3
function _calV2Log(){}                        // diagnostic logger — no-op in the harness
function _calV2DebugOn(){ return false; }
`;

// Build a module and pull out the symbols we need.
const mod = new Function(STUBS + '\n' + REAL + `
;return { CAL_STATUSES, CAL_PRIORITY, CAL_COMPONENTS, _calNormStatus,
  computeOverallStatus, _calClearStaleApprovals, _calLoadCommentsField,
  _calMigratePostShape, _calCommentsFor, _calSetCommentsFor,
  _calStringifyComments, _calMergeCommentLists, _calMergePostComments,
  _calPostsEqualForRender, _calRecentSaveReconcile, _calIsStaleLinearRegress };`)();

const {
  CAL_COMPONENTS, _calNormStatus, computeOverallStatus, _calClearStaleApprovals,
  _calMigratePostShape, _calCommentsFor, _calMergePostComments, _calPostsEqualForRender,
  _calRecentSaveReconcile, _calIsStaleLinearRegress,
} = mod;

const CAL_CONFLICT_WINDOW_MS = 90 * 1000; // index.html:11906

// ----------------------------------------------------------------------------
// Webhook simulator — reproduces the n8n upsert workflow's response shape.
// Build Row From Patch keeps only ALLOWED keys present in the patch; Wrap
// Response echoes the stripped row = { id, updated_at, ...patched keys }.
// (Comment-cell 3-way merge against base_at is modeled minimally; for this
// repro no comments change.)
// ----------------------------------------------------------------------------
const ALLOWED = ['order_index','scheduled_date','name','asset_url','thumbnail_url',
  'caption','caption_alt','caption_alt_platform','post_url','cta','tweaks','status','linear_issue_id',
  'kasper_approved_at','posted_at','platform','platforms','color',
  'video_status','graphic_status','caption_status','graphic_linear_issue_id',
  'video_tweaks','graphic_tweaks','caption_tweaks',
  'client_video_approved_at','client_graphic_approved_at','client_caption_approved_at',
  'kasper_seen','kasper_approved_after_tweaks'];

let _clock = Date.parse('2026-06-13T20:10:00.000Z');
function nextIso() { _clock += 1000; return new Date(_clock).toISOString(); }

// `db` is the authoritative Supabase row (full).
function makeWebhook(db) {
  return function upsert(wirePost) {
    const updated_at = nextIso();
    const echo = { id: wirePost.id, updated_at };
    for (const k of ALLOWED) {
      if (Object.prototype.hasOwnProperty.call(wirePost, k)) echo[k] = String(wirePost[k] == null ? '' : wirePost[k]);
    }
    // Persist to the full db row (autoMapInputData writes only present keys).
    Object.assign(db, echo);
    return { ok: true, post: echo };
  };
}

// Validate the simulator against the REAL captured echoes.
function assertSimulatorMatchesReality() {
  const db = { id: 'p_mpyjfkmz_fhdlr' };
  const wh = makeWebhook(db);
  const cap = wh({ id: 'p_mpyjfkmz_fhdlr', caption_status: 'Approved', status: 'For SMM Approval' });
  const vid = wh({ id: 'p_mpyjfkmz_fhdlr', video_status: 'For SMM Approval', status: 'For SMM Approval' });
  const gra = wh({ id: 'p_mpyjfkmz_fhdlr', graphic_status: 'Client Approval', status: 'For SMM Approval' });
  const keysOf = o => Object.keys(o.post).sort().join(',');
  const expect = (got, want, label) => {
    if (got !== want) { console.error(`SIMULATOR MISMATCH (${label}): got [${got}] want [${want}]`); process.exit(1); }
  };
  // Real echoes (captured live): caption -> {id,updated_at,status,caption_status}
  expect(keysOf(cap), 'caption_status,id,status,updated_at', 'caption');
  expect(keysOf(vid), 'id,status,updated_at,video_status', 'video');
  expect(keysOf(gra), 'graphic_status,id,status,updated_at', 'graphic');
  console.log('✓ Webhook simulator echo shapes match the real live webhook echoes (caption/video/graphic).\n');
}

// ----------------------------------------------------------------------------
// Faithful model of one tab.
// posts   = in-memory calState.posts
// painted = what the DOM currently shows (snapshot taken on each re-render)
// recentSaves / saveInFlight / pendingEdits = the in-memory guards
// ----------------------------------------------------------------------------
function snap(post) {
  return { video: post.video_status, graphic: post.graphic_status, caption: post.caption_status, status: post.status };
}
function fmt(s) { return `video=${pad(s.video)} graphic=${pad(s.graphic)} caption=${pad(s.caption)} | overall=${pad(s.status)}`; }
function pad(v) { return String(v || '').padEnd(16); }

function makeTab(name, fullRow) {
  const post = JSON.parse(JSON.stringify(fullRow));
  _calMigratePostShape(post);            // load-time migrate (full row → safe)
  post._baseAt = post.updated_at;
  return { name, posts: [post], painted: snap(post), recentSaves: new Map(), saveInFlight: Object.create(null), pendingEdits: Object.create(null) };
}

// _calStatusPick (index.html:16180) — optimistic edit + full re-render.
function tabClick(tab, comp, value) {
  const post = tab.posts[0];
  const key = comp + '_status';
  if (post[key] === value) return null;
  if (!tab.pendingEdits[post.id]) tab.pendingEdits[post.id] = {};
  post[key] = value;
  tab.pendingEdits[post.id][key] = value;
  post.status = computeOverallStatus(post);
  tab.pendingEdits[post.id].status = post.status;
  _calClearStaleApprovals(post, tab.pendingEdits[post.id]);
  post.updated_at = nextIso();           // optimistic local stamp (index.html:16213)
  tab.painted = snap(post);              // _calRenderBody — paints calState
  return { comp, value };
}

// The v2 wirePost builder (index.html:16664-16686).
function buildWire(post, edits) {
  const wire = { id: post.id };
  for (const k of Object.keys(edits)) {
    if (k === 'comments' || k === 'tweaks' || /_tweaks$/.test(k)) continue;
    wire[k] = post[k];
  }
  if ('video_status' in edits || 'graphic_status' in edits || 'caption_status' in edits) wire.status = post.status;
  return wire;
}

// _calFlushCardSave echo-merge — BUGGY (current code, index.html:16727-16753).
function echoMergeBuggy(tab, realId, echo) {
  const saved = Object.assign({}, echo);
  _calMigratePostShape(saved);                                   // <-- invents absent subs on the PARTIAL echo
  const i2 = tab.posts.findIndex(p => p.id === realId);
  if (i2 >= 0) {
    const merged = Object.assign({}, tab.posts[i2], saved);     // <-- clobbers good local subs with invented ones
    const queued = tab.pendingEdits[realId];
    if (queued) for (const k in queued) merged[k] = tab.posts[i2][k];
    _calMergePostComments(merged, tab.posts[i2]);
    merged._baseAt = String(saved.updated_at || merged.updated_at || merged._baseAt || '');
    tab.posts[i2] = merged;
  }
}

// _calFlushCardSave echo-merge — FIXED (migrate the MERGED full row).
function echoMergeFixed(tab, realId, echo) {
  const saved = Object.assign({}, echo);
  const i2 = tab.posts.findIndex(p => p.id === realId);
  if (i2 >= 0) {
    const merged = Object.assign({}, tab.posts[i2], saved);     // overlay only the echo's keys; absent subs stay local
    _calMigratePostShape(merged);                                // migrate the FULL row → no invention
    const queued = tab.pendingEdits[realId];
    if (queued) for (const k in queued) merged[k] = tab.posts[i2][k];
    _calMergePostComments(merged, tab.posts[i2]);
    merged._baseAt = String(saved.updated_at || merged.updated_at || merged._baseAt || '');
    tab.posts[i2] = merged;
  }
}

// _calFlushCardSave (v2) — build patch, POST, run the echo-merge variant.
function tabSave(tab, webhook, echoMerge) {
  const post = tab.posts[0];
  const realId = post.id;
  const edits = tab.pendingEdits[realId];
  if (!edits) return;
  delete tab.pendingEdits[realId];
  tab.saveInFlight[realId] = true;
  const wire = buildWire(post, edits);
  const resp = webhook(wire);                    // real workflow echoes the partial patch
  echoMerge(tab, realId, resp.post);             // <-- buggy or fixed
  tab.recentSaves.set(realId, Date.now());       // index.html:16758
  delete tab.saveInFlight[realId];
  // NOTE: success path does NOT call _calRenderBody → painted state unchanged here.
}

// The realtime bg reload (loadCalendarPosts background) — LWW winner w/ recent-save
// guard (index.html:14370-14431) + dataChanged re-render suppression (14449/14480).
function tabRealtimeReload(tab, db) {
  const fp = JSON.parse(JSON.stringify(db));     // fetched FULL row from Supabase
  fp.status = _calNormStatus(fp.status);
  _calMigratePostShape(fp);
  const prevPosts = tab.posts;
  const lp = prevPosts.find(p => p.id === fp.id);
  const nowMs = Date.now();
  let winner;
  if (tab.saveInFlight[fp.id]) winner = lp;
  else {
    const recentSave = tab.recentSaves.get(fp.id);
    if (recentSave && (nowMs - recentSave) > CAL_CONFLICT_WINDOW_MS) tab.recentSaves.delete(fp.id);
    const stillRecent = tab.recentSaves.has(fp.id);
    const lT = Date.parse(lp.updated_at || ''); const fT = Date.parse(fp.updated_at || '');
    if (stillRecent) winner = lp;                          // <-- keeps clobbered local; Supabase row discarded
    else if (isFinite(lT) && isFinite(fT) && lT >= fT) winner = lp;
    else { const pend = tab.pendingEdits[fp.id]; winner = pend ? Object.assign({}, fp, pend) : fp; }
  }
  _calMergePostComments(winner, winner === lp ? fp : lp);
  winner._baseAt = fp.updated_at || '';
  const newPosts = [winner];
  const dataChanged = !_calPostsEqualForRender(prevPosts, newPosts);
  tab.posts = newPosts;
  if (dataChanged) tab.painted = snap(winner);             // re-render only if changed
  return { dataChanged, keptLocal: winner === lp };
}

// ----------------------------------------------------------------------------
// Drive the exact 4-step repro.
// ----------------------------------------------------------------------------
function runRepro(label, echoMerge) {
  console.log('============================================================');
  console.log(label);
  console.log('============================================================');
  // Fresh card, all subs In Progress (the clean test case).
  const seed = { id: 'p_repro', name: 'REPRO', video_status: 'In Progress', graphic_status: 'In Progress',
                 caption_status: 'In Progress', status: 'In Progress', updated_at: '2026-06-13T20:09:00.000Z',
                 linear_issue_id: '', graphic_linear_issue_id: '' };
  const db = JSON.parse(JSON.stringify(seed));
  const webhook = makeWebhook(db);
  const tab1 = makeTab('Tab 1 (editor)', seed);
  const tab2 = makeTab('Tab 2 (observer)', seed);

  const steps = [
    ['video',   'For SMM Approval'],
    ['graphic', 'Client Approval'],
    ['caption', 'Approved'],
  ];
  for (let i = 0; i < steps.length; i++) {
    const [comp, value] = steps[i];
    tabClick(tab1, comp, value);
    tabSave(tab1, webhook, echoMerge);
    // Realtime event from this write reaches BOTH tabs → debounced bg reload.
    tabRealtimeReload(tab1, db);     // editor tab (recent-save guard active)
    tabRealtimeReload(tab2, db);     // observer tab (no recent save → takes Supabase)
    console.log(`\nStep ${i + 1}: ${comp} → ${value}`);
    console.log(`  Tab1 PAINTED (what the user SEES): ${fmt(tab1.painted)}`);
    console.log(`  Tab1 calState (latent in memory):  ${fmt(snap(tab1.posts[0]))}`);
    console.log(`  Tab2 PAINTED (observer):           ${fmt(tab2.painted)}`);
  }
  // A hard refresh clears in-memory guards → fresh load from Supabase.
  const refreshed = makeTab('Tab 1 refreshed', db);
  console.log(`\nAfter HARD REFRESH of Tab 1 (guards cleared):`);
  console.log(`  Tab1 PAINTED: ${fmt(refreshed.painted)}`);
  console.log(`  Supabase row: ${fmt(snap((() => { const r = JSON.parse(JSON.stringify(db)); _calMigratePostShape(r); return r; })()))}`);

  const seen = tab1.painted;
  const correct = { video: 'For SMM Approval', graphic: 'Client Approval', caption: 'Approved' };
  const bugPresent = !(seen.video === correct.video && seen.graphic === correct.graphic && seen.caption === correct.caption);
  console.log(`\n  >>> RESULT: Tab 1's visible video status = "${seen.video}" ` +
              (bugPresent ? `❌ BUG PRESENT (expected "${correct.video}")` : `✅ CORRECT`));
  console.log('');
  return bugPresent;
}

// Confirm the SHIPPED index.html actually carries the fix (ties this model to
// the real code): the echo-merge must build `merged` first, then migrate it —
// and must NOT migrate the raw partial echo `saved`.
function assertShippedCodeIsFixed() {
  const flush = grabFunc('_calFlushCardSave');
  const hasMergedMigrate = /const merged = Object\.assign\(\{\}, calState\.posts\[i2\], saved\);\s*\n\s*_calMigratePostShape\(merged\);/.test(flush);
  const stillMigratesSaved = /const saved = json\.post \|\| post;\s*\n\s*_calMigratePostShape\(saved\);/.test(flush);
  if (!hasMergedMigrate || stillMigratesSaved) {
    console.error('SHIPPED CODE CHECK FAILED — index.html echo-merge is not the fixed form.');
    console.error('  migrate(merged) present:', hasMergedMigrate, '| still migrates raw echo:', stillMigratesSaved);
    process.exit(1);
  }
  console.log('✓ Shipped index.html _calFlushCardSave migrates the MERGED full row (not the raw partial echo).\n');
}

// Confirm the SHIPPED index.html carries the stale-Linear-round-trip guard: the
// reconcile must consult _calIsStaleLinearRegress before adopting, and the
// background-merge caller must re-assert a refused regress back to Linear.
function assertShippedReconcileGuarded() {
  const rec = grabFunc('_calRecentSaveReconcile');
  const hasGuard = /_calIsStaleLinearRegress\(lp, fp, comp, rsf\)/.test(rec);
  const hasReassertWiring = /_calIsStaleLinearRegress\(lp, fp, comp, _rsf\)\)\s*_calReassertLinearStatus\(lp, comp\)/.test(INDEX);
  if (!hasGuard || !hasReassertWiring) {
    console.error('SHIPPED CODE CHECK FAILED — stale-Linear-regress guard not wired.');
    console.error('  reconcile guard:', hasGuard, '| caller re-assert:', hasReassertWiring);
    process.exit(1);
  }
  console.log('✓ Shipped index.html reconcile refuses a stale Linear regress of a fresh approval and re-asserts it to Linear.\n');
}

// Generalized driver: run an arbitrary step list with the given echo-merge and
// assert tab1's PAINTED state equals the cumulative truth after EVERY step
// (no sub ever shows a value the user didn't set), and that tab2 + a refresh +
// Supabase all agree.
const SEED_ALL_IP = { id: 'p_seq', name: 'SEQ', video_status: 'In Progress', graphic_status: 'In Progress',
  caption_status: 'In Progress', status: 'In Progress', updated_at: '2026-06-13T20:09:00.000Z',
  linear_issue_id: '', graphic_linear_issue_id: '' };

function runSeq(label, steps, echoMerge, seed) {
  seed = seed || SEED_ALL_IP;
  const db = JSON.parse(JSON.stringify(seed));
  const webhook = makeWebhook(db);
  const tab1 = makeTab('Tab1', seed);
  const tab2 = makeTab('Tab2', seed);
  const expect = { video: seed.video_status, graphic: seed.graphic_status, caption: seed.caption_status };
  let ok = true; const probs = [];
  for (const [comp, value] of steps) {
    expect[comp] = _calNormStatus(value);
    tabClick(tab1, comp, value);
    tabSave(tab1, webhook, echoMerge);
    tabRealtimeReload(tab1, db);
    tabRealtimeReload(tab2, db);
    const p = tab1.painted;
    if (!(p.video === expect.video && p.graphic === expect.graphic && p.caption === expect.caption)) {
      ok = false; probs.push(`  after ${comp}→${value}: SAW ${fmt(p)} | WANT video=${expect.video} graphic=${expect.graphic} caption=${expect.caption}`);
    }
  }
  // Final agreement: tab1 painted == tab2 painted == refresh == Supabase subs.
  const refreshed = makeTab('refresh', db);
  const dbMig = (() => { const r = JSON.parse(JSON.stringify(db)); _calMigratePostShape(r); return r; })();
  const eq = (a, b) => a.video === b.video && a.graphic === b.graphic && a.caption === b.caption;
  if (!eq(tab1.painted, snap(refreshed.posts[0])) || !eq(tab1.painted, snap(dbMig)) || !eq(tab1.painted, tab2.painted)) {
    ok = false; probs.push(`  final divergence: tab1=${fmt(tab1.painted)} tab2=${fmt(tab2.painted)} refresh=${fmt(snap(refreshed.posts[0]))} db=${fmt(snap(dbMig))}`);
  }
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
  if (!ok) probs.forEach(s => console.log(s));
  return ok;
}

// Comment-preservation: a video comment exists; the user sets caption=Approved
// AND the same save carries a caption comment. The fix must not drop the video
// comment or the caption comment.
function runCommentTest(echoMerge) {
  const seed = JSON.parse(JSON.stringify(SEED_ALL_IP));
  seed.id = 'p_cmt';
  seed.video_tweaks = JSON.stringify([{ id: 'cV', parent_id: null, body: 'video note', created_at: '2026-06-13T20:00:00.000Z', updated_at: '2026-06-13T20:00:00.000Z' }]);
  const db = JSON.parse(JSON.stringify(seed));
  const webhook = makeWebhook(db);
  const tab = makeTab('Tab', seed);
  const post = tab.posts[0];
  // Add a caption comment locally + set caption status, like the UI would.
  const capC = { id: 'cC', parent_id: null, body: 'caption note', created_at: '2026-06-13T20:05:00.000Z', updated_at: '2026-06-13T20:05:00.000Z' };
  post.caption_comments = [capC]; post.caption_tweaks = JSON.stringify([capC]);
  post.caption_status = 'Approved'; post.status = computeOverallStatus(post);
  tab.pendingEdits[post.id] = { caption_status: 'Approved', status: post.status, caption_tweaks: post.caption_tweaks };
  post.updated_at = nextIso();
  tabSave(tab, webhook, echoMerge);
  tabRealtimeReload(tab, db);
  const vC = _calCommentsFor(tab.posts[0], 'video').map(c => c.id);
  const cC = _calCommentsFor(tab.posts[0], 'caption').map(c => c.id);
  const ok = vC.includes('cV') && cC.includes('cC');
  console.log(`  ${ok ? '✅' : '❌'} comments survive a caption status+comment save (video=[${vC}] caption=[${cC}])`);
  return ok;
}

assertSimulatorMatchesReality();
assertShippedCodeIsFixed();
assertShippedReconcileGuarded();

const buggy = runRepro('A) CURRENT-PRE-FIX BEHAVIOR (buggy echo-merge: migrate the partial echo)', echoMergeBuggy);
const fixed = runRepro('B) FIXED BEHAVIOR (migrate the merged full row)', echoMergeFixed);

console.log('============================================================');
console.log('C) BATTERY — related status sequences (FIXED echo-merge)');
console.log('   asserts tab1 painted == truth after EVERY step + tab2/refresh/db agree');
console.log('============================================================');
const results = [];
results.push(runSeq('canonical: video→SMM, graphic→Client, caption→Approved', [['video','For SMM Approval'],['graphic','Client Approval'],['caption','Approved']], echoMergeFixed));
results.push(runSeq('reversed: caption→Approved, graphic→Client, video→SMM', [['caption','Approved'],['graphic','Client Approval'],['video','For SMM Approval']], echoMergeFixed));
results.push(runSeq('caption-only twice: caption→Kasper, caption→Approved', [['caption','Kasper Approval'],['caption','Approved']], echoMergeFixed));
results.push(runSeq('regress one sub: video→Approved, graphic→Approved, video→Tweaks Needed', [['video','Approved'],['graphic','Approved'],['video','Tweaks Needed']], echoMergeFixed));
results.push(runSeq('all six moves interleaved', [['video','Kasper Approval'],['caption','For SMM Approval'],['graphic','Kasper Approval'],['video','Client Approval'],['caption','Approved'],['graphic','Client Approval']], echoMergeFixed));
// Same battery, but starting from a NON-uniform seed (mixed subs) to be sure
// the fix doesn't depend on the all-In-Progress baseline.
const SEED_MIXED = Object.assign({}, SEED_ALL_IP, { id: 'p_mixed', video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'For SMM Approval', status: 'For SMM Approval' });
results.push(runSeq('mixed seed: caption→Approved only (was the trigger)', [['caption','Approved']], echoMergeFixed, SEED_MIXED));
results.push(runSeq('mixed seed: graphic→Tweaks Needed, then caption→Approved', [['graphic','Tweaks Needed'],['caption','Approved']], echoMergeFixed, SEED_MIXED));

// "Set all" sends ONE patch with several sub-statuses. When a component is
// unlinked it's SKIPPED (index.html _calSetAllSettable), so the echo omits it
// → partial echo of a different shape. The fix must preserve the skipped sub.
function runSetAll(label, pairs, echoMerge, seed) {
  seed = seed || SEED_ALL_IP;
  const db = JSON.parse(JSON.stringify(seed));
  const webhook = makeWebhook(db);
  const tab1 = makeTab('Tab1', seed); const tab2 = makeTab('Tab2', seed);
  const post = tab1.posts[0];
  const edits = tab1.pendingEdits[post.id] = {};
  const expect = { video: seed.video_status, graphic: seed.graphic_status, caption: seed.caption_status };
  for (const [comp, value] of pairs) { post[comp + '_status'] = value; edits[comp + '_status'] = value; expect[comp] = _calNormStatus(value); }
  post.status = computeOverallStatus(post); edits.status = post.status;
  post.updated_at = nextIso(); tab1.painted = snap(post);
  tabSave(tab1, webhook, echoMerge); tabRealtimeReload(tab1, db); tabRealtimeReload(tab2, db);
  const p = tab1.painted;
  const ok = p.video === expect.video && p.graphic === expect.graphic && p.caption === expect.caption;
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
  if (!ok) console.log(`      SAW ${fmt(p)} WANT v=${expect.video} g=${expect.graphic} c=${expect.caption}`);
  return ok;
}

// Realtime storm: several saves land before ANY reload (events coalesce into a
// single debounced reload). Optimistic state must not be lost.
function runStorm(label, steps, echoMerge) {
  const db = JSON.parse(JSON.stringify(SEED_ALL_IP)); db.id = 'p_storm';
  const seed = JSON.parse(JSON.stringify(db));
  const webhook = makeWebhook(db);
  const tab = makeTab('Tab', seed);
  const expect = { video: seed.video_status, graphic: seed.graphic_status, caption: seed.caption_status };
  for (const [comp, value] of steps) { tabClick(tab, comp, value); tabSave(tab, webhook, echoMerge); expect[comp] = _calNormStatus(value); }
  tabRealtimeReload(tab, db);   // ONE coalesced reload after the storm
  const p = tab.painted;
  const ok = p.video === expect.video && p.graphic === expect.graphic && p.caption === expect.caption;
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
  if (!ok) console.log(`      SAW ${fmt(p)} WANT v=${expect.video} g=${expect.graphic} c=${expect.caption}`);
  return ok;
}

// #470 audit: two tabs edit the SAME field. base_at='' disables the scalar
// conflict guard, so this is last-writer-wins + realtime. Assert both tabs
// converge to the last write (no false reject, no stuck divergence).
function runConcurrentSameField(echoMerge) {
  const db = JSON.parse(JSON.stringify(SEED_ALL_IP)); db.id = 'p_conc';
  const seed = JSON.parse(JSON.stringify(db));
  const webhook = makeWebhook(db);
  const A = makeTab('A', seed); const B = makeTab('B', seed);
  tabClick(A, 'video', 'Kasper Approval'); tabSave(A, webhook, echoMerge);   // A writes
  tabClick(B, 'video', 'Client Approval'); tabSave(B, webhook, echoMerge);   // B writes after → LWW winner
  // Realtime reaches both; B is the most recent writer. A still within its
  // recent-save window keeps local until the window passes; model the post-
  // window convergence (a later reload / refresh) too.
  tabRealtimeReload(A, db); tabRealtimeReload(B, db);
  const dbV = (() => { const r = JSON.parse(JSON.stringify(db)); _calMigratePostShape(r); return r.video_status; })();
  // After A's recent-save window expires, A converges to Supabase (LWW winner).
  A.recentSaves.clear(); tabRealtimeReload(A, db);
  const ok = dbV === 'Client Approval' && A.painted.video === 'Client Approval' && B.painted.video === 'Client Approval';
  console.log(`  ${ok ? '✅' : '❌'} concurrent same-field: LWW winner=${dbV}, A=${A.painted.video}, B=${B.painted.video} (converge after window)`);
  return ok;
}

console.log('\n  set-all / storm / concurrent (FIXED):');
results.push(runSetAll('set-all all three: video+graphic+caption → Client Approval', [['video','Client Approval'],['graphic','Client Approval'],['caption','Client Approval']], echoMergeFixed));
results.push(runSetAll('set-all skips unlinked video: graphic+caption → Approved (video must stay)', [['graphic','Approved'],['caption','Approved']], echoMergeFixed,
  Object.assign({}, SEED_ALL_IP, { video_status: 'Kasper Approval', status: 'In Progress' })));
results.push(runStorm('storm: video→SMM, graphic→Client, caption→Approved (one coalesced reload)', [['video','For SMM Approval'],['graphic','Client Approval'],['caption','Approved']], echoMergeFixed));
results.push(runConcurrentSameField(echoMergeFixed));

console.log('\n  (sanity) the canonical sequence under the OLD buggy merge:');
const canonicalBuggy = runSeq('canonical under BUGGY merge (expected to FAIL)', [['video','For SMM Approval'],['graphic','Client Approval'],['caption','Approved']], echoMergeBuggy);

console.log('\n============================================================');
console.log('D) COMMENT PRESERVATION (FIXED echo-merge)');
console.log('============================================================');
const cmtFixed = runCommentTest(echoMergeFixed);

console.log('\n============================================================');
console.log('E) CROSS-ACTOR RECENT-SAVE RECONCILE (Kasper→SMM clobber fix)');
console.log('============================================================');
// Exercises the REAL _calRecentSaveReconcile extracted from index.html with the
// exact values from the live clobber (v2debug log, 2026-06-14 23:21–23:22): the
// SMM saved video=Kasper Approval @23:21:42; Kasper approved video=Client
// Approval @23:21:55; the 90s recent-save guard kept the stale local copy and
// would re-save it over Kasper. The reconcile must now ADOPT Kasper's value,
// while still keeping local for a stale Linear round-trip (a revert to base, or
// an echo of what we wrote) and never touching an older-or-equal server row.
const eResults = [];
function eCase(label, lp, fp, rsf, expect) {
  const out = _calRecentSaveReconcile(lp, fp, rsf);
  let ok;
  if (expect === null) ok = (out === null);
  else ok = !!out && CAL_COMPONENTS.every(c => out[c + '_status'] === expect[c]) && out.status === computeOverallStatus(out);
  console.log(`  ${ok ? '✅' : '❌'} ${label}`);
  if (!ok) console.log('      got', out && { v: out.video_status, g: out.graphic_status, c: out.caption_status, o: out.status }, '| want', expect);
  eResults.push(ok);
}
const LP = { id: 'p_x', video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Kasper Approval', status: 'Kasper Approval', updated_at: '2026-06-14T23:21:42.833Z' };
const RSF = { wrote: { video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Kasper Approval' },
              base:  { video_status: 'In Progress',     graphic_status: 'In Progress',     caption_status: 'In Progress' } };
const newer = '2026-06-14T23:21:55.831Z', older = '2026-06-14T23:21:40.000Z';
// 1) the live clobber: Kasper moved video to a genuinely NEW value → adopt it, keep g/c local.
eCase('Kasper approval (video→Client Approval) is ADOPTED, not clobbered',
  LP, Object.assign({}, LP, { video_status: 'Client Approval', updated_at: newer }), RSF,
  { video: 'Client Approval', graphic: 'Kasper Approval', caption: 'Kasper Approval' });
// 2) stale Linear round-trip reverts video to its pre-save base → IGNORE (keep local, no flicker).
eCase('stale Linear revert (video→base "In Progress") is IGNORED → keep local',
  LP, Object.assign({}, LP, { video_status: 'In Progress', updated_at: newer }), RSF, null);
// 3) the realtime echo of our own write (server == what we wrote) → nothing to adopt.
eCase('echo of our own write (video==wrote) → no-op',
  LP, Object.assign({}, LP, { video_status: 'Kasper Approval', updated_at: newer }), RSF, null);
// 4) server row is NOT newer than our write → never override.
eCase('server not newer than local → no-op',
  LP, Object.assign({}, LP, { video_status: 'Client Approval', updated_at: older }), RSF, null);
// 5) no recent-save record at all → no-op.
eCase('no recent-save record (rsf null) → no-op',
  LP, Object.assign({}, LP, { video_status: 'Client Approval', updated_at: newer }), null, null);
// 6) a field we did NOT change this save (wrote==base) that Kasper then changed → still adopted.
eCase('untouched field (wrote==base) changed by Kasper → ADOPTED',
  LP, Object.assign({}, LP, { graphic_status: 'Client Approval', updated_at: newer }),
  { wrote: { video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Kasper Approval' },
    base:  { video_status: 'In Progress',     graphic_status: 'Kasper Approval', caption_status: 'In Progress' } },
  { video: 'Kasper Approval', graphic: 'Client Approval', caption: 'Kasper Approval' });
// --- Stale-Linear-round-trip guard (the "video reverts after a client approves
// it" bug). We just advanced a Linear-backed component to client review /
// sign-off; the Linear Status Sync round-trips a DRIFTED issue's bare sub-status
// back (no comment, no stamp clear). That regression must NOT be adopted, while
// a genuine forward move or a real tweak (which carries a comment) still is. ---
const LP_AP = { id: 'p_ap', video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved',
  status: 'Approved', updated_at: '2026-06-14T23:21:42.833Z',
  linear_issue_id: 'VID-1', graphic_linear_issue_id: 'GRA-1' };
const RSF_AP = { wrote: { video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved' },
                 base:  { video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval' } };
// 7) THE BUG: a fresh video Approved is round-tripped down to Kasper Approval by
//    a stale Linear sync (no comment) → keep local, adopt nothing.
eCase('stale Linear regress (video Approved → Kasper Approval, no comment) is REFUSED → keep local',
  LP_AP, Object.assign({}, LP_AP, { video_status: 'Kasper Approval', updated_at: newer }), RSF_AP, null);
// 8) same shape, regressed all the way to Tweaks Needed (the doc's example) → refused.
eCase('stale Linear regress (graphic Approved → Tweaks Needed, no comment) is REFUSED → keep local',
  LP_AP, Object.assign({}, LP_AP, { graphic_status: 'Tweaks Needed', updated_at: newer }), RSF_AP, null);
// 9) a GENUINE forward move from an approved state (Approved → Scheduled/Posted) is still adopted.
const LP_CA = { id: 'p_ca', video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval',
  status: 'Client Approval', updated_at: '2026-06-14T23:21:42.833Z', linear_issue_id: 'VID-2', graphic_linear_issue_id: 'GRA-2' };
const RSF_CA = { wrote: { video_status: 'Client Approval', graphic_status: 'Client Approval', caption_status: 'Client Approval' },
                 base:  { video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Kasper Approval' } };
eCase('forward move from above (video Client Approval → Approved) is ADOPTED',
  LP_CA, Object.assign({}, LP_CA, { video_status: 'Approved', updated_at: newer }), RSF_CA,
  { video: 'Approved', graphic: 'Client Approval', caption: 'Client Approval' });
// 10) a GENUINE tweak (regression WITH a new change-request comment) is still adopted.
eCase('genuine tweak (video Client Approval → Tweaks Needed WITH a new comment) is ADOPTED',
  LP_CA, Object.assign({}, LP_CA, { video_status: 'Tweaks Needed', updated_at: newer,
    video_comments: [{ id: 'tw_new', parent_id: null, is_tweak: true, deleted: false, done: false,
      body: 'tighten the hook', created_at: newer, updated_at: newer }] }), RSF_CA,
  { video: 'Tweaks Needed', graphic: 'Client Approval', caption: 'Client Approval' });
// 11) CAPTION has no Linear, so a caption regression is never a round-trip → always adopted.
eCase('caption regress (Approved → Kasper Approval) is ADOPTED — caption has no Linear to round-trip',
  LP_AP, Object.assign({}, LP_AP, { caption_status: 'Kasper Approval', updated_at: newer }), RSF_AP,
  { video: 'Approved', graphic: 'Approved', caption: 'Kasper Approval' });
// 12) the pure predicate is video/graphic-only and respects the comment fingerprint.
(() => {
  const rsf = RSF_AP;
  const fpReg = Object.assign({}, LP_AP, { video_status: 'Kasper Approval', updated_at: newer });
  const checks = [
    ['video regress, no comment → stale=true',  _calIsStaleLinearRegress(LP_AP, fpReg, 'video', rsf) === true],
    ['caption never stale',                      _calIsStaleLinearRegress(LP_AP, Object.assign({}, LP_AP, { caption_status: 'Kasper Approval' }), 'caption', rsf) === false],
    ['echo of our write is not stale',           _calIsStaleLinearRegress(LP_AP, Object.assign({}, LP_AP, { video_status: 'Approved' }), 'video', rsf) === false],
    ['forward (Approved→Posted) not stale',      _calIsStaleLinearRegress(LP_AP, Object.assign({}, LP_AP, { video_status: 'Posted' }), 'video', rsf) === false],
  ];
  checks.forEach(([label, ok]) => { console.log(`  ${ok ? '✅' : '❌'} predicate: ${label}`); eResults.push(!!ok); });
})();
const ePass = eResults.every(Boolean);
console.log(`  → ${eResults.filter(Boolean).length}/${eResults.length} reconcile assertions`);

console.log('\n============================================================');
console.log('SUMMARY');
console.log('============================================================');
console.log(`  A) pre-fix canonical repro:   ${buggy ? 'BUG REPRODUCED ❌' : 'no bug ⚠️'}`);
console.log(`  B) fixed canonical repro:     ${fixed ? 'STILL BUGGY ❌' : 'BUG GONE ✅'}`);
console.log(`  C) battery (fixed):           ${results.every(Boolean) ? 'ALL PASS ✅' : 'FAILURES ❌'} (${results.filter(Boolean).length}/${results.length})`);
console.log(`     buggy-merge control:       ${canonicalBuggy ? 'PASS (unexpected!) ⚠️' : 'FAILS as expected ✅'}`);
console.log(`  D) comment preservation:      ${cmtFixed ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`  E) cross-actor reconcile:     ${ePass ? 'ALL PASS ✅' : 'FAILURES ❌'} (${eResults.filter(Boolean).length}/${eResults.length})`);
const allGood = buggy && !fixed && results.every(Boolean) && !canonicalBuggy && cmtFixed && ePass;
console.log(`\n  OVERALL: ${allGood ? 'PASS ✅' : 'FAIL ❌'}`);
process.exit(allGood ? 0 : 1);
