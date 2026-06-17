'use strict';
/*
 * Kasper's URGENT ping — the editor gets the same #video-editing Slack message
 * whether the SMM clicks URGENT on the calendar or Kasper clicks it in his
 * review queue.
 *
 * Run:  node test/kasper-urgent-ping.js   (exit 0 = all good)
 *
 * CONTEXT. The URGENT ping was SMM-only: a manual button on the calendar card.
 * Kasper had no way to fire it, so when he flagged a tweak as urgent the editor
 * was never pinged unless the SMM noticed and clicked it (exactly the gap Analia
 * reported for Terrin / Dr. Sonia — the bot message never appeared because the
 * button was never pressed).
 *
 * FIX. A shared _calUrgentSlackDispatch(btn, issue, client, name) does the
 * confirm → POST → latch. _calSendUrgentSlack (SMM) and _kasperSendUrgentSlack
 * (Kasper) both feed it. The Kasper handler resolves the post from the
 * CROSS-CLIENT review queue (_kasperState.items / .replies), not calState.posts
 * (which only holds the actively-loaded client), so it works from any card in
 * the queue and sends that card's own client.
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

const SRC = [
  grabFunc('_calUrgentSlackDispatch'),
  grabFunc('_calSendUrgentSlack'),
  grabFunc('_kasperSendUrgentSlack'),
].join('\n\n');

function fakeBtn() {
  return {
    dataset: {}, disabled: false, textContent: 'URGENT',
    classList: { _s: new Set(), add(c) { this._s.add(c); }, contains(c) { return this._s.has(c); } },
  };
}
function build(env) {
  const globals = {
    showConfirm: (t, m, onYes) => onYes(),
    showNotify: (t, m) => env.notes.push({ t, m }),
    fetch: (url, opts) => {
      env.fetches.push({ url, body: JSON.parse(opts.body) });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, editor: 'Iara Jael' }) });
    },
    URGENT_SLACK_URL: 'http://x/webhook/send-urgent-slack',
    calState: env.calState || { client: '', posts: [] },
    _kasperState: env._kasperState || { items: [], replies: [] },
    wlCanonicalClient: (s) => s,
  };
  const names = Object.keys(globals);
  const fn = new Function(...names, SRC + '\nreturn { _calSendUrgentSlack, _kasperSendUrgentSlack };');
  return fn(...names.map((n) => globals[n]));
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const evt = (btn) => ({ preventDefault() {}, stopPropagation() {}, currentTarget: btn });

let failures = 0;
function check(label, cond) {
  if (!cond) failures++;
  console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}`);
}

const VID = 'https://linear.app/synchro-social/issue/VID-12624/video-1';

(async () => {
  console.log('— behaviour: SMM + Kasper both fire the identical ping —');

  // SMM button still works, now through the shared dispatch.
  {
    const env = { notes: [], fetches: [], calState: { client: 'Miki Agrawal', posts: [{ id: 'p1', linear_issue_id: VID, name: 'Video 6' }] } };
    const m = build(env);
    const btn = fakeBtn();
    m._calSendUrgentSlack(evt(btn), 'p1');
    await tick(); await tick();
    check('SMM: posts exactly once', env.fetches.length === 1);
    check('SMM: payload = { issue, client, name }',
      !!env.fetches[0] && env.fetches[0].body.issue === VID
      && env.fetches[0].body.client === 'Miki Agrawal' && env.fetches[0].body.name === 'Video 6');
    check('SMM: button latches to Sent', btn.dataset.urgentSent === '1' && btn.classList.contains('is-sent'));
  }

  // Kasper button resolves the post CROSS-CLIENT from the review queue, even
  // though the actively-loaded calendar client is someone else entirely.
  {
    const env = {
      notes: [], fetches: [],
      calState: { client: 'Some Other Client', posts: [] },
      _kasperState: { items: [{ post: { id: 'k1', linear_issue_id: VID, name: 'June 11th Video 1' }, client: 'Terrin Ammar', slug: 'terrinammar' }], replies: [] },
    };
    const m = build(env);
    const btn = fakeBtn();
    m._kasperSendUrgentSlack(evt(btn), 'k1');
    await tick(); await tick();
    check('Kasper: posts exactly once', env.fetches.length === 1);
    check("Kasper: sends the card's OWN client + sub-issue (cross-client)",
      !!env.fetches[0] && env.fetches[0].body.issue === VID
      && env.fetches[0].body.client === 'Terrin Ammar' && env.fetches[0].body.name === 'June 11th Video 1');
    check('Kasper: button latches to Sent', btn.dataset.urgentSent === '1' && btn.classList.contains('is-sent'));
  }

  // The per-session latch blocks a double-ping on the same button.
  {
    const env = { notes: [], fetches: [], _kasperState: { items: [{ post: { id: 'k1', linear_issue_id: VID, name: 'X' }, client: 'Terrin Ammar', slug: 'terrinammar' }], replies: [] } };
    const m = build(env);
    const btn = fakeBtn(); btn.dataset.urgentSent = '1';
    m._kasperSendUrgentSlack(evt(btn), 'k1');
    await tick();
    check('Kasper: an already-sent button does not re-post', env.fetches.length === 0);
    check('Kasper: warns "Already sent"', env.notes.some((n) => /already sent/i.test(n.t)));
  }

  // No linked sub-issue → can't resolve an editor → don't post, say why.
  {
    const env = { notes: [], fetches: [], _kasperState: { items: [{ post: { id: 'k2', linear_issue_id: '', name: 'X' }, client: 'Terrin Ammar', slug: 'terrinammar' }], replies: [] } };
    const m = build(env);
    m._kasperSendUrgentSlack(evt(fakeBtn()), 'k2');
    await tick();
    check('Kasper: no Linear link → no post', env.fetches.length === 0);
    check('Kasper: no Linear link → "No Linear link" notice', env.notes.some((n) => /no linear link/i.test(n.t)));
  }

  console.log('\n— source-form guards —');
  const cardSrc = grabFunc('_kasperRenderCard');
  check("Kasper card gates URGENT on the shared _calShowUrgent(p, 'video')", /_calShowUrgent\(p, 'video'\)/.test(cardSrc));
  check('Kasper card wires the button to _kasperSendUrgentSlack', /_kasperSendUrgentSlack\(event,/.test(cardSrc));
  check('Kasper button reuses .cal-urgent-btn (+ kcard variant)', /class="cal-urgent-btn kcard-urgent-btn"/.test(cardSrc));
  check('both SMM and Kasper route through the shared _calUrgentSlackDispatch',
    /_calUrgentSlackDispatch\(/.test(grabFunc('_calSendUrgentSlack')) && /_calUrgentSlackDispatch\(/.test(grabFunc('_kasperSendUrgentSlack')));
  check('Kasper handler resolves from the review queue, not calState.posts',
    /_kasperState\.items/.test(grabFunc('_kasperSendUrgentSlack')) && !/calState\.posts/.test(grabFunc('_kasperSendUrgentSlack')));
  check('.kcard-urgent-btn CSS exists', /\.kcard-urgent-btn\s*\{/.test(INDEX));

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\nAll kasper-urgent-ping checks passed.');
})();
