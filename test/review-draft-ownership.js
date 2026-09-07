'use strict';
// Actual composer helpers, isolated storage and fictional owners; no I/O writers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('./helpers/review-draft-source')(fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'));
function setup(storage = new Map(), source = core) {
  const post = { id: 'fictional-card', client: 'fictional-client' };
  const review = () => ({ drafts: {}, errors: {}, saving: {}, draftActionIds: {} });
  const s = { actor: 'staff:fictional-a:smm', denied: false, readDenied: false, mints: 0,
    calState: { client: post.client, posts: [post] }, sxrState: { client: post.client, posts: [post] },
    _calReviewState: review(), _sxrReviewState: review(), _kasperState: { items: [{ post }] },
    calClientSlug: x => x, sxrClientSlug: x => x,
    document: { querySelectorAll: () => [] }, _calEsc: x => String(x), _calEscAttr: x => String(x),
    _writeUiPrincipalKey: () => s.actor, _calMintCommentId: () => 'fictional-note-' + (++s.mints),
    localStorage: { getItem: k => { if (s.readDenied) throw new Error('synthetic denied'); return storage.get(k) || null; },
      setItem: (k,v) => { if (s.denied) throw new Error('synthetic quota'); storage.set(k,v); } },
  };
  vm.createContext(s); vm.runInContext(source, s);
  return { s, post, storage, ctx: () => s._reviewDraftContext('calendar', post, 'video'),
    input: value => s._reviewDraftInput('calendar', post, 'video', value),
    take: (kind = 'note', value = 'Original fictional text') => s._reviewDraftTake('calendar', post, 'video', kind, value) };
}
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
test('unsent whitespace survives fresh context, actor/client/component isolation and return', () => {
  const f = setup(); f.input('  Unsent fictional text\n');
  const fresh = setup(f.storage), ctx = fresh.s._reviewDraftBind('calendar', fresh.post, 'video');
  assert.equal(ctx.value.text, '  Unsent fictional text\n');
  fresh.s.actor = 'staff:fictional-b:smm';
  assert.equal(fresh.s._reviewDraftBind('calendar', fresh.post, 'video').value.text, '');
  assert.equal(fresh.s._calReviewState.drafts['fictional-card|video'], '');
  fresh.s.actor = 'staff:fictional-a:smm';
  assert.equal(fresh.s._reviewDraftBind('calendar', fresh.post, 'caption').value.text, '');
  fresh.s.calState.client = 'fictional-other';
  assert.equal(fresh.s._reviewDraftCurrent(ctx), false);
  fresh.s.calState.client = fresh.post.client;
  assert.equal(fresh.s._reviewDraftBind('calendar', fresh.post, 'video').value.text, '  Unsent fictional text\n');
});
function newerConserved(source, phase) {
  const f = setup(new Map(), source); f.input('Original fictional text'); const attempt = f.take();
  f.s._reviewDraftConsume(attempt); f.input('Newer fictional typing');
  f.s._reviewDraftFinish(attempt, phase);
  assert.equal(f.ctx().value.text, 'Newer fictional typing');
  return f;
}
test('late failure and success settle captured revision without replacing newer typing', () => {
  const failed = newerConserved(core, 'failed');
  assert.equal(failed.ctx().value.attempt.text, 'Original fictional text');
  assert.ok(failed.storage.get(failed.ctx().key).includes('Newer fictional typing'));
  assert.equal(newerConserved(core, 'accepted').ctx().value.attempt, null);
});
test('revision-loss mutant is rejected by the actual conservation assertion', () => {
  const mutant = core.replace('if (next.revision === attempt.revision) next.text', 'if (true) next.text');
  assert.notEqual(mutant, core); assert.throws(() => newerConserved(mutant, 'accepted'), assert.AssertionError);
});
test('explicit precommit refusal restores ordinary text and preserves newer typing', () => {
  const f = setup(); f.input('Original fictional text'); const attempt = f.take();
  f.s._reviewDraftConsume(attempt); f.s._reviewDraftFinish(attempt, 'refused');
  assert.equal(f.ctx().value.attempt, null); assert.equal(f.ctx().value.text, 'Original fictional text');
  assert.equal(setup(f.storage).ctx().value.text, 'Original fictional text');
  assert.equal(newerConserved(core, 'refused').ctx().value.attempt, null);
});
test('refusal with unavailable storage keeps the earlier owned attempt and original bytes', () => {
  const f = setup(); f.input('Original fictional text'); const attempt = f.take(); f.s._reviewDraftConsume(attempt);
  const before = f.storage.get(f.ctx().key); f.s.denied = true; f.s._reviewDraftFinish(attempt, 'refused');
  assert.equal(f.storage.get(f.ctx().key), before); assert.equal(f.ctx().value.attempt.id, attempt.id);
  assert.equal(f.ctx().value.attempt.text, 'Original fictional text');
  assert.equal(setup(f.storage).ctx().value.text, 'Original fictional text');
});
test('captured ID is durable before clear; reopen is unconfirmed and explicit retry reuses it', () => {
  const f = setup(); f.input('Original fictional text'); const attempt = f.take();
  assert.equal(JSON.parse(f.storage.get(f.ctx().key)).attempt.id, attempt.id);
  f.s._reviewDraftConsume(attempt);
  const fresh = setup(f.storage), ctx = fresh.ctx();
  assert.equal(ctx.value.text, 'Original fictional text'); assert.equal(ctx.value.attempt.phase, 'unconfirmed');
  const retried = fresh.take(); assert.equal(retried.id, attempt.id); assert.equal(fresh.s.mints, 0);
  assert.equal(fresh.take(), null, 'another in-flight attempt cannot be captured');
});
test('different action kind cannot reuse an unresolved attempt; accepted native repair is not replayed', () => {
  const f = setup(); f.input('Original fictional text'); const attempt = f.take();
  f.s._reviewDraftFinish(attempt, 'failed');
  assert.equal(f.take('tweak'), null); assert.equal(f.s.mints, 1);
  f.s._reviewDraftFinish(attempt, 'native'); assert.equal(f.take(), null);
});
test('explicit earlier retry keeps newer draft and earlier stable identity', () => {
  const f = newerConserved(core, 'failed'); const ctx = f.ctx(), oldId = ctx.value.attempt.id;
  assert.equal(f.take('note', 'Newer fictional typing'), null);
  ctx.retry = oldId; const retry = f.take('note', 'Newer fictional typing');
  assert.equal(retry.id, oldId); assert.equal(retry.text, 'Original fictional text');
  f.s._reviewDraftConsume(retry); assert.equal(ctx.value.text, 'Newer fictional typing');
  f.s._reviewDraftFinish(retry, 'accepted'); assert.equal(ctx.value.text, 'Newer fictional typing');
});
test('storage denial keeps typing; capture refuses to clear or submit', () => {
  const f = setup(); f.s.denied = true;
  assert.equal(f.input('Original fictional text'), false);
  assert.equal(f.ctx().value.text, 'Original fictional text'); assert.equal(f.take(), null);
  assert.match(f.ctx().error, /Keep this tab open/); assert.equal(f.storage.size, 0);
  f.s.denied = false; assert.ok(f.take());
});
test('storage failure during consume or acknowledgement retains captured bytes and visible text', () => {
  const f = setup(); f.input('Original fictional text'); const attempt = f.take(), before = f.storage.get(f.ctx().key);
  f.s.denied = true; f.s._reviewDraftConsume(attempt); f.s._reviewDraftFinish(attempt, 'accepted');
  assert.equal(f.ctx().value.text, 'Original fictional text');
  assert.equal(f.storage.get(f.ctx().key), before); assert.ok(f.ctx().value.attempt);
});
test('cross-tab conflict preserves both outside bytes and new in-memory typing', () => {
  const f = setup(); f.input('Original fictional text'); const ctx = f.ctx();
  const outside = f.storage.get(ctx.key).replace('Original fictional text', 'Other-tab fictional text');
  f.storage.set(ctx.key, outside); assert.equal(f.input('Newer fictional typing'), false);
  assert.equal(f.storage.get(ctx.key), outside); assert.equal(ctx.value.text, 'Newer fictional typing'); assert.equal(f.take(), null);
});
test('malformed/unreadable records are not reassigned or overwritten', () => {
  const f = setup(), key = f.ctx().key;
  f.storage.set(key, '{invalid'); const fresh = setup(f.storage);
  fresh.input('Original fictional text'); assert.equal(fresh.take(), null); assert.equal(f.storage.get(key), '{invalid');
  const denied = setup(f.storage); denied.s.readDenied = true;
  assert.equal(denied.ctx().unreadable, true); assert.equal(denied.take(), null);
});
test('late completion does not repaint another principal; unrelated action receipt cannot retire debt', () => {
  const f = setup(); f.input('Original fictional text'); const attempt = f.take();
  f.s.actor = 'staff:fictional-b:smm'; f.s._reviewDraftBind('calendar', f.post, 'video');
  f.s._reviewDraftFinish(attempt, 'failed');
  assert.equal(f.s._calReviewState.drafts['fictional-card|video'], '');
  f.s.actor = 'staff:fictional-a:smm'; const current = f.ctx();
  f.s._reviewDraftFinish({ ...attempt, id: 'unrelated-id' }, 'accepted'); assert.equal(current.value.attempt.id, attempt.id);
});
test('only the exact acknowledged source comment can retire the captured attempt', () => {
  const f = setup(); f.input('Original fictional text'); const attempt = f.take();
  const note = { id: attempt.id, body: attempt.text, is_tweak: false };
  for (const [slug, principal, wire] of [
    ['wrong-client', f.s.actor, { id: f.post.id, video_tweaks: JSON.stringify([note]) }],
    [f.post.client, 'wrong-owner', { id: f.post.id, video_tweaks: JSON.stringify([note]) }],
    [f.post.client, f.s.actor, { id: f.post.id, caption_tweaks: JSON.stringify([note]) }],
    [f.post.client, f.s.actor, { id: f.post.id, video_tweaks: JSON.stringify([{ ...note, body: 'Different text' }]) }],
    [f.post.client, f.s.actor, { id: f.post.id, video_status: 'Approved' }],
  ]) {
    f.s._reviewDraftSourceAck('calendar', slug, wire, principal);
    assert.equal(f.ctx().value.attempt.id, attempt.id);
  }
  f.input('Newer fictional typing');
  f.s._reviewDraftSourceAck('calendar', f.post.client, { id: f.post.id, video_tweaks: JSON.stringify([note]) }, f.s.actor);
  assert.equal(f.ctx().value.attempt, null); assert.equal(f.ctx().value.text, 'Newer fictional typing');
});
test('unsigned local ownership preserves existing permissions without assigning drafts to another session', () => {
  const session = new Map();
  const f = setup(); f.s.actor = ''; f.s._isClientLink = false;
  f.s.sessionStorage = { getItem: k => session.get(k) || null, setItem: (k,v) => session.set(k,v), removeItem: k => session.delete(k) };
  f.input('Original fictional text'); assert.match(f.ctx().principal, /^session:/);
  const principal = f.ctx().principal;
  f.s._reviewDraftSuspend();
  assert.notEqual(f.s._reviewDraftPrincipal(), principal, 'identity loss rotates local anonymous ownership');
  f.s._isClientLink = true; assert.equal(f.s._reviewDraftPrincipal(), '', 'invalid client capability has no anonymous fallback');
});
console.log('Review draft ownership: ' + passed + ' isolated cases passed.');
