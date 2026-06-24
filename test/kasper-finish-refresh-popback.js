'use strict';
/*
 * REPRO HARNESS — "I finished this card, why did it pop back into Waiting?"
 * (Kasper's intermittent review-tab bug.)
 *
 * Run:  node test/kasper-finish-refresh-popback.js
 *
 * WHAT KASPER SEES. He works through the Review tab, hits "Finish reviewing" on
 * a card (it slides into "Tweaks pending"), and then — not every time, but
 * sometimes — the card jumps back up into "Waiting for your review". His hunch:
 * "it auto-refreshes a lot, maybe that's it." This harness reproduces that
 * ourselves, deterministically, without the live backend.
 *
 * GROUND TRUTH WE VERIFIED FIRST (so this models production, not a stale rollout):
 *   • The global hand-off stamp IS live and durable — the Supabase column,
 *     the n8n upsert ALLOWED list, and realtime are all wired (70 real client
 *     rows carry a real kasper_finished_at, 12 carry kasper_closed_at). So this
 *     is NOT the "rollout not switched on yet" case; finishing a card persists
 *     globally and survives refresh on every device.
 *
 * THE MECHANISM. The Review tab re-buckets _kasperState.items into Waiting vs
 * Tweaks-pending via _kasperIsFinished (index.html ~26057). Its VERY FIRST gate,
 * ahead of the durable stamp, is:
 *
 *       if (_kasperUndecidedComps(post).length > 0) return false;   // "fresh ask"
 *
 * i.e. ANY actionable component reading "Kasper Approval" un-finishes the card —
 * stamp or no stamp. The auto-refresh (_kasperLoadReview, fired on focus /
 * visibility / realtime echo) REPLACES the in-memory post with whatever the
 * calendar fetch returns and then re-buckets. So if a refresh ingests a snapshot
 * where a component Kasper already decided still reads "Kasper Approval" — a
 * pre-decision read the store hasn't caught up on, or a concurrent writer's
 * carry-forward — the finished card flips back to Waiting. The ONLY thing
 * guarding this is the 30s "local-prefer" window in _kasperLoadReview
 * (~25670-25684); past it, or when another writer bumps the row's updated_at
 * over Kasper's, the stale snapshot wins. That's why it's intermittent and why
 * "it auto-refreshes a lot" is the right instinct.
 *
 * This file pulls the REAL predicates out of ../index.html (brace-balanced, so
 * it survives line shifts — same trick as kasper-review-state-global.js) and
 * runs them through a faithful, line-cited model of:
 *   • _kasperDismiss's hand-off writes      (index.html ~27049-27069)
 *   • _kasperLoadReview's reconcile          (index.html ~25618-25711)
 *   • _kasperPartitionItems                  (real, extracted)
 *
 * Each scenario prints its timeline and ends in:
 *   ✓ STAYS  — card remains in "Tweaks pending" (correct)
 *   ✗ POPS   — card jumped back to "Waiting"     (the reported bug, reproduced)
 * Exit non-zero if ANY scenario reproduces the pop-back, so once we have a fix
 * this file flips to a green regression test.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
function grabConst(name) {
  const re = new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm');
  const m = INDEX.match(re);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

// ── Real shipping code, extracted ────────────────────────────────────────────
const HARNESS = `
let _kasperState = { items: [], dismissed: {}, closed: {} };
let _seenMap = {};
function _kasperGetSeenAt(pid){ return _seenMap[pid] || ''; }
function _kasperMarkSeenAt(pid, ts){ _seenMap[pid] = ts || ''; }
function _calPostPlatforms(){ return []; }   // test posts aren't YouTube → base 3 components
`;

const REAL = [
  grabConst('CAL_STATUSES'),
  grabConst('CAL_COMPONENTS'),
  grabConst('CAL_REVIEW_COMPONENTS'),
  grabFunc('_calIsYouTubeCard'),
  grabFunc('_calTitleEngaged'),
  grabFunc('_calComponentsFor'),
  grabFunc('_calNormStatus'),
  grabFunc('_calCommentsFor'),
  grabFunc('_calMsgIsTweak'),
  grabFunc('_calLatestMsgAt'),
  grabFunc('_calLatestMsgCreatedAt'),
  grabFunc('_calCompHasUnresolvedKasperTweak'),
  grabFunc('_calCompKasperVisible'),
  grabFunc('_calPostKasperVisible'),
  grabFunc('_calPostHasUnresolvedKasperTweak'),
  grabFunc('_kasperUndecidedComps'),
  grabFunc('_kasperFinishedAt'),
  grabFunc('_kasperIsFinished'),
  grabFunc('_kasperIsClosed'),
  grabFunc('_kasperPartitionItems'),
].join('\n\n');

const mod = new Function(HARNESS + '\n' + REAL + `
;return {
  state: _kasperState, seen: _seenMap,
  setSeen: (pid, ts) => { _seenMap[pid] = ts; },
  _kasperIsFinished, _kasperIsClosed, _kasperUndecidedComps,
  _calPostKasperVisible, _calLatestMsgCreatedAt, _kasperPartitionItems,
};`)();

// ── Faithful models of the two paths that move a card between buckets ─────────

// _kasperDismiss hand-off branch (index.html ~27049-27069): stamp the card
// FINISHED on the card itself (durable + global — we verified the backend keeps
// it), mark the local "seen up to here" stamp, set the same-device flag, and
// bump updated_at locally (as _kasperPersistPostWrite does).
function finishReviewing(item) {
  const post = item.post;
  if (mod._kasperUndecidedComps(post).length) throw new Error('finish blocked: undecided components');
  const stamp = mod._calLatestMsgCreatedAt(post) || NOW();
  post.kasper_finished_at = stamp;
  mod.setSeen(post.id, stamp);
  mod.state.dismissed[post.id] = true;
  post.updated_at = NOW();
}

// _kasperLoadReview reconcile (index.html ~25618-25711), the auto-refresh path.
// `serverPosts` is what the calendar fetch returns this tick; nowMs drives the
// 30s local-prefer window. Returns the partition AFTER the refresh.
const KASPER_LOCAL_PREFER_MS = 30 * 1000;
function autoRefresh(serverPosts, nowMs) {
  // extract(): a row is in the fetched queue when a component is Kasper-visible
  // AND it has a video or thumbnail. (index.html ~25818-25834)
  const fetchedQueue = serverPosts
    .filter(p => mod._calPostKasperVisible(p)
      && (String(p.asset_url || '').trim() !== '' || String(p.thumbnail_url || '').trim() !== ''))
    .map(p => ({ post: p }));

  // dismissed / closed prune (~25628-25640) and X-closed filter (~25643).
  const fetchedIds = new Set(fetchedQueue.map(it => it.post.id));
  for (const id of Object.keys(mod.state.dismissed)) if (!fetchedIds.has(id)) delete mod.state.dismissed[id];
  for (const id of Object.keys(mod.state.closed))    if (!fetchedIds.has(id)) delete mod.state.closed[id];
  let items = fetchedQueue.filter(it => !mod._kasperIsClosed(it.post));

  // local-prefer (last-write-wins, time-bound): keep the local post over the
  // fetched one ONLY while the local stamp is < 30s old AND strictly newer.
  // (index.html ~25670-25684) — the sole guard against a stale snapshot.
  const prevById = new Map(mod.state.items.map(x => [x.post.id, x]));
  for (const it of items) {
    const local = prevById.get(it.post.id);
    if (!local) continue;
    const lT = Date.parse((local.post && local.post.updated_at) || '');
    const fT = Date.parse(it.post.updated_at || '');
    const localRecent = isFinite(lT) && (nowMs - lT) < KASPER_LOCAL_PREFER_MS;
    if (localRecent && isFinite(fT) && lT > fT) it.post = local.post;
  }
  mod.state.items = items;
  return mod._kasperPartitionItems(items);     // partition Waiting vs Tweaks-pending (~26121)
}

// ── tiny clock + scenario helpers ────────────────────────────────────────────
let _clock = Date.parse('2026-06-24T15:00:00.000Z');
function NOW() { return new Date(_clock).toISOString(); }
function iso(epochMs) { return new Date(epochMs).toISOString(); }   // absolute → ISO
function tick(ms) { _clock += ms; }

let reproduced = 0;
function bucketOf(part, pid) {
  if (part.tweaks.some(it => it.post.id === pid)) return 'Tweaks pending';
  if (part.waiting.some(it => it.post.id === pid)) return 'Waiting';
  return '(absent)';
}
function report(pid, part, expectStay) {
  const where = bucketOf(part, pid);
  const popped = where === 'Waiting';
  if (popped && expectStay) reproduced++;
  const tag = where === 'Tweaks pending' ? '✓ STAYS' : (popped ? '✗ POPS ' : '· gone ');
  let extra = '';
  if (popped) {
    // WHICH components re-surface = whatever read "Kasper Approval" in this
    // snapshot. It's a SUBSET, not always all three — exactly what Kasper sees.
    const it = part.waiting.find(x => x.post.id === pid);
    const comps = it ? mod._kasperUndecidedComps(it.post) : [];
    extra = `  — comes back showing: [${comps.join(', ') || '(none undecided)'}]`;
  }
  console.log(`   → ${tag}  card is now in "${where}"${extra}`);
  return where;
}
function tweak(id, at_) {
  return { id, role: 'kasper', is_tweak: true, audience: 'internal', body: 'fix the open',
           created_at: at_, updated_at: at_, done: false, deleted: false };
}
// A fully-decided hand-off card: caption approved → Client Approval, video
// change-requested → Tweaks Needed with an open Kasper tweak. No undecided
// components (Finish allowed); the open tweak keeps it Kasper-visible. This is
// the SETTLED, correct server picture once Kasper's two writes have landed.
function decidedCard(id, tAt) {
  return {
    id, name: 'CARD ' + id, asset_url: 'https://x/v.mp4', thumbnail_url: 'https://x/t.png',
    status: 'Tweaks Needed', video_status: 'Tweaks Needed', graphic_status: 'Approved',
    caption_status: 'Client Approval', graphic_linear_issue_id: '',
    kasper_finished_at: '', kasper_closed_at: '', updated_at: tAt,
    video_comments: [tweak(id + '-v', tAt)], graphic_comments: [], caption_comments: [],
  };
}
// The SAME card as the store still had it BEFORE Kasper's request-change write
// was visible: the video is still parked at Kasper Approval, no tweak yet. A
// refresh that ingests THIS snapshot reads the video as an undecided fresh ask.
function preDecisionSnapshot(id, updatedAt) {
  return Object.assign(decidedCard(id, updatedAt), {
    status: 'Kasper Approval', video_status: 'Kasper Approval', video_comments: [],
  });
}
// A decided card whose graphic component is the one Kasper change-requested
// (linked thumbnail, so it IS actionable), with video + caption approved. Used
// to show that the component which "comes back" depends purely on which one a
// given refresh catches still reading Kasper Approval.
function decidedCardGraphic(id, tAt) {
  return {
    id, name: 'CARD ' + id, asset_url: 'https://x/v.mp4', thumbnail_url: 'https://x/t.png',
    status: 'Tweaks Needed', video_status: 'Client Approval', graphic_status: 'Tweaks Needed',
    caption_status: 'Client Approval',
    graphic_linear_issue_id: 'https://linear.app/x/issue/GRA-9/x',   // linked → actionable
    kasper_finished_at: '', kasper_closed_at: '', updated_at: tAt,
    video_comments: [], caption_comments: [], graphic_comments: [tweak(id + '-g', tAt)],
  };
}
function preDecisionSnapshotGraphic(id, updatedAt) {
  return Object.assign(decidedCardGraphic(id, updatedAt), {
    status: 'Kasper Approval', graphic_status: 'Kasper Approval', graphic_comments: [],
  });
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function seedQueue(card) {
  mod.state.items = [{ post: card }];
  mod.state.dismissed = {}; mod.state.closed = {};
  for (const k of Object.keys(mod.seen)) delete mod.seen[k];
}

console.log('REPRO: a finished Kasper card pops back into "Waiting" after an auto-refresh');
console.log('(global hand-off stamp is durable — verified live; this is the residual race)\n');

// ─────────────────────────────────────────────────────────────────────────────
// CONTROL — the happy path p53 already covers: finish, then an auto-refresh that
// reads a SETTLED store (both writes landed, stamp echoed). Must stay put.
// ─────────────────────────────────────────────────────────────────────────────
console.log('CONTROL   finish → refresh against a settled store (both writes landed)');
{
  const card = decidedCard('ctrl', NOW());
  seedQueue(card);
  finishReviewing(mod.state.items[0]);
  tick(2000);
  const server = clone(card); server.kasper_finished_at = card.kasper_finished_at; // durable stamp echoed
  report('ctrl', autoRefresh([server], _clock), true);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROTECTED — same stale read, but WITHIN the 30s window and with no competing
// writer, so local-prefer keeps Kasper's decided post. Demonstrates the guard
// working — and that the bug lives only where the guard doesn't reach.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nPROTECTED finish → stale read at T+5s, no other writer (local-prefer holds)');
{
  const t0 = _clock;
  const card = decidedCard('prot', NOW());
  seedQueue(card);
  finishReviewing(mod.state.items[0]);                  // local.updated_at = t0
  tick(5000);                                            // refresh at t0+5s (< 30s window)
  const stale = preDecisionSnapshot('prot', iso(t0 - 2000)); // store updated_at OLDER than finish
  report('prot', autoRefresh([stale], _clock), true);
}

// ─────────────────────────────────────────────────────────────────────────────
// REPRO A — the realistic intermittent one. WITHIN 30s, but another surface
// wrote the same card just after Kasper finished (a Linear status sync, the SMM,
// the client — any of which read-modify-writes the row and carries the video
// status forward from a base that still says "Kasper Approval"). That write
// bumps the row's updated_at ABOVE Kasper's finish, so local-prefer's `lT > fT`
// fails and the stale snapshot replaces his decided post → video reads as an
// undecided fresh ask → card pops to Waiting.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nREPRO A    finish → a concurrent writer bumps updated_at, refresh ingests the stale row (T+6s)');
{
  const t0 = _clock;
  const card = decidedCard('rA', NOW());
  seedQueue(card);
  finishReviewing(mod.state.items[0]);                  // local.updated_at = t0
  console.log('   finished at T0; card → "Tweaks pending"');
  tick(6000);
  // concurrent write at T0+4s carried video=Kasper Approval forward, newer updated_at
  const stale = preDecisionSnapshot('rA', iso(t0 + 4000)); // updated_at = T0+4s > local T0
  console.log('   another surface touched the card at T0+4s (updated_at now newer than Kasper\'s finish)');
  console.log('   focus/realtime refresh @ T0+6s ingests that row: video still at Kasper Approval');
  report('rA', autoRefresh([stale], _clock), true);
}

// ─────────────────────────────────────────────────────────────────────────────
// REPRO B — the plain-latency variant. Kasper leaves the tab and comes back >30s
// later (focus refresh). The decision write was slow / had to retry, so the
// store the fetch reads still shows the video at Kasper Approval. local-prefer
// has expired, so the stale snapshot wins outright.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nREPRO B    finish → focus-refresh >30s later, decision read still stale');
{
  const card = decidedCard('rB', NOW());
  seedQueue(card);
  finishReviewing(mod.state.items[0]);
  console.log('   finished at T0; card → "Tweaks pending"');
  tick(35000);
  const stale = preDecisionSnapshot('rB', NOW()); // store still pre-decision when he tabs back
  console.log('   focus refresh @ T0+35s (local-prefer lapsed); store still shows video at Kasper Approval');
  report('rB', autoRefresh([stale], _clock), true);
}

// ─────────────────────────────────────────────────────────────────────────────
// REPRO C — "what comes back is not always the three components" (Kasper's words).
// Same race as REPRO A, but here the component left in flight is the GRAPHIC, so
// the card re-surfaces showing JUST the graphic — a different subset than REPRO
// A's video. Which component pops back is whatever that refresh caught mid-write;
// nothing about the card is special. (Run alongside A to see the subset differ.)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nREPRO C    same race, graphic in flight → card comes back showing a DIFFERENT subset');
{
  const t0 = _clock;
  const card = decidedCardGraphic('rC', NOW());
  seedQueue(card);
  finishReviewing(mod.state.items[0]);
  console.log('   finished at T0 (video+caption approved, graphic change-requested)');
  tick(6000);
  const stale = preDecisionSnapshotGraphic('rC', iso(t0 + 4000));
  console.log('   refresh @ T0+6s ingests a row where the graphic still reads Kasper Approval');
  report('rC', autoRefresh([stale], _clock), true);
}

console.log('\n' + '─'.repeat(74));
if (reproduced) {
  console.log(`Reproduced the pop-back in ${reproduced} scenario(s). ✗`);
  console.log('Root cause: _kasperIsFinished un-finishes a card whenever a refreshed snapshot');
  console.log('shows ANY actionable component at "Kasper Approval" — checked ahead of, and');
  console.log('regardless of, the durable finish stamp. A stale/pre-decision read (past the 30s');
  console.log('local-prefer window, or out-bumped by a concurrent writer) is read as a fresh ask.');
  process.exit(1);
}
console.log('No pop-back reproduced — every finished card stayed in "Tweaks pending". ✓');
