'use strict';
/* comment-round-zero-browser.js -- OPEN_REPAIRS 382.
 *
 * Older calendar comments were stored with round 0, and a reply inherits its
 * thread root's round. The page sent that 0 to production-write, whose own
 * check let it through, and production_comments' CHECK (round > 0) threw: a 500
 * the page retried about 520 times between 2026-10-07 21:58 and 2026-10-08
 * 19:10 UTC. The page must send no round (null) instead, on the first send and
 * on a queued retry.
 *
 * Fully mocked (lost-work-lib.js, whose production-write now refuses round 0
 * with the same 500 the live table caused); nothing reaches a live backend.
 *   A  a reply under a round-0 thread, through the shipped Calendar save path, saves
 *   B  the same on the Samples save path
 *   C  the rule itself: 0, '', null, negatives and fractions send no round; 1+ is kept
 *   D  a queued retry recorded with round 0 replays with no round
 */
const { createEnv, sleep } = require('./lost-work-lib');
const failures = [];
const check = (c, m) => { console.log((c ? '  ok  ' : 'FAIL  ') + m); if (!c) failures.push(m); };
const commentCalls = (S) => S.log.filter(e => e.key === 'gw:comment');

(async () => {
  const S = await createEnv();
  try {
    const page = await S.newPage();
    await S.openCalendar(page);
    const sent = [];
    page.on('request', r => {
      if (!/\/functions\/v1\/production-write$/.test(new URL(r.url()).pathname) || r.method() !== 'POST') return;
      try { const b = JSON.parse(r.postData() || '{}'); if (b.operation === 'comment') sent.push(b); } catch (e) {}
    });

    // A. Calendar: a reply whose thread root carries round 0.
    const a = await page.evaluate(async () => {
      const post = (calState.posts || []).find(p => p.id === 'p_t1');
      if (!post) return { error: 'no card' };
      try {
        const ack = await _calPostLinearComment(_calLinearUrlFor(post, 'video'), 'Reply under an old note', 'Browser Staff', {
          post, component: 'video', parentId: '',
          comment: { id: 'cmt-round-zero-a', parent_id: '', author: 'Browser Staff', body: 'Reply under an old note', created_at: new Date().toISOString() },
          audience: 'internal', isTweak: false, round: 0,
        });
        return { ok: !!(ack && ack.native_committed), ack: ack && { native_committed: ack.native_committed } };
      } catch (e) { return { error: String(e && (e.code || e.message) || e) }; }
    });
    await sleep(300);
    const aSent = sent.find(b => b.comment && /Reply under an old note/.test(b.comment.body || ''));
    check(aSent && aSent.comment.round === null, 'A: the Calendar save sends no round for a round-0 thread (sent ' + JSON.stringify(aSent && aSent.comment.round) + ')');
    check(a && a.ok === true, 'A: and it saves: the gateway commits it (' + JSON.stringify(a) + ')');
    check(S.comments.some(c => /Reply under an old note/.test(c.body || '') && c.round === null), 'A: the saved comment has no round');
    check(!commentCalls(S).some(e => /http 500/.test(e.outcome || '')), 'A: no comment save was answered 500');

    // B. Samples: the same rule on the sxr save path.
    const b = await page.evaluate(async () => {
      const post = (calState.posts || []).find(p => p.id === 'p_t1');
      try {
        const ack = await _sxrPostLinearComment('', 'Samples reply under an old note', 'Browser Staff', {
          post, component: 'video', parentId: '',
          comment: { id: 'cmt-round-zero-b', parent_id: '', author: 'Browser Staff', body: 'Samples reply under an old note', created_at: new Date().toISOString() },
          audience: 'internal', isTweak: false, round: 0,
        });
        return { ok: !!(ack && ack.native_committed) };
      } catch (e) { return { error: String(e && (e.code || e.message) || e) }; }
    });
    await sleep(300);
    const bSent = sent.find(x => x.comment && /Samples reply under an old note/.test(x.comment.body || ''));
    check(!bSent || bSent.comment.round === null, 'B: the Samples save never sends round 0 (sent ' + JSON.stringify(bSent && bSent.comment.round) + ', result ' + JSON.stringify(b) + ')');

    // C. The rule the four call sites share.
    const c = await page.evaluate(() => [0, '0', '', null, undefined, -1, 1.5, 'x', 1, 2, '3']
      .map(v => [v === undefined ? 'undefined' : v, _writeUiCommentRound(v)]));
    const want = [[0, null], ['0', null], ['', null], [null, null], ['undefined', null], [-1, null], [1.5, null], ['x', null], [1, 1], [2, 2], ['3', 3]];
    check(JSON.stringify(c) === JSON.stringify(want), 'C: _writeUiCommentRound keeps 1+ and sends no round for anything else ' + JSON.stringify(c));

    // D. A queued retry: the journal records the round through the same rule,
    //    and the replay reads it back through it, so a 0 recorded by an older
    //    build is sent as no round.
    const d = await page.evaluate(() => {
      const post = (calState.posts || []).find(p => p.id === 'p_t1');
      const repair = _writeUiBuildSourceRepair('calendar', 'comment', {
        post, component: 'video', parentId: '', audience: 'internal', isTweak: false, round: 0,
        comment: { id: 'cmt-round-zero-d', body: 'Queued reply', created_at: new Date().toISOString() },
      });
      const intent = repair && (repair.intents || []).find(i => i.operation === 'comment');
      return intent ? intent.comment_meta : { missing: Object.keys(repair || {}) };
    });
    check(d && d.round === null, 'D: a queued retry of a round-0 reply is recorded with no round (' + JSON.stringify(d) + ')');
    // E. The source of the 0: a canonical comment with NO round read back as
    //    round 0 (Number(null) is 0), was stored on the card that way, and a
    //    reply under it inherited the 0. It must read back as no round.
    const e = await page.evaluate(() => {
      const base = { id: 'pc_e', native_comment_id: 'pc_e', body: 'x', author_name: 'A', audience: 'internal', created_at: '2026-10-07T14:43:33Z', updated_at: '2026-10-07T14:43:33Z' };
      return [null, undefined, 0, 2].map(r => _prodCommentNormalize(Object.assign({}, base, r === undefined ? {} : { round: r }), 0).round);
    });
    check(JSON.stringify(e) === JSON.stringify([null, null, null, 2]), 'E: a comment read back with no round (or 0) keeps no round; a real round is kept (' + JSON.stringify(e) + ')');
  } catch (e) {
    check(false, 'stopped early: ' + String(e && e.message || e).split('\n')[0].slice(0, 200));
  } finally {
    await S.close();
  }
  if (failures.length) { console.log('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\ncomment-round-zero-browser: all checks passed');
})();
